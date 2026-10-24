# Helm Operating Theory

> Working name: **Steered Co-agency — 지향적 공동행위론**  
> Status: grand synthesis v0.1  
> Purpose: 철학, 인지, 통치, 상호작용, 시스템 아키텍처를 하나의 제품 운영 이론으로 연결

## 1. 중심 명제

Helm은 agent task manager가 아니다.

> **Helm은 제한된 인간 주의력 아래에서 인간·에이전트·도구가 공동 목적을 향해 지식, 약속, 실행, 결과를 계속 정렬하도록 만드는 지향적 공동행위 시스템이다.**

일반적인 harness가 “프롬프트에서 결과까지의 자율 실행”을 최적화한다면 Helm은 다음을 최적화한다.

```text
justified progress under bounded human attention
```

여기서 justified progress는 다음 네 조건을 동시에 요구한다.

1. 실제 세계 또는 Artifact가 가치 있는 방향으로 변했다.
2. 그 변화가 목적에 부합한다고 믿을 충분한 Evidence가 있다.
3. 누가 어떤 trade-off와 책임을 수락했는지 명확하다.
4. 지역 변화가 전체 시스템과 통합되고 다음 변화에 대응할 능력이 남아 있다.

## 2. 철학적 입장

### 2.1 실체보다 관계와 전이

Helm의 핵심 객체는 고립된 Task, File, Agent가 아니다. 이들이 Purpose, Evidence, Authority, Commitment, Outcome과 맺는 관계와 시간에 따른 전이가 핵심이다.

```text
Task identity alone does not explain work.
Work = authorized transformation of a shared situation.
```

### 2.2 표상보다 실천

문서와 모델의 가치는 현실을 완벽히 복제하는 데 있지 않다. 다음으로 정당한 행동과 판단을 가능하게 하는 데 있다.

Context는 세계의 복사본이 아니라 특정 Actor가 특정 Concern에서 올바르게 참여할 수 있게 하는 시점별 projection이다.

### 2.3 기술보다 실천적 지혜

에이전트는 탐색, 생성, 반복 실행, 분석에서 강할 수 있다. 그러나 어떤 목적과 위험을 받아들일지, 구체적 상황에서 무엇이 가치 있는지, 언제 충분히 탐구했고 행동해야 하는지는 실천적 판단을 요구한다.

Helm은 인간에게 에이전트가 못 하는 잔여 작업을 남기지 않는다. 인간이 실천적 지혜와 저자성을 행사할 **고레버리지 순간**을 설계한다.

### 2.4 독립성보다 공동행위

인간과 agent의 성능을 따로 최적화해서는 전체 성과를 설명할 수 없다. 한쪽의 행동이 다른 쪽의 가능성과 이해를 바꾸기 때문이다.

Helm의 분석 단위:

```text
Human + Agents + Tools + Shared representations + Policies + Environment
```

### 2.5 확실성보다 반증 가능한 정당화

Claim, Hypothesis, Decision은 영구 진실이 아니다. 출처, 범위, 불확실성, Counterevidence, reopen trigger를 가진다. 좋은 시스템은 확실해 보이는 결론보다 어떤 조건에서 결론이 바뀌어야 하는지 안다.

## 3. 다섯 상태 공간

시간 `t`의 Workspace 상태는 다음처럼 표현한다.

```text
W(t) = <N(t), E(t), M(t), A(t), P(t)>
```

### N — Normative

무엇을 해야 하고 누가 무엇을 수락했는가.

- Purpose
- Principle and Constraint
- Authority and Responsibility
- Decision
- Commitment
- AcceptanceCriterion

### E — Epistemic

무엇이 문제이고 무엇을 안다고 믿는가.

- SituationModel
- Observation
- ProblemFrame
- Hypothesis
- Claim
- Evidence and Counterevidence
- Assumption and Uncertainty

### M — Material

실제로 무엇이 존재하고 변했는가.

- Artifact
- Code and Document
- Test and Deployment
- ExecutionTrace
- ExternalState
- Outcome

### A — Actors and interdependence

누가 어떤 능력·역할·의존성을 가지는가.

- HumanActor
- AgentActor
- ToolActor
- CollectiveActor
- competence and dependency relations

### P — Policies

어떤 상태 전이와 권한·에스컬레이션이 허용되는가.

