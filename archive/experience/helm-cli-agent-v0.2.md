# Helm CLI AI Agent Experience v0.2 후보

> Status: Kernel/runtime/provider contracts, durable Kernel storage, and deterministic linear CLI simulated — model-driven CLI pending
>
> Foundation: [`../foundations/10-refinement-candidate.md`](../foundations/10-refinement-candidate.md)
>
> Architecture: [`../architecture/helm-kernel-v0.2-candidate.md`](../architecture/helm-kernel-v0.2-candidate.md)
>
> First fixture: [`../prototypes/agent-v0.2/helm-cli-guided-001.md`](../prototypes/agent-v0.2/helm-cli-guided-001.md)
>
> First run: [`../prototypes/agent-v0.2/runs/codex-kernel-baseline-001.md`](../prototypes/agent-v0.2/runs/codex-kernel-baseline-001.md)
>
> Linear CLI evidence: [`../prototypes/agent-v0.2/runs/helm-cli-linear-001.md`](../prototypes/agent-v0.2/runs/helm-cli-linear-001.md)
>
> Runtime evidence: [`../prototypes/agent-v0.2/runs/first-party-runtime-baseline-001.md`](../prototypes/agent-v0.2/runs/first-party-runtime-baseline-001.md)

## 1. 제품 경험 정의

Helm CLI는 Event를 사람이 수동 입력하는 관리 CLI가 아니다.

> **Helm CLI는 사용자가 자연어로 AI와 일하는 동안 목표, 이해, 선택, 맡긴 범위, 결과의 의미를 잃지 않게 만드는 first-party AI agent다.**

사용자는 Foundation 용어를 외우거나 form을 완성하지 않는다. Agent Runtime이 대화와 도구 사용에서 semantic candidate를 만들고 Kernel이 불변조건을 지킨다. 사용자는 자신의 판단이 결과를 바꾸는 순간에만 구조를 보고 수정한다.

## 2. 현재 CLI와의 단절점

현재 `packages/helm-cli`는 다음을 수행하는 유효한 experimental control utility다.

- `init`, `status`, `brief`, `events`
- Decision, Commitment, Belief, Next Action 수동 기록
- Git material capture
- resumption experiment와 local server 실행

그러나 first-party AI agent experience로는 다음이 없다.

- model/provider invocation
- conversational agent loop
- tool execution and steering
- 자연어에서 semantic candidate를 초안하는 과정
- 중요한 차이만 보여주는 interactive Gate
- runtime pause/cancel/context refresh
- Completion Claim → Acceptance → Integration interaction

현재 command를 그대로 확장하면 사용자가 agent와 대화한 뒤 별도 `helm record ...` 명령으로 의미를 다시 입력해야 한다. 이는 Helm이 줄이려는 조정 비용을 제품이 다시 만든다.

### Migration principle

- `helm` 기본 entrypoint는 interactive AI agent가 된다.
- automation과 inspection은 명시적 subcommand로 남긴다.
- 기존 `record` command는 diagnostic/import/admin surface로 재분류한다.
- interactive mode와 headless mode는 같은 Kernel Command를 사용한다.

## 3. 사용자 mental model

사용자는 Helm을 세 층으로 이해할 필요가 없다. 다음 다섯 질문만 일관되게 답할 수 있으면 된다.

1. **어디로 가는가?** — Goal
2. **지금 무엇을 풀고 있는가?** — Focus/Concern
3. **무엇이 사실이고 무엇이 아직 가능성인가?** — Observation/Finding/Possibility
4. **무엇을 어디까지 맡겼는가?** — Work Agreement/Allowed Range
5. **무엇을 왜 완료로 받아들였는가?** — Result Review/Whole Update

Kernel 용어와 Event type은 inspector와 developer mode에서만 보인다.

## 4. 기본 실행 형태

```text
$ helm

Helm resumes the current workspace or starts onboarding.
The user then works through natural conversation.
```

### Interactive entrypoints

```text
helm                         # resume or start the default workspace
helm --new                   # start a new Concern while preserving the Goal
helm --resume <work-ref>     # resume a specific WorkUnit
helm --profile quick         # user-requested lower ceremony, policy may escalate
helm --profile assured       # explicit higher assurance
```

### Non-interactive and administrative entrypoints

```text
helm run --prompt <text> --json
helm inspect brief --json
helm inspect history --json
helm workspace export
helm workspace doctor
helm server
```

