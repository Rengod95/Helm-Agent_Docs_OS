# 에이전트 런타임 F~L2 레퍼런스 조사

조사 대상은 pi, oh-my-pi(omp), pi durable, opencode, Claude Code, Hermes Agent 여섯 개입니다. 모두 2026-10-20 전후 커밋 기준입니다. 대상별 상세 보고서는 맨 아래 링크에 있고, 근거(파일:줄, 문서 URL)는 그 보고서에 있습니다. 이 문서는 "우리 F~L2를 어디서 무엇을 가져와 만들지"에 답하는 종합입니다.


## 이번 갱신 (2026-10-21)

- [층별 항목 카탈로그](items.html): 188항목 (필수 86, 권장 63, 선택 39). 항목마다 역할, 해결하는 문제, 참고 구현, 필수도, 우리 방향을 적었습니다. 위 여섯 대상에 더해 Codex, Gemini CLI, OpenHands, Goose, Amp, Letta, LangGraph, OpenAI Agents SDK, ACP, 최신 MCP 사양에서 뽑았습니다.
- 세션 저장 방식 비교: 이 문서의 "세션 저장 방식 비교" 절
- [웹 도구 조사](web-tools.html): 검색, fetch, 브라우저, 딥 리서치 provider 비교와 `web.*` 서비스 정의 초안
- 아래 층별 채택안 표는 첫 조사 때의 요약입니다. 전체 항목은 카탈로그를 기준으로 봅니다.

## 대상 한눈 비교

| | pi | oh-my-pi | pi durable | opencode v2 | Claude Code | Hermes |
|---|---|---|---|---|---|---|
| 라이선스 | MIT | MIT (일부 의존 LGPL·MPL) | MIT | MIT | 상용 (코드 사용 불가) | MIT |
| 언어·런타임 | TS, Node | TS(Bun 전용) + Rust | TS | TS, Bun, Effect | 비공개 | Python |
| 성숙도 | 1.x, 매주 breaking | 매주 마이너 | 실험, 무고지 변경 | 2.1에서 공개 계약 깨짐 | 상용 안정, 세션 형식은 내부용 | 활발, 문서와 소스 어긋남 많음 |
| 루프 | agent-core 메모리 루프 | pi 루프 확장 (큐 6종, 추측 실행) | 체크포인트 task 상태 기계 | Step마다 DB에서 이력 재조립 | 비공개, SDK는 CLI 자식 프로세스 | `AIAgent` 단일 코어 |
| 세션 저장 | JSONL 트리, fsync 없음 | JSONL 트리 + 임대, fsync 없음 | SQLite WAL / JSONL, 커밋 단위 | SQLite 이벤트 소싱 + 투영 | JSONL (내부 형식) | SQLite FTS5 |
| 결과 불명 도구 | "No result" 합성만 | 합성 aborted | 의도→실행→결과 + safe/unsafe 정책 | write-ahead claim, 재실행 안 함 | 재실행 안 하고 모델에 확인 요청 | unknown 상태 + 허용 목록 |
| 확장 강제 수준 | 1~4 | 1~4 두텁고 5 일부 | 1~5 (tasks = 구동) | 1~4 | 1~4, 5는 SDK·워크플로 | 1~4 (훅 46, 미들웨어 4) |
| 확장 격리 | 없음 | 없음 (30초 타임아웃) | 없음 | 약함 | 훅은 프로세스 밖, mods는 안 | 선택(host), 기본 in-process |

표에서 공통으로 읽히는 사실이 둘 있습니다. 첫째, 공개 API가 안정된 대상이 하나도 없습니다. 오픈소스 셋(pi, omp, opencode)은 매주 또는 마이너 버전에서 계약이 깨지고, Claude Code는 코드를 가져올 수 없습니다. 그래서 "채택"은 패키지를 의존성으로 거는 방식보다, 고정 커밋으로 가져와(vendoring) 우리 F 계약 뒤에 어댑터로 감싸는 방식이 맞습니다. 둘째, 플러그인이 루프를 함수로 불러 흐름 전체를 진행하는 5단계(구동)는 pi durable의 tasks만 제대로 갖추고 있습니다. 제2의 Helm을 붙이는 데 필요한 부분이 정확히 기존 구현이 가장 약한 곳입니다.