- Authority policy
- Gate policy
- Evidence burden
- Context routing
- Invalidation and recovery rules

Helm은 `M`의 task progress만 관리하지 않는다. `N–E–M`의 정렬, `A`의 공동행위, `P`의 적응을 관리한다.

## 4. Helm의 네 운영 루프

### Loop O — Orientation

목표: 행위자가 현재 상황에 다시 참여할 수 있는 인식 상태를 만든다.

```text
Events → Situation projection → Perception → Comprehension → Projection
```

핵심 primitive:

- CommonOperatingPicture
- ReturnBrief
- ContextProjection
- Handoff
- WeakSignal

핵심 질문:

- 무엇이 변했는가?
- 왜 중요한가?
- 개입하지 않으면 무엇이 일어나는가?
- 누가 무엇을 맡고 있는가?

주요 연구 근거: [Situation Recovery synthesis](../research/bundles/situation-recovery-and-deliberative-inquiry.md)

### Loop I — Inquiry

목표: 불확정 상황을 행동 가능한 문제와 정당화된 선택으로 변환한다.

```text
Surprise → Problem frames → Hypotheses → Evidence
         → Discriminating experiment → Deliberation → Decision
```

핵심 primitive:

- Concern
- ProblemFrame
- HypothesisSet
- Evidence
- Claim
- Experiment
- DecisionGate

핵심 질문:

- 우리는 무엇을 문제로 보고 있는가?
- 어떤 합리적 대안 설명이 있는가?
- 어느 Evidence가 가설을 실제로 구분하는가?
- 추가 정보와 지금 행동 중 어느 쪽 가치가 큰가?

### Loop C — Commitment

목표: 선택을 유효한 약속과 제한된 자율 실행으로 변환한다.

```text
Decision → Request → Negotiation → Commitment
         → Authority Envelope → Interdependent execution → Exception/repair
```

핵심 primitive:

- Request
- DelegationContract
- Commitment
- AuthorityEnvelope
- WorkUnit
- Exception
- EscalationTrigger

핵심 질문:

- 누가 무엇을 왜 맡았는가?
- 무엇을 스스로 결정할 수 있는가?
- 완료는 어떤 Evidence로 주장해야 하는가?
- 어떤 조건에서 방향을 바꾸거나 상향해야 하는가?

주요 연구 근거: [Delegated Action synthesis](../research/bundles/delegated-action-and-integration.md)

### Loop A — Assurance and Adaptation

목표: 지역 결과를 책임 있게 수락·통합하고 다음 변화에 대응할 능력을 높인다.

```text
Completion Claim → Evidence/Argument → Acceptance
                 → Integration → Outcome → Monitor/Learn/Anticipate
                 → Reopen or policy update
```

핵심 primitive:

- ClaimingComplete
- AssuranceView
- Acceptance
- Interface
- Integration
- RecoveryPath
- Reflection

핵심 질문:

- 왜 이 결과를 받아들여도 되는가?
- 명세대로 만들었는가와 올바른 것을 만들었는가를 모두 확인했는가?
- 다른 작업의 전제와 기준선을 깨뜨렸는가?
- 환경이 바뀌면 어떻게 복구하고 결정을 다시 열 것인가?

## 5. 네 루프의 결합

네 루프는 순차 pipeline이 아니다.

```text
                   ┌───────────────┐
              ┌───→│ O: Orientation│───┐
              │    └───────────────┘   │
              │                         ↓
        Outcome/Event             ┌────────────┐
              ↑                   │ I: Inquiry │
              │                   └────────────┘
              │                         ↓
     ┌───────────────────┐      ┌───────────────┐
     │ A: Assurance &    │←─────│ C: Commitment │
     │    Adaptation     │      └───────────────┘
     └───────────────────┘
```

상호 재진입 예:

- Orientation에서 새 Surprise를 발견하면 Inquiry가 열린다.
- Inquiry가 Purpose 충돌을 발견하면 Normative baseline을 다시 연다.
- Commitment 수행 중 Authority 밖의 문제가 나타나면 Inquiry 또는 Decision Gate로 돌아간다.
- Assurance에서 Evidence가 부족하면 새 Experiment WorkUnit을 만든다.
- Integration이 shared Assumption 충돌을 발견하면 관련 Decision과 Context를 invalidate한다.
- Reflection이 Gate policy와 Authority Envelope의 미래 기본값을 바꾼다.

