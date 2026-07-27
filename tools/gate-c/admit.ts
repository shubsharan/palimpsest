import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { writeCanonicalJson } from "../gate-a/artifacts.js";
import { checkGateCPredeclaration } from "./report.js";
import { FRONTIER_MODEL } from "./config.js";
import { errorFromStreamEvent, OpenAIHttpClient, OpenAIRequestError } from "./solver-runner.js";

function completedResponse(event: Record<string, unknown>): Record<string, unknown> | null {
  if (
    event.type !== "response.completed" ||
    event.response === null ||
    typeof event.response !== "object" ||
    Array.isArray(event.response)
  ) {
    return null;
  }
  return event.response as Record<string, unknown>;
}

export async function admitGateC(): Promise<void> {
  const declaration = await checkGateCPredeclaration();
  const declarationDigest = String(declaration.predeclarationDigest);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not available.");
  }
  const client = new OpenAIHttpClient(apiKey);
  const eventTypes: string[] = [];
  let terminalType: string | null = null;
  try {
    const container = await client.createContainer(`palimpsest-gate-c-admit-${Date.now()}`);
    let completed: Record<string, unknown> | null = null;
    for await (const event of client.streamResponse({
      containerId: container.id,
      input:
        "Use the python tool once to compute 17 * 19. Then answer with only the integer result.",
      model: FRONTIER_MODEL,
      previousResponseId: null,
    })) {
      if (typeof event.type === "string") {
        eventTypes.push(event.type);
        if (
          event.type === "response.completed" ||
          event.type === "response.incomplete" ||
          event.type === "response.failed"
        ) {
          terminalType = event.type;
        }
      }
      if (event.type === "error") {
        throw errorFromStreamEvent(event);
      }
      completed = completedResponse(event) ?? completed;
    }
    if (completed === null || typeof completed.id !== "string") {
      throw new Error("Admission response did not complete.");
    }
    await writeCanonicalJson(resolve("artifacts/gate-c/admission.json"), {
      schemaVersion: 1,
      admitted: true,
      declarationDigest,
      model: FRONTIER_MODEL,
      responseId: completed.id,
      checkedAt: new Date().toISOString(),
      eventTypes,
      terminalType,
    });
  } catch (error) {
    await writeCanonicalJson(resolve("artifacts/gate-c/admission.json"), {
      schemaVersion: 1,
      admitted: false,
      declarationDigest,
      model: FRONTIER_MODEL,
      checkedAt: new Date().toISOString(),
      failure: {
        type: error instanceof OpenAIRequestError ? "openai-request" : "local",
        status: error instanceof OpenAIRequestError ? error.status : null,
        code: error instanceof OpenAIRequestError ? error.code : null,
        message: error instanceof Error ? error.message : "Unknown admission failure.",
      },
      eventTypes,
      terminalType,
    });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await admitGateC();
}
