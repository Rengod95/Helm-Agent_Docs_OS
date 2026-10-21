---
id: product.scope.spec
layer: product
domain: scope
kind: spec
status: draft
depends_on: [product.vision.spec, product.usecases.spec, adr.0001, adr.0002, adr.0003, adr.0004, adr.0005, adr.0006, adr.0007, adr.0008]
binds: []
---

# 범위와 마일스톤

## 1. 목적과 범위

### 1.1 정하는 것

이 문서는 Xeon 범위와 마일스톤의 기준이다. 다른 문서의 일정 표기가 이 문서와 다르면 이 문서를 따른다.

- 범위에 포함하는 항목과 각 항목의 첫 마일스톤
- 비범위 항목과 다시 다루는 시점(2차, 보류, 제외)
- 마일스톤 M0~M3의 내용과 종료 조건
- 유즈케이스(UC-1~UC-6) x 마일스톤
- 제약, 가정, 위험

### 1.2 다루지 않는 것

- 층·도메인별 작업 분해와 테스트 목록: 각 층의 `plan.md`
- 유즈케이스 흐름: `product.usecases.spec`

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 마일스톤 | 걸어 다니는 골격부터 첫 공개 릴리즈 후보까지의 구현 묶음. M0~M3. |
| 구성요소 단계 | layer-plan-v2.json의 구성요소별 표기. 1차(첫 사용 버전), 2차(이후), 보류(조건이 생기면), 배포제외. |
| 첫 사용 버전 | 구성요소 단계 '1차'가 모두 들어간 버전. 이 문서에서는 M3 종료 시점의 첫 공개 릴리즈 후보와 같다. |
| 모델 테이프 | 기록한 모델 응답을 재생하는 테스트용 가짜 모델(`eng.testing.guide`). |

구성요소 단계와 마일스톤은 다른 구분이다. 단계 '1차'는 첫 사용 버전에 들어간다는 뜻이고, 마일스톤은 그 안에서 만드는 순서다. 그래서 '1차' 구성요소는 M0~M3 중 어디에나 놓일 수 있다.

## 3. 인터페이스

해당 없음.

## 4. 동작 규칙: 범위와 마일스톤

### 4.1 범위(포함)

| # | 항목 | 첫 마일스톤 | 근거 |
|---|---|---|---|
| I1 | 대화형 런타임 CLI(`xeon chat`) | M1 | [결정: decisions-log 2026-10-19] foundation-plan.md §5 P4 M1 |
| I2 | 데스크톱 앱: Tauri 2, 메모리 우선, 3플랫폼 지원 기술, 엔진 사이드카와 stdio JSON-RPC | M2 | [결정: decisions-log 2026-10-21 3차, ADR-0008] foundation-plan.md §1 결정 3 |
| I3 | 확장 지점 4연산(on, post, drive, scope) | M0 | [결정: decisions-log 2026-10-21 계획 v2, ADR-0007] |
| I4 | 층 F~L3 전체의 1차 구성요소 | M3 | [결정: decisions-log 2026-10-21 배포 단위 정정] |
| I5 | 세션 저장 C안(SQLite 이벤트 소싱 + 투영, 단일 DB, 확장 접두사 테이블) | M0 | [결정: decisions-log 2026-10-21 2차, ADR-0004] |
| I6 | 비밀 SOPS(age) 기본값과 `secret://` 참조 | M1 | [결정: decisions-log 2026-10-21 2차] |
| I7 | Helm 그룹 | M2 | [결정: decisions-log 2026-10-21 배포 단위 정정] |
| I8 | 학습 그룹 | M3 | [결정: decisions-log 2026-10-21 계획 v2] |
| I9 | 승인 프로토콜 통합(질문 도구와 계획 승인을 L1-d 하나로) | M2 | [결정: decisions-log 2026-10-21 3차] foundation-plan.md §1 결정 5 |
| I10 | 무료 검색 기본값 단계 구성 | M2(①~③), M3(④ 첫 실행 권장) | [결정: decisions-log 2026-10-21 3차, ADR-0005] foundation-plan.md §1 결정 6 |
| I11 | 목표 판정(별도 판정 모델 + 실행 횟수 상한) | M3 | [결정: decisions-log 2026-10-21 3차] foundation-plan.md §1 결정 4 |
| I12 | 공유 서비스 모드(`xeon service`, 자동 기동, 유휴 종료) | M3 | [결정: decisions-log 2026-10-21 3차, ADR-0006] foundation-plan.md §1 결정 2 |
| I13 | 예약, 원격, 알림(데몬 허용) | M3 | [결정: decisions-log 2026-10-21 3차] foundation-plan.md §1 결정 2. 원격은 로컬 서비스 소켓을 SSH 터널이나 사설망(Tailscale 등)으로 연결하는 방식으로 M3에 넣고, 내장 TLS + 토큰 WebSocket 전송은 2차다 [결정(잠정): review.decisions-2 U-11] |
| I14 | L4 설정 화면(추론 예산, 라우팅, 레이트 리밋, 계정 회전) | M3 | [결정: decisions-log 2026-10-21 2차] |

