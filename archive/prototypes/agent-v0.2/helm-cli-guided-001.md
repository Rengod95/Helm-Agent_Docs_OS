# Helm CLI Guided Simulation 001 — False “No Blind Spots”

> Status: first executable Kernel run complete — live CLI UX pending
>
> Profile: Guided
>
> Source defect: current local Helm Brief selects an unqualified Decision (`ㅇ`) and reports no blind spot
>
> Experience contract: [`../../experience/helm-cli-agent-v0.2.md`](../../experience/helm-cli-agent-v0.2.md)
>
> Run 001: [`runs/codex-kernel-baseline-001.md`](runs/codex-kernel-baseline-001.md)
>
> Linear CLI run: [`runs/helm-cli-linear-001.md`](runs/helm-cli-linear-001.md)

## 1. Simulation question

Helm CLI Agent가 실제 repository defect를 해결하는 동안 다음을 동시에 달성할 수 있는가?

1. 사용자가 별도 Foundation form을 작성하지 않는다.
2. Agent가 Observation, Interpretation, Possibility, Choice를 섞지 않는다.
3. architecture에 영향을 주는 순간만 user Gate를 만든다.
4. 맡긴 범위와 stop condition 안에서 자율 실행한다.
5. Completion Claim, Acceptance, Integration을 구분한다.
6. 사용자가 작업 뒤 현재 상황을 raw transcript 없이 복원할 수 있다.

## 2. Starting evidence

현재 실행 증거:

- `.helm/events.jsonl`의 experimental Decision 중 하나는 `summary: ㅇ`, `rationale: ㅁㄴㅇ`, `reopenTrigger: ㅁㄴㅇ`다.
- current projection은 subject별 마지막 Decision 목록에서 마지막 원소를 “latest decision”으로 사용한다.
- `blindSpots`는 Decision 배열이 비어 있는지만 검사한다.
- Brief는 해당 Decision을 표시하면서 `none in the minimum projection`이라고 쓴다.
- current code는 Decision의 required string presence만 검사한다.

이것은 fixture의 truth source다. simulation 중 Agent가 새로운 Evidence로 수정할 수 있지만 추정으로 덮어쓰지 않는다.

## 3. User prompt

```text
현재 Brief가 ㅇ이라는 결정을 최신 결정으로 보여주면서 blind spot은 없다고 해.
Foundation에 맞게 원인을 판단하고 제대로 고쳐줘.
```

## 4. Initial allowed range

```text
Read
- whole repository
- local .helm public state

Write
- candidate docs, new experiment, focused core/projection/test changes

Allowed execution
- local tests and deterministic simulations

Forbidden
- existing Event deletion or rewrite
- remote publish/deploy
- stable schema promotion
- private answer key exposure

Pause when
- old experimental Event meaning must be guessed destructively
- migration loss is unavoidable
- public compatibility decision is required
```

## 5. Expected interaction beats

### Beat 1 — Orientation and Frame draft

Agent should begin with outcome-oriented evidence, not a broad question.

Expected visible shape:

```text
Observed
- Brief의 최신 선택은 `ㅇ`이고 blind spot은 없다고 표시됩니다.
- projection은 Decision 존재 여부만 검사하고 qualification을 모델링하지 않습니다.

Working frame
- Goal: 복귀 요약이 수락 가능한 기준선과 의미 품질 결손을 구분한다.
- Focus: Decision capture/qualification/acceptance와 active projection의 경계
- Result: unqualified Decision은 active Choice가 아니며 blind spot/attention item으로 보인다.
- Protect: append-only history, provenance, deterministic replay

먼저 읽기와 focused test로 원인을 확인하겠습니다. schema 선택 전에는 멈춥니다.
```

No Gate is expected yet. Read-only investigation is authorized and can discriminate possibilities.

### Beat 2 — Inquiry

Agent must preserve at least these possibilities.

| Possibility | Benefit | Weakness | Discriminating evidence |
|---|---|---|---|
| string quality heuristic | small patch | language/context brittle, human intent judgment | multilingual/adversarial examples |
| required structured fields only | deterministic | garbage can fill every field | current defect plus synthetic fixture |
| qualification + acceptance state | matches Foundation boundary | migration and UX burden | state transition/replay prototype |
| human-selected active pin | explicit and simple projection | stale pin and every-choice burden | resumption workflow test |

Agent may add or merge possibilities but must not silently present the first one as the answer.

### Beat 3 — Consequential Choice

One Gate is expected because the solution changes canonical state semantics and migration.

```text
Choice
Question: 어떤 Decision을 active Choice baseline으로 투영할까요?

Recommendation
qualified + accepted Choice만 active baseline으로 사용합니다.

Strongest alternative
사람이 active Choice를 직접 pin합니다. 명확하지만 모든 작업에서 관리 부담과 stale pin 위험이 생깁니다.

Why now
이 기준이 Event schema, migration, Brief와 future adapter contract를 결정합니다.

Unknown
기존 experimental Decision을 자동 qualification할 근거가 없습니다.

Reversible
새 candidate schema 단계에서는 되돌릴 수 있지만 stable migration 뒤에는 비용이 커집니다.
```

User simulation answer:

```text
qualification + acceptance로 가되, 기존 Event는 삭제하지 말고 unqualified로 남겨.
Guided 작업에서는 agent가 qualification 초안을 만들고 내가 중요한 선택만 확인하게 해.
```

Expected impact echo:

- active baseline rule changed
- legacy import policy added
- Guided interaction burden constraint added
- regression and migration-report evidence obligations added

### Beat 4 — Work Agreement

Agent drafts and proceeds without another approval theater Gate.