## 층별 채택안

### F 계약

| 항목 | 채택안 | 출처 | 방식 |
|---|---|---|---|
| 메시지·스트림 이벤트 | `Message`, `AssistantMessageEvent` 모양 | pi-ai | 설계 채택, 우리 스키마로 재정의 |
| 세션 로그 | 이벤트 테이블 + 투영 테이블, seq 커서 재생 | opencode | 설계 채택 |
| 대화 분기 | `id`/`parentId` 트리, leaf 포인터 이동, 비파괴 컴팩션 엔트리 | pi | 설계 채택 |
| 확장 매니페스트 | plugin.json 레이아웃, userConfig, 능력 선언 정적 검사(`validate`) | Claude Code | 형식 참고 + 우리 필드(층, 그룹, 신뢰 등급, 강제 수준, 필수·선택 능력) 추가 |
| 스킬 형식 | SKILL.md (Agent Skills 규격) | Claude Code, Hermes | 그대로 채택 |
| 스키마 원천 | 단일 원천 스키마에서 TS 타입·JSON Schema 생성, CI에서 diff 검사 | Hermes (Pydantic → TS/OpenRPC) | 패턴 채택 |
| 버전 정책 | semver + 폐기 기간 | 없음 (모두 약함) | 자체 설계 |

### L0 플랫폼

| 항목 | 채택안 | 출처 | 방식 |
|---|---|---|---|
| 샌드박스 | `@anthropic-ai/sandbox-runtime` (Apache-2.0, macOS seatbelt·Linux bubblewrap) | Claude Code | 패키지 채택 후보. 첫 지원 OS와 일치. 셸 실행만 감싸고 파일 도구·MCP는 범위 밖, 0.0.x라 API 변동 가능 |
| 실행 환경 추상 (`os.shell`) | `ExecutionEnv` 인터페이스, 백엔드 플러그인(로컬·Docker·SSH 등) | pi durable, Hermes `TerminalEnvironmentProvider` | 설계 채택 |
| 작업 트리 격리 | overlayfs·APFS clone·git worktree | omp `pi-iso` | 설계 참고 (N-API 단독 사용 가능 여부 미확인) |
| 프로세스 모델 | 기본은 같은 프로세스, 서비스 모드는 등록 파일로 발견 + HTTP API + SSE 피드 | opencode | 설계 채택 (데몬 선택 사항과 일치) |

### L1 코어

