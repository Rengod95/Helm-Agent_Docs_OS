# Method Card: Situation Awareness

- Domain: aviation, military operations, supervisory control
- Evidence status: source mechanism supported; Helm measurement adaptation exploratory
- Primary Helm bundle: Situation Recovery
- Candidate primitives: `ReturnBrief`, `CommonOperatingPicture`, `Projection`, `AttentionGate`

## 1. Original problem

동적 시스템의 운영자는 많은 계기 값을 보고도 현재 상황이 무엇을 의미하고 다음에 무엇이 일어날지 이해하지 못할 수 있다. 자동화는 workload를 낮추지만 운영자를 수동적 감시자로 만들고, 실패 시 수동 복귀 능력과 상황 인식을 약화할 수 있다.

Situation Awareness 연구는 상태 인식을 대략 세 수준으로 구분한다.

1. 관련 요소의 지각
2. 그 의미의 이해
3. 가까운 미래 상태의 예측

## 2. Environmental assumptions

- 환경이 시간에 따라 계속 변한다.
- 모든 상태를 동시에 볼 수 없고 주의가 제한된다.
- 현재 목표에 따라 관련 정보가 달라진다.
- 잘못된 상황 모델은 의사결정 오류로 이어진다.
- 자동화의 행동과 피드백 품질이 인간 인식에 영향을 준다.

## 3. Domain-invariant mechanisms

### Goal-directed selection

상황 인식은 모든 데이터의 복제가 아니라 현재 목적과 관련된 요소 선택이다.

### Three-level representation

“무엇이 바뀌었는가”만이 아니라 “왜 중요한가”와 “다음에 무엇이 일어나는가”를 함께 표현해야 한다.

### Active processing

사용자가 수동적으로 상태를 보는 것보다 예측·판단·수정에 참여할 때 더 나은 상황 모델을 유지할 수 있다.

### Calibration

사용자의 확신과 실제 상황 이해가 일치하는지 별도로 측정해야 한다.

## 4. Helm problem explained

에이전트가 빠르게 병렬 작업하면 사용자는 많은 로그와 완료 알림을 받아도 다음을 모를 수 있다.

- 어떤 변화가 목적에 중요했는가
- 어떤 가정이 깨졌는가
- 작업들이 어떻게 상호작용하는가
- 개입하지 않으면 무엇이 일어나는가
- 언제 방향 수정 비용이 급격히 커지는가

이는 정보 부족보다 상황 모델의 붕괴다.

## 5. Transfer to Helm

| SA level | Return Brief section | User question |
|---|---|---|
| Perception | What changed | 무엇이 실제로 변했는가? |
| Comprehension | What it means | 목적·위험·가정에 어떤 의미인가? |
| Projection | What happens next | 개입하지 않으면 무엇이 일어나는가? |

## 6. Transfer rules

1. 모든 Brief는 change–meaning–projection을 분리한다.
2. 현재 목적과 사용자 역할에 따라 관련 정보를 선택한다.
3. status dashboard의 조회 수를 상황 인식의 증거로 사용하지 않는다.
4. 사용자에게 다음 상태를 예측하게 하여 실제 이해를 검사한다.
5. 자율 실행 중에도 의도, 예상 경로, 에스컬레이션 조건을 노출한다.
6. 높은 확신의 오답을 낮은 확신의 미완성 이해보다 위험하게 다룬다.

## 7. What must not be copied

- 작업을 자주 중단시키는 freeze-probe를 일상 UX로 사용하기
- 조종석의 고정 계기 모델을 지식 작업에 그대로 적용하기
- 상황 인식을 하나의 자기보고 숫자로 환원하기
- 모든 사용자에게 동일한 정보 밀도 제공하기

## 8. Failure modes

- **Data-rich, model-poor**: 로그는 많지만 의미와 향후 상태가 없음
- **False orientation**: 매끄러운 요약 때문에 사용자가 틀린 확신을 가짐
- **Out-of-the-loop**: 자율 구간 동안 사용자가 프레임과 기술 감각을 잃음
- **Projection omission**: 현재 상태만 보여 방향 수정 시점을 놓침
- **Goal mismatch**: 시스템이 중요하다고 판단한 정보와 사용자 목적이 다름

## 9. Falsifiable Helm hypotheses

### SA-H1

change–meaning–projection Return Brief는 상태 목록만 있는 current document보다 복귀 후 첫 유효 행동 시간을 줄일 것이다.

### SA-H2

예상 다음 상태를 명시하면 사용자는 자동화 surprise와 늦은 방향 수정을 덜 경험할 것이다.

### SA-H3

중요 Decision에 능동적으로 참여한 사용자는 결과만 통보받은 사용자보다 24시간 후 상황 퀴즈 정확도가 높을 것이다.

## 10. Prototype

- 동일 project state로 status-list Brief와 Helm Return Brief를 만든다.
- 재개 직후 Level 1–3 project-specific 질문을 수행한다.
- 첫 판단 전에 사용자가 다음 agent 행동과 위험을 예측하게 한다.
- 실제 상태와 응답을 비교하고 confidence calibration을 계산한다.

## 11. Metrics

- Level 1/2/3 accuracy
- time-to-first-valid-action
- confidence calibration error
- missed consequential change
- automation surprise count
- late redirection cost
- raw-log fallback rate

## 12. Sources

- [Endsley & Kiris, “The Out-of-the-Loop Performance Problem”](https://doi.org/10.1518/001872095779064555)
- [NASA: Situation Awareness Measurement Review](https://human-factors.arc.nasa.gov/publications/NASA_TM20210021987.pdf)
- [NASA NTRS: Objective Evaluation of Situation Awareness](https://ntrs.nasa.gov/citations/19950007634)

## 13. Open questions

- 지식 작업에서 정답이 하나가 아닌 Level 2/3 질문을 어떻게 신뢰성 있게 평가할 것인가?
- 적극적 사용자 참여가 상황 인식을 유지하는 최소 빈도는 얼마인가?
- Brief의 예측이 에이전트 경로를 고정시키는 자기충족 편향을 만들지 않는가?

