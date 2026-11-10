---
id: eng.performance.guide
layer: eng
domain: performance
kind: guide
status: draft
depends_on: [adr.0012, eng.toolchain.guide]
binds: []
---

# 성능 예산과 측정

## 1. 적용 범위

- 사용자가 체감하는 속도(시작, 첫 응답, 종료)의 예산과 측정 방법을 정합니다. 근거 결정은 ADR-0012(속도를 앱 크기보다 우선)입니다.
- 마일스톤 재점검 G2-04의 산출물입니다. M2는 기준선을 재고 예산표의 틀을 둡니다. M3에서 예산을 넘으면 실패하는 게이트로 바꿉니다(`review.m3-plan`).
- 데스크톱 속도·크기는 `just desktop-benchmark`(§2.2)입니다. 측정 레시피는 `just benchmark`(`xeon/scripts/benchmark.ts`)입니다. 서버 측정은 `just benchmark --server`, 예산 판정은 `just benchmark-gate`입니다. 둘 다 메모리 상한(`scripts/guard.sh run`) 아래에서 돌고 `just verify`에는 들어가지 않습니다.

## 2. 예산표

| 지표 | 뜻 | 측정 | 기준선 | 예산 | 비고 |
|---|---|---|---|---|---|
| `cold_start_cli` | `bun apps/cli/src/main.ts version --json` 시작부터 종료까지 | `just benchmark` | WSL2 중앙값 143.6 ms(3회, 2026-10-25). 서버(WSL2) 중앙값 189.8 ms(2026-10-27) | 기록만 [결정: 2026-11-04 사용자, B17] | 번들 전 소스 진입. 모듈 적재 비용을 봅니다 |
| `cold_start_sidecar` | 컴파일한 사이드카 `fresnel-<triple> version --json` 시작부터 종료까지 | `just desktop-sidecar host` 뒤 `just benchmark` | WSL2 약 131 ms(`--bytecode`, `L4.desktop.plan` §3 spike S2). 서버(WSL2) 중앙값 46.9 ms(2026-10-27) | 기록만 [결정: 2026-11-04 사용자, B17] | macOS 값은 `review.macos-checklist` M-07 |
| `first_token` | `fresnel chat -p` 시작부터 첫 `stream.chunk` 알림까지 | `just benchmark --first-token --yes` | 서버(WSL2) 1289.5 ms(1회, 실제 provider, 2026-10-27) | 기록만 [결정: 2026-11-04 사용자, B17] | 실제 모델 호출. 사용자 확인 뒤 1회(결정 D-e) |
| 사이드카 크기 | triple별 바이너리 크기 | `just desktop-sidecar <triple>` | WSL2 `x86_64-unknown-linux-gnu` 109.8 MiB(T7, `L4.desktop.plan` 구현 기록), macOS 26.5.2 `aarch64-apple-darwin` 91.0 MiB(`ws mac` 작업 20261025-224508-0141) | 500 MiB(회귀 상한) | ADR-0012 §3 2번. 줄이는 목표가 아닙니다. macOS 값은 `review.macos-checklist` M-07 |

- 2026-10-27 값은 M2 마감 절차(`review.m2-plan` §11 5번)의 `just benchmark`와 `just benchmark --first-token --yes` 결과입니다. 콜드 스타트 두 지표의 실행 횟수는 기록하지 않았습니다(기본값 5회 [가정]). macOS 값은 아직 없습니다.
- 예산 열은 아직 비워 두고 M3에서 정합니다(`review.m3-plan` M3-29). 예산 열의 숫자는 기준선을 본 뒤 사용자가 정합니다. 정하면 `xeon/scripts/benchmark.ts`의 `BUDGET_MS`를 같은 커밋에서 고칩니다.
- `just benchmark`는 지표마다 최소, 중앙값, p90, 최대와 예산 판정(`no budget`, `within`, `over`)을 출력합니다.

## 2.1 서버 측정표

`just benchmark --server`(`xeon/scripts/benchmark-server.ts`)가 패키지 안의 측정 진입(`<패키지>/test/benchmark/*.benchmark.ts`)을 차례로 돌립니다. 진입은 줄마다 JSON 한 개를 출력합니다. 값은 WSL2(Linux 6.18, 12 CPU, 디스크 ext4) 2026-10-29, 다른 에이전트가 함께 돌던 기기 부하(load average 9~16)에서 잰 것입니다. 부하 때문에 꼬리 값(p90, 최대)은 흔들리고 기준선이 아닙니다. 예산 칸은 모두 "기록만"입니다 [결정: 2026-11-04 사용자, B17]. 예산을 정하면 `benchmark-server.ts`의 `SERVER_BUDGET`을 같은 커밋에서 고칩니다(지금 코드는 모두 대기 상태이고 판정은 "기록됨"입니다).

