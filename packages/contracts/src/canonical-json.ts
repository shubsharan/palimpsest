import {
  evaluate,
  parse,
  type JSONValue,
  type ObjectNode,
  type ValueNode,
} from "@humanwhocodes/momoa";
import canonicalize from "canonicalize";

export type ContractReason =
  | "canonical"
  | "digest"
  | "duplicate_key"
  | "enum"
  | "format"
  | "length"
  | "number"
  | "range"
  | "required"
  | "schema_version"
  | "stream"
  | "type"
  | "unicode"
  | "unknown_field"
  | "unsafe_path";

export class ContractInputError extends Error {
  readonly pointer: string;
  readonly reason: ContractReason;

  constructor(reason: ContractReason, pointer: string, message: string) {
    super(message);
    this.name = "ContractInputError";
    this.pointer = pointer;
    this.reason = reason;
  }
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(parent: string, child: string | number): string {
  return `${parent}/${typeof child === "number" ? String(child) : escapePointer(child)}`;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function hasUnpairedEscapedSurrogate(source: string): boolean {
  const matches = [...source.matchAll(/\\u([0-9a-fA-F]{4})/g)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const code = Number.parseInt(match?.[1] ?? "", 16);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = matches[index + 1];
      const nextCode = Number.parseInt(next?.[1] ?? "", 16);
      const adjacent = next?.index === (match?.index ?? 0) + (match?.[0].length ?? 0);
      if (!adjacent || nextCode < 0xdc00 || nextCode > 0xdfff) {
        return true;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function inspectNumber(
  node: Extract<ValueNode, { type: "Number" }>,
  source: string,
  pointer: string,
) {
  const token = source.slice(node.loc.start.offset, node.loc.end.offset);
  if (
    !Number.isFinite(node.value) ||
    Object.is(node.value, -0) ||
    /^-0(?:\.0*)?(?:[eE][+-]?0+)?$/.test(token)
  ) {
    throw new ContractInputError(
      "number",
      pointer,
      "Non-finite and negative-zero numbers are forbidden.",
    );
  }
  if (/^-?[0-9]+$/.test(token) && !Number.isSafeInteger(node.value)) {
    throw new ContractInputError(
      "number",
      pointer,
      "Integers outside the interoperable range must be encoded as strings.",
    );
  }
}

function inspectObject(node: ObjectNode, source: string, pointer: string): void {
  const names = new Set<string>();
  for (const member of node.members) {
    const name = member.name.type === "String" ? member.name.value : member.name.name;
    const memberPointer = childPointer(pointer, name);
    if (names.has(name)) {
      throw new ContractInputError("duplicate_key", memberPointer, `Duplicate object key: ${name}`);
    }
    names.add(name);
    const rawName =
      member.name.type === "String"
        ? source.slice(member.name.loc.start.offset, member.name.loc.end.offset)
        : name;
    if (hasUnpairedSurrogate(name) || hasUnpairedEscapedSurrogate(rawName)) {
      throw new ContractInputError(
        "unicode",
        pointer,
        "Object key contains an unpaired surrogate.",
      );
    }
    inspectNode(member.value, source, memberPointer);
  }
}

function inspectNode(node: ValueNode, source: string, pointer: string): void {
  switch (node.type) {
    case "Array":
      node.elements.forEach((element, index) => {
        inspectNode(element.value, source, childPointer(pointer, index));
      });
      return;
    case "Object":
      inspectObject(node, source, pointer);
      return;
    case "String":
      if (
        hasUnpairedSurrogate(node.value) ||
        hasUnpairedEscapedSurrogate(source.slice(node.loc.start.offset, node.loc.end.offset))
      ) {
        throw new ContractInputError("unicode", pointer, "String contains an unpaired surrogate.");
      }
      return;
    case "Number":
      inspectNumber(node, source, pointer);
      return;
    case "NaN":
    case "Infinity":
      throw new ContractInputError("number", pointer, "Non-finite numbers are forbidden.");
    case "Boolean":
    case "Null":
      return;
  }
}

function pointerForNonFiniteSyntax(source: string): string {
  return /"value"\s*:\s*(?:NaN|[-+]?Infinity)/.test(source) ? "/value" : "";
}

export function parseJsonStrict(source: string): JSONValue {
  let document;
  try {
    document = parse(source, { mode: "json", allowTrailingCommas: false });
  } catch (error) {
    if (/\b(?:NaN|Infinity)\b/.test(source)) {
      throw new ContractInputError(
        "number",
        pointerForNonFiniteSyntax(source),
        "Non-finite numbers are forbidden.",
      );
    }
    const message = error instanceof Error ? error.message : "Invalid JSON.";
    throw new ContractInputError("canonical", "", message);
  }

  inspectNode(document.body, source, "");
  return evaluate(document);
}

function assertCanonicalValue(
  value: unknown,
  pointer: string,
  seen: Set<object>,
): asserts value is JSONValue {
  if (value === null || typeof value === "boolean") {
    return;
  }
  if (typeof value === "string") {
    if (hasUnpairedSurrogate(value)) {
      throw new ContractInputError("unicode", pointer, "String contains an unpaired surrogate.");
    }
    return;
  }
  if (typeof value === "number") {
    if (
      !Number.isFinite(value) ||
      Object.is(value, -0) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    ) {
      throw new ContractInputError(
        "number",
        pointer,
        "Number is outside the canonical interoperable subset.",
      );
    }
    return;
  }
  if (typeof value !== "object") {
    throw new ContractInputError("type", pointer, "Value is not representable as JSON.");
  }
  if (seen.has(value)) {
    throw new ContractInputError("canonical", pointer, "Cyclic values cannot be canonicalized.");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertCanonicalValue(item, childPointer(pointer, index), seen);
    });
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (hasUnpairedSurrogate(key)) {
        throw new ContractInputError(
          "unicode",
          childPointer(pointer, key),
          "Object key contains an unpaired surrogate.",
        );
      }
      assertCanonicalValue(item, childPointer(pointer, key), seen);
    }
  }
  seen.delete(value);
}

export function canonicalJsonBytes(value: unknown): Buffer {
  assertCanonicalValue(value, "", new Set());
  const canonical = canonicalize(value);
  if (canonical === undefined) {
    throw new ContractInputError("canonical", "", "Value cannot be serialized as canonical JSON.");
  }
  return Buffer.from(canonical, "utf8");
}

export { childPointer, escapePointer };
