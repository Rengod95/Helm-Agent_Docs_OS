---
id: F.records.spec
layer: F
domain: records
kind: spec
status: draft
depends_on: [F.conversation.spec, F.extensions.spec, eng.events.design, eng.transactions.design]
binds: [xeon/packages/contracts/src/records/**]
---

# F 기록 계약 (records)

서브패스: `@xeon/contracts/records`. 소스: `xeon/packages/contracts/src/records/`.

## 1. 목적과 범위

### 1.1 정하는 것

[결정] 세션 저장은 C안이다. SQLite 이벤트 소싱과 투영을 쓰고, DB는 하나이며, 확장 기록은 접두사 테이블에 둔다(`_research/decisions-log.md` 2026-10-21 결정 2차). 이 문서는 그 저장 방식의 기록 계약을 정한다.

- 이벤트 envelope(`EventEnvelope`)와 내구/휘발 구분
- 이벤트 종류 이름 규칙(`EventKind`)과 코어 카탈로그, 내장 L2 도메인의 소유 카탈로그(§3.3.2)
- 큰 값의 분리(`BlobRef`, 256 KiB 상한)
- 효과 이벤트 3단(`effect.intent`/`exec`/`result`)과 재생 정책(`ReplayPolicy`), 결과 불명 복구 규칙
- 단계 체크포인트 레코드(`StepCheckpoint`)
- 스키마 버전, 업캐스터, 투영 재생성, 청크 마이그레이션 계약
- 세션 저장소 인터페이스(`SessionStore`, 2차)
- 저장·투영 포트 타입(`StoreDb`, `SqlTx`, `StoreService`, `CommitRequest`, `SessionService`, `Projector` 등, §3.9)
- 분기와 비파괴 컴팩션

### 1.2 다루지 않는 것

- 테이블, DDL, PRAGMA, 잠금, blob 파일 배치: `L0.store.spec`(L0-e)과 `L1.persistence.spec`(L1-f). F는 레코드 형태와 규칙만 정한다.
- 그룹 간 레코드, 확장 접두사 테이블 스키마: `F.extensions.spec`.
- 와이어 표현(ISO 시각, 프레임, 커서, 민감 필드 제거): `F.wire-settings.spec`.
- 대화 모델 이름(ID, item, part, 알림): `F.conversation.spec`.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 내구 이벤트 | 이벤트 테이블에 저장되고 `seq`를 받는 이벤트. 재생 원본이다 |
| 휘발 이벤트 | 저장하지 않고 실행 중에만 흐르는 이벤트. `seq` 없이 조각 번호 `n`을 받는다 |
| 투영 | 내구 이벤트에서 파생한 조회 테이블(메시지, 파트, 체크포인트). 같은 트랜잭션에서 갱신한다 |
| leaf | thread의 현재 가지 끝 이벤트 id |
| 효과 | 부작용이 있을 수 있는 도구 실행 하나 |
| 단계 경계 | step이 끝나는 시점(pi `turn_end`). 용어는 `F.conversation.spec` §2를 따른다 |
| 업캐스터 | kind별 payload를 버전 n에서 n+1로 바꾸는 순수 함수 |

## 3. 인터페이스

ID 타입(`EventId`, `EffectId`, `CheckpointId` 등)과 스키마는 `F.conversation.spec` §3.2에서 정의하고 이 서브패스가 같은 심볼을 다시 export한다. 스키마 선언 형식(명시 타입 주석, `Static` 파생, 인터페이스 표기의 뜻)은 `F.conversation.spec` §3 머리말을 따른다. 예상 가능한 실패는 `@xeon/contracts` 루트의 `Result<T, E>`로 돌려주고 `E`는 `kind` 판별 유니온이다(`eng.typescript.guide` §1.2, TY-11). 루트 진입점의 범위는 `F.readme` §3을 따른다.

이 문서의 pi 소스 경로와 줄 번호(`~/projects/_ref/pi-src`, `durable/…`, agent `types.ts:490` 등)는 로컬 pi 1.1.0 소스 기준이다. 계약 대상은 npm 1.3.0이고, agent-core `types.ts`는 두 버전의 줄이 같다(`_research/notes/F-2.md` §4).

### 3.1 이벤트 envelope

```ts
// src/records/envelope.ts
import type { EventId, ThreadId, TurnId, StepId } from "../conversation/ids.ts";
import type { EventKind } from "./kinds.ts";
import type { DetachedField } from "./blob.ts";

interface EnvelopeBase {
  id: EventId;                    // evt_<ULID>
  kind: EventKind;                // "<영역>.<이름>", 확장은 "x.<extId>." 또는 "grp.<groupId>." 접두
  version: number;                // kind별 payload 버전, 정수 ≥ 1
  threadId: ThreadId;
  turnId: TurnId | null;
  stepId: StepId | null;
  recordedAt: number;             // ms 정수, 저장소(내구)·발신자(휘발)가 채운다
  causationId: EventId | null;    // 이 이벤트를 직접 일으킨 이벤트
  correlationId: string | null;   // 1~64자. 묶음 키(예: turnId, effectId)
  payload: unknown;               // kind·version별 스키마로 검증(§3.3)
}

export interface DurableEventEnvelope extends EnvelopeBase {
  durable: true;
  seq: number;                    // 전역 단조, 무간격, 정수 ≥ 1. 저장소가 채운다
  parentId: EventId | null;       // 분기 트리 부모. thread 첫 이벤트만 null
  detached?: DetachedField[];     // blob으로 옮긴 문자열 필드 목록(§3.4)
}

export interface VolatileEventEnvelope extends EnvelopeBase {
  durable: false;
  n: number;                      // (threadId, turnId) 안 조각 번호, 0부터 1씩
  afterSeq: number;               // 발신 시점의 마지막 내구 seq, 정수 ≥ 0
}

export type EventEnvelope = DurableEventEnvelope | VolatileEventEnvelope;

export const DurableEventEnvelopeSchema: Schema<DurableEventEnvelope>;   // additionalProperties: false
export const VolatileEventEnvelopeSchema: Schema<VolatileEventEnvelope>; // additionalProperties: false
export const EventEnvelopeSchema: Schema<EventEnvelope>;                 // durable 판별 유니온

/** 저장소에 넘기는 초안. seq, recordedAt, parentId는 저장소가 채운다. id는 호출자가 IdFactory로 미리 발급한다. */
export type DurableEventDraft = Omit<DurableEventEnvelope, "seq" | "recordedAt" | "parentId"> & {
  parentId?: EventId | null;      // 지정하면 분기 생성(§4.6), 생략하면 현재 leaf
};

export const ENVELOPE_MAX_BYTES: number = 262_144; // 256 KiB
export type EnvelopeSizeError = { kind: "event_too_large"; bytes: number; limit: number };
/** UTF-8 기준 JSON.stringify(envelope) 길이를 잰다. 순수 함수. 성공 값은 바이트 수. */
export function checkEnvelopeSize(envelope: EventEnvelope): Result<number, EnvelopeSizeError>;
```

- [제안] `durable`을 판별자로 하는 두 변형을 두고 `additionalProperties: false`로 닫는다. 그래서 `durable: false`인데 `seq`가 있거나, `durable: true`인데 `n`이 있으면 스키마 검증에서 거부된다.
- [제안] 휘발 이벤트에는 `parentId`, `detached`가 없다. 분기 트리에 들어가지 않기 때문이다.
- [제안] `afterSeq`는 기존 설계 `docs/design/09-event-store.md` §3.5의 같은 이름 필드를 가져온 것이다. 클라이언트는 이 seq까지 내구 이벤트를 받기 전에는 휘발 조각 적용을 미룰 수 있다.
- [결정] 필드 이름은 `kind`, `version`, `durable`이다. 기존 설계 09의 `type`, `typeVersion`은 인용만 한다(조정 기준표, 사용자 지시).

#### 3.1.1 기존 설계 09 §3.2와의 필드 대조

`docs/design/09-event-store.md` §3.2 `EventEnvelope`(98-222행)의 필드를 다음처럼 처리한다.

| 09 필드 | 처리 | Xeon 필드 | 사유 |
|---|---|---|---|
| `seq` | 가져옴 | `seq` | 전역 단조 무간격 재생 커서. 내구 이벤트만 |
| `id` (`ev_`) | 가져옴, 접두 변경 | `id` (`evt_`) | 공통 ID 접두 기준표 |
| `type` | 이름 변경 | `kind` | 사용자 지시 |
| `typeVersion` | 이름 변경 | `version` | 사용자 지시 |
| `recordedAt` | 가져옴 | `recordedAt` | |
| `causationId` | 가져옴 | `causationId` | 효과 3단, 파생 이벤트 추적 |
| `correlationId` | 가져옴 | `correlationId` | |
| `payload` | 가져옴 | `payload` | |
| `scope.runId` 등 | 대체 | `threadId`, `turnId`, `stepId` | 대화 계층으로 소속을 표현한다 |
| (없음) | 추가 | `parentId`, `durable`, `n`, `afterSeq`, `detached` | 분기 트리(pi), 내구/휘발 구분, 큰 값 분리 |
| `v` (envelope 버전) | 버림 [제안] | — | envelope 모양 변경은 DB 마이그레이션으로 처리한다(§3.7) |
| `category` | 버림 | — | Helm 도메인 분류(domain, governance, kernel, measurement 등). Xeon은 kind 영역 접두로 충분하다 |
| `plane` | 버림 | — | Helm 규범·인식 평면 개념. Xeon 코어에 없다 |
| `authority` | 버림 | — | Helm 커널의 권한 근거 문법. Xeon은 커널 단일 쓰기 전제를 철회했다(결정 로그 2026-10-19) |
| `actor`, `via` | 버림 [제안] | — | 확장 출처는 kind 접두로, 사용자 입력 출처는 item으로 표현한다. 필요하면 payload에 둔다 |
| `subject`, `refs` | 버림 | — | Helm 레코드(N/E) 참조. 대화 계층 ID로 대체 |
| `commandId` | 버림 | — | Helm 명령 모델 |
| `occurredAt` | 버림 [제안] | — | 외부 관찰의 효력 시각은 해당 payload 필드로 둔다 |
| `bootEpoch`, `provenance` | 버림 | — | 데몬 부팅 구분, 판정 재현은 Helm 커널 전용 |
| `redactions` | 이관 | — | 와이어 사본의 일이라 `F.wire-settings.spec`으로 옮긴다 |
| `prevHash`, `hash` (`StoredEvent`) | [미결] | — | 해시 체인 유지 여부(§10 미결 1) |
| `producer`, `requestId` (`eng.events.design` §4.1) | 두지 않음 [제안] | — | 확장 출처는 kind 접두(`x.`/`grp.`)로 안다. 제출 멱등 키 `requestId`는 그것이 필요한 payload(`TurnStartedPayload`, 사용자 `ItemRecord`)에 둔다(`F.conversation.spec` §3.5). 커밋 단위 멱등 키가 필요하면 envelope가 아닌 저장소 API(`AppendBatch`, `L0.store.spec`)에 둔다 |

#### 3.1.2 엔지니어링 문서와의 정본 관계

`eng.events.design`, `eng.domain-types.guide`, `eng.testing.guide`, `eng.best-practices.guide`의 예시와 [가정]은 이 문서·`F.conversation.spec`과 다른 이름을 쓴다. [제안] 아래 표의 "정본" 열을 따른다. F가 정본인 행은 엔지니어링 문서의 예시와 [가정]을 F 이름으로 고쳐야 한다(엔지니어링 문서의 수정은 요청으로 남긴다. P2 정합성 검토 ① 항목).

| 대상 | F 값 | 엔지니어링 문서 값 | 정본 |
|---|---|---|---|
| envelope 필드 이름 | `kind`, `version`, `threadId`, `durable`. `v`, `producer`, `requestId` 없음(§3.1, §3.1.1) | `type`, `typeVersion`, `sessionId`, `v`, `producer`, `requestId`(`eng.events.design` §4.1) | F. `kind`/`version`은 [결정](사용자 지시) |
| `BlobRef` 모양 | `{ type: "blob", sha256, size, mediaType }`(§3.4) | `{ hash: "sha256:…", size, mime }`(`eng.events.design` §4.1) | F [제안] |
| ID 접두 | 세 글자 8종 `thr` `trn` `stp` `itm` `prt` `evt` `efx` `ckp`, 타입 `IdPrefix`(`F.conversation.spec` §3.2). `ID_PREFIXES` 상수와 `SessionId`·`RequestId`·`TaskId`는 없다 | 두 글자 `ss` `ev` `rq` `tk`, 상수 `ID_PREFIXES`(`eng.domain-types.guide` DT-06) | F. DT-06은 F 표를 정본으로 지정했다 |
| 확장 접두 | 이벤트·레코드 kind `x.<extId>.<영역>.<이름>`, `grp.<groupId>.<영역>.<이름>`, `extId`는 `ExtensionName`(`^[a-z][a-z0-9-]{1,31}$`, 하이픈 허용·밑줄 금지, §3.2) | DT-08은 `x.`/`grp.` 접두로 고쳤다(K-06). `extId` 정규식은 하이픈을 허용하지 않는다(`eng.domain-types.guide` DT-08) | F. 정규식은 [결정: review.decisions-2 U-18]. `_` 접두는 코어 열거형 확장 예약으로만 남는다(`F.extensions.spec` §4.9) |
| 코어 kind 형식 | `<영역>.<이름>` snake_case(§3.2) | `<대상>.<과거형>`(`eng.events.design` §4.1) | F [제안] |
| `IdFactory` | `F.conversation.spec` §3.2, 서브패스 `./conversation` | 루트 `@xeon/contracts`에서 import(`eng.testing.guide`) | F. 루트에는 두지 않는다(`F.readme` §3) |
| `Clock`, 난수, `Logger` 인터페이스 | 루트 base의 `Clock`, `Scheduler`, `TimerHandle`, `RandomSource`, `Logger` 인터페이스(`F.readme` §3) | `Clock`·`RandomSource`(`eng.typescript.guide`), `Clock`·`IdSource`·`Random`·`Logger`(`eng.best-practices.guide` BP-05) | F [제안]. `IdSource`·`Random`은 `IdFactory`·`RandomSource`로 읽는다(`F.readme` §8 미결 10 정리) |
| 테스트 대역 서브패스 `@xeon/contracts/testing` | 없음(서브패스 7개, `F.readme` §3). 대역 구현(`manualClock`, `seededRandom`, `fixedIdFactory`)은 쓰는 패키지마다 자기 `test/` 안에 둔다 | `manualClock`, `fixedIdFactory` 등(`eng.testing.guide`) | F [결정: review.decisions-2 U-03]. 대역은 시계·난수 구현이라 F 런타임 로직 예외(`F.readme` §1)에 들지 않는다 |
| `createIdFactory` 위치 | F에 없음. 구현은 `platform-os`(`F.readme` §1, §8 10번) | `@xeon/contracts` base(`eng.typescript.guide` §1.2) | F [결정: review.decisions-2 U-03]. eng 문서의 수정은 요청으로 남긴다 |

### 3.2 이벤트 종류 이름 규칙

```ts
// src/records/kinds.ts
export type CoreArea =
  | "thread" | "turn" | "step" | "item" | "part" | "effect"
  | "checkpoint" | "scope" | "lease" | "post" | "settings"
  | "approval" | "input" | "agent" | "secret";

export type CoreEventKind =
  | "thread.started" | "thread.updated" | "thread.closed" | "thread.leaf_moved"
  | "thread.compacted" | "thread.branch_summarized" | "thread.resumed"
  | "turn.started" | "turn.updated" | "turn.completed" | "turn.abort_requested"
  | "step.started" | "step.updated" | "step.completed"
  | "item.started" | "item.updated" | "item.recorded"
  | "part.recorded"
  | "effect.intent" | "effect.exec" | "effect.result"
  | "checkpoint.step"
  | "scope.changed" | "scope.handler_failed" | "lease.acquired" | "lease.released"
  | "post.accepted" /* retired: review.decisions-2 U-05 */ | "settings.changed"
  | "approval.requested" | "approval.resolved"
  | "input.queued" | "input.placed" | "input.withdrawn"
  | "agent.spawned" | "agent.settled" | "agent.judged"
  | "secret.used" | "secret.denied" | "secret.approved" | "secret.masked";

/** 내장 L2 도메인이 소유하는 영역(§3.3.2). 카탈로그 파일이 있는 영역만 */
export type DomainArea = "work" | "dialog" | "artifact" | "schedule";
/** 예약만 한 L2 영역. 그 도메인이 kind를 처음 더할 때 DomainArea로 옮긴다 */
export type ReservedDomainArea = "workspace" | "mcp" | "web" | "knowledge";
export type DomainEventKind = `${DomainArea}.${string}`;

export type ExtensionEventKind = `x.${string}.${string}.${string}` | `grp.${string}.${string}.${string}`;
export type EventKind = CoreEventKind | DomainEventKind | ExtensionEventKind;

/** 코어·도메인: ^[a-z][a-z_]*\.[a-z][a-z_]*$
 *  확장: ^(x|grp)\.[a-z][a-z0-9-]{1,31}\.[a-z][a-z0-9_]{0,31}\.[a-z][a-z_]*$
 *  (둘째 마디는 F.extensions.spec의 EXTENSION_NAME_PATTERN, 셋째 마디는 L2.artifacts.spec 확장 ArtifactKind의 셋째 마디와 같다) */
export const CORE_KIND_PATTERN: string;
export const EXTENSION_KIND_PATTERN: string;
export const EventKindSchema: Schema<EventKind>;

export type ParsedKind =
  | { origin: "core"; area: CoreArea; name: string }
  | { origin: "domain"; area: DomainArea; name: string }
  | { origin: "extension"; ownerType: "x" | "grp"; ownerId: string; area: string; name: string };
export type KindError =
  | { kind: "malformed"; eventKind: string }
  | { kind: "reserved_area"; eventKind: string }   // 접두 없는 비코어·비도메인 영역, 예약 영역(ReservedDomainArea), 코어·도메인 영역의 미등록 이름
  | { kind: "duplicate"; eventKind: string };      // 레지스트리 등록 충돌
export function parseEventKind(kind: string): Result<ParsedKind, KindError>;

/** 확장이 kind를 등록하는 타입. 구현은 X(X.primitives.spec, X.loading-trust.spec). */
export interface EventKindRegistration {
  kind: ExtensionEventKind;
  version: number;
  durable: boolean;
  payload: TSchema;
  upcasters?: readonly Upcaster[];            // §3.7
}
export interface EventKindRegistry {
  register(owner: { type: "x" | "grp"; id: string }, entry: EventKindRegistration): Result<void, KindError>;
  lookup(kind: string): CatalogEntry | undefined;
}
```

규칙 [제안]:

1. 코어 kind는 `<영역>.<이름>`이다. 점은 하나, 소문자 `snake_case`다(09 §3.3 규칙 1을 따른다).
2. 확장 kind는 `x.<extId>.<영역>.<이름>`, 의도 그룹 kind는 `grp.<groupId>.<영역>.<이름>`이다. `extId`·`groupId`는 `F.extensions.spec` §3.1의 `ExtensionName`(`^[a-z][a-z0-9-]{1,31}$`, review.decisions-2 U-18)이다. 셋째 마디(영역)는 `[a-z][a-z0-9_]{0,31}`이다. `L2.artifacts.spec`의 확장 `ArtifactKind`(`x.<확장 이름>.<종류>`) 셋째 마디와 같은 규칙이다. 같은 형식을 그룹 레코드 kind(`F.extensions.spec` §3.6 `RecordKind`)와 확장 커스텀 메시지 `customType`(`F.conversation.spec` §3.5.2)도 쓴다. 설정 키와 wire 메서드는 `ext.` 접두를 쓰는 다른 규칙이다(`F.wire-settings.spec` §3.8.1).
3. 확장은 접두 없는 kind를 쓸 수 없다. 코어 영역 이름(`CoreArea`)도 접두 뒤에서는 쓸 수 있다(예: `grp.helm.item.tagged`). 예외는 내장 패키지 둘이다. `core-*` 패키지는 코어 영역을, 내장 `cap-*` 패키지는 §3.3.2 소유 카탈로그에 등록된 자기 도메인 영역(`DomainArea`)을 접두 없이 쓴다. 매니페스트가 있는 내장 `cap-*`도 이벤트 kind는 이 예외를 따르고, 그룹 레코드 kind와 커스텀 메시지 `customType`은 `RecordKind` 형식(`x.<확장 이름>.…`)을 그대로 쓴다(`F.extensions.spec` §3.6, `F.conversation.spec` §3.5.2). 외부 확장은 `DomainArea`·`ReservedDomainArea`를 접두 없이 쓸 수 없다.
4. 벤더 이름(pi, claude, codex)을 코어 kind에 넣지 않는다(09 §3.3 규칙 5).
5. 이름은 바꾸지 않는다. 의미가 바뀌면 `version`을 올리고 업캐스터를 둔다. 없앤 kind는 카탈로그에 `retired: true`로 남긴다.
6. `_` 접두 열거형 값 예약 같은 열거형 확장 규칙은 M2 이후 `F.extensions.spec`이 정한다.
7. `parseEventKind`는 병합된 카탈로그(§3.3.2)에 있는 영역만 `core` 또는 `domain`으로 본다. 그 영역의 미등록 이름과 `ReservedDomainArea`는 `reserved_area`다.

### 3.3 이벤트 카탈로그

```ts
// src/records/catalog/index.ts
export interface CatalogEntry {
  kind: EventKind;
  version: number;                // 현재 버전
  durable: boolean;
  payload: TSchema;               // 현재 버전 payload 스키마
  retired?: true;
}
export const CORE_EVENT_CATALOG: readonly CatalogEntry[];
export function catalogEntry(kind: CoreEventKind): CatalogEntry;
```

코어 카탈로그(40종, 모두 version 1). 아래 표는 `xeon/scripts/check-event-catalog.ts`가 `CORE_EVENT_CATALOG`와 대조한다(`F.records.plan`). 표 행을 고치면 코드도 고친다.

<!-- catalog:start -->
| kind | durable | payload 스키마 | 요약 |
|---|---|---|---|
| `thread.started` | 예 | `ThreadStartedPayloadSchema` | 제목, 분기 원본(thread, event) |
| `thread.updated` | 예 | `ThreadUpdatedPayloadSchema` | 제목·상태 변경 |
| `thread.closed` | 예 | `ThreadClosedPayloadSchema` | 종료 사유 |
| `thread.leaf_moved` | 예 | `LeafMovedPayloadSchema` | `{ leafEventId, reason: "branch" \| "rewind" \| "restore" }` |
| `thread.compacted` | 예 | `CompactedPayloadSchema` | 비파괴 컴팩션 요약(§4.6) |
| `thread.branch_summarized` | 예 | `BranchSummarizedPayloadSchema` | 떠난 가지 요약 `{ fromEventId, summary, details }` |
| `thread.resumed` | 예 | `ThreadResumedPayloadSchema` | 이어서 실행 시도(`turnId`, `attempt`, `mode`). 복구 표식 `resume_attempts`의 원천(`L1.persistence.spec` §3.9) |
| `turn.started` | 예 | `TurnStartedPayloadSchema` | 입력 item id들, `requestId`, `scopeId`(drive turn만, 그 밖은 null) |
| `turn.updated` | 아니오 | `TurnUpdatedPayloadSchema` | 상태 |
| `turn.completed` | 예 | `TurnCompletedPayloadSchema` | 종결 상태, step 수, 사용량, 오류 |
| `turn.abort_requested` | 예 | `TurnAbortRequestedPayloadSchema` | 취소 의도. `turn.updated`가 휘발이라 따로 둔다(`L1.tasks.spec` §3.8) |
| `step.started` | 예 | `StepStartedPayloadSchema` | `stepIndex` |
| `step.updated` | 아니오 | `StepUpdatedPayloadSchema` | 상태 |
| `step.completed` | 예 | `StepCompletedPayloadSchema` | 종결 상태, `stopReason`, 어시스턴트·도구 결과 item id |
| `item.started` | 아니오 | `ItemStartedPayloadSchema` | item id, 종류, 도구 호출 id |
| `item.updated` | 아니오 | `ItemUpdatedPayloadSchema` | 토큰·인자 델타(`part_delta`), 파트 완성, 도구 진행 |
| `item.recorded` | 예 | `ItemRecordedPayloadSchema` | `{ item: ItemRecord }` |
| `part.recorded` | 예 | `PartRecordedPayloadSchema` | `{ part: PartRecord }` |
| `effect.intent` | 예 | `EffectIntentSchema` | 실행 전 의도(§3.5) |
| `effect.exec` | 예 | `EffectExecSchema` | 실행 시작 표시 |
| `effect.result` | 예 | `EffectResultSchema` | 결과 상태, 구조화 출력, blob |
| `checkpoint.step` | 예 | `StepCheckpointSchema` | 단계 체크포인트(§3.6) |
| `scope.changed` | 예 | `ScopeChangedPayloadSchema` | scope 켜기·끄기 적용 |
| `scope.handler_failed` | 아니오 | `ScopeHandlerFailedPayloadSchema` | 확장 핸들러 실패 알림(`X.operations.spec` §4.3.4) |
| `lease.acquired` | 예 | `LeaseAcquiredPayloadSchema` | drive 배타 임대 획득 |
| `lease.released` | 예 | `LeaseReleasedPayloadSchema` | drive 임대 해제 |
| `post.accepted` | 예 | `PostAcceptedPayloadSchema` | retired(`retired: true`, [결정: review.decisions-2 U-05]). 새로 쓰지 않는다. M1 개발 DB에 남은 행을 읽을 때만 스키마를 쓴다. 확장 post의 기록은 `input.queued`(`source.type: "extension"`)다 |
| `settings.changed` | 예 | `SettingsChangedPayloadSchema` | 세션 범위 설정 변경 |
| `approval.requested` | 예 | `ApprovalRequestedPayloadSchema` | 승인 요청. `body.kind`는 `tool` \| `question` \| `plan`. 승인 id = 이 이벤트 id |
| `approval.resolved` | 예 | `ApprovalResolvedPayloadSchema` | 승인 응답 결과 |
| `input.queued` | 예 | `InputQueuedPayloadSchema` | 입력 큐 등록. 입력 id = 이 이벤트 id |
| `input.placed` | 예 | `InputPlacedPayloadSchema` | 큐 입력을 대화 item으로 배치 |
| `input.withdrawn` | 예 | `InputWithdrawnPayloadSchema` | 큐 입력 철회 |
| `agent.spawned` | 예 | `AgentSpawnedPayloadSchema` | 자식 thread 생성과 소유 간선 |
| `agent.settled` | 예 | `AgentSettledEventPayloadSchema` | 자식 turn 종결, 보고, 사용량 |
| `agent.judged` | 예 | `AgentJudgedPayloadSchema` | 목표 판정 모델 결과 |
| `secret.used` | 예 | `SecretUsedPayloadSchema` | 비밀 사용 허용(값 없음) |
| `secret.denied` | 예 | `SecretDeniedPayloadSchema` | 비밀 사용 거부와 사유 |
| `secret.approved` | 예 | `SecretApprovedPayloadSchema` | 비밀 사용 승인 증거 |
| `secret.masked` | 예 | `SecretMaskedPayloadSchema` | 마스킹 계층과 적중 수 |
<!-- catalog:end -->

- [제안] 토큰 델타(`item.updated`의 `update.kind: "part_delta"`, payload `PartDelta`)와 진행 표시(`*.updated`, `item.started`)는 휘발이다. 델타 전용 kind는 두지 않는다. 알림 `type`과 카탈로그 kind를 같게 두는 `F.conversation.spec` §3.5.3 규칙 때문이다. 완성 파트(`part.recorded`)와 완성 item(`item.recorded`)만 내구다(`_research/session-storage.md` 권장안, `docs/design/19-client-protocol.md` §3.5.2).
- 대화 계층 payload 스키마(`ThreadStartedPayloadSchema` ~ `ItemUpdatedPayloadSchema` 11종)는 `F.conversation.spec` §3.5.3에서 정의한 것을 그대로 쓴다. `item.completed` 알림은 카탈로그 kind가 아니다(내구 기록은 `item.recorded`, `effect.result`).

이 문서가 새로 정의하는 payload:

```ts
// src/records/catalog/thread.ts
export interface LeafMovedPayload { leafEventId: EventId; reason: "branch" | "rewind" | "restore" }
export interface CompactedPayload {
  summary: string;
  firstKeptEventId: EventId;      // 이 이벤트부터 원문을 모델 컨텍스트에 남긴다
  tokensBefore: number;
  details: JsonValue | null;      // 확장 전용 데이터, 모델에 보내지 않는다
  usage: Usage | null;            // 요약 생성 모델 호출 사용량
  fromExtension: string | null;   // 확장이 만든 요약이면 확장 id
}
export interface BranchSummarizedPayload { fromEventId: EventId; summary: string; details: JsonValue | null; usage: Usage | null }

// src/records/catalog/content.ts
export interface ItemRecordedPayload { item: ItemRecord }
export interface PartRecordedPayload { part: PartRecord }

// src/records/catalog/extension-ops.ts
// 필드의 정본은 F.extensions.spec이다. records는 extensions보다 낮은 순위라(F.readme §3) 타입을 import하지 않고
// 같은 모양을 적는다. 이름 대응: scopeId ↔ ScopeId(§3.2 scope.ts), leaseId ↔ LeaseId, limits ↔ DriveLimits, when ↔ PostWhen.
export interface ScopeChangedPayload {
  scopeId: string;                // F.extensions.spec ScopeId. "<확장 이름>" 또는 "<확장 이름>/<하위 이름>"
  status: "enabled" | "disabled"; // 적용된 상태. enable()/disable() 요청이 단계 경계에서 적용될 때 쓴다(F.extensions.spec §4.5)
  /** 적용 사유. 없으면 "request". 값 정본은 X.operations.spec ScopeChangeReason */
  reason?: "request" | "auto_disable" | "safe_mode" | "startup_disable";
}
/** 휘발. 확장 핸들러 실패 하나마다 보낸다(X.operations.spec §4.3.4) */
export interface ScopeHandlerFailedPayload {
  owner: string;                  // X.operations.spec HandlerOwnerKey: "ext:<이름>" | "hook:<이름>"
  point: string;                  // F.extensions.spec PointName
  result: string;                 // 실패 분류. 값 집합은 X.operations.spec §4.3
  message: string;
  consecutive: number;            // 같은 owner의 연속 실패 수, 정수 ≥ 1
}
export interface LeaseAcquiredPayload {
  leaseId: string;                // F.extensions.spec DriveLease.leaseId
  scopeId: string;                // 임대를 받은 그룹의 scope
  limits: { maxTurns?: number; maxSpawns?: number; maxTokens?: number };   // DriveLease.limits(DriveLimits)
}
export interface LeaseReleasedPayload {
  leaseId: string;
  scopeId: string;
  /** disabled: 그룹 끄기(§4.5), budget: 상한 도달(§4.6), error: drive 함수 예외, idle: 효과 없는 반환 반복(§5 7번),
   *  revoked: X의 중재로 회수, restart: 프로세스 재시작 뒤 정리. 번호는 F.extensions.spec 절 */
  reason: "disabled" | "budget" | "error" | "idle" | "revoked" | "restart";
}
export interface PostAcceptedPayload {
  requestId: string;              // F.extensions.spec PostOptions.requestId. 대화 범위 멱등 키
  scopeId: string;                // post한 확장의 scope
  when: "steer" | "followUp" | "next";   // PostOptions.when(PostWhen)
  /** 같은 커밋의 input.queued 이벤트 id. kind가 retired라 새로 쓰지 않는다 [결정: review.decisions-2 U-05] */
  inputId: EventId;
  itemId: ItemId | null;          // 대화에 남은 item(user 또는 custom). 아직 큐에 있으면 null
}

// src/records/catalog/settings.ts
// key·scope 값 집합의 정본은 F.wire-settings.spec §3.8.1(SettingKey, SettingScope)이다. records는 settings보다 낮은
// 순위라(F.readme §3) 스키마를 import하지 않고 문자열로 둔다. 값 집합 일치는 F.wire-settings.plan의 테스트가 확인한다.
export interface SettingsChangedPayload { key: string; scope: string; value: JsonValue | null }
```

- [제안] `settings.changed`는 세션 동작에 영향을 주는 변경(예: 모델, 추론 수준)만 기록한다. 비밀 값은 기록하지 않고 참조만 기록한다(결정 로그 2차 "에이전트는 값을 모른 채 참조로 사용").

#### 3.3.1 L0·L1·X 요청으로 더한 코어 kind

[제안] L1·L0·X 문서가 "F에 요청"으로 남긴 kind를 한 번에 받는다. 받은 요청: `L1.tools.spec` §8.3 F 요청 3과 `F.wire-settings.spec` §4.6(승인, A안 [결정: review.decisions-2 U-02]), `L1.tasks.spec` FR-T1·FR-T2(입력 큐, 취소 의도), `L1.agents.spec` §8.3 3(자식 대화), `L1.persistence.spec` FR-P3(재개), `L0.secrets.spec` §8.3 R3 (a)안(비밀 사용), `X.operations.spec` §10 미결 4(`scope.handler_failed`, `ScopeChangedPayload.reason`). 생산자 소유(`TYPE_PREFIX_OWNERS`)는 `eng.context-map.design` §5.1을 따른다.

records는 capabilities·extensions보다 낮은 순서라(`F.readme` §3) 그 도메인 타입을 import하지 않고 같은 모양을 JSON 수준으로 적는다(`extension-ops.ts`와 같은 방식). 하위 모양의 필드 뜻은 괄호 안 소유 문서를 따르고, 소유 문서와 이 블록이 다르면 이 블록을 고친 뒤 소유 문서를 맞춘다.

```ts
// src/records/catalog/thread.ts (계속)
export interface ThreadResumedPayload {
  turnId: TurnId;
  attempt: number;                // 1부터. 같은 turn의 thread.resumed 수
  mode: "manual" | "auto";
  fromCheckpointId: CheckpointId | null;
}

// src/records/catalog/turn.ts
export interface TurnAbortRequestedPayload {
  reason: { code: "user" | "parent" | "lease_revoked" | "budget" | "lease_lost" | "error"; message: string | null };
  cause: "direct" | "cascade";
  background: boolean;            // 백그라운드 경계를 넘는 취소였는지
}

// src/records/catalog/approval.ts   (하위 모양: L1.tools.spec §3.6)
export interface ApprovalOriginJson {
  threadId: ThreadId; turnId: TurnId | null; stepId: StepId | null;
  toolCallId: string | null;
  caller: string;                 // ApprovalCaller. APPROVAL_CALLER_PATTERN: main | background | host | subagent:<이름> | ext:<이름>
}
export type ApprovalBodyJson =
  | { kind: "tool"; tool: { toolName: string; capability?: { id: string; method: string }; risk: string;
                            args: JsonObject | BlobRef; argsHash: string; ruleId: string | null } }
  | { kind: "plan"; plan: { plan: string | BlobRef; planRef: string | null; nextModes: string[] } }
  | { kind: "question"; question: { questions: { id: string; header?: string; text: string;                    // header: 1~64자 머리글
                                                 options: { id: string; label: string; description?: string; recommended?: boolean }[];
                                                 multiSelect: boolean; allowFreeText: boolean }[] } };   // questions 1~4개
/** approvalId는 envelope id다. payload에 두지 않는다 */
export interface ApprovalRequestedPayload {
  origin: ApprovalOriginJson;
  requestKey: string;             // 1~48자. 같은 thread에서 요청 멱등 키
  title: string;                  // 1~120자
  body: ApprovalBodyJson;
  remember: ("once" | "thread" | "always")[];
  surfaceThreadId: ThreadId;      // 이벤트를 기록하는 대화
  requestedAt: number;            // ms
  expiresAt?: number;             // 만료 시각(ms). 없으면 만료가 없다. 필드가 생기기 전의 기록에는 없다 [결정: m2c G1-11]
  onExpire?: { decision: "deny" } | { decision: "answer"; answer: JsonValue };   // 생략하면 거부
}
export interface ApprovalResolvedPayload {
  approvalId: EventId;            // approval.requested 이벤트 id
  decision: "allow" | "deny" | "answer";
  answer: JsonValue | null;
  remember: "once" | "thread" | "always";
  requestedRemember: "once" | "thread" | "always" | null;
  resolvedBy: "user" | "noninteractive" | "cancelled" | "superseded" | "expired";   // expired: expiresAt이 지나 onExpire대로 해결 [결정: m2c G1-11]
}

- [결정: m2c G1-11] 승인 만료는 내구 필드 두 개와 해결자 하나다. `expiresAt`(요청 커밋 시각 + 제한, epoch ms)은 `approval.requested`에 기록되어 프로세스를 다시 시작해도 제한 시간이 처음부터 다시 재어지지 않는다. `onExpire`는 만료 때의 해결이고, 생략하면 `{ decision: "deny" }`다. `allow`는 쓸 수 없다. 응답이 없던 요청이 허용으로 끝나면 안 되기 때문이다. `answer`는 질문의 추천 답처럼 호출자가 정한 답이고 모양은 요청 kind가 정한다. 만료로 해결되면 `approval.resolved`의 `resolvedBy`가 `expired`이고 `decision`과 `answer`는 `onExpire`의 값이다. 두 필드는 선택이라 `version`을 올리지 않는다(옛 기록은 그대로 읽힌다). 서비스 쪽 입력은 `ApprovalRequestInput.expiresAt`·`onExpire`, L2 포트는 `L2ApprovalRequest`의 같은 이름 필드다(`F.capabilities.spec` §3.12).
  - 구현 범위: M2는 필드를 기록하고 읽기만 한다. 만료를 해결하는 일(시작 때 지난 요청 해결, 타이머)은 M3의 L1.tools 구현이다. 그때까지 `cap-dialog`의 `ask/expiry.ts` 임시 타이머가 같은 일을 하고, F 필드를 쓰는 구현으로 바뀌면 지운다(`L2.dialog.spec` §4.1.1). `expiresAt`이 있는 요청이 M2 구현에서 만료 시각이 지나도 대기로 남는 것은 결함이 아니다.
  - 클라이언트는 `approval.list`의 `request.expiresAt`으로 남은 시간을 보일 수 있다. 해결은 서버가 하므로 클라이언트 시계로 요청을 닫지 않는다.

/**
 * approval.respond의 answer 정본 모양이다. 승인 서비스는 검증한 응답의 answer를 approval.resolved의 answer(ApprovalResolvedPayload.answer)에 그대로 싣는다 [결정: m2 F.8].
 * 스키마는 ApprovalAnswerSchema = PlanAnswerSchema | DenyAnswerSchema | QuestionAnswerSchema (records/catalog/approval.ts).
 * 어느 kind·decision에 어느 모양이 맞는지는 F.wire-settings.spec §3.3.1이 정한다.
 */
export type QuestionAnswerJson = Record<string, { selected: string[]; text?: string }>;   // 질문 id → 답. 최대 4개
export interface PlanAnswerJson { mode?: string; note?: string }       // plan allow. mode는 nextModes 안, note 최대 8192자
export interface DenyAnswerJson { feedback: string }                                      // 1~8192자

// src/records/catalog/input.ts   (L1.tasks.spec §3.8)
export interface InputQueuedPayload {
  mode: "steer" | "followUp" | "next" | "aside";   // "aside"는 F.extensions.spec PostWhen 결정(§10 미결)에 따른다
  item:
    | { kind: "user"; content: string | (TextContent | ImageContent)[] }
    | { kind: "context"; customType: string; content: string | (TextContent | ImageContent)[]; display: boolean; details: JsonValue | null };
  requestId: string;              // 1~64자
  source:
    | { type: "user"; via: "interactive" | "rpc" }
    | { type: "extension"; scopeId: string }
    | { type: "delegation"; childThreadId: ThreadId }
    | { type: "schedule"; timerId: string };
}
export interface InputPlacedPayload { inputId: EventId; itemId: ItemId }      // inputId = input.queued 이벤트 id
export interface InputWithdrawnPayload { inputId: EventId; reason: "user" | "aborted" | "superseded" }

// src/records/catalog/agent.ts   (하위 모양: L1.agents.spec §3.2·§3.4·§3.5)
export type SpawnOwnerJson =
  | { kind: "tool"; turnId: TurnId; toolCallId: string }
  | { kind: "drive"; turnId: TurnId | null; scopeId: string; leaseId: string }
  | { kind: "scope"; scopeId: string };
export interface AgentSpawnedPayload {
  childThreadId: ThreadId;
  agent: string;
  requestId: string;              // 자식 requestId
  owner: SpawnOwnerJson;
  caller: string;                 // "subagent:<agent>"
  depth: number;
  background: boolean;
  fork: { at: "event"; eventId: EventId } | { at: "item"; itemId: ItemId } | null;
  modelRole: string;
}
/** F.extensions.spec의 지점 페이로드 AgentSettledPayload(agent_settled)와 이름이 겹치지 않게 Event를 붙인다 */
export interface AgentSettledEventPayload {
  childThreadId: ThreadId;
  requestId: string;
  status: "completed" | "aborted" | "error";
  report: { text: string; truncated: boolean; flags: string[]; originalChars: number } | null;
  answerItemId: ItemId | null;
  usage: Usage | null;            // 자식 사용량은 여기에만 남는다
  error: string | null;
}
export interface AgentJudgedPayload {
  goalRef: string;
  run: number;                    // 1부터
  verdict: "met" | "not_met" | "undecidable";
  rationale: string;
  missing: string[];
  usage: Usage | null;
  model: { provider: string; modelId: string };
}

// src/records/catalog/secret.ts   (L0.secrets.spec §3.9. 값, 값의 일부, 값의 해시를 싣지 않는다)
type SecretUseModeJson = "env" | "sentinel" | "runtime-http" | "browser-input";
export interface SecretUsedPayload {
  handle: string; mode: SecretUseModeJson; toolCallId: string | null;
  host: string | null; commandHash: string | null; leaseId: string; at: number;
}
export interface SecretDeniedPayload {
  handle: string; mode: SecretUseModeJson; reason: string;   // 값 집합은 L0.secrets.spec SecretDenyReason
  purpose: string; toolCallId: string | null; at: number;
}
export interface SecretApprovedPayload {
  handle: string; scope: "per-session" | "per-use"; approvalId: EventId; expiresAt: number | null; at: number;
}
export interface SecretMaskedPayload {
  hits: { kind: string; count: number }[];
  layer: "human-input" | "tool-result" | "outbound" | "model-projection" | "ops-log";
  at: number;
}
```

- [결정: m2c G1-09] `origin`의 필드마다 값을 채우는 주체가 하나다. 승인 요청을 올리는 쪽(L1.tools의 도구 승인, L2 어댑터의 질문·계획 승인)이 아니라 승인 서비스(`ApprovalService.open`)가 요청을 받을 때 채우거나 검사한다.

  | 필드 | 값 | 공급 |
  |---|---|---|
  | `threadId` | 호출이 일어난 대화. 자식 대화면 자식의 id다. 이벤트를 기록하는 대화(`surfaceThreadId`)와 다를 수 있다 | 호출 문맥 `CallContext.threadId` |
  | `turnId` | 활성 turn. 호스트가 turn 밖에서 직접 낸 호출이면 null | 호출 문맥 `CallContext.turnId` |
  | `toolCallId` | 도구 경로의 호출 id. 도구를 거치지 않은 요청이면 null | 호출 문맥 `CallContext.toolCallId` |
  | `stepId` | `toolCallId`로 찾은 활성 호출의 단계. 활성 호출이 없으면 null. 능력 포트의 `CallContext`에는 `stepId`가 없어 L2 어댑터는 이 값을 채우지 않고 승인 서비스가 채운다 | 승인 서비스 |
  | `caller` | `approvalCallerOf(CallContext.caller)`. 형식은 `APPROVAL_CALLER_PATTERN` | 변환 함수 하나 |

  - 같은 호출에서 L1.tools가 올린 요청과 L2 어댑터가 올린 요청은 이 규칙으로 같은 값이 된다. E5(M2 종료 조건)의 "같은 승인 요청 레코드"는 `turnId`, `stepId`, `toolCallId`, `caller` 값이 같다는 뜻이다. 키 이름만 같은 것은 통과가 아니다.
  - `caller` 변환 규칙은 `F.capabilities.spec` §3.2의 `CallerInfo` 아래 결정 문단이 정한다. `ext:<이름>`은 확장·그룹 코드가 능력을 부른 요청이고, `background`는 백그라운드 포크, `host`는 호스트가 직접 낸 호출이다.

- [제안] `secret.*`는 `L0.secrets.spec` §8.3 R3의 (a)안으로 한정한다. 세션 이벤트는 `used`, `denied`, `approved`, `masked` 넷이고 생산자는 `core.tools`(tool-runtime)다. 관리 레코드(`secret.created`, `updated`, `deleted`, `rotated`, `revealed`)는 세션 이벤트로 넣지 않는다. 감사 레코드의 `threadId`와 `type`은 envelope의 `threadId`와 `kind`로 옮겨서 payload에 두지 않는다.
- [결정: review.decisions-2 U-05] `post.accepted`는 retire한다. 카탈로그 항목은 `retired: true`로 남기고(§3.2 규칙 5) 새로 쓰지 않는다. 확장 post의 기록은 `input.queued`(`source.type: "extension"`, `scopeId`, `requestId`) 하나이고, 대화에 배치된 item은 `input.placed`가 적는다. 멱등 판정은 커밋 키 `in:<sourceKey>:<requestId>`(`eng.transactions.design` §4.8)와 `TxView.inputByRequestId`가 한다.
- [제안] M1 표지: 위 15종은 이 절로 카탈로그에 들어왔다. 그래도 코드(`CORE_EVENT_CATALOG`)와 `check-event-catalog.ts` 대조가 `F.records.plan`의 해당 작업으로 반영되기 전에는 소비 plan(`L1.tools`, `L1.tasks`, `L1.agents`)이 이 kind를 쓰는 테스트를 M1 완료 조건에 넣지 않는다.

#### 3.3.2 내장 L2 도메인 소유 카탈로그

[제안] L2 요청(`L2.readme` §5.9, §10 미결 13)을 받는다. 내장 L2 도메인의 kind는 `x.` 접두 없이 `<영역>.<이름>`을 쓰고, 영역은 `DomainArea`(§3.2)다.

| 영역 | 상태 | 카탈로그 파일 | 상수 | 소유 생산자 |
|---|---|---|---|---|
| `work` | 사용 | `src/records/catalog/work.ts` | `WORK_EVENT_CATALOG` | `cap.work` |
| `dialog` | 사용 | `src/records/catalog/dialog.ts` | `DIALOG_EVENT_CATALOG` | `cap.dialog` |
| `artifact` | 사용 | `src/records/catalog/artifact.ts` | `ARTIFACT_EVENT_CATALOG` | `cap.artifacts` |
| `schedule` | 사용 | `src/records/catalog/schedule.ts` | `SCHEDULE_EVENT_CATALOG` | `cap.schedule` |
| `workspace`, `mcp`, `web`, `knowledge` | 예약(`ReservedDomainArea`) | kind를 처음 더할 때 같은 형식으로 만든다 | `<DOMAIN>_EVENT_CATALOG` | `cap.<도메인>` |

규칙:

1. 각 파일은 `CatalogEntry[]`를 export한다. 휘발 kind는 `durable: false`다. 이름은 §3.2 규칙 1(점 하나, snake_case)을 따른다.
2. 병합: `src/records/catalog/index.ts`가 `CORE_EVENT_CATALOG`와 도메인 카탈로그를 이어 `EVENT_CATALOG: readonly CatalogEntry[]`를 만든다. 같은 kind가 두 번 나오면 모듈 로드 시 `Bug`다. `parseEventKind`와 `catalogEntry`는 병합 카탈로그로 판정한다(§3.2 규칙 7). `CORE_EVENT_CATALOG`는 코어 40종만 담고 `check-event-catalog.ts`는 코어 표(§3.3)와 각 도메인 문서의 카탈로그 표를 따로 대조한다.
3. 접두 표기: 이벤트 영역은 단수 `artifact`다. 능력 id·서비스·테이블의 복수 `artifacts`(`cap.artifacts`, `L2.artifacts.spec`)는 그대로 두고 둘의 대응은 위 표가 정한다(`L2.readme` §2 표 주석).
4. 소유: `TYPE_PREFIX_OWNERS`(`src/records/owners.ts`, 표의 정본은 `eng.context-map.design` §5.1)에 `work.` → `cap.work`, `dialog.` → `cap.dialog`, `artifact.` → `cap.artifacts`, `schedule.` → `cap.schedule` 행을 둔다. 커밋 때 접두 소유 검사는 이 표로 한다.
5. payload 스키마는 records 순서(`F.readme` §3)를 지켜 각 카탈로그 파일에 둔다. capabilities 정의 파일(`defs/<domain>.ts`)에서 import하지 않는다(`L2.work.spec` W-4 답). 정의 파일과 같은 값 모양(작업, 목표, 보고, 상태줄 세그먼트 등)은 카탈로그 파일에 다시 적고, `test/records/work-catalog.test.ts`·`dialog-catalog.test.ts`가 두 쪽을 JSON Schema로 비교해(설명 문구는 제외) 어긋남을 잡는다. 브랜드 타입은 `base`의 같은 `Brand`라 서로 대입된다. [결정: m2-plan F.3]
6. 외부 확장이 `DomainArea`·`ReservedDomainArea`를 접두 없이 쓰면 `reserved_area`다. 외부 확장이 L2 도메인 이름을 확장 이름으로 쓰는 경우는 `F.extensions.spec` §4.7 `name_reserved`가 막는다.
7. [결정: m2-plan F.3] M2 현재 `WORK_EVENT_CATALOG`(10종, 모두 내구)와 `DIALOG_EVENT_CATALOG`(`dialog.status` 휘발, `dialog.notified` 내구)가 `EVENT_CATALOG`에 병합되어 있다. `artifact`, `schedule`은 M3에서 더한다. `CatalogEntry` 타입은 `catalog/entry.ts`에 있고 `catalog/index.ts`가 재노출한다(도메인 카탈로그 파일이 `index.ts`를 import하면 순환이라서다).

### 3.4 내구/휘발과 큰 값 분리

```ts
// src/records/blob.ts
export interface BlobRef {
  type: "blob";
  sha256: string;                 // 소문자 hex 64자
  size: number;                   // 바이트, 정수 ≥ 0
  mediaType: string | null;
}
export const BlobRefSchema: Schema<BlobRef>;

/** envelope payload 안에서 blob으로 옮긴 문자열 필드. 그 위치의 값은 "blob:sha256:<hex>" 자리표시 문자열이다. */
export interface DetachedField {
  pointer: string;                // RFC 6901 JSON Pointer, payload 기준
  ref: BlobRef;
}
export const DetachedFieldSchema: Schema<DetachedField>;
export const BLOB_PLACEHOLDER_PREFIX: string = "blob:sha256:";
```

규칙 [제안]:

1. 휘발 이벤트는 `seq`가 없고 `(threadId, turnId)` 안 조각 번호 `n`을 받는다. 재전송하지 않는다. 놓친 조각은 이후 내구 이벤트(완성 item·파트)로 대체된다(19 §3.5.2).
2. 토큰 델타와 도구 출력 진행은 휘발이다. 완성된 파트, item, 효과 결과만 내구다.
3. 내구 envelope의 정규화 전 JSON 직렬화 크기는 256 KiB(262,144바이트) 이하다. 넘으면 저장소가 쓰기를 거부한다(`event_too_large`). 09 §3.2 필드 규칙 6과 같은 값이다.
4. 256 KiB를 넘는 값은 쓰기 전에 blob으로 옮긴다(oh-my-pi 방식, `_research/session-storage.md` 권장안). 옮기는 방법은 둘이다.
   - 명시 필드: `effect.intent.args`, `effect.result.blobRef`처럼 스키마가 `BlobRef`를 허용하는 필드.
   - 문자열 분리: 이미지 `data` 같은 큰 문자열은 그 자리를 `blob:sha256:<hex>` 자리표시로 바꾸고 `detached`에 위치를 적는다. 자리표시도 문자열이라 payload 스키마 검증 결과가 바뀌지 않는다. `detached`에 적힌 위치만 blob으로 해석한다.
5. payload 스키마 검증은 분리 전 값으로 한다. 읽는 쪽은 `detached`를 되돌린 뒤 소비한다. 되돌리는 구현(blob 읽기)은 L0-e·L1-f 몫이다.
6. blob 저장 위치, 쓰기 순서(blob 먼저 fsync, 이벤트 나중), 정리 규칙은 `L0.store.spec`이 정한다.

### 3.5 효과 이벤트 3단과 재생 정책

```ts
// src/records/effects.ts
// ReplayPolicy, ReplayPolicySchema, toReplayPolicy의 정의는 F.conversation.spec §3.6(tool-result.ts)이다.
// records와 capabilities가 함께 쓰므로 둘 다 import할 수 있는 conversation에 둔다(F.readme §3). records는 같은 심볼을 다시 export한다.
import { type ReplayPolicy, ReplayPolicySchema, toReplayPolicy } from "../conversation/tool-result.ts";
export { type ReplayPolicy, ReplayPolicySchema, toReplayPolicy };

export interface EffectIntent {
  effectId: EffectId;             // efx_<ULID>
  toolCallId: string;             // pi ToolCall.id
  toolName: string;
  itemId: ItemId;                 // 도구 호출 item
  argsHash: string;               // 최종 인자 정규화 JSON의 sha256 hex
  args: JsonObject | BlobRef;     // 검증·정규화한 최종 인자. 재실행 입력(§3.5 기록 순서 1)
  replay: ReplayPolicy;
  idempotencyKey: string | null;  // 외부 멱등 키(도구가 제공할 때)
}
export interface EffectExec {
  effectId: EffectId;
  startedAt: number;              // ms
}
export type EffectStatus = "ok" | "error" | "interrupted" | "abandoned";
export interface EffectOutput {
  structuredContent: JsonValue | null;
  terminate: boolean;
  status?: ResultStatus;          // 없으면 "complete" (F.conversation.spec §3.6)
  inputRequired?: InputRequiredInfo;
}
export interface EffectResult {
  effectId: EffectId;
  status: EffectStatus;
  resultItemId: ItemId | null;    // 같은 커밋의 toolResult item
  output: EffectOutput | null;    // 합성 결과는 null
  blobRef: BlobRef | null;        // 잘리기 전 전체 원본 출력
  durationMs: number | null;
  synthesized: boolean;           // 복구 규칙이 만든 결과면 true
}
export const EffectIntentSchema: Schema<EffectIntent>;
export const EffectExecSchema: Schema<EffectExec>;
export const EffectResultSchema: Schema<EffectResult>;

export type EffectRecovery =
  | { action: "none" }                                         // 결과가 이미 있음
  | { action: "rerun"; intent: EffectIntent }                  // 저장 인자로 다시 실행
  | { action: "synthesize"; code: "not_started" | "outcome_unknown"; result: EffectResult; content: string };

/** 재개 시 결과 없는 효과를 어떻게 닫을지 정하는 순수 함수. */
export function decideEffectRecovery(input: {
  intent: EffectIntent;
  exec: EffectExec | null;
  result: EffectResult | null;
  currentReplay: ReplayPolicy | null;   // 현재 등록된 도구의 선언. 도구가 사라졌으면 null
}): EffectRecovery;

export const OUTCOME_UNKNOWN_TEXT: string;
// "The tool call was interrupted before its result was recorded. It may have taken effect. Check the current state before retrying."
export const NOT_STARTED_TEXT: string;
// "The tool call was interrupted before it started. It had no effect."
```

기록 순서 [제안]:

1. `effect.intent`: `tool_call` 지점(first, 인자 변경 불가. `F.extensions.spec` §3.4 #13)을 통과한 뒤 L1.tools가 검증·정규화한 최종 인자로 실행 전에 커밋한다. 인자 변경 경로(`F.extensions.spec` §10 후보 b·c)를 채택하면 이 문장을 그 경로를 거친 인자로 고친다.
2. `effect.exec`: 실행 직전에 커밋한다. `intent`와 같은 커밋에 넣어도 된다. 둘을 나누면 "실행 시작 전 중단"과 "실행 중 중단"을 구분할 수 있다.
3. `effect.result`: 결과 toolResult `item.recorded`와 같은 커밋에 쓴다(pi durable `harness/tool.ts:588-630`, `_research/notes/F-3.md` §7).

재생 정책 [제안]:

- 값 집합은 pi durable의 `"safe" | "unsafe"`를 쓴다. 기본값은 `unsafe`다.
- agent-core `AgentTool.replay`는 `"never" | "safe"`이고 기본값이 없다(agent `types.ts:490`). 매핑은 `"safe"` → `"safe"`, `"never"`·미선언 → `"unsafe"`다. 이름 통일 자체는 사용자 확인 대상이다(`_research/notes/F-3.md` §8.3 미결 1, 이 문서 §10 미결 4).

`decideEffectRecovery` 결정표:

| result | exec | intent.replay | currentReplay | 결정 |
|---|---|---|---|---|
| 있음 | — | — | — | `none` |
| 없음 | 없음 | safe | safe | `rerun` |
| 없음 | 없음 | 그 밖 | 그 밖 | `synthesize`, `not_started`, status `abandoned` |
| 없음 | 있음 | safe | safe | `rerun` |
| 없음 | 있음 | 그 밖 | 그 밖 | `synthesize`, `outcome_unknown`, status `interrupted` |

- 재실행은 저장된 `intent.replay`와 현재 선언이 모두 `safe`일 때만 한다(pi durable `durable/test/harness-tools-recovery.test.ts:136-156`, spec 2082-2108).
- 합성 결과는 `isError: true`인 toolResult 메시지(`content` = 위 문구)로 모델에 보낸다. pi의 "No result provided" 합성은 효과 가능성을 알리지 않아 쓰지 않는다(`_research/item-catalog.md` L1-f "결과 불명 처리"). 근거: pi durable `docs/spec.md` 1917-1927.
- `safe` 재실행이어도 외부 효과의 멱등성은 도구 몫이다(spec 2936-2940). `idempotencyKey`는 이를 돕는 칸이다.

### 3.6 단계 체크포인트

```ts
// src/records/checkpoint.ts
export const STEP_CHECKPOINT_SCHEMA_VERSION: number = 1;

export interface PendingToolCall {
  toolCallId: string;
  effectId: EffectId | null;      // intent를 쓰기 전이면 null
  waiting: "approval" | "input_required" | "deferred" | null;
}
export interface StepCheckpoint {
  checkpointId: CheckpointId;     // ckp_<ULID>
  schemaVersion: number;          // STEP_CHECKPOINT_SCHEMA_VERSION
  threadId: ThreadId;
  turnId: TurnId;
  stepId: StepId;
  stepIndex: number;
  leafEventId: EventId;           // 이 체크포인트 직전 내구 이벤트(같은 커밋의 step.completed)
  next: "request" | "tools" | "await_input" | "turn_end";
  pendingToolCalls: PendingToolCall[];
  inputCursor: { consumedSeq: number };   // 입력 큐에서 마지막으로 소비한 내구 seq
  model: { provider: string; modelId: string; thinkingLevel: ModelThinkingLevel };
  leaseRefs: EventId[];           // 유효한 lease.acquired 이벤트
  scopeRef: EventId | null;       // 마지막 scope.changed 이벤트
}
export const StepCheckpointSchema: Schema<StepCheckpoint>;
```

- [제안] 체크포인트는 단계 경계마다 `step.completed`와 같은 커밋으로 쓴다. 이 커밋은 `synchronous=FULL`을 전제로 한다(`_research/foundation-plan.md` §2 DB 행). 저장 설정 자체는 `L0.store.spec`이 정한다.
- [제안] 루프 상태 전부를 복사하지 않는다. drive 임대와 scope 상태는 해당 이벤트 id로 참조한다. 대화 내용은 `leafEventId`에서 가지를 거슬러 읽는다.
- [제안] `next`가 pi durable `GenerationCheckpoint`의 `phase` 판별자에 해당한다(`durable/src/harness/generation.ts:53-90`). pi는 phase마다 레코드를 통째로 바꾸지만 Xeon은 단계 경계에만 쓰고 단계 안의 진행은 이벤트에서 복원한다.
- `model`은 재개 후 첫 요청에 쓴다. pi durable `request` 체크포인트의 `model`, `thinkingLevel`과 같은 목적이다.

### 3.7 스키마 버전과 마이그레이션

```ts
// src/records/versioning.ts
import type { SqlTx } from "./sql.ts";   // §3.9

/** v(n) payload → v(n+1) payload. 순수 함수. 저장된 행은 바꾸지 않는다. */
export type Upcaster = (payload: unknown) => unknown;

export interface KindVersioning {
  current: number;                       // 현재 버전
  upcasters: readonly Upcaster[];        // upcasters[i]: v(i+1) → v(i+2). 길이 = current - 1
}
export type UpcasterRegistry = ReadonlyMap<string, KindVersioning>;

export type UpcastError =
  | { kind: "unknown_kind"; eventKind: string }
  | { kind: "future_version"; eventKind: string; version: number; current: number }
  | { kind: "missing_upcaster"; eventKind: string; from: number };
export type UpcastResult = Result<DurableEventEnvelope, UpcastError>;

/** version을 current까지 올린 사본을 돌려준다. */
export function upcastEvent(event: DurableEventEnvelope, registry: UpcasterRegistry): UpcastResult;

export interface ProjectionVersion { name: string; version: number }

/** 큰 백필을 청크로 나누는 마이그레이션 계약. 구현은 L0-e. 커서는 JSON 값으로 저장한다.
 *  runChunk는 동기이고 실행기가 연 트랜잭션 tx를 받는다. 실행기는 같은 tx에 커서를 저장한다(규칙 6, L0.store.spec FR-S5) */
export interface ChunkMigration<C extends JsonValue> {
  readonly id: string;                   // 예: "0003_parts_backfill"
  readonly initialCursor: C;
  runChunk(tx: SqlTx, cursor: C, budget: { readonly maxRows: number }): { readonly next: C | null; readonly processed: number };
}
```

규칙 [제안] (09 §3.13.3의 여섯 규칙을 줄여 가져온다):

1. DB 스키마 버전(L0-e, `user_version`)과 kind별 payload `version`은 따로 간다.
2. 저장된 이벤트를 제자리에서 고쳐 쓰지 않는다. 형식 변환은 업캐스터, 데이터 정정은 새 이벤트로 한다.
3. 업캐스터가 없거나 `version`이 현재보다 크면 명시 오류(`missing_upcaster`, `future_version`)를 낸다. 건너뛰고 투영하지 않는다.
4. 알 수 없는 kind(`unknown_kind`)도 오류다. 단, 등록이 해제된 확장 kind는 투영에서 건너뛸 수 있는 예외로 둘지 [미결](§10 미결 5).
5. 투영 모양이나 규칙이 바뀌면 `ProjectionVersion.version`을 올린다. DB 마이그레이션 없이 내구 이벤트를 처음부터 재생해 투영을 다시 만든다.
6. 청크 마이그레이션은 청크마다 별도 트랜잭션이고 커서를 같은 트랜잭션에 저장한다. 중단 뒤에는 저장된 커서부터 이어간다.

7. [결정: m2c G2-06] 저장소를 열지 못한 이유는 안내 분류 넷으로 나눈다(`migrations.ts`의 `STORE_FAILURE_KINDS`, 순수 함수 `storeFailureKindOf(kind)`). 안내 문구와 복구 길이 달라서 한 이름(`storeUnavailable`)으로 합치지 않는다.

   | 분류 | 해당하는 오류 kind | 뜻과 안내 |
   |---|---|---|
   | `future_version` | `migration_future_version` | DB가 이 앱보다 새 버전이다(앱을 되돌렸다). 마이그레이션이 DB를 건드리지 않는다. 앱을 새 버전으로 올린다. 읽기 전용으로 여는 길은 M3 |
   | `corrupt` | `corrupt`, `migration_checksum_mismatch`, `migration_gap`, 저장된 행의 `row_invalid` | 파일이 망가졌거나 마이그레이션 이력이 맞지 않거나 행이 스키마와 다르다. 마이그레이션 전 스냅샷이나 백업에서 되살린다 |
   | `migration_failed` | `migration_failed` | 마이그레이션 단계가 실패했다. 앞 단계는 유지된다. 마이그레이션 전 스냅샷으로 돌아가고 같은 버전에서 보고한다 |
   | `unavailable` | 그 밖의 모든 kind(`busy`, `disk_full`, `io`, `permission`, `unsupported_filesystem`, `db_path_invalid`, `foreign_database`, `fts5_missing`, `sqlite_load_failed`) | 환경을 고치면 풀린다. 모르는 kind도 여기다 |

   - 이름을 문자열로 받는 이유는 F가 L0.store의 `StoreOpenError`를 import하지 못해서다. 새 오류 kind를 더하면 분류 표와 시험을 먼저 고친다.
   - 호스트는 `AssembleError`의 store 이유를 이 분류로 나눠 클라이언트에 알린다. 실행 중에 만난 `row_invalid`는 wire `store.corrupt`(5007, `F.wire-settings.spec` §3.5.2)로 알린다. 이전에는 `store.io`의 `details.code: "row_invalid"`로 옮겼다.
   - 마이그레이션 전 스냅샷(`VACUUM INTO`)의 보관 수와 복구 절차는 L0.store와 운영 문서가 정한다. 내보내기와 복구 런북은 M3다.

### 3.8 세션 저장소 인터페이스 (2차)

```ts
// src/records/store.ts
import type { CommitKey } from "./commit.ts";   // §3.9
export interface AppendBatch {
  threadId: ThreadId;
  /** 커밋 멱등 키. 형식과 지문 규칙은 §3.9 CommitRequest.requestId와 같다 */
  requestId: CommitKey;
  events: readonly DurableEventDraft[];
  checkpoint?: StepCheckpoint;           // 있으면 같은 트랜잭션에서 체크포인트 투영 갱신
  expectedLeaf?: EventId | null;         // 낙관 검사. 다르면 conflict
}
export type AppendError =
  | { kind: "conflict"; currentLeaf: EventId | null }
  | { kind: "event_too_large"; eventId: EventId; bytes: number; limit: number }
  | { kind: "invalid_payload"; eventId: EventId; eventKind: string }
  | { kind: "key_reused"; requestId: CommitKey }
  | { kind: "storage"; message: string };
export type AppendResult = Result<{ firstSeq: number; lastSeq: number; leaf: EventId }, AppendError>;

export interface SessionStore {
  /** 원자 커밋. 전부 쓰거나 아무것도 쓰지 않는다. seq·recordedAt·parentId를 채운다. */
  appendBatch(batch: AppendBatch): Promise<AppendResult>;
  /** seq 오름차순. threadId를 주면 그 thread만. */
  readFrom(fromSeq: number, options?: { threadId?: ThreadId; limit?: number }): AsyncIterable<DurableEventEnvelope>;
  /** leaf에서 parentId를 따라 루트까지 거슬러 읽고 루트→leaf 순서로 돌려준다. */
  readBranch(threadId: ThreadId, leaf: EventId): AsyncIterable<DurableEventEnvelope>;
  loadCheckpoint(threadId: ThreadId): Promise<StepCheckpoint | null>;
  /** fromSeq 이후 내구 이벤트를 커밋 순서로 전달한다. */
  subscribe(fromSeq: number, listener: (event: DurableEventEnvelope) => void): () => void;
}
```

- [제안] 내구 수준 필드를 두지 않는다. 모든 커밋은 `synchronous=FULL`이고 설정은 `L0.store.spec` §4.3이 정한다(`eng.transactions.design` §3.2, `L1.persistence.spec` §4.3 2번).
- [제안] `requestId`가 같은 두 번째 `appendBatch`는 새로 쓰지 않고 처음 결과를 돌려준다. 지문이 다르면 `key_reused`다. 규칙은 `SessionService.commit`과 같다(§3.9).
- [제안] `SessionService`와의 관계: M1 커밋 경로는 `SessionService.commit`(동기, §3.9)이다. `SessionStore.appendBatch`는 2차 외부 저장소 교체용 어댑터 포트이고, SQLite 구현은 `SessionService` 위의 얇은 어댑터다(`L1.persistence.spec` §3.1 3번).
- [제안] 확장 접두사 테이블 쓰기를 같은 트랜잭션에 넣는 방법은 이 인터페이스에 두지 않는다. L0-e 저장소 API가 트랜잭션 핸들을 확장 쓰기에 넘기는 방식을 `L0.store.spec`과 `F.extensions.spec`이 정한다.
- [제안] 어댑터 적합성 스위트를 둔다. 모든 `SessionStore` 구현은 같은 시나리오 테스트(원자성, seq 무간격, 분기 읽기, 구독 순서, 크기 거부)를 통과해야 한다. pi durable `testing/storage-conformance.ts`의 방식(어댑터 팩토리를 받아 같은 테스트를 돌림)만 차용하고 코드는 가져오지 않는다(`_research/packages.md` §4.1 F2).
- 첫 구현은 SQLite 어댑터 하나다(`_research/item-catalog.md` F절 "세션 저장소 외부화 인터페이스").

### 3.9 저장·투영 포트 타입

[제안] L0·L1·X가 같은 층 import 없이 저장소와 커밋 포트를 주입받도록 포트 타입을 records에 둔다. 받은 요청: `L0.store.spec` §8.1 FR-S1·FR-S5, `L1.persistence.spec` §8.3 FR-P1·FR-P2. 아래 블록이 이름과 시그니처의 정본이다. 구현은 `platform-store`(L0)와 `core-persistence`(L1)다.

```ts
// src/records/sql.ts   (다른 records 파일을 import하지 않는다)
export type SqlValue = string | number | bigint | Uint8Array | null;
export type SqlRow = Readonly<Record<string, SqlValue>>;
export interface SqlTx {
  run(sql: string, params?: readonly SqlValue[]): { readonly changes: number };
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
}

// src/records/store-db.ts
import type { Result } from "../base/index.ts";
import type { BlobRef } from "./blob.ts";
import type { LeaseService } from "./lease.ts";
import type { ExtensionTables, MigrationRunner } from "./migrations.ts";
import type { SqlTx } from "./sql.ts";

export const StoreServiceName: "xeon.store" = "xeon.store";
export type StoreWriteError =
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };          // SQLITE_IOERR 계열, SQLITE_READONLY
export type StoreReadError = { readonly kind: "busy" } | { readonly kind: "io"; readonly code: string };
export interface StoreDb {
  /** BEGIN IMMEDIATE … COMMIT. fn은 동기. fn이 던지면 롤백 후 다시 던진다. 중첩 호출은 Bug(store.nested_write) */
  write<T>(fn: (tx: SqlTx) => T): Result<T, StoreWriteError>;
  /** 읽기 연결의 BEGIN DEFERRED. 같은 스냅숏에서 읽는다 */
  read<T>(fn: (tx: SqlTx) => T): Result<T, StoreReadError>;
}
export interface StoreCapabilities {
  readonly fts5: boolean;
  readonly sqliteVersion: string;
  readonly customSqlitePath: string | null;   // macOS setCustomSQLite 경로. 그 밖에는 null
  readonly lockProvider: "flock" | "win32" | "none";
}
export type BlobError =
  | { readonly kind: "blob_missing"; readonly sha256: string }
  | { readonly kind: "blob_corrupt"; readonly sha256: string; readonly reason: "size" | "hash" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string };
