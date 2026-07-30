import { readFile, writeFile } from "node:fs/promises";

import { InfrastructureError } from "./sandbox/contracts.js";

export interface ReleasedStage {
  ordinal: number;
  sourcePath: string;
  visiblePath: string;
}

export class ReleasedStageInfrastructureError extends InfrastructureError {
  override readonly name = "ReleasedStageInfrastructureError";
  override readonly component = "released-stage";
}

export async function writeCanonicalReleasedCiphertext(
  stages: readonly ReleasedStage[],
  destinationPath: string,
): Promise<void> {
  try {
    const chunks: Buffer[] = [];
    for (const [index, stage] of stages.entries()) {
      if (stage.ordinal !== index + 1) {
        throw new Error("Released stages must be ordered and contiguous from ordinal 1.");
      }
      const content = await readFile(stage.sourcePath);
      if (content.length === 0 || content[content.length - 1] !== 0x0a) {
        throw new Error(`Released stage ${String(stage.ordinal)} must end with a newline.`);
      }
      if (index > 0) chunks.push(Buffer.from("\n"));
      chunks.push(content);
    }
    await writeFile(destinationPath, Buffer.concat(chunks), { flag: "wx" });
  } catch (error) {
    throw new ReleasedStageInfrastructureError(
      `Unable to assemble canonical released ciphertext: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}
