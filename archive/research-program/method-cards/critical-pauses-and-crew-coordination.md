# Method Card: Critical Pauses and Crew Coordination

- Domain: surgery, healthcare teamwork, aviation crew resource management
- Evidence status: established safety and teamwork practice; Helm transfer exploratory
- Primary Helm bundle: Acceptance & Integration
- Candidate primitives: `PhaseBoundary`, `Brief`, `Check`, `CheckBack`, `Huddle`, `Debrief`

## 1. Original problem

항공과 수술에서는 개인이 각자 전문적이어도 중요한 단계 전환에서 역할, 상태, 계획, 위험을 공유하지 못해 실패할 수 있다. 모든 행동을 이중 확인하면 운영이 마비되지만, 절개·이륙·인수인계 같은 특정 경계의 누락은 큰 피해를 만든다.

WHO Surgical Safety Checklist는 중요한 수술 단계에서 팀이 잠시 멈춰 확인하도록 하며, Crew Resource Management와 TeamSTEPPS는 brief, call-out, check-back, workload management, assertion, debrief를 통해 공동 상황과 의사소통을 개선한다.

## 2. Environmental assumptions

- 단계 전환에서 오류 비용이 급격히 커진다.
- 복수 전문 역할이 서로 다른 정보를 가진다.
- 권위 차이 때문에 중요한 이견이 말해지지 않을 수 있다.
- 시간 압력 아래 긴 절차는 형식화되기 쉽다.
- 짧은 공동 pause가 큰 오류를 예방할 수 있다.

## 3. Domain-invariant mechanisms

### Critical boundary pause

모든 순간이 아니라 되돌리기 어려운 단계 직전에 공동 확인한다.

### Shared plan and role check

목적, 다음 행동, 역할, 예상 위험을 짧게 정렬한다.

### Closed-loop communication

전달, 수신 확인, 필요한 수정이 완료될 때까지 통신을 닫는다.

### Speaking up and assertion

권위와 합의 압력에도 중요한 우려를 표면화할 경로를 제공한다.

### Debrief

성과와 조정 실패를 다음 운영 규칙에 반영한다.

## 4. Helm problem explained

에이전트 작업에서 모든 tool call을 승인하면 피로가 발생한다. 반대로 architecture baseline 변경, 외부 배포, 데이터 migration, 여러 WorkUnit 통합 전에 pause가 없으면 지역 결정이 전체를 비가역적으로 바꾼다.

## 5. Transfer to Helm

| Coordination mechanism | Helm primitive |
|---|---|
| Sign-in / brief | Purpose, roles, Contract check |
| Time-out | pre-irreversible Decision Gate |
| Sign-out | Claim, Evidence, handoff, remaining obligation |
| Call-out | urgent exception/weak signal |
| Check-back | acknowledged and corrected communication |
| Huddle | short reframe/replan session |
| Debrief | Reflection and policy update |

## 6. Transfer rules

1. pause는 risk, irreversibility, coupling이 증가하는 phase boundary에만 둔다.
2. check는 예/아니오 목록보다 현재 작업에 맞는 named risk와 owner를 포함한다.
3. 사람 또는 agent가 “stop”과 dissent를 안전하게 제기할 수 있어야 한다.
4. check-back은 단순 read receipt가 아니라 이해한 상태와 next action 확인이다.
5. 반복적으로 영향 없는 checklist item은 제거하거나 정책화한다.
6. debrief 결과가 Context, Contract, Gate policy 중 하나를 실제 변경해야 한다.

## 7. What must not be copied

- 수술/항공 체크리스트 문구를 일반 코딩에 그대로 사용
- 모든 phase에 Gate 삽입
- checkbox 완료를 실제 이해와 검증으로 착각
- 권위 문제를 UI 버튼 하나로 해결됐다고 보기
- debrief를 학습 없는 회고 문서로 남기기

## 8. Failure modes

- **Checklist fatigue**: 같은 항목을 습관적으로 승인
- **Approval theater**: 실질적 선택 없이 pause만 추가
- **Late pause**: 이미 비가역 변경 후 확인
- **Muted dissent**: agent minority view와 사용자 우려가 나타나지 않음
- **Open-loop handoff**: 전달했지만 수신 이해가 확인되지 않음

## 9. Falsifiable Helm hypotheses

### CPC-H1

위험 기반 phase-boundary Gate는 every-action approval보다 낮은 workload로 같은 수준 이상의 consequential defect를 예방할 것이다.

### CPC-H2

check-back을 포함한 handoff는 read receipt보다 wrong-next-action을 줄일 것이다.

### CPC-H3

명시적 dissent action은 다수 agent summary보다 중요한 반대 의견의 acceptance review 반영률을 높일 것이다.

## 10. Prototype

- 같은 workflow에 no pause, every-step approval, critical-boundary pause 조건을 비교한다.
- irreversible change 직전 숨은 충돌을 삽입한다.
- handoff에서 수신자의 plan reconstruction과 check-back 수정을 기록한다.

## 11. Metrics

- number and duration of pauses
- consequential defect prevented
- false/ritual confirmation
- wrong-next-action after handoff
- dissent surfaced and acted upon
- NASA-TLX frustration/mental demand
- debrief-to-policy conversion

## 12. Sources

- [WHO: Clinical Checklists](https://www.who.int/tools/clinical-checklists)
- [WHO: Safe Surgery Tools and Resources](https://www.who.int/teams/integrated-health-services/patient-safety/research/safe-surgery/tool-and-resources)
- [FAA: Crew Resource Management](https://www.faa.gov/documentLibrary/media/Advisory_Circular/AC_120-35D.pdf)
- [AHRQ: TeamSTEPPS Tools](https://www.ahrq.gov/teamstepps-program/resources/modules/index.html)

## 13. Open questions

- 비가역성·coupling의 변화로 phase boundary를 동적으로 어떻게 감지할 것인가?
- 반복 checklist item의 유효성을 어떤 데이터로 제거할 것인가?
- agent dissent가 실제 독립 관점인지 생성 다양성 노이즈인지 어떻게 구분할 것인가?

