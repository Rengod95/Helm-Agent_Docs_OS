# pi로 자체 에이전트 런타임을 만드는 방법: 선택지와 추천

- 조사일: 2026-10-11
- 기준: pi 저장소 `main` 커밋 `cdaf6c2`, npm `@earendil-works/*` 1.1.0 (2026-10-07)
- 질문: "pi를 쓰면 자체 에이전트 런타임 아키텍처를 쉽게 만들 수 있다"는 목적이라면 pi를 어떻게 써야 하는가.
- 방법
  - pi 저장소를 받아 패키지마다 소스, 문서, 예제를 확인했다.
  - faux provider(실제 API 키 없는 테스트 모델)로 실험 6개를 돌렸다.
  - pi 위에 런타임을 만든 사례 13건의 저장소와 변경 이력을 확인했다.
- 확인 수준
  - [원문]: 소스와 문서를 직접 확인함
  - [실험]: 코드를 돌려 확인함
  - [검색]: 검색 결과만 확인함
  - [추정]: 사실에 기반한 분석이나 추정
- Helm 전제(지금까지 결정된 것)
  - 개인 WSL 서버의 데몬에서 실행한다.
  - 클라이언트가 없어도 작업이 계속된다.
  - 데스크톱 앱을 먼저 만들고, 이후 SSH + pi + 커스텀 TUI를 더한다.
  - 외부에서 접속할 수 있어야 한다.
  - 커널이 모델의 제안을 검사하고 기록한다.
  - 나중에 Claude Code, Codex를 붙인다.

## 0. 요약

1. **"pi를 쓰면 런타임을 쉽게 만들 수 있다"는 전제는 절반만 맞다.**
   - pi가 쉽게 해 주는 부분: 모델 호출(pi-ai), 에이전트 루프(pi-agent-core), 코딩 도구(coding-agent의 도구 팩토리), 터미널 UI(pi-tui). 최근에는 크래시 복구(pi-durable)도 여기에 들어간다.
   - 조사한 사례 거의 모두가 직접 만든 부분: 데몬, 다중 클라이언트 프로토콜, 권한·승인, 이벤트 로그. pi에는 권한 시스템이 없고, README는 컨테이너 같은 격리를 쓰라고 안내한다. [원문]
   - Helm에서 가장 중요한 커널과 기록은 이 두 번째 부분에 속한다.
2. **pi는 "완성된 앱"과 "부품 모음"을 함께 제공한다.**
   - pi를 쓴 사례들은 크게 두 방향으로 나뉜다. 앱 전체를 감싸 쓰는 방향(확장, RPC, SDK)과 부품만 가져다 쓰는 방향(agent-core + pi-ai, pi-tui)이다.
   - pi로 시작한 대표 프로젝트 두 곳(OpenClaw, Happy Agent)은 나중에 pi 런타임을 걷어내고 루프, 세션, 도구 정책을 직접 소유했다. OpenClaw는 지금도 pi-tui만 쓰고 있다. [원문]
3. **변경 빈도가 높다.**
   - 핵심 패키지는 5개월 동안 58개 버전을 냈다(주당 약 2.7회).
   - 1.0 이후 patch 버전에도 breaking change가 있었다. CHANGELOG의 Breaking 절 수는 coding-agent 49, pi-ai 27, pi-agent-core 13이다. [원문]
   - pi-durable과 pi-server/client/protocol은 experimental로 표시되어 있다.
4. **추천: 안 3 "pi를 부품으로 쓰는 자체 런타임"을 기본으로 한다.** Helm 커널의 이벤트 로그를 기준 원본으로 두고, 그 아래에 pi-agent-core + pi-ai + coding-agent 도구 팩토리를 둔다. 클라이언트 TUI는 pi-tui로 만든다.
   - 시작은 안 1(pi 확장)로 한다. Helm 규칙을 며칠 안에 먼저 시험해 볼 수 있다.
   - 런타임 어댑터 인터페이스를 두어, 나중에 pi CLI(RPC)와 Claude Code, Codex를 같은 자리에 붙인다(안 5).
   - pi-durable은 안정화되면 다시 검토한다. 그 전까지는 크래시 복구 설계의 참고 자료로 쓴다.

## 1. pi 패키지 지도

모든 패키지는 같은 버전(1.1.0)을 쓴다. LOC는 `src/**/*.ts` 기준이다. [원문]

