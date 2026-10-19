# pi 사례 정리 (0단계 S4)

- 작성: 2026-10-11, S4(사례 정리)
- 목적: 사례 저장소 8곳을 코드로 확인해 데몬, 프로토콜, 인증, 지속성·크래시 복구, 스케줄러, 클라이언트, pi 활용 방식을 정리한다. 데몬(P11), 프로토콜(P12), 앱(P13), 런타임(P7), pi 활용(P4) 설계자가 참고한다.
- 범위 밖: Helm 설계 결정. 이 문서는 사실과 참고 후보만 적는다. 채택 여부는 각 설계 문서가 정한다.
- 입력: `docs/design/process/00-design-brief.md`, `docs/v0.3/audit/backend-oss-research.md`, `docs/v0.3/audit/pi-runtime-options.md`, `docs/v0.3/audit/mastra-review.md`, 사례 저장소(`~/projects/_ref/`, 읽기 전용).

## 0. 읽는 법

### 0.1 경로 표기

- 코드 근거는 `<사례>/<저장소 안 경로>:<행>` 형식으로 적는다. 기준 디렉터리는 `~/projects/_ref/`다. 예: `happy-agent/packages/happy-agent-base/sources/AgentBase.ts:4296-4304`.
- 한 절 안에서 같은 사례의 경로가 이어지면 사례 이름을 생략할 때가 있다.
- pi 소스는 `pi-src/`(커밋 `cdaf6c2`)로 적는다.

### 0.2 확인 수준

- [원문]: 소스나 저장소 안 문서를 직접 읽어 확인했다. 표시가 없는 사실 문장은 모두 [원문]이다.
- [추정]: 확인한 사실을 바탕으로 한 추측이다.
- 확인 못 함: 근거를 찾지 못했다.

### 0.3 기준 커밋

| 사례 | 커밋 | 날짜 | 비고 |
|---|---|---|---|
| happy-agent | `50cc885` | 2026-10-11 | shallow. 이력은 별도 blobless 클론(2,501 커밋)으로 확인 |
| paseo | `804335b` | 2026-10-11 | shallow. 이력은 별도 blobless 클론(5,798 커밋)으로 확인. v0.11.2 |
| pi-web | `4bd0953` | 2026-10-09 | shallow. 이력은 CHANGELOG(커밋 해시 포함)로 대신 확인 |
| pi-fabric | `9cea25d` | 2026-10-11 | shallow. v0.112.0. 이력은 코드 주석·테스트·이슈 번호로 대신 확인 |
| openclaw | `3258dd87` | 2026-10-11 | shallow. 2026.9.9. 이력은 `CHANGELOG/*.md`로 확인 |
| absurd | `5b97022` | 2026-08-04 | 0.5.0 직후 |
| pi-acp | `04d0a15` | 2026-10-05 | 0.0.34 |
| pi-chat | `9adbd29` | 2026-06-05 | 커밋 1개 |

### 0.4 조사 방법과 한계

- absurd, pi-acp, pi-chat은 S4가 직접 읽었다. happy-agent, paseo, pi-web, pi-fabric, openclaw는 하위 에이전트가 읽고 근거 행을 붙인 메모를 S4가 받아 정리했다. 메모 원본은 `.helm-design-work/S4/*.md`에 있다.
- 핵심 근거 몇 개는 S4가 다시 열어 확인했다: `happy-agent/.../AgentBase.ts:4303`, `openclaw/packages/gateway-client/src/protocol-client.ts:482`, `openclaw/src/gateway/server-broadcast.ts:218,444`, `openclaw/src/agents/tool-replay-safety.ts:6-28`, `pi-fabric/src/durable/agent.ts:16-20`, `paseo/packages/server/src/server/agent/agent-timeline-store.ts:49,102-121`, `happy-agent/.../ApiEventJournal.ts:35`, `pi-src/packages/agent/src/types.ts:489-490`.
- 대부분 shallow clone이라 `git log -S`가 되지 않았다. happy-agent, paseo는 하위 에이전트가 scratchpad에 별도 클론을 만들어 이력을 봤다. 나머지는 CHANGELOG와 코드 주석에 기댔다.
- 별도 저장소(Happy 데스크톱·모바일, Paseo relay 서버)는 확인하지 못했다.

## 1. 요약

1. **사례 8곳 중 데몬 재시작 뒤에도 같은 커서로 이벤트를 다시 받을 수 있는 클라이언트 프로토콜은 없다.**
   - happy-agent: 클라이언트 이벤트 저널이 메모리 10,000개 창이고, 데몬이 재시작하면 모든 커서가 gap이 된다.
   - paseo: 타임라인이 메모리에 있고, 에이전트 로드마다 `epoch`가 바뀐다.
   - pi-web: seq가 메모리 카운터라 재시작하면 0부터 다시 센다.
   - openclaw: seq가 연결별 카운터다. gap이면 재접속하고 스냅샷으로 맞춘다.
   - 영속 시퀀스와 `after` 커서를 가진 것은 pi-fabric의 로컬 mesh 이벤트 로그(`events.jsonl`)뿐이다. 이것은 네트워크 클라이언트 프로토콜이 아니다.
   - Helm 브리프 31번(lastSeq 재전송)은 사례에서 그대로 가져올 구현이 없다. 재접속 순서, 스냅샷 경계, 세대 감지는 사례에서 가져올 수 있다.
2. **크래시 복구에서 "결과 없는 도구 호출을 다시 실행하지 않는다"는 규칙은 세 사례에 공통으로 있다.**
   - happy-agent: 도구마다 `durable`/`reloadable` 플래그를 두고, 아닌 호출은 "interrupted by a restart and was not retried" 오류 결과로 닫는다.
   - pi-fabric: intent를 먼저 커밋하고, 재시작 시 "생성 시점 선언이 safe이고 현재 선언도 safe"일 때만 재실행한다.
   - openclaw: 매달린 호출을 재실행하지 않고, 재개 턴의 도구 집합을 replay-safe 허용 목록으로 좁힌다.
   - pi-agent-core에는 이미 `AgentTool.replay?: "never" | "safe"` 필드가 있다(`pi-src/packages/agent/src/types.ts:489-490`).
3. **pi를 깊게 쓴 사례는 시간이 지나며 pi 의존이 줄었다.**
   - openclaw: pi SDK 임베드 → 2026.5.22에 런타임 내부화, 지금은 pi-tui만 남았다.
   - happy-agent: pi-ai를 3주(2026-07-04~07-23)만 썼고, pi-tui는 2026-10-10에 TUI와 함께 제거했다. pi 런타임(agent-core, coding-agent)은 한 번도 의존하지 않았다.
   - paseo: pi-acp(ACP) → coding-agent SDK 임베드 → `pi --mode rpc` 자식 프로세스 순으로 옮겼다. 지금 pi 패키지 의존은 0이다.
   - pi-web, pi-fabric은 pi 패키지에 정확한 버전이나 peer 범위로 의존한다. 둘 다 업그레이드 사고 기록과 버전 검사 장치가 있다.
4. **단일 writer 보장은 "OS가 쥐는 SQLite 쓰기 트랜잭션" 방식이 두 곳에서 쓰인다.** happy-agent(`<db>.lock` 형제 파일), pi-fabric(`lease.sqlite`에 `BEGIN EXCLUSIVE`). 프로세스가 죽으면 커널이 락을 푼다. stale 락 정리가 필요 없다.
5. **원격 접속 방식은 제각각이다.** paseo는 E2E relay(QR 페어링, X25519)와 Tailscale IP 직접 바인딩, happy-agent는 Unix 소켓 + 토큰 파일과 모바일 E2E relay, openclaw는 Ed25519 기기 서명 + 기기 토큰 + `tailscale serve` 신원 헤더(whois 대조), pi-web은 인증 없음(VPN 권장)이다. Helm 브리프 26번 구성(127.0.0.1 + `tailscale serve` + 신원 헤더 + 기기 토큰)과 가장 가까운 것은 openclaw다.
6. **기존 조사 문서와 다른 점이 여럿 있다.** 13장에 판정 표를 둔다. 큰 것은 다음과 같다.
   - happy-agent는 "pi 기반 데몬"이 아니다. 클라이언트 이벤트 큐도 durable이 아니다. 재시작 뒤 진행 중 턴은 이어서 실행한다.
   - paseo는 ACP에서 RPC로 바로 옮긴 것이 아니다. 중간에 SDK 임베드 단계가 있었다.
   - pi-fabric은 사람 승인 단계가 있고, 루프는 pi-durable 내장 루프가 아니라 자체 구현이다.
   - "재시작 후 진행 중 턴을 이어서 실행하는 것은 OpenCode v2, Codex, pi-durable 정도"라는 진술에 happy-agent와 openclaw를 더해야 한다.

## 2. 사례 한눈에 보기

| 사례 | 무엇 | 언어·런타임 | 프로세스 구조 | pi 활용 (현재) |
|---|---|---|---|---|
| happy-agent | 1인용 로컬 코딩 에이전트 하네스 데몬. 팀 모드도 있음 | TS, pnpm, Node 또는 Bun 단일 바이너리 | 데몬 1개(모듈 50여 개), Rust 샌드박스 supervisor, 클라이언트는 별도 저장소(Electron, 모바일) | 없음. pi-ai(07-04~07-23), pi-tui(07-04~10-10) 사용 이력 |
| paseo | 여러 코딩 에이전트 CLI를 모바일·데스크톱·웹·CLI에서 제어하는 데몬 | TS, npm workspace, Node | supervisor → worker(데몬), 에이전트는 provider 자식 프로세스. 클라이언트는 Expo 앱, Electron, CLI | `pi --mode rpc` 자식 프로세스 + 주입 확장. pi 패키지 의존 0 |
| pi-web | pi 세션을 위한 웹 UI와 세션 데몬 | TS, Node ≥22.19, Fastify, Lit PWA | `pi-web-sessiond`(SDK 임베드, 세션 소유) + `pi-web-server`(웹/API, 프록시). systemd 사용자 서비스 둘 | coding-agent SDK 임베드(peer `^1.0.0`) |
| pi-fabric | pi 확장. 모델에 `fabric_exec` 하나를 주고 프로그램으로 도구·에이전트·mesh를 다룸 | TS, Node ≥24, 개발은 bun | pi(Main) 안의 확장 → 자식 에이전트마다 워커 → 러너 자식(`pi-durable` 기본) → 선택적 상주 호스트 | pi-durable 1.1.0 고정 + coding-agent 1.1.0 alias 사본 + `Agent` 상속 |
| openclaw | 다중 채널 AI gateway. 메신저, 모바일 노드, 웹 Control UI | TS, Node 24.16+, pnpm 모노레포, Swift/Kotlin 앱 | Gateway 데몬 1개(WS+HTTP 한 포트), 클라이언트는 macOS/iOS/Android/웹/TUI, node 역할 기기 | pi-tui 1.0.0만. 런타임은 2026.5.22에 내부화 |
| absurd | Postgres만으로 도는 durable execution 라이브러리 | SQL(plpgsql) + TS·Python·Go SDK | 워커가 Postgres에서 pull. 서버 없음 | 문서 패턴 하나(pi-agent-core + pi-ai) |
| pi-acp | pi를 ACP(Zed 등)에 붙이는 어댑터 | TS, Node ≥20 | ACP 클라이언트 ↔ pi-acp(stdio) ↔ `pi --mode rpc` 자식 | 사용자가 설치한 pi CLI를 RPC로 실행 |
| pi-chat | Discord·Telegram을 pi 세션에 연결하는 확장 | TS | pi 프로세스 안 확장, 채널마다 Gondolin VM, tmux 워커 | pi 확장 API + coding-agent 도구 팩토리(`create*Tool` + operations) |

## 3. happy-agent

### 3.1 무엇인지, 프로세스 구조

- 1인용 로컬 "코딩 에이전트 하네스" 데몬이다. Codex, Claude Code, Grok Build의 프롬프트와 도구를 모델별로 재현하고 세션, 권한, 샌드박스, 영속성, API를 공유한다(`happy-agent/docs/architecture.md:11-30`).
- 데몬 명령은 `happy-agent run|start|stop|kill|status|reload`다(`packages/happy-agent/sources/lifecycle/runAgentDaemon.ts:17-24`). 상태 디렉터리 `~/.happy/agent`에 `token`, `daemon.pid`, `daemon.log`, 소켓을 둔다(`.../lifecycle/getHappyDaemonPaths.ts:21-35`). DB는 `agent.sqlite`와 `auto-agent.sqlite`다(`packages/happy-agent-modules/sources/config/ConfigModule.ts:3218,3223`).
- `startHappyAgentRuntime`이 `*Module` 50여 개를 만들어 `AgentSystemLocal` 하나에 조립한다(`packages/happy-agent-modules/sources/runtime/startHappyAgentRuntime.ts:340-583,751-763`).
- 루프는 `@slopus/happy-agent-base`의 `AgentBase`(5,362행), 프로바이더는 자체 `@slopus/happy-providers`, 샌드박스는 Rust 바이너리 `happy-agent-supervisor`(Linux namespace + seccomp, macOS Seatbelt)다(`packages/happy-agent-supervisor/README.md:1-30`).
- 클라이언트: Happy 데스크톱(Electron, 별도 저장소), Happy 모바일(릴레이 경유, 별도 저장소), 타입 클라이언트 `@slopus/happy-agent-client`. pi-tui 기반 TUI는 2026-10-10 커밋 `bf103003`("Remove the terminal UI")로 제거됐다. 이유: "Happy Agent is a headless daemon … the terminal surface was a second product the repository no longer maintains".

### 3.2 pi 활용 이력

| 시점 | 커밋 | 내용 |
|---|---|---|
| 2026-07-04 | `b473459e` | README에 "ohmypi is an opinionated fork of pi". 최초 트리에 pi 소스를 들여온 흔적은 없고 자체 `sources/agent/loop.ts`가 있다 |
| 2026-07-04 | `19dff46e` | `@mariozechner/pi-ai ^0.73.1` 추가. `sources/providers/pi-bridge.ts`가 `streamSimpleOpenAICodexResponses` 사용 |
| 2026-07-04 | `14a9f3eb` | 에이전트 루프 자체 구현("Add agent tool loop") |
| 2026-07-04 | `4eb13f31` | `@earendil-works/pi-tui ^0.80.3` 추가(TUI) |
| 2026-07-12 | `5d8c60a8` | pi-ai 네임스페이스 이전(`@earendil-works/pi-ai ^0.80.6`) |
| 2026-07-22~23 | `6d189be1`, `3939ed92`, `54b4a58e`, `3f11d66b` | 자체 provider 패키지 도입, pi-bridge와 pi-ai 의존 삭제 |
| 2026-10-10 | `bf103003` | TUI 제거로 pi-tui 의존 삭제 |

- pi-agent-core와 pi-coding-agent는 package.json 이력에 한 번도 나오지 않는다.
- 제거 이유는 커밋 본문에 없다. 문서는 provider의 목적을 "native client의 요청과 같아 보이게"로 적고, prompt-cache prefix 안정성, stateful 세션, 네이티브 컴팩션, golden-trace 테스트를 요구한다(`docs/architecture.md:228-255`). [추정] 범용 stateless 스트림 API인 pi-ai로는 이 요구를 맞추기 어려워 자체 provider 계층으로 옮겼다.
- 문서 표류: 루트 `README.md:150-154`는 아직 "Pi's inference adapters"를 쓴다고 적는다. `docs/architecture.md:463`은 "Pi is not a provider or toolset"이라고 적는다.

### 3.3 클라이언트-서버 프로토콜

- **전송**: 단독 모드는 HTTP/1.1 over Unix 도메인 소켓, TCP 리스너 없음. 소켓 0600, 디렉터리 0700(`packages/happy-agent/API.md:11-16`, `packages/happy-agent/sources/socket/AgentSocket.ts:55-59`). 경로는 모두 `/v0`. 라우트는 `packages/happy-agent-modules/sources/api/ApiModule.ts`(7,981행) 한 파일의 if 체인이다.
- **이벤트**: SSE `GET /v0/events/stream`. 터미널만 WebSocket 바이너리(`REMOTE_TERMINALS.md:9-15,45-49`). JSON 본문 상한 48 MiB, SSE 버퍼 64 MiB 초과 시 끊음, 하트비트 15초(`ApiModule.ts:297-299`).
- **envelope** (`.../api/ApiEventJournal.ts:12-20`):

  ```ts
  export const apiEventSchema = Type.Object({
      cursor: eventIdSchema,          // UUIDv7
      occurredAt: Type.Integer(...),
      payload: Type.Unknown(),
      type: apiEventTypeSchema,       // "^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$"
  }, { additionalProperties: false });
  ```

  SSE 프레임은 `id: ${cursor}\nevent: ${type}\ndata: ${JSON}`(`ApiModule.ts:7625`).
- **이벤트 목록**(`packages/happy-agent-client/sources/protocol/events.ts:389-460`): `agent.created/updated/context.updated/draft.updated/…`, `message.created/updated/delta/deleted`, `run.started/finished/boundary`, `question.created/updated`, `process.started/updated/exited`, `project.*`, `workspace.*`, `terminal.*`, `task.*`, `artifact.*`, `config.updated`, `daemon.draining` 등.
- **스트리밍 텍스트**: `message.delta`에 `messageId`, `blockIndex`, `offset`을 붙여 append한다. 겹치거나 중복된 delta는 무시하고, 구멍이 나면 전체 재조회(`reconcile`)한다(`packages/happy-agent-client/sources/applyMessageDelta.ts:4-40`).
- **리소스 갱신**: `*.updated {previousVersion, version, changes, mutationId?}`, version은 UUIDv7. 사본 version이 previousVersion과 같으면 병합, 다르면 다시 읽는다. 사람이 바꾸는 리소스는 `If-Match`로 낙관적 동시성, 충돌하면 409와 현재값(`API.md:368-411`). `mutationId`는 확인용이고 멱등 키가 아니다(`API.md:412-423`). 메시지는 클라이언트가 정한 CUID2 `id`로 보낸다(`API.md:4361-4400`).
- **재접속·재전송**:
  - pull: `GET /v0/events?after&until&limit`(기본 100, 최대 10,000). 커서가 창 밖이면 `409 cursor_unavailable`(`ApiModule.ts:4438-4454`).
  - stream: `Last-Event-ID` 또는 `?after`로 재개. 순서는 (1) 먼저 subscribe하고 재생 중 이벤트는 `pending`에 모은다, (2) `hello {cursor, gap, resumed, connectedAt, daemonId, daemonStartedAt, draining}`, (3) 최대 10,000개 재생, (4) `pending` 중 `cursor > current`만 보낸다(`ApiModule.ts:4456-4530`). 커서가 창 밖이면 `gap: true`를 보내고 live만 보낸다(`:4497-4501`).
  - 버퍼: `ApiEventJournal`은 **메모리 배열**, 기본 용량 10,000(`ApiEventJournal.ts:35-36,52-58,64-80`). 데몬 재시작 시 새 origin 커서를 만들어 예전 커서는 모두 gap이 된다.
  - 내부 durable 저널은 따로 있다: SQLite `happy_agent_events(event_id UUIDv7, agent_id, occurred_at, type, payload_json, payload_bytes)`, 10,000개·32 MiB, payload 최대 5 MiB(`.../events/EventsDatabase.ts:19,57-110`, `.../events/EventsModule.ts:101`). 이것이 API 저널로 변환되어 흐른다(`ApiModule.ts:1999,2518`).
  - 클라이언트(`HappyAgentClient.updates()`)는 지수 백오프로 재접속하고 중복·역순을 버린다. `daemonId`가 바뀌면 `daemon_started`, gap이거나 resumed가 아니면 `state_lost`를 낸다(`packages/happy-agent-client/sources/updates.ts:68-96`).
  - 스냅샷 `GET /v0/bootstrap/desktop`, `GET /v0/agents/:id/bootstrap`은 읽기 **전에** 커서를 잡아 응답에 넣는다(`API.md:7241-7250`). 메시지 이력은 페이지(기본 50, 최대 500, `ApiModule.ts:3990-4010`).
