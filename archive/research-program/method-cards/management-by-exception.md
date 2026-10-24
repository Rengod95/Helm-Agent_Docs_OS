# Method Card: Management by Exception

- Domain: management control, accounting, operations supervision
- Evidence status: established management mechanism; Helm transfer exploratory
- Primary Helm bundle: Delegated Joint Action
- Candidate primitives: `ExpectedRange`, `Exception`, `EscalationPolicy`, `AttentionQueue`

## 1. Original problem

관리자는 모든 활동과 지표를 직접 검토할 수 없다. Management by Exception은 사전에 정한 기대 범위 안의 운영은 위임하고, 중요한 편차나 기준 위반만 관리자의 주의 대상으로 올려 제한된 정보 처리 부담을 줄인다.

## 2. Environmental assumptions

- 정상 범위와 중요 편차를 어느 정도 정의할 수 있다.
- 지역 실행자가 정상 운영을 처리할 능력이 있다.
- 관리자의 주의가 희소하다.
- 편차의 영향과 긴급도가 다르다.
- 기준 자체가 시간이 지나면 낡을 수 있다.

## 3. Domain-invariant mechanisms

### Expected envelope

허용 가능한 상태, 비용, 일정, 품질, 권한 범위를 정의한다.

### Exception detection

실제 상태가 범위를 벗어나거나 예상하지 못한 종류의 변화가 나타나면 신호를 만든다.

### Selective escalation

편차의 파급, 긴급성, 회복 가능성에 따라 적절한 수준으로 전달한다.

### Standard revision

반복 예외와 새로운 환경은 정상 범위와 정책 자체의 재검토를 요구한다.

## 4. Helm problem explained

다중 에이전트가 모든 진행을 보고하면 사용자는 로그 소비자가 된다. 반대로 완료 시점까지 침묵하면 중요한 방향 이탈을 늦게 발견한다. 필요한 것은 진행 빈도 기반 보고가 아니라 기대 범위와 결과 차이에 따른 상향이다.

## 5. Transfer to Helm

| Management mechanism | Helm primitive |
|---|---|
| Standard/expected range | AcceptanceCriterion, AuthorityEnvelope, plan prediction |
| Variance | `ExceptionDetected` Event |
| Materiality | stakes, coupling, reversibility |
| Exception report | Decision Gate or Attention item |
| Corrective action | Contract renegotiation or new WorkUnit |
| Standard revision | policy Reflection and Decision reopen |

## 6. Transfer rules

1. Contract에는 무엇이 정상 진행이고 무엇이 예외인지 가능한 범위에서 정의한다.
2. “예정보다 다름”과 “중요하게 나쁨”을 구분한다.
3. 사용자의 주의 큐에는 편차 크기보다 목적 영향과 마지막 저비용 수정 시점을 반영한다.
4. 반복 예외는 수행자 문제가 아니라 기준 또는 ProblemFrame 결함일 수 있다.
5. unknown unknown은 기존 threshold로 탐지되지 않으므로 Surprise와 dissent channel을 별도로 유지한다.
6. low-risk exception은 local correction을 허용하고 결과만 기록한다.

## 7. What must not be copied

- 측정 가능한 지표만 중요한 것으로 취급
- threshold 안의 상태를 안전하다고 가정
- 편차를 모두 수행 실패로 해석
- 목표 숫자 조작과 Goodhart 효과 무시
- 사용자를 예외 처리 전담자로 축소

## 8. Failure modes

- **Alert fatigue**: 낮은 중요도 variance가 계속 상향
- **Silent drift**: threshold 안에서 목적이 서서히 어긋남
- **Unknown exception blindness**: taxonomy 밖의 실패를 무시
- **Metric gaming**: agent가 측정 기준만 만족하도록 최적화
- **Static envelope**: 환경 변화에도 정상 범위가 갱신되지 않음

## 9. Falsifiable Helm hypotheses

### MBE-H1

expected-range 기반 보고는 고정 주기 진행 보고보다 사용자 attention을 줄이면서 중요한 방향 이탈 발견률을 유지할 것이다.

### MBE-H2

importance와 last-cheap-point를 반영한 exception queue는 variance 크기 기반 정렬보다 늦은 결정 비용을 줄일 것이다.

### MBE-H3

반복 Exception을 policy review로 승격하면 같은 유형의 사용자 Gate가 감소할 것이다.

## 10. Prototype

- 한 WorkUnit의 정상/경미/중요/새 유형 편차 Event를 준비한다.
- all-events, threshold-only, consequence-aware exception 조건을 비교한다.
- 사용자가 어떤 항목에 개입하고 무엇을 놓치는지 측정한다.

## 11. Metrics

- alerts per WorkUnit
- false escalation
- missed consequential deviation
- time before last cheap point
- repeated exception type
- local correction success
- threshold/policy revision rate

## 12. Sources

- [Management by Exception as a Communication and Control Mechanism](https://publications.aaahq.org/jmar/article/34/3/161/85/A-Positive-Theory-of-Accounting-Based-Management)

## 13. Open questions

- 생성적 작업에서 정상 범위를 결과 다양성을 억압하지 않고 어떻게 정의할 것인가?
- 목적 drift처럼 threshold 안에서 일어나는 의미 변화는 어떤 신호로 탐지할 것인가?
- 에이전트가 자신의 Exception을 분류할 때 self-report bias를 어떻게 보정할 것인가?

