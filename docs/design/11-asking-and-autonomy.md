# 11. 묻기와 자율성

- 소유: P6 커널
- 상태: 2판 초안 (2026-10-11). 1판을 08(도메인 모델)·09(이벤트 저장소)·12·13·14·15·19·20에 맞춰 고쳤다. 1판 이름과의 대응은 §2.4.
- 구현 위치: `@helm/kernel`의 `src/asking/`, `src/commands/question.ts`. 규칙 집행은 커널, 전달 실행은 런타임·데몬(12, 17), 전달 표시는 앱(20)
- 함께 읽을 문서: [10 커널](10-kernel.md), [08 도메인 모델](08-domain-model.md) §3.4.4(Trigger)·§3.4.5(Autonomy)·§3.10(Choice, Objection)·§3.13(Question)·§3.22.7(질문 상태 기계), [09 이벤트 저장소](09-event-store.md) §3.4·§3.11.3(타이머), [12 런타임](12-runtime-engine.md) §3.13(질문 대기와 재개), [13 도구](13-tools-and-execution.md) §3.7.8~§3.7.9, [14 루프·모드](14-loops-modes-orchestration.md) §3.5.3·§3.13.5~§3.13.8, [19 프로토콜](19-client-protocol.md) §3.7.5·§3.8.3

## 1. 목적과 범위

### 1.1 목적

에이전트가 사람에게 무엇을, 언제, 어떻게 묻는지와, 묻지 않고 정한 것을 어떻게 남기고 되돌리는지를 구현 가능한 규칙으로 정한다. 브리프 결정 12(묻기 재설계)와 결정 8(혼자 정한 결정 기록과 이의, 불변조건 7)이 대상이다.

핵심 구조는 v0.3 06 §3의 [결정]을 따른다.

1. 묻기를 두 결정으로 나눈다. 질문이 있는가(기록), 언제 어떻게 전달하는가(전달).
2. 질문이 생기는 이유를 권리 게이트와 정보 게이트로 나눈다.
3. 전달 방식은 즉시, 협상, 중재, 예약 넷이다.
4. 질문 레코드는 임시 가정과 가정 만료점을 가진다.
5. 묻지 않고 정한 것은 `whyNotAsked`와 함께 기록하고 언제든 이의를 걸 수 있다.

### 1.2 다루는 것

| 범위 | 절 |
|---|---|
| 전체 흐름 | §3.1 |
| 질문 레코드, 질문 종류, 응답 선택지, 검증 규칙 | §3.2 |
| 권리 게이트·정보 게이트 판정, 질문 조건과 문턱 | §3.3 |
| 판정 결과 다섯 갈래 | §3.4 |
| 전달 방식 결정, 발화, 우선순위, 병합, 전달 기록 | §3.5 |
| 임시 가정과 가정 만료점, 늦은 답 | §3.6 |
| 중재자 | §3.7 |
| 사람이 없을 때 | §3.8 |
| 혼자 정한 결정 기록과 확인 | §3.9 |
| 이의 뒤 되돌림·재작업 | §3.10 |
| 범위를 줄여 진행 | §3.11 |
| 되돌릴 지점(rollback_point) | §3.12 |
| 자동 검증 가능한 선택 | §3.13 |
| 권리 게이트 승인과 인자 지문 | §3.14 |
| 사람 조작 2회 상한과 C/A 우선 | §3.15 |
| 질문 다이얼과 설정 | §3.16 |
| 상태 기계 표 | §3.17 |
| 명령 상세 | §3.18 |
| 측정 | §3.19 |

### 1.3 다루지 않는 것

| 다루지 않는 것 | 소유 |
|---|---|
| 단일 변경 경로, 거부 갈래와 코드, 명령 공통 검사 | [10](10-kernel.md) |
| 질문·선택·전제·이의 레코드의 스키마와 상태 기계 | [08](08-domain-model.md) §3.10, §3.13, §3.22 (이 문서는 그 위의 규칙과 08에 대한 추가 요구) |
| 이벤트 이름·payload·타이머 투영(`p_timers`) | [09](09-event-store.md) |
| 권리 대상(돈, 대리 발언, 타인 영향, 정보 유출, 되돌릴 수 없는 외부 행동)의 판별 | 권한 레이어 (13, 18). 브리프 결정 2 |
| 질문 화면, 알림 문구, 복귀 요약 화면 배치 | 03, 04, 05, 21 |
| OS 알림 표시, 클라이언트 presence 신호 | 19, 20 |
| run 정지·재개, 타이머 실행, 중재자 run 실행, 복귀 요약 생성 | 12 |
| 되돌릴 지점의 실제 생성(git, 스냅숏), 검증 격리 | 13 §3.7.8~§3.7.9 |
| 다이얼 정본 목록, 모드 묶음, 주의 예산, 작업 경계 발생 | 14 (질문 다이얼의 의미는 이 문서 §3.16) |
| 원함 탐구의 자극·반응 절차, 기준 후보 생성 | 15 |
| 지표 수집과 정책 수정 제안 생성 | 16 |

## 2. 전제와 결정

### 2.1 브리프 결정과 이 문서의 귀결

| 브리프 결정 | 귀결 |
|---|---|
| 2 effect class·가역성은 권한 레이어 | 권리 게이트의 대상 분류는 권한 레이어 판정(`PermissionVerdict.rightsGate`와 권리 범주, 18 §3.11.6)으로 받는다. 커널이 직접 아는 권리 범주(Goal 변경, 결과 확인, 약속 확정, 정책 변경, 권한 확대)만 이 문서가 정한다 [결정] |
| 8 혼자 정한 결정 기록·이의 | §3.9, §3.10 [결정] |
| 12 묻기 재설계(구조 결정, 다이얼 수치는 제안) | §3.2~§3.8의 구조는 [결정], 문턱 수치·기본값은 [제안] |
| 14 결정 주체 원칙 | 질문 조건의 입력은 모델이 구조화된 값으로 선언하고, 판정은 코드가 한다 (§3.3) [결정: 원칙] |
| 16 질문 조건 AND 기본 + 조건별 문턱 다이얼 | [제안] 그대로 채택. AND/OR 선택 옵션은 실제 사용 후 결정(§7 A-1) |
| 17 불변조건 1~7 | 권리 게이트 질문은 어떤 다이얼에서도 가정 확정되지 않는다. 혼자 정한 결정은 어떤 다이얼에서도 기록된다 [결정] |
| 18 대안 2~3개 고르기 거부 | 원함 탐구(I.want)에서 "하나 고르기" 질문을 만들지 않는다 (V-Q-03, 08 R-23) [결정] |
| 22 클라이언트 없이 작업 계속 | 사람이 없을 때도 결정과 진행을 미루지 않는다 (§3.8) [결정] |
| 37 사용자 문구는 키로 | 질문 사유·알림 문구는 05의 문구 키로 낸다(§3.5.6) [결정] |

### 2.2 이 문서의 주요 [제안]

1. **전달 시점과 알림 강도를 나눈다.** 전달 방식(즉시·협상·중재·예약: 언제 사람 앞에 놓이는가)과 알림 강도(끼어들기·알림·묶음: 얼마나 세게 알리는가)를 다른 값으로 둔다. 권리 게이트는 언제나 즉시 놓이지만, 작업을 막지 않는 권리 질문(예: Goal 수정 확인)은 끼어들지 않고 알림으로 둔다. McFarlane의 결과(즉시 끼어들기가 원래 작업을 가장 많이 방해함, 협상이 종합 최선)를 권리 게이트에도 반영하기 위해서다(v0.3 06 §2.4 [원문]). 강도는 레코드 필드가 아니라 질문 상태·presence·다이얼에서 계산한다(`urgencyOf`, §3.5.1).
2. **세 조건이 거짓일 때의 처리를 조건별로 다르게 한다.** 대화 L3384("하나라도 거짓이면 묻지 않는다. 대신 정책대로 처리하거나, 에이전트가 정하고 기록만 남기거나, 나중에 모아서 묻는다")를 조건에 대응시킨다: 조건 1 거짓 → 정책대로, 조건 2 거짓 → 혼자 정하고 기록, 조건 3 거짓 → 모아서 나중에 묻는다(임시 가정으로 진행). v0.3 06 §3.1 "결정 1은 낮은 문턱. 불확실하면 일단 기록"과 맞는다.
3. **이의가 걸린 결정점은 다시 자율로 정하지 않는다.** 이의 뒤 같은 결정점의 재결정은 반드시 질문을 거친다(V-AUT-02).
4. **권리 게이트 승인은 인자 지문 1회다.** 사람이 허락한 그 인자로 한 번만 실행된다. 사람이 인자를 고쳐서 허락할 수 있다(§3.14). 별도 토큰 레코드 없이 08의 질문 `approvalFingerprint`·`consumedByToolCallId`와 도구 호출의 승인 상태로 표현한다.
5. **사람 조작 2회 상한은 Helm이 먼저 묻는 정상 경로 질문에 거는 설계 목표다.** 사람이 스스로 하는 조작과 정상 경로 밖 조작(01 R-OP-4)은 막지 않고 사유와 함께 센다. C/A 단계의 정보 게이트 질문은 결과 확인 때 함께 답하도록 묶는다(§3.15).
6. **사람의 접속 상태(presence)는 이벤트가 아니다.** 데몬이 19 `presence.report`와 연결 상태에서 만든 값을 커널에 `ctx.presence`로 넘긴다(10 §3.1). 전달 판정의 결과(`question.delivery_planned`, `question.delivered`)가 이벤트로 남으므로 재생에 presence가 필요 없다.

### 2.3 원천 대비 바뀐 점

| 원천 | 내용 | 이 문서 | 이유 |
|---|---|---|---|
| v0.3 06 §3.5 | 상태 pending → delivered → answered·assumed, withdrawn, expired | 08과 같은 여섯 상태. 예약은 `pending` + `plannedDelivery`, 미루기 답은 `plannedDelivery` 갱신 | 08 §3.22.7 |
| v0.3 06 §3.4 | 질문 레코드 필드 | 08 필드 + 결정점 키, 판정 기록, 병합 키, 가정의 답 형식 값, 깊이(08에 요구, §3.2) | canon-3 G4, C11, Mastra suspend/resume 스키마, 금지 상호작용 8(중복 질문) |
| v0.3 06 §3.3 | 권리 게이트 → 즉시 | 시점은 즉시, 강도는 막힘 여부로 | §2.2 1 |
| v0.3 06 §4.2 | Choice에 autonomous 필드 | 08 결정 레코드(ch, lp, lt, sa, sc, md)의 `Autonomy` 블록 | 08 D08-4 |
| canon-3 C10 | 침묵을 고위험 약속의 수락으로 해석하지 않음 | 권리 게이트 질문은 가정 확정되지 않고 시간으로 만료되지도 않는다. 대상이 사라질 때만 `expired` | Speech Acts 규칙 6, 08 §3.22.7 |
| 원전 F06 §10 | `maximum_active_gates: 3` | 화면 표시 수 설정(기본 3)과 묶음 크기 설정. 권리 게이트는 수 상한으로 숨기지 않는다 | canon-3 C3 |
| v0.3 06 §3.7 | 중재자의 결정도 이의 가능한 자율 결정 | 중재자의 전달 계획은 `question.delivery_planned`(decidedBy agent:mediator)로 기록되고 보인다. 이의 레코드 대상은 아니다. 사람은 미루기·지금 보기(`question.escalate`)로 바꾼다 | 08 `ContestableId`에 질문이 없음. 전달 시점은 사람이 바로 바꿀 수 있어 이의 절차가 필요 없다 |

### 2.4 1판 이름과의 대응

12·13·14·15·16·19·20이 1판 이름을 인용했으므로 대응을 남긴다.

| 1판 | 2판 | 근거 |
|---|---|---|
| 상태 `scheduled` | `pending` + `plannedDelivery` | 08 §3.22.7 |
| `question.raised`, `question.updated` | `question.recorded`. 갱신 이벤트 없음(병합은 §3.5.5) | 09 |
| `delivery.planned` | 질문별 `question.delivery_planned` | 09 |
| WorkingAssumption(`wa_`), `working_assumption.created` | 전제 `Assumption`(`as_`, `origin.kind = 'question'`), `assumption.recorded`·`confirmed`·`invalidated`·`retired` | 08 §3.8 |
| ApprovalToken(`ap_`), `approval.issued`·`consumed` | 질문 `approvalFingerprint`·`consumedByToolCallId`, `toolcall.approved`·`denied` | 08 §3.13, §3.22.14 |
| Contest(`ct_`), `decision.contested`, `contest.resolve`·`contest.resolved` | Objection(`ct_`), `objection.filed`·`objection.resolved`, 명령 `decision.contest`, `objection.withdraw`·`dismiss` | 08 §3.10.2 |
| `choice.decided` | `choice.committed`(`AutonomousDecision`) | 08 |
| `AutonomyMeta`(이벤트), `whyNotAsked` 종류 `information_gate_false`·`policy`·`structural_default` | 08 `Autonomy`(레코드), `WhyNotAsked` 다섯 종류 (`info_gate`, `assumption_expired`, `within_grant`, `emergency`, `auto_verifiable`) + 08에 요구하는 둘(§3.9.1) | 08 §3.4.5 |
| `presence.update`, `presence.changed` | 없음. `ctx.presence`(운영 상태) | 10 §3.1, 19 §3.7.8 |
| `boundary.reach` | 명령 `runtime.boundary` → 이벤트 `boundary.reached` | 10 §3.11.7, 14 §3.13.6 |
| `situation.acknowledge` | `brief.acknowledge` → `brief.acknowledged` | 09, 19 |
| `question.seen` | 없음. 열람은 19 `presence.report`의 `objectId`로 데몬이 운영 기록에 남긴다 | 19 §3.7.8 |
| `rework.required`·`plan`·`complete` | 재작업 필요는 상태에서 계산, 재작업은 `reworkOf`가 있는 WorkUnit | §3.10.3 |
| 권리 게이트 `deadline` | 없음 | §3.3.1 규칙 4 |
| 경계 `daily_digest`, `concern_switch` | 14 경계 `review_window`, `user_return`. 초점 변경 발화는 두지 않는다 | 14 §3.13.6 |
| 코드 `content.*`, `qualification.*` | 10 §3.4.4의 `invalid.*`·`policy.*`·`denied.*`·`gate.*` | 10 §3.4.6 대응표 |

## 3. 명세 본문

### 3.1 전체 흐름

```text
결정점 발생
  │  (A) 에이전트가 choice.decide / question.raise 에 DecisionPoint를 선언
  │  (B) 커널이 판정 중 사람 결정이 필요함을 앎 (권리 범주, 범위 확대, 결과 확인, 약속 확정, 회복 등)
  │  (C) 오케스트레이터(14)·탐구 엔진(15)이 사람 접점을 question.raise 로 제출
  ▼
게이트 판정 (§3.3)
  ├─ 권리 게이트 ─────────────────────────────→ 질문(권리), 해당 행동 막음, 가정 없음
  └─ 정보 게이트: 조건 1 → 2 → 3 (AND, 조건별 문턱)
        ├─ 조건 1 거짓 (정책이 덮음) ───────────→ 정책대로 처리: 혼자 정하기 또는 자동 검증 (§3.13)
        ├─ 조건 2 거짓 (결과 차이 없음) ─────────→ 혼자 정하기 + whyNotAsked
        ├─ 조건 3 거짓 (지금 물을 가치 < 비용) ──→ 질문(묶음 전달) + 임시 가정으로 진행
        └─ 모두 참 ────────────────────────────→ 질문
              ├─ 가정하고 진행 가능 ─────────────→ 질문 + 임시 가정 + 만료점 (+ 쓰기 전 되돌릴 지점)
              ├─ 독립 부분 있음 ────────────────→ 질문 + 범위를 줄여 진행 (§3.11)
              └─ 그 밖 ─────────────────────────→ 질문 + 해당 WorkUnit 막음
  ▼
전달 결정 (§3.5): 방식(즉시·협상·중재·예약) × 발화 조건 → 강도(끼어들기·알림·묶음)는 계산
  ▼
전달 → 답 / 가정 확정(만료) / 철회 / 만료
  ▼
효과: 막힌 run 재개 지시, 가정과 답 비교 → 같음: 전제 확정 / 다름: 전제 무효화와 재작업 (§3.10), 승인 대조 (§3.14)

혼자 정한 결정 → "에이전트가 정한 것" (§3.9) → 확인 / 이의 → 영향 계산, Concern 재개, 재작업 (§3.10)
```

### 3.2 질문 레코드 [결정: 존재와 핵심 필드(v0.3 06 §3.4, 08 §3.13) / 제안: 추가 필드]

질문 레코드는 08 §3.13 `Question`이다. 이 문서는 그 필드를 다음 뜻으로 쓰고, 묻기 규칙에 필요한 필드를 08에 더해 달라고 요구한다(§5.2).

| 08 필드 | 이 문서에서의 뜻 |
|---|---|
| `questionKind` | 질문 종류 (§3.2.2). 응답 선택지·막힘 범위·기본 전달의 기준 |
| `gate`, `blocking` | 권리·정보 게이트, 막힘 여부. 세 변형(권리 / 정보·막힘 / 정보·비막힘)은 08 스키마가 강제한다 |
| `reasons` | 왜 사람이 정해야 하는가의 분류(canon-3 G4). 사용자 문장 키는 `question.reason.<값>`(05 요구 (2)) |
| `text`, `whyNow`, `options`, `recommendation`, `strongestAlternative`, `unknowns`, `delayImpact`, `reviewTrigger`, `evidence` | v0.3 06 §3.4의 질문 문장 구성. `delayImpact` = 답이 없으면 자동으로 진행할 것 |
| `subjectRef` | 질문 대상: 합의 확인 → `ag`, 결과 확인 → `rs`, 권리 승인 → `tc`, Goal 수정 → `gl`, 재결정 → 이의가 걸린 레코드 |
| `approvalFingerprint`, `consumedByToolCallId` | 권리 승인 지문과 소진 (§3.14) |
| `answerSchema` | 답 값의 구조 (Mastra `resumeSchema`에 해당) |
| `delivery.mode`, `delivery.decidedBy`, `plannedDelivery`, `escalations`, `deliveredAt`, `deliveredTo` | 전달 (§3.5) |
| `batchKey` | 묶음 키. 같은 발화로 함께 놓이는 질문 묶음 (04의 `bundleId`) |
| `assumption`, `assumptionExpires` | 임시 가정 문장과 그 전제 ID, 가정 만료점 (§3.6) |
| `rollbackPoint` | 가정하고 진행할 때 되돌릴 지점의 서술. 실제 지점은 `rb` 레코드 (§3.12) |
| `answer.matchesAssumption`, `resolutionChoiceId` | 답과 가정 비교, 가정 확정 때 만든 선택 |

08에 더해 달라고 요구하는 필드:

```ts
// @helm/domain/src/records/question.ts 에 더할 것 (08에 요구, §5.2)
export interface QuestionAskingFields {
  /** 정보 게이트 결정점 키. concernId + decisionKind + 모델 선언 키를 정규화. 병합과 이의 뒤 재결정 판별에 쓴다 */
  readonly decisionPointKey: string | null;
  /** 열린 질문 병합 키 (§3.5.5) */
  readonly dedupeKey: string;
  /** 정보 게이트 판정 기록 (§3.3.4). "왜 사람이 정해야 하는가"의 설명 가능한 근거 */
  readonly askEvaluation: AskEvaluation | null;
  /** 에이전트가 혼자 정할 수 없는 이유 (Subsidiarity 규칙 2). 정보 게이트에서 필수 */
  readonly whyLocalInsufficient: string | null;
  /** 권리 게이트 범주. 권한 레이어 판정(18) 또는 커널 명령 종류. 권리 게이트에서 1개 이상 */
  readonly rightsCategories: readonly RightsCategory[];
  /** 임시 가정을 답 값으로 쓴 것 (§3.6.4 비교, 16 matchesAssumption). 08 assumption.{text, assumptionId} 옆 */
  readonly assumptionAnswer: AnswerValue | null;
  /** 화면 검토 깊이 (04 요구 (1)). 모델이 선언, 기본은 종류별 */
  readonly depth: 'light' | 'normal' | 'deep';
}

export type RightsCategory =
  // 권한 레이어 (18 §3.11.6)
  | 'spend_money' | 'speak_for_user' | 'affect_others' | 'disclose_data' | 'irreversible_external'
  // 커널이 명령 종류로 아는 것
  | 'goal_change' | 'result_acceptance' | 'commitment_acceptance' | 'policy_change' | 'authority_expansion';
```

#### 3.2.1 필드 출처

| 필드 | 출처 |
|---|---|
| 질문 문장 구성(`text` ~ `reviewTrigger`) | v0.3 06 §3.4 "지금 정할 것, 왜 지금인지, 선택지와 추천, 가장 강한 다른 선택, 아직 모르는 점, 미뤘을 때의 영향, 다시 볼 조건", 원전 F06 §4 Gate 13필드 중 Question·Why now·Recommendation·Alternative·Uncertainty·Consequences·Reopen trigger |
| `reasons`, `whyLocalInsufficient` | canon-3 G4, Subsidiarity 규칙 2(why-local-insufficient), 원전 Gate reason |
| 반대 근거 | 원전 Gate "Strongest counterevidence", F06 §12 금지 3(추천만 강조하고 반대 증거 숨김). 08 `evidence`에 반대 근거 관찰을 함께 넣고 화면은 `strongestAlternative`와 함께 보인다 |
| `assumptionExpires` | v0.3 06 §3.6 가정 만료점, 원전 Gate "Last cheap point to change direction" |
| `delayImpact` + `assumption` | 원전 Gate "What proceeds automatically if no decision is made" |
| 응답 선택지 `defer` | 원전 Gate 사용자 행동 "Defer until a specified trigger" |
| `answer.matchesAssumption` | 원전 Gate §9 "Decision impact feedback", v0.3 06 §7 지표 |
| `answerSchema` | Mastra `suspendSchema`/`resumeSchema`(`mastra-review.md` §5, §9) [원문] |

