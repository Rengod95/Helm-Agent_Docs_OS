# Method Card: Subsidiarity

- Domain: political and organizational governance
- Evidence status: established governance principle; Helm operationalization exploratory
- Primary Helm bundle: Delegated Joint Action
- Candidate primitives: `DecisionRight`, `CompetenceScope`, `EscalationJustification`, `LocalPolicy`

## 1. Original problem

다층 조직에서 모든 결정을 중앙이 맡으면 정보 손실, 지연, 책임 약화가 발생한다. 반대로 모든 권한을 지역 단위에 남기면 공통 목적, 규모 효과, 외부 파급을 다루기 어렵다.

Subsidiarity는 결정이 가능한 한 시민이나 문제에 가까운 수준에서 이루어지고, 상위 수준의 행동은 하위 수준에서 충분히 달성할 수 없거나 상위 행동이 더 적절할 때 정당화되어야 한다는 원리다.

## 2. Environmental assumptions

- 여러 수준의 행위자와 권한이 존재한다.
- 지역 수준이 구체적 맥락과 영향을 더 잘 알 수 있다.
- 일부 문제는 여러 지역을 가로질러 조정이 필요하다.
- 상위 개입에는 비용과 정당화 의무가 있다.
- 능력과 책임이 수준마다 다르다.

## 3. Domain-invariant mechanisms

### Lowest competent level

문제를 실제로 이해하고 처리할 수 있는 가장 가까운 유능한 수준에서 결정한다.

### Burden of escalation

상향 결정은 왜 지역 수준으로 충분하지 않은지 설명해야 한다.

### Cross-boundary exception

지역 행동이 다른 단위에 큰 영향을 주거나 공동 기준을 바꿀 때 상위 조정이 필요하다.

### Retained local agency

상위 정책이 있어도 지역 상황에 맞춘 구현과 판단 공간을 보존한다.

## 4. Helm problem explained

다중 에이전트 시스템에서 사용자는 모든 선택의 상위 승인자가 되기 쉽다. “인간이 최종 책임자”라는 원리가 “인간이 모든 결정을 직접 해야 한다”로 오해되면 Helm은 병목과 승인 노동을 만든다.

## 5. Transfer to Helm

| Subsidiarity concept | Helm primitive |
|---|---|
| Local level | WorkUnit performer or specialist agent |
| Competence | demonstrated capability + policy coverage |
| Higher level | human, integration owner, governance policy |
| Cross-boundary effect | blast radius / coupling |
| Escalation burden | Gate reason and why-local-insufficient |
| Local discretion | bounded implementation choices |

## 6. Transfer rules

1. 모든 Decision에 owner level과 competence basis를 지정한다.
2. Gate는 “왜 사용자가 결정해야 하는가”를 설명한다.
3. 정책이 충분히 다루는 가역적 지역 선택은 자동 또는 local Decision으로 처리한다.
4. 여러 Concern의 기준선을 바꾸거나 외부 효과가 큰 선택은 상위로 올린다.
5. 상위 Decision 이후에도 세부 수행법은 가능한 한 지역에 남긴다.
6. 동일 유형의 반복 Gate는 local policy로 내릴 수 있는지 회고한다.

## 7. What must not be copied

- 조직 수준을 인간/agent의 가치 위계로 표현
- lowest level을 무조건 가장 빠른 실행자로 해석
- competence를 모델 벤치마크 하나로 결정
- 상위 개입을 모두 나쁜 중앙집권으로 간주
- 책임 소재를 권한 분산 속에 숨기기

## 8. Failure modes

- **Human bottleneck**: 모든 사소한 Decision을 사용자에게 상향
- **Local overreach**: 다른 WorkUnit의 baseline을 지역 선택으로 변경
- **Competence fiction**: 수행 능력이 입증되지 않은데 policy가 권한 부여
- **Escalation dumping**: agent가 어려운 판단을 전부 인간에게 넘김
- **Central solution bias**: 통합 owner가 지역 맥락을 무시

## 9. Falsifiable Helm hypotheses

### SUB-H1

Decision을 lowest competent level에 배치하면 중요한 인간 개입률을 유지하면서 총 Gate 수가 감소할 것이다.

### SUB-H2

why-local-insufficient를 요구하면 불필요한 escalation과 authority dumping이 감소할 것이다.

### SUB-H3

cross-boundary coupling 기반 상향은 파일 경로 기반 ownership보다 의미 충돌을 더 잘 포착할 것이다.

## 10. Prototype

- 20개 실제/가상 Decision을 local, policy, human, integration-owner 수준에 분류한다.
- fixed human approval와 subsidiarity policy를 비교한다.
- 반복 Gate가 local policy로 내려간 뒤 miss/overreach를 측정한다.

## 11. Metrics

- total Gate count
- consequential Gate recall
- unnecessary escalation
- local overreach
- decision latency
- repeated Gate type
- user attention spent on normative vs implementation choices

## 12. Sources

- [EUR-Lex: The Principle of Subsidiarity](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=legissum%3Asubsidiarity)

## 13. Open questions

- agent competence를 특정 WorkUnit에서 동적으로 평가하는 가장 안전한 방법은 무엇인가?
- 팀의 역할 위계와 Helm의 Decision level을 어떻게 분리할 것인가?
- 사용자가 개입하고 싶다는 선호가 subsidiarity 기본값을 언제 override할 수 있는가?