- **버전 관리**: `/v0` + 정수 `HAPPY_AGENT_PROTOCOL_VERSION = 26`, `HAPPY_AGENT_MIN_PROTOCOL_VERSION = 22`(`packages/happy-agent-client/sources/protocol/daemon.ts:13-25`). 핸드셰이크 협상은 없다. 클라이언트가 `GET /v0/health`의 `version.protocol`을 보고 판단한다. 22 이상은 additive-only, 기능별 최소 번호를 문서에 적고, 번호를 올리지 않은 기능은 404/501로 감지한다(`API.md:208-299`).
- **큰 파일**: 원시 바이트 업로드 `POST /v0/artifact-uploads`(≤256 MiB) → sha256과 24시간 1회용 `uploadId`(`API.md:6035-6070`). 다운로드는 `Range` → 206(`API.md:6020-6022`). 작업 파일은 JSON+base64와 `expectedHash` CAS(`API.md:3383-3403`). 메시지 이미지는 send 본문 base64.

### 3.4 인증·원격·비밀

- **로컬 토큰**: `randomBytes(32).toString("base64url")`을 `<agentHome>/token`에 tmp→rename으로 0600 저장, 디렉터리 0700(`.../api/prepareLocalApiToken.ts:7-56`). 재시작해도 회전하지 않는다. 회전하면 재접속하는 SSE 클라이언트가 401을 받기 때문이다(`packages/happy-agent/sources/lifecycle/daemonToken.ts:16-37`). 검사는 Bearer + `timingSafeEqual`(`ApiModule.ts:7028-7041`).
- **팀 모드**: TCP + WorkOS JWT(`API.md:11-19`).
- **데몬↔데몬 원격**: Tailcat v0.7.0(WireGuard 터널, 내장 바이너리). 연결과 암호화만 맡고 권한은 API 토큰이나 WorkOS로 판정한다(`docs/architecture.md:84-89`).
- **모바일 E2E relay**: 데몬이 2분짜리 ephemeral 키 요청을 만들고 `happy://` 데이터를 돌려주면 클라이언트가 QR로 그린다. 암호화는 secretbox(legacy) 또는 스코프별 AES-256-GCM 데이터 키를 계정 공개키로 wrap(dataKey). 릴레이는 암호문만 다루고, "Encrypted v3 HTTP messages are authoritative; the Happy socket only wakes synchronization"(`INTEGRATIONS.md:8-28`, `.../happy/HappySessionClient.ts:827-880`).
- **비밀 저장**: SQLite 안 평문 JSON, 파일 0600(`docs/architecture.md:387-389`).

### 3.5 지속성·크래시 복구

- **저장소**: libSQL(`@libsql/client`) + drizzle. `journal_mode=WAL`, `synchronous=FULL`, `foreign_keys=ON`, `busy_timeout` 250→5000. 시작 시 쓰기 트랜잭션을 한 번 열고 롤백해 크래시 복구를 기다린다(`packages/happy-agent-base/sources/openAgentSQLiteDatabase.ts:40-63`).
- **실행 소유권**: 형제 파일 `<db>.lock`에 SQLite 쓰기 트랜잭션을 프로세스 수명 동안 잡는다. SIGKILL에도 커널이 풀고, 두 번째 프로세스는 `AgentSQLiteDatabaseLockedError`로 실패한다(`.../AgentSQLiteProcessLock.ts:22-50`). CAS나 다중 소유자 조정은 일부러 넣지 않았다(`packages/happy-agent-base/README.md:28-31`).
- **코어 DDL**(`.../AgentStorage.ts:127-157`): `happy_agent_migrations(module_key, migration_key, position)`, `happy_agent_records(owner_id, position, record_json)`(에이전트별 append-only), `happy_agent_values(owner_id, key, value_json)`(KV). 마이그레이션은 모듈마다 `[key, fn]` 배열.
- **원칙**: "Database first, memory second"(`docs/architecture.md:142-143`). 메모리 반영과 이벤트 발행은 `afterCommit`에서만(`packages/happy-agent-base/README.md:52-62`).
- **도구 플래그**(`.../AgentTool.ts:123-146`): `durable`(재시작 후 다시 실행해도 안전), `reloadable`(drain 때 결과 없이 버리고 다음 프로세스가 같은 call ID로 다시 실행), `steerable`(steering·종료가 abort), `transactional`(execute와 결과 commit을 한 트랜잭션).
  - 실제 값: `exec_command`·`Bash`·`Write`·`Edit`는 `durable: false`, `Read`는 `durable: true, reloadable: true`, `wait`는 `durable: true, steerable: true`(`packages/happy-agent-modules/sources/compute/tools/codex/exec_command.ts:90`, `.../claude/Bash.ts:109`, `.../claude/Write.ts:57`, `.../claude/Edit.ts:66`, `.../claude/Read.ts:131-132`, `.../scheduling/tools/wait.ts:20-21`).
  - 재시작으로 재개할 때 durable·reloadable이 아닌 호출은 실행하지 않고 `"The tool call was interrupted by a restart and was not retried."` 오류 결과로 닫는다(`.../AgentBase.ts:4296-4304,4384-4389`).
- **배치 불변식**(`AgentBase.ts:320-337`): 배치는 실행 전에 commit한다(커밋 안 된 배치는 "실행 안 됨"이 확실하므로 새로 dispatch). 결과는 배치 순서대로 commit. 대화에 답 없는 tool call을 남기지 않고, 로드 때 고아 호출을 원자적으로 고친다. 결과 commit은 first-writer-wins(`call.commit`, `README.md:112-120`).
- **단계 기록**: `pending.stage ∈ {inference, tools, compaction, settlement}`(`.../AgentBasePending.ts:16-44`). 배치 결과가 모두 commit되면 같은 트랜잭션에서 stage를 `inference`로 기록한다(`AgentBase.ts:4280-4285`).
- **진행 중 추론**: 이전 프로세스의 스트리밍 응답은 버리고 durable `block_reset`을 낸 뒤 같은 run ID로 다시 요청한다(`AgentBase.ts:3065-3072,3104-3130`).
- **재개 주체**: `AgentSystemLocal#start`가 저장된 모든 에이전트에 남은 일이 있는지 묻고 있는 것만 인스턴스화한다. 판단 기준은 durable pending 레코드다(`.../AgentSystemLocal.ts:756-790`, `AgentBase.ts:368-373`).
- **재시도**: `retryForever`이면 provider 오류에 지수 백오프 무한 재시도. commit된 도구 효과는 다시 실행되지 않는다(`README.md:21-26`).
- **graceful drain** `POST /v0/drain`: 새 mutation 503, 진행 중 추론은 마침, 시작 안 한 배치는 다음 프로세스로 넘김(`API.md:1565-1600`).

### 3.6 스케줄러·백그라운드·알림

- `wait`/`wait_until`(최대 24시간): 짧은 트랜잭션으로 claim → 트랜잭션 밖에서 대기 → 짧은 트랜잭션으로 settle. 재시작하면 남은 시간만큼 다시 기다린다. 새 메시지가 오면 중단(`.../scheduling/README.md:18-40`).
- `schedule_message`: pending 행 + afterCommit 알람. 시작 시 모든 pending을 다시 무장. 메시지 ID를 한 번만 accept하므로 재전달이 중복되지 않는다. 결과는 delivered/undelivered/cancelled(`scheduling/README.md:42-58`).
- cron 구현은 없다. 반복은 presence 스케줄(반복 시간창)뿐(`.../presence/README.md:39-42`).
- goal: 에이전트마다 하나. active goal은 completed/blocked/paused/cleared까지 계속. 외부 활성화는 같은 트랜잭션에서 wake, 외부 pause/clear는 commit 후 abort, 실패·중단 시 paused(`.../goal/README.md:1-60`).
- 푸시 알림 구현은 데몬에 없다. 릴레이로 `turn-end` 이벤트를 보내는 것까지(`.../happy/HappyProtocol.ts:41-60`). [추정] 푸시는 Happy 서버가 보낸다.

### 3.7 클라이언트·상태 동기화

- 동기화 방식은 "REST 스냅샷 + 버전 체인 델타 이벤트 + gap이면 재동기화"(`API.md:6741-6780`). `HappyReducer`는 React 외부 스토어로 SSE를 먼저 열고 스냅샷을 나중에 가져와 레이스를 보정한다. dirty 레플리카는 동시 3개까지 재동기화(`packages/happy-agent-client/sources/HappyReducer.ts:18-20,48-58`).
- 모바일 오프라인(데몬 쪽): 세션별 `last_remote_seq` 커서와 bounded outbox `happy_agent_happy_outbox(agent_id, position, local_id UNIQUE, payload_json, deferred)`, 50개씩 flush, ack 트랜잭션으로 삭제, deferred 최대 10,000(`.../happy/HappySyncDatabase.ts:28-69`).
- 앱 자체의 오프라인 저장소는 별도 저장소라 확인 못 함.

### 3.8 Helm 참고

- 가져올 것: 도구 플래그와 재시작 처리(3.5), 배치 선 commit + stage 기록, `block_reset`, 형제 lock 파일, SSE 재개 순서와 `hello.daemonId`, 커서를 먼저 잡는 스냅샷, offset delta, version 체인 + If-Match, 프로토콜 번호 체계, drain API, 토큰 비회전, 1회용 uploadId, wait/schedule_message 패턴.
- 피할 것:
  - 클라이언트 저널을 메모리에만 두고 고빈도 `message.delta`가 같은 창을 쓰는 것(`ApiEventJournal.ts:35-80`).
  - 7,981행 단일 라우터(`ApiModule.ts`).
  - 문서 표류(`EVENTS.md`, `docs/architecture.md:109,133-143,334,401-410`, `README.md:150-154`).
  - 비밀 평문 저장(`docs/architecture.md:387-389`).
  - 범용 플러그인 런타임을 일찍 만드는 것. 플러그인 설계를 세 번 바꿨다(`INTEGRATIONS.md:247-252`, `master-plans/13-plugins.md:3-8`).

## 4. paseo

### 4.1 무엇인지, 프로세스 구조

- 로컬 코딩 에이전트(Claude Code, Codex, Copilot, OpenCode, Pi, OMP 등)를 모바일·데스크톱·웹·CLI에서 모니터링·제어하는 클라이언트-서버 시스템(`paseo/docs/architecture.md:3-5`).
- 패키지(`docs/architecture.md:44-198`): `packages/server`(데몬), `packages/protocol`(zod 와이어 스키마, 7,642행 `messages.ts`), `packages/client`(WS 드라이버 + SDK), `packages/app`(Expo, RN 0.81.5, React 19.1.0, iOS/Android/웹), `packages/desktop`(Electron 44, 데몬을 관리 하위 프로세스로 띄움), `packages/cli`(Commander), `packages/relay`(E2E 채널 라이브러리, 운영 relay 서버는 별도 Elixir 저장소), `packages/plugin`.
- 데몬은 supervisor → worker 구조. worker가 `createPaseoDaemon`을 실행하고 `paseo:shutdown/ready/restart` 메시지를 주고받는다(`packages/server/src/server/daemon-worker.ts:3,12-25`). 기본 바인딩 `127.0.0.1:6767`(`docs/architecture.md:485`).

### 4.2 pi 활용

- 현재: pi 패키지 의존 0. 사용자가 설치한 `pi`를 `--mode rpc` 자식 프로세스로 띄운다. "the server package does not embed Pi's SDK/runtime packages"(`docs/providers.md:70`). 실행 `packages/server/src/server/agent/providers/pi/cli-runtime.ts:54-82`, 인자 `pi/runtime.ts:81-145`(`--mode rpc`, `--model`, `--thinking`, `--session <file>`|`--no-session`, `--mcp-config`, `--extension`).
- 쓰는 RPC 명령: `prompt`, `steer`, `clear_queue`, `compact`, `set_auto_compaction`, `abort`, `get_state`, `get_messages`, `get_available_models`, `set_model`, `set_thinking_level`, `get_session_stats`, `get_commands`, `extension_ui_response`(`pi/rpc-types.ts:133-146`). 받는 이벤트: `agent_start`, `turn_start`, `message_start/update/end`, `tool_execution_start/update/end`, `compaction_start/end`, `agent_end`, `agent_settled`, `auto_retry_start/end`, `extension_ui_request`, `command_output`(`pi/rpc-types.ts:157-226`).
- 재개: `nativeHandle`에 pi JSONL 세션 파일을 담고 재개 시 `--session <file>`(`pi/agent.ts:1473-1480`).
- **주입 확장과 notify 마커**: 에이전트마다 임시 `paseo-integration.mjs`(0600)를 생성해 `--extension`으로 넘긴다(`pi/agent.ts:616-770`). 확장은 MCP 서버 등록, 시스템 프롬프트 덧붙임, 엔트리 ID·트리 상태 수집, 내부 명령(`paseo_capture_entries`, `paseo_tree`)을 맡는다. RPC 스트림에 없는 상태는 `ctx.ui.notify("<MARKER> " + JSON)`로 빼낸다. 마커는 `PASEO_ENTRY_CAPTURE`, `PASEO_SUBMITTED_USER_ENTRY`, `PASEO_COMMAND_RESULT`(`pi/agent.ts:102-104,880-894,1938-2025`). 계약 주석: "Reports state that Pi's RPC stream omits through `ctx.ui.notify`"(`pi/extensions/contract.ts:78-79`).
- **변천**(별도 클론 이력):

  | 날짜 | 커밋 | 방식 | 근거 |
  |---|---|---|---|
  | 2026-04-04 | `65573499` | 번들 pi-acp(ACP) 하위 프로세스 | pi-acp가 thinking level을 ACP mode로, bash를 kind "other"로 보고해 변환기 4개가 필요 |
  | 2026-04-19 | `fbc2371b` | `@mariozechner/pi-coding-agent` SDK 인프로세스 | "Replace the ACP-based Pi provider … with a direct in-process integration", CHANGELOG 0.1.60 |
  | 2026-05-19 | `4cf985c2` | `pi --mode rpc` 자식 프로세스, SDK 제거 | 지운 문서 문장: Pi 0.75+는 `~/.pi/agent/npm/`에서 확장을 로드하는데 구 패키지는 global root를 봐서 확장을 놓치거나 낡은 것을 로드. CHANGELOG 0.1.79 "Runs through your installed Pi CLI, so your Pi extensions and configuration carry over"(`CHANGELOG.md:1711-1716`) |
  | 2026-05-22 | `af10e64f` | 확장 UI 다이얼로그 → 권한 프롬프트 | `CHANGELOG.md:1679` |
  | 2026-05-25 | `132e572d` | 주입 확장 + 엔트리 캡처 마커 | "in-process tree primitives" |

- **pi 업그레이드·수명주기 수정**: pi 0.84가 `message_update`의 누적 `message`를 빼서 첫 delta에 데몬이 크래시 루프(`98d3281c`, `COMPAT(piCumulativeMessageUpdate)` `pi/rpc-types.ts:169-171`), Pi 0.99 내장 MCP 변화(`4417d7c4`), 구 OMP `get_session_stats` 부재(`202c4173`). 업그레이드와 무관한 수명주기 버그도 많다: 확장이 일으킨 턴 running 고착 → `agent_settled`를 권위로(`c424f829`), 죽은 pi에 Stop 영구 거부(`81ad0079`), `navigateTree`가 파일에 쓰지 않아 재시작 후 rewind 소실(`26f227be`).

### 4.3 클라이언트-서버 프로토콜

- **전송**: 단일 WebSocket, JSON 텍스트 + 터미널·파일용 바이너리 프레임(`docs/architecture.md:232-234`).
- **envelope**(`packages/protocol/src/messages.ts:7527-7604`):

  ```ts
  WSInboundMessageSchema  = discriminatedUnion("type", [ping, hello, recording_state, session{message}])
  WSOutboundMessageSchema = discriminatedUnion("type", [pong, session{message}, "hello.rejected"])
  WSHelloMessageSchema = { type:"hello", clientId, clientType, protocolVersion: int,
    auth?: {kind:"password",password} | {kind:"localCredential",token}, appVersion?, capabilities? }
  WSHelloRejectedMessageSchema = { type:"hello.rejected",
    reason: "password_required"|"incorrect_password"|"incompatible_protocol", accepts:["password"] }
  ```

- JSON-RPC가 아니다. `requestId`로 상관하고 실패는 `rpc_error`. 새 RPC는 `x.y.request/response` 이름(`docs/architecture.md:272,289`). 서버 첫 응답은 `status {status:"server_info", serverId, hostname, version, capabilities, features, permissions?}`(`messages.ts:3560-3580`).
- **대표 메시지**: `agent_update`, `agent_stream`(4115), `agent_status`, `agent_list`, `agent_permission_request`(5148)/`_resolved`/`_response`(2163), `fetch_agent_timeline_request`(1870)/`_response`(4625), 터미널 바이너리 opcode(Output 0x01, Input 0x02, Resize 0x03, Snapshot 0x04)(`docs/architecture.md:300-308`).
- **구독**: 연결만으로는 데이터가 오지 않는다. list는 스냅샷이고 `subscribe: {}`를 붙이면 서버가 subscription ID를 발급한다. 재접속하면 새 서버 ID를 만든다(`docs/architecture.md:251-262`).
- **재접속·재전송**:
  - `agent_stream.payload`에 `seq`(정수)와 `epoch`(문자열)(`messages.ts:4115-4126`). 커서는 `{epoch, seq}`(`messages.ts:1865-1868`).
  - `fetch_agent_timeline_request {direction: "tail"|"before"|"after", cursor, limit, projection}`(`messages.ts:1870-1882`). 응답 `{epoch, reset, staleCursor, gap, window{minSeq,maxSeq,nextSeq}, startCursor, endCursor, hasOlder, hasNewer, entries}`(`messages.ts:4625-4650`).
  - 서버는 `InMemoryAgentTimelineStore`. 에이전트별 `epoch = randomUUID()`, 기본 페이지 200, 상한 없음. epoch가 다르면 `staleCursor`, 창보다 앞이면 `gap`, 둘 중 하나면 `reset`으로 tail을 준다(`packages/server/src/server/agent/agent-timeline-store.ts:28,49,96-130`).
  - 클라이언트 판정(`packages/app/src/timeline/session-stream-reducers.ts:283-304`): epoch 다름 → `drop_epoch`, `seq ≤ endSeq` → `drop_stale`, `seq = endSeq+1` → `accept`, 그 밖 → gap. gap이면 `after` 방향으로 `hasNewer:false`까지 페이지 반복, 실패는 1s→30s 백오프(`docs/timeline-sync.md:41-54`).
  - 표시용 프로젝션: 도구 호출 수명주기는 한 항목, 청크는 병합, `seqStart/seqEnd/sourceSeqRanges`로 원시 seq와 연결. 셸 출력 64 KiB 상한(`docs/timeline-sync.md:19-22,37-39`).
  - 생존 확인: 앱 수준 ping/pong 10초, 첫 ping이 소켓 소유 lease를 잡음. 송신 경로마다 8 MiB high-water mark, 넘으면 그 소켓만 강제 종료(`docs/architecture.md:266-268`).