#### 3.2.2 질문 종류

질문 종류는 08 `QuestionKind`다. 종류마다 게이트, 응답 형식, 막힘 범위, 기본 전달을 레지스트리 데이터(`RuleBundle.questionKinds`, 10 §3.1)로 둔다. 08에 없는 종류는 08에 더해 달라고 요구한다(§5.2). 14의 사람 접점 종류(14 §3.5.3)와 15의 질문 종류는 오른쪽 열로 대응한다.

| 08 종류 | 게이트 | 형식 (§3.2.3) | 막힘 범위 | 만드는 곳 | 14·15 이름 |
|---|---|---|---|---|---|
| `choice` | information | answer / choose_one | 판정 결과(§3.4) | `choice.decide`·`question.raise` (커널 판정) | `question` 제안 |
| `fact`, `reference_scope` | information | answer | 판정 결과 | `question.raise` | |
| `criterion_confirm` | information | confirm_candidate (여러 후보 묶음 가능, 15 요구) | 없음 | 15 | `criterion_confirm` |
| `agreement_confirm` | rights(`commitment_acceptance`) | confirm_candidate | 그 합의의 쓰기 | `agreement.propose`가 Grant로 활성화되지 않을 때 (10) | `agreement_confirm`, `probe_agreement` |
| `result_review` | rights(`result_acceptance`) | result_review | 없음 (쓰기는 이미 끝남) | `result.submit` (10) | `result_review` |
| `scope_change` | rights(`authority_expansion`) | approve_action | 그 행동 | 범위 밖 도구 호출 (10) | `scope_exceeded` |
| `send_approval` | rights(권한 레이어 범주) | approve_action | 그 행동 | 권리 범주 도구 호출 (10, 18) | `rights_permission` |
| `goal_revision` | rights(`goal_change`) | confirm_candidate | 없음. 확정 전까지 이전 Goal이 기준 | `goal.revision.propose` (10) | `goal_revise` |
| `stop_condition` | information | answer | WorkUnit | 멈출 조건 충족 (10) | |
| `situation_confirm` | information | confirm_candidate | 없음 | 14 | |
| `other` | information | answer | 판정 결과 | 그 밖 | |
| **08에 요구** `action_approval` | rights(권한 레이어 범주) | approve_action | 그 행동 | send 아닌 권리 행동(돈을 쓰는 execute, 공유 브랜치 push). 08이 `send_approval`을 넓히면 그것을 쓴다 | `rights_permission` |
| **08에 요구** `finding_confirm` | information | confirm_candidate | 없음 | 결정에 쓰이는 판단 승격 (10 §3.9) | `finding_confirm` |
| **08에 요구** `goal_achievement` | rights(`result_acceptance`) | confirm_candidate | 없음 | `goal.achievement.claim` (10) | |
| **08에 요구** `policy_change` | rights(`policy_change`) | confirm_candidate | 없음, 예약 전달 | `policy.change.propose` (10, 16) | |
| **08에 요구** `tool_outcome_unknown` | information | answer | WorkUnit | 결과 불확실 도구 호출 (10 §3.11.7, 12 요구) | 12 `recovery` |
| **08에 요구** `scope_violation` | information | answer | WorkUnit | 사후 범위 위반 (10 E-11) | |
| **08에 요구** `entry_confirm` | information | confirm_candidate | 없음 | "Concern으로 열까요?" (01, 14) | `entry_suggestion` |
| **08에 요구** `structure_cap` | information | answer | 없음 | 구조 상한 초과 (10, 14) | `structure_limit` |
| **08에 요구** `semantic_conflict` | information | answer | 겹치는 쓰기 | 의미 충돌 (10 R-6) | |
| **08에 요구** `prediction_check` | information | answer | 없음 | 예측 확인일 (10 `timer.fire`) | |
| **08에 요구** `stimulus_round`, `triad` | information | reaction (§3.2.3) | 없음 | 원함 탐구 (15) | `stimulus_round`, 15 `triad` |
| **08에 요구** `reframe_confirm` | information | confirm_candidate | 없음 | 문제 재정의 (15 §3.7) | 15 `reframe_confirm` |
| **08에 요구** `emergency_authorization` | rights(`authority_expansion`) | approve_action | 그 행동 | 비상 Grant가 없는 혼돈 상황 (14 §3.6.7) | `emergency_authorization` |
| **08에 요구** `watch_verdict`, `progress_stall`, `budget_extension`, `submission_missing` | information | answer | 종류별(14) | 오케스트레이터 (14) | 같은 이름 |
| **08에 요구** `kernel_error` | information | answer | WorkUnit | 커널 오류로 작업 정지 (10 E-9) | |

08이 종류를 더하기 전에는 `other` + `reasons`로 기록하고 레지스트리 키를 `answerSchema`의 `$id`에 둔다(임시 처리) [제안].

#### 3.2.3 질문 형식과 응답 선택지

응답 선택지는 질문마다 저장하지 않고 종류의 형식에서 정한다. 질문을 기록할 때 모델이 선택지를 빼먹을 수 없게 하기 위해서다(A15, V-Q-02). 클라이언트는 19 `protocol.describe`와 질문 뷰로 형식과 선택지를 받는다.

```ts
export type QuestionForm =
  | 'answer'             // 구조화된 답 (answerSchema)
  | 'confirm_candidate'  // 후보(기준, 판단, 합의, Goal 수정, 재정의)를 확정·수정·거절
  | 'approve_action'     // 특정 행동 허락·거절 (권리 게이트)
  | 'result_review'      // 결과 확인 다섯 결정 (10 §3.11.8)
  | 'choose_one'         // 선택지 중 하나 고르기. I.want에서 금지 (V-Q-03)
  | 'reaction';          // 자극 반응 요청 (15). 답은 반응 관찰로 기록되고 선택을 만들지 않는다

export type ResponseOptionId =
  | 'accept_recommendation'  // 추천대로 정하기
  | 'accept_assumption'      // 가정대로 진행 (19 question.proceedWithAssumption)
  | 'answer'                 // 다른 선택으로, 고쳐서 정하기 (값 또는 고친 문장)
  | 'confirm' | 'reject'
  | 'approve'                // 허락
  | 'approve_edited'         // 고쳐서 허락, 범위 줄여 허락 (05 "범위 줄여 허락"은 줄인 인자 초안을 고친 값으로)
  | 'deny'                   // 하지 않기
  | 'modify_criteria'        // 기준 고치기
  | 'reframe_question'       // 질문 다시 쓰기 (19 question.requestReframe)
  | 'experiment_first'       // 먼저 알아보기 (19 question.requestInquiry)
  | 'delegate'               // 맡기기: 에이전트가 정하게 둔다 (19 question.delegate)
  | 'defer'                  // 미루기 (명령 question.defer)
  | 'narrow_scope';          // 범위 줄여 진행

export type AnswerValue =
  | { readonly option: 'accept_recommendation' }
  | { readonly option: 'accept_assumption' }
  | { readonly option: 'answer'; readonly value?: unknown; readonly edits?: string }   // value는 answerSchema로 검증
  | { readonly option: 'confirm'; readonly edits?: Readonly<Record<string, unknown>> }
  | { readonly option: 'reject'; readonly reason?: string }
  | { readonly option: 'approve'; readonly conditions?: readonly string[] }
  | { readonly option: 'approve_edited'; readonly editedArgsBlob: BlobRef; readonly editedFingerprint: Sha256 }
  | { readonly option: 'deny'; readonly reason?: string }
  | { readonly option: 'modify_criteria'; readonly changes: string }
  | { readonly option: 'reframe_question'; readonly reframed: string }
  | { readonly option: 'experiment_first'; readonly experiment?: string }
  | { readonly option: 'delegate'; readonly note?: string }
  | { readonly option: 'narrow_scope'; readonly instruction: string }
  | { readonly option: 'review'; readonly decision: AcceptanceDecision; readonly conditions?: readonly string[];
      readonly bundled?: readonly { readonly questionId: QuestionId; readonly answer: AnswerValue }[] };  // result_review (§3.15)
```

`AnswerValue`는 08 `question.answered`의 `value`에 들어간다. 미루기는 답이 아니라 전달 계획의 변경이라 따로 명령(`question.defer`)이다.

형식별 필수 선택지(A15, 10 §3.15). 레지스트리 적재 때 검사한다(10 V-POL-01과 같은 시점).

| 형식 | 필수 선택지 |
|---|---|
| answer | answer, modify_criteria, reframe_question, experiment_first, delegate, defer, narrow_scope (+ 추천이 있으면 accept_recommendation, 비막힘이면 accept_assumption) |
| confirm_candidate | confirm, reject, modify_criteria, reframe_question, defer (+ 정보 게이트·비막힘이면 accept_assumption) |
| approve_action | approve, approve_edited, deny, narrow_scope, defer |
| result_review | review(10 §3.11.8의 다섯 결정: accept, accept_with_conditions, request_changes, reject, criteria_wrong), defer |
| choose_one | answer(고른 것), modify_criteria, reframe_question, experiment_first, delegate, defer, narrow_scope |
| reaction | 15 §3.4의 반응 입력 전체, defer |

- 권리 게이트에는 `accept_assumption`과 `delegate`가 없다. 들어오면 `policy.answer_option_not_allowed`(19 요구 (2) "권리 게이트의 `proceedWithAssumption` 거부").
- "계속할까요?"처럼 실질적 선택이 없는 질문은 형식이 없다. 질문 종류·형식 조합이 레지스트리에 없으면 기록을 거부한다(V-Q-03, approval theater 방지, 원전 F06 §12 금지 1).
- 원함 탐구(I.want)에서는 `choose_one`을 쓰지 않는다(08 R-23). 원함 탐구의 질문은 기준 후보 확인, 재정의 확인, 반응 요청(`reaction`), 사실 질문(참고 자료 범위 등)만이다(v0.3 06 §3.4). 반응은 질문의 답이 아니라 관찰(`obsKind: reaction`)로 기록한다(08 D08-5, 브리프 결정 18).
- 이의는 응답 선택지가 아니다. 질문의 전제나 추천에 이의를 걸려면 `decision.contest`로 대상 레코드(추천이 기댄 판단·가능성 등)를 가리킨다(05 §3.1.5 마지막 행).

응답 선택지별 처리(04 요구 (2), 05 요구 (3)):

| 선택지 | 처리 |
|---|---|
| `accept_recommendation` | 추천 선택지를 값으로 사람 선택(`choice.committed`, HumanDecision, viaQuestion) 또는 종류별 효과 |
| `accept_assumption` | 임시 가정을 값으로 사람 선택. `matchesAssumption = true`. 전제 `assumption.confirmed` |
| `answer` | 값으로 사람 선택. `edits`만 있으면(자연어로 고친 선택) 런타임이 값으로 바꾸지 않고 선택의 `decision` 문장으로 그대로 쓴다 |
| `confirm` / `reject` | 종류별 효과(08 §3.22.7 표: 합의 확정·거절, Goal 수정 확정·거절, 기준 확정, 판단 확인) |
| `approve` / `approve_edited` / `deny` | §3.14 |
| `modify_criteria`, `reframe_question`, `experiment_first`, `narrow_scope` | 질문은 answered. 선택은 만들지 않는다. 막힌 run 재개 지시에 답을 실어 보낸다. 임시 가정은 유지되고(전제 active), 에이전트가 고친 질문·탐구 WorkUnit·줄인 범위를 새로 낸다. 새 질문은 같은 `decisionPointKey`를 쓴다 |
| `delegate` | 질문은 answered. 에이전트가 정하고 `whyNotAsked = { kind: 'delegated', questionId }`(08에 요구, §3.9.1)로 기록한다. 이 선택도 이의 대상이다 |
| `review` | 결과 확인(`acceptance.recorded`)과 묶인 질문의 답을 한 번에 (§3.15) |

#### 3.2.4 질문 검증 규칙

| ID | 내용 | 실패 코드 (10 §3.4.4) |
|---|---|---|
| V-Q-01 | `text`, `whyNow`, `delayImpact`, `reasons`가 있다. 정보 게이트면 `whyLocalInsufficient`가 비어 있지 않다. 권리 게이트면 `rightsCategories` ≥ 1 | `invalid.question_shape` |
| V-Q-02 | 종류의 형식이 레지스트리에 있고, 형식의 필수 선택지를 모두 가진다(레지스트리 적재 시 검사) | `invalid.question_shape` |
| V-Q-03 | 형식이 종류에 허용된 형식이다. 루프가 I.want이면 `choose_one` 금지. 진행 확인 종류 없음 | `policy.want_inquiry_pick_question`, `policy.question_without_choice` |
| V-Q-04 | 권리 게이트 질문은 `assumption`·`assumptionExpires`가 없다 (08 스키마) | `invalid.assumption_on_rights_gate` |
| V-Q-05 | 같은 `dedupeKey`의 열린 질문이 있으면 새로 만들지 않는다 (§3.5.5) | accepted + `notice.question_merged` |
| V-Q-06 | 정보 게이트·비막힘 질문은 임시 가정과 만료점을 가진다. 모델이 만료점을 선언하지 않으면 기본값 "다음 작업 경계"(`{ kind: 'boundary', boundary: 'workunit_end', count: 1 }`, 01 요구)를 넣는다 | 기본값 적용 + notice |
| V-Q-07 | 답 선택지가 형식의 선택지 안이고, `answer`의 값이 `answerSchema`를 만족한다. `approve*`·`deny`는 권리 게이트에서만, `accept_assumption`·`delegate`는 정보 게이트에서만 | `invalid.schema`, `policy.answer_option_not_allowed` |
| V-Q-08 | 에이전트의 `question.raise`(정보 게이트)는 `DecisionPoint`를 가지며, 판정 결과가 "정책대로"·"혼자 정하기"이면 질문을 만들지 않는다. 사람 접점 종류(14 §3.5.3)로 오케스트레이터·15가 낸 질문은 종류의 기본 게이트를 쓰고 이 검사를 건너뛴다 | `policy.question_not_needed` (다음 행동: `choice.decide`) |
| V-Q-09 | `question.withdraw`는 질문을 낸 역할, 커널, 사람만 | `denied.capability` |

### 3.3 게이트 판정

#### 3.3.1 권리 게이트 [결정: 개념(v0.3 06 §3.2) / 제안: 범주와 처리]

권리 게이트는 "원래 사람이 정할 권리가 있는 결정"이다. 정보 가치가 0이어도 묻는다.

| 범주 | 판별 주체 | 예 | 질문 종류 | 막힘 |
|---|---|---|---|---|
| `spend_money` | 권한 레이어 | 유료 API 대량 호출, 구매 | `action_approval` | 그 행동 |
| `speak_for_user` | 권한 레이어 | 메일 발송, 메시지 게시, PR 코멘트 | `send_approval` | 그 행동 |
| `affect_others` | 권한 레이어 | 공유 브랜치 push, 다른 사람의 일정 변경 | `send_approval` / `action_approval` | 그 행동 |
| `disclose_data` | 권한 레이어 | 외부로 파일·비밀 전송 | `send_approval` | 그 행동 |
| `irreversible_external` | 권한 레이어 | 프로덕션 데이터 삭제 | `action_approval` | 그 행동 |
| `goal_change` | 커널 (명령 종류) | `goal.revision.propose` | `goal_revision` | 없음. 확정 전까지 이전 Goal이 기준 |
| `result_acceptance` | 커널 | `result.submit`, `goal.achievement.claim` | `result_review`, `goal_achievement` | 없음 |
| `commitment_acceptance` | 커널 | Grant로 활성화되지 않는 `agreement.propose` | `agreement_confirm` | 그 합의의 쓰기 (읽기 탐구는 계속) |
| `authority_expansion` | 커널 | 범위 밖 쓰기, 합의 범위 확대 요청, Grant 포함 검사 실패, 비상 권한 | `scope_change`, `emergency_authorization` | 그 행동 |
| `policy_change` | 커널 | 관찰 에이전트의 정책 수정 제안 | `policy_change` | 없음, 예약 전달 |

권리 게이트 처리 규칙:

1. 질문은 언제나 기록되고 즉시(`delivery.mode = immediate`) 놓인다. 강도는 막힘이 있으면 끼어들기, 없으면 알림이다(§2.2 1).
2. 임시 가정을 두지 않는다. 답이 없다고 허락으로 보지 않는다(canon-3 C10, 원전 F06 §12 금지 10, 05 요구 (1)).
3. 막히는 것은 그 행동(또는 그 합의의 쓰기)뿐이다. 다른 작업은 계속한다(v0.3 06 §6 예시 Q-15 "관련 작업만 멈추고 나머지 계속").
4. 시간으로 만료되지 않는다. 대상이 의미를 잃을 때(합의 취소, Concern 닫힘, 막힌 run의 WorkUnit 취소)만 `question.expired`다(08 §3.22.7). 1판의 마감(`deadline`)은 두지 않는다. 침묵을 거절로도 해석하지 않고 기다린다(§7 A-3).
5. 권리 게이트 질문은 사람 조작 상한(§3.15), 화면 표시 수, 주의 예산(14 §3.13.5 규칙 1)으로 숨기지 않는다(canon-3 C3).
6. 권한 레이어는 질문을 만들지 않는다. `needs-human`·`rightsGate` 판정을 커널에 넘기고 커널이 질문을 만든다(18 요구).

#### 3.3.2 정보 게이트의 입력: 결정점 선언

정보 게이트 판정은 모델이 선언한 구조화 값(결정점)과 상태·정책·다이얼로 코드가 한다(결정 주체 원칙).

```ts
export interface DecisionPoint {
  readonly decisionKind: string;                 // 결정 종류 레지스트리 키 (§3.3.3)
  readonly key: string;                          // 모델이 붙이는 결정점 키. 커널이 concernId + decisionKind와 합쳐 정규화
  readonly summary: string;                      // 지금 정할 것
  readonly options: readonly { readonly key: string; readonly label: string; readonly consequence: string }[]; // I.want에서는 비움
  readonly default: {                            // 묻지 않으면 따를 것 = 임시 가정 후보
    readonly optionKey: string | null;
    readonly label: string;
    readonly reason: string;
    readonly answer: AnswerValue;                // 답 형식의 가정값 (§3.6.4 비교에 씀)
  };
  readonly declared: {
    readonly outcomeDifference: 'none' | 'minor' | 'material' | 'major' | 'unknown';  // 조건 2 입력
    readonly wrongDefaultLikelihood: 'low' | 'medium' | 'high' | 'unknown';         // 조건 3 입력
    readonly autoVerifiable: boolean;            // 조건 1의 자동 검증 정책 입력
    readonly verificationPlan?: string;
    readonly canProceedWithAssumption: boolean;
    readonly independentPartExists: boolean;     // 범위를 줄여 진행할 수 있는가
    readonly delayCost: 'none' | 'low' | 'medium' | 'high'; // 답을 기다리는 동안의 비용 (즉시 승격 입력)
    readonly expiry?: Trigger;                   // 가정 만료점 (08 Trigger + §3.6.2 확장)
    readonly boundariesUntilExpiry?: number;     // before_primitive 만료점까지 예상 경계 수 (§3.6.3)
  };
  readonly evidence: readonly AnyRecordId[];
  readonly whyLocalInsufficient?: string;        // 질문이 될 때 필요 (V-Q-01)
  readonly depth?: 'light' | 'normal' | 'deep';
}
```

모델은 권리 범주를 선언하지 않는다. 권리 범주는 권한 레이어 판정과 명령 종류에서 온다.

#### 3.3.3 결정 종류 레지스트리 [제안]

```ts
export interface DecisionKindSpec {
  readonly key: string;
  readonly description: string;
  readonly loops: readonly LoopId[];
  readonly defaultCovered: boolean;              // 시스템이 기본으로 에이전트에게 맡기는 종류
  readonly humanOnly: boolean;                   // 권리 게이트로 다룬다
  readonly allowedForms: readonly QuestionForm[];
  readonly questionKind: QuestionKind;           // 질문이 되면 쓰는 08 종류
}
```

초기 항목(데이터. 관찰 에이전트의 제안과 사람 확인으로 늘어난다):

| key | 뜻 | defaultCovered | humanOnly | 허용 형식 | 질문 종류 |
|---|---|---|---|---|---|
| `impl.naming` | 이름 짓기 | 예 | 아니오 | answer | choice |
| `impl.local_structure` | 파일 안 구조, 작은 리팩터링 | 예 | 아니오 | answer | choice |
| `impl.approach` | 구현 방법 선택 | 아니오 | 아니오 | answer, choose_one | choice |
| `impl.dependency` | 의존성 추가·교체 | 아니오 | 아니오 | answer, choose_one | choice |
| `inquiry.scope` | 탐구 범위·깊이 | 예 | 아니오 | answer | choice |
| `inquiry.source_range` | 근거 범위(작업 대상 / 문서 / 웹) | 아니오 | 아니오 | answer | reference_scope |
| `want.criterion` | 선호 기준 후보 | 아니오 | 아니오 | confirm_candidate | criterion_confirm |
| `want.reference_scope` | 참고 자료 범위 | 아니오 | 아니오 | answer | reference_scope |
| `plan.loop` | 루프 계획·전환 | 예 | 아니오 | answer | choice |
| `plan.structure` | Concern 분해·병합 | 예 | 아니오 | answer | choice |
| `scope.interpretation` | 지시의 범위 해석 | 아니오 | 아니오 | answer | choice |
| `value.tradeoff` | 가치 판단이 걸린 trade-off (예: 오래된 가격 노출 허용) | 아니오 | 아니오 | answer | choice |
| `delivery.timing` | 질문 전달 시점 (중재자) | 예 | 아니오 | - | - |
| `goal.change` | Goal 수정 | - | 예 | confirm_candidate | goal_revision |
| `external.*` | 권한 레이어가 권리 범주를 붙인 행동 | - | 예 | approve_action | send_approval, action_approval |

