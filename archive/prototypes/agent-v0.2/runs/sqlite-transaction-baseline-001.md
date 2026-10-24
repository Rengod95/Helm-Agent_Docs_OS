# SQLite Transaction Baseline 001

> Date: 2026-08-22
>
> Result: durable Kernel application/storage boundary passed; production host and durable Agent Runtime remain pending
>
> Architecture: [`../../../architecture/helm-kernel-v0.2-candidate.md`](../../../architecture/helm-kernel-v0.2-candidate.md)

## 1. What this run tested

The pure candidate Kernel was rehydrated behind a disposable SQLite service without moving domain transitions or Projection rules into the database. The service adds operational guarantees that an in-memory fixture cannot prove:

- WAL-backed local storage and foreign-key enforcement;
- a durable, caller-scoped Command inbox;
- a durable, adapter-scoped Observation inbox;
- append-only Events and a transactional notification outbox;
- one `BEGIN IMMEDIATE` boundary around Kernel evaluation, Event append, outbox append, and inbox result;
- replay after close/reopen;
- a per-workspace SHA-256 checksum chain for accidental-corruption diagnostics.

The same runtime-neutral protocol host and direct adapter run over this service. No storage-specific operation enters the adapter contract.

## 2. Failure and recovery evidence

Nine focused storage fixtures passed:

1. Events and derived Projections survive close/reopen.
2. Retrying the same Command returns its durable result without another Event.
3. Two connections starting from the same cursor produce one accepted write and one explicit rebase conflict.
4. A fault after Event/outbox insertion but before Command-inbox insertion rolls back all three.
5. A modified stored Event body fails checksum-chain replay instead of becoming a silent new history.
6. Observation capture remains idempotent and cannot promote normative state.
7. Cross-workspace requests are rejected before either durable inbox is touched.
8. Outbox consumption resumes by Event sequence and delivery marking is idempotent.
9. The transport-neutral protocol behaves the same after replacing the in-memory service with SQLite.

Candidate suite after this run: **57 passed, 0 failed**.

## 3. Foundation consequence

This run supports four Foundation claims:

- an immutable record is not the same thing as true content, so storage integrity and semantic qualification remain separate checks;
- the Kernel is the only Event author even when state becomes durable;
- local-first operation still needs concurrency, idempotency, and recovery semantics;
- portability belongs at the semantic protocol boundary, not in database-specific adapters.

The checksum chain detects accidental mutation when the stored checksum remains intact. It is not a signature, MAC, or defense against a process that can rewrite both the Event and the checksum. Such a process is already inside the local database trust boundary.

## 4. Remaining limits

- The harness uses synchronous embedded SQLite; it is not the planned single-writer `helmd` process.
- Crash behavior is fault-injected inside a transaction, not yet tested with OS process termination and filesystem faults.
- Agent Runtime history, steering, open Gates, tool intent/outcome, and uncertain external recovery are still in-memory.
- Projection checkpoints, projector lag/degraded mode, subscription workers, and reconnect delivery are not implemented.
- Backup/restore, evidence manifests, key rotation, and long-lived schema migration are untested.
- Corrupt storage raises a fail-closed diagnostic; a user-facing read-only recovery mode is not implemented.
- No live model or real Codex/Pi/OpenCode runtime participated in this run.

## 5. Engineering decision

Keep the deterministic Kernel pure. Put transaction orchestration, idempotent inboxes, outbox delivery, migration, and recovery diagnostics in the application/storage boundary. The first-party CLI and every external runtime adapter must reach state through the same typed protocol; none receives a privileged SQLite or raw-Event path.
