# Formal State Model

## 1. 목적과 범위

이 문서는 Helm의 개념을 구현 언어와 저장소에 독립적인 상태 모델로 표현한다. 완전한 수학적 명세가 아니라 다음을 가능하게 하는 준형식 모델이다.

- 객체와 상태의 의미를 구현마다 동일하게 유지
- 유효하지 않은 상태 전이를 검증
- 이벤트 로그에서 현재 상황도를 재생성
- Markdown/YAML, 로컬 데이터베이스, SaaS 저장소 간 이식
- 에이전트가 제안한 변경과 사용자가 수락한 변경을 분리

## 2. 전체 상태

시간 `t`에서 Helm Workspace의 상태는 다음과 같다.

```text
W(t) = <N(t), E(t), M(t), A(t), P(t)>
```

- `N`: normative graph — 목적, 권한, 결정, 약속
- `E`: epistemic graph — 문제, 가설, 주장, 증거, 불확실성
- `M`: material graph — 산출물, 실행, 테스트, 외부 상태
- `A`: actor graph — 인간, 에이전트, 도구, 팀과 능력
- `P`: policy set — 전이 규칙, 자동 승인, 에스컬레이션 정책

현재 상태는 Event sequence를 투영한 결과다.

```text
W(t_n) = fold(apply, W(t_0), Events[0..n])
```

## 3. Event

Event는 이미 발생한 사실이며 수정하지 않는다.

```yaml
event:
  id: evt_...
  type: claim.proposed
  occurred_at: 2026-01-01T00:00:00Z
  actor: actor_...
  authority_basis: policy_or_decision_id
  concern: concern_...
  subject: claim_...
  payload: {}
  provenance:
    source: run_or_human_input_id
    tool: optional_tool_id
  causation_id: evt_...
  correlation_id: workflow_...
```

### Event 불변조건

1. `id`, `type`, `occurred_at`, `actor`, `subject`는 필수다.
2. 상태를 변경하는 Event는 권한 근거를 가져야 한다.
3. 파생 Event는 원인 또는 상관관계 ID를 가져야 한다.
4. Event는 삭제·수정하지 않고 보정 Event를 추가한다.
5. 외부 도구 결과는 원본 식별자 또는 내용 해시를 보존한다.

## 4. WorkUnit 상태기계

```text
Proposed
  → Negotiating
  → Delegated
  → InProgress
  → ClaimingComplete
  → Accepted
  → Integrating
  → Integrated
  → Closed
```

보조 전이:

```text
Proposed/Negotiating → Refused
Delegated/InProgress → Blocked
Delegated/InProgress → Suspended
ClaimingComplete     → CorrectionRequired → InProgress
Accepted/Integrating → Reopened
Any non-final        → Cancelled
Any                  → Superseded
```

### 상태 의미

| 상태 | 의미 | 진입 조건 |
|---|---|---|
| Proposed | 요청 초안 | Purpose 또는 Concern 연결 |
| Negotiating | 조건·범위·권한 협상 중 | 수행자 또는 요청자의 질문/반대 |
| Delegated | 수행 약속 성립 | Delegation Contract 유효 |
| InProgress | 허용 범위 안에서 실행 중 | 수행자가 시작 Event 생성 |
| ClaimingComplete | 만족 조건을 충족했다고 주장 | Evidence obligation 제출 |
| Accepted | 수락 주체가 주장을 승인 | 증명 부담 및 AcceptanceCriterion 충족 |
| Integrating | 전체 기준선과 정합화 중 | 통합 대상과 영향 분석 존재 |
| Integrated | 통합 검증 완료 | 충돌 해결 및 통합 증거 존재 |
| Closed | 후속 약속이 없고 회고 가능 | 미해결 obligation 없음 |

`ClaimingComplete → Accepted`를 자동화할 수는 있지만 같은 판단 주체가 주장과 검증을 모두 수행한 경우 독립성 수준을 표시해야 한다.

## 5. Decision 상태기계

```text
Open
  → Framed
  → AlternativesIdentified
  → Deliberating
  → Committed
  → Implementing
  → Validated
  → Integrated
```

예외 전이:

```text
Open..Deliberating → Deferred/Cancelled
Committed..Integrated → Reopened
Any accepted state → Superseded
```

### Decision 전이 규칙

- `Open → Framed`: 결정 질문, 소유자, why-now가 있어야 한다.
- `Framed → AlternativesIdentified`: 최소 하나의 대안과 현상 유지 대안을 포함한다.
- `AlternativesIdentified → Deliberating`: 평가 기준과 관련 Evidence가 있어야 한다.
- `Deliberating → Committed`: 권한 있는 Actor, 선택, 근거, 결과, 재검토 조건이 필요하다.
- `Committed → Implementing`: 하나 이상의 Commitment로 분해되어야 한다.
- `Implementing → Validated`: 선택 결과에 대한 Outcome과 Evidence가 필요하다.
- `Validated → Integrated`: 상위 Purpose 및 인접 Decision과 정합성이 확인되어야 한다.

