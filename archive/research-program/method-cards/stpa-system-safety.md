# Method Card: STPA and Systems-Theoretic Safety

- Domain: system safety engineering, control theory
- Evidence status: established safety analysis method; Helm low-risk tailoring exploratory
- Primary Helm bundle: Acceptance & Integration
- Candidate primitives: `Loss`, `Hazard`, `SafetyConstraint`, `ControlAction`, `ControlStructure`

## 1. Original problem

전통적 안전 분석은 부품 고장과 그 조합을 중심으로 보는 경우가 많다. 그러나 소프트웨어, 인간, 조직이 결합된 복잡한 시스템은 각 부품이 명세대로 동작해도 잘못된 상호작용과 통제 행동 때문에 사고가 발생할 수 있다.

STPA는 바람직하지 않은 Loss, Hazard, Safety Constraint, Control Structure를 정의하고, 어떤 control action이 제공되지 않거나 잘못 제공되거나 잘못된 시간·기간으로 제공되어 위험해지는지 분석한다.

## 2. Environmental assumptions

- 사고가 단일 부품 고장보다 상호작용에서 발생할 수 있다.
- software와 조직 결정이 통제 구조의 일부다.
- 안전은 단순 신뢰도가 아니라 제약의 적절한 집행 문제다.
- controller는 불완전한 process model을 가질 수 있다.
- 같은 action도 context와 timing에 따라 안전하거나 위험하다.

## 3. Domain-invariant mechanisms

### Loss-oriented framing

피해야 할 실제 손실과 이해관계자 영향을 먼저 정의한다.

### Hazard and constraint

어떤 시스템 상태가 Loss로 이어질 수 있는지와 이를 방지할 제약을 정의한다.

### Control structure

누가 무엇을 제어하고 어떤 feedback을 받는지 관계로 모델링한다.

### Unsafe control action

행동 제공 여부뿐 아니라 잘못된 timing, duration, context를 분석한다.

### Inadequate process model

controller가 실제 상태를 잘못 이해해 올바르지 않은 action을 선택할 수 있다.

## 4. Helm problem explained

에이전트가 허용된 tool을 정상 호출해도 잘못된 시점, 범위, 목적 아래 실행하면 위험하다. 각 agent가 local test를 통과해도 권한과 feedback 구조가 부적절하면 시스템 수준 Loss가 발생한다.

## 5. Transfer to Helm

| STPA concept | Helm primitive |
|---|---|
| Loss | unacceptable project/user consequence |
| Hazard | system state that can lead to Loss |
| Safety constraint | protected baseline / governance policy |
| Controller | human, agent, policy, tool |
| Controlled process | WorkUnit, Artifact, environment |
| Control action | Decision, delegation, tool action, acceptance |
| Feedback | Event, Evidence, Return Brief |
| Process model | SituationModel / ContextProjection |

## 6. Transfer rules

1. 고위험 WorkUnit은 tool permission 목록보다 먼저 unacceptable Loss를 정의한다.
2. action의 존재뿐 아니라 context, timing, duration을 검토한다.
3. 인간도 control structure 안의 controller이며 불완전한 SituationModel을 가질 수 있다.
4. feedback 누락과 stale Context를 안전 위험으로 다룬다.
5. local component reliability가 system safety를 증명하지 않는다는 점을 보존한다.
6. STPA 깊이는 외부 부작용·규제·안전·데이터 위험이 큰 작업에 제한한다.

## 7. What must not be copied

- 모든 일반 WorkUnit에 전체 STPA 분석 요구
- 프로젝트 불편을 생명 안전 Loss와 동일한 언어로 과장
- SafetyConstraint를 혁신을 막는 영구 금지로 사용
- control model이 현실을 완전히 표현한다고 가정
- 분석 문서 존재를 실제 runtime enforcement로 착각

## 8. Failure modes

- **Allowed but unsafe**: 권한 내 action이 잘못된 context에서 실행
- **Missing feedback**: 사용자가 실행 상태를 몰라 잘못된 Decision
- **Stale process model**: agent Context가 현재 baseline과 다름
- **Local safety illusion**: 각 WorkUnit은 안전하지만 조합이 위험
- **Constraint decay**: 환경 변경 후 정책이 실제 Loss를 막지 못함

## 9. Falsifiable Helm hypotheses

### STPA-H1

고위험 Delegation에서 control structure와 feedback을 명시하면 permission-only review보다 unsafe control action 발견률이 높을 것이다.

### STPA-H2

Context freshness와 feedback gap을 Hazard로 모델링하면 stale-context failure가 acceptance 전에 더 많이 발견될 것이다.

### STPA-H3

system-level Loss framing은 WorkUnit별 risk list보다 cross-agent interaction hazard를 더 많이 발견할 것이다.

## 10. Prototype

- 외부 배포 또는 data migration WorkUnit을 permission review와 STPA-lite view로 분석한다.
- 정상 권한이지만 잘못된 timing/context인 action을 삽입한다.
- 어떤 condition이 Hazard를 탐지하는지 비교한다.

## 11. Metrics

- unsafe control action detected
- feedback gap detected
- cross-work-unit hazard
- stale process model incident
- analysis time
- false hazard burden
- prevented high-consequence action

## 12. Sources

- [MIT OpenCourseWare: System Safety](https://ocw.mit.edu/courses/16-863j-system-safety-spring-2016/download/)
- [MIT Partnership for Systems Approaches to Safety: Books and Handbooks](https://psas.scripts.mit.edu/home/books-and-handbooks/)

## 13. Open questions

- software 제품에서 Loss와 일반 quality defect의 경계를 어떻게 정할 것인가?
- dynamic agent plans의 control structure를 실시간으로 얼마나 정확히 유지할 수 있는가?
- STPA-lite가 실제로 기존 threat model/risk review보다 추가 가치를 제공하는가?