export interface StoreService {
  readonly storeId: string;                   // "sto_<ULID>"(F.conversation.spec §3.2.1 ①)
  readonly capabilities: StoreCapabilities;
  /** 이 소유자의 테이블만 쓰는 핸들. 소유자가 sys_prefixes에 없으면 Bug(store.prefix_not_owned) */
  scoped(owner: string): StoreDb;
  readonly migrations: MigrationRunner;
  readonly extensions: ExtensionTables;
  readonly leases: LeaseService;
  /** 트랜잭션 밖에서만 부른다(TX-04) */
  putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError>;
  readBlob(ref: BlobRef): Result<Uint8Array, BlobError>;
}

// src/records/commit.ts
/** 커밋 키. 예: "tool:<toolCallId>:result". 1~200자 */
export type CommitKey = string;
/** 코드 상수 위치. 형식 정본은 eng.transactions.design §4.7(review.decisions-2 U-13) */
export const COMMIT_KEY_PATTERN: string = "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$";
/** 밖에서 온 id(toolCallId)를 키 부분으로 바꾸는 유일한 함수. 규칙 정본은 eng.transactions.design §4.7(review.decisions-2 U-13).
 *  원문이 ^[A-Za-z0-9_.-]{1,120}$이고 "h_"로 시작하지 않으면 그대로, 아니면 "h_" + sha256Hex(원문) 앞 40자. 순수 */
