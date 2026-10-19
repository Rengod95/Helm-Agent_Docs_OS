# Method Card: Pragmatist Inquiry

- Domain: philosophy of inquiry, education, democratic problem-solving
- Evidence status: foundational philosophical framework; Helm transfer exploratory
- Primary Helm bundle: Deliberative Inquiry
- Candidate primitives: `SituationModel`, `ProblemFrame`, `Inquiry`, `Outcome`, `Reflection`

## 1. Original problem

John Dewey의 실용주의에서 탐구는 이미 정확히 정의된 문제에 정답을 적용하는 과정이 아니다. 불확정하고 혼란스러운 상황을 구성 요소와 관계가 더 분명하여 행동 가능한 상황으로 변환하는 과정이다.

목표, 문제, 가치 판단도 경험과 행위 속에서 수정된다. 해결책의 의미는 추상적 일관성만이 아니라 실제 상황에서 어떤 결과를 만들고 공동 검토를 견디는지에 의해 평가된다.

## 2. Environmental assumptions

- 문제는 처음부터 완전히 주어지지 않는다.
- 관찰과 행동이 상황에 대한 이해를 바꾼다.
- 가치와 수단은 실제 결과를 통해 함께 조정된다.
- 지식은 잠정적이며 새로운 경험에 의해 수정된다.
- 복잡한 문제는 사회적·공동 탐구를 필요로 할 수 있다.

## 3. Domain-invariant mechanisms

### Indeterminate situation

탐구의 시작은 정답 없는 질문이 아니라 무엇이 문제인지조차 불명확한 긴장이다.

### Problem framing

상황의 어떤 요소와 관계를 문제로 선택하느냐가 이후 가능한 행동 공간을 형성한다.

### Hypothesis as action proposal

아이디어는 실제 결과를 예측하고 시험할 수 있을 때 탐구 가치를 가진다.

### Means–ends reciprocity

수단은 고정 목적을 단순 수행하지 않는다. 수단의 결과가 목적의 의미와 정당성을 다시 바꿀 수 있다.

### Public test and reconstruction

결과는 다른 참여자가 검토 가능한 경험과 증거로 평가되고, 상황 모델을 재구성한다.

## 4. Helm problem explained

에이전트 하네스가 사용자 프롬프트를 완성된 문제 정의로 취급하면 잘못된 프레임을 빠르게 구현할 수 있다. 사용자는 결과물을 보면서 원래 원했던 것이 달랐음을 깨닫지만, 그때는 많은 Material change가 잘못된 Normative baseline에 묶여 있다.

Helm은 프롬프트를 `initial concern`으로 취급하고 ProblemFrame을 탐구 가능한 객체로 만들어야 한다.

## 5. Transfer to Helm

| Pragmatist mechanism | Helm primitive |
|---|---|
| Indeterminate situation | `Concern`, `SituationModel` |
| Problem constitution | competing `ProblemFrame` |
| Idea as hypothesis | `Hypothesis` + predicted Outcome |
| Experimental action | bounded reversible WorkUnit |
| Consequence evaluation | `Outcome`, Evidence, Acceptance |
| Reconstruction | Reframe, Decision reopen, Reflection |

## 6. Transfer rules

1. 초기 사용자 요청과 최종 ProblemFrame을 분리한다.
2. 에이전트는 실행 중 발견한 모순을 scope deviation으로만 보지 않고 reframe candidate로 제출할 수 있다.
3. Purpose와 AcceptanceCriterion도 결과에 의해 재검토 가능해야 한다.
4. 탐구는 실행 전 분석 단계가 아니라 실행·관찰·재구성의 순환이다.
5. 이론적 정합성과 실제 Outcome을 모두 Evidence로 사용한다.
6. 결과가 유용했다는 이유로 원래 목적과 가치 충돌을 숨기지 않는다.

## 7. What must not be copied

- 모든 목적과 가치를 끝없이 잠정적인 것으로 만들어 Commitment를 회피하기
- “작동한다”를 윤리적·규범적 정당성과 동일시하기
- 모든 작업을 열린 탐구로 만들어 명확한 실행을 지연하기
- 공동 검토를 단순 다수결로 축소하기

## 8. Failure modes

- **Premature framing**: 첫 프롬프트를 정본 문제로 고정
- **Solution capture**: 구현된 해법이 문제 정의를 사후 정당화
- **End rigidity**: 실제 결과가 목적의 결함을 보여도 목표를 수정하지 않음
- **Inquiry without commitment**: 계속 학습하지만 행동을 선택하지 않음
- **Local usefulness**: 단기 작동을 전체 가치와 동일시

## 9. Falsifiable Helm hypotheses

### PI-H1

ProblemFrame을 일급 객체로 두면 같은 작업에서 late-stage scope reversal과 목적 부적합 결과가 감소할 것이다.

### PI-H2

실행 중 reframe candidate를 명시하면 에이전트가 원래 요청을 문자 그대로 최적화하는 오류가 줄어들 것이다.

### PI-H3

Outcome 기반 Purpose review는 단순 완료 회고보다 다음 작업의 AcceptanceCriterion 품질을 높일 것이다.

## 10. Prototype

- 같은 initial concern에서 사용자와 에이전트가 두 개 이상의 ProblemFrame을 작성한다.
- 각 Frame이 무엇을 전경화·은폐하는지 비교한다.
- 작은 reversible experiment 후 Frame과 Purpose가 어떻게 변하는지 기록한다.
- 바로 구현한 baseline과 late rework를 비교한다.

## 11. Metrics

- number of meaningful reframes
- time of first frame correction
- late scope reversal
- purpose-fit rating
- experiment-to-decision conversion
- inquiry duration without commitment
- accepted criteria changed after Outcome

## 12. Sources

- [Stanford Encyclopedia of Philosophy: Pragmatism](https://plato.stanford.edu/entries/pragmatism/)
- [Stanford Encyclopedia of Philosophy: Dewey’s Political Philosophy](https://plato.stanford.edu/entries/dewey-political/)

## 13. Open questions

- 에이전트가 제안한 reframe이 유용한 비판인지 책임 회피인지 어떻게 구분할 것인가?
- 제품 개발에서 Purpose를 다시 열 수 있는 비용 임계치는 무엇인가?
- 개인 사용자의 가치와 팀의 공동 수락 기준이 충돌할 때 탐구를 누가 닫는가?

