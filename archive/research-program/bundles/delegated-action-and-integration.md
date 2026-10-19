# Bundle Synthesis: Delegated Joint Action × Acceptance & Integration

> Status: research synthesis v0.1  
> Scope: 판단을 유효한 위임·실행으로 만들고, 지역 결과를 책임 있게 수락·통합하는 10개 Method Card의 공통 메커니즘

## 1. 결론

Delegated Joint Action과 Acceptance & Integration은 task execution의 앞뒤 단계가 아니다. 두 Bundle은 하나의 책임 폐루프다.

```text
Purpose and Decision
  → Request and negotiation
  → bounded Commitment
  → interdependent execution
  → completion Claim
  → evidence-backed Acceptance
  → system Integration
  → operational Outcome
  → recovery, learning, and policy revision
```

위임이 Integration과 연결되지 않으면 수행자는 지역 완료만 최적화한다. Integration이 위임의 Intent와 Authority를 보지 않으면 결과의 근거와 책임을 사후에 재구성해야 한다.

## 2. 10개 방법의 역할

| Method | Helm에 제공하는 핵심 질문 |
|---|---|
| Speech Acts / Conversation for Action | 어떤 대화가 요청·약속·완료·수락 상태를 바꾸는가? |
| Mission Command | 상위 목적을 보존하면서 세부 실행을 어떻게 분산하는가? |
| Subsidiarity | 어떤 Decision을 어느 유능한 수준에 둘 것인가? |
| Management by Exception | 무엇을 자율 처리하고 어떤 편차만 상향할 것인가? |
| Coactive Design | 인간과 agent의 상호의존성을 어떻게 관측·예측·지시·이의 제기할 수 있게 하는가? |
| Systems Engineering | 지역 Outcome을 Purpose·Requirement·Interface와 어떻게 정렬하는가? |
| High Reliability Organizations | 작은 실패 신호와 dissent를 어떻게 보존하는가? |
| Critical Pauses / Crew Coordination | 어느 단계 경계에서 짧은 공동 확인이 필요한가? |
| STPA | 정상 작동하는 구성 요소들의 상호작용이 어떻게 시스템 Loss를 만드는가? |
| Resilience Engineering | 예상 밖 변화 속에서 어떻게 응답·감시·학습·예측 능력을 유지하는가? |

## 3. 반복해서 나타난 열 가지 메커니즘

### M1. Language changes obligations

자연어는 정보뿐 아니라 요청, Commitment, 수락, 철회를 만든다.

제품 결론:

- message와 normative transition을 분리한다.
- Request, Commitment, ClaimingComplete, Acceptance를 다른 상태로 둔다.

### M2. Intent governs local action

변화하는 환경에서 세부 procedure보다 why, desired end state, protected value가 local initiative를 안내한다.

제품 결론:

- DelegationContract에 Purpose, end state, non-goal, protected baseline을 포함한다.
- agent가 Intent를 재구성하고 모순을 제기할 check-back을 지원한다.

### M3. Authority belongs at the lowest competent level

인간이 최종 책임자라는 사실은 모든 구현 선택을 인간이 해야 한다는 뜻이 아니다.

제품 결론:

- Decision마다 competence scope와 why-escalated를 기록한다.
- 반복적으로 성공한 local Decision은 정책으로 내려 보낸다.

### M4. Attention is allocated by exception

모든 진행이 아니라 예상 범위를 벗어나고 결과를 바꿀 수 있는 변화가 상향된다.

제품 결론:

- expected range, materiality, last-cheap-point를 Gate 근거로 사용한다.
- threshold 밖의 anomaly와 taxonomy 밖의 Surprise를 구분한다.

### M5. Interdependence shapes autonomy

agent의 독립 성능보다 인간·agent·tool이 서로 무엇에 의존하는지가 공동 결과를 결정한다.

제품 결론:

- OPD+C를 WorkUnit와 UX 평가 기준으로 사용한다.
- autonomy level보다 dependency와 redirection cost를 측정한다.

### M6. Acceptance is a distinct normative act

완료 주장은 수행자의 발화이고 수락은 권한 있는 Actor의 Commitment다.

제품 결론:

- Conditions of satisfaction, Evidence obligation, acceptor가 필요하다.
- 조건부 수락, correction, reopen을 정상 경로로 지원한다.

### M7. Integration is system-level alignment