| 패키지 | LOC | 역할 | 상태 |
|---|---|---|---|
| pi-ai | 27,242 | 약 35개 모델 제공자 통합, 모델 카탈로그, 인증, 스트리밍, 도구 호출 검증, faux provider | 안정 계열 |
| pi-agent-core | 2,519 | `Agent` 클래스와 `agentLoop`. 병렬 도구 실행, `beforeToolCall`/`afterToolCall`/`prepareRequest`/`finishTurn` 훅, steering·follow-up 큐 | 안정 계열. 1.0에서 하네스·세션·영속화 기능을 덜어냄 |
| pi-coding-agent | 86,152 | `pi` CLI 앱. AgentSession, SessionManager(JSONL), 확장 API(이벤트 40여 개), 내장 도구, interactive·print·json·rpc 모드, SDK | 안정 계열. `src/experimental`은 npm에서 제외 |
| pi-tui | 19,505 | 차등 렌더링 터미널 UI 라이브러리. 의존성 2개 | 안정 계열 |
| pi-durable | 22,842 | 크래시에 견디는 대화·태스크·문서 런타임. SQLite/JSONL 저장소 | **Experimental** ("API changes without notice") |
| chord | 8,817 | 애플리케이션 조립 런타임(서비스, 복제 상태) | 2026-09 신규 |
| pi-server / pi-client / pi-protocol | 약 4,000 | 세션 라우팅 서버, CBOR 프레임 프로토콜, Unix 소켓 | **Experimental**, 인증 미구현 |
| pi-codemode, pi-mcp, pi-env, pi-telemetry | - | QuickJS 샌드박스, MCP 클라이언트, SSH 원격 실행 환경, 텔레메트리 계약 | 독립 사용 가능 |

확인한 사실 중 설계에 중요한 것:
- **pi-durable은 pi-agent-core를 쓰지 않는다.** 루프와 도구를 별도로 구현했고, 내장 도구도 read/write/edit/bash뿐이다. coding-agent 확장은 pi-durable 위에서 동작하지 않는다. [원문]
- **coding-agent의 도구는 세션 없이 따로 쓸 수 있다.** `createReadTool(cwd)`, `createBashTool(cwd)` 등이 순수 `AgentTool`을 돌려주므로 pi-agent-core와 바로 조합할 수 있다. `*Operations` 인터페이스로 파일과 프로세스 접근을 다른 구현으로 바꿀 수도 있다. [실험] 다만 패키지 루트에서 import하면 coding-agent 전체 의존성이 따라온다. [원문]
- **pi-agent-core만으로 커널 검사를 걸 수 있다.** `beforeToolCall`에서 차단하면 그 호출은 사유가 담긴 오류 결과가 된다. 차단된 호출에는 `afterToolCall`이 불리지 않는다. `subscribe` 리스너는 await 되므로 assistant 메시지를 로그에 커밋한 뒤에 도구 실행이 시작되게 할 수 있다. `prepareRequest`로 매 요청 직전에 로그에서 컨텍스트를 다시 만들 수 있다. [실험]
- **pi의 세션 파일(JSONL)은 확정된 메시지마다 append하고 fsync·파일 락이 없다.** 스트리밍 중간 상태와 실행 중인 도구 상태는 남지 않는다. [원문]
- **pi 팀이 만들고 있는 데몬 구조**(`pi server`/`pi client`)는 세션마다 worker 프로세스가 pi-durable을 여는 방식이다. Helm이 원하는 구조와 같지만 npm 배포물에 없고 소스로만 돌릴 수 있다. [원문, 실험]

## 2. 사례: 누가 어느 층을 썼나

