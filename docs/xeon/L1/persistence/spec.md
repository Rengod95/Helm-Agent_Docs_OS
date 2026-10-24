---
id: L1.persistence.spec
layer: L1
domain: persistence
kind: spec
status: draft
depends_on: [F.records.spec, F.conversation.spec, F.extensions.spec, F.wire-settings.spec, eng.transactions.design, eng.events.design, eng.context-map.design, architecture.runtime-flow.design, adr.0004, adr.0006]
binds: [xeon/packages/core-persistence/**]
---

# L1 영속성과 복구 (persistence)

서비스: `xeon.session`(`SessionService`). 패키지: `@xeon/core-persistence`(`xeon/packages/core-persistence`). 컨텍스트: `session-core`(`eng.context-map.design` §4.1). 하위 층 id: L1-f(`_research/layer-plan-v2.json` L1-f "영속성과 복구").

## 1. 목적과 범위

### 1.1 정하는 것

- Cordis 서비스 `xeon.session` 하나의 API(`SessionService`)와 `core-persistence` 내부 구조
- 세션 쓰기의 단일 커밋 경로(`SessionService.commit`, 내부 구현 `SessionWriter`)와 F `SessionStore`(2차)와의 대응
- 소유 테이블(`events`, `requests`, `step_checkpoints`, `projector_state`, `consumer_cursors`, `p_*` 등)의 DDL과 의미
- 코어 투영기 `core`, 확장 투영기의 같은 커밋 참여(`ProjectionTx` 소유 검사), 투영 재생성과 불일치 검출
- 원자 커밋, 멱등(`requests` + 지문), 커밋 뒤 방출, 장애 주입 지점
- 결과 불명 효과의 판정 호출, 합성 결과 저장, 재실행 횟수 상한
- 열 때 복구와 재개 절차(복구 표식, 체크포인트, 열린 효과, 승인 대기, 입력 큐), 잠금 실패 때의 동작
- 분기와 수명주기 API(`thread.list/create/open/close/delete/fork/revert`의 L1 몫), 제목 변경
- 세션 범위 설정 값의 기록, `l1.persistence.*` 설정 키
- 확장 지점 7개(`session_start`, `session_info_changed`, `session_before_switch`, `session_before_fork`, `session_before_tree`, `session_tree`, `session_shutdown`)의 발화 시점
- 2차: 리플레이 커서, 되감기(파일 스냅샷 복원), JSONL 내보내기

### 1.2 다루지 않는 것

| 대상 | 소유 문서 |
|---|---|
| 레코드 형태(envelope, kind 카탈로그, `BlobRef`, `StepCheckpoint`, 효과 3단, `decideEffectRecovery`, 업캐스터 계약) | `F.records.spec` |
| DB 파일 위치, 연결, PRAGMA, WAL, `BEGIN IMMEDIATE` 래퍼 `StoreDb`, blob 파일 쓰기·읽기·GC 실행, `sys_*` 테이블, `StoreId` | `L0.store.spec` |
| 세션 id 키 OS 잠금의 구현(flock 등), 프로세스 사망 시 해제 | `L0.process.spec` |
| 루프 상태 리듀서(`reduceLoopState`), 커밋 지점의 내용, 진행 중 스트림 처리 | `L1.loop.spec` |
| 입력 큐 선택 규칙, 취소 전파, `isCancelledByOwner` | `L1.tasks.spec` |
| 효과 3단 기록 시점, 재실행 실행(`ToolService.rerun`), 승인 프로토콜과 `ApprovalService.restore` | `L1.tools.spec` |
| 컨텍스트 조립, `thread.compacted` 해석, 떠난 가지 요약 생성 | `L1.context.spec` |
| wire 메서드 처리기, 재전송 알고리즘 실행, 설정 파일 위치·감시 | `L4.host-service.spec`, `F.wire-settings.spec` |
| 확장 접두 테이블 정의 API(`defineTables`, `ExtWriters`), 소유 장부 `xh_ext_tables` | `X.operations.spec` |

### 1.3 근거

- [결정] 세션 저장은 C안이다. SQLite 이벤트 소싱과 투영, DB 하나, 확장 접두사 테이블이다(`_research/decisions-log.md` 2026-10-21 결정 2차, adr.0004 §3.1).
- [결정] 단계 경계 커밋은 `synchronous=FULL`이다(adr.0004 §3.2 5번, `_research/foundation-plan.md` §2 DB 행).
- [결정] 쓰기 소유자는 세션마다 하나이고 세션 id 키 OS 잠금으로 판정한다. 잠금을 얻지 못하면 위임·관찰·분기 중 하나로 동작한다(adr.0006 §3.6 1~3번).
- [결정: review.decisions-2 U-09] 커밋 트랜잭션 안의 소유 확인(펜싱)은 L0.store 임대 행 `sys_leases`의 epoch로 한다(`L0.store.spec` §3.1 `LeaseService.holds`, `eng.transactions.design` TX-10). OS 잠금은 생존 판정과 빠른 인수에 쓰고, 트랜잭션 안에서 확인할 수 없으므로 펜싱에는 쓰지 않는다. 별도 소유 테이블은 두지 않고 `sys_leases` 행이 소유 표시를 겸한다. adr.0004 §3.4와 adr.0006을 이에 맞게 개정한다.
- [결정] 결과 없는 의도는 저장된 정책과 현재 선언이 모두 `safe`일 때만 다시 실행한다(adr.0004 §3.2 3번, adr.0006 §3.6 6번).
- [결정] 코드 포크 없이 자체 구현한다. pi durable은 설계 근거로만 인용한다(`_research/foundation-plan.md` §1 결정 1, adr.0003).
- 줄 범위 근거(durable `~/projects/_ref/pi-src/packages/durable/docs/spec.md`, `_research/durable-and-search-facts.md` A-6): 결과 불명 1917-1927·2082-2108, requestId 2288-2301, 재생 3136-3170(3162-3163), 승인 대기 1898-1915, 소유 트리 1972-2200, 훅 표 2636-2660.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 커밋 | `SessionService.commit` 한 번. SQL 트랜잭션 하나다 |
| 커밋 키 | `requests` 테이블의 키. 이 문서는 eng 문서를 따라 필드 이름을 `requestId`로 둔다. F payload의 `requestId`(브랜드 없는 1~64자, `F.conversation.spec` §3.5)와 값이 다를 수 있다 |
| 지문 | `sha256Hex(canonicalJson(fingerprintSource))`. 같은 커밋 키의 재시도인지 판정한다(`eng.transactions.design` §4.7) |
| 단계 경계 커밋 | `step.completed`와 `checkpoint.step`을 담은 커밋 |
| 효과 커밋 | 도구 호출 하나의 `effect.intent`, `effect.exec`, `effect.result` 각각의 커밋 |
| 열린 효과 | `effect.intent`가 있고 `effect.result`가 없는 효과 |
| 복구 표식 | thread의 `running_since`(열린 turn의 시작 시각)와 `resume_attempts`(재개 시도 수). 투영 `p_threads`의 열이다 |
| 쓰기 소유 | 한 thread에 커밋할 수 있는 권한. 프로세스 하나가 가진다 |
| 관찰 열기 | 쓰기 소유 없이 읽기 전용으로 여는 일 |
| 투영기 | 내구 이벤트를 받아 자기 소유 테이블을 갱신하는 순수 함수 묶음(`Projector`) |
| 활성 가지 | leaf에서 `parentId`를 따라 루트까지 올라간 사슬(`F.records.spec` §4.6) |
| 후보 | 복구 표식이 남은 thread. "이어서 실행" 후보로 보여 준다(adr.0006 §3.6 5번) |

### 2.1 이름 대응표 (eng → F)

[결정] 이름의 정본은 F 문서다(`F.records.spec` §3.1.2). 이 문서는 F 이름만 쓰고, eng 문서의 이름은 아래 표로 읽는다. eng 문서 수정은 §8.4 요청으로 남긴다.

| eng 문서 이름 | F 이름 | 비고 |
|---|---|---|
| envelope `type`, `typeVersion`, `sessionId`, `producer`, `requestId` | `kind`, `version`, `threadId`, (없음), (없음) | 커밋 키는 envelope 밖 `events.request_id` 열에 둔다 |
| `SessionId`, `ss_` | `ThreadId`, `thr_` | `requests`의 키도 `(thread_id, request_id)` |
| `pos`(DB 전역 열) | `seq` | F `seq`가 DB 전역 단조다(`F.records.spec` §4.1). 별도 `pos`를 두지 않는다 |
| `session.created` | `thread.started` | 포크 출처는 `forkedFrom` |
| `session.retitled` | `thread.updated { title }` | |
| `session.rewound { toEventId }` | `thread.leaf_moved { leafEventId, reason: "rewind" }` | |
| `session.closed` | `thread.closed` | |
| `session.head`(휘발) | 없음 | head는 wire `events.subscribe` 결과의 `headSeq`로 안다 |
| `message.recorded` | `item.recorded` + `part.recorded` | 한 커밋(`F.records.spec` §4.2 3번) |
| `compaction.recorded` | `thread.compacted` | |
| `tool.intended` | `effect.intent` | |
| `tool.replay_started { attempt }` | `effect.exec`(재실행마다 한 건 더) | §4.7.3 |
| `tool.settled` | `effect.result` | `outcome_uncertain` → `status: "interrupted", synthesized: true`. `not_executed` → `status: "abandoned"` |
| `turn.ended` | `turn.completed` | |
| `turn.abort_requested` | `turn.abort_requested` | F 카탈로그에 있다(`L1.tasks.spec` FR-T2 반영) |
| `input.queued/placed/withdrawn` | 같은 이름 | F 카탈로그에 있다(`L1.tasks.spec` FR-T1 반영) |
| `approval.requested/resolved` | 같은 이름 | F 카탈로그에 있다(`L1.tools.spec` §8.3 요청 3 반영) |
| `agent.spawned/settled/judged` | 같은 이름 | F 카탈로그에 있다(`L1.agents.spec` §3.5, §8.3 요청 3 반영) |
| `scope.toggled` | `scope.changed` | |
| `drive.leased/released` | `lease.acquired/released` | |
| 확장 상태 기록(옛 확장 접두 표기) | `x.<name>.state.committed`, `grp.<name>.state.committed` | `X.primitives.spec` §4.6.1. 확장 kind 표기는 `x.`·`grp.`만 쓴다(review.decisions-2 T-21) |
| `message.text_delta`, `tool.args_delta`, `tool.output_delta` | `item.updated`(휘발) | `F.records.spec` §3.3 |
| `turn.progress` | `turn.updated`, `step.updated`(휘발) | |
| `tool.settled.status` 6값 | `EffectStatus` 4값 + `synthesized` | `F.records.spec` §3.5 |
| `decideRecovery`, `OpenIntent`, `RecoveryDecision` | `decideEffectRecovery`, `EffectRecovery` | 재실행 상한은 이 문서 §3.7 |
| `outcome_uncertain` 합성 문장(eng §5.3) | `OUTCOME_UNKNOWN_TEXT`, `NOT_STARTED_TEXT` | F 문장을 쓴다 |
| `StepCheckpointDraft { state }` | `StepCheckpoint`(이벤트 `checkpoint.step`) | 체크포인트는 이벤트이고 `step_checkpoints`는 그 투영이다 |
| `LeaseToken`, `lease_lost`, `sys_leases` | `LeaseToken`(`L0.store.spec` §3.1, resource `session:<threadId>`), `ownership_lost` | 소유 판정은 OS 잠금(생존) + `sys_leases.epoch` 펜싱(TX-10) [결정: review.decisions-2 U-09] |
| `p_sessions`, `p_messages`, `p_tool_calls` | `p_threads`, `p_items`, `p_effects` | §3.10 |

## 3. 인터페이스

스키마 선언 형식은 `F.conversation.spec` §3 머리말, 예상 실패는 `Result<T, E>`(`eng.typescript.guide` TY-11)를 따른다. 코드 블록의 파일 경로가 `contracts/src/records/`인 타입은 F에 둘 것을 요청하는 타입이다(§8.3 FR-P1). F가 받아들일 때까지 이 절이 이름의 후보 정본이다 [제안].

### 3.1 커밋 API 정리: F `SessionStore`와 eng `SessionWriter`

두 문서의 커밋 API가 다르다. 아래 표의 마지막 열이 이 문서의 정리안이다.

| 항목 | `F.records.spec` §3.8 | `eng.transactions.design` §4.2 | 이 문서의 정리 [제안] |
|---|---|---|---|
| 이름 | `SessionStore.appendBatch` | `SessionWriter.commit` | 공개: `SessionService.commit`. 내부 구현 클래스: `SessionWriter` |
| 동기성 | 비동기 `Promise<AppendResult>` | 동기 `Result<CommitResult, StoreError>` | 동기. bun:sqlite 트랜잭션 콜백은 동기여야 한다(TX-01) |
| 입력 | `AppendBatch { threadId, events, checkpoint?, durability, expectedLeaf? }` | `CommitRequest { requestId, fingerprintSource, build(TxView) }` | `CommitRequest { threadId, requestId, fingerprintSource, build, expectedLeaf? }`. `build`가 `CommitPlan { drafts, checkpoint }`을 돌려준다 |
| 초안 | `DurableEventDraft` | `StampedDraft`(producer 낙인) | `StampedDraft = { draft: DurableEventDraft, producer }`. envelope에는 producer를 넣지 않는다 |
| 체크포인트 | `StepCheckpoint` 통째 | `StepCheckpointDraft { state }` | `StepCheckpointInput`(F 레코드에서 저장소가 채우는 네 필드를 뺀 것). `checkpoint.step` 이벤트로 기록 |
| 멱등 키 | 없음(§3.1.1 "필요하면 저장소 API에") | `requestId` 필수 | 필수. `AppendBatch`에도 `requestId` 추가를 요청한다(FR-P2) |
| 결과 | `{ firstSeq, lastSeq, leaf }` | `committed / rejected / key_reused`, `replayed` | eng 모양 + `leaf`, `eventIds` |
| 실패 | `AppendError`(conflict, event_too_large, invalid_payload, storage) | `StoreError` + `StoreBugCode` | 예상 실패는 `StoreError`, 결함은 `Bug(StoreBugCode)`. `conflict`는 `rejected("leaf_conflict")` |
| 읽기 | `readFrom`, `readBranch`, `loadCheckpoint`, `subscribe` | `SessionFeed.readEvents`, `subscribe(onDurable, onVolatile)` | F 이름을 쓴다. 호스트용 동기 읽기 `feed`를 더한다 |
| 내구 | `durability: "step" \| "normal"` | 쓰기 연결 항상 FULL | 항상 FULL. 필드는 두지 않는다(§4.3) |
| 단계 | 2차 | M0 | 공개 `commit`은 M1. `SessionStore` 어댑터는 2차 |

나누는 방식 [제안]:

1. L1 내부 커밋 경로: `core-persistence/src/writer.ts`의 `SessionWriter` 하나다. 테이블에 쓰는 코드는 이 클래스뿐이다(TX-07, CM-02). 다른 컨텍스트는 L0 `StoreDb.write`를 받지 못한다.
2. 외부 공개 포트: Cordis 서비스 `xeon.session`의 `SessionService`다. `commit`은 `SessionWriter.commit`을 그대로 노출한다. L1 동료(`core-loop`, `core-tasks`, `core-tools`, `core-context`, `core-agents`)와 X는 이 포트로 쓴다. 이미 `L1.tasks.spec` §8, `L1.tools.spec` §8.2가 `SessionService.commit(CommitRequest)`를 요구한다.
3. F `SessionStore`(2차): 저장소 교체용 어댑터 포트로 둔다. SQLite 구현은 `SessionService` 위의 얇은 어댑터다. `appendBatch(batch)`는 `commit({ requestId: batch.requestId, fingerprintSource: batch, build: (v) => leafCheck(v, batch.expectedLeaf) ?? { kind: "append", drafts: stamp(batch.events), checkpoint: batch.checkpoint } })`다. 어댑터 적합성 스위트(`F.records.spec` §3.8)는 이 어댑터와 `SessionService` 둘 다에 돌린다.
4. 이름 정본은 F다. 그래서 위 타입들을 F `records`로 옮기는 요청(FR-P1)과 `AppendBatch.requestId` 추가 요청(FR-P2)을 함께 올린다.

### 3.2 커밋 타입

```ts
// xeon/packages/contracts/src/records/commit.ts  [제안: FR-P1]
import type { JsonValue, Result } from "../base/index.ts";
import type { EffectId, EventId, ItemId, StepId, ThreadId, TurnId } from "../conversation/ids.ts";
import type { ThreadStatus, TurnStatus } from "../conversation/hierarchy.ts";
import type { DurableEventDraft, DurableEventEnvelope } from "./envelope.ts";
import type { EventKind } from "./kinds.ts";
import type { DetachedField } from "./blob.ts";
import type { EffectStatus, ReplayPolicy } from "./effects.ts";
import type { StepCheckpoint } from "./checkpoint.ts";

/** 커밋 키. 예: "tool:<toolCallId>:result", "in:user:<requestId>". 1~200자 */
export type CommitKey = string;
/** 인용. 형식 정본은 eng.transactions.design §4.7(review.decisions-2 U-13), 코드 상수는 F.records.spec §3.9 */
export const COMMIT_KEY_PATTERN: string = "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$";

/** 생산자 id. eng.context-map.design §5.1 형식 */
export type ProducerId =
  | "core.persistence" | "core.tasks" | "core.loop" | "core.context" | "core.tools" | "core.agents" | "core.models"
  | "xh" | `ext.${string}`;

declare const stampedBrand: unique symbol;

/** ProducerHandle이 kind 소유 검사를 마친 초안 */
export interface StampedDraft {
  readonly draft: DurableEventDraft;
  readonly producer: ProducerId;
  readonly [stampedBrand]: true;
}

export type DraftInput = Omit<DurableEventDraft, "durable" | "version"> & {
  /** 생략하면 카탈로그의 현재 버전 */
  readonly version?: number;
};

export interface ProducerHandle {
  readonly producer: ProducerId;
  /** 소유하지 않은 kind면 Bug("store.prefix_not_owned")를 던진다. 동기, 순수 */
  draft(input: DraftInput): StampedDraft;
}

/** StepCheckpoint에서 저장소가 채우는 필드(checkpointId, schemaVersion, threadId, leafEventId)를 뺀 것 */
export type StepCheckpointInput = Omit<StepCheckpoint, "checkpointId" | "schemaVersion" | "threadId" | "leafEventId">;

export type CommitPlan =
  | {
      readonly kind: "append";
      readonly drafts: readonly StampedDraft[];
      /** 있으면 drafts 끝에 checkpoint.step 이벤트를 더한다. drafts에 step.completed가 있어야 한다 */
      readonly checkpoint: StepCheckpointInput | null;
    }
  | { readonly kind: "reject"; readonly code: string; readonly detail: string | null }
  /** build가 읽기에 실패해(예: core-tasks의 입력 이벤트 읽기) 계획을 세울 수 없다. 롤백하고 requests에 남기지 않는다. commit은 err(error)를 돌려준다 */
  | { readonly kind: "abort"; readonly error: ReadFailure };

export interface CommitRequest {
  /** 커밋 키의 범위가 되는 thread. drafts는 이 thread 또는 같은 프로세스가 쓰기 소유한 thread만 가리킨다 */
  readonly threadId: ThreadId;
  readonly requestId: CommitKey;
  /** 지문 원천. 생성 id, 시각, 시도 번호, 연결 id를 넣지 않는다(eng.transactions.design §4.7) */
  readonly fingerprintSource: JsonValue;
  /** 동기, 순수. 트랜잭션 안에서 한 번 부른다 */
  readonly build: (view: TxView) => CommitPlan;
  /** 있으면 build 전에 view.leaf와 비교한다. 다르면 rejected("leaf_conflict") */
  readonly expectedLeaf?: EventId | null;
}

export type CommitResult =
  | {
      readonly status: "committed";
      readonly firstSeq: number;
      readonly lastSeq: number;
      /** 이 커밋 뒤 threadId의 leaf */
      readonly leaf: EventId | null;
      /** 커밋한 이벤트 id, seq 순서. 재시도한 호출자가 처음 id를 다시 얻는다(예: approvalId) */
      readonly eventIds: readonly EventId[];
      readonly replayed: boolean;
    }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string | null; readonly replayed: boolean }
  | { readonly status: "key_reused"; readonly requestId: CommitKey };

/** 예상 가능한 실패. 판별 필드는 kind */
export type StoreError =
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string }                           // 저장 매체 I/O 실패. code는 OS·SQLite 코드(손상은 SQLITE_CORRUPT*)
  | { readonly kind: "ownership_lost"; readonly threadId: ThreadId }
  | { readonly kind: "read_only"; readonly reason: ReadOnlyReason }
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  | { readonly kind: "row_invalid"; readonly where: string };               // 저장된 행이 스키마와 다르다(손상, 수동 편집, 이전 버전)

/** 읽기 API가 돌려주는 실패 */
export type ReadFailure = Extract<StoreError, { readonly kind: "busy" | "io" | "row_invalid" }>;