## 6. 작업의 실제 최소 단위

Helm에서 일의 최소 단위는 Task가 아니라 **Concern을 중심으로 한 공동행위 episode**다.

```text
Disturbance or aspiration
  → Concern opened
  → Situation oriented
  → Problem framed
  → Hypotheses investigated
  → Decision committed
  → Work delegated
  → Outcome claimed
  → Result accepted
  → System integrated
  → Practice reflected
```

Task는 episode 안의 실행 수단이다. 하나의 Concern은 여러 WorkUnit을 만들 수 있고, 하나의 WorkUnit은 여러 Concern에 영향을 줄 수 있다.

## 7. 인간과 에이전트의 규범적 비대칭

### 인간의 중심 역할

- Purpose와 가치 정당화
- ProblemFrame contestation
- 중요한 Criterion 선택
- 비가역적·규범적 trade-off 수락
- 책임 있는 Commitment와 Acceptance
- 전체 결과의 사회적·조직적 의미 판단

### 에이전트의 중심 역할

- 넓은 탐색과 Hypothesis 생성
- Evidence 수집·정리·비교
- bounded WorkUnit 실행
- test, simulation, draft, analysis 생성
- Conflict, Exception, Counterevidence 탐지
- ContextProjection과 Decision 초안 생성

### 정책과 도구의 역할

- 반복 Decision의 안전한 자동화
- permission과 resource boundary 집행
- Event와 Evidence의 신뢰 가능한 생성
- 정상 범위의 압축과 예외 신호

이 분담은 능력의 영구 경계가 아니다. 에이전트 능력이 변해도 누가 Purpose와 위험을 수락했는지의 책임 구조는 명시적으로 남는다.

## 8. 인간 개입의 계산 원리

Helm은 개입 횟수를 최대화하거나 최소화하지 않는다. 인간 입력의 기대 가치가 attention cost보다 클 때 개입한다.

```text
Deliberation pressure increases with:
  normative conflict
  + stakes
  + irreversibility
  + uncertainty reducible by human judgment
  + cross-system coupling
  + meaningful dissent
  + low recoverability

Deliberation pressure decreases with:
  clear policy coverage
  + reversibility
  + observability
  + testability
  + proven local competence
```

이는 안정 수식이 아니라 설명 가능한 Gate rationale이다. 실제 weight는 pilot 전 확정하지 않는다.

### 개입해야 하는 순간

- Purpose와 가치가 충돌함
- ProblemFrame에 따라 전체 경로가 갈림
- 핵심 가설을 구분할 실험을 선택함
- 비가역적 외부 행동 직전
- Authority Envelope를 초과함
- 중요한 dissent 또는 weak signal이 존재함
- Completion Claim을 수락함
- 지역 결과를 전체 baseline에 통합함

### 개입하지 말아야 하는 순간

- 되돌리기 쉽고 자동 검증 가능한 local choice
- 정책이 명확히 다루는 반복 행동
- 실질적 선택이 없는 진행 확인
- agent가 스스로 해결할 수 있는 정보 부족
- 사용자의 답이 결과를 바꾸지 않는 approval theater

## 9. 공동행위 품질의 네 기준

모든 WorkUnit와 interface는 다음을 평가한다.

### Observability

다음 판단에 필요한 상태, 의도, Evidence, Exception을 볼 수 있는가?

### Predictability

다음 행동과 조건, 예상 Outcome을 충분히 예상할 수 있는가?

### Directability

낮은 비용으로 Purpose, Constraint, Criterion, priority를 바꿀 수 있는가?

### Contestability

ProblemFrame, Claim, Recommendation, Decision에 이의를 제기하고 Evidence를 다시 열 수 있는가?

OPD+C는 persona, 채팅 자연스러움, agent 독립 실행률보다 우선하는 공동행위 평가 기준이다.

## 10. 좋은 “일하는 경험”의 구조

Helm의 즐거움은 생산성 게임화가 아니라 다음 경험에서 나온다.

### Orientation pleasure

복잡하고 흩어진 상황이 이해 가능한 형태로 정리되는 만족감.

### Inquiry pleasure

그럴듯한 가설들이 Evidence에 의해 강화·반박되는 탐구의 긴장.

### Leverage

사용자의 한 번의 좋은 질문과 Criterion 변경이 여러 agent의 방향을 바꾸는 감각.