| 층 | 사례 | pi가 맡은 것 | 직접 만든 것 | 관찰된 문제 |
|---|---|---|---|---|
| 확장 | pi-chat, ypi, rlm.pi | 거의 전부 | 기능 일부 | pi 프로세스와 권한을 공유함. 호스트 pi 버전 불일치가 흔한 고장 원인(ypi) |
| RPC (`pi --mode rpc` 자식 프로세스) | Paseo, pi-acp | 루프, 도구, 세션 파일 | 데몬, 클라이언트, 권한 UI, 세션 매핑 | RPC 스트림에 없는 상태를 얻으려고 주입 확장과 notify 문자열 마커로 우회함. pi 업그레이드마다 수명주기 버그. Paseo는 ACP 브리지에서 직접 RPC로 옮김 |
| SDK (프로세스 안에 임베드) | pi-web, Vercel harness-pi, OpenClaw(~2026-05) | 루프, 도구, 세션, 리소스 로딩 | 데몬, 클라이언트, 정책 | 0.85.0 패키징 사고로 로드 불가, 0.87 SessionManager 의미 변경. pi와 함께 업그레이드해야 하고 데몬 재시작 시 세션이 끊김(pi-web) |
| agent-core + pi-ai | Assembly Line, Absurd 패턴 | 루프, 모델 호출 | 영속화, 도구 정책, 권한, 프로토콜 | 메시지 단위 체크포인트만으로는 도구 실행 중 크래시를 구분하지 못함(Absurd 패턴) |
| pi-ai만 | Happy Agent(2026-07~08) | 모델 호출 | 루프부터 전부 | 이후 pi-ai도 제거함 |
| pi-durable | pi-fabric, Cloudflare Agents, pi 실험 서버 | 루프, 크래시 복구, 저장소 | 클라이언트 프로토콜, 승인, 정책 | 스트리밍 델타 저장 시 저널이 급증해 순서 마커만 커밋. 정확히 한 번 실행은 보장하지 않음. 사람 승인 단계 없음 |
| pi-tui만 | OpenClaw(현재) | 터미널 UI | 나머지 전부 | - |

출처: [원문]

사례에서 보이는 흐름 [추정]:
- 처음에는 SDK나 RPC로 pi 앱 전체를 감싸 빨리 시작한다.
- 제품이 커지면 세션, 루프, 도구 정책을 직접 소유하는 쪽으로 옮긴다.
- 끝까지 남는 것은 pi-tui나 pi-ai 같은 독립 부품이다.
- Helm은 커널과 기록이 핵심이므로 처음부터 "부품으로 쓰기"를 택하면 이 이동 비용을 줄일 수 있다.

## 3. 선택지

### 안 1. pi 앱 + Helm 확장

pi를 그대로 실행하고, Helm 커널을 pi 확장으로 넣는다. 배치 B, "pi 안의 Helm"이다.

- **구조**: `tool_call`에서 합의 범위와 근거를 검사한다. Helm 도구(`helm_propose_agreement` 등)를 `registerTool`로 등록한다. `appendEntry`나 `.helm/ledger.jsonl`에 기록한다.
- **얻는 것**: pi TUI, 세션 트리, 컴팩션, 내장 도구, MCP, codemode를 전부 그대로 쓴다. SDK 실험에서 `tool_call` 차단과 입력 수정, `appendEntry` 기록, 세션 재열기를 확인했다. [실험]
- **못 하는 것**: 데몬이 없으므로 클라이언트 없이 진행할 수 없고, 데스크톱 앱 원격 접속도 안 된다. 기록이 pi 세션 파일에 묶인다.
- **공수**: 수일 [추정]
- **용도**: Helm 규칙(작업 합의, 근거 기반 승격, 사람의 결과 확인)이 실제 작업에서 쓸 만한지 먼저 시험하는 단계로 적합하다. 커널을 순수 모듈로 만들어 두면 이후 안에 그대로 옮겨 간다.

### 안 2. coding-agent SDK를 Helm 데몬에 임베드

데몬이 `createAgentSession`으로 pi 세션을 여러 개 띄우고, 이벤트를 클라이언트에 전달한다. pi-web 방식이다.

- **얻는 것**: pi의 런타임 기능 전부를 데몬 안에서 객체로 쓴다. 확장도 인라인으로 넣을 수 있다.
- **직접 만들 것**: 데몬, 원격 프로토콜과 여러 클라이언트로의 전달, 인증, 크래시 복구.
- **문제**
  - 기준 원본이 pi의 JSONL 세션이 된다. Helm 로그와 두 갈래가 된다.
  - AgentSession(4,398줄)의 내부 변경에 직접 노출된다. pi-web은 패키징 사고와 의미 변경을 겪었고, 업그레이드 무결성 테스트를 따로 둔다.
  - pi의 설정·리소스·인증 파일 규약도 함께 따라온다.
- **공수**: 1~3주 [추정]
- **판정**: 빨리 동작하는 데몬을 얻을 수 있다. 다만 커널 기록을 Helm이 소유한다는 목표와 어긋나고, 업그레이드 부담이 가장 큰 축에 속한다.

### 안 3. pi를 부품으로 쓰는 자체 런타임 (추천)

Helm 데몬이 런타임을 직접 소유한다. 쓰는 부품은 다음과 같다.