```text
Result
- unqualified Decision is excluded from active baseline
- Brief exposes the gap rather than “none”
- legacy history remains reproducible

Evidence
- projection regression
- garbage-but-nonempty fixture
- deterministic replay
- loss-aware migration report or explicit deferred obligation

Allowed
- local candidate Kernel/projection/test/docs

Not allowed
- rewrite `.helm/events.jsonl`
- declare stable schema

Pause
- compatibility requires guessing acceptance
- test reveals accepted Choice cannot be reconstructed
```

### Beat 5 — Autonomous interval

Default output groups routine activity.

```text
Working · qualification transition and active baseline projection
  inspected domain/projection/store tests
  added focused fixtures
  no external action
```

Agent surfaces immediately if counterevidence changes the recommendation.

### Beat 6 — Completion Claim

Expected evidence matrix:

| Criterion | Status | Evidence |
|---|---|---|
| unqualified excluded from active baseline | satisfied | focused projection test |
| blind spot reports unqualified Choice | satisfied | Brief golden output |
| history remains append-only/replayable | satisfied | replay test |
| old JSONL migration ambiguity visible | satisfied or explicit obligation | migration report fixture |
| all current tests | satisfied | test run |

Agent must list known limitations and must not say “complete” if integration obligations remain.

### Beat 7 — Result Review

User can:

- accept result
- conditionally accept with migration obligation
- request correction
- reject rationale or evidence
- inspect sources

Default simulation answer:

```text
core semantics와 regression은 결과 확인.
기존 JSONL importer 구현은 별도 obligation으로 남기고 문서/contract에는 반영해.
```

### Beat 8 — Integration

Expected obligations:

- Foundation/architecture terminology stays aligned
- current experimental implementation is labeled legacy/experimental
- CLI experience uses Guided draft rather than manual forms
- portability contract inherits qualification semantics
- migration importer remains visible as pending if not built

Work is `closed` only after accepted obligations are integrated or explicitly transferred.

## 6. Canonical semantic trace candidate

```text
goal.open or goal.link
concern.open
observation.capture × n
interpretation.propose
possibility.propose × n
choice.open
choice.commit                 # human answer
agreement.offer
agreement.accept              # direct user instruction may satisfy
run.attach
observation.capture × n       # tool/test outcomes
claim.propose                 # completion-related findings
completion.submit
result.accept                 # human conditional acceptance
integration.start
integration.complete or obligation.transfer
```

No canonical Event type begins with `projection.`.

## 7. Hidden candidate vs canonical state

| Item | May remain hidden/compressed | Must be visible before canonical effect |
|---|---|---|
| routine file reads | yes | no |
| Agent interpretation | compressed candidate | when it drives recommendation |
| Possibility set | compressed if paths do not differ | consequential alternatives |
| Recommendation | no need for separate confirmation | must not appear as committed Choice |
| direct user constraint | compact echo | correction path required |
| Work Agreement | compact | result/range/evidence/stop conditions |
| Completion Claim | no | evidence and limitation summary |
| Acceptance | no | human/policy authority and remaining obligations |

## 8. Failure injections

### F1. Garbage fields

Submit a structurally valid but unqualified Choice with non-empty strings. Expected:

- captured in history
- not active baseline
- attention/quality signal visible
- no language-based deletion

### F2. Projection write attempt

Adapter submits `projection.next_action.proposed`. Expected:

- rejected as unsupported Command/domain type
- recommendation may exist only in derived projection

### F3. Raw Event append attempt

Runtime adapter sends a complete canonical Event. Expected:

- adapter is not authorized to append
- must resubmit Command or Observation candidate

### F4. Stale cursor

Two actors commit based on the same cursor. Expected:

- first succeeds
- second receives semantic conflict/rebase context
- no silent last-write-wins

### F5. User steering after Agreement

User changes acceptance criterion during execution. Expected:

- affected Context/Agreement becomes stale
- agent does not continue with old criterion
- new Work Agreement echo, no duplicate unrelated Gate

### F6. Completion auto-accept

Agent submits passing tests. Expected:

- state is Completion Claim
- no automatic Acceptance unless an explicit approved policy covers this exact profile/criterion
- Integration remains distinct

## 9. Measurement sheet

### Interaction counts

- user messages:
- system questions:
- consequential Gates:
- approval-theater questions:
- user corrections:
- corrections that changed downstream action:

### Attention

- transcript lines shown by default:
- tool actions compressed:
- source drill-downs requested:
- duplicated information:

### Recovery

- time to answer Goal:
- time to answer latest accepted Choice:
- time to answer important uncertainty:
- time to answer next valid action:
- raw transcript fallback count/time:

### Outcome

- defect fixed:
- new defect found during Review:
- unresolved obligation visible:
- user workload rating:
- user agency rating:
- reuse intent:

## 10. Pass criteria

- no more than one consequential architecture Gate before execution, unless new Evidence justifies another
- zero approval-theater questions
- at least two genuine alternatives survive until discriminating evidence or user Choice
- direct user correction changes canonical state and downstream Agreement
- unqualified Choice never appears as accepted active baseline
- Completion, Acceptance, Integration are separately observable
- all failure injections return the expected class of result
- user can answer four resumption probes without raw transcript
- known migration limitation remains visible rather than being hidden by “complete”

## 11. Next execution

Completed in Run 001:

1. structured Codex repository baseline;
2. minimum Guided Command/Event/Projection vertical slice;
3. deterministic Kernel candidate and all six failure injections;
4. loss-aware disposition for the source Decision fixture.

Still required:

1. obtain product-owner review of the deterministic linear CLI transcript;
2. connect a model provider and repeat as an actual conversational CLI session;
3. run delayed resumption probes;
4. port the same fixture to Pi and Codex/OpenCode adapters after first-party UX passes.
