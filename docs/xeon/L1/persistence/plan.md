---
id: L1.persistence.plan
layer: L1
domain: persistence
kind: plan
status: draft
depends_on: [L1.persistence.spec, eng.testing.guide, eng.toolchain.guide, eng.transactions.design, eng.dependency-rules.guide]
binds: [xeon/packages/core-persistence/**]
---

# L1 영속성과 복구 구현 계획

대상 스펙: `L1.persistence.spec`. 패키지: `@xeon/core-persistence`(`xeon/packages/core-persistence`, 현재 스캐폴드). 서비스: `xeon.session`. 하위 의존: `@xeon/platform-store`(L0, 서비스 `xeon.store`)와 `@xeon/contracts`(F).

[제안] 아래 표는 `platform-store`(L0)와 `core-persistence`(L1)의 책임 경계다. 두 plan의 작업은 이 표를 기준으로 나뉜다.

| 일 | `platform-store` (L0, `L0.store.spec`) | `core-persistence` (L1, 이 계획) |
|---|---|---|
| DB 파일 위치, 열기, FTS5 프로브 | 소유 | 쓰지 않음 |
| PRAGMA(WAL, `synchronous=FULL`, `busy_timeout`), 연결 수, 읽기 전용 연결 | 소유 | 조회값만 테스트 |
| `StoreDb.write`(`BEGIN IMMEDIATE`, 중첩 금지), `StoreDb.read` | 소유 | 호출만 |
| DDL 실행 순서, `sys_migrations`, `user_version`, `ChunkMigration` 실행기 | 소유 | DDL 문자열과 마이그레이션 목록을 넘긴다 |
| blob 파일(임시 파일, fsync, rename), `putBlob`, `readBlob`, GC 실행, `sys_blobs` | 소유 | 분리·되돌리기(`detachLarge`, `hydrate`), 참조 목록(`p_blob_refs`) |
| `StoreId`, `sys_meta` | 소유 | 쓰지 않음 |
| 임대 API(`acquire`, `renew`, `release`, `holds`, `keepAlive`, `inspect`, `sys_leases`) | 소유 | 커밋 소유 확인에 `holds(tx, token)`, 자식 thread 임대에 `acquire`·`keepAlive`, 소유 표시에 `inspect`(spec §3.6, §4.10.1) |
| 세션 OS 잠금 | 없음(`L0.process.spec`) | 없음. 호스트가 임대와 함께 얻어 `LeaseToken`으로 넘긴다 |
| 테이블의 의미(`events`, `requests`, `step_checkpoints`, `projector_state`, `consumer_cursors`, `thread_creation_keys`, `p_*`) | 없음 | 소유 |
| 커밋 규칙(소유 확인, 멱등, 지문, seq 발급, envelope 완성, 투영, 체크포인트, 방출) | 없음 | 소유 |
| 투영기 등록, 재생성, 불일치 검출 | `ProjectionTx` 소유 검사의 SQL 추출 함수(공용 [제안]) | 소유 |
| 재개(열 때 복구, 결과 불명 판정, 합성 커밋, 재개 계획) | 없음 | 소유 |
| 수명주기·분기·제목·세션 범위 설정 | 없음 | 소유 |

## 1. 목표와 마일스톤 배치

[결정] M0 범위는 `platform-store`(bun:sqlite, 이벤트·투영·체크포인트·세션 잠금)이고, M1은 `xeon chat` 걸어 다니는 골격(이벤트 저장과 재개 포함)이다(`_research/foundation-plan.md` §5 P4). 마일스톤 정의는 `product.scope.spec` §4.3을 따른다(M2·M3 정의는 그 문서의 [제안]). `_research/layer-plan-v2.json` L1-f의 "2차"는 M3 이후에 둔다 [제안]. 예외로 리플레이 커서는 M3로 당긴다(아래 표 아래 항목).

| 마일스톤 | core-persistence 범위 | 스펙 절 | 소비자 |
|---|---|---|---|
| M0 | 스캐폴드만(`package.json`의 `xeon.layer: "L1"`, `xeon.domain: "persistence"`, 빈 `plugin.ts`). 계약 대응 표 확정과 F 변경 요청(PS-0) | §3.1 | contracts, platform-store |
| M1 | writer(단일 커밋 경로), requests 멱등, 코어 투영(`p_threads`, `p_items`, `p_parts`, `p_effects`, `p_turns`, `p_inputs`, `step_checkpoints`, `p_blob_refs`), 단계 체크포인트, 효과 3단 기록 경로, 커밋 뒤 방출, 열 때 복구(표식, 마지막 체크포인트, 열린 효과 판정·합성), 재개 계획, `threads.create`, `openForWrite/openForRead`, 업캐스터 연결, 장애 주입 테스트 전체, 설정 `l1.persistence.maxResumeAttempts` | §3.2~§3.7, §4.1~§4.8, §4.11, §4.12, §4.14 | core-loop, core-tasks, core-tools, ext-host, apps/host, M1 스모크 |
| M2 | 수명주기 API 전체(`list`, `close`, `remove`, `fork`, `revert`, `moveLeaf`, `setTitle`, `prepareSwitch`), 분기와 떠난 가지 요약 기록, 승인 대기 복원(`p_approvals`, A1 체크포인트), 자식 thread 연결(`p_agents`, `TxView.agentByRequestId`, `ResumePlan.openChildren`), 확장 접두 테이블 커밋 참여(등록 검사, `ProjectionTx` 소유 검사, `onFailure`), `p_scopes`, `p_settings`, `sessionSettings`, 확장 지점 7개 발화, 보관 정리와 `retention.*` 키, `ext` 포트 | §3.8, §4.5.2, §4.10, §6, §7 | L4 host(thread.* 메서드), X.operations, L2 artifacts, L3 그룹, core-agents |
| M3 | 서비스 모드 자동 재개(`l1.persistence.autoResume`, `AutoResumeVerdict`), 리플레이 커서(`replayFrom`, `oldestReplayableSeq` 갱신), 청크 재생성 | §4.8.3, §4.13.1, §4.5.3 | L4 host 서비스 모드 |
| 2차 | 되감기(파일 스냅샷 복원), JSONL 내보내기(`pi-jsonl`, `xeon-jsonl`), `SessionStore` 어댑터와 적합성 스위트, `xeon debug verify-projections` | §3.11, §4.13.2, §4.13.3, §3.1 3번 | L4 cli, L2 workspace |

- [제안] 리플레이 커서(§4.13.1)는 계획 JSON에서 2차 구성요소 "되감기, 리플레이 커서, JSONL 내보내기"의 일부다. M3의 공유 서비스 모드와 원격 클라이언트 재접속(`product.scope.spec` §4.3 M3)에 필요해 이 부분만 M3로 당긴다. 되감기와 JSONL 내보내기는 2차에 남는다. `L1.readme` §9 표와 각주에 같은 배치를 적는다.

M0 종료 조건과 L0 몫:

| M0 종료 조건(`_research/foundation-plan.md` §6) | 확인하는 패키지 | core-persistence 몫 |
|---|---|---|
| SIGKILL 뒤 마지막 커밋이 보존된다 | `platform-store`의 `StoreDb.write` + FULL 연결 fault 테스트(원시 테이블) | 없음. M1에서 같은 조건을 `SessionService.commit`으로 다시 확인한다(`commit_atomic_under_fault_at_every_point`, K1~K6) |
| 두 번째 프로세스는 세션 잠금을 얻지 못한다 | `platform-process`의 세션 잠금 테스트(`L0.process.plan`) | 없음. M1의 `lock_conflict_offers_delegate_observe_fork`는 호스트와 함께 L1 쪽 동작(관찰 열기, fork)을 확인한다 |

- [제안] `eng.transactions.design` §8 표는 `SessionWriter.commit`과 장애 주입 테스트를 M0(core-persistence)에 두었다. 이 계획은 `_research/foundation-plan.md` §5 P4의 M0 범위(platform-store만)를 따라 M1에 둔다. eng 표 수정을 요청한다.

## 2. 패키지와 파일 배치

[제안] 파일 하나가 스펙 절 하나에 대응한다.

```
xeon/packages/core-persistence/
  package.json             # "xeon": { "layer": "L1", "domain": "persistence" }, exports: ".", "./testing"
  tsconfig.json
  src/
    index.ts               # 공개 진입점: createSessionService, sessionPlugin(re-export)
    plugin.ts              # Cordis 플러그인: inject [xeon.store, xeon.ext?], provide xeon.session. 조립 루트 전용 옵션
    writer.ts              # SessionWriter: 단일 커밋 경로(§4.1). FaultInjector 주입. 테이블 쓰기는 이 파일과 projector/, lifecycle.ts의 remove만
    commit-plan.ts         # CommitPlan 검증, checkpoint.step 초안 만들기, parentId·recordedAt 계산, envelope 완성
    producers.ts           # ProducerHandle, kind 소유 표(TYPE_PREFIX_OWNERS F판), 합성 결과 예외
    requests.ts            # requests 조회·저장, 지문(sha256Hex(canonicalJson))
    tx-view.ts             # TxView 구현(투영 테이블 읽기)
    schema/
      ddl.ts               # §3.10 DDL 전체, 트리거, 인덱스
      migrations.ts        # L0 마이그레이션 실행기에 넘기는 목록
    projector/
      core.ts              # 코어 투영기 core. kind별 리듀서 표
      registry.ts          # ProjectorRegistry: 등록 검사, 해제, onFailure
      tx.ts                # ProjectionTx: 소유 테이블 검사(디버그 빌드), 금지 문장
      rebuild.ts           # 재생성(한 트랜잭션), 청크 재생성(M3), projector_state
    subscribe.ts           # EventFeed, subscribe, 커밋 뒤 동기 방출, 휘발 전달
    read.ts                # readFrom, readBranch, loadCheckpoint, hydrate, ProjectionQuery
    checkpoint.ts          # StepCheckpointInput → checkpoint.step, 승인 대기 예외, schemaVersion 검사
    blob.ts                # detachLarge, hydrate의 되돌리기, p_blob_refs 갱신 보조
    upcast.ts              # UpcasterRegistry 조립(CORE_EVENT_CATALOG + EventKindRegistry), 열 때 버전 검사
    recovery.ts            # decideOpenEffect(decideEffectRecovery 호출 + 상한), 합성 결과 초안
    resume.ts              # openForWrite, openForRead, recover, beginResume, AutoResumeVerdict, 열린 thread별 LeaseToken 보관
    lifecycle.ts           # ThreadLifecycle: create(creationKey, inheritOwnerFrom), list, close, remove, fork, revert, moveLeaf, setTitle, prepareSwitch
    branch.ts              # 활성 가지 계산, leaf 이동 대상 검사, fork 출처 해석
    session-settings.ts    # SessionSettingsStore(settings.changed, p_settings)
    ext-port.ts            # RecordCommitPort 구현(SessionService.ext)
    points.ts              # 확장 지점 7개 발화(ExtHost.dispatch)
    retention.ts           # 보관 정리(M2)
    settings.ts            # defineSettings("l1.persistence", …)
    replay-cursor.ts       # 2차(M3): replayFrom 해석, oldestReplayableSeq
    rewind.ts              # 2차: 파일 스냅샷 기록·복원 계획
    export-jsonl.ts        # 2차: pi-jsonl, xeon-jsonl
    testing/
      index.ts             # openTestSession, expectProjectionsRebuildable, faultAt, fakeGuard, fakeExtHost
  test/
    commit.fault.test.ts   # FaultPoint 전체
    points.test.ts         # 확장 지점 7개 발화 시점
    retention.test.ts      # 보관 정리
    restart.fault.test.ts  # K1~K6, 자식 프로세스 SIGKILL
    commit.test.ts
    requests.test.ts
    projector.test.ts
    ext-projector.test.ts
    recovery.test.ts
    resume.int.test.ts
    lifecycle.test.ts
    branch.test.ts
    subscribe.test.ts
    upcast.test.ts
    ddl.test.ts
    session-store.contract.test.ts   # 2차: 적합성 스위트
```

- `core-persistence`는 `@xeon/platform-store`를 import하지 않는다. `xeon.store`를 F 타입(`StoreDb`, `StoreService`)으로 주입받는다(DR-14, CM-05). 테스트만 `@xeon/platform-store/testing`의 `openTestStore`를 쓴다(`eng.testing.guide` §1 표).
- 다른 L1 패키지(`core-loop`, `core-tools`, `core-tasks`)를 import하지 않는다(DR-02). 재개 실행은 core-loop가 `ResumePlan`을 받아 한다(스펙 §4.8.2).
- `Date.now`, `Math.random`, `crypto.randomUUID` 금지(TX-06). `Clock`, `IdFactory`는 주입받는다. `projector/` 아래는 `node:fs`, `bun` import 금지(EV-06).
- 테이블 이름 문자열(`events`, `requests`, `step_checkpoints`, `p_`)이 이 패키지 밖에서 나오면 `check-layers.ts`가 거부한다(TX-07 [제안]).

## 3. 작업 분해

규모: S(하루 안), M(2~3일), L(4일 이상). 선행의 `F.records.plan`, `L0.store.plan`, `L0.process.plan`, `X.operations.plan`은 다른 계획의 작업이다.

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| PS-0 | 커밋 API 대응 표(스펙 §3.1) 확정. F 변경 요청 FR-P1~P5, FR-P9를 F 트랙에 올리고, 받아들여진 이름으로 이 계획의 타입 경로를 맞춘다. eng 문서 수정 요청(스펙 §8.4) 전달 | 없음 | S | M0 |
| PS-1 | DDL과 마이그레이션 연결: `schema/ddl.ts`(§3.10 전부, 트리거, 인덱스), `migrations.ts`, `ddl.test.ts`(스펙 표와 열 대조) | PS-0, L0.store.plan(마이그레이션 실행기, `StoreDb`) | M | M1 |
| PS-2 | writer와 requests 멱등: `writer.ts`, `commit-plan.ts`, `producers.ts`, `requests.ts`, `tx-view.ts`. 소유 확인(`leases.holds(tx, token)`), seq 발급(`event_seq`), envelope 완성, 스키마·kind·크기 검사, FaultInjector 지점 10개 | PS-1, contracts(F.records: envelope, 카탈로그, `checkEnvelopeSize`, FR-P1 타입) | L | M1 |
| PS-3 | 투영기 인터페이스와 코어 투영: `projector/core.ts`, `projector/tx.ts`(코어용), M1 테이블(`p_threads`, `p_items`, `p_parts`, `p_effects`, `p_turns`, `p_inputs`, `step_checkpoints`, `p_blob_refs`) | PS-2 | L | M1 |
| PS-4 | 확장 투영 등록과 소유 검사: `projector/registry.ts`, `ProjectionTx` 문장 검사(디버그 빌드), 금지 문장, `onFailure`, 등록 때 재생성 | PS-3, X.operations.plan(O-14 `ExtProjection` → `Projector`) | M | M2 |
| PS-5 | 체크포인트 쓰기·읽기: `checkpoint.ts`(`StepCheckpointInput` → `checkpoint.step`, 승인 대기 예외, `schemaVersion` 검사), `loadCheckpoint` | PS-3 | S | M1 |
| PS-6 | 재개 절차: `resume.ts`(`openForWrite`, `openForRead`, `recover`, `beginResume`, 표식, `leases.inspect` 소유 표시), `ResumePlan` 조립 | PS-5, PS-7, PS-13 | L | M1 |
| PS-7 | effect 복구: `recovery.ts`(`decideOpenEffect`, `MAX_REPLAY_ATTEMPTS`), 합성 결과 커밋(kind 단위 예외), 의도 없는 toolCall 목록 | PS-2, contracts(`decideEffectRecovery`, `OUTCOME_UNKNOWN_TEXT`, `NOT_STARTED_TEXT`) | M | M1 |
| PS-8 | 승인 대기·입력 큐 복원: `p_approvals` 투영, `ResumePlan.pendingApprovals`, `queuedInputs`, `abortRequestedTurn`. M1은 입력 큐, M2는 승인 대기 | PS-6, F 카탈로그(FR-P9: `input.*`, `approval.*`, `turn.abort_requested`) | M | M1/M2 |
| PS-9 | lifecycle: `lifecycle.ts` 전체(create는 M1, 나머지 M2), `remove`의 삭제 표지 경로, `setTitle`, `prepareSwitch`, `LifecycleError` | PS-3(create), PS-10, PS-17 | L | M1/M2 |
| PS-10 | 분기: `branch.ts`(활성 가지, `readBranch`, `query.branchItems`, `itemEvent`), `moveLeaf`와 `thread.branch_summarized`, `fork`의 `forkedFrom` | PS-3 | M | M2 |
| PS-11 | 투영 재생성: `projector/rebuild.ts`(열 때·등록 때), `projector_state`, 테스트 도우미 `expectProjectionsRebuildable`. 청크 재생성은 M3 | PS-3 | M | M1(M3 청크) |
| PS-12 | 커밋 뒤 구독 방출: `subscribe.ts`(`EventFeed`, `subscribe`, `onCommit`, `onVolatile`, `emitVolatile`), `read.ts`(`readFrom`, `feed.read` 필터·scanLimit) | PS-2 | M | M1 |
| PS-13 | 업캐스터 연결: `upcast.ts`(등록부 조립, 읽기 경로 업캐스트, 열 때 버전 검사와 `read_only`) | PS-2, contracts(`upcastEvent`, `EventKindRegistry`) | S | M1 |
| PS-14 | 설정 노출: `settings.ts`(`l1.persistence.*` 5키, 단계별 since), `session-settings.ts`(`settings.changed`, `p_settings`) | PS-2, contracts(`defineSettings`) | S | M1/M2 |
| PS-15 | blob 분리: `blob.ts`(`detachLarge`, `hydrate`), `p_blob_refs`, `query.liveBlobRefs` | PS-3, L0.store.plan(`putBlob`, `readBlob`) | M | M1 |
| PS-16 | 플러그인과 서비스 조립: `plugin.ts`(`xeon.store` 주입, `xeon.session` 제공, `producer` 한 번 받기 규칙), `index.ts`, `ext-port.ts`(M2) | PS-2, PS-12, X.primitives(플러그인 등록 API) | M | M1(ext-port M2) |
| PS-17 | 확장 지점 7개 발화: `points.ts`. M1은 `session.start`, `session.shutdown`(F 표 M1 ● 지점), M2는 나머지 5개 | PS-16, X.primitives(`ExtHost.dispatch`) | M | M1/M2 |
| PS-18 | 보관 정리: `retention.ts`, 제외 규칙, `retention.*` 키 연결 | PS-9 | S | M2 |
| PS-19 | 리플레이 커서: `replay-cursor.ts`(`replayFrom` 해석, `oldestReplayableSeq`) | PS-12, FR-P7 | S | M3 |
| PS-20 | 되감기: `rewind.ts`(스냅샷 기록 `checkpoint.files`, `RewindPlan`, 복원 효과 3단) | PS-10, FR-P8, L1.tools(쓰기 분류) | L | 2차 |
| PS-21 | JSONL 내보내기: `export-jsonl.ts`(pi v3 대응 표, xeon-jsonl), `export.format` 키 | PS-10, PS-15 | M | 2차 |
| PS-22 | `SessionStore` 어댑터와 적합성 스위트(`replay_diverged` 검사 포함) | PS-2, PS-12, FR-P2 | M | 2차 |
| PS-23 | 자식 thread 연결: `p_agents` 투영(DDL·리듀서, `agent.spawned`·`agent.settled` 원천, F.records 카탈로그에 있음), `TxView.agentByRequestId`, `query.childAgents`, `ResumePlan.openChildren`(재개 5단계) | PS-3, PS-6, FR-P9(`agent.*`) 또는 L1.agents.spec F 요청 4 | M | M2 |

- 순서: PS-0 → PS-1 → PS-2 → (PS-3, PS-12, PS-13) → (PS-5, PS-7, PS-15, PS-11) → PS-6 → PS-8 → PS-16 → PS-17 → M1 스모크. M2는 PS-4, PS-10, PS-9, PS-14 나머지, PS-18, PS-23 순서다.
- 선행 계약: contracts(F.records의 envelope·카탈로그·효과·체크포인트·업캐스터, FR-P1 타입), platform-store의 `StoreDb`·마이그레이션 실행기·blob API(`L0.store.plan`). 둘 다 없으면 PS-2를 시작하지 않는다.

### 3.1 M2 구현 상태 (2026-10-24, 레인 L1B)

| id | 상태 | 위치 |
|---|---|---|
| PS-4 | 완료 | `projector/registry.ts`, `projector/tx.ts`(소유 테이블 검사, `guardProjectors`), writer의 `onProjectorFailure` |
| PS-8 | 완료(M2: 승인 대기 복원) | `p_approvals`는 M1에 있었고 `approvals.test.ts`의 `resume_restores_pending_approval`이 재시작 뒤 복원을 확인한다 |
| PS-9 | 완료 | `lifecycle.ts`(create, workspace), `lifecycle-admin.ts`(list, close, remove, setTitle), `lifecycle-branch.ts`(fork, revert, moveLeaf, prepareSwitch) |
| PS-10 | 완료 | `branch.ts`(활성 가지 질의, 공통 조상), `lifecycle-branch.ts`, `query.latestEvent·branchItems·itemEvent` |
| PS-14 | 완료 | `settings.ts`(retention 키 읽기), `session-settings.ts`. `p_settings`는 두지 않는다(spec §6.2) |
| PS-16 | 완료 | `ext-port.ts`, `ext-queries.ts`, `ext-state.ts`, `upcast.ts`(열린 확장 kind) |
| PS-17 | 완료 | `points.ts`(7개), `resume.ts`(session_start·shutdown), `lifecycle*.ts` |
| PS-18 | 완료 | `retention.ts`(`SessionService.retention`, 타입은 F `SessionRetention`) |
| PS-23 | 완료 | `p_agents`(`projector/core.ts`, `CORE_PROJECTOR_VERSION` 4), `views.ts`(`readAgentByRequest`, `readChildAgents`, `readOpenChildren`), `tx-view.ts`, `query.childAgents`, `resume.ts`(`openChildren`) |

시험 대역은 `platform-store/testing`의 실제 저장소다(`test/support/sqlite-store.ts`가 감싼다, open-issues M-04). `bunfig.toml`의 preload가 시험마다 저장소를 닫는다.

## 4. 채택 코드

[결정] 코드 포크는 없다. 자체 구현한다(`_research/foundation-plan.md` §1 결정 1, `_research/packages.md` §4.3 L1-f 행 "자체", "설계").

| 대상 | 버전 | 쓰는 방식 |
|---|---|---|
| `bun:sqlite` | Bun 1.4.3 내장(`packageManager: bun@1.4.3`) | 직접 쓰지 않는다. `xeon.store`(`StoreDb`) 뒤에서 L0가 쓴다 |
| `typebox` | catalog 1.4.x(`_research/foundation-plan.md` §2 스키마 행) | 설정 정의, 테스트 픽스처 검증 |
| `@xeon/contracts` | 워크스페이스 | `records`, `conversation`, `extensions`, `settings` 서브패스 |
| Cordis | `xeon/vendor/cordis` 커밋 고정 | 직접 import하지 않는다. ext-host의 플러그인 등록 API로 등록한다(ADR-0002) |

패턴 참고(읽기 자료, 코드는 가져오지 않음):

| 자료 | 경로 | 가져오는 것 |
|---|---|---|
| pi durable 원자 커밋 | `~/projects/_ref/pi-src/packages/durable/src/storage/sqlite/storage.ts:179-189` | 한 SQL 트랜잭션 = 한 커밋, 메타 행의 `next_seq`를 같은 트랜잭션에서 올리는 방식(`event_seq`) |
| pi durable 적합성 스위트 | `durable/src/testing/storage-conformance.ts` | 어댑터 팩토리를 받아 같은 시나리오를 돌리는 방식(PS-22) |
| pi durable fork | `durable/src/session/forks.ts`(97줄) | fork 시점(`asOf`)과 현재(`current`) 정책 구분. Xeon은 scope 상태 이벤트로 대응 |
| pi durable requestId | `durable/src/harness/submissions.ts:155-160` | 쓰기 전 대화 범위 중복 판정 |
| pi durable 열기 | `durable/src/harness/scheduler.ts:287-318` | 열 때 아무것도 실행하지 않는 규칙 |
| opencode 이벤트 표 | `event/sql.ts`(`event_sequence`, `event(id, aggregate_id, seq, created, type, data)`, `unique(aggregate_id, seq)`) | 표 모양. Xeon은 seq가 DB 전역이라 `UNIQUE(thread_id, seq)` 대신 `seq` 기본 키 |
| opencode 리듀서 | `session/message-updater.ts`(485줄) `update` | 이벤트별 투영 갱신 논리 |
| opencode 되감기 | `packages/core/src/snapshot.ts`(244줄), `packages/core/src/session/revert.ts`(114줄) | 2차 PS-20 스냅샷 범위와 stage·commit 단계 |
| pi 세션 JSONL | `coding-agent/src/core/session-manager.ts:41-195`(`CURRENT_SESSION_VERSION = 3`, 엔트리 11종) | 2차 PS-21 내보내기 형식 |

- [결정] pi durable의 `synchronous = NORMAL`(`durable/src/storage/sqlite/node.ts:191`)은 채택하지 않는다. FULL이다(adr.0004 §3.2 5번).

## 5. 단위 테스트 목록

태그는 파일 접미사로 정한다(`eng.testing.guide` TS-01). 모든 테스트는 `manualClock`, `fixedIdFactory`를 쓴다(TS-03). 투영을 건드리는 테스트는 끝에 `expectProjectionsRebuildable`을 부른다.

| 테스트 | 파일 | 확인할 동작 | 작업 |
|---|---|---|---|
| `commit_atomic_under_fault_at_every_point` | `commit.fault.test.ts` | `FaultPoint` 10종 모두에서 예외 주입. 커밋 전 지점은 대상 테이블 행 수·행 해시 불변, `after_commit`은 행이 남고 방출 0회. 지점 목록과 테스트 목록 대조(TS-08) | PS-2 |
| `commit_retry_after_fault_matches_clean_commit` | `commit.fault.test.ts` | 장애 뒤 같은 `CommitRequest` 재시도 결과가 장애 없는 커밋과 같은 envelope 해시 | PS-2 |
| `commit_idempotent_same_request_id` | `requests.test.ts` | 같은 키·지문 두 번 → `replayed: true`, 같은 `eventIds`, 행 수 불변 | PS-2 |
| `commit_key_reused_with_different_fingerprint_rejected` | `requests.test.ts` | `key_reused`, 행 변화 없음 | PS-2 |
| `ext_commit_result_mapping` | `ext-port.test.ts` | `ext.commit`이 `ownership_lost` → `lease_lost`, `key_reused` → `invalid`, `busy` → `busy`, `disk_full`·`read_only` → `storage`로 바꾸고, 같은 키·같은 지문 상태 커밋은 `replayed`와 `stored`를 돌려준다(스펙 §3.3 변환표) | PS-16 |
| `ext_load_thread_uses_active_branch` | `ext-port.test.ts` | 판 2까지 커밋하고 판 1 뒤로 되감으면 `ext.loadThread`가 판 1과 그 이벤트 id를 돌려준다(`latestEvent`의 `onActiveBranch`) | PS-16, PS-10 |
| `ext_private_records_visible_to_owner_only` | `ext-port.test.ts` | 확장 `alpha`가 `visibility: "private"`로 커밋한 `grp.alpha.note` 행은 `events.private_owner`가 `alpha`이고, `ext.queryRecords(thread, { kind: "grp.alpha.*" }, "beta")`에는 없고 `reader` `alpha`에는 있다. 생략한 행은 둘 다 있다. 다른 확장 접두 kind의 비공개 커밋은 `invalid`(스펙 §3.3, §9 28) | PS-16 |
| `commit_rejected_plan_is_replayed_without_build` | `requests.test.ts` | 거부 저장, 재시도 때 `build` 호출 0회 | PS-2 |
| `commit_seq_is_global_and_gapless` | `commit.test.ts` | 두 thread 번갈아 커밋해도 seq가 DB 전역으로 1씩 증가 | PS-2 |
| `commit_rejects_unowned_kind` | `commit.test.ts` | `core.tasks` 생산자가 `effect.result` 초안 → `store.prefix_not_owned` | PS-2 |
| `commit_requires_ownership_guard` | `commit.test.ts` | `leases.holds(tx, token)` 거짓(인수당한 이전 소유자의 토큰 포함)이면 `ownership_lost`, 새 thread의 `thread.started`만 예외 | PS-2 |
| `commit_nested_inside_listener_is_bug` | `subscribe.test.ts` | 리스너 안 동기 `commit` → `store.nested_write` | PS-12 |
| `step_commit_contains_checkpoint` | `commit.test.ts` | `checkpoint` 있는 커밋에 `step.completed` 다음 `checkpoint.step`이 같은 커밋, `step_checkpoints` 갱신, `leafEventId` = `step.completed` id | PS-5 |
| `checkpoint_without_step_is_bug_except_approval_wait` | `commit.test.ts` | `step.completed` 없는 체크포인트는 Bug, `waiting: "approval"` 예외는 통과 | PS-5 |
| `projection_rebuild_equals_live` | `projector.test.ts` | 투영 테이블 삭제 후 재생성 행 해시 = 실시간 갱신 행 해시 | PS-11 |
| `projection_version_bump_rebuilds_only_that_projector` | `projector.test.ts` | 버전 오른 투영기만 다시 만든다 | PS-11 |
| `projector_has_no_io` | `projector.test.ts` | 같은 이벤트 열을 두 번 재생한 결과 바이트 동일(D0) | PS-3 |
| `extension_cannot_write_foreign_prefix` | `ext-projector.test.ts` | 남의 접두 테이블 등록 → `table_not_owned`. `apply`가 남의 테이블에 쓰면 디버그 빌드에서 `store.prefix_not_owned`와 롤백 | PS-4 |
| `extension_projection_commits_with_core_event` | `ext-projector.test.ts` | 확장 테이블 행과 코어 이벤트가 같이 커밋되거나 같이 롤백 | PS-4 |
| `extension_projector_failure_notifies_and_rolls_back` | `ext-projector.test.ts` | 확장 `apply` 예외 → 롤백, `onFailure` 1회, Bug | PS-4 |
| `subscribe_emits_only_after_commit` | `subscribe.test.ts` | `before_commit` 장애 때 방출 0회, 성공 때 1회. seq 순서. 리스너 예외가 다른 리스너에 영향 없음 | PS-12 |
| `subscribe_catch_up_then_live_has_no_gap` | `subscribe.test.ts` | `afterSeq` 따라잡기와 실시간 사이 빈칸·중복 없음 | PS-12 |
| `upcast_on_read_and_read_only_on_future_version` | `upcast.test.ts` | 읽기 경로 업캐스트, 모르는 코어 kind와 미래 버전이면 쓰기 열기 거부 | PS-13 |
| `detach_large_strings_keeps_envelope_under_limit` | `commit.test.ts` | 300 KiB 문자열 payload가 자리표시와 `detached`로 저장되고 `hydrate`가 원문을 돌려준다 | PS-15 |
| `resume_synthesizes_outcome_unknown_for_unsafe` | `recovery.test.ts` | intent+exec, `unsafe` → `interrupted` 합성, `OUTCOME_UNKNOWN_TEXT`. intent만 → `abandoned`, `NOT_STARTED_TEXT` | PS-7 |
| `resume_reruns_safe_tool_once_up_to_max_attempts` | `recovery.test.ts` | safe·safe → `reruns` 한 건, attempt 1. exec 3건이면 `outcome_unknown` | PS-7 |
| `resume_does_not_promote_stored_unsafe` | `recovery.test.ts` | 저장 `unsafe`, 현재 `safe` → 합성 | PS-7 |
| `resume_never_fires_tool_call_point_for_intended_calls` | `recovery.test.ts` | 재개 경로의 `tool.call.before` 디스패치 0회(가짜 ExtHost 기록) | PS-7 |
| `resume_lists_tool_calls_without_intent_as_pending` | `recovery.test.ts` | 의도 없는 toolCall이 `pendingToolCalls`에 | PS-7 |
| `resume_restores_pending_approval` | `resume.int.test.ts` | A1 커밋 뒤 끊고 다시 열면 같은 `approvalId` 하나, 새 `approval.requested` 없음 | PS-8 |
| `resume_restores_input_queue` | `resume.int.test.ts` | queued 두 건이 같은 seq 순서로 복원 | PS-8 |
| `abort_requested_turn_not_resumed` | `resume.int.test.ts` | 취소 의도 있는 turn은 `reruns` 비고 `autoResume.reason: "abort_requested"` | PS-6 |
| `resume_marker_comes_from_events` | `resume.int.test.ts` | `turn.started` 뒤 표식 생김, `turn.completed` 뒤 사라짐, `thread.resumed`로 시도 수 증가 | PS-6 |
| `resume_attempts_capped` | `resume.int.test.ts` | `maxResumeAttempts` 도달 뒤 `beginResume` → `attempts_exhausted` | PS-6 |
| `fork_creates_new_thread_with_forked_from` | `lifecycle.test.ts` | 새 thread 첫 이벤트 `thread.started{forkedFrom}`, 원본 이벤트 수 불변, `session.fork.before` 거부 시 커밋 없음 | PS-9 |
| `fork_continuity` | `fork-continuity.test.ts` | fork thread의 활성 가지가 출처의 fork 지점까지의 item을 같은 `itemId`로 잇고, 출처의 이후 쓰기는 들어오지 않으며, fork의 fork도 이어지고, 상속한 item으로는 되감기가 안 된다 (M2 마감 G2-11) | PS-9 |
| `branch_item_records_pages` | `item-pages.test.ts` | `before`·`limit` 쪽을 이어 붙이면 활성 가지 전체와 같고(fork 경계 포함), `hasMore` 정확, 오류 사유 구분, 쪽에 든 item의 blob만 읽는다 (M2 마감 G2-11) | PS-9 |
| `leaf_move_keeps_old_branch` | `branch.test.ts` | `moveLeaf` 뒤 옛 가지가 `readFrom`에 남고 `readBranch`에는 새 가지만 | PS-10 |
| `branch_summary_committed_with_leaf_move` | `branch.test.ts` | summary가 있으면 `thread.branch_summarized`가 같은 커밋 | PS-10 |
| `revert_rejects_target_inside_turn` | `lifecycle.test.ts` | toolCall 있는 assistant item 대상 → `invalid_target{inside_turn}` | PS-9 |
| `remove_deletes_thread_rows_and_blocks_other_deletes` | `lifecycle.test.ts` | `remove`만 `events` 삭제 가능, 포크가 가리키면 `has_forks`, 지운 seq 재사용 없음 | PS-9 |
| `set_title_writes_thread_updated_and_fires_info_changed` | `lifecycle.test.ts` | 제목 이벤트와 `session.info.after` 1회 | PS-9 |
| `lock_conflict_offers_delegate_observe_fork` | `resume.int.test.ts` | 가짜 잠금 실패 때 `openForRead`가 observer로 열리고 커밋은 `read_only{observer}`, `fork`는 새 thread를 만든다. 선택지 구성은 호스트 테스트가 확인 | PS-6, PS-9 |
| `session_settings_follow_branch` | `lifecycle.test.ts` | `settings.changed`가 `p_settings`와 `layer(threadId)`에 반영 | PS-14 |
| `session_settings_key_reused` | `session-settings.test.ts` | 같은 `requestKey`에 다른 값이면 `set`·`reset`이 `key_reused` 값을 돌려주고 행과 층이 그대로다 | PS-14 |
| `ddl_matches_spec_table` | `ddl.test.ts` | DDL 열 목록과 스펙 §3.10 표 대조 | PS-1 |
| `restart_invariants_k1_to_k6` | `restart.fault.test.ts` | 자식 프로세스를 K1~K6에서 SIGKILL, 다시 열어 `recover`, 스펙 §4.14 불변식 | PS-6, PS-7 |
| `events_update_and_stray_delete_blocked_by_trigger` | `ddl.test.ts` | `events` UPDATE는 트리거가 막고, `threads.remove` 경로 밖의 DELETE도 막는다(스펙 §9-21) | PS-1 |
| `session_points_fire_at_spec_times` | `points.test.ts` | 지점 7개가 스펙 §7.1 시점에 발화한다. first 지점(`session.switch.before`, `session.fork.before`, `session.tree.before`)의 거부·예외면 커밋이 없고, tap 지점은 커밋 뒤에만 발화한다. M1은 `session.start`, `session.shutdown`, M2는 나머지 5개 | PS-17 |
| `retention_prunes_only_eligible_threads` | `retention.test.ts` | `maxAgeDays`·`maxCount` 대상 중 표식이 남은 thread, 열린 turn이 있는 thread, 포크 출처, 쓰기 소유 중인 thread는 남고 나머지만 `threads.remove` 경로로 지워진다 | PS-18 |
| `agent_by_request_id_finds_spawned_child` | `projector.test.ts` | `agent.spawned` 커밋 뒤 `TxView.agentByRequestId(부모, requestId)`가 그 자식을 돌려주고, `agent.settled` 뒤 `settled`가 채워진다. 재생성 뒤에도 같다(스펙 §9-22) | PS-23 |
| `resume_lists_unsettled_children` | `resume.int.test.ts` | 자식 생성 커밋 뒤 SIGKILL, 다시 열면 `ResumePlan.openChildren`에 그 자식이 있고, 부모 turn에 취소 의도가 있으면 재개 대상에서 빠진다 | PS-23 |
| `step_commit_count_matches_formula` | `commit.test.ts` | 도구 n개 단계의 커밋 수가 `3 + 3n`(S1, C3, E1~E3 × n, C5)이다(스펙 §9-23) | PS-2 |

## 6. 완료 기준

1. 위 테스트가 모두 통과한다(`just test` 범위의 `core-persistence`).
2. `xeon/apps/cli/test/chat.scenario.test.ts`(저장소에 하나인 스모크)에서 모델 테이프로 한 turn을 돌리고 강제 종료, 재개하면 이벤트 seq가 빈칸 없이 이어진다(`_research/foundation-plan.md` §6 M1 스모크).
3. `cd xeon && just verify`가 종료코드 0이다.
4. fsync 비용 측정 항목: 모델 테이프 스모크에서 단계당 커밋 수와 커밋 지연(p50, p95)을 기록한다. 단계당 커밋 수는 스펙 §4.2 식 `3 + 3 × 도구 수`(S1, C3, 도구마다 E1~E3, C5)이고, 도구 3개 단계는 12커밋이다. 이 12커밋의 지연 합이 테이프 모델 응답 지연의 10%를 넘으면 위험 대응(§7 3행)을 연다 [제안: 기준값]. turn 단위 커밋(C1, C2, C2b, C6)과 취소 의도(X1)는 따로 기록한다.
5. 스펙 §9 수용 기준 1~23마다 그것을 확인하는 테스트에 `// spec §9.n` 주석이 있다.
6. F 변경 요청 FR-P1·FR-P2·FR-P9가 F 트랙에서 결론이 났다(채택 또는 대안).

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| 커밋 API 이름 불일치(F `SessionStore.appendBatch` 대 eng `SessionWriter.commit`) | L1 동료가 서로 다른 타입을 기대해 M1 통합이 늦는다 | PS-0에서 대응 표(스펙 §3.1)를 확정하고 contracts 변경 요청(FR-P1, FR-P2)을 함께 올린다. F 수용 전에는 타입을 `contracts/src/records/commit.ts` 초안 PR로 올려 L1 동료가 같은 파일을 보게 한다 |
| 투영 재생성 비용 | 큰 DB에서 열기가 느려진다 | 투영 버전이 오를 때와 새 등록 때만 재생성한다. 10만 건 넘으면 청크 재생성(M3)으로 커서를 `projector_state.rebuild_cursor`에 저장하고 이어서 한다 |
| 도구별 커밋 증가에 따른 fsync 비용 | 도구가 많은 단계가 느려진다 | §6 4번 측정 항목. 기준을 넘으면 읽기 도구만 의도·실행·결과를 배치하는 안을 ADR-0004 보충으로 올린다(eng T-5). 설계 변경 전에는 코드로 우회하지 않는다 |
| bun:sqlite 저장점 의미(eng 미결 T-2) | 중첩 write가 저장점이 되어 부분 커밋처럼 보일 수 있다 | 중첩 write 금지 테스트(`commit_nested_inside_listener_is_bug`, L0의 중첩 write 테스트)로 고정한다. 결과는 L0.store.plan과 공유 |
| `p_inputs`, `p_approvals`의 kind가 F에 없다(FR-P9) | 투영 코드를 쓸 수 없다 | M1은 `input.*`만 필요하다. F 결론 전에는 L1.tasks.spec §3.8 payload로 투영을 쓰고 kind 이름이 바뀌면 같은 PR에서 고친다 |
| X `RecordCommitPort` 이름 충돌(`commit`) | X가 `xeon.session`을 그대로 포트로 쓰지 못한다 | `SessionService.ext` 하위 객체(스펙 §3.3)를 X.primitives 트랙과 M1 전에 합의한다. X의 포트 계약 스위트(`X.primitives.plan` P-19)를 이 패키지 테스트에서 돌린다 |
| 확장 투영기 예외가 세션 진행을 막는다 | 확장 하나 때문에 커밋이 반복 실패 | `onFailure` 알림과 X의 확장 끄기 경로(X.operations 미결 6)를 M2 통합 테스트로 확인한다. 그 전에는 M1 테스트 그룹 투영을 단순 삽입 하나로 제한한다(X.operations.plan과 같은 대응) |
| adr.0004·adr.0006 개정(OS 잠금 + `sys_leases.epoch` 펜싱, review.decisions-2 U-09)이 늦음 | 문서 정본이 잠시 둘로 보인다 | 소유 확인을 `leases.holds(tx, token)` 호출 하나로 모은다. 가짜 `LeaseService`를 테스트에 둔다 |
| 설정 파일 소유 이전 제안(스펙 §6.2)이 거절된다 | L1이 파일 I/O를 맡아야 하고 `xeon.os` 의존이 생긴다 | 거절되면 `settings-files.ts`를 더하고 context-map (d)열에 `xeon.os`를 더하는 요청을 낸다. M1 범위에는 영향 없음(M1 `settings.get`은 호스트가 파일을 읽는다) |
