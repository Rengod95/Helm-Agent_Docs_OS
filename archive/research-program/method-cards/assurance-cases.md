# Method Card: Assurance Cases

- Domain: safety assurance, systems engineering, certification
- Evidence status: formal standard and safety practice; Helm tailoring exploratory
- Primary Helm bundle: Deliberative Inquiry
- Candidate primitives: `Claim`, `Argument`, `Evidence`, `Counterargument`, `Acceptance`

## 1. Original problem

안전 중요 시스템에서는 테스트 목록이 통과했다는 사실만으로 시스템이 특정 환경에서 충분히 안전하다는 결론을 정당화할 수 없다. 어떤 주장을 하는지, 하위 주장과 Evidence가 어떻게 연결되는지, 논증에 빠진 가정과 반대 논거가 무엇인지 설명해야 한다.

Assurance case는 시스템이 요구 속성을 만족한다는 Claim을 Argument와 Evidence로 지지하는 구조다. SACM은 이를 표준화된 모델로 표현하고 NASA는 안전 보증 사례와 도구에서 traceability, consistency, counterargument를 다룬다.

## 2. Environmental assumptions

- 실패 비용이 크고 수락 결정을 설명할 책임이 있다.
- Evidence가 여러 요구와 하위 주장에 분산된다.
- 테스트는 범위·환경·가정을 가진다.
- 단일 Evidence가 최상위 Claim 전체를 직접 증명하지 않는다.
- 검토자가 논증의 충분성과 약점을 감사해야 한다.

## 3. Domain-invariant mechanisms

### Claim decomposition

큰 수락 주장을 검증 가능한 하위 Claim으로 분해한다.

### Argument linkage

Evidence가 왜 Claim을 지지하는지 중간 추론을 명시한다.

### Evidence provenance and scope

Evidence의 생성 방법, 적용 환경, 신선도, 한계를 보존한다.

### Counterargument and defeater

결론을 약화하거나 무효화하는 조건을 논증 안에 포함한다.

### Reviewable acceptance

수락은 “모든 위험 없음”이 아니라 주어진 환경·범위에서 Evidence가 충분하다는 책임 있는 판단이다.

## 4. Helm problem explained

에이전트가 “테스트가 통과했고 구현이 완료됐다”고 보고해도 다음은 열려 있다.

- 테스트가 어느 AcceptanceCriterion을 검증했는가
- 테스트하지 않은 환경과 edge case는 무엇인가
- 목적 적합성·유지보수성·통합 정합성은 어떻게 검증됐는가
- Counterevidence와 Known Limitation은 무엇인가
- 누가 어떤 위험을 수락했는가

## 5. Transfer to Helm

| Assurance mechanism | Helm primitive |
|---|---|
| Top claim | WorkUnit completion or integration Claim |
| Subclaims | AcceptanceCriterion claims |
| Argument | claim-to-evidence rationale |
| Evidence | test, review, observation, user evaluation |
| Defeater | Counterevidence, invalidation trigger |
| Review | accept/correct/reject Decision |
| Dashboard | Assurance View and coverage gaps |

## 6. Transfer rules

1. 에이전트의 완료 보고를 `ClaimingComplete`로만 기록한다.
2. 각 required Criterion에 최소 Evidence relation을 요구한다.
3. Evidence가 Claim을 지지하는 이유와 적용 범위를 보존한다.
4. Known Limitation과 Counterevidence를 수락 화면에 함께 노출한다.
5. 위험이 낮은 작업에는 light assurance를 사용하고 형식 논증을 강제하지 않는다.
6. Evidence invalidation은 의존 Claim과 Decision을 stale/reopen 상태로 전파한다.
7. Claim 생성자와 수락자가 같은 경우 독립성 수준을 표시한다.

## 7. What must not be copied

- 모든 소프트웨어 작업에 safety case 수준 문서 요구
- Argument graph가 존재한다는 사실을 실제 충분성으로 착각
- 테스트 수와 Evidence 품질을 동일시
- 형식 구조를 인간 수락 책임의 대체물로 사용
- 높은 coverage 숫자로 중요한 누락을 숨기기

## 8. Failure modes

- **Evidence dumping**: 많은 테스트 링크를 붙이지만 Claim 관계가 없음
- **Circular argument**: Claim을 다른 표현으로 반복해 근거로 사용
- **Scope inflation**: 제한된 테스트가 전체 환경을 검증한다고 주장
- **Defeater suppression**: Known Limitation을 별도 문서로 밀어냄
- **Assurance bureaucracy**: 낮은 위험 작업의 비용이 가치보다 큼

## 9. Falsifiable Helm hypotheses

### AC-H1

Claim–Argument–Evidence 구조는 테스트 목록만 있는 완료 보고보다 acceptance defect와 post-acceptance rework를 줄일 것이다.

### AC-H2

Counterevidence와 invalidation trigger를 수락 시 함께 보이면 stale Decision reuse가 감소할 것이다.

### AC-H3

risk-tailored assurance depth는 모든 작업에 동일한 evidence form을 요구하는 방식보다 사용자 부담 대비 결함 탐지율이 높을 것이다.

## 10. Prototype

- 같은 agent 결과를 테스트 목록과 light assurance view로 제시한다.
- blind reviewer가 어느 결과를 수락하고 어떤 correction을 요구하는지 비교한다.
- Evidence 하나를 invalidated 처리하고 연쇄적으로 reopen되어야 할 Claim을 찾는다.

## 11. Metrics

- evidence-to-criterion coverage
- unsupported claim count
- counterevidence visibility
- acceptance defect
- post-acceptance rework
- invalidation propagation completeness
- assurance preparation/review time

## 12. Sources

- [OMG: Structured Assurance Case Metamodel](https://www.omg.org/spec/SACM/About-SACM)
- [NASA: An Assurance Case Approach to Space System Safety](https://ntrs.nasa.gov/api/citations/20160000772/downloads/20160000772.pdf?attachment=true)
- [NASA: AdvoCATE](https://sma.nasa.gov/news/articles/newsitem/2020/09/22/new-tool-for-developing-safety-assurance-cases)

## 13. Open questions

- 일반 지식 작업에서 assurance depth를 결정할 최소 risk taxonomy는 무엇인가?
- LLM이 생성한 Argument를 누가 검증하고 circularity를 어떻게 자동 탐지할 것인가?
- 수락자가 충분한 Evidence를 읽지 않은 채 coverage indicator만 신뢰하는 문제를 어떻게 막을 것인가?

