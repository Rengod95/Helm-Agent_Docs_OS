# Helm CLI Linear Experience 001

> Date: 2026-08-22
>
> Result: deterministic linear CLI rendering passed; product-owner and model-driven UX validation pending
>
> Scenario: [`../helm-cli-guided-001.md`](../helm-cli-guided-001.md)
>
> Kernel run: [`codex-kernel-baseline-001.md`](codex-kernel-baseline-001.md)

## 1. What ran

A first-party CLI experience harness used the candidate typed client, direct adapter, protocol host, and Kernel. It rendered the complete `CLI-G01` path as a linear terminal transcript:

```text
Orientation
→ Observation and Working Frame
→ Possibilities
→ consequential Choice Gate
→ impact echo
→ Work Agreement
→ compressed Working update
→ Completion Claim
→ Result Review Gate
→ Integration
```

The participant answers are scripted from the scenario. No language model generated this transcript. This isolates information architecture, policy timing, and state transitions before provider behavior is allowed to add variability.

Run command:

```bash
npm run simulate:cli-guided-001
```

## 2. User-visible transcript

```text
Helm
- Guided profile · Focus: active Choice qualification and Brief correctness
- Request: The Brief shows `ㅇ` as the latest Decision and no blind spot. Diagnose and fix it according to the Foundation.

Observed
- The current Brief selects `ㅇ` as the latest Decision and reports no blind spot.
- The legacy projection checks Decision presence, not qualification or accountable acceptance.

Working frame
- Result: unqualified history stays inspectable but cannot become the active Choice baseline.
- Protect: append-only history, provenance, deterministic replay.
- Range: local candidate Kernel, projection, tests, and docs only.
- Pause: before changing canonical state semantics.

Possible
- Language-quality heuristic — small, but brittle across languages and context.
- Required structured fields — deterministic, but the current garbage fixture disproves sufficiency.
- Qualification + accountable acceptance — models the missing boundary directly.
- Human active pin — explicit, but adds recurring selection and stale-pin burden.

Choice · needs your judgment
- Question: Which rule determines the active Choice baseline?
- Recommendation: require qualification + accountable acceptance.
- Strongest alternative: explicit human active pin for every Choice.
- Why now: this boundary changes Event, migration, Brief, and adapter contracts.
- Unknown: legacy `committed` does not prove v0.2 qualification or acceptance.
- Reply path: accept, revise the rule, inspect sources, or defer.

You
- Use qualification + acceptance; preserve existing Events as unqualified history.
- In Guided work, draft qualification and ask only about consequential Choices.

Impact
- Active baseline rule changed.
- Legacy import policy added.
- Guided interaction-burden constraint added.

Work Agreement
- Result: fix active baseline semantics and preserve legacy history.
- Evidence: projection regression, six failure injections, deterministic replay.
- Allowed: local candidate Kernel/tests/docs.
- Not allowed: rewrite legacy JSONL, declare stable schema, publish remotely.
- Stop: guessed acceptance or unavoidable migration loss.
- Authority: original “properly fix it” request plus the accepted Choice; correction remains available.

Working · qualification and active-baseline projection
- Candidate contract suite: 57 passed, 0 failed.
- Routine file reads and test output compressed; no external action.

Completion Claim
- Satisfied: unqualified history is not the active baseline.
- Satisfied: Brief exposes the qualification gap.
- Satisfied: sequence, provenance, cursor conflict, and replay checks pass.
- Known limitation: full product JSONL importer is pending; this is a deterministic CLI experience harness, not a model-driven session.
- State: submitted for Result Review — not yet accepted or integrated.

Result Review · needs your judgment
- Accept the candidate semantics, accept with an importer obligation, request correction, or reject.
- Passing tests are evidence for this review, not the review itself.

You
- Accept the core semantics and regression evidence.
- Keep as an explicit obligation: implement the full JSONL importer before stable migration.

Integration · complete with transferred obligation
- Foundation, architecture, experience contract, and executable fixture remain aligned.
- Transferred obligation remains visible: implement the full JSONL importer before stable migration.
- Candidate semantic run closed; Foundation promotion and live CLI UX remain open.
```

## 3. State and policy evidence

- the Agent client can open and qualify a Choice but has no `commitChoice` method;
- the Human client can commit a Choice but has no candidate-opening method;
- neither typed client exposes raw Event append or generic Command construction;
- Kernel still checks authority, so the client split is ergonomic defense rather than the trust boundary;
- the defect inspection and test result enter as Observation Candidates;
- neither Observation creates an active Choice;
- Completion remains submitted until the distinct human Result Review;
- the full importer stays visible after Integration as a transferred obligation.

Candidate suite at the current refinement point: **57 passed, 0 failed**. Existing experimental Helm suite remains **12 passed, 0 failed**.

## 4. Interaction measurement

- scripted participant messages: 3
- pre-work consequential Gates: 1
- post-work Result Review Gates: 1
- mid-work approval questions: 0
- Work Agreement confirmation prompt: 0
- correction paths shown: revise, inspect, defer, conditional acceptance
- routine tool output: compressed into one Working block
- canonical-state terms visible: Choice, Work Agreement, Completion Claim, Integration
- internal envelope/Event details visible by default: none

## 5. UX strengths

1. The opening leads with the defect and intended result rather than a setup questionnaire.
2. Four real possibilities survive until the architecture Gate.
3. The Gate explains consequence, uncertainty, and the strongest alternative.
4. The selected Choice changes migration, projection, and interaction policy visibly.
5. Work proceeds after the consequential judgment without repeated continuation prompts.
6. Test success is explicitly framed as evidence for a Completion Claim.
7. Conditional Acceptance and obligation transfer prevent a false “everything is done.”

## 6. UX risks requiring owner review

### R1. Work Agreement authority carry-forward

The refined harness accepts the Work Agreement without another user message because the initial “properly fix it” request is captured as a structured Human Authority Grant and the Agreement's requested authority is proven to be its subset. See [`Authority Carry-forward Baseline 001`](authority-carry-forward-001.md).

The executable policy now checks action class, effect class, resource scope, expiry, and stop conditions. Product-owner review is still needed for whether the surface echo feels sufficiently visible and controllable.

### R2. Information density

Guided mode exposes several domain labels and a relatively long Choice block. The information is useful in this architecture-changing scenario, but live dogfood must determine whether:

- `qualification`, `baseline`, and `provenance` should be translated into plainer surface language;
- possibilities should initially show only recommendation and strongest alternative, with the other two behind drill-down;
- Work Agreement should collapse allowed/not-allowed details when unchanged from the opening frame.

### R3. Scripted fluency

The transcript proves layout and policy sequence, not that a model can reliably extract the same distinctions. A provider-driven run must test malformed tool calls, premature completion, missing alternatives, and correction handling.

### R4. Terminal behavior

No keyboard selection, streaming redraw, narrow viewport, color-free accessibility, interruption, or resume behavior has been tested.

## 7. Product-owner review questions

1. Does one architecture Choice Gate before work plus one Result Review after work feel like the right Guided burden here?
2. Is it acceptable to carry the original instruction forward into a non-expanding Work Agreement without a second confirmation?
3. Which labels feel like useful precision, and which feel like internal jargon that should be hidden by default?

These answers should modify the experience contract before a model provider or full TUI makes the interaction more expensive to change.
