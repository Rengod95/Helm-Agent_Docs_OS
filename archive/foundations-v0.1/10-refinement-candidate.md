# Helm Foundation v0.2 정제 후보

> Status: product direction aligned — first semantic validation passed, broader validation pending
>
> Role: 기존 v0.1의 모순과 실행 증거를 정리하고, 합의된 제품 순서·세계 모델·강제 수준을 다음 정본 후보로 제안한다.
>
> Alignment: 2026-08-22에 D1은 “자체 CLI agent 우선, portable Kernel 두 번째”로 수정 수락했고, D2는 수락했으며, D3는 “Guided 기본값의 위험 적응형 강제”로 수정 수락했다.
>
> Promotion: 대표 CLI 및 cross-runtime 시나리오 검증 전에는 기존 문서를 대체하지 않는다.
>
> First evidence: [`CLI-G01 Codex Kernel Baseline`](../prototypes/agent-v0.2/runs/codex-kernel-baseline-001.md)

## 1. 이 문서가 필요한 이유

현재 저장소에는 서로 다른 시대와 추상화 수준의 세 시스템이 겹쳐 있다.

1. **Docs-Agent OS** — Markdown/YAML을 에이전트 진입 프로토콜로 사용하는 수동 문서 스캐폴드
2. **Helm Foundations v0.1** — 지향적 공동행위에 대한 철학·의미·통치 모델
3. **Helm System experimental.v0** — JSONL Event ledger, projection, CLI, server, Web client로 만든 실행 vertical slice

이 셋은 진화 관계지만 현재 README와 코드에서는 하나의 제품처럼 동시에 노출된다. 그 결과 사용자는 Helm이 문서 템플릿인지, 에이전트 관리자지, 공동행위 제어면인지 한 문장으로 판단하기 어렵다.

이 문서는 v0.1의 방향을 폐기하지 않는다. 다음을 명확히 하여 정본 후보를 더 작고 엄격하게 만든다.

- Helm의 본질과 제품 경계
- 세계 모델과 행위자·정책의 관계
- 기록, 진실, 상태, projection의 차이
- 의미 품질과 `unknown`의 취급
- 자체 Helm Agent Runtime과 이식 가능한 Kernel의 경계
- 합의된 Decision과 검증해야 할 가설

## 2. 현재 증거에서 드러난 모순

### C1. 제품 정체성의 이중성

루트 README는 Helm이라는 이름 아래 Docs-Agent OS initializer와 Helm System v0를 함께 소개한다. 전자는 문서 기반 에이전트 라우터이고 후자는 의미 상태를 다루는 제어면이다.

**영향:** 사용자 약속, 설치 경로, 핵심 성공 지표가 서로 달라진다.

**정제 방향:** Docs-Agent OS는 `legacy scaffold / compatibility profile`로 재분류하고, Helm의 정본 정의에서 분리한다.

### C2. 세 세계와 다섯 상태 공간의 불일치

Ontology는 Normative, Epistemic, Material의 세 세계를 정의한다. Operating Theory는 여기에 Actors와 Policies를 더해 다섯 상태 공간이라고 부른다. Actor와 Policy를 같은 종류의 세계로 취급하면 다음 질문이 모호해진다.

- Actor는 현실의 내용인가, 상태를 주장하고 바꾸는 참여자인가?
- Policy는 현재 상황인가, 허용되는 전이를 평가하는 메타 규칙인가?

**정제 방향:** 세 세계는 작업 현실의 의미 차원으로 유지하고, Actor와 Policy는 모든 세계를 가로지르는 통치 평면으로 둔다.

```text
WorkspaceState(t) = <N(t), E(t), M(t) | A(t), P(t)>

N/E/M = 무엇이 현재 성립하는가
A     = 누가 그것을 관찰·주장·수락·변경할 수 있는가
P     = 어떤 전이와 증명 부담이 허용되는가
```

### C3. Event와 진실의 혼동

Formal State Model은 Event를 “이미 발생한 사실”이라고 표현한다. 그러나 ledger가 실제로 보장하는 것은 어떤 Actor나 Tool이 특정 내용을 기록했다는 사실이지 payload의 진실이 아니다.

**영향:** agent의 주장, 도구의 관찰, 인간의 선택이 append되었다는 이유만으로 같은 인식적 지위를 얻을 수 있다.