| 지표 | 뜻 | 중앙값 | p90 | 판정 | 예산 | 근거 요구 |
|---|---|---|---|---|---|---|
| `index_build_200_skills` | 스킬 200개로 인덱스 블록 만들기(호출 1회) | 0.013 ms | 0.031 ms | 판정 대상 | 기록만 [결정: 2026-11-04 사용자, B17] | M3-REQ-98 |
| `like_scan_2char_20000_docs` | 2글자 질의의 대화 LIKE 탐색(문서 20,000개 전체 훑기) | 23~28 ms | 30 ms | 참고 | 없음 | M3-REQ-98 |
| `index_fit_<N>_skills` | 8,000자 예산에 실리는 스킬 수(설명 160자) | 33개(N≥40) | 해당 없음 | 참고 | 없음 | M3-REQ-98 |
| `index_fit_<N>_skills_desc60` | 같은 예산에 설명 60자일 때 | 57개(N≥80) | 해당 없음 | 참고 | 없음 | M3-REQ-98 |
| `lease_turn_overhead` | drive 락을 쓰는 그룹이 있을 때 turn당 추가 시간(메모리 호스트, 저장소 I/O 없음) | 0.017~0.022 ms | 0.07~0.08 ms | 판정 대상 | 기록만 [결정: 2026-11-04 사용자, B17] | M3-REQ-41 |
| `lease_records_per_turn` | turn당 추가 기록(`lease.acquired`·`lease.released`) | 0.667개 | 해당 없음 | 참고 | 없음 | M3-REQ-41 |
| `dispatch_overhead_per_handler` | 빈 tap 핸들러 하나를 예산 정책(`OperationsPolicy`)으로 돌린 시간 − 정책 없는 시간 | 0 ms(−0.004~0.000) | 0.013 ms | 판정 대상 | 기록만 [결정: 2026-11-04 사용자, B17] | M3-REQ-40 |
| `store_commit_event` | 사용자 item 이벤트 커밋 1건(`synchronous=FULL`, WAL, 디스크) | 5.4~7.0 ms | 12.7 ms | 판정 대상 | 기록만 [결정: 2026-11-04 사용자, B17] | M3-REQ-64, M3-29 |
| `thread_read_1k_items` | 활성 가지 item 1,000개 읽기(`readBranch`) | 5.6~6.1 ms | 8.4 ms | 판정 대상 | 기록만 [결정: 2026-11-04 사용자, B17] | M3-29 |
| `projector_rebuild_10k_events` | 코어 투영기 재생성(이벤트 10,000개) | 217~565 ms | 482~837 ms | 판정 대상 | 기록만 [결정: 2026-11-04 사용자, B17] | M3-new-18 |
| `projector_rebuild_events_per_sec` | 재생성 처리량 | 17,700~46,000 건/초 | 해당 없음 | 참고 | 없음 | M3-new-18 |
| `reinject_tokens_5_files_<크기>` | 컴팩션 뒤 최근 파일 5개 재주입의 추정 토큰(글자/3.5) | 2,000자 2,935 / 8,000자 11,510 / 16,000자 이상 22,935 | 해당 없음 | 참고 | 없음 | M3-new-18 |
| `recent_files_compute_2000_items` | 재주입 후보 계산(branch 2,000 item) | 0.026~0.046 ms | 0.05 ms | 참고 | 없음 | M3-new-18 |

기본값 판단은 이 표를 근거로 다음과 같이 둡니다.

