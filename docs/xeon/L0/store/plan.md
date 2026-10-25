---
id: L0.store.plan
layer: L0
domain: store
kind: plan
status: draft
depends_on: [L0.store.spec, eng.testing.guide, eng.toolchain.guide]
binds: [xeon/packages/platform-store/**]
---

# L0 저장 기반 구현 계획 (store)

대상 스펙: `L0.store.spec`. 패키지: `xeon/packages/platform-store`(`@xeon/platform-store`, 서브패스 `./testing`).

## 1. 목표와 마일스톤 배치

[결정] M0 범위에 `platform-store`(bun:sqlite, 이벤트·투영·체크포인트·세션 잠금)가 들어간다(`_research/foundation-plan.md §5` P4 M0). 이 계획은 그 가운데 L0 몫(연결, sys 스키마, 트랜잭션 래퍼, 잠금, 블롭)을 나눈다. `events`·`p_*`·seq 발급은 `L1.persistence.plan` 몫이다.

| 마일스톤 | 범위 | 작업 |
|---|---|---|
| M0 | 연결 설정, FTS5 프로브(Linux 구현 + macOS CI job), 접두사 검사, `write`/`read` 트랜잭션, sys 스키마 v1(`sys_meta`·`sys_migrations`·`sys_migration_cursors`·`sys_prefixes`), 마이그레이션 실행기, `openTestStore`, FaultInjector 연결, `StoreService` 등록과 `l0.store.*` 선언, 세션 잠금(sys v2 `sys_leases` + posix OS 잠금 + epoch 펜싱)과 두 프로세스 단일 소유 통합 테스트 | ST-01~ST-07, ST-09~ST-12, ST-15 |
| M1 | 블롭 쓰기·읽기(sys v3), 확장 접두사 테이블 등록·삭제, 장애 주입 테스트, macOS fullfsync 측정, X 확장 저장 영역 계약 스위트 | ST-08, ST-14, ST-16, ST-17, ST-23 |
| M2 | 마이그레이션 전 스냅샷 | ST-24 |
| M2 이후 | 블롭 GC, 청크 마이그레이션, Windows `LockProvider`, macOS 동봉 SQLite 배포 경로, 운영 빌드 접두사 검사 확대 판단 | ST-18~ST-22 |

- M1 스모크(`xeon chat` 강제 종료 뒤 재개, `_research/foundation-plan.md §6`)는 ST-12(임대)와 ST-13(복구 표식)이 끝나야 돈다.
- `L1.persistence.plan`의 `SessionWriter.commit`은 ST-04·ST-09에 기댄다. 두 작업을 M0 앞쪽에 둔다.
- 세션 잠금을 M0에 두는 근거: `_research/foundation-plan.md` §5 P4 M0 범위가 `platform-store`(bun:sqlite, 이벤트·투영·체크포인트·세션 잠금)다. 블롭과 복구 표식은 그 목록에 없고 M1 스모크(강제 종료 뒤 재개)가 쓰므로 M1에 둔다 [제안].
- F 선행 조건: `L0.store.spec` §8.1 FR-S1(`sql.ts`, `store-db.ts`), FR-S2(`lease.ts`), FR-S4(`migrations.ts`)는 M0 착수 조건이다. FR-S3은 철회되었다(복구 표식은 `L1.persistence.spec` §4.8.1의 `p_threads` 열, `L0.store.spec` §4.8). 반영 전에는 같은 타입을 이 패키지에 임시로 두지 않는다. 이 타입은 L1 persistence·L0 process가 import하는 공유 타입이라 `L0.readme` §3의 임시 타입 규칙(패키지 안에서만 쓰는 shim)이 적용되지 않는다.

## 2. 패키지와 파일 배치

```
xeon/packages/platform-store/
  package.json                 # exports ".", "./testing". xeon.layer L0, domain store
  bunfig.toml                  # [test] preload, coverageThreshold (eng.testing.guide TS-10)
  src/
    index.ts                   # openStore, storePlugin, 공개 타입 재수출
    open.ts                    # openStore: §4.4 열기 절차, close
    sqlite-env.ts              # setCustomSQLite 1회 호출, newDatabase(), probeFts5 (TC-11 예시 코드 위치)
    pragmas.ts                 # 쓰기·읽기 PRAGMA 표, 적용과 조회 검증
    db.ts                      # StoreDb 구현(write/read), 오류 매핑, inWrite 표지
    prefix.ts                  # 소유자 표, EXPLAIN 대조(디버그), DDL 어휘 검사(운영)
    migrations.ts              # MigrationRunner(apply, runChunked), 체크섬
    snapshot.ts                # snapshotBeforeMigration: VACUUM INTO, 보관 3개 (ST-24)
    sys-schema.ts              # sys_* DDL (owner "sys" MigrationSet)
    ext-tables.ts              # ExtensionTables(register, drop)
    lease.ts                   # LeaseService(acquire, renew, release, holds, inspect, keepAlive)
    lock/
      provider.ts              # LockProvider, LockHandle, LockAcquireError, 프로세스 안 보유 표
      posix.ts                 # bun:ffi flock (macOS·Linux)
      win32.ts                 # M2 이후 (수단 미결 S-5)
      none.ts                  # DB 임대만 (후퇴안)
    select.ts                  # OS provider 선택 지점 하나 (DR-13)
    blob.ts                    # putBlob, readBlob, BlobPins
    gc.ts                      # 블롭 GC (M2 이후)
    settings.ts                # defineSettings("l0.store", …)
    service.ts                 # StoreService 조립, Cordis 플러그인
    testing/
      index.ts                 # openTestStore: 실제 bun:sqlite :memory: 또는 tempDir 파일
      fault.ts                 # StoreFaultPoint, faultAt(), F FaultInjector 연결
  test/
    pragmas.int.test.ts
    sqlite-env.int.test.ts
    sqlite-order.int.test.ts   # 자식 프로세스로 setCustomSQLite 순서 위반 확인
    db.int.test.ts
    prefix.int.test.ts
    migrations.int.test.ts
    ext-tables.int.test.ts
    lease.int.test.ts
    lease-two-process.int.test.ts
    lock-posix.int.test.ts
    blob.int.test.ts
    blob.fault.test.ts
    gc.int.test.ts
    commit.fault.test.ts       # FaultInjector 10지점 참조 커밋
    ext-storage.contract.int.test.ts  # X 계약 시나리오를 실제 bun:sqlite 팩토리로 실행(D-05)
    fixtures/                  # 자식 프로세스 진입 스크립트(holder.ts, order-violation.ts)
  src/**/*.test.ts             # 순수 함수 단위 테스트 (prefix 어휘 분석, 체크섬, 경로 계산)
```

- 파일 이름 접미사는 `eng.testing.guide` TS-01 표를 따른다. 실제 SQLite 파일이나 자식 프로세스를 쓰면 `.int`, 장애 주입·강제 종료는 `.fault`다.
- `bun:sqlite` import는 `sqlite-env.ts`, `db.ts`, `pragmas.ts`, `testing/index.ts`에만 둔다. `new Database`는 `sqlite-env.ts`의 `newDatabase()`만 부른다(spec §4.1 2번).
- `bun:ffi` import는 `lock/posix.ts`(와 M2 이후 `lock/win32.ts`)에만 둔다.
- `process.platform` 등 OS 분기는 `select.ts`만 쓴다. 판정 값은 `StoreEnvironment`(L0.os 제공)로 받는다(DR-13).

## 3. 작업 분해

규모: S(하루 이내), M(2~3일), L(4일 이상).

| id | 내용 | 선행 | 규모 | 마일스톤 |
|---|---|---|---|---|
| ST-01 | `sqlite-env.ts`: 경로 결정, `setCustomSQLite` 1회 호출과 `loaded` 상태, `newDatabase()`, `probeFts5`(필수 단계) + `compile_options` 진단. Linux 먼저 | FR-S1 | S | M0 |
| ST-02 | [실측 2026-10-25 macOS 26.5.2, Apple silicon, Bun 1.4.3, 2026-10-25: 시스템 `bun:sqlite`는 SQLite 3.51.0이고 `create virtual table … using fts5(x, tokenize="trigram")`가 성공한다. Homebrew `/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`도 있으나 기본으로 쓰지 않는다. CI job 부분(FTS5 없는 amalgamation으로 거짓 확인)은 아직 남음] macOS CI job(`eng.toolchain.guide` TC-11에서 추가하는 job): `macos-latest`에서 시스템 SQLite 프로브 결과 기록, FTS5 없는 amalgamation과 FTS5 포함 amalgamation을 빌드해 `setCustomSQLite`로 지정하고 프로브 참·거짓 확인 | ST-01 | M | M0 |
| ST-03 | 연결 팩토리(`pragmas.ts`, `open.ts` 3단계): 쓰기·읽기 PRAGMA 적용과 조회 검증, 파일 존재 검사, 0600/0700, `fsKind` 판정 처리, 종료 절차(`wal_checkpoint(TRUNCATE)`) | ST-01 | M | M0 |
| ST-04 | `db.ts`: `write`(`transaction().immediate()`), `read`(BEGIN DEFERRED), 중첩·async 콜백 Bug, `SQLiteError.code` 오류 매핑 | ST-03 | M | M0 |
| ST-05 | `sys-schema.ts`: `sys_meta`·`sys_migrations`·`sys_migration_cursors`·`sys_prefixes` DDL(owner `sys` v1), `application_id` 대조, `storeId` 발급, `user_version` 동기화 | ST-04 | S | M0 |
| ST-06 | `migrations.ts` `apply`: 체크섬, 순서·빈칸 검사, 단계별 트랜잭션, 실패 롤백, 오류 종류 | ST-05 | M | M0 |
| ST-07 | `prefix.ts`: 소유자 표(`TABLE_PREFIX_OWNERS` + `sys_prefixes`), 디버그 빌드 `EXPLAIN` 루트 페이지 대조와 캐시, 운영 빌드 DDL 어휘 검사, `scoped(owner)`. 비용 측정 스크립트(문장 1만 개) 결과를 미결 S-8에 남긴다 | ST-04, ST-05 | M | M0 |
| ST-08 | `ext-tables.ts`: `register`(`ExtensionName` 패턴·예약어, 하이픈 → 밑줄 접두 변환), 지역 이름 규칙으로 하는 확장 테이블 소유 판정, `drop(name, tables)`(정확한 이름 목록만, 소유 아닌 이름이 있으면 전부 거부, FTS5 가상 테이블 포함) | ST-06, ST-07 | S | M1 |
| ST-09 | `testing/index.ts` `openTestStore`(`:memory:` 또는 `tempDir()` 파일), `rowCounts()`, `leases`(keepAlive 콜백을 붙잡는 임대 핸들), `takeover`·`loseLease`와 `TEST_HOLDER_A`·`TEST_HOLDER_B`(소비자 시험이 다른 엔진 인스턴스의 임대 인수와 하트비트 상실을 흉내 낸다. M2 PLT.4, open-issues M-04), `testing/fault.ts`: F `FaultInjector`를 받아 저장소 경로에 연결, `StoreFaultPoint` 지점 호출, 참조 커밋 픽스처(`commit.fault.test.ts`) | ST-04, ST-05 | M | M0 |
| ST-10 | `service.ts`, `settings.ts`: `StoreService` 조립, Cordis 플러그인으로 `xeon.store` 등록, `l0.store.*` 선언(`checkSettingDef` 통과) | ST-06, ST-07 | S | M0 |
| ST-11 | `lock/provider.ts`, `lock/posix.ts`, `lock/none.ts`, `select.ts`: bun:ffi `flock(LOCK_EX\|LOCK_NB)`, 키 파일(삭제 금지), 디렉터리 0700·소유자 검사, 프로세스 안 보유 표, FD_CLOEXEC 확인 | FR-S2 | M | M0 |
| ST-12 | `lease.ts`: `sys_leases` DDL(owner `sys` v2), `acquire`·`renew`·`release`·`holds`·`inspect`·`keepAlive`(주입 `Scheduler`), 후퇴안(`none`)의 pid·지문 판정(`StoreEnvironment.processStartedAt`) | ST-11, ST-05, L0.os.plan OS-18 | M | M0 |
| ST-13 | (철회) 복구 표식은 `L1.persistence.spec` §4.8.1의 `p_threads` 열로 정해 이 패키지에서 구현하지 않는다(`L0.store.spec` §4.8) | - | - | - |
| ST-14 | `blob.ts`: `putBlob` 쓰기 순서(임시 파일 → fsync → rename → 디렉터리 fsync → 행), 같은 해시 생략, `readBlob` 크기 검사, `sys_blobs`·`sys_blob_refs` DDL(sys v3), `BlobPins` | ST-04, ST-12(sys v2 다음 단계) | M | M1 |
| ST-15 | 두 프로세스 통합 테스트(`lease-two-process.int.test.ts`): 자식 둘이 같은 자원 경합, SIGKILL 뒤 즉시 인수, 늦게 깬 이전 소유자의 쓰기 거부 | ST-12 | M | M0 |
| ST-16 | 블롭·임대 장애 주입 테스트(`blob.fault.test.ts`) | ST-09, ST-14 | S | M1 |
| ST-17 | macOS `fullfsync` 성능 측정: 커밋 1000회의 p50·p99를 `fullfsync` 켬·끔으로 비교해 미결 S-9에 남긴다 | ST-02, ST-03 | S | M1 |
| ST-18 | `gc.ts`: 고아 행·행 없는 파일·임시 파일 정리, `scheduler` 임대 확인, 수동 시계 테스트 | ST-14, ST-12 | M | M2 이후 |
| ST-19 | `migrations.ts` `runChunked`: `sys_migration_cursors`, 청크별 트랜잭션, `signal`, 중단 뒤 이어하기 | ST-06, FR-S5 | M | M2 이후 |
| ST-20 | `lock/win32.ts`: named mutex 또는 `LockFileEx` bun:ffi 실측과 구현(미결 S-5) | ST-11 | M | M2 이후 |
| ST-21 | [macOS 26 실측으로 FTS5가 시스템 SQLite에 있어 필요성이 낮아짐(ST-02, 2026-10-25). 구버전 macOS·FTS5 부재 시의 대비책으로 남긴다] macOS 동봉 SQLite 배포 경로: FTS5 포함 dylib 빌드 스크립트, `L0.os` `resourceDir()` 연동, `L4.desktop.plan`·`L4.cli.plan`과 패키징 합의 | ST-02 | L | M2 이후 |
| ST-22 | 운영 빌드 접두사 검사 확대 판단(ST-07 측정 결과), 블롭 해시 재검증 운영 적용 판단 | ST-07, ST-14 | S | M2 이후 |
| ST-23 | 확장 저장 영역 계약 스위트(`ext-storage.contract.int.test.ts`): X `test/operations/storage/ext-storage.contract.ts`의 시나리오 모음을 테스트 파일 교차 import로 가져와 `openTestStore` 기반 저장소 팩토리(`StoreDb`, `ProjectionTx`, `Projector`, F.records.spec §3.9)로 돌린다. 장애 주입 지점 이름은 X와 같은 문자열(`after_ext_projection:<n>` 등)을 쓴다. 시나리오 파일은 `X.operations.plan` O-15가 만든다 [결정: review.decisions-2 D-05, U-17] | ST-08, ST-09 | S | M1 |
| ST-24 | 마이그레이션 전 스냅샷: `snapshot.ts`(`snapshotBeforeMigration`, 보관 3개), `migrations.ts` 연결, `StoreWarning`의 `migration_snapshot`·`snapshot_prune_failed`. `migration-snapshot.int.test.ts`가 올리기 전 상태 복사, 모드, 보관 수, 실패 시 단계 미실행을 확인. `spec` §4.6.1 | ST-06 | S | M2 |

## 4. 채택 코드

| 대상 | 버전 | 방식 | 비고 |
|---|---|---|---|
| `bun:sqlite` | Bun 1.4.3 내장(`packageManager: bun@1.4.3`) | 그대로 쓴다 | [결정] `_research/foundation-plan.md §2` DB 행. 이 패키지만 import한다(DR-07) |
| `bun:ffi` | Bun 1.4.3 내장 | `lock/posix.ts`에서 libc `flock`만 부른다 | `_research/notes/L0-2.md §4.1` 1안. Linux x64 실측, macOS 미실측. 실험 기능 경고 원문 확인은 미결 S-10 |
| `typebox` | 1.3.27(`xeon/package.json` catalog) | 설정 스키마 | `F.wire-settings.spec` §3.0 |
| `better-sqlite3`, `node:sqlite`, `sqlite3` | - | 금지 | `.oxlintrc.json` `no-restricted-imports` 패턴에 있다. 계획 v2 L0-e 표의 better-sqlite3 서술은 `_research/foundation-plan.md §2`의 bun:sqlite 결정이 우선한다 |
| `proper-lockfile` | - | 쓰지 않는다 | 크래시 뒤 약 5~10초 대기(`_research/notes/L0-2.md §2.6`). flock이 즉시 인수한다 |
| oh-my-pi `coding-agent/src/session/blob-store.ts`(437줄, 커밋 `d1bffdf`) | - | 규칙만 차용, 포크하지 않는다 | GC 쓰기 유예(재쓰기 요청 시 갱신)와 임시 파일 규칙만 가져온다. `Bun.SHA256`·pi-tui·pi-utils 결합 때문에 포크 비용이 새로 쓰기보다 크다(`_research/packages.md §2.3`, `§4.2` L0-e) |
| oh-my-pi `session-storage.ts:610-631`, `crates/pi-natives/src/file_lock/*` | - | 규칙만 차용 | 세션 id 키, 사이드카 삭제 금지, 디렉터리 0700·소유자 검사(`_research/notes/L0-2.md §2.5`). Rust 코드는 가져오지 않는다 |

락 구현 수단(research 질문 2 결과, `_research/notes/L0-2.md`):

- macOS·Linux: bun:ffi `flock` 사이드카. Linux는 `dlopen("libc.so.6", { flock: { args: ["i32", "i32"], returns: "i32" } })`. `bun build --compile` 바이너리에서도 같은 결과를 실측했다(§2.2). macOS 라이브러리 이름 `libSystem.B.dylib`는 실측으로 확인했다(macOS 26.5.2, Apple silicon, Bun 1.4.3, 2026-10-25, `lock-posix.int.test.ts` 통과: 파일은 디스크에 없어도 dlopen이 된다).
- Linux 추상 소켓(`Bun.listen({ unix: "\0…" })`)은 Linux 전용이라 채택하지 않는다. 파일 소켓 + connect 프로브는 판정과 unlink 사이 경쟁이 있어 채택하지 않는다(§2.4).
- Windows: 미결 S-5. ST-20 전까지 `none` provider(DB 임대만, 크래시 뒤 최대 30초 대기)다.

## 5. 단위 테스트 목록

| 테스트 | 파일 | 확인할 동작 |
|---|---|---|
| `pragmas are applied on the write connection` | `pragmas.int.test.ts` | 임시 파일 DB에서 `journal_mode`=`wal`, `synchronous`=2, `busy_timeout`=5000, `foreign_keys`=1, `trusted_schema`=0, `temp_store`=2, `application_id`=1480937294 |
| `read connection is query_only` | `pragmas.int.test.ts` | 읽기 연결의 `query_only`=1, 쓰기 문장이 `SQLITE_READONLY` 계열 오류 |
| `open checks file existence without fileMustExist` | `pragmas.int.test.ts` | 없는 파일이면 새로 만들고 0600. 소스에 `fileMustExist` 문자열이 없음(정적 검사) |
| `foreign application_id is rejected` | `pragmas.int.test.ts` | `application_id`를 다른 값으로 둔 파일은 `foreign_database`이고 파일이 바뀌지 않음 |
| `network and drvfs filesystems are rejected` | `pragmas.int.test.ts` | `dbDirFsKind`가 `network`·`drvfs`이면 `unsupported_filesystem`, `unknown`이면 경고만 |
| `probe returns true with bundled sqlite` | `sqlite-env.int.test.ts` | Linux에서 `probeFts5()`가 참 |
| `probe returns false when fts5 module is missing` | `sqlite-env.int.test.ts` | FTS5 없는 SQLite 흉내: `probeFts5`가 받는 `ProbeDriver`(`run`, `query`만 있는 좁은 인터페이스)에 `no such module: fts5`를 던지는 구현을 넣는다. 실제 FTS5 없는 SQLite 확인은 ST-02 macOS job(FTS5 빼고 빌드한 amalgamation을 `setCustomSQLite`로 지정)이 한다 |
| `missing fts5 opens store with capability off` | `sqlite-env.int.test.ts` | 프로브 거짓 + `requireFts5=false`면 열림, `capabilities.fts5=false`, 경고 `fts5_missing`. `requireFts5=true`면 `fts5_missing` |
| `setCustomSQLite after first Database is a bug` | `sqlite-order.int.test.ts` | 자식 프로세스에서 `newDatabase()` 뒤 다른 경로로 초기화하면 `Bug(store.sqlite_already_loaded)`, 종료코드 1 |
| `nested write is a bug and rolls back` | `db.int.test.ts` | 안쪽 `write`가 `Bug(store.nested_write)`, 바깥 행 변화 없음 |
| `async callback is a bug` | `db.int.test.ts` | Promise 반환 콜백이 `Bug(store.async_tx)` |
| `busy beyond timeout is a Result error` | `db.int.test.ts` | 두 번째 연결이 BEGIN IMMEDIATE를 쥔 동안 `busyTimeoutMs=0`인 `write`가 `err({kind:"busy"})` |
| `disk full maps to disk_full` | `db.int.test.ts` | `PRAGMA max_page_count`를 작게 둔 DB에서 삽입이 `err({kind:"disk_full"})` |
| `statements outside the owner prefix are rejected in debug` | `prefix.int.test.ts` | `scoped("cap.knowledge")`로 `p_turns` 읽기·쓰기, `sys_leases` 쓰기가 `Bug(store.prefix_not_owned)`. `cap_knowledge_x`는 통과 |
| `ddl outside migrations is rejected` | `prefix.int.test.ts` | 범위 핸들 `write` 안 `CREATE TABLE`이 `Bug(store.ddl_outside_migration)`. `ATTACH`는 운영 모드에서도 거부 |
| `explain cache is refreshed on schema change` | `prefix.int.test.ts` | 테이블을 지우고 같은 이름으로 다시 만든 뒤에도 판정이 맞음 |
| `ddl lexer extracts table names` | `src/prefix.test.ts` | 따옴표 이름, `IF NOT EXISTS`, `temp.` 접두, 주석이 든 DDL에서 대상 이름 추출 |
| `migration checksum mismatch is rejected` | `migrations.int.test.ts` | 적용된 단계 SQL을 바꾸면 `migration_checksum_mismatch`, DDL 실행 없음 |
| `migrations apply in order and stop at the failing step` | `migrations.int.test.ts` | 3단계 중 2단계 실패 시 1단계만 남고 `migration_failed` |
| `future version is reported` | `migrations.int.test.ts` | DB 버전 > 코드 버전이면 `migration_future_version` |
| `extension ids follow pattern and reserved words` | `ext-tables.int.test.ts` | `Helm`, `ext`, `a_b`, `x`가 `ext_id_invalid`. `acme-notes`는 접두 `x_acme_notes_`로 등록 |
| `drop removes only the extension tables` | `ext-tables.int.test.ts` | 확장 `ab`(`x_ab_cd`)와 `ab-cd`(`x_ab_cd_ef`)를 등록한 뒤 `drop("ab", ["x_ab_cd"])`는 `x_ab_cd`(FTS5 가상 테이블 포함)만 지우고 `x_ab_cd_ef`, `events` 그대로. `drop("ab", ["x_ab_cd_ef"])`는 `table_not_owned`이고 행 변화 없음 |
| `fault points keep the store consistent` | `commit.fault.test.ts` | 참조 커밋 픽스처(`events` 모양 테스트 테이블, `p_` 테스트 투영, `requests` 모양 테이블)에 F `FaultPoint` 10지점을 연결하고 지점마다 예외: 커밋 전 9지점은 `rowCounts()`와 행 해시가 같음, `after_commit`은 모두 남음. 모든 경우 `integrity_check`=ok |
| `exactly one acquire wins under contention` | `lease.int.test.ts` | 같은 프로세스 두 홀더가 같은 자원을 획득하면 하나만 `ok`, 다른 하나는 `LockBusy{reason:"os_lock_held"}` |
| `late writer is fenced by epoch` | `lease.int.test.ts` | A 획득 → B가 인수(epoch+1) → A의 토큰으로 `holds`가 거짓, `renew`가 `lease_lost` |
| `release keeps epoch monotonic` | `lease.int.test.ts` | 반납 뒤 재획득 epoch가 증가 |
| `none provider waits for expiry on another host` | `lease.int.test.ts` | 수동 시계로 `leaseTtlMs` 전에는 `lease_active`, 뒤에는 인수 |
| `keepAlive reports loss once` | `lease.int.test.ts` | 인수당한 뒤 `onLost`가 한 번 불리고 타이머가 멈춤(수동 시계) |
| `flock is released on SIGKILL` | `lock-posix.int.test.ts` | 자식(`fixtures/holder.ts`)이 쥔 잠금을 SIGKILL 뒤 즉시 획득 |
| `lock fd is close-on-exec` | `lock-posix.int.test.ts` | Linux `/proc/self/fdinfo` flags에 O_CLOEXEC |
| `lock files are never deleted` | `lock-posix.int.test.ts` | 반납 뒤 키 파일이 남고 디렉터리 모드 0700 |
| `two processes own one session` | `lease-two-process.int.test.ts` | 서로 다른 두 프로세스가 같은 `session:<threadId>`를 경합하면 소유자는 하나. 소유자 SIGKILL 뒤 다른 쪽이 즉시 인수. 멈춰 둔(SIGSTOP) 이전 소유자를 깨워 커밋하게 하면 `lease_lost`이고 행 변화 없음 |
| `same blob is written once` | `blob.int.test.ts` | 같은 바이트 두 번 `putBlob`: 파일 mtime 불변, `last_put_at` 갱신 |
| `putBlob inside a transaction is a bug` | `blob.int.test.ts` | `write` 콜백 안 호출이 `Bug(store.nested_write)` |
| `missing blob is reported` | `blob.int.test.ts` | 파일 삭제 뒤 `readBlob`이 `blob_missing`, 크기 변조는 `blob_corrupt{size}` |
| `partial blob writes are cleaned` | `blob.fault.test.ts` | `StoreFaultPoint` `blob_after_tmp_write`·`blob_after_fsync`·`blob_after_rename`에서 중단 → 목적 파일이 없거나 완전함. 남은 임시 파일은 GC가 정리 |
| `orphan blob after failed commit is collected` | `gc.int.test.ts` | 블롭 선쓰기 뒤 커밋 실패 → 유예 전 GC는 남김, 유예 뒤 GC는 파일·행 삭제. 참조(`sys_blob_refs`)가 있는 블롭은 남김 |
| `chunk migration resumes from saved cursor` | `migrations.int.test.ts` | 3청크 중 2청크 뒤 `signal` 중단 → 다시 실행하면 3청크부터, 처리 수 합계 일치 |
| `extension storage contract runs on bun:sqlite` | `ext-storage.contract.int.test.ts` | X 계약 시나리오 전부가 실제 bun:sqlite 팩토리에서 통과. `after_ext_projection:0` 장애 주입 뒤 확장 테이블 행 해시 불변(`X.operations.plan` §5 23번과 같은 시나리오) |
| `settings definitions pass checkSettingDef` | `src/settings.test.ts` | `l0.store.*` 일곱 키가 `checkSettingDef`, `buildCatalog` 통과 |

`StoreFaultPoint` [제안](이 패키지 `testing/fault.ts` 전용, F `FaultPoint`에 넣지 않는다): `blob_after_tmp_write`, `blob_after_fsync`, `blob_after_rename`, `blob_before_row`, `lease_after_os_lock`, `lease_before_commit`, `migration_after_step`.

## 6. 완료 기준

- `cd xeon && just verify`가 종료코드 0이다.
- `platform-store` 단위·통합·장애 주입 테스트가 Linux에서 통과하고 커버리지 임계(lines·functions 0.9, TS-10)를 넘는다.
- TC-11에 추가하는 macOS CI job에서 FTS5 프로브가 통과하고, FTS5를 뺀 SQLite로 프로브가 거짓을 돌려준다(ST-02).
- 서로 다른 두 프로세스를 띄우는 통합 테스트 1개(`lease-two-process.int.test.ts`)가 단일 소유, 즉시 인수, 늦은 쓰기 거부를 증명한다(ST-15).
- `bun:sqlite`·`bun:ffi` import 위치가 §2의 파일 목록 밖에 없다(check-layers, oxlint `no-restricted-imports`).
- X 확장 저장 영역 계약 시나리오가 실제 bun:sqlite 팩토리에서 통과한다(ST-23, spec §9 18번).
- spec §9 수용 기준 1~18이 각각 §5의 테스트 하나 이상에 대응한다.

## 7. 위험과 대응

| 위험 | 영향 | 대응 |
|---|---|---|
| macOS 시스템 SQLite에 FTS5가 없을 가능성 | 세션 검색 불가 | ST-02에서 실측: macOS 26.5.2 시스템 SQLite 3.51.0에는 FTS5(trigram 포함)가 있다(macOS 26.5.2, Apple silicon, Bun 1.4.3, 2026-10-25). 더 낮은 macOS는 미실측. 없으면 동봉 dylib 경로(ST-21)를 확정할 때까지 `capabilities.fts5=false`로 검색만 끈다(spec §4.1) |
| bun:ffi로 OS 잠금이 불가능하거나 불안정(macOS, 실험 경고) | 크래시 뒤 즉시 인수 불가 | `none` provider(DB 임대만)로 후퇴한다. 정합성은 epoch로 같고, 크래시 뒤 최대 30초(`leaseTtlMs`) 대기와 PID·지문 검사 코드를 감수한다(`_research/notes/L0-2.md §4.3`) |
| WAL 파일 증가와 체크포인트 정체 | 디스크 사용, 읽기 성능 저하 | `journal_size_limit` 64 MiB, `read` 콜백 동기, 종료 때 `TRUNCATE` 체크포인트, `checkpoint_incomplete` 경고를 진단에 남긴다. 다른 프로세스의 장시간 읽기 연결은 `host.status`(L4)로 보이게 한다 |
| macOS `fullfsync` 성능 | 커밋 지연 | ST-17 측정. 지연이 크면 `macFullFsync` 기본값을 끄고 `checkpoint_fullfsync`만 둔다(미결 S-9) |
| 확장의 접두사 우회(동적 SQL, 가상 테이블) | 세션 테이블 오염 | 디버그 빌드 `EXPLAIN` 대조, 운영 빌드 DDL 검사, 범위 핸들의 `ATTACH`·`PRAGMA` 금지. 가상 테이블 그림자 테이블 접근은 ST-07에서 실측해 보완한다 |
| 블롭 선쓰기 뒤 커밋 실패로 쌓이는 고아 파일 | 디스크 사용 | GC 유예(`blobGraceMs`) 뒤 회수(ST-18). M2 전에는 GC가 없으므로 M1 기간의 고아 파일은 남는다. M1 스모크 범위에서는 양이 작다 [가정] |
| `setCustomSQLite` 호출 순서 위반 | macOS에서 "SQLite already loaded" | `newDatabase()` 단일 경로, `sqlite-order.int.test.ts` |
| `transaction().immediate()`의 중첩 저장점 의미 미확인(T-2) | 의도하지 않은 저장점 | 중첩 금지 Bug로 경로를 막는다. SQL 추적으로 확인한 뒤 T-2를 닫는다 |
