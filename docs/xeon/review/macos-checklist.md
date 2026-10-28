---
id: review.macos-checklist
layer: meta
domain: review
kind: review
status: draft
depends_on: [product.scope.spec, review.m2-plan, review.fake-only]
binds: []
---

# macOS 확인 목록

## 1. 목적과 읽는 법

- macOS 우선 지원(`product.scope.spec` §4.7, 결정 D-d)의 M2 증거를 한 문서에 모읍니다. 마일스톤 재점검 G4-02의 산출물입니다.
- 확인 수단은 두 가지입니다.
  - CI: `.github/workflows/xeon-macos.yml`. `workflow_dispatch`나 PR 라벨 `ci:macos`로만 돕니다(결정 D1). 러너는 `macos-15`(Apple Silicon)입니다.
  - 실기: 사용자 Mac. Mac은 하루 몇 시간만 켜져 있으므로 `ws mac up`으로 확인하고, 꺼져 있으면 `ws mac queue add`로 넣습니다. 실행은 `ws on --detach mac -- just <레시피>`입니다(mac 스킬).
- 결과 열에는 날짜, 수단(CI 실행 번호 또는 `ws mac jobs <번호>`), 실측 값을 적습니다. 비어 있으면 아직 확인하지 않은 것이고, "미실행"은 마감 재검토에서 사람 손이나 권한이 필요해 남긴 것으로 표시한 항목입니다.
- 실기 작업 번호는 `ws mac jobs <번호>`로 마지막 로그를 볼 수 있고, 전체 로그는 동기화된 `~/projects/.ws-jobs/<번호>/log`에 있습니다.

## 2. Mac 실기 환경 (2026-10-25)

사용자가 Mac 부트스트랩을 끝내고 결과를 전했습니다.

| 항목 | 상태 |
|---|---|
| 툴체인 | Rust 1.99.1(`aarch64-apple-darwin`, `x86_64-apple-darwin` 대상 설치), bun 1.4.3(mise) |
| 부트스트랩 | 완료. doctor의 남은 항목: `claude-code` 미설치, agent-kit 스킬 링크 실패, opencloud 미설치(모두 ENV·INFO) |
| GUI 권한 | 화면 기록, 손쉬운 사용 권한 없음. 자동으로 주지 않습니다. WKWebView 스크린샷과 IME 자동 입력이 필요하면 사람이 시스템 설정에서 고릅니다 |
| Docker | 선택. 설치하지 않았습니다(SearXNG 수동 스모크에만 필요) |

## 3. 확인 목록