| 부품 | 쓰는 것 |
|---|---|
| 모델 호출 | pi-ai (`createModels`, 제공자, faux provider로 테스트) |
| 루프 | pi-agent-core `Agent` |
| 코딩 도구 | coding-agent의 `create*Tool` 팩토리. 필요하면 `*Operations`로 실행 환경을 바꿈 |
| 기록 | Helm SQLite 이벤트 로그 (기준 원본) |
| 터미널 클라이언트 | pi-tui + coding-agent가 export한 메시지 컴포넌트. JSON 메시지만으로 렌더링 확인 [실험] |

커널을 끼우는 지점은 실험으로 확인했다. [실험]
1. `subscribe`의 `message_end`에서 assistant 메시지를 로그에 커밋한다. 도구 실행 전에 커밋이 끝난다.
2. `beforeToolCall`에서 커널 검사를 하고, 실행 의도를 커밋한 뒤 허용 또는 차단을 정한다.
3. `afterToolCall`에서 결과를 커밋해 관찰 레코드를 만든다.
4. `prepareRequest`에서 로그로부터 투영(모델에게 줄 컨텍스트)을 만든다. A11 투영 규칙을 여기서 지킨다.

- **얻는 것**
  - 기준 원본이 하나(Helm 로그)다.
  - 표면이 작은 층(agent-core 2,519줄, Breaking 13회)에만 의존한다.
  - 커널이 런타임 타입에 묶이지 않아 나중에 다른 런타임 어댑터를 붙이기 쉽다.
- **직접 만들 것**: 영속화, 세션과 분기, 컴팩션, 재시도, 크래시 복구, 원격 프로토콜, 클라이언트.
  - 크래시 복구는 pi-durable 명세(`docs/spec.md` 5.2의 "실행 의도 → 실행 → 결과" 기록 순서)를 참고해서 만든다. 중단된 도구 호출은 "중단됨" 결과로 정리하고, 다시 실행해도 안전한 도구만 다시 실행한다.
  - 클라이언트 재접속은 시퀀스 번호 기반 replay로 한다(Happy Agent의 커서 방식 참고).
- **잃는 것**
  - pi CLI의 확장 생태계와 세션 트리 UI를 그대로 쓰지 못한다.
  - "SSH로 들어가서 pi를 실행"하는 경로는 pi-tui로 만든 Helm TUI 클라이언트로 바뀐다. pi CLI 자체를 쓰고 싶다면 안 5의 RPC 어댑터가 필요하다.
- **공수**: 3~6주 [추정]

### 안 4. pi-durable 위에 Helm

pi-durable을 버전을 고정해 쓰고, 커널을 pi-durable 확장으로 구현한다. pi-fabric 방식이다.

- **구조**
  - typed action은 `defineTool`, 커널 검사는 `hook(ToolTask, {beforeTool})`로 만든다.
  - Helm 레코드는 `defineDoc`이나 사용자 정의 entry로 대화와 같은 트랜잭션에 넣는다.
- **얻는 것**: 크래시 복구, 멱등 제출(`requestId`), 사용자 메시지 inbox, 하위 태스크, 컴팩션, 클라이언트 관찰용 `watch()`를 처음부터 쓴다.
  - 실험에서 도구 실행 중 프로세스를 죽였다가 다시 열었다. 중단된 호출은 interrupted로 정리되고 run이 끝까지 진행됐다. [실험]
  - 12·13 문서와 두 스파이크가 이미 이 방향이다.
- **문제**
  - Experimental이다. Unreleased에도 Breaking 항목이 5개 있다.
  - 저장소 하나에 프로세스 하나만 쓸 수 있다.
  - coding-agent 도구·확장과 호환되지 않아 grep/find/ls 같은 도구를 따로 만들어야 한다.
  - 사람 승인 대기 상태가 없다.
  - 늦게 붙은 클라이언트에 이력을 다시 보내 주지 않는다.
  - 커널 확장을 기본 확장 목록에 고정하지 않으면 검사 없이 실행될 수 있다(명세에 명시된 사항).
- **공수**: 2~5주 + 지속적인 API 추적 [추정]
- **판정**: 기능은 가장 많이 얻는다. 변경 비용을 감수할 수 있을 때 택한다.

### 안 5. pi를 "런타임 어댑터 중 하나"로 두는 벤더 중립 데몬

Helm 데몬이 런타임 어댑터 인터페이스를 정의하고, pi는 그 구현 중 하나가 된다. Paseo 방식이다.

