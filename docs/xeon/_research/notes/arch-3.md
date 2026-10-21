---
id: meta.research.arch-3
layer: meta
domain: research
kind: guide
status: draft
depends_on: []
binds: []
---

# 조사 노트 arch-3: bun:sqlite의 FTS5 포함 여부와 macOS 커스텀 SQLite 절차

정본 아님. 조사 원자료다. 스펙과 ADR을 쓸 때 인용한다. 조사 기준일은 2026-10-21이고, 대상 버전은 Bun 1.4.3이다(`foundation-plan.md §2`의 `packageManager: bun@1.4.3`).

조사 범위: 1차 자료(Bun 1.4.3 태그의 소스와 문서, SQLite 공식 문서, Homebrew 포뮬러)로 한정했다. 코드는 실행하지 않았다. 내려받은 파일은 텍스트로만 읽었다. 원문 사본은 `/tmp/claude-1000/-home-user-projects-helm/18be0c42-9f6e-4c80-8aa6-91ac9c0b15e2/scratchpad/bun-src/`에 있다.

## 1. 결론

- [결정] `foundation-plan.md §2`의 DB 행(bun:sqlite, macOS는 `Database.setCustomSQLite`로 FTS5 포함 SQLite 지정)은 코드상 유효한 절차다. 다만 호출 순서와 FTS5 포함 여부에 조건이 붙는다(§3.2).
- Linux·Windows: Bun 1.4.3 소스가 번들 SQLite 빌드에 `SQLITE_ENABLE_FTS5: 1`을 정의한다. 소스 기준으로 FTS5가 포함된다. 실행 바이너리의 `PRAGMA compile_options`는 실행하지 않았으므로 [미확인]이다.
- macOS: 기본값은 시스템 `libsqlite3.dylib`을 실행 시점에 dlopen하는 방식이다. Apple 빌드의 FTS5 포함 여부는 [미확인]이다. 커스텀 dylib을 지정하려면 첫 Database를 열기 전에 `setCustomSQLite`를 호출해야 한다. 한 번 로드된 뒤에는 다른 경로를 지정할 수 없다.
- [제안] 시작 시 검사 순서를 "플랫폼별 dylib 경로 결정 → `setCustomSQLite` → FTS5 탐침"으로 고정한다. 기본 시스템 라이브러리로 DB를 먼저 열면 커스텀 경로 지정이 실패한다(§3.2 근거 줄 참조).
- [제안] `setCustomSQLite`의 반환값으로 플랫폼을 판별하지 않는다. 1.4.3 소스는 비-macOS에서도 `true`를 반환한다. stack-status §7-D가 적은 "그 외 OS에서 `false` 반환"은 1.4.3 소스와 맞지 않는다.

## 2. 확인 방법과 자료 등급

| 자료 | 위치 | 확인 방식 |
|---|---|---|
| Bun 1.4.3 소스 | `https://raw.githubusercontent.com/oven-sh/bun/bun-v1.4.3/...` | 원문을 내려받아 줄 번호를 직접 확인 (1차) |
| Bun 1.4.3 문서 | `docs/runtime/sqlite.mdx` (같은 태그) | 원문 직접 확인 (1차) |
| Bun 공식 문서 | `https://bun.com/docs/runtime/sqlite` | WebFetch 요약 경유 인용 (1차, 요약 경유) |
| SQLite 공식 문서 | `https://sqlite.org/fts5.html`, `https://sqlite.org/pragma.html`, `https://sqlite.org/c3ref/compileoption_get.html` | WebFetch 요약 경유 인용 (1차, 요약 경유) |
| Homebrew 포뮬러 | `https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/s/sqlite.rb` | 원문 직접 확인 (1차, master 기준) |
| 과거 Apple 빌드 FTS5 표 | PSPDFKit 가이드 | 2차 자료. 2017~2018 빌드 기준이므로 결론에 쓰지 않는다 |

미실행 항목: `PRAGMA compile_options`와 FTS5 가상 테이블 생성 테스트는 실행하지 않았다. 지시에 따라 문서와 소스만 확인했다.

## 3. 조사 결과