## 6. Claim 상태기계

```text
Proposed
  → UnderInvestigation
  → Supported / Contested
  → Accepted / Rejected / Undetermined
  → Stale / Superseded / Reopened
```

Claim은 참/거짓 Boolean만 갖지 않는다. 다음 평가를 별도로 가진다.

- `support_level`
- `scope`
- `confidence_basis`
- `unresolved_counterevidence`
- `valid_from`
- `review_at`
- `invalidation_triggers`

## 7. Evidence 상태기계

```text
Captured → Qualified → Linked → Revalidated
                         ├─ Stale
                         ├─ Invalidated
                         └─ Superseded
```

- Captured: 원본과 출처 확보
- Qualified: 방법, 범위, 신뢰도 평가
- Linked: 특정 Claim과 관계 설정
- Revalidated: 환경 변경 이후에도 유효성 확인

## 8. Commitment 상태기계

```text
Draft → Offered → Accepted → Active
                         ├─ Fulfilled
                         ├─ Breached
                         ├─ Renegotiating → Active
                         ├─ Released
                         └─ Transferred
```

Commitment의 `Fulfilled`는 WorkUnit의 `Integrated`와 동일하지 않다. 수행자가 약속한 산출물을 제공했어도 상위 시스템 통합은 별도 책임일 수 있다.

## 9. ContextProjection 상태기계

```text
Requested → Materialized → Delivered
                       ├─ Refreshed
                       ├─ Invalidated
                       └─ Expired
```

ContextProjection 필수 메타데이터:

```yaml
context_projection:
  id: ctx_...
  actor: actor_...
  concern: concern_...
  purpose: resumption | execution | deliberation | review | handoff
  generated_at: timestamp
  source_state_version: event_cursor
  included_entities: []
  omitted_categories: []
  invalidation_triggers: []
  expires_at: optional_timestamp
```

## 10. Integration 상태

Integration은 단순 merge가 아니다.

```text
Pending
  → ImpactMapped
  → ConflictsIdentified
  → Reconciled
  → Verified
  → BaselineUpdated
```

검사 대상:

- Purpose 및 AcceptanceCriterion 충족
- 인접 Decision과 정책 충돌
- Artifact 의존성과 인터페이스
- 다른 WorkUnit의 Assumption 무효화
- ContextProjection과 문서의 갱신 필요
- 관측되지 않은 외부 효과
- 롤백 및 복구 가능성

## 11. 핵심 파생 뷰

Event와 Entity에서 다음 뷰를 생성한다.

### Common Operating Picture

현재 Purpose, 열린 Concern, 활성 Commitment, 위험, 이견, 다음 Gate를 보여준다.

### Return Brief

특정 cursor 이후 Normative/Epistemic/Material 변화와 그 의미를 요약한다.

### Inquiry Map

ProblemFrame, Hypothesis, Claim, Evidence, 실험을 연결한다.

### Decision Queue

인간 판단의 기대 가치와 긴급도에 따라 열린 Gate를 정렬한다.

### Integration Map

지역 Outcome이 상위 Purpose, Decision, Artifact에 미치는 영향을 표시한다.

## 12. 전역 불변조건

아래 조건을 위반하는 Event는 거부하거나 명시적 예외 Decision을 요구한다.

```text
I1  Active WorkUnit has valid DelegationContract.
I2  DelegationContract authority is within requester's authority.
I3  ClaimingComplete has evidence for every required criterion.
I4  Accepted has an authorized acceptor.
I5  Integrated has a verified integration target.
I6  Committed Decision has alternatives, rationale, and reopen trigger.
I7  ContextProjection references a reproducible source state.
I8  Superseding entity links to the entity it replaces.
I9  Material mutation links to an authorized WorkUnit or emergency policy.
I10 Normative baseline changes invalidate affected projections.
I11 Evidence invalidation re-evaluates dependent Claims and Decisions.
I12 Closed WorkUnit has no unresolved obligations hidden beneath it.
```

## 13. 충돌과 동시성

복수 에이전트 환경에서 파일 충돌보다 의미 충돌을 먼저 다룬다.

- 같은 Artifact를 변경하지만 목적과 계약이 양립하면 조정 가능한 실행 충돌이다.
- 다른 Artifact를 변경해도 같은 Assumption이나 Decision을 상반되게 바꾸면 규범·인식 충돌이다.
- 동일 기준선에 대한 동시 변경은 조용히 last-write-wins 하지 않는다.
- 충돌은 `ConflictDetected` Event와 별도 Concern을 생성한다.
- 해결은 `Decision` 또는 명시된 정책으로만 기준선을 갱신한다.

## 14. 저장 형식 독립성

이 상태 모델은 다음 표현 모두에 매핑될 수 있어야 한다.

- Markdown/YAML local-first workspace
- SQLite 또는 embedded graph
- 서버 이벤트 로그와 관계형 projection
- Git 기반 변경 이력
- 외부 agent runtime의 session/run metadata

표현 방식이 상태 의미와 전이 규칙을 바꾸어서는 안 된다.

