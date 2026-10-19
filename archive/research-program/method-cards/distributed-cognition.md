# Method Card: Distributed Cognition

- Domain: cognitive science, aviation, navigation
- Evidence status: source mechanism supported; Helm transfer exploratory
- Primary Helm bundle: Situation Recovery
- Candidate primitives: `Workspace`, `ContextProjection`, `ArtifactGraph`, `CommonOperatingPicture`

## 1. Original problem

전통적 인지과학은 기억·판단·계산을 개인의 머릿속 과정으로 분석하는 경향이 있다. 그러나 조종석, 함선 항법, 의료팀처럼 복수 사람과 도구가 함께 일하는 환경에서는 결과가 어느 한 사람의 지식만으로 생성되지 않는다.

Edwin Hutchins의 조종석 연구는 속도 기억과 절차 수행이 조종사 개인이 아니라 조종사, 계기, 카드, 말, 절차 사이에 분산되어 있음을 분석한다. 시스템의 인지적 성질은 개별 구성원의 성질과 다를 수 있다.

## 2. Environmental assumptions

- 복수 참여자가 지속적으로 같은 환경과 산출물을 다룬다.
- 정보 표현이 사람과 인공물 사이에서 이동한다.
- 표식과 절차는 단순 보조물이 아니라 기억·계산 기능의 일부다.
- 시간 압력과 역할 분담 때문에 한 사람이 모든 정보를 유지하지 않는다.
- 성공은 개인 정확도보다 전체 표현 변환의 정합성에 달려 있다.

## 3. Domain-invariant mechanisms

### Representation propagation

정보는 한 위치에 복제되는 것이 아니라 서로 다른 표현으로 변환된다. 예: 로그 → 요약 → 판단 → 작업 지시 → 코드 변화.

### Externalized memory

체크리스트, 계기, 문서, 상태판은 인간 기억을 보조하는 것이 아니라 공동 시스템의 기억을 구성한다.

### Coordination through artifacts

참여자가 직접 대화하지 않아도 같은 인공물을 읽고 수정하며 행동을 조정한다.

### System-level cognition

전체 시스템이 무엇을 기억하고 예측할 수 있는지는 어느 한 에이전트의 context window나 인간 기억만으로 평가할 수 없다.

## 4. Helm problem explained

에이전트 실행 로그, Git diff, 문서, 사용자의 기억이 분리되면 각 구성 요소가 부분적으로 정확해도 전체 시스템은 목적과 상황을 잃는다. “컨텍스트를 에이전트 프롬프트에 더 넣기”는 분산된 표현 사이의 변환 오류를 해결하지 못한다.

Helm의 분석 단위는 다음 전체가 되어야 한다.

```text
human + agents + tools + artifacts + policies + environment
```

## 5. Transfer to Helm

| Mechanism | Helm primitive |
|---|---|
| 외재화된 기억 | Event ledger, Decision/Commitment graph |
| 역할별 표현 | ContextProjection |
| 공동 작업 표면 | CommonOperatingPicture, InquiryMap |
| 표현 이동 추적 | provenance, derived-from relation |
| 시스템 수준 평가 | joint outcome quality, resumption performance |

## 6. Transfer rules

1. Context는 “에이전트에게 전달한 텍스트”가 아니라 공동 시스템에서 다음 행동을 가능하게 하는 표현의 집합으로 측정한다.
2. 요약이 생성될 때 어떤 원본 표현이 어떻게 변환·누락됐는지 추적한다.
3. 인간과 에이전트가 같은 화면을 본다는 사실을 common ground로 착각하지 않는다.
4. 문서가 존재하는지보다 필요한 시점에 올바른 역할이 이를 해석할 수 있는지 평가한다.
5. 개인 에이전트 정확도가 아니라 handoff, resumption, integration 단계에서 전체 성능을 측정한다.

## 7. What must not be copied

- 모든 상호작용과 파일을 거대한 지식 그래프로 만들기
- 사용자 머릿속 상태를 시스템이 완전히 표현할 수 있다고 가정하기
- 외부 표현을 추가할수록 기억과 이해가 자동 개선된다고 보기
- 한 도메인의 표식과 절차를 다른 작업에 그대로 적용하기

## 8. Failure modes

- **Representation drift**: 같은 Decision이 chat, docs, code에서 다르게 표현됨
- **Orphaned memory**: 중요한 Evidence가 존재하지만 어느 Claim에도 연결되지 않음
- **Projection blindness**: 요약이 원본의 이견과 불확실성을 제거함
- **Cognitive offloading without recovery**: 사용자가 모든 기억을 시스템에 맡겼지만 시스템 실패 시 복원 불가
- **Artifact overload**: 너무 많은 외부 표현이 다음 행동을 더 어렵게 만듦

## 9. Falsifiable Helm hypotheses

### DC-H1

역할별 ContextProjection은 전체 문서 탐색보다 적은 시간으로 더 정확한 다음 행동을 만들 것이다.

### DC-H2

Normative/Epistemic/Material 변화의 provenance를 유지하면 원본 로그만 있는 조건보다 handoff 오류가 감소할 것이다.

### DC-H3

공동 시스템 수준의 상황 퀴즈는 개별 에이전트 정확도보다 integration defect를 더 잘 예측할 것이다.

## 10. Prototype

- 동일 Event set에서 구현 에이전트용 Context와 product owner용 Return Brief를 별도로 생성한다.
- 각 projection에서 누락된 항목과 사용되지 않은 항목을 기록한다.
- 24시간 후 사용자에게 목적, 주요 변화, 다음 상태를 설명하게 한다.
- 원본 로그 fallback과 잘못된 상태 추론을 비교한다.

## 11. Metrics

- context precision/recall for next action
- time-to-orientation
- representation drift incidents
- provenance drill-down rate
- missed critical change
- projection generation cost
- post-handoff correction count

## 12. Sources

- [Hutchins, “How a Cockpit Remembers Its Speeds”](https://doi.org/10.1207/s15516709cog1903_1)
- [Distributed Cognition in an Airline Cockpit](https://www.cambridge.org/core/books/abs/cognition-and-communication-at-work/distributed-cognition-in-an-airline-cockpit/885A955C962A056D5B3217F4E8538D5C)

## 13. Open questions

- Helm이 반드시 외재화해야 할 상태와 인간 기억에 남겨야 할 상태의 경계는 무엇인가?
- projection 자동화가 facilitator의 의미 해석을 얼마나 대체할 수 있는가?
- 여러 에이전트가 같은 모델과 context를 공유할 때 독립적 판단처럼 보이는 상관 오류를 어떻게 표시할 것인가?

