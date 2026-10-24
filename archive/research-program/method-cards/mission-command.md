# Method Card: Mission Command

- Domain: military command and decentralized operations
- Evidence status: established doctrine; non-military Helm transfer exploratory
- Primary Helm bundle: Delegated Joint Action
- Candidate primitives: `CommanderIntent`, `Purpose`, `Constraint`, `AuthorityEnvelope`, `EscalationTrigger`

## 1. Original problem

현장은 상위 지휘부보다 빠르고 구체적인 정보를 가지며, 통신이 불완전하고 상황이 변하기 때문에 중앙이 모든 세부 행동을 명령할 수 없다. 반대로 하위 단위가 각자 최적화하면 전체 임무가 분열된다.

Mission Command는 명확한 지휘 의도, 임무 명령, 상호 신뢰, 공유 이해, disciplined initiative를 통해 중앙의 목적 일관성과 지역의 실행 자율성을 결합한다.

## 2. Environmental assumptions

- 현장 상황이 계획보다 빠르게 변한다.
- 상위와 하위의 정보가 비대칭적이다.
- 세부 명령을 기다리면 기회를 놓치거나 실패한다.
- 하위 단위는 목적을 이해하고 판단할 전문성이 있다.
- 자율성은 공통 의도와 제약 안에서 행사된다.

## 3. Domain-invariant mechanisms

### Intent over procedure

무엇을 왜 달성해야 하는지, 핵심 제약과 원하는 최종 상태를 전달한다.

### Mission-type orders

세부 수행법보다 결과, 책임, 자원, 경계를 명시한다.

### Disciplined initiative

계획이 현실과 맞지 않을 때 상위 목적을 보존하는 방향으로 지역 판단을 허용한다.

### Shared understanding and trust

자율성은 단순 권한 부여가 아니라 능력, 예상 행동, 공통 상황에 대한 충분한 신뢰를 요구한다.

## 4. Helm problem explained

에이전트에게 세부 프롬프트를 과도하게 지정하면 변화에 취약하고 사용자가 병목이 된다. 반대로 “알아서 해”는 목적·제약·중단 조건을 전달하지 않아 자율적 방향 이탈을 만든다.

## 5. Transfer to Helm

| Mission Command concept | Helm primitive |
|---|---|
| Commander’s intent | Purpose + why + desired end state |
| Mission order | DelegationContract |
| Boundaries | AuthorityEnvelope and protected baselines |
| Disciplined initiative | local decision policy |
| Shared understanding | ContextProjection + check-back |
| Report by exception | EscalationTrigger |

## 6. Transfer rules

1. Delegation은 목표 문구뿐 아니라 why, end state, preserved values를 포함한다.
2. 수행자가 의도를 자신의 말로 재구성하거나 모순을 제기할 수 있게 한다.
3. 세부 실행법은 검증·권한 요구가 없는 한 수행자에게 남긴다.
4. 계획 이탈의 허용 기준과 보고 조건을 Contract에 포함한다.
5. initiative가 상위 Purpose를 변경할 수는 없으며 필요한 경우 Decision Gate를 연다.
6. 반복적 성공과 예측 가능한 행동을 기반으로 Authority Envelope를 점진 조정한다.

## 7. What must not be copied

- 군사적 계급·복종 언어를 제품 UX에 사용
- 사용자를 commander, agent를 부하로 의인화
- “disciplined initiative”를 무단 권한 확장의 정당화로 사용
- trust를 검증 없는 낙관으로 해석
- 분산 실행을 규범적 책임 분산과 동일시

## 8. Failure modes

- **Intent vacuum**: task는 있지만 왜 하는지와 end state가 없음
- **Micromanagement**: 모든 세부 선택이 사용자 Gate가 됨
- **Unbounded initiative**: 목적을 재해석하며 보호 기준선까지 변경
- **Nominal trust**: 능력 Evidence 없이 자율 범위 확대
- **Plan obedience**: 환경 변화에도 문자 그대로 원 계획 수행

## 9. Falsifiable Helm hypotheses

### MC-H1

why/end-state/constraints를 포함한 Delegation은 step-by-step prompt보다 예상 외 상황에서 목적 적합한 회복 행동을 증가시킬 것이다.

### MC-H2

Authority Envelope와 EscalationTrigger를 함께 제공하면 “알아서 해”보다 무단 행동과 불필요한 질문이 모두 감소할 것이다.

### MC-H3

수행자의 intent check-back은 단순 prompt acknowledgment보다 방향 이탈을 더 일찍 발견할 것이다.

## 10. Prototype

- 같은 변동 시나리오에 step instructions, vague autonomy, intent-based contract를 비교한다.
- 중간에 계획 전제를 무효화하는 Event를 주입한다.
- 수행자가 멈추거나, initiative를 행사하거나, 목적에서 벗어나는지 관찰한다.

## 11. Metrics

- intent recall and reconstruction
- unnecessary clarification count
- unauthorized deviation
- correct local initiative
- escalation precision
- recovery time after invalidated plan
- purpose-fit of final Outcome

## 12. Sources

- [U.S. Army: Understanding Mission Command](https://www.army.mil/article/106872/understanding_mission_command)

## 13. Open questions

- 모델 능력과 task 환경에 따라 disciplined initiative를 어떤 Evidence로 승인할 것인가?
- Purpose가 여러 이해관계자 사이에 충돌할 때 단일 intent를 어떻게 표현할 것인가?
- agent가 상위 의도를 그럴듯하게 재진술하지만 실제 계획이 어긋나는 문제를 어떻게 검증할 것인가?