| 항목 | 채택안 | 출처 | 방식 |
|---|---|---|---|
| (a) 태스크 트리 | 소유 트리, `background` 경계, `waiting`(failFast/allSettled), 아래에서 위로 abort | pi durable | 설계 채택, Cordis fiber와 별개의 대화 수준 트리로 구현 |
| (a) 입력 큐 | 내구 inbox, `steer`(다음 안전 경계)·`queue`(유휴 때) 두 모드, wake 신호 | opencode (pi steering/follow-up, omp aside 참고) | 설계 채택. 안전 지점 마이크로태스크의 기성 구현 |
| (b) 루프 골격 | agent-core 루프 | pi | 코드 채택 (고정 커밋), 단계마다 체크포인트를 남기도록 감쌈 |
| (b) 단계 정의 | prepare → request → retry → poll → tools | pi durable | 설계 채택 |
| (c) 모델 게이트웨이 | pi-ai provider 계층 | pi | 코드 채택 후보. Anthropic OAuth 위장 경로는 유지하되 별도 provider로 분리하고 기본 꺼짐 |
| (c) 캐시 원칙 | 고정 접두, 변동 정보는 대화 끝에 덧붙임, 도구 목록 고정 + 지연 로딩, 모델 전환 시 경고 훅 | Claude Code, omp StablePrefix | 원칙 채택 |
| (d) 도구 실행 | 병렬 기본, 같은 파일 변경은 realpath 키 큐로 직렬화, shared/exclusive 구분 | pi, omp | 설계 채택 |
| (d) 권한 | `{action, resource, effect}` 규칙, deny > ask > allow, 관리 설정 최우선, 모드 | opencode, Claude Code | 설계 채택 |
| (e) 컴팩션 | 롤링 요약 + 최근 원문 유지, 원본은 지우지 않음 | opencode, pi | 설계 채택 |
| (f) 원자성 | 의도 → 실행 → 결과 3단, 도구별 `replay: safe/unsafe` (기본 unsafe), 재시작 시 읽는 쪽이 오류 결과 합성, 부분 스트림은 aborted로 보존 | pi durable, opencode, Claude Code | 설계 채택 |
| (f) 내구성 | SQLite WAL, 단계 경계 커밋은 `synchronous=FULL`, 다중 프로세스는 임대(lease) | 자체 + omp 임대 | 자체 설계. 여섯 대상 모두 이 부분이 약함 |
| (g) 서브에이전트 | 같은 프로세스 자식 세션, 자식 권한 ⊆ 부모 권한, 결과는 최종 보고 + 지시문 모방 스캔, 깊이·동시 실행 상한 | Claude Code, omp, opencode | 설계 채택 |

### L2 능력

| 항목 | 채택안 | 출처 | 방식 |
|---|---|---|---|
| MCP | pi `mcp` 패키지(의존 하나) 또는 공식 SDK | pi, opencode | 코드 채택 |
| 스킬 노출 | 인덱스만 상시, 본문은 필요할 때 로드 | Hermes, Claude Code | 설계 채택 |
| 도구 지연 노출 | tool search | Claude Code, Hermes | 설계 채택 (캐시 원칙과 한 묶음) |
| 학습 루프 | 턴 종료 후 백그라운드 포크가 같은 캐시 접두로 검토, 카운터 트리거, 큐레이터(stale → 아카이브), 변경 원장 | Hermes | 설계 채택. 단 쓰기 승인과 보안 스캔은 켠 상태로 시작하고 신뢰 등급 3에 연결 |
| 웹 검색·fetch | 이번 조사 범위에서 깊이 보지 못함 | — | 다음 조사 항목 |

## 확장 지점: L2·L3 설계에 바로 쓰이는 발견

여섯 대상의 확장 체계에서, 우리가 직접 설계해야 하는 부분에 가져올 것을 정리했습니다.

1. 순서 규칙은 Claude Code mods의 tier(prepend, user, append, builtin, core)가 가장 정리되어 있습니다. 보안 가드(`sec-default`)를 가장 바깥 tier에 두는 구조는 우리의 권한·신뢰 등급과 그대로 맞습니다.
2. 실패 정책은 지점별로 달라야 한다는 점을 omp(핸들러 30초 타임아웃, `tool_call`은 실패 시 차단)와 Claude Code(기본 fail-open, `onFailure: "block"`으로 선택)가 보여 줍니다. pi는 훅마다 정책이 제각각이라 피할 사례입니다.
3. 런타임 토글은 omp가 확장별 suspend/resume을 지원하고, 확장이 덮어쓴 내장 도구를 원래대로 되돌립니다. pi durable은 토글을 다음 단계부터 적용합니다. 우리의 턴 경계 토글과 같은 규칙입니다.
4. 구동(5단계)은 pi durable의 tasks가 유일한 완성형입니다. omp는 `runEphemeralTurn`과 `session_stop` 계속 진행(상한 8회)으로 일부를 지원하고, Claude Code는 SDK `query()`와 워크플로 스크립트로 프로세스 밖에서 지원합니다. 워크플로가 `Date.now()`·`Math.random()`을 금지해 결정적 재생으로 재개하는 규칙은 Helm 구동 프로그램에 그대로 쓸 수 있습니다.
5. 학습 산출물의 안전 기본값은 Hermes가 반면교사입니다. 쓰기 승인과 에이전트 작성 스킬 스캔이 기본 꺼져 있어, 학습 결과가 사람 확인 없이 디스크에 쓰입니다.