export function commitKeyPart(raw: string, sha256Hex: (text: string) => string): string;
/** 승인 요청 키(`approval.requested`의 requestKey, `ApprovalRequestInput.requestKey`)의 길이 상한. `approval.requested` 스키마의 requestKey maxLength와 `L2_APPROVAL_REQUEST_ID_MAX`는 순환 import와 services의 값 import 금지 때문에 같은 값을 거울로 두고 시험이 일치를 지킨다 [결정: 통합 검토 L6] */
export const APPROVAL_REQUEST_KEY_MAX: number = 48;
/** 밖에서 온 id(toolCallId, L2 requestId)를 승인 요청 키(`^[A-Za-z0-9_.-]{1,48}$`)로 바꾸는 유일한 함수 [결정: 통합 검토 L6]. commitKeyPart(raw)가 48자 이하면 그대로,
 *  넘으면 "h_" + sha256Hex(원문) 앞 40자. core-tools 파이프라인, 호스트 l2-approvals, cap-*가 자기 함수를 따로 두지 않고 이 함수를 쓴다. 순수 */
export function requestKeyFor(raw: string, sha256Hex: (text: string) => string): string;
/** 값이 requestKeyFor가 낼 수 있는 승인 요청 키인지 판정한다(해시 없이). 1~48자 ^[A-Za-z0-9_.-]+$이고 "h_"로 시작하면 정확히 "h_" + 소문자 hex 40자여야 한다("h_plain" 같은 원문은 키가 아니다).
 *  이미 키를 만든 호출자의 값을 다시 해시하지 않고 검사만 하는 자리(호스트 l2-approvals)가 쓴다. 키 알파벳 정의는 이 파일 하나다 [결정: 통합 검토 L5 후속 N-2]. 순수 */
