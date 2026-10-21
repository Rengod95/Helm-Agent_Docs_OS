# 에이전트 런타임 프로세스 구조 조사 (설계용, 구현 아님)

조사일 2026-10-21. 표기: [원문] 소스·문서에서 직접 확인, [추측] 추론, [의견] 설계 판단, [2차] 공식이 아닌 블로그·요약 사이트. 경로 약칭: `PI` = `~/projects/_ref/pi-src/packages`, `PX` = `PI/coding-agent/src/experimental`, `OC` = `scratchpad/ext/opencode/repo`, `CC` = `scratchpad/ext/claude-code/docs`, `OMP` = `scratchpad/ext/omp/repo`, `HM` = `scratchpad/ext/hermes/repo`. 기존 보고서(`research/refs/*.md`, `ref-synthesis.md`)에 이미 있는 사실은 반복하지 않고 필요한 곳에서만 인용한다. 코드 실행·설치는 하지 않았다.

## 0. 결론 먼저

1. 데몬이 없어도 pi durable 식 "지속성"(크래시 뒤 체크포인트 재개, 분기, 승인 대기 복구)은 얻는다. pi durable 자체에는 상주 워커가 없고, 저장소를 다시 열 때 재개한다. [원문]
2. 데몬이 있어야 하는 것은 "지속성"이 아니라 "계속 실행"이다. 앱·터미널을 닫아도 도는 작업, 예약 실행, 다중 클라이언트 동시 접속, 원격 접속, 알림이 여기에 든다. 다만 "세션당 분리된 자식 프로세스가 일이 끝나면 스스로 종료"하는 중간 형태(pi 실험 서버)는 상시 데몬 없이도 앞의 일부를 해 준다. [원문]
3. 검증된 구조는 둘로 모인다. (a) 서버/클라이언트 분리 + 클라이언트가 서버를 자동 기동(opencode v2, pi 실험 서버, Claude Code 백그라운드 감독자, Hermes 게이트웨이). (b) 앱이 서버를 자식 프로세스로 띄우고 stdio로 대화(Codex app-server). 데스크톱과 CLI가 서로 다른 경로를 쓰면 기능을 두 번 만들게 된다는 교훈은 Goose가 공개적으로 적었다. [원문]
4. 권고: "엔진은 프로세스와 무관한 라이브러리, 호스트 계약은 하나, 전송만 교체". CLI는 기본 in-process, 데스크톱은 자식 엔진(stdio), 필요할 때 켜는 공유 서비스 모드(등록 파일 + 자동 기동 + 유휴 종료)를 뒤 단계로 얹는다. 같은 세션의 동시 쓰기는 세션 단위 OS 잠금으로 막고, 충돌 시 "위임 / 읽기 전용 / 분기" 중 하나로 내려간다.

## 1. Q1: pi durable은 어떻게 지속성을 얻는가

### 1.1 durable 패키지 자체: 상주 워커 없음, 열 때 재개

- README 첫 단락: 프로세스가 중간에 죽으면 저장소를 다시 열 때 멈춘 지점에서 이어 받는다 (`PI/durable/README.md:5`). [원문]
- 저장소 소유는 한 프로세스다. "One process owns a storage at a time; there is no cross-process locking" (`PI/durable/README.md:623`). [원문]
- 열기: `Harness.open`은 살아 있는 task를 읽어 `running`을 `pending`으로 되돌리고(체크포인트 보존) 아무것도 실행하지 않는다 (`PI/durable/src/harness/scheduler.ts:287-318`, 주석 "Dispatches nothing"). 실행은 `harness.resume()` 또는 첫 submit/wait가 켠다 (`scheduler.ts:321-324`, `PI/durable/README.md:110-112`). [원문]
- `waiting` task는 그대로 남고 열 때 재평가된다 (`PI/durable/docs/spec.md:1898-1915`). [원문] 승인 대기는 저장소에 기록된 상태일 뿐, 대기 중에 돌아가는 프로세스는 없다.
- `close()`는 task 결과를 쓰지 않는다. 호출을 신호로 멈추고 다음에 열 때 이어진다 (`spec.md:2011`). [원문]
- 외부 효과는 "의도 커밋 → 효과 수행 → 결과 커밋" 3단이고, 의도 단계에서 열리면 "효과가 이미 일어났을 수 있다"고 보고 핸들러가 재시도·폴링·중단 기록 중 하나를 택한다 (`spec.md:1917-1925`). [원문]
- 타이머: `sleep(until)`은 Harness 시계와 비교하고, 만료 확인용 타이머는 `unref`되어 프로세스를 붙잡지 않는다 (`spec.md:1850, 1861-1864`). [원문] 프로세스가 없으면 깨어나지 않는다. 예약·알림 기능은 durable 안에 없다.
- SQLite는 WAL + `synchronous=NORMAL`이라 프로세스 크래시에는 안전하고 전원 장애에는 최근 커밋이 날 수 있다 (`research/refs/pi-durable.md` 3.3절, `PI/durable/src/storage/sqlite/node.ts:190`). [원문]

대조: `~/projects/_ref/absurd`는 Postgres에 task를 두고 상주 워커가 큐에서 가져가는 구조다 (`absurd/README.md:74-76, 180-198` `startWorker`). 이 "상주 워커" 모델은 pi durable에 없다. [원문] 두 프로젝트를 같은 계열로 보면 안 된다.

