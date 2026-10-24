# Method Card: Systems Engineering and Integration

- Domain: aerospace and complex systems engineering
- Evidence status: established engineering discipline; Helm tailoring exploratory
- Primary Helm bundle: Acceptance & Integration
- Candidate primitives: `PurposeTrace`, `Requirement`, `Interface`, `Baseline`, `Integration`, `Verification`, `Validation`

## 1. Original problem

복잡한 시스템은 각 부품이 개별 요구를 만족해도 전체 임무에서 실패할 수 있다. 요구의 의미가 하위 설계로 내려가며 변형되고, 인터페이스와 가정이 충돌하며, 결정 근거가 사라지면 지역 최적화가 전체 성능을 손상시킨다.

NASA Systems Engineering은 stakeholder expectation, requirement, logical decomposition, design solution, product realization과 함께 decision, configuration, risk, interface, verification/validation을 교차 관리한다.

## 2. Environmental assumptions

- 여러 하위 시스템과 전문 영역이 상호작용한다.
- 상위 목적이 하위 요구와 설계로 분해된다.
- 인터페이스 실패가 부품 내부 실패보다 중요할 수 있다.
- 결정과 가정이 긴 수명 동안 추적되어야 한다.
- verification과 validation은 서로 다른 질문에 답한다.

## 3. Domain-invariant mechanisms

### Traceability

상위 Purpose와 하위 Requirement, Decision, Artifact, Evidence의 관계를 보존한다.

### Logical decomposition

목적을 단순 task list가 아니라 기능·성능·인터페이스·제약으로 분해한다.

### Interface management

하위 단위 사이의 계약, 데이터, 동작, 가정을 일급으로 관리한다.

### Verification vs validation

- Verification: 정의한 기준대로 만들었는가?
- Validation: 실제 목적과 사용 환경에 적합한 것을 만들었는가?

### Baseline and change impact

수락된 상태를 기준선으로 관리하고 변경이 미치는 파급을 분석한다.

## 4. Helm problem explained

각 agent WorkUnit이 테스트를 통과해도 서로 다른 Assumption, API, UX 기준, Decision을 따를 수 있다. 완료된 로컬 변경을 merge하는 것만으로는 Purpose 적합성과 의미 정합성을 보장하지 못한다.

## 5. Transfer to Helm

| Systems engineering mechanism | Helm primitive |
|---|---|
| Mission/stakeholder expectation | Purpose and AcceptanceCriterion |
| Requirement decomposition | Claim/criterion hierarchy |
| Interface | semantic dependency and Contract |
| Verification | evidence against specified criterion |
| Validation | Outcome against real Purpose/context |
| Configuration baseline | accepted Decision/Artifact state |
| Change impact | affected graph and invalidation propagation |
| Integration | reconciled and verified composite Outcome |

## 6. Transfer rules

1. WorkUnit을 파일이나 feature뿐 아니라 상위 Purpose와 interface에 연결한다.
2. verification success를 validation success로 표현하지 않는다.
3. Integration 전에 shared Assumption과 Decision baseline의 충돌을 검사한다.
4. 지역 Outcome이 다른 WorkUnit의 Evidence나 Context를 무효화하는지 확인한다.
5. change impact를 code dependency뿐 아니라 Normative/Epistemic relation까지 확장한다.
6. 위험이 낮은 작업에는 최소 trace를 사용하고 전체 systems process를 강제하지 않는다.

## 7. What must not be copied

- 모든 초기 제품을 우주 시스템 수준 문서로 운영
- Requirement hierarchy를 고정된 진실로 간주
- traceability link 수를 실제 정합성으로 착각
- V-model 형태를 모든 탐구 순서에 강제
- local experimentation을 baseline control로 억압

## 8. Failure modes

- **Verified but invalid**: 명세는 충족했지만 사용자 목적과 어긋남
- **Interface orphan**: 어느 WorkUnit도 통합 책임을 갖지 않음
- **Trace theater**: 링크는 많지만 의미와 영향이 불명확
- **Baseline divergence**: agent들이 서로 다른 Decision version으로 작업
- **Late integration**: 모든 로컬 완료 후 처음으로 의미 충돌 발견

## 9. Falsifiable Helm hypotheses

### SE-H1

Purpose–Criterion–Evidence trace는 task-only hierarchy보다 verified-but-invalid 결과를 줄일 것이다.

### SE-H2

Acceptance 이전의 semantic interface check는 merge 단계의 code conflict 검사보다 integration defect를 더 일찍 발견할 것이다.

### SE-H3

Normative/Epistemic change impact propagation은 문서 수동 갱신보다 stale baseline 사용을 줄일 것이다.

## 10. Prototype

- 세 WorkUnit이 서로 다른 Assumption과 interface를 가진 통합 과제를 수행한다.
- task/file view와 Purpose/interface trace view를 비교한다.
- verification 통과 후 실제 user scenario validation을 별도 수행한다.

## 11. Metrics

- purpose-to-outcome trace completeness
- verified-but-invalid count
- semantic interface conflict detection time
- unowned integration obligation
- baseline divergence
- post-acceptance rework
- integration lead time

## 12. Sources

- [NASA Systems Engineering Handbook](https://www.nasa.gov/reference/systems-engineering-handbook/)
- [NASA: System Design Processes](https://www.nasa.gov/reference/4-0-system-design-processes/)
- [NASA: Crosscutting Technical Management](https://www.nasa.gov/reference/6-0-crosscutting-technical-management/)

## 13. Open questions

- 초기 product discovery에서 validation과 requirement trace를 얼마나 가볍게 유지할 수 있는가?
- code dependency와 semantic dependency를 함께 표현할 최소 모델은 무엇인가?
- agent가 자동 생성한 trace link의 정확성을 어떤 샘플링으로 감사할 것인가?

