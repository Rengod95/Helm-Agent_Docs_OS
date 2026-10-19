# CLI-G01 Run 001 — Codex Kernel Baseline

> Date: 2026-08-22
>
> Result: executable semantic baseline passed; live conversational CLI UX and cross-runtime portability remain unverified
>
> Scenario: [`../helm-cli-guided-001.md`](../helm-cli-guided-001.md)
>
> Executable contract: [`../../../../experiments/helm-kernel-v02/README.md`](../../../../experiments/helm-kernel-v02/README.md)

## 1. Scope of this run

This is the first structured Codex baseline for `CLI-G01`. Codex inspected the actual repository defect, extracted the minimum Guided transition contract, implemented it in an isolated in-memory Kernel candidate, and ran the scenario and failure injections.

It is not yet a test of:

- a real Helm conversational CLI or TUI;
- model/provider invocation and tool-loop behavior;
- SQLite transaction and crash recovery;
- the complete `.helm/events.jsonl` importer;
- Codex MCP, Pi extension/RPC, or OpenCode plugin transport;
- delayed human resumption.

Accordingly, this run can validate semantic enforcement and replay. It cannot yet validate attention cost, natural-language quality, terminal ergonomics, or cross-runtime continuity.

## 2. Observed defect

The current source Event at `.helm/events.jsonl:99` says:

```text
type          normative.decision.committed
summary       ㅇ
rationale     ㅁㄴㅇ
reopenTrigger ㅁㄴㅇ
```

The current `experimental.v0` implementation:

1. validates only that required fields are non-empty strings;
2. records the input immediately as `committed`;
3. selects the last Decision per subject;
4. reports a Decision blind spot only when no Decision Event exists.

This confirms that structural validity is being mistaken for qualification and acceptance.

## 3. Possibilities preserved until the architecture Gate

| Possibility | Evidence outcome |
|---|---|
| language-quality heuristic | rejected as the baseline rule because language and context make it non-deterministic; retained only as a diagnostic candidate |
| required structured fields | disproved by the real garbage-but-nonempty Event and synthetic structural fixtures |
| qualification + accountable acceptance | selected because it models the missing semantic transitions directly |
| human-selected active pin | retained as the strongest alternative, but imposes recurring selection and stale-pin burden |

The scripted participant Choice was:

```text
Use qualification + acceptance. Preserve the old Event as unqualified history.
In Guided work, the agent drafts qualification and asks only for consequential human Choices.
```

## 4. Contract extracted

The minimum vertical slice added these transitions:

```text
legacy.choice.capture
choice.open
choice.qualify
choice.commit
agreement.offer
agreement.accept
agreement.renegotiate
completion.submit
result.accept
integration.start
integration.complete
```

`choice.qualify` is an explicit refinement discovered by the run. `choice.open → choice.commit` alone cannot represent the difference between a structurally captured candidate and a candidate whose source, scope, evidence relation, accountable acceptor, and review trigger are adequate.

The resulting semantic event categories follow the aligned world model:

- Choice open, qualification, commit and Work Agreement transitions belong to the Normative world;
- Completion submission is an Epistemic Claim about achieved criteria;
- test output and artifacts are Evidence references, not automatic Acceptance;
- Actor and Policy remain cross-cutting governance data on each Command/Event.

## 5. Legacy disposition

The source Event is neither deleted nor rewritten. The import planner records:

```text
source path        .helm/events.jsonl
source line        99
source event ID    evt_b99d405d692b48b9b3ee0978d3844d0a
source hash        sha256:be427c697341c5feffed0884e0d818eb35fafb6bfaef9b4884535ce9a0b5d278
ambiguity          legacy `committed` cannot prove v0.2 qualification or acceptance
disposition        captured / structural / unqualified / proposed
```

Immediately after import, the candidate Brief returns:

```text
latest accepted Choice  none
blind spots             active_choice, choice_qualification
attention               choice.unqualified
```

The text `ㅇ` remains inspectable in history but cannot become the active baseline.

## 6. Failure-injection results