- 각 항목의 마일스톤 배정 중 M0·M1은 foundation-plan.md §5 P4를 따른다. M2·M3 배정은 [제안]이다(4.3).
- I4에서 "1차 구성요소"는 layer-plan-v2.json의 단계 표기에 decisions-log 2026-10-21 3차를 덮어쓴 집합이다. 3차 결정이 범위에 넣은 항목(공유 서비스 모드, 예약 실행, 원격 제어, 사용자 알림)은 JSON 표기가 '2차' 또는 '보류'여도 1차로 본다.
- I14의 레이트 리밋과 계정 회전은 L1-c 구성요소 단계가 '2차'였다. 사용자가 L4에서 조작할 수 있어야 한다고 지시했으므로 M3 설정 화면에 넣는다 [결정(잠정): review.decisions-2 U-21].
- I11 목표 지속은 L2-e 구성요소 단계가 '2차'다. 판정 방식은 3차 결정으로 확정됐으므로 [제안] M3에 넣는다.

### 4.2 비범위

| # | 항목 | 다시 다루는 시점 | 근거 |
|---|---|---|---|
| N1 | 입출력 가드레일 | 보류. 필요해지면 X의 first 지점에 붙는 선택 플러그인으로 만든다. | layer-plan-v2-notes.md "입출력 가드레일은 필요한가", decisions-log 2026-10-21 계획 v2 |
| N2 | 확장 프로세스 격리 | 2차 선택 기능. 기본은 같은 프로세스 로드다. | decisions-log 2026-10-21 2차, layer-plan-v2-notes.md "확장 프로세스 격리는 기본값이 아니어도 된다" |
| N3 | OS 서비스 등록(launchd, systemd) | 2차 | decisions-log 2026-10-21 3차, foundation-plan.md §1 결정 2 |
| N4 | Windows 네이티브 지원 | 나중(2차 이후) | decisions-log 2026-10-19 |
| N5 | 클라우드 실행 | 제외 | process.md §6.2 단계 3 "범위 밖" |
| N6 | 위장 provider(Anthropic OAuth) 배포 | 릴리즈 제외. `plugins/provider-anthropic-oauth`로 분리한다. 별도 플러그인 배포 여부는 [미결]. | decisions-log 2026-10-21 2차, ADR-0001 |
| N7 | 유료 웹 API 기본 탑재 | 제외. 사용자가 플러그인으로 등록한다. | decisions-log 2026-10-21 2차 |
| N8 | pi durable 그대로 사용 | 제외. env, tools, images, truncate만 포크한다. | decisions-log 2026-10-21 3차, ADR-0003 |
| N9 | 키 없는 DuckDuckGo 스크레이핑 | 제외(약관 위험) | foundation-plan.md §1 결정 6, ADR-0005 |
| N10 | 기존 `docs/design` 정본 병합 | 제외. 참고 인용만 한다. | foundation-plan.md Context, repo-survey.md §6.1 충돌 3 |
| N11 | 기본 단계·비용 상한 | 제외. 일반 대화 턴에는 pi 방식대로 기본 상한을 두지 않는다. pi 방식의 예외는 사용자 입력 없이 실행되는 경로의 상한뿐이다. ① drive 임대 상한 `{maxTurns, maxSpawns, maxTokens}`(`F.extensions.spec`의 `DriveLimits`)과 Helm 기본값 `l3.helm.driveLimits` 4/8/400000 [결정(잠정): review.decisions-2 U-12]. ② 예약·반복 폭주 방지용 안전 상한(`l2.schedule.timers.maxRunsPerHour`, 최소 간격, 켜진 타이머 수, `l2.schedule.loops.maxIterations`, 루프 수명, `L2.schedule.spec` 설정 표)과 `l3.learning.review.maxIterations` [결정(잠정): review.decisions-2 U-22]. | decisions-log 2026-10-21 계획 v2 | decisions-log 2026-10-21 계획 v2 |