| 어댑터 | 연결 방식 | 커널 검사 지점 |
|---|---|---|
| pi CLI | `pi --mode rpc` 자식 프로세스 + 주입한 Helm 확장 | 확장의 `tool_call` |
| Claude Code | Claude Agent SDK 또는 ACP | `PreToolUse` 훅, 권한 콜백 |
| Codex | app-server | PreToolUse 훅, dynamicTools |
| 기타 | ACP | 권한 요청 |

- **얻는 것**: 사용자의 pi 설정과 확장을 그대로 쓴다. Helm 후반 목표(벤더 중립)와 구조가 같다. pi와 느슨하게 연결된다.
- **문제**
  - 런타임 안에서 일어나는 일을 어댑터가 보여 주는 만큼만 본다. 커널이 강제할 수 있는 범위도 그 런타임의 훅과 권한 콜백까지다.
  - RPC 스트림에 없는 정보(엔트리 id 등)는 주입 확장으로 따로 보내야 한다.
  - 크래시 복구는 각 런타임의 세션 재개 기능에 맡겨진다.
- **공수**: 어댑터마다 1~3주 [추정]
- **판정**: 단독으로 쓰기보다 안 3의 데몬 위에 얹는 2단계로 맞다.

### 안 6. pi 실험 서버(pi-server/client) 위에 Helm

pi 팀이 만들고 있는 데몬 구조를 그대로 쓴다.

- **판정: 지금은 권하지 않는다.**
  - npm 배포물에 없고, 피어 인증이 없고, 호환성 보장이 없다. 트리 탐색, 하위 에이전트, transcript 페이징이 TODO로 남아 있다. [원문]
- 세션별 worker 프로세스, 세션별 SQLite, 복제 상태로 클라이언트에 전달하는 구조는 Helm 데몬의 설계 참고 자료로 가치가 있다.

## 4. 비교

| 기준 | 안 1 확장 | 안 2 SDK 임베드 | 안 3 부품 조립 | 안 4 pi-durable | 안 5 어댑터 | 안 6 pi 서버 |
|---|---|---|---|---|---|---|
| 클라이언트 없이 진행 | X | O (직접) | O (직접) | O (기본) | O (직접) | O |
| 데몬 재시작 후 이어 가기 | X | 확정 메시지까지 | 직접 구현 | **기본 제공** | 런타임에 의존 | 기본 제공 |
| 원격·다중 클라이언트 | X | 직접 | 직접 | `watch()` + 직접 transport | 직접 | 목적이지만 인증 없음 |
| 커널 검사 강제력 | 확장 훅 | 확장 훅 | **루프 훅 (가장 강함)** | 도구 훅 | 런타임 훅까지 | 도구 훅 |
| 기준 원본 | pi JSONL | pi JSONL | **Helm 로그** | pi-durable 저장소 | 런타임별 + Helm 로그 | pi-durable 저장소 |
| pi CLI·TUI 그대로 사용 | O | 같은 프로세스에서만 | X (pi-tui로 재구성) | X (재구성) | O | 실험 클라이언트 |
| 벤더 중립 확장 | X | 어려움 | 쉬움 | 어려움 | **목적 자체** | 어려움 |
| 업그레이드 위험 | 중간 | 중간~높음 | **낮음~중간** | 높음 | 중간 | 매우 높음 |
| 공수 [추정] | 수일 | 1~3주 | 3~6주 | 2~5주 + 추적 | 어댑터당 1~3주 | 4~8주 + 안 4 |

## 5. 추천

### 5.1 단계

| 단계 | 내용 | 다루는 안 |
|---|---|---|
| 0 | 커널을 순수 모듈(이벤트 로그 + 규칙)로 만들고 pi 확장으로 감싸, 실제 작업 몇 개로 Helm 규칙을 시험한다. 10 §5의 "막연한 작업 5개로 먼저 시험"도 여기서 한다 | 안 1 |
| 1 | Helm 데몬. 커널 + SQLite 로그 + pi-agent-core 런타임 어댑터 + coding-agent 도구 팩토리. 크래시 복구는 실행 의도·결과 기록 방식으로 한다 | 안 3 |
| 2 | 클라이언트 프로토콜(JSON-RPC over WebSocket, 시퀀스 번호 replay)과 Tauri 데스크톱 앱. 원격 접속은 Tailscale | 안 3 |
| 3 | pi-tui TUI 클라이언트, pi CLI(RPC) 어댑터, Claude Code·Codex 어댑터 | 안 3 + 안 5 |
| 검토 시점 | pi-durable이 experimental 표시를 떼면 안 3의 크래시 복구를 pi-durable로 바꿀지 다시 본다 | 안 4 |