- **버전 관리**: `WS_PROTOCOL_VERSION = 1` 고정, 1 미만만 거부(`packages/server/src/server/websocket-server.ts:489,1568-1578`). 실제 호환성은 capability/feature 게이트와 `COMPAT(name): added in vX, remove after <date>` 태그(`messages.ts:3567-3580`, `docs/protocol-compatibility.md`). 스키마는 append-only.
- **큰 파일**: WS 바이너리 `FileBegin/FileChunk/FileEnd`, 256 KiB 청크, 청크마다 송신 완료 대기(`docs/architecture.md:310-314`). HTTP `/api/files/download`는 자체 capability 토큰(`packages/server/src/server/auth.ts:115-118`).

### 4.4 인증·페어링·원격

- **비밀번호**: `config.json auth.password` 또는 `PASEO_PASSWORD`, bcrypt cost 12(`auth.ts:1,6,35-37`). hello 안에서 인증하고 실패하면 `hello.rejected`. 구 클라이언트용 Bearer 헤더와 `paseo.bearer.<token>` 서브프로토콜도 허용(`auth.ts:50-75`).
- **로컬 자격증명**: 실행마다 `$PASEO_HOME/local-credential`(0600)을 새로 쓰고 종료 시 삭제. 같은 OS 사용자 프로세스는 막지 못한다고 명시(`SECURITY.md:53`).
- **E2E relay·QR**: 첫 실행에 Curve25519 키쌍 → `daemon-keypair.json`(0600)(`packages/server/src/server/daemon-keypair.ts:16-69`). 페어링 URL `https://app.paseo.sh/#offer=…`, 프래그먼트에 `{serverId, daemonPublicKeyB64, relay}`(`pairing-offer.ts:34-46`). 클라이언트가 연결마다 임시 키 → `e2ee_hello` → `e2ee_ready`, 이후 X25519 + XSalsa20-Poly1305(`packages/relay/src/crypto.ts:1-25`, `encrypted-channel.ts:57-98,151-282`). 세션 안 재전송 방어 없음(`SECURITY.md:39`). relay 경유 클라이언트는 아직 비밀번호 없이 허용(`SECURITY.md:45`). 데몬이 relay로 아웃바운드 연결(제어 소켓 1 + 클라이언트별 데이터 소켓, `relay-transport.ts:50-52,114-185`).
- **그 밖의 원격**: SSH는 이미 떠 있는 원격 데몬으로 터널만(`public-docs/connectivity.md:19-50`). Tailscale은 `daemon.listen`을 Tailscale IP로 직접 바인딩. `tailscale serve`와 신원 헤더는 쓰지 않는다(`public-docs/connectivity.md:74-122`). DNS rebinding 방어용 Host 허용 목록(`SECURITY.md:69-73`).
- 권한 모델(principal → grants, 1회용 페어링 초대)은 진행 중(`docs/permissions.md:5-36`).

### 4.5 지속성·크래시 복구

- DB 없이 JSON 파일 + zod 검증, 원자 쓰기, 마이그레이션 프레임워크 없음(`docs/data-model.md:33-35`). "store 메서드는 SQL 문 하나 또는 트랜잭션 하나에 대응"이라는 규칙을 미리 둔다(`:37-39`).
- 에이전트 레코드 `$PASEO_HOME/agents/{sanitized-cwd}/{id}.json`, 스키마 `STORED_AGENT_SCHEMA`(`packages/server/src/server/agent/agent-storage.ts:45-78`): `lastStatus`(기본 closed), `persistence{provider, sessionId, nativeHandle, metadata}`, `config`, `attention*` 등.
- 타임라인은 저장하지 않는다. "provider history is the durable transcript authority"(`docs/architecture.md:392`). 대기 중 권한 요청도 메모리에만(`agent-manager.ts:4721-4732`, `agent-projections.ts:244`).
- 재시작: 정상 종료 때 모든 에이전트를 close해 `closed`로 영속(`bootstrap.ts:1812-1840,1885-1900`, `agent-manager.ts:1768-1808`). 시작 시 자동 재개 없음("agents will initialize on demand", `bootstrap.ts:1381-1386`). 요청이 오면 persistence handle로 재개하고 provider 이력으로 타임라인을 다시 채운다. 이때 새 epoch(`agent-loading.ts:63-152`). 진행 중 턴은 이어 가지 않는다. "the unfinished turn is lost"(`docs/agent-lifecycle.md:31-38`).
- [추정] 크래시 뒤 `lastStatus: running`이 정규화되지 않을 수 있다(`agent-projections.ts:240`에 그대로 출력, 시작 시 정규화 코드 없음).
- 생성 저널: 작업 종류 + 멱등 키로 마일스톤 기록. "Interrupted side effects with no conclusive receipt return an unknown outcome instead of being repeated"(`docs/architecture.md:331-350`).
- 관리 프로세스 원장 `runtime/managed-processes/*.json`(PID, argv, 프로세스 신원). 부팅 때 확실히 일치하는 잔존물만 종료(`docs/providers.md:124-128`).
- 소유권: 에이전트별 lifecycle mutation 큐로 직렬화(`agent-manager.ts:1748-1766`). 인터럽트 계약 "소유가 불확실할 때만 reject"(`agent-sdk-types.ts:688-693`). DB lease는 없다.

### 4.6 스케줄러·알림

- 자체 `schedule/cron.ts` + 1초 `setInterval`(unref). 놓친 실행은 따라잡지 않고 `nextRunAt`을 현재 이후로 건너뛴다(`schedule/service.ts:29,41-51,642-653`). 시작 시 `running` 실행을 `failed` "Daemon restarted before the scheduled run completed"로 표시(`:593-634`). heartbeat·loop 도구도 있다(`agent/tools/paseo-tools.ts:2546-2547`).
- 푸시: Expo push API, 토큰 `push-tokens.json`(`push/push-service.ts:24`). 라우팅은 클라이언트 heartbeat(기기 종류, 앱 가시성, 포커스 에이전트)로 하되 스트림 정합성 판단에는 쓰지 않는다(`docs/timeline-sync.md:24-33`).

### 4.7 클라이언트

- Expo Router 앱, `HostRuntimeController`가 여러 호스트 연결·재접속 관리(`packages/app/src/runtime/host-runtime.ts`). 캐시 우선 표시 후 네트워크 대조, 늦은 캐시 읽기가 진전된 상태를 덮지 못하게(`docs/architecture.md:126-140`). "Reconnecting to host" → "Updating messages" 신선도 표시, 포그라운드 복귀 3초 프로브(`docs/timeline-sync.md:84-98`).
- 클라이언트 복제본: IndexedDB(웹·Electron)·expo-sqlite(네이티브), 키 `(serverId, kind, id)`, 32 MiB, 호스트 단위 LRU, 암호화 없음(`docs/data-model.md:579-597`).
- TUI는 없다.

### 4.8 Helm 참고

- 가져올 것: `{epoch, seq}` 커서와 `staleCursor/gap/reset`, `hasNewer` 페이지 반복, 프로젝션과 `sourceSeqRanges`, hello 안 인증 + `hello.rejected{reason}`, ping lease와 소켓별 송신 상한, 버전 정수 + capability + `COMPAT` 태그, 인터럽트 계약, 생성 저널의 unknown 결과, 스케줄 run의 failed 표시, 관리 프로세스 원장, pi 확장 UI → 질문 매핑(`pi/agent.ts:940-1093,1451-1471`), 도구 출력 64 KiB 상한, 전송 중립 도구 카탈로그(`agent/tools/types.ts:22-47`).
- 피할 것: notify 문자열 마커, 메모리 타임라인 + provider 이력 정본, 대기 권한 메모리 보관, 마이그레이션 없는 JSON, relay 재전송 방어 부재, 2,817행 `pi/agent.ts`, Tailscale IP 직접 바인딩.

## 5. pi-web

### 5.1 무엇인지, 프로세스 구조

- `@jmfederico/pi-web` 1.202610.1, "Web UI for persistent Pi Coding Agent sessions"(`pi-web/package.json:2-4`). Fastify 5 + `@fastify/websocket`, Lit + Vite PWA, node-pty + xterm.
- 실행 파일 셋: `pi-web`, `pi-web-server`, `pi-web-sessiond`(`package.json:27-31`).
  - `sessiond`: pi SDK를 in-process로 임베드하고 모든 세션 런타임을 소유. 기본 Unix 소켓 `<PI_WEB_DATA_DIR>/sessiond.sock`, `PI_WEB_SESSIOND_PORT`가 있으면 127.0.0.1 TCP(`src/sessiond/config.ts:4-6`, `src/server/sessiond.ts:465-477`).
  - web/API: 127.0.0.1:8504(`src/server/index.ts:7`). 세션 HTTP/WS를 데몬으로 프록시(`src/server/sessiond/sessionProxyRoutes.ts:57-66`).
  - systemd 사용자 서비스 둘. "Browser disconnects and UI/API restarts should not stop active Pi sessions."(`AGENTS.md:3-10`)
- 단일 데몬 보장은 `sessiond-owner.json` 마커 + /proc start-time으로 pid 재사용 구분(`src/server/sessiond/sessiondStateOwnership.ts:1-30`).
- fleet: gateway가 원격 pi-web을 machine으로 등록해 프록시(`src/server/machines/machineProxyRoutes.ts:291`).

### 5.2 pi 활용

- pi-agent-core, pi-ai, pi-coding-agent를 `^1.0.0` devDeps + peerDeps로 둔다(`package.json:110-112,143-147`). 포크·제거는 없다. pi-tui는 쓰지 않는다. 전역 npm 설치 때 peer가 pi-web 아래에 깔리고 그 사본이 임베드 런타임이 된다. 사용자 pi CLI와 설치본은 다르지만 agent dir와 세션 파일은 공유한다(`scripts/smoke-package-install.mjs:113-135`, `CHANGELOG.md:276`).
- 조립 순서(`src/server/sessions/piSessionService.ts`): `createAgentSessionRuntime`(754-763) → `createEventBus`(1020) → `SettingsManager.create`(1030) → `createAgentSessionServices({modelRuntime, settingsManager, resourceLoaderOptions:{eventBus, extensionFactories}})`(1035-1053) → `createAgentSessionFromServices`(1067-1075) → `session.bindExtensions({uiContext, mode:"rpc", …})`(4012-4024).
- `ModelRuntime` 하나를 데몬 전체가 공유하고, 전역 확장의 provider 등록은 부팅 때 받은 뒤 동결(`src/server/sessiond.ts:229-233`).
- 세션 저장은 pi `SessionManager`(JSONL)를 그대로(`piSessionManagerGateway.ts:123,192,304`).
- 정책은 직접: 프로젝트 신뢰(1039-1052), 위임 게이트(1024-1028), 에이전트에 보이는 환경변수 정리(`sessiond.ts:144-152`).
- 업그레이드 사고:
  - 0.85.0: barrel이 선언되지 않은 `@earendil-works/pi-server`를 정적 import해 로드 불가. peer 범위에서 뺐다(`CHANGELOG.md:95`, 커밋 `24e1e22`, `src/server/piSdkIntegrity.test.ts:3-8`, `pi-src/packages/coding-agent/CHANGELOG.md:542`).
  - 0.87: "Support Pi 0.87's transcript-based SDK … Require Pi 0.87.0"(`CHANGELOG.md:69`). pi 쪽 Breaking "Made `SessionManager` canonical for `AgentSession` provider context"(`pi-src/packages/coding-agent/CHANGELOG.md:393`).
  - 요구 하한을 거의 minor마다 올렸다(`CHANGELOG.md:391,307,274,264,216,158,174,69,9`).
  - 세션 파일 다중 작성자: 데몬이 in-memory SessionManager를 들고 파일을 다시 읽지 않아 pi CLI의 append가 보이지 않았다. Reload 버튼(`:373`) → 다른 프로세스 append 반영(`:110`). 동시 사용은 잠금 없이 경고만(`:85`).
- **무결성 테스트** `src/server/piSdkIntegrity.test.ts:1-75`: coding-agent의 `VERSION`이 `1.`로 시작하는지와 export 17개, pi-ai 3개, agent-core `runAgentLoop`를 동적 import로 검사. 깨진 barrel이 있어도 이 테스트 하나만 실패하게 한다(`:6-8,57-71`). 일반 vitest 스위트와 CI(Linux·Windows)에서 돈다.

### 5.3 프로토콜

- 명령은 HTTP JSON, 이벤트는 서버→클라이언트 WS. JSON-RPC가 아니다. 엔드포인트 `/sessions/:id/events`, `/sessions/events`, `/events`(`src/server/sessions/sessionRoutes.ts:533-546`).
- envelope 없이 `{type, …, seq?}` 텍스트 프레임. 세션 이벤트 유니온 `SessionUiEventBody`(`src/shared/apiTypes.ts:1363-1390`): `message.append`, `assistant.delta`, `thinking.delta`, `tool.start/update/end`, `agent.start/end`, `ask.*`, `dialog.*`, `session.tree.changed`, `pi.event` 등.
- seq: `SessionEventHub.publish`가 세션별 단조 seq를 붙인다. 메모리 Map이라 데몬 재시작 시 0부터(`src/server/realtime/sessionEventHub.ts:17,55-64`). 클라이언트 주석 "A restarted daemon starts a new sequence"(`src/client/src/controllers/sessionController.ts:1543`).
- 재접속: **서버 재전송 버퍼 없음.** 클라이언트가 (1) 이벤트를 로컬 버퍼에 쌓기 시작, (2) HTTP `transcript-snapshot`(page·status·partial·seq를 한 tick에 캡처, `sessionRoutes.ts:209-218`, `apiTypes.ts:1330-1347`), (3) `seq > snapshot.seq`만 적용(`sessionController.ts:1438-1514`, 워터마크 판정 `:2388`).
- 백오프 500 ms ×1.6, 최대 5 s(`src/client/src/sessionSocket.ts:14,78-83`). 송신 실패 소켓만 끊는다(`sessionEventHub.ts:95-106`).
- 버전: 와이어 협상 없음. 컴포넌트별 runtime capability 교환(`src/shared/capabilities.ts:12-16`). 플러그인 API 버전 browser v4, server v3(`src/plugin-api.ts:48`, `src/server-plugin-api.ts:25`).
- 큰 파일: WS에는 media id만, 본문은 `GET /sessions/:id/media/:mediaId`(`sessionRoutes.ts:179`, `src/sessiond/sessionDaemonClient.ts:51-73`). 첨부는 POST(`sessionRoutes.ts:413`). 플러그인 WS 채널에 프레임·큐 상한(`src/server/webSocketBridge.ts:130-221`).

### 5.4 인증

- 브라우저 인증 없음. "Do not expose it directly to the public internet without … VPN, SSH tunnel, or authenticated reverse proxy"(`README.md:171-173`). 문서는 Tailscale을 권한다(`docs/install.html:233-234`).
- 데몬은 Unix 소켓 파일 권한으로 보호. [추정] TCP 모드는 인증 없음.
- machine bearer 토큰은 `machines.json`(0600)(`src/server/machines/machineStore.ts:21,92,133`).
- QR, 키 교환, E2E는 없다.

### 5.5 지속성·복구

- 정본은 pi JSONL. 자체 상태는 JSON 파일(projects, machines, archived-sessions(tmp 후 rename, `sessionArchiveStore.ts:42-51,172`), session-unread, sessiond-owner). DB 없음.
- 종료 순서: ingress 503 → plugin 취소 → … → sessions.dispose → unread flush(`src/server/sessiond/sessionDaemonShutdown.ts:30-46`). dispose는 활성 세션을 모두 abort(`piSessionService.ts:1458-1501`). pending ask·다이얼로그는 메모리에서 버린다(`:1470-1473`).
- 재시작 뒤 자동 재개 없음. 요청이 오면 JSONL에서 다시 연다. 중단된 도구 호출 기록·재실행 코드는 찾지 못했다.
- `ask_user`는 사람을 기다리지 않는다. "the tool terminates the run, and the submitted answers return later as a follow-up message"(`src/server/sessions/askUserTool.ts:94-104`). 다만 `PendingAskStore`는 메모리.
- 세션 lease·lock 없음.

### 5.6 스케줄러·알림·클라이언트

- 스케줄러 없음. 백그라운드는 catalog refresher, 2초 heartbeat, unread 정리, 패키지 자동설치 정도(`sessiond.ts:187-244`, `piSessionService.ts:1319`).
- 알림은 메모리 inbox와 영속 unread 표시뿐. Web Push 없음.
- 클라이언트는 웹 PWA 하나. 오프라인 쓰기 큐 없음.

### 5.7 Relay(최신 커밋)

- "Goal-led Relay method, durable baton and history … for independent Pi session chains"(`pi-packages/relays/package.json:4`). 긴 작업을 독립 세션 "leg"로 이어 간다. 패킷은 `.pi-web/relays/<name>/{charter.md, status.md, log.md}`.
- `dispatch_relay`는 자유 프롬프트 없이 저장된 패킷을 디스크에서 검증(realpath, 비어 있지 않은 UTF-8, 256 KiB 이하)한 뒤 handover 지시문을 만든다(`relayDispatch.ts:24-74`). 세션 소속은 메타데이터 `{"@jmfederico/pi-relay": {version:1, packetPath, relayName, leg}}`로만 판정(`relayIdentity.ts:4-12,43-49`).
- 호스트 연결은 in-process 버스 `pi-web:session-dispatch:v1`, `emit({input, accept})`에 동기 `accept(promise)` 접수증. "synchronous receipt avoids timeout/retry ambiguity"(`src/server/sessions/extensionSessionDispatch.ts:7-36`).

### 5.8 Helm 참고

- 가져올 것: 스냅샷 + seq 워터마크 결합(lastSeq 재전송 범위를 넘었거나 데몬 세대가 바뀐 경우의 대체 경로), SDK 조립 순서(P4가 coding-agent 일부를 쓸 때), barrel 동적 import 무결성 테스트(포크 재동기화 뒤 export 회귀 검사), 기다리지 않는 ask 도구 모양(Helm은 질문 레코드를 SQLite에 영속), 동기 접수증 이벤트, owner 마커와 종료 순서표, 미디어 id 참조 + HTTP 조회.
- 피할 것: 데몬 재시작 = 세션 중단(기록·재개 없음), seq·pending 메모리 보관, peer 범위로 업스트림 추종, 같은 JSONL을 여러 프로세스가 잠금 없이 쓰기, ws 내부 `_receiver` 조작(`webSocketBridge.ts:361-376`), 5,521행 `piSessionService.ts`, 브라우저 인증 없음.

## 6. pi-fabric

### 6.1 무엇인지, 프로세스 구조