### 1.2 pi의 서버 계층: 상시 데몬은 없고 "필요할 때 뜨는 프로세스"가 있다

`packages/server`, `client`, `protocol`은 모두 "Experimental"이다. 실제 프로세스 배치는 `PX`에 있고 세 겹이다. [원문]

| 프로세스 | 역할 | 수명 | 근거 |
|---|---|---|---|
| coordinator | 서버와 클라이언트 사이 불투명 메시지 라우터(Unix 소켓) | 서버·피어·연결이 모두 없으면 250ms 뒤 종료 | `PX/coordinator.ts:187-198`(없으면 spawn), `:264`, `:483-496` |
| server | 세션 목록·attach 라우팅. 클라이언트가 접속할 때 없으면 자동 기동 | 연결 0 + 워커 0이면 1초 뒤 퇴장, 시작 후 10초 유예. `keepAlive`면 상주 | `PX/server.ts:145-190`(activateServer), `:244-245`, `:296-320` |
| session-worker | 세션 하나의 Harness와 SQLite를 소유. `detached` + `unref`로 분리 기동 | attach 수요 0 + Harness에 live task 0이면 스스로 퇴장 | `PX/process.ts:40-70`, `PX/session-worker.ts:183-305, 560-594` |

핵심 동작은 다음과 같다.

- 워커는 열릴 때 `proper-lockfile`로 세션 잠금을 잡고(stale 2초, 갱신 1초, 최대 8초 재시도, `session-worker.ts:517-522`), Harness를 연 뒤 곧바로 `harness.resume()`을 부른다 (`:594`, 주석 "Recovered work from an interrupted turn continues now"). [원문]
- 퇴장 조건은 "수요 초기화됨 + 보류 0 + Harness 비활성 + attach 0"이다. 주석: "Every live task, background work included, keeps the worker and its Session open" (`session-worker.ts:292-304, 592`). [원문] 클라이언트가 모두 떠나도 live task(백그라운드 서브에이전트, 도구 실행)가 있으면 워커는 계속 돈다. "앱을 닫아도 계속 도는 작업"의 최소 구현이다.
- 서버가 시작할 때 미완료 세션을 훑어 깨우는 코드는 찾지 못했다 (`server.ts`, `session-worker-manager.ts`, `session-catalog.ts`에서 resume·recover·startup 검색). [원문: 부재 확인] 즉 크래시 뒤 재개는 "누군가 그 세션에 attach해 워커가 열릴 때" 일어난다.
- 서버가 죽어도 워커는 고아 수요 유예 30초 동안 새 서버 세대를 기다린다 (`session-worker.ts:307-308`). 서버는 교체 가능한 프로세스로 설계되었다 (`PI/server/README.md` 끝 단락). [원문]
- 인증은 앱 정책에 맡긴다. Unix 전송은 피어 인증을 구현하지 않는다 (`PI/server/README.md`). [원문]
- 별도로 `PX/durable/main.ts`는 서버 없이 한 프로세스가 모델·Harness·SQLite·TUI를 모두 소유하는 단독 모드다. 세션 디렉터리 잠금을 쓰고 크래시로 남은 잠금은 10초 뒤 stale이다 (`PX/durable/README.md`, `PX/durable/sessions.ts:47`). [원문]

### 1.3 기능별로 데몬이 필요한가

