# Research Preflight Contract

## Advisory Development Check

```bash
pnpm check
```

The workflow installs locked dependencies, runs exact language/package declaration checks, formatting, linting, the TypeScript build, and a sandbox image build. It does not run unit suites, real-container behavior tests, or the offline fixture. Success is development feedback only.

## Full Research Preflight

```bash
pnpm preflight
```

Preconditions:

- `HEAD` names a commit;
- tracked and nonignored untracked source is clean;
- Docker is available;
- locked JavaScript and Python dependencies are installed.

On success, stdout contains one JSON receipt and `artifacts/preflight.json` contains the formatted receipt defined in [data-model.md](../data-model.md). The command exits nonzero and emits no success object when any source, sandbox, full-suite, fixture, or publication step fails.

The prior canonical receipt is removed before verification begins. Only complete success creates a new one.

## Live Run

The configured provider-backed run command and flags remain unchanged:

```bash
pnpm puzzle:run -- \
  --config experiments/config.yaml \
  --run <run-name> \
  --build <build-root> \
  --output <attempt-root>
```

Before any provider call, the command requires:

- a valid canonical receipt;
- a still-clean checkout at `testedCommit`;
- the inspected current sandbox identity to equal `receipt.sandbox`.

The command copies the receipt to `<attempt-root>/preflight.json` before model sessions begin. Fixture runs do not require or copy a receipt.

## Publication Review

Findings from a live attempt are eligible for review only when `<attempt-root>/preflight.json` is present, decodes successfully, and names the same sandbox identity recorded in `<attempt-root>/attempt.json`. The receipt supports source/environment traceability only; it does not establish benchmark validity or reproduce stochastic model behavior.