- pi 확장이다. 데몬·서버가 아니다. 모델에 `fabric_exec` 하나를 주고, 모델이 TypeScript(QuickJS) 또는 Python(Monty) 프로그램으로 pi 도구·MCP·에이전트·액터·mesh를 호출한다(`pi-fabric/README.md:32`, `docs/architecture.md:5-30`). 설치는 `pi install npm:pi-fabric`.
- 프로세스:
  1. Main: 사용자 pi 세션 안의 확장. "Main's outer Pi session is unchanged"(`docs/durable-pi.md:7`). Main 대화는 durable이 아니다.
  2. 프로세스 워커 `src/worker.ts`: 자식 에이전트마다 detached 실행(`src/agents/transports/process-utils.ts:212-235`).
  3. 러너 자식: `pi`, `pi-durable`(기본), `claude`, `veda`, custom(`src/worker.ts:339-381`). `pi-durable` 러너는 Pi SDK를 RPC 모드로 돌린다(`src/durable/worker-host.ts:148-151`).
  4. 선택적 상주 호스트(`residency: "durable"`): `client → detached Node launcher → pi --mode rpc --no-session --no-tools --extension pi-entry.js → ResidentHost`(`docs/residency-runtime.md:19-27`). 소유한 durable 참여자가 없으면 종료. "Fabric adds no system daemon"(`:70-73`).
- 네트워크 서버 없음.
- `LAWS.bend`/`PROOF.bend`/`proofs/`: Bend 언어로 쓴 정책 커널의 명세와 증명. 컴파일한 JS가 운영 경로에서 수락 판정을 한다(`docs/verified-kernels.md:3-9`). 대상은 자원 충돌, 권한 파생, 컴팩션 컷, 저장소 CAS 등이고 "not a proof of every subsystem invariant"(`:20-34`). durable 실행은 증명 대상이 아니다.

### 6.2 pi 활용

- 런타임 의존을 정확한 버전으로 고정: `@earendil-works/pi-durable: "1.1.0"`, `@earendil-works/chord: "1.1.0"`(`package.json:137-138`), `pi-fabric-worker-sdk: "npm:@earendil-works/pi-coding-agent@1.1.0"`(`:149`). alias 사본은 별도 서브프로세스가 Main의 모듈을 빌릴 수 없어서 둔다(`docs/durable-pi.md:9-17`).
- peer는 pi-agent-core, pi-ai, pi-coding-agent, pi-tui, typebox 모두 `"*"`(`package.json:158-164`). leaf 어댑터는 첫 사용 때 `version !== "1.1.0"`이면 예외(`src/durable.ts:46-60`). 호스트 최소 버전 1.0.0(`src/host-compatibility.ts:4`).
- 포크는 없다. pi-agent-core `Agent`를 상속한 `DurableAgent`(`src/durable/agent.ts:43-44`)를 coding-agent `AgentSession`에 끼운다(`src/durable/session.ts:139-155`).
- 기본 러너는 pi-durable의 `Harness`, `createRegistry`, `defineDoc`, `defineTask`만 쓰고, pi-durable 내장 생성 태스크 `pi.generation`/`pi.tool`은 쓰지 않는다. 루프를 `fabric.agent.run`(prepare → model → tools → boundary → decide)과 `fabric.agent.tool`로 다시 구현했다(`src/durable/agent.ts:10-11,33-38,91-317`). "The Harness scheduler owns both requests and tool invocations; no native Agent loop runs behind this adapter".
- 비기본 leaf 어댑터(`src/durable.ts`)만 pi-durable 내장 루프를 쓴다(`compaction`·`retry` 끔, `src/durable.ts:169,205`).

### 6.3 프로토콜

- 네트워크 클라이언트 프로토콜은 없다. 모두 같은 OS 사용자의 로컬 파일이나 stdio다.
- 워커 ↔ 러너 자식: pi 네이티브 RPC(stdin/stdout JSONL)(`src/durable/worker-host.ts:150`). RPC command id는 응답 상관용이고 중복 제거 키가 아니다(`docs/durable-pi.md:57-59`).
- Fabric ↔ 워커(worker protocol v1, `FABRIC_WORKER_PROTOCOL_VERSION = 1`, `src/agents/runner-protocol.ts:8`): `statusFile`(temp 후 rename), `lifecycleFile`(`{version:1, event, occurredAt, data}` append), `logFile`, `steerFile`(200 ms 폴링, `src/worker.ts:1175-1200,1284`). 버전 협상 없음, "Readers ignore unknown fields"(`runner-protocol.ts:4-7`).
- 상주 호스트: `requests/`·`responses/` 디렉터리에 `<requestId>.json`(`src/residency/protocol.ts:36-53`). 재시작한 호스트는 control log를 0부터 다시 읽고 `ownerIncarnation` 펜싱으로 이전 incarnation 앞 명령을 거부(`docs/residency-runtime.md:75-84`).
- **mesh 이벤트 로그**: `events.jsonl`, `sequence` 카운터, `.lock`, `schedules.json`(`src/mesh/store.ts:353-360`). 이벤트에 단조 `sequence`(`:22-40,424-447`). 읽기는 `read({after: sequence, topic, limit})`(기본 100, `:638-652`)와 `tail(cursor)`(generation + byte offset, generation이 다르면 0부터, `:658-700`). 사례 중 유일하게 영속 시퀀스와 after 커서를 가진 로그다.

### 6.4 인증

- 원격·페어링·E2E 없음. 권한 기준은 mesh root 파일 접근(`docs/decisions.md:107`).
- scoped external grant: 한 mesh topic에 append만 허용하는 bearer 토큰. **토큰의 SHA-256만** `grants.json`에 저장. TTL 1분~30일, 사용 횟수 최대 10,000, 환경변수 `PI_FABRIC_MESH_TOKEN`(`src/mesh/grants.ts:1-14`).
- 모델 자격증명은 pi `auth.json`/`models.json` 그대로(`src/durable/session.ts:29-31`).

### 6.5 지속성·크래시 복구

- 저장 위치 `durable/<key>/`(첫 세션 `initial`, `/new`·`/fork`·`/resume`이면 `sha256(sessionId)`)(`src/durable/worker-host.ts:106-112`).
- **단일 writer 락**: `lease.sqlite`에서 `PRAGMA journal_mode = DELETE; BEGIN EXCLUSIVE;`. OS가 쥐는 배타 트랜잭션이라 프로세스가 죽으면 풀린다. PID 파일·만료·강탈 없음(`src/durable/storage.ts:54-67`, `docs/durable-pi.md:41-43`).
- 저장 백엔드는 pi-durable `JsonlStorage({fsync: true})`(`storage.ts:141`). upstream 어댑터가 커밋 마커를 fsync하지 않아 Fabric이 O_NOFOLLOW 디스크립터로 쓰기·fsync, 디렉터리 fsync를 보강했다(`storage.ts:100-124`). 주석: "The published JSONL adapter fsyncs sidecars, not every main commit marker".
- **도구 호출**(`src/durable/agent.ts:93-120`): `runtime.memo("intent")`가 없으면 intent를 기록하고 `tool_execution_start`를 커밋한 뒤 실행, 결과는 `tool_execution_end`와 terminal outcome을 한 커밋에. 재시작으로 intent가 이미 있으면 "태스크 생성 시점 `replaySafe`가 true이고 현재 도구도 `replay === "safe"`"일 때만 재실행(`:104-105,229,241`). 아니면 `isError: true`, `"Tool execution interrupted; unsafe effect was not replayed."`. 테스트 "A newly safe declaration cannot retroactively authorize an unsafe retry"(`tests/durable-agent.test.ts:60-77`). `replay` 필드는 pi-agent-core `AgentTool.replay?: "never" | "safe"`(`pi-src/packages/agent/src/types.ts:489-490`).
- 출력 한도로 잘린 도구 호출은 실행하지 않고 오류 결과로(`agent.ts:216-226`). abort 시 완료된 자식 결과는 보존하고 나머지는 "Tool execution aborted"(`:289-316`).
- **스트리밍 델타**: "Persisting those payloads grows a run's journal quadratically. Commit a slim, ordered marker instead and rehydrate the payload in memory when that commit is delivered."(`agent.ts:16-20`). 구현 `transientEvent()`/`rehydrate()`(`:360-385,438-448`), 테스트 #229 "journals streaming updates linearly"(저널 2 MB 미만, 다시 보내면 20 MB 이상, `tests/durable-agent.test.ts:274-309`). upstream pi-durable 내장 generation은 partial을 `pi.live` 문서에 100 ms마다 한 번 커밋하는 다른 방식이다(`pi-src/packages/durable/src/harness/generation.ts:365-376`).
- **재시작 복구**: AgentManager가 워커를 relaunch(진척 없이 죽으면 `#retryStartup`, 진척 후 멈추면 `#resumeStopped`, 최대 3회 지수 백오프, `src/agents/manager.ts:1856-1934`, `src/agents/constants.ts:3,7`). relaunch 때 원래 task 문자열을 그대로 넘긴다. "Changing its prompt breaks recorded-result identity"(`manager.ts:1927-1930`). 새 자식은 같은 저장소로 `DurableAgent.open()`, `HISTORY`와 `message_end`만 읽어 메시지 복원(`agent.ts:411-451`). `recoverHistory`는 `message_end`를 재전달하지 않아 확장 훅 재실행·사용량 이중 계산을 막는다(`src/durable/session.ts:156-198`). 복원 전에는 `startup` 게이트(`agent.ts:321-333`).
- 멱등 제출: 첫 prompt의 requestId = runId, ledger에 requestId→taskId(`agent.ts:476-512`). 같은 requestId를 다른 내용에 쓰면 거부(`src/durable-controls.ts:64-69`).
- 한계(문서 명시): 기본 워커는 소유 Fabric 재시작 때 자동 재부착되지 않음, steering·follow-up이 추가된 완료 대화 복구 미완성(fail-closed), hosted run은 "indeterminate"(`docs/durable-pi.md:66-71,220-224`). exactly-once 외부 효과는 보장하지 않는다(`:55-56,60-61,72-73,228-229`).
- 소유자 식별(mesh·액터·상주 호스트 락): hostname, PID namespace, boot id, 프로세스 시작 시각. 다른 namespace는 heartbeat(10초 갱신, 45초 stale). `unknown`이면 죽은 것으로 보지 않는다(`docs/residency-runtime.md:86-118`).

### 6.6 스케줄러·승인·알림

- durable 태스크 대기 `{status: "waiting", on: children, policy: "allSettled"}`(`agent.ts:230-231`).
- mesh 예약 이벤트 `mesh.publish({notBefore|afterMs, key})`: 최대 366일, 1,000개. 시스템 데몬 없이 기한 뒤 mesh를 처음 건드리는 프로세스가 lock 아래에서 방출(`docs/agents.md:813-831`, `src/mesh/store.ts:457-513`). 반복은 사용자 코드가 재예약.
- 백그라운드 셸 `pi.bash({background:true})`: 완료 시 소유 세션에 배치 이벤트(`docs/background-tasks.md:1-20`). followUp은 2초 창으로 묶고 steer는 즉시(`src/lifecycle/delivery-scheduler.ts:19-31`).
- **승인**: 위험 등급(read/write/execute/network/agent)마다 `allow | ask | auto | deny`(`src/config.ts:37,100-113`). `ask`는 "Allow once / Allow <risk> for this session / Deny"(`src/core/approval-controller.ts:172-296`), `auto`는 분류기 후 불확실하면 사람에게. 헤드리스 기본 `deny`, `approvals.headless: "decision"`이면 durable decision을 만들고 기본 5분 기다린 뒤 만료 시 거부(`docs/decisions.md:109-116`). 자기 요청 자기 승인 금지, 응답 경쟁은 CAS(`docs/decisions.md:38,80`). **기본 설정은 모든 등급 `"allow"`**(`src/config.ts:491-497`).
- 푸시 없음. TUI `ctx.ui.notify`만.

### 6.7 클라이언트

- 클라이언트는 pi TUI. `/fabric` 대시보드 등. 자식 대화 보기는 pi 세션 JSONL과 워커 `events.jsonl`을 tail해서 만든다(`src/ui/conversation-native-reader.ts:1-30`).
- upstream pi-durable watch: 느린 watch는 미전달 프레임 100개까지 보관하고 넘으면 최신 view 하나로 대체, 재접속은 현재 view부터(`pi-src/packages/durable/README.md:380`). 이벤트 스트림은 snapshot + 커밋 단위 델타, 100 배치 넘게 뒤처지면 새 snapshot(`:446-460`).

### 6.8 Helm 참고

- 가져올 것: 델타는 순서 마커만 커밋(또는 정본에 넣지 않음), intent → 실행 → 결과 커밋과 "생성 시점 AND 현재" 재실행 허가, `BEGIN EXCLUSIVE` 단일 writer 락, requestId 멱등 제출과 요청 지문, incarnation 펜싱, 복구 시 `message_end` 재전달 금지, durable decision과 타임아웃 기본 거부, 토큰 SHA-256 저장.
- 피할 것: 루프를 durable 태스크로 재구현하며 `Agent` 내부 상태를 `Object.defineProperties`로 덮어쓰기(`agent.ts:84-90`), 파일 폴링 제어 채널, 수동 stale 락 복구 절차(`docs/durable-pi.md:166-186`), 4단 프로세스 구조와 Bun→node 재실행·import 훅(`src/durable/worker.ts:10-40`), experimental pi-durable에 버전 검사 없이 의존하기.

## 7. openclaw

### 7.1 무엇인지, 프로세스 구조

- "Multi-channel AI gateway with extensible messaging integrations"(`openclaw/package.json:12`), 2026.9.9. Node 24.16+ 또는 26.1+, pnpm 모노레포. 주요 의존 ws 8.22.0, kysely 0.29.6(쿼리 컴파일만), croner 10.0.1, web-push 3.6.7, qrcode(`package.json:2261-2327`).
- 구성: `packages/agent-core`, `packages/ai`, `packages/gateway-protocol`, `packages/gateway-client`, `apps/{android,ios,linux,macos,shared}`, `ui/`(Lit 웹 Control UI), `src/tui/`.
- Gateway 데몬 하나가 WS와 HTTP를 한 포트(기본 18789)로 받는다(`docs/gateway/config-gateway.md:135,145`). bind 기본 `loopback`.
- 상태: `~/.openclaw/state/openclaw.sqlite`(공유), `agents/<id>/agent/openclaw-agent.sqlite`(auth, 세션, transcript)(`docs/openclaw-agent-runtime.md:52-60`).

### 7.2 pi 활용 이력

- 현재 pi 의존은 `"@earendil-works/pi-tui": "1.0.0"` 하나(`package.json:2269`). src, packages, extensions에서 pi-ai, pi-agent-core, pi-coding-agent import 0건.
- pi-tui 사용처: `src/tui/` 28개 파일, `src/agents/modes/interactive/`, `src/agents/sessions/`의 일부. `docs/agent-runtime-architecture.md:25`: "pi-tui remains a third-party dependency … Internalizing it would be a separate vendoring effort."
- 고지: "Portions of OpenClaw were adapted from Pi / pi-mono"(MIT)(`THIRD_PARTY_NOTICES.md:7-14`).
- 이력(CHANGELOG): pi-* 0.40.0→0.42.2(`CHANGELOG/2026.1.9.md:60-61`), pi-ai 패치 고정(`2026.1.13.md:6`), "bump embedded Pi SDK packages (pi-agent-core, pi-ai, pi-coding-agent, pi-tui) to 0.54.0"(`2026.2.21.md:103`), 네임스페이스 이전(`2026.5.12.md:70`), Pi 0.75.1(`2026.5.19.md:8`, 마지막), **"internalize the former Pi agent runtime into OpenClaw, remove legacy package dependencies, and keep Pi-named SDK aliases only as deprecated plugin compatibility"(`2026.5.22.md:29`)**.
- 제거 이유를 직접 적은 문장은 없다. 임베드 때의 마찰 기록 [추정, 이유로 보는 것은 추정]: pi-coding-agent 내부 auto-retry와 OpenClaw retry·failover가 겹쳐 실패한 도구 호출을 다시 실행("nested SDK retry", `2026.5.22.md:255`), Pi와 OpenClaw transcript 쓰기가 섞여 false session-takeover(`:226,270`), 세션 JSONL 이중 저장(`2026.5.12.md:799`), 동기 session manager의 큰 transcript 재열기 성능(`2026.5.2.md:181,188`).
- 현재: "OpenClaw owns the built-in agent runtime", "No external agent framework packages remain"(`docs/agent-runtime-architecture.md:6,23`). `packages/agent-core/src/agent-loop.ts`에 `runAgentLoop`(:86), `runAgentLoopContinue`(:123). `src/agents/sessions/session-manager.ts:1-6` "Session tree manager backed by an explicit SQLite transcript identity". `"pi"` 런타임 id는 `"openclaw"`로 정규화(`src/agents/agent-runtime-id.ts:13`).

### 7.3 Gateway 프로토콜

- **전송**: WS text frame JSON. 첫 프레임은 반드시 `connect` 요청(`docs/gateway/protocol/transport.md:37-38`). `permessage-deflate` 미협상(`:50-54`).
- **프레임**(`packages/gateway-protocol/src/schema/frames.ts:178-220`, TypeBox, 추가 필드 금지):
  - `{type:"req", id, method, params?, traceparent?, expectedProfileId?}`
  - `{type:"res", id, ok, payload?, error?}`, 오류 `{code, message, details?, retryable?, retryAfterMs?}`
  - `{type:"event", event, payload?, seq?, stateVersion?, recipientProfileId?}`
  - JSON-RPC 2.0이 아니다(`jsonrpc` 필드 없음, `ok` boolean).
