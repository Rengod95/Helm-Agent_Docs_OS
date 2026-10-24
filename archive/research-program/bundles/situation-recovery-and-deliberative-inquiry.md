# Bundle Synthesis: Situation Recovery × Deliberative Inquiry

> Status: research synthesis v0.1  
> Scope: 첫 Helm paper prototype과 직접 연결되는 10개 Method Card의 공통 메커니즘 및 제품 결론

## 1. 결론

Situation Recovery와 Deliberative Inquiry는 별도 기능이 아니다.

- 상황 복원은 사용자가 과거 진행을 읽는 행위가 아니라 **현재 탐구에 다시 참여할 수 있는 인식 상태를 회복하는 것**이다.
- 숙의적 탐구는 회의실에서 가설을 비교하는 별도 단계가 아니라 **새 Event와 Evidence에 따라 공동 상황 모델을 계속 재구성하는 것**이다.

두 Bundle은 다음 폐루프를 만든다.

```text
Events and outcomes
  → qualified observations and evidence
  → role-specific situation projection
  → human/agent comprehension and projection
  → problem frames and competing hypotheses
  → discriminating experiment or decision
  → commitment and execution
  → new events and outcomes
```

이 루프가 끊어지면 다음 두 실패 중 하나가 발생한다.

- `activity without inquiry`: 에이전트는 계속 실행하지만 왜 하는지와 무엇을 배웠는지 사라짐
- `inquiry without situation`: 가설과 결정이 실제 현재 상태·권한·산출물에서 분리됨

## 2. 10개 방법의 역할

| Method | Helm에 제공하는 핵심 질문 |
|---|---|
| Distributed Cognition | 기억과 판단은 어디에 분산되어 있는가? |
| Situation Awareness | 사용자가 무엇을 보고, 이해하고, 예측해야 하는가? |
| Incident Command / COP | 많은 작업을 어떤 공통 상황과 통제 범위로 묶는가? |
| Structured Handoff / SBAR | 정보와 책임을 어떻게 다음 행위자에게 넘기는가? |
| Requisite Variety | 무엇을 압축하고 무엇을 확대하며 어디에 권한을 분산할 것인가? |
| Pragmatist Inquiry | 불확정 상황을 어떻게 행동 가능한 문제로 구성하는가? |
| Abduction | 새로운 설명 후보는 어떻게 생성하고 잠정 상태로 유지하는가? |
| Competing Hypotheses | 어떤 Evidence가 가설을 실제로 구분하거나 반박하는가? |
| NASA Decision Analysis | 언제 어떤 기준으로 대안을 Commitment로 바꾸는가? |
| Assurance Cases | 결과를 왜 수락해도 되는지 어떻게 정당화하는가? |

## 3. 반복해서 나타난 여덟 메커니즘

### M1. Representation is active

문서와 요약은 현실을 수동적으로 반영하지 않는다. 어떤 정보를 포함·제외·연결하느냐가 사용자의 문제 프레임과 다음 행동을 만든다.

제품 결론:

- ContextProjection은 생성 근거, 누락 정책, 무효화 조건을 가져야 한다.
- 요약 품질은 길이가 아니라 결정 관련 차이의 보존으로 평가한다.

### M2. Surprise initiates inquiry

현재 모델로 설명되지 않는 Observation이 탐구를 촉발한다.

제품 결론:

- `expected_state`와 `observed_state`의 불일치를 Event로 표현한다.
- agent failure뿐 아니라 예상보다 좋은 Outcome과 의미 충돌도 Surprise가 될 수 있다.

### M3. Frame precedes optimization

무엇을 문제로 보느냐가 어떤 해법과 Evidence가 관련되는지 결정한다.

제품 결론:

- initial prompt와 active ProblemFrame을 분리한다.
- 중요한 Reframe은 scope change가 아니라 Normative/Epistemic Event다.

### M4. Alternatives must disagree consequentially

가설의 수보다 다른 예측, 반증 조건, 결과 경로가 중요하다.

제품 결론:

- 표현만 다른 agent output을 중복 Hypothesis로 병합한다.
- Hypothesis에는 prediction과 falsifier가 필요하다.

### M5. Evidence is relational

Evidence는 독립적인 첨부물이 아니라 특정 Claim을 특정 범위에서 지지·도전하는 관계다.

제품 결론:

- Evidence count를 confidence로 직접 변환하지 않는다.
- provenance, independence, diagnosticity, freshness를 보존한다.

### M6. Decision changes the normative baseline

분석 결과와 행동 선택은 다르다. Decision은 누가 어떤 trade-off와 불확실성을 받아들이는지에 대한 Commitment다.

제품 결론:

- Recommendation과 Decision을 상태적으로 분리한다.
- Decision 후 영향을 받는 Contract와 Context를 invalidation/propagation 대상으로 표시한다.

### M7. Handoff transfers responsibility

다음 사람이 상태를 읽는 것과 다음 행동에 대한 책임·권한을 인수하는 것은 다르다.

제품 결론:

- snapshot과 Handoff를 다른 Event로 표현한다.
- Handoff에는 check-back과 unresolved obligation이 필요하다.

### M8. Acceptance is argued, scoped, and revisable

완료는 Boolean이 아니다. 어떤 Claim을 어느 범위에서 어떤 Evidence로 수락했는지와 무엇이 결론을 무효화하는지 필요하다.

제품 결론:

- ClaimingComplete, Accepted, Integrated를 분리한다.
- 위험에 비례한 light/deep assurance를 지원한다.

## 4. 핵심 긴장과 설계 균형

### Compression vs dissent preservation

- ICS, SBAR, requisite variety는 압축을 요구한다.
- ACH, assurance case는 불일치와 반대 증거 보존을 요구한다.

설계 균형:

> 정상 반복은 압축하지만 Decision을 바꿀 수 있는 차이는 별도 객체로 보존한다.

### Autonomy vs active situation awareness

- 분산 실행은 사용자의 직접 감독을 줄여야 한다.
- out-of-the-loop를 피하려면 사용자가 의미 있는 예측과 판단에 참여해야 한다.

설계 균형:

> 실행 관여는 줄이고 프레임·가설·비가역 선택·수락 참여는 유지한다.

### Inquiry depth vs decision latency

- 경쟁 가설과 보증은 품질을 높일 수 있다.
- 모든 선택에 깊은 분석을 요구하면 시스템이 멈춘다.

설계 균형:

> stakes, reversibility, uncertainty, coupling에 따라 탐구와 assurance 깊이를 조절한다.

### Shared representation vs role relevance

- 공동 상황도가 필요하다.
- 모든 행위자에게 동일한 화면은 context flooding을 만든다.

설계 균형:

> 정본 graph는 공유하되 projection은 역할·Concern·시점별로 다르게 생성한다.

## 5. 첫 prototype의 최소 의미 객체

10개 카드를 함께 적용해도 첫 pilot에 전체 ontology가 필요하지 않다. 다음 12개 객체면 충분하다.

```text
Purpose
Concern
Observation
ProblemFrame
Hypothesis
Evidence
Claim
Decision
Commitment
WorkUnit
Outcome
ContextProjection
```

다음 객체는 pilot에서 필요성이 관찰될 때 승격한다.

- Argument
- Counterargument
- Surprise
- Workstream
- Handoff
- AuthorityEnvelope
- Integration
- Reflection

이는 Foundations의 객체를 부정하지 않는다. 안정 schema를 경험적 사용 순서에 맞춰 좁히는 것이다.

## 6. 후보 Event vocabulary

아래는 구현 계약이 아니라 paper artifact를 일관되게 관찰하기 위한 후보 어휘다.

```text
purpose.confirmed
concern.opened
observation.captured
surprise.detected
frame.proposed
frame.selected
frame.reopened
hypothesis.proposed
hypothesis.strengthened
hypothesis.weakened
evidence.captured
evidence.qualified
evidence.invalidated
decision.opened
decision.committed
decision.reopened
commitment.offered
commitment.accepted
work.started
work.claimed_complete
work.accepted
outcome.observed
context.materialized
handoff.acknowledged
```

첫 dogfood에서는 Event 이름보다 다음 필드를 우선 기록한다.

- actor
- time
- subject
- type of change: Normative/Epistemic/Material
- source/provenance
- authority basis
- affected entities
- invalidation consequence

## 7. Paper prototype field justification

### Return Brief

- `What changed`: Situation Awareness Level 1, Event perception
- `What it means`: Level 2, pragmatist situation reconstruction
- `What happens next`: Level 3 projection, automation surprise prevention
- `Open gates`: requisite variety amplification
- `Active commitments`: ICS objective/ownership, handoff continuity
- `Provenance and omissions`: distributed cognition, Evidence traceability