#### 3.3.4 질문 조건과 문턱 [결정: 세 조건(원전 Gate rule) / 제안: AND 기본과 문턱 수치(브리프 16)]

조건(v0.3 06 §2.1, 원전 정리 2 §1.12):

1. 정책이 자동으로 처리할 수 없다.
2. 사람의 결정이 결과를 실질적으로 바꾼다.
3. 지금 묻는 가치가 사람의 주의를 쓰는 비용보다 크다.

정보 가치(VoI)로 보면 조건 1 ≈ 기본 선택이 틀릴 확률의 존재, 조건 2 ≈ 틀렸을 때 손실 차이, 조건 3 ≈ 묻는 비용과의 비교이며 곱셈 구조라서 AND가 자연스럽다(대화 4-2~4-3). 기본은 AND다. 조건마다 문턱 다이얼(적게 묻기 / 보통 / 많이 묻기)을 둔다(08 DIAL_KEYS `question.threshold.c1`~`c3`).

```ts
type Level3 = 'few' | 'normal' | 'many';    // 다이얼 값: 적게 묻기 / 보통 / 많이 묻기

export interface AskEvaluation {
  readonly c1: { readonly value: boolean; readonly covered: 'none' | 'kind_default' | 'system_policy' | 'user_policy'; readonly policyId?: string; readonly threshold: Level3 };
  readonly c2: { readonly value: boolean; readonly level: number; readonly threshold: Level3; readonly unknownTreatedAs: number };
  readonly c3: { readonly value: boolean; readonly score: number; readonly threshold: Level3 };
  readonly combinator: 'and';
  readonly forcedByObjection: boolean;        // V-AUT-02로 질문이 강제됨
  readonly result: 'policy' | 'autonomous' | 'digest' | 'ask';
}
```

판정(순수 함수 `evaluateInformationGate`):

```text
evaluateInformationGate(dp, state, dials):
  kind = registry[dp.decisionKind] ?? UNKNOWN_KIND        # 모르는 종류: defaultCovered=false
  ## 조건 1: 정책이 처리할 수 있는가 (코드)
  pols = applicablePolicies(state.policies ∪ systemPolicies, dp)   # appliesTo, when 평가 (10 §3.6.4)
  if any p in pols with kind 'always_ask':           c1 = true (강제)
  else:
    covered =
      user/observer 정책(autonomy|never_ask)이 있으면    'user_policy'
      else system 정책이 있으면                          'system_policy'
      else kind.defaultCovered                         'kind_default'
      else                                             'none'
    c1 = not coveredAt(dials['question.threshold.c1'], covered)
       # few:    covered ∈ {kind_default, system_policy, user_policy} 이면 덮임
       # normal: covered ∈ {system_policy, user_policy}
       # many:   covered == user_policy
  ## 조건 2: 결과 차이 (모델 선언 + 코드 문턱)
  L = {none:0, minor:1, material:2, major:3}; unknown → 2
  c2 = L[dp.declared.outcomeDifference] >= {few:3, normal:2, many:1}[dials['question.threshold.c2']]
  ## 조건 3: 물을 가치 (모델 선언 + 코드 문턱)
  W = {low:1, medium:2, high:3}; unknown → 2
  score = W[wrongDefaultLikelihood] * L[outcomeDifference]
  c3 = score >= {few:6, normal:4, many:2}[dials['question.threshold.c3']]
  ## 결과 (거짓인 첫 조건이 처리 방식을 정한다)
  if not c1: result = 'policy'
  elif not c2: result = 'autonomous'
  elif not c3: result = 'digest'
  else: result = 'ask'
```

- "unknown"은 묻는 쪽으로 센다(불확실하면 기록, v0.3 06 §3.1).
- 조건 1의 문턱은 "무엇을 정책이 덮은 것으로 볼까"를 조절한다. "많이 묻기"는 사람이 직접 만든 정책만 인정한다.
- 조건 2는 결과 차이의 크기만 본다. 예정과 다르기만 한 것(minor)은 문턱 보통에서 묻지 않는다(canon-3 체크리스트 "예정보다 다름"과 "중요하게 나쁨" 구분).
- 대화 L3397 판정 연습으로 확인한 결과(다이얼 모두 보통):

| 상황 | 선언 | 판정 | 결과 |
|---|---|---|---|
| a) 변수 이름 `data` vs `items` | 종류 `impl.naming`(defaultCovered), 차이 none | c1: 보통에서는 kind_default로 덮이지 않음 → 참. c2: 0 < 2 → 거짓 | 혼자 정하기, `whyNotAsked = info_gate [2]` |
| b) 검색 캐시로 오래된 가격 최대 5분 노출 | `value.tradeoff`, 차이 major, 틀릴 가능성 medium | c1 참, c2 3 ≥ 2, c3 6 ≥ 4 | 질문 |
| c) 테스트로 바로 확인 가능한 두 수정 방법 | `impl.approach`, 자동 검증 가능 | `system.auto_verifiable` 정책 → c1 거짓 | 정책대로: 자동 검증 (§3.13) |
| d) 밤 11시, 내일 정해도 되는 디자인 선택 | 차이 material, 틀릴 가능성 medium, 사람 away | c1·c2·c3 참 (score 4) | 질문. 전달은 사람 부재로 예약(§3.5) |

AND/OR 선택 옵션: `combinator`의 값으로 `'and'`만 둔다. `'or'`는 실제 사용 뒤 Concern당 질문 수와 자율 결정 이의 비율을 보고 정한다(브리프 결정 16, v0.3 06 §2.1) [제안].

### 3.4 판정 결과 다섯 갈래 [제안]

```ts
export type AskOutcome =
  | { readonly kind: 'rights'; readonly question: QuestionDraft }
  | { readonly kind: 'policy'; readonly via: 'auto_verify' | 'decide'; readonly policyId: string }
  | { readonly kind: 'autonomous'; readonly whyNotAsked: WhyNotAsked }
  | { readonly kind: 'digest'; readonly question: QuestionDraft }                 // 비막힘, 임시 가정 필수
  | {
      readonly kind: 'ask';
      readonly mode: 'with_assumption' | 'with_scope_reduction' | 'blocking';
      readonly question: QuestionDraft;
    };
```

선택 알고리즘:

```text
decideAsk(dp | kernelQuestion, state, dials):
  if 권리 범주 있음 (권한 레이어 판정 또는 kind.humanOnly 또는 커널 권리 명령):
      return rights
  ev = evaluateInformationGate(dp, state, dials)
  if decisionPointKey(dp) ∈ state.objectedDecisionPoints (V-AUT-02):
      ev.result = 'ask', ev.forcedByObjection = true
  switch ev.result:
    'policy':     정책 효과가 auto_verify면 → policy(auto_verify) (§3.13), 아니면 → policy(decide)
    'autonomous': → autonomous(whyNotAsked = { kind: 'info_gate', falseConditions: [2], note })
    'digest':     → digest: 질문(정보, 비막힘) + 임시 가정(dp.default), 전달은 묶음(§3.5 D-5)
    'ask':
       if dp.declared.canProceedWithAssumption: → ask(with_assumption)
       elif dp.declared.independentPartExists:  → ask(with_scope_reduction)  # 다음 행동 agreement.narrow
       else:                                    → ask(blocking)              # WorkUnit 막음
```

| 갈래 | 이벤트 (같은 트랜잭션) | 제출자에게 돌아가는 것 |
|---|---|---|
| rights | `command.rejected`(`gate.*`, `gateQuestionId`) 또는 도구 호출이면 `toolcall.approval_requested` + `question.recorded`(권리) | `needs_gate`, 질문 ID. 런타임은 해당 행동만 보류 |
| policy(decide) | `choice.committed`(AutonomousDecision, `whyNotAsked = { kind: 'info_gate', falseConditions: [1], policyRef }`) | accepted |
| policy(auto_verify) | 검증 관찰이 있으면 `choice.committed`(`choiceKind: 'auto_verified'`, `whyNotAsked.kind = 'auto_verifiable'`). 없으면 거부 `policy.verification_missing` + 다음 행동(검증 실행) | |
| autonomous | `choice.committed`(AutonomousDecision, `info_gate [2]`) | accepted |
| digest | `question.recorded`(정보, 비막힘) + `assumption.recorded`(origin question) + `question.delivery_planned`(scheduled) | accepted + 질문 ID. 가정대로 진행 |
| ask(with_assumption) | `question.recorded`(정보, 비막힘) + `assumption.recorded` (+ 예약이면 `question.delivery_planned`) | accepted + 질문 ID |
| ask(with_scope_reduction) | `command.rejected` + `question.recorded`(정보, 막힘) | `needs_gate` + 다음 행동 `agreement.narrow` |
| ask(blocking) | `command.rejected` + `question.recorded`(정보, 막힘) | `needs_gate`, run 정지 |

임시 가정으로 진행하는 갈래(digest, ask with_assumption)에서는 선택을 아직 만들지 않는다. "지금 어떤 가정으로 일하고 있는가"는 활성 전제(`as`, origin question) 목록으로 보인다(OPD+C Predictability, v0.3 09). 답이 오면 사람 선택, 만료되면 가정 확정 선택이 생긴다(08 R-25, §3.6). 비막힘 질문의 전제는 커널이 질문과 같은 트랜잭션에서 만든다(08 R-23). 탐구 엔진(15)이 따로 기록하지 않는다(15 요구에 대한 답).

### 3.5 전달 방식 결정 [결정: 네 방식과 규칙 구조(v0.3 06 §3.3) / 제안: 순서·수치]

#### 3.5.1 전달 데이터

```ts
export type DeliveryMode = 'immediate' | 'negotiated' | 'mediated' | 'scheduled';   // 08 DeliveryMode
export type Urgency = 'interrupt' | 'notice' | 'digest';

/** 예약 전달의 발화 조건. 08 plannedDelivery의 at(시각) 또는 boundary(Trigger)로 저장한다 */
export type DeliveryTrigger =
  | { readonly kind: 'now' }
  | { readonly kind: 'at'; readonly at: Ms }                                     // Trigger at
  | { readonly kind: 'boundary'; readonly boundary: WorkBoundaryKind; readonly concernId: ConcernId | null } // Trigger boundary (§3.6.2, 08에 요구)
  | { readonly kind: 'with_result_review'; readonly workUnitId: WorkUnitId };   // Trigger record_state(wu, 'submitted') (§3.15)

/** 14 §3.13.6 작업 경계 */
export type WorkBoundaryKind =
  | 'round_end' | 'workunit_end' | 'loop_transition' | 'concern_waiting'
  | 'user_return' | 'review_window' | 'daily_rollover';
```

방식의 뜻(McFarlane 2002 [원문], v0.3 06 §2.4·§3.1):

| 방식 | 언제 사람 앞에 놓이나 | 정보 가치 계산에서 대신하는 것 |
|---|---|---|
| 즉시 | 지금 | 세 항 모두 추정. 문턱을 높게 둔다 |
| 협상 | 지금 질문함에 놓이고, 사람이 볼 때를 정한다 | 조건 3("지금 볼 가치")을 사람에게 넘김 |
| 중재 | 중재자가 정한 때 | 사람 상태 판단을 별도 행위자에게 |
| 예약 | 작업 경계·복귀·시각·결과 확인 | 묻는 비용을 경계에서 한 번 |

알림 강도는 저장하지 않고 계산한다(순수 함수, 전달 지시와 `question.delivered` payload에 넣는다).

```text
urgencyOf(q, presence, dials, state):
  if presence.state == 'away' or presence.dnd or presence.attention == 'quiet_hours': return 'digest'  # 05 §3.7.4: 방해 금지 = 자리에 없음
  if q.escalations 비어 있지 않음: return 'interrupt'                           # 만료 임박 승격
  if q.delivery.mode == 'immediate':
     return (q.blocking and (q.gate == 'rights' or 막힘 범위가 run을 멈춤)) ? 'interrupt' : 'notice'
  if q.delivery.mode == 'negotiated': return 'notice'
  return 'digest'                                                               # 예약·중재로 묶여 놓임
```

방해 금지·조용한 시간·부재에도 질문 기록과 전달 기록은 그대로 하고, 강도만 `digest`(OS 알림 없음, 질문함·배지·복귀 요약)로 낮춘다. 권리 게이트 질문도 같다. 막힌 상태는 화면에 계속 보인다(14 §3.13.5 규칙 4, 05 §3.7.4).

#### 3.5.2 규칙 (첫 일치가 적용) [제안]

| ID | 조건 | 방식 | 발화 조건 |
|---|---|---|---|
| D-1 | 권리 게이트 | immediate | now |
| D-2 | 막힘 있음 그리고 `delayCost` ≥ 즉시 승격 문턱(다이얼 `question.immediate_threshold`) | immediate | now |
| D-3 | 만료 여유 안(§3.6.3) | immediate (승격) | now |
| D-4 | 종류별 예외 다이얼(`question.kind_exceptions`)이 이 결정 종류에 방식을 지정 | 지정값 | 방식 기본 |
| D-5 | 판정 갈래 digest | scheduled | 부재면 `user_return`, 아니면 그 Concern의 다음 `workunit_end`·`round_end`나 `review_window` 중 이른 것 |
| D-6 | 정보 게이트, C·A 루프, WorkUnit의 정상 경로 사람 조작 예산이 남지 않음(§3.15) | scheduled | `with_result_review` |
| D-7 | 정보 게이트, 비막힘, 주의 예산 초과(`presence.attention == 'over_budget'`, 14 §3.13.5 규칙 2) | scheduled | 다음 `review_window`, 없으면 `user_return` |
| D-8 | VoI 점수 ≥ 즉시 VoI 문턱(즉시 승격 다이얼: high 9 / normal 9 / low 6) 그리고 시간당 즉시 전달 수 < 상한(14 `interruptsPerHour`, 규칙 3) | immediate | now |
| D-9 | 사람 부재(`presence.state == 'away'` 또는 방해 금지) | scheduled | `user_return` |
| D-10 | 루프별 다이얼(`question.per_loop`) | 루프 기본(아래 표) | 방식 기본 |
| D-11 | 그 밖 | 사용자 기본 방식(`question.default_delivery`, 기본 협상) | now |

루프별 기본값(v0.3 06 §5, Parasuraman 등의 기능별 자동화 수준, 15 요구 "I 계열은 라운드 경계 예약"):

| 루프 | 기본 | 비고 |
|---|---|---|
| O | scheduled(`user_return`) | 복귀 요약에서 |
| I.* | scheduled(`round_end`). 막히는 질문은 negotiated | 탐구는 가정하고 진행 가능 |
| C.* | negotiated. 범위 이탈은 D-1(권리)로 즉시 | |
| A.* | immediate. 결과 확인은 D-1 | |
| S.* | scheduled(`loop_transition`) | |

D-11 뒤에 묶음 규칙을 적용한다: 결과 방식이 negotiated이고, 같은 Concern에서 최근 창(설정 "비슷한 시점 창", 기본 10분) 안에 전달된 정보 게이트 질문이 이미 둘 이상이면 scheduled(다음 경계)로 바꾼다(v0.3 06 §3.3 "여러 질문이 비슷한 시점에 생김 → 다음 작업 경계에 예약").

시간당 알림 상한(05 요구 (7))은 D-8의 조건과 묶음 규칙으로 받는다. 권리 게이트(D-1)와 만료 임박 승격(D-3)은 상한에 걸리지 않는다(14 §3.13.5 규칙 3). 시간당 즉시 전달 수는 상태에서 센다(`question.delivered` 중 강도 interrupt, 권리 게이트 제외).

중재 방식(사용자 기본이나 루프 기본이 `mediated`)이면 질문을 `pending`(`plannedDelivery = null`)으로 두고 지시 `agent.request(mediator)`를 낸다. 중재자 계획을 받으면 적용하고, 대기 시간(설정, 기본 2분) 안에 계획이 없으면 negotiated로 놓는다(§3.7).

```text
planDelivery(q, state, presence, dials, now):
  for rule in [D-1 .. D-11]:
     if rule.matches(q, state, presence, dials, now): plan = rule.plan(q); break
  if plan.mode == 'negotiated' and similarRecent(q, state, now) >= 2:
     plan = scheduled(nextBoundary(q, state))
  if plan.mode == 'mediated':
     return { events: [], directives: [agent.request(mediator), timer(mediator_timeout)] }
  if plan.trigger.kind == 'now':
     return { events: [], directives: [notify([q], urgencyOf(q, ...))] }       # 기록은 런타임의 question.mark_delivered
  return { events: [question.delivery_planned(plan)], directives: timerIfAt(plan.trigger) }
```

`delivery.mode`는 `question.recorded` 때 정해진 값이다. 이후 변경(중재 계획, 미루기, 승격)은 `question.delivery_planned`·`question.escalated`로만 기록한다(08 요구 (1)).

#### 3.5.3 발화와 전달 기록

예약된 질문은 다음 사건이 커밋될 때 발화한다. 커널은 사건을 커밋하는 결정에서 발화한 질문의 전달 지시(`notify`)를 낸다(10 R-7). 지시는 이벤트가 아니므로, 데몬이 지시를 처리하기 전에 꺼지면 09의 내부 소비자 커서 이후 이벤트에서 `directivesFor`로 다시 만든다(10 §3.1.4).

| 발화 조건 | 발화 사건 |
|---|---|
| `boundary` `round_end`, `workunit_end`, `loop_transition`, `concern_waiting`, `user_return`, `review_window`, `daily_rollover` | `boundary.reached`(그 종류, 같은 Concern 또는 전역). 14의 스케줄러가 `runtime.boundary`로 제출한다 |
| `at` | `timer.fire(question_delivery)` (09 `p_timers`의 `question_delivery`) |
| `with_result_review` | 그 WorkUnit의 `result.submitted` (결과 확인 질문과 같은 `batchKey`로) |

전달 기록:

1. 런타임(데몬의 전달기)이 `notify` 지시를 받아 연결된 클라이언트에 보낸다. 연결된 클라이언트가 없으면 복귀 요약에 넣는다(channel `brief`).
2. 보낸 뒤 `question.mark_delivered`(런타임 채널)를 제출하고 커널이 `question.delivered`를 기록한다(09: 전달 기록 행위자는 runtime). 앱은 이 이벤트를 받았을 때만 OS 알림을 띄운다(19 §3.8.3, 20 APP-D11).
3. 같은 질문에 알림을 반복하지 않는다. 다른 기기 재전송·재접속 재생은 이벤트를 만들지 않는다(08 §3.22.7).

같은 사건으로 발화하는 질문들은 하나의 `batchKey`로 묶여 한 번의 알림(강도 digest)이 된다. 묶음 안의 순서는 §3.5.4의 우선순위다. 묶음 크기 상한은 설정(기본 3)이며 넘는 것은 같은 묶음의 접힌 부분으로 보인다.

#### 3.5.4 우선순위 (정렬 키)

클라이언트가 같은 순서로 보이도록 커널이 순수 함수 `questionPriority(q, state, now)`를 제공한다. 원전 F06 §10의 Gate 우선순위 요소(지연 비용, 기대 가치, 남은 저비용 시간, 의존 정도, 맥락 재구성 비용)와 14 §3.13.5 규칙 6("권리 게이트 → C/A 접점 → 막힌 정보 게이트 → 나머지")을 쓴다.

```text
key = (
  gate == rights and kind ∉ {agreement_confirm, result_review} ? 0 : 1,
  kind ∈ {agreement_confirm, result_review} ? 0 : 1,      # C/A 접점 (14 규칙 6)
  blocking ? 0 : 1,
  timeToExpiry(q, now) (작을수록 앞, 없으면 +∞),
  -dependentCount(q),          # 이 질문의 답을 기다리는 WorkUnit·질문 수
  -vocScore(q),
  concernPriority(q.concernId), # 14 §3.13.3
  createdSeq
)
priorityReason(q) = 첫 번째로 결정된 키 성분의 문장 키   # 04 요구 (4). 예: question.priority.rights, question.priority.expiry_near
```

화면 표시 수(설정, 기본 3, 14 `maxVisibleDecisions`와 같은 값)를 넘는 정보 게이트 질문은 접혀 보인다. 권리 게이트와 막는 질문은 접지 않는다(canon-3 C3).

#### 3.5.5 중복과 병합

같은 질문을 여러 번 묻지 않는다(원전 F06 §12 금지 8).

- `dedupeKey = concernId + ':' + (decisionPointKey ?? questionKind + ':' + subjectRef)`.
- 열린(pending·delivered) 질문 중 같은 키가 있으면 새 질문을 만들지 않고 기존 질문 ID와 `notice.question_merged`를 돌려준다. 새 제출의 근거는 제출자가 기존 질문에 링크(`claim.link_evidence` 등)로 더한다.
- 새 제출이 더 강한 질문(막힘인데 기존은 비막힘, 또는 권리인데 기존은 정보)이면 기존 질문을 `question.withdrawn(reason 'superseded_by:<새 ID>')`으로 닫고 새 질문을 기록한다. 기존 질문의 전제는 새 질문으로 옮기지 않고 `assumption.retired`. 08에 질문 갱신 이벤트가 없어서 택한 방법이다.
- 다른 run이 같은 결정점을 물어도 같다(다중 에이전트 중복 방지).

#### 3.5.6 전달 payload (19·20 요구)

전달 지시와 `question.delivered` payload에 다음을 넣는다. 09 `question.delivered`의 `channel`·`deviceIds`에 더해 달라고 요구한다(§5.2).

```ts
export interface QuestionDeliveredExtra {      // 09에 요구
  readonly deliveryId: string;                 // 지시 단위 ID. 앱 중복 알림 방지 (20)
  readonly batchKey: string | null;
  readonly urgency: Urgency;
  readonly surface: readonly ('os' | 'badge' | 'banner')[];   // interrupt: os+banner, notice: os, digest: badge (20 §3.10.1 규칙 5)
  readonly category: 'question' | 'rights_gate' | 'review' | 'goal' | 'recovery' | 'observer' | 'system';
  readonly copy: { readonly titleKey: string; readonly bodyKey: string; readonly args: Readonly<Record<string, string>> }; // 05 문구 키. 질문 본문·비밀을 넣지 않는다
  readonly target: string;                     // 딥 링크 helm://question/<qs_id> (03 §3.5.4)
  readonly targetDevices: 'all' | readonly DeviceId[];
}
```

