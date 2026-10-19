# Method Card: Incident Command and Common Operating Picture

- Domain: emergency and incident management
- Evidence status: operational framework established; Helm transfer exploratory
- Primary Helm bundle: Situation Recovery
- Candidate primitives: `CommonOperatingPicture`, `OperationalPeriod`, `Workstream`, `SpanPolicy`, `Handoff`

## 1. Original problem

재난과 대형 사건에서는 여러 조직이 불완전하고 빠르게 변하는 정보 아래에서 동시에 행동한다. 공통 용어, 목표, 역할, 통신, 자원, 운영 주기가 맞지 않으면 각 팀이 유능해도 전체 대응이 충돌한다.

FEMA의 Incident Command System은 공통 용어, 목표에 의한 관리, incident action planning, 관리 가능한 통제 범위, 통합된 통신과 자원 관리를 제공한다.

## 2. Environmental assumptions

- 상황이 빠르게 변하고 초기 정보가 불완전하다.
- 복수 조직과 전문 역할이 임시로 결합한다.
- 지휘 구조와 책임이 사건 동안 변할 수 있다.
- 운영자는 제한된 수의 직접 보고만 효과적으로 관리할 수 있다.
- handoff와 operational period 경계가 중요하다.

## 3. Domain-invariant mechanisms

### Common terminology

동일한 상태와 역할을 서로 다른 이름으로 부르는 조정 비용을 줄인다.

### Management by objectives

개별 활동보다 현재 운영 기간의 명확한 목표와 우선순위를 정렬한다.

### Common Operating Picture

각 팀의 모든 세부 정보를 합치는 것이 아니라 공동 판단에 필요한 사건 수준의 상태를 유지한다.

### Manageable span

한 감독자가 직접 조정하는 활성 단위 수를 제한하고 필요할 때 계층화한다.

### Operational periods and handoff

지속적인 흐름을 명시적 검토·계획·책임 이전 주기로 나눈다.

## 4. Helm problem explained

여러 에이전트를 동시에 실행할 때 사용자는 각 run을 직접 관리 대상으로 인식한다. run 수가 증가하면 상태 확인과 방향 조정이 인간의 통제 범위를 넘는다. 또한 세션 경계마다 전체 상황을 새로 구성해야 한다.

## 5. Transfer to Helm

| ICS mechanism | Helm primitive |
|---|---|
| Common terminology | shared ontology and Event vocabulary |
| Objectives | active Purpose and operational goals |
| Common Operating Picture | workspace projection |
| Span of control | Workstream grouping and attention capacity |
| Operational period | review window / checkpoint cadence |
| Incident Action Plan | bounded set of active Commitments |
| Transfer of command | explicit responsibility handoff |

## 6. Transfer rules

1. 사용자에게 모든 agent run을 평면 목록으로 직접 보고하지 않는다.
2. WorkUnit을 Purpose, dependency, risk에 따라 관리 가능한 Workstream으로 묶는다.
3. Common Operating Picture는 공통 결정에 필요한 상태만 포함한다.
4. 운영 주기마다 목표, 열린 위험, 권한, 다음 Gate를 갱신한다.
5. 책임 이전은 정보뿐 아니라 authority와 unresolved obligation을 함께 넘긴다.
6. span 임계치는 `5` 같은 고정값으로 복사하지 않고 pilot에서 측정한다.

## 7. What must not be copied

- 일반 제품 개발을 비상 지휘 체계처럼 운영하기
- 모든 workspace에 단일 지휘관과 위계 조직 강요
- 팀 구조를 실제 조직도와 동일하게 고정
- 정해진 span 숫자를 소프트웨어에 하드코딩
- 보고 양식을 늘려 상황 공유가 자동 개선된다고 보기

## 8. Failure modes

- **Flat overload**: 모든 agent가 사용자에게 직접 보고
- **Competing pictures**: dashboard, docs, chat이 서로 다른 현재 상태를 표시
- **Objective drift**: agent activity가 현재 운영 목표와 분리
- **Handoff gap**: 정보는 전달됐지만 책임과 권한이 불분명
- **Permanent incident mode**: 모든 작업을 높은 긴급도로 운영하여 피로 발생

## 9. Falsifiable Helm hypotheses

### ICS-H1

Purpose/Workstream으로 묶인 Common Operating Picture는 평면 agent-run 목록보다 사용자 오류와 orientation time을 줄일 것이다.

### ICS-H2

operational-period handoff는 비정형 세션 요약보다 미해결 obligation 누락을 줄일 것이다.

### ICS-H3

사용자별 active Workstream 수를 제한하면 총 agent 병렬성은 유지하면서 false escalation과 방향 이탈이 감소할 것이다.

## 10. Prototype

- 동일한 6개 WorkUnit을 flat run list와 2–3개 Workstream view로 제시한다.
- 사용자가 Purpose, 위험, owner, 다음 Gate를 얼마나 정확히 복원하는지 비교한다.
- 세션 종료 시 정보만 넘기는 handoff와 authority/obligation 포함 handoff를 비교한다.

## 11. Metrics

- direct-report count
- orientation time
- workstream ownership errors
- missed obligation at handoff
- conflicting-state incidents
- active objective recall
- false urgency rate

## 12. Sources

- [FEMA: ICS Management Characteristics](https://emilms.fema.gov/is_0552/groups/51.html)
- [FEMA: Manageable Span of Control](https://emilms.fema.gov/_is0200c/groups/376.html)

## 13. Open questions

- agent run, WorkUnit, Workstream 중 무엇이 실제 인간 통제 단위여야 하는가?
- 사용자가 관리할 수 있는 span은 전문성·위험·표현 품질에 따라 어떻게 변하는가?
- incident mode와 normal mode 사이의 전환 조건은 무엇인가?