### 4.3 마일스톤

M0와 M1은 foundation-plan.md §5 P4 정의를 그대로 옮긴다. M2와 M3는 계획에 정의가 없으므로 이 문서가 [제안]으로 처음 정한다. [미결] M2·M3 확정.

| 마일스톤 | 표지 | 내용 |
|---|---|---|
| M0 기반 | [결정: foundation-plan.md §5 P4] | `contracts`(F 전 도메인의 TypeBox 타입). `ext-host`(Cordis vendored, on/post/drive/scope 최소형). `platform-store`(bun:sqlite, 이벤트·투영·체크포인트·세션 잠금). `platform-exec`(durable env 포크). |
| M1 걸어 다니는 골격 | [결정: foundation-plan.md §5 P4] | `xeon chat` CLI에서 다음이 동작한다: pi-ai 모델 1개, 도구 `read`, `ls`, `bash`(sandbox), 이벤트 저장과 재개, SOPS 비밀 참조 1종, 테스트용 그룹이 on/post/drive를 사용. UC-1이 이 마일스톤이다. [제안] 도구 `read`, `ls`, `bash`의 본문은 `cap-workspace`(L2-a, ADR-0003 포크 위치)의 최소형으로 이 마일스톤에 만든다. |
| M2 능력과 Helm | [제안] | L2 능력 `cap-web`, `cap-mcp`, `cap-knowledge`, `cap-work`, `cap-dialog`의 1차 구성요소. 승인 프로토콜 통합. 무료 검색 기본값 단계 구성(①~③, ④ 첫 실행 권장은 M3). Helm 본체 1차(`group-kit`, `group-helm`). Tauri 데스크톱과 엔진 사이드카(`apps/desktop`). 비밀 관리 명령(목록, 등록, 삭제, 열람 `xeon secret reveal`, UC-6). 열람은 OS 인증 재확인이 가능한 곳에서 재확인한다 [결정(잠정): review.decisions-2 U-20]. |
| M3 첫 공개 릴리즈 후보 | [제안] | 학습 그룹(`group-learning`). 범위는 스킬 md와 메타인지 피드백 제안이고, 반복 작업 스크립트 제안은 2차다(4.5). 공유 서비스 모드(`xeon service`). 예약, 원격, 알림(`cap-schedule`, `apps/host`, `platform-os`). 원격은 SSH 터널·사설망 연결 방식이다 [결정(잠정): review.decisions-2 U-11]. 목표 판정. 설정 화면(settings-ui, 레이트 리밋·계정 회전 포함 [결정(잠정): review.decisions-2 U-21], 비밀 값 열람 화면 [결정(잠정): review.decisions-2 U-20]). 나머지 1차 구성요소(`cap-workspace`의 M1 밖 도구(write, edit, grep 등), `cap-artifacts` 등). macOS·Linux 릴리즈 빌드. |

- 이번 실행(foundation-plan.md P4)은 M0~M1을 구현하고, Tauri 데스크톱, L2 웹·MCP, Helm 본체는 스캐폴드까지만 만든다.
- [가정] M2와 M3의 순서는 의존 방향을 따른다. Helm은 L2 웹·지식 능력을 쓰므로 같은 M2에 두고, 학습 그룹은 L2 지식 저장소와 백그라운드 위임이 안정된 뒤인 M3에 둔다.

### 4.4 마일스톤별 종료 조건

모든 조건은 테스트로 확인한다. M1 조건의 근거는 foundation-plan.md §6 M1 스모크다. 모든 마일스톤은 `cd xeon && just verify` 종료코드 0을 공통 조건으로 갖는다(foundation-plan.md §6).

