---
id: xeon.research.eng-3
layer: meta
domain: research
kind: guide
status: draft
depends_on: []
binds: []
---

# 엔지니어링 조사 3: Bun 1.4의 SQLite와 테스트 기능

정본 아님. 조사 원자료로서 구속 문서(`engineering/*`)와 저장소·테스트 설계의 근거로 인용한다. 인용 형식은 `_research/notes/eng-3.md §절`이다.

- 대상 런타임: Bun 1.4.3(npm 최신, `_research/foundation-plan.md §2`의 고정 버전)
- 조사 일자: 2026-10-21
- 조사 질문: (a) bun:sqlite 트랜잭션·PRAGMA·오류 형태, (b) bun test의 시계·가짜 타이머·mock.module·coverage 임계·패키지별 실행, (c) setCustomSQLite와 FTS5 검사

## 0. 요약

- (a) `db.transaction(fn).immediate()`는 BEGIN IMMEDIATE로 실행되며, 쓰기 잠금은 BEGIN 시점에 잡힌다. `PRAGMA journal_mode = WAL`과 `synchronous = FULL`은 설정과 조회가 모두 된다. 오류는 `SQLiteError`이며 `code`(예: `SQLITE_BUSY`)와 `errno`를 갖는다. 기본 `busy_timeout`이 0이라 잠금 충돌은 즉시 실패하므로, 설계 09 §3.6.3의 5000 설정을 연결마다 명시해야 한다.
- (b) `setSystemTime`, `jest.useFakeTimers`(setTimeout 포함), `mock.module`, `bunfig.toml`의 `coverageThreshold`가 동작한다. `mock.module`은 기본 실행에서 파일 사이에 누수되므로 `--isolate` 또는 `--parallel`이 필요하다. 임계 미달은 종료 코드 1로만 알리고 메시지를 내지 않는다. 패키지 cwd에서 실행하면 루트 `bunfig.toml`을 읽지 않으므로 패키지마다 설정 파일이 필요하다.
- (c) `setCustomSQLite`는 macOS 전용이다. Linux 실측 반환값은 공식 문서(`false`)와 달리 `true`였다. FTS5 검사는 반환값을 근거로 하지 않고 `sqlite_compileoption_used`와 FTS5 생성·MATCH 프로브로 한다. Linux x64 Bun 1.4.3의 번들 SQLite 3.53.4는 FTS5를 포함한다. macOS는 [미확인]이다.

## 1. 조사 방법과 한계

- 공식 문서: https://bun.com/docs/api/sqlite , https://bun.com/docs/test/dates-times , https://bun.com/docs/test/mocks , https://bun.com/docs/test/code-coverage , https://bun.com/docs/test/configuration , https://bun.com/docs/test/parallel , https://bun.com/docs/pm/filter 를 확인했다. 이 도구의 페이지 가져오기는 작은 모델이 요약해 답하는 방식이므로, 인용문이 원문과 글자 단위로 같다고 보장되지 않는다. 요약에 기대는 내용은 "(요약 기준)"으로 표시한다.
- 선언 파일(1차 근거): `xeon/node_modules/.bun/bun-types@1.4.3/node_modules/bun-types/sqlite.d.ts`, `test.d.ts`. 저장소 루트 기준 경로다.
- Bun 본체 소스는 로컬에 없다. 소스 수준 확인은 전부 [미확인]이다.
- 실측(재현 근거): 로컬 설치본 Bun 1.4.3(linux-x64, WSL2)으로 돌렸다. 항목당 1~2회 실행했고, 잠금 경합처럼 타이밍에 따라 달라질 수 있는 결과는 반복 검증하지 않았다 [미확인]. 재현 스크립트는 임시 디렉터리에 있으며 저장소에는 넣지 않았다(§7). 실측 OS는 Linux x64뿐이다. macOS, Windows, Linux arm64는 [미확인]이다.

## 2. (a) bun:sqlite 트랜잭션, PRAGMA, 오류

### 2.1 문서와 선언