merge와 local verification은 전체 Purpose 적합성, interface, baseline 정합성을 보장하지 않는다.

제품 결론:

- verification과 validation을 분리한다.
- Normative/Epistemic/Material change impact를 함께 본다.

### M8. Critical transitions deserve pauses

모든 action을 승인하지 않되 비가역성·coupling이 급증하는 경계에서 공동 확인한다.

제품 결론:

- Gate는 phase boundary와 last-cheap-point를 알아야 한다.
- check-back과 dissent action이 pause에 포함되어야 한다.

### M9. Weak signals and interaction hazards matter

각 agent가 정상 작동해도 feedback, timing, shared Assumption의 결함으로 전체 실패가 발생할 수 있다.

제품 결론:

- near miss, unexplained correction, dissent를 보존한다.
- 고위험 작업은 control action과 feedback gap을 분석한다.

### M10. Completion must create future adaptive capacity

현재 기준 충족만으로 충분하지 않다. 다음 변화에 응답·감시·학습·예측할 능력이 남아야 한다.

제품 결론:

- Integration Review에 recovery path, reopen trigger, Reflection을 포함한다.
- 회고는 Context, Contract, Policy 중 하나를 실제로 변경해야 한다.

## 4. 핵심 긴장과 설계 균형

### Exception attenuation vs weak-signal amplification

- Management by Exception은 정상 정보를 압축하라고 한다.
- HRO는 작은 실패 신호를 놓치지 말라고 한다.

설계 균형:

> 빈도나 편차 크기가 아니라 Purpose 영향, 새로움, 반복 correction, Decision을 바꿀 가능성으로 신호를 선택한다.

### Local initiative vs baseline coherence

- Mission Command와 Subsidiarity는 지역 판단을 요구한다.
- Systems Engineering은 전체 기준선과 interface 정합성을 요구한다.

설계 균형:

> 지역 Actor는 실행 방법을 선택하되 공유 Purpose·protected baseline·cross-boundary interface 변경은 상향한다.

### Assurance depth vs delivery speed

- Assurance, STPA, HRO는 깊은 검토를 요구할 수 있다.
- 낮은 위험 작업까지 같은 절차를 적용하면 가치가 사라진다.

설계 균형:

> stakes, irreversibility, coupling, recoverability로 assurance depth를 조절한다.

### Directability vs micromanagement

- 사용자는 방향을 바꿀 수 있어야 한다.
- 계속 세부 action을 지시하면 자율성과 인간 attention이 붕괴한다.

설계 균형:

> Intent, Constraint, Criterion, priority를 수정하고 수행 방법은 local level에 남긴다.

### Standardization vs adaptation

- Contract, checklist, policy는 조정 비용을 낮춘다.
- 예상 밖 상황은 표준 밖의 adaptation을 요구한다.

설계 균형:

> 표준은 safe envelope를 제공하고, 벗어난 adaptation은 Event·Outcome·Reflection으로 정책을 갱신한다.

## 5. Bundle C/D의 최소 의미 객체

첫 pilot에서 다음 객체를 A/B 객체에 추가 관찰한다.

```text
Request
DelegationContract
AuthorityEnvelope
AcceptanceCriterion
Exception
Handoff
Interface
Integration
Reflection
```

고위험 pilot에서만 다음을 승격한다.

```text
Loss
Hazard
SafetyConstraint
ControlAction
RecoveryPath
```

## 6. 후보 Event vocabulary

```text
request.created
request.countered
request.withdrawn
commitment.offered
commitment.accepted
commitment.renegotiated
commitment.breached
authority.granted
authority.exceeded
exception.detected
exception.resolved_locally
exception.escalated
direction.changed
work.claimed_complete
work.correction_requested
work.accepted
handoff.initiated
handoff.acknowledged
integration.started
integration.conflict_detected
integration.validated
baseline.updated
near_miss.recorded
decision.reopened
reflection.applied
```

이 Event 이름은 안정 API가 아니라 paper/sidecar 관찰 어휘다.

## 7. Paper prototype field justification

### Delegation Contract

- `Intent`: Mission Command
- `Conditions of satisfaction`: Conversation for Action + Assurance
- `Authority Envelope`: Mission Command + Subsidiarity
- `Escalation Trigger`: Management by Exception
- `Coordination obligations`: Coactive Design
- `Completion Claim`: Speech Acts + Assurance
- `Acceptance and Integration`: Systems Engineering