**정제 방향:** `LedgerEvent`는 **상태 전이에 대한 관찰·주장·수락의 불변 기록**이다. 기록 무결성과 내용 타당성을 분리한다.

```text
immutable record != true content
observed != interpreted != accepted
accepted != permanently valid
```

### C4. Canonical state와 Projection의 경계 침범

현재 `projection.next_action.proposed`는 정본 Event로 append된다. Projection은 Event에서 파생되는 소비자별 view여야 하므로 `projection.*`이 domain write vocabulary가 되면 경계가 뒤집힌다.

**정제 방향:**

- Actor가 행동을 제안했다면 `normative.action.proposed` 또는 WorkUnit/Commitment domain에 기록한다.
- 단순 추천이라면 projection 생성 결과로만 존재하며 source cursor와 derivation을 가진다.
- 사용자가 추천을 수락할 때만 별도 normative transition을 기록한다.

### C5. Foundation의 인식적 구분이 실행 코어에서 소실됨

Foundation은 Observation, Inference, Hypothesis, Assumption, Claim, Evidence, Decision을 구분한다. 현재 코어는 이를 `epistemic.belief.updated`와 `confidenceBasis` 문자열로 압축한다.

**영향:** 그럴듯한 해석이 관찰처럼 보이고, Evidence가 Claim과 독립적으로 재검토될 수 없으며, 반대 근거가 어떤 판단을 약화시키는지 계산할 수 없다.

**정제 방향:** 모든 세부 Entity를 즉시 구현하지 않더라도 최소한 아래 차이는 코어 계약에서 잃지 않는다.

```text
Observation — 직접 확인되거나 도구가 측정한 것
Interpretation — Observation의 의미에 대한 추론
Possibility — 아직 비교·검증 중인 설명이나 해법
Finding — 현재 범위에서 수락된 Claim
EvidenceLink — 무엇이 어떤 Claim을 어떻게 지지·반박하는지
Choice — 앞으로의 기준선을 바꾸는 규범적 선택
```

### C6. 구조적 유효성과 의미 품질의 혼동

현재 Decision validation은 필수 문자열이 비어 있지 않은지만 확인한다. 실제 local dogfood state에는 다음 값이 최신 Decision으로 투영되어 있다.

```text
summary: ㅇ
rationale: ㅁㄴㅇ
reopen trigger: ㅁㄴㅇ
```

그런데 Brief는 `blind spots: none`이라고 표시한다.

**이 증거가 반증하는 것:** 필드 존재 여부는 상황 복원 가능성이나 정당화된 상태를 증명하지 않는다.

**정제 방향:** 다음 상태를 분리한다.

```text
absent       — 기록 없음
captured     — 원시 입력 존재
structural   — schema와 타입 충족
qualified    — 출처·범위·근거·책임이 평가됨
accepted     — 권한 있는 주체 또는 정책이 기준선으로 수락
contested    — 중요한 반대 근거 또는 이견 존재
stale        — 시간·환경 변화로 재검토 필요
superseded   — 더 새로운 기준선이 명시적으로 대체
```

Projection은 `unknown`, `unqualified`, `contested`, `stale`을 blind spot과 risk로 보여야 한다. 낮은 품질의 입력을 조용히 최신 기준선으로 승격해서는 안 된다.

### C7. Goal-first 원칙과 단일 초기화 Purpose의 충돌

현재 Purpose는 `workspace.initialized` payload에 한 번 저장되며 변경·분기·상위 연결·재검토 전이가 없다. 그러나 Foundation은 Purpose가 작업보다 먼저 존재하고 Inquiry가 Purpose 충돌을 발견하면 기준선을 다시 열 수 있어야 한다고 말한다.

**정제 방향:** Goal은 workspace 이름표가 아니라 versioned normative entity다.

- 상위 Goal과 하위 Goal을 연결할 수 있다.
- success condition과 preservation constraint를 가진다.
- 수정, 중단, 대체, 달성 주장을 Event로 남긴다.
- Goal 변경은 영향받는 Context와 Work Agreement를 invalidate할 수 있다.

### C8. 다중 client와 다중 agent portability의 혼동

CLI와 Web이 같은 application service를 사용한다는 테스트는 다중 client 경계를 입증한다. 하지만 Pi, Codex, OpenCode가 같은 의미 계약으로 실행·중단·재개·결과 제출할 수 있다는 것은 아직 검증하지 않았다.