- 스키마는 npm `@openclaw/gateway-protocol`(스키마, 검증기, TS 타입, 버전 상수, `protocol.schema.json`)로, 참조 클라이언트는 `@openclaw/gateway-client`(`/browser` 엔트리 별도)로 배포(`transport.md:21-28`). 스키마 파일 약 180개.
- **버전**: `PROTOCOL_VERSION = 4`, `MIN_CLIENT_PROTOCOL_VERSION = 4`, `MIN_NODE_PROTOCOL_VERSION = 3`(`packages/gateway-protocol/src/version.ts:2-8`). 클라이언트가 `minProtocol/maxProtocol`을 보내면 서버는 현재 버전 4가 범위에 드는지만 본다. node 역할만 N-1 허용("Protocol v4 changed chat deltas, not node RPC frames"). 안 맞으면 `PROTOCOL_MISMATCH` 후 close 1002(`src/gateway/server/ws-connection/connect-admission.ts:232-266`). 기능 차이는 `hello-ok.features.methods/events/capabilities`로 광고(`frames.ts:106-110`). 메서드 표 4번째 열이 도입 릴리스(`src/gateway/methods/core-descriptors.ts:16-60`).
- **핸드셰이크**: 서버가 upgrade 직후 `connect.challenge {nonce: randomUUID(), ts, capabilities}`(`src/gateway/server/connection.ts:307-318`). 클라이언트는 nonce에 서명해 `connect`(`packages/gateway-client/src/protocol-client.ts:437-461`). `ConnectParams`(`frames.ts:31-92`): `client{…}`, `caps`, `commands`, `permissions`, `role`, `scopes`, `device{id, publicKey, signature, signedAt, nonce}`, `auth{token, bootstrapToken, deviceToken, password, …}`. `HelloOk`(`frames.ts:94-175`): `protocol`, `server{version, buildId, bootId, connId}`, `features`, `snapshot`, `auth{method, deviceToken, role, scopes, …}`, `policy{maxPayload, maxBufferedBytes, tickIntervalMs, attachments}`. 사전 인증 프레임 64 KiB, IP당 미인증 연결 128, 타임아웃 15초(`transport.md:39-43`, `src/gateway/server-constants.ts:5,9`).
- **메서드·이벤트**: 코어 메서드 표 `CORE_GATEWAY_METHOD_SPECS` 한 곳(`[name, group, requiredScope, since, flags?]`, 509행), "every core handler must appear here so listing, authorization, startup availability, and write throttling stay in sync"(`core-descriptors.ts:13-14`). 이벤트 `GATEWAY_EVENTS` 66개(`src/gateway/server-methods-list.ts:33-100`). role은 `operator`, `node`, `worker`. operator scope는 read/write/admin/approvals/questions/pairing/talk/talk.secrets(`docs/gateway/protocol/handshake.md:325-354`).
- **seq·gap**: 서버 seq는 **연결별 메모리 카운터**(`const clientSeq = new WeakMap<GatewayWsClient, number>()`, `src/gateway/server-broadcast.ts:218,444`). 클라이언트도 연결마다 초기화(`protocol-client.ts:195`). `seq > lastSeq + 1`이면 재전송을 요청하지 않고 `closeSocket(4000, "event sequence gap")`으로 끊는다(`protocol-client.ts:463-485`). 주석 "a lost append cannot be repaired by the next append-only frame". 예외로 gap이 감지된 그 프레임이 chat의 `final|error|aborted`이면 먼저 전달(`:467-474`). 재접속 뒤 `hello-ok.snapshot` + `sessions.subscribe` + `sessions.list`로 맞춘다("Reconnects require a new subscription and snapshot", `docs/gateway/protocol/rpc-bootstrap-and-events.md:16-51`). `chat.history.inFlightRun`으로 아직 영속되지 않은 현재 run 꼬리만 복원(`transport.md:62-64`).
- `stateVersion`은 `{presence, health}` 두 하위 트리의 카운터일 뿐이다(`packages/gateway-protocol/src/schema/snapshot.ts:229-233`).
- 느린 소비자: 송신 버퍼 50 MiB 초과 시 `dropIfSlow` 이벤트는 버리되 seq는 소비해 클라이언트가 gap으로 감지하게 하고("so the client's gap detector sees the loss instead of a silently thinner stream"), 나머지는 close 1008(`server-broadcast.ts:458-467`).
- tick: `TICK_INTERVAL_MS = 30_000`(`server-constants.ts:14`). 클라이언트는 `tickIntervalMs*2` 동안 아무것도 못 받으면 끊고 재접속(`packages/gateway-client/src/client.ts:1251-1259`). 대기 요청은 reject하고 재전송하지 않는다. 회복 불가 인증 오류에서는 재접속을 멈춘다(`packages/gateway-client/src/reconnect-policy.ts:7-56`).
- 멱등: `chat.send.idempotencyKey` 필수, 서버 dedupe TTL 5분·1,000건(`server-constants.ts:16-17`).
- **큰 파일**: `MAX_PAYLOAD_BYTES = 25 MiB`, `MAX_BUFFERED_BYTES = 50 MiB`(`server-constants.ts:3-4`). 업로드는 `chat.send` attachments base64 인라인. 문서가 "a 20 MB file is about 26.7 MB on the wire and exceeds the default 25 MiB frame limit"을 경고(`handshake.md:107-126`). 다운로드는 `artifacts.download` → `data`(base64) 또는 `url + expiresAt`(`schema/artifacts.ts:67-82`). URL `/api/artifacts/download/<connId>/<ticket>`, ticket은 randomBytes(32), TTL 5분, 연결당 128개, grant는 `WeakMap<GatewayClient, …>`라 **WS 연결에 묶인다**(`src/gateway/artifact-download-grants.ts:10-11,22-23,90-127`).

### 7.4 인증·페어링·Tailscale

- auth mode: `none | token(기본) | password | trusted-proxy`(`docs/gateway/tailscale.md:97-106`).
- **기기 신원**: Ed25519, `deviceId = sha256(raw pubkey)`(`src/infra/device-identity-store.ts:81-92`, Swift·Kotlin·웹 각자 구현). 서명 payload `v3|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce|platform|deviceFamily`(`packages/gateway-client/src/device-auth.ts:24-60`). 서버는 signedAt ±2분, nonce 불일치, device.id와 지문 불일치를 거부(`src/gateway/server/ws-connection/connect-device-proof.ts:13,64-74`). "All connections must sign the server-provided `connect.challenge` nonce"(`docs/gateway/protocol/auth.md:164`).
- **기기 토큰**: 페어링 승인 시 기기·role별 발급, `hello-ok.auth.deviceToken`으로 전달(`auth.md:28-42`). `randomBytes(32).base64url`, 상수 시간 비교(`src/infra/pairing-token.ts:5-18`). 회전·폐기 `device.token.rotate/revoke`, 승인 범위를 넘을 수 없음(`auth.md:77-94`). 서버 저장은 `device_pairing_paired(… tokens_json …)`(`src/state/openclaw-state-schema.sql:567-590`)이고 비교 코드(`src/infra/device-pairing-tokens.kernel.ts:90`)로 보아 **평문 저장**이다. 디렉터리 0o700, 파일 0o600(`src/state/openclaw-state-db-permissions.ts:13-14`). 비밀 테이블 목록 상수(`src/state/secret-state-tables.ts:2-21`).
- **페어링**: 승인 대기 소켓은 RPC 없이 열려 있다가 `device.pair.resolved`를 받으면 닫히고 클라이언트가 새로 connect. "the event itself never grants access"(`auth.md:126-141`). **loopback 자동 승인이 기본**(첫 페어링과 scope 상향까지, `docs/gateway/pairing.md:238-246`). SSH 포워드도 loopback으로 본다(`:231-236`).
- **설정 코드(QR)**: `{url, urls?, bootstrapToken, expiresAtMs?, tlsFingerprint?}` base64url(`src/pairing/setup-code.ts:43-49,401-402`). bootstrap 토큰은 쓰면 삭제(`openclaw-state-schema.sql:612-626`). TLS 지문 pinning 지원(`auth.md:196-202`).
- **Tailscale**: `gateway.tailscale.mode: off|serve|funnel`. Gateway가 `tailscale serve --yes --bg=false … <target>`을 자식으로 소유하고 권한이 없으면 `sudo -n`(`src/infra/tailscale.ts:408-445`). **serve 전용 loopback 리스너**(`127.0.0.1:0`)를 따로 띄워 serve target으로 잡고 신원 헤더는 이 리스너에서만 인정(`src/gateway/server-runtime-state.ts:399-404,507-519`). 헤더 검증: remote가 loopback이고 x-forwarded-for/proto/host가 모두 있어야 하고, funnel 마커가 있으면 거부, `tailscale-user-login`은 `tailscale whois --json <XFF IP>`와 일치할 때만(`src/gateway/ingress-attribution.ts:126-131,152-202`). whois 캐시 60초(`tailscale.ts:643-679`). Tailscale 신원은 **device identity를 대신하지 않는다**(`docs/gateway/tailscale.md:114-120`).
- **비밀 저장**: 모델 자격은 에이전트 DB `auth_profile_store`(SecretRef 지원). iOS Keychain + 네이티브 SQLite, Android EncryptedSharedPreferences, 웹은 **Ed25519 개인키를 localStorage**에(`ui/src/lib/nodes/index.ts:48-51,253-327`).

### 7.5 지속성·크래시 복구

- **DB**: `node:sqlite` `DatabaseSync`(동기), kysely는 쿼리 컴파일만(`src/infra/kysely-sync.ts:36-51`). DDL은 단일 SQL 원본 둘(`src/state/openclaw-state-schema.sql` 2,712행, `src/state/openclaw-agent-schema.sql` 912행). 버전 판정 `PRAGMA user_version` + `schema_meta` 이중 확인(`src/state/openclaw-agent-db-schema.ts:368,421-425`). 모든 테이블 `STRICT` + CHECK.
- PRAGMA: WAL, `busy_timeout = 5000`, `synchronous = NORMAL`, `foreign_keys = ON`, `wal_autocheckpoint = 16384`, `journal_size_limit = 64 MiB`(`src/infra/sqlite-wal.ts:50-56,170,233-277`, `src/state/openclaw-state-db-contract.ts:110`). 네트워크 파일시스템에서는 WAL 대신 DELETE 저널 강제(`src/infra/sqlite-wal-filesystem.ts:278-303`).
- **transcript 정본**: `transcript_events((session_id, seq) PK, event_json, event_zstd)`, `transcript_event_identities(event_id, parent_id, message_idempotency_key UNIQUE)`(`openclaw-agent-schema.sql:439-478,556-580`). 입력 대기열 `session_pending_inputs(state IN ('queued','interrupted','cancelled'), UNIQUE(session_id, idempotency_key))`(`:878-897`).
- **writer claim**: 세션 행 `activeWriterRunId`를 `{sessionId, lifecycleRevision}` 조건부로 기록, 이전 writer는 새 claim이 영속된 뒤 superseded("The replacement must own the durable row before the incumbent is made terminal", `src/agents/embedded-agent-runner/run/session-bootstrap.ts:523-603`). 쓰기 직전에 행을 다시 읽어 비교(`src/config/sessions/session-accessor.sqlite-scope.ts:80-99`). 만료·heartbeat 없음. 생존은 프로세스 내 레지스트리와 `lifecycleGeneration`으로 판정(`src/infra/agent-events.ts:175-181`).
- 최신 커밋(`3258dd87`)은 admission 스냅숏(claim 이전)을 소유권 검사에 재사용해 모든 실행이 "ownership changed"로 실패하던 문제를 고쳤다. 스냅숏에 기대 writer가 있을 때만 재사용하고 아니면 다시 읽는다(`src/agents/embedded-agent-runner/run/model-setup.ts:193-199`).
- **interrupted 표식 세 시점**(`docs/gateway/restart-recovery.md:634-664`): admission 때 사용자 메시지 append·이전 outcome 삭제·recovery claim을 한 트랜잭션, 종료 때 활성 run 세션에 marker 후 abort(`src/gateway/server-lifecycle.ts:505-536`), 시작 때 살아 있는 소유자가 없는 `interrupted` 세션을 고아로 표시(크래시 안전망).
- **재개**: 시작 5초 뒤 "이전 턴이 재시작으로 중단됐으니 기존 transcript에서 이어가라"는 합성 시스템 메시지로 새 턴(`main-session-restart-recovery-shared.ts:21`, `restart-recovery.md:700-704`). 중단 주기마다 영속 예산 3회, 디스패치 전에 차감, 소진 시 tombstone(`:766-795`). 같은 영속 디스패치 식별자를 재사용.
- **도구 호출**(`src/agents/main-session-recovery/main-session-restart-recovery-resume-policy.ts:129-160,340-459`): 결과 없는 호출은 재실행하지 않고 다음 요청에서 빼며, 매달린 호출에 replay-safe가 아닌 것이 하나라도 있으면 재개 턴의 도구 목록을 restart-safe로 필터(`attempt-tool-prepare.ts:386-394`). 주석 "the continuation can inspect and report, but never silently re-execute the ambiguous side effect". 허용 목록 `read, search, find, grep, glob, ls, web_search, web_fetch, …, view_image`(`src/agents/tool-replay-safety.ts:6-28`), 플러그인은 `declaredReplaySafe`, 동명 도구는 fail-closed(`:48-89`). 전달 완료 영수증이 있으면 재실행 없이 complete, 불확실하면 restart-safe 재개.
- 하위 에이전트는 자동 재실행하지 않고 부모에게 interrupted로 정산. PTY와 백그라운드 exec은 메모리라 사라진다(`docs/gateway/background-process.md:234`).
- 크래시 루프 차단기: 5분 안 비정상 부팅 3번이면 safe mode(`restart-recovery.md:981-1003`).
- 종료 예산: drain 315초 + reserve 10초 + margin 5초, systemd `TimeoutStopUSec`에 맞춰 재계산, `KillMode=mixed` 필요(`gateway-shutdown-budget.mjs:3-38`, `restart-recovery.md:211-260`).
- 도구 실행 경계("실행에 들어갔는가")는 메모리 Map이다(`src/agents/agent-tools.before-tool-call.state.ts:6-11`). 크래시 뒤에는 transcript 꼬리로만 판단한다.

### 7.6 스케줄러·승인·알림

- **cron**: croner는 다음 시각 계산에만(`src/cron/schedule.ts:24-35`). 실행 타이머는 단일 `setTimeout`, 최대 60초로 자른다. "Wake at least once a minute to avoid schedule drift and recover quickly when the process was paused or wall-clock time jumps."(`src/cron/service/timer-scheduler.ts:57-112`). 지난 슬롯 hot loop 방지 2초(`timer-execution-timeout.ts:36`). 종류 `every`, `at`, cron.
- 저장 `cron_jobs(job_json, state_json)`, 실행 영수증 `cron_run_receipts`("One owner-native receipt is also the durable execution fence", `running` 영수증은 작업당 하나, 부분 UNIQUE 인덱스, `openclaw-state-schema.sql:1432-1484`). 소유자는 `owner_pid + owner_start_time`, heartbeat 없음, 검증 불가 pid는 2시간 뒤 회수(`src/cron/store/run-receipt-store.ts:82,197-211`).
- 재시작 때 실행 중이던 작업은 "cron: job interrupted by gateway restart" 오류 실행으로 기록, 자동 재실행 안 함(`src/cron/service/startup-run-repair.ts:18,33-118`). 놓친 실행 catch-up은 재시작당 즉시 5개, 나머지 5초 간격, 에이전트 턴 작업은 2분 뒤(`timer-execution-timeout.ts:38-42`).
- heartbeat는 cron이 소유하는 시스템 작업 한 행(기본 30분, `docs/gateway/heartbeat.md:15-23`). 결과 `heartbeat_outcomes(outcome IN ('progress','done','blocked','needs_attention'))`.
- **승인**: exec 정책 `security`(deny/allowlist/full), `ask`(off/on-miss/always)(`src/infra/exec-approvals-core.ts:12-15`), 결합은 강화만(`exec-approvals-policy.ts:32-40`). 기본 대기 30분. `operator_approvals(pending/allowed/denied/expired/cancelled, allow-once/allow-always/deny, consumed_at_ms)`(`openclaw-state-schema.sql:365-490`). 승인 때 실행 plan을 저장해 승인 뒤 인자가 바뀌어도 저장된 plan 실행(`docs/tools/exec-approvals.md:716-723`). 대기 상태는 영속하지만 프로세스마다 `runtime_epoch = randomUUID()`를 두고 시작 시 다른 epoch의 pending을 모두 `cancelled/gateway-restart`로 종결(`src/gateway/server-aux-handlers.ts:100-105`, `operator-approval-store.transitions.ts:237-290`).
- **알림**: Web Push(VAPID, `question.requested`/chat final/cron 실패, TTL 5분, `src/gateway/event-web-push.ts:33,56-117`), APNs(direct 또는 relay, `src/infra/push-apns-store.types.ts:5,14`). 외부 전송 outbox `delivery_queue_entries(retry_count, recovery_state, platform_send_started_at)`, "보냈는지 불확실"이면 재전송하지 않고 영수증(`openclaw-state-schema.sql:1532-1551`).

### 7.7 클라이언트

- 모든 클라이언트가 같은 WS 프로토콜. 웹 UI(Lit)는 `@openclaw/gateway-client`, TUI는 같은 `GatewayClient`로 operator 접속(`src/tui/gateway-chat.ts:189-213`), iOS/macOS는 공유 `GatewayChannel.swift`(1,659행), Android는 Kotlin 자체 구현(`GatewaySession.kt`, 2,565행). 서명과 seq 규칙을 언어마다 다시 구현했다.
- node 역할: caps/commands/permissions를 claim하고 서버 allowlist가 강제, 명령은 `node.invoke.request` 이벤트. 모바일은 operator 세션과 node 세션을 분리(`docs/platforms/ios.md:277-283`).
- gap 대응은 네 클라이언트 모두 폐기 → 재접속 → 스냅샷·history 재조회(`ui/src/app/gateway-store.ts:599-611`, `GatewayChannel.swift:1148-1168`, `GatewaySession.kt:1984-1999`, `src/tui/tui.ts:1692-1702`).
- iOS outbox: gateway별 durable 최대 50개, 순서대로 멱등 재시도, 48시간 만료(`docs/platforms/ios.md:27`).

### 7.8 Helm 참고

- 가져올 것: challenge nonce Ed25519 서명 connect, gap 시 스냅샷 fallback과 종료 프레임 예외, 느린 소비자 정책, hello의 policy·features 광고와 메서드 표 단일화, 정수 버전 + optional 필드 추가, 연결에 묶인 일회성 다운로드 ticket, Tailscale 헤더 whois 대조와 serve 전용 리스너, 페어링 대기 소켓, 토큰 회전 규칙, 비밀 테이블 목록 상수, 매달린 호출 비재실행 + 재개 턴 도구 제한, "보냈는지 불확실" 상태, 영속 재시도 예산과 크래시 루프 차단기, 실행 영수증 fence(pid + start_time), 프로세스 epoch로 이전 대기 행 일괄 종결, 승인 plan 고정과 allow-once 소비, cron 타이머 60초 상한·catch-up 상한·interrupted 기록, heartbeat를 스케줄러 작업 한 행으로, SQLite 운영값과 네트워크 FS 거부, 단일 SQL 원본 + user_version 이중 확인.
- 피할 것: 연결별 메모리 seq(클라이언트 네 종이 복구 로직을 각자 구현), WS base64 첨부, 서버 토큰 평문 저장, 웹 localStorage 개인키, loopback 자동 승인 기본값(serve 뒤에서는 원격 요청도 TCP상 127.0.0.1에서 온다 [추정]), 메서드 509·이벤트 66 규모, Gateway가 `tailscale serve`를 자식으로 소유하고 sudo로 fallback, 상태 DB 테이블 130여 개와 복구 모듈 25개, 소유권·실행 경계를 프로세스 메모리에 두기, 같은 상태 이중 저장, 백그라운드 exec 메모리 보관, 재시작 시 승인 대기 무조건 취소.

## 8. absurd

### 8.1 무엇인지

- "the simplest durable execution workflow system … entirely based on Postgres and nothing else"(`absurd/README.md:7-12`). SQL 파일 하나(`sql/absurd.sql`, 3,150행)와 마이그레이션, SDK(TypeScript, Python, Go 실험)로 구성. 워커가 Postgres에서 pull하고 push는 지원하지 않는다(`README.md` "Push vs Pull"). 서버 프로세스는 없다. 관리 도구 `absurdctl`, 웹 UI `habitat`(Go).
- 클라이언트 프로토콜, 인증, 원격 접속 기능은 범위 밖이다.
- 저장소 안에 SQLite 관련 코드나 문서는 없다(`grep -rli sqlite` 결과 0건).

### 8.2 스키마 (`sql/absurd.sql:184-366`, 큐마다 테이블 5종)

- `t_<queue>` 태스크: `task_id uuid PK, task_name, params jsonb, headers, retry_strategy, max_attempts, cancellation, enqueue_at, first_started_at, state ∈ {pending, running, sleeping, completed, failed, cancelled}, attempts, last_attempt_run, completed_payload, cancelled_at, idempotency_key unique`(`:222-243`).
- `r_<queue>` 실행: `run_id PK, task_id, attempt, state, claimed_by, claim_expires_at, available_at, wake_event, event_payload, started_at, completed_at, failed_at, result, failure_reason`(`:245-266`).
- `c_<queue>` 체크포인트: `(task_id, checkpoint_name) PK, state jsonb, status, owner_run_id, updated_at`(`:268-280`).
- `e_<queue>` 이벤트: `event_name PK, payload, emitted_at`(`:282-289`).
- `w_<queue>` 대기 등록: `(run_id, step_name) PK, task_id, event_name, timeout_at`(`:291-302`).
- 인덱스 `r(state, available_at)`, `r(claim_expires_at) where state='running'`(`:316-336`).

