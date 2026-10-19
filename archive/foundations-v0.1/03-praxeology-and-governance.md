# Praxeology and Governance: 누가 무엇을 어떻게 행하는가

## 1. 행위의 기본 단위

Helm에서 실행의 기본 단위는 명령이 아니라 **정당한 권한 아래 생성된 Commitment**다.

프롬프트는 요청, 질문, 제안, 경고, 수락, 거부 중 무엇인지 불분명할 수 있다. 언어행위론의 관점에서 협업은 정보 교환보다 이런 발화가 만드는 약속과 의무의 상태 변화로 성립한다. Terry Winograd의 Language/Action 접근은 조직적 일을 요청과 약속이 이어지는 conversation for action으로 모델링한다. [A Language/Action Perspective on Cooperative Work](https://www.lri.fr/~mbl/ENS/CSCW/2017/papers/Winograd-CSCW86.pdf)

## 2. Conversation for Action

Helm의 위임은 다음 상태기계를 따른다.

```text
Request
  ├─ Reject ───────────────────────────────→ Closed
  ├─ Clarify/Counter ─→ Negotiate ─────────┐
  └─ Accept ───────────────────────────────┤
                                           ↓
                                       Committed
                                           ↓
                                       Performing
                                           ↓
                                  Claiming Satisfaction
                                      ├─ Reject/Correct → Performing
                                      └─ Accept         → Accepted
                                                             ↓
                                                         Integrated
                                                             ↓
                                                           Closed
```

이 상태기계의 목적은 관료적 절차가 아니라 다음 혼동을 방지하는 것이다.

- 요청을 합의로 착각
- 계획을 약속으로 착각
- 실행 종료를 완료로 착각
- 완료 주장을 검증된 완료로 착각
- 지역적 수락을 전체 통합으로 착각

## 3. Delegation Contract

모든 자율 실행은 명시적 또는 정책으로 파생된 Delegation Contract 안에서 수행한다.

```yaml
delegation_contract:
  requester: human-or-collective-id
  performer: agent-id
  purpose: purpose-id
  work_unit: work-unit-id
  conditions_of_satisfaction:
    - criterion-id
  authority_envelope:
    scopes: []
    allowed_actions: []
    forbidden_actions: []
    resource_limits: {}
    external_side_effects: false
  evidence_obligations: []
  escalation_triggers: []
  acceptor: actor-or-policy-id
  integration_target: concern-or-artifact-id
  review_at: timestamp-or-condition
```

Contract는 모든 필드를 사람이 직접 입력해야 한다는 뜻이 아니다. Helm이 Purpose, 정책, 과거 결정에서 초안을 생성하고 사용자는 중요한 차이만 확인할 수 있다.

## 4. 권한과 책임

Helm은 다음을 구분한다.

- **Capability**: 실제로 무엇을 할 수 있는가
- **Permission**: 무엇을 하도록 허용되었는가
- **Authority**: 어떤 범위에서 다른 상태를 규범적으로 변경할 수 있는가
- **Responsibility**: 무엇을 수행하거나 감시할 의무가 있는가
- **Accountability**: 결과에 대해 설명하고 받아들일 최종 책임이 누구에게 있는가

에이전트가 기술적으로 파일을 삭제할 수 있어도 삭제 권한이 있다는 뜻은 아니다. 사용자가 “알아서 해”라고 말했어도 비가역적 외부 변경까지 포괄적으로 승인한 것으로 확장해서는 안 된다.

## 5. Authority Envelope

자율성은 에이전트의 고정 등급이 아니라 WorkUnit별 권한 범위다.

Authority Envelope는 다음 차원으로 구성한다.

- **Scope**: 어떤 Concern, Artifact, 환경에 적용되는가
- **Action class**: 읽기, 제안, 로컬 변경, 배포, 외부 메시지 등
- **Reversibility**: 쉽게 되돌릴 수 있는가
- **Blast radius**: 다른 작업·사용자·시스템에 미치는 범위
- **Observability**: 실행과 결과를 충분히 볼 수 있는가
- **Testability**: 성공과 실패를 자동으로 검증할 수 있는가
- **Uncertainty**: 환경과 결과에 대한 무지가 얼마나 큰가
- **Value sensitivity**: 기술적 기준 외 인간 가치 판단이 필요한가
- **Temporal boundary**: 언제까지 또는 어떤 사건 전까지 유효한가

## 6. 사용자 개입 필요도

초기 버전에서는 정밀 점수보다 설명 가능한 휴리스틱을 사용한다.

```text
need_for_human_deliberation increases with:
  stakes
  + irreversibility
  + uncertainty
  + cross-system coupling
  + normative disagreement
  + agent disagreement

need_for_human_deliberation decreases with:
  reversibility
  + observability
  + testability
  + proven policy coverage
```

이 값은 자동 승인 여부를 결정하는 단일 숫자가 아니라 Gate 생성의 근거다.

## 7. 보충성 및 예외 관리

결정은 가능한 한 문제와 전문성에 가까운 가장 낮은 유능한 수준에서 이루어진다. 상위 사용자는 다음 경우에 개입한다.

- 하위 권한 범위를 초과함
- 목적 또는 가치가 충돌함
- 여러 Concern의 기준선을 함께 변경함
- 가역성이 낮음
- Evidence가 서로 모순됨
- 정책이 적용되지 않는 새로운 상황임
- 실패의 파급 범위가 임계치를 넘음

미군의 Mission Command는 상위 의도와 제약을 명확히 하면서 세부 행동을 분산하고, FEMA의 Incident Command System은 공통 상황도·목표 관리·통제 범위를 통해 복수 팀을 조정한다. Helm은 군사적 위계가 아니라 **중앙의 목적 일관성과 지역의 판단 자율성**을 차용한다. [Understanding Mission Command](https://www.army.mil/article/106872/understanding_mission_command), [FEMA ICS](https://emilms.fema.gov/is_0552/groups/51.html)

## 8. Decision의 상태

```text
Open
  → Framed
  → AlternativesIdentified
  → Deliberating
  → Committed
  → Implementing
  → Validated
  → Integrated
  → Superseded/Reopened
```

Decision은 다음을 보존한다.

- decision question
- why now
- decision owner
- alternatives
- evaluation criteria
- supporting and counterevidence
- assumptions and uncertainty
- reversibility and blast radius
- selected option
- consequences
- dissent
- implementation commitments
- review and reopen triggers

## 9. 실패·철회·재협상

Commitment는 지켜지거나 실패하는 두 상태만 갖지 않는다.

- 조건이 불명확하면 재협상할 수 있다.
- 환경이 바뀌면 범위와 기한을 수정할 수 있다.
- 권한 밖의 문제가 발견되면 상향할 수 있다.
- 수행자가 능력 부족을 발견하면 이관할 수 있다.
- 요청자는 가치가 사라지면 철회할 수 있다.
- 부분 결과가 가치 있으면 조건부 수락할 수 있다.

중요한 것은 변경을 조용히 덮어쓰지 않고 누가 무엇을 왜 바꿨는지 Event로 남기는 것이다.

## 10. 통치 불변조건

1. 어떤 자율 실행도 유효한 Authority Envelope를 가져야 한다.
2. 권한 범위는 도구 능력보다 좁거나 같아야 한다.
3. 규범적 판단을 사실 추론으로 위장해서는 안 된다.
4. 완료 선언자와 수락자는 고위험 작업에서 독립적이어야 한다.
5. 비가역적 외부 행위는 명시적 권한 또는 충분히 구체적인 승인 정책을 요구한다.
6. 에이전트는 불확실성이나 권한 초과를 숨기기보다 Escalation Event를 생성해야 한다.
7. Decision의 변경은 기존 결정을 수정하는 대신 supersede/reopen 관계로 남겨야 한다.
8. 인간은 언제든 ProblemFrame, Purpose, Constraint를 재검토할 수 있지만 그 변경의 파급 효과를 확인해야 한다.