export type ReadOnlyReason = "observer" | "unknown_event_kind" | "newer_event_version" | "core_projection_stale";

/** 결함. Bug의 메시지 앞머리 코드. 트랜잭션은 롤백되고 호출자가 처리할 대상이 아니다 */
export type StoreBugCode =
  | "store.nested_write"
  | "store.prefix_not_owned"
  | "store.producer_claimed"
  | "store.schema_invalid"
  | "store.kind_unregistered"
  | "store.event_too_large"
  | "store.checkpoint_without_step"
  | "store.projection_failed"
  | "store.replay_diverged";
```

`TxView`는 `build`가 읽는 트랜잭션 안 보기다. `build` 호출 시점에 커밋된 상태를 보여 준다. 메서드는 투영 테이블을 같은 트랜잭션에서 읽는다.

손상된 행(row_invalid) 처리 [제안, eng.typescript.guide TY-24]: `build`는 동기·순수 콜백이라 `TxView` 메서드는 값을 바로 돌려준다. 읽은 행이 스키마와 다르면 트랜잭션을 롤백하고 `commit`이 `err({ kind: "row_invalid", where })`를 돌려준다. 그 요청 키에는 결과가 남지 않는다. `build`가 다른 읽기(예: 입력 이벤트 읽기)에서 실패하면 `{ kind: "abort", error }`를 돌려줘 같은 경로를 탄다. 투영 읽기 도우미(`readThread` 등)는 안쪽에서 `Result<_, row_invalid>`로 돌려주고 `Bug`를 던지지 않는다.

```ts
// xeon/packages/contracts/src/records/commit.ts (계속)
export interface TurnView {
  readonly turnId: TurnId;
  readonly status: TurnStatus;
  readonly abortRequested: boolean;
  readonly stepCount: number;
}
export interface EffectView {
  readonly effectId: EffectId;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly replay: ReplayPolicy;
  /** effect.exec 건수. 첫 실행 1, 재실행마다 1 증가 */
  readonly execCount: number;
  readonly result: { readonly status: EffectStatus; readonly synthesized: boolean } | null;
}
export interface InputView {
  readonly inputId: EventId;
  readonly seq: number;
  readonly mode: "steer" | "followUp" | "next" | "aside";
  readonly state: "queued" | "placed" | "withdrawn";
  readonly sourceKey: string;
  readonly requestId: string;
}
export interface ApprovalView {
  readonly approvalId: EventId;
  readonly threadId: ThreadId;
  readonly toolCallId: string | null;
  readonly resolved: boolean;
}
/** 자식 thread 연결(L1.agents.spec §3.5). 투영 p_agents */
export interface AgentView {
  readonly childThreadId: ThreadId;
  readonly parentThreadId: ThreadId;
  /** 자식 requestId(L1.agents.spec §4.5) */
  readonly requestId: string;
  readonly ownerTurnId: TurnId | null;
  readonly background: boolean;
  readonly depth: number;
  /** agent.settled가 있으면 그 상태와 이벤트 id */
  readonly settled: { readonly status: "completed" | "aborted" | "error"; readonly eventId: EventId } | null;
}

export interface TxView {
  readonly threadId: ThreadId;
  /** DB 전역 head seq */
  readonly headSeq: number;
  readonly leaf: EventId | null;
  readonly threadStatus: ThreadStatus | "absent";
  turn(turnId: TurnId): TurnView | undefined;
  turnAbortRequested(turnId: TurnId): boolean;
  effect(effectId: EffectId): EffectView | undefined;
  effectByToolCall(threadId: ThreadId, toolCallId: string): EffectView | undefined;
  /** drive turn·자식 turn 멱등 조회(L1.loop.spec §4.8, §4.13). scopeId가 null이면 scope 없는 turn. 투영 p_turns (thread_id, scope_id, request_id) */
  turnByRequestId(threadId: ThreadId, scopeId: string | null, requestId: string): TurnView | undefined;
  /** drive turn 펜싱(L1.loop.spec §4.8). p_scopes.lease_epoch. 임대가 없었으면 0 */
  scopeLeaseEpoch(threadId: ThreadId, scopeId: string): number;
  /** L1.tasks.spec §4.7 */
  inputByRequestId(threadId: ThreadId, sourceKey: string, requestId: string): InputView | undefined;
  queuedInputs(threadId: ThreadId): readonly InputView[];
  approval(approvalId: EventId): ApprovalView | undefined;
  /** L1.agents.spec §4.5 멱등 조회. 부모 대화의 agent.spawned 중 같은 requestId */
  agentByRequestId(parentThreadId: ThreadId, requestId: string): AgentView | undefined;
  /** X.primitives.spec §4.6.1 expectStateRev 검사용. 없으면 0 */
  scopeStateRev(threadId: ThreadId, scopeId: string): number;
  lastCheckpoint(threadId: ThreadId): StepCheckpoint | null;
}
```

장애 주입 타입은 `eng.transactions.design` §4.2의 `FaultPoint`(10종)와 `FaultInjector`를 그대로 쓴다. 운영 빌드의 주입기는 아무것도 하지 않는다.

### 3.3 `SessionService`

```ts
// xeon/packages/contracts/src/records/session-service.ts  [제안: FR-P1]
import type { Unsubscribe } from "../extensions/index.ts";   // 위치는 F.extensions.spec §3.2
import type { ItemId, ThreadId, TurnId, EventId } from "../conversation/ids.ts";
import type { DurableEventEnvelope, VolatileEventEnvelope } from "./envelope.ts";
import type { StepCheckpoint } from "./checkpoint.ts";

export const SessionServiceName = "xeon.session" as const;

export interface SessionService {
  // ── 쓰기 (§3.2, §4.1)
  commit(request: CommitRequest): Result<CommitResult, StoreError>;
  /** 플러그인 setup 중 한 번만 받는다. 같은 producer를 두 번 받으면 Bug("store.producer_claimed") */
  producer(id: ProducerId): ProducerHandle;

  // ── 투영 (§3.4)
  readonly projectors: ProjectorRegistry;
  readonly query: ProjectionQuery;

  // ── 읽기와 구독 (F.records.spec §3.8 이름, §3.5)
  /** afterSeq보다 큰 seq를 오름차순으로. threadId를 주면 그 thread만 */
  // 읽기 연결의 busy·io와 손상 행(row_invalid)은 예상 가능한 실패라 값으로 돌려준다(eng.typescript.guide TY-24).
  // 스트림은 실패를 마지막 원소(err)로 알리고 닫는다. 호출자는 원소의 ok를 보고 멈춘다
  readFrom(afterSeq: number, options?: { readonly threadId?: ThreadId; readonly limit?: number }): AsyncIterable<Result<DurableEventEnvelope, ReadFailure>>;
  /** leaf(생략하면 현재 leaf)에서 parentId를 따라 올라가 루트→leaf 순서로 */
  readBranch(threadId: ThreadId, leaf?: EventId): AsyncIterable<Result<DurableEventEnvelope, ReadFailure>>;
  loadCheckpoint(threadId: ThreadId): Promise<Result<StepCheckpoint | null, ReadFailure>>;
  /** afterSeq 이후 내구 이벤트를 커밋 순서로. 따라잡기와 실시간을 같은 동기 구간에서 잇는다. 따라잡기 읽기가 실패하면 등록하지 않고 err */
  subscribe(afterSeq: number, listener: CommitListener, filter?: FeedFilter): Result<Unsubscribe, ReadFailure>;
  /** 호스트 재전송용 동기 읽기(L4.host-service.spec EventFeedPort와 같은 모양) */
  readonly feed: EventFeed;
  /** detached 필드를 blob에서 되돌린 사본(§4.11) */
  hydrate(event: DurableEventEnvelope): Promise<DurableEventEnvelope>;
  /** 휘발 이벤트 전달. 저장하지 않는다. n·afterSeq는 발신자가 채운다(F.records.spec §4.3) */
  emitVolatile(event: VolatileEventEnvelope): void;

  // ── 열기, 소유, 재개 (§3.6, §3.7, §4.8)
  openForWrite(threadId: ThreadId, token: LeaseToken): Result<OpenReport, OpenError>;
  openForRead(threadId: ThreadId): Result<OpenReport, OpenError>;
  /** 열 때 복구. 합성 결과를 커밋하고 남은 일을 계획으로 돌려준다. 실행은 하지 않는다 */
  recover(threadId: ThreadId, deps: RecoverDeps): Result<ResumePlan, StoreError>;
  /** 실제로 이어서 실행할 때 부른다. thread.resumed를 커밋하고 resume_attempts를 올린다 */
  beginResume(threadId: ThreadId, mode: "manual" | "auto"): Result<{ readonly attempt: number }, ResumeError>;
  release(threadId: ThreadId, reason: SessionShutdownReason): Promise<void>;

  // ── 수명주기와 분기 (§3.8)
  readonly threads: ThreadLifecycle;

  // ── 세션 범위 설정 (§6.2)
  readonly sessionSettings: SessionSettingsStore;

  // ── X 포트 (X.primitives.spec §3.6 RecordCommitPort와 같은 모양)
  readonly ext: RecordCommitPort;
}
```

- [결정: review.decisions-2 D-04] `ext`를 하위 객체로 두는 이유: X `RecordCommitPort.commit(ExtCommitRequest): Promise<ExtCommitResult>`와 `SessionService.commit(CommitRequest)`의 이름이 겹친다. 같은 서비스 객체가 두 모양을 함께 만족할 수 없다. X는 `xeon.session`에서 `ext`를 `PortKey.member`로 꺼내 쓴다(`F.extensions.spec` §3.2.1 `RecordCommitPortKey`). `F.records.spec` §3.9도 `SessionService`의 `ext` 속성이 `RecordCommitPort`라고 정했다. `RecordCommitPort` 타입은 F `F.records.spec` §3.9 `session-service.ts`에 있고 `F.extensions.spec` §3.2.1이 다시 export한다.
- `ext.commit`은 `ExtCommitRequest.drafts`를 `ext.<name>` 또는 `xh` 생산자로 낙인한 뒤 `commit`을 부른다. `expectStateRev`는 `build` 안에서 `view.scopeStateRev`와 비교해 다르면 `rejected("state_conflict")`이고 X 쪽 결과는 `{ status: "rejected", code: "state_conflict" }`다. `ownership_lost`는 `code: "lease_lost"`로 바꾼다(X 이름 유지).
- `ext.loadThread`는 X 소유 투영 `x_<name의 '-'를 '_'로>_state`를 읽지 않는다. 켜진 scope, 끈 scope(`disabled`), scope 전이 횟수(`scopeTransitions`), 켜진 scope의 마지막 켜짐 seq(`enabledAtSeq`), 열린 임대, 임대 차수, 상태 판을 모두 활성 가지(현재 leaf에서 `parentId`를 따라 올라간 사슬) 위 이벤트로 계산한다(`X.primitives.spec` §4.6.1 활성 가지 규칙). 상태 판은 `x|grp.<name>.state.committed` 이벤트를 `query.latestEvent(…, { onActiveBranch: true })`로 찾는다 [제안]. 이벤트 순서로 갱신되는 투영(`p_scopes` 같은 것)은 버려진 가지의 값을 담을 수 있어 두지 않는다(§3.10). X 소유 테이블을 core-persistence가 읽지 않기 위해서다(CM-02). 구현은 `ext-queries.ts`다: 활성 가지 사슬을 한 번 훑어 `scope.changed`, `lease.*`, `*.state.committed`를 seq 순으로 접는다. 열린 임대의 `used`는 임대를 받은 뒤 같은 scope가 시작한 turn 수(`turn.started.scopeId`), 그 임대가 소유한 drive spawn 수(`agent.spawned.owner.leaseId`), 그 turn의 `turn.completed.usage.totalTokens`와 그 spawn의 `agent.settled.usage.totalTokens` 합이다.
- 확장 kind 등록 [결정: L1B.1]. `EventKindRegistry`(F)의 구현은 X 몫이지만 지금까지 아무도 `register`를 부르지 않는다. 그래서 `ext.commit`은 등록부에 없는 확장 kind(`x.*`, `grp.*`)를 "열린 kind"로 프로세스 안에서 올린다(`KindCatalog.openExtension`). 열린 kind의 payload 검사는 X가 커밋 앞에서 이미 했다는 전제다(공개 기록은 매니페스트 `recordKinds` 스키마, 상태 문서는 `StateDecl.schema`, 비공개 기록은 쓰는 확장의 몫, `X.primitives.spec` §4.6.5). 저장소가 확인하는 것은 kind 형식, 생산자 이름(`ext.<kind의 둘째 마디>`), 버전 정수, 크기, `*.state.committed`의 모양(`scopeId`, `rev`, `prevEventId`, `version`, `doc`)이다. 등록부에 항목이 있으면 그 스키마와 버전이 우선한다. 다시 시작하면 열린 kind는 비어 있고, 읽기 경로(`readFrom`, `readBranch`, `subscribe`)는 등록되지 않은 확장 kind를 업캐스트 없이 그대로 통과시킨다(§4.12). 코어 kind 가운데 `ext.commit`이 낼 수 있는 것은 생산자 `xh`가 소유한 `scope.changed`, `lease.acquired`, `lease.released`뿐이다. 그 밖의 코어 kind는 `invalid`다.
- `ext.commit` 결과 변환표 [제안]. `SessionService.commit` 결과와 오류를 X `ExtCommitResult`로 바꾼다(`X.primitives.spec` §4.6.1 "저장소 결과 변환"):

| `SessionService.commit` 결과·오류 | `ExtCommitResult` |
|---|---|
| `committed` | `{ status: "committed" }` |
| `committed` + `replayed: true` | `{ status: "replayed", stored }`. 상태 커밋이면 `stored`에 그때 저장된 `StoredScopeState`(이벤트 id, 판, 버전, doc)를 싣는다 |
| `rejected("state_conflict")` | `{ status: "rejected", code: "state_conflict" }` |
| `ownership_lost` | `{ status: "rejected", code: "lease_lost" }` |
| `key_reused`, 초안 검증 실패, 알 수 없는 thread(`thread_not_found`) | `{ status: "rejected", code: "invalid" }`. X 쪽에서는 결함(`Bug`)이다. 초안 검증은 쓰기 앞에서 하므로 Bug를 던지지 않는다 |
| `busy` | `{ status: "rejected", code: "busy" }` |
| `disk_full`, `read_only`, `io`, `row_invalid` | `{ status: "rejected", code: "storage" }` |

- `ext.commit`의 지문: `ExtCommitRequest.fingerprintSource`가 있으면 그 값으로 지문을 만든다. 상태 커밋은 키의 신원 부분만 담으므로 정당한 재실행이 `key_reused`가 되지 않는다(`X.primitives.spec` §4.6.1 지문 규칙).
- `ext.commit`의 공개 범위 [결정: review.decisions-2 T-21]: `ExtCommitRequest.visibility`가 `"private"`이면(X `ScopeApi.recordPrivate`, `X.primitives.spec` §4.6.5) 그 커밋의 이벤트 행 `events.private_owner`에 행의 소유 확장 이름을 넣는다. 소유 확장은 kind의 둘째 마디(`x.<name>.*`, `grp.<name>.*`의 `<name>`)이고, 낙인한 생산자 `ext.<name>`의 `<name>`과 같아야 한다. 다르면(다른 확장 접두 kind를 비공개로 커밋하면) `rejected(invalid)`다(`F.records.spec` §3.9 비공개 규칙 1). 생략하거나 `"public"`이면 NULL이다. 저장 위치는 `events` 행의 `private_owner` 열 하나이고, envelope 필드와 투영 열은 따로 두지 않는다 [제안]. `visibility`는 지문에 넣는다. 같은 `requestId`로 공개 범위만 바꿔 다시 커밋하면 `key_reused`다 [제안].
- `ext.queryRecords` 조회 [결정: review.decisions-2 T-21]: 현재 thread의 활성 가지 위 그룹 레코드 중 `query.kind`(정확히 일치 또는 `.*` 접두 일치)와 `subject`에 맞는 행을 `seq` 순으로 돌려준다. `private_owner`가 NULL이 아닌 행은 `private_owner`가 조회한 확장(`reader`)과 같을 때만 돌려준다. `readsRecordKinds`가 `grp.<id>.*`처럼 넓어도 같다. X가 넘기는 `kinds` 허용 목록 검사(`read_kind_undeclared`)는 X 몫이고, 이 필터는 그 뒤 저장소에서 한 번 더 적용한다. 조회한 확장은 `RecordCommitPort.queryRecords(threadId, query, reader)`의 셋째 인자다(`F.records.spec` §3.9 비공개 규칙 3, FR-P11 반영). 시그니처의 `reader`는 `string`이고 값은 `ExtensionName`이다. 필터는 SQL 조건 `private_owner IS NULL OR private_owner = :reader`로 적용한다 [제안].
- 확장 투영기는 비공개 행도 그대로 받는다. 투영기의 `kinds`에는 자기 접두만 둘 수 있으므로(`X.operations.spec` §4.4.4 `kind_not_owned`) 다른 확장의 비공개 행은 전달되지 않는다. 투영 계층에서 따로 거르지 않는다.

### 3.4 투영기

`Projector`, `ProjectionTx`의 모양은 `eng.events.design` §5.1을 F 이름으로 옮긴 것이다(`types` → `kinds`).

```ts
// xeon/packages/contracts/src/records/projector.ts  [제안: FR-P1]
export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Readonly<Record<string, SqlValue>>;

/** 투영기가 받는 SQL 핸들. 소유 테이블 밖 문장은 테스트·디버그 빌드에서 Bug("store.prefix_not_owned") */
export interface ProjectionTx {
  run(sql: string, params?: readonly SqlValue[]): void;
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
}

export interface Projector {
  /** "core" | "cap.<도메인>" | "ext.<확장 이름>" */
  readonly name: string;
  /** 투영 규칙 버전. payload version과 독립(F.records.spec §3.7 규칙 5) */
  readonly version: number;
  /** 소유 테이블. core는 p_* 와 step_checkpoints, ext.<name>은 x_<name의 '-'를 '_'로>_<지역 이름> 만(지역 이름에 밑줄 없음) */
  readonly tables: readonly string[];
  /** 소유 테이블 DDL. 재생성 때 이 순서로 실행한다 */
  readonly ddl: readonly string[];
  /** 관심 kind. "all"이면 모든 내구 이벤트 */
  readonly kinds: readonly EventKind[] | "all";
  /** 업캐스트된 이벤트를 받는다. 동기, 순수, I/O 없음(EV-06) */
  apply(tx: ProjectionTx, event: DurableEventEnvelope): void;
}

export type ProjectorRegisterError =
  | { readonly kind: "name_taken"; readonly name: string }
  | { readonly kind: "name_reserved"; readonly name: string }          // "core"
  | { readonly kind: "table_not_owned"; readonly name: string; readonly table: string }
  | { readonly kind: "table_taken"; readonly table: string; readonly owner: string };

export interface ProjectorFailure {
  readonly projector: string;
  readonly event: { readonly id: EventId; readonly kind: EventKind; readonly seq: number };
  readonly requestId: CommitKey;
  readonly message: string;
}

export interface ProjectorRegistry {
  /** 버전이 projector_state와 다르면 등록 전에 그 투영기만 재생성한다(§4.5.3). 해제하면 테이블은 남는다 */
  register(projector: Projector): Result<{ dispose(): void }, ProjectorRegisterError>;
  list(): readonly { readonly name: string; readonly version: number; readonly tables: readonly string[] }[];
  /** 확장 투영기 apply 예외로 커밋이 롤백되었을 때 알린다. X가 확장을 끄는 데 쓴다 */
  onFailure(listener: (failure: ProjectorFailure) => void): Unsubscribe;
}
```

조회 API(`ProjectionQuery`)는 다른 컨텍스트가 `p_*`를 직접 읽지 않게 하는 질의 묶음이다(CM-02).

```ts
// xeon/packages/contracts/src/records/session-service.ts (계속)
export interface ThreadSummaryRow {
  readonly threadId: ThreadId;
  readonly title: string | null;
  readonly status: ThreadStatus;
  readonly workspace: string | null;
  readonly createdAt: number;              // ms
  readonly updatedAt: number;              // 마지막 이벤트 recordedAt
  readonly headSeq: number;                // 이 thread의 마지막 seq
  readonly forkedFrom: { readonly threadId: ThreadId; readonly eventId: EventId } | null;
  readonly marker: RecoveryMarker | null;  // 후보 표시
  readonly queuedInputs: number;
  readonly pendingApprovals: number;
}

