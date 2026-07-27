export class FrameValidationError extends Error {
  readonly code: string;
  readonly offset: number;

  constructor(code: string, message: string, offset = 0) {
    super(message);
    this.name = "FrameValidationError";
    this.code = code;
    this.offset = offset;
  }
}

export class BinaryReader {
  readonly #bytes: Buffer;
  #offset = 0;

  constructor(bytes: Buffer) {
    this.#bytes = bytes;
  }

  get offset(): number {
    return this.#offset;
  }

  get remaining(): number {
    return this.#bytes.length - this.#offset;
  }

  bytes(length: number): Buffer {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.remaining) {
      throw new FrameValidationError(
        "truncated",
        "Frame ends before the declared field.",
        this.#offset,
      );
    }
    const value = Buffer.from(this.#bytes.subarray(this.#offset, this.#offset + length));
    this.#offset += length;
    return value;
  }

  u8(): number {
    return this.bytes(1).readUInt8();
  }

  u16(): number {
    return this.bytes(2).readUInt16BE();
  }

  u32(): number {
    return this.bytes(4).readUInt32BE();
  }

  u64(): bigint {
    return this.bytes(8).readBigUInt64BE();
  }
}

export class BinaryWriter {
  readonly #chunks: Buffer[] = [];
  #byteLength = 0;

  get byteLength(): number {
    return this.#byteLength;
  }

  bytes(value: Buffer): void {
    this.#chunks.push(value);
    this.#byteLength += value.length;
  }

  u8(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new FrameValidationError("range", `Value ${value} does not fit u8.`);
    }
    const bytes = Buffer.allocUnsafe(1);
    bytes.writeUInt8(value);
    this.bytes(bytes);
  }

  u16(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new FrameValidationError("range", `Value ${value} does not fit u16.`);
    }
    const bytes = Buffer.allocUnsafe(2);
    bytes.writeUInt16BE(value);
    this.bytes(bytes);
  }

  u32(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new FrameValidationError("range", `Value ${value} does not fit u32.`);
    }
    const bytes = Buffer.allocUnsafe(4);
    bytes.writeUInt32BE(value);
    this.bytes(bytes);
  }

  u64(value: bigint): void {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
      throw new FrameValidationError("range", `Value ${value} does not fit u64.`);
    }
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeBigUInt64BE(value);
    this.bytes(bytes);
  }

  finish(): Buffer {
    return Buffer.concat(this.#chunks, this.#byteLength);
  }
}
