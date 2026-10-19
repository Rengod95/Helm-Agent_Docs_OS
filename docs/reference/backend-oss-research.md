# 에이전트 백엔드 오픈소스 조사

- 조사일: 2026-10-11
- 목적: Helm 데몬(개인 WSL 서버, 클라이언트 없이도 작업 지속, 데스크톱 앱 우선, 외부 접속)을 만들 때 가져다 쓰거나 설계를 참고할 오픈소스를 찾는다.
- 방법: 세 갈래로 나눠 병렬로 조사했다.
  1. 서버(데몬)와 클라이언트가 분리된 에이전트 제품
  2. 지속 실행 엔진과 에이전트 프레임워크
  3. 클라이언트-에이전트 프로토콜, 데스크톱 앱 셸, WSL 원격 접속
- 확인 수준
  - [원문]: 저장소 문서, 소스, 레지스트리를 직접 확인함
  - [검색]: 검색 결과나 2차 자료만 확인함
  - [지식]: 기존 지식이며 이번에 다시 확인하지 않음
  - [판단]: 위 사실에 기반한 분석
- Mastra는 따로 상세 검토한다([mastra-review.md](mastra-review.md)).

## 0. 요약

1. **데몬 + 여러 클라이언트 구조는 이미 흔하다.**
   - OpenCode v2, Codex app-server, Happy Agent, Paseo, Cline hub, OpenHands agent-server가 모두 이 구조다.
   - 그중 클라이언트 없이 진행하다가 데몬이 재시작된 뒤 **진행 중이던 턴까지 이어서 실행하는** 것은 OpenCode v2, Codex(관리형 데몬), pi-durable 정도다. [원문]
2. **pi 쪽에 새로 확인한 것이 있다.**
   - pi 저장소에 pi-server, pi-client, pi-protocol 패키지가 생겼다. 데몬 하나에 여러 클라이언트가 붙는 구조이고, 모두 experimental이며 피어 인증이 없다.
   - coding-agent 안에도 실험 단계의 durable 모드가 있다(`src/experimental/durable`). 세션 하나가 SQLite 파일 하나이고, 크래시 후 `--continue`로 턴을 이어 간다. [원문]
3. **지속 실행 엔진은 Helm 규모에 비해 대부분 무겁다.**
   - Temporal, Hatchet, Trigger.dev, LangGraph Server는 Postgres, Redis, 클러스터가 필요하다.
   - TypeScript, 단일 프로세스, SQLite 조건에 맞는 것은 OpenWorkflow(0.10, 라이브러리), Resonate(0.9, Rust 단일 바이너리) 정도다. 둘 다 1.0 전이다. [원문]
4. **런타임 연결 표준은 ACP(Agent Client Protocol)가 가장 넓게 쓰인다.**
   - 에이전트 쪽 45개가 지원한다. pi는 pi-acp, Claude는 claude-agent-acp, Codex는 codex-acp 어댑터로 붙는다. [원문]
   - 원격 전송(HTTP/WebSocket)은 아직 진행 중인 RFD이고, 끊긴 동안의 메시지를 다시 보내 주지 않는다. [원문]
5. **원격 접속은 Windows 호스트에 Tailscale을 두는 방식이 가장 단순하다.**
   - 데몬은 WSL 안에서 127.0.0.1에만 바인딩하고, `tailscale serve`로 HTTPS를 붙인다.
   - WSL 유지에는 systemd, `.wslconfig` timeout 두 개를 -1로, 로그온 시 keepalive 작업, 절전 끄기를 함께 적용해야 한다. 설정 하나만으로는 불안정하다는 보고가 있다. [원문]
6. **Helm에 대한 잠정 결론 [판단]**
   - 런타임은 pi를 유지한다.
   - 지속 실행은 pi-durable과 Helm 자체 SQLite 커널 로그 조합으로 한다.
   - 재시작 복구 규칙은 OpenCode의 write-ahead claim, 클라이언트 재접속은 시퀀스 번호 기반 replay를 참고한다.
   - 벤더 중립 어댑터 계층은 Paseo를 참고한다.
   - 기성 엔진을 도입하지 않아도 된다.

## 1. 서버와 클라이언트가 분리된 에이전트 제품