export interface ProjectionQuery {
  thread(threadId: ThreadId): Result<ThreadSummaryRow | undefined, ReadFailure>;
  turn(threadId: ThreadId, turnId: TurnId): Result<TurnView | undefined, ReadFailure>;
  openTurn(threadId: ThreadId): Result<TurnView | undefined, ReadFailure>;
  /** TxView.turnByRequestId와 같은 조회. 트랜잭션 밖 읽기 */
  turnByRequestId(threadId: ThreadId, scopeId: string | null, requestId: string): Result<TurnView | undefined, ReadFailure>;
  openEffects(threadId: ThreadId): Result<readonly EffectView[], ReadFailure>;
  queuedInputs(threadId: ThreadId): Result<readonly InputView[], ReadFailure>;
  pendingApprovals(threadId: ThreadId): Result<readonly ApprovalView[], ReadFailure>;
  /** 부모 대화의 자식 thread 연결. unsettledOnly가 참이면 정착하지 않은 것만 */
  childAgents(parentThreadId: ThreadId, options?: { readonly unsettledOnly?: boolean }): Result<readonly AgentView[], ReadFailure>;
  /** 활성 가지의 item, 순서대로. 컨텍스트 조립과 화면이 쓴다 */
  branchItems(threadId: ThreadId, options?: { readonly afterItemId?: ItemId; readonly limit?: number }): Result<readonly ItemRow[], ReadFailure>;
  /** item을 기록한 이벤트 id(fork, revert의 대상 해석) */
  itemEvent(threadId: ThreadId, itemId: ItemId): Result<EventId | undefined, ReadFailure>;
  /** onActiveBranch가 참이면 활성 가지(현재 leaf에서 parentId 사슬) 위 이벤트만 본다. branchItems와 같은 사슬 조회다. match.pointer는 payload 안의 RFC 6901 포인터다 */
  latestEvent(threadId: ThreadId, kind: EventKind, match?: { readonly pointer: string; readonly equals: JsonValue }, options?: { readonly onActiveBranch?: boolean }): Result<DurableEventEnvelope | undefined, ReadFailure>;
  /** 참조 중인 blob 해시. GC 뿌리 집합(§4.11) */
  liveBlobRefs(): Result<readonly string[], ReadFailure>;
}

export interface ItemRow {
  readonly itemId: ItemId;
  readonly eventId: EventId;
  readonly seq: number;
  readonly kind: "user" | "assistant" | "system" | "toolResult" | "custom";
  readonly turnId: TurnId | null;
  readonly status: "in_progress" | "completed" | "failed" | "interrupted";
}
```

### 3.5 읽기와 구독

```ts
// xeon/packages/contracts/src/records/session-service.ts (계속)
/** 커밋 하나의 결과. (firstSeq - 1, lastSeq] 구간 */
export interface CommitBatch {
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly events: readonly DurableEventEnvelope[];
}
export type CommitListener = (batch: CommitBatch) => void;

/** F.wire-settings.spec §3.4.1 EventFilter와 같은 모양 */
export interface FeedFilter {
  readonly threadIds?: readonly ThreadId[];
  readonly kindPrefixes?: readonly string[];
  readonly excludeKindPrefixes?: readonly string[];
}

export interface EventFeed {
  headSeq(): Result<number, ReadFailure>;
  /** 다시 보낼 수 있는 가장 오래된 seq - 1. 로그를 잘라 내지 않으므로 M1은 항상 0 */
  oldestReplayableSeq(): number;
  /** seq > after AND seq ≤ upto, 필터 적용. limit만큼 차면 멈추고, 아니면 scanLimit 행까지 훑는다 */
  read(after: number, upto: number, filter: FeedFilter | undefined, limit: number, scanLimit: number):
    Result<{ readonly events: readonly DurableEventEnvelope[]; readonly scannedTo: number }, ReadFailure>;
  /** 커밋 직후 같은 JS 턴에서 동기로 부른다(TX-09) */
  onCommit(listener: CommitListener): Unsubscribe;
  onVolatile(listener: (event: VolatileEventEnvelope) => void): Unsubscribe;
}
```

- `readFrom`과 `subscribe`의 첫 인자는 배타 경계(그 seq보다 큰 것)다. F `SessionStore`의 인자 이름 `fromSeq`가 포함 경계로 읽힐 수 있어 이름을 `afterSeq`로 바꾸도록 요청한다(FR-P2).
- `feed.read`는 `L4.host-service.spec` §3.3.2 `EventFeedPort.read`와 같은 시그니처다. 호스트 어댑터는 이 메서드를 그대로 넘긴다.

### 3.6 쓰기 소유와 열기

쓰기 소유 증표는 L0.store의 `LeaseToken`(`resource = "session:<threadId>"`, `holderId`, `epoch`)이다 [제안]. 호스트가 세션 임대를 얻어(`L4.host-service.spec` `SessionLockPort` → L0.process OS 잠금 + `xeon.store.leases.acquire`) 토큰을 넘긴다. core-persistence는 열린 thread마다 토큰을 보관하고 커밋 트랜잭션 안에서 `xeon.store.leases.holds(tx, token)`로 `sys_leases` 행을 새로 읽어 epoch를 대조한다(TX-10). 메모리의 잠금 핸들 확인으로는 임대를 인수당한 뒤 늦게 깬 이전 소유자의 쓰기를 막지 못하기 때문이다. 소유 표시(`kind`, `pid`, `host`, `heartbeatAt`)는 `leases.inspect(resource)`의 `LeaseOwnerInfo`에서 읽는다. 별도 소유 표시 테이블을 두지 않는다(`L0.store.spec` §3.3 `sys_leases.kind`).

```ts
// xeon/packages/contracts/src/records/session-service.ts (계속)
// LeaseToken, LeaseOwnerInfo: F records lease.ts(L0.store.spec FR-S2)
import type { LeaseOwnerInfo, LeaseToken } from "./lease.ts";

export interface RecoveryMarker {
  readonly turnId: TurnId;
  readonly runningSince: number;     // 열린 turn의 turn.started recordedAt
  readonly resumeAttempts: number;   // 그 turn의 thread.resumed 수
}

export interface OpenReport {
  readonly threadId: ThreadId;
  readonly role: "owner" | "observer";
  readonly headSeq: number;          // thread의 마지막 seq
  readonly marker: RecoveryMarker | null;
  readonly readOnly: ReadOnlyReason | null;
  /** 이번 열기에서 다시 만든 투영기 이름 */
  readonly rebuilt: readonly string[];
  /** leases.inspect 결과. 표시용이고 판정에 쓰지 않는다. 관찰 열기에서 쓰기 소유자를 보여 준다 */
  readonly owner: LeaseOwnerInfo | null;
}

export type OpenError =
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string }
  | { readonly kind: "row_invalid"; readonly where: string }             // 읽은 행이 스키마와 다르다
  | { readonly kind: "guard_mismatch"; readonly threadId: ThreadId };   // token.resource가 session:<threadId>가 아니거나 leases.holds가 거짓
```

### 3.7 재개 타입

```ts
// xeon/packages/contracts/src/records/session-service.ts (계속)
import type { EffectIntent, EffectExec, EffectResult, EffectRecovery, PendingToolCall } from "./index.ts";

/** 재실행 상한. 첫 실행 뒤 재실행은 이 수까지 [제안: eng.transactions.design §5.2 값] */
export const MAX_REPLAY_ATTEMPTS: 2 = 2;

export interface EffectRerun {
  readonly intent: EffectIntent;
  /** 1부터. effect.exec 커밋 키의 끝 토막이 된다(§4.7.3) */
  readonly attempt: number;
}

export interface ResumePlan {
  readonly threadId: ThreadId;
  readonly checkpoint: StepCheckpoint | null;
  readonly marker: RecoveryMarker | null;
  /** recover가 이미 커밋한 합성 결과 */
  readonly synthesized: readonly { readonly effectId: EffectId; readonly toolCallId: string; readonly code: "not_started" | "outcome_unknown" }[];
  /** 호출자(core-loop)가 ToolService.rerun으로 다시 실행할 효과 */
  readonly reruns: readonly EffectRerun[];
  /** 의도가 없는 도구 호출. 승인 대기 포함. 호출자(core-loop)가 runTurn({ kind: "tools" })로 xeon.tools의 prepare·execute를 다시 거친다(L1.loop.spec §4.5) */
  readonly pendingToolCalls: readonly PendingToolCall[];
  /** 해결되지 않은 approval.requested id. 호출자가 ApprovalService.restore를 부른다 */
  readonly pendingApprovals: readonly EventId[];
  readonly queuedInputs: readonly InputView[];
  /** 열린 turn이 소유한, 정착하지 않은 자식 thread. 호출자(core-agents)가 같은 requestId로 자식 대화를 재개한다(L1.agents.spec §4.5) */
  readonly openChildren: readonly AgentView[];
  /** turn.abort_requested가 있는 열린 turn. 호출자가 재개하지 않고 닫는다 */
  readonly abortRequestedTurn: TurnId | null;
  /** 체크포인트의 next. 열린 turn이 없으면 "idle" */
  readonly next: StepCheckpoint["next"] | "idle";
  readonly autoResume: AutoResumeVerdict;
}

export type AutoResumeVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: "no_marker" | "setting_off" | "not_service_mode" | "attempts_exhausted" | "abort_requested" };

export type ResumeError =
  | StoreError
  | { readonly kind: "no_open_turn"; readonly threadId: ThreadId }
  | { readonly kind: "attempts_exhausted"; readonly attempts: number; readonly max: number };
```

판정 함수(순수, `core-persistence/src/recovery.ts`, F로 옮기지 않는다 [제안]):

```ts
// xeon/packages/core-persistence/src/recovery.ts
import { decideEffectRecovery, OUTCOME_UNKNOWN_TEXT, type EffectRecovery } from "@xeon/contracts/records";

export interface OpenEffectInput {
  readonly intent: EffectIntent;
  readonly lastExec: EffectExec | null;
  readonly result: EffectResult | null;
  readonly currentReplay: ReplayPolicy | null;   // ToolService.meta(name)?.replay를 toReplayPolicy로. 도구가 없으면 null
  readonly execCount: number;
}

/** F decideEffectRecovery에 재실행 상한을 더한다. result.resultItemId는 null로 나오고 커밋 때 채운다 */
export function decideOpenEffect(input: OpenEffectInput): EffectRecovery;
// 규칙: base = decideEffectRecovery({ intent, exec: lastExec, result, currentReplay })
//       base.action === "rerun" && max(0, execCount - 1) >= MAX_REPLAY_ATTEMPTS
//         → { action: "synthesize", code: "outcome_unknown", result: { status: "interrupted", synthesized: true, ... }, content: OUTCOME_UNKNOWN_TEXT }
//       그 밖은 base 그대로
```

- `currentReplay`는 core-persistence가 `xeon.tools`를 부르지 않고 얻어야 한다(§4.8.2 이유). 그래서 `recover`는 호출자(core-loop)가 넘기는 `RecoverDeps`를 받는다 [제안].

```ts
// xeon/packages/contracts/src/records/session-service.ts (계속)
export interface RecoverDeps {
  /** 현재 등록된 도구의 재생 정책. ToolService.meta(name)을 toReplayPolicy로 바꾼 값. 도구가 없으면 null */
  readonly toolReplay: (toolName: string) => ReplayPolicy | null;
  /** 소유 사슬 취소 판정(L1.tasks.spec §4.8 3번 isCancelledByOwner) */
  readonly cancelledByOwner: (threadId: ThreadId, turnId: TurnId) => boolean;
  /** 호스트 모드. 자동 재개 판정에 쓴다 */
  readonly hostMode: "in-process" | "stdio" | "service";
}
```

### 3.8 수명주기와 분기 API

```ts
// xeon/packages/contracts/src/records/session-service.ts (계속)
export interface ThreadCreated {
  readonly threadId: ThreadId;
  readonly headSeq: number;
  /** 같은 creationKey로 이미 만든 thread를 돌려줬으면 참. threadId는 처음 만든 값이다 */
  readonly replayed: boolean;
  /** inheritOwnerFrom으로 만든 자식 thread의 세션 임대 토큰. 그 밖은 null */
  readonly token: LeaseToken | null;
}

export interface ThreadCreateInput {
  readonly threadId: ThreadId;
  readonly title?: string;
  readonly workspace?: string;
  /** 전역 생성 멱등 키 1~200자. 같은 키의 두 번째 호출은 새 thread를 만들지 않는다(§4.10.1). 예: L2.schedule "timer:<timerId>:<dueAt>:create" */
  readonly creationKey?: string;
  /** 자식 thread 생성(L1.agents.spec §4.1). 부모 thread의 토큰. 같은 holder로 session:<threadId> 임대를 얻는다 */
  readonly inheritOwnerFrom?: LeaseToken;
}

export interface ThreadListQuery {
  readonly workspace?: string;
  readonly includeClosed?: boolean;      // 기본 false
  readonly cursor?: string;              // 불투명. (updatedAt, threadId) 내림차순 위치
  readonly limit?: number;               // 1~200, 기본 50
}
export interface ThreadPage {
  readonly threads: readonly ThreadSummaryRow[];
  readonly nextCursor: string | null;
}

export interface BranchSummaryInput {
  readonly summary: string;
  readonly details: JsonValue | null;
  readonly usage: Usage | null;
}

export type SessionShutdownReason = "quit" | "reload" | "new" | "resume" | "fork";   // F.extensions.spec §3.5

export type LifecycleError =
  | StoreError
  | { readonly kind: "not_owner"; readonly threadId: ThreadId }
  | { readonly kind: "thread_closed"; readonly threadId: ThreadId }
  | { readonly kind: "turn_running"; readonly turnId: TurnId }
  | { readonly kind: "has_forks"; readonly forks: readonly ThreadId[] }
  | { readonly kind: "invalid_target"; readonly reason: "item_not_found" | "not_on_branch" | "inside_turn" | "open_tool_calls" }
  | { readonly kind: "cancelled_by_extension"; readonly point: "session_before_fork" | "session_before_tree" | "session_before_switch"; readonly reason: string | null };

export interface ThreadLifecycle {
  /** thread.started 커밋. 새 thread의 첫 이벤트라 쓰기 소유 검사를 건너뛴다(§4.10.1). inheritOwnerFrom이 없으면 임대는 호출자가 이어서 얻는다 */
  create(input: ThreadCreateInput): Result<ThreadCreated, LifecycleError>;
  list(query: ThreadListQuery): ThreadPage;
  /** thread.closed 커밋. 쓰기 소유자만. 열린 turn이 있으면 turn_running */
  close(threadId: ThreadId, reason: string | null): Result<void, LifecycleError>;
  /** 이벤트와 투영 행을 지운다. 쓰기 소유자만. 이 thread를 forkedFrom으로 가리키는 thread가 있으면 has_forks */
  remove(threadId: ThreadId): Result<void, LifecycleError>;
  /** session_before_fork(first) 뒤 새 thread의 thread.started{forkedFrom} 커밋 */
  fork(threadId: ThreadId, at: ItemId | undefined, newThreadId: ThreadId): Promise<Result<ThreadCreated, LifecycleError>>;
  /** session_before_tree(first) 뒤 thread.leaf_moved{reason:"rewind"} 커밋. 파일은 되돌리지 않는다(2차 §4.13.2) */
  revert(threadId: ThreadId, to: ItemId, requestKey: string): Promise<Result<{ readonly leaf: EventId; readonly headSeq: number }, LifecycleError>>;
  /** 가지 이동. summary가 있으면 thread.branch_summarized를 같은 커밋에 넣는다 */
  moveLeaf(threadId: ThreadId, target: EventId, options: { readonly reason: "branch" | "restore"; readonly summary?: BranchSummaryInput; readonly requestKey: string }):
    Promise<Result<{ readonly leaf: EventId; readonly headSeq: number }, LifecycleError>>;
  /** thread.updated{title} 커밋 뒤 session_info_changed(tap, detached). L2 artifacts가 부른다 */
  setTitle(threadId: ThreadId, title: string | null, requestKey: string): Result<void, LifecycleError>;
  /** 같은 클라이언트가 다른 thread로 옮기기 전에 session_before_switch(first)를 발화한다 */
  prepareSwitch(from: ThreadId, to: ThreadId | null): Promise<Result<void, LifecycleError>>;
}
```

### 3.9 이벤트 소유와 새 kind 요청

[제안] `core.persistence`가 생산하는 코어 kind다. 접두 소유는 `eng.context-map.design` §5.1 `session.` 행을 F 이름으로 바꾼 것이다(§8.4).

| kind | durable | 생산 API | 커밋 키 |
|---|---|---|---|
| `thread.started` | 예 | `threads.create`, `threads.fork` | `thread:<threadId>:start`. `creationKey`가 있으면 같은 커밋에서 `thread_creation_keys` 행을 쓴다(§4.10.1) |
| `thread.updated` | 예 | `threads.setTitle` | `title:<threadId>:<requestKey>` |
| `thread.closed` | 예 | `threads.close` | `thread:<threadId>:close` |
| `thread.leaf_moved` | 예 | `threads.revert`, `threads.moveLeaf` | `leaf:<threadId>:<requestKey>` |
| `thread.branch_summarized` | 예 | `threads.moveLeaf`(summary 있을 때) | 같은 커밋 |
| `checkpoint.step` | 예 | `commit`이 `CommitPlan.checkpoint`로 만든다 | 그 커밋의 키 |
| `settings.changed` | 예 | `sessionSettings.set/reset` | `setting:<threadId>:<key>:<requestKey>` |
| `thread.resumed` | 예 | `beginResume` | `resume:<turnId>:<attempt>` |
| `effect.result`(합성), toolResult `item.recorded`(합성) | 예 | `recover` | `tool:<commitKeyPart(toolCallId)>:result`(review.decisions-2 U-13) |

- `checkpoint.step`의 producer는 `core.persistence`다. 체크포인트 내용(`StepCheckpointInput`)은 루프가 만들고, envelope는 저장소가 만든다.
- 합성 결과 두 kind는 `core.tools`(`effect.*`)와 `core.loop`(`item.*`) 소유다. `recover`만 쓸 수 있는 kind 단위 예외로 `TYPE_PREFIX_OWNERS`에 둔다(`eng.context-map.design` §5.1의 `tool.args_delta` 예외와 같은 방식) [제안]. 조건: `effect.result.synthesized === true`이고 item kind가 `toolResult`, `isError: true`일 때만 허용한다.
- `settings.changed`의 producer는 `core.persistence` 하나로 둔다 [제안]. `L1.tools.spec` §3.9가 권한 모드 변경을 직접 커밋한다고 적었으므로 `sessionSettings.set`을 쓰도록 요청한다(§8.4).

`thread.resumed`는 F 카탈로그에 있다(FR-P3 반영). 복구 표식의 `resume_attempts`를 이벤트에서 다시 만들 수 있게 한다.

```ts
// xeon/packages/contracts/src/records/catalog/thread.ts  [제안: FR-P3]
export interface ThreadResumedPayload {
  turnId: TurnId;
  attempt: number;                          // 1부터. 같은 turn의 thread.resumed 수
  mode: "manual" | "auto";
  fromCheckpointId: CheckpointId | null;
}
```

### 3.10 테이블

[제안] DDL은 `core-persistence/src/schema/ddl.ts`에 둔다. L0.store는 마이그레이션 실행 순서(`sys_migrations`)와 연결만 제공한다(`L0.store.spec`). 모든 테이블은 `STRICT`다.

비투영 테이블(재생으로 다시 만들 수 없음, 투영기 `core`의 `tables`에 넣지 않음):

```sql
CREATE TABLE events (
  seq            INTEGER PRIMARY KEY,          -- DB 전역 단조. event_seq.next_seq에서 받는다
  id             TEXT NOT NULL UNIQUE,         -- evt_<ULID>
  thread_id      TEXT NOT NULL,
  parent_id      TEXT,                         -- thread 첫 이벤트만 NULL
  kind           TEXT NOT NULL,
  version        INTEGER NOT NULL CHECK (version >= 1),
  turn_id        TEXT,
  step_id        TEXT,
  recorded_at    INTEGER NOT NULL,
  request_id     TEXT NOT NULL,                -- 커밋 키. envelope 밖
  private_owner  TEXT,                         -- ExtCommitRequest.visibility = "private"이면 쓴 확장 이름, 공개는 NULL(§3.3)
  envelope       TEXT NOT NULL                 -- DurableEventEnvelope 정규화 JSON(detached 적용 뒤)
) STRICT;
CREATE INDEX events_thread_seq ON events (thread_id, seq);
CREATE INDEX events_thread_kind ON events (thread_id, kind, seq);

-- 전역 seq 수열. 지운 thread의 seq를 다시 쓰지 않는다(durable storage.ts:179-189의 next_seq와 같은 방식)
CREATE TABLE event_seq (
  singleton      INTEGER PRIMARY KEY CHECK (singleton = 1),
  next_seq       INTEGER NOT NULL
) STRICT;

-- thread 삭제 경로만 쓰는 표지. 평소에는 비어 있다
CREATE TABLE thread_delete_guard (thread_id TEXT PRIMARY KEY) STRICT;

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
CREATE TRIGGER events_no_delete BEFORE DELETE ON events
WHEN NOT EXISTS (SELECT 1 FROM thread_delete_guard g WHERE g.thread_id = OLD.thread_id)
BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;

