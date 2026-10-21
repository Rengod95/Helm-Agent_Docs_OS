---
id: F.records.plan
layer: F
domain: records
kind: plan
status: draft
depends_on: [F.records.spec, F.conversation.plan]
binds: [xeon/packages/contracts/src/records/**]
---

# F2 기록 계약 구현 계획

대상 스펙: `F.records.spec`. 패키지: `@xeon/contracts`, 서브패스 `./records`.

## 1. 목표와 마일스톤 배치

[결정] M0 범위에 `contracts`(F 전 도메인의 TypeBox 타입)와 `platform-store`(bun:sqlite, 이벤트·투영·체크포인트·세션 잠금)가 함께 들어간다(`_research/foundation-plan.md` §5 P4 M0 범위). platform-store가 이 문서의 envelope, 카탈로그, 체크포인트를 구현하므로 records는 platform-store 착수 전에 끝낸다.

| 마일스톤 | 범위 | 작업 |
|---|---|---|
| M0 | envelope(내구/휘발 판별), kind 이름 규칙과 `parseEventKind`, 코어 카탈로그 payload 스키마, 효과 3단과 재생 매핑·복구 결정 함수, `StepCheckpoint`, `BlobRef`·`DetachedField`·크기 검사, 업캐스터 타입과 `upcastEvent`, `ChunkMigration` 타입 | R1~R7 |
| M1 | `EventKindRegistry` 타입(테스트용 그룹이 `grp.*` kind와 post·drive 기록을 쓴다), X.primitives.spec 확정으로 F.extensions.spec이 바뀌면 그에 맞춘 scope·lease·post payload 갱신, 스펙 §3.3.1 요청 kind 15종 payload, §3.9 저장·투영 포트 타입 | R9, R3 후속, R10, R12 |
| M2 | 내장 L2 도메인 카탈로그 병합(스펙 §3.3.2) | R11 |
| M2 이후 | `SessionStore` 인터페이스와 적합성 스위트, 열거형 확장 예약(`F.extensions.spec`) | R8 |

소비자:

| 소비자 | 쓰는 이름 | 시점 |
|---|---|---|
| L0 `platform-store` (`L0.store.spec`) | `DurableEventEnvelopeSchema`, `checkEnvelopeSize`, `CORE_EVENT_CATALOG`, `StepCheckpointSchema`, `BlobRef`, `ChunkMigration`, `upcastEvent` | M0 |
| L1 `core-persistence` (`L1.persistence.spec`) | `decideEffectRecovery`, `upcastEvent`, `ProjectionVersion`, 재개 규칙, `CommitRequest`·`SessionService`·`Projector` | M1 |
| L1 `core-tools`·`core-tasks`·`core-agents` | `approval.*`, `input.*`, `agent.*`, `turn.abort_requested`, `secret.*` payload | M1(R10 완료 뒤) |
| L1 `core-loop` (`L1.loop.spec`) | `EffectIntent`/`EffectExec`/`EffectResult`, `toReplayPolicy`, `VolatileEventEnvelope` | M1 |
| X `ext-host` (`X.primitives.spec`) | `EventKindRegistry`, scope·lease·post payload | M1 |

## 2. 패키지와 파일 배치

```
xeon/packages/contracts/
  package.json                       # exports "./records" 추가
  src/records/
    envelope.ts                      # Durable/VolatileEventEnvelope, 스키마, DurableEventDraft, ENVELOPE_MAX_BYTES, checkEnvelopeSize
    kinds.ts                         # CoreArea, CoreEventKind, DomainArea, EventKind, 패턴, parseEventKind, EventKindRegistry 타입
    owners.ts                        # TYPE_PREFIX_OWNERS(정본 표는 eng.context-map.design §5.1)
    sql.ts, store-db.ts, commit.ts, projector.ts, session-service.ts   # 스펙 §3.9 포트 타입
    lease.ts, migrations.ts                                            # 스펙 §3.9 표(L0.store FR-S2·S4)
    catalog/
      thread.ts                      # LeafMoved, Compacted, BranchSummarized payload
      content.ts                     # ItemRecorded, PartRecorded payload
      extension-ops.ts               # ScopeChanged, LeaseAcquired, LeaseReleased, PostAccepted payload
      settings.ts                    # SettingsChanged payload
      turn.ts, approval.ts, input.ts, agent.ts, secret.ts   # 스펙 §3.3.1 payload
      work.ts, dialog.ts, artifact.ts, schedule.ts          # 스펙 §3.3.2 도메인 카탈로그(M2)
      index.ts                       # CatalogEntry, CORE_EVENT_CATALOG, EVENT_CATALOG(병합), catalogEntry
    effects.ts                       # ReplayPolicy·toReplayPolicy 재수출(정의는 conversation), EffectIntent/Exec/Result, decideEffectRecovery, 합성 문구
    checkpoint.ts                    # StepCheckpoint, PendingToolCall, 스키마, 스키마 버전 상수
    blob.ts                          # BlobRef, DetachedField, BLOB_PLACEHOLDER_PREFIX
    versioning.ts                    # Upcaster, KindVersioning, UpcasterRegistry, upcastEvent, ProjectionVersion, ChunkMigration
    store.ts                         # SessionStore, AppendBatch, AppendResult (M2)
    index.ts                         # 위 전부 + conversation의 EventId·EffectId·CheckpointId 재수출
  test/records/
    envelope.test.ts
    kinds.test.ts
    catalog.test.ts
    effects.test.ts
    checkpoint.test.ts
    blob.test.ts
    versioning.test.ts
xeon/scripts/check-event-catalog.ts  # 스펙 §3.3 표와 CORE_EVENT_CATALOG 대조
```

- 대화 계층 payload 스키마(thread·turn·step·item 알림 11종)는 `src/conversation/lifecycle.ts`에 있다. 토큰 델타는 `item.updated` payload 안의 `PartDelta`(`parts.ts`)이고 별도 kind가 없다. `catalog/index.ts`는 그것을 가져와 카탈로그 항목에 연결만 한다. 같은 패키지 안 import라 층 규칙과 무관하다.
- `isolatedDeclarations` 규칙과 스키마 선언 형식은 `F.conversation.plan` §2와 같다. `CORE_EVENT_CATALOG`는 `readonly CatalogEntry[]`로, 패턴 상수는 `string`으로 주석한다. 실패를 돌려주는 함수(`parseEventKind`, `checkEnvelopeSize`, `upcastEvent`)는 루트의 `Result`를 쓴다.
- `package.json` exports에 `"./records": "./src/records/index.ts"`를 더한다. 새 외부 의존성은 없다.

## 3. 작업 분해

| id | 내용 | 선행 | 규모 |
|---|---|---|---|
| R1 | envelope 스키마: `EnvelopeBase`, `DurableEventEnvelope`, `VolatileEventEnvelope`, 세 스키마(`additionalProperties: false`), `DurableEventDraft`, `ENVELOPE_MAX_BYTES`, `checkEnvelopeSize`(UTF-8 바이트 측정) | C1, R2, R6 | M |
| R2 | kind 이름 규칙: `CoreArea`, `CoreEventKind`(40개), `DomainArea`, `ReservedDomainArea`, `ExtensionEventKind`, `EventKind`, 두 패턴 상수, `EventKindSchema`, `parseEventKind`(병합 카탈로그 기준), `KindError` | — | S |
| R3 | 카탈로그 payload 스키마: `catalog/*.ts`의 새 payload 10종과 스키마, `CatalogEntry`, `CORE_EVENT_CATALOG`(conversation payload 스키마 연결 포함), `catalogEntry`, `xeon/scripts/check-event-catalog.ts` | R2, R4, R5, C4, C5 | L |
| R4 | 효과 3단과 재생 매핑: `ReplayPolicy`·`ReplayPolicySchema`·`toReplayPolicy` 재수출(정의는 C7), `EffectIntent`·`EffectExec`·`EffectOutput`·`EffectResult`와 스키마, `EffectStatus`, `EffectRecovery`, `decideEffectRecovery`, `OUTCOME_UNKNOWN_TEXT`, `NOT_STARTED_TEXT` | C1, C7, R6 | M |
| R5 | 체크포인트: `PendingToolCall`, `StepCheckpoint`, `StepCheckpointSchema`, `STEP_CHECKPOINT_SCHEMA_VERSION` | C1, C2 | S |
| R6 | BlobRef: `BlobRef`, `DetachedField`, 스키마, `BLOB_PLACEHOLDER_PREFIX` | — | S |
| R7 | 업캐스터 타입: `Upcaster`, `KindVersioning`, `UpcasterRegistry`, `UpcastError`, `UpcastResult`, `upcastEvent`, `ProjectionVersion`, `ChunkMigration`(동기 `runChunk(tx, cursor, budget)`, `SqlTx`는 R12의 `sql.ts`) | R1, R12 | M |
| R8 | SessionStore(2차): `AppendBatch`(`requestId` 필수, `durability` 없음), `AppendError`(`key_reused` 포함), `AppendResult`, `SessionStore`. 적합성 스위트 시나리오 목록 문서화 | R1, R5, R12 | M |
| R9 | kind 레지스트리 타입: `EventKindRegistration`, `EventKindRegistry`. 구현은 X(`X.primitives.spec`) | R2, R3, R7 | S |
| R10 | 스펙 §3.3.1 요청 kind 15종: payload 타입·스키마, 카탈로그 행, 거부 픽스처. 끝나기 전에는 소비 plan(L1.tools, L1.tasks, L1.agents)이 이 kind를 쓰는 테스트를 M1 완료 조건에 넣지 않는다 | R2, R3 | M |
| R11 | 스펙 §3.3.2 도메인 소유 카탈로그: `EVENT_CATALOG` 병합, 중복 검사, `owners.ts` L2 행, 검사 스크립트가 도메인 문서 표도 대조. 도메인 payload는 각 L2 plan이 채운다 | R2, R3 | M |
| R12 | 스펙 §3.9 포트 타입: `sql.ts`, `store-db.ts`, `commit.ts`, `projector.ts`, `session-service.ts`. §3.9 표의 이름은 소유 문서 블록(`L0.store.spec` §3.1, `L1.persistence.spec` §3.2~§3.8, `X.primitives.spec` §3.6)을 옮겨 필드를 확정하고 스펙 §3.9를 같이 고친다. X 기록 포트(`RecordCommitPort`와 부속 타입, `visibility`, 비공개 조회 규칙)는 스펙 §3.9 블록이 이미 정본이다 | R1, R5 | L |

선행의 C1~C7은 `F.conversation.plan`의 작업 id다. 규모 기준은 같은 문서 §3을 따른다.

## 4. 채택 코드

| 대상 | 방식 | 버전·경로 | 바꿀 점 |
|---|---|---|---|
| opencode 이벤트 저장 | 표 모양만 차용, import·복사 없음 | `core/src/event/sql.ts`(event, event_sequence 표), `schema/src/event.ts` | Effect·drizzle 결합이라 가져올 수 없다(`_research/packages.md` §2.4, §4.1 F2). seq 테이블과 id·version 열 구성만 참고 |
| pi durable | 아이디어만 차용, 코드 포크 없음 | `~/projects/_ref/pi-src/packages/durable/src/{types.ts,entries.ts,tasks.ts}`, `harness/generation.ts:53-90`, `harness/tool.ts:156-196,588-630`, `testing/storage-conformance.ts` | documents/entries 분리, 의도→결과 커밋 순서, `replay` 재실행 조건, 적합성 스위트 방식. [결정] pi durable은 그대로 쓰지 않는다(`_research/foundation-plan.md` §1 #1) |
| pi coding-agent 세션 트리 | 의미만 차용 | `coding-agent/src/core/session-manager.ts:60-125` | `parentId`/leaf, `CompactionEntry`, `BranchSummaryEntry` 모양 |
| 기존 설계 09 | 인용만 | `docs/design/09-event-store.md` §3.2(98-222행), §3.3, §3.5, §3.13 | 필드 대조표(스펙 §3.1.1)로 가져올 것과 버릴 것을 정했다 |
| `typebox` | 그대로 | catalog 1.4.2 | `F.conversation.plan` §4와 같다 |

## 5. 단위 테스트 목록

모두 `bun test`. 저장소가 없는 순수 테스트다. SQLite를 쓰는 통합 테스트(원자 커밋, seq 무간격, FULL 커밋, blob 쓰기 순서)는 `L0.store.plan`으로 위임한다.

| 테스트 | 확인할 동작 |
|---|---|
| `envelope.test.ts` › 필수 필드 | 내구·휘발 정상 픽스처가 통과하고, 필수 필드 하나씩 뺀 변형이 모두 실패한다 |
| `envelope.test.ts` › durable/seq 상호 제약 | `durable:false`+`seq` 실패, `durable:false`+`parentId` 실패, `durable:true`+`n` 실패, `durable:true`에 `seq` 없음 실패 |
| `envelope.test.ts` › 값 범위 | `version: 0`, `seq: 0`, `n: -1`, 정수 아닌 `recordedAt` 실패 |
| `envelope.test.ts` › 256KiB | 직렬화 262,144바이트는 `ok:true`, 262,145바이트는 `ok:false`. 다바이트 문자(한글)로 길이를 맞춘 경우도 UTF-8 바이트로 잰다 |
| `kinds.test.ts` › 코어 | `CoreEventKind` 40개 모두 `origin:"core"`로 파싱된다. `part.delta`는 `reserved_area`다(카탈로그에 없음) |
| `kinds.test.ts` › 도메인 | 병합 카탈로그에 있는 `work.*` kind는 `origin:"domain"`이다. `web.searched`(예약 영역), `work.unknown_name`(미등록) → `reserved_area` |
| `kinds.test.ts` › 접두 규칙 | `x.foo.bar.baz`, `x.web-exa.search.done`, `grp.helm.item.tagged`, `grp.learning.skill.proposed` 통과. 확장 이름 마디가 33자이거나 밑줄을 가진 kind(`x.acme_notes.a.b`) → `malformed`(U-18). `foo.bar`(비코어 영역) → `reserved_area`. `thread.unknown_name` → `reserved_area`. `X.foo.a.b`, `x..a.b`, `x.foo.a`, `x.1foo.a.b`(이름이 숫자로 시작), `grp.learning.skill_proposed`(3마디) → `malformed`. 셋째 마디 규칙 `[a-z][a-z0-9_]{0,31}`: `x.foo.note_v2.added` 통과, `x.foo.2note.added`와 셋째 마디 33자 → `malformed` |
| `kinds.test.ts` › 레지스트리 계약 | 테스트 안의 가짜 `EventKindRegistry` 구현으로 계약을 확인한다(실제 구현은 X 몫). 같은 kind 두 번 등록 → `duplicate`, 형식 위반 kind 등록 → `malformed`, 등록 뒤 `lookup`이 `CatalogEntry`를 돌려주고 미등록 kind는 `undefined`. `EventKindRegistration`에 코어 kind를 넣으면 타입 오류(`// @ts-expect-error`) |
| `catalog.test.ts` › 왕복 | `CORE_EVENT_CATALOG` 항목마다 대표 payload 픽스처를 JSON 왕복한 뒤 `payload` 스키마를 통과한다. 픽스처가 없는 항목이 있으면 실패한다 |
| `catalog.test.ts` › 유일성 | kind 중복 없음(병합 카탈로그 포함), `version ≥ 1` |
| `catalog.test.ts` › 요청 kind payload | 스펙 §3.3.1 payload 15종마다 정상·거부 픽스처. `secret.*` payload에 값 필드가 없고, `approval.requested`의 `body.kind`는 `tool`, `question`, `plan`만 통과한다 |
| `ports.test.ts` › 비공개 기록 | 테스트 안의 가짜 `RecordCommitPort`로 스펙 §3.9 비공개 기록 규칙을 확인한다. `visibility: "private"` 행은 `queryRecords`의 셋째 인자 `reader`가 소유 확장일 때만 돌아오고, 다른 확장 접두 kind의 private 커밋은 `rejected(invalid)`다. 같은 적합성 사례를 `L1.persistence.plan`이 실제 구현에 돌린다 |
| `versioning.test.ts` › 청크 | 가짜 `SqlTx`로 `runChunk`가 동기로 `{ next, processed }`를 돌려주는 계약을 확인한다(실행기 테스트는 `L0.store.plan`) |
| `catalog.test.ts` › 신규 payload 거부 | 스펙 §3.3이 새로 정의한 payload 10종(LeafMoved, Compacted, BranchSummarized, ItemRecorded, PartRecorded, ScopeChanged, LeaseAcquired, LeaseReleased, PostAccepted, SettingsChanged)마다 거부 픽스처를 둔다. 필수 필드 누락, 열거값 밖(`reason: "expired"`, `status: "entered"`, `when: "later"`), 잘못된 ID 접두가 모두 실패한다 `PostAccepted`에 `inputId`가 없으면 실패한다(스펙 §3.3, review.decisions-2 U-05) |
| `catalog.test.ts` › blob 자리표시 | `ItemRecorded`의 이미지 `data`를 `blob:sha256:<hex 64자>`로 바꾼 payload가 같은 스키마를 통과한다. `BLOB_PLACEHOLDER_PREFIX`가 `"blob:sha256:"`다. `detached`에 없는 위치의 자리표시 모양 문자열은 일반 문자열로 남는다(되돌림 대상 목록이 `detached`의 pointer와 같음) |
| `effects.test.ts` › replay 재수출 | records의 `ReplayPolicySchema`, `toReplayPolicy`가 conversation의 것과 같은 참조다. 매핑 값은 `F.conversation.plan` `tool-result.test.ts`가 확인한다 |
| `effects.test.ts` › 복구 결정 | 스펙 §3.5 결정표 다섯 행을 표 주도 테스트로 확인. intent만 있는 unsafe → `synthesize`/`not_started`/`abandoned`, exec까지 있는 unsafe → `synthesize`/`outcome_unknown`/`interrupted`, 저장 safe+현재 unsafe → `synthesize`, `currentReplay:null` → `synthesize` |
| `effects.test.ts` › 순수성 | 같은 입력 두 번 호출 결과가 깊은 비교로 같고 입력 객체가 바뀌지 않는다(`Object.freeze` 입력) |
| `effects.test.ts` › 합성 결과 | 합성 `EffectResult`가 `synthesized:true`, `output:null`이고 `EffectResultSchema`를 통과한다 |
| `checkpoint.test.ts` | 정상 픽스처 통과. `schemaVersion` 누락, `stepIndex: -1`, 잘못된 `next` 값, 잘못된 접두 `leafEventId` 실패 |
| `blob.test.ts` | `sha256` 63자·대문자 실패, `size` 음수 실패. `DetachedField.pointer`는 `""` 또는 `/`로 시작해야 한다 |
| `versioning.test.ts` › 업캐스트 체인 | v1 payload를 등록된 두 업캐스터로 v3까지 올린다. 결과 `version`은 3이고 원본 envelope는 그대로다 |
| `versioning.test.ts` › 누락 시 오류 | 업캐스터 배열이 짧으면 `missing_upcaster`, `version > current`이면 `future_version`, 미등록 kind면 `unknown_kind` |
| `versioning.test.ts` › 현재 버전 | `version === current`이면 같은 내용 사본을 돌려준다 |

## 6. 완료 기준

1. 스펙 §9 수용 기준 14개가 모두 §5 테스트에 대응한다(11·12번은 `versioning.test.ts` › 청크와 `L0.store.plan`의 `SessionStore` 어댑터 테스트).

   | 수용 기준 | 테스트 |
   |---|---|
   | 1 durable/seq | `envelope.test.ts` › 상호 제약 |
   | 2 알 수 없는 version | `versioning.test.ts` › 누락 시 오류 |
   | 3 업캐스터 체인 | `versioning.test.ts` › 업캐스트 체인 |
   | 4 효과 복구 | `effects.test.ts` › 복구 결정, 순수성 |
   | 5 replay 재수출 | `effects.test.ts` › replay 재수출 |
   | 6 256KiB | `envelope.test.ts` › 256KiB |
   | 7 kind 파싱 | `kinds.test.ts` |
   | 8 카탈로그 일치 | `xeon/scripts/check-event-catalog.ts` |
   | 9 payload 왕복 | `catalog.test.ts` › 왕복 |
   | 10 체크포인트 | `checkpoint.test.ts` |
   | 13 비공개 기록 | `ports.test.ts` › 비공개 기록 |
   | 14 확장 kind 셋째 마디 | `kinds.test.ts` › 접두 규칙 |

2. `tsc -b`, oxlint(type-aware), oxfmt, check-layers가 통과한다. records 소스는 `../conversation/*` 외의 내부 모듈과 `typebox`만 import한다.
3. 카탈로그 검사 스크립트 1개(`xeon/scripts/check-event-catalog.ts`)가 있다. 스크립트는 `docs/xeon/F/records/spec.md`의 `<!-- catalog:start -->`~`<!-- catalog:end -->` 사이 표에서 kind·durable 열을 읽어 `CORE_EVENT_CATALOG`와 비교하고, 다르면 종료코드 1로 끝난다. `just verify`에 이 단계를 더하는 일은 툴체인 담당(`eng.toolchain.guide`)과 맞춘다.
4. `@xeon/contracts/records`에서 스펙 §3의 이름이 모두 export된다. `SessionStore` 계열은 M2 전에는 export만 하고 구현 요구를 걸지 않는다.

## 7. 위험과 대응

| 위험 | 대응 |
|---|---|
| envelope 필드가 늘어난다(Helm 설계 09를 옮기면서 비대해짐) | 스펙 §3.1.1 대조표에서 버린 필드를 다시 넣으려면 스펙 개정을 거친다. `additionalProperties:false`라 필드 추가는 envelope 스키마 변경과 DB 마이그레이션을 함께 요구한다 |
| kind 이름 규칙이 X 문서(`X.primitives.spec`, `F.extensions.spec`)와 어긋난다 | `extId`·`groupId` 패턴은 `F.extensions.spec`의 `ExtensionName`과 같게 정했고 R2에서 상수 하나로 모았다. F.extensions의 `RECORD_KIND_PATTERN`은 같은 값을 쓴다. 이름 규칙이 바뀌면 그 상수만 바꾼다. P2 정합성 검토 ①(F 계약과 소비 층 이름 일치) 항목으로 올린다 |
| 해시 체인 결정이 늦어진다 | M0은 해시 없이 시작한다. 나중에 넣으면 `prevHash`·`hash` 열을 L0 마이그레이션으로 더하고 기존 행은 체인 시작점을 새로 잡는다. envelope 타입은 바뀌지 않는다(저장 행 필드) |
| scope·lease·post payload가 X 설계와 다르다 | 필드는 `F.extensions.spec`(§3.2, §4.4~§4.6)에 맞췄다. `X.primitives.spec` 확정으로 F.extensions가 바뀌면 M1에서 `version` 1 상태로 같이 고친다. 아직 저장된 기록이 없으므로 업캐스터는 필요 없다 |
| 효과 재생 정책 이름 미결 | `toReplayPolicy` 한 함수에 매핑을 모았다. 사용자가 다른 이름을 고르면 이 함수와 `ReplayPolicy` 리터럴만 바꾼다 |
| 문서 표와 코드 카탈로그가 어긋난다 | 검사 스크립트가 `just verify`에서 실패한다 |