export function isApprovalRequestKey(value: string): boolean;
/** 확장이 아닌 입력 출처 키. 확장 id로 쓸 수 없다(F.extensions.spec §4.7 name_reserved, review.decisions-2 U-13) */
export const RESERVED_SOURCE_KEYS: readonly ["user", "deleg", "timer"];
/** 생산자 id. 형식 정본은 eng.context-map.design §5.1 */
export type ProducerId =
  | "core.persistence" | "core.tasks" | "core.loop" | "core.context" | "core.tools" | "core.agents" | "core.models"
  | `cap.${string}` | "xh" | `ext.${string}`;
declare const stampedBrand: unique symbol;
export interface StampedDraft { readonly draft: DurableEventDraft; readonly producer: ProducerId; readonly [stampedBrand]: true }
export type DraftInput = Omit<DurableEventDraft, "durable" | "version"> & { readonly version?: number };
export interface ProducerHandle {
  readonly producer: ProducerId;
  /** 소유하지 않은 kind면 Bug("store.prefix_not_owned"). 동기, 순수 */
  draft(input: DraftInput): StampedDraft;
}
export type StepCheckpointInput = Omit<StepCheckpoint, "checkpointId" | "schemaVersion" | "threadId" | "leafEventId">;
export type CommitPlan =
  | { readonly kind: "append"; readonly drafts: readonly StampedDraft[]; readonly checkpoint: StepCheckpointInput | null }
  | { readonly kind: "reject"; readonly code: string; readonly detail: string | null }
  /** build가 읽기에 실패해(동기 읽기 연결의 busy, 손상 행) 계획을 세울 수 없다. 롤백하고 기록하지 않는다. commit은 err(error)를 돌려주고, reject와 달리 키에 결과가 남지 않아 같은 키로 다시 낼 수 있다 */
  | { readonly kind: "abort"; readonly error: ReadFailure };