### Inquiry Map

- `Competing frames`: Dewey problem constitution
- `Hypothesis set`: abduction
- `Counterevidence`: ACH
- `Discriminating experiments`: abduction economy + decision information value
- `Stop rule`: inquiry/decision latency balance

### Decision Gate

- `Why now`: attention and operational timing
- `Criteria and options`: NASA Decision Analysis
- `Strongest counterevidence`: ACH and HRO-style reluctance to simplify
- `Experiment/defer`: value of information and reversibility
- `Commitment`: speech-act bridge to Bundle C
- `Reopen trigger`: evidence temporality and assurance defeaters

### Delegation Contract

Bundle A/B만으로도 Purpose, Evidence obligation, check-back, Outcome이 필요하다. Authority의 깊은 설계는 Bundle C에서 추가 검증한다.

## 8. Bundle-level hypotheses

### AB-H1 — Recovery enables inquiry

change–meaning–projection Brief를 받은 사용자는 status list를 받은 사용자보다 다음 탐구 행동을 더 정확히 선택할 것이다.

### AB-H2 — Inquiry improves compression

현재 ProblemFrame과 competing Hypothesis를 아는 projection은 빈도 기반 요약보다 결정 관련 Event를 더 잘 보존할 것이다.

### AB-H3 — Decision closes but does not erase inquiry

Decision에 Counterevidence와 reopen trigger를 연결하면 실행 속도를 유지하면서 stale Decision 재사용이 감소할 것이다.

### AB-H4 — Structured handoff preserves epistemic state

Handoff가 active Hypothesis, Evidence gaps, unresolved obligation을 포함하면 단순 task handoff보다 중복 조사와 frame drift가 감소할 것이다.

### AB-H5 — Tailoring is essential

위험 적응적으로 필드·분석 깊이를 조절한 Helm 조건이 모든 작업에 전체 구조를 요구하는 조건보다 workload 대비 품질이 높을 것이다.

## 9. 첫 dogfood에서 관찰할 결정적 사건

1. 사용자가 Return Brief를 읽고 원래 없던 질문을 제기하는가?
2. 사용자가 제안된 ProblemFrame을 수정하거나 거부하는가?
3. 두 Hypothesis를 구분하기 위해 추가 실험을 선택하는가?
4. Counterevidence 때문에 Recommendation 또는 Criterion이 바뀌는가?
5. Decision 이후 어떤 Context와 Commitment가 함께 바뀌어야 하는지 발견하는가?
6. 완료 주장과 수락 사이에서 새로운 결함이 드러나는가?
7. 어떤 필드가 반복적으로 읽히지 않거나 판단에 사용되지 않는가?

이 사건이 없다면 풍부한 문서 구조가 실제 공동행위를 만들지 못하고 있을 가능성이 크다.

## 10. 아직 결정하지 말아야 할 것

pilot 전에는 다음을 안정 제품 계약으로 정하지 않는다.

- 모든 Entity의 최종 schema
- Event Store 기술
- graph database 사용 여부
- Gate scoring 공식과 weight
- fixed span-of-control number
- 자동 confidence score
- agent별 persona 또는 역할 UI
- SaaS 조직 모델
- 모든 WorkUnit에 요구할 assurance depth

## 11. Traceability

### Method Cards

- [Distributed Cognition](../method-cards/distributed-cognition.md)
- [Situation Awareness](../method-cards/situation-awareness.md)
- [Incident Command and COP](../method-cards/incident-command-common-operating-picture.md)
- [Structured Handoff and SBAR](../method-cards/structured-handoff-sbar.md)
- [Requisite Variety](../method-cards/requisite-variety.md)
- [Pragmatist Inquiry](../method-cards/pragmatist-inquiry.md)
- [Abductive Reasoning](../method-cards/abductive-reasoning.md)
- [Competing Hypotheses](../method-cards/competing-hypotheses.md)
- [NASA Decision Analysis](../method-cards/nasa-decision-analysis.md)
- [Assurance Cases](../method-cards/assurance-cases.md)

### Product artifacts

- [Helm Foundations](../../foundations/README.md)
- [Paper Prototype v0](../../prototypes/paper-v0/README.md)
- [Evaluation Protocol](../../prototypes/paper-v0/experiment-protocol.md)