| # | 항목 | 이어지는 것 | 수단 | 기대 | 결과 |
|---|---|---|---|---|---|
| M-01 | `bun:sqlite`의 FTS5 trigram 탐침, `Database.setCustomSQLite` 경로, `fullfsync`, 세션 잠금 | R2, TC-11, FK-06 | CI `platform-store` 단계, 실기 `just test packages/platform-store` | 시험 통과, 탐침이 FTS5 있음 | 통과(실기, 2026-10-25, `m2c/mac` 기준). 시스템 SQLite 3.51.0에서 FTS5 trigram 탐침이 성공해 동봉 dylib이 필요 없습니다. 동시 첫 열기 경합을 `3aae85e`에서 고친 뒤 10회 연속 종료코드 0입니다(작업 20261025-232814-7624). 건너뜀 2건과 경과는 §4.2에 있습니다 |
| M-02 | 한글 NFD 파일 이름과 경로 정규화 | FK-07 | CI `platform-os` 단계 | 시험 통과 | 통과(실기, 2026-10-25, `m2c/mac` 기준, 작업 20261025-223149-7bc2). `platform-os` 219 통과, 0 실패. 같은 작업의 `platform-exec`는 218 통과, 1 건너뜀, 0 실패입니다(`pwd -P` 기대 경로를 realpath로 비교하도록 `9d15a06`에서 고친 뒤) |
| M-03 | Seatbelt 샌드박스에서 작업 폴더 밖 쓰기 거부, 자가 시험 6항목 | M1, FK-01, FK-02, T-02 | CI `platform-sandbox`와 `exit-tests` 단계 | int 시험 통과, 건너뜀 0 | 실기 통과, CI 미실행(2026-10-25, 작업 20261025-202916-7042, 메인 checkout, 커밋 미기록). `just test packages/platform-sandbox` 131 통과, 0 건너뜀입니다. 그중 `sandbox.int.test.ts`의 `real sandbox (srt)` 8건이 실제 srt(macOS Seatbelt)로 돌았습니다: 작업 폴더 밖 쓰기 거부, `.git/hooks` 쓰기 거부, 보호 파일 읽기 거부, 네트워크 거부, 자가 시험 6항목. `exit-tests`의 건너뜀 0 검사와 CI 단계는 돌지 않았습니다 |
| M-04 | 실제 sops로 비밀 관리 명령(E7) | E7, FK-05 | CI `platform-secrets`와 `exit-tests` 단계 | 시험 통과, 건너뜀 0 | |
| M-05 | 키체인 age 키, `reveal`의 `os-auth`(Touch ID·암호) | E7, FK-04, T-06 | 실기만(CI 러너는 사람 인증 불가) | 재인증 성공 뒤에만 값 표시, 취소하면 값 없음 | 미실행 |
| M-06 | FTS5 검색(cap-knowledge) | FK-06 | CI `cap-knowledge` 단계 | 시험 통과 | |
| M-07 | 사이드카 `aarch64-apple-darwin` 빌드와 크기, 콜드 스타트 | ADR-0012, FK-14 | CI 사이드카 단계, 실기 `just bench` | 빌드 성공, 500 MiB 이하, 콜드 스타트 기록 | 부분(실기, 2026-10-25, 작업 20261025-224508-0141, 병합 전 `m2c/t7` 워크트리). `just desktop-sidecar host` 성공, 91.0 MiB(95,432,306바이트) / 500 MiB. 이 바이너리로 `just test apps/desktop`이 178 통과, 0 건너뜀입니다. 사이드카 e2e 3건(E2 응답열 동등, E3 stdin EOF 종료, E3 `host.shutdown`)이 macOS 컴파일 바이너리에서 돌았습니다. 콜드 스타트(`just bench`)와 CI 사이드카 단계는 미측정입니다 |
| M-08 | Tauri 셸 Rust 시험 | E3, FK-15 | CI `desktop-test` 단계 | 시험 통과 | 통과(실기, 2026-10-25, 작업 20261025-224508-0141, `m2c/t7` 워크트리). `just desktop-test` 65 통과, 0 실패. CI 단계는 미실행입니다 |
| M-09 | 데스크톱 프리뷰 실행: 한 턴, 정상 종료 뒤 사이드카 프로세스 없음 | E2, E3, FK-15 | 실기 `just desktop-run` 뒤 `pgrep xeon` | 종료 10초 뒤 사이드카 0개 | 통과(2026-10-28). `gd` 한 턴에 답 1개, Cmd+Q 종료 뒤 `pgrep -fl xeon` 결과 없음(앱과 사이드카 모두). 디버그 점검 소켓 파일 `inspect.sock`은 남지만 다음 실행이 교체합니다(`inspect/server.rs` 시험) |
| M-10 | WKWebView 렌더링과 입력, 뷰포트 스냅샷(`snapshot_macos.rs`) | FK-16, T-11 | 실기(화면 기록 권한 필요) | 트랜스크립트, 승인 카드, 설정 화면이 보임. 스냅샷 파일이 생김 | 통과(실기, 2026-10-27, `xeon/foundation` `c8afa8b`, 사이드카는 작업 20261026-230909-2d87에서 빌드). 디버그 점검 소켓(`~/Library/Logs/dev.helm.xeon/inspect.sock`)의 `state.dump`가 엔진 running(sidecar), relay epoch 1, 창 2200x1520, 배율 2.0을 돌려줬습니다. `viewport.snapshot`이 149,448바이트 PNG(2200x1520)를 썼고, 대화 목록과 트랜스크립트(사용자 "gd"와 어시스턴트 답)가 보입니다. 설정 화면은 사용자 스크린샷 글자로 확인했습니다. 승인 카드는 그 턴에 도구 호출이 없어 확인하지 못했습니다 |
| M-11 | 한글 IME 조합(입력창, 설정 화면) | G2-13, FK-16 | 실기, 사람 입력 | 조합 중 Enter가 전송되지 않음, 글자 깨짐 없음 | 통과(실기, 사람 입력, 2026-10-27, `c8afa8b`). WebKit은 Enter `keydown`(keyCode 229)보다 `compositionend`를 먼저 보냅니다. `0338353`에서 `isComposing`, keyCode 229, 조합 끝 뒤 50 ms 유예로 막은 뒤 조합 중 Enter가 전송되지 않고 중복 전송도 없습니다 |
| M-12 | 데스크톱 첫 실행: 키 등록, 모델 선택, 첫 실행 안내, 외부 바이너리 점검 결과 | D-b, G2-07, G2-08 | 실기 | 깨끗한 상태 디렉터리에서 첫 대화까지 감 | 통과(실기, 2026-10-27, `c8afa8b`). 빈 상태에서 dotfiles로 CLI와 sops를 설치하고, 기본 SOPS 파일이 자동으로 생겼습니다. 데스크톱에서 키를 등록했고(`secret ls`에서 `anthropic-api-key` valid), provider를 연결하고, 기본 모델 `anthropic/claude-sonnet-5-5`를 저장한 뒤 첫 대화가 답을 받았습니다. 점 표기 id `anthropic/claude-sonnet-5.5`는 저장할 때 "알 수 없는 모델 … (anthropic의 모델: …)"로 거절됩니다(HS-78, `7683dc6`). 키체인 접근 확인 창은 뜨지 않았습니다. 이 회차에 고친 커밋: `48e99d9`, `2b76551`, `dc2d37c`, `5735f75`, `48df802`, `3f8a8ff`, `0338353`, `59d468b`, `6da37f1`, `a497c46`, `154b03f`, `7683dc6`, `c8afa8b`. 남은 일은 `review.m3-plan` M3-m2c-02, M3-m2c-04에 있습니다 |
| M-13 | 데스크톱 단일 실행: 앱 프로세스 두 개 | G2-09 | 실기, 앱을 두 번 실행 | 두 번째 실행이 첫 창을 앞으로 가져오고 스스로 끝남. 사이드카는 하나 | 통과(실기, 2026-10-27 회차). 두 번째 실행이 첫 창을 앞으로 가져오고 끝났으며 사이드카는 하나였습니다 |

