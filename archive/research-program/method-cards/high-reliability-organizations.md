# Method Card: High Reliability Organizations

- Domain: healthcare, aviation, nuclear operations, high-hazard organizations
- Evidence status: established organizational research tradition; Helm transfer exploratory
- Primary Helm bundle: Acceptance & Integration
- Candidate primitives: `WeakSignal`, `Dissent`, `OperationalSensitivity`, `ExpertRouting`, `NearMiss`

## 1. Original problem

일부 조직은 높은 복잡성과 위험 속에서도 치명적 실패를 드물게 유지해야 한다. 성공이 반복될수록 경계심이 낮아지고 작은 실패 신호를 정상 변동으로 단순화하기 쉽다.

High Reliability Organization 연구는 실패에 대한 선제적 관심, 단순화 거부, 실제 운영에 대한 민감성, 회복력, 관련 전문성에 대한 권한 양보를 강조한다.

## 2. Environmental assumptions

- 실패는 드물지만 비용이 크다.
- 복잡한 상호작용 때문에 모든 실패 경로를 미리 알 수 없다.
- 작은 이상과 near miss가 중요한 학습 신호일 수 있다.
- 현장 전문가는 형식적 권한자보다 상황을 더 잘 알 수 있다.
- 정상 성과가 안전을 완전히 증명하지 않는다.

## 3. Domain-invariant mechanisms

### Preoccupation with failure

작은 실패, near miss, 약한 신호를 성공 통계에 묻지 않고 학습한다.

### Reluctance to simplify

매끄러운 단일 설명으로 복잡성과 이견을 성급히 제거하지 않는다.

### Sensitivity to operations

계획과 dashboard보다 실제 현재 작업 조건과 현장 변화를 중시한다.

### Deference to expertise

직급보다 문제와 가장 관련된 지식·Evidence를 가진 Actor에게 판단을 라우팅한다.

### Commitment to resilience

예상 밖 상황에서 기능을 회복하고 적응할 능력을 준비한다.

## 4. Helm problem explained

에이전트가 높은 완료율과 테스트 통과를 보이면 사용자는 작은 경고, dissent, 설명되지 않은 변화, 반복 correction을 무시하기 쉽다. 오케스트레이터가 여러 결과를 매끄럽게 요약하면 weak signal이 사라진다.

## 5. Transfer to Helm

| HRO mechanism | Helm primitive |
|---|---|
| Weak signal / near miss | Observation or Concern with low frequency/high consequence |
| Reluctance to simplify | Counterevidence and dissent preservation |
| Operational sensitivity | live Outcome/ExecutionTrace vs plan |
| Deference to expertise | expert/agent routing by evidence and competence |
| Resilience | recovery path, fallback, reversible Decision |

## 6. Transfer rules

1. correction, rollback, near miss를 단순 소음으로 삭제하지 않는다.
2. Return Brief는 가장 중요한 dissent와 설명되지 않은 Observation을 포함한다.
3. 다수 agent 합의보다 관련 전문 Evidence를 우선할 수 있어야 한다.
4. 계획 상태와 실제 운영 상태의 차이를 별도 표시한다.
5. acceptance에는 Known Limitation과 recovery readiness를 포함한다.
6. HRO 깊이는 위험에 비례시키고 모든 작업을 고위험으로 취급하지 않는다.

## 7. What must not be copied

- 모든 작은 실패를 사용자에게 즉시 알림
- 저위험 창작 작업을 안전 중요 운영처럼 관리
- 전문성 라우팅을 agent persona 이름으로 대체
- 실패에 대한 관심을 비난·책임 추궁 문화로 구현
- 단순화를 항상 나쁜 것으로 간주

## 8. Failure modes

- **Success complacency**: 통과한 run 수가 숨은 위험을 가림
- **Smooth summary loss**: dissent와 near miss가 요약에서 제거
- **Expertise hierarchy confusion**: formal owner가 관련 전문 Evidence를 무시
- **Weak-signal flood**: 중요도 평가 없이 모든 anomaly를 확대
- **Safety ritual**: checklist가 실제 운영 민감성을 대체

## 9. Falsifiable Helm hypotheses

### HRO-H1

near miss와 dissent를 구조적으로 보존하면 일반 progress summary보다 integration 전 결함 발견률이 높을 것이다.

### HRO-H2

expertise-based Gate routing은 fixed owner routing보다 결정 정확도와 응답 시간을 개선할 것이다.

### HRO-H3

risk-tailored weak-signal amplification은 all-alert 조건보다 alert fatigue를 줄이면서 중요한 실패 전조를 보존할 것이다.

## 10. Prototype

- 여러 성공 Event 사이에 낮은 빈도의 near miss와 dissent를 삽입한다.
- smooth summary와 HRO-informed Brief의 탐지율을 비교한다.
- formal owner와 relevant expert에게 같은 Gate를 라우팅해 판단 차이를 본다.

## 11. Metrics

- weak signal recall
- near-miss-to-concern conversion
- escaped defect
- dissent preservation rate
- expert routing accuracy
- alert fatigue
- repeated correction before failure

## 12. Sources

- [AHRQ: High Reliability Organization Research Protocol](https://effectivehealthcare.ahrq.gov/products/hro/protocol)
- [AHRQ: Becoming a High Reliability Organization](https://www.ahrq.gov/sites/default/files/wysiwyg/patient-safety/settings/hospitals/hroadvice.pdf)

## 13. Open questions

- 소프트웨어 agent 작업에서 near miss를 어떤 Event로 정의할 것인가?
- relevant expertise를 최근 Evidence, historical success, user designation 중 무엇으로 판단할 것인가?
- weak signal amplification이 사용자의 불안을 과도하게 높이지 않게 하려면 무엇이 필요한가?