### 8.3 실행 소유권(lease)과 복구

- `claim_task(queue, worker_id, claim_timeout=30, qty=1)`(`sql/absurd.sql:908-1071`):
  1. 취소 규칙(`max_delay`, `max_duration`)을 먼저 적용.
  2. `state='running' and claim_expires_at <= now`인 실행을 `for update skip locked`로 골라 `fail_run(… '$ClaimTimeout' …)`. 한 번에 qty개까지만 쓸어 claim 비용을 묶는다.
  3. `pending|sleeping`이고 `available_at <= now`인 실행을 `skip locked`로 골라 `running`, `claimed_by`, `claim_expires_at = now + timeout`으로 바꾸고, 만료된 대기 등록을 지운다.
- 체크포인트 저장 `set_task_checkpoint_state(…, p_owner_run, p_extend_claim_by)`(`:1460-1545`): 취소된 태스크는 `AB001`, 실패한 run은 `AB002` 예외. 저장하면서 lease를 연장. 기존 체크포인트 소유 run의 attempt보다 새 attempt가 크거나 같을 때만 덮어쓴다.
- TS SDK(`sdks/typescript/src/index.ts`):
  - `step(name, fn)`: `beginStep`으로 체크포인트를 찾고 있으면 캐시 값을 반환, 없으면 실행 후 `completeStep`(`:350-399`). 체크포인트 이름은 `name`, 같은 이름이 반복되면 `name#2`, `name#3`(`getCheckpointName`, `:429-434`). 이름과 등장 순서가 키다.
  - `heartbeat(seconds)` → `extend_claim`(`:592-602`). 체크포인트 저장도 lease를 연장(`:457-474`).
  - 워커 기본 `claimTimeout = 120`, `fatalOnLeaseTimeout = true`이면 claim 시간의 2배를 넘긴 태스크가 있을 때 `process.exit(1)`(`:1117-1128,1260-1276`). lease를 잃은 워커가 계속 쓰는 것을 프로세스 종료로 막는다.
- 코드 변경 규칙: "A completed step returns its cached value forever."(`docs/patterns/living-with-code-changes.md:18-20`). 대처법으로 step 이름 바꾸기, 이전 결과 정규화, 이름에 버전 붙이기, 큰 변경은 새 태스크로를 든다.
- 외부 멱등: step 안 외부 호출에는 `${ctx.taskID}:payment` 같은 안정 키를 쓰라고 안내(`docs/concepts.md:362-418`).

### 8.4 대기·타이머·이벤트

- `sleepUntil(stepName, wakeAt)`: 깨어날 절대 시각을 체크포인트로 저장하고, 재실행 때는 저장된 시각을 쓴다. 남은 시간이 있으면 `schedule_run` 후 `SuspendTask`(`index.ts:414-427`). 크래시 후에도 원래 시각에 깨어난다.
- `await_event(…, event_name, timeout)`(`sql/absurd.sql:1692-1877`): 체크포인트가 있으면 바로 반환. 없으면 이벤트 행을 `payload IS NULL` 센티널로 만들고 `FOR SHARE` 락 → run 행 `FOR UPDATE`(락 순서 고정으로 교착 방지). 이미 발행된 payload가 있으면 체크포인트로 저장하고 반환. 타임아웃으로 깨어난 경우 null 반환. 아니면 대기 등록 후 run과 task를 `sleeping`으로.
- `emit_event`: "Events are immutable once emitted: first write wins"(`:1879-1915`). 대기자가 없을 때 먼저 온 이벤트도 보관되므로 나중에 시작한 대기가 받는다.
- cron: 애플리케이션 쪽 스케줄러가 cron 표현식을 평가하고 `spawn`. 멱등 키는 `task name | cron expr | 실행 슬롯(UTC 분)`으로 중복 스케줄러·재시작을 한 태스크로 합친다(`docs/patterns/cron.md:9-40`). `pg_cron` 경로도 있다.

### 8.5 pi 활용 (문서 패턴)

- `docs/patterns/pi-ai-agent.md:1-101`: pi-agent-core + pi-ai로 에이전트 턴을 durable하게 만드는 패턴.
  1. `message_end` 이벤트마다 `completeStep(nextHandle, {message})` 후 새 `beginStep("message")`(`:69-76`).
  2. 재시도 때 `beginStep`을 반복해 메시지 로그를 다시 읽는다(`:39-49`).
  3. 마지막 메시지가 `assistant`가 아니면 `runAgentLoopContinue(...)`로 이어 간다(`:91-97`).
- 한계 [원문 + 추정]:
  - 마지막 메시지가 `assistant`이면 "Already finished on a previous attempt"로 반환한다(`:91-94`). 도구 호출을 담은 assistant 메시지가 저장된 직후, 도구 결과 저장 전에 크래시하면 마지막 메시지가 도구 호출을 담은 `assistant`다. 이 패턴은 그 경우도 완료로 보고 끝낸다 [추정: 코드 흐름으로 판단, 실행 확인 안 함]. pi-agent-core의 `runAgentLoopContinue`도 마지막 메시지가 `assistant`이면 예외를 던진다(`pi-src/packages/agent/src/agent-loop.ts:139-141`).
  - 예제는 `@mariozechner/*` 네임스페이스를 쓰고 `runAgentLoopContinue(context, config, persistEvent)` 인자 3개로 부른다. 현재 pi-src 서명은 `(context, config, emit, signal, streamFn)`이다(`pi-src/packages/agent/src/agent-loop.ts:128-134`). 예제가 현재 pi와 맞지 않는다.

### 8.6 Helm 참고

- 가져올 것:
  - 깨어날 절대 시각을 저장하는 `sleepUntil`(가정 만료점, 기대 레코드 기한).
  - first-emit-wins 이벤트 캐시와 `await_event`의 "체크포인트 → 발행된 이벤트 → 대기 등록" 순서. Helm 질문 레코드에서 답이 대기보다 먼저 오는 경우에 같은 모양을 쓴다.
  - claim 쿼리 안에서 만료 lease를 정리하고 `skip locked`로 고르는 방식, 체크포인트 저장 시 lease 연장, lease 2배 초과 시 프로세스 종료. Helm은 단일 프로세스라 lease 자체는 필요가 적지만, 스케줄러 작업의 "실행 중" 행 정리에 쓸 수 있다.
  - cron 멱등 키(작업 | 표현식 | 슬롯).
  - "완료된 step은 캐시 값을 영원히 반환" 규칙과 코드 변경 대처법. Helm 이벤트 로그 투영을 바꿀 때의 규칙 참고.
- 피할 것:
  - pi 패턴을 그대로 쓰는 것. 메시지 단위 체크포인트만으로는 도구 실행 중 크래시를 구분하지 못한다. Helm은 도구 호출마다 의도와 결과를 따로 기록한다.
  - 이름+등장 순서 키에 기대는 것. 순서가 바뀌면 다른 체크포인트를 읽는다.

## 9. pi-acp

### 9.1 무엇인지, 프로세스 구조

- "ACP adapter for pi coding agent"(`pi-acp/package.json:4`), 0.0.34, MIT. ACP JSON-RPC 2.0 over stdio로 ACP 클라이언트(Zed 등)와 통신하고 `pi --mode rpc`를 띄워 중계한다(`README.md:5-7`).
- 의존은 `@agentclientprotocol/sdk ^0.26.0`, `cross-spawn`, `zod`뿐이다. pi 패키지 의존은 없고 사용자가 설치한 `pi` 실행 파일(v0.81.0+)을 쓴다(`README.md` Prerequisites).
- 진입점: stdin/stdout을 `ndJsonStream`으로 감싸 `AgentSideConnection(conn => new PiAcpAgent(conn))`(`src/index.ts:24-52`). stdin이 끝나거나 SIGINT/SIGTERM이면 세션 자식 프로세스를 정리하고 종료(`:54-73`).

### 9.2 pi RPC 래퍼 (`src/pi-rpc/process.ts`)

- 실행: `pi --mode rpc --no-themes [--session <path>]`. 확장과 프롬프트 템플릿은 켜 둔다(`:154-171`). ENOENT·EACCES를 명확한 오류로 바꾼다(`:193-207`).
- 명령 타입(`:31-55`): `prompt`, `abort`, `get_state`, `get_available_models`, `set_model`, `get_available_thinking_levels`, `set_thinking_level`, `set_follow_up_mode`, `set_steering_mode`, `compact`, `set_auto_compaction`, `get_session_stats`, `set_session_name`, `export_html`, `switch_session`, `get_messages`, `get_commands`. 확장 UI 응답은 `{type: "extension_ui_response", id, value|confirmed|cancelled}`(`:66-69,364-366`).
- 요청마다 `crypto.randomUUID()` id를 붙여 응답을 상관하고, 타임아웃 뒤 늦게 온 응답은 버린다(`:368-414`). `type: "response"`가 아닌 줄은 모두 이벤트로 전달. JSON이 아닌 줄(pi 시작 문구)은 prelude로 모은다(`:117-140`).
- 프로세스 종료 시 대기 중 요청을 모두 reject(`:142-151`). 재접속·재전송 개념은 없다.

### 9.3 ACP 쪽 동작

- `initialize`: ACP protocol version 1만 지원. `loadSession: true`, `mcpCapabilities {http:false, sse:false}`, `promptCapabilities {image:true, audio:false, embeddedContext: env}`, `sessionCapabilities {list:{}, delete:{}}`(UNSTABLE)(`src/acp/agent.ts:239-272`).
- 이벤트 변환(`src/acp/session.ts:640-975`): `message_update`의 `text_delta` → `agent_message_chunk`, `thinking_delta` → `agent_thought_chunk`, `toolcall_*`와 `tool_execution_*` → `tool_call`/`tool_call_update`, `auto_retry_*`·`auto_compaction_*` → 안내 텍스트. 턴 종료는 `turn_end`나 `agent_end`가 아니라 `agent_settled`에서 판정(`:954-969`). 주석: pi는 `turn_end`를 하위 단계에도 쓰고, `agent_end` 뒤에도 재시도·컴팩션·대기 continuation이 이어질 수 있다.
- **확장 UI 요청**(`session.ts:899-909,977-1081`): `select` → 선택지마다 `allow_once` 옵션을 만든 ACP `requestPermission`, `confirm` → yes/no 권한 요청, `input`/`editor` → "not supported in ACP yet"를 출력하고 취소, `notify` → 메시지 청크로 출력하고 취소 응답. 권한 요청 실패 시 취소 응답.
- **큐·취소**: 실행 중에 온 prompt는 클라이언트 쪽 큐에 넣고 `queueDepth`를 `_meta`로 알린다(`session.ts:372-399`). `cancel`은 큐를 비우고 `abort`(`:405-425`).
- **세션 저장**: pi가 자기 세션을 `~/.pi/agent/sessions/...`에 저장하고, pi-acp는 `~/.pi/pi-acp/session-map.json`에 `{version:1, sessions{sessionId → {cwd, sessionFile, updatedAt}}}`만 둔다(`src/acp/session-store.ts:5-68`). 원자 쓰기는 하지 않는다(`writeFileSync`, `:34-37`).
- **session/load**: 기존 자식 프로세스를 닫고 저장된 세션 파일로 pi를 다시 띄운 뒤 `get_messages` 결과 전체를 `user_message_chunk`/`agent_message_chunk`로 다시 보낸다(`agent.ts:932-1000`). 한 ACP 연결에는 pi 자식 하나만 남긴다(`closeAllExcept`).
- MCP 서버는 받아서 저장만 하고 pi로 넘기지 않는다(`agent.ts:284-287`). 확장의 slash command는 지원하지 않는다. `fs/*`·`terminal/*` 위임도 없다(`README.md` Limitations).
- 인증: ACP "Terminal Auth". `--terminal-login`이면 pi를 터미널에서 실행해 사용자가 로그인(`src/index.ts:4-22`).

### 9.4 Helm 참고

- 가져올 것: `agent_settled`를 턴 종료 기준으로 쓰는 판정, 요청 id + 타임아웃 + 늦은 응답 폐기, prelude 분리, 확장 UI `select`/`confirm`을 권한 질문으로 바꾸는 매핑(paseo와 같은 방향). Helm이 나중에 pi CLI(RPC) 어댑터를 만들 때(브리프 33·34번) 바로 쓸 수 있는 크기(`process.ts` 432행)다.
- 피할 것: 큐를 어댑터 메모리에 두기, 세션 매핑을 원자 쓰기 없이 JSON 파일에 두기, `input`/`editor` 요청을 조용히 취소하기.

## 10. pi-chat

### 10.1 무엇인지, 프로세스 구조

- pi 확장. Discord와 Telegram 채널을 pi 세션에 연결하고, 연결마다 Gondolin micro-VM(Alpine)에서 도구를 실행한다(`pi-chat/README.md:1-5`, `AGENTS.md:1-15`). LICENSE 파일과 package.json은 Apache-2.0, README 끝 문구는 MIT로 서로 다르다.
- `/chat-spawn-all`은 채널마다 분리된 tmux 세션에 pi 워커를 하나씩 띄운다(`--chat-conversation <account/channel>` 플래그). 워커는 15초마다 상태 JSON을 `~/.pi/agent/chat/worker-status/`에 쓴다(`index.ts:852-857`).
- peer 의존이 `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`(구 네임스페이스)다(`package.json:30-34`).

### 10.2 pi 활용

- 확장 API: `registerFlag`, `registerTool`, `registerCommand`, `registerMessageRenderer`, `appendEntry`(재접속용 대화 id 영속, `index.ts:450-451`), `sendUserMessage`, `setActiveTools`, `on("session_start" | "session_shutdown" | "context" | "before_agent_start" | "agent_end" | "tool_call")`.
- 도구 교체: `session_start`에서 `createReadToolDefinition(ctx.cwd)` 등으로 정의를 받아 같은 이름으로 다시 등록하고, `execute`에서 `createReadTool(GONDOLIN_WORKSPACE, { operations: await sandbox.createReadOperations() })`처럼 VM 연산으로 위임한다(`index.ts:483-499,1300-1344`). coding-agent 도구 팩토리의 `operations` 주입으로 실행 환경을 바꾸는 실제 예다. bash 연산은 `vm.exec(["/bin/bash", "-lc", command])`로 출력 스트리밍, abort, timeout을 처리한다(`src/gondolin.ts:296-336`).
- 원격 턴 도구 제한: 채팅 턴 중에는 `tool_call`에서 허용 목록 밖 도구를 `{block: true, reason}`으로 막는다(`index.ts:1123-1133`).
- `context` 훅으로 표시용 커스텀 메시지(`chat-context`)를 모델 컨텍스트에서 뺀다(`index.ts:1362-1369`). `before_agent_start`로 시스템 프롬프트에 채널 정보, 메모리 파일, 스킬 목록을 덧붙인다(`:1371-1394`).

### 10.3 지속성·작업 큐

- 채널마다 append-only `channel.jsonl`(`src/log.ts:84-90`, fsync 없음). 레코드 타입 `checkpoint`, `inbound`, `job_queued`, `outbound`, `job_completed`, `job_failed`, `error`(`src/core/runtime-types.ts:34-98`). `recordId`는 정수 단조 증가.
- 런타임 락: `.lock` 파일을 `open(…, "wx")`로 만들고 owner 문자열 `pi-chat-<pid>-<uuid>`를 쓴다. 이미 있으면 pid가 살아 있는지 `process.kill(pid, 0)`로 확인해 죽었으면 지우고 다시 만든다(`src/log.ts:92-138`). pid 재사용은 구분하지 않는다.
- 작업 의미(`src/runtime.ts`):
  - 트리거(멘션 또는 DM)가 오면 `job_queued`를 기록하고 메모리 큐에 넣는다(`:199-237`).
  - 프롬프트는 "마지막 `job_completed`의 triggerRecordId 이후 ~ 이번 트리거"의 inbound 레코드 묶음이다(`:248-257`). 실패한 작업은 경계를 앞당기지 않는다.
  - 재접속 시 catch-up 메시지는 기록만 하고, 따라잡기가 끝난 뒤(`armAfterCurrentTail`)에 온 트리거만 작업이 된다(`:94-96,174-177`, `index.ts:751-753`).
  - 시작할 때 로그를 읽어 `nextRecordId`만 복원하고 대기 큐는 복원하지 않는다(`:87-92`). 처리되지 않은 이전 트리거의 메시지는 다음 트리거의 프롬프트 묶음에 함께 들어간다.
- 플랫폼 커서: Telegram은 `update_id + 1` offset을 `checkpoint` 레코드로 저장하고 재접속 때 그 offset부터 받는다(`src/live/telegram.ts:181,249,271-288`). Discord는 마지막 messageId 이후 페이지 조회(`src/live/discord.ts:158-191`).
- `agent_end`에서 stopReason이 `aborted`/`error`/`length`면 `job_failed`, 아니면 결과를 채널로 보내고(120초 타임아웃) `outbound` + `job_completed`(`index.ts:1396-1466`).

### 10.4 비밀

- 설정 비밀(봇 토큰, Gondolin 비밀)은 `~/.pi/agent/chat/config.json`에 평문으로 저장한다. 파일 모드를 지정하지 않는다(`src/config.ts:89-104`).
- Gondolin HTTP 훅: 비밀마다 허용 호스트를 정하고, VM 안에는 자리표시 환경변수만 두고 허용 호스트로 나가는 HTTP 요청에서만 실제 값으로 바꾼다(`src/gondolin.ts:31-43`, `README.md` Secrets). 에이전트는 실제 값을 보지 않는다.
- 런타임 비밀 교환: 도구 `chat_request_secret`이 RSA-2048 임시 키쌍을 만들고 `https://pi.dev/secret#<base64(name, desc, pubkey, requestId)>` 링크를 채팅에 보낸다. 사용자가 브라우저에서 암호화한 blob을 `!secret:<id>:<payload>`로 붙여 넣으면 RSA-OAEP(SHA-256) + AES-256-GCM으로 풀어 `/workspace/.secrets/<name>`에 쓴다. 개인키는 프로세스 메모리에만 있다(`src/secrets.ts:1-49`, `index.ts:690-706`).

### 10.5 Helm 참고

- 가져올 것: coding-agent 도구 팩토리에 `operations`를 주입해 실행 환경을 바꾸는 방법(P7의 도구 격리), 허용 호스트에서만 비밀을 치환하는 HTTP 훅 개념, 런타임 비밀을 공개키로 받는 흐름, "실패한 작업은 소비 경계를 앞당기지 않는다"는 규칙, 따라잡기 뒤에만 트리거를 받는 무장(arm) 단계.
- 피할 것: 대기 큐를 메모리에만 두기, pid만 보는 락(pid 재사용 미구분), fsync 없는 JSONL, 봇 토큰 평문·기본 모드 저장.

## 11. 사례 비교

### 11.1 클라이언트 프로토콜