- 대상 기기: 기본은 모든 기기. presence가 active인 기기가 있으면 그 기기만 OS 알림, 나머지는 배지(19 §3.8.3 "활동 중인 기기 우선").
- 문구는 데몬이 05의 키로 만든다. 질문 본문은 넣지 않는다(20 요구, 18 비밀 규칙).
- 재전송으로 받은 전달 이벤트는 앱이 묶어서 보인다(19 §3.8.3, 20).

### 3.6 임시 가정과 가정 만료점 [결정: 개념(v0.3 06 §3.4·§3.6) / 제안: 형식과 판정]

#### 3.6.1 임시 가정 = 질문에서 나온 전제

임시 가정은 08 전제(`Assumption`, `as_`)의 `origin.kind = 'question'`이다(08 §3.8). 1판의 별도 레코드(`wa`)는 두지 않는다. 비막힘 정보 질문을 기록하는 트랜잭션에서 커널이 함께 만든다(08 R-23).

| 08 필드 | 값 |
|---|---|
| `statement` | 질문의 `assumption.text` ("이 기준을 임시로 적용해 다음 자극과 초안을 만든다") |
| `origin` | `{ kind: 'question', questionId }` |
| `whyNeeded` | 결정점의 `default.reason` |
| `failureImpact` | 질문의 `delayImpact` |
| `howToTest` | 질문 답 (사람 답이 시험이다) |
| `reviewTrigger` | 질문의 `assumptionExpires` |

전제 상태와 질문의 관계:

| 질문 사건 | 전제 |
|---|---|
| `question.recorded` (비막힘 정보) | `assumption.recorded` → active |
| 답 = 가정 (`accept_assumption` 또는 같은 값) | `assumption.confirmed` (refs: 답) |
| `question.assumed` | `assumption.confirmed` (refs: 가정 확정 선택) |
| 답 ≠ 가정 | `assumption.invalidated` → 08 R-2 낡음 전파, 재작업(§3.10.3) |
| 답이 선택을 만들지 않음 (`modify_criteria` 등) | active 유지 |
| `question.withdrawn`·`expired` | `assumption.retired` |

도구 호출이 어느 임시 가정 아래에서 일어났는지는 커널이 `toolcall.started`에 그 WorkUnit의 활성 질문 전제 목록으로 넣는다(10 §3.11.7). 모델이 선언하지 않는다.

#### 3.6.2 만료점의 표현

가정 만료점은 08 `Trigger`다(08 요구 (2)). 질문 만료점에 필요한 두 가지를 08에 더해 달라고 요구한다.

```ts
// 08 Trigger에 더할 변형과 필드 (§5.2)
| { kind: 'boundary'; boundary: WorkBoundaryKind; count: number; concernId: ConcernId | null; label: ShortText }  // 경계 n번째
| { kind: 'before_primitive'; primitive: Primitive; resources?: ResourcePattern[]; label: ShortText }           // resources 추가
```

| 만료점 | Trigger |
|---|---|
| 시각 | `{ kind: 'at', at }` |
| 이 자원에 처음 쓰기 전 | `{ kind: 'before_primitive', primitive: 'write', resources }` |
| 첫 발송 전 | `{ kind: 'before_primitive', primitive: 'send' }` |
| 이 루프 진입 전 | `{ kind: 'before_loop', loop }` (15 예: "다음 C.commit 합의 전") |
| 결과 제출 전 | `{ kind: 'record_state', recordId: workUnitId, state: 'submitted' }` |
| 경계 n번째 | `{ kind: 'boundary', boundary, count }` (기본값: `workunit_end` 1번째, V-Q-06) |
| 기계 판정 불가 | `manual`은 만료점으로 받지 않는다(가정 확정 시점을 코드가 알 수 없음). `invalid.question_shape` |

"본문 2절 작성 시작 전"(v0.3 06 §3.4 예)은 `before_primitive(write, resources: ['file:…/draft.md#section-2'])`이나, 섹션 단위 자원이 없으면 `boundary(round_end, 1)`처럼 경계로 표현한다. 모델이 선언하고, 도달 판정은 코드가 한다.

#### 3.6.3 도달 판정과 승격

"만료 여유"(다이얼 `question.expiry_margin`)는 만료 전에 즉시 전달로 올리는 여유다. 경계 수는 14 §3.13.6 정의대로 그 Concern의 `round_end`, `workunit_end`, `loop_transition`을 센다.

| 만료점 종류 | "가까워짐" (만료 여유 안) | "도달" |
|---|---|---|
| at | `now ≥ at - margin`. margin = max(15분, 남은 시간의 20%) 또는 다이얼 값. 09 `p_timers`의 `assumption_expiry`가 여유만큼 앞선 시각에 `timer.fire(question_escalation)` | `timer.fire(question_expiry)` (`now ≥ at`) |
| boundary | 그 경계가 `count - marginBoundaries`번 발생 (기본 경계 1개 전) | `count`번째 경계 사건(`boundary.reached`) 커밋 |
| before_primitive, before_loop, record_state | 모델이 `boundariesUntilExpiry`를 선언했으면 질문 이후 경계 수가 `estimate - marginBoundaries`에 이를 때. 없으면 질문 이후 첫 경계 | 이 WorkUnit(없으면 Concern)에서 맞는 제출이 들어올 때. 커널은 그 제출을 받아들이기 전에 같은 결정 안에서 만료 처리를 먼저 한다 |

가까워짐: 질문이 아직 답을 받지 않았으면 `question.escalated(cause 'expiry_near')`를 기록하고 즉시·끼어들기로 전달 지시를 낸다(D-3). 이미 delivered(알림)면 강도만 올린다.

도달:

- 정보 게이트, 임시 가정 있음 → `question.assumed` + `choice.committed`(`choiceKind: 'assumption_confirmed'`, AutonomousDecision, `whyNotAsked = { kind: 'assumption_expired', questionId }`) + `assumption.confirmed`. 같은 트랜잭션이다(08 R-25). 질문은 닫히지만 그 선택이 "에이전트가 정한 것"에 남아 이의를 걸 수 있다(v0.3 06 §3.6).
- 종류가 `criterion_confirm`이면 가정 확정 선택은 "이 기준을 임시로 계속 적용한다"이며 선호 모델 기준을 확정하지 않는다(`preference.criterion_confirmed`는 사람만, 08 R-36, 15 요구).
- 정보 게이트, 막는 질문(가정 없음) → 만료점이 없다. 답을 기다린다.
- 권리 게이트 → 만료점이 없다(§3.3.1 규칙 4).

데몬이 꺼져 만료 여유 시각을 지나친 경우(10 E-5): 같은 결정에서 승격 없이 바로 만료 규칙을 적용한다. 승격 알림을 늦게 보내 사람을 방해하지 않는다. 복귀 요약에 "부재 중 가정 확정 n건"으로 보인다.

#### 3.6.4 답과 가정의 비교

`question.answer`를 받으면 커널은 다음을 같은 결정에서 처리한다.

```text
onAnswer(q, a):
  matchesAssumption = q.assumption 없음 ? null : equivalent(a, q.assumptionAnswer)
      # accept_assumption이면 true. option이 같고 value가 깊은 동등(문자열은 정규화)이면 true
  matchesRecommendation = q.recommendation 없음 ? null : (a.option == 'accept_recommendation' or a.value.key == q.recommendation.optionKey)
  emit question.answered { value: a, basisVersion, matchesAssumption, matchesRecommendation(09에 요구) }
  종류별 효과 (08 §3.22.7 표): choice → choice.committed(HumanDecision, viaQuestion), agreement_confirm → agreement.*,
      result_review → acceptance.recorded, scope_change → workunit.scope_resolved, send_approval·action_approval → §3.14,
      goal_revision → goal.revised / goal.revision_rejected, criterion_confirm → preference.criterion_confirmed
  if q.assumption:
     if matchesAssumption: assumption.confirmed
     elif a가 선택을 만드는 답: assumption.invalidated   # R-2 낡음 전파
          imp = impactOf(state, q.assumption.assumptionId)    # 10 §3.13.3
          imp.calls 중 쓰기 있음 → 재작업 필요 (§3.10.3)
          imp.sends 있음 → 반영 항목(other, "가정 아래 발송 재검토") + 질문(tool_outcome_unknown 아님, 정보 answer)
  if q.blocking: 지시 run.signal(resume, q.runId, payloadRef = 질문)   # 12 §3.13
  답이 선택을 만들지 않는 선택지(modify_criteria, reframe_question, experiment_first, narrow_scope):
       질문 answered, 전제 active 유지, 재개 지시에 답을 실음. 에이전트가 같은 decisionPointKey로 새 질문·탐구·범위 줄이기를 낸다
  delegate: 질문 answered, 재개 지시. 에이전트가 choice.decide (whyNotAsked delegated)
```

**늦은 답** (가정 확정 뒤 답이 옴, 08 E-12, 21 요구 E14):

1. 질문은 `assumed` → `answered`(08 §3.22.7 허용 전이).
2. 답이 가정과 같으면 끝. 지표에 "가정 확정 뒤 같은 답"으로 남는다.
3. 답이 다르면 같은 트랜잭션에서: 가정 확정 선택에 `objection.filed`(행위자 human, 답한 사람. `reason`: "가정 확정 뒤 다른 답", `concernId`) → 사람 답으로 새 `choice.committed`(supersedes 가정 확정 선택) → `record.superseded` → 그 이의 `objection.resolved(upheld)` → 전제 `assumption.invalidated` → 재작업 필요(§3.10.3). Concern이 닫혀 있으면 `concern.reopened`.
4. 이의 레코드를 남기는 이유는 "가정 확정 뒤 이의 비율"(v0.3 06 §7) 지표와 이의 이력에 이 사건이 보이게 하려는 것이다.

#### 3.6.5 임시 가정 아래 행동 규칙

| ID | 규칙 | 실패 코드 |
|---|---|---|
| V-AS-01 | 권리 게이트 질문에 임시 가정을 만들지 않는다 (= V-Q-04) | `invalid.assumption_on_rights_gate` |
| V-AS-02 | 같은 WorkUnit에 활성 질문 전제가 있으면, 발송(send)이나 권한 레이어가 되돌릴 수 없다고 판정한 행동은 그 질문이 답을 받을 때까지 거부한다 | `policy.irreversible_under_assumption` |
| V-AS-03 | 활성 질문 전제가 있는 WorkUnit에서 쓰기(write, 쓰기 성격 execute)를 하려면, 전제 생성 뒤에 등록되었고 대상 자원을 덮는 되돌릴 지점(`available`)이 있어야 한다. 대상 미상 실행은 작업 공간 전체를 덮는 지점이 필요하다 | `policy.rollback_point_required` (다음 행동: 런타임이 지점을 만들고 `rollback.register`) |

### 3.7 중재자 [결정: 별도 행위자(v0.3 06 §3.7) / 제안: 입출력과 제약]

중재자(`agent:mediator`)는 작업 에이전트와 다른 새 컨텍스트에서 실행되는 보조 에이전트다. 작업 에이전트가 스스로 "지금 물어도 되나"를 정하면 작업을 계속하는 쪽으로 기울 수 있기 때문이다(v0.3 06 §3.7, Ask or Assume? 연구 [초록 확인]). 실행은 12(§3.14.3)가 맡고, 이 절은 입력·출력과 커널이 거는 제약을 정한다.

```ts
export interface MediatorInput {                // 12가 상태와 ctx.presence에서 만들어 중재자에게 준다
  readonly now: Ms;
  readonly questions: readonly {
    readonly id: QuestionId; readonly concernId: ConcernId; readonly loop: LoopId | null;
    readonly blocking: boolean; readonly expires: Trigger | null; readonly expiryNearAt: Ms | null;
    readonly priorityKey: readonly number[]; readonly createdSeq: Seq; readonly text: string;
  }[];
  readonly presence: PresenceSnapshot;          // §3.8.1 (접속 상태, 방해 금지, 주의 예산 상태)
  readonly recentAnswers: readonly { readonly questionId: QuestionId; readonly deliveredAt: Ms; readonly answeredAt: Ms }[];
  readonly deliveredUnanswered: number;
  readonly reviewWindows: readonly { readonly from: string; readonly to: string }[]; // 설정 "선호 검토 시간대" (원전 attention_policy)
  readonly bundleMax: number;
}

export interface DeliveryPlanPayload {          // 명령 delivery.plan
  readonly planId: string;
  readonly bundles: readonly {
    readonly batchKey: string;
    readonly questionIds: readonly QuestionId[];
    readonly trigger: DeliveryTrigger;          // 'now' 허용 (협상과 같은 강도)
    readonly reason: string;
  }[];
  readonly declared: {
    readonly userLoad: 'low' | 'medium' | 'high' | 'unknown';
    readonly interruptibility: 'now' | 'soon' | 'later' | 'unknown';
  };
}
```

커널 제약(`delivery.plan` 검사):

| ID | 제약 | 실패 |
|---|---|---|
| V-MED-01 | 계획에 든 질문은 정보 게이트이고 상태가 `pending`이다 | `conflict.invalid_transition` (이미 delivered인 질문만 빼고 부분 수락, Q-E6) |
| V-MED-02 | 끼어들기를 정하지 않는다. 끼어들기는 규칙(D-1~D-3, D-8)만 정한다. 계획은 시점만 정하고 강도는 `urgencyOf`가 계산한다 | (형식상 강도 필드 없음) |
| V-MED-03 | 시각 발화는 그 질문의 만료 여유 시점보다 이르다. 경계 발화는 만료 경계보다 앞선다 | `policy.delivery_after_expiry` |
| V-MED-04 | 묶음 크기 ≤ 설정 `bundleMax`(기본 3), 질문은 한 묶음에만 | `invalid.schema` |
| V-MED-05 | 질문을 철회하거나 내용을 바꾸지 않는다(계획만) | 능력표 (`denied.capability`) |

받아들이면 질문별 `question.delivery_planned`(`decidedBy: agent:mediator`, `batchKey`)를 기록한다. 계획에 없는 pending 질문은 대기 시간이 지나면 `question.delivery_planned`(negotiated, decidedBy kernel)로 놓인다. 중재자가 실패하거나 응답하지 않아도 같다. 중재자의 결정은 질문의 전달 이력에 남고 화면에 보인다. 사람은 미루기(`question.defer`)나 지금 보기(`question.escalate`)로 바꾼다(§2.3 마지막 행).

중재자가 사람의 작업 부하를 아는 방법(발췌 4 d6, 14 요구 (6)): 데몬이 모은 접속 상태(19 `presence.report`의 active·idle·hidden·locked와 연결 여부를 14 §3.13.8의 active·idle·away로 줄인 값), 보고 있는 화면, 방해 금지, 14의 주의 예산 상태, 최근 전달-답 지연, 전달됐으나 답하지 않은 질문 수, 사용자가 정한 검토 시간대. 키 입력 내용이나 화면 내용은 받지 않는다 [제안].

### 3.8 사람이 없을 때 [결정: 작업 계속(브리프 22) / 제안: 규칙]

#### 3.8.1 presence

```ts
/** 10 KernelContext.presence. 데몬이 연결 상태와 19 presence.report에서 만든다. 이벤트가 아니다 */
export interface PresenceSnapshot {
  readonly state: 'active' | 'idle' | 'away';      // 14 §3.13.8: active 5분 이내 상호작용, idle 5분 넘게 없음, away 연결 없음 또는 30분 넘게 없음
  readonly dnd: boolean;                           // 05 §3.7.4 방해 금지 (데몬 설정, 기기 공통)
  readonly attention: 'normal' | 'over_budget' | 'quiet_hours';   // 14 §3.13.5 주의 예산 상태
  readonly activeDevices: readonly DeviceId[];
  readonly focus: { readonly screen?: string; readonly objectId?: string } | null;  // 19 presence.report
}
```

- presence는 이벤트로 기록하지 않는다(10 §3.1, 19 §3.7.8). 전달 결정이 presence에 따라 달라지지만 그 결정이 `question.delivery_planned`·`question.delivered`로 남으므로 재생에 presence가 필요 없다. 1판의 `presence.changed`(A-5)는 철회한다.
- `away → active` 전환은 14 작업 경계 `user_return`이다. 스케줄러가 `runtime.boundary(user_return)`를 제출하고 `boundary.reached`가 `user_return` 발화 질문을 한 묶음으로 내보낸다.
- 방해 금지는 전달 판정에서 away로 본다(05 요구 (6)).

#### 3.8.2 규칙

| 상황 | 처리 |
|---|---|
| 정보 게이트, 가정 가능 | 질문 기록, 임시 가정으로 진행. 전달은 D-9 scheduled(`user_return`). 만료점 도달 시 가정 확정(§3.6.3) |
| 정보 게이트, 막음 | 그 WorkUnit(또는 의존 부분)만 멈춤. 다른 WorkUnit·Concern은 계속. 가능하면 범위를 줄여 진행(§3.11) |
| 권리 게이트 | 즉시 놓이지만(D-1) 보는 사람이 없다. 강도는 digest(OS 알림 없음). 그 행동만 막고 나머지 계속. 가정 확정 없음, 시간 만료 없음 |
| 결과 확인 질문 | 놓이고 기다린다. 다음 WorkUnit은 이전 결과 확인과 의존이 없으면 계속(Grant 범위 안) |
| 모든 WorkUnit이 막힘 | Concern 표시 상태 "대기"(14 경계 `concern_waiting`). 런타임은 반복 시도하지 않고 멈춘다. 스케줄러 타이머만 돈다 |
| 알림 | 연결된 클라이언트가 없으면 전달기는 channel `brief`로 기록하고 복귀 요약에 넣는다. 휴대폰 푸시 같은 외부 알림 경로는 이 설계 범위 밖이다(19 §2.4: 별도 푸시 채널 없음) [가정: 1단계에는 없음] |
| 돌아왔을 때 | `boundary.reached(user_return)`가 `user_return` 발화 질문을 한 묶음으로 놓고, 복귀 요약(12 투영)이 다음 순서로 보인다: 선택 필요(권리·막는 질문, C/A 접점 먼저) / 미룬 반영 항목 / 확인하면 좋은 것(임시 가정 질문) / 에이전트가 정한 것(접힘, 마지막 확인 seq 이후) |
| 확인 상호작용 (check-back) | 사람이 복귀 요약을 읽고 "이해했다"를 표시하면 `brief.acknowledge`로 `brief.acknowledged(upToSeq)`가 기록된다. 읽은 것과 이해했다는 주장을 같게 보지 않는다(원전 CLI 경험 §11, canon-3 G1) |

v0.3 06 §6 예시를 이 규칙으로 재현한다(§6 완료 기준 시나리오 Q-14·Q-15).

### 3.9 혼자 정한 결정의 기록과 확인 [결정: 기록·이의(브리프 8) / 제안: 형식]

#### 3.9.1 무엇이 혼자 정한 결정인가

08 `Autonomy`가 `AutonomousDecision`인 결정 레코드 전부다(08 §3.4.5, 10 V-INV-07). 레코드 종류는 Choice(`ch`), LoopPlan(`lp`), LoopTransition(`lt`), SituationAssessment(`sa`), StructureChange(`sc`), ModeAssignment(`md`) 여섯이다. v0.3 06 §4.2와 14 §3.9.6의 목록 대응:

| 종류 | 레코드·이벤트 | `whyNotAsked` |
|---|---|---|
| 정보 게이트를 통과하지 못해 묻지 않고 정한 것 | `choice.committed` | `info_gate` (거짓 조건, 조건 1이면 `policyRef`) |
| 자동 검증으로 정한 것 | `choice.committed`(`auto_verified`) | `auto_verifiable` |
| 질문의 가정 확정 | `choice.committed`(`assumption_confirmed`) | `assumption_expired` |
| 사람이 맡김 | `choice.committed` | **08에 요구** `delegated` (questionId) |
| Grant 범위 안 결정, 비상 | 각 결정 레코드 | `within_grant`, `emergency` |
| 루프 계획, 루프 전환 | `loop_plan.adopted`, `loop.transitioned` | 규칙으로 정했으면 **08에 요구** `rule_default` (규칙 ID, 14 §3.20.1), 모델이 정했으면 `info_gate` |
| 상황 판정 | `situation.assessed` | `rule_default` 또는 `info_gate` |
| 구조 동작(분해·병합·독립·재배치·재조합·보류·닫기) | `structure.changed` | 같음 |
| 모드 라우팅 | `mode.assigned` | 같음 |

다음은 레코드 종류가 Autonomy를 갖지 않지만 같은 피드에 보인다. 08에 Autonomy를 더하지 않고 투영이 모은다 [제안].

| 종류 | 이벤트 | 피드에서 이의를 거는 대상 |
|---|---|---|
| Grant 범위 안 합의 활성화 | `agreement.activated_by_grant` | 합의(`ag`, ContestableId) |
| 범위를 줄여 진행 | `agreement.narrowed` | 합의 |
| 탐침 키우기·접기 | `probe.concluded` | 탐침의 근거가 된 판단·관찰 |
| 반영 항목 미루기·이관(에이전트 제안) | `obligation.deferred`, `obligation.transferred` | 반영 항목은 이의 대상이 아니다. 사람은 `obligation.reopen`으로 되돌린다 |

`whyNotAsked`의 두 변형을 08에 요구한다: `{ kind: 'delegated', questionId }`(05 "맡기기"), `{ kind: 'rule_default', ruleId }`(14 규칙 기반 결정. 1판의 `structural_default`).

#### 3.9.2 보여주기