### 5.2 이유

1. Helm의 핵심은 커널 규칙과 기록이다. 기준 원본을 Helm이 소유해야 공리(근거 기반 승격, 투영 규칙, 혼자 정한 결정 기록)를 런타임과 무관하게 지킬 수 있다. 안 3만이 처음부터 이 조건을 만족한다.
2. pi에서 가장 안정적이고 재사용 가치가 큰 부품(pi-ai, agent-core, 도구 팩토리, pi-tui)만 쓴다. 사례에서 끝까지 남은 것도 이 부품들이다.
3. 개인 1인용이라 크래시 복구 요구가 크지 않다. 실행 의도와 결과를 기록하고 중단된 호출을 정리하는 정도로 충분할 가능성이 크다. pi-durable의 변경 속도를 감수할 이유가 상대적으로 약하다. [추정]
4. 단계 0에서 만든 커널을 그대로 옮겨 쓰므로 시험 비용이 낭비되지 않는다.

### 5.3 다른 안이 나은 경우

- 크래시 복구, 하위 태스크, 컴팩션을 직접 만들기 싫고 API 변경을 따라갈 수 있다면 **안 4**가 낫다. 이미 해 둔 스파이크 두 개를 이어서 쓸 수 있다.
- SSH로 들어가 pi CLI를 그대로 쓰는 경험이 가장 중요하다면 **안 1과 안 5 조합**이 낫다. 데몬은 기록, 대기, 클라이언트 API만 맡고, 실행은 pi CLI(RPC)가 맡는다.
- 가장 빨리 데몬을 띄워 보는 것이 목적이라면 **안 2**가 빠르다. 다만 나중에 안 3으로 옮길 가능성이 크다.

## 6. 남은 확인 사항

- coding-agent 도구 팩토리만 쓰기 위한 import 경로. 패키지 루트에서 import하면 전체 의존성이 따라오므로 하위 경로 export가 있는지 확인해야 한다.
- pi-agent-core의 `beforeToolCall`에서 인자를 수정하는 방식은 코드상 동작하지만 문서화된 계약이 아니다.
- WSL 데몬에서 도구 실행을 어떻게 격리할지(컨테이너, Gondolin VM, pi-env 원격 실행).
- 버전 관리: 정확한 버전 고정, import 무결성 테스트, 업그레이드 체크리스트(pi-web, Assembly Line 사례).

## 7. 출처

### pi 저장소 (커밋 cdaf6c2)
- https://github.com/earendil-works/pi
- `packages/ai/README.md`, `packages/ai/src/types.ts`
- `packages/agent/README.md`, `packages/agent/src/{agent,agent-loop,types}.ts`, `packages/agent/CHANGELOG.md`
- `packages/coding-agent/docs/{sdk,cli-integration,extensions,session-format,rpc}.md`, `src/core/tools/*.ts`, `src/core/session-manager.ts`, `src/experimental/*/README.md`, `CHANGELOG.md`
- `packages/durable/README.md`, `packages/durable/docs/spec.md`, `CHANGELOG.md`
- `packages/{tui,server,client,protocol,chord}/README.md`

### 사례
- Happy Agent: https://github.com/slopus/happy-agent
- OpenClaw: https://github.com/openclaw/openclaw , https://docs.openclaw.ai/agent-runtime-architecture
- Paseo: https://github.com/getpaseo/paseo
- pi-acp: https://github.com/svkozak/pi-acp
- Absurd pi 패턴: https://earendil-works.github.io/absurd/patterns/pi-ai-agent/
- PI WEB: https://github.com/jmfederico/pi-web
- pi-fabric: https://github.com/fabric-runtime/pi-fabric
- Cloudflare Agents Pi 하네스: https://developers.cloudflare.com/agents/harnesses/pi/
- Vercel harness-pi: https://registry.npmjs.org/@ai-sdk/harness-pi
- Assembly Line: https://registry.npmjs.org/@assemblyline-agents/pi
- pi-chat: https://github.com/earendil-works/pi-chat
- ypi: https://github.com/rawwerks/ypi

### 글
- Mario Zechner, pi coding agent (2025-11-30): https://mariozechner.at/posts/2025-11-30-pi-coding-agent/
- Armin Ronacher, Pi (2026-01-31): https://lucumr.pocoo.org/2026/1/31/pi/
- Earendil, Pi 1.0: https://earendil.com/posts/pi-1-0/