CREATE TABLE requests (
  thread_id      TEXT NOT NULL,
  request_id     TEXT NOT NULL,
  fingerprint    TEXT NOT NULL,                -- 64 hex
  status         TEXT NOT NULL CHECK (status IN ('committed', 'rejected')),
  result         TEXT NOT NULL,                -- CommitResult JSON(replayed 제외)
  first_seq      INTEGER,
  last_seq       INTEGER,
  PRIMARY KEY (thread_id, request_id)
) STRICT;

CREATE TABLE projector_state (
  name           TEXT PRIMARY KEY,             -- "core" | "cap.<도메인>" | "ext.<이름>"
  version        INTEGER NOT NULL,
  last_seq       INTEGER NOT NULL,             -- 반영한 마지막 seq
  rebuild_cursor TEXT                          -- 청크 재생성 중이면 ChunkMigration 커서 JSON, 아니면 NULL
) STRICT;

CREATE TABLE consumer_cursors (                -- 행은 각 소비자가 자기 것만 쓴다(eng.transactions.design §7)
  consumer       TEXT PRIMARY KEY,
  seq            INTEGER NOT NULL,             -- eng의 pos
  updated_at     INTEGER NOT NULL
) STRICT;

-- 전역 thread 생성 멱등 키(§4.10.1). requests는 thread 범위라 thread 밖 키를 받지 못한다
CREATE TABLE thread_creation_keys (
  key            TEXT PRIMARY KEY,             -- ThreadCreateInput.creationKey
  thread_id      TEXT NOT NULL
) STRICT;
```

- 소유 표시 테이블은 두지 않는다 [제안]. 표시 정보는 L0.store `sys_leases`(`holder_id`, `kind`, `pid`, `host`, `heartbeat_at`, `expires_at`)를 `leases.inspect`로 읽는다(`L0.store.spec` §3.3). 하트비트 주기는 L0.store `l0.store.heartbeatMs`(기본 5초)다.

코어 투영 테이블(투영기 `core` 소유, `eng.events.design` §5.2를 F 이름으로 다시 정리):

| 테이블 | 기본 키 | 주요 열 | 갱신 kind |
|---|---|---|---|
| `p_threads` | `thread_id` | `title`, `status`, `workspace`, `created_at`, `updated_at`, `first_seq`, `head_seq`, `leaf_event_id`, `forked_from_thread`, `forked_from_event`, `closed_reason`, `open_turn_id`, `running_since`, `resume_attempts` | `thread.*`, `turn.started`, `turn.completed`, `thread.resumed`, 모든 내구 이벤트(head·leaf·updated_at) |
| `p_items` | `item_id` | `thread_id`, `event_id`, `parent_event_id`, `seq`, `turn_id`, `step_id`, `kind`, `status`, `stop_reason`, `effect_id` | `item.recorded` |
| `p_parts` | `part_id` | `item_id`, `idx`, `type`, `text`, `blob_sha256` | `part.recorded` |
| `p_effects` | `effect_id` | `thread_id`, `tool_call_id`, `item_id`, `tool_name`, `replay`, `intent_seq`, `exec_count`, `last_exec_seq`, `result_seq`, `result_status`, `synthesized` | `effect.intent`, `effect.exec`, `effect.result` |
| `p_turns` | `turn_id` | `thread_id`, `status`, `started_seq`, `started_at`, `completed_seq`, `abort_requested_seq`, `step_count`, `request_id`, `scope_id`(drive turn의 scope, 그 밖은 NULL, FR-P10). 색인 `(thread_id, scope_id, request_id)` 유일 | `turn.started`, `turn.completed`, `turn.abort_requested`, `step.completed` |
| `p_inputs` | `input_id` | `thread_id`, `seq`, `mode`, `state`, `source_key`, `request_id`, `placed_item_id`, `placed_turn_id` | `input.queued`, `input.placed`, `input.withdrawn` |
| `p_approvals` | `approval_id` | `thread_id`, `origin_thread_id`, `tool_call_id`, `body_kind`, `requested_seq`, `resolved_seq`, `decision` | `approval.requested`, `approval.resolved` |
| `p_blob_refs` | `(thread_id, sha256)` | `first_seq` | `detached`가 있는 모든 이벤트, `BlobRef` 필드가 있는 `effect.*` |
| `step_checkpoints` | `thread_id` | `checkpoint_id`, `seq`, `turn_id`, `step_index`, `next`, `schema_version`, `record` | `checkpoint.step` |
| `p_agents` | `child_thread_id` | `thread_id`(부모), `request_id`, `owner_kind`, `owner_turn_id`, `owner_tool_call_id`, `background`, `depth`, `agent`, `spawned_seq`, `settled_seq`, `settled_status`, `settled_event_id`. 색인 `(thread_id, request_id)` 유일, `(thread_id, owner_turn_id)` 부분 색인(정착하지 않은 행) | `agent.spawned`, `agent.settled`. F가 `agent.*`를 받지 않으면 `thread.started.spawnedBy`에서 투영한다(§10 8번) |

- `p_scopes`와 `p_settings`는 만들지 않는다 [결정: L1B.1, L1B.2]. session 범위 값(`settings.changed`)도 같은 이유로 활성 가지 이벤트에서 읽는다(§6.2). 켜짐·임대·상태 판은 활성 가지 이벤트로 계산하므로(§3.3 `ext.loadThread`) 이벤트 순서로 쌓이는 테이블이 버려진 가지의 값을 담을 일이 없다. `TxView.scopeStateRev`·`scopeLeaseEpoch`도 같은 계산이다.
- 모든 투영 테이블은 `thread_id` 열을 둔다. thread 삭제 때 소유 투영기의 `tables`에서 그 thread 행을 함께 지운다(`eng.context-map.design` §5.2 [제안]).
- `p_items`·`p_parts`는 모든 가지의 행을 갖는다. 활성 가지 조회는 `query.branchItems`가 `leaf_event_id`에서 `parent_event_id`를 따라 거른다(`eng.events.design` §6).
- `p_inputs`의 열 이름은 `L1.tasks.spec` §3.6 `InputQueuedPayload`를 따른다. `L1.tasks.spec`이 투영 열을 바꾸면 이 표를 같은 변경에서 고친다.
- 열 정의와 인덱스 전체는 `schema/ddl.ts`가 정본이다. 이 표와 다르면 `ddl.test.ts`가 실패한다(`L1.persistence.plan`).

### 3.11 2차 인터페이스

```ts
// xeon/packages/core-persistence/src/export-jsonl.ts  (2차)
export type ExportFormat = "pi-jsonl" | "xeon-jsonl";
export interface ExportOptions {
  readonly format: ExportFormat;
  /** 생략하면 활성 가지만. "all"이면 모든 가지 */
  readonly branch?: "active" | "all";
  readonly hydrateBlobs: boolean;           // true면 detached를 되돌려 싣는다
}
export function exportThread(session: SessionService, threadId: ThreadId, options: ExportOptions): AsyncIterable<string>;   // 줄마다 JSON 하나 + "\n"

