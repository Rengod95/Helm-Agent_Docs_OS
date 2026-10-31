---
id: L4.cli.spec
layer: L4
domain: cli
kind: spec
status: draft
depends_on: [F.wire-settings.spec, F.conversation.spec, F.records.spec, adr.0006, L4.host-service.spec, eng.testing.guide, eng.toolchain.guide, L0.secrets.spec, L1.tools.spec, L1.models.spec, L0.process.spec, L2.web.spec, L2.schedule.spec]
binds: [xeon/apps/cli/**]
---

# L4 CLI (`xeon`)

이 문서는 L4 배포 런타임 중 CLI 앱(`xeon/apps/cli`)의 스펙이다. 사용자가 터미널에서 Xeon과 대화하고, 세션·설정·비밀·서비스를 다루는 명령 체계를 정한다.

## 1. 목적과 범위

### 1.1 정하는 것

- `xeon` 명령 체계: 하위 명령, 플래그, 각 명령이 쓰는 wire 메서드, 마일스톤.
- 실행 모드: 대화형(interactive), 비대화(print), JSON Lines(`--json`), 내부 진입(`host --stdio`).
- 엔진 연결: CLI는 `HostConnection`(`F.wire-settings.spec` §3.1)만 쓴다. in-process와 서비스 접속의 선택 규칙.
- 화면: TUI 라이브러리 선택, 내구·휘발 이벤트의 렌더링 규칙, 승인·잠금 프롬프트, 슬래시 명령.
- 종료 코드와 신호 처리.
- CLI가 소유하는 설정 키 `l4.cli.*`.
- 비밀 명령의 입력·출력 규칙.

### 1.2 다루지 않는 것

- 엔진 조립(Cordis 호스트, 플러그인 등록, 저장소 열기), 전송 구현, 서비스 수명(등록 파일, `ensure`, 유휴 종료): `L4.host-service.spec`.
- 설정 화면(데스크톱 12탭): `L4.settings-ui.spec`. CLI의 TUI 설정 화면은 지금 만들지 않되, 나중에 만들 수 있게 view-model을 `packages/client`에 둔다 [결정: review.m3-design-inputs D-M3-30 행 3, adr.0020](§4.9, §10).
- 데스크톱 셸: `L4.desktop.spec`.
- 비밀 값의 저장·해석·마스킹: `L0.secrets.spec`. CLI는 명령 입구와 출력 규칙만 정한다.
- 승인 요청 payload의 모양: `L1.tools.spec`. CLI는 표시와 응답 규칙만 정한다.
- 개발용 justfile 종료코드 규칙(`eng.toolchain.guide` 3.2절). 이 문서의 종료 코드는 제품 CLI의 것이며 개발 레시피 규칙과 별개다(§3.6).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 엔진 바이너리 | `bun build --compile`로 만든 단일 실행 파일. [제안] 이름은 `xeon`이고 CLI 명령과 엔진 진입(`host --stdio`, 서비스)을 한 파일에 담는다. 확정은 `L4.host-service.spec`이 한다 |
| 조립 진입점 | `@xeon/host`의 공개 진입점 `.`과 `./client`(`L4.host-service.spec` §3.3). CLI는 이 API를 조합해 엔진 연결을 만든다(§3.3). `apps/cli` → `@xeon/host` import는 허용 목록 `DR-10/cli-host`로 연다 [결정: review.decisions-2 U-15] |
| 대화형 모드 | stdin과 stdout이 모두 TTY일 때 입력 편집기와 트랜스크립트를 보이는 모드 |
| print 모드 | 입력 하나로 turn 하나를 돌리고 끝내는 비대화 모드. `-p`이거나 TTY가 아니면 이 모드다 |
| JSON 모드 | print 모드에서 사람용 출력 대신 JSON-RPC 메시지를 한 줄에 하나씩 쓰는 모드(`--json`) |
| 트랜스크립트 | `events.batch`(내구 이벤트)로 그린 대화 기록 |
| 진행 줄 | `stream.chunk`(휘발 이벤트)로 그린 임시 줄. 같은 item의 내구 기록이 오면 지운다 |
| CLI 상태 파일 | CLI가 마지막 thread와 위치(`StreamPosition`)를 적어 두는 파일(§3.7) |
| 세션 | 사용자에게 보이는 이름. wire의 thread 하나다(`F.wire-settings.spec` §2 [가정] 1:1) |

## 3. 인터페이스

### 3.0 import

```ts
import type { Result } from "@xeon/contracts";
import type { ThreadId, ItemId } from "@xeon/contracts/conversation";
import type {
  HostConnection, TransportKind, JsonRpcMessage, StreamPosition,
  EventsBatchParams, StreamChunkParams, EventWire, WireErrorData,
} from "@xeon/contracts/wire";
import type { SettingKey, SettingScope, EffectiveSetting, SettingDefWire, SettingGroup, SettingDefInput } from "@xeon/contracts/settings";
```

- 이름은 F 문서가 정한 것을 쓴다. ADR-0006 §3.3의 `HostMessage`, `"service"` 전송 종류는 F의 `JsonRpcMessage`, `"socket"`(`TransportKind`)과 같은 것으로 읽는다.
- 아래 코드 블록의 상수에는 `isolatedDeclarations` 때문에 명시 타입 주석을 단다(`F.wire-settings.spec` §3.0).

### 3.1 명령 표

| 명령 | 동작 | 쓰는 wire 메서드 | 마일스톤 |
|---|---|---|---|
| `xeon`, `xeon chat` | 대화형 모드. TTY가 아니면 print 모드로 바뀐다(§4.2). 대화형의 슬래시 명령 중 엔진에 등록한 것은 `command.list`로 목록을, `command.run`으로 실행을 부른다(§4.12) | `host.hello`, `thread.create`, `events.subscribe`, `turn.start`, `settings.get`. 슬래시 명령: `command.list { threadId }`, `command.run`, `thread.compact` | M1 |
| `xeon chat -p <입력>`, `--print <입력>` | print 모드. 입력 하나로 turn 하나를 돌리고 응답 텍스트를 stdout에 쓴다. `-p -` 또는 `-p`만 쓰면 stdin 전체가 입력이다 | 위와 같음 | M1 |
| `xeon chat -p … --json` | JSON 모드. 연결에서 오간 JSON-RPC 메시지를 순서대로 한 줄에 하나씩 쓴다(§4.4) | 위와 같음 | M1 |
| `xeon chat -p … --auto-approve` | print 모드에서 도구 승인 요청을 `{ decision: "allow" }`로 한 번 허용한다(`remember`를 보내지 않는다). 질문·계획·검토 승인은 거부한다. 승인마다 stderr에 한 줄을 쓴다(§4.11 4번). 대화형과 함께 쓰면 사용법 오류 2(`autoApproveRequiresPrint`) | `approval.respond`(`decision: "allow"`) | M3(구현됨, M3b B1-SCH) |
| `xeon chat --continue` | 현재 작업 폴더의 마지막 세션을 이어 연다. M1은 CLI 상태 파일, M2부터 `thread.list`. 대화형이고 그 세션에 끊긴 turn이 있으면 묻고 `turn.resume`을 부른다(§4.4) | M1: 위와 같음. M2: `thread.list`, `thread.open` 추가 | M1 |
| `xeon chat --resume <id>` | 지정 세션을 이어 연다 | M1: `events.subscribe`, `turn.start`. M2: `thread.open` 추가 | M1 |
| `xeon chat --set <key>=<value>` | 이 세션에만 설정을 덮어쓴다(session 범위). 여러 번 쓸 수 있다 | `settings.set`(scope `session`, `threadId`) | M2 |
| `xeon chat --safe-mode`, `xeon --safe-mode` | 이번 시작에 외부 확장과 L3 내장 그룹을 싣지 않는다(`X.operations.spec` §4.6). `AssembleOptions.safeMode`로 넘긴다. 설정 `x.operations.safeMode.default`가 켜져 있어도 같고, 호스트가 `host.status.safeMode`로 알린다. 서비스 모드의 안전 모드는 서비스를 새로 띄울 때 `service start --safe-mode`로 정한다 | 없음(조립 옵션). `host.status`가 `safeMode: true`를 돌려준다 | M3(구현됨, M3b B1-SVC) |
| `xeon sessions ls [--all] [--limit n] [--json]` | 세션 목록. 기본은 현재 작업 폴더 | `thread.list` | M2 |
| `xeon sessions show <id> [--json]` | 세션의 내구 이벤트를 트랜스크립트로 출력한다 | `events.subscribe`(filter `threadIds`), `events.unsubscribe` | M2 |
| `xeon sessions fork <id> [--at <itemId>]` | 분기를 만들고 새 id를 출력한다 | `thread.fork` | M2 |
| `xeon sessions rm <id> [--yes]` | 세션 삭제. TTY에서는 확인을 받는다 | `thread.delete` | M2 |
| `xeon sessions rename <id> <제목>` | 세션 제목을 바꾼다. 제목은 낱말 여러 개를 따옴표 없이 써도 되고 1~200자다. 목록(`sessions ls`, `/resume`)은 제목이 없으면 `(제목 없음)`을 보인다 | `thread.rename` | M2 |
| `xeon config get [<key>…] [--json]` | 유효 값과 출처(`source`), 잠금, 가려진 범위, 적용 대기를 출력한다 | `settings.get` | M1 |
| `xeon config set <key> <value> [--scope user\|project\|local]` | 값을 쓴다. 기본 범위는 `user` [제안] | `settings.set` | M2 |
| `xeon config reset <key> [--scope …]` | 그 범위의 값을 지운다 | `settings.reset` | M2 |
| `xeon config list [--prefix p] [--deprecated] [--json]` | 정의 목록과 유효 값 | `settings.list`, `settings.get` | M2 |
| `xeon config schema --scope <managed\|user\|project\|local> [--out <path>] [--core-only]` | 설정 파일 JSON Schema 출력. `--out`이 없으면 stdout에 쓴다. 엔진 연결 없이 로컬 명령으로 돈다(`L4.host-service.spec` §6.2) | 없음. `runHostCommand({ kind: "config-schema" })` | M1 |
| `xeon secret ls [--meta] [--usage]` | 비밀 목록. 값은 없다 | `secret.list`(`F.wire-settings.spec` §4, M2) | M2 |
| `xeon secret add <name> [--provider sops] [--desc …] [--hosts …] [--expires …]` | 생성. 값은 stdin이나 프롬프트로만 받는다(§4.7) | `secret.beginEntry { name, action: "add" }`. 값 필드 없음 | M2 |
| `xeon secret set <name>` | 값 교체. 값은 stdin이나 프롬프트로만 받는다(§4.7) | `secret.beginEntry { name, action: "set" }`. 값 필드 없음 | M2 |
| `xeon secret meta <name> [--desc …] [--scope …] [--expires …] [--hosts …]` | 메타 수정. 값과 무관하다 | `secret.meta` | M2 |
| `xeon secret rotate <name>` | 새 값으로 교체하고 기존 lease를 폐기한다. TTY 프롬프트로만 받는다 | `secret.beginEntry { name, action: "rotate" }`. 값 필드 없음 | M2 |
| `xeon secret rm <name> [--yes]` | 삭제. 참조하는 정책과 참조(설정 키, 활성 lease, 최근 사용한 세션)를 보인 뒤 확인한다. 활성 lease가 있으면 묻지 않고 거부한다 | `secret.references`, `secret.list { meta: true }`, `secret.remove` | M2 |
| `xeon secret test <name>` | 존재와 복호화 가능 여부. 길이와 해시 앞 8자만 출력한다. 복호화할 수 없거나 없으면 1이다 | `secret.test` | M2 |
| `xeon secret reveal <name>` | 값 열람. 사람 전용이고 TTY에서만 동작한다. OS 인증 재확인이 가능한 플랫폼에서는 재확인한다(§4.7) [결정: review.decisions-2 U-20] | `secret.beginReveal { name }`. 값 필드 없음. F 메서드 추가는 M2 계획에서 정한다(review.decisions-2 U-04) | M2 |
| `xeon trust [status] [--json]` | 이 작업 폴더의 프로젝트 신뢰 상태(폴더, 불러오려는 자원, 판정과 출처, 선택지)를 보인다. 신뢰할 자원이 없으면 stderr에 한 줄이다 | `trust.get { workspace }` | M2 |
| `xeon trust allow\|deny [--scope folder\|parent\|session]` | 선택지 하나를 host에 보낸다. 범위 기본값은 `folder`. host가 낸 선택지에 없는 조합이면 2다 | `trust.get`, `trust.decide { workspace, choice }` | M2 |
| `xeon schedule add <프롬프트…> (--every <초> \| --at <시각> \| --remote \| --watch <경로>[,<경로>…] \| --loop <초> --max-iterations <n> --expires-in <초>) [--title <제목>] [--workspace <폴더>] [--disabled]` | 예약을 만든다. 트리거 플래그는 정확히 하나다(§4.14). 서비스 모드가 꺼져 있으면 저장만 되고 실행되지 않는다는 경고를 stderr에 쓴다 | `schedule.create { trigger, prompt, workspace?, title?, enabled? }` | M3(구현됨, M3b B1-SCH2) |
| `xeon schedule list [--all] [--json]` | 예약 목록. 기본은 켜진 항목이고 `--all`은 끈 항목까지 본다. 한 항목이 한 줄이고 `--json`은 항목 배열이다(§4.14) | `schedule.list { enabled? }` | M3(구현됨, M3b B1-SCH2) |
| `xeon schedule cancel <id>` | 예약을 끈다. 이미 꺼진 항목은 그대로 둔다 | `schedule.cancel { scheduleId }` | M3(구현됨, M3b B1-SCH2) |
| `xeon schedule run <id>` | 원격 트리거 예약을 지금 한 번 실행한다. 원격이 아니거나 꺼진 예약은 거부된다(§4.14) | `schedule.fire { scheduleId }` | M3(구현됨, M3b B1-SCH2) |
| `xeon service start\|status\|stop [--json] [--safe-mode] [--listen-tcp <호스트>:<포트>]` | 서비스 기동(이미 떠 있으면 붙는다), 상태, 종료. `install`/`uninstall`은 2차. `--safe-mode`와 `--listen-tcp`는 서비스를 새로 띄울 때만 적용된다(이미 떠 있는 서비스의 모드는 바뀌지 않는다). `--listen-tcp`는 TCP로도 열고 접속에는 등록 파일의 토큰이 필요하다. 루프백이 아닌 주소는 `--allow-non-loopback`을 함께 써야 하고 없으면 사용법 오류(2)다 | 없음. `runHostCommand({ kind: "service-start" \| "service-status" \| "service-stop" })`(§3.3). status는 그 안에서 `host.status`를 부른다. 종료코드: start 0·실패 1, status 떠 있음 0·없음 1, stop 0·실패 1 | M3(구현됨, M3b B1-SVC) |
| `xeon service ensure --json` | `ensure`만 하고 소켓 경로를 JSON 한 줄로 쓴다. 데스크톱 셸이 쓴다(`L4.host-service.spec` HS-38) | 없음. `runHostCommand({ kind: "service-ensure" })`. `--safe-mode`는 새로 띄울 때만 적용된다 | M3(구현됨) |
| `xeon service launch-mode --json` | 서비스 사용 설정을 엔진 없이 읽어 JSON 한 줄로 쓴다. 데스크톱 셸이 쓴다(`L4.desktop.spec` §4.2). 도움말에 보이지 않는다 | 없음. `runHostCommand({ kind: "service-launch-mode" })` | M3 |
| `xeon service run` | 서비스 본체를 전경에서 실행한다. `service start`와 `ensure`가 자기 바이너리를 detached로 띄울 때 붙이는 인자다(`L4.host-service.spec` §3.2, SV-06). 도움말에 보이지 않는다 | 없음. `runHostCommand({ kind: "service-run", safeMode, tcp? })`. `--safe-mode`·`--listen-tcp`를 받는다 | M3(구현됨) |
| `xeon host --stdio` | 내부 진입. stdin/stdout JSON Lines로 엔진 서버를 연다. 원격 주소(`--remote` 또는 설정)가 있으면 엔진을 열지 않고 `bridgeStdioToService`로 원격 서비스에 중계한다(HS-89). 데스크톱 사이드카가 쓴다. 도움말에 보이지 않는다 | 서버 쪽 전체. `startStdioHost({ readable, writable, assemble: { settingGroups } })`(`l4.cli.*` 그룹을 카탈로그에 넣으려고 `runHostCommand`를 거치지 않는다, §3.3 표). 원격이면 `resolveRemoteEndpoint`, `bridgeStdioToService` | M2(컴파일 바이너리 서브커맨드, 구현됨) |
| `xeon doctor` | FTS5, sops·age, 데이터 디렉터리 권한, 외부 바이너리 점검, 서비스 도달, 터미널 능력, 검색 provider 상태(§4.7.1) 진단 [제안] | `connectEngine` 결과와 wire 조회(`secret.list`, `host.status { includeBinaries: true }`, `settings.get`, `web.providers`)로 판정한다(§4.7.1, §10 5번 임시 결정) | M2 |
| `xeon db export <폴더> [--json]` | 저장소 파일(데이터 디렉터리의 `xeon.db`)을 엔진을 띄우지 않고 읽기 전용으로 `<폴더>`에 내보낸다. 엔진이 떠 있어도 된다. 상대 경로는 작업 폴더(`-C`) 기준이다(§4.13). 종료코드: 성공 0, 폴더 인자 누락과 비어 있지 않은 대상 2, 저장소·디스크 오류와 데이터 디렉터리 위치 실패 3(§4.10) | 없음. `deps.exportDatabase`(`L0.store.spec` §4.10)와 `deps.resolveDataDir`(`resolveOsDirs`)를 부른다 | M3(구현됨, M3b B3-DATA) |
| `xeon group new <이름> [--drive\|--policy] [--dir <폴더>] [--json]` | 그룹 골격을 만든다. 기본은 observe 템플릿, `--drive`는 drive, `--policy`는 policy 템플릿이다. 두 플래그를 함께 주면 사용법 오류(2)다. 대상 폴더는 비어 있어야 하고 기본은 작업 폴더의 `<이름>`이다. 엔진에 연결하지 않고 템플릿 파일만 읽는다(§3.8) | 없음. 파일 작업(`CliDeps.groupTemplates`) | M3b(구현됨, M3b B4-GRP) |
| `xeon version [--json]` | CLI 버전, 계약 버전(`WIRE_PROTOCOL_VERSION`), Bun 버전 | 없음 | M1 |

- 근거: 명령 모양은 omp `config list/get/set/reset`(`_research/settings.md` §1, §3 [S36]), pi 모드 4종(TUI, print, JSON, RPC: `_research/refs/pi.md` "같은 AgentSession을 네 모드가 쓴다", `~/projects/_ref/pi-src/packages/coding-agent/src/modes/`), 비밀 명령은 `_research/secrets.md` §6.6, 서비스 명령은 adr.0006 §3.4다.
- [결정] 서비스 모드는 1차이고 OS 서비스 등록은 2차다(adr.0006 §1). [제안] CLI의 `service` 명령은 M3에 둔다. M1·M2는 in-process와 stdio로 충분하고, 서비스 본체는 `L4.host-service.plan`의 일정을 따른다.
- [제안] M1 host 처리기는 `host.hello`, `thread.create`, `turn.start`, `events.subscribe`, `settings.get` 다섯이다(`F.wire-settings.spec` §3.3.1의 [제안]. M1 범위는 `_research/foundation-plan.md` §5 P4). 그래서 M1의 `config`는 `get`과 로컬 명령 `schema`만 있고, `sessions ls`는 `thread.list`가 생기는 M2다.
- M1의 stdio 진입은 개발 진입 `bun xeon/apps/host/src/main.ts host --stdio`(`L4.host-service.plan` H5)이고, 컴파일 바이너리의 `xeon host --stdio` 서브커맨드는 M2다. 데스크톱의 M1 적합성 테스트는 개발 진입을 쓴다(`L4.desktop.plan` D1).
- `service`, `host --stdio`, `config schema`는 엔진 연결 없이 `runHostCommand`를 부르고 그 반환값을 종료 코드로 쓴다(§3.6). `db export`도 엔진 연결 없이 끝난다(§4.13).
- `secret run -- <cmd>`(`_research/secrets.md` §6.6 마지막 행)는 이 문서에 두지 않는다 [미결 §10 3번].

공통 플래그:

| 플래그 | 뜻 |
|---|---|
| `-h`, `--help` | 도움말 |
| `--no-color` | 색 끄기. `NO_COLOR` 환경 변수가 있어도 같다 |
| `-C <dir>` | 작업 폴더 지정. 없으면 현재 폴더 [제안] |
| `--remote <주소>` | 원격 서비스 주소(HS-87). 문법은 `unix:/abs`, `tcp://host:port`, `ssh://[user@]host[:port]/abs/socket`이다. 있으면 설정 `l0.process.service.remote`보다 우선한다. 문법이 틀리면 로컬로 가지 않고 사용 오류(2, `invalidRemote`)다. 빈 값은 사용 오류다. tcp 토큰은 환경 변수 `XEON_REMOTE_TOKEN`에서 읽고 argv와 설정 파일에 두지 않는다. 엔진을 쓰는 명령과 `host --stdio`가 본다 [제안] |

### 3.2 인자 파서와 명령 모델

```ts
// src/cli/command.ts
export type OutputMode = "text" | "json";

export type ChatTarget =
  | { readonly kind: "new" }
  | { readonly kind: "continue" }
  | { readonly kind: "resume"; readonly threadId: ThreadId };

export interface SessionOverride {
  readonly key: SettingKey;
  readonly raw: string;                 // 해석 전 값. §4.8 규칙으로 해석한다
}

export interface ChatCommand {
  readonly kind: "chat";
  readonly mode: "interactive" | "print";
  readonly input: string | null;        // print 모드 입력. "-"이면 stdin을 읽은 뒤 채운다
  readonly output: OutputMode;
  readonly target: ChatTarget;
  readonly overrides: readonly SessionOverride[];
  readonly autoApprove: boolean;        // --auto-approve. print 모드에서만 참이다(§4.11 4번)
}

export type SessionsCommand =
  | { readonly kind: "sessions.ls"; readonly all: boolean; readonly limit: number; readonly output: OutputMode }
  | { readonly kind: "sessions.show"; readonly threadId: ThreadId; readonly output: OutputMode }
  | { readonly kind: "sessions.fork"; readonly threadId: ThreadId; readonly at: ItemId | null }
  | { readonly kind: "sessions.rm"; readonly threadId: ThreadId; readonly yes: boolean };

export type FileScope = Extract<SettingScope, "user" | "project" | "local">;
export type SchemaScope = Extract<SettingScope, "managed" | "user" | "project" | "local">;   // config schema만(L4.host-service.spec §6.2)
export type ConfigCommand =
  | { readonly kind: "config.get"; readonly keys: readonly SettingKey[]; readonly output: OutputMode }
  | { readonly kind: "config.set"; readonly key: SettingKey; readonly raw: string; readonly scope: FileScope }
  | { readonly kind: "config.reset"; readonly key: SettingKey; readonly scope: FileScope }
  | { readonly kind: "config.list"; readonly prefix: string | null; readonly includeDeprecated: boolean; readonly output: OutputMode }
  | { readonly kind: "config.schema"; readonly scope: SchemaScope; readonly out: string | null; readonly coreOnly: boolean };

import type { SecretName } from "@xeon/contracts/capabilities";   // F 브랜드 타입. ^[a-z][a-z0-9-]{1,63}$ (F.capabilities.spec §3)
export interface SecretMetaFlags {
  readonly provider?: "sops" | "op" | "bws" | "keychain";
  readonly desc?: string;
  readonly scope?: string;
  readonly hosts?: readonly string[];
  readonly expires?: string;            // ISO 8601 날짜
}
export type SecretCommand =
  | { readonly kind: "secret.ls"; readonly meta: boolean; readonly usage: boolean; readonly output: OutputMode }
  | { readonly kind: "secret.add"; readonly name: SecretName; readonly meta: SecretMetaFlags }
  | { readonly kind: "secret.set"; readonly name: SecretName }
  | { readonly kind: "secret.meta"; readonly name: SecretName; readonly meta: SecretMetaFlags }
  | { readonly kind: "secret.rotate"; readonly name: SecretName }
  | { readonly kind: "secret.rm"; readonly name: SecretName; readonly yes: boolean }
  | { readonly kind: "secret.test"; readonly name: SecretName }
  | { readonly kind: "secret.reveal"; readonly name: SecretName };

/** `schedule add`의 트리거. 파서는 시계를 읽지 않으므로 만료는 초로 받는다(runner가 `expiresAtMs`로 바꾼다) */
export type ScheduleTriggerArg =
  | { readonly kind: "every"; readonly everySeconds: number }
  | { readonly kind: "at"; readonly atMs: number }
  | { readonly kind: "remote" }
  | { readonly kind: "watch"; readonly paths: readonly string[]; readonly debounceMs: number }
  | { readonly kind: "loop"; readonly intervalSeconds: number; readonly maxIterations: number; readonly expiresInSeconds: number };

export type ScheduleCommand =
  | { readonly kind: "schedule.add"; readonly prompt: string; readonly trigger: ScheduleTriggerArg; readonly title: string | null; readonly workspace: string | null; readonly disabled: boolean }
  | { readonly kind: "schedule.list"; readonly all: boolean; readonly output: OutputMode }
  | { readonly kind: "schedule.cancel"; readonly scheduleId: string }
  | { readonly kind: "schedule.run"; readonly scheduleId: string };

export type ServiceCommand = {
  readonly kind: "service";
  readonly action: "start" | "status" | "stop" | "ensure" | "launch-mode" | "run";   // launch-mode·run은 도움말에 숨김
  readonly output: OutputMode;
  readonly safeMode: boolean;                                                       // --safe-mode. start·ensure·run만
  readonly listenTcp: { readonly host: string; readonly port: number } | null;      // --listen-tcp. start·run만
  readonly allowNonLoopback: boolean;                                               // --allow-non-loopback. --listen-tcp와 함께만
};
/** `db export <폴더>`. destDir은 작업 폴더 기준 상대 경로일 수 있다. 엔진을 띄우지 않는다(§4.13) */
export type DbCommand = { readonly kind: "db.export"; readonly destDir: string; readonly output: OutputMode };
/** @xeon/host의 HostCommand(runHostCommand 입력)와 다른 타입이다. 이름을 나눠 둔다. */
export type CliHostCommand = { readonly kind: "host"; readonly stdio: true };
export type DoctorCommand = { readonly kind: "doctor"; readonly output: OutputMode };
export type VersionCommand = { readonly kind: "version"; readonly output: OutputMode };
export type HelpCommand = { readonly kind: "help"; readonly topic: string | null };

export type CliCommand =
  | ChatCommand | SessionsCommand | ConfigCommand | SecretCommand
  | ScheduleCommand | ServiceCommand | DbCommand | CliHostCommand | DoctorCommand | VersionCommand | HelpCommand;

export interface GlobalOptions {
  readonly cwd: string;
  readonly color: boolean;
}

export type UsageErrorCode =
  | "unknownCommand" | "unknownFlag" | "missingArgument" | "unexpectedArgument"
  | "invalidSettingKey" | "invalidOverride" | "invalidThreadId" | "invalidScheduleId" | "invalidSecretName"
  | "secretValueInArgv" | "conflictingFlags" | "jsonRequiresPrint" | "autoApproveRequiresPrint" | "inputRequired" | "revealRequiresTty";

export interface UsageError {
  readonly code: UsageErrorCode;
  readonly message: string;             // 한 줄. 무엇이 잘못됐는가
  readonly fix: string;                 // 한 줄. 해결 방법(§4.10)
}

export interface TerminalFacts {
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
}

/** 순수 함수. argv는 실행 파일 경로를 뺀 인자다. TTY 사실로 모드를 정한다(§4.2). */
export declare function parseArgv(
  argv: readonly string[],
  terminal: TerminalFacts,
  env: Readonly<Record<string, string | undefined>>,
): Result<{ readonly global: GlobalOptions; readonly command: CliCommand }, UsageError>;
```

- [제안] 설정 키 인자(`config get/set/reset`, `--set`)는 파서 단계에서 `SettingKey` 스키마(`SETTING_KEY_PATTERN`)로 형식만 검사한다. 키의 존재와 값 검사는 host가 한다(§4.8, `F.wire-settings.spec` §4.11).
- [제안] 파서는 외부 라이브러리를 쓰지 않고 직접 쓴다. 명령 수가 적고, 비밀 값 argv 금지(§4.7) 같은 규칙을 파서 안에 둬야 하기 때문이다.

### 3.3 엔진 연결: `@xeon/host` API 조합

[결정] UI는 엔진 객체를 직접 다루지 않고 호스트 계약만 쓴다(adr.0006 §3.2). [제안] CLI는 `@xeon/host`의 공개 진입점(`.`)과 L4 공유 패키지 `@xeon/client`(연결 코드 `createHostConnection`, [결정: adr.0020])가 내는 함수를 조합해 연결을 만든다. M2의 `@xeon/host/client` 서브패스는 M3에 `@xeon/client`로 옮긴다. `EngineConnector`, `StdioHostRunner`, `ServiceControl` 같은 이름은 `@xeon/host`에 없다. 연결 타입과 오류 문구는 CLI 안의 이름이다(`L4.host-service.spec` §3.3.5). `apps/cli` → `@xeon/host` import는 허용 목록 `DR-10/cli-host`로 연다(`L4.host-service.spec` §3.1, 사용자 승인 전 [미결 §10 1번]).

| CLI 경로 | 쓰는 `@xeon/host` API | `L4.host-service.plan` 작업 |
|---|---|---|
| `chat`, `sessions`, `config get/set/reset/list`, `secret` | `connectEngine`(아래)이 원격 주소(`resolveRemoteEndpoint`, HS-87)를 먼저 보고, 있으면 `attachToService({ kind: "endpoint" })`. 없으면 `resolveLaunchMode` → `"service"`면 `attachToService({ kind: "local" })`(이 기기의 서비스를 띄우고 붙는다), `"in-process"`면 `startInProcessHost` + `createHostConnection(host.client)` | H2(`assemble`), H3(`createHostConnection`), H4(처리기), H10(`ensureService`, `connectServiceTransport`), H20(`resolveLaunchMode`), B2-RMT(`attachToService`, `resolveRemoteEndpoint`) |
| `host --stdio` | `runHostCommand({ kind: "host-stdio" }, io)`. `l4.cli.*` 설정 그룹을 함께 넘길 때는 같은 일을 하는 `startStdioHost({ readable, writable, assemble: { settingGroups } })`를 부른다 | H5 |
| `service start/status/stop/ensure/launch-mode/run` | `runHostCommand({ kind: "service-start" \| "service-status" \| "service-stop" \| "service-ensure" \| "service-launch-mode" \| "service-run" }, io)` | H10, H11, H20 |
| `config schema` | `runHostCommand({ kind: "config-schema", scope, out, coreOnly }, io)` | H8 |

```ts
// src/engine.ts (CLI 안의 이름. @xeon/host에 두지 않는다)
import type { Result } from "@xeon/contracts";
import type { HostConnection, JsonRpcMessage, TransportKind } from "@xeon/contracts/wire";
import type { SettingDefInput, SettingGroup } from "@xeon/contracts/settings";

export type ConnectPreference = "auto" | "in-process" | "service";

export interface EngineConnectOptions {
  readonly workspace: string;                                   // 작업 폴더 절대 경로
  readonly preference: ConnectPreference;                       // "auto"면 원격 주소, 다음 resolveLaunchMode()(§4.3)
  readonly client: { readonly name: "xeon-cli"; readonly version: string };
  readonly settingGroups: readonly SettingGroup<"l4.cli", Readonly<Record<string, SettingDefInput>>>[];   // AssembleOptions.settingGroups로 넘긴다(§6)
  readonly devWireRoundTrip: boolean;                           // AssembleOptions.devChecks로 넘긴다(F wire §3.1)
  readonly observe?: (message: JsonRpcMessage) => void;         // CLI가 Transport를 감싸 send·onMessage를 탭한다(JSON 모드)
  readonly remote?: string;                                     // --remote 원문. "auto"일 때만 본다(HS-87)
  readonly env: Readonly<Record<string, string | undefined>>;   // 원격 토큰 XEON_REMOTE_TOKEN을 읽는다
}

export type EngineStartErrorKind =
  | "fts5Missing" | "sopsMissing" | "dataDirPermission" | "storeUnavailable"   // AssembleIssue "store"(메시지로 구별 [가정])
  | "catalogConflict"                                                          // AssembleIssue "catalog"
  | "missingService"                                                           // AssembleIssue "missingService"
  | "serviceUnreachable"                                                       // AttachError(ensure_failed, connect_failed, hello_failed의 auth_failed·timeout·closed)
  | "protocolUnsupported"                                                      // hello 1003, AttachError hello_failed protocol_unsupported
  | "invalidRemote";                                                           // --remote 또는 설정 주소의 문법 오류(HS-87). 사용 오류라 종료 코드 2

export interface EngineStartError {
  readonly kind: EngineStartErrorKind;
  readonly message: string;                                     // 한 줄
  readonly fix: string;                                         // 한 줄
}

export interface EngineHandle {
  readonly connection: HostConnection;                          // host.hello까지 마친 연결
  readonly transport: TransportKind;                            // "in-process" | "socket"
  readonly storeId: string;                                     // host.hello 결과의 storeId
  readonly paths: { readonly cliStateFile: string };            // CLI 상태 파일 위치. @xeon/host resolveHostStatePaths(L4.host-service.spec §3.3.6)
  /** in-process면 InProcessHost.close()(HS-31), socket이면 HostConnection.close()만 한다. in-process에서는 close()가 돌려준 "clean" | "deadline"을 그대로 돌려준다.
   *  체크포인트 시한은 l0.process.shutdown.timeoutMs다(L0.process.spec §6, L4.host-service.spec §3.3.5). */
  shutdown(reason: "user" | "signal"): Promise<"clean" | "deadline">;
}

export type ConnectEngine = (options: EngineConnectOptions) => Promise<Result<EngineHandle, EngineStartError>>;
/** 위 표 첫 행의 조합. AssembleError와 EnsureResult 실패를 EngineStartError로 바꾸고 host.hello를 보낸다. */
export declare const connectEngine: ConnectEngine;
```

- `observe`는 `HostConnection` 안쪽의 클라이언트 전송에 붙는 탭이다. 호스트는 관여하지 않는다. CLI는 이 탭으로 JSON 모드 출력을 만들고, 엔진 객체를 만지지 않는다.
- 연결 대상(`preference` "auto", HS-87·HS-88): ① `resolveRemoteEndpoint({ flag: --remote, env })`가 `remote`면 `attachToService({ kind: "endpoint", endpoint })`로 붙는다. ② `invalid`면 엔진을 열지 않고 `invalidRemote`로 끝난다. 플래그 값은 문구에 보이고, 설정 값과 `@`가 든 값은 보이지 않는다. ③ 주소가 없으면 `resolveLaunchMode()`가 `"service"`일 때 `attachToService({ kind: "local" })`로 붙고, 아니면 in-process다. `"service"`는 주소를 보지 않고 로컬 서비스에 붙고, `"in-process"`는 어떤 설정도 보지 않는다.
- 서비스 접속의 `EngineHandle`: `secretOutOfBand`는 `null`이다. 값 입력은 §4.7이 정한 대로 서비스 쪽 입력 창으로 받는 설계지만 이 구현은 그 창을 만들지 않는다. 그래서 서비스 접속의 `xeon secret add`는 두 줄 오류로 끝난다(§10 22번). `shutdown`은 연결만 닫고 `"clean"`을 돌려준다. 서비스와 진행 중 turn은 계속된다(HS-88). 시계와 `newRequestId`는 CLI의 운영 값(`@xeon/platform-os`)이다. 엔진이 CLI 밖에 있기 때문이다 [제안].
- `AttachError`의 문구(§4.10 표 `serviceUnreachable`·`protocolUnsupported`): `ensure_failed`는 해결 `xeon service status`다. `connect_failed`는 `not_found`·`refused`에 "원격 서비스가 켜져 있고 주소가 맞는지 확인한다", `permission`에 소켓 파일과 폴더의 소유자·권한, `tunnel_unavailable`에 재설치, `tunnel_failed`에 ssh 출력의 첫 줄과 "ssh 키나 ssh-agent로 암호 없이 접속되는지 확인한다", `io`에 `xeon service status`다. `hello_failed`는 `auth_failed`에 `XEON_REMOTE_TOKEN`을 서버 토큰과 맞추라는 해결(토큰 값은 싣지 않는다), `protocol_unsupported`에 `protocolUnsupported`, `timeout`·`closed`에 `xeon service status`다.
- `settingGroups`: [제안] CLI 설정(§6)은 엔진 바이너리의 진입(`apps/cli/src/main.ts`)이 in-process 연결, `host --stdio`, 서비스 기동 세 경우 모두 조립에 넘긴다. 엔진 바이너리가 하나이므로(§2) 서비스 프로세스의 카탈로그에도 `l4.cli.*`가 들어간다.
- 오류 대응: `AssembleError.issues[].code`가 `store`면 `message`로 `fts5Missing`·`dataDirPermission`·`storeUnavailable`을 고른다 [가정: `L0.store.spec` 오류 모양을 따른다]. `catalog`는 `catalogConflict`, `missingService`는 `missingService`다. 종료 코드는 §4.10 표다.

### 3.4 CLI 진입

```ts
// src/main.ts
import type { CommandIo, HostCommand } from "@xeon/host";   // @xeon/host의 이름(L4.host-service.spec §3.3.4)
import type { ConnectEngine } from "./engine.ts";

export interface CliIo {
  readonly stdin: ReadableStream<Uint8Array>;
  readonly stdout: (text: string) => Promise<void>;    // EPIPE면 거부한다(§4.6)
  readonly stderr: (text: string) => Promise<void>;
  readonly terminal: TerminalFacts & { readonly columns: number | null };
  readonly env: Readonly<Record<string, string | undefined>>;
  onSignal(signal: "SIGINT" | "SIGTERM" | "SIGHUP", handler: () => void): () => void;
}

export interface CliDeps {
  readonly connect: ConnectEngine;                      // §3.3. 실제 값은 connectEngine
  /** @xeon/host의 runHostCommand 그대로. host --stdio, service *, config schema가 쓴다(§3.3 표). */
  readonly runHostCommand: (command: HostCommand, io: CommandIo) => Promise<0 | 1 | 2>;
  readonly clock: { now(): number };                    // Ctrl+C 2회 판정(§4.6). eng.typescript.guide의 Clock. 실제 값은 @xeon/platform-os의 systemClock()
}

/** 프로세스 밖 효과는 io와 deps로만 한다. 테스트는 둘을 가짜로 넣는다. */
export declare function runCli(argv: readonly string[], io: CliIo, deps: CliDeps): Promise<ExitCode>;
```

- M2에서 더한 필드 [spec에 더한 필드]:
  - `CliIo.readSecret(prompt, signal)`: 에코 없는 한 줄 입력을 바이트 배열로 돌려준다(§4.7). EOF·Ctrl+C는 null이다. TTY일 때만 부른다.
  - `CliIo.setCompleter(complete)`: 대화형 입력의 Tab 완성기를 바꾼다(§4.12).
  - `CliIo.stdoutStream`, `stderrStream`: 바이트 출력. `host --stdio`는 계약(JSON Lines) 전용으로 `stdoutStream`만 쓰고, `secret reveal`은 값을 이 스트림에 바이트로 쓴다.
  - `CliDeps.startStdioHost`: `@xeon/host`의 `startStdioHost` 그대로(§3.3 표). `CliDeps.probes.probeSearxng`: doctor의 SearXNG 탐침(§4.7.1).
  - `EngineHandle.secretOutOfBand`: in-process 접속에서 값 입력·열람 수단을 wire 밖으로 맡기는 통로(`SecretOutOfBandPort`, `InProcessHost.secretOutOfBand`). 서비스 접속은 null이다.
  - `EngineHandle.supports(feature)`: `host.hello`의 `features`(active, experimental)에 그 이름이 있는지. 호스트가 아직 구현하지 않은 메서드(`turn.interrupt`, `thread.open`, `approval.list`, `events.unsubscribe`)를 쓰기 전에 거른다.
- M3b B3-DATA에서 더한 필드: `CliDeps.exportDatabase`(`@xeon/platform-store`의 `exportDatabase`를 감싼 비동기 함수. 부를 때 모듈을 읽는다)와 `CliDeps.resolveDataDir`(`@xeon/platform-os`의 `resolveOsDirs`가 정한 데이터 디렉터리의 절대 경로, 정할 수 없으면 null). 둘 다 엔진을 띄우지 않는다. 시험은 가짜를 넣는다.
  - M3b에서 더한 필드: `CliDeps.groupTemplates`(`GroupTemplatesPort`, §3.8). 실제 값은 `src/group/fs-port.ts`의 `createGroupTemplatesFs`이고 `runtime.ts`가 조립한다.
- `main.ts`의 최상위 코드는 `process.argv.slice(2)`, 실제 `CliIo`, `CliDeps`(`connectEngine`과 `@xeon/host`의 `runHostCommand`)로 `runCli`를 부르고 `process.exit(code)`만 한다. 최상위 await를 쓰지 않는다(`bun build --compile --bytecode`). 실제 `CliIo`·`CliDeps`를 만드는 코드는 `runtime.ts`에 있고 `main.ts`가 필요할 때 읽는다.

### 3.5 렌더러

```ts
// src/render/model.ts
export type ToolChannel = "model" | "ui" | "structured";

export interface ToolCallView {
  readonly itemId: ItemId;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly argsSummary: string;                         // 한 줄, 120자 이하
}

export interface ToolResultView {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly isError: boolean;
  readonly synthesized: boolean;                        // 재개 때 복구 규칙이 만든 결과(F.records §4.5)
  readonly lines: readonly string[];                    // §4.5 표시 규칙으로 만든 줄
}

export interface ApprovalView {
  readonly approvalId: string;                          // [가정] approval.requested 이벤트 id(F wire §4.6)
  readonly title: string;
  readonly body: readonly string[];
  readonly allowsAnswer: boolean;
}

export type RenderOp =
  | { readonly kind: "user"; readonly itemId: ItemId; readonly text: string }
  | { readonly kind: "assistant"; readonly itemId: ItemId; readonly markdown: string; readonly thinking: string | null }
  | { readonly kind: "toolCall"; readonly view: ToolCallView }
  | { readonly kind: "toolResult"; readonly view: ToolResultView }
  | { readonly kind: "custom"; readonly itemId: ItemId; readonly customType: string; readonly text: string }
  | { readonly kind: "progress"; readonly itemId: ItemId; readonly text: string }       // 휘발
  | { readonly kind: "clearProgress"; readonly itemId: ItemId }
  | { readonly kind: "approval"; readonly view: ApprovalView }
  | { readonly kind: "approvalResolved"; readonly approvalId: string }
  | { readonly kind: "turnEnd"; readonly status: "completed" | "interrupted" | "failed"; readonly error: string | null }
  | { readonly kind: "notice"; readonly text: string };   // 확장 핸들러 실패와 알림 전달(§4.5.1). text는 여러 줄일 수 있다

export interface TranscriptState {
  readonly position: StreamPosition | null;             // 마지막으로 반영한 (storeId, to)
  readonly openItems: ReadonlySet<string>;              // 진행 줄이 있는 item
  readonly pendingApprovals: ReadonlySet<string>;
  readonly deferredChunks: readonly StreamChunkParams[];   // afterSeq가 position보다 앞선 조각
}

export declare function initialTranscript(position: StreamPosition | null): TranscriptState;
/** 순수 함수. 구간 규칙(F wire §3.4.2)을 검사하고 내구 이벤트를 RenderOp로 바꾼다. */
export declare function applyBatch(state: TranscriptState, batch: EventsBatchParams, storeId: string):
  Result<{ readonly state: TranscriptState; readonly ops: readonly RenderOp[] }, { readonly kind: "gap"; readonly expectedFrom: number; readonly got: number }>;
/** 순수 함수. 휘발 조각을 진행 줄로 바꾼다. 내구 기록이 이미 온 item의 조각은 버린다. */
export declare function applyChunk(state: TranscriptState, chunk: StreamChunkParams):
  { readonly state: TranscriptState; readonly ops: readonly RenderOp[] };

export interface RenderSink {
  write(ops: readonly RenderOp[]): Promise<void>;
  close(): Promise<void>;
}
/** text: 제어 문자 없는 줄 출력(print 모드, 비TTY). tui: §4.9의 화면. JSON 모드는 RenderSink를 쓰지 않는다. */
export type RenderSinkKind = "text" | "tui";
```

- 도구 결과 표시용 렌더러 표:

```ts
// src/render/tools.ts
export interface ToolResultRenderer {
  readonly toolName: string;
  /** details(UI 채널)를 줄로 바꾼다. 모양이 맞지 않으면 undefined를 돌려 일반 규칙으로 넘긴다. */
  render(details: unknown, width: number): readonly string[] | undefined;
}
export declare const BUILTIN_TOOL_RENDERERS: readonly ToolResultRenderer[];   // M1: read, ls, bash
```

### 3.6 종료 코드 [제안]

```ts
// src/exit-codes.ts
export type ExitCode = 0 | 1 | 2 | 3 | 4 | 129 | 130 | 143;

export const EXIT: {
  readonly ok: 0; readonly error: 1; readonly usage: 2; readonly environment: 3;
  readonly lockDenied: 4; readonly hangup: 129; readonly interrupted: 130; readonly terminated: 143;
} = { ok: 0, error: 1, usage: 2, environment: 3, lockDenied: 4, hangup: 129, interrupted: 130, terminated: 143 };
```

| 코드 | 뜻 | 예 |
|---|---|---|
| 0 | 정상 | turn이 `completed`로 끝났다. 명령이 성공했다 |
| 1 | 일반 오류 | turn이 `failed`, wire 오류(`internal`, `settings.invalidValue` 등), 없는 세션, `EngineStartError`의 `catalogConflict`·`missingService`(설치본·확장 결함이라 환경을 고쳐도 풀리지 않는다), `runHostCommand`의 1, `schedule`의 기대한 실패(없는 예약, 원격 아님, 꺼진 예약, 간격 미달, 상한, 지난 시각) |
| 2 | 사용법 오류 | 모르는 플래그, 인자 누락, argv에 비밀 값, `--json`을 대화형에 씀, `--remote` 주소 문법 오류(`EngineStartError`의 `invalidRemote`), `schedule`의 사용법 오류(트리거 없음이나 둘 이상, 값 형식, 예약 id 형식), `db export`의 폴더 인자 누락, `db export`의 대상 폴더가 비어 있음(`dest_not_empty`) |
| 3 | 환경 문제 | `EngineStartError`의 나머지 kind(FTS5 없음, sops 없음, 데이터 디렉터리 권한, 저장소 열기 실패, 서비스 도달 불가, 계약 버전 불일치), `db export`의 저장소·디스크 오류(`foreign_database`, `not_a_database`, `io`, `busy`, `disk_full`)와 데이터 디렉터리 위치를 정하지 못함. `schedule`의 `store_failed`(예약 상태 파일) |
| 4 | 세션 잠금 실패 후 사용자 거부 | `thread.locked`에서 관찰·분기·위임을 고르지 않았다. M1은 프롬프트 없이 바로 4다 |
| 129 | SIGHUP | 터미널이 닫혔다(pi print 모드와 같은 값, `~/projects/_ref/pi-src/packages/coding-agent/src/modes/print-mode.ts:60`) |
| 130 | 중단 | Ctrl+C(SIGINT)로 끝냈다. print 모드 turn이 `interrupted`로 끝났다 |
| 143 | SIGTERM | 체크포인트 뒤 끝냈다(pi print 모드와 같은 값) |

- 이 표는 제품 CLI의 종료 코드다. 개발 레시피의 종료코드 규칙(1 고침, 2 환경, 3 사람 확인, `eng.toolchain.guide` 3.2절)과 섞지 않는다. 특히 제품의 3은 "환경 문제"이고 개발 레시피의 3은 "사람 확인 필요"다.
- 129, 143은 pi print 모드의 신호 종료 값을 따라 더한 것이다 [제안](`print-mode.ts:60`).
- `runHostCommand`를 부르는 명령(`host --stdio`, `service *`, `config schema`)은 반환값 0·1·2를 그대로 종료 코드로 쓴다. 이 경로의 시작 거부(SV-05 권한 검사, `AssembleError`)는 3이 아닌 1이다(`L4.host-service.spec` §3.3.5).
- `group new`(§3.8)의 종료 코드: 2는 플래그 충돌, 이름 형식이나 예약 이름, 설치된 확장과 이름 겹침, 대상 폴더가 비어 있지 않음, 생성한 매니페스트의 검사 실패다. 3은 템플릿 위치나 색인 문제, 파일 읽기와 쓰기 실패다.

### 3.7 CLI 상태 파일

```ts
// src/state.ts
import { Type, type Static } from "typebox";

export const CliStateEntrySchema = Type.Object({
  threadId: Type.String({ minLength: 1, maxLength: 64 }),          // ThreadId 문자열
  position: Type.Object({ storeId: Type.String(), seq: Type.Integer({ minimum: 0 }) }),
  updatedAt: Type.String({ format: "date-time", maxLength: 32 }),
}, { additionalProperties: false });

export const CliStateSchema = Type.Object({
  version: Type.Literal(1),
  workspaces: Type.Record(Type.String({ maxLength: 4096 }), CliStateEntrySchema),   // 키: 작업 폴더 절대 경로
}, { additionalProperties: true });

export type CliStateEntry = Static<typeof CliStateEntrySchema>;
export type CliState = Static<typeof CliStateSchema>;
```

- 위치는 `EngineHandle.paths.cliStateFile`이다. 경로 계산(OS 분기)은 CLI가 하지 않는다(DR-13).
- 쓰기는 임시 파일에 쓴 뒤 이름 바꾸기로 한다. 권한은 0600 [제안].
- 이 파일은 캐시다. 깨졌거나 스키마가 맞지 않으면 버리고 `--continue`는 "이어 열 세션이 없다"로 처리한다. M2부터 `--continue`는 `thread.list`를 정본으로 쓰고 이 파일은 위치(`position`)만 제공한다.

### 3.8 그룹 생성 명령 `xeon group new` [M3b]

명령의 요구(R1~R6)는 `L3.slots.spec` §3.3.6이 정한다. 이 절은 구현 계약이다.

```ts
// src/io.ts (CliDeps의 필드)
export interface GroupTemplatesPort {
  readIndex(): Promise<Result<string, GroupIoError>>;                  // templates/index.json 텍스트
  readTemplateFile(rel: string): Promise<Result<Uint8Array, GroupIoError>>;
  installedExtensionNames(workspace: string): Promise<Result<readonly string[], GroupIoError>>;
  targetState(path: string): Promise<Result<"absent" | "empty" | "occupied", GroupIoError>>;
  makeDir(path: string): Promise<Result<void, GroupIoError>>;
  writeFile(path: string, bytes: Uint8Array): Promise<Result<void, GroupIoError>>;
  removeDir(path: string, options: { readonly keepRoot: boolean }): Promise<Result<void, GroupIoError>>;
}
```

- [spec에 더한 형식] 실패할 수 있는 호출은 `Result`를 돌려준다(`eng.typescript.guide` TY-11). 시험 가짜는 `test/support/group-fs.ts`다. `targetState`는 `isEmptyDir` 대신 세 상태를 준다. 그래야 실패할 때 처음부터 없던 폴더만 지우고 빈 폴더는 남긴다.
- [결정: 오케스트레이터 기본값] 이름 규칙은 `src/group/rules.ts`가 가진다. `GROUP_NAME_PATTERN`, `RESERVED_GROUP_NAMES`, 색인 스키마는 `group-kit`의 값을 옮겨 적은 복사본이다(DR-14). `test/group-rules.test.ts`가 `group-kit/src/define-group.ts` 텍스트와 비교해 목록이 갈라지면 실패한다.
- 검사 순서. 파서가 플래그 충돌(R1)과 이름 형식, 예약 이름(R2 앞부분)을 본다. 명령은 색인을 읽고 설치된 확장 이름과 겹치는지 본다(R2). 대상 폴더가 비어 있는지 본다(R3). 템플릿을 메모리에서 읽고 치환한 뒤에 쓴다. 쓴 뒤 `.xeon-plugin/plugin.json`을 F `validateManifest`로 검사한다(R4). 오류가 있으면 쓴 것을 지운다. 처음부터 있던 빈 폴더는 지우지 않는다.
- [결정: 오케스트레이터 기본값] R4 실패는 사용법 오류(2)다. 실패의 원인은 템플릿 결함이지만 명령이 생성 결과를 거부한 것이라 환경 문제(3)로 두지 않았다. 템플릿 위치와 색인, 파일 읽기와 쓰기 실패는 3이다.
- 치환 자리. `__ID__`는 이름, `__TITLE__`은 이름(표시 이름 옵션은 두지 않는다), `__VERSION__`은 `0.1.0`이다. 파일 내용과 경로에 모두 적용한다. 치환 뒤 경로는 템플릿 묶음 이름(`common`, 종류 이름) 한 마디를 뗀 상대 경로다.
- 대상 폴더. `--dir`이 없으면 작업 폴더 아래 `<이름>`이다. `--dir`이 상대 경로면 작업 폴더 기준이다. 빈 값은 사용법 오류다.
- 설치된 확장 이름. 사용자 설정 폴더(`<OsDirs.config>/extensions/*`)와 작업 폴더(`.xeon/extensions/*`)의 `.xeon-plugin/plugin.json` `name`을 모은다. 작업 폴더의 확장은 신뢰 여부와 관계없이 센다(보수적). 폴더 없이 설치된 기본 그룹 `helm`, `learning`, `account-rotation`은 `runtime.ts`에 옮겨 적었다([미결] §10 28번). `<OsDirs.config>`는 `@xeon/platform-os`의 `resolveOsDirs`로 구한다. 같은 함수를 호스트가 쓴다. 매니페스트가 없는 폴더는 건너뛴다. 있는데 읽지 못하면 환경 문제다.
- 템플릿 위치. 환경 변수 `XEON_GROUP_TEMPLATES_DIR`가 있으면 그 폴더를 쓴다. 없으면 자원 디렉터리(실행 파일이 든 폴더)의 `group-kit/templates/`를 본다. 릴리즈 아카이브가 여기에 템플릿을 싣는다(`L4.release.spec` §3.1). 그다음 실행 파일의 소스 위치에서 위로 올라가며 `packages/group-kit/templates`를 찾는다([결정: 오케스트레이터 기본값]). 셋 모두 없으면 3으로 끝난다.
- R5. 템플릿 코드는 실행하지 않는다. 명령은 파일을 읽고 치환해 쓸 뿐이다. 의존은 설치하지 않고 `bun install`과 `bun test`를 안내한다. 생성 `package.json`에는 의존을 적지 않는다([미결] §10 30번).
- 옵션을 더하지 않는다. 저장소 안 그룹의 `src/manifest.ts` 형식(`L3.slots.spec` §3.3.2)은 만들지 않고 외부 형식 `.xeon-plugin/plugin.json`만 쓴다.
- 출력. 텍스트는 만든 파일 목록과 다음 단계를 쓴다. `--json`은 `{ name, template, dir, files }` 한 개를 쓴다.
- 시험. `test/group-new.test.ts`는 메모리 가짜로 플래그, 이름, 치환, 정확한 매니페스트 텍스트, 충돌, 비어 있지 않은 폴더, R4 되돌리기, 쓰기 실패 되돌리기, 색인 없음을 본다. `test/group-new-core-diff.test.ts`(`group-new.output-passes-core-diff-check-with-zero-lines`)는 실제 파일 시스템과 실제 `templates/`로 만든 세 그룹을 임시 저장소에 커밋하고, `scripts/core-diff-check.ts`가 보호 경로를 0줄로 보고하는지 본다. 같은 시험에서 `ext-host` README를 바꾸면 그 경로를 보고하는지도 본다.

## 4. 동작 규칙

### 4.1 기동 순서

1. `parseArgv`. 실패하면 사용법 오류를 출력하고 2로 끝낸다.
2. `version`, `help`는 엔진 없이 끝낸다.
3. `host --stdio`, `service *`, `config schema`는 `deps.runHostCommand`를 부르고 그 반환값으로 끝낸다(§3.3 표). `host --stdio` 경로는 사람용 출력을 stdout에 쓰지 않는다(stdout은 JSON Lines 전용).
4. 그 밖의 명령은 `deps.connect`를 부른다. 실패하면 `EngineStartError`의 `message`와 `fix`를 stderr에 쓰고 §4.10 표의 종료 코드(`catalogConflict`·`missingService`는 1, `invalidRemote`는 2, 나머지는 3)로 끝낸다.
5. 명령을 실행한다. 끝나면 `EngineHandle.shutdown("user")`를 부르고 종료 코드를 돌려준다. 체크포인트 시한은 `l0.process.shutdown.timeoutMs`다(`L0.process.spec` §6, `L4.host-service.spec` HS-31).

### 4.2 실행 모드 결정

| 조건 | 모드 |
|---|---|
| `-p`/`--print`가 있다 | print |
| `-p`가 없고 stdin이 TTY가 아니다 | print. 입력은 stdin 전체 |
| `-p`가 없고 stdout이 TTY가 아니다 | print. 입력이 없으면(stdin이 TTY) 사용법 오류 2, `inputRequired` |
| `-p`가 없고 stdin·stdout이 모두 TTY | 대화형 |

- `-p <입력>`과 TTY가 아닌 stdin이 함께 있으면 `-p` 입력 뒤에 빈 줄과 stdin 내용을 붙인다 [제안].
- 입력은 UTF-8로 읽고 `TurnStartInput` 문자열로 보낸다. 1 MiB 프레임 한도(`WIRE_LIMITS.maxFrameBytes`)를 넘으면 사용법 오류 2다.
- `--json`은 print 모드에서만 쓴다. 대화형과 함께 쓰면 2(`jsonRequiresPrint`).
- `--auto-approve`도 print 모드에서만 쓴다. 대화형과 함께 쓰면 2(`autoApproveRequiresPrint`).
- print 모드와 비TTY 출력에는 ANSI 제어 문자(색, 커서 이동, CSI 2026 동기화, OSC)를 쓰지 않는다. `--no-color`, `NO_COLOR`, `TERM=dumb`이면 대화형에서도 색을 쓰지 않는다.

### 4.3 엔진 연결

- [결정] CLI 기본 전송은 in-process다(adr.0006 §3.3, `F.wire-settings.spec` §3.1 표).
- [결정] 서비스 사용 설정이 켜져 있으면 시작할 때 `ensure`를 부르고 socket 전송으로 접속한다. 꺼져 있으면 in-process다(adr.0006 §3.4). [제안] `preference: "auto"`이면 `connectEngine`이 `resolveLaunchMode()`로 `l0.process.service.enabled`를 엔진 없이 읽어 정한다(`L4.host-service.spec` HS-37). 키는 `L0.process.spec` §6이 소유한다.
- [제안] 원격 주소(`--remote` 또는 설정 `l0.process.service.remote`)가 있으면 서비스 사용 설정보다 먼저 그 주소로 붙는다(HS-87, HS-88). 원격 접속 토큰은 환경 변수 `XEON_REMOTE_TOKEN`에서 읽는다. 주소 문법이 틀리면 엔진을 열지 않고 `invalidRemote`(2)로 끝난다.
- [제안] 개발 빌드(`process.env.XEON_DEV === "1"` 또는 `bun run`으로 소스 실행)는 `devWireRoundTrip: true`를 넘긴다. in-process에서 비직렬화 값이 섞이지 않게 하는 검사다(F wire §3.1 마지막 항목). 컴파일 바이너리는 끈다.
- 연결 뒤 순서:
  1. `host.hello`(`connectEngine`이 보낸다, `L4.host-service.spec` §3.3.5). `storeId`를 기억한다.
  2. 대상 세션 결정(§4.4).
  3. `events.subscribe { from, filter: { threadIds: [threadId] } }`.
  4. 응답 뒤 `turn.start { threadId, input, requestId }`. `requestId`는 CLI 실행마다 새 ULID [제안]. 같은 실행 안의 재시도는 같은 값을 쓴다(F conversation `requestId` 멱등).
- 세션 쓰기 소유(adr.0006 §3.6 규칙 1)는 새 세션이면 `thread.create`가 얻고(F wire §3.3.1 둘째 항목), 기존 세션은 `turn.start`가 암묵 획득한다(`L4.host-service.spec` HS-28). 얻지 못하면 `turn.start`가 `thread.locked`(3002)와 대안 `options`를 돌려준다. 그래서 M1의 `--continue`·`--resume`은 `thread.open` 없이 동작한다.

### 4.4 세션 대상과 재개

| 대상 | M1 | M2 이후 |
|---|---|---|
| 새 세션 | `thread.create { workspace }` → `position`부터 구독 | 같음 |
| `--continue` | CLI 상태 파일에서 작업 폴더의 항목을 찾는다. 없으면 "이어 열 세션이 없다" + 해결 한 줄, 1로 끝낸다 | `thread.list { workspace, limit: 1 }`의 첫 항목 → `thread.open { mode: "write" }`. 호스트가 `thread.list`를 -32601로 거절하면(아직 구현하지 않은 호스트) 상태 파일로 대신하고, `thread.open`은 `features`에 없으면 건너뛰어 M1처럼 `turn.start`가 소유를 얻게 한다 |
| `--resume <id>` | 상태 파일에 그 id의 위치가 있으면 그 위치부터, 없으면 `{ storeId, seq: 0 }`부터 구독 | `thread.open { threadId, mode: "write" }`의 `position` 사용 |

- 재개 구독 [제안]:
  - print 모드는 저장된 위치부터 구독한다. 그래서 강제 종료 뒤 엔진이 쓴 복구 기록(합성 `effect.result`, `turn.completed{interrupted}`)과 새 turn의 이벤트가 이어서 출력된다.
  - 대화형은 `{ storeId, seq: 0 }`, `filter.threadIds`로 구독해 이전 대화를 접힌 형태(user·assistant 텍스트만)로 그리고, 저장 위치 이후부터 전체 형태로 그린다.
- `replay.outOfRange`:
  - `storeMismatch`: 위치를 버리고 `from: "head"`로 다시 구독한다. "저장소가 바뀌어 이전 기록을 이어 받지 못했다"를 알린다.
  - `tooFar`, `beforeOldest`: 대화형은 `from: "head"`로 다시 구독하고 알린다. print 모드도 같다.
- 구간 검사(F wire §4.5): `applyBatch`가 `from ≠ position.seq`를 받으면 `gap`을 돌려준다. CLI는 마지막 `to`부터 다시 구독한다.
- 상태 파일 갱신: `events.batch`를 반영할 때마다 메모리의 위치를 바꾸고, 파일 쓰기는 turn 경계(`turn.completed`)와 종료 때 한다 [제안]. 강제 종료로 파일이 덜 갱신돼도 더 이른 위치부터 구독하므로 이벤트를 놓치지 않는다. 다시 받은 이벤트는 `applyBatch`가 seq로 걸러 중복 출력하지 않는다.

- 끊긴 turn 이어 실행 [결정: m2c G1-02]:
  - 대화형이 기존 세션(`--continue`, `--resume <id>`, `/resume`)을 열면 이전 기록을 다 그린 뒤, 입력을 받기 전에 `thread.list`에서 그 세션의 요약을 찾는다. 작업 폴더 범위에서 먼저 찾고 없으면 전체에서 찾는다. 쪽은 각 범위 최대 3쪽까지 넘겨 본다.
  - 요약의 `resumable`이 `null`이 아니면 "이 세션에 끊긴 turn이 있다 (시작 <시각>, 이어 실행을 <n>번 시도했다)"를 보이고 `이어서 실행할까요? [y/N]`을 묻는다. `y`일 때만 `turn.resume { threadId }`를 보낸다. 호스트는 자동 재개를 하지 않으므로 CLI도 묻지 않고 부르지 않는다. 호스트가 쓰기 소유를 얻으면서 되살린 미해결 승인(HS-52)이 있으면 그 승인 카드가 이 질문보다 먼저 서고, 카드에 답한 뒤에 이 질문을 한다 [미결 §10 15번].
  - 결과는 `resumed`(이어서 실행한다, 단계 `from`을 보이고 그 turn이 끝날 때까지 기다린다. 진행은 이벤트로 그려진다), `closed`(중단 요청 또는 소유자 취소라 이어 실행하지 않고 닫았다), `nothing`(이어서 실행할 turn이 없다)이다. 실패는 두 줄 오류로 알리고 입력을 이어 받는다.
  - 새 세션, 관찰 전용으로 연 세션, print 모드, `host.hello`의 `features`에 `turn.resume`이 없는 호스트에서는 묻지 않는다. 목록을 읽지 못해도 대화를 막지 않는다.
  - `xeon sessions ls`는 `resumable`이 있는 세션에 `[이어서 실행 가능]`을 붙인다(구현됨).

### 4.5 이벤트 렌더링

- 내구(`events.batch`)는 트랜스크립트, 휘발(`stream.chunk`)은 진행 줄이다(F wire §3.4.4). 다만 휘발 `scope.handler_failed`와 서버 알림 `notify.delivered`는 알림 줄이다(§4.5.1).

| 이벤트 | 처리 |
|---|---|
| `item.recorded`(user) | 사용자 입력 줄 |
| `item.recorded`(assistant) + `part.recorded` | Markdown 본문. thinking 파트는 대화형에서 접힌 한 줄, print 모드에서 생략 [제안] |
| `effect.intent` | 도구 호출 줄: 표시 제목(없으면 기계 이름)과 인자 요약 한 줄 |
| `item.recorded`(toolResult) + `effect.result` | 도구 결과(아래 3채널 규칙) |
| `item.recorded`(custom) | `display: true`면 `content`의 텍스트를 보이고, `false`면 보이지 않는다 |
| `turn.completed` | 상태가 `interrupted`·`failed`면 한 줄 알림. print 모드 종료 코드 결정(§3.6) |
| `step.*`, `checkpoint.step`, `lease.*`, `scope.changed`, retire된 `post.accepted`(M1 개발 DB에 남은 행) | 트랜스크립트에 그리지 않는다. 대화형 상태 줄에만 반영할 수 있다 |
| `settings.changed` | 대화형에서 한 줄 알림. 값이 비밀 참조면 참조 문자열만 보인다 |
| 확장 kind(`x.<id>.*`, `grp.<id>.*`) | 그리지 않는다. 확장이 보일 내용은 `custom` item으로 낸다(F conversation §3.5.2) |
| `stream.chunk` `item.updated{part_delta}` | 진행 줄에 텍스트를 이어 붙인다 |
| `stream.chunk` `item.updated{tool_progress}` | 진행 줄에 도구 진행을 한 줄로 바꿔 쓴다 |
| `stream.chunk` `scope.handler_failed` | 알림 한 줄(`notice`). §4.5.1 확장 핸들러 실패 규칙 |
| `notify.delivered` | 대화형에서 알림 한 줄(`notice`), 본문이 있으면 둘째 줄. §4.5.1 알림 전달 규칙 |
| 같은 item의 `item.recorded` 도착 | 그 item의 진행 줄을 지운다(F wire §3.4.4) |

- `afterSeq`가 현재 위치보다 앞선 조각은 `deferredChunks`에 두고, 그 seq까지 반영한 뒤 적용한다(F wire §3.4.4 마지막 항목).
- 도구 결과 3채널 표시 규칙(F conversation §3.6) [제안]:

| 채널 | 필드 | 텍스트 모드 표시 |
|---|---|---|
| UI용 | `details` | 우선 사용. `BUILTIN_TOOL_RENDERERS`에 그 도구가 있고 `render`가 줄을 돌려주면 그 줄을 쓴다 |
| 모델용 | `content` | UI용이 없거나 렌더러가 `undefined`를 돌려주면 텍스트 파트를 앞 20줄까지 보인다. 이미지 파트는 `[image <mimeType>]` 한 줄 |
| 구조화 | `structuredContent` | 텍스트 모드에서 보이지 않는다. JSON 모드에서는 이벤트에 그대로 있다 |

- `isError: true`면 결과 앞에 `error` 표지를 붙인다. `synthesized: true`면 "재개 때 중단됨으로 기록됨" 표지를 붙인다.
- `redactions`가 있는 이벤트는 가린 필드를 `[redacted]`로 보인다. 값을 복원하지 않는다.

#### 4.5.1 알림 그리기 [결정: 오케스트레이터 기본값]

확장 핸들러 실패와 알림 전달은 진행 줄이 아니라 `notice` 줄로 그린다. 문구와 묶음 규칙은 `render/notices.ts`의 순수 함수가 정한다.

- 확장 핸들러 실패(`stream.chunk`의 `scope.handler_failed`, `L4.host-service.spec` HS-92, `X.operations.spec` §4.3.4):
  - 문구: 카탈로그 id `cli.render.notices.handlerFailed`에서 현재 로케일로 만듭니다. 한국어 값은 `확장 <이름>의 <point> 핸들러가 실패했다 (연속 <n>회): <message>`입니다. `owner`의 `ext:` 접두어는 `cli.render.notices.owner.extension`(확장), `hook:`은 `cli.render.notices.owner.hook`(훅)으로 바꾸고 이름만 보입니다. `message`는 줄바꿈과 제어 문자를 칸으로 바꾸고 앞 120자(코드 포인트)만 보인다. 잘리면 `…`를 붙인다. 비어 있으면 `: <message>`를 붙이지 않는다.
  - 묶음: `consecutive`가 1이거나 5의 배수인 실패만 그리고 나머지는 버린다. 세는 일은 호스트가 한 `consecutive`를 그대로 쓰므로 CLI 세션은 상태를 두지 않는다. 5는 `X.operations.spec` §4.3.3의 자동 끄기 기본 기준(연속 5회)과 맞춘 값이다.
  - thread: 이 세션의 thread(`event.threadId`)가 보낸 것만 그린다. 호스트는 thread를 연 연결마다 한 번씩 보내므로, 다른 thread의 것은 같은 실패의 중복이거나 이 화면 밖의 일이다.
  - 순서: 진행 줄 조각과 달리 `afterSeq`가 앞서도 기다리지 않고 도착 순서대로 그린다 [제안].
- 알림 전달(`notify.delivered`, `L4.host-service.spec` HS-94):
  - 대화형에서만 그린다. print 모드는 turn 하나를 끝내고 끝나므로 완료 알림을 stderr에 쓰지 않는다. 성공한 실행의 stderr를 비운다(§4.2). JSON 모드는 `RenderSink`가 없어 그리지 않는다. 그 메시지는 JSON 줄로 그대로 나간다.
  - 문구: 첫 줄은 `[<종류>] <제목>`입니다. 종류 이름은 카탈로그 id `cli.render.notices.kind.<이름>`에서 읽습니다. `completed`는 `kind.completed`, `approval_waiting`은 `kind.approvalWaiting`, `question_waiting`은 `kind.questionWaiting`, `error`는 `kind.error`, `background_completed`는 `kind.backgroundCompleted`입니다. 한국어 값은 완료, 승인 대기, 질문 대기, 오류, 백그라운드 완료입니다. `body`가 있으면 둘째 줄입니다. 제어 문자는 칸으로 바꿉니다.
  - thread: `threadId`가 null이거나 이 세션의 thread면 그대로 쓴다. 다른 thread의 알림이면 첫 줄 끝에 ` (다른 대화)`를 붙인다.
  - 등록은 `host.hello`의 `features`에 `notify.delivered`가 없어도 한다. 오지 않으면 그릴 것이 없다.
  - 문구는 카탈로그 id(`cli.render.notices.*`)에서 현재 로케일로 만듭니다. ` (다른 대화)`는 `cli.render.notices.otherThread`에서 읽습니다(ADR-0016).
- 알림은 turn이 끝난 뒤 비동기로 온다. 세션이 먼저 끝나면 그 알림은 보이지 않을 수 있다(§10 24번).

### 4.6 입력, 중단, 신호

| 입력·신호 | 대화형 | print 모드 |
|---|---|---|
| Ctrl+C 1회(turn 진행 중) | M2: `turn.interrupt { threadId }`를 한 번 보낸다. 호스트의 `features`에 `turn.interrupt`가 없거나 그 요청이 실패하면 종료 요청과 같다(아래) [제안] | 종료 요청. 끝나면 130 |
| Ctrl+C 1회(turn 없음) | 입력 줄이 있으면 비운다. 비어 있으면 "한 번 더 누르면 끝낸다"를 보인다 | 해당 없음 |
| Ctrl+C 2회(2초 안) | 종료 요청. turn이 진행 중이었으면 130, 아니면 0 | 강제 종료(체크포인트 없이) 130 |
| Ctrl+C 3회 또는 종료 시한 초과 | 강제 종료 130. 다음 열기에서 엔진 복구 규칙이 처리한다(adr.0006 §3.6 규칙 5·6) | 같음 |
| SIGTERM | 종료 요청 → 143 | 같음 |
| SIGHUP | 종료 요청 → 129 | 같음 |
| stdout EPIPE | 출력을 멈추고 종료 요청 → 0 [제안] | 같음 |

- 종료 요청: `EngineHandle.shutdown("signal" | "user")`. 안전 경계에서 체크포인트한 뒤 닫는다(adr.0006 §3.7 7번). 시한은 상수 대신 `l0.process.shutdown.timeoutMs`(기본 3000ms)를 쓴다(`L4.host-service.spec` HS-31, §3.3.5). in-process에서 CLI가 소유 프로세스이므로, 진행 중 turn은 종료와 함께 `interrupted`가 된다(F wire §4.1 4번). socket 전송이면 연결만 닫고 서비스의 turn은 계속된다.
- [제안] M1에서 Ctrl+C 1회를 종료 요청으로 두는 이유: `turn.interrupt`가 M2 메서드이고(F wire §3.3.1), CLI는 엔진 객체를 직접 중단할 수 없다. M1 안에서 turn만 멈추는 동작이 필요하면 `turn.interrupt`를 M1로 당기는 F 변경이 필요하다 [미결 §10 2번].
- TUI가 raw 모드면 Ctrl+C는 신호 대신 입력 바이트(`\x03`)로 온다(`~/projects/_ref/pi-src/packages/tui/README.md` Quick Start 주석). 두 경로를 같은 처리기로 보낸다.

### 4.7 비밀 명령의 입력과 출력

- 값은 stdin이나 프롬프트로만 받는다. argv로 받지 않는다(`_research/secrets.md` §6.6).
  - [제안] 값은 wire 프레임에 싣지 않는다(`L4.readme` §4 비밀 행, `L0.secrets.spec` §8.3 R4). `add`·`set`·`rotate`는 값 필드가 없는 `secret.beginEntry { name, action }`으로 시작한다. 서비스 접속이면 서비스 쪽 L0.secrets가 OS 입력 창으로 값을 받는다(`L4.settings-ui.spec` §4.6.4 C안). in-process이면 CLI가 아래 규칙으로 읽은 값을 같은 프로세스의 L0.secrets에 wire 밖 경로로 넘긴다. 이 경로의 API는 `InProcessHost.secretOutOfBand`(`SecretOutOfBandPort`)다: CLI가 `offerEntry`·`offerReveal`로 수단을 맡기면 호스트 처리기가 다음 `beginEntry`·`beginReveal` 한 번에 그것을 꺼내 쓰고, CLI는 끝난 뒤 쓰이지 않은 수단을 거둔다. wire 메서드 `secret.list`·`meta`·`remove`·`test`·`beginEntry`는 F 표에 M2로 있다.
  - 파서는 `secret add|set|rotate`의 이름 뒤 위치 인자, `--value`, `<name>=<값>` 형식을 `secretValueInArgv` 사용법 오류(2)로 거부한다. 오류 메시지에 그 인자를 다시 쓰지 않는다.
  - TTY면 에코 없는 프롬프트로 두 번 받아 비교한다. TTY가 아니면 stdin을 EOF까지 읽고 끝의 줄바꿈 하나를 지운다.
  - `rotate`는 TTY 프롬프트만 받는다 [제안]. 사람이 직접 입력하는 동작으로 두기 위해서다(`_research/secrets.md` §6.6 "사람이 입력").
- 값은 stdout, stderr, 이벤트, 로그, 오류 `details`, JSON 모드 출력 어디에도 없다.
  - [제안] 비밀 명령에는 `--json` 메시지 탭을 붙이지 않는다. `secret ls`, `secret test`의 `--json`은 결과 객체만 쓴다.
  - 값을 담은 바이트 배열은 L0.secrets에 넘긴 직후 0으로 덮는다. 문자열로 바꾸지 않는다 [제안].
- `secret test`는 존재, 복호화 가능 여부, 길이, SHA-256 hex 앞 8자만 출력한다 [결정: m2c G1-07]. wire 결과는 `state`, `decryptable`, `length`, `sha256Prefix`다(`L0.secrets.spec`의 `SecretTestResult`). 글은 `<이름>: registered (복호화 가능, 길이 <n>바이트, sha256 앞 8자 <hex>)`이고, 복호화할 수 없으면 `registered (복호화할 수 없다)`, 없으면 `missing`이다. `registered`이면서 복호화할 수 있을 때만 0이고 나머지는 1이다. `--json`은 `{ name, state, decryptable, length, sha256Prefix }`를 한 줄로 쓴다. 앞 8자는 사람이 같은 값인지 견주는 데만 쓰고 기록하지 않는다.
- 입력 규칙 (구현):
  - TTY가 아니면 stdin을 EOF까지 읽고 끝의 줄바꿈 하나(`\n`, `\r\n`)를 지운다. 빈 값은 2, 64 KiB를 넘으면 2다.
  - TTY면 `readSecret`으로 두 번 받아 상수 시간으로 비교한다. 다르면 아무것도 저장하지 않고 1이다. Ctrl+C·Ctrl+D는 취소(1)다.
  - 값을 읽는 때는 호스트가 맡긴 수단의 `read()`를 부르는 순간이다. 읽은 바이트 배열은 `secret.beginEntry`가 끝나면 성공·실패와 관계없이 0으로 덮는다.
  - `add`의 `--desc`, `--scope`, `--expires`, `--hosts`는 값을 저장한 뒤 `secret.meta`로 적용한다. `--hosts`는 기존 사용 정책을 `secret.list { meta: true }`로 읽어 `hosts`만 바꾼다. 메타 적용이 실패하면 값은 저장된 상태라고 알린다. `--provider`는 `sops`만 받는다(wire에 제공자 선택이 없다). `secret meta`는 플래그가 하나도 없으면 2다.
  - `rm`은 먼저 `secret.references { name }`로 이 비밀을 가리키는 곳을 읽는다 [결정: m2c G1-07]. `--yes` 없이 비TTY면 2다.
    - `--yes`가 없으면 `secret.list { meta: true }`의 사용 정책(허용 도구·호스트)과 `<이름>: 참조하는 설정 키 <키…> / 활성 lease <n>개 / 최근 사용한 세션 <id…>` 한 줄(없으면 `없음`, 세션은 5개까지, 나머지는 `외 <n>개`)을 보인 뒤 `[y/N]`로 묻는다.
    - 활성 lease가 하나라도 있으면 묻지 않고 "사용 중인 비밀이라 지울 수 없다 (활성 lease <n>개)"로 1로 끝낸다. `secret.remove`는 보내지 않는다.
    - `--yes`는 묻지 않고 지우되, 참조가 하나라도 있으면 같은 한 줄을 stderr에 남긴다. 활성 lease는 호스트가 거부하고(`secret.inUse`) CLI는 활성 lease 수를 보인다.
    - `host.hello`의 `features`에 `secret.references`가 없는 호스트에서는 사용 정책만 보인다.
  - 비밀 오류는 F 오류 표의 전용 kind(`secret.notFound`~`secret.writeFailed`, 3201~3212)로 온다. 전용 kind가 생기기 전의 호스트는 `internal`의 `details.secret.kind`에 실었으므로 CLI는 두 길을 같은 문구 표로 모은다. 문구와 종료 코드는 제공자·키 문제가 3, 나머지가 1이다. [결정: m2r sec] 같은 kind라도 원인별로 해결 줄을 나눈다: `provider_unavailable`은 `binary_missing`이면 "sops와 age를 설치", `version_too_old`면 버전을 올리라고, `not_registered`면 `l0.secrets.defaultProvider`와 `l0.secrets.sops.files`를 보라고 한다(SOPS 파일이 없는 것은 원인이 아니다: 기본 파일은 첫 `secret add`가 만든다, `L0.secrets.spec` §4.8). `key_unavailable`(`file`, `access_denied`)는 `l0.secrets.ageKey.source`를 `file`로 저장하라고 한다. `write_failed`는 `target`(`sops_file`, `key_store`, `key_file`)과 `code`를 문구에 싣고 `code`별로 고칠 곳을 말한다.
- `reveal` (구현): 확인 문구로 이름을 다시 입력받고(`tty-confirm`, `verifiedAt`은 엔진 시계) 열람 수단을 맡긴 뒤 `secret.beginReveal`을 보낸다. 값은 `show` 콜백에서 바이트 그대로 `stdoutStream`에 한 번 쓰고, 문자열로 바꾸지 않는다. `os-auth`는 L0.os가 제공하기 전까지 쓰지 않는다. 호스트가 `started: false`를 돌려주면(재확인 만료·취소) 값을 보이지 않고 1이다.
- 값 열람 [결정: review.decisions-2 U-20]: 열람 경로는 M2 CLI `xeon secret reveal <name>`과 M3 데스크톱 화면(`L4.settings-ui.spec`) 둘이다. 에이전트 경로(모델 도구, 확장 API)에는 열람이 없다.
  - [제안] `reveal`은 stdin과 stdout이 모두 TTY일 때만 동작한다. 아니면 `revealRequiresTty` 사용법 오류(2)다. `--json`을 받지 않는다.
  - [제안] 시작은 값 필드가 없는 `secret.beginReveal { name }`이다. 값 표시는 호스트 쪽 L0.secrets가 맡는다. in-process면 같은 프로세스가 TTY에 직접 쓰고, 서비스 접속이면 서비스 쪽 L0.secrets가 OS 창으로 보인다(`L4.settings-ui.spec` §4.6.4 C안과 같은 경로). 값은 wire 프레임, 로그, 이벤트에 없다.
  - [제안] OS 인증 재확인(macOS Touch ID·암호, Windows Hello 등)이 가능한 플랫폼에서는 표시 전에 재확인한다. 수단은 `L0.secrets.spec`·`L0.os.spec`이 정한다. 재확인을 못 하는 플랫폼에서는 TTY 확인 문구(이름을 다시 입력)만 받는다.
  - 열람은 감사 기록(`L0.secrets.spec`)에 남긴다. 기록에는 값이 없다.

#### 4.7.1 검색 provider 상태 출력

[제안] ADR-0005 ④의 첫 실행 권장 내용(`product.scope.spec` I10)을 CLI에서는 `xeon doctor`의 한 묶음으로 보인다. M3 데스크톱 첫 실행 화면은 `L4.settings-ui.spec`이 맡는다. 줄 1, 줄 3과 `웹 provider` 블록은 `web.providers`의 값을 `@xeon/client/web`의 `toolsWebViewOf`로 바꾼 view-model을 읽기만 한다(M3b B2-WEB, M3-12, M3-REQ-96).

- 줄 1: 검색 provider. `search` 행과 웹 설정 값에서 정한다.
  - 설정이 `auto`이면 `검색 provider: auto → <표시 이름> (<id>)`다. 표시 이름과 id는 다음 호출이 쓸 행(`current`)의 것이다. 자동 순서는 호스트가 `autoRank`로 정해 싣고 CLI는 다시 계산하지 않는다(`L2.web.spec` §4.8.2).
  - 설정이 provider를 고정했으면 `검색 provider: <id> (l2.web.search.provider로 고정)`다. 고정한 행을 쓸 수 없으면 ` — <문구>`를 더한다. 목록에 그 id가 없으면 ` — 목록에 없는 provider다`를 더한다 [결정: 오케스트레이터 기본값].
  - 자동인데 쓸 수 있는 행이 없으면 `검색 provider: auto → 쓸 수 있는 provider가 없다`다 [결정: 오케스트레이터 기본값].
  - 웹 provider 목록을 읽지 못했으면 `검색 provider: 알 수 없다 (엔진에서 provider 목록을 읽지 못했다)`다.
- 줄 2: 설정한 SearXNG 주소의 상태. 자동 감지는 없다 [결정: m2c H1, `L2.web.spec` §4.8.3]. 주소(`l2.web.search.searxng.url`)가 비어 있으면 어디에도 요청하지 않고 "주소를 설정하지 않았다"와 `xeon config set l2.web.search.searxng.url <주소>`를 보인다. 주소가 있으면 그 주소 하나만 탐침해 응답함, JSON 형식 꺼짐, 응답 없음 중 하나를 보인다. 응답이 없으면 검색이 내장 래퍼로 내려간다는 말을 덧붙인다.
- 줄 3: 키 플러그인 권장. Exa와 Brave(`plugin:web-exa`, `plugin:web-brave`, `L2.web.spec` §4.8)의 상태에서 만든다. 둘 다 쓸 수 있으면 `키 플러그인: Exa, Brave 모두 쓸 수 있다`다. 아니면 `권장 키 플러그인: ` 뒤에 쓸 수 없는 항목을 쉼표로 잇는다. 항목은 `<표시>(<상태> — <해결>)`이다 [결정: 오케스트레이터 기본값: 해결 문구를 항목 괄호 안에 둔다].
  - `needs-key`: `Exa(키 필요 — xeon secret add exa-api-key)`처럼 등록 명령 `xeon secret add <비밀 이름>`을 보인다.
  - `not-installed`(행이 없다): `Brave(설치 필요 — 플러그인을 설치한다)`.
  - `unavailable`: `Brave(사용 불가 — <사유 코드>)`.
  - 웹 provider 목록을 읽지 못했으면 `키 플러그인: 알 수 없다 (엔진에서 provider 목록을 읽지 못했다)`다.
- 값은 키 이름과 참조 문자열만 보인다. 비밀 값은 없다.
- 키 이름과 provider 목록의 정본은 `L2.web.spec`이다. 이 출력은 그 값을 읽기만 한다.
- 웹 provider 블록 [제안]: 줄 3 뒤에 `웹 provider` 머리 줄을 내고, 검색, 브라우즈, 가져오기 섹션의 모든 행을 이 순서로 한 줄씩 보인다. 각 섹션 안에서는 view-model의 순서다.
  - 줄 형식: `  <표시> <id>  <출처> · <능력> · <순위>[ · 현재][ · 고정] · <문구>[ · 첫 사용 고지 대기][ · 가격표 오래됨(<기준일>)]`
  - 표시: 쓸 수 있으면 `[ok]  `, 못 쓰면 `[경고]`.
  - 출처: `builtin`은 내장, `plugin`은 플러그인, `detected`는 사용자 설정.
  - 능력: `web.search`는 검색, `web.browse`는 브라우저, `web.fetch`는 가져오기.
  - 순위: `autoRank`에 1을 더한 `순위 N`. 순위가 없는 행(가져오기)은 `순위 없음`.
  - `현재`는 다음 호출이 쓸 행, `고정`은 설정이 고정한 행이다.
  - 문구는 view-model의 `note`다. 상세 문구(`detail`)는 출력하지 않는다.
  - `첫 사용 고지 대기`는 고지가 아직 나가지 않은 행이고, `가격표 오래됨`은 가격표 기준일이 오래된 행이다.
  - 행이 하나도 없으면 `  provider가 없다` 한 줄을 낸다 [결정: 오케스트레이터 기본값]. 웹 provider 목록을 읽지 못했으면 이 블록을 내지 않는다(줄 1과 줄 3이 알 수 없다고 말한다) [결정: 오케스트레이터 기본값].
- 출력 형식:

  ```text
  xeon doctor (xeon 0.0.0)
  진단
    [ok]   엔진을 열었다 (in-process). 세션 저장소와 FTS5를 쓸 수 있다
    [ok]   상태 디렉터리: <경로>
    [ok]   비밀 저장소: 사용할 수 있다 (등록 0개)
    [ok]   외부 바이너리 sops: 3.9.0 (시스템) — 비밀 저장소
    [경고] 외부 바이너리 bwrap: 없다 (선택) — 명령을 샌드박스 없이 실행하지 못한다
           해결: bubblewrap 패키지를 설치한다
    [참고] 서비스 모드: 사용 안 함 (in-process)
    [ok]   터미널: stdin TTY, stdout TTY, 100열, 색 사용
  검색 provider
    검색 provider: auto → Built-in search (model provider) (builtin-wrapper)
    SearXNG: 주소를 설정하지 않았다 (자동 감지는 하지 않는다) — 쓰려면: xeon config set l2.web.search.searxng.url <주소>
    권장 키 플러그인: Exa(키 필요 — xeon secret add exa-api-key), Brave(설치 필요 — 플러그인을 설치한다)
  웹 provider
    [ok]   builtin-wrapper  내장 · 검색 · 순위 1 · 현재 · 사용할 수 있다
    [경고] plugin:web-exa  플러그인 · 검색 · 순위 2 · 키가 없다 — 해결: xeon secret add exa-api-key · 첫 사용 고지 대기
    [ok]   playwright-mcp  플러그인 · 브라우저 · 순위 1 · 현재 · 사용할 수 있다
    [ok]   builtin-fetch  내장 · 가져오기 · 순위 없음 · 사용할 수 있다
  ```

  엔진을 열지 못하면 첫 항목이 `[실패] 엔진을 열 수 없다: <message>`와 해결 줄이 되고 종료 코드는 `EngineStartError` 표(§4.10)를 따른다. 터미널 항목과 검색 세 줄은 엔진 없이도 낸다. 이때 줄 1과 줄 3은 `알 수 없다`다. `--json`은 같은 내용을 `{ version, checks, binaries, search, web }` 문서 하나로 쓴다. `binaries`는 호스트가 준 `HostBinaryReport` 그대로이고 점검 결과가 없으면 `null`이다. `web`은 view-model `ToolsWebView`(검색, 브라우즈, 가져오기 섹션, 키 플러그인 권장, 첫 사용 고지가 남은 id)이고 웹 provider 목록을 읽지 못했으면 `null`이다. `web`의 행에는 view-model이 200자에서 자른 `detail`이 들어 있지만 텍스트 출력에는 없다.
- 구현 (임시 경로, §10 5번): 엔진에서 SearXNG 주소 키 `l2.web.search.searxng.url` 하나를 `settings.get`으로 읽는다. 웹 provider 목록은 `host.hello`의 `features`에 `web.providers`가 있을 때만 한 번 보내 받는다. 요청이 예상 가능한 실패로 끝나면 목록 없이 판정하고 원인은 줄로 내지 않는다 [결정: 오케스트레이터 기본값]. 예상 가능한 실패가 아닌 오류는 버그이므로 다시 던진다. 목록이나 주소 키가 없으면 `(엔진에서 검색 설정을 읽지 못해 기본 설정으로 판정했다)`를 덧붙인다. provider 고정 값과 순서는 `web.providers`의 `settings`가 준다. 옛 키 `l2.web.search.pluginOrder`는 없어졌으므로 읽지 않는다. 설정한 주소의 탐침은 L2.web.spec §4.8.3의 형식(`GET <base>/search?q=xeon&format=json&pageno=1`, 1.5초, 64 KiB, 403이면 `json-disabled`)을 CLI가 같은 값으로 가진다. L2.web의 provider 상태 조회가 조립 진입점으로 나오면 이 복제를 그쪽 조회로 바꾼다.
- 외부 바이너리 점검 [결정: m2c G2-07, `L4.host-service.spec` HS-69]: 엔진을 연 뒤 `host.status { includeBinaries: true }`를 한 번 보내 `binaries`를 받고 바이너리마다 항목 한 줄을 낸다. 점검은 바이너리마다 자식 프로세스를 띄우므로 doctor 말고 다른 명령은 요청하지 않는다.
  - `ok`는 `[ok]   외부 바이너리 <이름>: <버전> (번들|시스템) — <쓰는 곳>`이다.
  - `missing`, `too_old`, `unusable`은 `need`가 `required`이면 `[실패]`, `optional`이면 `[경고]`다. 해결 줄은 `missing`이면 호스트가 준 `hint`, `too_old`이면 필요한 버전 이상으로 올리라는 말, `unusable`이면 설치와 실행 권한을 확인하라는 말이다.
  - 보고서의 `ready`가 거짓(필수 바이너리를 쓸 수 없음)이면 종료 코드는 3(환경 문제)이다. 선택 바이너리만 빠졌으면 0이다. HS-69가 "종료코드 2 계열"이라 적은 자리는 CLI 종료 코드 표(§3.6)에서 환경 문제인 3으로 읽는다.
  - `host.hello`의 `features`에 `host.status`가 없거나 응답에 `binaries`가 없으면 "점검 결과를 알리지 않는다"를 `[참고]`로 한 줄 낸다. 점검 요청이 실패하면(`request.cancelled` 등) `[경고]` 한 줄로 알리고 doctor는 이어 간다. 키 플러그인 ID는 `plugin:web-exa`, `plugin:web-brave`(L2.web.spec §4.8)이고, 등록 여부는 `web.providers` 행의 상태가 준다(줄 3).
- 설정의 비밀 키(`secret: true`)는 `config get`이 참조 문자열(`secret://<name>`)이나 `null`만 보인다(F wire §4.9).

### 4.8 설정 명령과 세션 덮어쓰기

- 값 해석(`config set`, `--set`, `/set`): `raw`를 먼저 JSON으로 해석하고, 실패하면 문자열로 본다(F wire §4.11).
- 최종 판정은 host의 `settings.set`이다. host는 `checkSettingWrite`로 범위·잠금·값을 검사한다(F wire §3.9). CLI는 오류 `kind`를 §4.10 표의 문구로 바꾼다.
- [제안] 미리 검사: `config set`은 `settings.list`의 `SettingDefWire`로 같은 값을 먼저 검사해 왕복 없이 범위 오류를 알린다. 이때 `type`에 `range`를 병합한 스키마(F wire §4.10 3번 규칙)를 `typebox/schema`의 `Check`로 검사한다(`_research/notes/L4-3.md`). 잠금과 비밀 값 거부는 host만 판정한다. 병합 함수는 F에 공통으로 두자는 제안을 따른다 [미결 §10 4번]. M2 구현은 이 사전 검사를 하지 않고 호스트의 `settings.set` 판정과 오류 문구(§4.10)만 쓴다 [미결 §10 13번].
- `config get` 출력 형식(텍스트):

  ```text
  l1.loop.maxSteps = 50
    source: project (/repo/.xeon/settings.json)
    shadowed: user (~/.config/xeon/settings.json)
    pending: nextTurn
  l1.models.default = "provider/model"  [locked: managed]
  ```

  `--json`이면 `EffectiveSetting[]`를 그대로 한 JSON 문서로 쓴다. 텍스트와 JSON 모두 `settings.get` 결과의 `source`를 그대로 옮긴다(F wire §4.7 5번).
- `config set`의 `--scope session`은 받지 않는다. 세션 범위는 `--set`과 `/set`만 쓴다.
- `--set key=value`(M2): 대상 세션이 정해진 뒤 첫 `turn.start` 전에 `settings.set { key, value, scope: "session", threadId }`를 순서대로 부른다. 하나라도 실패하면 turn을 시작하지 않고 2로 끝낸다.

### 4.9 화면(TUI)

#### 4.9.1 라이브러리 비교

| 기준 | pi-tui (`@earendil-works/pi-tui`) | Ink | opentui | 최소 renderer(`node:readline` + ANSI) |
|---|---|---|---|---|
| 방식 | 컴포넌트 `render(width): string[]`, 차등 렌더링, CSI 2026 동기화 출력. main-screen과 alt-screen 렌더러 | React 컴포넌트와 reconciler | Solid 바인딩(opencode TUI, `_research/refs/opencode.md`) | 줄 단위 출력 + 입력 줄 편집 |
| `bun build --compile` | 순수 TS + 선택 `.node` 애드온. 애드온은 자동 포함되지 않고 없으면 폴백한다. pi가 Bun 1.3.14로 pi-tui를 넣은 바이너리를 릴리즈한다. Bun 1.4.3 실행은 [미확인](`_research/notes/L4-1.md` §0, §4, §5) | [미확인] 레이아웃 엔진(yoga)의 wasm 포함 방식 확인 필요 | [가정] 네이티브 코어를 FFI로 로드한다. compile 포함 방식 [미확인] | Bun 내장. 추가 의존 없음 |
| 기동 시간·메모리 | 의존 2개(`marked` 18.0.11, `get-east-asian-width` 1.6.0, `TUI/package.json`). 실측 없음 | React 런타임이 더해진다 [가정]. 실측 없음 | 실측 없음 | 가장 작다 [가정] |
| CJK 폭 | `get-east-asian-width`로 폭 계산, `visibleWidth`·`truncateToWidth`·`wrapTextWithAnsi` 제공 | [미확인] | [미확인] | 직접 구현(같은 `get-east-asian-width`를 쓸 수 있다) |
| IME 입력 | `Focusable` + `CURSOR_MARKER`로 하드웨어 커서를 놓아 후보 창 위치를 맞춘다. `showHardwareCursor` 옵션(README "Focusable Interface") | [미확인] | [미확인] | 터미널의 줄 편집과 커서를 그대로 쓰므로 IME 문제가 적다. 여러 줄 편집은 어렵다 |
| 설정 목록 컴포넌트 | `SettingsList`, `SelectList`, `Editor`, `Markdown`, `Loader` 내장 | 서드파티 컴포넌트 | 일부 내장 [가정] | 없음 |
| 유지 비용 | pi-ai·agent-core와 같은 릴리즈 묶음(1.3.0, 약 4분 안에 함께 배포). engines는 Node만 선언 | React 생태계. Hermes TUI 사례(`_research/refs/hermes.md` 12행). Claude Code 사례 [가정] | 신생 [가정] | 모든 위젯을 직접 만든다 |
| 라이선스 | MIT. 1.3.0 tarball에 LICENSE 파일이 없어 배포물에 고지를 함께 싣는다(`_research/notes/L4-1.md` §2) | MIT [가정] | MIT [가정] | Bun(MIT) |

- 참조 트리(`~/projects/_ref/pi-src/packages/tui/package.json`)는 1.1.0이고 npm `latest`는 1.3.0이다. 1.3.0은 pi-ai·agent-core 1.3.0과 같은 묶음이다. 그래서 참조 트리 1.1.0과 npm 1.3.0의 어긋남은 1.3.0을 고정하면 사라진다(`_research/notes/L4-1.md` §2).

#### 4.9.2 선택

- [결정: review.m2-plan §8 D10] 스파이크를 M2에 돌리고, 아래 조건을 통과할 때만 대화형 TUI에 pi-tui 1.3.0(정확 고정)을 쓴다. M2 종료 조건에는 넣지 않는다. 조건은 둘이다.
  1. 스파이크 통과: `_research/notes/L4-1.md` §7의 1번(애드온 없이 Bun 1.4.3 `--compile` 바이너리 시작·종료)과 6번(`process.execPath` 값)을 확인하고, 한글 입력(IME)과 CJK 폭을 macOS·Linux 터미널에서 확인한다(`L4.cli.plan` C8).
  2. 스택 표에 pi-tui 행을 더한다(`eng.toolchain.guide` TC-04). 사용자는 1번 통과를 조건으로 채택을 정했다(D10). 현재 `_research/foundation-plan.md` §2 스택 표에 TUI 행이 없다.
- [제안] 네이티브 애드온은 1차 배포에 넣지 않는다. 빠지는 기능은 Apple Terminal·Windows의 Shift+Enter 판별, Windows Shift+Tab 판별, 네이티브 클립보드뿐이다(`_research/notes/L4-1.md` §3.3). 사이드카 `native/` 디렉터리 배포 여부는 릴리즈 형태와 함께 정한다 [미결 §10 7번].
- [제안] 후퇴 경로: M1은 pi-tui 없이 통과한다. print 모드와 JSON 모드는 어떤 TUI 라이브러리도 쓰지 않는다. M1 대화형은 최소 renderer(`node:readline` 입력 + 줄 출력 + 진행 줄 한 줄 덮어쓰기)로 만든다. 스파이크가 실패하면 M2도 최소 renderer를 유지하고 TUI 라이브러리 선택을 [미결]로 둔다.
- 렌더러 교체가 쉽도록 화면 코드는 `RenderSink` 뒤에 둔다. `TranscriptState`와 `RenderOp`는 라이브러리와 무관하다.

#### 4.9.3 화면 구성(pi-tui 채택 시)

- `TuiMainScreen`을 쓴다. 터미널 스크롤백을 보존하기 위해서다. alt-screen은 쓰지 않는다 [제안].
- 위에서 아래로: 트랜스크립트(`Markdown`, `Text`), 진행 줄(`Loader`), 입력(`Editor`), 상태 줄(`l4.cli.statusLine` 세그먼트).
- 승인 프롬프트와 잠금 선택은 오버레이(`showOverlay`) 안의 `SelectList`로 보인다.

#### 4.9.4 설정 화면

- [결정: review.m3-design-inputs D-M3-30 행 3] TUI 안의 설정 화면(pi `/settings`, omp `/settings`에 해당)은 M3에 만들지 않는다. 설정은 `xeon config` 명령과 데스크톱 화면으로 바꾼다. 나중에 만들 수 있게 설정 view-model(탭 배치, 위젯 결정, 범위 배지)은 L4 공유 패키지 `packages/client`에 둔다 [결정: adr.0020].

### 4.10 오류 문구

모든 오류 출력은 두 줄이다: `xeon: <무엇이 잘못됐다>`와 `  해결: <한 줄>`. wire `message`(영어 개발자용)를 그대로 쓰지 않고 `kind`와 `details`로 만든다(F wire §3.5.1). 문구는 `packages/client`의 카탈로그 id(`cli.errors.*`)에서 현재 로케일로 만듭니다. `해결:` 머리말도 카탈로그(`cli.errors.fixLabel`)에서 읽습니다(ADR-0016). 인자 오류 문구(`cli.usage.*`, `parseArgv`가 돌려주는 `UsageError`), 도움말 본문(`cli.help.*`), `config list`의 정의 줄(`cli.config.*`), `version`과 `--set`의 문장도 같은 방식으로 호출할 때 현재 로케일에서 만듭니다. 예약(`schedule`)·세션(`sessions`)·그룹 만들기(`group new`)·대화(`chat`)의 문장, 슬래시 명령의 도움말과 문구도 같은 방식으로 호출할 때 현재 로케일에서 만듭니다(`cli.schedule.*`, `cli.sessions.*`, `cli.group.*`, `cli.chat.*`, `cli.slash.*`, `cli.usage.slash.*`). 렌더링 문장(`cli.render.approval.*`, `cli.render.lock.*`, `cli.render.notices.*`, `cli.render.textSink.*`, `cli.render.tools.*`, `cli.render.transcript.*`, `cli.render.trust.*`)과 최소 TUI 문장(`cli.tui.minimal.*`)도 같은 방식으로 호출할 때 현재 로케일에서 만듭니다. 그 밖의 명령과 상태 문장(`cli.doctor.*`, `cli.secret.*`, `cli.trust.*`, `cli.db.*`, `cli.state.*`, `cli.host.*`, `cli.threads.*`, `cli.overrides.*`)도 카탈로그 id입니다.

| kind | 문구 요지 | 해결 한 줄 | 종료 코드 |
|---|---|---|---|
| `thread.notFound` | 세션 `<id>`가 없다 | `xeon sessions ls`로 id를 확인한다 | 1 |
| `thread.locked` | 다른 프로세스(`ownerKind`)가 이 세션을 쓰고 있다 | M1: 끝날 때까지 두거나 새 세션을 연다. M2: 프롬프트(§4.11) | 4 |
| `thread.closed` | 닫힌 세션이라 쓸 수 없다 | `xeon sessions fork`로 분기하거나 새 세션을 연다 | 1 |
| `turn.busy` | 진행 중인 turn이 있다 | 끝난 뒤 다시 보낸다 | 1 |
| `thread.cancelledByExtension` | 확장이 `point`의 작업(컴팩션, 분기, 되감기, 세션 전환)을 막았다. `reason`이 있으면 붙인다 | 확장의 설정을 확인한다 | 1 |
| `thread.compactFailed` | 대화를 요약하지 못했다(`reason`) | 잠시 뒤 다시 `/compact`를 실행한다. 반복되면 `xeon doctor`를 실행하고 보고한다 | 1 |
| `request.cancelled` | 요청이 취소되었다 | 필요하면 다시 실행한다 | 1 |
| `settings.unknownKey` | 등록되지 않은 키 | `xeon config list`로 키를 확인한다 | 2 |
| `settings.invalidValue` | 값이 형식이나 범위에 맞지 않다(`issues` 첫 항목) | 허용 범위를 확인한다 | 2 |
| `settings.scopeNotAllowed` | 그 범위에 쓸 수 없는 키 | 허용 범위: `allowedScopes` | 2 |
| `settings.locked` | 관리 설정이 잠근 키 | 관리자에게 요청한다 | 1 |
| `settings.secretValue` | 비밀 키에는 참조만 쓸 수 있다 | `xeon secret add <name>` 뒤 `secret://<name>`을 쓴다 | 2 |
| `settings.reserved` | 아직 읽는 코드가 없는 예약 키다 | `xeon config list`로 쓸 수 있는 키를 확인한다 | 2 |
| `secret.*` | 비밀 오류별 문구(없음, 사용 중, 제공자·키 없음, 복호화 실패, 재확인 필요 등). 값은 싣지 않는다 | 오류별 한 줄(§4.7) | 제공자·키·쓰기 문제 3, 나머지 1 |
| `store.corrupt` | 저장된 데이터가 스키마와 다르다(`where`) | `xeon doctor`를 실행하고 보고한다. 복원하기 전에 데이터 디렉터리를 복사해 둔다 | 1 |
| `cap.dialog.commands.*` | 슬래시 명령 실패. `command_args_invalid`는 인자 선언과 다르다, `command_shell_disabled`는 셸 주입 설정이 꺼져 있다 | `/help`로 사용법을 확인한다. 셸 주입은 `l2.dialog.commands.shellInjection`을 확인한다 | 인자 오류 2, 나머지 1 |
| `protocol.unsupported` | CLI와 엔진의 계약 버전이 다르다 | 같은 버전의 바이너리를 쓰거나 서비스를 다시 띄운다 | 3 |
| `host.shuttingDown` | 엔진이 종료 중이다 | 잠시 뒤 다시 실행한다 | 1 |
| `internal` | 내부 오류(`traceId`) | `xeon doctor`를 실행하고 `traceId`를 보고한다 | 1 |
| `EngineStartError`(`catalogConflict`, `missingService`) | `message` | `fix` | 1 |
| `EngineStartError`(`invalidRemote`) | `--remote` 또는 설정 `l0.process.service.remote`의 주소 문법이 틀리다. 플래그 값은 보이고, 설정 값과 `@`가 든 값은 보이지 않는다 | `unix:/abs`, `tcp://host:port`, `ssh://[user@]host[:port]/abs/socket` 중 하나로 고친다 | 2 |
| `EngineStartError`(`serviceUnreachable`) | 서비스에 접속하지 못했다(소켓 없음, 거부, 권한, ssh 터널 실패, 토큰 불일치, 응답 없음). 원인별 문구는 §3.3 | 원인별 한 줄(§3.3) | 3 |
| `EngineStartError`(그 밖의 kind) | `message` | `fix` | 3 |
| `db export`, `dest_not_empty` | 내보낼 폴더가 비어 있지 않다. 아무것도 바꾸지 않았다 | 비어 있거나 없는 폴더를 지정한다 | 2 |
| `db export`, `foreign_database` | Xeon 데이터베이스가 아니다(`application_id`) | `XEON_HOME`으로 데이터 디렉터리를 확인하고 `xeon.db`가 다른 프로그램의 파일이면 옮긴다 | 3 |
| `db export`, `not_a_database` | 데이터베이스 파일이 없거나 SQLite 파일이 아니다 | `xeon chat`을 한 번 실행해 데이터베이스를 만든 뒤 다시 실행한다. 위치는 `XEON_HOME`으로 바꾼다 | 3 |
| `db export`, `busy` | 데이터베이스가 다른 쓰기로 바쁘다 | 잠시 뒤 다시 실행한다 | 3 |
| `db export`, `disk_full` | 저장 공간이 가득 찼다 | 디스크 공간을 비우고 다시 실행한다 | 3 |
| `db export`, `io`(`code`) | 내보내기 중 입출력 오류가 났다(`code`) | 대상 폴더와 데이터 디렉터리의 권한과 디스크 상태를 확인한다 | 3 |
| 데이터 디렉터리 위치를 정하지 못함(`db export`) | 데이터 디렉터리 위치를 정하지 못했다 | HOME(Windows는 USERPROFILE)과 XEON_HOME 설정을 확인한다 | 3 |

### 4.11 승인 요청과 잠금 프롬프트

- 승인(M2) [가정: F wire §4.6 A안]
  1. `approval.requested` 내구 이벤트가 오면 `ApprovalView`를 만들고 프롬프트를 연다. 선택지는 허용, 거부, 답(질문형일 때)이고 기억 범위는 이번만(`once`), 이 세션(`thread`), 항상(`always`)이다.
  2. 사용자의 선택을 `approval.respond { approvalId, decision, answer?, remember? }`로 보낸다.
  3. `approval.resolved` 이벤트가 오면 프롬프트를 닫는다. 다른 클라이언트가 먼저 답한 경우도 같다.
  4. print 모드는 프롬프트를 열 수 없으므로 답을 자동으로 보내고 승인마다 stderr에 한 줄 알린다. 기본(플래그 없음)은 모든 승인에 `decision: "deny"`로 답한다(`createAutoDeny`). 엔진은 사전 허용 규칙(`l1.tools.rules`, L1.tools 정책)을 승인 요청 전에 적용하므로, CLI가 받는 `approval.requested`는 사전 허용되지 않은 요청이다. 그래서 기본 모드는 사전 허용 규칙만 적용하고 나머지는 거부한다 [결정: review.m3-design-inputs D-M3-14 c](§10 8번).
     - `--auto-approve`는 옵션이다 [결정: 오케스트레이터 기본값, M3b B1-SCH]. 도구 승인(`form.kind === "tool"`)만 `{ decision: "allow" }`로 한 번 허용한다. `remember`는 보내지 않는다(호스트가 `once`로 본다). 승인마다 stderr에 `승인 요청 "<제목>"을 --auto-approve로 허용했다`를 쓴다. 응답이 적용되지 않았으면 이유를 붙이고, 응답 수단이 없으면 그 사실을 붙인다(`createAutoAllow`).
     - 질문, 계획, 검토 승인은 사람이 답해야 하므로 이 플래그로도 거부한다. 거부 알림은 기본과 같다. 자동 응답은 사람의 답(질문 번호, 수정 요청 내용)을 대신하지 않는다.
     - 알림에는 승인 제목만 쓴다. 본문(명령, 인자, `secret://` 핸들)은 쓰지 않는다.
  5. payload 모양은 `L1.tools.spec` 소관이다. CLI는 제목·본문·질문 여부만 읽는다.
  6. 구현 (대화형 줄 입력): 요청 payload의 `remember`가 허용하는 범위만 보인다.
     - 도구: `[y]` 이번만 허용, `[t]` 이 세션 동안 허용(`thread`가 있을 때), `[a]` 항상 허용(`always`가 있을 때), `[n]` 거부. `n` 뒤에 이유를 받아 있으면 `answer: { feedback }`으로 보낸다.
     - 계획: `[y]` 승인이면 `nextModes` 중 하나(엔터는 지금 모드)와 메모를 받아 `answer: { mode?, note? }`로 보낸다. `[n]`은 도구와 같다.
     - 검토(`review`, ADR-0018): 카드는 제목, 라운드, 파일별 변경 종류와 hunk 수 요약만 보인다(hunk 본문은 요청에 없다). 프롬프트는 `[y] 모두 승인  [r] 일부 거절  [c] 수정 요청  [n] 모두 거절`이다. 그 밖의 입력은 `y, r, c, n 중 하나를 입력한다`를 보이고 다시 묻는다.
       - `[y]` 모두 승인은 `decision: "answer"`와 `ReviewAnswer { decisions: [], comments: [], submit: true, approveRemaining: true }`로 보낸다.
       - `[r]` 일부 거절은 `거절할 hunk (쉼표로 구분, 예 f0h1,f1h0 / all = 전부) > `를 한 번 더 묻는다. hunk id는 카드의 파일 순서대로 `f<파일 순번>h<hunk 순번>`이고 둘 다 0부터 센다. `all`은 카드가 보인 hunk id 전부다. 목록에 없는 id는 `알 수 없는 hunk: <id>`를, 빈 입력은 `알 수 없는 hunk: (비어 있음)`을 보이고 검토 프롬프트로 돌아간다. hunk가 하나도 없는 카드에서는 `[r]`을 받지 않고 `거절할 hunk가 없다`를 보인 뒤 검토 프롬프트로 돌아간다. 고른 id는 `rejected`로, 나머지는 승인하고 제출한다: `decision: "answer"`와 `ReviewAnswer { decisions: [{ hunkId, decision: "rejected" }, …], comments: [], submit: true, approveRemaining: true }`로 보낸다.
       - `[c]` 수정 요청은 내용(필수)을 받아 `ReviewAnswer { decisions: [], comments: [{ target: { type: "review" }, body }], submit: false }`로 보낸다. 제출하지 않으므로 같은 라운드의 새 승인 요청이 카드로 다시 온다.
       - `[n]` 모두 거절은 도구의 `[n]`과 같다. 이유를 받아 `decision: "deny"`로 보낸다. 호스트는 되돌릴 수 있는 hunk를 모두 거절하고 제출하며, 이유는 리뷰 단위 코멘트가 된다.
     - 질문: 질문마다 번호(여러 선택이면 쉼표)나 직접 입력(`allowFreeText`)을 받아 `decision: "answer"`와 `QuestionAnswer`(`{ [질문 id]: { selected, text? } }`)로 보낸다. `/deny`는 요청 전체를 거부한다.
     - 프롬프트는 한 번에 하나다. 입력 줄이 읽는 중에 승인이 오면 입력 줄을 닫고 승인을 먼저 묻는다.
     - 세션을 열 때 이전 기록을 다 그린 뒤 `approval.list { threadId }`로 아직 답하지 않은 승인을 되살려 묻는다(재시작 뒤 복원). 이벤트로 이미 받은 승인은 `approvalId`로 중복을 거른다.
     - `approval.resolved`가 먼저 오면 "다른 곳에서 이미 답한 승인이다"를 보이고 프롬프트를 닫는다.
     - `approval.respond`가 `applied: false`이면 `reason`에 따라 처리를 나눈다 [결정: m2c G2-10]. `answer_invalid`는 `detail`을 보이고 같은 질문을 다시 묻는다(요청이 아직 대기 중이다). `commit_failed`는 "승인 응답을 기록하지 못했다"를 알리고 다시 묻는다. 두 이유로 3번 적용되지 않으면 이 승인을 대기로 남기고 포기한다(재시작 뒤 `approval.list`가 다시 묻는다). `already_resolved`와 이유를 알리지 않는 호스트는 "다른 곳에서 이미 답한 승인이다", `unknown_approval`은 "host가 모르는 승인이다. 재시작으로 사라졌을 수 있다"를 보이고 프롬프트를 닫는다. print 모드의 자동 거부가 적용되지 않으면 이유를 stderr에 남긴다.
  7. 동의 표시 [결정: m2c G2-10. 요건의 정본은 `L1.tools.spec`이고 CLI는 아래를 보인다]: 사용자가 허용하는 것이 무엇인지 카드에서 알 수 있어야 한다.
     - 도구 카드는 인자 요약(120자) 아래에 실행할 `command` 전체(40줄까지, 넘으면 "…(n줄 생략)")와 `secretEnv`의 비밀 핸들(`이름=secret://…`)을 보인다. 승인이 비밀 사용의 증거라서 명령과 핸들을 보고 허용해야 한다. `secret://` 참조 모양이 아닌 값은 값을 보이지 않고 "(참조 형식이 올바르지 않음)"만 쓴다. 인자가 BlobRef면 상세 줄이 없다.
     - 요청 주체(`origin.caller`)가 `main`이 아니면 첫 줄에 보인다: `background`는 백그라운드 작업, `host`는 호스트, `subagent:<이름>`은 서브에이전트, `ext:<이름>`은 확장이다.
     - `expiresAt`이 있으면 "만료: <ISO 시각> (그때까지 답하지 않으면 거부로 처리한다)"를 보인다. `onExpire`가 `answer`면 "정해 둔 답으로 처리한다"다.
     - `approval.resolved`의 `requestedRemember`와 적용한 `remember`가 다르면(2차 전에는 `always`가 `thread`로 낮춰진다) "항상 허용을 골랐지만 이 세션 동안 허용으로 낮춰 적용했다"를 보인다. `resolvedBy`가 `user`가 아니면(`expired`, `noninteractive`, `cancelled`, `superseded`) 이유를 한 줄로 보인다. 사용자가 직접 답했고 요청한 범위 그대로면 아무것도 보이지 않는다.
- 프로젝트 신뢰(M2) [결정: m2c G1-03. wire 이름은 F wire §3.3.1 trust를 따른다]
  1. 대화형 `chat`은 세션을 만들거나 열기 전에 `trust.get { workspace }`를 부른다. `required`가 참이고 `verdict`가 `undecided`일 때만 카드를 보인다. 이미 정한 폴더나 신뢰할 자원이 없는 폴더(`notRequired`)는 묻지 않는다.
  2. 카드는 프로젝트 폴더, 불러오려는 자원(`resources`), 판정과 출처(`via`), 신뢰하면 자원의 지시문·명령·MCP 서버가 사용자 권한으로 쓰인다는 경고, 번호가 붙은 선택지다. 선택지 글은 CLI가 `choice`(`kind` × `verdict`)로 만든다. `label`은 현지화 식별자라 글로 쓰지 않는다. 저장되는 폴더(`savedPath`)가 있으면 함께 보인다.
  3. 번호를 입력하면 `trust.decide { workspace, choice }`를 보낸다. 엔터나 EOF는 "나중에"라서 아무것도 보내지 않고, 이 프로젝트의 자원은 읽지 않는다는 한 줄을 stderr에 남긴다(fail-closed). 잘못된 번호는 다시 묻는다.
  4. `trust.get`이나 `trust.decide`가 실패하면 한 줄로 알리고 대화는 계속한다. 프로젝트는 신뢰하지 않은 채로 열린다. 저장 실패(`store.io`, `details.code: "trust_store"`)는 전용 문구와 종료 코드 3 문구를 쓴다. `trust.json` 쓰기의 프로세스 간 잠금은 host가 맡는다(`fileLock`).
  5. print 모드는 물을 수 없다. 결정이 없으면 stderr에 "프로젝트 신뢰가 정해지지 않아 <자원>을(를) 읽지 않는다 (xeon trust로 정한다)"를 한 줄 남긴다. JSON 모드는 메시지 열이 출력 전부라서(AC4) `trust.get`을 부르지 않는다.
  6. `host.hello`의 `features`에 `trust.get`과 `trust.decide`가 없는 호스트에서 `chat`은 조용히 지나가고, `xeon trust`는 환경 문제(3)로 알린다.
- 잠금(M2): `thread.locked` 오류의 `details.options`(`observe`, `fork`, `delegate`) 중 가능한 것만 보인다.
  - 관찰: `thread.open { mode: "observe" }` 뒤 구독만 한다. 입력란을 잠근다.
  - 분기: `thread.fork { threadId }`로 새 세션을 만들어 연다.
  - 위임: 서비스 전송일 때만 보인다. 소유자에게 입력을 보내는 클라이언트가 된다(adr.0006 §3.6 규칙 3).
  - 아무것도 고르지 않으면 4로 끝낸다. M1은 프롬프트 없이 4다.
  - 구현: 열기(`thread.open { mode: "write" }`)에서 3002를 받으면 묻는다. 글자는 `[o]` 관찰, `[f]` 분기, `[d]` 위임, 엔터는 취소다. 위임은 전송이 `socket`일 때만 보이고 M2에는 서비스 접속이 없어 나오지 않는다. 관찰로 열면 입력 줄은 남아 있되 보낸 줄에는 "관찰 전용이라 입력을 보낼 수 없다"를 알린다. 분기하면 새 id를 `thread.open { mode: "write" }`로 열어 이어 간다. print 모드는 묻지 않고 4다.

### 4.12 슬래시 명령

- 슬래시 명령은 설정 정의에서 만든다 [제안].
  - `/set <key> <value>`: `settings.list` 결과 중 `allowedScopes`에 `session`이 있는 키만 자동 완성에 넣는다. 실행은 `settings.set { scope: "session", threadId }`.
  - `/model [<값>]`: 모델 선택 키의 별칭이다. 값이 없으면 그 키의 `range.enum`으로 목록을 보인다. 키 이름은 `L1.models.spec`이 정한다 [가정: 아직 이름이 정해지지 않았다].
  - `/resume [<번호|id>]`: `thread.list`로 이 작업 폴더의 목록을 보이고 고른 세션으로 바꾼다(M2). 바꿀 때 이전 세션의 구독을 해제하고(`events.unsubscribe`) 새 세션을 같은 연결에서 연다. 잠금이면 §4.11의 프롬프트가 뜬다. 바꾸지 못하면 이전 세션을 다시 연다.
  - `/rename <제목>`: 지금 세션의 제목을 `thread.rename { threadId, title }`로 바꾼다 [결정: m2c G2-12]. 제목이 비었거나 200자를 넘으면 보내지 않고 사용법을 알린다.
  - `/compact [<지침>]`: 지금 세션의 대화를 요약해 줄인다 [결정: m2c G2-01]. `thread.compact { threadId, instructions? }`를 한 번 보낸다. `<지침>`은 `/compact` 뒤의 나머지 줄이고 없으면 `instructions`를 싣지 않는다. 쓰기 소유는 호스트가 암묵으로 얻는다(`L4.host-service.spec` HS-77).
    - `compacted`면 `대화를 요약했다 (요약 전 약 <tokensBefore> 토큰)`을 쓴다. 요약 내용을 확장이 냈으면(`fromExtension`) `, 요약 확장 <이름>`을 덧붙인다.
    - `skipped`는 오류가 아니다. `why`별로 한 줄을 stdout에 쓴다: `nothing_to_summarize`는 "요약할 내용이 아직 없다", `last_entry_is_compaction`은 "방금 요약했다. 새 대화가 쌓인 뒤에 다시 요약한다", `disabled`는 "이 엔진은 컴팩션을 쓸 수 없게 조립되어 있다".
    - 실패는 `thread.cancelledByExtension`(확장이 막음, 3006), `thread.compactFailed`(요약 또는 커밋 실패, 3008), `turn.busy`(진행 중인 turn, 3003), `thread.closed`(3007), `request.cancelled`로 온다. 문구는 §4.10 표다. 입력은 이어 받는다.
    - `host.hello`의 `features`에 `thread.compact`가 없는 호스트에서는 부르지 않고 "이 엔진은 수동 컴팩션을 처리하지 않는다"를 알린다.
    - 이름이 같은 엔진 명령이 있어도 내장이 앞선다. `/help`와 Tab 완성에 보인다. 자동 컴팩션(`threshold`, `overflow`)은 루프가 하고 CLI는 관여하지 않는다.
  - `/help`, `/quit`: CLI 내장.
  - 엔진 명령 [결정: m2c G1-01]: 내장도 별칭도 아닌 이름은 줄 전체를 `command.run { threadId, text }`에 그대로 넘긴다. `/plan`, `/tasks`, `/goal`처럼 L2·L3 코드가 등록한 동작 명령이 여기서 실행된다. 이름이 겹치면 내장과 별칭이 앞선다.
    - 결과 `done`은 `message`를 stdout에 쓴다. `message`가 `null`이고 `result`가 `null`이 아니면 `result`를 들여쓴 JSON으로 쓴다. 동작 명령은 turn을 만들지 않는다.
    - 결과 `expanded`는 템플릿을 펼친 최종 텍스트다. 사용자가 그 텍스트를 친 것처럼 `turn.start`로 보낸다(`command.run`은 turn을 만들지 않는다).
    - 결과 `needs_confirmation`은 셸 주입이 있는 템플릿이다. 실행할 셸 명령을 보이고 `[y/N]`로 묻는다. `y`면 `confirmShell: true`로 한 번 더 부르고, 그 밖의 입력은 "실행하지 않았다"를 알리고 끝낸다.
    - 결과 `not_command`는 모르는 슬래시 명령으로 처리한다.
    - 실패는 능력 오류(`cap.dialog.commands.*`)와 `thread.notFound`로 온다. 문구는 §4.10 표다.
    - `/help`는 `command.list`가 알려 준 명령을 "엔진 명령" 아래에 보인다. Tab 완성은 명령 이름과 첫 인자의 `choices`를 쓴다. 목록은 `command.list { threadId }`로 읽는다 [결정: m2c G1-01]. 호스트가 프로젝트 명령(`.xeon/commands`)을 그 세션의 작업 폴더 기준으로 읽게 하려는 것이다. 대화형을 시작할 때 한 번 읽고, `/resume`으로 세션을 바꾸면 새 세션의 id로 다시 읽는다.
    - `host.hello`의 `features`에 `command.run`이 없는 호스트에서는 부르지 않고 모르는 명령으로 처리한다.
- 별칭 표는 `src/slash.ts`의 상수 하나에 둔다. 키 이름이 없는 별칭은 등록하지 않는다. 현재 별칭은 `/model` → `l1.models.default` 하나다.
- Tab 완성: `/set ` 뒤는 session 범위를 허용하는 키, 줄 첫 단어는 슬래시 이름이다. 키 목록은 대화형을 시작할 때 `settings.list`로 한 번 읽는다.
- 실패한 슬래시 명령(없는 키, 허용되지 않은 범위)은 두 줄 오류를 stderr에 쓰고 입력을 이어 받는다.
- 확장이 슬래시 명령을 더하는 경로(L2-e 프롬프트 템플릿)는 등록 쪽이 엔진 안이라 이 문서에 두지 않는다. 클라이언트는 위의 `command.list`와 `command.run`만 부른다.

### 4.13 DB 내보내기 (`db export`)

`xeon db export <폴더>`는 저장소 파일을 `<폴더>`에 내보냅니다. 엔진을 띄우지 않고, 내보내기는 `L0.store.spec` §4.10의 `exportDatabase`가 합니다. 복구와 보관에 쓰는 명령입니다.

- 원본: 데이터 디렉터리(`OsDirs.data`)의 `xeon.db`입니다. 위치는 호스트와 같은 `resolveOsDirs`가 정하므로 `XEON_HOME`이 적용됩니다. 엔진이 이 파일을 열고 있어도 됩니다. 원본은 읽기 전용으로만 열고 아무것도 쓰지 않습니다.
- 대상: `<폴더>`가 없으면 만듭니다. 있으면 비어 있어야 합니다. 비어 있지 않으면 `dest_not_empty`로 끝나고(종료 코드 2) 아무것도 바꾸지 않습니다. 상대 경로는 작업 폴더(`-C`, 없으면 현재 폴더) 기준입니다.
- 사람용 출력(stdout): `exported <N> blobs to <절대 경로>` 한 줄입니다.
- 누락 블롭: `missingBlobs`의 sha256마다 stderr에 `경고: 블롭 파일이 없어 빠졌다: <sha256>` 한 줄을 씁니다. 열 줄을 넘으면 앞의 열 줄만 쓰고, `경고: 나머지 <M>개도 빠졌다 (전체 <K>개, manifest.json의 missingBlobs)` 한 줄로 개수를 알립니다. 누락 블롭이 있어도 내보내기는 성공이고 종료 코드는 0입니다. 사본에는 복사된 블롭만 있습니다.
- `--json`: `ExportReport`(`destDir`, `exportedAt`, `blobCount`, `missingBlobs`)를 JSON 문서 하나로 stdout에 씁니다. 이 경우 누락 블롭 경고는 stderr에 쓰지 않습니다.
- 오류: 문구와 종료 코드는 §4.10 표를 따릅니다. 실패하면 `exportDatabase`가 이 호출로 만든 파일과 디렉터리만 지웁니다.
- 사본을 열 때는 `openStore`를 씁니다. 다른 Xeon 버전이 만든 파일도 내보내집니다. 사본을 데이터 디렉터리로 되돌리는 절차는 이 명령이 하지 않고 M3 복구 런북(`review.m3-plan` M3-25)이 정합니다.

예:

```
$ xeon db export ~/backup/xeon-2026-10-29
exported 3 blobs to /home/user/backup/xeon-2026-10-29
$ xeon db export ~/backup/xeon-2026-10-29 --json
{
  "destDir": "/home/user/backup/xeon-2026-10-29",
  "exportedAt": 1767571200000,
  "blobCount": 3,
  "missingBlobs": []
}
$ xeon db export ~/backup/xeon-2026-10-29
xeon: 내보낼 폴더가 비어 있지 않다 (아무것도 바꾸지 않았다)
  해결: 비어 있거나 없는 폴더를 지정한다
$ echo $?
2
```

[미결] `xeon.db`라는 이름과 데이터 디렉터리 위치는 `apps/host`의 `DB_FILE_NAME`과 `os.dirs.data`에서 옵니다. 호스트가 이 이름을 공개 API로 내보내기 전까지 `apps/cli/src/commands/db.ts`가 같은 이름을 한 번 더 적습니다(§10 18번).

### 4.14 예약 명령

[결정: 오케스트레이터 기본값, M3b B1-SCH2] 예약 명령은 `schedule.create`, `schedule.list`, `schedule.cancel`, `schedule.fire`를 한 번씩 부르고 결과를 문구로 옮긴다. 저장과 실행은 host가 한다(`L2.schedule.spec` §4.4.9).

- 트리거 플래그는 `--every`, `--at`, `--remote`, `--watch`, `--loop` 가운데 정확히 하나다. 없거나 둘 이상이면 사용법 오류(2)다. `--debounce`는 `--watch`와, `--max-iterations`와 `--expires-in`은 `--loop`와만 쓴다. `--loop`는 두 상한을 함께 받는다. 상한 없는 루프는 만들 수 없다(`L2.schedule.spec` §4.1.2).
- 프롬프트는 위치 인자 낱말을 공백 하나로 이어 붙이고 앞뒤 공백을 뗀다. 비어 있으면 사용법 오류다. `--` 뒤의 낱말은 플래그로 읽지 않는다.
- 값 검사는 파서가 한다. `--every`는 1~31536000 정수 초다. 300초 미만은 파서가 막지 않고 host가 `interval_too_short`로 거부한다. `--loop <초>`는 0~31536000, `--max-iterations`는 1~10000, `--expires-in`은 1~31536000 정수 초다 [결정: 오케스트레이터 기본값]. `--at`은 `Date.parse`가 읽는 시각이다. 1970년 이전이거나 읽지 못하면 사용법 오류다. `--watch`는 쉼표로 나눈 경로 1~16개이고 빈 항목이 없어야 한다. `--debounce`는 0~3600000 ms이고 기본은 1000 ms다.
- 파서는 시계를 읽지 않는다. runner가 `--expires-in`을 `expiresAtMs`(지금 시각 + n초)로 바꾼다. 시계는 명령 문맥의 `deps.clock`이다. 상대 경로인 `--watch` 항목과 `--workspace`는 작업 폴더 기준 절대 경로로 바꿔 보낸다. `--workspace`를 빼면 `workspace`를 보내지 않아 host의 기본 작업 폴더를 쓴다 [결정: 오케스트레이터 기본값]. `--title`은 앞뒤 공백을 뗀 뒤 1~200자다. `--disabled`는 `enabled: false`를 보내고, 빼면 `enabled`를 보내지 않는다(host 기본은 켜짐).
- `add`의 결과 줄은 `예약했다: <id>  <트리거>  다음 실행 <ISO|없음>`이다. 트리거 요약은 `간격 300초`, `시각 <ISO>`, `감시 <경로들> (디바운스 <ms>ms)`, `원격`, `루프 <초>초 간격, 최대 <n>회, 만료 <ISO>` 가운데 하나다. `warnings`에 `service_mode_off`가 있으면 그 뒤에 stderr로 `경고: 서비스 모드가 꺼져 있어 이 예약은 실행되지 않는다. xeon service start로 서비스를 띄운 뒤에 실행된다` 한 줄을 쓴다. 종료 코드는 0이다. CLI는 서비스를 띄우지 않는다.
- `list`는 기본으로 `{ enabled: true }`를, `--all`이면 `{}`를 보낸다. 항목마다 한 줄이고 형식은 `<id>  <on|off>  <트리거>  다음 <ISO|->  마지막 <status>/<outcome|-> <claimedAt ISO>  <제목 또는 프롬프트 앞 40자>`다. 실행 기록이 없으면 `마지막 없음`이다. 제목이 없으면 프롬프트를 쓴다. 줄바꿈과 연속 공백은 한 칸으로 줄인다. `--json`은 항목 배열을 들여쓰기 두 칸으로 쓴다. 항목이 없으면 stderr에 `예약이 없다`를 쓴다. `--json`은 그때도 `[]`를 stdout에 쓴다.
- `cancel`은 `껐다: <id>`를, `run`은 `실행했다: <id>  run <runId>  <status>`를 쓴다. `run`의 status는 응답을 만든 시점의 기록이다. 원격 예약의 턴은 그 뒤에 끝난다.
- `ok: false` 값은 아래 표의 문구와 종료 코드로 바꾼다. host가 준 메시지 원문은 문구에 싣지 않는다.

| kind | 문구 | 해결 | 종료 코드 |
|---|---|---|---|
| `interval_too_short` | 간격이 최소값(`minSeconds`초)보다 짧다 | `--every`를 최소값 이상으로 쓴다 | 1 |
| `at_in_past` | 시각이 이미 지났다 | `--at`에 앞으로의 시각을 쓴다 | 1 |
| `invalid_trigger` | 트리거 값이 엔진 규칙에 맞지 않다 (`reason`) | `xeon help schedule`로 트리거 규칙을 확인한다 | 1 |
| `limit_reached` | 켜진 예약이 상한(`max`개)이라 더 만들 수 없다 | `xeon schedule list`로 보고 필요 없는 것은 `cancel`로 끈다 | 1 |
| `not_found` | 그런 예약이 없다 | `xeon schedule list --all`로 id를 확인한다 | 1 |
| `not_remote` | 원격 트리거 예약만 지금 실행할 수 있다 | 간격·시각 예약은 기한이 되면 실행된다. 원격 예약은 `--remote`로 만든다 | 1 |
| `disabled` | 꺼진 예약이라 실행하지 않는다 | `xeon schedule add`로 새 예약을 만든다 | 1 |
| `store_failed` | 예약 상태 파일을 읽거나 쓰지 못했다 | 상태 디렉터리의 `schedule/state.json`을 고치거나 지운다. 지우면 예약이 모두 사라진다 | 3 |

- `store_failed`의 해결 문구가 말하는 파일은 host의 상태 디렉터리 아래 `schedule/state.json`이다(`L2.schedule.spec` §4.4.9). host는 읽지 못한 파일을 빈 상태로 덮어 쓰지 않는다.
- host가 `schedule.*` 메서드를 알리지 않으면(`host.hello`의 `features`에 없으면) 네 명령 모두 환경 문제(3)로 끝난다. 문구는 "연결한 host가 예약 명령을 아직 지원하지 않는다"다.
- `--auto-approve`는 예약 명령에 없다. 알 수 없는 플래그(2)다.
- 명령 뒤의 `--remote`는 트리거 플래그다. 원격 서비스 주소는 명령 앞에 `xeon --remote <주소> schedule …`로 쓴다(§3.1 공통 플래그). 명령 앞의 `--remote`는 그대로 공통 플래그다.
- 예약 id는 `sch_`로 시작하는 영숫자다. 형식이 맞지 않으면 엔진에 보내지 않고 사용법 오류(2, `invalidScheduleId`)다.

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| FTS5가 없는 SQLite(macOS 시스템 SQLite) | `@xeon/host`가 `AssembleError { code: "store" }`를 던지고 `connectEngine`이 `fts5Missing`으로 바꾼다. 3으로 끝내고 해결 한 줄을 보인다(`eng.toolchain.guide` TC-11). 운영 처리(시작 거부 또는 검색 비활성)는 `L0.store.spec` 결정을 따른다 |
| sops·age가 없다 | 비밀이 필요한 명령에서만 `sopsMissing`, 3. `chat`은 비밀 참조를 쓰는 도구 호출이 실패로 기록될 뿐 시작은 한다 [제안] |
| 강제 종료(SIGKILL) 뒤 `--continue` | 저장된 위치부터 구독한다. 엔진이 열 때 쓴 복구 기록과 새 turn이 이어진다(§4.4) |
| 상태 파일이 깨졌다 | 버리고 진단 한 줄을 stderr에 쓴다. `--continue`는 1 |
| `events.batch`의 `from`이 기대와 다르다 | 마지막 `to`부터 다시 구독한다(F wire §4.5) |
| 휘발 조각이 순서 없이 온다 | `n`과 `afterSeq`로 정렬·지연한다. 내구 기록이 오면 버린다 |
| stdin이 1 MiB를 넘는다 | 2. "입력이 1 MiB를 넘는다", 해결: 파일을 도구로 읽게 한다 |
| 터미널 폭이 매우 좁다(20열 미만) | 대화형은 상태 줄을 숨기고 트랜스크립트만 그린다 |
| `--json`과 `sessions rm` 확인 | `--yes` 없이 비TTY면 2 |
| 서비스 소켓이 사라졌다 | `HostConnection.closed`가 끝난다. CLI는 진행을 멈추고 "엔진 연결이 끊겼다", 해결 `xeon service status`, 1 |
| 계약 버전 불일치(서비스가 옛 버전) | adr.0006 §3.7 3번 규칙(한가하면 재기동, 작업 중이면 경고)은 `ensureService`가 한다(`L4.host-service.spec` SV-03). 끝까지 맞지 않으면 `protocolUnsupported`, 3 |
| 출력 파이프가 닫혔다(`| head`) | 출력을 멈추고 종료 요청, 0 [제안] |
| `--remote` 주소 문법이 틀리다 | 엔진을 열지 않고 `invalidRemote`, 2. 로컬로 가지 않는다(HS-87) |
| 원격 서비스의 ssh 터널이 열리지 않는다 | `serviceUnreachable`, 3. ssh 출력의 첫 줄을 문구에 싣는다 [제안] |
| `host --stdio`의 원격 연결이 끊겼다 | 종료 코드 1(HS-89). stdin이 닫히면 0이다 |
| 예약 상태 파일이 깨졌거나 쓸 수 없다 | `store_failed`, 3. 해결: 상태 디렉터리의 `schedule/state.json`을 고치거나 지운다(§4.14). 읽지 못한 파일은 덮어 쓰지 않는다 |
| 서비스 모드가 꺼진 채 예약을 만들었다 | 예약은 저장되고 stderr에 경고 한 줄이 나온다. 종료 코드는 0이다. 실행은 `xeon service start` 뒤에 한다(§4.14) |

## 6. 설정 노출

`defineSettings("l4.cli", …)`로 선언하고 §3.3 `settingGroups`로 등록한다. 열은 `F.wire-settings.spec` §6의 열이다.

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | ui.tab | secret |
|---|---|---|---|---|---|---|---|
| `l4.cli.theme` | `Type.String()` | `"system"` | `enum: ["system", "dark", "light"]` | `live` | managed, user, local, session | appearance(select) | 아니오 |
| `l4.cli.statusLine` | `Type.Array(Type.Union([Type.Literal("model"), Type.Literal("thinking"), Type.Literal("tokens"), Type.Literal("cost"), Type.Literal("cwd"), Type.Literal("session"), Type.Literal("transport")]), { uniqueItems: true, maxItems: 7 })` | `["model", "cwd", "session"]` | 없음 | `live` | managed, user, local | appearance(list) | 아니오 |
| `l4.cli.keybindingsFile` | `Type.Union([Type.String({ minLength: 1, maxLength: 4096 }), Type.Null()])` | `null`(기본 위치) | 없음 | `restart` | managed, user | appearance(text) | 아니오 |
| `l4.cli.outputMode` | `Type.String()` | `"text"` | `enum: ["text", "json"]` | `live` | managed, user, project, local, session | appearance(select) | 아니오 |

- [제안] 네 키 모두 탭은 `appearance`다. 표시 설정의 소유자가 L4이기 때문이다(F wire §3.8.1 마지막 항목, `_research/settings.md` §2.13).
- `l4.cli.outputMode`는 print 모드의 기본 출력이다. `--json` 플래그가 이 값보다 앞선다. 대화형에는 적용하지 않는다.
- `l4.cli.keybindingsFile`: 키 바인딩 내용은 파일로만 정한다(`_research/settings.md` §2.13 "파일만"). 파일 형식은 pi `keybindings.json`을 따른다 [가정: pi-tui `src/keybindings.ts`의 형식, 채택 뒤 확정]. CLI는 시작할 때 파일을 읽고 같은 키에 동작이 둘 이상이면 충돌 목록을 stderr에 쓴다. 충돌한 키는 기본 바인딩을 쓴다. `restart`이므로 `session` 범위가 없다(F wire D7).
- `l4.cli.statusLine`은 배열 원소 열거를 `type`에 둔다. `range.enum`은 string·number에만 쓰기 때문이다(F wire D5).
- 서비스 사용 설정은 `l0.process.service.enabled`다(`L0.process.spec` §6 소유). 설정 화면에서는 "실행" 탭(`SettingsTab` `"execution"`)이다(adr.0006 §3.4 마지막 항목).
- 노출 경로: 설정 파일(`L4.host-service.spec`의 파일 위치), `xeon config`, `/set`(session 허용 키만), 데스크톱 설정 화면(`L4.settings-ui.spec`).

## 7. 확장 지점

- CLI는 on·post·drive·scope 지점을 선언하지 않는다. 확장 지점은 엔진 안에 있고 CLI는 호스트 계약만 쓴다(adr.0006 §3.2).
- 확장과의 관계:
  - 확장이 사용자에게 보일 내용은 `custom` item(`display: true`)으로 오고, CLI는 텍스트로 그린다(§4.5).
  - drive 임대(`lease.acquired`/`lease.released`)와 scope 변경(`scope.changed`)은 상태 줄에 활성 그룹 이름으로 보일 수 있다 [제안]. 트랜스크립트에는 그리지 않는다.
  - 확장 설정 키(`ext.<id>.*`)는 `xeon config`와 `/set`에서 코어 키와 같은 규칙으로 다룬다.
  - pi의 `ctx.ui.custom`(TUI 컴포넌트를 돌려주는 확장 UI)은 두지 않는다. 원격·데스크톱으로 옮길 수 없기 때문이다(`_research/refs/pi.md` 415행).

## 8. 다른 문서와의 인터페이스

| 방향 | 문서 | 내용 |
|---|---|---|
| 요구 | `F.wire-settings.spec` | `HostConnection`, `TransportKind`, `JsonRpcMessage`, `EventsBatchParams`, `StreamChunkParams`, `StreamPosition`, `WIRE_LIMITS`, `WIRE_PROTOCOL_VERSION`, 오류 kind 표, `EffectiveSetting`, `SettingDefWire`, `defineSettings`, `SETTING_KEY_PATTERN`, `checkSettingWrite`(host 쪽) |
| 요구 | `F.conversation.spec` | `ThreadId`, `ItemId`, `ItemRecord`, `ToolResultRecord` 3채널, `XeonCustomMessage.display` |
| 요구 | `F.records.spec` | 코어 kind 카탈로그, `EffectResult.synthesized`, `redactions` 규칙 |
| 요구 | `L4.host-service.spec` | `resolveLaunchMode`, `startInProcessHost`, `startStdioHost`, `ensureService`, `connectServiceTransport`, `createHostConnection`, `runHostCommand`와 `HostCommand`·`CommandIo`(§3.3.4, §3.3.5), `AssembleError`·`EnsureResult` 코드, 엔진 바이너리 이름과 서브커맨드(§3.2), 서비스 사용 설정 키, `turn.start` 암묵 획득(HS-28), 테스트용 조립(테이프 모델 주입) |
| 요구 | `L0.secrets.spec` | 비밀 관리 동작(`secret.*`의 의미, §8.3 R4의 값 없는 메서드), 값 비노출 규칙, `secret test`의 해시 규칙 |
| 요구 | `L1.tools.spec` | `approval.requested` payload |
| 요구 | `L1.models.spec` | `/model` 별칭이 가리킬 설정 키 |
| 요구 | `L2.schedule.spec` | `schedule.create`·`list`·`cancel`·`fire`의 입력과 오류 값(§4.4.9), 서비스 모드가 꺼졌을 때의 `service_mode_off` 경고 |
| 요구 | `eng.testing.guide` | `scenario` 태그(저장소 1개), 테이프 형식, TS-08 강제 종료 규칙, L4 커버리지 임계 |
| 요구 | `eng.toolchain.guide` | TC-05(산출물 비커밋), TC-10(`bun build --compile`), TC-11(FTS5) |
| 요구 | adr.0006 | in-process 기본, 서비스 사용 시 `ensure` 후 socket, 잠금 3선택, 종료 협조 |
| 제공 | `L4.settings-ui.spec` | `l4.cli.*` 키 정의(외관 탭) |
| 제공 | `L4.desktop.spec` | `xeon host --stdio` 진입(사이드카 실행 인자) |
| 제공 | `eng.testing.guide` | `apps/cli/test/chat.scenario.test.ts` |

## 9. 수용 기준

- AC1. 모델 테이프로 `xeon chat -p "<입력>" --json` 한 턴이 종료 코드 0으로 끝나고, 출력에 `turn.completed{status: "completed"}`가 담긴 `events.batch`가 있다(M1 scenario).
- AC2. 같은 시나리오에서 turn 진행 중 자식 프로세스를 SIGKILL한 뒤 `xeon chat --continue -p "<입력>" --json`을 실행하면, 같은 `threadId`의 이벤트가 이어서 온다. 첫 실행에서 받은 마지막 seq보다 큰 seq만 새로 출력되고 seq 중복이 없으며, 새 turn이 `completed`로 끝난다. 이전 turn이 `interrupted`로 닫히는지는 엔진 복구 규칙(`L1.persistence.spec`, adr.0006 §3.6 규칙 5)을 따른다 [가정].
- AC3. `xeon config get <key> --json`의 출력이 같은 연결에서 `settings.get { keys: [key] }`가 돌려준 `settings` 배열과 같다. 텍스트 출력에는 `source.scope`가 있고, 파일 범위면 `source.path`도 있다.
- AC4. `--json` 출력의 각 줄을 JSON으로 해석한 열이, `observe` 탭이 받은 `JsonRpcMessage` 열과 순서·내용 모두 같다.
- AC5. 비밀 값 `S`(길이 16 이상의 무작위 문자열)로 `secret add`를 stdin 입력으로 실행하고 `secret test`, `secret ls --json`, `chat -p` 한 턴을 돌리면, stdout·stderr·이벤트 DB·CLI 상태 파일 어디에도 `S`, `S`의 base64, `S`의 hex가 없다(M2). M1에서는 같은 검사를 `chat -p` 한 턴(SOPS 비밀 참조 1종, `product.scope.spec` M1 행)에 적용한다.
- AC6. `secret add <name> <값>`, `secret set <name> --value <값>`은 2로 끝나고, stderr에 `<값>`이 없다.
- AC7. stdout이 TTY가 아니면 출력에 ESC(0x1B) 바이트가 없다. stdin이 TTY가 아니면 대화형 화면을 열지 않고 print 모드로 동작한다.
- AC8. `thread.locked`를 받은 M1 실행은 4로 끝난다. M2 프롬프트에서 아무것도 고르지 않으면 4다.
- AC9. 대화형에서 turn 진행 중 Ctrl+C 1회는 M2에서 `turn.interrupt`를 정확히 한 번 보낸다. 2초 안의 2회는 종료 요청을 보내고 130으로 끝난다.
- AC10. `applyBatch`는 같은 seq를 두 번 받으면 두 번째를 무시하고, `from`이 위치와 다르면 `gap`을 돌려준다.
- AC11. 개발 빌드의 in-process 연결에서 `devWireRoundTrip: true`가 `AssembleOptions.devChecks`로 전달된다(§3.3). 컴파일 바이너리에서는 `false`다.
- AC12. 사용법 오류 출력은 두 줄(무엇, 해결)이고 종료 코드는 2다.
- AC13. stdout이 TTY가 아닐 때 `xeon secret reveal <name>`은 2로 끝나고, stdout·stderr·이벤트 DB 어디에도 그 비밀 값이 없다. TTY에서 열람하면 감사 기록이 한 건 늘고 그 기록에 값이 없다.
- AC14. 키 플러그인이 없고 SearXNG 주소를 설정하지 않은 설정에서 `xeon doctor`는 검색 provider 묶음 세 줄을 내고, 권장 목록에 Exa와 Brave가 있다. 주소가 비어 있으면 어떤 주소에도 탐침을 보내지 않는다. 옛 후보 주소(`127.0.0.1`·`localhost`의 8888, 8080)에서 SearXNG가 응답해도 쓰지 않는다.
- AC24. `xeon doctor`는 `host.status { includeBinaries: true }`를 한 번 보내 바이너리마다 한 줄을 낸다. 필수 바이너리를 쓸 수 없으면 종료 코드 3이고 선택 바이너리만 빠졌으면 0이다. `--json`의 `binaries`는 호스트가 준 보고서와 같다.
- AC15. 승인 프롬프트의 응답이 kind별 정본 모양이다: 도구 허용은 `remember`만, 거부 이유는 `{ feedback }`, 계획 승인은 `{ mode?, note? }`, 질문은 `QuestionAnswer`, 검토는 `ReviewAnswer`다. 다른 클라이언트가 먼저 답하면 열린 프롬프트가 닫히고 `approval.respond`를 보내지 않는다.
- AC16. `host --stdio`의 stdout에는 JSON-RPC 메시지만 나오고(사람용 출력은 stderr), stdin EOF에서 0으로 끝난다. `l4.cli.*` 키가 그 호스트의 카탈로그에 있다. 컴파일(`--minify --bytecode`) 바이너리에서도 같다.
- AC17. 대화형이 시작할 때 `command.list { threadId }`로 연 세션의 id를 보내고, `/resume`으로 세션을 바꾸면 새 id로 다시 읽는다. 엔진에 등록한 동작 명령(`/plan on`)을 치면 `command.run { threadId, text: "/plan on" }`이 한 번 가고 `done.message`가 stdout에 나오며 `turn.start`는 가지 않는다. `expanded` 결과는 펼친 텍스트가 `turn.start`의 `input`이 되고, `needs_confirmation`은 사용자가 `y`를 입력해야만 `confirmShell: true`로 다시 간다.
- AC18. 대화형으로 `thread.list`가 `resumable`을 알린 세션을 열면 `이어서 실행할까요? [y/N]`을 묻는다. `y`일 때만 `turn.resume { threadId }`가 한 번 가고, 그 turn의 나머지 이벤트가 그려진다. 새 세션과 print 모드는 묻지 않고 `turn.resume`을 보내지 않는다.
- AC19. 결정이 없고 신뢰할 자원이 있는 폴더에서 대화형 `chat`을 시작하면 `thread.create`보다 앞서 카드를 묻고, 번호를 입력하면 그 선택지의 `choice`로 `trust.decide { workspace, choice }`가 한 번 간다. 엔터는 `trust.decide`를 보내지 않는다. `xeon trust allow --scope parent`는 host가 낸 선택지의 `{ kind: "parent", verdict: "allow" }`를 보낸다.
- AC20. `xeon secret rm <name>`은 `secret.references`로 읽은 설정 키·활성 lease·최근 세션을 보인 뒤 묻고, 활성 lease가 있으면 `secret.remove`를 보내지 않는다. `xeon secret test <name>`의 출력에는 길이와 SHA-256 앞 8자가 있고 값, 값의 base64·hex는 stdout·stderr·요청 어디에도 없다.
- AC21. 도구 승인 카드에 `command` 전체와 `secretEnv` 핸들이 보이고, 값이 아닌 `secret://` 참조만 있다. `approval.resolved`가 `always`를 `thread`로 낮췄다고 알리면 그 사실이 카드 다음에 보인다. `approval.respond`가 `answer_invalid`를 돌려주면 `detail`을 보이고 다시 묻는다.
- AC22. `xeon sessions rename <id> <제목>`과 `/rename <제목>`은 `thread.rename { threadId, title }`를 한 번 보내고, 바뀐 제목이 `sessions ls`와 `/resume` 목록에 보인다. 제목이 비었거나 200자를 넘으면 호스트에 보내지 않는다. 첫 입력에서 제목을 정하는 일(80자)은 호스트가 하며 CLI는 하지 않는다.
- AC23. `/compact`는 `thread.compact { threadId }`를 한 번 보내고(`/compact <지침>`이면 `instructions`를 함께), `compacted`이면 요약 전 토큰 수를, `skipped`이면 이유를 stdout에 쓰며 `turn.start`를 보내지 않는다. 확장이 막거나 요약이 실패하거나 turn이 진행 중이면 두 줄 오류를 stderr에 쓰고 입력을 이어 받는다. 같은 이름의 엔진 명령이 있어도 `command.run`을 부르지 않는다.
- AC25. `--remote`(또는 설정 주소)가 있으면 엔진 명령은 엔진을 열지 않고 그 주소로 `attachToService`를 부른다. 주소 문법이 틀리면 엔진을 열지 않고 `invalidRemote`(2)로 끝난다. `host --stdio`는 같은 주소에 중계하고 stdin이 닫히면 0으로 끝난다. 원격 토큰 값은 오류 출력에 없다(HS-87~HS-89). 시험: `test/engine-start.test.ts`, `test/host-stdio.test.ts`, `test/parse-chat-flags.test.ts`.
- AC26. `xeon db export <폴더>`는 엔진에 연결하지 않는다. 실제 저장소에 행과 블롭을 쓰고 원본을 연 채로 내보낸 사본을 읽기 전용 `openStore`로 열면 행과 블롭 바이트가 원본과 같다(`test/db-export.int.test.ts`). 대상 폴더가 비어 있으면 2, 저장소·디스크 오류는 3이다(`test/db-export.test.ts`).

- AC26. `xeon schedule add --every 300 "<프롬프트>"`는 `schedule.create`를 한 번 보내고, `trigger`가 `{ kind: "interval", everySeconds: 300 }`, `prompt`가 입력과 같다. 결과 줄은 `예약했다: <id>  간격 300초  다음 실행 <ISO>`다. 서비스 모드가 꺼져 있으면 stderr에 경고 한 줄이 더 나온다. `--auto-approve`와 `--json`은 알 수 없는 플래그다. `list`는 `{ enabled: true }`를, `--all`은 `{}`를 보낸다. 원격이 아닌 항목에 `schedule run`을 하면 `not_remote` 문구와 종료 코드 1이다. 시험: `test/schedule-parse.test.ts`, `test/schedule.test.ts`, `test/schedule-host.int.test.ts`.

## 10. 미결 사항

1. [결정: review.decisions-2 U-15] `apps/cli` → `@xeon/host` import는 허용 목록 `DR-10/cli-host`로 연다(`L4.host-service.spec` §3.1). 남은 [미결]: 엔진 바이너리 이름 `xeon`([제안], 같은 문서 §10 미결 2). `EngineHandle.paths.cliStateFile`의 원천은 정했다 [결정: review.decisions-2 B-07]: `@xeon/host`의 `resolveHostStatePaths()`가 L0.os `OsDirs.state` 아래 `cli/state.json`을 돌려준다(`L4.host-service.spec` §3.3.6). CLI는 경로를 계산하지 않는다(DR-13). 환경 변수 `XEON_CLI_STATE_FILE`은 테스트 격리용 덮어쓰기로만 남는다.
2. [미결] M1 중단의 wire 지원. `turn.interrupt`가 M2라서 M1의 Ctrl+C 1회가 종료 요청이다(§4.6). M1에 turn만 멈추는 동작이 필요하면 `turn.interrupt`를 M1으로 당기는 F 변경 요청이 필요하다. 기존 세션의 쓰기 소유를 `turn.start`가 얻는 동작은 `L4.host-service.spec` HS-28로 확정되어 이 항목에서 닫았다(§4.3).
3. [미결] 비밀 명령의 wire 경로. 값 없는 메서드 `secret.list`, `secret.meta`, `secret.remove`, `secret.test`, `secret.beginEntry`(add·set·rotate)는 F 표에 M2로 들어왔다. 값을 싣는 메서드는 두지 않는다(`L0.secrets.spec` §8.3 R4). 열람은 `xeon secret reveal`로 정했다 [결정: review.decisions-2 U-20]. F의 `secret.beginReveal`과 in-process 값 전달 통로(`InProcessHost.secretOutOfBand`)는 구현되어 CLI가 쓴다(§4.7). 남은 것: `secret run -- <cmd>`를 둘지.
4. [미결] `type`에 `range`를 병합하는 함수를 F에 공통으로 둘지(`_research/notes/L4-3.md`). `config schema`는 wire 없이 로컬 명령(`L4.host-service.spec` §6.2)으로 정해져 F 변경 요청에서 뺐다.
5. [결정: M2 임시] `doctor`의 진단 경로. FTS5 검사(TC-11)는 `platform-store` 안에만 둔다. M2는 CLI가 `connectEngine`의 성공·실패(`EngineStartError`), `secret.list`, `settings.get`으로 판정한다(§4.7.1). 조립 진입점이 진단 함수를 내거나 F에 `host.diagnose`를 더하면 그쪽으로 옮긴다. 비밀 저장소의 sops·age 판정은 `secret.list` 오류 kind(`provider_unavailable`, `key_unavailable`)에 기대므로 sops가 없어도 목록 조회가 오류 없이 끝나는 구성이면 항목이 `ok`로 나올 수 있다 [가정]. M3b(B2-WEB)에서 검색 provider 줄과 웹 provider 블록은 `web.providers`(view-model)로 판정하도록 바꿨다. 설정 키는 SearXNG 주소 하나만 `settings.get`으로 읽는다(§4.7.1).
6. [결정: review.m2-plan §8 D10] pi-tui 채택은 M2 스파이크의 한글 IME·CJK 폭 확인 통과를 조건으로 한다(§4.9.2). 실패하면 최소 renderer로 유지한다. M2 종료 조건이 아니다. 스파이크 결과(2026-10-24, `L4.cli.plan` §4.4): CJK 폭, IME 확정 입력, 하드웨어 커서 위치, 줄바꿈의 자동 확인은 모두 통과했다. 실제 터미널(macOS·Linux·WSL)의 한국어 IME 확인과 Bun 1.4.3 `--compile` 실행 확인이 남아 채택을 보류하고 최소 renderer를 유지한다. 최소 renderer의 진행 줄이 문자 수로 잘리던 문제는 칸 수 기준으로 고쳤다.
7. [결정: review.m3-design-inputs D-M3-25 행 4] 릴리즈 형태는 단일 파일이다. native 모듈이 꼭 필요하면 옆 디렉터리를 쓴다. 이전 질문: 단일 파일만 배포할지, pi처럼 `native/` 사이드카 디렉터리를 함께 둘지(`_research/notes/L4-1.md` §5). macOS 공증 때 사이드카 `.node`와 FTS5 dylib의 서명 위치는 `_research/notes/L4-2.md`가 다룬다.
8. [결정: M2] print 모드에서 승인 요청이 오면 거부로 답하고 stderr에 한 줄 알린다(§4.11 4번). [결정: review.m3-design-inputs D-M3-14] M3 기본은 L1.tools 사전 허용 규칙만 적용하고 나머지는 거부한다. [결정: 오케스트레이터 기본값, M3b B1-SCH] 옵션 플래그는 `--auto-approve`다(이전 [제안] `--yes-all`은 쓰지 않는다). print 모드에서만 쓰고, 도구 승인만 한 번 허용한다. D-M3-14 b의 "모두 허용 포함" 범위는 도구 승인으로 좁힌다. 질문·계획·검토 승인은 이 플래그로도 거부한다(§4.11 4번).
9. [결정: review.decisions-2 U-02] 승인 요청은 A안(내구 이벤트 `approval.requested`/`approval.resolved` + `approval.respond`)이다. kind는 F.records 카탈로그에 있다(`F.records.spec` §3.2).
10. [결정: review.m3-design-inputs D-M3-30 행 3, adr.0020] TUI 설정 화면은 M3에 만들지 않는다. view-model 공유 위치는 `packages/client`다(§4.9.4).
11. [미결] stdout EPIPE의 종료 코드(0 제안)와 129·143 추가.
12. [결정: m2c G1-07] `secret test`의 출력. F 결과에 `decryptable`, `length`, `sha256Prefix`가 더해져서 §4.7대로 출력한다.
13. [미결] 설정 값 사전 검사(§4.8). `settings.list`의 `SettingDefWire`는 `type`이 JSON Schema 객체라 `validateSettingValue`(TSchema 입력)를 바로 부를 수 없고, CLI에서 `Type.Unsafe(json)`을 쓰면 TY-26을 어긴다. F가 `SettingDefWire`를 받는 검사 함수를 내면 `config set`이 왕복 전에 범위 오류를 알릴 수 있다. 그 전까지 값 판정은 호스트의 `settings.set`이 한다(오류 문구는 §4.10 표).
14. [결정: m2c G1-07] 비밀 삭제 전 참조 표시. `secret.references`로 설정 키, 활성 lease 수, 최근 사용한 세션을 보인다(§4.7 `rm`).
15. [미결] 끊긴 turn을 연 세션의 질문 순서. 실제 호스트는 쓰기 소유를 얻을 때 미해결 승인을 되살리므로(`L4.host-service.spec` HS-52) 승인 카드가 `이어서 실행할까요? [y/N]`보다 먼저 선다. 이어 실행을 먼저 묻고 승인 카드를 그 뒤로 미루려면 승인 프롬프트를 이어 실행 질문이 끝날 때까지 붙잡는 장치가 CLI에 필요하다. 지금은 두 질문이 같은 입력 줄을 순서대로 쓰고 어느 쪽으로도 잘못 응답되지 않는다(`turn-resume-host.int.test.ts`). 작성자 결정.
16. [미결] `settings.invalidated` 구독(M2 마감 재검토 T6 메모). 이 문서가 M2에 요구하는 동작은 "시작할 때 `settings.list`와 `command.list`를 한 번 읽는다"(§4.12)이고 CLI는 알림을 구독하지 않는다. 대화 중에 다른 연결이 설정이나 신뢰를 바꾸면 Tab 완성의 키 목록과 엔진 명령 목록이 낡는다. 알림을 받아 두 목록을 다시 읽는 일은 M3에 한다(`L4.cli.plan` §4.6 끝 항목).
17. [결정: adr.0016] CLI 출력 문장은 `packages/client`의 ko·en 카탈로그 id로 만들고 현재 로케일로 풉니다. 포맷은 `Intl` 기반 포트(`packages/client/src/i18n/format.ts`, ICU MessageFormat 부분집합)입니다. ADR-0016 §3.1의 FormatJS(`@formatjs/intl`)는 승인 전이라 쓰지 않습니다 [결정: 오케스트레이터 기본값]. 로케일은 `ui.locale`(기본 auto, OS 로케일, 영어 폴백)을 따릅니다. 표시 언어 설정 키는 `l4.ui.locale`이고(`packages/client`의 `uiSettings`, `cliSettingGroups`로 엔진 조립에 넘깁니다), `runCli`는 시작할 때 OS 단서(`LC_ALL`, `LC_MESSAGES`, `LANG`)로, `chat`의 `--set l4.ui.locale=<값>`이 있으면 그 값으로 현재 로케일을 정합니다. 단서가 없으면 처음 값 `en`을 씁니다. CLI 문장의 한국어 이전은 M3b B4-I18N에서 끝났습니다. L4 `src`(apps/host, apps/cli, apps/desktop, packages/client)의 한국어 문자열 리터럴은 `xeon/hardcoded-korean` 규칙(`xeon/scripts/check-ts-rules.ts`)이 막습니다(시험과 `.tsx` 뷰는 제외). 테이프 스모크 `apps/cli/test/chat.scenario.test.ts`의 scenario-4는 `--set l4.ui.locale=en`이면 print 모드 턴의 거부 문장이 영어이고, 설정이 없으면 같은 테이프가 한국어로 나오는지 실제 자식 프로세스로 확인합니다.
18. [결정: 오케스트레이터 기본값] `invalidRemote`의 종료 코드는 2다. HS-87이 주소 문법 오류를 "사용 오류"라고 하고 §3.6의 2는 인자 값의 오류를 포함한다. 설정 파일의 같은 값 오류(`settings.invalidValue`)도 2라서 맞췄다.
19. [제안] `host --stdio`의 원격 중계(HS-89)는 M3b B2-RMT에 넣었다. 접속 실패의 종료 코드는 §4.10의 연결 오류 코드(3)를 따르고, HS-89의 1은 원격이 끊기거나 중계가 실패한 경우에만 쓴다. HS-89 문장과 맞는지 host-service 문서에서 확인한다.
20. [미결] 주소 문구에서 `@`가 든 값을 가리는 규칙(자격 증명 방어)은 HS-87에 없다. 이 문서의 구현이 먼저 두었다. host-service 문서로 옮길지 정한다.
21. [미결] 서비스 접속의 `clock`과 `newRequestId`를 CLI의 운영 값으로 낸다([제안]). `L4.host-service.spec` §3.3.5의 `EngineHandle` 정의와 맞출지 확인한다.
22. [미결] 서비스 쪽 값 입력 창(§4.7, `L4.settings-ui.spec` §4.6.4 C안)은 아직 없다. `secret.ts`의 두 줄 오류 문구는 "서비스 모드는 M3에서 제공한다"라고 쓰는데, M3b에서도 그 창이 없으면 이 문구가 틀린다. 창을 만드는 단위와 문구를 정한다.
23. [미결] 대화형 완료 알림의 노이즈. §4.5.1 규칙대로면 turn이 끝날 때마다 `[완료] 작업이 끝났다`가 한 줄 붙는다. 같은 thread의 답은 화면에 이미 보이므로 이 줄은 잉여다. 같은 thread의 `completed`를 접을지, 다른 thread의 알림에만 쓸지 사용자가 정한다. 그 전까지 규칙은 §4.5.1 그대로다.
24. [미결] 알림 도착과 세션 종료의 경합. 시험(`slash-commands-host.int.test.ts`, `/compact`)에서 turn 세 개 가운데 한 건의 완료 알림만 세션 종료 전에 도착했다. 종료 직전에 알림 대기열을 짧게 비우는 방법(시간 상한 포함)을 정한다.
25. [미결] `db export`의 저장소 파일 이름(`xeon.db`)과 데이터 디렉터리 위치. 이름은 `apps/host/src/assemble.ts`의 `DB_FILE_NAME`과 같고 호스트가 내보내지 않아 `apps/cli/src/commands/db.ts`에 한 번 더 있다. 위치는 `runtime.ts`가 `@xeon/platform-os`의 `resolveOsDirs`로 정한다. 호스트가 데이터 디렉터리를 공개 API로 내보내면 두 곳을 그 값으로 바꾼다(§4.13).
26. [미결] `apps/cli` → `@xeon/platform-store` 간선. `L0.store.spec` §3.2는 `openStore`와 `exportDatabase`를 조립 루트 `apps/host`만 import한다고 적는다. 이 간선은 DR-14 예외 목록에 없다. 의존 검사(`just depcruise`)는 통과하지만, 문서와 맞추려면 허용 목록 항목을 더하거나 호스트 공개 API로 옮기는 결정이 필요하다.
27. [결정: 오케스트레이터 기본값, M3b B1-SCH2] `schedule add`의 기본값과 상한: `--workspace`를 빼면 host의 기본 작업 폴더를 쓴다(`L2.schedule.spec` §4.4.1). `--every`와 `--expires-in`은 1년(31536000초) 이하, `--loop`는 0 이상 1년 이하, `--max-iterations`는 1~10000, `--debounce`는 기본 1000 ms이고 0~3600000 ms, `--watch` 경로는 16개 이하다. 사용자 확인은 남아 있다.
28. [미결] 기본 그룹 이름 목록의 출처(M3b B4-GRP). `runtime.ts`의 `BUILTIN_GROUP_NAMES`(`helm`, `learning`, `account-rotation`)는 `apps/host/src/assembly/catalog.ts`가 올리는 기본 그룹을 옮겨 적은 값이다. CLI가 host 조립 코드를 import하지 않으려고 둔다(DR-10은 엔진 조립 코드만 허용한다). host가 이름 목록을 내면 그쪽으로 옮기고 이 상수를 없앤다. 그 전까지 기본 그룹을 추가하면 이 목록도 같이 고친다.
29. 닫음: 템플릿 패키징(B5-REL). 릴리즈 아카이브는 템플릿을 `group-kit/templates/`에 싣고, `locateGroupTemplates`가 실행 파일 옆 그 자리를 찾는다. 배치와 탐색 순서는 `L4.release.spec` §3.1과 §3.2이고, 시험은 `test/group-templates-locate.test.ts`와 X11의 `group new`(환경 변수 없이)다.
30. [미결] 생성 패키지의 의존 선언. 생성한 `package.json`이 `@xeon/group-kit`이나 `@xeon/contracts`를 적을지 정하지 않았다(`L3.slots.spec` §3.3.2, S-01 구현 기록). 지금은 적지 않는다. 저장소 안에 만든 그룹은 워크스페이스 해석에 기댄다.
31. [미결] `apps/cli/package.json`의 `@xeon/group-kit` 워크스페이스 의존은 소스가 쓰지 않는다. knip은 잡지 않는다. 지우면 루트 `bun.lock`을 고쳐야 해서 이 작업 범위 밖이다. 다음 정리 때 지운다.
