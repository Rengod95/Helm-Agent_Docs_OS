# Ontology: Helm에서 무엇이 존재하는가

## 1. 존재론적 선택

Helm은 파일, 채팅, 태스크를 세계의 기본 단위로 보지 않는다.

- 파일은 상태를 표현하는 매체다.
- 채팅은 행위가 발생하는 채널이다.
- 태스크는 더 큰 목적과 약속을 수행하기 위한 한시적 단위다.

Helm의 기본 단위는 **행위자, 상태, 주장, 약속, 변화, 관계**다.

## 2. 세 세계 모델

시간 `t`의 프로젝트 상태 `W(t)`를 다음 세 부분으로 본다.

```text
W(t) = <N(t), E(t), M(t)>
```

### N — Normative world

무엇을 해야 하고, 무엇이 허용되며, 무엇을 받아들이기로 했는가에 관한 세계다.

- Purpose
- Principle
- Policy
- Constraint
- Authority
- Responsibility
- Commitment
- Decision
- AcceptanceCriterion

### E — Epistemic world

무엇이 문제이며 무엇을 안다고 믿는가에 관한 세계다.

- SituationModel
- ProblemFrame
- Question
- Hypothesis
- Claim
- Evidence
- Counterevidence
- Assumption
- Uncertainty
- ConfidenceAssessment

### M — Material world

실제로 무엇이 존재하고 어떤 변화가 일어났는가에 관한 세계다.

- Artifact
- CodeChange
- Document
- Design
- TestResult
- Deployment
- ExternalState
- ExecutionTrace

작업의 완료는 세 세계의 정렬을 요구한다. 물질적 변경이 존재해도 그것이 목적에 부합한다는 정당한 믿음과 규범적 수락이 없다면 완료가 아니다.

## 3. 행위자

### HumanActor

가치, 목적, 책임, 수락의 최종 주체가 될 수 있다. 한 인간이 모든 결정을 직접 해야 한다는 뜻은 아니며, 팀·조직·정책에 권한을 위임할 수 있다.

### AgentActor

모델과 도구를 이용하여 탐색, 추론, 제안, 실행, 검증을 수행한다. AgentActor의 운영적 약속은 시스템이 추적할 수 있지만 법적·도덕적 책임의 최종 주체로 간주하지 않는다.

### ToolActor

CI, Git, 배포 시스템, 정적 분석기처럼 규칙에 따라 사건과 증거를 생성한다. 목적을 스스로 정하지 않으며 권한이 부여된 호출을 실행한다.

### CollectiveActor

팀, 위원회, 정책 엔진처럼 복수 행위자를 하나의 결정 주체로 표현한다. CollectiveActor는 구성원, 의사결정 규칙, 정족수 또는 위임 정책을 명시해야 한다.

## 4. 핵심 엔터티

### Concern

주의와 행위가 필요한 가장 일반적인 관심 단위다. Feature보다 넓으며 장애, 연구 질문, 정책 변화, 통합 위험도 Concern이 될 수 있다.

필수 속성:

- `id`
- `title`
- `why_it_matters`
- `owner`
- `status`
- `related_purposes`

### Purpose

추구하는 가치 있는 미래 상태다. 단순 목표 문구가 아니라 성공 기준, 비목표, 보존해야 할 가치, 종료 또는 재검토 조건을 가진다.

### SituationModel

현재 상태에 대한 시점별 모델이다. 사실 그 자체가 아니라 증거를 바탕으로 구성한 해석이므로 출처와 불확실성을 가진다.

### ProblemFrame

현재 상황과 목적 사이에서 해결할 가치가 있다고 선택한 긴장을 정의한다. 동일한 Situation에서도 여러 ProblemFrame이 경쟁할 수 있다.

### Hypothesis

문제의 원인, 가능한 미래, 해결책 효과에 대한 반증 가능한 설명이다.

### Claim

참으로 받아들이기를 제안하는 명시적 진술이다. Claim은 Evidence와 Argument를 통해 지지되고 Counterevidence로 도전받는다.

### Evidence

Claim의 신뢰도를 바꿀 수 있는 관찰 또는 산출물이다. Evidence는 출처, 획득 방법, 시점, 범위, 품질, 관련 Claim을 가진다.

### Decision

대안들 중 하나를 선택하여 이후 행위의 규범적 기준선을 변경하는 사건과 그 결과다. Decision은 선택되지 않은 대안, 기준, 근거, 불확실성, 파급 효과, 재검토 조건을 보존한다.

### Commitment