export interface CommitRequest {
  readonly threadId: ThreadId;
  readonly requestId: CommitKey;
  /** 지문 원천. 생성 id, 시각, 시도 번호, 연결 id를 넣지 않는다(eng.transactions.design §4.7) */
  readonly fingerprintSource: JsonValue;
  /** 동기, 순수. 트랜잭션 안에서 한 번 부른다 */
  readonly build: (view: TxView) => CommitPlan;
  readonly expectedLeaf?: EventId | null;
}
export type CommitResult =
  | { readonly status: "committed"; readonly firstSeq: number; readonly lastSeq: number; readonly leaf: EventId | null;
      readonly eventIds: readonly EventId[]; readonly replayed: boolean }
  | { readonly status: "rejected"; readonly code: string; readonly detail: string | null; readonly replayed: boolean }
  | { readonly status: "key_reused"; readonly requestId: CommitKey };
export type ReadOnlyReason = "observer" | "unknown_event_kind" | "newer_event_version" | "core_projection_stale";
export type StoreError =
  | { readonly kind: "busy" }
  | { readonly kind: "disk_full" }
  | { readonly kind: "io"; readonly code: string }                           // 저장 매체 I/O 실패. code는 OS·SQLite 코드(손상은 SQLITE_CORRUPT*)
  | { readonly kind: "ownership_lost"; readonly threadId: ThreadId }
  | { readonly kind: "read_only"; readonly reason: ReadOnlyReason }
  | { readonly kind: "thread_not_found"; readonly threadId: ThreadId }
  | { readonly kind: "row_invalid"; readonly where: string };                // 저장된 행이 스키마와 다르다(손상, 수동 편집, 이전 버전). where는 `<표>.<열>` 같은 위치 이름