- M3-REQ-40 핸들러 시간 예산(30·10·5·1·2·10·30초): 값을 유지합니다. 예산 정책의 실행 비용은 핸들러당 마이크로초 이하이고, 예산은 성능이 아니라 멈춘 핸들러를 끊는 정책입니다. 실제 확장 핸들러의 소요 시간은 아직 모을 데이터가 없습니다(빈 핸들러만 잼). 예산 값 자체는 사용자 결정입니다.
- M3-REQ-41 탐구 없는 turn의 drive 락 비용: 행을 닫습니다. drive 락 부여와 반납은 3 turn에 기록 2개(0.667개/turn)입니다. 기록 1개의 커밋이 5.4~7.0 ms이므로 turn당 약 3.6~4.7 ms이고, 첫 토큰 1,289.5 ms(§2)의 0.4% 이하입니다. 후보 제외 조건을 두지 않습니다. 근거 한계: 커밋 시간은 사용자 item 커밋으로 대신 쟀습니다(drive 락 기록 커밋을 따로 재지 않음).
- M3-REQ-98 인덱스 예산(8,000자), 설명 자르기(160자), LIKE 탐색 범위(20,000): 값을 유지합니다. 만드는 시간은 0.013 ms이고 8,000자는 약 2.3k 토큰이며 매 요청에 고정으로 들어갑니다. 160자 설명이면 33개, 60자면 57개가 실립니다. 2글자 질의 LIKE는 20,000문서를 다 훑어도 23~28 ms입니다. 스킬이 33개를 넘는 사용자는 `knowledge_search`로 찾는 경로를 씁니다(`L2.knowledge.spec`).
- 컴팩션 뒤 최근 파일 재주입(기본 5개): 개수를 유지합니다 [결정: 오케스트레이터 기본값]. 파일마다 상한 16,000자라 최악은 22,935 토큰으로 `keepRecentTokens`(20,000)의 115%, 200k 창의 11.5%입니다. 8,000자 파일이면 11,510 토큰입니다. 파일당 상한을 8,000자로 낮추면 최악이 약 11.5k 토큰이 되지만 큰 소스 파일이 잘립니다. 상한을 낮출지, 재주입을 `keepRecentTokens`에 포함할지는 [미결] 사용자 결정입니다.
- 투영기 청크 재생성 기준(이벤트 10만 건): 값을 유지합니다. 10,000건이 0.2~0.6초이므로 10만 건은 약 2~6초(선형 외삽)입니다. 쓰기 열기를 막는 시간으로 보면 수 초 수준이라 기준을 올릴 이유가 없습니다.
- M3-REQ-87 게이트 상한(8)과 반복 감지 임계(4, 3): 게이트 상한 8은 유지합니다. 반복 감지(`l1.loop.repeat.*`)는 M3b B5-FIX2에서 구현했고(`xeon/packages/core-loop/src/repeat.ts`, 합성 테이프 값 시험 `test/repeat.test.ts`, `test/loop-repeat.test.ts`) 기본 임계는 4와 3입니다. 임계를 실제 모델 행동에 맞춰 조정하는 일은 실제 provider 녹화(`just tape-record`, 비용이 들어 사람 확인 `--yes`)가 먼저입니다. [미결]
- M3-REQ-64 서버 측정: 커밋·읽기 기준선만 기록합니다. `synchronous=NORMAL` 비교, 프로세스 시작 지문 시간은 쓰기 연결을 시험에서 바꿀 길이 없어(platform-store 시험 훅 필요) 재지 못했습니다. macOS `fullfsync` 기본값과 지문 수단은 사용자 묶음입니다(아래 §5).

## 2.2 데스크톱 측정표 (Y17)

`just desktop-benchmark <size|startup|frame|trace|all>`(`xeon/scripts/desktop-benchmark.ts`)가 쟀습니다. 실제 모델 호출은 없습니다. 기기: Apple M1 Pro, 메모리 32 GB, macOS 26.5.2(arm64), 2026-11-04. **측정 중 load average가 약 625(1분)였습니다.** 다른 worktree의 작업이 함께 돌아 시간 값은 기준선이 아니라 참고입니다. 예산 칸은 모두 기록만입니다 [결정: 2026-11-04 사용자, B17]. 값을 줄이는 일이 목표가 아닙니다(ADR-0012).

