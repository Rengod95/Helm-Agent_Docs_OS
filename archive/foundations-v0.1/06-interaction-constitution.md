# Interaction Constitution

## 1. 목적

이 문서는 Helm이 사용자에게 언제, 왜, 어떤 형태로 개입을 요청할 수 있는지 정의한다. UI 컴포넌트 목록이 아니라 인간의 주의력과 저자성을 보호하는 헌법이다.

## 2. 기본 권리

Helm 사용자는 다음 권리를 가진다.

### 목적을 알 권리

모든 실행은 어떤 Purpose와 Concern에 기여하는지 설명할 수 있어야 한다.

### 상태를 복원할 권리

시간이 지난 뒤에도 원본 로그를 처음부터 읽지 않고 현재 상황, 의미, 향후 경로를 이해할 수 있어야 한다.

### 전제를 볼 권리

추천과 결정에 사용된 핵심 Assumption, Evidence, Counterevidence를 볼 수 있어야 한다.

### 방향을 바꿀 권리

진행 중인 작업의 ProblemFrame, 우선순위, Constraint, Authority Envelope를 수정할 수 있어야 한다.

### 이의를 제기할 권리

에이전트의 Claim과 Recommendation을 반박하고 대안 가설 또는 추가 실험을 요청할 수 있어야 한다.

### 침묵할 권리

시스템은 사소하고 가역적이며 검증 가능한 선택으로 사용자를 방해하지 않아야 한다.

### 근거 있는 수락을 할 권리

결과를 승인할 때 무엇을 수락하며 무엇이 여전히 불확실한지 알 수 있어야 한다.

## 3. 개입 요청의 허용 조건

Helm은 다음 중 하나 이상이 참이고, 사용자의 입력이 결과를 실질적으로 바꿀 수 있을 때만 능동 Gate를 생성해야 한다.

- 가치 또는 목적이 충돌한다.
- 문제 프레임에 따라 이후 경로가 크게 갈린다.
- 비가역적이거나 외부 파급 효과가 큰 행동이다.
- 현재 Authority Envelope를 벗어난다.
- 에이전트·증거·이해관계자 사이에 중요한 이견이 있다.
- 추가 정보의 가치보다 바로 결정할 가치가 높다.
- 결과 수락 또는 전체 통합을 위한 규범적 약속이 필요하다.
- 재검토 조건이 충족되어 기존 Decision을 다시 열어야 한다.

다음 경우에는 기본적으로 Gate를 생성하지 않는다.

- 되돌리기 쉽고 자동 검증 가능한 로컬 구현 선택
- 이미 승인된 정책과 패턴이 명확히 적용되는 경우
- 사용자가 선택해도 결과가 사실상 달라지지 않는 경우
- 단순 진행 보고
- 에이전트가 스스로 해결할 수 있는 정보 부족

## 4. Decision Gate 계약

모든 Decision Gate는 다음 필드를 MUST로 제공한다.

```text
Question          지금 무엇을 결정해야 하는가?
Why now           왜 지금 결정이 필요한가?
Purpose           어떤 상위 목적과 연결되는가?
Options           현상 유지를 포함한 실질적 선택지는 무엇인가?
Criteria          무엇을 기준으로 비교하는가?
Evidence          각 선택을 지지·반박하는 증거는 무엇인가?
Uncertainty       무엇을 아직 모르며 결정에 어떤 영향을 주는가?
Consequences      지역 및 전체 시스템 영향은 무엇인가?
Reversibility     되돌릴 수 있는가? 비용은 얼마인가?
Recommendation    시스템은 무엇을 왜 권하는가?
Alternative       결정 대신 어떤 실험·위임·연기가 가능한가?
Commitment        선택 시 누가 무엇을 맡게 되는가?
Reopen trigger    언제 이 결정을 다시 검토하는가?
```

“진행할까요?” 또는 “A와 B 중 무엇을 원하나요?”만 있는 Gate는 유효하지 않다.

## 5. Return Brief 계약

Return Brief는 사용자의 마지막 확인 cursor 이후 변화만 보여주되, 의미를 재구성할 충분한 배경을 포함한다.

### Situation

- 현재 최상위 목적과 작업 단계
- 긴급한 위험과 막힘
- 사용자의 판단을 기다리는 항목

### Changes

- Normative: Decision, Constraint, Commitment의 변화
- Epistemic: 강화·약화된 Hypothesis, 새 Evidence와 이견
- Material: 변경된 Artifact, 테스트, 배포, 외부 상태

### Assessment

- 변화가 왜 중요한가
- 어떤 기존 가정이 깨졌는가
- 목표 달성 가능성과 위험이 어떻게 달라졌는가

### Projection

- 개입하지 않을 경우 예상되는 다음 행동
- 가까운 시점의 결정과 통합 위험
- 방향을 바꿀 수 있는 마지막 저비용 지점

### Recommendation

- 사용자가 지금 해야 할 가장 가치 있는 행동
- 지금 읽지 않아도 되는 항목