**정제 방향:** `client contract`와 `agent adapter protocol`을 분리하고 각각 독립적인 acceptance test를 둔다.

## 3. 합의된 제품 정의

### 정본 후보

> **Helm은 인간이 방향과 판단의 주인으로 남으면서 AI와 함께 탐구하고 실행하고 결과를 통합하게 하는 local-first AI agent system이다. 첫 제품은 자체 CLI AI agent이며, 그 경험을 지탱하는 Foundation과 Kernel은 다른 agent runtime에도 이식할 수 있어야 한다.**

### 한 줄 사용자 약속

> Helm CLI에서 깊고 일관된 방식으로 AI와 일하고, 자리를 비웠다가 돌아오거나 다른 agent로 옮겨도 같은 방향·맡긴 범위·결과 기준으로 이어간다.

### 제품 목표의 순서

1. **첫 번째 목표 — Helm CLI AI Agent:** Foundation을 기본 행동 방식으로 내장한 완결된 first-party agent experience를 만든다.
2. **두 번째 목표 — Portable Foundation & Kernel:** 같은 관점, workflow, semantic contract를 Codex, Pi, OpenCode, Oh My OpenCode에 이식한다.
3. **세 번째 목표 — Helm GUI AI Agent:** 검증된 Kernel과 Agent Runtime 위에 시각적이고 더 넓은 co-agency experience를 만든다.

두 번째 목표는 첫 번째 목표를 약화시키는 “최소 공통분모”가 아니다. 먼저 Helm CLI에서 원하는 경험을 충분히 강하게 구현하고, Kernel의 의미 계약을 훼손하지 않는 adapter를 다른 runtime에 제공한다.

### 제품과 Kernel의 경계

Helm **제품**은 Agent Runtime을 포함한다.

- model/provider invocation
- reasoning and tool loop
- session, steering, pause, resume
- CLI interaction and rendering
- Foundation workflow orchestration

Helm **Kernel**은 runtime과 분리된다.

- Goal, Concern, Claim, Choice, Work Agreement, Result의 의미
- 권한, evidence burden, state transition, conflict
- Event ledger, projection, invalidation, provenance
- runtime-independent adapter contract

즉, Kernel은 제품 내부의 “control plane” 역할을 하지만 Helm 제품 전체를 control panel로 정의하지 않는다. First-party Agent Runtime도 Kernel의 권한 검사를 우회할 수 없다.

### 여전히 비목표인 것

- 모든 model provider의 자체 inference 구현
- 범용 IDE와 프로젝트 관리 전 기능 대체
- 모든 채팅 transcript를 정본 장기 기억으로 취급
- 특정 vendor의 session ontology를 Helm ontology로 채택
- 이식성을 위해 Helm CLI 경험을 가장 약한 runtime 수준으로 제한

## 4. 정제된 세계 모델

### 4.1 세 의미 세계

#### N — Normative: 해야 하는 것과 수락된 약속

- Goal과 success condition
- Constraint와 priority
- Choice와 review trigger
- Work Agreement, authority, responsibility
- Result acceptance와 integration obligation

#### E — Epistemic: 알고 있다고 주장하는 것과 아직 모르는 것

- Observation과 source
- Interpretation과 Assumption
- Possibility/Hypothesis
- Finding/Claim
- Evidence와 challenging evidence
- uncertainty, confidence basis, invalidation trigger

#### M — Material: 실제로 존재하거나 변한 것

- Artifact와 external state
- run, tool action, test, deployment
- change와 Outcome
- interface, dependency, recovery path

세 세계는 분리되지만 관계 없이 독립적이지 않다.

```text
E justifies N        Evidence와 판단이 Choice를 정당화한다.
N authorizes M       Choice와 Work Agreement가 변경을 허가한다.
M updates E          실행 결과가 믿음과 가설을 바꾼다.
M fulfills N         Outcome이 Goal과 약속을 만족시킨다.
```

### 4.2 두 통치 평면

#### A — Actors and capabilities

Actor는 사람, agent, tool, team일 수 있다. 동일한 인격으로 취급하지 않고 다음 능력을 명시한다.

- observe
- propose
- decide within scope
- execute action classes
- attest evidence
- accept result
- integrate baseline

