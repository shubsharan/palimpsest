# Research: Simple Research Verification

## Advisory CI Boundary

**Decision**: Keep one Linux workflow for pull requests and pushes to `main`. Run locked installs, `pnpm check`, and one sandbox image build; omit merge-queue handling, unit suites, real-container behavior tests, the end-to-end fixture, and exact host Git compilation.

**Rationale**: Linux execution plus mechanical checks catches broken dependencies, source errors, and an invalid sandbox definition. A red advisory check remains useful without pretending to authorize research.

**Alternatives considered**:

- `continue-on-error`: rejected because it hides useful failures instead of changing branch policy.
- A platform or runtime matrix: rejected because this small local research project has no current cross-version claim.
- Push checks on every branch plus pull-request checks: rejected because it duplicates runs for ordinary pull requests.

## Mechanical and Full Verification Split

**Decision**: Make `pnpm check` run only exact bootstrap declarations, formatting, linting, and the TypeScript build. Retain the existing full `test:ts`, `test:py`, and `verify` scripts for preflight.

**Rationale**: CI is only a mechanical smoke signal for this research repository. Behavioral confidence belongs to the explicit preflight immediately before consequential work.

**Alternatives considered**:

- A reduced unit-test selection: rejected because it creates another boundary to maintain without authorizing research.
- Running all unit tests: rejected because CI is intentionally limited to mechanical failures.
- A second Vitest project/configuration: rejected because CI runs no behavioral test selection.

## Preflight Receipt

**Decision**: Use one versioned receipt at `artifacts/preflight.json` containing the tested commit, `sourceClean: true`, completion time, and existing sandbox identity. Remove the prior receipt before checks and atomically publish a new receipt only after success.

**Rationale**: A clean commit binds tracked source and lockfiles. The sandbox image ID and Dockerfile source digest bind the actual agent environment. Removing the old receipt prevents a failed rerun from leaving stale authorization.

**Alternatives considered**:

- Repository tree or dependency hashing: rejected because the clean commit and locked inputs already provide the needed source identity.
- Signed or remotely attested receipts: rejected because there is no untrusted release pipeline or enterprise compliance requirement.
- Receipt history: rejected because experiments copy the receipt they use into their own immutable artifact root.

## Preflight Execution

**Decision**: Route `pnpm preflight` through `src/cli.ts`. It checks the source before and after, rebuilds the sandbox, runs `pnpm verify`, runs a fresh offline fixture, confirms its score and sandbox identity, then writes the receipt.

**Rationale**: A package-script shell chain cannot safely coordinate stale-receipt invalidation, start/end Git state, fixture identity, and atomic success publication. One small TypeScript owner can reuse the existing process, sandbox, and fixture functions.

**Alternatives considered**:

- Running only the full test suite: rejected because the constitution requires a fresh operator-level build-run-evaluate fixture.
- Running preflight inside every development check: rejected because it recreates the merge-time ceremony this feature removes.
- Adding a freshness time-to-live: rejected because source and sandbox identity are the meaningful validity conditions; an arbitrary wall-clock limit adds policy without evidence.

## Live-Run Gate

**Decision**: Require and validate the receipt only for the OpenAI adapter. Validate source state first, then inspect the sandbox and require identity equality before constructing the adapter. Copy the receipt into the newly created attempt root before sessions start.

**Rationale**: The first provider request occurs only when a session responds. Gating in `runPuzzle` therefore prevents spend without changing provider code or checking every turn. Fixture verification remains usable without self-authorizing preflight.

**Alternatives considered**:

- Guarding `fetch`: rejected because it couples research policy to one provider transport.
- Requiring receipts for fixture runs: rejected because preflight itself depends on the fixture.
- Adding a new run flag: rejected because one canonical receipt and current checkout remove an unnecessary operator choice.

## Host and Sandbox Versions

**Decision**: Stop exact equality checks for host Git and Docker. Retain exact Node, pnpm, Python, and uv bootstrap declarations. Treat the digest-pinned base, checked-in Dockerfile digest, and inspected immutable image ID as the sandbox pin.

**Rationale**: Existing Git tests exercise the behavior the runner needs, while preflight directly exercises Docker containment and cleanup. The host Git patch is not an agent-visible experimental condition.

**Alternatives considered**:

- A minimum Git semantic-version parser: rejected because behavior tests are stronger and shorter.
- Debian snapshot infrastructure for every sandbox package: rejected as disproportionate; the exact built image is already recorded for each attempt.
- Keeping Git and Docker in `.tool-versions` without enforcement: rejected because it continues to imply false experimental significance.

## Branch Protection

**Decision**: Remove only the required `verify` status-check policy from `main`; preserve the rest of branch protection.

**Rationale**: Workflow YAML cannot make a check advisory. Deleting only required status checks realizes the chosen policy without weakening unrelated force-push or deletion controls.

**Alternatives considered**:

- Renaming the job without updating protection: rejected because it can leave pull requests waiting forever for a nonexistent context.
- Removing all branch protection: rejected because the user requested only removal of the verification gate.
