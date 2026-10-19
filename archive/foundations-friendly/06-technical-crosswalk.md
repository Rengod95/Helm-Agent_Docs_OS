# Product Language와 기술 모델의 연결

## 1. 적용 규칙

이 문서는 쉬운 언어가 copy에만 머물지 않고 application domain에도 일관되게 반영되도록 한다.

### MUST

- 사용자 화면, 알림, onboarding, help 문서는 Product/UI 용어를 사용한다.
- 새 public API와 application-layer type은 Product Domain 이름을 우선한다.
- 원론 개념과의 관계를 `foundationRef` 또는 개발 문서에서 추적할 수 있어야 한다.
- 제품 용어로 바꾸어도 원론의 상태 전이와 책임 구분을 보존한다.

### SHOULD

- core 내부의 기존 experimental Event 이름은 즉시 일괄 rename하지 않는다.
- projection 경계에서 core term을 Product Domain term으로 변환한다.
- migration 없이 UI copy만 바꾸는 임시 상태를 오래 유지하지 않는다.

### MUST NOT

- 쉬워 보이게 만들기 위해 `결과 제출`, `결과 확인`, `전체 반영`을 하나의 `완료`로 합치지 않는다.
- `관찰`, `해석`, `가능성`, `판단`, `선택`을 하나의 text field에 저장하지 않는다.
- agent persona 이름을 owner, delegate, authority 정보 대신 사용하지 않는다.

## 2. 전체 대응표

| 원론 개념 | Product Domain | 한국어 UI | 권장 component/API 이름 |
|---|---|---|---|
| Purpose | Goal | 목표 | `Goal`, `GoalSummary` |
| Concern | Focus | 초점 | `Focus`, `FocusRoom` |
| SituationModel | CurrentPicture | 현재 상황 | `CurrentPicture` |
| ProblemFrame | ProblemView | 문제 관점 | `ProblemView` |
| Observation | Observation | 관찰 | `Observation` |
| Inference | Interpretation | 해석 | `Interpretation` |
| Hypothesis | Possibility | 가능성 | `Possibility`, `PossibilityComparison` |
| Claim | Finding | 판단 | `Finding` |
| Evidence | Evidence | 근거 | `Evidence`, `EvidenceView` |
| Counterevidence | ChallengingEvidence | 반대 근거 | `ChallengingEvidence` |
| Assumption | Assumption | 전제 | `Assumption` |
| Uncertainty / Question | OpenQuestion | 아직 모르는 점 | `OpenQuestion` |
| Decision | Choice | 선택 | `Choice`, `ChoiceRecord` |
| DecisionGate | ChoiceRequest | 선택 요청 | `ChoiceRequest` |
| AcceptanceCriterion | ResultCondition | 완료 기준 | `ResultCondition` |
| Commitment | Promise | 약속 | `Promise` |
| DelegationContract | WorkAgreement | 작업 합의 | `WorkAgreement` |
| AuthorityEnvelope | AllowedRange | 맡긴 범위 | `AllowedRange` |
| WorkUnit | Work | 진행 작업 | `Work`, `ActiveWorkCard` |
| CompletionClaim | ResultSubmission | 결과 제출 | `ResultSubmission` |
| Acceptance / Assurance | ResultReview | 결과 확인 | `ResultReview` |
| Outcome | Result | 실제 결과 | `Result` |
| Integration | WholeUpdate | 전체 반영 | `WholeUpdate` |
| Reflection | LearningReview | 돌아보기 | `LearningReview` |
| ContextProjection | ContextView | 맞춤 상황 | `ContextView` |
| ReturnBrief | Brief | 복귀 요약 | `Brief`, `SinceLastVisit` |
| CommonOperatingPicture | Overview | 전체 상황 | `Overview` |
| InquiryMap | ExploreView | 가능성 비교 | `ExploreView` |
| Event | ChangeRecord | 변화 기록 | `ChangeRecord` |
| ReopenTrigger | ReviewTrigger | 다시 볼 조건 | `ReviewTrigger` |
| EscalationTrigger | HelpTrigger | 도움 요청 조건 | `HelpTrigger` |

### 참여자, 운영, 실제 변화의 확장 대응