#### P — Policies and transition rules

Policy는 누가 어떤 조건에서 위 능력을 행사할 수 있는지 평가한다.

- authority envelope
- evidence burden
- escalation and pause rule
- freshness and invalidation
- concurrency and conflict
- privacy and disclosure
- recovery and compensation

## 5. 작업의 두 단위

`Concern episode` 하나만을 모든 규모에 강제하면 작은 수정에 과도한 형식을 부과한다. 반대로 Task만 사용하면 목적과 판단의 연속성이 사라진다. 따라서 두 단위를 구분한다.

### Concern

사람과 agent의 주의와 판단이 필요한 중요한 상황이다. 문제, 기회, 위험, 불확실성일 수 있다.

### WorkUnit

Concern 또는 Goal을 바꾸기 위해 제한된 권한 아래 실행하는 구체적 작업이다.

```text
Goal
  └─ Concern
       ├─ Inquiry WorkUnit
       ├─ Change WorkUnit
       └─ Integration WorkUnit
```

작고 가역적이며 정책으로 충분히 덮이는 작업은 더 가벼운 profile로 처리할 수 있다. 그러나 기본값은 최소 기록이 아니라 사용자가 방향과 근거를 실제로 이해할 수 있는 `Guided` profile이다. 형식의 양은 고정 workflow가 아니라 위험·불확실성·결합도에 따라 증가해야 한다.

### 위험 적응형 강제 수준

#### Quick — 낮은 위험의 짧은 작업

- Goal 또는 active Concern 연결
- 기대하는 Result와 보존해야 할 Constraint
- material mutation의 provenance
- 완료 주장과 자동 검증 Evidence

사용자에게 매번 form을 요구하지 않지만 agent가 이 의미를 내부적으로 유지해야 한다. Observation을 Choice로 자동 승격하거나 완료를 수락과 동일시하는 것은 Quick에서도 금지한다.

#### Guided — 기본값

- 명시적 Goal과 현재 Concern
- Observation, Interpretation, Possibility의 구분
- 중요한 Choice의 실질적 대안과 rationale/review trigger
- Work Agreement와 맡긴 범위
- Completion Claim, Evidence, Acceptance의 구분
- 중요한 uncertainty, dissent, integration obligation 표시

사용자가 자연어로 대화하면 Agent가 구조를 초안하고, 사용자는 결과를 바꿀 수 있는 핵심 차이만 확인·수정한다. 제품의 “조금 더 강하지만 과도하게 엄격하지 않은” 기본 경험이다.

#### Assured — 높은 위험·높은 결합도

- 명시적 Problem Frame과 competing possibilities
- Evidence/Counterevidence와 acceptance burden
- effect class별 강제된 Authority Envelope
- 독립적이거나 명시적으로 동일 주체임을 밝힌 result review
- integration impact, rollback/recovery, reopen trigger
- consequential action 전 human Gate

### Profile이 바꾸지 못하는 불변조건

Profile은 입력 형식과 증명 부담의 양을 조절한다. 다음 의미 경계는 어떤 profile에서도 축소하지 않는다.

- 기록과 진실은 다르다.
- Observation, Interpretation, Possibility, Finding, Choice는 다르다.
- Projection은 정본을 쓰지 않는다.
- Authority는 scope와 effect class를 가진다.
- Completion Claim, Acceptance, Integration은 다르다.
- unknown, dissent, stale state는 숨기지 않는다.

## 6. 코어의 최소 법칙 후보

1. **모든 material mutation은 Goal/Concern과 권한 근거에 연결한다.**
2. **기록의 존재와 내용의 진실·품질·수락을 구분한다.**
3. **Observation, Interpretation, Possibility, Finding, Choice를 서로 자동 승격하지 않는다.**
4. **Choice는 대안, 근거, 권한 주체, review trigger를 가진다.**
5. **Authority는 agent의 고정 등급이 아니라 WorkUnit과 action class별 범위다.**
6. **결과 제출, 결과 수락, 전체 반영을 별도 전이로 둔다.**
7. **Projection은 정본을 변경하지 않으며 cursor, 포함·누락 정책, freshness를 가진다.**
8. **`unknown`, dissent, counterevidence는 오류 없이 존재할 수 있는 일급 상태다.**
9. **semantic conflict를 file conflict와 별도로 탐지·표현한다.**
10. **특정 agent/runtime/session 없이도 의미 상태를 읽고 내보낼 수 있어야 한다.**
11. **자동화가 사용자의 복귀 능력·예측 가능성·방향 수정 능력을 낮추면 실패로 측정한다.**
12. **모든 안정 schema는 실제 cross-runtime scenario의 증거를 통과한 뒤 승격한다.**