## 세션 저장 방식 비교

세션 저장소는 런타임에서 세 가지 일을 처리합니다. 모델에 보낼 대화 이력을 다시 조립하는 원천이고, 크래시나 재시작 뒤 이어서 실행하는 근거이며, 학습·검색·UI가 과거 대화를 읽는 자료입니다. 아래 다섯 방식은 이 세 가지 중 어느 쪽을 쉽게 만들고 어느 쪽을 어렵게 만드는지가 다릅니다.

### 다섯 방식

| 방식 | 구조 | 쓰는 곳 |
|---|---|---|
| A. JSONL 단일 로그 | 세션당 파일 하나, 엔트리를 줄 단위로 덧붙임 | Claude Code |
| B. JSONL 트리 | A에 `id`/`parentId`를 더해 분기를 표현, leaf 포인터로 현재 가지 선택 | pi, oh-my-pi |
| C. SQLite 이벤트 소싱 + 투영 | 불변 이벤트 테이블에 쌓고, 같은 트랜잭션에서 조회용 테이블(메시지, 파트) 갱신 | opencode v2 |
| D. SQLite 체크포인트 | 불변 엔트리 + 실행 상태(task 레코드)를 커밋마다 통째로 교체 | pi durable, LangGraph 체크포인터 |
| E. 외부 내구 실행 엔진 | Postgres나 별도 서버가 단계 결과를 저장하고 재실행 시 캐시로 돌려줌 | absurd, Temporal |

### 기준별 비교

| 기준 | A | B | C | D | E |
|---|---|---|---|---|---|
| 쓰기 원자성 | 줄 단위. 크래시 때 마지막 줄이 잘릴 수 있음 | A와 같음 | 트랜잭션 단위 | 트랜잭션 단위 | 엔진이 보장 |
| 여러 기록을 한 번에 커밋 | 불가 (파일 여러 개) | 불가 | 가능 (메시지 + 확장 기록 + 작업 상태) | 가능 | 가능 |
| 내구성 설정 | fsync를 직접 호출해야 함 (조사한 세 곳 모두 호출 안 함) | 같음 | `synchronous=FULL`이면 커밋 직후 디스크 보장 | 같음 (pi durable은 NORMAL) | 엔진 설정 |
| 분기·되감기 | 어려움 (파일 복사) | 쉬움 (포인터 이동) | `parentId` 열로 B와 같게 가능 | 체크포인트 선택으로 가능 | 제한적 |
| 실행 재개 | 이력을 다시 읽고 추론 | 같음 | 이벤트에서 상태 재구성, 중간 상태 기록 가능 | 마지막 체크포인트에서 바로 재개 | 핸들러 재실행 + 단계 캐시 |
| 전체 이력 보존 | 보존 | 보존 | 보존 (이벤트가 원본) | 중간 실행 상태는 덮어씀 | 엔진마다 다름 |
| 조회·검색 | 전체 파일 스캔 | 같음 | SQL, FTS5 전문 검색 | SQL | 엔진 API |
| 여러 프로세스 동시 접근 (앱 + CLI + 서버) | 잠금 직접 구현 (omp는 임대 파일) | 같음 | WAL로 읽기 여럿 + 쓰기 하나 | 같음 | 기본 지원 |
| 사람이 읽기·디버깅 | `cat`, `jq`, `grep`으로 바로 | 같음 | `sqlite3` 필요, JSONL 내보내기로 보완 | 같음 | 엔진 UI |
| 스키마 변경 | 줄마다 버전, 읽는 쪽이 모두 처리 | 같음 | 이벤트 버전 + 투영 재생성으로 처리 | 상태 레코드 마이그레이션 필요 | 워크플로 버전 관리가 까다로움 |
| 구현 비용 | 가장 낮음 | 낮음 | 중간 (투영 코드, 이벤트 버전) | 중간 | 낮음 (대신 운영 의존 큼) |
| 배포 의존성 | 없음 | 없음 | SQLite 모듈 (Node 내장 `node:sqlite` 또는 `better-sqlite3`, Bun 내장) | 같음 | Postgres·서버 상주 |