| 지표 | 뜻 | 값 | 못 잰 부분 |
|---|---|---|---|
| `app_size_mib` | 릴리즈 앱 크기: 셸 바이너리 + 번들 사이드카(`just desktop-build`, `just desktop-sidecar host`) | 109.3 MiB(셸 13.6 + 사이드카 95.8, 화면 번들 3 MiB는 셸 안). 상한 500 MiB 이내 | `.app`·설치 파일은 만들지 않아 못 잼(맨 바이너리 합) |
| `first_screen_ms` | 프로세스 시작부터 앱 창이 비지 않게 그려진 첫 화면까지(창 스크린샷이 10만 바이트 이상) | 중앙값 6,653 ms. 5회 6,653 / 9,355 / 5,101 / 5,380 / 11,343 ms. 창이 화면에 뜨기까지 중앙값 2,704 ms. 해상도 약 300 ms | 깨끗한 홈(모델 키 없음)이라 "설정 필요" 첫 화면입니다. 부하가 커서 흔들림이 큽니다. 앱 안의 그리기 완료 표식이 없어 스크린샷으로 대신했습니다 |
| `idle_rss_mib` | 첫 화면 10초 뒤 유휴 메모리: 셸 + 엔진(사이드카) + 이번 실행 중 새로 생긴 WebKit 도우미 프로세스의 상주 메모리 합 | 3회 중앙값 219.9 MiB(셸 78.7, 엔진 81.8, WebKit 57.3), 5회 중앙값 338.7 MiB | 같은 시간에 다른 앱이 띄운 WebKit 프로세스가 섞여 WebKit 몫이 흔들립니다. 셸과 엔진 값(약 79, 약 82 MiB)이 믿을 만합니다. 공유 페이지를 프로세스마다 세어 실제보다 큽니다 |
| `orbit_frame_cpu_ms` | 크래프트 지도 한 장의 계산 시간(배치, 밝힘, 보일 것 고르기), 확장 77개 고정 데이터(`buildFixture(77)`), 2,000장 | p50 0.019 ms, p95 0.033 ms, 최대 393.6 ms(한 번의 튀는 값: 적재·GC나 부하) | **실제 프레임 시간은 못 잼.** WebGL 배경, DOM 그리기, 합성은 창 안에서 77개 데이터를 띄울 길이 없어 재지 못했습니다. 위 값은 한 프레임 예산(16.7 ms) 중 계산 몫의 하한입니다 |
| 계측 켬·끔 Turn 비용 | 한 Turn(시작부터 `turn.completed`)의 시간, 모델 테이프(즉답), 기본 그룹, Turn 30개 × 5라운드 | 아래 표 | 모델 시간이 0에 가까워 비중의 상한에 가깝습니다 |

| 조건(`x.operations.trace`) | Turn p50 | Turn p95 | 힙 증가(평균, 30 Turn) | p50 차이(끔 대비) |
|---|---|---|---|---|
| 끔 | 36.2 ms | 111.0 ms | 3.54 MB | 기준 |
| 켬, thread당 8 Turn | 35.6 ms | 111.8 ms | 2.36 MB | −1.8% |
| 켬, 20 Turn(기본값) | 36.6 ms | 96.0 ms | 1.92 MB | +0.9% |
| 켬, 200 Turn(상한) | 37.3 ms | 109.0 ms | 2.47 MB | +2.9% |

- 이전 값(끔 45.8 ms, 8 Turn +1.0%, 20 +1.3%, 200 +1.9%, p50, 힙 미측정)과 방향이 같습니다: 켬 비용은 한 자리 퍼센트 이하이고 조건 사이 차이가 라운드 사이 흔들림 안에 듭니다. 힙은 조건 순서와 맞지 않습니다(끔이 가장 큼). 이 크기에서는 계측의 메모리 비용을 가려낼 수 없고, 값은 GC 시점과 부하에 좌우됩니다.
- 트레이스 수 값(8, 20, 200)은 사용자 결정(B18)이라 바꾸지 않았습니다.
- 실행: `just desktop-benchmark all`(앱을 먼저 빌드). 값만 다시 재려면 `size`, `frame`, `trace`, `startup --runs <n>`. `startup`은 macOS GUI 환경(로그인한 화면)이 필요하고 없으면 종료코드 2입니다.

## 2.3 원격 웹 측정표 (L4.remote W8)

`just benchmark --web`(또는 `just web-e2e --bench`, `xeon/apps/desktop/test/web-e2e/web.benchmark.ts`)가 쟀습니다. 실제 모델 호출은 없습니다(테이프). 실제 서비스(임시 홈), 루프백 HTTP 게이트웨이, 헤드리스 Chrome 157(`Bun.WebView`)을 같은 컴퓨터에 띄운 값이라 네트워크 지연은 들어 있지 않습니다. 기기: macOS 26.5(arm64), Bun 1.4.3, 2026-11-10, 다른 에이전트가 함께 돌던 기기입니다. 예산은 정하지 않았습니다(기록만).