정확한 command name은 prototype에서 변경 가능하다. 중요한 계약은 interactive agent와 automation client가 같은 semantic Command/Event/Projection을 사용하는 것이다.

## 5. CLI의 다섯 핵심 surface

### Orient — 다시 참여하기

다음만 우선 보여준다.

- 마지막 확인 이후 중요한 변화
- 목표와 현재 Focus
- 멈춰 있는 이유 또는 다음 자동 행동
- 사용자의 판단이 필요한 하나의 우선 항목
- 지금 읽지 않아도 되는 활동

`Event 200개`, `파일 99개 변경`은 기본 orientation이 아니다. source drill-down에서만 보인다.

### Explore — 문제를 이해하기

- 직접 확인한 관찰
- 그 관찰에 대한 해석
- 경쟁하는 원인 또는 해결 가능성
- 각 가능성을 구분할 Evidence
- 아직 확인하지 않은 전제

Explore는 항상 긴 분석 화면이 아니다. 중요한 불확실성이 실제 경로를 바꿀 때만 펼친다.

### Choose — 방향을 바꾸는 선택

- 지금 정할 것과 why-now
- 현상 유지/추가 확인을 포함한 실질적 선택지
- 추천과 가장 강한 대안
- 근거, 반대 근거, 남은 unknown
- 되돌릴 수 있는지
- 선택이 바꿀 Work Agreement
- review trigger

사용자는 추천을 선택하는 것뿐 아니라 기준 수정, 질문 재구성, 추가 실험, 연기를 할 수 있다.

### Work — 자율 실행과 steering

- 지금 하는 일과 이유
- 맡긴 범위와 금지된 행동
- 다음 의미 있는 checkpoint
- 지켜보는 위험과 stop condition
- 마지막 consequential change

tool call 전체를 기본 stream으로 강요하지 않는다. 사용자는 필요할 때 source trace를 펼친다.

### Review — 결과 수락과 전체 반영

- 결과 기준별 Evidence
- 확인되지 않은 것과 known limitation
- counterevidence와 invalidation trigger
- 수정/조건부 수락/수락/거절
- 다른 Goal, Choice, WorkUnit, Artifact에 미치는 영향
- integration obligation과 다음 learning

## 6. 기본 화면 문법

### Persistent status line

```text
Goal  Agent-independent Helm foundation
Focus Fix false “no blind spots” projection
Mode  Build · Guided
Work  Compare qualification designs
Range Read all · Write local docs/code · No external actions
Next  Pause before schema choice
```

터미널이 좁으면 다음처럼 축약한다.

```text
Build · Guided · comparing qualification designs · pauses before schema choice
```

### Conversation area

일반 설명, 질문, tool activity, semantic surface를 시각적으로 구분한다.

```text
Helm       자연어 설명과 recommendation
Observed   직접 확인한 내용
Possible   아직 검증 중인 설명/해법
Choice     사용자의 판단이 필요한 구조화된 요청
Working    자율 실행의 의미 있는 상태 변화
Review     결과와 Evidence
Source     tool/log/file drill-down
```

색상만으로 상태를 구분하지 않는다. label과 text가 항상 존재한다.

### Command palette

자연어가 기본이고 slash command는 빠른 조작과 발견성을 위한 보조 수단이다.

```text
/brief        현재 상황과 달라진 점
/goal         Goal과 success condition 보기/수정
/focus        현재 Concern 보기/재구성
/explore      Observation/Possibility/Evidence 보기
/choice       열린 선택 보기
/scope        맡긴 범위 보기/수정
/work         진행 작업과 checkpoint
/review       결과 제출과 확인
/history      정본 변화와 source
/profile      Quick/Guided/Assured
/pause        안전한 checkpoint에서 멈춤
/stop         현재 실행 취소 또는 compensation 안내
```

Slash command를 사용하지 않아도 모든 기능에 자연어로 접근할 수 있어야 한다.

## 7. Guided 기본 interaction rhythm

```text
Resume/Start
  → Frame draft
  → Investigate autonomously
  → consequential Choice only when needed
  → Work Agreement echo
  → autonomous interval with semantic checkpoints
  → Completion Claim
  → Result Review
  → Whole Update
```

각 단계는 고정 wizard page가 아니다. 간단한 작업에서는 일부가 하나의 agent turn 안에서 압축된다.