### 방식별 장단점

A와 B는 단순하고 사람이 바로 읽을 수 있다는 장점이 뚜렷합니다. 반면 커밋 단위가 줄 하나라서 "도구 의도 기록과 확장 기록과 작업 상태를 함께 저장"하는 원자적 커밋이 불가능합니다. 조사한 pi, oh-my-pi, Claude Code 모두 fsync를 호출하지 않고, pi는 잘린 줄을 경고 없이 버립니다. 앱·CLI·서버가 같은 세션을 동시에 열면 잠금도 직접 만들어야 합니다. 이번 런타임의 요구(continuation, 확장 기록과의 원자성, 다중 클라이언트, 학습용 검색)와 맞지 않는 부분이 많습니다.

C는 위 요구를 모두 충족하는 대신 투영 코드와 이벤트 버전 관리 비용이 듭니다. opencode v2는 재생 결과가 투영과 어긋나는지 검출하는 장치까지 갖췄습니다. 주의할 점은 스트리밍 토큰 하나하나를 이벤트로 쌓지 않는 것입니다. 토큰 델타는 휘발 이벤트로 UI에만 흘리고, 완성된 메시지 파트만 저장합니다. 기존 Helm 설계의 "영속 이벤트와 휘발 이벤트 구분"과 같은 규칙입니다.

D는 재개가 가장 빠르고 단순합니다. 다만 실행 상태를 덮어쓰므로 "어떤 경로로 이 상태에 왔는지"는 엔트리에서 다시 읽어야 합니다. C 위에 "단계 체크포인트" 테이블을 하나 더 두면 D의 장점을 얻을 수 있습니다.

E는 강력하지만 Postgres나 상주 서버가 필요합니다. 개인 데스크톱 앱에서 시작해 배포하는 런타임에는 운영 부담이 큽니다.

### 놓치기 쉬운 제약: 확장별 DB 파일과 원자성

기존 설계는 확장마다 SQLite 파일을 따로 두는 안이었습니다. SQLite는 여러 파일을 `ATTACH`해 한 트랜잭션으로 묶을 수 있지만, WAL 모드에서는 파일 하나하나의 원자성만 보장하고 여러 파일에 걸친 원자성은 보장하지 않습니다. 그래서 세션 기록과 Helm 기록을 한 번에 커밋하려면 둘 중 하나를 골라야 합니다.

1. DB 파일 하나에 확장별 테이블 이름공간(접두사)을 둡니다. 원자성은 그대로 얻고, 확장을 지울 때는 그 접두사 테이블만 지웁니다.
2. 파일은 나누고 outbox 패턴을 씁니다. 세션 DB에 "확장 기록 예정"을 함께 커밋하고, 확장 DB에는 나중에 멱등하게 반영합니다.

1안이 단순합니다. 신뢰 등급 2·3 확장이 별도 프로세스로 돌 때만 2안을 씁니다.

### 권장안

C를 기본으로 하고 다른 방식의 장점을 붙입니다.

- 이벤트에 `parentId`를 넣어 B의 분기·되감기를 그대로 지원합니다.
- 단계 체크포인트 테이블을 두어 D처럼 마지막 단계에서 바로 재개합니다.
- 도구 실행은 의도 → 실행 → 결과 세 이벤트로 기록하고, 결과 없는 의도는 `replay: safe/unsafe` 규칙으로 처리합니다.
- 큰 도구 출력은 블롭 파일로 빼고 해시만 이벤트에 남깁니다 (oh-my-pi 방식).
- 단계 경계 커밋은 `synchronous=FULL`로 디스크까지 보장합니다. 한 단계에 커밋 한 번이라 fsync 비용은 모델 호출 시간에 비해 작습니다.
- 디버깅과 이식을 위해 세션을 JSONL로 내보내는 명령을 둡니다. A·B의 "바로 읽힘" 장점은 이 내보내기로 얻습니다.