### 1.1 비교

| 제품 | 라이선스 / 언어 | 최신 | 클라이언트 통신 | 클라이언트 없이 진행 | 재시작 후 진행 중 턴 | 저장 | 원격·인증 | 커널이 끼어들 지점 | Helm 판정 |
|---|---|---|---|---|---|---|---|---|---|
| OpenCode v2 | MIT / TS | 2.0.26 (10-08) | HTTP + SSE, OpenAPI | 예 | **이어서 실행** (write-ahead claim) | SQLite 이벤트 소싱 | Basic, 일회용 페어링 → 30일 토큰, 터널 | 플러그인 before/after, 권한·form·inbox API | 설계 참고 (높음) |
| Codex app-server | Apache-2.0 / Rust | 0.162.1 (10-09) | JSON-RPC: stdio, unix, ws | 예 (구독자 없어도 30분 유지) | 관리형 데몬은 로컬 턴 자동 재개 | thread별 JSONL + state DB | WS 토큰 (experimental, non-loopback 기본 무인증) | PreToolUse 훅, dynamicTools | 나중의 런타임 어댑터, 데몬 수명주기 참고 |
| Happy Agent | MIT / TS | 0.4.89-preview (10-11) | HTTP over Unix 소켓, SSE, 전역 이벤트 커서 | 예 | 세션·goal 유지, 턴 재개는 미확인 | SQLite | 토큰 파일 0600, E2E relay | 권한 모드, 플러그인 | 설계 참고 (pi 기반 데몬) |
| Paseo | Apache-2.0 / TS | 0.11.2 (10-09) | WebSocket (+ E2E relay) | 예 | 재개 가능 상태로 남김, 턴은 미확인 | JSON 파일 | 비밀번호, VPN, E2E relay, SSH | 데몬 플러그인, 도구 카탈로그 | 설계 참고 (벤더 중립 어댑터) |
| Cline hub | Apache-2.0 / TS | 4.1.23 (10-07) | WebSocket | 예 | 미확인 | 미확인 | 로컬, ROOM_SECRET | 훅, beforeDispatch | 일부 참고 |
| OpenHands agent-server | MIT / Python | 1.54.0 (10-09) | REST + WS, webhook | 예 | ERROR로 표시 후 recovery 이벤트 (자동 재개 없음) | 이벤트별 JSON 파일 | Bearer 키 | 훅, confirmation, security analyzer | 일부 참고 (Python, Docker 중심) |
| Goose | Apache-2.0 / Rust | 1.54.0 (10-08) | ACP (stdio, HTTP/WS) | 연결에 묶임 | 재개 근거 없음 | SQLite | 토큰, TLS, P2P 키 신뢰 | 훅 (command 타입) | 일부 참고 |
| pi RPC 모드 | MIT / TS | 1.1.0 (10-07) | stdin/stdout JSONL | 프로세스가 사는 동안 | 세션 파일로 재개 | JSONL | 없음 | tool_call 차단·변경, UI 요청 중계 | 런타임 어댑터 |
| pi-durable + pi-server | MIT / TS | 1.1.0, experimental | CBOR 프레임 (unix, Radius relay) | 예 | **이어서 실행** (task checkpoint) | SQLite / JSONL | 피어 인증 미구현 | beforeTool/afterTool, 사용자 Entry·Document 원자 커밋 | **재사용** |
| Crush | FSL-1.1-MIT / Go | 0.98.1 | HTTP + SSE | 미확인 | 미확인 | SQLite | 없음 | PreToolUse 1종 | 부적합 (라이선스, 실험 플래그) |
| coder/agentapi | MIT / Go | 0.12.2, 유지보수 중단 | HTTP + SSE | 메모리 | 소실 | 메모리 | 없음 | 없음 (화면 스크래핑) | 부적합 |
| Omnara | Apache-2.0 / Go | 커밋 10-09 | REST + 스트림 | 예 | 이벤트 로그 기반 | Postgres + Valkey 등 | 토큰 | 승인 API | 부적합 (구성 요소가 많음) |
| CloudCLI (claudecodeui) | AGPL-3.0 / TS | 1.37.4 | WebSocket | 일부 | 미확인 | 벤더 JSONL + DB | 자체 로그인 | UI 플러그인 | 부적합 |