/** 읽기 API가 돌려주는 실패: 읽기 연결의 busy와 io, 손상 행 */
export type ReadFailure = Extract<StoreError, { readonly kind: "busy" | "io" | "row_invalid" }>;
export type StoreBugCode =
  | "store.nested_write" | "store.prefix_not_owned" | "store.producer_claimed" | "store.schema_invalid"
  | "store.kind_unregistered" | "store.event_too_large" | "store.checkpoint_without_step"
  | "store.projection_failed" | "store.replay_diverged";
/** build가 읽는 트랜잭션 안 보기. 메서드 목록은 아래 표 */
export interface TxView { readonly threadId: ThreadId; readonly headSeq: number; readonly leaf: EventId | null; /* … */ }

// src/records/projector.ts
import type { SqlRow, SqlValue } from "./sql.ts";
/** 투영기가 받는 SQL 핸들. 소유 테이블 밖 문장은 테스트·디버그 빌드에서 Bug("store.prefix_not_owned") */
export interface ProjectionTx {
  run(sql: string, params?: readonly SqlValue[]): void;
  get(sql: string, params?: readonly SqlValue[]): SqlRow | undefined;
  all(sql: string, params?: readonly SqlValue[]): readonly SqlRow[];
}
export interface Projector {
  readonly name: string;                      // "core" | "cap.<도메인>" | "ext.<확장 이름>"
  readonly version: number;                   // §3.7 규칙 5
  readonly tables: readonly string[];
  readonly ddl: readonly string[];
  readonly kinds: readonly EventKind[] | "all";
  /** 업캐스트된 이벤트를 받는다. 동기, 순수, I/O 없음 */
  apply(tx: ProjectionTx, event: DurableEventEnvelope): void;
}

// src/records/session-service.ts
export type Unsubscribe = () => void;         // records는 extensions보다 낮아 같은 모양을 적는다
export const SessionServiceName: "xeon.session" = "xeon.session";
export interface SessionRetention {
  preview(): Result<readonly ThreadId[], ReadFailure>;   // 지금 설정으로 지워질 thread. 지우지 않는다
  prune(): Result<readonly ThreadId[], StoreError>;      // 지울 thread를 지우고 지운 목록을 돌려준다
}
export interface SessionService {
  commit(request: CommitRequest): Result<CommitResult, StoreError>;          // M1 커밋 경로(동기)
  producer(id: ProducerId): ProducerHandle;
  readonly projectors: ProjectorRegistry;
  readonly query: ProjectionQuery;
  // 읽기 실패는 예상 가능한 실패라 Result로 돌려준다. 스트림은 실패를 마지막 원소(err)로 알리고 닫는다
  readFrom(afterSeq: number, options?: { readonly threadId?: ThreadId; readonly limit?: number }): AsyncIterable<Result<DurableEventEnvelope, ReadFailure>>;
  readBranch(threadId: ThreadId, leaf?: EventId): AsyncIterable<Result<DurableEventEnvelope, ReadFailure>>;
  loadCheckpoint(threadId: ThreadId): Promise<Result<StepCheckpoint | null, ReadFailure>>;
  subscribe(afterSeq: number, listener: CommitListener, filter?: FeedFilter): Result<Unsubscribe, ReadFailure>;
  readonly feed: EventFeed;
  hydrate(event: DurableEventEnvelope): Promise<DurableEventEnvelope>;
  emitVolatile(event: VolatileEventEnvelope): void;
  openForWrite(threadId: ThreadId, guard: OwnershipGuard, owner: OwnerInfo): Result<OpenReport, OpenError>;
  openForRead(threadId: ThreadId): Result<OpenReport, OpenError>;
  recover(threadId: ThreadId, deps: RecoverDeps): Result<ResumePlan, StoreError>;
  beginResume(threadId: ThreadId, mode: "manual" | "auto"): Result<{ readonly attempt: number }, ResumeError>;
  release(threadId: ThreadId, reason: SessionShutdownReason): Promise<void>;
  readonly threads: ThreadLifecycle;
  readonly sessionSettings: SessionSettingsStore;
  /** X 포트. commit 이름이 위 commit과 겹쳐 하위 객체로 둔다(L1.persistence.spec §3.3). PortKey.member = "ext" */
  readonly ext: RecordCommitPort;
  /** 보관 정리(L1.persistence.spec §6.1). core-persistence의 RetentionApi가 이 모양을 채운다. 조립 루트가 엔진을 열 때 prune()을 한 번 부른다 */
  readonly retention: SessionRetention;
}