행위자가 미래의 조건을 만족시키겠다고 운영적으로 맡은 약속이다. 요청이나 계획과 다르며, 약속 주체·수혜자·만족 조건·기한·철회 규칙을 가진다.

### DelegationContract

하나 이상의 Commitment를 권한과 제약에 연결하는 위임 계약이다.

```text
DelegationContract = {
  requester,
  performer,
  purpose,
  conditions_of_satisfaction,
  authority_envelope,
  evidence_obligations,
  escalation_triggers,
  acceptor,
  integration_target
}
```

### WorkUnit

DelegationContract를 수행하기 위한 일시적 실행 단위다. Task와 달리 협상, 위임, 완료 주장, 수락, 통합 상태를 구분한다.

### Event

누가 언제 무엇을 어떤 근거와 권한으로 변경했는지를 기록하는 불변 사실이다. 현재 상태는 Event의 투영이며, 과거 Event를 조용히 덮어쓰지 않는다.

### Outcome

실행 이후 관찰된 실제 변화다. 의도한 산출물뿐 아니라 예상하지 못한 영향과 학습을 포함한다.

### ContextProjection

특정 행위자가 특정 Concern에 관해 다음으로 유효한 행동을 하기 위해 필요한 상태의 시점별 투영이다.

```text
Context(actor, concern, t) = project(W(t), actor, concern)
```

ContextProjection은 정본이 아니며 원본 Entity와 Event로 역추적할 수 있어야 한다.

### Integration

지역적 Outcome을 더 넓은 목적, 결정 기준선, 산출물 그래프에 정합시키는 과정과 그 결과다.

### Reflection

경험을 통해 ProblemFrame, 정책, 자율성 범위, 완료 기준, 컨텍스트 라우팅 규칙을 변경하는 학습 사건이다.

## 5. 핵심 관계

```text
Purpose      --frames-->            Concern
Concern      --is_interpreted_as--> ProblemFrame
ProblemFrame --generates-->         Hypothesis
Hypothesis   --predicts-->          Claim
Evidence     --supports/challenges-> Claim
Claim        --informs-->           Decision
Decision     --authorizes-->        DelegationContract
Actor        --undertakes-->        Commitment
Commitment   --is_executed_by-->    WorkUnit
WorkUnit     --changes-->            Artifact
Outcome      --satisfies/fails-->    Commitment
Integration  --aligns-->             Outcome + Purpose + System
Reflection   --revises-->            Frame/Policy/Model
```

관계는 단순 링크가 아니라 종류, 생성자, 시점, 근거를 가져야 한다.

## 6. 동일성과 시간

Helm의 객체는 이름이나 파일 경로로만 식별되지 않는다.

- 모든 장기 객체는 안정적인 ID를 가진다.
- 제목, 경로, 설명이 바뀌어도 동일 객체로 추적할 수 있다.
- 과거 상태는 수정하지 않고 후속 Event로 대체 또는 무효화한다.
- `supersedes`, `invalidates`, `reopens`, `derived_from` 관계를 명시한다.
- 삭제는 기본적으로 의미적 폐기이며 감사와 학습에 필요한 이력은 보존한다.

## 7. Context와 Memory

Raw conversation은 증거 또는 출처가 될 수 있지만 그 자체가 장기 기억은 아니다.

Helm의 장기 기억은 다음을 중심으로 구성한다.

- 수락된 Purpose와 Decision
- 현재 유효한 Constraint와 Policy
- 근거가 연결된 Claim
- 기각되거나 대체된 Hypothesis와 그 이유
- 이행 중인 Commitment
- 검증된 Outcome과 실패
- 재검토 조건과 무효화 사건

대화와 실행 로그는 이 의미 객체를 생성하는 원자료이며, 의미 객체를 대신하지 않는다.

## 8. 존재론적 불변조건

1. WorkUnit은 최소 하나의 Purpose 또는 Concern과 연결되어야 한다.
2. Decision은 선택자, 대안, 근거, 시점, 재검토 조건을 가져야 한다.
3. Claim은 Observation, Inference, Hypothesis 중 자신의 인식적 종류를 밝혀야 한다.
4. Evidence는 출처와 획득 시점이 없는 경우 검증 증거로 승격될 수 없다.
5. Commitment는 책임 주체와 만족 조건이 없으면 생성될 수 없다.
6. Outcome은 의도와 분리하여 실제 관찰된 결과를 기록해야 한다.
7. ContextProjection은 정본 Entity와 Event로 역추적 가능해야 한다.
8. Feature, 파일 경로, 에이전트 세션은 핵심 객체의 정체성을 결정하지 않는다.