## 8. 자연어에서 state로 가는 규칙

### Clear direct instruction

사용자의 문장이 충분히 명확하고 권한 있는 직접 지시라면 별도 “확인할까요?”를 묻지 않는다.

```text
User: 이 작업에서는 외부 배포를 하지 마.

Helm: 외부 배포를 금지하고 로컬 변경과 테스트까지만 맡은 범위로 두었습니다.
```

Normative state 변경을 짧게 echo하고 언제든 correction할 수 있게 한다.

### Ambiguous but low consequence

Agent가 provisional interpretation을 만들고 진행 가능한 read-only 조사부터 한다.

```text
“빠르게 정리”를 문서 구조 개선으로 이해하고 먼저 읽기만 하겠습니다.
코드 삭제나 공개 API 변경이 필요하면 그 전에 멈춥니다.
```

### Ambiguous and consequential

실질적 경로가 갈리면 Gate를 연다. 질문은 ambiguity를 그대로 되묻지 않고 차이가 만드는 결과를 설명한다.

### Epistemic extraction

Agent가 대화에서 추출한 Observation/Interpretation/Possibility는 candidate다. 기록되었다는 이유로 accepted Finding이 되지 않는다.

### Normative extraction

Agent recommendation은 Choice가 아니다. 사용자의 명시적 선택 또는 승인된 policy transition이 있어야 기준선이 바뀐다.

## 9. Profile behavior

### Quick

Quick은 “대충 하기”가 아니다.

- 작은 local/reversible change
- 명확한 Goal과 Result
- established policy and automated verification
- 낮은 semantic coupling

UI는 Frame/Agreement를 한두 문장으로 압축한다. internal provenance와 Completion/Acceptance 경계는 유지한다.

### Guided — default

- Goal과 Focus를 visible하게 유지
- 중요한 Observation/Interpretation/Possibility 구분
- consequential Choice와 Work Agreement를 짧게 surface
- semantic checkpoint를 batch
- evidence-based Result Review

사용자가 profile을 고르지 않으면 Guided로 시작한다.

### Assured

다음 신호에서 system이 escalation을 제안하거나 policy가 강제한다.

- external/shared effect
- secret, production, payment, customer data
- 낮은 recoverability 또는 높은 cost
- 규범적 가치 충돌
- 중요한 agent/stakeholder disagreement
- cross-system coupling
- evidence quality가 낮은데 결과 영향이 큼

Assured는 더 많은 승인 버튼이 아니라 더 명확한 problem frame, evidence burden, authority, recovery, independent review를 의미한다.

### Profile transition

```text
Quick → Guided
  unexpected uncertainty, scope growth, semantic conflict

Guided → Assured
  high effect class, low recoverability, authority boundary

Assured → Guided/Quick
  risk retired and policy explains why lower burden is safe
```

변경 이유를 보여주고 user가 더 엄격한 profile을 선택할 수 있게 한다. policy가 요구한 Assured를 user가 silent downgrade할 수는 없다.

## 10. Onboarding

### First launch

Helm은 repository를 읽기 전에 trust와 scope를 설명한다.

```text
이 프로젝트에서 Helm을 시작합니다.

지금은 파일과 Git 상태를 읽기만 합니다.
프로젝트 안에 Helm state를 둘지, 개인 state directory에 둘지 선택할 수 있습니다.
프로젝트 instruction이나 extension은 검토 후에만 활성화합니다.
```

### Goal framing

사용자는 자연어로 원하는 변화를 말한다. Agent가 다음을 초안한다.

```text
Goal             이루려는 변화
Result           받아들일 수 있는 상태
Protect          지켜야 할 가치/기준선
Not now          명시적 비목표
First focus      처음 풀 Concern
```

다섯 개의 빈 입력란을 순서대로 묻지 않는다. 사용자가 말한 내용과 repository evidence로 초안하고 결과를 바꾸는 ambiguity만 묻는다.

### Existing project

README, Git, tests, current agent instructions에서 material observation을 만들 수 있지만 Purpose/Choice를 자동 추론해 확정하지 않는다.

## 11. Resumption

### User-acknowledged cursor

“마지막 Event”가 아니라 사용자가 마지막으로 상황을 이해했다고 표시한 cursor 이후의 차이를 보여준다.

### Brief order