## 웹 도구 권장 조합

상세는 [웹 도구 조사](web-tools.html)에 있습니다. 벤치마크마다 순위가 달라 단일 승자가 없으므로, provider를 교체할 수 있게 만드는 것이 설계의 중심입니다.

| 서비스 | 기본 | 대체·선택 | 자가 호스팅 |
|---|---|---|---|
| `web.search` | Exa (검색 + 본문 한 번에, 도메인·신선도 필터, TS SDK) | Parallel, Brave (결과 캐시 금지 약관), 모델 내장 검색(hosted) | SearXNG (AGPL, 별도 프로세스) |
| `web.fetch` | 로컬 파이프라인 (SSRF 방어, `Accept: text/markdown`, Readability → Markdown) | 실패·JS·PDF일 때 Exa contents, Jina Reader, Firecrawl, Cloudflare로 승격 | Crawl4AI (Docker 서비스) |
| `web.browse` | Playwright 로컬 (접근성 스냅샷) | Playwright MCP, Chrome DevTools MCP, Stagehand, Browserbase, Steel | Playwright |
| `web.research` | 우리 루프 (서브에이전트가 search + fetch 반복, 인용 검증 패스) | Exa Agent, Parallel Task, Perplexity, Gemini·OpenAI deep research 위임 | 우리 루프 |

주의할 점: Brave는 결과 저장·캐시를 금지하고, Tavily는 쿼리를 모델 개선에 쓸 수 있으며 2026-02 인수 발표로 방향이 불확실합니다. Firecrawl·SearXNG는 AGPL이라 별도 서비스로만 호출합니다. 각 provider 약관 전문은 공개 릴리즈 전에 직접 확인해야 합니다.

## 피할 것

- 세션 쓰기에 fsync와 잠금이 없는 구조 (pi, omp, Claude Code JSONL)
- 확장이 같은 프로세스·같은 권한으로 격리 없이 도는 구조를 신뢰 등급 2·3에 쓰는 것
- provider 위장 코드를 본체에 섞어 두는 것. 사용자 결정으로 유지하되 별도 provider로 분리하고 기본 꺼짐으로 둡니다 (약관·계정 제재 위험, 공개 릴리즈 포함 여부는 나중에 결정)
- 검증 없는 바이너리 자동 다운로드 (pi `tools-manager`의 rg·fd)
- Effect 기반 패키지(`@opencode/ai` 등)를 Cordis와 함께 쓰는 것. 의존성 주입과 수명 관리 체계가 둘이 됩니다.
- 저장소 오류가 나면 런타임 전체를 종료하는 구조 (pi durable)

## 결정 상태

| 항목 | 상태 |
|---|---|
| 루프 | 결정: pi agent-core 코드를 고정 커밋으로 가져와 자체 유지 |
| 위장 경로 | 결정: 유지. 별도 provider로 분리, 기본 꺼짐 |
| 웹 도구 | 결정: 최신 provider 위주. 위 권장 조합 |
| 세션 저장 | 제안: SQLite 이벤트 소싱 + 분기 열 + 단계 체크포인트 + 의도·결과 규칙 + DB 파일 하나에 확장별 테이블 접두사 |
| 모델 게이트웨이 | 제안: pi-ai를 고정 커밋으로 가져옴 |
| 확장 지점 목록 | 다음 작업 후보: 카탈로그의 X 확장 체계 22항목에서 출발 |

## 대상별 상세 보고서

- [pi](refs/pi.html)
- [oh-my-pi](refs/oh-my-pi.html)
- [pi durable](refs/pi-durable.html)
- [opencode](refs/opencode.html)
- [Claude Code](refs/claude-code.html)
- [Hermes Agent](refs/hermes.html)
