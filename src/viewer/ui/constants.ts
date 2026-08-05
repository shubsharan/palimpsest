import type { ViewerEventCategory } from "../contracts.js";

export const CATEGORIES: readonly ViewerEventCategory[] = [
  "model",
  "tool",
  "team",
  "stage",
  "git",
  "session",
  "run",
  "evaluation",
  "infrastructure",
];

export const SPEEDS = [1, 10, 60, 300] as const;

export type MobilePanel = "agents" | "team" | "decode";

export const MOBILE_PANELS: readonly { id: MobilePanel; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "team", label: "Team room" },
  { id: "decode", label: "Decode" },
];