- `db.transaction(fn)`은 `(...args) => T` 함수를 반환하며, 이 함수에 `deferred`, `immediate`, `exclusive` 속성이 붙는다. 각각 `BEGIN DEFERRED`, `BEGIN IMMEDIATE`, `BEGIN EXCLUSIVE`를 쓴다. [선언] sqlite.d.ts:394-415, [공식] api/sqlite.
- 래핑 함수는 동기 함수여야 한다. `async` 함수는 첫 `await`에서 반환하고, 그 뒤는 트랜잭션 밖이다. [공식]
- 트랜잭션 함수 안에서 다른 트랜잭션 함수를 부르면 안쪽은 저장점(savepoint)이 된다. [공식]
- 예외가 던져지면 롤백되고, 예외는 그대로 전파된다. [선언] sqlite.d.ts:366-369, [공식]
- 오류 객체는 `SQLiteError`이며 `name`은 고정값이다. `errno`(확장 오류 코드의 숫자), `code`(예: `SQLITE_CONSTRAINT_UNIQUE`), `byteOffset`을 갖는다. [선언] sqlite.d.ts:1271-1302. 공식 문서는 오류 코드 목록을 싣지 않는다.
- 생성자 옵션은 `readonly`, `create`, `readwrite`, `safeIntegers`, `strict`다. [선언] sqlite.d.ts:36-84. `fileMustExist`는 선언에 없다.
- PRAGMA: 공식 문서는 `PRAGMA journal_mode = WAL;`을 권장하고, 빠른 커밋을 위해 `PRAGMA synchronous = NORMAL`을 든다. 설계 09 §3.6.3의 `synchronous = FULL`은 이 권장과 반대 방향이다. 설계 문서는 정전이 나도 커밋된 이벤트를 잃지 않도록 FULL을 택했고, 그 근거를 §3.6.3에 적었다. [공식], [제안] 설계 09의 FULL을 유지한다.
- `static setCustomSQLite(path: string): boolean`이다. [선언] sqlite.d.ts:351. 선언 주석은 macOS 전용이며, 최초 호출은 `new Database()` 전에만 효력이 있다고 쓴다. 같은 경로의 재호출은 멱등이고, 다른 경로는 SQLite가 로드된 뒤 거부된다. 공식 문서는 다른 OS에서 "does nothing and returns false"라고 쓴다. [공식]
- FTS5: 공식 문서에 FTS5 빌드 옵션 언급은 없다. Linux와 Windows는 "upstream defaults"를 따르는 정적 링크이고, macOS는 Apple 시스템 SQLite를 쓰며 WAL을 지속 설정으로 둔다고 쓴다. [공식]

### 2.2 실측 (Bun 1.4.3, linux-x64)

| 항목 | 결과 |
|---|---|
| `PRAGMA journal_mode = WAL` | 반환값 `wal` |
| `PRAGMA synchronous = FULL` | 조회값 2(FULL) |
| 번들 SQLite 버전 | 3.53.4 |
| `PRAGMA compile_options` | `ENABLE_FTS5`, `ENABLE_FTS3` 포함 |
| `:memory:`에서 FTS5 생성, 삽입, `MATCH` | 성공 |
| 새 연결의 `busy_timeout` | 0 (Bun 기본값) |
| 다른 연결이 쓰기 잠금을 쥔 상태에서 `.immediate()` 빈 트랜잭션, busy_timeout 0 | 즉시 `SQLITE_BUSY`("database is locked"). 잠금이 BEGIN 시점에 잡힌다는 뜻이다 |
| 같은 조건의 `.deferred()` 빈 트랜잭션 | 오류 없음 |
| 다른 프로세스가 1.5초 쓰기 잠금, busy_timeout 5000 | 약 1,078ms 대기 후 성공 |
| 같은 조건, busy_timeout 0 | 1ms 안에 `SQLITE_BUSY` |
| 다른 연결이 쓰기 잠금을 쥔 상태에서 `.deferred()` 트랜잭션의 `SELECT 1` | 성공. 테이블을 읽는 경우는 [미확인] |
| 트랜잭션 안의 삽입 뒤 사용자 `throw` | 삽입 행 전부 롤백. 원래 `Error`가 그대로 전파됨 |
| 외부 트랜잭션 안의 `.immediate()` 중첩 | 오류 없음. 외부가 롤백되면 내부 행도 사라지고, 외부가 커밋되면 남음 |
| `readonly: true` 연결 + `PRAGMA query_only = ON`에서 쓰기 | `SQLITE_READONLY`(errno 8). 같은 연결의 SELECT는 성공 |
| `readonly: true`로 없는 파일 열기 | `SQLITE_CANTOPEN`(errno 14) |
| `create: false`로 없는 파일 열기 | `SQLITE_MISUSE`(errno 21). 옵션 의미와 맞지 않는 오류 형태 |
| `fileMustExist: true` 옵션 | 생성자가 "bad parameter or other API misuse"로 실패 |
| `PRAGMA wal_checkpoint(TRUNCATE)` | 실행 성공 |