| 기능 | 데몬 없이 | 상주/분리 프로세스 필요 | 근거·메모 |
|---|---|---|---|
| 크래시/종료 후 재개 | 가능. 다음 open에서 체크포인트 재개 | "알아서 이어 가려면" 누군가 시작해야 함 | pi durable `open()`/`resume()` [원문]. opencode는 서비스 기동 시 write-ahead claim이 남은 세션을 자동 재개 (`OC/specs/v2/session.md:57-66`, `OC/packages/core/src/session/store.ts:198-255`) [원문] |
| 분기, 되감기, 이력 조회, 검색 | 가능 | 아님 | 저장소 읽기만 필요 [원문] |
| 승인 대기 복구 | 가능. 대기 상태가 저장소에 있음 | 승인 "후" 이어 달리려면 프로세스가 있어야 함 | pi `waiting`은 열 때 재평가. Claude Code `defer`는 도구를 실행하지 않고 종료했다가 재개 때 훅이 다시 결정 (`CC/hooks.md:1153`, `research/refs/claude-code.md:196`). Codex는 클라이언트가 답하기 전에 턴이 끝나면 대기 요청을 지운다 (https://learn.chatgpt.com/docs/app-server `serverRequest/resolved`) |
| 앱·터미널을 닫아도 계속 도는 작업 | 불가 | 필요. 형태는 (a) 상시 감독자 (Claude Code) (b) 작업 있을 때만 사는 분리 워커 (pi) (c) 원격 클라우드 (Codex cloud) | Claude 감독자 `CC/agent-view.md:815-829`. pi 워커는 위 1.2절. Codex cloud: "Each task has its own workspace and can keep working while your computer is asleep" (https://learn.chatgpt.com/docs/cloud) |
| 예약 실행 | OS 스케줄러(cron/launchd)가 "한 번 실행하고 종료"하는 CLI를 부르면 가능 [추측] | 앱이 켜져 있거나 상주 틱 프로세스 필요 | Hermes: 게이트웨이 안의 60초 틱, 잡마다 새 AIAgent (`research/refs/hermes.md:286`). Claude Code Desktop 예약은 컴퓨터가 켜져 있고 Desktop이 실행 중이어야 하며, 꺼져도 되는 것은 클라우드 작업뿐 (`CC/scheduled-tasks.md:24-37`). pi durable엔 없음 |
| 여러 클라이언트 동시 접속 | 읽기 전용 관찰은 가능(SQLite 폴링) [추측]. 토큰 스트림·입력 주입은 불가 | 필요. 세션 실행을 가진 프로세스 하나가 여러 연결에 중계 | pi server "multi-presentation attachment" (`PI/server/README.md`). opencode SSE 단일 피드 (`research/refs/opencode.md:105`). Codex는 연결마다 `initialize`하고 구독도 연결별 |
| 원격·폰 접속 | 불가 | 필요. 인바운드 서버 또는 아웃바운드 릴레이 | Claude Remote Control: 로컬 세션은 "outbound HTTPS requests only", 릴레이가 중계하며 로컬 프로세스는 살아 있어야 한다 (https://code.claude.com/docs/en/remote-control). Codex는 `--listen ws://`와 `--remote`, 비루프백은 인증과 TLS 권고. opencode는 `--hostname/--port` + basic 비밀번호 (https://opencode.ai/docs/server/) |
| 알림 | 프로세스가 살아 있을 때만 | 이벤트 시점에 깨어 있는 주체 필요 | 데스크톱 앱이 열려 있으면 앱이 주체가 될 수 있다 [추측] |

요약하면 "지속성(durability)"과 "존속성(liveness)"은 다른 축이다. 전자는 저장소 설계로, 후자는 프로세스 설계로 얻는다. pi durable은 전자만 다룬다.

## 2. Q2: 각 구현의 프로세스 분할

### 2.1 한눈 비교

| 대상 | 구조 | 자동 기동 | 유휴 종료 | 같은 세션 동시 쓰기 | 확인 수준 |
|---|---|---|---|---|---|
| Claude Code CLI | 세션 = 터미널에 묶인 단일 프로세스 | 해당 없음 | 터미널 종료 시 종료 | 잠금 없음. 같은 세션을 두 터미널에서 재개하면 한 기록에 섞임 (`CC/sessions.md:212`) | 문서 [원문], 본체 비공개 |
| Claude Code 백그라운드 | 감독자(supervisor) + 세션당 프로세스 | 처음 백그라운드로 보내거나 agent view를 열 때 | 끝났고 미접속 약 1시간이면 프로세스를 내리고 저장된 대화로 복원. 고정(pin)하면 유지 | 감독자가 소유 | `CC/agent-view.md:809-850` [원문] |
| Claude Code Remote Control | 로컬 세션이 아웃바운드로 등록·폴링. 서버 모드는 한 프로세스에서 기본 최대 32 세션 | 사용자가 명시 실행 | 서버 중단 후 약 4시간 안에 `--continue`로 복귀 | 서버 모드는 same-dir 또는 worktree 분리 선택 | https://code.claude.com/docs/en/remote-control [원문] |
| Claude Code 데스크톱 | 설정은 CLI와 공유. SSH 세션은 원격에 "백그라운드 도우미"를 설치해 그 아래서 실행, 클라우드 세션은 앱을 닫아도 지속 | 앱 | 로컬 세션은 앱 수명에 묶임 [추측] | 앱이 만든 세션만 앱이 나열 | https://code.claude.com/docs/en/desktop [원문, 앞 10만 자만 읽음] |
| Codex | `app-server`: 클라이언트가 자식으로 띄워 stdio JSONL(기본), 선택적 WebSocket/Unix 소켓. 연결마다 `initialize`. 스레드는 구독자 0 + 30분 무활동이면 메모리에서 내림 | 클라이언트가 spawn (예: VS Code 확장) | 스레드 단위 30분 | 연결별 구독 | https://learn.chatgpt.com/docs/app-server [원문]. 데스크톱이 child process로 띄운다는 서술은 [2차] https://www.kitze.io/posts/codex-electron-app-technical-breakdown (검색 요약만 확인), https://openai.com/index/unlocking-the-codex-harness/ (403으로 열람 실패) |
| Codex cloud | 작업마다 격리된 원격 작업 공간 | 사용자가 시작 | 해당 없음 | 해당 없음 | https://learn.chatgpt.com/docs/cloud [원문] |
| opencode v2 | 공유 백그라운드 서비스 `opencode serve --service` 하나 + TUI·데스크톱·웹·SDK가 HTTP·SSE로 접속 | 클라이언트가 등록 파일을 읽고 없거나 버전이 다르면 spawn | 코드에서 유휴 종료를 찾지 못함 | 세션 실행은 프로세스 로컬, 클러스터용 펜싱 없음 (`OC/specs/v2/session.md:118`) | 소스 [원문] |
| pi | 단독(durable TUI) 또는 coordinator + server + 세션별 worker 3겹 (실험) | 클라이언트가 server, server가 worker를 spawn | 연결 0 + 작업 0이면 퇴장 | 세션 잠금(proper-lockfile) | 소스 [원문], 모두 Experimental |
| oh-my-pi | 기본 단일 프로세스. RPC(JSONL stdio), ACP, collab(릴레이 경유 세션 공유) | 해당 없음 | 해당 없음 | 세션 id 키 OS 임대, 충돌 시 형제 파일로 이동 (`OMP/docs/session.md:538-541`) | 문서 [원문], 코드는 일부만 |
| Goose | 이전: CLI는 에이전트를 in-process, 데스크톱은 `goosed`(REST+SSE). 2.0 베타: ACP 서버 하나로 통일하고 `goosed`와 구 CLI를 제거할 계획 | 미확인 | 미확인 | 미확인 | 블로그 [원문] https://goose-docs.ai/blog/2026/04/08/goose-acp-and-new-tui/ |
| Gemini CLI | `packages/core`와 `packages/cli`는 한 프로세스 안의 패키지 분리라는 2차 서술. 별도 실험적 A2A 서버와 ACP 어댑터. 세션은 `~/.gemini/tmp/<project_hash>/chats/`에 자동 저장되고 `--resume`으로 재개 | 해당 없음 | 해당 없음 | 미확인 | 세션 문서 [원문] https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md. 구조는 [2차] (구조 문서 404) |
| Hermes | CLI는 단일 프로세스. 게이트웨이가 상주 프로세스 하나로 채널 어댑터·크론 틱·하우스키핑 호스트. TUI·데스크톱은 stdio JSON-RPC(`tui_gateway`) | `hermes gateway install`로 launchd/systemd 등록(명시 동의). 등록 없이 `start`도 가능 | 상주 | 프로필별 PID 파일 + `gateway.lock`, 같은 토큰을 두 프로필이 쓰면 잠금 충돌 (`HM/website/docs/developer-guide/gateway-internals.md:609-613, 682-684`, `HM/gateway/status.py:42-46`) | 소스 [원문] |

### 2.2 대상별 메모

**Claude Code.** 일반 사용은 단일 프로세스이고 오래 도는 작업만 감독자 아래로 보낸다. 감독자는 처음 필요할 때 자동 기동하고 사용자가 관리하지 않는다. 상태는 `~/.claude/daemon/roster.json`, `jobs/<id>/state.json`, `daemon.log`이며 `claude daemon status`가 도달성·PID·버전·소켓 디렉터리를 보여 준다 (`CC/agent-view.md:831-850`). 감독자가 죽으면 세션 프로세스가 약 1분 기다렸다가 멈추고, 저장된 대화에서 다시 일으킬 수 있다 (`:825`). 자동 업데이트 시 감독자가 새 버전으로 재시작하며 한가한 세션부터 옮긴다 (`:823`). 상태 파일은 모르는 필드를 보존해 버전이 섞여도 견딘다 (`:848`). "자동 기동 + 유휴 시 프로세스 내림 + 저장된 대화로 복원" 조합이 사용자 부담이 가장 적은 사례다. [원문]

**Codex.** 핵심은 "클라이언트가 서버를 자식으로 띄워 stdio로 JSON-RPC를 주고받는다"이다. 연결 단위 `initialize` → `thread/start|resume` → `turn/start` → 알림 스트림이고, 스레드는 구독자가 없어지고 30분이 지나야 메모리에서 내려가며 영속 이력은 남는다. WebSocket은 "experimental and unsupported"이며 비루프백 리스너는 기본이 무인증이라 토큰 인증과 TLS를 권고한다. 인증은 `initialize` 이전에 강제한다. [원문] TUI가 같은 프로세스 안에서 서버 코어를 직접 쓰는 in-process 전송은 2차 출처뿐이다 [2차] https://codex.danielvaughan.com/2026/04/15/codex-app-server-complete-guide/ (검색 요약만 확인).

**opencode.** 가장 직접 참고할 구현이다. 연결 방식 세 가지가 한 클라이언트 코드에 있다.

1. 공유 서비스(기본): `ServerConnection.resolve`가 등록 파일(XDG state, `{id, version, url, pid, password}`)을 읽고, 없거나 버전이 다르면 `opencode serve --service`를 띄운다 (`OC/packages/cli/src/services/server-connection.ts:27-47`, `OC/packages/client/src/service.ts:9-57`, `OC/packages/client/src/effect/service.ts:34-112`). 이중 기동은 "contender" 방식으로 막는다. 데스크톱 주석: "A fixed port makes a second contender fail to bind and back off; port 0 never collides, so two services could boot against the same database" (`OC/packages/desktop/src/main/service/background-service.ts:49-52`). [원문]
2. 독립(`--standalone` 또는 서비스 설정 `disabled`): TUI가 `serve --stdio --port 0`을 자식으로 띄운다. 핵심은 stdin 파이프다. "The server treats EOF on this pipe as the end of its ownership lease. The OS closes it even when the TUI is killed before Effect finalizers run" (`OC/packages/cli/src/services/standalone.ts:23-27`). 부모가 어떻게 죽든 자식이 따라 죽는 수명 임대다. [원문]
3. 원격 지정: `--server URL`, 비밀번호는 환경 변수 (`server-connection.ts:27-41`). [원문]

서비스 모드는 시작 시 작업 디렉터리를 홈으로 옮기고(`OC/packages/cli/src/server-process.ts:60-64`), 비밀번호는 설정값 또는 무작위 32바이트다 (`:90-95`). 실행 소유는 "프로세스 로컬"이고, 이전 프로세스가 남긴 불명 도구 호출은 `aborted`로 정리하며 재실행하지 않는다 (`OC/specs/v2/session.md:64-72`). 크래시 복구는 세션 행의 `time_suspended`(write-ahead claim)와 `resume_attempts`로 한다 (`OC/packages/core/src/session/store.ts:198-255`). [원문]

**pi / oh-my-pi.** pi는 1.2절. omp는 서버 없이 단일 프로세스를 기본으로 하고 RPC·ACP·collab으로 외부와 붙는다. 세션 쓰기 충돌은 5절. [원문]

**Goose.** 공식 블로그의 진단이 이번 조사에서 가장 중요한 한 줄이다. "The Rust CLI talked to the agent directly in process, while the desktop app went through goosed … Every new feature — session management, extension loading, streaming — had to be wired up in both places." 해법은 "a single protocol that any client could speak to reach the same agent core"(ACP)다. [원문] 우리가 "데스크톱 + CLI 같은 런타임"을 원하면 이 함정을 처음부터 피해야 한다. 이전 `goosed`의 세부(데스크톱이 띄우는 방식, 인증)는 소스를 못 열어 확인하지 못했다. 서드파티 문서는 "내장 인증 없음, 리버스 프록시 권고, 세션은 인스턴스별 디스크 저장"이라고 하나 신뢰도가 낮다 [2차] https://mintlify.wiki/block/goose/advanced/server-deployment.

**Hermes.** 상주 게이트웨이는 "메신저에서 에이전트를 부리는" 제품 요구에서 나온 구조다. 한 호스트에 게이트웨이 하나(프로필 멀티플렉싱 시)이고, 활성 여부는 PID + 시작 시각 지문으로 판단한다 (`gateway-internals.md:684`). 서비스 감독자(systemd/launchd/s6)가 재시작하되 설정 충돌은 종료코드 78로 재시작 루프를 멈춘다 (`:613`). 서비스 등록은 명시 동의 때만이고 비대화형 `start`는 건드리지 않는다 (`HM/website/docs/user-guide/windows-native.md:243`). [원문] 메신저 연동이 요구되지 않는 한 이 수준의 상주는 과하다 [의견].

## 3. "데스크톱 + CLI를 같은 런타임으로" 할 때의 패턴

| 패턴 | 사용 사례 | 장점 | 단점 |
|---|---|---|---|
| P1. 앱이 엔진을 자식 프로세스로 띄우고 stdio JSON-RPC | Codex(VS Code·데스크톱), Hermes TUI/데스크톱, Claude Agent SDK(CLI를 자식으로 spawn) | 포트·인증 불필요. 부모 종료 = 자식 종료. 가장 단순하고 안전 | 클라이언트마다 엔진이 따로 뜬다. 앱을 닫으면 작업이 끝난다. 다른 클라이언트와 공유 불가 |
| P2. 자동 기동되는 공유 로컬 서비스 + 등록 파일 | opencode v2, Claude Code 감독자, pi 실험 서버 | 앱·CLI·웹·원격이 같은 세션을 본다. 앱을 닫아도 작업 지속 | 수명·버전 불일치·이중 기동·인증을 직접 풀어야 한다 |
| P3. in-process 직접 호출 | 대부분 CLI 기본 동작, omp 기본, pi 코딩 에이전트, 이전 Goose CLI | 가장 빠르고 의존 없음 | 데스크톱과 경로가 갈리면 기능을 두 번 만든다 (Goose 교훈) |
| P4. 상시 OS 서비스(launchd/systemd) | Hermes 게이트웨이 | 재부팅 후에도, 예약·메신저 수신 가능 | 설치·권한·업데이트·보안 부담이 가장 큼 |
| P5. 원격 실행 | Codex cloud, Claude 클라우드 세션, Remote Control(로컬 세션을 원격에서 조종) | 기기를 꺼도 지속 / 로컬 환경 그대로 | 인프라와 계정 의존 |

관찰: 성숙한 제품은 한 가지만 쓰지 않는다. opencode는 P2 기본 + P1 변형(standalone) + 원격 지정을 한 클라이언트 코드에서 지원한다. Codex는 P1 기본 + WebSocket 원격. Claude Code는 P3 기본 + P2(감독자) + P5. 공통점은 클라이언트가 쓰는 계약(프로토콜)이 전송과 무관하게 하나라는 점이다. [원문 종합, 일부 2차]

"서버 자동 기동 + 유휴 종료"는 pi(연결 0 + 작업 0 → 1초 뒤 퇴장)와 Claude Code(미접속 1시간 → 프로세스 내림)가 구현했고 opencode는 유휴 종료를 찾지 못했다. 자동 기동은 흔하지만 유휴 종료는 구현이 갈린다. [원문]

## 4. 장단점 요약

- 데몬 없음(P3/P1): 장애 지점이 적고 보안 표면이 작다. 대신 앱을 닫으면 작업이 멈추고, 다중 클라이언트·원격·예약이 불가하거나 어색하다.
- 자동 기동 공유 서비스(P2): 사용자에게는 "그냥 된다". 대신 버전 불일치(opencode는 재기동, Claude Code는 경고 + `daemon stop --any`), 이중 기동(포트 선점, 소켓 잠금), 서비스 인증(무작위 비밀번호 + 파일 권한), 좀비 정리(stdin EOF 임대, PID + 시작시각 지문)를 모두 설계해야 한다.
- 상시 OS 서비스(P4): 가장 강력하지만 설치·업데이트·권한 문제가 가장 크다. 명시 동의가 필요하다 (Hermes도 그렇게 한다).

## 5. 단일 소유와 잠금: 같은 세션을 앱과 CLI가 함께 열 때

| 사례 | 방식 | 충돌 시 | 장단점 |
|---|---|---|---|
| Claude Code | 잠금 없음 | 한 기록에 섞임. 피하려면 `--fork-session` (`CC/sessions.md:212`) | 단순하나 기록이 섞인다. 사용자 책임 [원문] |
| pi durable 단독 | 세션 디렉터리 `proper-lockfile` | 두 번째 프로세스는 대기 후 실패. 크래시 잠금은 10초 stale 대기 (`PX/durable/sessions.ts:47`) | 안전하나 크래시 뒤 10초 대기 [원문] |
| pi 서버 | 세션별 워커 하나가 잠금(stale 2초, 갱신 1초)을 쥐고 모든 클라이언트는 워커에 attach | 클라이언트는 쓰지 않고 중계만 | 소유 프로세스 하나로 모으는 구조 [원문] |
| oh-my-pi | 세션 id 키 OS 임대(Linux 추상 소켓, Windows named mutex, macOS flock 사이드카). 쓰기 경로에서만 취득, 조회는 취득 안 함 | 다른 프로세스가 쥐고 있으면 새 형제 파일로 옮겨 쓰고 `parentSession`으로 연결, 알림 발생 (`OMP/docs/session.md:538-541`) | 커널이 프로세스 종료 시 즉시 해제(stale 대기 없음). 경로가 아니라 id 기준이라 복사·링크에도 견딤. 자동 분기라 데이터 손실이 없다 [원문] |
| opencode | 서비스 하나가 실행을 소유. 클라이언트는 전부 서비스 경유 | 서비스 내부에서는 세션 inbox를 키별 뮤텍스로 직렬화 (`OC/packages/core/src/session/inbox.ts:59`). 서비스끼리의 소유는 펜싱 없음 | 잠금이 필요 없는 대신 서비스가 단일 장애점 [원문] |
| Hermes | 프로필별 PID 파일 + 파일 잠금 + 토큰 스코프 잠금 | 시작 시 충돌은 종료코드 78(재시도 금지), 실행 중 충돌은 재시도 | 서비스 감독자와 결합된 정교한 정책 [원문] |
| Codex | 서버 하나에 연결 여럿. 구독은 연결별 | 서버가 실행 소유 | opencode와 같은 "서버가 소유" 모델 [원문] |

정리하면 해법은 둘이다. (A) 실행을 가진 프로세스를 하나로 모으고 나머지는 클라이언트가 된다 (opencode, Codex, pi 서버, Claude 감독자). (B) 서버가 없으면 세션 단위 OS 잠금으로 쓰기 소유자를 하나로 하고, 못 잡으면 읽기 전용이나 분기로 내려간다 (omp). 둘을 하나의 규칙으로 묶을 수 있다 (6.3절).

## 6. 권고안

전제: TypeScript, Cordis 확장 호스트, SQLite 단일 DB, macOS·Linux 우선, CLI + 데스크톱. 확장이 같은 프로세스에서 돌고 격리가 없으므로(ref-synthesis의 신뢰 등급 논의) 프로세스 수가 적을수록 신뢰 경계가 단순하다 [의견].

### 6.1 구조 1안: 엔진 라이브러리 + 단일 호스트 계약 + 교체 가능한 전송

```
CLI       ── in-process 전송 (메모리 채널) ─────────┐
데스크톱  ── 자식 프로세스 전송 (stdio JSONL) ──────┤  호스트 계약 (JSON-RPC 계열, 스키마 단일 원천)
CLI·앱    ── 서비스 전송 (Unix 소켓 → 선택적 TLS WS) ┘        └ 엔진 = Cordis 호스트 + 루프 + SQLite
                                         (서비스 전송은 뒤 단계에서만)
```

- 엔진은 `Runtime.open(dbPath)`처럼 프로세스 정책을 모르는 라이브러리다. pi durable이 "열 때 재개, 닫을 때 결과 안 씀"을 지키는 것과 같다. 데몬 여부는 엔진이 아니라 호스트가 정한다.
- UI(CLI TUI, 데스크톱)는 엔진 객체를 직접 만지지 않고 항상 호스트 계약만 쓴다. CLI의 기본 전송만 in-process로 한다. 그러면 Goose가 겪은 "두 경로 이중 구현"을 피하고, Codex가 TUI를 서버 클라이언트로 옮기는 방향과도 맞는다 [2차 포함]. 계약 스키마는 단일 원천에서 TS 타입과 JSON Schema를 생성하고 CI가 diff한다 (Hermes `scripts/gen_gateway_contracts.py`, ref-synthesis F 계약 채택안과 동일).
- 데스크톱 앱은 엔진을 UI 프로세스 안에 넣지 않고 자식 프로세스로 띄운다. 이유: 확장이 블로킹·크래시를 일으켜도 UI가 살아 있어야 하고, 같은 엔진 바이너리를 CLI도 쓰기 때문이다 [의견].
- 스트리밍 토큰은 휘발 이벤트, 완성된 파트만 DB 이벤트로 저장한다 (ref-synthesis 세션 저장 권장안과 동일). 그러면 다른 프로세스가 데몬 없이 DB 폴링만으로 완성된 기록을 따라올 수 있다.

### 6.2 데몬 단계적 도입 경로

| 단계 | 상태 | 추가되는 것 | 얻는 기능 | 아직 안 되는 것 |
|---|---|---|---|---|
| 0 | 데몬 없음. CLI = in-process, 앱 = 자식 엔진 | 호스트 계약, 세션 소유 잠금, 열 때 복구 (6.3) | 크래시 재개, 분기, 승인 대기 복구, 이력 검색 | 앱을 닫고 계속 실행, 예약, 다중 클라이언트 쓰기 |
| 1 | 단계 0 + 자식 엔진에 수명 임대 | stdin EOF 임대(opencode standalone 방식), 앱 종료 시 진행 중 턴을 안전 경계에서 멈추고 체크포인트 | 앱이 비정상 종료돼도 자식이 남지 않음. 다음 실행 때 "이어서 실행?" 제안 | 앱 종료 후 계속 실행 |
| 2 | 선택 모드: `helm service start`로 공유 서비스 | 등록 파일(url·pid·version·시작시각 지문·무작위 비밀번호, 0600), `ensure`(없거나 버전이 다르면 기동), 이중 기동 방지, 연결 0 + live task 0이면 유예 후 종료(pi `ServerLifetime` 방식), 앱·CLI가 서비스를 발견하면 접속 | 앱 닫아도 작업 지속, 앱·CLI 동시 접속, 입력 위임 | 재부팅 후 자동 시작, 예약, 원격 |
| 3 | 선택 모드: OS 서비스 등록 + 원격 | `helm service install`(launchd 사용자 에이전트 / systemd 사용자 유닛, 명시 동의), 예약 작업 테이블과 틱, 알림, 원격 전송(Unix 소켓 → TLS + 토큰 WebSocket, 비루프백 무인증 금지) | 예약 실행, 원격·폰, 알림 | 클라우드 실행(범위 밖) |

- 단계 0~1에서 "앱을 닫고 계속 실행"이 꼭 필요하면 pi식 세션별 분리 워커를 단계 1.5로 둘 수 있다. 워커는 세션 잠금을 쥔 채 live task가 끝나면 스스로 종료하는 `detached` 자식이다. 다만 pi가 이를 coordinator·server·worker 세 겹으로 푼 만큼 코드가 복잡하므로, 서비스 모드(단계 2)를 바로 만드는 편이 더 단순할 가능성이 있다 [의견, 미검증].
- 불변식: 호스트 계약과 DB 스키마는 단계가 바뀌어도 변하지 않는다. 단계 전환은 "누가 엔진 프로세스를 소유하는가"만 바꾼다.

### 6.3 단일 소유·잠금 규칙 (단계 0부터 적용)

1. 쓰기 소유자는 세션 단위로 하나다. 세션 실행(루프 구동)을 시작하려는 프로세스는 세션 id 키 OS 잠금을 얻어야 한다. omp 방식을 따른다. 경로가 아니라 id 기준이고, 프로세스가 죽으면 커널이 해제하므로 stale 대기가 없다 (`OMP/docs/session.md:538`). Node 표준 라이브러리에는 flock이 없으므로 네이티브 바인딩 또는 `proper-lockfile`(mtime 갱신 방식, 크래시 뒤 수 초 대기) 중 선택이 필요하다 [미결].
2. 읽기는 자유다. SQLite WAL은 읽기 여럿 + 쓰기 하나를 허용하므로 잠금은 "세션 실행 소유"를 막는 것이지 DB 읽기를 막는 것이 아니다. 조회·검색·관찰 UI는 잠금 없이 연다 (omp도 조회는 임대를 취득하지 않는다).
3. 잠금을 못 얻으면 선택지 셋을 제시한다.
   - 위임: 서비스가 있으면 소유자에게 입력을 보내는 클라이언트가 된다 (단계 2 이후 기본).
   - 관찰: 읽기 전용으로 열고 DB를 따라간다.
   - 분기: 현재 시점에서 `parentId`로 새 분기를 만들어 별도 세션으로 연다. omp의 형제 파일, Claude Code `--fork-session`과 같은 의미이며 우리는 DB 행이라 복사 비용이 작다.
   Claude Code처럼 대응 없이 섞이게 두는 것은 피한다.
4. 소유 기록 테이블 `session_owner(session_id, owner_id, kind[cli|app|service], pid, started_at, heartbeat_at)`는 "누가 쥐고 있는지 표시"용 보조 정보로만 쓰고, 소유 판정은 OS 잠금이 한다. 표시 정보가 틀려도 안전해야 한다 (Hermes도 PID 존재가 아니라 시작 시각 지문으로 판정).
5. 복구 표식: opencode처럼 루프가 시작될 때 write-ahead claim(`running_since`, `resume_attempts`)을 커밋하고 정상 종료·사용자 중단 때만 해제한다. 비정상 종료는 표식이 남는다 (`OC/specs/v2/session.md:64-66`). 열 때 표식이 남은 세션을 "이어서 실행" 후보로 보여 준다. 자동 재개는 비용·부작용 때문에 기본 꺼짐이고, 서비스 모드에서만 설정으로 켠다 [의견]. 재개 횟수 상한을 둔다.
6. 결과 불명 도구 호출은 재개 때 자동 재실행하지 않고 "중단됨"으로 합성한다 (opencode, Claude Code 공통). `replay: safe`로 선언된 도구만 재실행한다 (ref-synthesis (f) 채택안).

### 6.4 서비스 모드 설계 체크리스트 (단계 2~3)

- 등록 파일은 권한 0600, 모르는 필드를 보존한다 (Claude Code `roster.json` 규칙, `CC/agent-view.md:848`).
- 기동 경합은 고정 소켓 경로 또는 포트를 먼저 바인드한 쪽이 이긴다 (opencode contender, pi `acquireServerActivation`, `PX/server.ts:154, 200`).
- 버전 불일치는 서비스가 한가하면 자동 재기동, 아니면 경고한다 (opencode `mismatch: replace`, Claude Code 경고 + 한가한 세션부터 이전).
- 유휴 종료는 연결 0 + live task 0 + 대기 예약 0일 때만, 시작 직후 유예를 포함한다 (pi 10초/1초). 승인 대기 세션은 live로 볼지 정책이 필요하다. Claude Code는 권한 프롬프트에서 멈춘 세션도 계속 실행으로 본다 (`CC/agent-view.md:819`). 같은 쪽을 권한다 [의견].
- 인증: 로컬은 Unix 소켓 + 파일 권한. TCP/WebSocket은 무작위 토큰 필수이고 `initialize` 전에 인증한다 (Codex).
- 부모-자식 수명: 자식 엔진은 stdin EOF 임대로 정리하고 (opencode), 서비스는 `detached` + `unref`로 부모에서 분리한다 (pi `PX/process.ts:40-70`).
- 종료 협조: 자식에게 SIGTERM → 안전 경계에서 체크포인트 → 종료, 시한 뒤 SIGKILL (opencode 3초). 비협조 확장 코드가 close를 막을 수 있음을 pi durable도 명시한다 (`spec.md:5096`).
- 단일 장애점: 서비스가 죽어도 DB와 복구 표식이 남으므로 다음 `ensure`가 재개 후보를 제시한다. Claude Code가 감독자 소실 시 세션 프로세스를 1분 뒤 멈추듯, 서비스 소실을 감지한 자식 엔진이 안전하게 멈추는 규칙을 둔다.

### 6.5 사용자 결정이 필요한 항목

1. 예약·원격·알림(단계 3)을 제품 범위에 넣을지. 넣지 않으면 단계 2에서 멈춰도 된다.
2. 단계 1.5(세션별 분리 워커)를 건너뛰고 단계 2로 바로 갈지.
3. 데스크톱 셸 기술(Electron/Tauri 등). 이번 조사에서 확정되지 않았고 자식 프로세스 방식은 어느 쪽이든 같다 [추측].
4. 세션 잠금 구현(네이티브 flock vs `proper-lockfile`). 크래시 직후 대기 시간이 다르다.
5. 자동 재개 기본값(권고는 꺼짐).

## 7. 한계와 못 본 것

- Codex: 데스크톱이 app-server를 띄우는 방식, TUI in-process 전송, 클라이언트가 모두 끊겼을 때 진행 중 턴의 운명은 공식 문서에서 확인하지 못했다. 2차 또는 미확인이다. 소스(openai/codex)는 열지 않았다.
- Goose: 이전 `goosed`의 세부와 2.0 ACP 서버의 전송 방식은 소스·문서를 못 열어 미확인이다.
- Gemini CLI: 세션 저장 문서만 직접 확인했고 패키지 구조는 2차 서술이다.
- Claude Code 데스크톱·Remote Control 문서는 각각 앞부분 위주로 읽었다. 본체 소스는 비공개이며 번들 분석은 하지 않았다.
- opencode의 "유휴 종료 없음"은 `idle`·`autostop` 검색 결과 부재에 근거한다. 다른 이름으로 있을 수 있다 [추측]. pi의 "서버 시작 시 미완료 세션 자동 재개 없음"도 부재 확인이며 실행해 보지 않았다.
- absurd·Temporal 같은 외부 내구 엔진은 개인 앱 배포에 맞지 않아 비교에서 제외했다.
- 6절 권고는 사례 종합이며 우리 코드 위에서 시험한 것이 아니다. 단계 0의 세션 잠금 구현과 앱 자식 프로세스 수명 처리는 소규모 프로토타입으로 검증할 가치가 있다 [의견].