| 사례 | 전송 | envelope | 요청 상관 | 버전 관리 | 큰 파일 |
|---|---|---|---|---|---|
| happy-agent | HTTP/1.1 over Unix 소켓 + SSE (터미널만 WS) | `{cursor(UUIDv7), occurredAt, type, payload}` | REST | `/v0` + 정수 26(최소 22), health 조회, 404/501 감지 | 원시 바이트 업로드 → 1회용 uploadId, Range 다운로드 |
| paseo | WS (JSON + 바이너리) | `hello`/`session{message}`/`hello.rejected`, 자체 RPC | `requestId`, `rpc_error` | 정수 1 고정 + capability/feature + `COMPAT` 태그 | WS 바이너리 청크 256 KiB, HTTP는 capability 토큰 |
| pi-web | HTTP 명령 + WS 이벤트 | `{type, …, seq?}` | REST | 협상 없음, runtime capability | WS에는 media id, 본문은 HTTP GET |
| pi-fabric | 로컬 파일·stdio(pi RPC JSONL) | 파일 프로토콜 v1, 상주 호스트 `format: 1` | 파일 이름 requestId | 알 수 없는 필드 무시 | 파일 경로 전달 |
| openclaw | WS (JSON text) + HTTP | `req`/`res`/`event` 3종, TypeBox | `id`, `ok` | 정수 4, min/max 범위에 현재 버전 포함 여부, features 광고 | WS base64 인라인 업로드(25 MiB 상한), 다운로드는 연결에 묶인 ticket URL |
| pi-acp | stdio (ACP JSON-RPC 2.0) ↔ pi RPC JSONL | ACP 표준 / pi RPC `{type, id}` | JSON-RPC id / UUID | ACP v1만 | 없음 |
| pi-chat | 해당 없음(채팅 플랫폼 API) | - | - | - | 첨부 파일 복사 |
| absurd | 해당 없음(Postgres 함수 호출) | - | - | `absurd.get_schema_version()` | - |

### 11.2 재접속·재전송

| 사례 | 시퀀스 | 영속 여부 | 재접속 처리 | 세대 감지 | 스냅샷 경계 |
|---|---|---|---|---|---|
| happy-agent | 전역 UUIDv7 커서 | 클라이언트 저널은 메모리 10,000개(내부 저널은 SQLite) | subscribe → hello → 재생 → pending 필터. 창 밖이면 `gap:true` + live | `hello.daemonId`, `daemonStartedAt` | 스냅샷이 읽기 전에 커서를 잡아 응답에 포함 |
| paseo | 에이전트별 `{epoch, seq}` | 메모리 | `fetch_agent_timeline_request after`로 페이지 반복, `staleCursor/gap/reset` | 에이전트 로드마다 새 `epoch` | tail로 원자 교체 |
| pi-web | 세션별 정수 seq | 메모리(재시작 시 0) | 서버 재전송 없음. 버퍼링 → 스냅샷 → `seq > snapshot.seq`만 적용 | seq 감소로 재시작 판정 | `transcript-snapshot`에 seq 포함 |
| pi-fabric | mesh `sequence`, tail은 generation + byte offset | 파일(영속) | `read({after})`, generation이 다르면 0부터 | generation, incarnation | 해당 없음 |
| openclaw | 연결별 정수 seq | 메모리(연결마다 초기화) | gap이면 연결 폐기 → 재접속 → 스냅샷·재구독 | `server.bootId` | `hello-ok.snapshot` + `sessions.list` |
| pi-acp | 없음 | - | `session/load`에서 전체 메시지 재전송 | - | - |
| pi-chat | 정수 `recordId`(로그), 플랫폼 offset | JSONL | 플랫폼 커서부터 catch-up 후 무장 | - | - |

### 11.3 인증·원격

| 사례 | 로컬 인증 | 원격 경로 | 기기 식별 | 토큰 저장 | Tailscale |
|---|---|---|---|---|---|
| happy-agent | Unix 소켓 0600 + Bearer 토큰 파일 0600(재시작에 회전 안 함) | Tailcat(WireGuard) 데몬 간, 모바일은 E2E relay(QR, secretbox/AES-GCM) | 없음(토큰 하나) | 평문 파일 0600 | 쓰지 않음 |
| paseo | 비밀번호(bcrypt), 실행별 local-credential | E2E relay(QR, X25519), SSH 터널, Tailscale IP 직접 바인딩 | relay 클라이언트 임시 키 | bcrypt 해시 | IP 직접 바인딩, serve·헤더 없음 |
| pi-web | 없음(Unix 소켓 권한) | VPN·SSH·리버스 프록시 권장, machine bearer 토큰 | 없음 | machines.json 0600 | 문서 권장만 |
| pi-fabric | 파일 접근 | 없음 | 없음 | mesh grant SHA-256 해시 | 없음 |
| openclaw | token(기본)/password/trusted-proxy + Ed25519 기기 서명 | LAN, tailnet, `tailscale serve`/funnel, SSH | Ed25519 키, challenge nonce 서명 | 기기 토큰 평문(SQLite 0600) | Gateway가 serve 소유, serve 전용 loopback 리스너, 헤더를 whois와 대조, 기기 신원 대체 안 함 |
| pi-acp | ACP Terminal Auth(pi 로그인) | 없음(stdio) | 없음 | pi 설정 | 없음 |
| pi-chat | 채팅 플랫폼 사용자·역할 허용 목록 | 플랫폼 봇 | 플랫폼 사용자 id | config.json 평문 | 없음 |

### 11.4 지속성·크래시 복구

| 사례 | 저장소 | 단일 writer | 재시작 시 진행 중 턴 | 결과 없는 도구 호출 | 스트리밍 델타 |
|---|---|---|---|---|---|
| happy-agent | libSQL, WAL, synchronous=FULL, append-only 레코드 + KV | 형제 `<db>.lock` 쓰기 트랜잭션 | 자동 재개(pending 레코드). 추론은 `block_reset` 후 재요청 | durable·reloadable만 같은 call ID로 재실행, 나머지 "interrupted … not retried" | 영속 안 함(offset delta 이벤트) |
| paseo | JSON 파일(원자 쓰기), 타임라인 메모리 | lifecycle mutation 큐, pid 파일 | 재개 안 함("unfinished turn is lost") | provider 몫. 생성 저널은 unknown 결과 | 메모리 |
| pi-web | pi JSONL + JSON 파일 | owner 마커(pid + start time) | 재개 안 함(종료 시 abort) | 처리 없음 | 메모리 |
| pi-fabric | pi-durable JSONL(fsync 보강) | `lease.sqlite` `BEGIN EXCLUSIVE` | 워커 relaunch 후 저널에서 재개(기본 워커는 자동 재부착 안 됨) | intent 커밋, 생성 시점 AND 현재 safe일 때만 재실행, 아니면 interrupted 오류 | 순서 마커만 커밋 |
| openclaw | SQLite(node:sqlite), WAL, STRICT | 세션 writer claim(runId, 만료 없음) + 쓰기 직전 재확인 | 5초 뒤 합성 메시지로 재개, 예산 3회 | 재실행 안 함, 재개 턴 도구를 replay-safe로 제한 | 영속 transcript는 완성 이벤트 [추정] |
| absurd | Postgres, 큐별 테이블 5종 | claim lease(기본 120초) + `skip locked` + 2배 초과 시 프로세스 종료 | 실행 재시작, 완료된 step은 캐시 반환 | step 단위. step 안 외부 효과는 사용자 멱등 키 | 해당 없음 |
| pi-acp | pi 세션 파일 + 매핑 JSON | 없음 | pi 몫 | pi 몫 | 메모리 |
| pi-chat | 채널 JSONL(fsync 없음) | `.lock` + pid 생존 확인 | 작업 큐 복원 안 함 | 해당 없음 | 메모리 |

### 11.5 pi 활용 방식

| 사례 | 방식 | 쓰는 패키지 | 버전 관리 | 이력 |
|---|---|---|---|---|
| happy-agent | 쓰지 않음 | - | - | pi-ai 3주, pi-tui 3개월 후 제거 |
| paseo | RPC 자식 프로세스 + 주입 확장 | 사용자 pi CLI | `COMPAT` 태그로 버전 차이 흡수 | ACP → SDK → RPC |
| pi-web | SDK 임베드 | coding-agent, agent-core, pi-ai | peer `^1.0.0`, 무결성 테스트 | 0.85·0.87 사고 |
| pi-fabric | 확장 + pi-durable + `Agent` 상속 | pi-durable, chord, coding-agent alias, agent-core | 정확한 버전 고정 + 런타임 검사 | - |
| openclaw | pi-tui만 | pi-tui | 1.0.0 고정 | SDK 임베드 → 2026.5.22 내부화 |
| absurd | 문서 패턴 | agent-core, pi-ai | 없음(예제가 현재 서명과 다름) | - |
| pi-acp | RPC 자식 프로세스 | 사용자 pi CLI | pi v0.81.0+ 요구 | - |
| pi-chat | 확장 | 확장 API, 도구 팩토리, pi-tui | peer `*`, 구 네임스페이스 | - |

## 12. Helm이 가져다 쓸 것과 피할 것

번호 앞 괄호는 주로 참고할 설계자다. 모두 [제안]이고 채택은 각 문서가 정한다.

### 12.1 가져다 쓸 것

1. (P7) **도구별 재실행 정책.**
   - pi-agent-core의 `AgentTool.replay?: "never" | "safe"`(`pi-src/packages/agent/src/types.ts:489-490`)를 그대로 쓴다. 기본은 `never`.
   - 재시작 시 판정은 "의도 기록 시점의 선언이 safe이고 현재 선언도 safe"(`pi-fabric/src/durable/agent.ts:98-105,229`).
   - drain 때 결과 없이 포기해도 되는 도구(`reloadable`)를 따로 둘지 검토(`happy-agent/.../AgentTool.ts:123-146`).
   - 중단된 비안전 호출은 오류 결과로 닫는다. 문구 예: `happy-agent/.../AgentBase.ts:4303`, `pi-fabric/src/durable/agent.ts:104-105`.
2. (P7) **실행 의도 → 실행 → 결과 기록의 구체 모양.**
   - 도구 배치를 실행 전에 commit하고, 결과는 순서대로 first-writer-wins로 commit, 마지막 결과와 다음 stage를 같은 트랜잭션에(`happy-agent/.../AgentBase.ts:320-337,4280-4285`).
   - "외부 효과 불확실" 상태를 두고 그 경우 재실행하지 않고 보고(`openclaw/src/state/openclaw-state-schema.sql:1532-1551`, `paseo/docs/architecture.md:339-350`).
   - 재개 턴에서 도구 집합을 replay-safe로 좁혀 모델이 상태를 확인하게 하는 선택지(`openclaw/.../main-session-restart-recovery-resume-policy.ts:129-160`, `attempt-tool-prepare.ts:386-394`).
   - 진행 중 추론은 버리고 `block_reset` 이벤트 후 같은 run으로 재요청(`happy-agent/.../AgentBase.ts:3104-3130`).
3. (P11, P7) **데몬 세대(epoch)와 재시작 정리.**
   - 시작할 때 데몬 epoch를 발급하고, 이전 epoch의 "실행 중"·"승인 대기"·"스케줄 실행 중" 행을 한 단계에서 `interrupted`로 바꾼다(`openclaw/src/gateway/server-aux-handlers.ts:100-105`, `paseo/.../schedule/service.ts:593-634`). 승인 대기를 취소할지 유지할지는 P6·P7이 정한다(openclaw는 취소).
   - 영속 재시도 예산과 크래시 루프 차단기(`openclaw/docs/gateway/restart-recovery.md:766-795,981-1003`).
4. (P11) **단일 writer 락.** OS가 쥐는 SQLite 쓰기 트랜잭션을 별도 파일에 프로세스 수명 동안 잡는다(`happy-agent/.../AgentSQLiteProcessLock.ts:22-50`, `pi-fabric/src/durable/storage.ts:54-67`). pid 파일·stale 정리가 필요 없다.
5. (P12) **재접속 순서와 경계.**
   - 구독 먼저 → hello(현재 seq, gap 여부, 데몬 epoch) → `lastSeq` 이후 재생 → 재생 중 쌓인 live 이벤트 중 재생 끝보다 큰 것만 전송(`happy-agent/.../ApiModule.ts:4456-4530`).
   - 스냅샷 응답은 읽기 전에 seq를 잡아 포함(`happy-agent/packages/happy-agent/API.md:7241-7250`, `pi-web/src/server/sessions/sessionRoutes.ts:209-218`).
   - 보존 범위를 넘었거나 epoch가 바뀌면 `reset` 응답 + 스냅샷(`paseo/.../agent-timeline-store.ts:96-130`). 클라이언트 판정표(`paseo/packages/app/src/timeline/session-stream-reducers.ts:283-304`).
   - 종료 프레임 우선 전달 예외(`openclaw/packages/gateway-client/src/protocol-client.ts:467-474`).
6. (P12, P7) **스트리밍 델타는 정본 로그에 넣지 않는다.** 델타는 휘발 채널(seq 없음 또는 별도 seq)로 보내고 정본에는 `message_end`만(`pi-fabric/src/durable/agent.ts:16-20,360-385`). 클라이언트 쪽 델타는 offset 지정으로 중복·구멍에 안전하게(`happy-agent/packages/happy-agent-client/sources/applyMessageDelta.ts:4-40`).
7. (P12, P11) **인증 모양.**
   - hello 안에서 인증하고 실패하면 `hello.rejected{reason}`(`paseo/packages/protocol/src/messages.ts:7535-7590`).
   - Tailscale 신원 헤더는 serve 전용 loopback 리스너에서만 받고 `tailscale whois`와 대조, 기기 토큰을 대신하지 않는 보조 신호로(`openclaw/src/gateway/ingress-attribution.ts:126-202`, `server-runtime-state.ts:399-404`).
   - 기기 토큰에 challenge nonce 서명을 더하는 선택지(`openclaw/src/gateway/server/connection.ts:307-318`, `packages/gateway-client/src/device-auth.ts:24-60`).
   - 서버에는 토큰 해시만 저장(`pi-fabric/src/mesh/grants.ts:1-14`). 토큰 파일은 재시작에 회전하지 않음(`happy-agent/.../daemonToken.ts:16-37`).
8. (P12, P13) **큰 파일.** 업로드는 HTTP 원시 바이트 → 1회용 uploadId(`happy-agent/.../API.md:6035-6070`), 다운로드는 짧은 수명 ticket URL을 WS 연결에 묶음(`openclaw/src/gateway/artifact-download-grants.ts:10-127`), WS 이벤트에는 id만(`pi-web/src/server/sessions/sessionRoutes.ts:179`). WS 프레임에 base64를 싣지 않는다.
9. (P7, P11) **스케줄러·타이머.**
   - 깨어날 절대 시각을 저장(`absurd/sdks/typescript/src/index.ts:414-427`).
   - cron 표현식 라이브러리는 다음 시각 계산에만, 타이머는 하나에 최대 60초 상한(WSL 일시정지·시계 점프 대비)(`openclaw/src/cron/service/timer-scheduler.ts:57-112`).
   - 재시작 때 실행 중이던 작업은 interrupted 실패로 기록하고 자동 재실행하지 않음. 놓친 실행은 상한·지연을 두고 한 번만(`openclaw/src/cron/service/startup-run-repair.ts:33-118`, `timer-execution-timeout.ts:36-42`, `paseo/.../schedule/service.ts:642-653`).
   - 답이 대기보다 먼저 와도 잃지 않게 first-emit-wins 저장 후 대기 시작 시 먼저 조회(`absurd/sql/absurd.sql:1692-1915`).
   - 예약 메시지는 pending 행 + 시작 시 재무장 + 메시지 id 단일 accept(`happy-agent/.../scheduling/README.md:42-58`).
10. (P4) **pi 포크 관리.**
    - 포크를 재동기화할 때 export 표면 무결성 테스트를 둔다(`pi-web/src/server/piSdkIntegrity.test.ts:1-75`).
    - pi의 자체 retry와 세션 저장은 끄고 Helm 하나만 남긴다(openclaw의 "nested SDK retry"와 transcript 이중 쓰기 기록, `openclaw/CHANGELOG/2026.5.22.md:226,255,270`).
    - 도구 실행 환경은 coding-agent 도구 팩토리의 `operations` 주입으로 바꾼다(`pi-chat/index.ts:483-499`, `src/gondolin.ts:296-336`).
    - 나중의 pi CLI 어댑터는 `agent_settled`를 턴 종료로, 확장 UI `select/confirm/input/editor`를 Helm 질문으로 매핑(`pi-acp/src/acp/session.ts:954-1081`, `paseo/.../pi/agent.ts:940-1093`).

그 밖에 참고할 것:

- (P12) 프로토콜 버전은 정수 하나 + capability 광고 + additive 필드, 호환 코드는 `COMPAT(name): added in vX, remove after <date>` 태그(`paseo/docs/protocol-compatibility.md`, `openclaw/.../connect-admission.ts:232-266`, `happy-agent/.../protocol/daemon.ts:13-25`).
- (P12) 메서드 표 한 곳에 이름·권한·도입 버전(`openclaw/src/gateway/methods/core-descriptors.ts:13-60`).
- (P12) 느린 소비자: 소켓별 송신 상한(8 MiB, `paseo/docs/architecture.md:268`)과 "버린 이벤트도 seq를 소비해 gap으로 보이게"(`openclaw/src/gateway/server-broadcast.ts:458-467`).
- (P11) graceful drain API와 systemd `TimeoutStopUSec`에 맞춘 종료 예산(`happy-agent/.../API.md:1565-1600`, `openclaw/gateway-shutdown-budget.mjs:3-38`).
- (P11) SQLite 운영값: WAL, `busy_timeout=5000`, `foreign_keys=ON`, 네트워크 FS(`/mnt/c` 등)에서 WAL 거부(`openclaw/src/infra/sqlite-wal.ts:50-56,233-277`, `sqlite-wal-filesystem.ts:278-303`). 시작 시 쓰기 트랜잭션 한 번으로 복구 대기(`happy-agent/.../openAgentSQLiteDatabase.ts:40-63`). DDL을 단일 SQL 원본에 두고 `user_version`으로 확인(`openclaw/src/state/openclaw-agent-db-schema.ts:368,421-425`).
- (P13) 리소스 version 체인 `previousVersion → version`과 If-Match 409에 현재값 포함(`happy-agent/.../API.md:368-411`). 캐시 우선 표시와 "늦은 캐시 읽기가 진전된 상태를 덮지 않음"(`paseo/docs/architecture.md:126-140`). 오프라인 송신 outbox(멱등 키, 상한, 만료)(`openclaw/docs/platforms/ios.md:27`).
- (P6, P7) 승인 레코드: 승인 시점 실행 plan 저장, allow-once는 `consumed_at`으로 한 번만(`openclaw/src/state/openclaw-state-schema.sql:365-490`, `docs/tools/exec-approvals.md:716-723`). 헤드리스 승인 타임아웃 기본 거부(`pi-fabric/docs/decisions.md:109-116`). 사람을 기다리며 도구를 붙잡지 않는 ask(`pi-web/src/server/sessions/askUserTool.ts:94-104`).

### 12.2 피할 것