오류 형태(실측):

| 상황 | name | code | errno | message |
|---|---|---|---|---|
| UNIQUE 위반 | SQLiteError | SQLITE_CONSTRAINT_UNIQUE | 2067 | UNIQUE constraint failed: ev.k |
| 문법 오류 | SQLiteError | SQLITE_ERROR | 1 | near "SELEC": syntax error |
| 잠금 충돌 | SQLiteError | SQLITE_BUSY | 5 | database is locked |
| 읽기 전용 쓰기 | SQLiteError | SQLITE_READONLY | 8 | attempt to write a readonly database |

`byteOffset`은 UNIQUE 위반에서 -1, 문법 오류에서 0이었다.

### 2.3 설계 09와의 대조 [제안]

| 설계 항목 | Bun 1.4.3 결과 | 조치 |
|---|---|---|
| §3.6.3 `journal_mode = WAL` | 동작 | 유지 |
| §3.6.3 `synchronous = FULL` | 동작 | 유지 |
| §3.6.3 `busy_timeout = 5000` | 기본값은 0 | 연결 직후 명시 설정이 필요하다 |
| §3.6.3 `foreign_keys`, `temp_store`, `cache_size`, `mmap_size`, `wal_autocheckpoint`, `journal_size_limit`, `trusted_schema`, `application_id` | 설정 뒤 조회값이 맞음(`cache_size`는 조회하지 않음) | 유지 |
| §3.6.3 읽기 연결 `readonly: true, fileMustExist: true` | `fileMustExist`는 실측에서 오류를 낸다 | 열기 전 파일 존재 검사로 대체한다 |
| §3.6.3 종료 시 `wal_checkpoint(TRUNCATE)` | 실행 성공 | 유지 |
| §3.8.1 겹 3, §3.8.4 1~2단계: `BEGIN IMMEDIATE` 직후 부팅 epoch 검사 | 잠금이 BEGIN에서 잡히므로 검사 순서가 성립한다 | 유지 |
| §3.6.3 드라이버 `better-sqlite3` | Bun 전제로 바뀐다 | `_research/foundation-plan.md §2`의 bun:sqlite 결정으로 대체 [결정] |

### 2.4 미확인

- macOS의 Apple 시스템 SQLite에서 `setCustomSQLite`가 실제로 교체되는지, FTS5가 포함되는지 [미확인].
- Linux arm64, Windows, `bun build --compile` 산출물의 번들 SQLite 구성 [미확인].
- `setCustomSQLite`가 Linux에서 `true`를 반환하는 이유와, 시스템 라이브러리가 실제로 로드되는지 [미확인]. 존재하지 않는 경로를 부른 뒤에도 버전이 3.53.4였다.
- `create: false`가 SQLITE_MISUSE를 내는 이유(소스 미확인) [미확인].
- 중첩 `.immediate()`가 저장점으로 처리되는지, BEGIN을 생략하는지는 SQL 추적 없이 관찰 결과만 있다 [미확인].
- 테이블을 읽는 SELECT가 다른 연결의 쓰기 잠금 중에도 성공하는지(WAL 읽기 동작의 직접 확인) [미확인].
- 사용자 `throw` 외의 JS 측 오류 형태 전체 [미확인].

## 3. (b) bun test

### 3.1 문서와 선언

