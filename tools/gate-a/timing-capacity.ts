import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { gateATimingModel } from "./config.js";
import { writeCanonicalJson } from "./artifacts.js";

export function timingCapacityResult() {
  if (gateATimingModel.runSeconds % gateATimingModel.slotSeconds !== 0) {
    throw new Error("Gate A run duration must contain an integral number of publication slots.");
  }
  const slotCount = gateATimingModel.runSeconds / gateATimingModel.slotSeconds;
  const presenceBits = slotCount * gateATimingModel.presenceBitsPerSlot;
  const totalBits = presenceBits + gateATimingModel.residualBits;
  return {
    capacityBytes: String(Math.ceil(totalBits / 8)),
    contractId: "timing-capacity-result",
    presenceBits: String(presenceBits),
    residualBits: String(gateATimingModel.residualBits),
    runSeconds: gateATimingModel.runSeconds,
    schemaVersion: 1,
    slotCount,
    slotSeconds: gateATimingModel.slotSeconds,
    totalBits: String(totalBits),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeCanonicalJson(
    resolve("artifacts/gate-a/inputs/timing-capacity.json"),
    timingCapacityResult(),
  );
}