### 3.1 Linux·Windows 정적 링크 빌드의 FTS5 (소스로 확인)

Bun 1.4.3 태그의 빌드 정의:

| 항목 | 값 | 근거 |
|---|---|---|
| 정적 링크 게이트 | `enabled: cfg => cfg.staticSqlite` | `scripts/build/deps/sqlite.ts:21` |
| 정적 링크 기본값 | `staticSqlite = partial.staticSqlite ?? !darwin` | `scripts/build/config.ts:1036` |
| FTS5 정의 | `SQLITE_ENABLE_FTS5: 1` | `scripts/build/deps/sqlite.ts:38` |
| 플랫폼 조건 | defines 블록에는 없음. Windows에서만 cflags `/MT`, `/U_DLL` 추가 | `scripts/build/deps/sqlite.ts:58` |
| 번들 SQLite 버전 | `3.53.4` | `src/jsc/bindings/sqlite/sqlite3.c:472` |
| 빌드 주석 | "Built when staticSqlite is true (the Linux/Windows default)." | `scripts/build/deps/sqlite.ts:7` |

- 문서 `docs/runtime/sqlite.mdx:227`(1.4.3): "Linux and Windows: Bun statically links its own SQLite build, which follows upstream defaults."
- 주의: "upstream defaults"는 FTS5 포함을 보장하지 않는다. SQLite 공식 문서에 따르면 소스 트리 configure는 FTS5를 기본으로 끈다(§3.3). Linux·Windows에서 FTS5가 포함되는 근거는 `SQLITE_ENABLE_FTS5: 1` 정의다. stack-status §7-D의 "FTS5 포함 여부 [미확인]"은 이 소스로 해소된다.
- Windows는 같은 defines를 쓴다. Windows 산출물의 실제 동작은 [미확인]이다.
- `bun build --compile` 산출물: stack-status §7-C는 산출물에 Bun 런타임 사본이 들어간다고 적는다. 같은 SQLite가 산출물에 들어간다는 것은 [가정]이다. 산출물 검증은 [미확인]이다.
- [가정] 배포 바이너리는 태그 소스와 같은 빌드 정의로 만들어진다.

### 3.2 macOS: `setCustomSQLite` 절차 (절차는 소스로 확인, FTS5 포함 여부는 [미확인])

절차 (`docs/runtime/sqlite.mdx:641–646`, 1.4.3):

1. `Database.setCustomSQLite(path)`를 Database 인스턴스를 만들기 전에 호출한다.
2. `path`는 `.dylib` 파일 경로다. 실행 파일 경로가 아니다.
3. 예시 경로: `/opt/homebrew/Cellar/sqlite/<version>/libsqlite3.dylib`(Homebrew).

소스 동작 (`src/jsc/bindings/sqlite/JSSQLStatement.cpp`, 1.4.3):

- 1202행: `jsSQLStatementSetCustomSQLite` 시작.
- 1225행 이후 LAZY 분기: 1242행에서 경로를 저장하고, 1244행에서 `lazyLoadSQLiteUnlocked`로 dlopen한다.
- 1235–1236행: 라이브러리가 이미 로드된 상태에서 경로가 다르면 "SQLite already loaded" 오류를 던진다. 같은 경로이면 허용한다. 문서 `sqlite.mdx:652`("Bun rejects a different path after SQLite loads")와 일치한다.
- 1802–1806행(`jsSQLStatementOpenStatementFunction`, 1779행 함수 안): LAZY 빌드에서 `lazyLoadSQLite`를 호출한다. 경로를 따로 지정하지 않으면 기본값 `libsqlite3.dylib`을 쓴다. 기본값은 `src/jsc/bindings/sqlite/lazy_sqlite3.h:331`에 있다.
- 결과: 커스텀 경로를 지정하기 전에 Database를 한 번이라도 열면 기본 시스템 라이브러리가 고정된다. 이후 `setCustomSQLite(다른 경로)`는 1235행 오류를 낸다. 시작 순서가 이 제약을 따라야 한다.
- 반환값: 1253–1255행은 LAZY 여부와 관계없이 `Bun__initializeSQLite()` 뒤에 `jsBoolean(true)`를 반환한다. 비-macOS 빌드에서는 no-op이고 반환값은 `true`다.
  - 문서 차이: bun.com 문서와 main 브랜치 문서는 비-macOS에서 `false`를 반환한다고 적는다. 1.4.3 태그 문서(`sqlite.mdx:641`)는 "this is a no-op"만 적는다. stack-status §7-D의 `false` 기술은 1.4.3 소스와 맞지 않는다. main 브랜치 동작은 [미확인]이다.