```text
1. 돌아온 뒤 달라진 점
2. 왜 중요한가
3. 그대로 두면
4. 지금 내 판단이 필요한 것
5. 맡긴 범위 안에서 자동으로 이어질 것
6. 지금 읽지 않아도 되는 것
```

### Resumption actions

- 맡긴 범위 안에서 계속
- 목표/기준/범위 수정
- 열린 Choice 처리
- source 근거 확인
- 작업 pause/stop

Brief를 읽었다는 행위와 내용을 이해했다는 주장을 동일시하지 않는다. 실험에서는 별도 situation probe로 측정한다.

## 12. Steering and interruption

### User steering

사용자는 실행 중 자연어로 다음을 바꿀 수 있다.

- Goal priority
- Problem view
- success/acceptance criterion
- protected baseline
- Allowed Range
- next checkpoint
- pause/stop

Agent는 queued message를 단순 다음 prompt로만 처리하지 않는다. 영향을 받는 Choice, Agreement, Context를 invalidate/recompile한다.

### Agent escalation

Agent가 도움을 요청할 때 포함할 것:

```text
무엇을 발견했는가
왜 현재 맡긴 범위로 해결할 수 없는가
멈춘 상태와 이미 발생한 effect
가능한 선택과 추천
언제까지 판단이 필요한가
```

### Pause semantics

- `pause`: 현재 tool action이 안전하게 끝나는 checkpoint에서 멈춤
- `stop`: 취소 요청, 이미 발생한 effect와 compensation 필요 여부 보고
- hard abort: 즉시 process 중단, workspace는 recovery-required가 될 수 있음

UI는 이 차이를 숨기지 않는다.

## 13. Tool activity

### Default compression

연속된 read/search/test는 의미 목적별 activity group으로 묶는다.

```text
Working · Decision qualification 경로 확인
  read 4 files · ran 2 focused searches · no material change
```

### Always surface

- material mutation 시작/완료
- external/shared effect
- permission/authority denial
- test evidence that changes a Finding
- counterevidence that changes recommendation
- protected baseline conflict
- cost/time/risk threshold crossing

### Drill-down

source trace는 timestamp, command/tool, input scope, output reference, exit/error, originating WorkUnit을 가진다.

## 14. Choice interaction

### Gate 생성 조건

1. 결과가 실질적으로 다른 대안이 있다.
2. policy/agent만으로 정당하게 선택할 수 없다.
3. 지금 묻는 것이 늦게 묻는 것보다 가치가 있다.
4. 사용자의 답이 실제 downstream plan/Agreement를 바꾼다.

### Compact Gate

```text
Choice · 어떤 상태를 Brief의 최신 선택으로 보여줄까요?

왜 지금
현재는 마지막으로 append된 문자열이 자동 기준선이 되어 잘못된 Brief를 만듭니다.

추천
qualified + accepted Choice만 active baseline으로 투영

가장 강한 대안
문자열 품질 heuristic으로 의심 항목만 제외 — 빠르지만 언어와 맥락에 취약

아직 모르는 점
과거 experimental Event를 어떤 quality state로 import할지 정하지 않았습니다.

[추천 선택] [기준 수정] [먼저 실험] [연기]
```

단순 `[승인] [거절]`은 사용하지 않는다.

### Choice impact echo

선택 직후 다음을 보여준다.

```text
이 선택으로 바뀐 것
- active Choice projection은 qualified + accepted만 사용
- 기존 experimental Decision은 captured/unqualified로 import
- migration report와 regression test가 Work Agreement에 추가됨

다시 볼 조건
- qualification burden 때문에 normal Guided 작업이 반복적으로 막힐 때
```

## 15. Work Agreement interaction

Agent가 자연어 대화에서 초안하고 compact echo를 보여준다.

```text
Work · Brief qualification path

Result
유효하지 않은 Decision이 active baseline이나 “blind spot 없음”으로 보이지 않는다.

Allowed
관련 docs/core/projection/test의 로컬 변경과 테스트

Not allowed
기존 JSONL 삭제, stable schema 선언, 외부 publish

Evidence
regression test · old JSONL import report · deterministic replay

Pause when
기존 Event 의미를 자동 추정해야 하거나 migration loss가 발생함
```

사용자는 `범위 좁혀`, `테스트는 전체로`, `migration은 이번에 하지 마`처럼 자연어로 수정한다.

## 16. Completion, Acceptance, Integration

### Completion Claim

Agent가 조건별 Evidence를 제출한다.