## 4. macOS 실측 기록 (2026-10-25)

### 4.1 환경 사실

- 기기: macOS 26.5.2(빌드 25F84), Apple silicon, Bun 1.4.3.
- 시스템 SQLite 3.51.0이고 FTS5 trigram 가상 테이블 생성이 성공합니다. Homebrew SQLite(`/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib`)는 있지만 자동으로 쓰지 않습니다(`L0.store.spec` §4.1).
- `Database.setCustomSQLite("/nonexistent/…")`는 macOS에서 dlopen 오류를 던집니다. Linux에서는 `true`를 돌려줍니다.
- `/usr/lib/libSystem.B.dylib`는 디스크에 없지만 `dlopen("libSystem.B.dylib")`로 `flock`과 `__error`를 쓸 수 있습니다(dyld 공유 캐시).
- 첫 실행의 실패 원인: 없는 커스텀 dylib은 `sqlite_load_failed`로 돌려주고(`L0.store.spec` §4.1), 가짜 Linux 시험이 실제 dlopen을 불러 `process_only` 경고를 내던 것은 `OsRuntime.createFlock` 주입으로 고쳤습니다.
- 임시 디렉터리는 `/var/folders/…`이고 realpath는 `/private/var/folders/…`입니다. `pwd -P`와 저장소 스냅샷 경로는 realpath를 돌려주므로 시험은 기대 경로를 `realpathSync`로 비교합니다.