Authority의 후속 사용은 다음 포함 관계를 증명해야 한다.

```text
RequestedAuthority(next action or Work Agreement)
  ⊆ CurrentAuthorityGrant(actor, WorkUnit)
```

따라서 “이미 한 번 맡겼다”는 사실만으로 권한이 이어지지 않는다. action/effect/resource/expiry/stop condition 중 하나라도 확대되거나 불명확하면 더 좁은 Agreement를 만들거나 Gate를 연다.

## 7. 코어와 주변부의 경계 후보

### Helm Kernel이 소유한다

- stable identity와 versioned schema
- Command validation과 domain transition
- append-only ledger와 correction/supersession semantics
- N/E/M 관계 projection
- authority/evidence/freshness policy evaluation
- conflict와 invalidation 신호
- adapter capability contract
- deterministic export/import와 provenance

### Runtime Adapter가 소유한다

- Helm Work Agreement를 agent별 instruction/context로 변환
- agent session/run lifecycle 관찰
- tool action과 artifact change 수집
- runtime의 permission·pause·cancel 기능 매핑
- 결과를 Completion Claim과 Evidence 후보로 제출
- 지원할 수 없는 capability를 명시적으로 보고

### Client가 소유한다

- CLI, TUI, GUI, IDE surface
- Brief, Explore, Choice, Review의 상호작용 표현
- 접근성, progressive disclosure, 알림 채널

Client는 domain validation이나 정본 state를 별도로 소유하지 않는다.

### Agent Runtime이 소유한다

- model invocation과 reasoning loop
- tool selection과 실행 substrate
- provider/session management
- agent-specific context window strategy

## 8. Agent-independent Adapter Protocol의 최소 요구

모든 runtime이 같은 기능을 제공한다고 가정하지 않는다. Adapter는 capability negotiation을 해야 한다.

```text
identify_actor
start_or_attach_run
deliver_context
declare_authority_envelope
observe_lifecycle
observe_tool_action
observe_artifact_change
request_pause_or_cancel
receive_completion_claim
link_evidence
```

지원 수준 예시:

- **Level A — File/CLI bridge:** instructions file + deterministic CLI/JSON 입출력
- **Level B — Lifecycle hooks:** run start/end, tool action, artifact event 수집
- **Level C — Directed runtime:** pause/cancel, context refresh, authority enforcement
- **Level D — Native co-agency:** live steering, gate, semantic conflict, resumption round-trip

Codex, Pi, OpenCode는 먼저 자신이 지원하는 capability로 설명되어야 한다. vendor별 이름을 코어 schema에 넣지 않는다.

## 9. 첫 대표 시나리오 후보

### Cross-runtime 이어서 일하기

1. 사용자가 Codex에서 Goal과 Concern을 연다.
2. Codex가 현재 관찰과 두 개 이상의 가능성을 구조화하되 Choice를 자동 확정하지 않는다.
3. 사용자가 한 방향을 선택하고 조사 범위와 중단 조건을 정한다.
4. Pi가 같은 Work Agreement와 Context Projection으로 조사를 수행한다.
5. Pi의 Finding과 Evidence가 Helm에 들어오며 기존 Assumption 하나를 약화시킨다.
6. 사용자가 돌아왔을 때 Brief는 raw activity가 아니라 달라진 판단·위험·다음 선택을 보여준다.
7. OpenCode가 수락된 Choice와 제한된 authority로 구현한다.
8. 구현 완료 주장은 test evidence와 함께 제출되지만 자동으로 전체 완료가 되지 않는다.
9. Codex 또는 사용자가 결과를 확인하고 인접 작업의 Assumption까지 통합한다.
10. 다른 runtime에서 열어도 동일한 Goal, Choice, Work Agreement, unresolved risk가 재현된다.

이 시나리오는 다중 client가 아니라 **의미의 cross-runtime continuity**를 검증한다.

## 10. 첫 UX 명제 후보