- 투영 `autonomousDecisions(state, filter)`(10 §3.1.5, 09 `v_autonomous_feed`): 종류별 개수와 목록. 기본 접힘(v0.3 06 §4.3). 화면 이름 "에이전트가 정한 것"(브리프 용어집).
- 항목마다: 무엇을 정했나, 다른 선택지, 이유, 묻지 않은 이유(`whyNotAsked`와 `askEvaluation`을 사람이 읽을 문장 키로), 다시 볼 조건, 이 결정에 기댄 것(영향 미리보기 = `impactOf` 요약), 상태(확인 안 함·확인함·이의).
- 복귀 요약에는 마지막 `brief.acknowledged` 이후의 것만.

#### 3.9.3 확인

`decision.confirm`은 사람이 "봤고 이대로 둔다"를 남기는 명령이다(04 `autonomous.markSeen`). 여러 개를 한 번에 확인할 수 있다(한 번의 조작). 확인은 선택 사항이며, 확인하지 않은 결정도 확인한 결정도 언제든 이의를 걸 수 있다(불변조건 7 "언제든"). 확인은 레코드 상태를 바꾸지 않고 `decision.confirmed`(09에 요구)로 남는다. 종류별 확인 비율은 측정 재료다. 확인은 사람 조작 상한에 넣지 않는다(§7 A-7).

#### 3.9.4 기록이 정책을 조정한다 (사람 확인)

v0.3 06 §4.4의 조정 표를 그대로 쓴다. 커널은 순수 조회 `autonomyStats(state, window)`로 종류별 수치를 제공하고, 관찰 에이전트(16)가 정책 수정을 제안(`policy.change.propose`)하며, 사람이 확인한다. 자동 조정은 하지 않는다(canon-3 MBE-H3, Subsidiarity 규칙 6).

| 관찰 | 조정 제안 |
|---|---|
| 특정 종류의 혼자 정한 결정에 이의가 자주 걸림 | 그 종류에 `always_ask` 정책, 또는 종류별 예외 다이얼 |
| 답이 임시 가정과 같았던 비율이 높음 | 그 종류에 `autonomy` 정책, 또는 조건 3 문턱 올림 |
| 답이 추천과 같았던 비율이 높음 (16 `matchesRecommendation`) | 그 종류의 c1 덮임 문턱 조정 |
| 가정 확정 뒤 이의 비율이 높음 | 만료 여유 늘림, 즉시 승격 문턱 낮춤 |

이의를 걸 때 "다음부터 묻기"(`desired: 'ask_next_time'`)를 고르면 그 결정 종류에 대한 `always_ask` 정책 제안이 바로 만들어진다(관찰 에이전트를 거치지 않는 사람 제안, `policy.change.propose` 행위자 human). 적용은 같은 화면의 확인 한 번이다(05 요구 (5)).

### 3.10 이의 → 되돌림·재작업 [결정: 이의 가능(브리프 8) / 제안: 흐름]

#### 3.10.1 이의 걸기

이의는 08 Objection(`ct`)이다. 명령은 `decision.contest`(10 §3.11.5).

```ts
interface DecisionContestPayload {
  objectionId: ObjectionId;
  target: ContestableId;                    // 08: ch lp lt sa sc md fd in ps as ob pm dc pr gl ag (+ rs, 08에 요구)
  targetItemKey?: string;                   // 'evidence:<ob>', 'criterion:<cr>' 등 (19 요구)
  reason?: string;                          // 이유 없는 이의도 받는다 (21)
  desired?: 'reconsider' | 'revert' | 'ask_next_time';   // 08 ObjectionCore에 더해 달라고 요구
  expect: VersionRef[];                     // 대상 레코드 version (10 §3.3.4)
}
```

검사: 대상이 ContestableId이고 `superseded`가 아니다, 행위자는 사람(채널 human_client, 08 R-16). 받아들이면 `objection.filed`와 다음 파생(10 R-8)이 같은 트랜잭션에 커밋된다.

```text
onObjection(o):
  target contested (08: quality.contestedBy += o.id), Concern 다시 열림 (08 §3.22.12)
  imp = impactOf(state, o.target)                    # 10 §3.13.3
  imp.records 각각: 주의 항목 (사람 확정 레코드는 표시만, 자동으로 뒤집지 않음)
  reopenLoop(대상 종류)로 loop.transitioned(kernel, rule_default)
  target에 decisionPointKey가 있으면 objectedDecisionPoints에 더함 → 이후 같은 키의 자율 결정 금지 (V-AUT-02)
  if o.desired == 'ask_next_time': policy.change.propose(always_ask, 행위자 human) 초안 → 확인 질문(§3.9.4)
  imp.calls 중 쓰기 있음 → 재작업 필요 (§3.10.3, 이벤트 없음, 주의 항목)
  imp.sends 있음 → 반영 항목(other, "발송된 것 보상 검토")
  지시 run.signal(pause): 영향받은 WorkUnit의 run (12)
  재결정 질문: 같은 결정점 (questionKind choice, 정보 게이트, 막힘, subjectRef = target, decisionPointKey 재사용)
```

재개 루프(`reopenLoop`) [제안]:

| 대상 종류 | 재개 루프 |
|---|---|
| Choice (`impl.*`, `scope.*`, `value.*`) | 대상 Concern의 C.commit (재작업 필요 시) 또는 I.fact (근거가 문제일 때, 이유에 따라 에이전트가 고름) |
| 가정 확정 선택 | 질문을 같은 `decisionPointKey`로 다시 낸다 |
| 루프 계획 | O |
| 루프 전환 | 출발 루프 |
| 상황 판정 | O (재판정) |
| 구조 동작 | S (반대 동작 제안: 분해 ↔ 병합) |
| 모드 라우팅 | O |
| Grant로 활성화한 합의 | 합의 쓰기 정지(`workunit.paused`) + `agreement_confirm` 질문 |
| 범위를 줄인 합의 | C.commit |
| 판단·가능성·해석·관찰 | I.fact |
| 선호 모델 기준 | I.want |

에이전트는 이의를 혼자 기각하지 않는다. `objection.resolved`의 `dismissed`·`withdrawn`은 사람만, `upheld`는 대상이 대체·철회될 때 커널이 기록한다(08 §3.22.12, 05 요구 (4)).

#### 3.10.2 재결정

이의가 걸린 결정점은 자율로 다시 정할 수 없다(V-AUT-02, `policy.redecide_after_objection`). 재결정은 위에서 만든 질문의 답으로만 일어난다. 사람이 답하면:

- 원래 결정과 같은 답: 이의 `objection.resolved(dismissed)`(사람이 대상을 유지하기로 함). 재작업 필요가 사라진다.
- 다른 답: 새 선택(`choice.committed`, HumanDecision, supersedes 원래 선택) → 원래 선택 `record.superseded` → 이의 `objection.resolved(upheld)`. 재작업이 필요하면 진행한다.

사람은 질문에 답하지 않고 `objection.dismiss`로 바로 "그대로 둔다"를 고를 수도 있다. 이때 재결정 질문은 `question.withdrawn`.

Choice가 아닌 결정 레코드(lp, lt, sa, sc, md)는 질문의 답으로 사람이 정한 새 레코드(HumanDecision)가 원래 레코드를 대체한다. 에이전트가 같은 결정점의 새 레코드를 자율로 내면 거부한다. 다른 결정점(다른 Concern, 다른 루프 단계)은 막지 않는다.

#### 3.10.3 재작업

재작업은 새 레코드 종류 없이 WorkUnit으로 표현한다 [제안]. 1판의 `rework.*` 이벤트는 두지 않는다.

**재작업 필요 판정** (상태에서 계산, 이벤트 없음):

```text
reworkNeeded(state) = { (source, wu, imp) :
   source ∈ 열린 이의(쓰기 영향 있음) ∪ invalidated 질문 전제(쓰기 영향 있음),
   imp = impactOf(state, source.target), wu ∈ imp.calls의 WorkUnit,
   wu를 reworkOf로 가리키는 WorkUnit이 없음 }
```

판정 결과는 Concern의 주의 항목(09 `p_attention`)으로 보이고, 가드 G-K2(10 §3.12)가 해당 WorkUnit의 새 쓰기를 막는다.

**재작업 WorkUnit**:

| 단계 | 처리 |
|---|---|
| 제안 | 에이전트가 `workunit.propose`에 `reworkOf: { source: ObjectionId | AssumptionId, workUnitId, steps }`(08 WorkUnit에 요구)를 넣는다. `steps`는 `rollback(rollbackPointId)` / `redo(description)` / `compensate(description)`의 목록 |
| 범위 | 쓰기 대상이 기존 합의 범위 안이면 그 합의 아래에서 사람 조작 없이 시작한다(Grant 포함 검사와 같은 원리, 10 §3.6.7). 범위 밖이면 `gate.scope_expansion_required` |
| 되돌리기 | `purpose: 'rollback'`인 도구 호출(13 §3.7.8)로, 일반 쓰기와 같은 검사를 받는다. 완료되면 지점 `rollback_point.used` |
| 보상 | 되돌릴 수 없는 것(발송 등)은 `compensate` 단계로, 새 발송이면 권리 게이트를 다시 거친다 |
| 끝 | 보통의 `result.submit` → 결과 확인. 결과 확인 질문은 정상 경로 밖 조작(01 R-OP-4 사유 `rework`)으로 센다 |
| 되돌릴 지점 없음 | 계획에 `rollback`이 없을 수 있다(redo만). 결과 확인 때 반영 항목 "가정 아래 변경 재검토"(other)가 생긴다 |

이미 결과 확인을 받은 합의의 일이 재작업 대상이면 결과 확인을 다시 받는다(재작업이 결과를 바꾸므로). 이의가 사람에게서 시작된 것이므로 상한 예외로 센다(§3.15).

### 3.11 범위를 줄여 진행 (scope-reduced progress) [제안]

Horvitz의 mixed-initiative 원칙 "불확실할수록 서비스 범위를 좁힌다"(v0.3 06 §2.2 [출처 위치 확인], 감사 §3.10)를 "묻는다 / 혼자 정한다" 사이의 중간 선택지로 둔다.

| 언제 | 어떻게 |
|---|---|
| 판정 갈래 ask(with_scope_reduction): 질문에 의존하지 않는 부분이 있음 | 에이전트가 `agreement.narrow`로 질문에 의존하는 대상을 뺀 범위로 줄이고 나머지를 진행 |
| 권리 게이트로 한 행동이 막힘 | 그 행동을 뺀 나머지 진행(자동. 합의를 줄이지 않아도 그 행동만 막혀 있음) |
| 사람 부재 + 막는 질문 | 독립 부분이 있으면 위와 같음 |
| 결과가 불확실해 "초안까지만" 하는 경우 | 줄인 범위 프리셋 `draft_only`(13 §3.7.9): 쓰기는 초안 영역만, 발송 없음, 네트워크 없는 실행 |
| 권리 게이트 질문에 "범위 줄여 허락"(05) | 에이전트가 미리 낸 줄인 인자 초안을 사람이 `approve_edited`로 허락 (§3.14) |

규칙:

1. 줄인 범위 ⊆ 현재 유효 범위(커널 검사, 10 `agreement.narrow`). 줄이기는 사람 조작이 필요 없다(권한이 줄어드는 방향).
2. 줄이기는 "에이전트가 정한 것" 피드에 보인다(§3.9.1). 이의 대상은 합의 레코드다. 연결 질문은 `linkedQuestionId`.
3. 복원(`agreement.restore`)은 연결 질문이 허락·답(`approve`, `answer`, `confirm`, `accept_recommendation`, `accept_assumption`)으로 닫혔거나 철회됐을 때, 사람이 확정한 범위 이하로만 가능하다. 거절·범위 줄이기 답이면 줄인 상태가 유지되고, 더 넓히려면 사람의 재협상(`agreement.renegotiated`)이 필요하다.
4. 줄인 상태에서 만든 결과는 결과 제출의 `limitations`에 "범위를 줄여 진행: …"이 자동으로 들어간다(커널이 결과 제출 시 추가).
5. 줄인 범위는 합의 레코드의 `narrowedScope`로 둔다. 이벤트 `agreement.narrowed`·`agreement.restored`를 09에, 필드를 08에 요구한다. `agreement.renegotiated`를 쓰지 않는 이유: 08에서 그 전이는 사람 행위자, 새 개정판, 제출 결과 stale을 동반하는데, 줄이기는 에이전트가 하고 개정판을 바꾸지 않는다.

### 3.12 되돌릴 지점 (rollback_point) [제안]

가정하고 진행할 때 "되돌릴 지점 남김"(대화 4-11 표, 감사 §3.10). 지점은 데몬이 직접 만든다(모델 도구 아님, 13 §3.7.8). 커널은 등록만 받는다.

```ts
export interface RollbackPoint {               // 08에 레코드 `rb` 요구
  readonly id: RollbackPointId;                // `rb_<ULID>`
  readonly concernId: ConcernId;
  readonly workUnitId: WorkUnitId;
  readonly agreementId: AgreementId;
  readonly mechanism: 'git_commit' | 'file_snapshot';          // 13 §3.7.8
  readonly ref: string;                        // refs/helm/rollback/<rb_id>의 커밋 sha, 또는 스냅숏 blob 해시
  readonly coversTargets: readonly ResourcePattern[];
  readonly forAssumptions: readonly AssumptionId[];            // 등록 시 그 WorkUnit의 활성 질문 전제 (커널이 채움)
  readonly limitations: readonly string[];     // 예: ".gitignore 대상은 포함 안 됨"
  readonly status: 'available' | 'used' | 'expired';
  readonly registeredSeq: Seq;
}
interface RollbackRegisterPayload { rollbackPointId: RollbackPointId; workUnitId: WorkUnitId;
  mechanism: RollbackPoint['mechanism']; ref: string; coversTargets: ResourcePattern[]; limitations: string[] }
```

- 등록: `rollback.register`(런타임 채널) → `rollback_point.registered`(09에 요구). 저장 위치는 이벤트 로그가 아니다. git ref는 작업 저장소에, 스냅숏은 `/srv/volumes/helm/blobs`(브리프 §2.5, 09 §3.6.1)에 있다.
- 런타임은 활성 질문 전제가 있는 WorkUnit에서 첫 쓰기 의도를 만들기 전에 지점을 먼저 등록한다. 등록하지 않으면 커널이 V-AS-03으로 거부하고 다음 행동으로 알려 준다.
- 사용: 되돌리기 도구 호출(`purpose: 'rollback'`, `rollbackPointId`)이 완료되면 `rollback_point.used`.
- 만료: `forAssumptions`가 모두 confirmed가 되면 `rollback_point.expired`(커널 파생). 데몬은 만료된 ref를 정리해도 된다(17).
- 지점이 덮지 못하는 변경(외부 발송, 추적 안 되는 파일)은 `limitations`에 적고 화면에 보인다. 커널은 덮는 범위를 넘어 보장하지 않는다.
- 질문 레코드의 `rollbackPoint`(08)는 모델이 쓴 서술("본문 2절 시작 전 커밋")이고, `ref`에 실제 지점 ID를 넣는다. 질문 기록 때는 지점이 아직 없으므로 `ref`가 null일 수 있다. 실제 지점은 `forAssumptions`로 찾는다.

### 3.13 자동 검증 가능한 선택 [제안]

"자동으로 검증할 수 있는 선택은 에이전트가 정하고 검증 결과를 관찰로 남긴다"(대화 L3403, 감사 §3.10).

1. 모델이 결정점에 `autoVerifiable: true`와 `verificationPlan`을 선언한다.
2. 시스템 정책 `system.auto_verifiable`이 조건 1을 거짓으로 만든다(권리 범주가 없을 때만, 10 V-POL-01).
3. 에이전트는 후보마다 검증을 실행한다(`toolcall.intend` `purpose: 'verification'`, 격리 작업 트리는 13 §3.7.9). 검증 실행의 쓰기는 격리 영역 안이며 일반 범위 검사를 받는다.
4. `choice.decide`에 `verification: { observationIds, perOption }`을 넣는다(10 §3.11.5).
5. 커널 검사(V-AUT-03): 관찰이 실재하고 `purpose = 'verification'`인 도구 결과이며, 같은 Concern이고, 결정점 선언 뒤에 기록됐다. 고른 후보에 통과 관찰이 있다.
6. 받아들이면 `choice.committed`(`choiceKind: 'auto_verified'`, `whyNotAsked = { kind: 'auto_verifiable', verification }`). 검증 관찰은 선택의 `basis`가 된다(08 R-15 "basis 1개 이상"). 후보는 가능성 레코드로 먼저 남긴다(`possibility.propose`).
7. 검증이 결론을 내지 못하면(모두 통과·모두 실패) 조건 1을 참으로 다시 평가한다(정보 게이트로 돌아감).

### 3.14 권리 게이트 승인과 인자 지문 [제안]

Mastra 검토 §4의 "승인 때 도구 이름과 인자의 지문을 저장하고 `beforeToolCall`에서 대조, 한 번 쓰면 소진" [원문]을 08의 도구 호출 상태 기계(08 §3.22.14)와 질문 필드로 집행한다. 별도 토큰 레코드는 두지 않는다.

지문은 08이 정한 `fingerprint = sha256(toolName + "\n" + canonical(args))`이고, 정규화 함수는 `@helm/domain`에 하나만 둔다(13과 공유).

| 사건 | 처리 |
|---|---|
| 권리 범주 도구 호출 (`toolcall.intend`, 권한 레이어 `rightsGate`) | `toolcall.requested` + `toolcall.approval_requested` + `question.recorded`(`send_approval`/`action_approval`, `subjectRef = tc`, `approvalFingerprint = tc.fingerprint`). `needs_gate`. 실행 계획(인자 blob·지문)은 도구 호출 레코드에 남아 재시작 뒤에도 유지된다(12 요구) |
| `approve` | `question.answered` + `toolcall.approved`(→ requested). 지시 `run.signal(resume)`. 런타임이 같은 `toolCallId`와 `approvalQuestionId`로 `toolcall.intend`를 다시 내면 지문 대조 후 `toolcall.started`, 질문 `consumedByToolCallId = tc` |
| `approve`에 조건이 있음 | 조건은 답에 기록되어 화면·감사에 보인다. 조건 때문에 인자가 바뀌면 지문이 달라져 다시 묻는다 |
| `approve_edited` (고쳐서 허락, 범위 줄여 허락) | 커널이 고친 인자의 지문을 계산해 답의 `editedFingerprint`와 대조한다. `question.answered` + 원래 호출 `toolcall.denied(reason 'edited_by_human')`. 고친 인자 본문은 답 payload의 blob으로 런타임에 간다(13 요구). 런타임은 새 `toolCallId`로 `toolcall.intend`(`approvalQuestionId`)를 내고, 커널은 새 호출의 지문 = `editedFingerprint`이고 질문이 아직 소진되지 않았는지 보고 허락한다. 08에 "`consumedByToolCallId`가 `subjectRef`와 다른 호출일 수 있다"를 요구한다 |
| `deny` | `question.answered` + `toolcall.denied`. 지시 `run.signal(resume)`에 거절 이유 |
| 대조 실패 (지문 다름, 이미 소진, Concern 다름) | `gate.approval_mismatch`. 새 인자로 다시 묻는다 (10 E-12) |
| 승인 유효 기간 경과 (답 시각 + 설정 "승인 유효 기간", 기본 24시간) | 대조 실패와 같다. 다시 묻는다 |
| 합의 취소·Concern 닫힘·run 취소 | 도구 호출 `toolcall.dropped`, 질문이 열려 있으면 `question.expired` |

한 번 허락으로 같은 행동을 여러 번 하려면(예: 메일 열 통) 질문 단계에서 묶음 행동으로 묻고 지문을 묶음 지문(인자 목록의 정규화 해시)으로 둔다. 같은 지문을 여러 번 쓰는 승인은 만들지 않는다.

같은 Concern 안에서만 쓴다. 다른 Concern에서 같은 행동이 필요하면 따로 묻는다(Q-E10).

### 3.15 사람 조작 2회 상한과 C/A 우선 [결정: 출처 진술(브리프 §3.5) / 제안: 집행]

#### 3.15.1 무엇을 세나

대화 X3-2-19: "사람이 하는 일은 고르기 두 번이 상한입니다. 합의 확인 한 번, 결과 확인 한 번입니다." 사용자 진술 "C와 A를 가장 많이 건너뛴다"(X3-2-02)가 근거다. 셈법은 01 §3.5.2(R-OP-1~R-OP-6)를 따른다.

- 정상 경로(범위 확대, 권리 게이트, 수정 요청, 실패 없이 끝나는 변경 WorkUnit)의 결정 조작은 합의 확정 1회와 결과 확인 1회가 상한이다.
- 정상 경로 밖 조작(범위 확대, 권리 게이트, 수정 뒤 재확인, 다시 조사 뒤 새 합의, Goal 수정, 이의, 재작업)은 상한에 넣지 않고 사유와 함께 센다(01 R-OP-4).
- 한 번의 조작에 여러 답을 묶은 경우(결과 확인 + `bundled`) 한 번으로 센다.
- 사람이 스스로 시작한 조작(이의, 재협상, 다이얼 변경, 확인)은 별도로 센다. 원함 탐구의 반응은 상한 밖이다(R-OP-6).
- 커널 `apply`가 `humanOpsByWorkUnit`을 세고(10 §3.5), 16이 01의 `HumanDecisionOp`(`onNormalPath`, `extraReason`)로 집계한다.

#### 3.15.2 집행 위치

