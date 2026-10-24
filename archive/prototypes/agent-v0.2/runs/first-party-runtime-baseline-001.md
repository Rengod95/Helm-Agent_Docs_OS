# First-party Agent Runtime Baseline 001

> Date: 2026-08-22
>
> Result: bounded provider/tool/Gate loop passed with a scripted provider; real model provider pending
>
> CLI surface: [`helm-cli-linear-001.md`](helm-cli-linear-001.md)

## 1. Runtime boundary under test

The first-party Helm Agent Runtime now has a candidate execution boundary between:

```text
Model Provider
  → bounded provider turn
  → registered agent-only tools
  → typed Helm client
  → runtime-neutral adapter
  → Kernel policy and Event creation

Human CLI input
  → validated runtime Gate
  → Human typed client
  → Kernel policy and Event creation
```

The provider does not receive the Human client and cannot construct raw Commands or Events through the typed surface.

## 2. Provider turn contract

A provider turn may do one of three things:

1. emit non-authoritative assistant blocks;
2. request registered tool calls;
3. yield or request one runtime-validated Gate.

A turn cannot combine tool calls with a Gate or finish marker. The runtime applies step and total-tool-call limits and rejects reused tool-call IDs.

Provider-visible block kinds are restricted to:

```text
message      → Helm
possibility  → Possible
explanation  → Why
progress     → Working
```

The provider cannot assign `Observed`, `Choice`, `Work Agreement`, `Completion Claim`, `Result Review`, or `Integration` labels. Those surfaces require Kernel projection or runtime policy evidence. This prevents fluent model text from impersonating canonical state.

## 3. Agent tool surface

Available to the provider:

```text
helm_get_brief
helm_get_workspace
helm_submit_observation
helm_open_choice
helm_qualify_choice
helm_offer_work_agreement
helm_activate_work_agreement
helm_submit_completion
helm_start_integration
helm_complete_integration
```

Intentionally unavailable:

```text
helm_commit_choice
helm_accept_work_agreement
helm_accept_result
raw Event append
generic Command submit
projection write
```

An attempted `helm_commit_choice` call returns `runtime.unknown_tool` and creates no Event.

## 4. Gate mediation

The provider may request a Gate candidate, but the runtime opens it only if current projection state makes it eligible:

- Choice Gate: candidate is qualified and still proposed;
- Agreement Gate: Work Agreement is offered;
- Result Gate: Completion Claim is submitted.

The runtime binds the Gate to the current cursor. Human acceptance uses that cursor through the Human typed client. If any Event advances state after rendering, acceptance returns `runtime.stale_gate`; the old Gate cannot silently commit against newer context.

The successful Choice fixture proves:

1. provider opens and qualifies the candidate;
2. runtime pauses at `awaiting_user`;
3. no active Choice exists yet;
4. Human client accepts the exact cursor-bound Gate;
5. the resulting committed Event records `human:founder` as Actor.

## 5. Runtime safety fixtures

| Fixture | Expected result | Actual |
|---|---|---|
| provider requests unavailable Human tool | rejected tool result, no normative effect | pass |
| Event advances after Gate rendering | stale Gate conflict | pass |
| provider emits terminal escape/control bytes | sanitized before UI event | pass |
| provider assigns `Observed` label | provider turn fails, no Observation | pass |
| provider loops on read tools | step limit stops run | pass |
| cancellation during provider wait | run becomes cancelled | pass |
| user steering during provider wait | provider interrupted, steering enters next context | pass |

Candidate suite after this run: **28 passed, 0 failed**.

## 6. Steering and cancellation semantics

Steering submitted while the provider is running interrupts the pending provider call, appends a distinct `user / steering` context item, and restarts the bounded loop. It is not collapsed into an assistant message.

Cancellation interrupts a pending provider call and produces a runtime cancellation event. This run does not yet prove cancellation during every tool effect class; tool-level cancellation and recovery must distinguish read-only, local atomic, external reversible, and irreversible operations.

## 7. Remaining gaps

- no real model provider or streaming decoder;
- no durable session/event outbox for runtime events;
- no context compiler token/omission policy;
- no model-tested natural-language Authority Grant extraction, revocation, or budget consumption;
- no capability-specific tool cancellation and uncertain-outcome recovery;
- no provider retry/backoff, usage budget, or secret boundary;
- no interactive terminal Gate input;
- no full Goal/Concern/Possibility/Claim tool set;
- no real Codex, Pi, or OpenCode adapter run.

## 8. Architecture consequence

The provider is not the Helm Agent Runtime. It is one replaceable inference component inside a runtime that owns:

- bounded execution;
- tool registration and effect metadata;
- context compilation;
- steering/cancellation;
- Gate validation and human input routing;
- safe rendering;
- operational trace and recovery.

The Kernel remains the authority and semantic transition boundary. First-party ownership means Helm can implement richer UX and interruption behavior, not that it can bypass Kernel invariants.

## 9. Next run

1. add tool effect/cancellation capability and uncertain-outcome states;
2. implement provider-neutral context compilation and omission reporting;
3. bind one real model provider to the runtime interface;
4. test natural-language Authority Grant extraction against expansion attacks;
5. repeat `CLI-G01` with live model output while preserving projection-owned semantic surfaces.