### 4.2 실행 경과

| 작업 | 위치 | 명령 | 결과 |
|---|---|---|---|
| 20261025-202916-7042(안의 194109) | 메인 checkout | `platform-store`·`platform-os`·`platform-sandbox`·`platform-exec`의 `just test`, `just desktop-test` | store 2 실패, os 1 실패, sandbox 131 통과(실제 srt 8건 포함, M-03), exec 2 실패, Rust 54 통과. 실패는 macOS 차이(커스텀 dylib 오류, realpath, 가짜 Linux 시험의 실제 dlopen)였고 `m2c/mac`에서 고쳤습니다(`1a1ac35`, `9d15a06`, `8248af7`) |
| 20261025-223149-7bc2 | `m2c/mac` | store·os·exec의 `just test` | store 215 통과, 2 건너뜀, 1 실패(동시 첫 열기). os 219 통과. exec 218 통과, 1 건너뜀 |
| 20261025-224546-05fe | `m2c/mac` | store `just test` 5회 | 4회 통과(217 통과, 2 건너뜀), 1회 실패. 동시 첫 열기 스냅샷 경합으로 `f659901`, `3aae85e`에서 고쳤습니다 |
| 20261025-224508-0141 | `m2c/t7` | `just test apps/desktop`, `just desktop-test`, `just desktop-sidecar host`, 다시 `just test apps/desktop` | 175 통과·3 건너뜀(사이드카 없음), Rust 65 통과, 사이드카 91.0 MiB, 178 통과·0 건너뜀(사이드카 있음) |
| 20261025-232814-7624 | `m2c/mac` | store `just test` 10회 | 10회 모두 종료코드 0입니다. 작업 상태가 `failed 1`인 것은 반복문 마지막 `[ $r -ne 0 ] && …`의 값이고 시험 실패가 아닙니다 |

- `platform-store`의 macOS 건너뜀 2건은 `two processes and one session > a stopped owner that wakes up after takeover is fenced`와 `posix flock provider > lock fd is close-on-exec`입니다. 세션 잠금의 펜싱 경로는 macOS에서 확인하지 않았습니다.
- `m2c/mac`(`1a1ac35`~`3aae85e`)은 이 기록 시점에 `xeon/foundation`에 병합되지 않았습니다. M-01, M-02의 "통과"는 그 브랜치 기준입니다.

## 5. 미결 사항

- [미결] M-05는 사람이 직접 해야 합니다. macOS `os-auth`(Touch ID)는 구현되지 않았습니다(`osAuthAvailable` 기본값 false). E7의 macOS 부분과 함께 M3로 옮깁니다(`review.m3-plan` M3-m2c-01). M-10, M-11, M-13은 2026-10-27에 끝났습니다.
- [미결] M-10의 승인 카드는 확인하지 못했습니다. 도구 호출이 있는 턴으로 다시 봅니다.
- [미결] CI 수단은 하나도 돌지 않았습니다. GitHub macOS 수동 job(`xeon-macos.yml`)을 한 번 돌려 M-03의 `exit-tests` 부분, M-04, M-06과 각 행의 CI 결과를 채웁니다(`review.m2-plan` §11 4번).
- [미결] M-07은 macOS 콜드 스타트 기록을 요구합니다. 2026-10-27의 `just bench` 기준선(`eng.performance.guide` §2)은 서버(WSL2)에서 잰 값이라 M-07을 채우지 않습니다. Mac에서 `just bench`를 한 번 돌려야 합니다.
