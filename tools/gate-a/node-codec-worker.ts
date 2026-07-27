import { readFile, writeFile } from "node:fs/promises";
import {
  brotliCompressSync,
  brotliDecompressSync,
  constants,
  zstdCompressSync,
  zstdDecompressSync,
} from "node:zlib";

const [strategy, inputPath, encodedPath, resultPath] = process.argv.slice(2);
if (!strategy || !inputPath || !encodedPath || !resultPath) {
  throw new Error("Usage: node-codec-worker <strategy> <input-path> <encoded-path> <result-path>");
}

const input = await readFile(inputPath);
let encoded: Buffer;
let decoded: Buffer;
if (strategy === "brotli-text-11") {
  encoded = brotliCompressSync(input, {
    params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
      [constants.BROTLI_PARAM_QUALITY]: 11,
    },
  });
  decoded = brotliDecompressSync(encoded);
} else if (strategy === "zstandard-22") {
  encoded = zstdCompressSync(input, {
    params: {
      [constants.ZSTD_c_compressionLevel]: 22,
    },
  });
  decoded = zstdDecompressSync(encoded);
} else {
  throw new Error(`Unsupported Node relay strategy: ${strategy}.`);
}
await writeFile(encodedPath, encoded);
await writeFile(
  resultPath,
  JSON.stringify({
    accessedInputs: ["opaque-shard"],
    decodedByteLength: decoded.length,
    encodedByteLength: encoded.length,
    exactReconstruction: decoded.equals(input),
    strategyId: strategy,
  }),
);