### Decision Gate

- `Why now` / `last cheap point`: critical phase pause
- `Gate reason`: exception and cross-boundary authority
- `Options`: local action, escalation, experiment, defer
- `Counterevidence`: HRO reluctance to simplify
- `Consequences`: system-level Loss and interface impact
- `Impact feedback`: resilience learning

### Return Brief

- `Active commitments`: conversation state
- `Expected action`: predictability
- `Escalation condition`: management by exception
- `Weak signals`: HRO
- `Recovery and reopen`: resilience

### Integration Review

- Purpose trace and interface consistency
- verification vs validation
- Claim–Evidence coverage
- near miss and dissent
- recovery readiness and Reflection

## 8. Bundle-level hypotheses

### CD-H1 — Intent plus envelope outperforms instruction extremes

Intent와 Authority Envelope를 함께 제공한 Contract는 step-by-step micromanagement와 vague autonomy 모두보다 변화 상황에서 Purpose 적합 결과를 높일 것이다.

### CD-H2 — Lowest competent decision reduces approval labor

Subsidiarity와 exception policy는 consequential human intervention을 유지하면서 총 Gate와 decision latency를 줄일 것이다.

### CD-H3 — OPD+C predicts teamwork failure

Observability, Predictability, Directability, Contestability 결함은 개별 agent task accuracy보다 handoff/integration failure를 더 잘 예측할 것이다.

### CD-H4 — Critical pauses dominate ubiquitous approvals

위험 기반 phase-boundary Gate는 every-action approval보다 낮은 workload로 같은 수준 이상의 consequential defect를 예방할 것이다.

### CD-H5 — Acceptance and integration separation exposes hidden work

ClaimingComplete, Accepted, Integrated를 분리하면 기존 task-done 조건보다 미해결 obligation과 system conflict가 더 일찍 드러날 것이다.

### CD-H6 — Adaptive closure improves future work

RecoveryPath와 applied Reflection을 포함한 Integration은 pass/fail closure보다 다음 유사 예외의 처리 시간과 재작업을 줄일 것이다.

## 9. 첫 dogfood에서 관찰할 결정적 사건

1. agent가 Request 조건에 counteroffer 또는 clarification을 생성하는가?
2. 사용자가 세부 수행법이 아니라 Intent·Constraint·Criterion을 수정하는가?
3. local Decision이 불필요하게 Gate로 상향되거나 반대로 cross-boundary 변경이 조용히 실행되는가?
4. Exception이 last-cheap-point 전에 드러나는가?
5. 완료 Claim을 사용자가 Evidence 부족으로 correction 요청하는가?
6. Acceptance 이후 Integration에서 새로운 의미 충돌이 발견되는가?
7. near miss와 dissent가 다음 Contract 또는 Policy를 실제로 바꾸는가?

## 10. 아직 결정하지 말아야 할 것

- 모든 speech act의 자동 분류 taxonomy
- agent competence의 단일 점수
- 고정 autonomy level
- 전역 exception threshold
- 모든 작업에 공통인 checklist
- 완전한 STPA runtime model
- formal assurance graph의 필수 범위
- 조직 hierarchy와 Helm Decision level의 직접 매핑
- 자동 policy learning과 권한 확대

## 11. Traceability

### Method Cards

- [Speech Acts and Conversations for Action](../method-cards/speech-acts-and-conversations-for-action.md)
- [Mission Command](../method-cards/mission-command.md)
- [Subsidiarity](../method-cards/subsidiarity.md)
- [Management by Exception](../method-cards/management-by-exception.md)
- [Coactive Design](../method-cards/coactive-design.md)
- [Systems Engineering and Integration](../method-cards/systems-engineering-integration.md)
- [High Reliability Organizations](../method-cards/high-reliability-organizations.md)
- [Critical Pauses and Crew Coordination](../method-cards/critical-pauses-and-crew-coordination.md)
- [STPA and Systems-Theoretic Safety](../method-cards/stpa-system-safety.md)
- [Resilience Engineering](../method-cards/resilience-engineering.md)

### Product artifacts

- [Praxeology and Governance](../../foundations/03-praxeology-and-governance.md)
- [Co-agency](../../foundations/04-co-agency.md)
- [Formal State Model](../../foundations/05-formal-state-model.md)
- [Paper Prototype v0](../../prototypes/paper-v0/README.md)