```text
Result submitted
✓ unqualified Choice excluded from active baseline — test ...
✓ blind spot reports unqualified choice — test ...
✓ projection replay deterministic — test ...
△ old JSONL migration — report only, importer not implemented
```

### User actions

- 결과 확인
- 제한을 남기고 조건부 확인
- 수정 요청
- 결과 거절
- 근거 더 보기

### Integration

Acceptance 뒤에도 다음이 남을 수 있다.

- docs and public language update
- adapter contract change
- old workspace migration
- dependent Context invalidation
- release and rollback plan

UI는 “수락됨 · 전체 반영 2개 남음”처럼 표시한다. `완료`는 integration obligation이 없을 때만 단독 사용한다.

## 17. Error and degraded states

### Kernel unavailable

Agent가 semantic state 없이 조용히 일반 chat mode로 계속하지 않는다.

```text
Helm state에 기록할 수 없어 실행을 멈췄습니다.
대화 초안은 보존했지만 Choice와 Work Agreement는 확정되지 않았습니다.
```

### Adapter capability missing

```text
이 runtime에서는 tool 실행 전 권한 차단을 강제할 수 없습니다.
현재 맡긴 범위는 advisory이며 실제 sandbox가 아닙니다.
```

### Projection stale

stale view를 current처럼 표시하지 않는다. source cursor와 invalidation reason을 보여준다.

### Unknown external outcome

timeout을 실패로 단정하지 않는다. 외부 action이 실제로 발생했는지 확인할 WorkUnit을 만든다.

## 18. Accessibility and terminal behavior

- 80-column text fallback
- color-independent labels
- screen reader가 읽을 수 있는 linear mode
- animation/spinner 없이도 상태 이해 가능
- full keyboard operation
- copyable source refs and plain-text export
- CJK/emoji display width test
- terminal resize without semantic content loss
- streaming output 중 user input/steering 보존
- `NO_COLOR`와 non-interactive environment 지원

## 19. Headless parity

TUI에서만 존재하는 business action을 만들지 않는다.

```text
TUI interaction
  → typed Client Command
  → Kernel decision/result
  → semantic UI event

Headless JSON interaction
  → same typed Client Command
  → same Kernel decision/result
```

Headless mode에서 human Gate가 필요하면 `needs_gate` result와 resume token을 반환한다. stdin prompt를 열어 CI를 멈추지 않는다.

## 20. Software engineering considerations

### Separate state machines

다음을 하나의 `status`로 합치지 않는다.

- Agent loop state: idle/thinking/tool-running/paused/stopped
- WorkUnit domain state: proposed/active/claiming/accepted/integrating/closed
- Connection state: connected/degraded/reconnecting/offline
- Projection freshness: current/stale/rebuilding/failed

### Event loop and cancellation

- tool execution은 cancellable signal을 받는다.
- pause와 abort semantics를 tool capability별로 명시한다.
- streaming UI update가 canonical transaction과 결합되지 않는다.
- terminal crash 뒤 incomplete tool/result를 recovery state로 복원한다.

### Rendering architecture

- Kernel Projection과 terminal component model 분리
- semantic UI event를 golden transcript로 test
- viewport/layout snapshot보다 linear accessible representation을 먼저 검증
- tool plugin output은 untrusted content로 escape/sanitize

### Provider neutrality

- provider message type을 Kernel Entity로 사용하지 않는다.
- model-specific reasoning/token fields는 operational telemetry다.
- tool schema와 context compilation은 provider capability adapter를 가진다.
- provider 전환 후에도 Goal/Choice/Agreement/Result가 유지된다.

### Secrets and local trust

- provider credentials는 Event/Projection에 들어가지 않는다.
- project instructions, skills, extensions는 trust 후 load한다.
- shell/environment capture에서 secret redaction policy를 적용한다.
- transcript export는 evidence export와 다른 privacy policy를 가진다.

### Crash consistency

- Command idempotency key
- tool action intent and outcome correlation
- single-writer Kernel transaction
- durable user steering queue
- resumable human Gate
- consistent SQLite backup and evidence manifest

## 21. 첫 시나리오 묶음