| 장치 | 위치 | 내용 |
|---|---|---|
| 권한 이어 쓰기 | 커널 10 §3.6.7 | 처음 지시에서 만든 Grant(조작 1) 안의 합의는 사람 확인 없이 활성화. 그러면 결과 확인(조작 2)까지 두 번 |
| 합의 확정 생략 | 커널 10 §3.6.7, 01 R-OP-2 | (a) 사람이 확정한 구조화 범위 안임을 커널이 증명할 때(Grant 포함 검사), (b) 직접 지시의 echo를 사람 채널 `agreement.propose`+`confirmNow`로 받을 때 |
| 결과 확인 묶음 | 이 문서 D-6 | C·A 루프의 정보 게이트 질문은 WorkUnit 예산이 남지 않았으면 결과 확인과 함께 묶는다(`with_result_review`). 사람은 결과 확인 한 번에 함께 답한다(`AnswerValue.review.bundled`) |
| 판단 확인 묶음 | 14 §3.13.7 | `finding_confirm`은 다음 C의 `agreement_confirm`과 같은 `batchKey`로 놓는다 |
| 반영 항목 방침 묶음 | 14 §3.13.7, 01 R-OP-3 | 반영 항목의 지금 처리·미루기는 결과 확인 한 번 안에서 함께 고른다 |
| 예산 계산 | 커널 순수 함수 | `remaining(WU) = 2 - normalOps(WU) - (결과 확인 전이면 1)`. 0이면 D-6 적용 |
| 권리 게이트 예외 | D-1 | 권리 게이트는 묶지 않는다(제때 묻지 않으면 행동이 막힌다). 정상 경로 밖으로 센다 |
| 합의 초안을 모델이 채움 | 10 `agreement.propose` | 합의 항목(목적, 기준, 범위, 금지, 근거, 멈출 조건)과 check-back을 모델이 채우고 사람은 확인·수정만(recognition over recall, 브리프 결정 18) |
| 오케스트레이터 묶기 권고 | 14 §3.13.7 `beforeCreateTouchpoint` | 셋째 정상 경로 접점이 생기려 하면 묶기 → 범위 줄이기 추천 → 그래도 필요하면 만들고 설계 결함 신호로 기록 |
| 지표 | 16 | WorkUnit별 사람 조작 수 분포, 2회 초과 WorkUnit 비율, 2주 우회율(X3-2-20) |

#### 3.15.3 C/A 우선

C와 A가 가장 많이 건너뛰어지므로 다음은 어떤 모드·다이얼에서도 끌 수 없다.

1. 의존 규칙 1(write·send에는 C)과 2("완료"에는 A)는 커널이 언제나 집행한다(10 §3.8). 정책·다이얼 데이터가 이 규칙을 끄지 못한다(10 V-POL-01).
2. 결과 제출이 오면 결과 확인 질문이 자동으로 생긴다(권리 `result_acceptance`, 10 §3.11.8). 결과 확인 질문은 가정 확정 대상이 아니다(01 요구).
3. 런타임은 턴을 끝내기 전에 `checkSettle`로 "쓰기는 했는데 결과 제출이 없음"을 확인하고 한 번 더 진행하게 한다(최대 2회, 10 §3.18.2). 문구 예: "결과 제출이 없습니다. 기준별 근거와 함께 제출하세요."(대화 X3-2-12)
4. 질문 우선순위에서 C/A 접점을 권리 게이트 다음, 다른 질문 앞에 둔다(§3.5.4, 14 규칙 6).
5. 구현 순서에서 C/A 명령(합의, 도구 의도, 결과 제출·확인, 반영)을 먼저 만든다(23에 요구, 대화 X3-8-28).

### 3.16 질문 다이얼과 설정 [결정: 다이얼의 존재(v0.3 06 §5) / 제안: 값과 기본]

다이얼 정본 목록은 14가 소유하고 저장 키는 08 `DIAL_KEYS`다. 이 표는 질문 다이얼의 의미와 값이다.

| 다이얼 (08 키) | 값 | 기본 | 의미 |
|---|---|---|---|
| `question.threshold.c1` | few / normal / many | normal | §3.3.4 정책 덮임 판정 |
| `question.threshold.c2` | few / normal / many | normal | 결과 차이 문턱 (major / material / minor) |
| `question.threshold.c3` | few / normal / many | normal | 물을 가치 점수 문턱 (6 / 4 / 2) |
| `question.default_delivery` | immediate / negotiated / mediated / scheduled | negotiated | D-11 (McFarlane 권고) |
| `question.immediate_threshold` | high / normal / low | normal | D-2의 `delayCost` 문턱(high만 / medium 이상 / low 이상), D-8의 VoI 문턱(9 / 9 / 6) |
| `question.expiry_margin` | 경계 수(0~3) 또는 분 | 경계 1개 전, 시간형은 max(15분, 20%) | §3.6.3 |
| `question.kind_exceptions` | 결정 종류 → 항상 묻기 / 절대 묻지 않기 / 방식 지정 | 없음 | D-4. 항상 묻기·묻지 않기는 정책 규칙으로도 저장(10 §3.6.4) |
| `question.per_loop` | 루프 → 위 값들 | §3.5.2 표 | D-10 |

다이얼이 아닌 질문 설정(사람이 바꾸지만 모드·루프로 층을 두지 않는 값). 14의 설정(`OrchestrationSettings`, 19 `settings.update`)에 두기를 요구한다.

| 설정 | 기본 | 의미 |
|---|---|---|
| 조건 결합 | and | OR은 사용 후 결정 (A-1) |
| 비슷한 시점 창 | 10분 | 묶음 규칙 |
| 묶음 크기 | 3 | 중재자·예약 묶음 상한 |
| 화면 표시 수 | 3 | 접히기 전 표시 질문 수(권리·막는 질문 제외). 14 `maxVisibleDecisions`와 같은 값 |
| 중재자 대기 | 2분 | §3.7 |
| 승인 유효 기간 | 24시간 | §3.14 |
| 검토 시간대 | 09:00 하나 | 경계 `review_window`, 중재자 입력 |
| 방해 금지 | 꺼짐 | 05 §3.7.4. 켜져 있으면 away로 본다 |

다이얼은 어느 값에서도 §3.3.1 권리 게이트 처리 규칙 2(가정 없음), V-Q-02(응답 선택지), 혼자 정한 결정 기록을 바꾸지 못한다(브리프 결정 17). 16의 다이얼 조정 제안(D10)이 다룰 수 있는 키는 위 다이얼 여덟 개와 설정 중 묶음 크기·비슷한 시점 창·화면 표시 수다(16 요구 (3)).

### 3.17 상태 기계

#### 3.17.1 질문

08 §3.22.7을 따른다. 이 문서가 더하는 입력과 효과(08에 반영 요구)를 함께 적는다.

| 현재 | 입력 | 다음 | 가드 | 부수 효과 |
|---|---|---|---|---|
| ∅ | `question.recorded` (R-23) | pending | V-Q-01~08, §3.4 판정 | 비막힘이면 `assumption.recorded`. 전달 결정(§3.5.2): now면 전달 지시, 예약이면 `question.delivery_planned`, 중재면 중재자 요청 |
| ∅ | `question.raise`, 같은 `dedupeKey` 열림 | (기존 질문) | V-Q-05 | `notice.question_merged`. 더 강한 질문이면 기존 `question.withdrawn` 후 새로 기록 |
| pending | `question.delivery_planned` (중재자·커널·사람의 미루기) | pending | V-MED-01~05 (중재자) | 시각이면 09 `p_timers` `question_delivery` |
| pending | 발화 사건(§3.5.3) | pending | | 전달 지시 `notify` (이벤트 없음) |
| pending | `question.delivered` (런타임 `question.mark_delivered`) | delivered | | `deliveredAt`, `deliveredTo`, 전달 payload(§3.5.6) |
| **delivered** | `question.delivery_planned` (사람의 미루기) | **pending** | 행위자 human | **08에 요구**: 미룬 질문은 질문함에서 내려가고 발화 때 다시 전달된다 |
| pending, delivered | `question.escalated` (만료 임박·사람·정책) | (그대로) | 전달 방식이 이미 즉시가 아님, 또는 강도 올림 | 전달 지시(interrupt) |
| pending, delivered | `question.answered` | answered | R-24, V-Q-07, `basisVersion` | §3.6.4 비교, 종류별 효과, 막힘 해제·재개 지시, 승인 대조(§3.14), 사람 조작 셈 |
| pending, delivered | `question.assumed` (커널·스케줄러) | assumed | 정보 게이트·비막힘, 만료점 도달 (R-25) | 가정 확정 선택, 전제 confirmed. 재개 없음(가정대로 이미 진행 중) |
| assumed | `question.answered` (늦은 답) | answered | R-24 | 같으면 끝. 다르면 §3.6.4 늦은 답 처리 |
| pending, delivered | `question.withdrawn` | withdrawn | V-Q-09 | 전제 retired, 막힘 해제 |
| pending, delivered | `question.expired` (커널) | expired | Concern 닫힘·병합, WorkUnit 취소, 대상 레코드 종료, 막힌 도구 호출 dropped | 전제 retired |

종료: answered, withdrawn, expired. assumed는 늦은 답을 받을 수 있다.

#### 3.17.2 질문 전제 (Assumption, origin question)

08 §3.22.10의 전제 상태 기계에 질문 사건을 대응한다.

| 현재 | 입력 | 다음 | 부수 효과 |
|---|---|---|---|
| ∅ | 비막힘 정보 질문 기록 | active | |
| active | 답이 가정과 같음 | confirmed | 연결 되돌릴 지점 확인(모든 전제 confirmed면 `rollback_point.expired`) |
| active | `question.assumed` | confirmed | 가정 확정 선택 |
| active | 답이 가정과 다름 (선택을 만드는 답) | invalidated | R-2 낡음 전파, 영향 계산, 재작업 필요 |
| active | 질문 withdrawn·expired | retired | |
| confirmed (가정 확정분) | 가정 확정 선택에 이의 → 재결정 답이 다름, 또는 늦은 다른 답 | invalidated | 재작업 필요 |

#### 3.17.3 혼자 정한 결정 (표시 상태)

레코드 상태는 08 §3.22.12다. 피드의 표시 상태는 투영이 계산한다.

| 표시 상태 | 조건 |
|---|---|
| 확인 안 함 | Autonomy 레코드, `decision.confirmed` 없음, 열린 이의 없음 |
| 확인함 | `decision.confirmed` 있음, 열린 이의 없음 |
| 이의 중 | 열린 Objection (`contestedBy` 비어 있지 않음) |
| 유지됨 | 이의 `dismissed`·`withdrawn` |
| 바뀜 | 대상 `superseded`·`revoked` (이의 `upheld`) |
| 재작업 중 | 바뀜 + 재작업 필요 또는 `reworkOf` WorkUnit 진행 중 |

#### 3.17.4 이의와 재작업

| 현재 | 입력 | 다음 | 가드 |
|---|---|---|---|
| ∅ | `objection.filed` | open | R-16, 사람 |
| open | 재결정 답이 원래와 같음, 또는 `objection.dismiss` | dismissed | 사람 |
| open | `objection.withdraw` | withdrawn | 사람 |
| open | 대상 대체·철회 (새 선택 `supersedes`, `choice.revoke`) | upheld | 커널 |
| (재작업) | 재작업 필요(계산) → `reworkOf` WorkUnit 제안 → 결과 확인 | | G-K2가 원래 WorkUnit의 새 쓰기를 막음 |

#### 3.17.5 권리 승인 (도구 호출과 질문)

08 §3.22.14의 도구 호출 상태와 질문 필드로 표현한다.

| 도구 호출 | 질문 | 입력 | 결과 |
|---|---|---|---|
| requested → awaiting_approval | ∅ → pending | `toolcall.intend`(권리) | `toolcall.approval_requested`, `question.recorded` |
| awaiting_approval → requested | → answered (approve) | `question.answer` | `toolcall.approved` |
| requested → started | `consumedByToolCallId` 설정 | `toolcall.intend`(같은 호출, `approvalQuestionId`) | 지문 대조 통과 |
| awaiting_approval → denied | → answered (deny 또는 approve_edited) | `question.answer` | `toolcall.denied` |
| (새 호출) requested → started | `consumedByToolCallId` = 새 호출 | `toolcall.intend`(고친 인자, `approvalQuestionId`) | approve_edited 지문 대조 통과 |

#### 3.17.6 범위 줄이기 (합의의 `narrowedScope`)

| 현재 | 입력 | 다음 | 가드 |
|---|---|---|---|
| 없음 | `agreement.narrow` | narrowed | ⊆ 현재 범위 |
| narrowed | `agreement.narrow` | narrowed | 더 좁게만 |
| narrowed | `agreement.restore` | 없음 | 연결 질문이 허락·답으로 닫히거나 철회, 복원 범위 ≤ 사람 확정 범위 |
| narrowed | `agreement.renegotiate`(사람) | 없음 (새 개정판) | |
| narrowed | 연결 질문 거절 | narrowed 유지 | |

### 3.18 명령 상세

10 §3.11.9 표의 명령 페이로드와 규칙이다. 공통 검사(채널, 능력, 스키마, version)는 10 §3.7.

```ts
interface QuestionRaisePayload {
  questionId: QuestionId;
  core: Omit<QuestionCore, 'delivery'>;         // 08 §3.13. 게이트·막힘·가정은 커널 판정이 덮어쓴다
  asking: Pick<QuestionAskingFields, 'decisionPointKey' | 'whyLocalInsufficient' | 'depth'>;
  decisionPoint?: DecisionPoint;               // 정보 게이트 판정 입력 (V-Q-08). 사람 접점 종류는 생략 가능
  touchpointKind?: HumanTouchpointKind;         // 14 §3.5.3. 오케스트레이터·15가 낼 때
}
interface QuestionAnswerPayload { questionId: QuestionId; answer: AnswerValue; note?: string; expect: VersionRef[] }
interface QuestionDeferPayload {                // 19 QuestionDeferParams에서 만든다
  questionId: QuestionId; expect: VersionRef[];
  until: { kind: 'boundary'; boundary: 'next_work_boundary' | 'user_return' }   // 19 nextWorkBoundary / nextBrief
       | { kind: 'at'; at: Ms }
       | { kind: 'condition'; label: string };  // 기계 판정 불가. 다음 user_return에 다시 놓고 조건 문장을 보인다
}
interface QuestionEscalatePayload { questionId: QuestionId }           // 사람이 "지금 보기"
interface QuestionWithdrawPayload { questionId: QuestionId; reason: string }
interface QuestionMarkDeliveredPayload { questionIds: QuestionId[]; deliveryId: string; channel: 'app' | 'push' | 'tui' | 'brief'; deviceIds: DeviceId[] }
// DeliveryPlanPayload: §3.7
interface BriefAcknowledgePayload { upToSeq: Seq; projectId: ProjectId | null }
interface DecisionConfirmPayload { targets: AnyRecordId[] }
// DecisionContestPayload: §3.10.1
interface ObjectionDecidePayload { objectionId: ObjectionId; note?: string }
interface AgreementNarrowPayload { agreementId: AgreementId; narrowedScope: Scope; linkedQuestionId: QuestionId; reason: string }
interface AgreementRestorePayload { agreementId: AgreementId; restoreTo: Scope | 'confirmed' }
// RollbackRegisterPayload: §3.12
```

| 명령 | 채널 | 능력 | 규칙 | 이벤트 | 주요 거부 |
|---|---|---|---|---|---|
| `question.raise` | M, X(verifier), R(오케스트레이터·15) | propose/question | V-Q-01~08, §3.4 판정 | 판정 갈래별(§3.4 표) | `policy.question_not_needed`, `invalid.question_shape`, `policy.question_without_choice`, `policy.want_inquiry_pick_question` |
| `question.answer` | H | accept, 사람 전용 | R-24, V-Q-07, 상태 열림 | `question.answered` + §3.6.4 파생 (+ `toolcall.approved`·`denied`) | `conflict.version_mismatch`, `conflict.already_resolved`, `policy.answer_option_not_allowed` |
| `question.defer` | H | accept, 사람 전용 | 상태 pending·delivered. 정보 게이트 비막힘이면 만료점보다 늦은 시각을 고르면 경고(가정 확정이 먼저 일어남) | `question.delivery_planned`(decidedBy human) | `conflict.already_resolved` |
| `question.escalate` | H | accept, 사람 전용 | 상태 pending | `question.escalated(cause 'human')` + 전달 지시 | |
| `question.withdraw` | M, R, H | propose/question 또는 사람 | V-Q-09 | `question.withdrawn` (+ `assumption.retired`) | `denied.capability` |
| `question.mark_delivered` | R | sys:runtime | 상태 pending(발화했거나 즉시·협상) | `question.delivered` | `conflict.invalid_transition` |
| `delivery.plan` | X(mediator) | propose/delivery_plan | V-MED-01~05 | 질문별 `question.delivery_planned` | `policy.delivery_after_expiry`, `invalid.schema` |
| `brief.acknowledge` | H | accept, 사람 전용 | `upToSeq` ≤ 현재 seq | `brief.acknowledged` | |
| `decision.confirm` | H | accept, 사람 전용 | 대상에 AutonomousDecision 또는 `activated_by_grant` 합의 | `decision.confirmed` (09에 요구) | `conflict.invalid_transition` |
| `decision.contest` | H | accept, 사람 전용 | R-16, §3.10.1 | `objection.filed` + 10 R-8 파생 | `gate.human_required`, `not_found.record` |
| `objection.withdraw` / `objection.dismiss` | H | accept, 사람 전용 | 08 §3.22.12 | `objection.resolved(withdrawn / dismissed)` (+ 재결정 질문 `question.withdrawn`) | |
| `agreement.narrow` / `agreement.restore` | M, R / M, R, H | propose/agreement_scope_change | §3.11 | `agreement.narrowed` / `agreement.restored` (08·09에 요구) | `gate.scope_expansion_required` |
| `rollback.register` | R | sys:runtime | §3.12 | `rollback_point.registered` (08·09에 요구) | `conflict.invalid_transition` |
| `runtime.boundary` | R | sys:runtime | 14 §3.13.6 경계 | `boundary.reached` (+ 발화 질문 전달 지시, 경계형 만료 판정) | |

19의 질문 메서드 대응(19 요구 (2)): `question.answer` → `question.answer`. `question.proceedWithAssumption` → `question.answer`(`accept_assumption`). `question.requestReframe` → `question.answer`(`reframe_question`). `question.requestInquiry` → `question.answer`(`experiment_first`). `question.delegate` → `question.answer`(`delegate`). `question.defer` → `question.defer`. 19 표의 `kernelCommand` 열을 이 대응으로 고쳐 달라고 요구한다(§5.2). 19 `QuestionAnswerParams.optionId = "narrowed"`는 `approve_edited`(줄인 인자)다.

### 3.19 측정 (16에 넘김)

| 지표 | 해석 | 출처 |
|---|---|---|
| Concern당 전달된 질문 수 | 많으면 사용자가 Helm을 건너뛰게 됨 (A12) | v0.3 06 §7 |
| 즉시 전달 비율, 끼어들기 비율 | 높으면 즉시 문턱이 너무 낮음 | v0.3 06 §7 |
| 답이 임시 가정과 같았던 비율 (종류별) | 높으면 덜 물어도 됨 (false positive 대리값, 14 §3.13.5) | v0.3 06 §7 |
| 답이 추천과 같았던 비율 (종류별) | 높으면 그 종류는 정책으로 덮을 후보 | 16 요구 (1) |
| 가정 확정 뒤 이의 비율 | 높으면 만료점이 너무 이르거나 더 물어야 함 | v0.3 06 §7 |
| 혼자 정한 결정 중 이의 비율 (종류별) | 종류별 정책 조정 근거 (false negative 대리값) | v0.3 06 §7 |
| 답이 결과를 바꾼 비율 (답이 추천·가정과 다르고 선택을 만든 경우) | 낮으면 승인 극장에 가까움 | 원전 Gate §9 |
| WorkUnit별 정상 경로 사람 조작 수, 2회 초과 비율 | 2회 상한 준수 | 대화 X3-2-19, 01 §3.5.3 |
| 2주 지표 5개 (우회·취소 비율, 범위 초과 차단 수, 근거 없이 제출된 기준 수, 결과 확인까지 시간, 열린 반영 항목 수) | 엔진이 무거운지 | 대화 X3-2-20 |
| 방식별 전달-답 지연 | 협상의 늦은 답이 문제인지 | McFarlane |
| 권리 게이트 대기 시간, 끼어들었으나 보지 않은 질문 수 | 사람 부재 영향 | 이 문서 §3.8 |

## 4. 실패·예외·경계 사례

