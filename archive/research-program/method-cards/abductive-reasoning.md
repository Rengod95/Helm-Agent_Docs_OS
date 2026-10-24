# Method Card: Abductive Reasoning

- Domain: logic of discovery, scientific inquiry
- Evidence status: foundational philosophical account; Helm generation protocol exploratory
- Primary Helm bundle: Deliberative Inquiry
- Candidate primitives: `Hypothesis`, `SurprisingObservation`, `Falsifier`, `Experiment`

## 1. Original problem

Deduction은 전제로부터 필연적 결론을 도출하고 induction은 관찰에서 일반화를 형성한다. 그러나 새로운 설명 후보가 어디서 오는지는 별도의 발견 과정이 필요하다.

Peirce의 abduction은 놀라운 관찰이 있을 때 그것을 설명할 수 있는 잠정적 가설을 채택해 조사할 가치가 있는 후보로 만드는 추론이다. Abduction은 결론을 증명하지 않으며 탐구할 해석을 생성한다.

## 2. Environmental assumptions

- 현재 모델로 예상하지 못한 관찰이 존재한다.
- 여러 설명이 같은 관찰과 양립할 수 있다.
- 모든 가설을 시험할 자원은 없다.
- 좋은 가설은 설명력뿐 아니라 검증 가능성과 탐구 경제성을 가진다.
- 발견과 정당화는 다른 단계다.

## 3. Domain-invariant mechanisms

### Surprise detection

현재 SituationModel의 예측과 관찰 사이의 차이가 탐구를 촉발한다.

### Explanatory generation

가설은 관찰을 설명하는 가능한 모델로 생성된다.

### Provisional adoption

가설은 참으로 수락되는 것이 아니라 조사할 가치가 있다고 임시 채택된다.

### Economy of inquiry

검증 비용, 구분력, 후속 결과를 고려하여 어떤 가설을 먼저 시험할지 선택한다.

## 4. Helm problem explained

에이전트는 그럴듯한 단일 설명을 빠르게 생성하고 자연어 유창성 때문에 높은 확신처럼 보이게 할 수 있다. 병렬 에이전트도 같은 모델과 context를 공유하면 서로 비슷한 설명을 독립적 합의처럼 반복할 수 있다.

Helm은 explanation generation과 evidence-based acceptance를 상태적으로 분리해야 한다.

## 5. Transfer to Helm

| Abductive mechanism | Helm primitive |
|---|---|
| Surprising observation | `Observation` + expected-state mismatch |
| Candidate explanation | `Hypothesis` |
| Investigation worthiness | expected information value |
| Provisional adoption | `Hypothesis.status=open` |
| Test | discriminating `Experiment` WorkUnit |
| Revision | strengthen/weaken/reject/reframe Event |

## 6. Transfer rules

1. 에이전트의 최초 설명을 Claim accepted가 아니라 Hypothesis proposed로 기록한다.
2. 각 가설은 설명할 Observation과 틀렸음을 보여줄 조건을 가진다.
3. 가설 다양성은 문구 차이가 아니라 인과 모델과 예측 차이로 평가한다.
4. 탐구 비용과 실패 파급 효과를 고려해 시험 순서를 정한다.
5. 독립 Evidence 없이 여러 에이전트의 같은 답을 confidence 증가로 계산하지 않는다.
6. 관찰을 설명하지 못하면 새 가설뿐 아니라 ProblemFrame 변경을 허용한다.

## 7. What must not be copied

- 모든 상상 가능한 설명을 생성하여 인지 부하 늘리기
- 설명의 단순성만으로 참에 가깝다고 결정하기
- LLM 다양성을 epistemic independence로 간주하기
- 반증 조건 없이 창의적 아이디어를 Hypothesis로 승격하기

## 8. Failure modes

- **Narrative lock-in**: 첫 설명이 이후 Evidence 해석을 지배
- **Pseudo-diversity**: 표현만 다른 동일 인과 가설
- **Hypothesis explosion**: 검증 예산보다 후보가 빠르게 증가
- **Unfalsifiable elegance**: 아름답지만 틀렸음을 보일 수 없는 설명
- **Discovery–acceptance collapse**: 생성된 가설을 즉시 Decision 근거로 사용

## 9. Falsifiable Helm hypotheses

### AR-H1

놀라운 Observation을 명시적으로 감지하고 대안 가설을 생성하면 단일 agent diagnosis보다 원인 오진이 감소할 것이다.

### AR-H2

가설을 인과 예측과 falsifier로 비교하면 단순 자연어 similarity보다 실제 다양성이 높은 후보를 선별할 수 있을 것이다.

### AR-H3

expected information value로 실험을 선택하면 모든 가설을 균등 조사하는 방식보다 적은 비용으로 Decision confidence를 개선할 것이다.

## 10. Prototype

- 알려진 원인과 distractor가 있는 복잡한 failure scenario를 제시한다.
- 단일 응답, 다중 agent brainstorming, structured abductive map을 비교한다.
- 가설마다 예측과 falsifier를 작성하게 한다.
- 첫 두 실험 후 남은 후보와 최종 진단 정확도를 비교한다.

## 11. Metrics

- causal hypothesis diversity
- falsifier completeness
- true-cause coverage
- experiment information gain
- time/cost to eliminate hypotheses
- premature acceptance rate
- duplicate correlated hypothesis rate

## 12. Sources

- [Stanford Encyclopedia of Philosophy: Peirce on Abduction](https://plato.stanford.edu/archives/fall2023/entries/abduction/peirce.html)

## 13. Open questions

- LLM agent 간 epistemic independence를 어떤 metadata로 추정할 수 있는가?
- creative divergence와 사용자 attention cost의 적정 균형은 무엇인가?
- 가설의 설명력·검증 가능성·실행 가치 사이 우선순위를 누가 정하는가?