모든 항목은 저장소를 내려받아 문서와 소스로 확인했다 [원문]. "미확인"은 문서와 소스에서 근거를 찾지 못한 경우다.

### 1.2 Helm이 가져올 것

- **OpenCode v2: 재시작 복구 규칙**
  - 턴을 시작할 때 "execution claim"을 시작 이벤트와 같은 트랜잭션에 기록한다.
  - 종료로 중단되면 claim을 남겨 두고, 다음 시작에서 그 턴을 이어 실행한다. 재개 횟수도 센다.
  - 소스 주석의 원칙은 "recovery is a property of the database, never of a shutdown hook"이다.
  - permission request/reply, form(사람에게 구조화된 질문), inbox(steer/queue) API는 Helm 질문·게이트 API의 형태를 정할 때 참고할 만하다.
- **pi-durable: 대화와 커널 기록을 같은 트랜잭션에**
  - 대화, 턴, 도구 호출을 먼저 저장소에 커밋한 뒤 보여 준다.
  - 사용자 정의 Entry와 Document를 같은 커밋에 넣을 수 있다. Helm 레코드를 여기에 함께 쓰면 커널 기록과 대화 기록이 어긋나지 않는다. 12 문서와 스파이크에서 확인한 방향과 같다.
  - 주의: 저장소 하나에 프로세스 하나만 허용하고, 프로세스 간 잠금이 없다.
- **Paseo: 벤더 중립 어댑터 계층**
  - 하나의 데몬 아래 pi(`--mode rpc`), Codex(app-server), Claude(Agent SDK), OpenCode(서버 API), Copilot(ACP)을 어댑터로 둔다.
  - pi 확장의 UI 요청(select, confirm)을 데몬의 권한 질문으로 연결한다.
- **Happy Agent: pi 기반 데몬의 실제 예**
  - Unix 소켓 + Bearer 토큰 파일(0600)을 쓴다.
  - 전역 durable 이벤트 큐에 UUIDv7 커서를 붙여 재생 후 이어 받기를 지원한다.
- **Codex app-server: 데몬 수명주기**
  - start/stop/restart, 종료 유예(기본 60초), 중단된 턴 스냅샷을 다룬다.
  - TUI가 실행 중인 데몬을 찾으면 붙고, 없으면 내장 서버를 쓴다.

## 2. 지속 실행 엔진과 에이전트 프레임워크

### 2.1 비교

| 이름 | 언어 / 라이선스 | 최신 | 필요한 구성 | SQLite | 사람 답 대기 | 타이머 | 자식 작업 | 클라이언트 스트림 | 판정 |
|---|---|---|---|---|---|---|---|---|---|
| pi-durable (기준선) | TS / MIT | 1.1.0 | 라이브러리, 저장소당 프로세스 1개 | O | task waiting (직접 구현) | O | child task | watchEvents | 기준선 |
| OpenWorkflow | TS / Apache-2.0 | 0.10.1 (09-16) | 라이브러리 + DB, 서버 없음 | **O** | waitForSignal (대기자가 없으면 신호 유실) | O | O | X | 채택 후보 1 |
| Absurd (earendil-works) | TS·Py·Go / Apache-2.0 | 0.5.0 (08-04) | Postgres만 | X (개념 증명만) | awaitEvent (먼저 온 이벤트도 보관) | O | O | X | 설계 참고 1 |
| Restate | Rust 서버 + TS SDK / BSL 1.1 (서버) | 1.7.13 / 1.17.3 | 단일 바이너리 + Node 서비스 | X (RocksDB) | awakeable + timeout | O | O | X | 채택 후보 3 |
| Resonate | Rust 서버 + TS SDK / Apache-2.0 | 0.9.8 | 단일 바이너리 + worker | **O (기본)** | durable promise | O | rpc | X | 대안 |
| DBOS TS | TS / MIT | 5.2.11 | 라이브러리 + Postgres | X (Python만 SQLite) | recv | O | O | writeStream | 설계 참고 |
| Temporal | Go 서버 + TS SDK / MIT | 1.32.1 / 1.24.0 | 서버 + DB | 개발 서버만 | Signal/Update | O | O | Workflow Streams | 설계 참고 |
| Inngest | Go 서버 + TS SDK / SSPL | 1.46.0 | 단일 바이너리 + 앱 | O (단일 노드) | waitForEvent (대기 이후 이벤트만) | O | invoke | Realtime | 설계 참고 |
| Vercel Workflow | TS / Apache-2.0 | 5.2.0 | 앱 + World (운영은 Postgres) | X | hook | O | O | getWritable | 설계 참고 |
| Rivet | TS·Rust / Apache-2.0 | rivetkit 2.3.26 | Engine 또는 파일 시스템 | O (actor별) | queue wait | O | O | broadcast | 설계 참고 |
| Mastra | TS / Apache-2.0 (+ee) | core 1.75.0 | 라이브러리 + libsql 등 | O (libsql) | suspend/resume | O | 중첩 workflow | observe | 별도 상세 검토 |
| LangGraph JS + Agent Server | TS·Py / MIT, 서버 Elastic-2.0 | 1.4.21 | Postgres + Redis + 라이선스 키 | checkpointer만 | interrupt (재개 시 노드 처음부터) | X | subgraph | O | 부적합 |
| Letta Code | TS / Apache-2.0 | 0.34.10 | 앱 서버, 파일 기반 | 파일 | 승인 입력 | cron | subagent | WS 2채널 + sync | 설계 참고 (control/stream 채널 분리) |
| Hatchet, Trigger.dev, Aegra, MS Agent Framework, Dapr Agents, VoltAgent | - | - | Postgres, Redis, 컨테이너 다수, 또는 Python·.NET | - | - | - | - | - | 부적합 |

