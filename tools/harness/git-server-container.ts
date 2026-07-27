import { startGitServer } from "./git-server.js";

const repository = process.env.PALIMPSEST_GIT_REPOSITORY;
if (!repository) {
  throw new Error("PALIMPSEST_GIT_REPOSITORY is required.");
}
const server = await startGitServer({
  repository,
  stagingRefMode: true,
  host: "0.0.0.0",
  port: 8080,
  secrets: {
    "agent-1": "fixture-agent-1",
    "agent-2": "fixture-agent-2",
    "agent-3": "fixture-agent-3",
  },
});
process.stdout.write("ready\n");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
await new Promise(() => {});