사용자 경험의 중심 화면은 agent 목록이나 task board가 아니라 다음 네 질문이어야 한다.

1. **어디로 가고 있는가?** — Goal, success condition, constraint
2. **무엇이 달라졌고 무엇을 믿는가?** — observation, finding, uncertainty, dissent
3. **내 판단이 필요한 차이는 무엇인가?** — choice gate와 consequence
4. **무엇을 어디까지 맡겼고 결과를 믿어도 되는가?** — work agreement, evidence, acceptance, integration

상세 activity와 transcript는 drill-down source이지 기본 화면이 아니다.

## 11. 제품 소유자 Decision 정렬 결과

### D1. Helm의 제품 경계 — 수정 수락

**결정:** Helm의 첫 목표는 자체 CLI AI agent다. Portable Kernel과 다른 runtime adapter는 두 번째 목표이며, GUI agent가 그 다음이다.

**정제:** Kernel은 runtime-independent control plane이지만 Helm 제품은 first-party Agent Runtime과 experience를 포함한다.

**아키텍처 결과:** `Kernel ≠ Agent Runtime`, 그러나 `Helm Product = Kernel + Agent Runtime + Experience`다.

### D2. 세계 모델의 위상 — 수락

**결정:** N/E/M은 의미 세계, A/P는 가로지르는 통치 평면이다.

**결과:** Event schema와 projection은 이 위상을 기준으로 설계한다.

### D3. 의미 모델의 깊이 — 수정 수락

**결정:** 최소 의미 계약만으로 약화하지 않는다. `Guided`를 기본값으로 하고 Quick/Assured profile이 위험에 따라 부담을 조절한다.

**결과:** 핵심 의미 경계는 항상 강제하되, 모든 작업에 전체 Inquiry/Delegation/Assurance form을 요구하지 않는다.

**재검토 조건:** Guided profile이 사용자 판단을 개선하지 못하고 workload만 증가하거나, Quick profile이 반복적으로 방향 이탈·허위 완료를 허용할 때 강도를 조정한다.

## 12. v0.2 Foundation의 수락 기준

다음 조건 전에는 이 후보를 정본으로 승격하지 않는다.

- Helm을 처음 접한 사용자가 제품과 agent runtime의 차이를 설명할 수 있다.
- 사용자가 Helm 제품과 portable Kernel의 차이를 “자체 agent 우선, 외부 이식 두 번째”로 이해할 수 있다.
- Quick/Guided/Assured가 같은 의미 불변조건을 보존하면서 interaction burden만 다르게 만든다.
- 모든 안정 core Entity가 하나 이상의 사용자 질문과 불변조건에 연결된다.
- Event, Entity state, Projection, Policy의 경계가 예제로 모순 없이 설명된다.
- 형식적 품질 검사를 통과한 쓰레기 입력이 `blind spot 없음`으로 승격되지 않는다.
- Codex, Pi, OpenCode 중 최소 두 runtime에서 같은 cross-runtime scenario를 재현한다.
- 결과 제출, 수락, 통합 중 하나를 생략했을 때 무엇이 손실되는지 실제 사례로 확인한다.
- 사용자가 raw transcript를 다시 읽는 양과 방향 수정 비용이 baseline보다 감소한다.

## 13. 다음 작업

1. 수락된 내용을 v0.2의 짧은 canonical foundation과 상세 rationale로 분리한다.
2. 기존 00–09 문서에서 중복 법칙과 충돌하는 정의를 migration map으로 정리한다.
3. [`Helm Agent & Kernel Architecture v0.2 후보`](../architecture/helm-kernel-v0.2-candidate.md)를 first-party CLI Agent 우선 구조로 유지한다.
4. [`Guided Simulation 001`](../prototypes/agent-v0.2/helm-cli-guided-001.md)의 Kernel baseline 결과를 product-owner 관점에서 검토한다.
5. [`Helm CLI AI Agent Experience`](../experience/helm-cli-agent-v0.2.md)를 thin conversational CLI에서 검증한다.
6. 현재 `experimental.v0` 코어를 stable 후보로 승격하지 말고 검증된 contract를 새 Kernel과 Agent Runtime boundary로 구현한다.
7. Helm CLI live simulation 뒤 Codex/Pi/OpenCode portability simulation에서 interaction burden, semantic correction, resumption quality를 비교한다.