버전은 npm·PyPI 레지스트리와 git 태그로 확인했다 [원문].

### 2.2 핵심 사실

- **pi 세션 전체를 엔진의 step 하나로 넣을 수는 있다.**
  - 다만 크래시가 나면 세션 전체가 다시 실행되어 LLM 비용과 도구 부작용이 반복된다.
  - Absurd의 공식 "Pi AI Agent" 패턴은 pi의 `message_end`마다 step을 하나 완료한다(메시지 단위 checkpoint). [원문]
- **사람 답이 먼저 도착하는 경우의 처리가 엔진마다 다르다.**
  - OpenWorkflow는 대기자가 없으면 신호를 버린다. Inngest는 대기 시작 이후의 이벤트만 받는다.
  - Absurd는 먼저 온 이벤트를 보관한다.
  - Helm의 질문 레코드는 답을 먼저 inbox에 저장하고, 대기 시작 시 inbox를 먼저 조회해야 한다. [원문 + 판단]
- **결정적 replay 방식의 제약**
  - Temporal, OpenWorkflow, Vercel은 step 이름이나 순서를 바꾸면 진행 중인 실행이 깨진다.
  - Absurd는 replay 대신 checkpoint를 재사용하는 방식이라 이 제약이 덜하다. [원문]
- **WSL 파일 위치**: SQLite는 `/mnt/c`가 아니라 WSL ext4 영역에 둔다. [지식]

### 2.3 Helm 데몬의 지속 실행 방식 후보 [판단]

| 안 | 구성 | 장점 | 단점 |
|---|---|---|---|
| 1. pi-durable + Helm 자체 커널 로그 (추천) | 대화와 턴은 pi-durable, 커널 커밋·질문 대기·가정 만료 타이머·혼자 정한 결정 기록은 같은 데몬의 Helm SQLite. 대기·타이머·lease 스키마는 OpenWorkflow와 Absurd에서 가져옴 | 프로세스 하나, 의존성 최소, 기준 원본 하나 | 타이머 스케줄러, lease, 멱등성을 직접 구현·검증해야 함 |
| 2. OpenWorkflow (SQLite) | 데몬 안에 worker와 client. Helm 작업 하나 = workflow 하나 | sleep, signal, 자식 workflow를 바로 씀 | 0.x, 신호 유실(inbox로 보완), run당 step 1000 상한, 스트리밍 없음 |
| 3. Restate | restate-server + Node 서비스 | 의미론이 가장 정돈됨 | BSL, 프로세스 둘, push/HTTP 모델 |

