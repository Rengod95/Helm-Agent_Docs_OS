# Method Card: Resilience Engineering

- Domain: safety science, complex adaptive systems
- Evidence status: established research framework; Helm operationalization exploratory
- Primary Helm bundle: Acceptance & Integration
- Candidate primitives: `Respond`, `Monitor`, `Learn`, `Anticipate`, `AdaptiveCapacity`, `RecoveryPath`

## 1. Original problem

복잡한 운영 환경에서는 모든 변동과 실패를 사전에 예측해 절차로 막을 수 없다. 실제 성과는 현장의 조정과 적응으로 유지되며, 정상 성공과 실패가 종종 같은 적응 과정에서 나온다.

Resilience Engineering은 시스템이 변화와 교란 속에서 필요한 기능을 유지하는 능력을 보고, Resilience Analysis Grid는 respond, monitor, learn, anticipate 네 잠재력을 검토한다.

## 2. Environmental assumptions

- 환경과 workload가 계속 변한다.
- 모든 위험과 대응을 사전에 명세할 수 없다.
- 정상 작업은 절차와 현실 사이를 조정한다.
- 성과는 실패 방지뿐 아니라 회복·적응 능력에 달려 있다.
- 과거 실패 학습만으로 미래 변화를 충분히 대비할 수 없다.

## 3. Domain-invariant mechanisms

### Respond

현재 변화와 교란에 필요한 행동을 수행한다.

### Monitor

어떤 신호가 가까운 위협과 기회를 나타내는지 지속 관찰한다.

### Learn

성공·실패·near miss에서 운영 모델과 정책을 갱신한다.

### Anticipate

현재 경로와 환경 변화가 미래에 어떤 상태를 만들지 준비한다.

### Adaptive capacity

정해진 절차 밖에서 목적을 유지하며 역할·자원·계획을 재구성할 여지를 보존한다.

## 4. Helm problem explained

완료된 작업을 검증하고 통합해도 새로운 모델, dependency, 사용자 목적 변화가 계속 발생한다. 고정 workflow와 정책이 현재 성공을 반복하게 할 수는 있지만 예상 밖 상황에서 brittle해질 수 있다.

## 5. Transfer to Helm

| Resilience potential | Helm mechanism |
|---|---|
| Respond | incident WorkUnit, rollback, local corrective action |
| Monitor | weak signals, Event/Outcome monitors, policy drift |
| Learn | Reflection, debrief, hypothesis/policy update |
| Anticipate | Projection, scenario, pre-mortem, reopen trigger |
| Adaptive capacity | reversible architecture, flexible authority, fallback |

## 6. Transfer rules

1. 검증은 현재 기준 충족뿐 아니라 failure recovery와 future change readiness를 포함한다.
2. 실패뿐 아니라 성공적인 local adaptation도 학습 대상으로 기록한다.
3. monitor는 측정 가능한 health metric뿐 아니라 dissent와 unexplained observation을 포함한다.
4. anticipate 결과를 확정 예측이 아니라 scenario와 준비 행동으로 표현한다.
5. policy는 모든 상황을 통제하기보다 local adaptation의 safe boundary를 제공한다.
6. Reflection은 문서 작성으로 끝나지 않고 Context, Contract, Policy 중 하나를 변경한다.

## 7. What must not be copied

- resilience를 장애 복구나 uptime 하나로 축소
- 모든 실패를 현장 적응 부족으로 책임 전가
- 예측 시나리오를 정확한 forecast로 표현
- flexibility를 권한과 기준 없는 improvisation으로 해석
- 회고 횟수를 학습 능력으로 측정

## 8. Failure modes

- **Brittle success**: 현재 test는 통과하지만 작은 환경 변화에 실패
- **Monitor fixation**: dashboard metric 밖의 변화 감지 불가
- **Learning without change**: 같은 회고가 반복되지만 policy는 그대로
- **Past-only learning**: 과거 failure에만 최적화해 새 위험 놓침
- **Adaptation debt**: local workaround가 전체 일관성을 지속 약화

## 9. Falsifiable Helm hypotheses

### RE-H1

respond/monitor/learn/anticipate를 분리 평가하면 pass/fail integration review보다 brittle Outcome을 더 많이 발견할 것이다.

### RE-H2

성공적인 adaptation을 Reflection에 포함하면 failure-only retrospective보다 향후 예외 처리 시간이 줄어들 것이다.

### RE-H3

recovery path와 reopen trigger를 가진 Decision은 없는 Decision보다 환경 변화 후 재구성 비용이 낮을 것이다.

## 10. Prototype

- 통합된 Outcome에 dependency 변경, agent capability 변화, 사용자 기준 변경 시나리오를 적용한다.
- pass/fail review와 four-potentials review를 비교한다.
- debrief가 실제 policy/Context를 바꾸고 다음 시나리오에서 도움이 되는지 관찰한다.

## 11. Metrics

- recovery time
- change scenario success
- monitor signal coverage
- reflection-to-policy conversion
- repeated exception time
- adaptation debt incidents
- anticipated vs unanticipated failure handling

## 12. Sources

- [Resilience Engineering Institute: Resilience Analysis Grid](https://resilienceengineeringinstitute.org/resilience-analysis-grid/)

## 13. Open questions

- Helm의 adaptive capacity를 사용자 이해를 약화시키지 않고 어떻게 확장할 것인가?
- agent가 만든 local workaround와 가치 있는 innovation을 어떻게 구분할 것인가?
- four potentials를 제품 metric으로 만들 때 다시 metric fixation을 만들지 않으려면 무엇이 필요한가?