| 지표 | 뜻 | 값 |
|---|---|---|
| `web_login_first_screen` | 페어링 코드 제출부터 UI 첫 화면(사이드바 "새 대화"와 연결됨 표시)까지 | 5회 최소 251.8 / 중앙값 274.7 / p90 331.2 ms |
| `web_reload_first_screen` | 로그인된 탭을 다시 열어 UI 첫 화면까지(번들 시작 시간, 쿠키 있음) | 5회 최소 164.8 / 중앙값 202.8 / p90 217.8 ms |
| `web_wire_roundtrip` | 탭 안 `/wire` WebSocket으로 `thread.list`(빈 목록)를 보내 답을 받기까지, 워밍업 20회 뒤 180회 | 중앙값 0.3 / p90 0.4 / 최대 1.1 ms |

- 못 잰 부분: 원격 네트워크(TLS, 실제 지연), 큰 대화 목록, 데스크톱 `first_screen_ms`와 같은 조건의 비교(데스크톱 값은 Electron 창 시작부터라 시작점이 다릅니다), Safari·Firefox.

## 3. 규칙

### PF-01 측정은 레시피로 한다

- 이유: 측정 조건(진입 파일, 인자, 반복 수)이 같아야 값을 비교할 수 있습니다.
- 좋은 예: `just benchmark --runs 5`.
- 나쁜 예: 터미널에서 `time bun …`을 한 번 재서 plan에 적습니다(검사 없음, 리뷰에서 거부).

### PF-02 실제 모델 호출은 사람 확인 뒤에만 잰다

- 이유: 비용과 키가 들어갑니다(사용자 전역 규칙의 종료코드 3).
- 좋은 예: `just benchmark --first-token`이 종료코드 3으로 계획을 보이고, 사람이 확인한 뒤 `--yes`로 다시 부릅니다.
- 나쁜 예: CI나 `just verify`에서 실제 provider를 부릅니다(`benchmark.ts`가 `--yes` 없이는 실행하지 않음).

### PF-03 기기와 날짜를 함께 적는다

- 이유: WSL2와 macOS의 값이 다르고, 같은 기기도 부하에 따라 다릅니다.
- 좋은 예: "WSL2 중앙값 143.6 ms(3회), 2026-10-25".
- 나쁜 예: 기기 없이 "143 ms".

## 4. 강제 수단

- `xeon/scripts/benchmark.test.ts`: 통계, 예산 판정, `--first-token`의 확인 요구를 값으로 비교합니다.
- `xeon/scripts/desktop-benchmark.test.ts`: 앱 크기 판정(500 MiB), `ps` 해석, 유휴 메모리 합산(앱 트리와 새 WebKit 프로세스만), 중앙값, 첫 화면 기준을 값으로 비교합니다(Y17).
- `xeon/scripts/benchmark-gate.test.ts`: 측정 줄 해석, 예산 판정(대기, 안, 초과), 게이트 통과·실패(`--strict`는 예산 대기도 실패), 출시 예산이 모두 대기 상태인지 값으로 비교합니다. `just benchmark-gate`가 서버 측정 결과로 게이트를 돌립니다.
- 리뷰: 예산표 값이 바뀌면 `BUDGET_MS`도 같은 커밋에서 바뀌어야 합니다.

## 5. 예외와 미결 사항

- [결정: 2026-11-04 사용자, B17] 지표별 예산 수치(§2)는 정하지 않고 기록만 합니다. 판정은 "기록됨"입니다. 기준선을 macOS에서 잰 뒤 다시 정합니다.
- [결정: 2026-11-04 사용자, B17] 서버 지표 예산 수치(§2.1)도 기록만 합니다. 예산을 정하면 `just benchmark-gate --strict`를 릴리즈 점검에 넣습니다.
- [미결] macOS 기준선(사용자 항목): `cold_start_cli`, `cold_start_sidecar`, 서버 측정 전부, `fullfsync` 기본값, `processStartFingerprint` macOS 수단, 접두 밖 문장 거부의 운영 빌드 비용. `ws mac`으로 `just benchmark --server`를 돌려 §2.1에 macOS 열을 더합니다.
- [미결] `store_commit_event`의 `synchronous=NORMAL` 대조와 프로세스 시작 지문 시간: platform-store 시험 훅(연결 옵션)과 platform-os 지문 읽기 export가 필요합니다.
- [미결] 컴팩션 시간 지표(`thread.read`는 §2.1에 더함).