어느 안이든 커널 이벤트 로그는 Helm이 소유해야 한다. 엔진의 역할은 대기, 타이머, 재시도 스케줄링으로 좁혀진다. 그 정도 범위라면 작은 스키마를 직접 구현하는 1안이 기준 원본을 하나로 유지하기 쉽다. 클라이언트 스트리밍과 재접속은 어느 안을 택하든 데몬이 직접 만든다.

## 3. 클라이언트-에이전트 프로토콜

| 프로토콜 | 관리 / 라이선스 | 상태 | 전송 | Helm 용도 |
|---|---|---|---|---|
| ACP (Agent Client Protocol) | agentclientprotocol 조직 (Zed 시작, JetBrains 참여) / Apache-2.0 | v1. session list/resume/close/delete, elicitation, compaction 완료. fork는 Draft. 원격 전송 RFD는 Active | stdio JSON-RPC. HTTP/WS는 RFD | **런타임 어댑터 계약 1순위** |
| AG-UI | CopilotKit / MIT | interrupt 관련 필드 일부 Draft | 전송 무관 (SSE, WS) | 요청 단위(run) 모델이라 상주 데몬 관찰과는 맞지 않음. State snapshot/delta 설계만 참고 |
| A2A | Linux Foundation → AAIF / Apache-2.0 | v1.0 (2026-03) | JSON-RPC, gRPC, REST | 지금은 해당 없음 |
| MCP | AAIF / MIT | 2026-07-28 버전. 프로토콜 세션 제거, SSE 재개 제거, tasks는 확장으로 이동 | stdio, Streamable HTTP | **에이전트 → Helm 기록 도구를 노출하는 용도**. 클라이언트 계약으로는 부적합 |
| Codex app-server | OpenAI / Apache-2.0 | experimental | stdio, unix, ws | 데몬-클라이언트 설계 참고 |
| OpenCode server API | Anomaly / MIT | OpenAPI 3.1 | HTTP + SSE | 설계 참고 |
| pi RPC | earendil-works / MIT | - | stdin/stdout JSONL | 현재 런타임 직접 어댑터 |

pi-acp의 제약 [원문]:
- `pi --mode rpc`를 띄우고 중계하는 방식이다.
- 파일·터미널 위임, MCP 서버 전달, pi 확장의 slash command를 지원하지 않는다.
- 따라서 Helm이 pi 확장을 쓰려면 pi RPC 직접 어댑터가 필요할 가능성이 크다. [판단]

정리 [판단]:
- **데몬 ↔ 런타임**: pi는 RPC 직접 어댑터, 다른 런타임은 ACP 클라이언트로 붙인다.
- **데몬 ↔ 클라이언트**: 자체 JSON-RPC over WebSocket으로 한다. 세션 스트림은 ACP `session/update` 타입을 재사용하고, Helm 상태(Concern, 질문, 혼자 정한 결정, 근거 체인)는 별도 메서드로 정의한다.
- **재접속**: 데몬 이벤트 로그의 시퀀스 번호로 처리한다. 클라이언트가 `lastSeq`를 보내면 이어서 받는다. 표준 프로토콜들이 이 기능을 제공하지 않으므로 직접 만든다.

## 4. 데스크톱 앱 셸

| 항목 | Tauri v2 | Electron | Wails v3 | Electrobun |
|---|---|---|---|---|
| 최신 | 2.12.0 (09-26) | 44.7.0 (10-07) | v3 beta | 2.x |
| 백엔드 언어 | Rust | Node | Go | TS (Bun) |
| 웹뷰 | 시스템 (Windows는 WebView2) | Chromium 번들 | 시스템 | 시스템 / CEF |
| 크기 | 수 MB | 80~150MB | 수 MB | 수 MB |
| 자동 업데이트 | 플러그인 (서명 필수) | electron-updater | 예정 | 내장 |
| 모바일 | iOS / Android | 없음 | 없음 | 없음 |