// src/records/session-service.ts (계속) — X 기록 포트
// 정본은 이 블록이다. X.primitives.spec §3.6의 블록을 옮겼다. records는 extensions보다 낮아(F.readme §3)
// ScopeId·LeaseId·DriveLimits·RecordQuery·GroupRecord를 import하지 않고 같은 모양을 적는다(§3.3 extension-ops.ts와 같은 방식).
// ExtensionName도 import하지 않는다. queryRecords의 reader는 같은 모양(string)으로 적는다.
// 이름 대응: scopeId ↔ ScopeId, leaseId ↔ LeaseId, limits ↔ DriveLimits, ExtRecordQuery ↔ RecordQuery, ExtRecordRow ↔ GroupRecord, reader ↔ ExtensionName.
export interface ExtCommitRequest {
  readonly threadId: ThreadId;
  /** SessionWriter 멱등 키. 같은 키의 두 번째 커밋은 기록된 결과를 돌려준다. 형식은 COMMIT_KEY_PATTERN */
  readonly requestId: CommitKey;
  readonly drafts: readonly DurableEventDraft[];
  /** 상태 커밋이면 기대하는 직전 판. 활성 가지 위 판과 비교한다. 다르면 rejected(state_conflict) */
  readonly expectStateRev?: { readonly scopeId: string; readonly rev: number };
  /** 멱등 지문의 원천. 있으면 drafts 대신 이 값으로 지문을 만든다. 규칙은 X.primitives.spec §4.6.1 */
  readonly fingerprintSource?: JsonValue;
  /**
   * 기록 초안의 공개 범위 [결정: review.decisions-2 T-21]. 생략하면 "public".
   * "private"는 ScopeApi.recordPrivate(F.extensions.spec §3.2, X.primitives.spec §4.6.5)만 쓴다
   */
  readonly visibility?: "public" | "private";
}
export type ExtCommitRejectCode =
  | "state_conflict" | "lease_lost"
  /** 저장소의 key_reused와 초안 검증 실패 */
  | "invalid"
  /** 쓰기 잠금 대기 초과 */
  | "busy"
  /** disk_full, read_only 같은 저장 매체 실패 */
  | "storage";
export type ExtCommitResult =
  | { readonly status: "committed" }
  /** 같은 requestId가 이미 커밋됨. 상태 커밋이면 stored에 그때 저장된 상태를 싣는다 */
  | { readonly status: "replayed"; readonly stored?: StoredScopeState }
  | { readonly status: "rejected"; readonly code: ExtCommitRejectCode };