// xeon/packages/core-persistence/src/rewind.ts  (2차)
export interface FileSnapshotEntry {
  readonly path: string;                    // 작업 공간 기준 상대 경로
  readonly before: BlobRef | null;          // null = 그 시점에 파일 없음
}
export interface RewindPlan {
  readonly threadId: ThreadId;
  readonly toTurnId: TurnId;
  readonly files: readonly FileSnapshotEntry[];
  readonly untracked: readonly string[];    // 추적 범위 밖 변경 후보(Bash 등). 되돌리지 않는다
}
```

## 4. 동작 규칙

### 4.1 커밋 순서

[제안] `eng.transactions.design` §4.3·§4.4 순서를 F 이름과 L0.store 임대 토큰으로 옮긴다.

| # | 단계 | 실패 처리 | FaultPoint |
|---|---|---|---|
| 0 | 트랜잭션 밖: 지문 계산, 큰 문자열 분리와 blob 쓰기(`xeon.store.putBlob`) | | |
| 1 | `StoreDb.write` 시작(`BEGIN IMMEDIATE`) | `busy`, `disk_full` | `after_begin` |
| 2 | 소유 확인: 요청 thread와 초안이 가리키는 모든 thread에 대해 보관한 토큰으로 `xeon.store.leases.holds(tx, token)`가 참. 같은 트랜잭션에서 `sys_leases` 행을 새로 읽어 epoch를 대조한다(TX-10). 새 thread의 첫 이벤트 `thread.started`만 예외(§4.10.1) | 토큰이 없거나 거짓이면 롤백, `ownership_lost`. `ownership_lost`는 이 경우에만 낸다 | `after_lease_check` |
| 3 | `requests (thread_id, request_id)` 조회. 같은 지문이면 저장된 결과 + `replayed: true`, 다른 지문이면 `key_reused` | 쓰기 없음 | `after_request_check` |
| 4 | `expectedLeaf` 비교, `TxView` 열기, `build(view)` 동기 호출 | `reject`면 `requests`에 rejected 저장 | |
| 5 | 초안마다: envelope 완성(`seq = next_seq`, `recordedAt`, `parentId`), 스키마·kind 소유·크기 검사, `events` INSERT, `p_blob_refs` | Bug, 롤백 | `after_event_insert:<i>` |
| 6 | 같은 초안에 `core` 투영기 apply | Bug(`store.projection_failed`), 롤백 | `after_projection:<i>` |
| 7 | 관심 kind가 맞는 `cap.*`·`ext.*` 투영기 apply(등록 순서) | Bug, 롤백, `onFailure` 알림 | `after_ext_projection:<i>` |
| 8 | `checkpoint`가 있으면 `checkpoint.step` 초안을 끝에 붙여 5~7을 한 번 더 | Bug | `before_checkpoint` |
| 9 | `requests` INSERT(결과, first_seq, last_seq), `event_seq` 갱신 | Bug | `before_request_insert` |
| 10 | 모든 투영기의 `projector_state.last_seq` 갱신 | | `before_commit` |
| 11 | COMMIT(`synchronous=FULL`) | `busy`, `disk_full` | |
| 12 | 커밋 뒤 동기 방출(§4.6) | 구독자 예외는 로그 | `after_commit` |

- `recordedAt = max(clock.now(), 직전 recordedAt)`이다. DB 안에서 감소하지 않는다.
- `parentId`: 초안이 지정하면 그 값(분기), 아니면 그 thread의 현재 leaf, 같은 커밋 안에서는 앞 초안이다(`F.records.spec` §4.6 1번). `thread.leaf_moved`의 `parentId`는 현재 leaf이고, 커밋 뒤 leaf는 payload의 `leafEventId`다(§4.10.2).
- 스키마 검사: 코어 kind는 `CORE_EVENT_CATALOG`, 확장 kind는 `EventKindRegistry`(`F.records.spec` §3.2)로 payload를 검사한다. 등록되지 않은 kind는 `store.kind_unregistered`다.
- 크기 검사: `checkEnvelopeSize`가 `err`면 `store.event_too_large`다. 큰 값은 0단계에서 분리했어야 한다(§4.11). 커밋 경로에서 예상 실패로 돌려주지 않는다.
- 중첩: `commit` 안(`build`, 투영기, 구독자)에서 `commit`을 다시 부르면 `store.nested_write`다(TX-09, 미결 T-2).

### 4.2 커밋 지점

[제안] `eng.transactions.design` §4.1 C1~C6과 `L1.tools.spec` §3.9를 F 이름으로 합친 표다. 행 하나가 커밋 하나다. 커밋 내용의 정본은 각 소유 spec이다.

| 지점 | 커밋 내용(F kind) | 커밋 키 | 체크포인트 | 소유 문서 |
|---|---|---|---|---|
| C1 입력 수락 | `input.queued` | `in:<sourceKey>:<requestId>` | 아니오 | `L1.tasks.spec` §4.7 |
| C2 turn 시작 | `turn.started`, `input.placed`, user `item.recorded`, 확장 기여 | `turn:<turnId>:start` | 아니오 [제안] | `L1.loop.spec` |
| C2b turn 시작 보충 | `before_agent_start`가 추가한 custom `item.recorded`(있을 때만) | `turn:<turnId>:prestart` | 아니오 | `L1.loop.spec` §4.2 규칙 1 |
| S1 단계 시작 | `step.started` | `step:<turnId>:<stepIndex>:start` | 아니오 | `L1.loop.spec` §3.5 T2 |
| C3 모델 응답 확정 | assistant `item.recorded` + `part.recorded`들, 확장 기여 | `resp:<turnId>:<stepIndex>` | 아니오. `L1.loop.spec`은 도구 호출이 있으면 `next: "tools"` 체크포인트를 요청한다(FR-L3, `L1.readme` §13 (j)) | `L1.loop.spec` |
| E1 효과 의도 | `effect.intent`(호출마다) | `tool:<toolCallId>:intent` | 아니오 | `L1.tools.spec` §4.4 |
| E2 실행 시작 | `effect.exec` | `tool:<toolCallId>:exec`, 재실행은 `…:exec:<attempt>` | 아니오 | `L1.tools.spec`, 이 문서 §4.7.3 |
| E3 효과 결과 | `effect.result` + toolResult `item.recorded` | `tool:<toolCallId>:result` | 아니오 | `L1.tools.spec` |
| A1 승인 요청 | `approval.requested` + `checkpoint.step`(`waiting: "approval"`) | `L1.tools.spec` §3.9 | 예 | `L1.tools.spec` §4.7 |
| C5 단계 끝 | `step.completed`, `input.placed`(steer), 확장 기여, `checkpoint.step` | `step:<turnId>:<stepIndex>:end` | 예 | `L1.loop.spec` |
| C6 turn 끝 | `turn.completed`, 확장 기여(`agent_before_settle` chain 결과) | `turn:<turnId>:end` | 아니오 | `L1.loop.spec` |
| X1 취소 의도 | `turn.abort_requested` | `abort:<turnId>` | 아니오 | `L1.tasks.spec` §4.2 |
| C7 컴팩션 | `thread.compacted` + 새 접두 system `item.recorded` | `compact:<threadId>:<stepId>:<reason>` | 아니오 | `L1.context.spec` §4.6 5번 |

- [제안] 컴팩션은 별도 커밋 지점 C7이다. 임계·수동 컴팩션(단계 사이)과 오버플로우 복구 컴팩션(단계 중간, 같은 단계 재요청 전, `L1.context.spec` §4.7)이 같은 지점을 쓴다. C5 `build` 안에 넣지 않는 이유는 오버플로우 복구가 단계 끝 전에 일어나 C5에 합칠 수 없고, 두 경로를 한 방식으로 두어야 크래시 뒤 상태가 하나로 정해지기 때문이다(§4.14). 키의 `stepId`는 같은 커밋의 `thread.compacted.details.xeon.stepId`이고 `L1.context.spec`의 `second_overflow` 판정과 같은 값이다. `stepId`가 없는 수동 컴팩션(유휴 thread)은 그 자리에 직전 leaf 이벤트 id를 쓴다. C7은 체크포인트를 쓰지 않는다. 이름을 K1로 두지 않은 이유는 K1~K6이 §4.14의 종료 지점 이름이기 때문이다.
- [제안] 체크포인트는 단계 경계(C5)와 승인 대기(A1)에만 쓴다. `F.records.spec` §3.6은 "단계 경계마다 `step.completed`와 같은 커밋"으로 정했고, A1은 단계 중간이므로 `step.completed` 없이 체크포인트를 쓴다. 그래서 A1은 §4.1 8단계의 `store.checkpoint_without_step` 검사에서 예외다(`next: "await_input"`이고 `pendingToolCalls`에 `waiting: "approval"`이 있을 때. `next: "tools"`는 C3의 도구 단계 체크포인트라 이 예외가 아니다, review.open-issues D-06). 이 예외를 F에 적도록 요청한다(FR-P4).
- C2에 체크포인트를 두지 않는 이유: turn 시작 직후 크래시는 마지막 체크포인트(이전 turn의 C5, 없으면 없음)와 그 뒤 이벤트로 복원된다. `next: "request"`는 리듀서가 `turn.started` 뒤 이벤트에서 얻는다.
- 도구별 커밋(E1 의도, E2 실행 시작, E3 결과)은 ADR-0004 §3.2 3번의 보충이다. 단계당 커밋 수는 `3 + 3n`이다 [결정: review.decisions-2 U-10].
- 모든 커밋은 FULL이다(§4.3). 그래서 커밋 수가 그대로 fsync 수다. 한 단계의 fsync 수는 `1(S1) + 1(C3) + 3 × 도구 수 + 1(C5)` = `3 + 3 × 도구 수`다. turn마다 C2와 C6이 하나씩 더해지고, C2b는 `before_agent_start`가 메시지를 더할 때만, C1은 유휴 thread의 입력일 때 하나 더 있다. 취소 의도(X1), 승인 요청(A1), 컴팩션(C7)은 일어날 때만 더한다. 측정 항목은 `L1.persistence.plan` §6이다.

지점 이름 대응표 [제안]. 이 문서의 C·S·E·A·X 이름을 L1 커밋 지점의 공통 이름으로 쓰고, 다른 문서의 이름은 아래처럼 읽는다. `eng.transactions.design` §4.1의 C4(도구 정착)는 도구별 E1~E3로 나눴으므로 쓰지 않는다.

| 이 문서 | `L1.loop.spec` §3.5 | `L1.tools.spec` §3.9 | `L1.tasks.spec` | `eng.transactions.design` §4.1 |
|---|---|---|---|---|
| C1 | (`admit` 4단계의 큐 기록) | — | §4.7 `enqueue` | C1 |
| C2 | T1 | — | — | C2 |
| C2b | `turn:<turnId>:prestart` | — | — | 없음 |
| S1 | T2 | — | — | 없음 |
| C3 | T3 | — | — | C3(의도는 E1로 분리) |
| E1, E2, E3 | (도구) | `effect.intent`, `effect.exec`, `effect.result` | — | C4(분리) |
| A1 | — | §4.7 2번 승인 요청 | — | 없음 |
| C5 | T4 | — | `drain`의 `stepEnd` 배치 | C5 |
| C6 | T6 | — | — | C6 |
| X1 | 취소 의도 | — | §4.2 `abortIntent` | 없음(§6.2 2항) |
| C7 | (컴팩션, `L1.context.spec` §4.6) | — | — | C7 |

### 4.3 원자성과 내구성

1. [결정] 단계 경계 커밋(`step.completed` + `checkpoint.step` + 그 단계의 남은 내구 이벤트 + 확장 접두 테이블 갱신)은 한 트랜잭션이고 `synchronous=FULL`이다(adr.0004 §3.2 5번).
2. [제안] 쓰기 연결은 항상 FULL이다. 효과 커밋(E1~E3)도 FULL이다. 의도가 디스크에 없으면 외부 효과를 낸 뒤 흔적이 없을 수 있기 때문이다. 연결 설정은 `L0.store.spec`이 정한다(`eng.transactions.design` §3.2).
3. [제안] pi durable의 `synchronous = NORMAL`(`durable/src/storage/sqlite/node.ts:191`)은 쓰지 않는다. 전원 장애 때 최신 커밋을 잃을 수 있다(`_research/refs/pi-durable.md` §3.8 (1)).
4. 커밋 단위는 완성된 파트다(`_research/layer-plan-v2.json` L1-f "커밋 단위와 내구성"). 토큰 델타는 휘발이고 저장하지 않는다(adr.0004 §3.2 6번).
5. [제안] 부분 스트림: 사용자 취소나 provider 오류로 스트림이 끝나면 루프는 그때까지 완성된 파트로 assistant `item.recorded`를 C3에 커밋한다. `message.stopReason`은 `"aborted"`(취소) 또는 `"error"`이고 item `status`는 `interrupted` 또는 `failed`다. 컨텍스트 조립은 이 item을 다음 요청에서 뺀다(`L1.context.spec`). pi durable과 같다(`_research/refs/pi-durable.md` §3.8 (4) "커밋된 부분 응답 → aborted assistant entry", spec S:3574, 3790). 크래시(K1)에는 부분 스트림이 저장되지 않고 같은 단계 요청을 다시 보낸다.
6. 커밋 전 어느 지점에서 실패해도 `events`, `p_*`, `step_checkpoints`, `x_*`, `cap_*`, `requests`, `event_seq`에 변화가 남지 않는다(`eng.transactions.design` §4.6 표).

### 4.4 멱등

- [제안] `requests (thread_id, request_id)`와 지문으로 판정한다(`eng.transactions.design` §4.7, durable spec 2288-2301 "`requestId` deduplicates within one conversation before any write"). 결과 저장 규칙은 `eng.transactions.design` §4.7 표를 그대로 따른다.
- 같은 키·같은 지문의 재시도는 저장된 `CommitResult`에 `replayed: true`를 붙여 돌려준다. `committed`면 `eventIds`, `firstSeq`, `lastSeq`가 처음과 같다. 이벤트 수는 늘지 않는다.
- 같은 키·다른 지문은 `key_reused`다. 아무 행도 쓰지 않고 운영 로그에 남긴다.
- `rejected`도 저장한다. 같은 키로 다시 오면 같은 거부를 `replayed: true`로 돌려준다.
- 예상 실패(`busy`, `disk_full`, `io`, `ownership_lost`, `read_only`)와 Bug는 `requests`에 남지 않는다. 같은 키로 처음부터 다시 처리된다(TX-05).
- 커밋 키 형식: `COMMIT_KEY_PATTERN`(1~200자)만 검사한다. 커밋 키 정본은 `eng.transactions.design` §4.7의 `COMMIT_KEY_PATTERN`이고, scope id의 `/`는 키에 넣을 때 `:`로 바꾼다 [결정: review.decisions-2 U-13]. 옛 `REQUEST_ID_PATTERN`(`<종류>:<부분>`)은 쓰지 않는다.
- payload의 `requestId`(사용자 입력, `post`, `turn.start`)는 F 규칙(브랜드 없는 1~64자)이다. 커밋 키는 그 값을 감싸 만든다(예: `in:user:<requestId>`). 이 감싸기 규칙은 각 생산 spec이 정한다.
- 결과는 thread가 지워질 때까지 보관한다.

### 4.5 투영

#### 4.5.1 코어 투영기

- [제안] 이름 `core`, 테이블은 §3.10의 `p_*`와 `step_checkpoints`, `kinds: "all"`이다. `core-persistence/src/projector/core.ts`에 kind별 리듀서 표로 둔다. 리듀서 논리는 opencode `message-updater.update`의 이벤트별 갱신 방식을 읽기 자료로 참고하고 코드는 가져오지 않는다(`_research/packages.md` §2.4).
- 투영은 순수 함수이고 I/O를 하지 않는다. 시계, 난수, 파일, 네트워크, 환경 변수를 쓰지 않는다(EV-06, `eng.events.design` §5.1 1번). 시각이 필요하면 `event.recordedAt`을 쓴다.
- 업캐스트한 이벤트만 받는다. 커밋 경로의 새 이벤트는 현재 버전이라 업캐스트가 그대로 통과한다.

#### 4.5.2 확장 투영기와 같은 커밋 참여

- [결정] 확장은 자기 접두 테이블만 소유한다(`_research/decisions-log.md` 2026-10-21 결정 2차 "확장 접두사 테이블", `eng.context-map.design` §3 규칙 3). 테이블 이름 형식은 `x_<확장 id의 '-'를 '_'로>_<지역 이름>`이다. 확장 id는 `^[a-z][a-z0-9-]{1,31}$`이고 지역 이름에는 밑줄을 쓰지 않는다 [결정: review.decisions-2 U-18](`X.operations.spec` §4.4.2).
- [제안] 참여 방법: X가 `ExtProjection`을 `Projector`(`name: "ext.<이름>"`)로 바꾸어 `projectors.register`로 등록한다. 등록 메서드 이름은 이것으로 정한다(`X.operations.spec` §4.1, §4.4.4가 이 문서에 맡김). 커밋 7단계가 같은 트랜잭션의 `ProjectionTx`를 넘기고, X는 그 핸들을 `ExtWriters`로 감싼다.
- 등록 검사(모든 빌드):
  1. `name`이 `"core"`거나 `ext.`·`cap.` 접두가 아니면 `name_reserved`, 이미 있으면 `name_taken`.
  2. `ext.<이름>` 투영기의 `tables`는 모두 `x_<이름 '-'→'_'>_` 접두이고 지역 이름에 밑줄이 없어야 한다. 아니면 `table_not_owned`.
  3. 다른 투영기가 이미 가진 테이블이면 `table_taken`.
- 등록 때 버전·`last_seq` 검사로 그 투영기만 다시 만든다. 저장소가 막혔거나 투영기의 `apply`가 재생 중 던져 다시 만들지 못하면 등록은 성공하되 그 투영기를 "뒤처짐"으로 표시하고 Logger에 남긴다 [제안: `ProjectorRegisterError`에 입출력 변형이 없다]. 뒤처진 투영기는 커밋이 건너뛰고(`projector_state.last_seq`도 올리지 않는다) 다음 쓰기 열기(`openForWrite`)가 다시 시도한다. 투영은 이벤트에서 다시 만들 수 있어서 건너뛴 이벤트는 재생성으로 메워진다.
- `ProjectionTx` 소유 검사(테스트·디버그 빌드): 문장에서 `INSERT INTO`, `REPLACE INTO`, `UPDATE`, `DELETE FROM`, `FROM`, `JOIN`, `CREATE`, `DROP` 뒤 식별자를 뽑아 그 투영기의 `tables`와 대조한다. 밖이면 `Bug("store.prefix_not_owned")`를 던지고 커밋 전체가 롤백된다. `ATTACH`, `DETACH`, `PRAGMA`, `VACUUM`, `sqlite_` 이름과 여러 문장은 항상 거부한다. 운영 빌드에서는 검사를 끈다. X의 `checkStatement`(`X.operations.spec` §4.4.6)와 겹치는 방어 검사다. `eng.events.design` §5.1 끝 항목이 이 검사의 정의를 이 문서와 `L0.store.spec`에 맡겼다.
- 투영기 예외 처리 [제안]:
  - `core` 투영기 예외는 코드 결함이다. 커밋을 롤백하고 Bug를 다시 던진다.
  - `ext.*`·`cap.*` 투영기 예외는 롤백 뒤 `projectors.onFailure`로 알리고 Bug를 다시 던진다. 저장소가 투영기를 스스로 해제하지 않는다. X는 알림을 받아 그 확장을 끄고 투영기를 해제한 뒤 같은 커밋 키로 다시 시도하게 한다(`X.operations.spec` §5 6번, §10 미결 6). 해제된 투영기의 테이블은 남고 갱신되지 않는다. 다시 등록하면 버전과 관계없이 재생성한다.

#### 4.5.3 재생성과 불일치 검출

`eng.events.design` §5.4를 따른다.

- 열 때(`openForWrite`, `openForRead`) `projector_state.version ≠ P.version`이거나 `last_seq ≠ head`인 투영기만 재생성한다. 등록(`register`) 때도 같은 검사를 한다.
- 재생성: `DROP TABLE` → `ddl` 실행 → `events`를 seq 순으로 5,000행씩 읽어 업캐스트 후 `kinds`가 맞는 이벤트만 apply → `projector_state` 갱신. 한 트랜잭션이다.
- [제안] 이벤트가 많으면 청크 재생성으로 바꾼다. 청크마다 별도 트랜잭션이고 커서를 `projector_state.rebuild_cursor`에 같은 트랜잭션으로 저장한다(`F.records.spec` §3.7 규칙 6 `ChunkMigration`). 청크 재생성 중인 투영기가 있는 thread는 쓰기 모드로 열지 않는다(`read_only`, `core_projection_stale`). 기준은 이벤트 10만 건 [가정].
- 재생성은 투영 버전이 오를 때와 투영기를 새로 등록할 때만 한다. 열 때마다 하지 않는다.
- 불일치 검출: 테스트 도우미 `expectProjectionsRebuildable(session)`(`@xeon/core-persistence/testing`)가 메모리 DB에 같은 DDL로 테이블을 만들고 이벤트를 재생한 뒤, 운영 테이블과 기본 키 정렬 행 해시를 비교한다. 모든 투영 테스트 끝에 부른다. 운영 명령 `xeon debug verify-projections`는 2차다.
- 재전송 검사(`replay_diverged`): seq를 저장소가 매기므로 일반 커밋에서는 같은 seq를 두 번 쓰지 않는다. 2차 `SessionStore` 어댑터의 가져오기 경로처럼 seq가 정해진 이벤트를 넣을 때만, 같은 seq의 기존 행과 정규화 envelope 바이트를 비교해 다르면 `Bug("store.replay_diverged")`다(opencode v2 "Replay diverged", adr.0004 §3.2 8번).

### 4.6 커밋 뒤 방출

- 내구 이벤트는 COMMIT이 성공한 뒤에만 방출한다(`architecture.runtime-flow.design` §4.1 끝 항목, §5). 커밋한 그 JS 턴 안에서 동기로 `onCommit`·`subscribe` 리스너를 부른다. 그래서 리스너는 seq 순서대로 받는다(`eng.transactions.design` §4.5).
- 리스너 예외는 잡아서 운영 로그에 남긴다. 커밋 결과에 영향을 주지 않고, 다른 리스너는 같은 배치를 받는다.
- 리스너 안의 동기 `commit`은 `store.nested_write`다(TX-09). 쓰기가 필요하면 `queueMicrotask`로 미룬다.
- `replayed: true` 결과는 방출하지 않는다. 처음 커밋 때 이미 방출했다.
- `subscribe(afterSeq, …)`는 `afterSeq`부터 head까지 `feed.read`로 읽어 넘긴 뒤 같은 동기 구간에서 실시간 리스너를 등록한다. 따라잡기와 실시간 사이에 빈칸과 중복이 없다(`eng.events.design` §4.6).
- 다른 프로세스가 쓴 이벤트는 실시간 알림이 없다. 관찰 쪽 따라잡기(폴링)는 호스트가 `feed.headSeq()`로 한다(`L4.host-service.spec` HS-16).
- 휘발 이벤트(`emitVolatile`)는 저장소를 거치지 않고 `onVolatile` 리스너에 바로 전달한다.

### 4.7 결과 불명

#### 4.7.1 호출하는 쪽

| 일 | 하는 쪽 | 근거 |
|---|---|---|
| 열린 효과 찾기(`p_effects`에서 `result_seq IS NULL`) | core-persistence `recover` | `F.records.spec` §4.5 2번 |
| `decideEffectRecovery` 호출(상한 포함 `decideOpenEffect`) | core-persistence `recover` | 이 문서 §3.7 |
| `synthesize` 결과 커밋(`effect.result{synthesized:true}` + toolResult `item.recorded{isError:true}`, 본문 `OUTCOME_UNKNOWN_TEXT`·`NOT_STARTED_TEXT`) | core-persistence `recover` | `F.records.spec` §4.5 3번 |
| `rerun` 실행(`ToolService.rerun(intent, run)`) | core-loop(재개 실행자) | `L1.tools.spec` §4.9. §4.8.2 이유 |
| 컨텍스트 조립 안전망 합성(저장하지 않음) | core-context | `eng.transactions.design` §5.2 마지막 항목 |

- [제안] `L1.tools.spec` §4.9는 "L1.persistence가 `ToolService.rerun`을 부른다"고 적었다. session-core 컨텍스트는 `xeon.store`만 부른다는 규칙(`eng.context-map.design` §4.1 (d)열)에 맞추어, 계획(`ResumePlan.reruns`)은 이 문서가 내고 호출은 core-loop가 하도록 바꾼다(§8.4).

#### 4.7.2 저장하는 합성과 저장하지 않는 합성

| 구분 | 언제 | 저장 | 문장 |
|---|---|---|---|
| 복구 합성 | 쓰기 소유자가 `recover`할 때, 열린 효과마다 | 예. `effect.result{synthesized: true, output: null}` + toolResult item 한 커밋 | `NOT_STARTED_TEXT`(exec 없음, status `abandoned`), `OUTCOME_UNKNOWN_TEXT`(exec 있음 또는 상한 초과, status `interrupted`) |
| 조립 안전망 | 컨텍스트 조립 때 toolCall에 짝 toolResult가 없을 때 | 아니오. 메모리에서만 | `L1.context.spec`이 정한다. `OUTCOME_UNKNOWN_TEXT`를 쓰기를 권한다 [제안] |

- 안전망이 쓰이는 경우는 저장소에 복구가 아직 없는 상태다. 관찰 열기(복구를 하지 않는다), 읽기 전용 열기, 재개 전 화면 표시, 그리고 의도 전에 끝난 toolCall(아래 4.7.4)이 재개되기 전이다.
- pi의 "No result provided" 합성은 효과 가능성을 알리지 않아 쓰지 않는다(`F.records.spec` §3.5, durable spec 1917-1927).

#### 4.7.3 재실행과 상한

1. [결정] 재실행은 저장된 `intent.replay`와 현재 선언이 모두 `safe`일 때만 한다(adr.0004 §3.2 3번, durable spec 2082-2108, 3136-3170 "Recovery does not let a changed registry declaration alter the stored replay policy").
2. [제안] 재실행 횟수는 `effect.exec` 건수로 센다. 첫 실행이 `effect.exec` 1건이고 재실행마다 1건이 더 붙는다. 재실행 수 = `max(0, execCount - 1)`이다. `MAX_REPLAY_ATTEMPTS`(2)에 이르면 다음 판정은 `outcome_unknown` 합성이다. 별도 kind(`tool.replay_started`)를 두지 않는다. `L1.tools.spec` §10 [미결] "재실행 시도 횟수 기록 방식"에 대한 이 문서의 답이다.
3. 재실행의 `effect.exec` 커밋 키는 `tool:<toolCallId>:exec:<attempt>`다(attempt는 1부터). 첫 실행 키 `tool:<toolCallId>:exec`와 달라야 재실행 표시가 `replayed`로 사라지지 않는다. `ToolRunContext`에 attempt를 넘기도록 `L1.tools.spec`에 요청한다(§8.4).
4. 재실행 결과의 `effect.result` 커밋 키는 처음과 같은 `tool:<toolCallId>:result`다. 그래서 효과마다 종결 기록은 하나다(`eng.transactions.design` §5.1 불변식 2).
5. 재생 때 `tool_call` 지점을 다시 실행하지 않는다. 의도가 커밋된 호출은 저장된 최종 인자로만 실행한다(durable spec 3162-3163 "Recovery does not rerun `beforeTool` and passes the same stored arguments", `architecture.runtime-flow.design` §4.2 "재생 시 도구 지점" 행).
6. `safe` 재실행이어도 외부 효과의 멱등성은 도구 몫이다(`F.records.spec` §3.5, durable spec 2936-2940).

#### 4.7.4 의도 없는 도구 호출

- assistant item에 toolCall이 있고 그 `toolCallId`의 `effect.intent`가 없으면 효과는 일어나지 않았다(TX-02: 의도 없이 실행하지 않는다). 승인 대기 중이었거나, 정책 판정 전이었거나, 의도 커밋 직전에 끝난 호출이다.
- `recover`는 이 호출들을 `ResumePlan.pendingToolCalls`에 넣는다. 재개 실행자(core-loop)는 `runTurn({ kind: "tools" })`로 들어가 `xeon.tools`의 `prepare`·`execute` 단계 계약으로 정상 파이프라인을 다시 지난다(L1.tools.spec §3.3, adr.0009). 이때 `tool_call` 지점과 정책은 다시 실행된다. 의도 전이므로 다시 실행해도 된다(`F.extensions.spec` §4.3 재생 계약, durable spec 2636-2660 "a crash before the consuming commit may rerun them").

### 4.8 재개 절차

#### 4.8.1 단계 표

`architecture.runtime-flow.design` §4.4 흐름도를 L1 관점의 단계로 옮긴다. 흐름도의 분기 그림은 runtime-flow가 정본이고, 이 표는 단계마다 누가 무엇을 쓰는지만 정한다.

| # | 단계 | 하는 쪽 | core-persistence가 쓰는 것 | 근거 |
|---|---|---|---|---|
| 1 | 세션 임대 획득: OS 잠금 + `sys_leases` 행(`session:<threadId>`), 결과는 `LeaseToken`. 실패하면 4.9 | L4 host(`SessionLockPort`) → L0.process, L0.store `leases.acquire` | 없음 | adr.0006 §3.6 1·3번, `L0.store.spec` §3.1 |
| 2 | 쓰기 열기: 토큰 확인(`leases.holds`), 버전 검사(§4.12), 투영 재생성(§4.5.3) | `openForWrite(threadId, token)` | 재생성한 투영 테이블 | adr.0006 §3.6 4번(소유 표시는 `sys_leases`, §3.6) |
| 3 | 복구 표식 확인: `p_threads.open_turn_id`, `running_since`, `resume_attempts` | `openForWrite`가 `OpenReport.marker`로 돌려준다 | 없음 | adr.0006 §3.6 5번 |
| 4 | 마지막 `checkpoint.step`에서 복원: `loadCheckpoint` + `leafEventId` 뒤 활성 가지 이벤트 | `recover`가 읽고, 루프 상태 재구성(`reduceLoopState`)은 core-loop | 없음 | `F.records.spec` §4.5 1번, `eng.events.design` §7.2 |
| 5 | 취소 의도 확인: 열린 turn에 `turn.abort_requested`(또는 `isCancelledByOwner`). 소유 자식 thread 정착 판정: 열린 turn이 소유한 `p_agents` 행 중 `settled_seq`가 비어 있는 것을 `ResumePlan.openChildren`에 싣는다 | 판정 함수는 core-tasks, 표시는 `ResumePlan.abortRequestedTurn`. 자식 재개는 core-agents(같은 requestId, L1.agents.spec §4.5) | 없음 | `eng.transactions.design` §6.2 7번, `L1.tasks.spec` §4.8 3번 |
| 6 | 열린 효과 처리: `decideOpenEffect`. `synthesize`는 커밋, `rerun`은 계획 | `recover`(판정·합성), core-loop(재실행) | 합성 `effect.result` + toolResult item | §4.7 |
| 7 | 승인 대기 복원: 미해결 `approval.requested`와 `waiting: "approval"` 호출 | `recover`가 목록, core-tools `ApprovalService.restore`가 메모리 대기 | 없음 | durable spec 1898-1915, `L1.tools.spec` §4.7 |
| 8 | 입력 큐 복원: `p_inputs`의 queued 행 | `recover`가 목록, core-tasks `peek`가 같은 투영을 읽는다 | 없음 | `L1.tasks.spec` §4.8 |
| 9 | 후보 제시 또는 자동 재개 판정(`AutoResumeVerdict`) | `recover`가 판정 값, 호스트가 실행 여부 결정 | 없음 | adr.0006 §3.6 5번 |
| 10 | 이어서 실행: `beginResume` → `thread.resumed` 커밋 → core-loop가 `next`에서 계속 | core-loop | `thread.resumed` | 이 문서 §3.9 |

- 5단계에서 취소 의도가 있으면 열린 자식 thread도 재개하지 않는다. 자식의 취소 의도는 소유 사슬에서 도출한다(`L1.tasks.spec` §4.8 3번).
- 5단계가 참이면 6단계의 판정은 `rerun`을 내지 않는다. 취소 의도가 있는 turn의 열린 효과는 재실행하지 않고 `outcome_unknown`·`not_started`로 닫는다(`eng.transactions.design` §6.2 7번). 이어서 core-loop가 `turn.completed{status:"interrupted"}`를 커밋한다. 9단계의 판정은 `abort_requested`다.
- 2~9단계는 실행을 시작하지 않는다(adr.0006 §3.1, durable `Harness.open` "Dispatches nothing", `_research/process.md` §1.1). 호스트 기동 순서의 "열 때 복구"(`L4.host-service.spec` §4.1 7단계)가 2~9단계다.
- 복구 표식은 별도 쓰기 없이 이벤트에서 나온다. `turn.started` 커밋이 `running_since`를 세우고, `turn.completed`(정상 종료, 사용자 중단, 실패 모두)가 지운다. 비정상 종료 뒤에는 열린 turn이 남아 표식이 남는다. `architecture.runtime-flow.design` §4.1의 "복구 표식 running_since 커밋"은 C2 커밋에 포함된다.

#### 4.8.2 컨텍스트 경계

- [제안] core-persistence는 `xeon.store`만 부른다(`eng.context-map.design` §4.1 (d)열). 그래서 재개의 실행 단계(재실행, 승인 대기 메모리 복원, 루프 계속)는 core-loop가 `ResumePlan`을 받아 한다. 확장 지점 발화(§7)에는 `xeon.ext`가 필요하므로 (d)열에 `xeon.ext`를 더하도록 요청한다(§8.4).
- `recover`가 현재 도구 선언을 알아야 하는 부분(`currentReplay`)은 호출자가 넘기는 `toolReplay` 함수로 받는다(§3.7).

#### 4.8.3 자동 재개

- [제안] 기본은 후보 제시다(adr.0006 §3.6 5번, `architecture.runtime-flow.design` §3). 자동 재개는 서비스 모드에서 `l1.persistence.autoResume`이 참일 때만 한다. 기본값은 거짓이다. 기본값 자체는 adr.0006 §6 [미결]이다.
- `AutoResumeVerdict.allowed`는 다음이 모두 참일 때다: 표식이 있다, 설정이 켜졌다, 호스트 모드가 `service`다, `resume_attempts < l1.persistence.maxResumeAttempts`, 취소 의도가 없다.
- `beginResume`도 상한을 검사한다. `resume_attempts >= maxResumeAttempts`면 `attempts_exhausted`다. 수동 재개(사용자가 "이어서 실행"을 고름)도 같은 상한을 쓴다 [제안]. 상한에 이른 thread는 사용자가 새 입력을 넣으면 정상 turn으로 진행한다(열린 turn은 core-loop가 `interrupted`로 닫는다).

### 4.9 잠금 실패

[결정] 잠금을 얻지 못하면 위임, 관찰, 분기 중 하나다(adr.0006 §3.6 3번). 선택지 구성과 wire 오류는 호스트가 한다(`L4.host-service.spec` HS-24, HS-25). L1의 몫은 아래다.

| 선택 | L1 몫 |
|---|---|
| 위임 | 없음. 클라이언트가 서비스에 다시 접속해 같은 thread를 연다 |
| 관찰 | `openForRead`: 버전 검사만 하고 재생성은 하지 않는다(쓰기 소유자가 한다). `role: "observer"`, 커밋은 `read_only{observer}`. 복구는 하지 않는다 |
| 분기 | `threads.fork(threadId, at, newThreadId)`: 현재 활성 가지의 leaf(또는 `at`)에서 새 thread를 만든다. 새 thread는 잠금 없이 만들고(§4.10.1) 호스트가 바로 잠근다 |

- wire 오류는 `thread.locked`(3002, `details: { ownerKind, options }`)다(`F.wire-settings.spec` §3.5.2). `ownerKind`는 `leases.inspect("session:<threadId>")`의 `LeaseOwnerInfo.kind`이고 틀릴 수 있다.
- 하트비트는 L0.store `leases.keepAlive`가 `l0.store.heartbeatMs`(기본 5초)마다 한다(`L0.store.spec` §4). 이 문서는 별도 주기를 두지 않는다. `L4.host-service.spec` HS-29가 이 문서에 맡긴 주기는 L0.store 설정을 가리키도록 요청한다(§8.4).
- 펜싱은 `sys_leases` epoch다(§3.6, §4.1 2단계) [결정: review.decisions-2 U-09]. 임대를 인수당한 이전 소유자(OS 잠금이 없는 후퇴안에서 멈췄다 깨어난 프로세스 등)가 늦게 커밋하면 `leases.holds`가 거짓이라 `ownership_lost`이고 행 변화가 없다(`L0.store.spec` §5 "늦게 깨어난 이전 소유자의 커밋" 행). adr.0004 §3.4는 이 방식으로 개정한다.

### 4.10 분기와 수명주기

#### 4.10.1 생성

- `threads.create`는 `thread.started { title, forkedFrom: null }`을 커밋한다. 요청 thread가 `absent`이고 첫 초안이 `thread.started`인 커밋은 소유 확인을 건너뛴다. 아무도 모르는 id라 다른 쓰기 소유자가 있을 수 없다. 면제 범위는 그 thread의 첫 이벤트 `thread.started` 하나이고, 같은 커밋의 다른 thread 초안(예: 부모의 `agent.spawned`)은 그 thread의 토큰으로 확인한다.
- 생성 멱등 [제안]: `creationKey`가 있으면 쓰기 트랜잭션 안에서 `thread_creation_keys`를 먼저 읽는다. 행이 있으면 아무것도 쓰지 않고 그 `thread_id`로 `ThreadCreated{ replayed: true }`를 돌려준다(입력의 `threadId`는 버린다). 없으면 `thread.started` 커밋과 같은 트랜잭션에서 행을 쓴다. 그래서 호출자가 재시작 뒤 새 `threadId`로 다시 불러도 thread는 하나다. `requests`는 thread 범위(`(thread_id, request_id)`)라 이 일을 하지 못한다. 고아 thread 정리는 호출자가 `creationKey` 조회로 끝낸다(예: `L2.schedule.spec` 재시작 복구).
- 자식 생성과 부모 연결 [결정: L1B.3]. F `ThreadCreateInput`에는 다른 thread의 초안(부모의 `agent.spawned`)을 같은 커밋에 싣는 자리가 없다. 그래서 두 커밋으로 나눈다: (1) 호출자가 `threads.create({ threadId, creationKey: <부모와 자식 requestId에서 만든 키>, inheritOwnerFrom })`로 자식을 만든다. `creationKey`가 같으면 재시도가 같은 자식을 돌려주므로(`replayed: true`) 중복 자식이 생기지 않는다. (2) 부모 대화에 `agent.spawned`를 커밋한다(커밋 안에서 `TxView.agentByRequestId`로 같은 requestId를 먼저 본다). 두 커밋 사이에 죽으면 `p_agents` 행이 없는 자식이 남지만, 재시도가 같은 `creationKey`로 같은 자식을 찾아 (2)를 이어 한다. 한 커밋으로 합치려면 F `ThreadCreateInput`(또는 `ThreadLifecycle`)에 부모 초안을 받는 자리를 더해야 한다 [미결: F 요청]. 같은 (부모, 자식 requestId)의 두 번째 `agent.spawned`가 걸러지지 않고 커밋되면 `p_agents`의 유일 색인이 투영 실패로 커밋 전체를 되돌린다.
- 자식 연결은 이력이다 [결정: L1B.3]. 자식 thread를 `remove`해도 부모의 `agent.spawned`·`p_agents` 행은 남는다(재생성이 같은 행을 다시 만들기 때문이다). 소비자는 죽은 자식의 `thread_not_found`를 처리해야 한다. 부모를 `remove`하면 그 부모의 연결 행은 함께 지워진다.
- `ResumePlan.openChildren`은 열린 turn이 소유한(`owner_turn_id`) 정착하지 않은 자식이다. scope 소유와 소유 turn이 없는 백그라운드 자식은 포함하지 않는다. 열린 turn에 취소 의도가 있으면 비어 있다(§4.8.1 5단계).
- 자식 thread 생성 [제안]: `inheritOwnerFrom`이 있으면 core-persistence가 그 토큰의 holder(같은 엔진 인스턴스)로 `xeon.store.leases.acquire("session:<threadId>", holder)`를 부른 뒤 `thread.started` 커밋을 한다. 새 id라 임대 경합이 없다. 커밋이 실패하면 임대를 반납한다. 얻은 토큰은 `ThreadCreated.token`으로 돌려주고 보관해 이후 그 thread의 커밋 소유 확인에 쓴다. 하트비트(`leases.keepAlive`)도 core-persistence가 걸고, 잃으면(`onLost`) 부모와 같은 처리(그 thread의 메모리 작업 취소)를 호출자에게 알린다. 정착 때 반납은 `release(threadId, …)`다. 재개 때 자식 소유는 `openForWrite(child, token)`으로 다시 얻는다(`L1.agents.spec` §4.1, §4.5). 같은 holder가 엔진 인스턴스마다 하나이므로 holder 값은 조립 루트가 core-persistence에 넘긴다 [가정: 조립 루트 배선은 `L4.host-service.spec`이 정한다].
- `workspace`: `ThreadCreateInput.workspace`는 `thread.started.workspace`(F가 선택 필드로 더했다, FR-P5 반영)에 실려 `p_threads.workspace`로 투영된다. 없으면 null이고 필드를 쓰지 않는다. 멱등 지문에는 workspace가 있을 때만 넣어, 필드가 없던 때의 같은 키 재시도가 `key_reused`가 되지 않게 한다. 투영 규칙이 바뀌어 `CORE_PROJECTOR_VERSION`을 올렸고 다음 열기에서 core가 다시 만들어진다.
- 생성 뒤 `session_start{ reason: "new" }`를 발화한다(재전송이면 발화하지 않는다). `openForWrite`는 읽기 전용이 아닐 때 `session_start{ reason: "startup" }`을, 복구 표식이 남은 thread면 `resume`을 발화한다. 지점 발화는 모두 `SessionPoints`(`points.ts`)를 거치고, tap은 기다리지 않는다(`detach`, 실패는 Logger). `reload`는 엔진 재적재를 아는 호스트의 몫이다.
- 오류 통로가 없는 `list`는 읽기 실패(busy, io, 손상 행)를 Logger에 남기고 빈 쪽을 돌려준다 [제안: F `ThreadLifecycle.list`를 `Result`로 바꾸는 요청]. 커서는 `<updatedAt>:<threadId>` 불투명 문자열이고 해석할 수 없으면 빈 쪽이다.

#### 4.10.2 leaf 이동과 떠난 가지 요약

- `moveLeaf`는 `thread.leaf_moved { leafEventId: target, reason }`을 커밋한다. 기존 가지는 지우지 않는다(`F.records.spec` §4.6 3번). 다음 이벤트의 `parentId`는 `target`이다.
- 대상 검사: `target`이 이 thread의 이벤트가 아니면 `invalid_target{item_not_found}`. 열린 turn이 있으면 `turn_running`. 닫힌 thread는 `thread_closed`, 쓰기 소유자가 아니면 `not_owner`다. 옛 가지의 이벤트로 `restore`할 수 있으므로 활성 가지 위일 필요는 없다. 요약이 없고 target이 이미 leaf면 커밋하지 않는다. 커밋 키는 `leaf:<requestKey>`다.
- [제안] 커밋 전에 `session_before_tree`(first)를 발화한다. 결정이 거부면 `cancelled_by_extension`이다. 커밋 뒤 `session_tree`(tap)를 발화한다.
- 요약 순서와 leaf: 같은 커밋의 초안은 `[thread.leaf_moved, thread.branch_summarized]`다. 요약 이벤트의 `parentId`는 target이라 새 가지에 놓이고, 커밋 뒤 leaf는 요약 이벤트다(요약이 없으면 target). `thread.leaf_moved` 자신은 옛 가지에 남는다. `session_before_tree`의 결정이 요약을 주고 호출자가 요약을 주지 않았으면 결정의 요약을 쓴다(`usage`는 null). `session_tree`(tap)의 `fromExtension`은 null이다 [제안: 결정을 낸 확장 이름은 디스패처가 알려주지 않는다].
- 떠난 가지 요약: `options.summary`가 있으면 `thread.branch_summarized { fromEventId: 이전 leaf, summary, details, usage }`를 같은 커밋에 넣는다(`F.records.spec` §4.6 5번). 요약을 누가 만드는지(모델 호출, 확장 결정의 `summary`)는 `L1.context.spec`의 [미결]이다. 이 문서는 받은 요약을 기록만 한다.

#### 4.10.3 fork

- `fork(threadId, at, newThreadId)`: `at`이 있으면 `query.itemEvent(threadId, at)`, 없으면 현재 leaf를 출처 이벤트로 쓴다. 출처가 활성 가지에 없으면 `invalid_target{not_on_branch}`, item이 없으면 `item_not_found`다. `session_before_fork`의 `itemId`는 `at`, 없으면 활성 가지의 마지막 item이다(`position: "at"`). 쓰기 소유자가 아니어도(관찰 열기) 새 thread를 만들 수 있다. 새 thread에는 출처의 제목과 workspace를 옮긴다. 새 thread의 소유 잠금은 호출한 호스트가 얻는다.
- 커밋 전 `session_before_fork`(first)를 발화하고, 거부면 `cancelled_by_extension`이다.
- 새 thread의 첫 이벤트 `thread.started { title, forkedFrom: { threadId, eventId } }`를 커밋한다. 출처 이벤트를 복사하지 않는다. 컨텍스트 조립은 출처 thread의 `eventId`까지 활성 사슬을 앞에 잇는다(`eng.events.design` §6) [제안]. pi durable `session/forks.ts`(97줄)는 대화 문서를 fork 시점(`asOf`)과 현재(`current`) 정책으로 복사한다. Xeon의 문서 대응물은 scope 상태 이벤트이므로, 새 thread의 scope 상태는 X가 출처 thread의 `x|grp.<name>.state.committed`를 `at` 시점으로 읽어 새 thread에 다시 커밋한다 [가정: X.primitives.spec이 정한다].
- 커밋 뒤 `session_start{ reason: "fork", previousThreadId: threadId }`를 새 thread에 발화한다.

#### 4.10.4 revert

- `revert(threadId, to, requestKey)`: `to` item을 기록한 이벤트로 leaf를 옮긴다(`thread.leaf_moved{reason: "rewind"}`). `to`는 남는 마지막 item이다 [제안]. 검사 순서: 소유자, 닫힘, 열린 turn, item 존재, 활성 가지 소속, 열린 효과, turn 안 위치. 이미 그 leaf면 커밋하지 않는다. 커밋 키는 `revert:<requestKey>`다.
- 대상 제한: `to`가 user item, toolCall이 없는 assistant item(`stop_reason`이 `toolUse`가 아님), 또는 turn의 마지막 item이어야 한다. 그 밖이면 `invalid_target{inside_turn}`. 열린 효과가 있으면 `open_tool_calls`, 진행 중 turn이 있으면 `turn_running`(wire 3003)이다.
- 커밋 전후 발화는 `moveLeaf`와 같다(`session_before_tree`, `session_tree`).
- 파일은 되돌리지 않는다. 파일 복원은 2차 되감기(§4.13.2)다.

#### 4.10.5 close, delete, 제목

- `close`: `thread.closed { reason }`을 커밋한다. 커밋 키는 `thread:<id>:close`, 지문은 이유와 무관해 두 번째 호출은 처음 결과를 돌려준다(이벤트 1개). 쓰기 소유자만 부르고(`not_owner`), 열린 turn이 있으면 `turn_running`이다. 이후 그 thread의 커밋은 `build`의 `view.threadStatus === "closed"` 검사로 생산 spec이 거부한다(`reject("thread_closed")`). wire `thread.close`는 연결의 열기 기록을 지우는 일이라 이 API와 다르다(`L4.host-service.spec` §3.4). thread 종결을 wire로 노출할지는 [미결]이다.
- `remove`: 쓰기 소유자만 한다. 한 트랜잭션에서 `thread_delete_guard`에 행을 넣고, `events`, `requests`, 모든 투영기 테이블의 그 thread 행, 그 thread를 가리키는 `thread_creation_keys` 행을 지우고, 표지 행을 지운다. 세션 임대 행은 L0.store 소유라 지우지 않고 `release`로 반납한다. `consumer_cursors`는 건드리지 않는다. 다른 thread의 `forked_from_thread`가 이 thread면 `has_forks`로 거부한다 [제안]. 지운 seq는 다시 쓰지 않는다(`event_seq`). 지운 뒤 커밋 뒤 방출은 없다. 화면 갱신은 wire `thread.delete` 응답으로 한다.
- `setTitle`: 커밋 키는 `title:<requestKey>`다. L2 artifacts가 `xeon.session`의 이 API를 부르고, 이벤트 `thread.updated { title }`은 core-persistence가 쓴다(`eng.context-map.design` §4.4 4번). 커밋 뒤 `session_info_changed`(tap, detached)를 발화한다.

#### 4.10.6 wire 메서드와 L1 구현 책임

`F.wire-settings.spec` §3.3.1의 thread 메서드다. 처리기는 호스트에 있다(`L4.host-service.spec` §3.4).

| 메서드 | 단계 | 호스트 처리 | L1.persistence 몫 | L1 오류 → wire |
|---|---|---|---|---|
| `thread.create` | M1 | 새 id 발급, 잠금 | `threads.create`, `openForWrite`, `session_start{new}` | 없음 |
| `thread.list` | M2 | 결과 변환 | `threads.list`(`p_threads`) | 없음 |
| `thread.open` | M2 | `write`면 잠금, 실패면 3002 | `openForWrite` 또는 `openForRead`, `recover`(write), `session_start{resume\|startup}` | `thread_not_found` → 3001 |
| `thread.close` | M2 | 열기 기록 삭제, 잠금 해제 조건 | `release`(`session_shutdown`) | 3001 |
| `thread.delete` | M2 | 소유 확인 | `threads.remove` | `has_forks` → [미결] 새 오류 kind(FR-P6), `not_owner` → 3002 |
| `thread.fork` | M2 | 새 id, 잠금 | `threads.fork` | `cancelled_by_extension`·`invalid_target` → [미결] FR-P6, 3001 |
| `thread.revert` | M2 | 소유 확인 | `threads.revert` | `turn_running` → 3003, `not_owner` → 3002, `invalid_target` → [미결] FR-P6 |

- `ThreadSummary`(`thread.list` 원소)는 F `threadSummaryOf(row)`가 `ThreadSummaryRow`(§3.4)에서 만든다(`F.wire-settings.spec` §3.3.1, m2-plan F.6). 호스트는 `threads.list`와 `query.thread`의 행을 이 함수로만 wire로 옮기고, 시각(ms)이 Date 범위 밖이면 함수가 돌려주는 오류 값을 처리한다. 후보 표시(`marker`)가 있으면 호스트가 "이어서 실행" 후보를 알릴 수 있다(`L4.host-service.spec` HS-30).
- 소유 잠금 오류는 `thread.locked`(3002)다. L1은 이 오류를 만들지 않는다. L1의 `ownership_lost`·`not_owner`를 호스트가 3002로 바꾼다.

### 4.11 큰 값 분리의 경계

| 일 | 하는 쪽 |
|---|---|
| blob 파일 쓰기(임시 파일, fsync, rename), 읽기, 위치, GC 실행 | L0.store(`xeon.store.putBlob`, `readBlob`) |
| 명시 필드(`effect.intent.args`, `effect.result.blobRef`)에 `BlobRef` 넣기 | 생산자(core-tools 등) |
| 큰 문자열 분리: `blob:sha256:<hex>` 자리표시 + `detached` | core-persistence `detachLarge(draft)`(커밋 전, 트랜잭션 밖) |
| 되돌리기: `detached`를 읽어 문자열을 채운 사본 | core-persistence `hydrate(event)` |
| 참조 중인 해시 목록 | core-persistence `p_blob_refs`, `query.liveBlobRefs()` |

- [제안] `detachLarge`는 payload 안의 문자열 중 64 KiB 이상인 것을 큰 것부터 옮겨 envelope가 256 KiB(`ENVELOPE_MAX_BYTES`) 이하가 될 때까지 반복한다. payload 스키마 검사는 분리 전 값으로 한다(`F.records.spec` §3.4 규칙 5).
- `hydrate`에서 blob 파일이 없으면 `DetachedField` 위치에 자리표시를 남긴 사본과 함께 진단 오류를 낸다. 처리 정책은 `L0.store.spec`이 정한다(`F.records.spec` §5).
- [미결] GC 뿌리 집합 전달: L0.store는 L1을 부를 수 없다. 조립 루트(L4 host)가 `query.liveBlobRefs()`를 L0.store GC에 넘기는 방식을 제안한다. `L0.store.spec`과 정한다.

### 4.12 스키마 버전과 업캐스터

- DB 스키마 버전(`user_version`, `sys_migrations`)은 L0.store가, kind별 payload `version`은 이 문서가 다룬다(`F.records.spec` §3.7 규칙 1).
- 업캐스터 등록부(`UpcasterRegistry`)는 `CORE_EVENT_CATALOG`와 `EventKindRegistry`의 `upcasters`로 열 때 만든다. 투영기와 `readFrom`·`readBranch`·`subscribe`가 넘기는 이벤트는 모두 `upcastEvent`를 거친다. 저장된 행은 바꾸지 않는다.
- 열 때 검사(`openForWrite`, `eng.events.design` §8.3):

| 경우 | 동작 |
|---|---|
| 코어 kind인데 카탈로그에 없음(`unknown_kind`) | 쓰기 모드로 열지 않는다. `read_only{unknown_event_kind}` |
| 카탈로그보다 높은 `version`(`future_version`) | `read_only{newer_event_version}` |
| 업캐스터 누락(`missing_upcaster`) | Bug. 코드 결함이다 |
| 등록되지 않은 확장 kind | 쓰기 모드로 연다. 코어 투영기는 건너뛴다. 그 확장 투영기는 없으므로 갱신되지 않는다 [제안: `F.records.spec` §10 미결 5] |
| 설치된 확장보다 높은 확장 `version` | 쓰기 모드로 연다. X가 그 확장을 이 thread에서 끈다(`eng.events.design` §8.3) |

- 검사는 `events_thread_kind` 인덱스로 thread의 서로 다른 `(kind, version)` 쌍만 훑는다.
- `StepCheckpoint.schemaVersion`이 `STEP_CHECKPOINT_SCHEMA_VERSION`과 다르면 그 체크포인트를 버리고 이벤트에서 복원한다(`eng.events.design` §5.1 7번).

### 4.13 2차 항목

#### 4.13.1 리플레이 커서

- `events.subscribe { from: StreamPosition | "head" }`의 seq 커서 재전송은 호스트가 실행한다(`F.wire-settings.spec` §3.4.3). L1은 `feed.headSeq`, `feed.oldestReplayableSeq`, `feed.read`, `feed.onCommit`을 제공한다. M1에서 이 네 메서드는 이미 있다. 2차(M3) 몫은 로그를 잘라 낼 때(보관 정리) `oldestReplayableSeq`를 올리는 일과 재개 때의 `replayFrom` 의미다.
- [제안] `replayFrom` 의미(ACP v2 `replayFrom`, `_research/item-catalog.md` L1-f "세션 재개 시 리플레이 커서"):
  - `"none"`: 재개 뒤 실시간 이벤트만. `from: "head"`.
  - `{ storeId, seq }`: 그 위치 뒤부터 재전송. 클라이언트가 마지막으로 받은 위치다.
  - `"all"`: 그 thread의 첫 이벤트부터. `from: { storeId, seq: p_threads.first_seq - 1 }`, `filter.threadIds = [threadId]`.
- `thread.open` params에 `replayFrom`을 둘지는 F 결정이다(FR-P7).

#### 4.13.2 되감기(파일 스냅샷 복원)

- [제안] 읽기 자료: opencode `packages/core/src/snapshot.ts`(244줄, git 기반 콘텐츠 주소 트리, 미추적 파일 2 MiB 상한 136행), `packages/core/src/session/revert.ts`(114줄, `stage`·`clear`·`commit` 22·60·77행). Claude Code는 프롬프트마다 Write·Edit 대상만 스냅샷한다(`_research/refs/claude-code.md` 195행). 코드는 가져오지 않는다.
- 스냅샷: turn 안에서 쓰기 계열 도구(`L1.tools.spec` `classes`의 쓰기 분류)가 어떤 파일을 처음 건드리기 직전에 그 파일의 이전 내용을 blob으로 넣고, 그 효과의 `effect.intent` 커밋에 `checkpoint.files { turnId, files: FileSnapshotEntry[] }`를 함께 넣는다. kind는 F 요청이다(FR-P8).
- 복원: `RewindPlan`을 만들고 파일 복원을 효과 3단(`effect.intent` → 파일 쓰기 → `effect.result`, 도구 이름 `rewind`, `replay: "safe"`)으로 기록한 뒤 `thread.leaf_moved{reason: "rewind"}`를 커밋한다. 파일 쓰기는 트랜잭션 밖이다(TX-04). 파일 복원은 이벤트 가지와 별개의 외부 효과다(`eng.events.design` §6 끝 항목).
- 한계(문서화 대상): Bash와 셸 명령으로 바뀐 파일, 서브에이전트가 다른 작업 공간에서 바꾼 파일, 외부 프로그램의 변경, 심볼릭·하드 링크는 추적하지 않는다. `RewindPlan.untracked`에 그 turn에서 실행된 셸 효과의 존재만 알린다. 같은 한계를 Claude Code도 문서에 적었다(`_research/refs/claude-code.md` 195행, 354행).

#### 4.13.3 JSONL 내보내기

- [결정] 세션을 JSONL로 내보내는 명령을 둔다(adr.0004 §3.2 7번). 명령 이름은 `L4.cli.spec`이 정한다.
- [제안] 기본 형식 `pi-jsonl`은 pi 세션 JSONL v3(`coding-agent/src/core/session-manager.ts:41` `CURRENT_SESSION_VERSION = 3`)과 호환을 목표로 한다. 대응:

| Xeon | pi 엔트리(`session-manager.ts:43-195`) |
|---|---|
| `thread.started` | 첫 줄 `{ type: "session", version: 3, id, timestamp, cwd, parentSession? }`. `cwd`는 workspace, `parentSession`은 `forkedFrom.threadId` |
| user·assistant·toolResult·system `item.recorded` | `{ type: "message", id, parentId, timestamp, message }` |
| custom `item.recorded` | `{ type: "custom_message", customType, content, details, display }` |
| `thread.compacted` | `{ type: "compaction", summary, firstKeptEntryId, tokensBefore, details, usage, fromHook }` |
| `thread.branch_summarized` | `{ type: "branch_summary", fromId, summary, details, usage }` |
| `thread.updated{title}` | `{ type: "session_info", name }` |
| `settings.changed`(모델, 추론 수준) | `model_change`, `thinking_level_change` |
| 확장 kind(`x.*`, `grp.*`) | `{ type: "custom", customType: kind, data: payload }` |
| `effect.*`, `checkpoint.step`, `input.*`, `approval.*`, `scope.*`, `lease.*` | 내보내지 않는다(pi에 대응 엔트리 없음). `xeon-jsonl`에만 싣는다 |

- 엔트리 `id`·`parentId`는 내보내는 엔트리끼리의 사슬로 다시 잇는다. 내보내지 않는 이벤트를 건너뛰면 다음 엔트리의 `parentId`는 내보낸 가장 가까운 조상이다. `timestamp`는 `recordedAt`의 ISO 문자열이다.
- `xeon-jsonl`은 업캐스트한 envelope를 seq 순서로 줄마다 쓴다. 디버깅용이다.
- 내보내기 전 민감 정보 경고 확인 단계를 둔다(`_research/settings.md` §2.8). 비밀은 기록 규칙상 참조만 있다(`F.records.spec` §3.3).
- 가져오기(`/import`, pi JSONL → Xeon thread) 지원 여부는 [미결]이다.

### 4.14 종료 지점과 재시작 불변식

`eng.transactions.design` §5.4의 K1~K6을 F 이름으로 옮긴다. 각 행은 `L1.persistence.plan`의 장애 주입 테스트 하나다.

| 종료 지점 | 재시작 뒤 저장 상태 | `recover` 결과 | 성립해야 하는 불변식 |
|---|---|---|---|
| K1 스트리밍 중(C3 전) | 이 단계의 assistant item 없음 | 효과 없음, `next: "request"` | 부분 스트림 행 없음. 같은 단계 요청을 다시 보낸다 |
| K2 E1 뒤, E2 전 | intent만 | safe·safe면 `reruns`, 아니면 `not_started` 합성 | 효과마다 `effect.result` 0 또는 1. 합성은 `synthesized: true`, `status: "abandoned"` |
| K3 실행 중(E2 뒤) | intent + exec | safe·safe이고 상한 안이면 `reruns`, 아니면 `outcome_unknown` 합성 | 합성은 `status: "interrupted"`. `tool_call` 지점 발화 0회 |
| K4 실행 끝, E3 전 | intent + exec(효과는 났음) | K3과 같다 | K3과 같다 |
| K5 E3 뒤, 방출 전 | 종결됨 | 효과 없음 | 구독자는 `readFrom`으로 따라잡는다. 같은 키 재시도는 `replayed` |
| K6 C6 전, 모든 효과 종결 | 열린 turn, 표식 남음 | `next`는 체크포인트 값, 후보 또는 자동 재개 | seq는 끊김 없이 이어진다(새 seq = 직전 최대 + 1) |
| C7 뒤, 다음 단계 시작 전(컴팩션 직후 끊김) | `thread.compacted`와 새 접두 system item 있음, 이 단계의 `step.completed` 없음 | `next: "request"`(마지막 체크포인트 값 그대로) | 같은 단계 요청을 컴팩션 뒤 가지로 다시 보낸다. 같은 키(`compact:<threadId>:<stepId>:<reason>`)의 컴팩션은 다시 커밋되지 않는다 |

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| `busy`(busy_timeout 초과) | `err({ kind: "busy" })`. 쓰기 없음. 같은 `CommitRequest`로 재시도(TX-05) |
| `disk_full` | `err({ kind: "disk_full" })`. 쓰기 없음 |
| 커밋 중 임대를 잃음(`leases.holds(tx, token)` 거짓) | 롤백, `ownership_lost`. 호출자는 그 thread의 메모리 작업을 취소한다 |
| 같은 `creationKey`로 `threads.create`를 다시 부름 | 쓰기 없음. 처음 thread로 `replayed: true` |
| 관찰로 연 thread에 커밋 | `read_only{observer}` |
| 같은 키, 다른 지문 | `key_reused`. 운영 로그 |
| `build`가 던짐 | Bug로 다시 던진다. 롤백. `requests`에 남지 않는다 |
| 소유하지 않은 kind로 초안 | `ProducerHandle.draft`가 `store.prefix_not_owned` |
| 등록 안 된 kind, payload 스키마 위반 | `store.kind_unregistered`, `store.schema_invalid`, 롤백 |
| envelope 256 KiB 초과 | `store.event_too_large`, 롤백. `detachLarge`를 빠뜨린 생산자 결함 |
| checkpoint가 있는데 `step.completed`도 승인 대기도 아님 | `store.checkpoint_without_step` |
| 확장 투영기 예외 | 롤백, `onFailure` 알림, Bug 다시 던짐(§4.5.2) |
| 다른 확장 접두 테이블을 쓰는 문장(디버그 빌드) | `store.prefix_not_owned`, 롤백 |
| 리스너 안에서 `commit` | `store.nested_write` |
| 코어 kind 모름, 버전이 더 높음 | 쓰기 열기 거부, `read_only` |
| 체크포인트 schemaVersion 불일치 | 체크포인트를 버리고 이벤트에서 복원 |
| 재실행 상한 초과 | `outcome_unknown` 합성 |
| 도구가 사라진 뒤 재개(`toolReplay`가 null) | `unsafe`와 같게 처리(`F.records.spec` §5) |
| 재개 횟수 상한 | 자동 재개 안 함. `beginResume`은 `attempts_exhausted` |
| fork 출처가 활성 가지 밖 | `invalid_target{not_on_branch}` |
| 포크가 가리키는 thread 삭제 | `has_forks` |
| 확장이 `session_before_fork`·`session_before_tree`에서 거부 또는 예외 | `cancelled_by_extension`(first fold의 fail-closed, `F.extensions.spec` §4.1 2번) |
| blob 파일 없음(`hydrate`) | 자리표시를 남긴 사본 + 진단 |
| 청크 재생성 중 열기 | 쓰기 열기 거부(`core_projection_stale`), 관찰 열기는 허용 |

## 6. 설정 노출

### 6.1 키

[제안] `SettingDef` 규칙 D1~D9를 따른다(`F.wire-settings.spec` §3.8.2). 탭은 `sessions`다(`L4.settings-ui.spec` 탭 표의 `sessions` 행). 저장 설정(WAL, synchronous, busy_timeout)은 `L0.store.spec`이 노출한다(`F.records.spec` §6).

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | widget | 단계 | 뜻 |
|---|---|---|---|---|---|---|---|---|
| `l1.persistence.retention.maxAgeDays` | integer | `0` | min 0, max 3650 | `live` | `managed`, `user` | `number`, unit "일" | M2 | 마지막 갱신 뒤 이 일수가 지난 thread를 지운다. 0이면 지우지 않는다 |
| `l1.persistence.retention.maxCount` | integer | `0` | min 0, max 100000 | `live` | `managed`, `user` | `number` | M2 | thread 수 상한. 넘으면 오래된 것부터 지운다. 0이면 상한 없음 |
| `l1.persistence.autoResume` | boolean | `false` | - | `restart` | `managed`, `user` | `toggle` | M3 | 서비스 모드에서 열 때 표식이 남은 thread를 자동 재개한다 |
| `l1.persistence.maxResumeAttempts` | integer | `3` | min 1, max 20 | `live` | `managed`, `user` | `number`, unit "회" | M1 | 한 turn의 재개 시도 상한(수동·자동 공통) |
| `l1.persistence.export.format` | string | `"pi-jsonl"` | enum `pi-jsonl`, `xeon-jsonl` | `live` | `managed`, `user`, `session` | `select` | 2차 | 내보내기 기본 형식 |

- 보관 정리 규칙 [제안]: 정리는 엔진 열기 때 한 번 돈다(조립 루트가 `createSessionService`가 돌려주는 `SessionServiceImpl.retention.prune()`을 부른다. `preview()`는 지우지 않고 대상만 돌려준다). 기간(`maxAgeDays`)에 걸린 것을 먼저 고르고, 남은 수가 `maxCount`를 넘으면 오래된 것부터 더 고른다. 한 라운드에서 포크가 지워져도 그 원본은 계획 때 포크가 가리키고 있었으므로 다음 라운드에 지운다. 대상에서 빼는 것: 표식이 남은 thread, 열린 turn이 있는 thread, 다른 thread가 포크로 가리키는 thread, 지금 쓰기 소유 중인 thread. 화면은 삭제 대상 수 미리보기와 복구 불가 경고를 보인다(`_research/settings.md` §2.8). 삭제는 `threads.remove`와 같은 경로다.
- 자동 재개 키는 `l1.persistence.autoResume`, `l1.persistence.maxResumeAttempts` 둘만 둔다. L0.process·L4.host-service는 자기 자동 재개 키를 두지 않고 이 두 키를 읽는다 [결정: review.decisions-2 S-03].
- 화면: `sessions` 탭 "세션과 컨텍스트". 명령: `xeon config get/set/reset l1.persistence.<이름>`(`L4.cli.spec`). 파일: 사용자·관리 설정 파일.

### 6.2 세션 범위 값과 설정 파일

```ts
// xeon/packages/contracts/src/records/session-service.ts (계속)  [제안: FR-P1]
import type { ScopeLayer, SettingKey } from "../settings/index.ts";