### Craft and authorship

완성품을 단순 승인하는 것이 아니라 목적, 형상, trade-off를 공동으로 만든다는 감각.

### Closure

지역 결과가 전체에 통합되고 남은 위험과 다음 상태가 명확해지는 완결감.

### Growing competence

반복할수록 사용자의 도메인 이해, 위임 방식, 판단 policy가 실제로 개선되는 감각.

기본 리듬:

```text
Orient → Frame together → Delegate → Autonomous interval
       → Meaningful checkpoint → Decide/redirect
       → Accept → Integrate → Reflect
```

## 11. 아키텍처의 필연적 도출

운영 이론에서 다음 기술 계층이 도출된다.

### 11.1 Event Ledger

왜 필요한가:

- 상태 덮어쓰기보다 시간적 전이와 책임을 보존
- Decision, Commitment, Evidence의 provenance 제공
- projection 재생성과 invalidation 지원

### 11.2 Normative Graph

왜 필요한가:

- Purpose, Authority, Decision, Commitment, Acceptance 연결
- agent가 어느 기준선과 권한으로 행동했는지 추적

### 11.3 Epistemic Graph

왜 필요한가:

- ProblemFrame, Hypothesis, Claim, Evidence, Counterevidence 연결
- 요약에서 사라지는 불확실성과 dissent 보존

### 11.4 Material and Interface Graph

왜 필요한가:

- Artifact, run, test, deployment, external state와 실제 Outcome 추적
- local completion과 system integration 구분

### 11.5 Projection Runtime

왜 필요한가:

- 같은 정본 상태에서 역할·Concern·시점별 Context 생성
- Return Brief, Common Operating Picture, Inquiry Map, Assurance View 제공

### 11.6 Attention and Governance Engine

왜 필요한가:

- Authority 검증
- normal variation 감쇠와 consequential difference 증폭
- Gate 병합·우선순위·attention budget 관리
- Decision reopen과 Evidence invalidation 감시

### 11.7 Agent and Tool Adapters

왜 필요한가:

- 특정 모델의 session 구조를 product ontology와 분리
- DelegationContract를 실행 지시와 permission으로 변환
- run 결과를 Claim과 Evidence로 수집

## 12. 제품 성숙도 모델

### Level 0 — Passive Docs Scaffold

- 문서 라우팅과 checkpoint
- 현재 Docs-Agent OS
- 가치: context continuity
- 한계: semantic state와 interaction loop 부재

### Level 1 — Situation Recovery

- Event capture
- Return Brief
- role-specific ContextProjection
- 가치: 시간 간격 이후 orientation

### Level 2 — Deliberative Inquiry

- ProblemFrame, Hypothesis, Evidence, Decision Gate
- 가치: 조기 수렴 감소와 근거 있는 사용자 판단

### Level 3 — Bounded Delegation

- Commitment, DelegationContract, AuthorityEnvelope, Exception
- 가치: 목적 일관성과 자율 실행의 결합

### Level 4 — Assured Integration

- Claim–Evidence acceptance, semantic interface, Integration state
- 가치: local completion을 전체 결과로 변환

### Level 5 — Adaptive Institution

- Reflection, policy revision, cross-workspace learning, organizational memory
- 가치: 작업할수록 공동 시스템 자체가 개선

각 Level은 앞 Level의 사용자 가치를 검증한 뒤 진행한다. 기술 기반을 먼저 완성했다고 상위 성숙도가 달성되는 것은 아니다.

## 13. 첫 제품 경계

첫 실제 제품은 Level 1과 Level 2에 집중한다.

### MUST

- 기존 agent workflow의 read-only Event 수집 또는 수동 입력
- Return Brief
- ContextProjection with provenance/freshness
- Inquiry Map
- Decision Gate
- 최소 Decision/Evidence/Commitment log

### SHOULD

- paper prototype에서 검증된 필드만 자동 생성
- 사용자가 Frame, Criterion, Recommendation을 수정 가능
- 중요 source까지 drill-down
- Gate impact feedback

### NOT YET

- 전체 조직 governance
- 자동 권한 확대
- formal assurance case everywhere
- graph database dependency
- 모든 agent tool 통합
- fully autonomous orchestration

## 14. OSS와 SaaS의 철학적 경계

### OSS kernel

