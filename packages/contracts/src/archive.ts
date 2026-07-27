import { ContractInputError, childPointer } from "./canonical-json.js";

export interface CanonicalArchiveFile {
  contentBase64: string;
  kind: "file";
  path: string;
}

export interface CanonicalArchiveDirectory {
  kind: "directory";
  path: string;
}

export type CanonicalArchiveEntry = CanonicalArchiveDirectory | CanonicalArchiveFile;

export interface CanonicalArchiveInput {
  contractId: "canonical-archive";
  entries: CanonicalArchiveEntry[];
  schemaVersion: 1;
}

interface NormalizedEntry {
  content: Buffer;
  inputIndex: number;
  kind: "directory" | "file";
  path: string;
}

const BLOCK_SIZE = 512;

function invalidPath(pointer: string, message: string): never {
  throw new ContractInputError("unsafe_path", pointer, message);
}

function normalizeEntry(entry: CanonicalArchiveEntry, index: number): NormalizedEntry {
  const pointer = childPointer(childPointer("", "entries"), index);
  const pathPointer = childPointer(pointer, "path");
  const normalized = entry.path.normalize("NFC");
  const parts = normalized.split("/");

  if (
    normalized !== entry.path ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    invalidPath(pathPointer, `Unsafe archive path: ${entry.path}`);
  }

  const archivePath = entry.kind === "directory" ? `${normalized}/` : normalized;
  if (Buffer.byteLength(archivePath, "utf8") > 100) {
    invalidPath(pathPointer, "Canonical ustar paths are limited to 100 UTF-8 bytes.");
  }

  let content = Buffer.alloc(0);
  if (entry.kind === "file") {
    content = Buffer.from(entry.contentBase64, "base64");
    if (content.toString("base64") !== entry.contentBase64) {
      throw new ContractInputError(
        "format",
        childPointer(pointer, "contentBase64"),
        "Invalid canonical base64.",
      );
    }
  }

  return { content, inputIndex: index, kind: entry.kind, path: archivePath };
}

export function normalizeArchiveEntries(entries: CanonicalArchiveEntry[]): NormalizedEntry[] {
  const normalized = entries.map(normalizeEntry);
  normalized.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));

  const collision = (entry: NormalizedEntry): never =>
    invalidPath(
      childPointer(childPointer(childPointer("", "entries"), entry.inputIndex), "path"),
      `Colliding archive path: ${entry.path}`,
    );
  for (const [index, entry] of normalized.entries()) {
    const entryBase = entry.path.replace(/\/$/, "").toLowerCase();
    for (const prior of normalized.slice(0, index)) {
      const priorBase = prior.path.replace(/\/$/, "").toLowerCase();
      if (entryBase === priorBase) {
        collision(entry.inputIndex > prior.inputIndex ? entry : prior);
      }
      if (entryBase.startsWith(`${priorBase}/`) && prior.kind === "file") {
        collision(entry.inputIndex > prior.inputIndex ? entry : prior);
      }
      if (priorBase.startsWith(`${entryBase}/`) && entry.kind === "file") {
        collision(entry.inputIndex > prior.inputIndex ? entry : prior);
      }
    }
  }
  return normalized;
}

function writeAscii(target: Buffer, offset: number, width: number, value: string): void {
  const bytes = Buffer.from(value, "ascii");
  if (bytes.length > width) {
    throw new ContractInputError("range", "", `ustar field exceeds ${width} bytes.`);
  }
  bytes.copy(target, offset);
}

function octal(value: number, width: number): string {
  const digits = value.toString(8);
  if (digits.length > width - 1) {
    throw new ContractInputError("range", "", `Value ${value} exceeds ustar field width ${width}.`);
  }
  return `${digits.padStart(width - 1, "0")}\0`;
}

function headerFor(entry: NormalizedEntry): Buffer {
  const header = Buffer.alloc(BLOCK_SIZE);
  Buffer.from(entry.path, "utf8").copy(header, 0);
  writeAscii(header, 100, 8, octal(entry.kind === "directory" ? 0o755 : 0o644, 8));
  writeAscii(header, 108, 8, octal(0, 8));
  writeAscii(header, 116, 8, octal(0, 8));
  writeAscii(header, 124, 12, octal(entry.content.length, 12));
  writeAscii(header, 136, 12, octal(0, 12));
  header.fill(0x20, 148, 156);
  writeAscii(header, 156, 1, entry.kind === "directory" ? "5" : "0");
  writeAscii(header, 257, 6, "ustar\0");
  writeAscii(header, 263, 2, "00");
  writeAscii(header, 329, 8, octal(0, 8));
  writeAscii(header, 337, 8, octal(0, 8));

  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeAscii(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
  return header;
}

export function canonicalArchiveBytes(value: unknown): Buffer {
  if (
    value === null ||
    typeof value !== "object" ||
    !("entries" in value) ||
    !Array.isArray(value.entries)
  ) {
    throw new ContractInputError(
      "type",
      "/entries",
      "Canonical archive input requires an entries array.",
    );
  }

  const entries = normalizeArchiveEntries(value.entries as CanonicalArchiveEntry[]);
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(headerFor(entry));
    if (entry.kind === "file") {
      chunks.push(entry.content);
      const padding = (BLOCK_SIZE - (entry.content.length % BLOCK_SIZE)) % BLOCK_SIZE;
      if (padding > 0) {
        chunks.push(Buffer.alloc(padding));
      }
    }
  }
  chunks.push(Buffer.alloc(BLOCK_SIZE * 2));
  return Buffer.concat(chunks);
}