1. 클라이언트용 이벤트 시퀀스를 메모리에만 두기(happy-agent, paseo, pi-web, openclaw 모두). 재시작마다 전체 재동기화가 필요하고 클라이언트마다 복구 로직이 생긴다(`openclaw` 네 클라이언트의 중복 구현).
2. 소유권과 "도구가 실행에 들어갔는가"를 프로세스 메모리에만 두고, 크래시 후 transcript 꼬리를 해석하기(`openclaw/src/agents/agent-tools.before-tool-call.state.ts:6-11`, resume-policy 460행).
3. 같은 상태를 두 곳에 쓰기: pi 세션 JSONL과 호스트 저장(openclaw 2026.5.12 기록), `entry_json`과 승격 컬럼(openclaw), 메모리 타임라인과 provider 이력(paseo).
4. 업스트림 pi를 peer 범위로 따라가며 런타임 검사를 두지 않기(pi-web 0.85.0 사고). experimental 패키지(pi-durable)를 버전 고정 없이 쓰기.
5. RPC 스트림에 없는 상태를 문자열 마커로 빼내기(`paseo/.../pi/agent.ts:102-104`). Helm은 포크하므로 정식 이벤트 필드를 추가한다.
6. 대기 중 권한·질문을 메모리에만 두기(paseo, pi-web). Helm 질문 레코드는 영속한다.
7. 비밀을 평문으로 저장하기(happy-agent SQLite, openclaw 기기 토큰, pi-chat config). 웹 저장소에 개인키를 두기(openclaw 웹).
8. loopback 자동 승인을 기본으로 켜기(`openclaw/docs/gateway/pairing.md:238-246`). serve 뒤의 데몬에는 원격 요청도 127.0.0.1에서 온다 [추정].
9. 데몬이 `tailscale serve`를 자식 프로세스로 소유하고 sudo로 fallback하기(`openclaw/src/infra/tailscale.ts:408-445`). Helm은 브리프 26번대로 Windows 호스트에서 serve를 관리한다. Tailscale IP 직접 바인딩(paseo)도 브리프와 맞지 않는다.
10. 한 파일에 몰린 거대 모듈(happy-agent `ApiModule.ts` 7,981행, pi-web `piSessionService.ts` 5,521행, paseo `pi/agent.ts` 2,817행)과 사례 규모(openclaw 메서드 509, 상태 테이블 130여 개).
11. 문서와 코드의 표류(happy-agent `EVENTS.md`, `docs/architecture.md`, `README.md`). 프로토콜 문서를 스키마에서 생성하거나 테스트로 고정한다.

## 13. 기존 조사 주장 판정

판정 기준: 확인 = 코드와 맞음, 불일치 = 코드와 다름(전부 또는 일부), 확인 불가 = 사례 저장소 범위 밖이거나 근거 없음.

### 13.1 `docs/v0.3/audit/backend-oss-research.md`

| 위치 | 주장 | 판정 | 근거·보충 |
|---|---|---|---|
| §0-1 | 재시작 뒤 진행 중 턴까지 이어서 실행하는 것은 OpenCode v2, Codex, pi-durable 정도 | 불일치 | happy-agent(`AgentSystemLocal.ts:756-790`, `AgentBase.ts:3104-3130`)와 openclaw(`restart-recovery.md:700-704`)도 재개한다. OpenCode·Codex는 확인 불가(사례 밖) |
| §1.1 Happy | 통신은 HTTP over Unix 소켓, SSE, 전역 이벤트 커서 | 확인 | `API.md:11-16`, `AgentSocket.ts:55-59`, `ApiModule.ts:4456-4530` |
| §1.1 Happy | 재시작 후 진행 중 턴: 세션·goal 유지, 턴 재개는 미확인 | 불일치(갱신) | 턴을 재개한다. 비안전 도구는 interrupted 오류(`AgentBase.ts:4296-4304`) |
| §1.1 Happy | 저장 SQLite | 확인 | libSQL(`openAgentSQLiteDatabase.ts:40-63`) |
| §1.1 Happy | 원격·인증: 토큰 파일 0600, E2E relay | 확인 | `prepareLocalApiToken.ts:7-56`. E2E relay는 모바일용이고 데몬 간은 Tailcat(`docs/architecture.md:84-89`) |
| §1.1 Happy | 커널 지점: 권한 모드, 플러그인 | 확인 | 모드 4종 기본 auto(`AgentPermissionMode.ts:12-34`), `AgentModule` 훅 46개 |
| §1.2 Happy | "pi 기반 데몬의 실제 예" | 불일치 | pi 런타임을 쓴 적이 없다. pi-ai 3주(07-04~07-23), pi-tui 3개월. 현재 pi 의존 0 |
| §1.2 Happy | 전역 durable 이벤트 큐에 UUIDv7 커서, 재생 후 이어 받기 | 불일치(일부) | UUIDv7 커서와 재생은 맞다. 클라이언트 저널은 메모리 10,000개라 재시작 후 재생 불가(`ApiEventJournal.ts:35-80`). durable한 것은 내부 저널(`EventsDatabase.ts:57-110`) |
| §1.1 Paseo | WebSocket(+E2E relay), JSON 파일, 비밀번호·VPN·E2E relay·SSH | 확인 | §4. VPN은 Tailscale IP 직접 바인딩 안내. 타임라인은 JSON에도 저장하지 않음(메모리) |
| §1.1 Paseo | 재개 가능 상태로 남김, 턴은 미확인 | 확인(갱신) | 턴은 재개하지 않는다("the unfinished turn is lost", `docs/agent-lifecycle.md:37-38`) |
| §1.1 Paseo | 데몬 플러그인, 도구 카탈로그 | 확인 | `docs/plugins.md:1-7`, `agent/tools/types.ts:22-47` |
| §1.2 Paseo | pi(`--mode rpc`), Codex(app-server), Claude(Agent SDK), OpenCode(서버 API), Copilot(ACP) 어댑터 | 확인 | `provider-registry.ts:188-228`. OMP, Cursor 등 ACP 계열도 있다 |
| §1.2 Paseo | pi 확장의 UI 요청(select, confirm)을 데몬의 권한 질문으로 | 확인 | `pi/agent.ts:940-1093`. input·editor도 질문으로 바꾼다. pi-acp도 select·confirm을 ACP 권한 요청으로 바꾼다(`pi-acp/src/acp/session.ts:1019-1081`) |
| §2.1 Absurd | 0.5.0 (08-04), Postgres만 | 확인 | 최신 커밋 `5b97022` "after 0.5.0 release", `README.md:7-12` |
| §2.1 Absurd | SQLite: X (개념 증명만) | 확인 불가 | 저장소 안에 SQLite 언급이 없다(`grep -rli sqlite` 0건). "개념 증명"의 출처를 저장소에서 찾지 못했다 |
| §2.1 Absurd | awaitEvent가 먼저 온 이벤트도 보관 | 확인 | `emit_event` first write wins, `await_event`가 발행된 payload를 먼저 확인(`sql/absurd.sql:1692-1915`) |
| §2.2 | Absurd 공식 Pi 패턴은 `message_end`마다 step 하나 완료 | 확인 | `docs/patterns/pi-ai-agent.md:69-76`. 예제는 구 네임스페이스와 이전 서명(인자 3개)을 쓴다 |
| §2.2 | Absurd는 replay 대신 checkpoint 재사용이라 step 이름·순서 변경 제약이 덜하다 | 일부 불일치 | checkpoint 재사용은 맞다. 다만 키가 `name`과 같은 이름의 등장 순번(`name#n`)이라(`index.ts:429-434`) 같은 이름 step의 개수·순서가 바뀌면 다른 체크포인트를 읽는다. 저장소도 코드 변경 대처 문서를 따로 둔다(`docs/patterns/living-with-code-changes.md`) |
| §3 | pi-acp는 `pi --mode rpc`를 띄워 중계 | 확인 | `pi-acp/src/pi-rpc/process.ts:154-171` |
| §3 | pi-acp는 파일·터미널 위임, MCP 서버 전달, pi 확장 slash command를 지원하지 않음 | 확인 | `README.md` Limitations, `src/acp/agent.ts:284-287`. 확장 UI의 select·confirm은 권한 요청으로 지원한다 |

### 13.2 `docs/v0.3/audit/pi-runtime-options.md`

| 위치 | 주장 | 판정 | 근거·보충 |
|---|---|---|---|
| §0-2 | pi로 시작한 대표 프로젝트 두 곳(OpenClaw, Happy Agent)은 나중에 pi 런타임을 걷어내고 루프·세션·도구 정책을 직접 소유했다 | 일부 불일치 | OpenClaw는 확인(`CHANGELOG/2026.5.22.md:29`). Happy Agent는 루프를 첫날부터 자체 구현했고 pi 런타임(agent-core, coding-agent)을 의존한 적이 없다 |
| §0-2 | OpenClaw는 지금도 pi-tui만 쓴다 | 확인 | `package.json:2269`, `docs/agent-runtime-architecture.md:25` |
| §2 표, 확장 | pi-chat: pi가 거의 전부. 문제: pi 프로세스와 권한을 공유 | 일부 확인 | 확장은 pi 프로세스 권한으로 돈다. 다만 read/write/edit/bash는 Gondolin VM으로 보내 실행하고, 비밀은 허용 호스트에서만 치환한다(`pi-chat/index.ts:483-499`, `src/gondolin.ts:31-43`) |
| §2 표, RPC | Paseo, pi-acp가 RPC 방식 | 확인 | `paseo/docs/providers.md:70`, `pi-acp/src/pi-rpc/process.ts:162` |
| §2 표, RPC | RPC 스트림에 없는 상태를 주입 확장과 notify 문자열 마커로 우회 | 확인 | `paseo/.../pi/agent.ts:102-104,880-894`, `pi/extensions/contract.ts:78-79` |
| §2 표, RPC | pi 업그레이드마다 수명주기 버그 | 일부 확인 | 업그레이드 원인 사례(`98d3281c` pi 0.84, `4417d7c4` Pi 0.99)는 있다. 수명주기 버그 다수는 업그레이드와 무관(`c424f829`, `81ad0079`, `26f227be`). "매번"은 확인 못 함 |
| §2 표, RPC | Paseo는 ACP 브리지에서 직접 RPC로 옮김 | 불일치 | ACP(`65573499`) → SDK 인프로세스(`fbc2371b`) → RPC(`4cf985c2`). RPC의 직전 단계는 SDK 임베드이고, 옮긴 이유는 사용자 pi 설치본과 확장 로딩 경로·버전 불일치다 |
| §2 표, SDK | pi-web: pi가 루프·도구·세션·리소스 로딩, 데몬·클라이언트·정책은 직접 | 확인 | `pi-web/src/server/sessions/piSessionService.ts:754-763,1035-1076` |
| §2 표, SDK | 0.85.0 패키징 사고로 로드 불가, 0.87 SessionManager 의미 변경 | 확인 | `pi-web/CHANGELOG.md:69,95`, `piSdkIntegrity.test.ts:3-8`, `pi-src/packages/coding-agent/CHANGELOG.md:393,542`. "SessionManager 의미 변경"은 pi 쪽 CHANGELOG 문구 |
| §2 표, SDK | pi와 함께 업그레이드해야 하고 데몬 재시작 시 세션이 끊김 | 확인 | `pi-web/CHANGELOG.md:9`("Restarting the daemon interrupts active sessions"), `piSessionService.ts:1458-1501` |
| §2 표, SDK | OpenClaw(~2026-05)가 SDK 임베드 | 확인(월 단위) | "embedded Pi SDK packages"(`2026.2.21.md:103`)를 2026.5.19까지, 2026.5.22에 내부화. 날짜 단위는 확인 못 함(릴리스 번호 체계) |
| §2 표, agent-core + pi-ai | Absurd 패턴: 메시지 단위 체크포인트만으로는 도구 실행 중 크래시를 구분하지 못함 | 확인 | 마지막 메시지가 assistant면 완료로 보고 반환(`absurd/docs/patterns/pi-ai-agent.md:91-94`). 도구 호출을 담은 assistant 직후 크래시도 같은 분기로 간다 [추정: 실행 확인 안 함] |
| §2 표, pi-ai만 | Happy Agent(2026-07~08) pi-ai만, 이후 pi-ai도 제거 | 불일치(기간) | 2026-07-04 ~ 2026-07-23. 8월까지 가지 않았다. pi-tui는 2026-10-10까지 |
| §2 표, pi-durable | pi-fabric: pi가 루프·크래시 복구·저장소, 직접 만든 것은 클라이언트 프로토콜·승인·정책 | 일부 불일치 | 저장소·스케줄러·체크포인트는 pi-durable. 기본 러너의 루프는 Fabric 자체(`pi-fabric/src/durable/agent.ts:10-11,91-317`). 네트워크 클라이언트 프로토콜은 없다 |
| §2 표, pi-durable | 스트리밍 델타 저장 시 저널이 급증해 순서 마커만 커밋 | 확인 | `pi-fabric/src/durable/agent.ts:16-20,360-385`, 테스트 #229. upstream pi-durable 내장 generation은 100 ms 쓰로틀이라 "마커만"은 Fabric의 선택 |
| §2 표, pi-durable | 정확히 한 번 실행은 보장하지 않음 | 확인 | `pi-fabric/docs/durable-pi.md:55-61,72-73,228-229` |
| §2 표, pi-durable | 사람 승인 단계 없음 | 불일치(pi-fabric 기준) | pi-fabric은 위험 등급별 `ask`와 헤드리스 durable decision이 있다(`src/core/approval-controller.ts:172-296`, `docs/decisions.md:109-116`). 다만 기본 설정이 모두 `allow`(`src/config.ts:491-497`). pi-durable 자체에는 승인 프리미티브가 없고 `beforeTool` 차단만 있다(`pi-src/packages/durable/README.md:138`) |
| §3 안 3 | 클라이언트 재접속은 시퀀스 번호 기반 replay(Happy Agent의 커서 방식 참고) | 확인 불가(전제 수정 필요) | Happy Agent 커서 방식은 재시작을 넘지 못한다. 참고할 부분은 재개 순서와 gap 신호이고, 재시작을 넘는 replay는 Helm이 SQLite seq로 새로 만든다 |
| §3 안 6 | pi 실험 서버는 세션별 worker, 세션별 SQLite, 복제 상태 전달 | 확인 불가 | 사례 범위 밖. `pi-src/packages/coding-agent/src/experimental/`에 `server.ts`, `session-worker.ts`, `radius-relay.ts` 등 파일이 있음만 확인 |
| 출처 | ypi: 호스트 pi 버전 불일치가 흔한 고장 원인 | 확인 불가 | 사례 저장소에 없음 |

### 13.3 `docs/v0.3/audit/mastra-review.md`

- 사례 8곳과 직접 관련된 주장이 없다. 판정할 항목이 없다.
- 참고: mastra-review §9가 권하는 "실행 소유권 lease와 fencing(10초 갱신, 30초 만료)"은 사례에서 다른 모양으로 나타난다. absurd는 claim lease(기본 120초) + 저장 시 연장 + 2배 초과 시 프로세스 종료, openclaw는 만료 없는 runId claim + 쓰기 직전 재확인, happy-agent와 pi-fabric은 OS 락으로 lease 자체를 두지 않는다.

### 13.4 `docs/design/process/00-design-brief.md`

| 항목 | 내용 | 판정 | 보충 |
|---|---|---|---|
| 26 | 원격 접속 구성 근거로 backend-oss-research §5 | 확인(사례 보강) | 같은 구성을 쓰는 사례는 openclaw(serve + 헤더 whois 대조 + 기기 토큰)뿐이다. 다만 openclaw는 serve를 데몬이 소유한다 |
| 30 | 재시작 시 중단된 도구 호출을 "중단됨"으로, 안전한 도구만 재실행 | 확인(사례 보강) | happy-agent, pi-fabric이 같은 규칙. openclaw는 안전한 도구도 자동 재실행하지 않고 재개 턴의 도구만 좁힌다 |
| 31 | 이벤트에 단조 seq, 재접속 시 `lastSeq`부터 재전송 | 사례 없음 | 8곳 중 데몬 재시작을 넘는 네트워크 재전송 구현은 없다. 1장 1번 참고 |

## 14. 설계자별 참고 지도

| 설계자 | 먼저 볼 절 | 핵심 파일 |
|---|---|---|
| P4 pi 활용 | 3.2, 4.2, 5.2, 6.2, 7.2, 8.5, 9, 10.2, 11.5, 12.1-10 | `pi-web/src/server/piSdkIntegrity.test.ts`, `pi-chat/index.ts:483-499`, `pi-acp/src/pi-rpc/process.ts`, `openclaw/CHANGELOG/2026.5.22.md`, `pi-src/packages/agent/src/types.ts:489-490` |
| P7 런타임 | 3.5, 3.6, 6.5, 7.5, 7.6, 8.3, 8.4, 11.4, 12.1-1·2·3·6·9 | `happy-agent/packages/happy-agent-base/sources/AgentBase.ts`, `pi-fabric/src/durable/agent.ts`, `openclaw/src/agents/main-session-recovery/`, `openclaw/src/cron/service/`, `absurd/sql/absurd.sql` |
| P11 데몬 | 3.1, 3.4, 3.5, 5.1, 7.4, 7.5, 11.3, 11.4, 12.1-3·4·7·9 | `happy-agent/.../AgentSQLiteProcessLock.ts`, `pi-fabric/src/durable/storage.ts`, `openclaw/gateway-shutdown-budget.mjs`, `openclaw/src/gateway/ingress-attribution.ts`, `openclaw/src/infra/sqlite-wal.ts` |
| P12 프로토콜 | 3.3, 4.3, 5.3, 7.3, 11.1, 11.2, 12.1-5·6·7·8 | `happy-agent/.../ApiModule.ts:4456-4530`, `paseo/packages/protocol/src/messages.ts`, `paseo/.../agent-timeline-store.ts`, `openclaw/packages/gateway-protocol/src/schema/frames.ts`, `openclaw/src/gateway/artifact-download-grants.ts` |
| P13 앱 | 3.7, 4.7, 5.6, 7.7, 12.1 그 밖 | `happy-agent/packages/happy-agent-client/sources/HappyReducer.ts`, `paseo/packages/app/src/timeline/session-stream-reducers.ts`, `pi-web/src/client/src/controllers/sessionController.ts`, `openclaw/docs/platforms/ios.md` |

## 15. 확인 못 한 것

- Happy 데스크톱·모바일 앱, Paseo relay 서버(Elixir)의 내부: 별도 저장소.
- paseo 크래시 직후 `lastStatus: running` 레코드가 UI에 어떻게 보이는지(실행 확인 안 함).
- openclaw: 최신 커밋의 실제 diff(shallow), cron 놓친 실행의 coalesce 세부, `state_leases` 기본 길이, macOS Keychain 범위, Web Push 발송 세부, HTTP 업로드 라우트 존재 여부.
- happy-agent worklet·플러그인 호스트 구현 위치.
- absurd pi 패턴의 크래시 동작은 코드 흐름으로만 판단했고 실행하지 않았다.
- pi 실험 서버(`pi-src/packages/coding-agent/src/experimental/`)의 내용.

## 16. 출처

- 사례 저장소: `~/projects/_ref/{happy-agent, paseo, pi-web, pi-fabric, openclaw, absurd, pi-acp, pi-chat}` (커밋은 0.3절).
- pi 소스: `~/projects/_ref/pi-src` 커밋 `cdaf6c2`.
- 이력 확인용 별도 클론: happy-agent(blobless bare, 2,501 커밋), paseo(blobless bare, 5,798 커밋). 위치는 S4 세션 scratchpad.
- 조사 메모: `.helm-design-work/S4/{happy-agent, paseo, pi-web, pi-fabric, openclaw, openclaw-gateway, openclaw-runtime}.md`.
- 비교 대상 문서: `docs/v0.3/audit/backend-oss-research.md`, `docs/v0.3/audit/pi-runtime-options.md`, `docs/v0.3/audit/mastra-review.md`, `docs/design/process/00-design-brief.md`.

<!-- 0단계 완료 -->