| # | 사례 | 처리 |
|---|---|---|
| Q-E1 | 답이 run 정지보다 먼저 도착 | 답은 질문 레코드에 먼저 커밋된다. 런타임은 정지 전에 질문 상태를 확인하고 이미 답이 있으면 정지하지 않는다(Mastra 선도착 실험 [실험], 12 §3.13) |
| Q-E2 | 두 기기에서 같은 질문에 답 | 먼저 커밋된 답이 질문 version을 올린다. 나중 답은 `conflict.already_resolved`와 현재 질문 요약(10 E-3) |
| Q-E3 | 만료점 도달과 사람의 답이 같은 순간 | single writer 순서대로. 답이 먼저 커밋되면 answered. 만료가 먼저면 assumed 뒤 늦은 답으로 처리(§3.6.4). 클라이언트는 "이미 가정대로 진행됨"과 답의 효과(같으면 끝, 다르면 바뀐 선택과 재작업)를 보인다 |
| Q-E4 | 만료점 `before_primitive`의 대상이 질문과 같은 행동 | 그 제출이 도달 계기다. 가정 확정 후 행동을 받아들인다(되돌릴 지점 규칙은 그대로) |
| Q-E5 | 데몬이 꺼진 동안 만료 시각 지남 | 재시작 후 `timer.fire`가 늦게 오면 승격 없이 바로 만료 처리(§3.6.3). 복귀 요약에 "부재 중 가정 확정 n건" |
| Q-E6 | 중재자 계획이 이미 delivered된 질문을 포함 | 그 질문은 계획에서 빼고 나머지만 적용(부분 수락). notice |
| Q-E7 | 중재자가 계속 실패 | 대기 시간마다 negotiated로 놓인다. 운영 로그(17)에 남긴다. 중재 방식을 쓰는 다이얼 설정은 유지 |
| Q-E8 | 같은 결정점을 여러 run이 물음 | 병합(§3.5.5) |
| Q-E9 | 사람이 질문에 `reframe_question`으로 답함 | 질문은 answered. 에이전트가 같은 `decisionPointKey`로 재구성된 질문을 새로 낸다. 이전 질문이 닫혔으므로 병합되지 않고 새로 기록된다 |
| Q-E10 | 권리 게이트 행동이 다른 Concern에서도 필요 | 승인은 같은 Concern에서만 쓴다. 다른 Concern은 따로 묻는다 |
| Q-E11 | 가정 아래 이미 발송함 | V-AS-02로 발송이 막히므로 정상 경로에서는 없다. 사후 범위 위반(bash 등)으로 발생하면 보상 반영 항목과 `scope_violation` 질문 |
| Q-E12 | 되돌릴 지점이 실제로는 복구 불가(ref 삭제, 스냅숏 손상) | 되돌리기 도구 호출이 실패해 관찰로 남는다. 재작업 WorkUnit의 단계를 redo로 바꾸거나 사람에게 `tool_outcome_unknown`이 아닌 정보 질문 |
| Q-E13 | 이의를 건 결정에 기댄 사람 확정 레코드가 있음 | 자동으로 뒤집지 않는다. 주의 항목으로 보이고 재결정 질문 화면에 함께 나온다 |
| Q-E14 | 질문 수가 폭증 (모델이 계속 물음) | 정보 게이트 판정이 걸러내고, digest는 묶이며, 화면 표시 수와 주의 예산(14)이 있다. 반복 패턴은 16이 정책 수정 제안으로 |
| Q-E15 | 사람 부재가 길어 결과 확인이 쌓임 | Grant 범위 안의 독립 작업은 계속된다. 의존하는 작업은 막힌다. 결과 확인 질문은 복귀 때 우선순위 순서로 |
| Q-E16 | 방해 금지 중 권리 게이트 | 강도 digest(OS 알림 없음). 막힌 행동은 계속 막힌 채 질문함·배지에 보인다 |
| Q-E17 | 원함 탐구에서 모델이 `choose_one` 질문을 냄 | V-Q-03 거부 `policy.want_inquiry_pick_question`. 다음 행동: 자극 제시(`stimulus.present`)와 반응 기록, 또는 `triad` 반응 요청 |
| Q-E18 | `approve_edited`의 인자에 비밀이 포함 | 지문만 질문 답에 남기고 인자 원문은 blob에 둔다. 화면 미리보기는 13의 비밀 가림(`argsPreview`, 13 §3.10)을 거친다(18) |
| Q-E19 | 미룬(`question.defer`) 비막힘 질문의 만료점이 미룬 시각보다 먼저 옴 | 가정 확정이 먼저 일어난다. 미루기 화면에서 이를 경고한다(§3.18 `question.defer` 규칙). 막는 질문을 미루면 그동안 그 WorkUnit은 멈춰 있다(05 "그동안 작업은 멈춰 있습니다") |
| Q-E20 | presence 값이 틀림(데스크톱이 `locked`를 보내지 못함, 20) | `idle`이 길어져 away가 되는 경로로 처리된다. presence 오판은 강도만 바꾸고 질문 기록·막힘에는 영향이 없다 |
| Q-E21 | 질문 병합 중 기존 질문에 전제가 있고 새 질문이 막힘 | 기존 질문 withdrawn, 전제 retired, 새 막는 질문 기록. 기존 전제 아래 이미 한 쓰기는 영향 계산 대상(전제가 retired여도 `toolcall.started`의 전제 목록에 남아 있다) |
| Q-E22 | 런타임이 `notify` 지시를 처리하기 전에 데몬이 꺼짐 | 재시작 뒤 09 소비자 커서 이후 이벤트에서 `directivesFor`로 지시를 다시 만든다. `question.mark_delivered`는 질문이 pending일 때만 받아들이므로 두 번 기록되지 않는다 |

## 5. 다른 문서와의 인터페이스

### 5.1 이 문서가 제공하는 것

| 대상 | 제공 |
|---|---|
| 10 | 질문 명령과 V-Q·V-AS·V-MED·V-AUT 규칙, 판정 함수(`decideAsk`, `planDelivery`, `urgencyOf`), 코드 `policy.delivery_after_expiry`·`policy.answer_option_not_allowed` |
| 08 | 질문 종류 레지스트리, 질문 추가 필드, 질문 전제·되돌릴 지점·승인·이의·재작업의 규칙과 상태 대응 |
| 09 | 질문 이벤트 사용 규칙(전달 결정은 `question.delivery_planned`·`question.escalated`, 전달 기록은 runtime의 `question.delivered`), `p_timers`의 `assumption_expiry`·`question_delivery` 계산 기준 |
| 12 | 전달 지시(`notify`, `agent.request(mediator)`), 재개 지시, 경계 사건 목록, 중재자 입력 형식, 질문 상태 선확인 규칙, 승인 뒤 같은 도구 호출 재개 |
| 13 | 인자 지문 대조와 `approve_edited`, 되돌릴 지점 등록 시점, `draft_only`, 검증 실행 `purpose` |
| 14 | 질문 다이얼의 의미와 값, 루프별 전달 기본값, 사람 접점 종류 대응, 경계 발화, 묶음 규칙 |
| 15 | 원함 탐구 질문 제한(V-Q-03), `criterion_confirm`·`triad`·`reframe_confirm` 처리, 가정 확정과 기준 확정의 구분 |
| 16 | §3.19 지표, `autonomyStats` 조회, `matchesAssumption`·`matchesRecommendation` |
| 04·05·21 | 질문 화면 필드, 응답 선택지와 처리, 강도별 표시, "에이전트가 정한 것" 항목, 복귀 요약 순서, 우선순위와 `priorityReason` |
| 19 | 질문 명령과 메서드 대응, `question.defer`의 `until` 형식, 전달 payload |
| 20 | 전달 payload(§3.5.6), 강도별 표시 |

### 5.2 다른 문서에 요구하는 것

| 대상 | 요구 |
|---|---|
| 08 (P5) | (1) 질문에 §3.2의 `QuestionAskingFields`(`decisionPointKey`, `dedupeKey`, `askEvaluation`, `whyLocalInsufficient`, `rightsCategories`, `assumptionAnswer`, `depth`). (2) 질문 종류 추가(§3.2.2의 "08에 요구" 행). `send_approval`을 넓힐지 `action_approval`을 따로 둘지 결정. (3) `Trigger`에 `boundary` 변형과 `before_primitive.resources`(§3.6.2). (4) 질문 상태 기계에 `delivered → pending`(사람의 미루기) 전이(§3.17.1). (5) `consumedByToolCallId`가 `subjectRef`와 다른(고친 인자의 새) 도구 호출일 수 있음(§3.14). (6) `WhyNotAsked`에 `delegated`(questionId), `rule_default`(ruleId) 변형(§3.9.1). (7) Objection에 `desired`(선택), `ContestableId`에 `rs`(§3.10.1). (8) WorkUnit에 `reworkOf`(§3.10.3). (9) 레코드 `rb` RollbackPoint(§3.12). (10) Agreement에 `narrowedScope`(§3.11). (11) 기대 기본 기한 72시간 [제안]을 받아들인다(08 요구 (3)에 대한 답). 질문 설정으로 둔다 |
| 09 (P5) | (1) `question.answered` payload에 `matchesRecommendation`(16 요구). (2) `question.delivered` payload에 §3.5.6 `QuestionDeliveredExtra`(19·20 요구). (3) 새 이벤트: `decision.confirmed`, `agreement.narrowed`, `agreement.restored`, `rollback_point.registered`·`used`·`expired`, `boundary.reached`(14와 공유). (4) `question.delivery_planned`의 `decidedBy`를 payload나 envelope 행위자로(사람의 미루기, 중재자, 커널 구분). (5) `p_timers` 행 `question_escalation`(만료 여유)과 `question_delivery`·`assumption_expiry`·`mediator_timeout`의 계산을 §3.5·§3.6.3에 맞춤 |
| 12 (P7) | (1) 지시 `notify`를 전달기로, 전달 뒤 `question.mark_delivered`. 연결 클라이언트가 없으면 channel `brief`. (2) `agent.request(mediator)`로 중재자 실행, 결과를 `delivery.plan`으로 제출. (3) needs_gate면 run 정지, 정지 전 질문 상태 확인, 재개 지시에서 답 payload 전달. 권리 승인 뒤 같은 `toolCallId`로 `toolcall.intend` 재제출. (4) 복귀 요약 순서(§3.8.2). (5) 타이머 목적: `question_escalation`, `question_expiry`, `question_delivery`, `mediator_timeout` |
| 13 (P7) | (1) 지문 정규화 함수를 `@helm/domain`에 두어 커널과 공유. (2) 활성 질문 전제가 있는 WorkUnit에서 첫 쓰기 전 되돌릴 지점 생성과 `rollback.register`. 되돌리기 도구 호출에 `rollbackPointId`. (3) `approve_edited`의 고친 인자 본문을 blob으로(13 요구와 같음). (4) 13 §3.7.8의 코드 이름 `content.rollback_point_required`를 `policy.rollback_point_required`로 |
| 14 (P8) | (1) 다이얼 정본에 §3.16 항목. 다이얼이 아닌 질문 설정을 `OrchestrationSettings`에. (2) 루프별 전달 기본값을 루프 계약 데이터에. (3) `boundary.reached` 경계 목록을 §3.5.1 `WorkBoundaryKind`로 확정하고 `user_return`을 presence 집계에서 낸다. (4) 주의 예산 상태(`normal`·`over_budget`·`quiet_hours`)를 `ctx.presence.attention`으로 넘긴다(실행 기록에서 계산). (5) 규칙 기반 결정의 `whyNotAsked`는 `rule_default`(08 요구) |
| 15 (P9) | (1) 원함 탐구에서 반응을 관찰로 기록하고 질문의 답으로 다루지 않는다. (2) 기준 후보 여러 개를 한 `criterion_confirm` 질문에 묶을 때 `answerSchema`를 후보별 확정·거절 배열로. (3) 라운드 끝은 `runtime.boundary(round_end)`. (4) 비막힘 질문의 전제는 커널이 만든다(15가 따로 기록하지 않음) |
| 16 (P10) | §3.19 지표 수집, 정책 수정 제안(§3.9.4)과 근거 통계. presence는 이벤트가 아니므로 활동 시간 지표는 19 `presence.report`에서 데몬이 만든 운영 기록으로 |
| 19 (P12) | (1) §3.18 끝의 메서드 → 커널 명령 대응으로 메서드 표의 `kernelCommand` 열 수정. (2) `QuestionDeferParams.until`을 §3.18 `QuestionDeferPayload`로 변환. (3) "지금 보기" 메서드(`question.escalate`) 추가. (4) 질문 뷰에 형식별 응답 선택지와 `priorityReason` |
| 20 (P13) | 전달 payload를 §3.5.6으로 읽는다. `surface`는 강도에서 데몬이 정한다 |
| 05·04·21 (P2, P14) | 질문 카드: 질문 문장 구성 일곱 칸과 응답 선택지, 강도별 표시, 접힘 규칙(권리·막는 질문은 접지 않음), "에이전트가 정한 것" 피드와 이의 버튼(사유 선택 입력 + desired 세 가지), 이의 영향 미리보기, 권리 게이트 카드의 인자 미리보기·수정(`approve_edited`), 미루기의 만료 경고, 문구 키 `question.reason.*`·`question.priority.*` |
| 17·20 (P11, P13) | 방해 금지 설정을 데몬 설정으로 두고 presence 집계에 넣는다. 클라이언트가 없을 때의 외부 알림 경로는 1단계 범위 밖임을 명시 |
| 18 (P11) | 권리 범주 판정 규칙, `disclose_data`를 고정 범주로 둘지(대화 b1), 인자 미리보기의 비밀 가림 |
| 23 | C/A 명령과 질문 핵심(권리 게이트, 결과 확인, 가정·만료)을 첫 마일스톤에 |

### 5.3 다른 문서가 이 문서에 요구한 것과 처리

| 요구한 문서 | 요구 | 처리 |
|---|---|---|
| 01 | Concern 열기 제안을 정보 게이트 질문으로, send는 항상 권리 게이트, 결과 확인은 가정 확정 대상 아님, 같은 질문 반복 알림 금지, 가정 만료 기본값 "다음 작업 경계" | `entry_confirm`(§3.2.2), §3.3.1, §3.15.3 2, §3.5.3 3, V-Q-06 |
| 02 | 기준 확인 질문, Concern 열기 제안 질문, Goal 수정 권리 게이트, 결과 확인의 전달 방식, 승격·가정 확정 순서 | §3.2.2, §3.3.1, D-1(결과 확인은 권리 게이트 즉시, 막힘 없으면 알림), 판단 승격은 10 §3.9이고 가정 확정은 §3.6.3(둘은 독립. 가정 확정이 판단을 승격시키지 않는다) |
| 03 | 질문 종류 정본 목록과 화면 종류 대응, "비확장 합의는 질문을 만들지 않는다"의 판정 | 종류는 §3.2.2(08 정본). 화면 대응은 03 소유. 비확장 판정은 Grant 포함 검사(10 §3.6.7) |
| 04 | (1) `depth` (2) 응답 종류의 의미 (3) 묶음(`bundleId`)과 경계 이름 (4) `priorityReason` 문장 키 (5) 결과 확인·합의 확인·Goal 확인·복구 판단을 질문 레코드로 | (1) `QuestionAskingFields.depth` (2) §3.2.3 처리 표 (3) `batchKey`, §3.5.1 `WorkBoundaryKind` (4) §3.5.4 (5) 모두 질문 종류(§3.2.2) |
| 05 | (1) 권리 게이트 assumed 없음 (2) gate reason 문장 키 (3) 응답 종류 처리 (4) 이의 처리 상태와 에이전트 혼자 기각 금지 (5) "다음부터 묻기" 경로 (6) 방해 금지 = 자리에 없음 (7) 시간당 알림 상한 | (1) §3.3.1 2 (2) `question.reason.*` (3) §3.2.3 (4) §3.17.3, §3.10.1 끝 (5) §3.9.4 끝 (6) §3.8.1 (7) D-8과 묶음 규칙 |
| 08 | (1) 전달 결정은 `question.delivery_planned`·`question.escalated`로만 (2) 만료점에 `Trigger` (3) 기대 기본 기한 (4) 늦은 답과 `rollbackPoint` 의미 | (1) §3.5.2 끝 (2) §3.6.2 (확장 요구 포함) (3) 72시간 수용 (4) §3.6.4, §3.12 끝 |
| 09 | 질문 이벤트와 `p_timers`, 전달기가 `question.delivered` 기록 | §3.5.3, §3.6.3 |
| 12 | 질문 대기 중 run 종료와 답 뒤 재개, 예약 전달·만료 타이머, 중재자 run, `tool_outcome_unknown`, 승인 실행 계획 저장과 1회 소진, 재시작 뒤 승인 유지 | §3.6.4, §3.5.3, §3.7, §3.2.2, §3.14(도구 호출 레코드와 질문 필드에 저장되어 재시작 뒤에도 유지) |
| 13 | 되돌릴 지점 생성, `draft_only`·검증 격리, `argsPreview` 가림, `approve_edited` 본문 | §3.12, §3.11, §3.13, Q-E18, §3.14 |
| 14 | (1) 사람 접점 종류를 질문 종류로 (2) `boundary.reached`로 예약 전달, 만료 여유 경계 정의 (3) 주의 상태 반영 (4) 묶음(같은 Concern, goal_revise, agreement_confirm + finding_confirm, result_review + 반영 방침) (5) 권리 게이트 assumed 없음 (6) 중재자가 접속·주의 상태를 읽음 (7) 혼자 정한 결정 기록에 14 §3.9.6 종류 | (1) §3.2.2 (2) §3.5.3, §3.6.3 (3) D-7, `urgencyOf` (4) §3.15.2 (5) §3.3.1 (6) §3.7 (7) §3.9.1 |
| 15 | `triad`, `reframe_confirm`, 전제 선기록, I 계열 라운드 경계 예약, 기준 확인 묶음, 가정 확정이 기준을 확정하지 않음, 원함 탐구 밖 `choice` 질문의 A15 선택지 | §3.2.2, §3.4 끝, D-10 표, §5.2 15 (2), §3.6.3, §3.2.3 필수 선택지 |
| 16 | (1) `recommendation`, `assumption` 구조화, `matchesRecommendation`·`matchesAssumption` (2) presence 이벤트 형식 (3) 다이얼 조정 제안이 다룰 키 | (1) 08 `recommendation`, `assumptionAnswer`, §3.6.4 (2) presence는 이벤트가 아니다(§3.8.1). 19 운영 기록 사용 (3) §3.16 끝 |
| 18 | `needs-human` + `rightsGate` 판정을 받아 묻는다. 권한 레이어는 질문을 만들지 않는다 | §3.3.1 6 |
| 19 | (1) 전달 payload (2) 메서드와 종류·전이 대응, `defer`의 `until`, 권리 게이트의 `proceedWithAssumption` 거부 (3) `presence.report` 사용 규칙 | (1) §3.5.6 (2) §3.18 끝, V-Q-07 (3) §3.8.1 |
| 20 | 전달 payload 필드, `locked`는 데스크톱이 보내지 못함 | §3.5.6, Q-E20 |
| 21 | 이의 사유 선택, 가정 확정 뒤 답을 이의로 | §3.10.1 `reason?`, §3.6.4 늦은 답 |

## 6. 구현 단위와 완료 기준

### 6.1 파일

```text
packages/kernel/src/asking/
  registry.ts          # 질문 종류·결정 종류 레지스트리 기본 데이터, 형식별 필수 선택지, 적재 검사
  gate.ts              # 권리 게이트 판정, evaluateInformationGate, decideAsk
  delivery.ts          # planDelivery (D-1~D-11, 묶음 규칙), urgencyOf, 발화 판정, questionPriority, priorityReason
  expiry.ts            # 만료 여유·도달 판정 (at, boundary, before_*, record_state)
  assumption.ts        # 질문 전제 생성, 답 비교, 늦은 답, V-AS-01~03
  mediator.ts          # V-MED-01~05, 계획 적용, 대기 초과
  approval.ts          # 승인 대조 (지문, 소진, 유효 기간, approve_edited)
  autonomy.ts          # autonomousDecisions, autonomyStats, 이의 파생(R-8의 질문 쪽), reopenLoop 표
  rework.ts            # reworkNeeded, reworkOf 검사 (G-K2 입력)
  humanOps.ts          # 정상 경로 예산 계산
packages/kernel/src/commands/question.ts   # §3.18 명령 스펙
packages/kernel/test/asking/
  gate.test.ts delivery.test.ts expiry.test.ts assumption.test.ts mediator.test.ts
  approval.test.ts contest.test.ts rework.test.ts humanops.test.ts
packages/kernel/test/scripts/absent-user.json, late-answer.json, contest-rework.json
```

### 6.2 완료 기준

| 단위 | 조건 |
|---|---|
| 게이트 판정 | §3.3.4 판정 연습 a~d가 표의 결과와 같다(다이얼 보통). 각 다이얼 값 3 × 조건 3의 경계값 표 테스트 |
| 권리 게이트 | 권리 질문은 어떤 다이얼·presence 조합에서도 `assumed`·시간 만료가 되지 않는다(10 PT-09). 방해 금지·부재에서도 행동은 막혀 있다 |
| 질문 형식 | 레지스트리의 모든 종류가 형식의 필수 선택지를 가진다. 권리 게이트에 `accept_assumption`·`delegate` 답은 거부. I.want의 `choose_one` 거부 |
| 전달 | D-1~D-11 각 규칙이 첫 일치로 적용되는 사례. 묶음 규칙(창 안 두 질문 뒤 셋째는 예약). 발화 사건별 전달 지시. `question.mark_delivered` 중복 기록 없음 |
| 강도 | `urgencyOf` 표: 부재·방해 금지·조용한 시간 → digest, 승격 → interrupt, 즉시·막힘 → interrupt, 즉시·비막힘 → notice |
| 만료 | 다섯 종류 만료점의 승격·도달. 늦은 타이머에서 승격 생략 |
| 가정 비교 | 같은 답 → 전제 confirmed, 다른 답 → invalidated + 영향 + 재작업 필요. 선택을 만들지 않는 답 → 전제 active 유지. 늦은 다른 답 → 이의 filed·upheld + 새 선택 |
| 가정 아래 행동 | V-AS-02 발송 거부, V-AS-03 되돌릴 지점 없는 첫 쓰기 거부, 등록 후 통과 |
| 중재자 | V-MED 각 위반 거부, 대기 시간 경과 시 negotiated |
| 사람 부재 | v0.3 06 §6 예시(23:02 Q-14 정보 게이트 예약, 23:40 Q-15 권리 게이트 대기, 다음 날 `user_return` 묶음, Q-14 답 = 가정 → 그대로, Q-15 허락 → 같은 도구 호출 재개 → 기대 레코드 + 발송)를 대본으로 재현 |
| 혼자 정한 결정 | §3.9.1 표의 모든 종류가 피드에 나온다. 일괄 확인 1회 조작 |
| 이의·재작업 | 이의 → 영향 표시, 재개 루프 표대로, 같은 결정점 자율 재결정 거부(10 PT-13), 재결정 질문, 같은 답 → dismissed, 다른 답 → upheld → 재작업 필요 → G-K2가 원래 WorkUnit 쓰기 거부 → `reworkOf` WorkUnit → 되돌리기 도구 호출 → 결과 확인 |
| 범위 줄이기 | ⊆ 검사, 복원 조건, 결과 제출 limitations 자동 기입 |
| 승인 | 지문 일치 1회 소진, 다른 인자 거부, `approve_edited` 새 호출 허락, 유효 기간 경과 거부, 재시작 뒤 승인된 호출 재개 |
| 사람 조작 | Grant + 결과 확인 = 정상 경로 2회로 끝나는 C/A 대본. C 단계 정보 질문이 결과 확인 묶음으로 가는지. 권리 게이트는 정상 경로 밖으로 셈 |
| 승인 극장 방지 | 진행 확인 종류·I.want의 choose_one 거부, 필수 선택지 없는 종류 적재 거부 |