- `setSystemTime(new Date(...))`로 시각을 고정한다. 인자 없이 부르면 실제 시각으로 돌아간다. 영향 범위는 `Date.now`, `new Date()`, `Intl.DateTimeFormat().format()`이다. 반환값과 타이머 영향은 문서에 없다. [공식: dates-times(요약 기준)], [선언] test.d.ts:92.
- `jest.useFakeTimers()`, `jest.useRealTimers()`, `jest.setSystemTime()`, `jest.now()`를 지원한다고 문서가 쓴다. 문서는 `useFakeTimers`가 Date 생성자를 바꾸지 않는다고 설명한다(요약 기준). 선언의 `jest` 네임스페이스는 `advanceTimersByTime`, `advanceTimersToNextTimer`, `runAllTimers`, `runOnlyPendingTimers`, `getTimerCount`, `clearAllTimers`, `isFakeTimers`를 포함한다. [선언] test.d.ts:94-110.
- `mock.module(path, factory)`로 모듈을 덮는다. 이미 import된 모듈도 덮고, factory는 비동기일 수 있다. 원본 평가 자체를 막으려면 `--preload`나 bunfig의 `preload`를 쓴다. `mock.restore()`는 `mock.module` 대상을 복원하지 않는다. [공식: mocks(요약 기준)], [선언] test.d.ts:54.
- CLI: `--coverage`, `--coverage-reporter=text|lcov`, `--coverage-dir`. [공식], `bun test --help`로도 확인했다.
- bunfig `[test]` 키: `coverage`, `coverageThreshold`(숫자, 또는 `{ lines, functions }` 객체. `statements`는 받지만 강제하지 않는다), `coverageSkipTestFiles`, `coverageReporter`, `coverageDir`, `coveragePathIgnorePatterns`, `coverageIgnoreSourcemaps`. [공식: code-coverage, configuration(요약 기준)]
- 문서는 임계 미달 시 0이 아닌 종료 코드를 낸다고 쓴다. 검사는 `--parallel` 밖에서, 텍스트 보고기가 켜진 경우에만 이뤄진다고 요약된다(요약 기준). 아래 실측과 다르다.
- 문서는 테스트가 import하지 않은 파일은 커버리지 보고서에 나오지 않는다고 쓴다. [공식(요약 기준)]
- 격리: `--parallel`을 쓰면 `--isolate`가 함께 켜진다. 플래그가 없는 기본 실행에서는 모든 파일이 하나의 전역 객체와 모듈 레지스트리를 공유한다. `--parallel --no-isolate`에서는 워커 하나가 받은 파일들끼리 상태를 공유한다. 워커 수 기본값은 CPU 코어 수다. [공식: parallel(요약 기준)], `bun test --help`
- 워크스페이스: `bun test`에는 워크스페이스나 projects 설정이 없다. `bun test --help`에 `--filter` 플래그도 없다. 파일이나 디렉터리 경로 인자로 대상을 고른다. [공식: test(요약 기준)] `--filter`는 `bun --filter <패턴> <스크립트>`와 `bun run --filter`의 스크립트 선택 기능이며, 워크스페이스 패키지의 `name`이나 경로로 고른다. [공식: pm/filter(요약 기준)]

### 3.2 실측 (Bun 1.4.3)