AHRQ의 SBAR가 상황, 배경, 평가, 요청을 구조화하여 중요한 인수인계의 오해를 줄이는 것처럼, Return Brief는 단순 로그 요약이 아니라 책임과 상황 모델의 이전을 지원한다. [AHRQ SBAR](https://www.ahrq.gov/teamstepps-program/curriculum/communication/tools/sbar.html)

## 6. Inquiry Interaction

사용자는 Inquiry Map에서 다음 행위를 할 수 있어야 한다.

- ProblemFrame을 분기하거나 합치기
- 새 Hypothesis를 제안하기
- Evidence 관계에 이의를 제기하기
- 숨겨진 Assumption을 승격하기
- 구분력이 높은 다음 실험을 선택하기
- 불확실성이 충분히 줄지 않아도 행동하기로 결정하기
- 탐구 중단 비용과 기대 정보 가치를 비교하기

에이전트가 생성한 가설 수를 늘리는 것보다 사용자가 가설 간 핵심 차이를 이해하고 조작할 수 있는지가 중요하다.

## 7. Delegation Interaction

위임 화면은 수행 목록보다 다음을 우선한다.

- intent and purpose
- conditions of satisfaction
- scope and exclusions
- allowed and forbidden actions
- evidence obligations
- escalation triggers
- expected next checkpoint
- current confidence and blockers

사용자는 자연어로 위임하더라도 Helm이 추출한 Contract의 중요한 모호성만 확인한다. 모든 필드를 수동 폼으로 채우게 해서는 안 된다.

## 8. Integration Review

Integration Review는 코드 diff만 검토하지 않는다.

- 어떤 Purpose와 Decision을 구현했는가
- 어떤 Assumption이 실제 결과로 검증되거나 깨졌는가
- 다른 WorkUnit의 전제를 무효화했는가
- 정책·문서·테스트·운영 상태가 함께 갱신되었는가
- 지역 최적화가 전체 품질을 떨어뜨리는가
- 수락 이후 남는 Known Limitation은 무엇인가

## 9. 상호작용 리듬

WHO의 수술 체크리스트처럼 Helm은 모든 순간이 아니라 오류 비용이 높은 단계 경계에서 구조화된 pause를 만든다. [WHO Clinical Checklists](https://www.who.int/tools/clinical-checklists)

기본 운영 주기:

```text
Brief → Delegate → Autonomous interval
      → Checkpoint/Gate → Continue
      → Acceptance → Integration → Debrief
```

사용자가 선택할 수 있는 운영 모드:

- **Explore**: 가설 다양성과 학습 우선
- **Build**: 수락된 방향의 구현과 증거 생성 우선
- **Stabilize**: 위험, 회귀, 통합, 복구 가능성 우선
- **Incident**: 짧은 통제 범위와 빈번한 상황 갱신 우선
- **Reflect**: 결과보다 모델·정책·학습 갱신 우선

모드는 고정 워크플로우가 아니라 Gate 임계치와 ContextProjection을 조정한다.

## 10. 주의력 예산

Workspace와 사용자는 명시적 또는 추론된 Attention Budget을 가질 수 있다.

```yaml
attention_policy:
  preferred_review_windows: []
  maximum_active_gates: 3
  interrupt_only_for:
    - authority_violation
    - irreversible_action
    - critical_risk
  batch_low_urgency_until: timestamp
  detail_preference: concise | balanced | deep
```

Gate 우선순위는 단순 긴급도가 아니라 다음을 고려한다.

- 결정 지연 비용
- 인간 입력이 결과를 개선할 기대 가치
- 남은 저비용 방향 전환 시간
- 다른 WorkUnit이 이 결정에 의존하는 정도
- 사용자가 맥락을 재구성하는 비용

## 11. 즐거움의 설계

Helm은 생산성을 게임화하지 않는다. 다음 경험을 통해 즐거움을 만든다.

- 복잡한 상황이 이해 가능한 구조로 정리되는 만족감
- 직접 세운 기준이 결과에 반영되는 저자성
- 좋은 질문과 판단이 여러 에이전트의 방향을 바꾸는 레버리지
- 가설이 증거로 강화·반박되는 탐구의 긴장
- 지역적 결과가 하나의 전체로 통합되는 완결감
- 반복할수록 자신의 위임 방식과 전문성이 개선되는 유능감

사용자의 행동이 결과에 미친 영향을 사후에 명확히 보여줘야 한다.

## 12. 금지되는 상호작용

1. 실질적 선택이 없는 승인 요청
2. 모든 진행 Event를 실시간 알림으로 전환
3. 추천만 강조하고 반대 증거를 숨김
4. 사용자가 보지 않은 상태 변경을 이미 합의된 것으로 표현
5. Confidence 숫자로 근거의 품질을 대체
6. Context 부족을 긴 원문 덤프로 해결
7. 사용자 개입 이후 그 영향과 후속 Commitment를 보여주지 않음
8. 동일 질문을 여러 에이전트가 중복 요청
9. 에이전트의 감정·의식·책임을 암시하여 신뢰를 유도
10. 사용자의 침묵을 고위험 결정의 암묵적 승인으로 해석