## 7. 미결 사항

| # | 질문 | 선택지 | 추천 기본값 |
|---|---|---|---|
| A-1 | 질문 조건 AND/OR 사용자 선택 | (a) AND만 (b) OR 옵션 추가 | (a). 2~4주 사용 뒤 Concern당 질문 수와 이의 비율로 결정(브리프 결정 16) |
| A-2 | 문턱 수치 (c2: major/material/minor, c3: 6/4/2, VoI 즉시 9/9/6) | 수치 | 그대로 시작, 16 지표로 조정 |
| A-3 | 권리 게이트 시간 만료 | (a) 없음 (b) 사용자가 질문별로 정함 | (a). 침묵을 거절로도 해석하지 않고 기다린다. 실제 사용에서 오래 쌓이는 권리 질문이 문제가 되면 (b) |
| A-4 | 사람 부재 시 외부 알림 | (a) 없음 (b) 휴대폰 푸시 | (a) 1단계. 19·20이 이후 단계로 검토 |
| A-5 | presence를 기준 원본에 둘까 | (a) 운영 상태만(10·19) (b) 전이를 이벤트로 | (a). 전달 결정이 이벤트로 남으므로 재생에 필요 없다. 1판 추천을 바꿨다 |
| A-6 | 가정 확정 뒤 질문을 닫을까 | (a) assumed로 닫고 늦은 답 허용 (b) 계속 열어 둠 | (a). v0.3 06 §3.5, 08 §3.22.7 |
| A-7 | `decision.confirm`을 사람 조작으로 셀까 | (a) 별도 셈(상한 제외) (b) 포함 | (a). 사람이 시작한 조작 |
| A-8 | 기본 전달 방식 | (a) 협상 (b) 중재 | (a). McFarlane 권고, 중재자는 선택 |
| A-9 | 이의 뒤 재결정을 반드시 질문으로 | (a) 예 (b) 에이전트가 다른 결정이면 자율 허용 | (a). 같은 일이 반복되지 않게 |
| A-10 | 에이전트의 반영 항목 미루기 | (a) 허용 + 복귀 요약 표시(08) (b) 사람만 | (a). 08 규칙 6과 맞춤. 1판 추천(b)을 바꿨다. 피드에 보이고 사람은 `obligation.reopen` |
| A-11 | 검토 시간대 기본 | (a) 09:00 하나 (b) 없음 | (a). 사용자가 정함 |
| A-12 | before_* 만료의 승격 시점 | (a) 모델 선언 경계 수 (b) 첫 경계 | (a), 선언 없으면 (b) |
| A-13 | 질문 갱신 이벤트 | (a) 철회 후 새로 기록(이 문서) (b) 09에 `question.updated` 추가 | (a). 갱신이 드물고 이력이 분명하다 |
| A-14 | 08에 없는 질문 종류가 많음 | (a) 08에 추가 (b) `other` + 레지스트리 키 | (a). 응답 형식과 막힘 범위를 종류로 집행하므로 |

## 8. 출처

### 8.1 참고한 자료

| 자료 | 위치 | 쓴 곳 |
|---|---|---|
| 설계 브리프 | `docs/design/process/00-design-brief.md` 결정 2, 8, 12, 14, 16, 17, 18, 22, 37, §3.5 | §2 |
| 다른 설계 초안 | 08 §3.4.4·§3.4.5·§3.8·§3.10·§3.13·§3.22.7·§3.22.12·§3.22.14·§5.2, 09 §3.4·§3.11.3·§5.2, 10, 12 §3.13·§5.2, 13 §3.7.8·§3.7.9·§5.2, 14 §3.5.3·§3.13.5~§3.13.8·§3.20.1·§5.2, 15 §3.7·§5.2, 16 §5.2, 18 §5.2, 19 §3.7.5·§3.7.8·§3.8.3·§5.2, 20 §3.10.1, 01·02·03·04·05·21의 §5.2 | §2.4, §3, §5.3 |
| v0.3 06 묻기와 끼어들기 | `docs/v0.3/06-asking-and-interruption.md` 전체 | 전체 |
| v0.3 03, 07, 08 | 03 §3.3(비상 합의), §6(전환 계기), 07 §2.4(능력표), §3(다이얼 정본), 08 §4(결정 주체), §9(독립성) | §3.3, §3.7, §3.16 |
| 감사 보고 | `docs/v0.3/audit/audit-report.md` §3.10(범위 줄이기, rollback_point, 자동 검증, approval theater) | §3.11~§3.13 |
| Mastra 검토 | `docs/v0.3/audit/mastra-review.md` §4(승인-인자 지문), §5(suspend/resume, 시한 없음, 선도착 답) [원문·실험] | §3.2.1, §3.14, Q-E1 |
| 대화 발췌 3 | X3-2-07~21(C/A, 사람 조작 2회, 2주 지표), X3-6-03~07(코드가 정하는 질문 선택) | §3.15, §3.19 |
| 대화 발췌 4 | 1-31~1-36(선택 요청 세 조건과 판정 연습), 2-2~2-6(혼자 정한 결정, AND/OR), 4-1~4-15(VoI, Horvitz, Parasuraman, McFarlane, 권리 게이트), 5-1~5-15(두 결정 분리, 질문 레코드, 가정 만료점, 다이얼 세 값), 21(d) d1~d8·d14 | 전체 |
| 원전 정리 1 | §9.4(알아서 해), §9.6~9.7, §12.2~12.4, §12.10, §12.12, §15.7 | §3.2, §3.3, §3.5 |
| 원전 정리 2 | §1.12(Gate rule), §3.7~3.8(Gate 조건, approval theater), §3.10(User-acknowledged cursor), §3.15(headless needs_gate), §3.18(동시 Gate 3개), §4.6(권한 이어 쓰기), §5.2.2(Decision Gate 템플릿), §11 체크리스트 | §3.2, §3.5, §3.15 |
| 원전 정리 3 | §4.11(Speech Acts 규칙 6), §4.13(Subsidiarity 규칙 2·6), §4.14(MBE), §7.1 C1·C3·C9·C10·C11, §7.2 G1·G4, §8 체크리스트 | §2.3, §3.2, §3.3.1, §3.9.4 |

### 8.2 원천 체크리스트 반영

| 원천 항목 | 반영 위치 / 반영하지 않은 이유 |
|---|---|
| canon-1 §21 11: 개입 허용 조건 8, 비생성 5, P03 비생성 6 | 허용 조건 8은 권리 게이트 범주(3: 비가역·외부, 4: 권한 밖, 7: 수락·통합)와 정보 게이트 판정(1: 가치 충돌 → `value.tradeoff` 종류, 2·5·6: 조건 2·3), 재개(8: 다시 볼 조건 → 10 R-2·R-10)로 흡수. 비생성 조건은 조건 1(정책·자동 검증), 조건 2(결과 차이 없음), V-Q-08(혼자 해결 가능한 정보 부족은 질문 아님), 진행 보고는 질문 종류에 없음 |
| canon-1 §21 11: Gate 생성 "추가 판단이나 실험이 결과를 바꿀 수 있을 때" | 조건 2, 선택지 `experiment_first` |
| canon-1 §21 11: 개입 필요도 두 판, 설명 가능한 Gate rationale, weight는 pilot 전 확정 안 함 | `askEvaluation`을 질문에 저장(설명 가능), 수치는 [제안]과 미결 A-2 |
| canon-1 §21 11: 보충성 7 경우, 선택 요청 깊이 3 | 보충성 경우는 권리 범주·정보 게이트로 흡수. 깊이 3(가볍게/일반/깊은)은 질문 필드 `depth`로 받고 표현은 04·05 |
| canon-1 §21 11: Gate 13필드, Alternative, Reopen trigger | §3.2.1 |
| canon-1 §21 11: 금지 상호작용 8(중복), 10(침묵을 승인으로), 4(보지 않은 변경을 합의로) | V-Q-05, §3.3.1 규칙 2, 혼자 정한 결정 표시(합의로 표현하지 않고 "에이전트가 정한 것"으로) |
| canon-1 §21 11: attention_policy, Gate 우선순위 5요소, 유사 Gate 병합 | 설정 §3.16(검토 시간대, 묶음, 표시 수), 우선순위 §3.5.4, 병합 §3.5.5. `maximum_active_gates: 3`은 표시 수 설정으로(canon-3 C3) |
| canon-1 §21 11: "알아서 해"를 비가역 외부 변경까지 확장 안 함, Escalation Event | 권한 이어 쓰기 포함 검사(10), 권리 게이트는 Grant가 있어도 따로 묻는다(§3.3.1), needs_gate = `command.rejected` + 질문 |
| canon-1 §21 11: 혼자 정한 결정과 독립성 표시 | §3.9, 10 V-POL-07 |
| canon-2 §11 11: approval theater 방지와 Gate 조건 | V-Q-02·03, 판정 §3.3 |
| canon-2 §11 11: Headless needs_gate + resume token | needs_gate 결과의 질문 ID와 version이 재개 토큰 역할. 관리 CLI(비대화)는 stdin으로 묻지 않고 needs_gate를 그대로 돌려준다 |
| canon-2 §11 11: 동시 active Gate 3개 이하, 중복 질문 금지 | 표시 수 설정 3, 묶음 크기 3, V-Q-05 |
| canon-2 §11 11: Last cheap point, What proceeds automatically, Defer until trigger | `assumptionExpires`, `delayImpact` + 임시 가정, `question.defer` |
| canon-2 §11 11: 비확장 Agreement 재질문 없음, 확대 시 Gate | 10 §3.6.7, §3.15.2 |
| canon-2 §11 11: 범위를 줄여 진행(narrower Agreement draft) | §3.11 |
| canon-3 §8 11: "왜 사람이 정해야 하는가" 필드 | 08 `reasons` + `whyLocalInsufficient` + `askEvaluation` |
| canon-3 §8 11: 질문 레코드 필드 후보(why now, last cheap point, 반대 근거, 결과, 다시 볼 조건, 영향 피드백) | §3.2.1 |
| canon-3 §8 11: assumed는 정보 게이트만 | V-Q-04, V-AS-01, 10 PT-09 |
| canon-3 §8 11: 반복 예외·질문 유형은 정책 수정 제안(사람 확인), 자동 권한 확대 없음 | §3.9.4 |
| canon-3 §8 11: 중재자 분리로 self-report bias 줄이기 | §3.7 |
| canon-3 §8 11: "예정보다 다름"과 "중요하게 나쁨" 구분을 조건 2 설명에 | §3.3.4 조건 2 설명. 질문 화면 문구는 05 |
| canon-3 §8 11: false negative를 false positive와 함께 측정 | §3.19 (이의 비율, 가정 일치 비율), 14 §3.13.5 |
| canon-3 §8 11: 묻기 설계 근거 표에 MBE, Subsidiarity, Critical Pauses, Requisite Variety | §8.3 |
| canon-3 G1 check-back | 사람 쪽: `brief.acknowledge`(§3.8.2). 에이전트 쪽: 10 합의의 `checkBack` |
| 발췌 4 d1 권리 게이트 위치 | 판별은 권한 레이어, 질문·기록·전달은 Helm (§3.3.1) |
| 발췌 4 d2 "되돌릴 수 있는가" 값 형식 | 권한 레이어 판정(10 §3.6.5). Helm은 표시와 V-AS-02 입력으로만 |
| 발췌 4 d3 정보 유출 행동 고정 | 18에 요구(`disclose_data` 범주) |
| 발췌 4 d4 AND/OR, 수치 | A-1, A-2 |
| 발췌 4 d5 질문 상태 기계와 만료점 표현 | §3.17.1, §3.6.2 |
| 발췌 4 d6 중재자가 사람 상태를 아는 방법 | §3.7 끝 |
| 발췌 4 d7 예약 전달 경계 목록 | §3.5.1 `WorkBoundaryKind` (14 §3.13.6) |
| 발췌 4 d8 이의 잦은 종류의 정책 수정 주체 | 관찰 에이전트 제안 → 사람 확인 (§3.9.4) |
| 발췌 4 d14 비상 합의 형식 | 비상 Grant(10 §3.11.6), 없으면 `emergency_authorization` 질문 |
| 발췌 4 b2 종류별 예외 규칙("가격과 결제는 항상 묻는다") | `question.kind_exceptions` 다이얼 + `always_ask` 정책 |
| 발췌 4 b4 라우터 선택도 혼자 정한 결정 | §3.9.1 표 (`mode.assigned`) |
| 발췌 4 b7 범위 줄여 진행, 되돌릴 지점 | §3.11, §3.12 |
| 발췌 4 b8 질문 빈도 다이얼을 기능별로 | `question.per_loop`(Parasuraman 네 기능 ≈ 루프) |
| 발췌 2 d-7 Gate 빈도 초기값 | 다이얼 기본값 §3.16 |
| 발췌 2 d-11 선택지에 "질문 재구성" | 넣는다 (`reframe_question`) |

### 8.3 묻기 설계의 근거 방법 (canon-3 §3.3)

| 방법 | 이 문서에서의 형태 |
|---|---|
| Management by Exception | 정보 게이트 조건, 만료점(= last cheap point), 반복 예외 → 정책 수정 제안 |
| Subsidiarity | 혼자 정한 결정(`whyNotAsked`), `whyLocalInsufficient`, 반복 Gate를 정책으로 내림 |
| Critical Pauses | 작업 경계 예약 전달 |
| Requisite Variety | 묶음, 표시 수, 전달 방식, 주의 예산으로 사람에게 오는 양을 줄임 |
| CRM | 협상·중재 전달, 이의 경로, check-back |
| Speech Acts | 침묵을 수락으로 보지 않음, 재협상은 정상 전이 |
| Horvitz mixed-initiative | 범위를 줄여 진행, 사람 상태를 보고 타이밍 |
| McFarlane | 네 전달 방식, 협상 기본 |

## ADR 후보

### ADR-A1 전달 시점과 알림 강도를 나눈다

- 상태: 제안
- 맥락: v0.3 06 §3.3은 권리 게이트를 즉시 전달한다. McFarlane 실험에서 즉시 끼어들기는 원래 작업을 가장 많이 방해했다. Goal 수정 확인처럼 막지 않는 권리 질문도 있다.
- 결정: 전달 방식(언제 놓이나)은 레코드에 남기고, 알림 강도(끼어들기·알림·묶음)는 질문 상태·presence·다이얼에서 계산해 전달 기록에 남긴다. 권리 게이트는 언제나 즉시 놓이고, 막힘이 있을 때만 끼어든다. 부재·방해 금지면 강도만 묶음으로 낮춘다.
- 근거: 권리 게이트의 의미(미루지 않는다)를 지키면서 방해를 줄인다. 강도를 저장하지 않으므로 presence 변화로 레코드를 바꿀 일이 없다.
- 기각한 대안: 권리 게이트를 모두 끼어들기로 — 사람 부재·방해 금지 때 쌓이고, 막지 않는 질문까지 방해한다. 권리 게이트도 협상 — "미루지 않는다"가 약해진다. 강도를 레코드 필드로 — presence가 바뀔 때마다 갱신 이벤트가 필요하다.
- 결과: 05·20이 강도별 표시를 정한다. 09 `question.delivered` payload에 강도가 들어간다.

### ADR-A2 거짓인 첫 조건이 처리 방식을 정한다

- 상태: 제안
- 맥락: 원전 Gate rule은 세 조건 AND로 묻는다. 대화 L3384는 거짓일 때 정책·혼자 정하기·나중에 묻기의 세 처리를 말했다. v0.3 06은 "결정 1은 낮은 문턱"이다.
- 결정: 조건 1 거짓 → 정책대로(자동 검증 포함), 조건 2 거짓 → 혼자 정하고 기록, 조건 3 거짓 → 질문을 기록하고 묶어서 나중에 전달하며 임시 가정으로 진행.
- 근거: 결과 차이가 없는 결정은 질문으로 남기지 않아 승인 극장을 막고, 가치는 있지만 지금 물을 만큼은 아닌 결정은 기록해 사람이 돌아왔을 때 볼 수 있다.
- 기각한 대안: 하나라도 거짓이면 모두 혼자 정하기 — "불확실하면 기록"과 어긋난다. 모두 질문으로 기록 — 질문함이 잡음으로 찬다.
- 결과: 판정 기록(`askEvaluation`)이 질문에, 거짓 조건이 선택의 `whyNotAsked`에 남는다.

### ADR-A3 이의가 걸린 결정점은 질문으로만 다시 정한다

- 상태: 제안
- 맥락: 이의를 건 뒤 에이전트가 같은 결정을 다시 자율로 내리면 불변조건 7이 형식만 남는다.
- 결정: 이의가 걸린 `decisionPointKey`의 재결정은 정보 게이트 판정을 건너뛰고 질문을 강제한다(V-AUT-02). 같은 답이면 이의 dismissed, 다른 답이면 새 선택이 원래 선택을 대체하고 이의 upheld.
- 근거: 사람의 이의가 실제로 결과를 바꿀 기회를 보장한다.
- 기각한 대안: 에이전트가 다른 결정을 내리면 허용 — 사람이 원한 방향인지 알 수 없다.
- 결과: 이의 한 번이 질문 한 번을 만든다(사람이 시작한 조작이므로 상한 예외).

### ADR-A4 권리 게이트 승인은 인자 지문 1회, 별도 토큰 레코드 없이

- 상태: 제안 (1판의 토큰 레코드를 바꿈)
- 맥락: 사람이 허락한 발송과 실제 실행 인자가 달라질 수 있다. Mastra는 승인을 인자 지문에 묶고 한 번 쓰면 소진하는 예시를 둔다. 08은 질문에 `approvalFingerprint`·`consumedByToolCallId`, 도구 호출에 `awaiting_approval → approved` 전이를 두었다.
- 결정: 승인은 질문 답과 도구 호출 상태로 표현한다. 같은 호출을 재개할 때 지문을 대조하고 질문의 소진 필드를 채운다. 사람이 인자를 고쳐 허락하면 원래 호출을 거절하고 고친 인자의 새 호출을 한 번 허락한다.
- 근거: "허락한 그것만 한 번" 실행. 레코드 종류를 늘리지 않고 08 상태 기계를 그대로 쓴다. 승인 계획이 도구 호출 레코드에 있어 재시작 뒤에도 남는다.
- 기각한 대안: 별도 승인 토큰 레코드(1판) — 같은 사실을 두 곳에 둔다. 질문 단위 승인 — 인자 변경을 막지 못한다. 시간 창 승인 — 범위가 넓다.
- 결과: 13과 지문 정규화 함수를 공유한다. 08에 "소진한 호출이 대상 호출과 다를 수 있다"를 요구한다.

### ADR-A5 C·A 단계의 정보 질문은 결과 확인과 묶는다

- 상태: 제안
- 맥락: 사람 조작 2회 상한(대화 X3-2-19)과 C/A를 가장 많이 건너뛴다는 진술.
- 결정: WorkUnit의 정상 경로 사람 조작 예산이 남지 않으면 C·A 루프의 정보 게이트 질문은 결과 확인과 같은 묶음으로 놓이고 한 번에 답한다. 권리 게이트는 예외.
- 근거: 사람에게 요구하는 조작 수를 늘리지 않고 질문을 버리지도 않는다.
- 기각한 대안: 상한을 넘는 질문을 막음 — 정보를 잃는다. 상한 없음 — 우회 습관(X3-2-18).
- 결과: 결과 확인 화면에 묶인 질문 영역이 생긴다(04).

### ADR-A6 임시 가정은 질문에서 나온 전제다

- 상태: 제안 (1판의 `wa` 레코드를 바꿈)
- 맥락: 1판은 임시 가정을 전제와 다른 레코드로 두었다. 08은 전제(`as`)에 `origin.kind = 'question'`을 두고 비막힘 질문과 같은 트랜잭션에서 만들게 했다.
- 결정: 임시 가정 = 질문 전제. 답 비교 결과는 전제 상태(confirmed·invalidated·retired)로 남고, 답이 다르면 08의 낡음 전파가 그대로 영향을 퍼뜨린다. 비교용 답 값(`assumptionAnswer`)만 질문에 더한다.
- 근거: 같은 낡음 전파·영향 계산을 쓴다. "지금 어떤 가정으로 일하는가"를 전제 목록 하나로 본다.
- 기각한 대안: 별도 레코드 — 낡음 전파 경로가 둘이 된다. 가정값으로 선택을 먼저 만듦 — 08 R-25(가정 확정 때 선택)와 맞지 않고, 답이 오면 선택이 둘 생긴다.
- 결과: 15는 전제를 따로 기록하지 않는다. 영향 계산은 `toolcall.started`의 전제 목록을 쓴다.

### ADR-A7 presence는 이벤트가 아니다

- 상태: 제안 (1판 A-5를 바꿈)
- 맥락: 1판은 재생과 결정성을 위해 presence를 이벤트로 남기자고 했다. 19는 `presence.report`를 휘발 알림으로 정했고, 10은 `ctx.presence`로 받는다.
- 결정: presence는 데몬의 운영 상태이고 커널에는 `ctx.presence`로 들어간다. 전달 결정의 결과만 이벤트(`question.delivery_planned`, `question.escalated`, `question.delivered`)로 남는다. 복귀는 14 경계 `user_return`(`boundary.reached`)로 이벤트가 된다.
- 근거: 재생은 결정의 결과만 필요하다. 상태 변화마다 이벤트를 남기면 로그가 늘고 사람의 활동 기록이 기준 원본에 쌓인다.
- 기각한 대안: presence 전이를 이벤트로 — 로그가 늘고 개인 활동 기록이 기준 원본에 쌓인다. presence를 아예 쓰지 않음 — 부재 중 끼어들기를 막지 못한다.
- 결과: 16의 활동 시간 지표는 운영 기록(19)에서 만든다.