| ID | Profile | 사용자 목표 | 검증할 핵심 |
|---|---|---|---|
| CLI-Q01 | Quick | 작은 문서 오탈자 수정 | 의미 경계 유지와 낮은 마찰 |
| CLI-G01 | Guided | 잘못된 Decision이 Brief를 오염시키는 문제 해결 | inquiry, choice, agreement, review |
| CLI-G02 | Guided | 실행 중 사용자가 완료 기준 변경 | steering과 invalidation |
| CLI-G03 | Guided | 하루 뒤 작업 복귀 | situation recovery와 raw-log fallback |
| CLI-A01 | Assured | 외부 배포가 포함된 변경 | authority, recovery, human Gate |
| PORT-G01 | Guided | Codex → Pi → OpenCode handoff | semantic continuity와 capability degradation |

첫 구현과 simulation은 `CLI-G01`을 기준으로 하며, 이어 `CLI-Q01`, `CLI-G02`, `CLI-G03`을 수행한다. `CLI-A01`은 외부 effect를 실제 발생시키지 않는 simulation으로 시작한다.

## 22. UX acceptance criteria

### Correctness

- 사용자가 수정한 Goal/criterion/scope가 다음 agent action과 Context에 반영된다.
- Recommendation이 사용자 Choice로 자동 승격되지 않는다.
- Completion Claim이 자동 Acceptance/Integration이 되지 않는다.
- stale/unqualified/contested state가 current accepted baseline처럼 보이지 않는다.
- TUI와 headless client가 같은 source cursor와 policy result를 재현한다.

### Attention

- Guided 중간 작업에서 consequential Gate가 3개를 넘으면 각각의 필요성을 검토한다.
- routine tool activity는 기본 view의 절반 이상을 차지하지 않는다.
- 동시에 active한 user Gate는 기본 3개 이하로 batch/priority한다.
- 동일한 unresolved question을 중복 요청하지 않는다.

숫자는 초기 hypothesis이며 실제 dogfood에서 조정한다.

### Situation recovery

- 사용자가 raw transcript 없이 Goal, latest accepted Choice, important uncertainty, next valid action을 설명할 수 있다.
- Brief 사용 후 semantic correction이 필요한 경우 원본과 projection 중 어느 쪽 결함인지 구분한다.
- raw-log fallback 시간과 횟수가 baseline보다 감소한다.

### Agency and usefulness

- 사용자의 correction이 downstream result에 observable impact를 만든다.
- 사용자는 자신이 단순 승인자가 아니라 기준과 방향의 저자였다고 평가한다.
- Guided burden이 재작업 감소와 이해 향상보다 크지 않다.
- 사용자가 다음 작업에서도 Helm 방식을 다시 선택한다.

## 23. 금지되는 CLI 경험

1. 대화를 끝낸 뒤 사용자가 별도 `record` command로 같은 의미를 재입력하게 함
2. 매 turn마다 Goal/Choice/Agreement form을 출력
3. agent reasoning transcript를 situation awareness로 대체
4. 모든 tool call을 live dashboard의 중심으로 표시
5. `[승인] [거절]`만 제공하고 기준 수정이나 대안 탐구를 막음
6. user correction을 chat message로만 남기고 Kernel state/Context를 바꾸지 않음
7. “confidence 90%”를 Evidence 설명 대신 사용
8. tool success를 Result Acceptance로 표시
9. external adapter의 advisory boundary를 enforced sandbox처럼 표현
10. first-party Agent Runtime이 private API로 Kernel invariant를 우회

## 24. 다음 검증

Kernel Run 001에서 semantic trace, canonical Event, Gate 정책과 최소 contract를 검증했고, Linear CLI Run 001에서 deterministic user-visible rendering을 만들었다. 이어 bounded Agent Runtime, mocked provider mapping, Authority Grant, effect-aware cancellation, Context Projection, SQLite transaction/replay까지 통과했다. 실제 human workload, live model behavior와 terminal interaction은 아직 검증하지 않았다.

1. product-owner가 deterministic transcript의 Gate 수, 구조화된 맡긴 범위 echo, 용어 밀도를 검토한다.
2. live provider와 streaming decoder를 bounded model/tool loop에 연결한다.
3. `CLI-G01`을 실제 model-driven conversational CLI transcript로 재실행한다.
4. user-visible output, hidden candidate, canonical Event와 correction/workload를 대조한다.
5. durable runtime journal을 추가하고 `CLI-G02` steering과 `CLI-G03` delayed resumption으로 상태 복구를 검증한다.
6. first-party UX가 통과한 뒤 같은 fixture를 외부 runtime adapter에서 실행한다.
