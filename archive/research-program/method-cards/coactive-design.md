# Method Card: Coactive Design

- Domain: human–robot and human–agent teamwork
- Evidence status: developed and demonstrated design method; software-agent transfer exploratory
- Primary Helm bundle: Delegated Joint Action
- Candidate primitives: `Interdependence`, `Observability`, `Predictability`, `Directability`, `Contestability`

## 1. Original problem

인간–기계 시스템은 자율성을 기계가 혼자 할 수 있는 정도로 측정하는 경향이 있다. 그러나 더 높은 독립성이 공동 팀 성과를 높인다는 보장은 없다. 자동화가 더 자율적일수록 인간이 상태를 보거나 방향을 바꾸기 어려워질 수 있다.

Coactive Design은 자율성보다 상호의존성을 중심으로 두고, 사람과 기계가 서로 의존하고 의존받을 수 있도록 관측 가능성, 예측 가능성, 지시 가능성을 설계한다.

## 2. Environmental assumptions

- 인간과 자동화가 지속적 공동 활동에 참여한다.
- 각 참여자는 서로 다른 강점과 한계를 가진다.
- 한쪽의 행동이 다른 쪽의 선택 가능성을 바꾼다.
- 예상하지 못한 상황에서는 역할과 도움 관계가 바뀔 수 있다.
- 팀 성과는 독립적 taskwork뿐 아니라 teamwork capability에 달려 있다.

## 3. Domain-invariant mechanisms

### Interdependence analysis

누가 누구의 정보, 결정, 능력, 확인에 의존하는지 먼저 식별한다.

### Observability

상대의 관련 상태와 의도를 볼 수 있게 한다.

### Predictability

상대가 다음에 무엇을 어떤 조건으로 할지 예상할 수 있게 한다.

### Directability

상황 변화 시 목표, 계획, 행동을 수정하도록 지시할 수 있게 한다.

### Flexible mutual support

역할이 고정되지 않고 필요에 따라 서로를 지원하거나 대체한다.

## 4. Helm problem explained

“에이전트 자율성 수준”만 정하면 다음 질문이 빠진다.

- 사용자가 에이전트 내부 상태와 의도를 얼마나 볼 수 있는가?
- 방향 수정은 언제까지 얼마나 싸게 가능한가?
- 에이전트가 사용자 결정과 다른 WorkUnit에 어떻게 의존하는가?
- 사용자가 필요한 도움을 에이전트에게 요청할 수 있는가?
- 에이전트의 주장에 이의를 제기할 수 있는가?

## 5. Transfer to Helm

Helm은 원래 세 기준에 Contestability를 추가한다.

| Criterion | Helm question |
|---|---|
| Observability | 다음 판단에 필요한 상태·의도·증거가 보이는가? |
| Predictability | 다음 agent 행동과 예외 조건을 예상할 수 있는가? |
| Directability | 낮은 비용으로 목표·제약·경로를 바꿀 수 있는가? |
| Contestability | 프레임·Claim·Recommendation에 이의를 제기하고 다시 열 수 있는가? |

## 6. Transfer rules

1. WorkUnit마다 인간–agent–tool 의존성을 명시한다.
2. 상태 노출은 모든 chain-of-thought가 아니라 coordination에 필요한 intent, uncertainty, next action을 중심으로 한다.
3. 실행 전에 예상 경로와 마지막 저비용 redirection point를 제공한다.
4. 방향 수정이 현재 Commitment와 dependent WorkUnit에 미치는 영향을 보여준다.
5. 에이전트의 Explanation과 사용자의 Contestability를 분리한다.
6. automation level보다 공동 시스템의 OPD+C 성능으로 설계를 평가한다.

## 7. What must not be copied

- 로봇의 물리적 실시간 제어 요구를 소프트웨어 작업에 그대로 적용
- 모든 내부 reasoning 공개를 Observability로 오해
- Directability를 micromanagement UI로 구현
- 사람과 agent를 대칭적 책임 주체로 표현
- 친근한 persona를 teamwork capability로 대체

## 8. Failure modes

- **Strong but silent**: 잘 실행하지만 상태·의도 feedback이 부족
- **Predictable but brittle**: 정해진 경로는 보이나 변화 대응 불가
- **Directable but costly**: 방향 수정에 전체 context 재구성 필요
- **Explainable but uncontestable**: 이유는 보이나 전제와 결정을 바꿀 수 없음
- **Dependency blindness**: agent 독립 성능은 높지만 팀 상호작용에서 실패

## 9. Falsifiable Helm hypotheses

### CD-H1

OPD+C 정보를 제공하면 단순 progress percentage보다 사용자의 agent next-action 예측과 방향 수정 정확도가 높을 것이다.

### CD-H2

interdependence map은 agent별 capability list보다 handoff와 integration failure를 더 잘 예측할 것이다.

### CD-H3

Contestability action이 있는 Recommendation은 explanation-only 조건보다 결과 개선과 calibrated trust를 높일 것이다.

## 10. Prototype

- 같은 WorkUnit을 progress-only, explanation, OPD+C view로 제시한다.
- 중간에 Purpose/Constraint 변경을 주입하고 사용자가 방향을 수정하게 한다.
- agent Claim에 Counterevidence를 연결해 challenge–experiment–reopen 경로를 관찰한다.

## 11. Metrics

- next-action prediction accuracy
- redirection latency and cost
- dependency-related failure
- challenge rate and outcome improvement
- automation surprise
- trust calibration
- user sense of agency

## 12. Sources

- [TU Delft: Coactive Design](https://repository.tudelft.nl/record/uuid%3A35cfe91a-bd59-427d-89a9-e2019f9b0c28)
- [Coactive Design: Why Interdependence Must Shape Autonomy](https://jeffreymbradshaw.net/publications/20101008_CoactiveDesign.pdf)

## 13. Open questions

- software agent의 intent와 prediction을 얼마나 안정적으로 추출할 수 있는가?
- Contestability가 사용자 agency를 높이는 최소 인터페이스는 무엇인가?
- interdependence map 유지 비용이 실제 integration defect 감소를 정당화하는가?