export interface SessionSettingsStore {
  /** session 범위 층. resolveSetting의 ScopeStack에 넣는다(F.wire-settings.spec §3.9) */
  layer(threadId: ThreadId): ScopeLayer;
  /** checkSettingWrite 통과 뒤 settings.changed 커밋. 비밀 키는 SecretRef만 */
  set(threadId: ThreadId, key: SettingKey, value: JsonValue, requestKey: string): Result<void, StoreError>;
  /** settings.changed { value: null } 커밋 */
  reset(threadId: ThreadId, key: SettingKey, requestKey: string): Result<void, StoreError>;
}
```

- session 범위 값은 `settings.changed{scope:"session"}` 이벤트로 남고, `layer(threadId)`가 활성 가지 위 이벤트를 seq 순으로 접어 돌려준다. 분기·되감기·재개를 따라간다. 이벤트 순서로 쌓는 투영 테이블(`p_settings`)은 버려진 가지의 값을 담을 수 있어 두지 않는다 [결정: L1B.2]. 도구 호출마다 읽으므로 thread별 캐시를 두고(leaf가 앞으로만 나아갔으면 새 이벤트만 접고, 되감기·가지 이동이면 처음부터 다시 접는다) thread를 지우면 버린다.
- `set`·`reset`의 커밋 키는 `settings:<requestKey>`다. 같은 키에 다른 값을 내면 호출자 결함이라 `Bug("store.schema_invalid")`다. 쓰기 소유자가 아니면 `ownership_lost`다. `layer`는 오류 통로가 없다(F 계약): 읽을 수 없으면 비어 있는 층을 돌려주고 Logger에 남긴다 [제안: F에 `Result` 요청].
- [제안] 설정 파일 범위(`managed`, `user`, `project`, `local`)의 파일 위치, 읽기, 감시, 쓰기, 병합 실행은 `L4.host-service.spec`이 소유한다. `F.wire-settings.spec` §1.2는 이 일을 `L1.persistence.spec`과 `L4.host-service.spec`에 [가정]으로 넘겼다. session-core 컨텍스트는 `xeon.store`만 부르므로(§4.8.2) 파일 시스템과 OS 디렉터리(L0.os)를 쓸 수 없다. 그래서 이 문서는 session 범위만 맡는다. 프로젝트 설정의 신뢰 전 적용 제외 규칙(`X.loading-trust.spec` §4.7.4)과 파일 이름(`.xeon/settings.json`, `.xeon/settings.local.json`)도 파일 범위 소유자의 일이다. `L4.host-service.spec`의 `SettingsStorePort` 대응([가정])과 `X.loading-trust.spec`의 기대를 바꾸는 요청이므로 [미결]로 둔다(§10).

## 7. 확장 지점

### 7.1 발화 지점

이 문서가 발화하는 지점은 7개다(`L1.readme` §6 소유표). 페이로드·반환·fold·실패 규칙은 `F.extensions.spec` §3.4 표와 §3.5가 정본이고, 아래는 인용과 발화 시점만 적는다.

| # | 지점 | fold(F 표) | 발화 시점 | 결정의 처리 |
|---|---|---|---|---|
| 30 | `session_start` | tap | `create`(`new`), `openForWrite`(`startup`, 재개 후보면 `resume`), `fork` 새 thread(`fork`), 엔진 재적재(`reload`). 커밋과 복구 뒤 | 기록 후 계속 |
| 31 | `session_info_changed` | tap(detached) | `setTitle` 커밋 뒤 | 기다리지 않음 |
| 32 | `session_before_switch` | first | `prepareSwitch`, 커밋 없음 | 거부면 `cancelled_by_extension`. 예외도 거부(Xeon fail-closed) |
| 33 | `session_before_fork` | first | `fork` 커밋 전, 트랜잭션 밖 | 거부면 fork 안 함 |
| 37 | `session_before_tree` | first | `moveLeaf`, `revert` 커밋 전 | 거부면 이동 안 함. 결정이 요약을 주면 `summary`로 쓴다 [가정: `SessionBeforeTreeDecision` 필드는 F가 정한다, pi `types.ts:833/1488`] |
| 38 | `session_tree` | tap | `moveLeaf`, `revert` 커밋 뒤 | 기록 후 계속 |
| 39 | `session_shutdown` | tap | `release`(`quit`, `reload`, `new`, `resume`, `fork`). 커밋 없음 | 기록 후 계속 |

- first 지점의 fail-closed를 `session_before_*`에도 그대로 적용할지는 `F.extensions.spec` §4.1 [미결]이다. 이 문서는 현재 표를 따른다.
- 핸들러는 커밋 전, 트랜잭션 밖에서 await로 실행한다(`eng.transactions.design` §4.1). 결정을 받은 뒤 커밋한다. 소비 커밋 전 크래시면 다시 발화될 수 있다(`F.extensions.spec` §4.3, durable spec 2636-2660).
- `session_start`는 pi와 같이 `threadId`, `previousThreadId`를 싣는다(`F.extensions.spec` §3.5 `SessionStartPayload`).
- 발화는 `xeon.ext`의 `ExtHost.dispatch`로 한다(`X.primitives.spec` §8 표). 같은 층 import 없이 F 지점 선언(`POINTS`)과 서비스로만 한다.

### 7.2 on, post, drive, scope와의 관계

- on: 위 7개 지점을 발화한다. on 실행 자체는 기록하지 않는다(`F.records.spec` §7).
- post: 확장 post의 기록은 `input.queued` 하나다(`post.accepted` retire, review.decisions-2 U-05). core-persistence는 커밋 경로와 커밋 키 멱등만 제공한다.
- drive: 임대 획득·반납(`lease.acquired`, `lease.released`)은 X가 `ext.commit`으로 커밋한다. 재개 때 열린 임대는 `ext.loadThread`의 `openLease`로 X에 넘긴다. drive 함수 재호출은 X가 한다(`F.extensions.spec` §4.6).
- scope: `scope.changed`와 상태 판(`x|grp.<name>.state.committed`)은 X가 커밋하고, 접두 테이블 투영은 §4.5.2로 같은 커밋에 들어간다.
- [결정] Helm과 학습 그룹은 L3 기본 그룹이다. 학습 그룹은 drive를 쓰지 않는다(`_research/decisions-log.md` 2026-10-21 계획 v2 "Hermes 학습 정책은 L3 학습 그룹(drive 미사용, Helm과 공존)", `eng.context-map.design` §3 규칙 4). 두 그룹의 비공개 상태는 각각 `x_helm_*`, `x_learning_*`에 있고 이 문서의 등록 검사로 서로의 테이블을 쓰지 못한다.

## 8. 다른 문서와의 인터페이스

### 8.1 제공

| 이름 | 쓰는 문서 |
|---|---|
| `xeon.session`/`SessionService`, `SessionServiceName` | L1.loop.spec, L1.tasks.spec, L1.tools.spec, L1.context.spec, L1.agents.spec, X.primitives.spec, X.operations.spec, L2.artifacts.spec, L2.knowledge.spec, L2.work.spec, L4.host-service.spec |
| `CommitRequest`, `CommitPlan`, `CommitResult`, `CommitKey`, `TxView`(+ `TurnView`, `EffectView`, `InputView`, `ApprovalView`, `AgentView`), `StoreError`, `StoreBugCode`, `ProducerHandle`, `ProducerId`, `StampedDraft`, `DraftInput`, `StepCheckpointInput` | L1 전 도메인, X |
| `Projector`, `ProjectionTx`, `ProjectorRegistry`, `ProjectorFailure` | X.operations.spec, L2 투영 도메인 |
| `EventFeed`, `CommitBatch`, `FeedFilter`, `readFrom`, `readBranch`, `loadCheckpoint`, `subscribe` | L4.host-service.spec, L2.knowledge.spec, L1.context.spec |
| `openForWrite(threadId, token: LeaseToken)`, `OpenReport`(`owner: LeaseOwnerInfo`), `RecoveryMarker`, `ResumePlan`, `AutoResumeVerdict`, `MAX_REPLAY_ATTEMPTS` | L4.host-service.spec, L1.loop.spec |
| `ThreadLifecycle`, `ThreadCreateInput`(`creationKey`, `inheritOwnerFrom`), `ThreadSummaryRow`, `LifecycleError` | L4.host-service.spec, L2.artifacts.spec(`setTitle`), L2.schedule.spec(`creationKey`), L1.agents.spec(`inheritOwnerFrom`) |
| `SessionSettingsStore` | L4.host-service.spec, L1.tools.spec |
| 테스트 도우미 `@xeon/core-persistence/testing`(`openTestSession`, `expectProjectionsRebuildable`, `faultAt`) | 모든 투영기 패키지, L1 동료 |
| 설정 `l1.persistence.*` | L4.settings-ui.spec, L4.cli.spec |

### 8.2 요구

| 이름 | 출처 |
|---|---|
| `DurableEventEnvelope`, `DurableEventDraft`, `VolatileEventEnvelope`, `CORE_EVENT_CATALOG`, `EventKindRegistry`, `parseEventKind`, `checkEnvelopeSize`, `BlobRef`, `DetachedField`, `StepCheckpoint`, `EffectIntent/Exec/Result`, `decideEffectRecovery`, `OUTCOME_UNKNOWN_TEXT`, `NOT_STARTED_TEXT`, `upcastEvent`, `UpcasterRegistry`, `ChunkMigration` | F.records.spec |
| `ThreadId` 등 ID, `IdFactory`, `ThreadStartedPayload`, 수명주기 payload, `ItemRecord`, `PartRecord`, `ReplayPolicy`, `toReplayPolicy` | F.conversation.spec §3.2, §3.5, §3.6 |
| 지점 선언(`POINTS`, session 지점 페이로드), `ExtensionName` | F.extensions.spec §3.1, §3.4, §3.5 |
| `defineSettings`, `ScopeLayer`, `checkSettingWrite`, `resolveSetting`, wire 오류 표 | F.wire-settings.spec §3.5, §3.8, §3.9 |
| `StoreDb`(`write`, `read`), `StoreService.putBlob/readBlob`, 마이그레이션 실행, FULL 연결 | L0.store.spec(`xeon.store`) |
| 세션 id 키 OS 잠금 | L0.process.spec(호스트 경유) |
| `LeaseService`(`acquire`, `holds`, `keepAlive`, `release`, `inspect`), `LeaseToken`, `LeaseHolder`, `LeaseOwnerInfo` | L0.store.spec §3.1(F records `lease.ts`, FR-S2) |
| `reduceLoopState`, 재개 실행 | L1.loop.spec |
| `isCancelledByOwner`, 입력 큐 payload | L1.tasks.spec §3.6, §4.8 |
| `ToolService.rerun`, `ApprovalService.restore`, approval payload | L1.tools.spec §3.3, §3.6, §3.9 |
| `agent.spawned`·`agent.settled` payload(`AgentSpawnedPayload`, `AgentSettledPayload`), 멱등 규칙 | L1.agents.spec §3.5, §4.5 |
| `ExtHost.dispatch`, `RecordCommitPort` 모양 | X.primitives.spec §3.6 |
| 커밋 규칙, `FaultPoint` | eng.transactions.design §4 |

### 8.3 F 요청 사항

| id | 대상 | 요청 | 이유 |
|---|---|---|---|
| FR-P1 | F.records.spec | (반영됨, §3.9) §3.2~§3.8, §6.2의 `contracts/src/records/` 타입(`CommitRequest` 등, `SessionService`, `Projector`, `ProjectionTx`, `EventFeed`, `ResumePlan`, `ThreadLifecycle`, `SessionSettingsStore`)을 `records/commit.ts`, `records/projector.ts`, `records/session-service.ts`에 둔다. `FaultPoint`, `FaultInjector`도 같은 서브패스 | L1 동료와 X가 core-persistence를 import할 수 없다(DR-02, CM-05). eng 문서가 F에 두라고 했으나 F에 아직 없다 |
| FR-P2 | F.records.spec §3.8 | (반영됨) `AppendBatch.requestId: string`과 지문 규칙 추가, `durability` 필드 삭제, `readFrom`·`subscribe` 인자 이름을 `afterSeq`로 | 멱등을 저장소 API에 두겠다는 §3.1.1의 문장을 구체화. 배타 경계를 이름으로 드러낸다 |
| FR-P3 | F.records.spec §3.3 | (반영됨) `thread.resumed`(durable, `ThreadResumedPayload`) 추가 | 복구 표식 `resume_attempts`를 이벤트에서 다시 만든다 |
| FR-P4 | F.records.spec §3.6 | 체크포인트를 승인 대기 커밋(`waiting: "approval"`)에도 쓸 수 있다는 예외를 적는다 | `L1.tools.spec` §4.7 2번의 A1 커밋 |
| FR-P5 | F.conversation.spec §3.5.3, F.wire-settings.spec §3.3.1 | (반영됨) `ThreadStartedPayload.workspace: string \| null` 추가. `ThreadSummary` 필드를 `ThreadSummaryRow` 기준으로 정한다 | `thread.list`의 `workspace` 필터, 후보 표시(HS-30) |
| FR-P6 | F.wire-settings.spec §3.5.2 | thread 오류 kind 추가 후보: `thread.hasForks`, `thread.invalidTarget`, `thread.cancelledByExtension` | `LifecycleError`를 wire로 옮길 코드가 없다 |
| FR-P7 | F.wire-settings.spec §3.3.1 (2차) | `thread.open` params에 `replayFrom?: "none" \| "all" \| StreamPosition` | §4.13.1 |
| FR-P8 | F.records.spec §3.3 (2차) | `checkpoint.files`(durable, `{ turnId, files: FileSnapshotEntry[] }`) 추가 | 되감기 파일 스냅샷(§4.13.2) |
| FR-P10 | F.conversation.spec §3.5.3 | (반영됨) `TurnStartedPayload.scopeId: string \| null` 추가(`L1.loop.spec` FR-L8과 같은 요청). `p_turns.scope_id`와 `(thread_id, scope_id, request_id)` 유일 색인이 이 값을 투영한다 | drive turn 멱등 키가 `(scopeId, requestId)`다(`X.primitives.spec` §3.6). `TxView.turnByRequestId` |
| FR-P11 | F.records.spec §3.9 `session-service.ts` | (반영됨) `ExtCommitRequest.visibility?: "public" \| "private"`(X.primitives.spec §3.6, §4.6.5)를 더하고, `RecordCommitPort.queryRecords`에 조회한 확장 `reader` 인자(시그니처는 `string`, 값은 `ExtensionName`)를 더한다 | 비공개 기록 필터(§3.3)는 쓴 확장과 조회한 확장을 비교해야 한다. 요청 당시 포트에는 조회한 확장이 없었다 [결정: review.decisions-2 T-21] |
| FR-P9 | F.records.spec §3.3 | (반영됨) `input.*`, `turn.abort_requested`(L1.tasks FR-T1·T2), `approval.*`(L1.tools §8.3 요청 3), `agent.spawned`·`agent.settled`·`agent.judged`(L1.agents §8.3 요청 3)를 함께 받는다. `p_inputs`, `p_approvals`, `p_turns`, `p_agents`가 이 kind를 투영한다 | 투영 이름과 kind를 맞춘다 |

### 8.4 다른 문서 수정 요청

- `eng.transactions.design` §4.1, §4.8: C1~C6과 키 표를 §4.2 표(F 이름, 도구별 E1~E3, 컴팩션 C7)로 바꾼다. §4.1 C5와 §4.8의 컴팩션 행, TX-08의 컴팩션 언급을 지운다. §4.8 drive 턴 행(`drive:<scopeId>:<leaseEpoch>:<turnIndex>`)은 `turn.started` 커밋의 `build` 안 `TxView.turnByRequestId(threadId, scopeId, requestId)` 조회로 바꾼다. §4.8 `session:<sessionId>:create` 행은 지우고 `ThreadCreateInput.creationKey`(§4.10.1)로 대신한다. §7 표에 백그라운드 위임 완료 행을 "outbox 불필요(같은 커밋)"로 더한다(`L1.agents.spec` §4.7). §4.2 타입은 FR-P1로 옮기고 `SessionId` → `ThreadId`, `lease_lost` → `ownership_lost`, `StepCheckpointDraft` → `StepCheckpointInput`. §5.2 `decideRecovery`는 F `decideEffectRecovery` + 이 문서 `decideOpenEffect`로 바꾼다. `tool.replay_started`를 지운다.
- `eng.events.design` §4.4 분류표, §5.2 표를 §2.1·§3.10의 F 이름으로 바꾼다. `pos`를 `seq`로 합친다(미결 E-4 해소 제안).
- `eng.context-map.design` §4.1 `session-core` 행: 소유 데이터에 `event_seq`, `thread_delete_guard`, `thread_creation_keys`를 더하고, (b)열 `session.`을 `thread.`, `checkpoint.`, `settings.`으로, (d)열에 `xeon.ext`를 더한다. §5.1에 합성 결과 kind 단위 예외(§3.9)를 더한다.
- `L1.tools.spec` §4.9: `ToolService.rerun` 호출 주체를 core-loop로 고친다. `ToolRunContext`에 재실행 attempt를 넘겨 `effect.exec` 키를 `tool:<toolCallId>:exec:<attempt>`로 만든다. §3.9 `settings.changed` 직접 커밋을 `sessionSettings.set`으로 바꾼다.
- `X.primitives.spec` §3.6: `RecordCommitPort`를 `xeon.session`의 `ext` 속성에서 꺼낸다.
- `X.primitives.spec` §3.6, §4.6.4: `readRecords`가 `RecordCommitPort.queryRecords(threadId, query, reader)`에 호출한 확장 이름을 넘긴다(FR-P11). 비공개 행 필터는 core-persistence가 적용한다(§3.3).
- `X.operations.spec` §4.1, §4.4.4: 투영기 등록 메서드는 `SessionService.projectors.register`다.
- `L4.host-service.spec` §3.3.2: `SettingsStorePort`의 파일 범위 구현을 호스트 자신으로 둔다(§6.2). 자동 재개는 `l1.persistence.autoResume`·`maxResumeAttempts`를 읽는다(review.decisions-2 S-03).
- `L0.process.spec` §6: 자기 자동 재개 키 두 개를 지우고 `l1.persistence.autoResume`·`maxResumeAttempts`를 가리킨다(review.decisions-2 S-03).
- `architecture.runtime-flow.design` §4.1: "복구 표식 running_since 커밋"을 C2 `turn.started` 커밋에 포함된 것으로 고친다.
- adr.0004 §3.4, adr.0006 §3.6 4번: 쓰기 소유 판정을 OS 잠금(생존 판정) + `sys_leases.epoch` 펜싱으로 고치고, 별도 소유 테이블 없이 `sys_leases` 행이 소유 표시를 겸하게 한다 [결정: review.decisions-2 U-09].
- `L4.host-service.spec` HS-29: 하트비트 주기를 L0.store `l0.store.heartbeatMs`로 가리킨다. `openForWrite`에 `LeaseToken`을 넘긴다.
- `L2.schedule.spec` §4: 세션 생성 멱등은 `threads.create`의 `creationKey`로 한다. 고아 세션 정리는 `creationKey` 조회로 끝낸다.

## 9. 수용 기준

1. `FaultPoint` 10종 각각에서 예외를 던지면, 커밋 전 지점(`after_begin`~`before_commit`)은 `events`, `event_seq`, `requests`, `step_checkpoints`, `p_*`, `x_*`, `cap_*`의 행 수와 기본 키 정렬 행 해시가 시도 전과 같다. `after_commit`은 모든 행이 남고 방출은 없다.
2. 장애 주입 뒤 같은 `CommitRequest`로 다시 커밋하면 첫 시도가 성공했을 때와 같은 `events` 행(정규화 envelope 해시)이 나온다.
3. 같은 `requestId`·같은 지문으로 두 번 커밋하면 두 번째는 `replayed: true`이고 `eventIds`, `firstSeq`, `lastSeq`가 첫 번째와 같고 `events` 행 수는 늘지 않는다.
4. 같은 `requestId`·다른 지문은 `key_reused`이고 아무 행도 늘지 않는다.
5. `build`가 `reject`를 돌려준 키로 다시 커밋하면 같은 거부가 `replayed: true`로 나오고 `build`는 다시 불리지 않는다.
6. K1~K6 각 종료 지점에서 자식 프로세스를 SIGKILL하고 같은 DB로 다시 열어 `recover`하면 §4.14 표의 불변식이 성립한다. 모든 경우에 효과마다 `effect.result`는 0 또는 1건이고 새 이벤트의 seq는 종료 전 최대 seq + 1이다.
7. `replay: "unsafe"` 효과가 intent+exec 상태로 끝나면 `recover`는 `effect.result{status:"interrupted", synthesized:true}`와 `isError: true` toolResult item 한 커밋을 쓰고, 그 내용은 `OUTCOME_UNKNOWN_TEXT`다. intent만 있으면 `abandoned`와 `NOT_STARTED_TEXT`다.
8. 저장된 정책과 현재 선언이 모두 `safe`인 효과는 `reruns`에 나온다. 재실행 중 다시 SIGKILL을 두 번 반복하면 세 번째 `recover`는 재실행 없이 `outcome_unknown`으로 닫는다(`MAX_REPLAY_ATTEMPTS` 2). 저장 정책이 `unsafe`이고 현재 선언이 `safe`면 재실행하지 않는다.
9. 재개 경로 전체에서 `tool_call` 지점 핸들러 호출 횟수는 의도가 커밋된 호출에 대해 0이다.
10. 투영 테이블(`p_*`, `step_checkpoints`, 등록된 `x_*`)을 모두 지우고 재생성하면 지우기 전과 기본 키 정렬 행 해시가 같다(`expectProjectionsRebuildable`).
11. `ext.a` 투영기가 `x_b_t`를 `tables`에 넣어 등록하면 `table_not_owned`다. `ext.a` 투영기의 `apply`가 `x_b_t`에 쓰는 문장을 내면(디버그 빌드) 커밋이 `store.prefix_not_owned`로 롤백되고 `events` 행이 늘지 않는다. 확장 `a`의 테이블 쓰기는 같은 커밋의 코어 이벤트와 함께 커밋되거나 함께 사라진다.
12. 한 thread의 세션 임대를 쥔 프로세스가 있을 때 두 번째 프로세스는 잠금을 얻지 못하고, `openForRead`로 관찰 열기(커밋은 `read_only{observer}`)나 `threads.fork`로 새 thread 생성 중 하나로 동작한다. 서비스 등록 파일이 있으면 위임 선택지가 함께 나온다(호스트 테스트).
13. 승인 대기(A1 커밋) 중 SIGKILL 뒤 재개하면 `ResumePlan.pendingApprovals`에 같은 `approvalId` 하나가 있고 새 `approval.requested`가 생기지 않는다.
14. `input.queued` 두 건을 커밋하고 SIGKILL한 뒤 다시 열면 `ResumePlan.queuedInputs`가 같은 두 건을 같은 seq 순서로 돌려준다.
15. `turn.abort_requested`가 커밋된 turn은 `recover` 뒤 `reruns`가 비어 있고 `autoResume.reason`이 `abort_requested`다.
16. 커밋 뒤 방출: 구독자는 COMMIT 성공 뒤에만 배치를 받는다. `before_commit` 장애 주입 때 구독자 호출은 0회다. 리스너가 예외를 던져도 결과는 `committed`이고 다른 리스너는 같은 배치를 받는다.
17. `threads.fork`는 새 thread의 첫 이벤트로 `thread.started{forkedFrom: {threadId, eventId}}`를 쓰고 원본 thread의 이벤트 수는 변하지 않는다.
18. `moveLeaf` 뒤 원래 가지의 이벤트는 `readFrom`으로 계속 읽히고, `readBranch`와 `query.branchItems`는 옮긴 뒤 가지만 돌려준다.
19. 모델 테이프로 한 turn을 돌리고 C5 뒤 SIGKILL, 재개, 다음 turn을 돌리면 이벤트 seq가 빈칸 없이 이어진다.
20. 쓰기 연결의 `PRAGMA synchronous` 조회값은 2(FULL)다(L0.store와 공동 확인).
21. `events`에 UPDATE를 시도하면 트리거가 막는다. `threads.remove` 밖의 DELETE도 막는다.
22. 자식 생성(`threads.create`의 `creationKey` + 부모 `agent.spawned`, §4.10.1) 뒤 SIGKILL하고 다시 열면 `TxView.agentByRequestId(부모, requestId)`가 그 자식을 돌려주고, 자식이 정착하지 않았으면 `ResumePlan.openChildren`에 있다. `agent.settled` 뒤에는 `openChildren`에 없다.
23. 한 단계(도구 n개)의 커밋 수는 `3 + 3n`이다(§4.2 fsync 식). 모델 테이프 스모크의 커밋 기록으로 확인한다.
24. 프로세스 A의 임대를 B가 인수한 뒤(epoch 증가) A의 토큰으로 커밋하면 `ownership_lost`이고 `events` 행이 늘지 않는다.
25. 같은 `creationKey`로 서로 다른 `threadId`를 주어 `threads.create`를 두 번 부르면 `thread.started`는 하나이고 두 번째 결과는 `replayed: true`, 첫 `threadId`다.
26. `turn.started{scopeId: s, requestId: r}`가 커밋된 뒤 `TxView.turnByRequestId(thread, s, r)`가 그 turn을 돌려주고, `scopeId` null인 turn과 섞이지 않는다.
27. 오버플로우 복구 컴팩션(C7) 직후 SIGKILL하고 재개하면 `next: "request"`로 같은 단계 요청이 컴팩션 뒤 가지로 나가고 `thread.compacted`는 하나다.
28. 확장 `alpha`가 `visibility: "private"`로 `grp.alpha.note` 레코드를 커밋하면 `events.private_owner`가 `alpha`다. `ext.queryRecords(thread, { kind: "grp.alpha.*" }, "beta")`는 그 행을 돌려주지 않고, 같은 질의를 `reader` `alpha`로 부르면 돌려준다. `visibility`를 생략한 행은 두 조회 모두 돌려준다. `alpha`가 `grp.beta.note`를 `visibility: "private"`로 커밋하면 `rejected(invalid)`다(`F.records.spec` §9 13과 같은 시나리오).

## 10. 미결 사항

1. (닫음) 커밋 API 정리안(§3.1)의 F 수용. `F.records.spec` §3.9가 FR-P1·FR-P2를 반영했다.
2. [결정: review.decisions-2 U-10] 도구별 효과 커밋(E1~E3)을 ADR-0004 §3.2 3번의 보충으로 올린다. 단계당 커밋 수는 `3 + 3n`이다.
3. [결정: review.decisions-2 U-09] 쓰기 소유 판정은 OS 잠금(생존 판정) + `sys_leases.epoch` 펜싱(`LeaseToken`, TX-10)이다. 별도 소유 테이블은 두지 않는다. adr.0004 §3.4·adr.0006 §3.6 4번을 이에 맞게 개정한다.
4. [미결] 자동 재개 기본값(adr.0006 §6). 이 문서는 꺼짐을 [제안]으로 쓴다. 키는 `l1.persistence.autoResume`, `l1.persistence.maxResumeAttempts` 둘로 정했다(review.decisions-2 S-03).
5. [미결] 설정 파일 범위의 위치·감시·병합·신뢰 전 제외 규칙의 소유를 `L4.host-service.spec`으로 옮기는 제안(§6.2). `F.wire-settings.spec` §1.2 [가정], `X.loading-trust.spec` §4.7.4, `L4.host-service.spec` `SettingsStorePort`가 함께 바뀐다.
6. [결정: review.decisions-2 U-13] 커밋 키 정본은 `eng.transactions.design`의 `COMMIT_KEY_PATTERN`이다. scope id의 `/`는 키에 넣을 때 `:`로 바꾼다. 복구 합성 키 `tool:<…>:result`의 toolCallId 부분은 core-tools와 같은 F `commitKeyPart`로 만든다(§3.9 표).
7. [미결] 떠난 가지 요약(`thread.branch_summarized`)을 누가 만드는지(`L1.context.spec`). 이 문서는 받은 요약만 기록한다.
8. (닫음) `agent.spawned`, `agent.settled`, `agent.judged`는 F 카탈로그 kind다(`F.records.spec` §3.3, `L1.agents.spec` §8.3 요청 3 반영). `p_agents`, `TxView.agentByRequestId`, `ResumePlan.openChildren`의 투영 원천은 이 kind다.
9. [미결] fork가 출처 이벤트를 참조만 할지 복사할지. 참조안은 출처 thread 삭제를 막는다(`has_forks`). 복사안은 삭제가 독립이지만 저장량이 늘고 확장 상태 복사 규칙이 필요하다.
10. [미결] `LifecycleError`를 wire 오류로 옮길 kind(FR-P6)와 thread 종결(`thread.closed`)을 wire로 노출할지.
11. [미결] 등록 해제된 확장 kind를 투영 재생에서 건너뛰는 제안(§4.12)을 `F.records.spec` §10 미결 5의 답으로 받을지.
12. [미결] blob GC 뿌리 집합을 L0.store에 넘기는 경로(§4.11).
13. [미결] JSONL 가져오기(pi JSONL → Xeon thread) 지원 여부(§4.13.3).
14. (닫음) `ext` 하위 객체 방식(§3.3). `F.extensions.spec` §3.2.1 `PortKey.member`로 `xeon.session`의 `ext`를 꺼낸다. `RecordCommitPort` 타입 위치는 F(`F.records.spec` §3.9 `session-service.ts`, `F.extensions.spec` §3.2.1이 다시 export)다.
15. [미결] 청크 재생성으로 바꾸는 기준 이벤트 수(10만 건 [가정])와 재생성 중 쓰기 거부가 사용자에게 주는 지연.
16. [미결] 확장 투영기 예외 뒤 복구 경로(X가 확장을 끄고 재시도)를 이 문서의 알림 방식으로 확정할지(`X.operations.spec` §10 미결 6).
17. [미결] 승인 대기 커밋(A1)의 체크포인트 예외(FR-P4)를 F가 받지 않으면, 승인 대기를 단계 경계로 볼지(`step.completed{status}` 확장) 다시 정해야 한다.