- 데몬이 WSL에 있으므로 데스크톱 앱은 **얇은 클라이언트**다. React SPA가 WebSocket/HTTPS로 데몬에 붙기만 하면 된다. 그래서 Node 사이드카 지원 여부는 중요하지 않다. [판단]
- assistant-ui는 순수 React라서 어느 셸에서도 동작한다. React Native와 Ink(TUI) 변형도 있다. [원문]
- Tauri로 원격 데몬에 붙을 때 주의할 점 [지식]
  - 웹뷰 origin이 `http://tauri.localhost`(Windows) 또는 `tauri://localhost`라서 데몬 쪽 CORS 설정이 필요하다.
  - macOS에서는 `ws://` 접속이 mixed content로 막힐 수 있다. `tailscale serve`의 HTTPS/WSS를 쓰면 이 문제가 없다.
- 조사 결과의 권고는 "SPA를 먼저 만들고 PWA로 배포한 뒤 Tauri로 감싸기"였다. 데스크톱 앱을 먼저 만들기로 했으므로 **같은 SPA를 처음부터 Tauri v2로 감싸고, 필요하면 데몬이 같은 SPA를 웹으로도 서빙하는 방식**이 결정과 맞다. [판단]

## 5. WSL2 데몬 원격 접속

### 5.1 권장 구성 [판단, 세부는 원문 확인]

```
[외부 노트북 / 휴대폰]
   └─ Tailscale → https://<pc>.<tailnet>.ts.net (wss)
[Windows 호스트]
   ├─ Tailscale (Windows에만 설치, WSL 안에는 설치하지 않음)
   ├─ tailscale serve: https → http://127.0.0.1:<HELM_PORT>
   ├─ (선택) tailscale serve --tcp 2222 → 127.0.0.1:2222 (WSL sshd)
   ├─ 작업 스케줄러: 로그온 시 숨김 `wsl.exe -d <distro> --exec sleep infinity`
   └─ 전원: AC 연결 시 절전·최대 절전 끔
[WSL2, NAT 모드]
   ├─ /etc/wsl.conf: [boot] systemd=true
   ├─ helm-daemon.service (Restart=always) → 127.0.0.1:<HELM_PORT>
   │    ├─ 인증: Tailscale-User-Login 헤더 확인 + 기기별 bearer 토큰
   │    ├─ 클라이언트 API: JSON-RPC over WebSocket, 시퀀스 번호 기반 재개
   │    └─ 런타임: pi를 자식 프로세스로 실행
   └─ sshd → 127.0.0.1:2222 (키 인증만)
```

- `.wslconfig`: `[general] instanceIdleTimeout=-1`, `[wsl2] vmIdleTimeout=-1` [원문]
- WSL은 wsl.exe로 실행한 자식 프로세스가 없으면 배포판을 종료한다. systemd 서비스는 이 판단에 들어가지 않는다. 그래서 keepalive 작업이 필요하다. [원문]
- 데몬을 localhost에만 바인딩하면 NAT 모드로 충분하다. portproxy나 Hyper-V 방화벽 설정이 필요 없다. [판단]
- Tailscale Funnel은 공개 인터넷 노출이라 쓰지 않는다. [원문]
- Tailscale을 설치할 수 없는 기기가 생기면 그때 Cloudflare Tunnel + Access를 추가한다. [판단]

### 5.2 운영상 주의 [지식]

| 항목 | 대응 |
|---|---|
| 절전 / 최대 절전 | 전원 연결 시 끔. 외부에서 깨우려면 같은 LAN의 Wake-on-LAN이 필요 |
| Windows Update 재부팅 | 로그온 트리거 방식이면 로그인 전까지 데몬이 내려가 있음. 사용 시간 설정. 데몬은 재시작 후 로그로 상태를 복원하도록 설계 |
| 정전 | BIOS의 "Restore on AC power loss" |
| WSL 업데이트 | 2.5.7에서 idle 동작이 바뀐 사례가 있음. 업데이트 후 데몬 생존을 확인하는 헬스체크 |
| 로그인 전 자동 시작 | 확실한 방법이 없음. 필요하면 Windows 자동 로그온 (물리 보안과 절충) |

## 6. Helm 설계에 반영할 것 [판단]

