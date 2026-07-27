# Host Model Bridge Contract

## Purpose

The host model bridge separates trusted orchestration from an untrusted agent worker. The offline fixture adapter and later provider-backed adapters use the same request, event, file, quota, timeout, and terminal boundary.

## Invocation Request

One canonical request contains:

- schema, run, agent, invocation, adapter, and policy versions;
- current lifecycle state and monotonic deadline;
- released private input manifest;
- captured published-snapshot identity;
- authenticated Git endpoint and permitted ref namespace;
- workspace and private-output mounts;
- remaining model, CPU, memory, disk, wall-time, invocation, file-read, and subagent budgets;
- prior public checkpoint references;
- exact expected event and terminal output contract.

The request never contains another shard, future release, oracle, source identity, credential bytes, private peer output, container-control endpoint, or host filesystem path outside declared mounts.

## Event Stream

The worker writes UTF-8 NDJSON. Each line is one canonical record with monotonically increasing ordinal and one of:

- `response.output`;
- `tool.started`, `tool.output`, or `tool.completed`;
- `file.read`, `file.written`, or `file.declared`;
- `git.clone`, `git.fetch`, `git.pull`, `git.commit`, `git.push`, or `git.result`;
- `checkpoint`;
- `resource.usage`;
- `worker.error`;
- `worker.completed`.

Observable output and code artifacts may be persisted. The contract has no private chain-of-thought field.

## Fixture Adapter

The fixture adapter:

- runs locally and deterministically from the request plus released bytes;
- performs no network operation except the authenticated local Git endpoint;
- uses ordinary Git commands;
- may create races, conflicts, stale pushes, imperfect mappings, and incomplete outputs as declared fixtures;
- writes private deliverables only to its own output mount;
- never loads an external model SDK, provider credential, or recorded provider response.

The adapter's purpose is boundary coverage, not simulated intelligence.

## Terminal Record

The terminal record binds:

- request digest and final event ordinal;
- exit classification and process status;
- exact declared files with byte lengths and hashes;
- measured resource use;
- final Git observation;
- private deliverable reference if present.

Missing terminal output, malformed NDJSON, ordinal gaps, undeclared files, timeout, signal, or resource-policy breach fails the invocation without trusted repair.

## Adapter Authorization

During Milestones 4–6, the coordinator accepts only the frozen fixture adapter ID. A provider-backed adapter additionally requires a passing `offline-harness-report` digest whose `liveModelValidationAuthorized` value is true. This check occurs before credentials, containers, or network policy are prepared.