- 플랫폼 게이트: `scripts/build/config.ts:1036`에 따라 darwin 타깃은 `staticSqlite = false`다. 같은 파일 1032–1034행 주석에 따르면 macOS에서는 `bun:sqlite`와 `node:sqlite`가 시스템 라이브러리를 공유한다. `scripts/build/deps/sqlite.ts:7–12` 주석은 Apple 빌드가 `load_extension`, percentile(), geopoly, rbu를 생략한다고 적는다.
- 손상 주의: 같은 파일 1033–1034행 주석은 "one library, one POSIX-lock inode map"을 이유로 든다. 근거로 SQLite의 howtocorrupt 문서 §2.2.1을 인용한다. 이 원문은 확인하지 못했다([미확인]).

FTS5 포함 여부(dylib 쪽):

- Homebrew 포뮬러 `Formula/s/sqlite.rb:47`: `-DSQLITE_ENABLE_FTS5=1`(CPPFLAGS). 같은 파일 `:28`은 `keg_only :provided_by_macos`다. 따라서 Homebrew sqlite는 FTS5를 포함하고, 기본 링크 경로 밖에 설치된다. 포뮬러 버전과 설치된 실제 dylib은 [미확인]이다.
- Apple 시스템 `libsqlite3.dylib`의 FTS5 포함 여부는 [미확인]이다. 2차 자료인 PSPDFKit 가이드는 3.18과 3.24 Apple 빌드에 FTS5가 있다고 적는다. 이 자료는 현행 macOS에 적용하지 못한다.
- Intel Mac의 경로와 Homebrew 외 설치 경로는 [미확인]이다.

### 3.3 SQLite 공식 문서의 FTS5 빌드 규칙 (요약 경유)

- `https://sqlite.org/fts5.html`: "As of version 3.9.0 (2015-10-14), FTS5 is included as part of the SQLite amalgamation." 소스 트리 configure는 FTS5를 기본으로 끄고, amalgamation configure는 기본으로 켠다고 적는다. 다른 빌드 시스템에서는 `SQLITE_ENABLE_FTS5` 전처리기 심볼을 정의해야 한다. 이 페이지는 빌드에 FTS5가 있는지 확인하는 방법을 적지 않는다.
- `https://sqlite.org/pragma.html`: 컴파일 옵션 이름에서 `SQLITE_` 접두사를 뺀다. 예를 들어 `ENABLE_FTS5`로 나온다.
- `https://sqlite.org/c3ref/compileoption_get.html`: `sqlite3_compileoption_used()`는 인자에서 `SQLITE_` 접두사를 생략할 수 있다.

### 3.4 설계에 걸리는 점 (ADR-0001, ADR-0004)

- [결정] `decisions-log.md`(2026-10-19 설계 규칙): OS별 차이는 공통 인터페이스 뒤의 구현으로 둔다. 소비자 코드에 OS 분기를 두지 않는다. 따라서 dylib 경로 결정과 `setCustomSQLite` 호출은 L0 `platform-store` 안에 둔다.
- [제안] 시작 시 검사 순서:
  1. 플랫폼별 dylib 경로 결정. macOS에서만 커스텀 경로를 쓴다.
  2. `Database.setCustomSQLite(path)`를 호출한다. 반환값은 판별에 쓰지 않는다.
  3. 임시 in-memory DB를 열고 `CREATE VIRTUAL TABLE temp.<접두사>_probe USING fts5(x)`를 실행한 뒤 닫는다. 이 탐침이 FTS5 가용성의 기준이다.
  4. 진단용으로 `PRAGMA compile_options`에서 `ENABLE_FTS5`를 찾아 기록한다.