개인이 자신의 작업 현실과 결정 기록을 소유하고 검토할 수 있어야 한다.

- local-first Event and Entity model
- human-readable export
- adapter protocol
- Return Brief, Inquiry, Decision의 핵심 가치
- offline and tool-independent operation

### SaaS

복수 사람과 workspace 사이의 공동 상황, 권한, 조직 기억에서 가치가 커진다.

- team Common Operating Picture
- shared Decision and Gate
- organizational policy and expertise routing
- long-term Evidence/Decision graph
- audit, analytics, cross-project learning

SaaS는 개인의 핵심 판단 도구를 인질로 삼지 않고 협업의 복잡성을 해결해야 한다.

## 15. Harness와 Helm의 차이

| 질문 | Harness | Helm |
|---|---|---|
| 최적화 대상 | prompt-to-result completion | justified progress under attention |
| 기본 단위 | task/run | Concern episode and Commitment |
| 인간 역할 | requester/reviewer/exception handler | normative author and co-inquirer |
| agent 역할 | autonomous executor | bounded epistemic/material actor |
| context | model input | role-specific projection of shared state |
| progress | activity/completion | alignment, uncertainty reduction, integration |
| decision | internal reasoning or approval | explicit normative baseline transition |
| completion | agent result/test pass | Claim → Acceptance → Integration |
| memory | conversation/run history | valid Decisions, Evidence, Commitments, Outcomes |
| failure | task error | breakdown of inquiry, authority, coordination, assurance |

Helm은 harness를 대체하지 않는다. Harness를 실행 substrate로 사용하면서 그 위에 공동행위와 인간 판단의 control plane을 제공한다.

## 16. 원론의 열두 법칙

1. Purpose 없는 WorkUnit은 실행하지 않는다.
2. Initial prompt를 완성된 ProblemFrame으로 취급하지 않는다.
3. Observation, Inference, Hypothesis, Decision을 혼합하지 않는다.
4. 병렬성은 같은 답의 복제보다 경쟁 가설과 전문 관점에 먼저 사용한다.
5. Request, Commitment, Completion Claim, Acceptance를 구분한다.
6. 자율성은 agent 속성이 아니라 WorkUnit의 Authority Envelope다.
7. Decision은 가능한 가장 낮은 유능한 수준에 두고 상향 이유를 설명한다.
8. 정상 반복은 압축하고 Decision을 바꿀 수 있는 차이는 보존한다.
9. 중요한 단계 경계에서만 공동 pause를 만든다.
10. 수락은 Evidence, 한계, reopen trigger를 가진다.
11. local completion은 system Integration 전까지 닫히지 않는다.
12. Reflection은 다음 Context, Contract, Policy를 실제로 바꿔야 한다.

## 17. 반증 조건

이 운영 이론은 다음이 반복되면 수정하거나 폐기해야 한다.

- Return Brief가 원본 로그 재독을 줄이지 못함
- Inquiry Map이 조기 수렴이나 결과 결함을 줄이지 못함
- Decision Gate가 대부분 approval theater로 끝남
- DelegationContract의 비용이 방향 이탈·재작업 감소보다 큼
- OPD+C가 teamwork failure를 예측하지 못함
- Claim/Acceptance/Integration 분리가 실제 숨은 작업을 드러내지 못함
- 사용자 참여가 품질·저자성 증가 없이 workload만 높임
- structured docs baseline과 반복적으로 차이가 없음
- facilitator 도움을 제거하면 효과가 사라짐

## 18. 현재 가장 중요한 다음 Evidence

더 많은 Entity를 설계하는 것이 아니다. 다음 사건을 실제 사용에서 관찰하는 것이다.

1. Return Brief가 사용자의 상황 모델을 실제로 복원하는가?
2. 사용자가 ProblemFrame이나 Criterion을 의미 있게 바꾸는가?
3. Counterevidence 때문에 Recommendation 또는 Decision이 바뀌는가?
4. DelegationContract가 실제 scope/authority 오해를 예방하는가?
5. Completion Claim과 Acceptance 사이에서 새로운 결함이 드러나는가?
6. Acceptance와 Integration 분리가 미해결 obligation을 발견하는가?
7. 사용자가 이 방식으로 다시 일하고 싶어 하는가?

이 Evidence가 다음 안정 schema와 코드 아키텍처의 정당한 출발점이다.

