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

// The categories that carry signal in most runs get their own filter chip; the
// rarely-firing bookkeeping categories fold behind one "system" toggle so the
// timeline stays legible.
export const PRIMARY_CATEGORIES: readonly ViewerEventCategory[] = [
  "model",
  "tool",
  "team",
  "stage",
  "git",
];

export const SYSTEM_CATEGORIES: readonly ViewerEventCategory[] = [
  "session",
  "run",
  "evaluation",
  "infrastructure",
];

export const SPEEDS = [1, 10, 60, 300] as const;

// A stable, distinct accent per agent for any team size. Agent ids are
// `agent-N`; we rotate the hue by the golden angle so colors stay far apart no
// matter how many agents a run declares, and keep saturation/lightness in the
// muted ink range so they sit inside the manuscript palette.
export function agentAccent(agentId: string): string {
  const parsed = Number.parseInt(agentId.replace(/^agent-/, ""), 10);
  const index = Number.isFinite(parsed) ? Math.max(0, parsed - 1) : 0;
  const hue = (18 + index * 137.508) % 360;
  return `hsl(${hue.toFixed(1)} 46% 41%)`;
}

export type MobilePanel = "agents" | "team" | "decode";

export const MOBILE_PANELS: readonly { id: MobilePanel; label: string }[] = [
  { id: "agents", label: "Solvers" },
  { id: "team", label: "Team room" },
  { id: "decode", label: "Manuscript" },
];