- [제안] 탐침을 기준으로 삼는 이유: 옵션 목록은 빌드 정보만 보여준다. 실제 기능 여부는 탐침으로 확인하는 편이 직접적이다.
- [제안] 단일 SQLite 로드 원칙: 프로세스 안에서 `bun:sqlite` 외 다른 SQLite 로더를 쓰지 않는다. `node:sqlite`는 같은 핸들을 공유한다. 근거는 main 브랜치 `sqlite.ts` 주석과 `src/jsc/bindings/sqlite/lazy_sqlite3.h` 주석(검색 결과 인용, 1.4.3 원문 미확인)이다. 손상 위험을 막는 장치다.
- [제안] 반환값 판별 금지: `setCustomSQLite`의 `true`/`false`에 기대지 않는다. 플랫폼 판별은 L0 구현 안에서 처리한다.

## 4. 미확인 항목

1. 배포된 Bun 1.4.3 바이너리(Linux x64·arm64, Windows)의 `PRAGMA compile_options`와 FTS5 테이블 생성 결과. 코드를 실행하지 않아 확인하지 못했다.
2. Windows 산출물의 실제 FTS5 동작.
3. `bun build --compile` 산출물의 SQLite 정의 상속. 추론만 있고 검증하지 않았다.
4. Apple 시스템 `libsqlite3.dylib`(현행 macOS)의 FTS5 포함 여부. 2차 자료뿐이다.
5. Homebrew sqlite 포뮬러 버전과 Intel Mac, Homebrew 외 경로.
6. Bun main 브랜치의 `setCustomSQLite` 반환값. 문서는 `false`, 1.4.3 소스는 `true`다.
7. SQLite howtocorrupt §2.2.1 원문.
8. stack-status §7-D의 "false 반환" 기술 정정. 정정은 메인 조정 몫이다. 이 노트는 정정하지 않는다.

## 5. 근거 목록

- Bun 1.4.3 소스 (태그 `bun-v1.4.3`): `scripts/build/deps/sqlite.ts:7, 21, 38, 58`; `scripts/build/config.ts:1032–1036`; `src/jsc/bindings/sqlite/sqlite3.c:472`; `src/jsc/bindings/sqlite/JSSQLStatement.cpp:1202, 1235–1236, 1242, 1244, 1253–1255, 1779, 1802–1806`; `src/jsc/bindings/sqlite/lazy_sqlite3.h:331, 355–363`
- Bun 1.4.3 문서: `docs/runtime/sqlite.mdx:227, 641–646, 652`
- Bun 공식 문서 (요약 경유): https://bun.com/docs/runtime/sqlite
- SQLite 공식 문서 (요약 경유): https://sqlite.org/fts5.html, https://sqlite.org/pragma.html, https://sqlite.org/c3ref/compileoption_get.html
- Homebrew 포뮬러 (master): https://raw.githubusercontent.com/Homebrew/homebrew-core/master/Formula/s/sqlite.rb (`:28`, `:47`)
- 2차 자료: PSPDFKit 커스텀 SQLite 가이드 (Apple 빌드 FTS5 표). 결론에 쓰지 않는다.
- 저장소 내부: `docs/xeon/_research/foundation-plan.md §2, §7`; `docs/xeon/_research/decisions-log.md` (2026-10-19 설계 규칙); `docs/xeon/_research/stack-status.md §7-C, §7-D`

## 미결 사항

- [미결] macOS에서 FTS5 포함 dylib을 찾지 못할 때의 처리. 시작을 중단할지, FTS5 기능만 끄고 시작할지 정한다. 사용자 확인이 필요하다.
- [미결] dylib 경로 지정 방식. Homebrew 경로 규칙으로 자동 탐색할지, 설정 키로 받을지 정한다. 설정 키라면 L4 노출 여부도 정한다.
- [미결] macOS 시스템 라이브러리의 FTS5 포함 여부 실측. 실측은 macOS 실행 환경이 필요하다. 구현 작업자가 수행한다.
