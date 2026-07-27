export const gateAGeometries = [16_384, 27_000, 40_960].flatMap((tokenCount) =>
  [4_096, 8_000, 12_288].map((vocabularySize) => ({
    geometryId: `tokens-${tokenCount}-vocab-${vocabularySize}`,
    tokenCount,
    vocabularySize,
  })),
);

export const gateARetainedGeometryId = "tokens-27000-vocab-8000";

export const gateABudgetsBytes = Array.from({ length: 61 }, (_, index) => (4 + index) * 1_024);

export const gateAStrategies = [
  {
    strategyId: "raw-utf8",
    implementation: "identity",
    inputAccess: ["opaque-shard"],
  },
  {
    strategyId: "fixed-width-token-ids",
    implementation: "palimpsest.channel.codecs/1.0.0",
    inputAccess: ["token-ids", "shared-vocabulary-order"],
  },
  {
    strategyId: "varint-token-ids",
    implementation: "palimpsest.channel.codecs/1.0.0",
    inputAccess: ["token-ids", "shared-vocabulary-order"],
  },
  {
    strategyId: "canonical-huffman-token-ids",
    implementation: "palimpsest.channel.codecs/1.0.0",
    inputAccess: ["token-ids", "shared-vocabulary-order"],
  },
  {
    strategyId: "deflate-9",
    implementation: "python-zlib/1.2.13",
    inputAccess: ["opaque-shard"],
  },
  {
    strategyId: "dictionary-deflate-9",
    implementation: "python-zlib/1.2.13",
    inputAccess: ["opaque-shard", "reference-dictionary"],
  },
  {
    strategyId: "bzip2-9",
    implementation: "python-bz2/3.12.4",
    inputAccess: ["opaque-shard"],
  },
  {
    strategyId: "lzma-xz-9",
    implementation: "python-lzma/3.12.4",
    inputAccess: ["opaque-shard"],
  },
  {
    strategyId: "brotli-text-11",
    implementation: "node-zlib/26.5.0",
    inputAccess: ["opaque-shard"],
  },
  {
    strategyId: "zstandard-22",
    implementation: "node-zlib/26.5.0",
    inputAccess: ["opaque-shard"],
  },
  {
    strategyId: "reference-delta-deflate",
    implementation: "palimpsest.reference-delta/1.0.0",
    inputAccess: ["opaque-shard", "reference-text"],
  },
  {
    strategyId: "sparse-dictionary",
    implementation: "palimpsest.channel.codecs/1.0.0",
    inputAccess: ["token-ids", "shared-vocabulary-order"],
  },
  {
    strategyId: "complete-dictionary",
    implementation: "palimpsest.channel.codecs/1.0.0",
    inputAccess: ["token-ids", "shared-vocabulary-order"],
  },
  {
    strategyId: "cumulative-split-history",
    implementation: "palimpsest.git-strategies/1.0.0",
    inputAccess: ["encoded-relay", "git-genesis"],
  },
] as const;

export const gateAUsefulState = {
  checkpointCount: 4,
  contradictionCount: 64,
  mappingCount: 512,
  reconstructionDiffCount: 16,
  switchHypothesisCount: 8,
} as const;

export const gateATimingModel = {
  acceptedPushesPerAgentPerSlot: 1,
  presenceBitsPerSlot: 1,
  residualBits: 0,
  runSeconds: 3_600,
  slotSeconds: 30,
} as const;

export const gateASourceDefinitions = [
  {
    author: "George Eliot",
    catalogUrl: "https://www.gutenberg.org/ebooks/145",
    downloadUrl: "https://www.gutenberg.org/cache/epub/145/pg145.txt",
    ebookNumber: 145,
    sourceId: "middlemarch",
    title: "Middlemarch",
  },
  {
    author: "Herman Melville",
    catalogUrl: "https://www.gutenberg.org/ebooks/2701",
    downloadUrl: "https://www.gutenberg.org/cache/epub/2701/pg2701.txt",
    ebookNumber: 2701,
    sourceId: "moby-dick",
    title: "Moby-Dick; or, The Whale",
  },
  {
    author: "Alexandre Dumas",
    catalogUrl: "https://www.gutenberg.org/ebooks/1184",
    downloadUrl: "https://www.gutenberg.org/cache/epub/1184/pg1184.txt",
    ebookNumber: 1184,
    sourceId: "count-of-monte-cristo",
    title: "The Count of Monte Cristo",
  },
  {
    author: "Charlotte Bronte",
    catalogUrl: "https://www.gutenberg.org/ebooks/1260",
    downloadUrl: "https://www.gutenberg.org/cache/epub/1260/pg1260.txt",
    ebookNumber: 1260,
    sourceId: "jane-eyre",
    title: "Jane Eyre: An Autobiography",
  },
] as const;
