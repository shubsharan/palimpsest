export function parseFlags(argv: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  const start = argv[0] === "--" ? 1 : 0;
  for (let index = start; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === undefined || !name.startsWith("--")) {
      throw new Error(`Expected an option name, received ${name ?? "end of input"}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${name} requires a value.`);
    }
    if (flags.has(name)) throw new Error(`${name} may be provided only once.`);
    flags.set(name, value);
    index += 1;
  }
  return flags;
}

export function requiredFlag(flags: ReadonlyMap<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function integerFlag(
  flags: ReadonlyMap<string, string>,
  name: string,
  fallback?: number,
): number {
  const raw = flags.get(name);
  if (raw === undefined && fallback !== undefined) return fallback;
  if (raw === undefined || !/^-?\d+$/.test(raw)) throw new Error(`${name} must be an integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a safe integer.`);
  return value;
}

export function numberFlag(
  flags: ReadonlyMap<string, string>,
  name: string,
  fallback?: number,
): number {
  const raw = flags.get(name);
  if (raw === undefined && fallback !== undefined) return fallback;
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}
