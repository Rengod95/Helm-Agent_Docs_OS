# Adapter Contract Baseline 001 — Direct and JSONL Parity

> Date: 2026-08-22
>
> Result: runtime-neutral transport parity passed; real Codex/Pi/OpenCode adapters remain pending
>
> Executable contract: [`../../../../experiments/helm-kernel-v02/README.md`](../../../../experiments/helm-kernel-v02/README.md)

## 1. Question

Can one candidate Kernel contract be carried through two different transport shapes without changing semantic identity, Event order, policy results, or projections?

This run deliberately avoids vendor-specific SDK names. It tests the seam that future first-party, MCP, Pi RPC, and OpenCode adapters must share.

## 2. Transport shapes

### Direct object adapter

- in-process request/response objects;
- represents the minimum seam for the first-party Helm Agent Runtime or an embedded SDK client;
- cannot access the Kernel Event append path;
- queries Brief and Workspace through protocol methods.

### JSONL RPC adapter

- every request and response is serialized to one JSON line and parsed again;
- represents a headless process boundary relevant to, but not identical with, Pi RPC or another stdio host;
- reports lifecycle observation as advisory in this test shape;
- uses the same Command and Projection schemas as the direct adapter.

## 3. Candidate protocol surface

```text
helm.handshake
helm.command.submit
helm.query.brief
helm.query.workspace
```

Handshake returns supported contract versions and the invariants the host enforces:

```text
adapter-cannot-append-events
projection-is-derived
expected-cursor-required
guided-human-gates
```

Adapter capability is reported independently from semantic correctness:

```text
A tool/query
B lifecycle observation
C directed runtime
D native co-agency

support = enforced | advisory | unavailable
```

An adapter can therefore preserve Kernel semantics while honestly reporting that it cannot observe or pause work outside Helm tool calls.

## 4. Parity fixture

Both transports executed the same sequence:

```text
choice.open
choice.qualify
choice.commit by accountable human
```

Both now produce the same semantic sequence after an Observation Candidate:

```text
sequence 1  epistemic.observation.captured
sequence 2  normative.choice.opened
sequence 3  normative.choice.qualified
sequence 4  normative.choice.committed
```

After normalization, the two Workspace projections were deeply equal for:

- source cursor;
- active Choice and quality state;
- captured Choice history;
- attention signals;
- blind spots.

Event order, types, effective times, actors, authority, subject references, and domain payloads were equal. Observation provenance intentionally retained different adapter IDs. Transport framing therefore does not change semantic state, while source identity is not erased to manufacture byte equality.

## 5. Boundary checks

For both adapters:

- a forged `helm.event.v0.2-candidate` envelope was rejected with `denied.adapter_cannot_append_event`;
- cursor stayed at 4 after the rejected forgery;
- the adapter reached state only through Queries;
- policy remained inside the Kernel host;
- the same Guided human Gate behavior applied.

## 6. Executable schema

Draft 2020-12 JSON Schema candidates now describe:

- Command envelope and current command vocabulary;
- Observation Candidate with observer, observed time, subject, external ID, and content hash;
- output-only Ledger Event envelope and current event vocabulary;
- Command Result states;
- runtime-neutral protocol request;
- adapter capability declaration.

Tests ensure the JSON documents parse and that Command/Event enums remain identical to the executable contract constants.

The Observation fixture also confirms that capture creates an Epistemic Event but no Claim, Choice, or active baseline. `effectiveAt` preserves the external observed time, while Kernel `recordedAt` preserves receipt order. Duplicate external observations are idempotent; the same external ID with different content conflicts.

Overall candidate suite after this refinement: **15 passed, 0 failed**.

## 7. What this proves—and what it does not

Proved:

- transport framing is outside canonical semantics;
- semantic parity does not erase runtime-specific provenance;
- a first-party embedded client and a serialized RPC client can share one protocol;
- adapter capability can degrade without relaxing Kernel invariants;
- runtime adapters do not need an Event append API;
- projection parity is testable as a fixture rather than asserted in prose.

Not proved:

- actual Pi RPC request/event compatibility;
- Codex MCP tool discovery and human Gate UX;
- OpenCode plugin lifecycle interception;
- reconnect, streaming subscription, cancellation, and outbox behavior;
- durable cross-process concurrency;
- Level B–D lifecycle and steering capability.

This run is therefore a **protocol precondition**, not a cross-runtime acceptance result.

## 8. Next adapter work

1. add a typed client so the first-party Agent Runtime never constructs raw Event or protocol envelopes;
2. define lifecycle input without permitting automatic normative promotion;
3. add subscription/reconnect and cursor resume fixtures around durable storage;
4. bind the protocol to a real Codex MCP tool surface;
5. bind the JSONL shape to Pi only after Pi is installed and its current RPC contract is verified;
6. run the same semantic fixture through at least two real runtime adapters before Foundation promotion.