| 항목 | 결과 |
|---|---|
| `setSystemTime(2020-01-01)` 뒤 `Date.now()`와 `new Date().getFullYear()` | 2020 반영. 인자 없는 호출로 실제 시각 복귀 확인 |
| `jest.useFakeTimers()` 아래 `setTimeout(cb, 1000)` 뒤 `jest.advanceTimersByTime(2000)` | 같은 동기 구간에서 cb 실행. setTimeout이 가짜 타이머에 들어감 |
| `jest.runAllTimers()` | 대기 중 setTimeout 실행 |
| `jest.setSystemTime()` 뒤 `Date.now()`와 `new Date()` | 같은 값 |
| 이미 import한 모듈에 `mock.module` 적용 뒤 동적 `import()` | mock 값을 반환. 정적 import 바인딩 갱신은 [미확인] |
| 기본 실행, 파일 2개: a가 `mock.module("./dep")`, b가 실제 `dep`을 정적 import | b 실패. 누수 재현 |
| 같은 파일 조합, `--isolate` | 통과 |
| 같은 파일 조합, `--parallel` | 통과 |
| 같은 파일 조합, `--parallel --no-isolate` | 실패. 누수 재현 |
| 기본 실행, a가 시계를 2020으로 고정하고 끝남, b가 연도 > 2020을 검사 | b 통과. 누수 없음(관찰 1회) |
| bunfig 임계 `{ lines: 0.9, functions: 0.9 }`, 함수 커버리지 87.5% | 종료 코드 1. 출력에 임계 미달 문구 없음. 커버리지 표만 출력 |
| 같은 실행, 임계 0.4 | 종료 코드 0 |
| CLI `--coverage-threshold=0.5` | `bun test --help`에 없는 플래그다. 지정해도 bunfig의 0.9가 적용되어 종료 코드 1 |
| bunfig `coverageReporter = ["lcov"]`(text 없음), 임계 미달 | 종료 코드 1. 문서의 "lcov만이면 항상 0" 설명과 다름 |
| `--parallel` + text 보고, 임계 미달 | 종료 코드 1. 문서의 "--parallel 밖에서만 검사" 설명과 다름 |
| 테스트가 import하지 않는 파일 | 커버리지 표에 나오지 않음 |
| 루트에서 `bun test` (루트 bunfig) | 모든 패키지의 테스트를 수집하고 루트 bunfig를 적용 |
| 루트에서 `bun test packages/b` | 해당 패키지 테스트만 실행(경로 필터) |
| `cd packages/b && bun test` | 루트 bunfig 미적용. 커버리지 표 없음, 임계 무시 |
| `packages/a/bunfig.toml` 추가 뒤 `cd packages/a && bun test` | 패키지 설정 적용(임계 0.5 통과) |
| `bun --filter '@tp/a' test` | 패키지의 test 스크립트 실행. cwd가 패키지이므로 패키지 bunfig 적용 |
| `bun run --filter '@tp/*' test` | 두 패키지 동시 실행. 출력 접두사로 구분 |

실행 환경 주의: 이 세션의 셸에서 `bun`(mise shim)은 "No version is set for shim: bun"으로 실패했다. 위 실측은 설치본 경로를 PATH 앞에 두고 수행했다. 셸 실패의 원인은 확인하지 않았다 [미확인].

### 3.3 설계 대조 [제안]

- 시각과 타이머 테스트는 `setSystemTime`과 `jest.useFakeTimers`로 작성할 수 있다. setTimeout 제어는 실측으로 확인했다.
- `mock.module`을 쓰는 테스트는 `--isolate`를 명시하거나 `--parallel`로 실행한다. 기본 직렬 실행은 파일 사이 누수로 실패할 수 있다.
- 패키지별 실행 방식은 둘 중 하나로 정한다 [미결 M-2]. (a) 루트에서 경로 인자로 실행하면 루트 `bunfig.toml` 하나로 충분하다. (b) 패키지 cwd에서 실행하면 패키지마다 `bunfig.toml`이 필요하다. `_research/foundation-plan.md §6`의 "패키지별 실행"은 (b)에 가깝다.
- 임계 미달 메시지가 없으므로 CI는 종료 코드에 의존한다. 스텝 이름에 임계 기준을 적어 원인을 찾기 쉽게 한다 [제안].
- 커버리지 집계에는 모든 소스 파일을 import하는 테스트가 필요하다. 그렇지 않으면 빠진 파일이 집계에서 사라져 임계가 실제보다 높게 보인다 [제안].
- `foundation-plan`의 임계 기준은 line과 function으로 정한다. `statements`는 강제되지 않으므로 기준으로 쓰지 않는다 [제안].

### 3.4 미확인

- `jest.useFakeTimers`만 켠 상태에서 `Date` 생성자가 바뀌지 않는다는 문서 설명의 실측. 이번 실측은 `setSystemTime`을 함께 쓴 경우만 확인했다 [미확인].
- `mock.module`의 ESM과 CJS 세부 차이 [미확인].
- `--shard`, `--timings`의 실측 [미확인].
- macOS와 Windows에서 커버리지와 격리 동작 [미확인].