| 마일스톤 | 종료 조건 |
|---|---|
| M0 | `contracts`의 TypeBox 스키마가 예시 레코드를 왕복 검증한다. `ext-host` 단위 테스트에서 first 핸들러의 거부가 뒤 핸들러 호출을 막고, chain 핸들러 예외는 그 핸들러만 건너뛰며, 같은 `requestId`의 `post`는 한 번만 큐에 들어가고, 동시에 요청된 drive 임대는 하나만 승인된다. `platform-store`에서 이벤트 추가와 투영 갱신이 한 트랜잭션으로 커밋되고, 쓰기 중인 자식 프로세스를 SIGKILL한 뒤 다시 열면 마지막 커밋까지 보존되며, 두 번째 프로세스의 세션 잠금 시도는 실패한다. 시작 검사가 FTS5 유무를 탐침한다. `platform-exec` 포크 테스트가 통과하고 `CancelScope` 취소가 실행 중 명령을 멈춘다. |
| M1 | 모델 테이프로 `xeon chat` 한 턴을 실행한다. 프로세스를 강제 종료한 뒤 재개하면 이벤트가 이어진다. drive 그룹을 켜고 끄는 동작이 단계 경계(step 종료 직후, 도구 결과 커밋 뒤)에서 적용된다. foundation-plan 원문의 "턴 경계"를 단계 경계로 읽는다 [결정(잠정): review.decisions-2 U-01](`F.conversation.spec` §2.1). SOPS 비밀 참조 1종을 쓰는 도구 호출에서 값이 이벤트 DB와 모델 요청 본문에 나타나지 않는다. 이 검증은 `env` 주입 모드(`_research/secrets.md` §6.2의 M1 모드)로 한다 [결정(잠정): review.decisions-2 U-19]. M1 마일스톤의 도구가 `read`, `ls`, `bash`뿐이고 `sentinel`·`runtime-http` 모드는 프록시나 HTTP 도구가 필요하기 때문이다. 승인 없는 `env` 주입은 금지이므로 이 호출은 승인과 명령 패턴을 갖춘 `bash` 호출이고, 출력에 나타난 값은 저장 전에 가려진다. 샌드박스 `bash`가 작업 폴더 밖 쓰기를 거부한다. |
| M2 | Helm이 확산 단계일 때 쓰기 도구 호출을 거부하고, 렌즈 N개 탐구에서 서브에이전트 N개 결과 커밋 뒤 적용 턴을 한 번 실행한다(UC-2 수용 기준). 같은 모델 테이프와 입력으로 CLI(in-process)와 데스크톱 사이드카(stdio)의 호스트 계약 메시지 열이 같다. 앱을 정상 종료하면 사이드카 프로세스가 남지 않는다. `web.search`가 SearXNG를 감지하면 SearXNG를 쓰고, 없으면 내장 검색 래퍼를 쓴다. 질문 도구와 계획 승인이 같은 승인 요청 레코드로 기록된다. 테스트 MCP 서버의 도구가 도구 목록에 노출된다. |
| M3 | 학습 그룹이 카운터 임계에서 검토 포크를 백그라운드로 실행해 스킬 md와 메타인지 피드백 후보를 만들고, 승인 전에는 스킬·메모리 파일이 바뀌지 않으며, Helm drive 임대 중에도 동작한다(UC-3). [제안] 학습 그룹(`group-learning`)을 추가하는 변경에서 `contracts`, `ext-host`, `platform-*`, `core-*` 경로의 diff가 0이고, 학습 그룹이 쓰는 연산(`on`, `post`, `scope`)이 통합 테스트에서 호출된다(`product.vision.spec` S1). 학습 그룹은 `drive`를 쓰지 않으므로 S1의 `drive` 호출은 M1의 테스트 그룹이 확인한다. 서비스 모드에서 클라이언트를 모두 종료해도 예약 실행 이벤트가 기록되고, 연결 0·live task 0·대기 예약 0일 때만 유예 뒤 종료한다(UC-4). SSH 터널로 서비스 소켓을 연결한 다른 기기의 클라이언트가 세션 목록을 보고 입력을 위임하며, 서비스는 비루프백 리스너를 열지 않는다(UC-5). 목표 판정이 실행 횟수 상한(`l1.agents.judge.maxRuns`)에서 멈춘다. 설정 화면에서 레이트 리밋과 계정 회전을 바꾸면 F5 설정 파일에 같은 키로 저장된다(I14). 설정 화면의 비밀 탭이 재인증 뒤 값을 보인다(UC-6). 설정 화면 "도구와 웹" 탭과 `xeon doctor` 출력이 검색 provider 상태, SearXNG 주소 입력, 키 플러그인 권장 목록(Exa, Brave)을 보인다(I10 ④, ADR-0005 §3.1). 설정 화면 항목, 설정 파일 키, 설정 명령이 같은 F5 스키마에서 생성된다(스키마 키 집합과 화면 항목 집합이 같다). macOS와 Linux 릴리즈 빌드가 같은 스모크를 통과한다. |

### 4.5 유즈케이스 x 마일스톤

