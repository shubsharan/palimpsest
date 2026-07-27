# Quickstart: Decipherment Headroom

Gate B is decided for product sequencing.

```bash
pnpm verify
git diff --check
```

Review:

- `artifacts/gate-b/qualified-feasibility-decision.json`
- `specs/003-decipherment-headroom/spec.md`
- `docs/roadmap.md`

The decision is intentionally not emitted as `gate-report.json`: the original judged Amber outputs are unavailable for immutable replay. The result authorizes the minimum Gate C experiment and leaves broader replication and the full harness deferred.
