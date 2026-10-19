# Runtime Effects and Context Baseline 001

> Date: 2026-08-22
>
> Result: effect-aware interruption, uncertain-outcome recovery, and bounded Context Projection passed
>
> Runtime source: [`first-party-runtime-baseline-001.md`](first-party-runtime-baseline-001.md)

## 1. Why this refinement is required

Two common agent-runtime shortcuts contradict the Helm Foundation:

1. displaying “cancelled” even when an external or atomic action may still complete;
2. sending the entire mutable transcript and workspace state to every model call.

The first breaks predictability and recovery. The second makes raw activity the context source, hides omission policy, leaks operational data, and produces runtime-specific meaning drift.

## 2. Tool capability contract

Every runtime tool now declares:

```text
effectClass           R0 | R1 | R2 | R3 | R4
cancellation          immediate | cooperative | atomic | none
authorityEnforcement  kernel | runtime | advisory
```

Current Helm semantic tools are classified as:

| Tool class | Effect | Cancellation | Enforcement |
|---|---|---|---|
| Brief/Workspace Query | R0 | immediate | Kernel |
| Observation/Choice/Agreement/Completion Event transaction | R1 | atomic | Kernel |
| hypothetical external integration | R2+ | capability-specific | often advisory unless host interception exists |

The metadata is visible in provider tool definitions and runtime activity events. A UI can therefore distinguish “interrupt now,” “stop after current transaction,” and “cannot know the external outcome yet.”

## 3. Steering and cancellation behavior

### Cooperative operation

User steering aborts the current call, records an interrupted Tool Result, adds a separate user steering item, recompiles Context, and resumes the bounded loop.

### Atomic operation

Cancellation is acknowledged as deferred. The transaction finishes, its result is recorded, and the run stops before the next tool/provider step. Helm does not claim that a half-transaction was cancelled.

### Non-cancellable or uncertain external operation

If a response is lost after transmission, the tool returns `runtime.tool_outcome_uncertain`. Runtime enters `awaiting_recovery` and preserves:

- tool-call ID;
- external operation reference;
- required recovery query;
- no-retry state.

Only recovery evidence such as `confirmed_applied` or `confirmed_not_applied` returns the runtime to idle. This prevents duplicate external effects caused by blind retry.

## 4. Context Projection contract

The model provider no longer receives raw `workspace`, `brief`, or runtime `history`. It receives:

```text
helm.context-projection.v0.2-candidate
workspace and source cursor
profile and context policy version
accepted active Choice
active Work Agreement
attention and blind spots
open Gate
latest user directives and steering
recent Tool Results
budgeted authority, observation, completion, Choice, and provider-note sections
included references
omission report
character/token estimate, redaction count, truncation count
```

Priority is semantic:

1. accepted baseline, active work, attention, open Gate;
2. latest user instruction/steering and Tool Results;
3. current authority and recent sourced observations;
4. completion/integration history and non-active Choices;
5. provider narration.

Routine narration is omitted before user steering or evidence-bearing tool results.

## 5. Budget and privacy behavior

- compilation is deterministic for the same cursor, state, history, and budget;
- secret-like object keys are redacted before provider delivery;
- long strings, arrays, deep objects, and excessive keys are bounded with explicit counters;
- optional categories are added until the declared budget is reached;
- every omitted category reports count and reason;
- if required semantic context cannot fit, compilation fails closed rather than silently dropping it.

The current budget uses characters plus an approximate token count. A real provider adapter may refine token estimation but cannot change semantic priority or omit required categories silently.

## 6. Evidence

Focused fixtures prove:

- cooperative tool steering interruption;
- atomic cancellation deferral;
- uncertain external outcome recovery;
- effect/cancellation/enforcement metadata exposure;
- provider receives no raw workspace/transcript;
- deterministic cursor-bound compilation;
- secret redaction and bounded payloads;
- provider narration omitted before steering/tool results;
- fail-closed behavior when required context exceeds budget.

Candidate suite after this run: **41 passed, 0 failed**.

## 7. Remaining limits

- character-based token approximation is not provider tokenizer parity;
- redaction is key-based and is not a full data-loss-prevention system;
- evidence disclosure labels and per-provider privacy policy are not implemented;
- Context Projection is in-memory and has no durable cache/checkpoint;
- tool recovery evidence is operational runtime state, not yet linked to a canonical Exception/Observation Event;
- process crash during an atomic or external tool still needs durable intent/outcome journaling;
- actual provider streaming and partial tool-call decoding remain untested.

## 8. Software engineering consequence

Provider context and terminal transcript are consumers of semantic state, not alternative state stores. Runtime state, Kernel state, tool effect state, and UI rendering must remain separate state machines joined by IDs and cursors.