| UC | 처음 동작 | 이후 확장 |
|---|---|---|
| UC-1 대화 | M1(CLI) | M2 데스크톱 |
| UC-2 탐구 | M2 | M3 학습 결과 소비 |
| UC-3 학습 | M3 | 2차: 큐레이터, 학습 이력 보기, 반복 작업 스크립트 제안(layer-plan-v2.json L3-c 단계 '2차') |
| UC-4 예약 | M3 | 2차: OS 서비스 등록 뒤 재부팅 후 자동 시작 |
| UC-5 원격 | M3(SSH 터널·사설망 연결) | 2차: OS 서비스 등록, 내장 원격 전송(TLS + 토큰 WebSocket) |
| UC-6 비밀 사용 | M1(에이전트 참조 1종, 마스킹, `env` 주입 검증 [결정(잠정): review.decisions-2 U-19]) | M2 관리 명령(목록, 등록, 삭제, 열람 `xeon secret reveal`), M3 설정 화면의 비밀 탭(열람 포함) [결정(잠정): review.decisions-2 U-20] |

서비스 모드 '1차' 표기와의 관계:

- foundation-plan.md §1 결정 2는 "공유 서비스 모드를 1차로 올린다"고 적었다. 여기서 '1차'는 구성요소 단계(첫 사용 버전에 포함)다. 마일스톤 번호가 아니다.
- UC-4와 UC-5는 공유 서비스 모드 없이는 동작하지 않는다(`product.usecases.spec` UC-4, UC-5 사전 조건). 그래서 두 UC와 서비스 모드를 같은 M3에 둔다.
- M3는 첫 공개 릴리즈 후보이므로 서비스 모드는 첫 사용 버전에 들어간다. 계획의 '1차' 표기와 어긋나지 않는다.
- 앱 실행 중 반복(루프와 웨이크업)은 서비스 모드가 필요 없지만, `cap-schedule` 묶음으로 함께 만들기 위해 M3에 둔다 [제안].

### 4.6 제약과 가정

| 구분 | 내용 | 근거 |
|---|---|---|
| [결정] 런타임 | Bun 1.4.x(`packageManager: bun@1.4.3`) | decisions-log 2026-10-21 3차, ADR-0001 |
| [결정] 언어 | TypeScript 7.0.x(tsgo), strict | foundation-plan.md §2, ADR-0001 |
| [결정] DI | Cordis 4.0.0-rc.x 단일, `xeon/vendor/cordis`에 커밋 고정 | decisions-log 2026-10-21 3차, ADR-0002 |
| [결정] 첫 OS | macOS, Linux(WSL 포함) | decisions-log 2026-10-19 |
| [결정] 코드 위치 | `xeon/` 독립 워크스페이스 | decisions-log 2026-10-21 3차 |
| [결정] 문서 위치 | `docs/xeon/` | foundation-plan.md §1 코드 위치 행 |
| [가정] 구성요소 수 | layer-plan-v2.json 실측: 6층, 33하위 층, 182구성요소(1차 121, 2차 51, 보류 9, 배포제외 1). 이 수는 3차 결정으로 바뀐 단계를 반영하지 않은 값이다. | layer-plan-v2.json |
| [미결] 수치 불일치 | foundation-plan.md Context는 하위 층 41개, decisions-log 2026-10-21 층 구성 계획은 구성요소 163개로 적었다. 둘 다 이전 값이며 이 문서는 JSON 실측(33, 182)을 쓴다. 원 문서 정정 여부를 확인해야 한다. | foundation-plan.md Context, decisions-log 2026-10-21 |

## 5. 실패와 경계 사례: 위험 요약

foundation-plan.md §7에서 가져오고, 아키텍처 조사 노트(`_research/notes/arch-1.md`~`arch-3.md`)의 확인 결과를 덧붙인다.

