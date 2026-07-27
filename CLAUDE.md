<!-- SPECKIT START -->

For additional context about technologies to be used, project structure, shell commands, and other important information, read the current plan: `specs/009-refactor-puzzle-architecture/plan.md`

The active implementation is one root TypeScript application under `src/` and one Python distribution under `python/palimpsest/`. Route operator commands through `src/cli.ts`, keep runtime concerns with their named owners, and preserve attempt publication before optional overlap observation.
<!-- SPECKIT END -->