| ID | Injection | Result | Canonical effect |
|---|---|---|---|
| F1 | garbage-but-nonempty legacy Choice | captured with attention signal | no active baseline |
| F2 | submit `projection.next_action.proposed` as Command | `denied.projection_is_derived` | no Event |
| F3 | adapter submits a complete Event envelope | `denied.adapter_cannot_append_event` | no Event |
| F4 | two Commands use the same expected cursor | second gets `conflict.expected_cursor_mismatch` with rebase Brief | first transition only |
| F5 | user changes acceptance criteria after Agreement | prior revision becomes `stale`; old criteria cannot support completion | new revision controls work |
| F6 | agent submits passing Completion Claim | remains `submitted`; agent acceptance attempt returns a human Gate | no automatic Acceptance or Integration |

Additional checks passed:

- caller-scoped idempotent retry creates no duplicate Event;
- Guided Choice commit requires human authority after qualification;
- replaying immutable Events reproduces the same Workspace and Brief projections;
- no generated Event type begins with `projection.`.

Test result: **9 passed, 0 failed**.

## 7. Scripted semantic run

The deterministic simulation produced ten Events:

```text
1  migration.legacy_choice.captured
2  normative.choice.opened
3  normative.choice.qualified
4  normative.choice.committed
5  normative.agreement.offered
6  normative.agreement.accepted
7  epistemic.completion.submitted
8  normative.result.accepted
9  normative.integration.started
10 normative.integration.completed
```

Two legitimate Gates appeared:

1. before the consequential architecture Choice was committed;
2. after execution, when a Completion Claim was offered for Result Acceptance.

Only the first occurred before autonomous work. There were no repeated “may I continue?” questions.

The scripted final state is:

```text
active Choice       qualification + accountable acceptance
legacy Choice       unqualified history
Completion Claim    accepted by the simulated human reviewer
Integration         complete
remaining importer  explicitly transferred obligation
```

This Acceptance exists only inside the simulation fixture. The real project candidate still requires product-owner review before architectural promotion.

## 8. Measurement sheet

### Interaction

- scripted participant messages: 3 — initial task, architecture Choice, conditional Result Acceptance
- consequential Gates before execution: 1
- Result Review Gates after execution: 1
- approval-theater questions: 0
- correction represented in this run: acceptance criterion change in F5
- correction changing downstream action: yes; stale Completion Claim rejected

### Attention

- terminal transcript lines shown by default: not measured; no live CLI exists
- tool actions compressed: not measured
- source drill-downs: source Event path, line, ID, and hash are available
- duplicated information: not measured

### Recovery

- Goal recovery: not tested
- latest accepted Choice recovery: deterministic Brief projection succeeds
- important uncertainty recovery: unqualified legacy Choice appears as attention
- next valid action recovery: not yet modeled in this vertical slice
- raw transcript fallback: not tested

### Outcome

- semantic defect represented and prevented: yes
- current product core modified: no
- existing history rewritten: no
- unresolved obligation visible: yes, full legacy importer
- user workload, agency, and reuse intent: awaiting live CLI dogfood

## 9. Completion Claim and limitations

Satisfied in the candidate experiment:

- unqualified Decision is excluded from active baseline;
- the Brief exposes the qualification gap;
- legacy identity and provenance remain replayable;
- all six failure classes return the expected policy outcome;
- Completion, Acceptance, and Integration are distinct.

Not satisfied yet:

- production JSONL migration and its loss report;
- durable single-writer storage and crash consistency;
- Observation Candidate contract;
- Goal, Concern, Possibility, Claim, Evidence, and resumption beyond this slice;
- first-party model/tool/session loop;
- live CLI interaction measurements;
- portability through two independent runtime adapters.

## 10. Review status and next run

The semantic candidate is ready for product-owner review, but the Foundation and architecture are not promoted by this run alone.

Next engineering run:

1. convert the candidate envelopes and policy outcomes into JSON Schema fixtures;
2. define a runtime-neutral adapter conformance harness around the same Commands and projections;
3. implement a thin first-party Helm Agent Runtime/CLI loop against this boundary;
4. repeat `CLI-G01` as an actual conversational session and measure attention/correction cost;
5. add Pi and Codex/OpenCode transport adapters only after first-party UX passes.