| # | 위험 | 영향 마일스톤 | 대응 | 조사 노트 |
|---|---|---|---|---|
| R1 | oxfmt가 0.x이고 TS 7 API가 없다. tsgolint는 TS 7.0.x에 묶여 있다. | M0 | 두 버전을 함께 정확히 고정한다. 문제가 생기면 해당 파일만 제외한다. | 없음 |
| R2 | bun:sqlite의 FTS5 유무가 macOS에서 다르다. | M0 | 시작할 때 경로 결정, `Database.setCustomSQLite`, FTS5 탐침 순서로 검사하고 반환값에 기대지 않는다. | arch-3: Linux·Windows 정적 빌드는 소스 기준 FTS5 포함, macOS 시스템 SQLite의 FTS5와 실행 바이너리 검사는 미확인 |
| R3 | Playwright가 Bun에서 동작하지 않을 수 있다. | M2 | Node 자식 프로세스로 우회한다. | 없음 |
| R4 | Cordis가 rc 버전이다. | M0 | vendored로 고정하고 `ext-host` 뒤에 숨긴다. | arch-1: emit은 리스너 오류를 격리하지 않고 bail은 동기 전용이다. fold 실패 정책은 `ext-host`가 직접 구현해야 한다. |
| R5 | 사이드카 단일 바이너리 크기와 Windows 서명 | M2 | `L4.desktop.plan`에서 다룬다. | arch-2: Tauri 플러그인은 앱 정상 종료 때만 사이드카를 정리한다. 크래시·신호 종료에서는 남으므로 stdin EOF 감시가 필요하다. 바이너리 크기는 미확인 |

## 6. 설정 노출

해당 없음. 범위에 포함한 설정 화면(I14)의 탭과 키는 `L4.settings-ui.spec`과 `F.wire-settings.spec`이 정한다.

## 7. 확장 지점

| 마일스톤 | 확장 지점 도입 |
|---|---|
| M0 | on(tap, first, chain), post(steer, followUp, next), drive 임대, scope 켜기·끄기의 최소형. 지점 종류 input, request, tool, boundary, session의 선언. |
| M1 | 테스트용 그룹이 on, post, drive를 실제 루프에서 사용한다. |
| M2 | `group-kit`의 `defineGroup`, drive 임대 중재, 그룹 상태 레코드. Helm이 이를 쓴다. |
| M3 | drive를 쓰지 않는 두 번째 기본 그룹(학습 그룹)과 Helm의 공존. [제안] 제2 그룹은 학습 그룹이고, 그 추가 시 코어 diff 0을 확인한다(`product.vision.spec` S1, 4.4 M3). |

## 8. 다른 문서와의 인터페이스

| 문서 id | 관계 |
|---|---|
| `product.vision.spec` | 성공 기준 S1~S4를 마일스톤 종료 조건으로 배치한다(S2·S3: M1, S4: M2, S1: M3). |
| `product.usecases.spec` | UC-1~UC-6의 첫 동작 마일스톤을 4.5절에서 정한다. |
| `architecture.runtime-flow.design` | 마일스톤 이름 M0~M3을 인용한다. |
| 각 층 `plan.md` | 1절 "목표와 마일스톤 배치"를 이 문서의 M0~M3에 맞춘다. |

## 9. 수용 기준

- 4.1의 모든 포함 항목에 첫 마일스톤이 하나씩 배정되어 있다.
- 4.2의 모든 비범위 항목에 다시 다루는 시점(2차, 보류, 제외, 나중)이 적혀 있다.
- 4.4의 모든 종료 조건이 테스트로 확인할 수 있는 문장이다.
- 4.5의 서비스 모드 의존 설명이 foundation-plan.md §1 결정 2의 '1차' 표기와 모순되지 않는다.

## 10. 미결 사항

| # | 항목 | 관련 절 | 확인 대상 |
|---|---|---|---|
| 1 | M2·M3 정의 확정. 이 문서의 M2·M3는 [제안]이다. | 4.3 | 사용자 |
| 2 | 제품 이름. 'Xeon'은 임시 이름이다(decisions-log 2026-10-21 3차). | 1 | 사용자 |
| 3 | 위장 provider 별도 플러그인을 공개 배포할지 | 4.2 N6 | 사용자 |
| 4 | Helm 내부 설계 착수 시점. decisions-log 2026-10-21 2차는 "층 구성 계획 보완·합의 뒤 착수"로 적었다. M2 시작 전에 필요하다. | 4.3 | 사용자 |
| 6 | 하위 층 수(41/33)와 구성요소 수(163/182) 불일치. 원 문서를 JSON 실측으로 정정할지 | 4.6 | 사용자 |
| 7 | layer-plan-v2.json 단계 표기를 3차 결정에 맞게 갱신할지(공유 서비스 모드, 예약 실행, 원격 제어, 사용자 알림) | 4.1 | 사용자 |

- 5번(레이트 리밋·계정 회전 단계), 8번(원격 전송 단계), 9번(M1 비밀 검증 모드), 10번(비밀 값 열람 단계와 경로)은 `review.decisions-2` U-21, U-11, U-19, U-20으로 정해 지웠다. 남은 항목의 번호는 다른 문서의 인용 때문에 바꾸지 않는다.