| 원론 개념 | Product Domain | 한국어 UI | 권장 component/API 이름 |
|---|---|---|---|
| HumanActor | Person | 사람 | `Person`, `HumanOwner` |
| AgentActor | Agent | Agent | `Agent`, `AgentDelegate` |
| ToolActor | Tool | 도구 | `Tool` |
| CollectiveActor | Team | 팀 | `Team`, `ReviewGroup` |
| Principle | GuidingRule | 기본 원칙 | `GuidingRule` |
| Policy | AutomationRule | 자동화 규칙 | `AutomationRule` |
| Constraint | Boundary | 지켜야 할 조건 | `Boundary` |
| Authority | DecisionRight | 결정 권한 | `DecisionRight` |
| Responsibility | Responsibility | 책임 | `Responsibility` |
| Artifact | WorkOutput | 결과물 | `WorkOutput` |
| CodeChange | CodeChange | 코드 변경 | `CodeChange` |
| Document | Document | 문서 | `Document` |
| Design | Design | 설계 | `Design` |
| TestResult | TestResult | 테스트 결과 | `TestResult` |
| Deployment | Release | 배포 | `Release` |
| ExternalState | ExternalState | 외부 상태 | `ExternalState` |
| ExecutionTrace | RunRecord | 실행 기록 | `RunRecord` |
| Handoff | Handoff | 이어받기 | `Handoff` |
| Interface | ConnectionPoint | 연결 지점 | `ConnectionPoint` |
| Conflict | Conflict | 충돌 | `Conflict` |
| Exception | OutsideRange | 맡긴 범위 밖 상황 | `OutsideRange` |
| Surprise | UnexpectedChange | 예상 밖 변화 | `UnexpectedChange` |
| WeakSignal | EarlyWarning | 작은 경고 | `EarlyWarning` |
| RecoveryPath | RecoveryPlan | 복구 방법 | `RecoveryPlan` |

## 3. Product Domain object 예시

### 선택 요청

```json
{
  "goal": "새 결제 흐름을 안전하게 출시한다",
  "focus": "기존 고객의 결제 호환성",
  "question": "호환 모드를 한 달 유지할 것인가?",
  "whyNow": "데이터 이전을 시작하기 전에 정해야 한다",
  "options": [],
  "recommendation": {},
  "evidence": [],
  "challengingEvidence": [],
  "openQuestions": [],
  "reversibility": {},
  "reviewTrigger": "구버전 사용자가 5% 아래로 내려갈 때"
}
```

### 작업 합의

```json
{
  "goal": "새 결제 흐름을 안전하게 출시한다",
  "focus": "모바일 복구 경로",
  "delegate": "agent:mobile-review",
  "humanOwner": "human:product-owner",
  "resultConditions": [],
  "allowedRange": {
    "can": ["read", "test", "local-change"],
    "cannot": ["deploy", "contact-customer"]
  },
  "evidenceNeeded": [],
  "helpTriggers": [],
  "nextCheckpoint": "재현 테스트가 끝날 때"
}
```

## 4. 기존 core와 projection 경계

현재 experimental core가 `Purpose`, `Decision`, `Commitment`, `Belief`, `Material Event`를 사용하더라도 UI는 다음처럼 투영한다.

```text
Core Event / Entity
  → semantic validation
  → Product Domain projection
  → role- and time-specific ContextView
  → 쉬운 한국어 UX copy
```

예:

```text
normative.decision.committed
  → ChoiceRecord
  → “호환 모드를 한 달 유지하기로 선택함”
```

## 5. Information architecture 이름

| 이전 연구 표현 | 사용자 기본 label | 설명 |
|---|---|---|
| Today | 오늘 | 돌아온 뒤 달라진 점과 지금 할 일 |
| Concerns | 초점 | 함께 풀고 있는 중요한 상황 |
| Work | 진행 작업 | 사람과 agent가 맡은 일 |
| Decisions | 선택 | 열린 선택 요청과 선택 기록 |
| Evidence | 근거 | 판단과 결과를 지지·약화하는 자료 |
| Policies | 자동화 규칙 | 맡길 범위, 알림, 연결, 보관 기준 |

`Agent`, `Timeline`, `Artifact`는 기본 top-level navigation이 아니라 초점과 진행 작업을 설명하는 보조 view로 둔다.

## 6. 도입 순서

1. UI copy와 component 이름에 Product Language 적용
2. fixture, example, test description을 쉬운 용어로 갱신
3. application-layer DTO와 command 이름 전환
4. adapter에서 core Event와 Product Domain 사이의 명시적 mapping 제공
5. pilot에서 용어 이해도와 잘못된 상태 해석 측정
6. 의미가 안정된 뒤에만 core schema rename 또는 migration 검토

구현에서 label과 상태를 중복 선언하지 않도록 [`product-language.yaml`](product-language.yaml)을 copy test와 fixture의 기준으로 사용한다.