## 4. (c) Database.setCustomSQLite와 FTS5 검사

### 4.1 API와 제약

- 시그니처: `static setCustomSQLite(path: string): boolean`. [선언] sqlite.d.ts:351.
- 대상은 macOS다. 경로는 `.dylib` 파일이며 실행 파일이 아니다. [공식], [선언]
- 효력 시점: 첫 `new Database()` 전에 불러야 한다. 같은 경로 재호출은 허용되고, 다른 경로는 로드 뒤 거부된다. [선언], [공식]
- 반환값: 공식 문서는 다른 OS에서 `false`라고 한다. 실측(Linux x64, Bun 1.4.3)에서는 존재하지 않는 경로와 시스템 `libsqlite3.so.0` 경로 모두 `true`를 반환했다. 존재하지 않는 경로를 부른 뒤에도 번들 SQLite 버전은 3.53.4 그대로였다. 따라서 반환값만으로 교체 성공을 판정하지 않는다 [제안].

### 4.2 FTS5 검사 절차 [제안]

1. 옵션 조회: `SELECT sqlite_compileoption_used('ENABLE_FTS5')`. 실측 결과 1.
2. 옵션 목록: `PRAGMA compile_options`에 `ENABLE_FTS5`가 있는지 확인. 실측 결과 포함.
3. 기능 프로브: `:memory:` 연결에서 `CREATE VIRTUAL TABLE p USING fts5(x)`, 행 삽입, `MATCH` 질의. 실측 결과 성공.

3단계는 데이터 파일을 건드리지 않는다. macOS의 시스템 SQLite는 옵션 목록에 Apple 빌드 값을 보고하므로, 1·2단계만으로는 판정이 부족하다. 실제 기능을 판정하는 3단계를 필수로 둔다 [공식(macOS 옵션 보고), 제안]. 프로브가 실패했을 때 시작을 거부할지 기능을 끌지는 L0 store 계획에서 정한다 [미결 M-3].

### 4.3 기존 자료 정정

- `_research/stack-status.md §7-D`의 "Linux/Windows의 FTS5 포함 여부 [미확인]" 항목은 Linux x64에 한해 실측으로 해소되었다. Windows는 [미확인]이다.
- `_research/foundation-plan.md §2`의 DB 행, "macOS는 setCustomSQLite로 FTS5 포함 SQLite 지정"은 macOS 실측 전까지 [가정]이다. dylib 경로와 설치 방법은 [미확인]이다.

## 5. 설계 문서 반영 후보 [제안]

1. 설계 09 §3.6.3에 `busy_timeout = 5000` 명시 설정이 필요하다는 점과, Bun의 기본값이 0이라는 점을 적는다.
2. 읽기 연결의 `fileMustExist` 항목을 파일 존재 검사로 바꾼다.
3. 테스트 규칙에 `mock.module` 테스트의 격리 실행(`--isolate` 또는 `--parallel`) 요구를 넣는다.
4. FTS5 프로브를 L0 store 시작 절차에 넣는다.

## 6. 미결 사항

- [미결 M-1] macOS 실측이 필요하다. dylib 경로, FTS5 포함 여부, WAL 지속 설정을 확인해야 한다. macOS에서 실측할 담당과 시점을 정한다.
- [미결 M-2] 패키지별 테스트 실행 방식. (a) 루트 경로 인자 실행과 (b) 패키지 cwd 실행 중 택일하고, 패키지별 `bunfig.toml` 필요 여부를 정한다.
- [미결 M-3] FTS5 프로브 실패 시 동작. 시작 거부인지 기능 비활성인지 정한다.

## 7. 재현 방법

- 실측 스크립트는 임시 디렉터리에 있다. `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/bunexp/`에 `sqlite-check*.ts`, `busy` 실험용 `holder.ts`와 `waiter.ts`, bun test 실험용 `tp/`, `tp2/`, `tp3/`가 있다. 저장소에는 넣지 않았다.
- 실행 바이너리: `/home/user/.local/share/mise/installs/bun/1.4.3/bin/bun`(버전 1.4.3 확인).