1. 런타임은 pi를 유지하고, 데몬이 pi를 자식 프로세스로 띄운다. pi 확장으로 커널 검사를 하므로 pi RPC 직접 어댑터를 먼저 만들고, ACP 어댑터는 다른 런타임을 붙일 때 만든다.
2. 지속 실행은 pi-durable과 Helm 커널 로그(같은 SQLite 트랜잭션)로 한다. 대기·타이머·lease 스키마는 OpenWorkflow와 Absurd를 참고하고, 재시작 복구는 OpenCode의 write-ahead claim을 따른다.
3. 클라이언트 API는 자체 JSON-RPC over WebSocket과 시퀀스 번호 replay로 만든다. 세션 스트림 타입은 ACP를 재사용한다.
4. 데스크톱 앱은 React SPA + Tauri v2, UI 컴포넌트는 assistant-ui로 한다.
5. 원격 접속은 Windows Tailscale + `tailscale serve`, 인증은 Tailscale 신원과 기기별 토큰 두 겹으로 한다.
6. 에이전트가 Helm에 기록하는 도구는 pi 확장 도구로 제공한다. 다른 런타임용으로는 MCP 서버를 연다.
7. 미확인으로 남은 것: pi-server/pi-client를 Helm 데몬의 기반으로 쓸 수 있는지(experimental, 인증 없음), pi-durable과 pi RPC 모드를 함께 쓸 수 있는지.

## 7. 출처

### 제품
- OpenCode: https://github.com/anomalyco/opencode , https://opencode.ai/docs/server/
- Codex app-server: https://github.com/openai/codex (codex-rs/app-server, app-server-daemon), https://learn.chatgpt.com/docs/app-server
- Happy: https://github.com/slopus/happy , https://github.com/slopus/happy-agent
- Paseo: https://github.com/getpaseo/paseo
- Cline: https://github.com/cline/cline
- OpenHands: https://github.com/OpenHands/software-agent-sdk , https://github.com/OpenHands/OpenHands
- Goose: https://github.com/aaif-goose/goose
- Crush: https://github.com/charmbracelet/crush
- agentapi: https://github.com/coder/agentapi
- Omnara: https://github.com/omnara-ai/omnara
- CloudCLI: https://github.com/siteboon/claudecodeui
- pi (rpc, durable, server, client, protocol): https://github.com/earendil-works/pi

### 지속 실행과 프레임워크
- OpenWorkflow: https://github.com/openworkflowdev/openworkflow
- Absurd: https://github.com/earendil-works/absurd , https://earendil-works.github.io/absurd/patterns/pi-ai-agent/
- Restate: https://github.com/restatedev/restate , https://docs.restate.dev/ai
- Resonate: https://github.com/resonatehq/resonate
- DBOS: https://docs.dbos.dev/typescript/reference/configuration
- Temporal: https://docs.temporal.io/develop/typescript/integrations/ai-sdk
- Inngest: https://www.inngest.com/docs/self-hosting
- Vercel Workflow: https://github.com/vercel/workflow
- Rivet: https://github.com/rivet-dev/rivet
- Mastra: https://mastra.ai/docs/long-running-agents/durable-agents.md
- LangGraph: https://docs.langchain.com/oss/javascript/langgraph/interrupts
- Letta Code: https://github.com/letta-ai/letta-code

### 프로토콜
- ACP: https://agentclientprotocol.com/ , https://agentclientprotocol.com/rfds/streamable-http-websocket-transport
- pi-acp: https://github.com/svkozak/pi-acp
- AG-UI: https://docs.ag-ui.com/concepts/events
- A2A: https://a2a-protocol.org/latest/specification/
- MCP 2026-07-28 변경: https://modelcontextprotocol.io/specification/2026-07-28/changelog

### 데스크톱과 WSL
- Tauri: https://v2.tauri.app/release/tauri/
- Electron: https://endoflife.date/electron
- assistant-ui: https://github.com/assistant-ui/assistant-ui
- WSL 네트워킹·설정: https://learn.microsoft.com/en-us/windows/wsl/networking , https://learn.microsoft.com/en-us/windows/wsl/wsl-config
- WSL idle 종료 이슈: https://github.com/microsoft/WSL/issues/13291
- Tailscale on WSL2: https://tailscale.com/kb/1295/install-windows-wsl2
- Tailscale Serve: https://tailscale.com/kb/1312/serve