export interface StoredScopeState {
  readonly scopeId: string;
  /** 이 판을 남긴 state.committed 이벤트 id. 다음 상태 이벤트의 prevEventId가 된다 */
  readonly eventId: EventId;
  /** 활성 가지 위 판 */
  readonly rev: number;
  /** 저장 당시 StateDecl.version */
  readonly version: number;
  readonly doc: JsonValue;
}
export interface OpenLease {
  readonly leaseId: string;
  readonly scopeId: string;
  readonly leaseEpoch: number;
  readonly limits: { readonly maxTurns?: number; readonly maxSpawns?: number; readonly maxTokens?: number };
  readonly used: { readonly turns: number; readonly spawns: number; readonly tokens: number };
}
/** 모든 필드는 활성 가지(현재 leaf에서 parentId를 따라 올라간 사슬) 위 이벤트만으로 계산한다 */
export interface ExtThreadSnapshot {
  readonly enabled: readonly string[];
  /** 마지막 scope.changed가 disabled인 scope. 기본 켜짐 scope를 끈 뒤 다시 열어도 끈 상태를 되살리는 데 쓴다 */
  readonly disabled: readonly string[];
  /** scope마다 활성 가지 위 scope.changed 개수(enabled와 disabled 합). 재시작 뒤 커밋 키 구분에 쓴다 */
  readonly scopeTransitions: Readonly<Record<string, number>>;
  /** 켜진 scope마다 마지막 scope.changed{status:"enabled"}의 seq. 켜진 scope만 키를 갖는다 */
  readonly enabledAtSeq: Readonly<Record<string, number>>;
  readonly states: readonly StoredScopeState[];
  /** lease.acquired 뒤 lease.released가 없는 임대. 최대 1개 */
  readonly openLease: OpenLease | null;
  /** scope마다 활성 가지 위 lease.acquired 개수 */
  readonly leaseEpochs: Readonly<Record<string, number>>;
}
export interface ExtRecordQuery {
  /** 확장 kind 또는 접두 "<접두>.*". X가 readsRecordKinds로 거른 뒤의 값 */
  readonly kind: ExtensionEventKind | `${string}.*`;
  readonly subject?: { readonly type: "thread" | "turn" | "step" | "item" | "task" | "external"; readonly id: string };
  readonly limit?: number;
}
export interface ExtRecordRow {
  readonly groupId: string;
  readonly kind: ExtensionEventKind;
  readonly version: number;
  readonly subject: { readonly type: "thread" | "turn" | "step" | "item" | "task" | "external"; readonly id: string };
  readonly payload: JsonValue;
}
export interface RecordCommitPort {
  /** SessionService.commit 한 트랜잭션. 확장 투영(x_<name>_*)도 같은 트랜잭션에서 갱신된다 */
  commit(request: ExtCommitRequest): Promise<ExtCommitResult>;
  /** 활성 가지 기준 스냅샷. 버려진 가지의 이벤트는 보지 않는다 */
  loadThread(threadId: ThreadId): Promise<Result<ExtThreadSnapshot, ReadFailure>>;
  /**
   * 그룹 레코드 조회. reader는 조회하는 확장의 이름(ExtensionName, F.extensions.spec §3.1)이다.
   * private 행은 reader가 그 행의 소유 확장일 때만 돌려준다(아래 규칙)
   */
  queryRecords(
    threadId: ThreadId,
    query: ExtRecordQuery,
    reader: string,
  ): Promise<Result<readonly ExtRecordRow[], ReadFailure>>;
}
```

- 비공개 기록 규칙 [결정: review.decisions-2 T-21]:
  1. `visibility: "private"`인 커밋의 초안은 모두 그 확장 자신의 접두 kind(`x.<name>.*` 또는 `grp.<name>.*`)여야 한다. 아니면 `rejected(invalid)`다. 행의 소유 확장은 kind의 둘째 마디다.
  2. 저장소는 private 여부를 이벤트와 함께 남긴다. 저장 위치(envelope 필드 또는 core 투영 열)는 `L1.persistence.spec`이 정한다.
  3. `queryRecords`의 셋째 인자 `reader: ExtensionName`은 조회하는 확장 이름이다(`L1.persistence.spec` FR-P11). records는 extensions보다 낮아 시그니처에는 같은 모양인 `string`으로 적는다. `queryRecords`는 private 행을 `reader`가 그 행의 소유 확장일 때만 돌려준다. 다른 확장의 조회 결과에는 넣지 않는다. 공개 행은 지금처럼 `kind` 일치만으로 돌려준다.
  4. 확장 투영기(`Projector.kinds`)에는 private 행도 그대로 전달된다. 다른 확장의 kind는 투영기 `kinds`에 둘 수 없으므로(`X.operations.spec` §4.4.4 `kind_not_owned`) 다른 확장에 전달되지 않는다.

- [제안] `SqlValue`·`SqlRow`는 `sql.ts` 한 곳에 둔다. `ProjectionTx`는 `run`의 반환만 다른 별도 인터페이스다.
- [제안] `SessionService.readFrom`·`subscribe`의 첫 인자는 배타 경계 `afterSeq`다. §3.8 `SessionStore`의 `fromSeq`와 이름이 다르며, 정리는 §10 미결 9다.
- [제안] 복구 표식은 records에 두지 않는다. 복구 표식의 정본은 `L1.persistence.spec` §4.8.1의 `p_threads` 열이고, 읽는 경로는 `xeon.session`의 `RecoveryMarker`(`OpenReport.marker`, `ProjectionQuery.thread(threadId)`가 돌려주는 값의 `marker`)다.
- 같은 절에 옮길 이름 [제안]. 아래 이름은 이 절의 파일에 두기로 하고, 필드는 오른쪽 소유 문서의 현재 블록을 옮긴다. 옮기는 작업은 `F.records.plan`이 맡고, 옮기기 전에는 소유 문서 블록이 필드의 후보 정본이다.

| 파일 | 이름 | 필드 후보 정본 |
|---|---|---|
| `lease.ts` | `LeaseResource`, `LEASE_RESOURCE_PATTERN`, `LeaseKind`, `LeaseHolder`, `LeaseToken`, `LeaseOwnerInfo`, `LockBusy`, `LeaseRowInvalid`, `LeaseError`, `LeaseService` | `L0.store.spec` §3.1(FR-S2) |
| `migrations.ts` | `MigrationStep`, `MigrationSet`, `MigrationError`, `MigrationReport`, `MigrationRunner`, `ExtensionTables`, `ExtensionTableError`, `StoreFailureKind`, `STORE_FAILURE_KINDS`, `storeFailureKindOf`(§3.7 7항). `ChunkMigration`은 §3.7에 둔다 | `L0.store.spec` §3.1(FR-S4) |
| `commit.ts` | `CommitKey`, `COMMIT_KEY_PATTERN`, `commitKeyPart`, `APPROVAL_REQUEST_KEY_MAX`, `requestKeyFor`, `isApprovalRequestKey`, `RESERVED_SOURCE_KEYS`, `ProducerId`, `StampedDraft`, `DraftInput`, `ProducerHandle`, `StepCheckpointInput`, `CommitPlan`, `CommitRequest`, `CommitResult`, `ReadOnlyReason`, `StoreError`, `ReadFailure`, `StoreBugCode`, `TxView` 메서드, `TurnView`, `EffectView`, `InputView`, `ApprovalView`, `AgentView`, `FaultPoint`, `FaultInjector` | `L1.persistence.spec` §3.2 |
| `projector.ts` | `ProjectionTx`, `Projector`, `ProjectorRegisterError`, `ProjectorFailure`, `ProjectorRegistry`. `ProjectionQuery`는 `session-service.ts`에 있다 | `L1.persistence.spec` §3.4 |
| `session-service.ts` | `SessionServiceName`, `CommitListener`, `CommitBatch`, `FeedFilter`, `EventFeed`, `ThreadSummaryRow`, `ItemRow`, `ProjectionQuery`, `RecoveryMarker`, `OpenReport`, `OpenError`, `MAX_REPLAY_ATTEMPTS`, `EffectRerun`, `AutoResumeVerdict`, `ResumePlan`, `ResumeError`, `RecoverDeps`, `ThreadCreated`, `ThreadCreateInput`, `ThreadListQuery`, `ThreadPage`, `BranchSummaryInput`, `SessionShutdownReason`, `LifecycleError`, `ThreadLifecycle`, `SessionSettingsLayer`, `SessionSettingsError`, `SessionSettingsStore`, `SessionRetention`, `SessionService`. 쓰기 소유 판정은 `lease.ts`의 `LeaseToken`(epoch 펜싱)과 `LeaseOwnerInfo`(표시용), 열기 결과의 `OpenLease`가 맡는다. 옛 이름 `OwnershipGuard`·`OwnerInfo`는 없다 [결정: review.decisions-2 U-09, open-issues D-04] | `L1.persistence.spec` §3.3~§3.8, §6.2 |
| `session-service.ts` | `RecordCommitPort`, `ExtCommitRequest`, `ExtCommitRejectCode`, `ExtCommitResult`, `StoredScopeState`, `OpenLease`, `ExtThreadSnapshot`, `ExtRecordQuery`, `ExtRecordRow` | 위 블록이 정본이다(옮김 끝남). `F.extensions.spec` §3.2.1 `ports.ts`가 다시 export한다 |

## 4. 동작 규칙

### 4.1 seq

1. 내구 이벤트만 `seq`를 받는다. DB 전체에서 단조 증가, 무간격이다.
2. 한 `appendBatch`의 이벤트는 연속된 seq를 받는다.
3. seq는 저장소가 커밋 안에서 매긴다. 호출자가 정하지 않는다.

### 4.2 원자성

1. 한 단계 경계 커밋에 `step.completed`, `checkpoint.step`, 그 단계의 남은 내구 이벤트를 함께 넣는다.
2. `effect.result`와 결과 toolResult `item.recorded`는 같은 커밋이다.
3. 어시스턴트 `item.recorded`와 그 메시지의 `part.recorded` 전부는 같은 커밋이다.
4. 커밋 단위와 트랜잭션 규칙의 일반형은 `eng.transactions.design`을 따른다.

### 4.3 내구/휘발

1. 휘발 이벤트는 저장소를 거치지 않는다. 발신자(L1-b)가 `n`, `afterSeq`, `recordedAt`을 채운다.
2. 휘발 이벤트의 결과는 반드시 내구 이벤트로 남는다. 예: `item.updated(part_delta)` → `part.recorded`·`item.recorded`, `item.updated(tool_progress)` → `effect.result`.

### 4.4 인과

1. `effect.exec`·`effect.result`의 `causationId`는 같은 효과의 `effect.intent` id다.
2. 복구 규칙이 만든 합성 `effect.result`의 `causationId`는 `effect.intent` id이고 `synthesized: true`다.
3. `correlationId`는 [제안] turn 범위 이벤트는 `turnId`, 효과 이벤트는 `effectId`를 쓴다.

### 4.5 재개

재개 절차의 구현은 `L1.persistence.spec`이 정한다. 기록 계약 쪽 규칙:

1. 마지막 `checkpoint.step`을 읽고 `leafEventId` 이후의 내구 이벤트를 재생한다.
2. `effect.intent`가 있고 `effect.result`가 없는 효과마다 `decideEffectRecovery`를 부른다.
3. 결과가 `synthesize`이면 합성 `effect.result`와 toolResult `item.recorded`를 한 커밋으로 쓴다.

### 4.6 분기와 컴팩션

1. [제안] 내구 이벤트의 `parentId`는 쓰기 시점 thread의 leaf다. 한 배치 안에서는 앞 이벤트가 뒤 이벤트의 부모다. pi 세션 트리(`coding-agent/src/core/session-manager.ts` SessionEntryBase `id`/`parentId`)와 같은 의미다.
2. leaf는 마지막에 쓴 내구 이벤트다. `thread.leaf_moved`가 있으면 그 `leafEventId`가 leaf다.
3. 분기: 이전 이벤트로 leaf를 옮긴다(`thread.leaf_moved{reason:"branch"}`). 이후 쓰기는 그 이벤트를 부모로 삼아 새 가지가 된다. 기존 가지는 지우지 않는다.
4. 비파괴 컴팩션: `thread.compacted`를 가지 끝에 덧붙인다. 원문 이벤트는 그대로 두고, 모델 컨텍스트 조립 때 `firstKeptEventId` 앞 내용을 `summary`로 대체한다. pi `CompactionEntry{summary, firstKeptEntryId, tokensBefore, details, fromHook}`와 같은 모양이다. 컨텍스트 조립 규칙은 `L1.context.spec`(L1-e)이 정한다.
5. 다른 가지로 옮길 때 떠난 가지 요약은 `thread.branch_summarized`로 남긴다(pi `BranchSummaryEntry`).
6. 다른 thread로 복사하는 fork는 새 thread의 `thread.started.forkedFrom`에 원본을 적는다.

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| `durable: false` envelope에 `seq` 또는 `parentId`가 있음 | 스키마 검증 실패 |
| `durable: true` envelope에 `n`이 있음 | 스키마 검증 실패 |
| 직렬화 크기 256 KiB 초과 | `checkEnvelopeSize` → `err({ kind: "event_too_large" })`. 저장소도 같은 오류로 거부 |
| `version`이 등록된 현재 버전보다 큼 | `upcastEvent` → `err({ kind: "future_version" })` |
| 업캐스터 배열이 비어 있는 버전 구간 | `upcastEvent` → `missing_upcaster` |
| 접두 없는 확장 kind | `parseEventKind` → `reserved_area` |
| 예약 도메인 영역(`ReservedDomainArea`) kind, 또는 등록된 영역의 미등록 이름 | `parseEventKind` → `reserved_area` |
| 같은 `requestId`, 다른 지문의 `appendBatch` | `key_reused` |
| 두 확장이 같은 kind 등록 | 레지스트리 → `duplicate` |
| 결과 없는 `unsafe` 효과 | `decideEffectRecovery` → `synthesize` |
| 도구가 사라진 뒤 재개(`currentReplay: null`) | `unsafe`와 같게 처리 |
| `expectedLeaf` 불일치 | `conflict`. 호출자가 다시 읽고 판단한다 |
| blob 파일 없음(읽기 시) | 소비자에 명시 오류. 처리 정책은 `L0.store.spec` |

## 6. 설정 노출

이 도메인은 사용자 설정 키를 두지 않는다. 저장 설정(WAL, synchronous, 보관 기간, 내보내기)은 `L0.store.spec`과 `L1.persistence.spec`이 노출한다.

## 7. 확장 지점

- 확장과 의도 그룹은 `EventKindRegistry`로 `x.<extId>.*`, `grp.<groupId>.*` kind를 등록한다. 등록 구현과 신뢰 등급 검사는 X(`X.primitives.spec`, `X.loading-trust.spec`)가 한다.
- X의 네 연산 중 scope, drive, post의 결과는 각각 `scope.changed`, `lease.acquired`/`lease.released`, `input.queued`(`source.type: "extension"`)로 기록된다(post는 [결정: review.decisions-2 U-05]). on(fold) 실행 자체는 기록하지 않는다 [제안]. fold가 바꾼 결과(`tool_result` 패치, boundary 엔트리)는 해당 이벤트에 남는다. `tool_call` 지점은 인자를 바꾸지 못하므로 `effect.intent.args`는 fold 결과가 아니다(§3.5 기록 순서 1).
- 그룹 간 레코드 형식은 `F.extensions.spec`이 정한다.

## 8. 다른 문서와의 인터페이스

| 문서 | 제공·요구 |
|---|---|
| `F.conversation.spec` | 요구: ID, `ItemRecord`, `PartRecord`, 수명주기 payload 스키마, `ToolResultRecord`, `ResultStatus`, `ReplayPolicy`·`toReplayPolicy` |
| `F.extensions.spec` | 제공: `EventKindRegistry`, 확장 kind 형식. 요구: `extId`·`groupId` 형식, 확장 테이블 접두 규칙 |
| `F.wire-settings.spec` | 제공: `EventEnvelope`. 요구: 와이어 변환(시각, redaction), `settings.changed`의 key·scope 값 집합(`SettingKey`, `SettingScope`) |
| `F.extensions.spec` | 요구: scope·lease·post payload 필드의 정본(§3.2 `ScopeId`·`DriveLease`·`PostOptions`, §4.4~§4.6). 변경되면 §3.3 `extension-ops.ts`를 같은 변경에서 고친다 |
| `X.primitives.spec` | 요구: scope·lease·post 기록 시점(디스패치, 임대 중재, 토글 적용)의 구현 |
| `L0.store.spec` (L0-e) | 제공: §3.9 `StoreDb`·`SqlTx`·`StoreService` 등과 §3.7 `ChunkMigration`(FR-S1·FR-S5 반영). 요구: 테이블, seq 발급, FULL 커밋, blob 저장, `ChunkMigration` 실행, FR-S2~S4 필드 블록, `SessionStore` SQLite 어댑터(2차) |
| `L1.persistence.spec` (L1-f) | 제공: §3.9 `CommitRequest`·`SessionService`·`Projector` 등(FR-P1), §3.8 `AppendBatch.requestId`·`durability` 삭제(FR-P2), `thread.resumed`(FR-P3). 요구: 재개 절차, `decideEffectRecovery` 사용, 투영 재생성, §3.9 표의 나머지 필드 블록 |
| `L1.tools.spec`, `L1.tasks.spec`, `L1.agents.spec`, `L0.secrets.spec`, `X.operations.spec` | 제공: §3.3.1 kind와 payload. 요구: 하위 모양의 필드 뜻 |
| `L2.readme`와 L2 도메인 spec | 제공: §3.3.2 도메인 소유 카탈로그 규칙. 요구: 도메인별 카탈로그 표와 payload |
| `L1.loop.spec` (L1-b) | 요구: 휘발 이벤트 발신(`n`, `afterSeq`), 효과 3단 기록 순서 |
| `L1.context.spec` (L1-e) | 요구: `thread.compacted` 해석 |
| `eng.events.design`, `eng.transactions.design` | 요구: 내구/휘발, 커밋 단위 일반 규칙. 현재 envelope 필드·`BlobRef`·확장 접두가 이 문서와 다르다. 정본 관계와 고칠 쪽은 §3.1.2 표를 따른다 |

## 9. 수용 기준

1. `durable: false` 이벤트에 `seq`가 있으면 `EventEnvelopeSchema` 검증이 실패한다. `durable: true` 이벤트에 `seq`가 없어도 실패한다.
2. 알 수 없는 `version`(현재보다 큼, 또는 업캐스터 누락)은 `upcastEvent`가 각각 `future_version`, `missing_upcaster` 오류를 낸다.
3. 업캐스터 체인 v1→v3이 순서대로 적용되고 원본 envelope 객체는 바뀌지 않는다.
4. `decideEffectRecovery`는 순수 함수이며 결정표 다섯 행을 그대로 낸다. intent만 있는 `unsafe` 효과는 `synthesize`/`not_started`, intent+exec만 있는 `unsafe` 효과는 `synthesize`/`outcome_unknown`으로 닫힌다.
5. `@xeon/contracts/records`가 export하는 `ReplayPolicy`, `ReplayPolicySchema`, `toReplayPolicy`는 `@xeon/contracts/conversation`의 것과 같은 심볼이다(동일 참조). 매핑 값은 `F.conversation.spec` §9 수용 기준 9가 확인한다.
6. 직렬화 크기가 262,145바이트인 envelope는 `checkEnvelopeSize`에서 `ok: false`(`event_too_large`)다. 262,144바이트는 `ok: true`다.
7. `parseEventKind`는 코어 kind 40개와 병합된 도메인 카탈로그 kind를 통과시키고, 접두 없는 비코어·비도메인 kind, `ReservedDomainArea` kind, 형식 위반을 거부한다.
8. `CORE_EVENT_CATALOG`의 kind·durable 목록이 §3.3 표(40종)와 같다. 도메인 카탈로그(`<DOMAIN>_EVENT_CATALOG`)는 해당 L2 문서의 카탈로그 표와 같고, 병합 카탈로그에 중복 kind가 없다(검사 스크립트).
9. 카탈로그의 모든 payload 스키마가 대표 픽스처의 JSON 왕복 뒤 검증을 통과한다.
10. `StepCheckpointSchema`는 `schemaVersion` 누락과 `stepIndex` 음수를 거부한다.
11. `ChunkMigration.runChunk`는 동기이고 실행기가 같은 `tx`에 커서를 저장한다. 청크 중간에 던지면 그 청크의 행과 커서가 함께 롤백된다.
12. 같은 `requestId`로 `appendBatch`를 두 번 부르면 이벤트는 한 번만 저장되고 두 결과의 `firstSeq`·`lastSeq`가 같다.
13. `RecordCommitPort` 적합성(가짜와 core-persistence 구현 공통): 확장 `alpha`가 `visibility: "private"`로 `x.alpha.note.added`를 커밋하면 `queryRecords(threadId, { kind: "x.alpha.*" }, "alpha")`는 그 행을 돌려주고 `queryRecords(threadId, { kind: "x.alpha.*" }, "beta")`는 돌려주지 않는다. `visibility`를 생략한 커밋의 행은 두 조회 모두 돌려준다. `visibility: "private"`로 다른 확장 접두 kind를 커밋하면 `rejected(invalid)`다.
14. `EXTENSION_KIND_PATTERN`은 `x.alpha.note_v2.added`를 통과시키고, 셋째 마디가 33자 이상이거나 숫자로 시작하면(`x.alpha.2note.added`) 거부한다.

## 10. 미결 사항

1. [미결] 해시 체인: 09 §3.2.2의 `prevHash`/`hash` 체인을 유지할지. [제안] M0에서는 두지 않고, 필요하면 열 추가 마이그레이션으로 더한다. 개인 런타임에서 변조 탐지 요구가 확인되지 않았다.
2. [미결] 휘발 이벤트 seq 부여 여부: 현재 [제안]은 seq 없음 + `n` + `afterSeq`다. 여러 클라이언트가 휘발 조각 순서를 seq 기준으로 맞춰야 하는 요구가 생기면 다시 본다.
3. [결정: M2 마감 G5-03] ULID 단조성은 L0 `IdFactory` 구현이 지킨다(`F.conversation.spec` §10 미결 3과 같은 항목).
4. [미결] 재생 정책 이름 통일: `ReplayPolicy = "safe" | "unsafe"`(pi durable) 채택과 F `AgentTool.replay`(pi-agent-core에서 온 `"never" | "safe"`)의 `"never"` → `"unsafe"` 매핑을 확정할지(정의 위치는 `F.conversation.spec` §3.6). Xeon 도구 선언에서 `"never"`를 계속 허용할지.
5. [미결] 등록 해제된 확장 kind를 투영 재생에서 건너뛸지, 시작을 거부할지.
6. [미결] 효과 결과 코드 집합: `ok`, `error`, `interrupted`, `abandoned` 네 값으로 충분한지(`_research/notes/F-3.md` §8.3 미결 3).
7. [미결] 모델 요청 재전송: 재개 시 `next: "request"` 체크포인트에서 요청을 다시 보내는 것을 기본으로 할지, 요청마다 멱등 키를 둘지(`_research/notes/F-3.md` §8.3 미결 2).
8. [결정: review.decisions-2 U-05] `post.accepted`는 retire한다(§3.3). 멱등은 커밋 키가 맡고 기록은 `input.queued`가 맡는다. 2026-10-22 사용자 확인에서 잠정안(유지 + `inputId`)을 바꿨다.
9. [미결] `SessionStore.readFrom`·`subscribe` 첫 인자의 이름과 경계: §3.9 `SessionService`는 배타 경계 `afterSeq`다. `SessionStore`도 `afterSeq`로 바꿀지(`L1.persistence.spec` FR-P2).
10. 닫음 [제안]: X 포트 `RecordCommitPort`는 records `session-service.ts`에 둔다. `SessionService.ext`가 이 타입을 쓰고 records는 extensions를 import할 수 없기 때문이다. `F.extensions.spec` §3.2.1 `ports.ts`가 다시 export한다.
