---
id: L4.cli.spec
layer: L4
domain: cli
kind: spec
status: draft
depends_on: [F.wire-settings.spec, F.conversation.spec, F.records.spec, adr.0006, L4.host-service.spec, eng.testing.guide, eng.toolchain.guide, L0.secrets.spec, L1.tools.spec, L1.models.spec, L0.process.spec, L2.web.spec]
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
- 설정 화면(데스크톱 12탭): `L4.settings-ui.spec`. CLI의 TUI 설정 화면도 [미결](§4.9, §10).
- 데스크톱 셸: `L4.desktop.spec`.
- 비밀 값의 저장·해석·마스킹: `L0.secrets.spec`. CLI는 명령 입구와 출력 규칙만 정한다.
- 승인 요청 payload의 모양: `L1.tools.spec`. CLI는 표시와 응답 규칙만 정한다.
- 개발용 justfile 종료코드 규칙(`eng.toolchain.guide` 3.2절). 이 문서의 종료 코드는 제품 CLI의 것이며 개발 레시피 규칙과 별개다(§3.6).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 엔진 바이너리 | `bun build --compile`로 만든 단일 실행 파일. [제안] 이름은 `xeon`이고 CLI 명령과 엔진 진입(`host --stdio`, 서비스)을 한 파일에 담는다. 확정은 `L4.host-service.spec`이 한다 |
| 조립 진입점 | `@xeon/host`의 공개 진입점 `.`과 `./client`(`L4.host-service.spec` §3.3). CLI는 이 API를 조합해 엔진 연결을 만든다(§3.3). `apps/cli` → `@xeon/host` import는 허용 목록 `DR-10/cli-host`로 연다 [결정(잠정): review.decisions-2 U-15] |
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
| `xeon`, `xeon chat` | 대화형 모드. TTY가 아니면 print 모드로 바뀐다(§4.2) | `host.hello`, `thread.create`, `events.subscribe`, `turn.start`, `settings.get` | M1 |
| `xeon chat -p <입력>`, `--print <입력>` | print 모드. 입력 하나로 turn 하나를 돌리고 응답 텍스트를 stdout에 쓴다. `-p -` 또는 `-p`만 쓰면 stdin 전체가 입력이다 | 위와 같음 | M1 |
| `xeon chat -p … --json` | JSON 모드. 연결에서 오간 JSON-RPC 메시지를 순서대로 한 줄에 하나씩 쓴다(§4.4) | 위와 같음 | M1 |
| `xeon chat --continue` | 현재 작업 폴더의 마지막 세션을 이어 연다. M1은 CLI 상태 파일, M2부터 `thread.list` | M1: 위와 같음. M2: `thread.list`, `thread.open` 추가 | M1 |
| `xeon chat --resume <id>` | 지정 세션을 이어 연다 | M1: `events.subscribe`, `turn.start`. M2: `thread.open` 추가 | M1 |
| `xeon chat --set <key>=<value>` | 이 세션에만 설정을 덮어쓴다(session 범위). 여러 번 쓸 수 있다 | `settings.set`(scope `session`, `threadId`) | M2 |
| `xeon sessions ls [--all] [--limit n] [--json]` | 세션 목록. 기본은 현재 작업 폴더 | `thread.list` | M2 |
| `xeon sessions show <id> [--json]` | 세션의 내구 이벤트를 트랜스크립트로 출력한다 | `events.subscribe`(filter `threadIds`), `events.unsubscribe` | M2 |
| `xeon sessions fork <id> [--at <itemId>]` | 분기를 만들고 새 id를 출력한다 | `thread.fork` | M2 |
| `xeon sessions rm <id> [--yes]` | 세션 삭제. TTY에서는 확인을 받는다 | `thread.delete` | M2 |
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
| `xeon secret rm <name> [--yes]` | 삭제. 참조하는 정책을 보인 뒤 확인한다. 사용 중이면 거부된다 | `secret.remove` | M2 |
| `xeon secret test <name>` | 존재와 복호화 가능 여부. 길이와 해시 앞 8자만 출력한다 | `secret.test` | M2 |
| `xeon secret reveal <name>` | 값 열람. 사람 전용이고 TTY에서만 동작한다. OS 인증 재확인이 가능한 플랫폼에서는 재확인한다(§4.7) [결정(잠정): review.decisions-2 U-20] | `secret.beginReveal { name }`. 값 필드 없음. F 메서드 추가는 M2 계획에서 정한다(review.decisions-2 U-04) | M2 |
| `xeon service start\|status\|stop` | 서비스 기동, 상태, 종료. `install`/`uninstall`은 2차 | 없음. `runHostCommand({ kind: "service-start" \| "service-status" \| "service-stop" })`(§3.3). status는 그 안에서 `host.status`를 부른다 | M3 |
| `xeon service ensure --json` | `ensure`만 하고 소켓 경로를 JSON 한 줄로 쓴다. 데스크톱 셸이 쓴다(`L4.host-service.spec` HS-38) | 없음. `runHostCommand({ kind: "service-ensure" })` | M3 |
| `xeon service launch-mode --json` | 서비스 사용 설정을 엔진 없이 읽어 JSON 한 줄로 쓴다. 데스크톱 셸이 쓴다(`L4.desktop.spec` §4.2). 도움말에 보이지 않는다 | 없음. `runHostCommand({ kind: "service-launch-mode" })` | M3 |
| `xeon service run` | 서비스 본체를 전경에서 실행한다. `service start`와 `ensure`가 자기 바이너리를 detached로 띄울 때 붙이는 인자다(`L4.host-service.spec` §3.2, SV-06). 도움말에 보이지 않는다 | 없음. `runHostCommand({ kind: "service-run" })` | M3 |
| `xeon host --stdio` | 내부 진입. stdin/stdout JSON Lines로 엔진 서버를 연다. 데스크톱 사이드카가 쓴다. 도움말에 보이지 않는다 | 서버 쪽 전체. `runHostCommand({ kind: "host-stdio" })` | M2(컴파일 바이너리 서브커맨드) |
| `xeon doctor` | FTS5, sops·age, 데이터 디렉터리 권한, 서비스 도달, 터미널 능력, 검색 provider 상태(§4.7.1) 진단 [제안] | [미결] 진단 진입(§10 5번) | M2 |
| `xeon version [--json]` | CLI 버전, 계약 버전(`WIRE_PROTOCOL_VERSION`), Bun 버전 | 없음 | M1 |

- 근거: 명령 모양은 omp `config list/get/set/reset`(`_research/settings.md` §1, §3 [S36]), pi 모드 4종(TUI, print, JSON, RPC: `_research/refs/pi.md` "같은 AgentSession을 네 모드가 쓴다", `~/projects/_ref/pi-src/packages/coding-agent/src/modes/`), 비밀 명령은 `_research/secrets.md` §6.6, 서비스 명령은 adr.0006 §3.4다.
- [결정] 서비스 모드는 1차이고 OS 서비스 등록은 2차다(adr.0006 §1). [제안] CLI의 `service` 명령은 M3에 둔다. M1·M2는 in-process와 stdio로 충분하고, 서비스 본체는 `L4.host-service.plan`의 일정을 따른다.
- [제안] M1 host 처리기는 `host.hello`, `thread.create`, `turn.start`, `events.subscribe`, `settings.get` 다섯이다(`F.wire-settings.spec` §3.3.1의 [제안]. M1 범위는 `_research/foundation-plan.md` §5 P4). 그래서 M1의 `config`는 `get`과 로컬 명령 `schema`만 있고, `sessions ls`는 `thread.list`가 생기는 M2다.
- M1의 stdio 진입은 개발 진입 `bun xeon/apps/host/src/main.ts host --stdio`(`L4.host-service.plan` H5)이고, 컴파일 바이너리의 `xeon host --stdio` 서브커맨드는 M2다. 데스크톱의 M1 적합성 테스트는 개발 진입을 쓴다(`L4.desktop.plan` D1).
- `service`, `host --stdio`, `config schema`는 엔진 연결 없이 `runHostCommand`를 부르고 그 반환값을 종료 코드로 쓴다(§3.6).
- `secret run -- <cmd>`(`_research/secrets.md` §6.6 마지막 행)는 이 문서에 두지 않는다 [미결 §10 3번].

공통 플래그:

| 플래그 | 뜻 |
|---|---|
| `-h`, `--help` | 도움말 |
| `--no-color` | 색 끄기. `NO_COLOR` 환경 변수가 있어도 같다 |
| `-C <dir>` | 작업 폴더 지정. 없으면 현재 폴더 [제안] |

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

export type ServiceCommand = {
  readonly kind: "service";
  readonly action: "start" | "status" | "stop" | "ensure" | "launch-mode" | "run";   // ensure·launch-mode는 --json만, launch-mode·run은 도움말에 숨김
  readonly output: OutputMode;
};
/** @xeon/host의 HostCommand(runHostCommand 입력)와 다른 타입이다. 이름을 나눠 둔다. */
export type CliHostCommand = { readonly kind: "host"; readonly stdio: true };
export type DoctorCommand = { readonly kind: "doctor"; readonly output: OutputMode };
export type VersionCommand = { readonly kind: "version"; readonly output: OutputMode };
export type HelpCommand = { readonly kind: "help"; readonly topic: string | null };

export type CliCommand =
  | ChatCommand | SessionsCommand | ConfigCommand | SecretCommand
  | ServiceCommand | CliHostCommand | DoctorCommand | VersionCommand | HelpCommand;

export interface GlobalOptions {
  readonly cwd: string;
  readonly color: boolean;
}

export type UsageErrorCode =
  | "unknownCommand" | "unknownFlag" | "missingArgument" | "unexpectedArgument"
  | "invalidSettingKey" | "invalidOverride" | "invalidThreadId" | "invalidSecretName"
  | "secretValueInArgv" | "conflictingFlags" | "jsonRequiresPrint" | "inputRequired" | "revealRequiresTty";

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

[결정] UI는 엔진 객체를 직접 다루지 않고 호스트 계약만 쓴다(adr.0006 §3.2). [제안] CLI는 `@xeon/host`의 공개 진입점(`.`, `./client`)이 내는 함수를 조합해 연결을 만든다. `EngineConnector`, `StdioHostRunner`, `ServiceControl` 같은 이름은 `@xeon/host`에 없다. 연결 타입과 오류 문구는 CLI 안의 이름이다(`L4.host-service.spec` §3.3.5). `apps/cli` → `@xeon/host` import는 허용 목록 `DR-10/cli-host`로 연다(`L4.host-service.spec` §3.1, 사용자 승인 전 [미결 §10 1번]).

| CLI 경로 | 쓰는 `@xeon/host` API | `L4.host-service.plan` 작업 |
|---|---|---|
| `chat`, `sessions`, `config get/set/reset/list`, `secret` | `connectEngine`(아래)이 `resolveLaunchMode` → `"in-process"`면 `startInProcessHost` + `createHostConnection(host.client)`, `"service"`면 `ensureService` + `connectServiceTransport` + `createHostConnection` | H2(`assemble`), H3(`createHostConnection`), H4(처리기), H10(`ensureService`, `connectServiceTransport`), H20(`resolveLaunchMode`) |
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
  readonly preference: ConnectPreference;                       // "auto"면 resolveLaunchMode()(§4.3)
  readonly client: { readonly name: "xeon-cli"; readonly version: string };
  readonly settingGroups: readonly SettingGroup<"l4.cli", Readonly<Record<string, SettingDefInput>>>[];   // AssembleOptions.settingGroups로 넘긴다(§6)
  readonly devWireRoundTrip: boolean;                           // AssembleOptions.devChecks로 넘긴다(F wire §3.1)
  readonly observe?: (message: JsonRpcMessage) => void;         // CLI가 Transport를 감싸 send·onMessage를 탭한다(JSON 모드)
}

export type EngineStartErrorKind =
  | "fts5Missing" | "sopsMissing" | "dataDirPermission" | "storeUnavailable"   // AssembleIssue "store"(메시지로 구별 [가정])
  | "catalogConflict"                                                          // AssembleIssue "catalog"
  | "missingService"                                                           // AssembleIssue "missingService"
  | "serviceUnreachable"                                                       // EnsureResult "spawnTimeout" | "registrationInvalid"
  | "protocolUnsupported";                                                     // EnsureResult "protocolUnsupported", hello 1003

export interface EngineStartError {
  readonly kind: EngineStartErrorKind;
  readonly message: string;                                     // 한 줄
  readonly fix: string;                                         // 한 줄
}

export interface EngineHandle {
  readonly connection: HostConnection;                          // host.hello까지 마친 연결
  readonly transport: TransportKind;                            // "in-process" | "socket"
  readonly storeId: string;                                     // host.hello 결과의 storeId
  readonly paths: { readonly cliStateFile: string };            // CLI 상태 파일 위치(L0.os 상태 디렉터리 아래, §10 1번)
  /** in-process면 InProcessHost.close()(HS-31), socket이면 HostConnection.close()만 한다.
   *  체크포인트 시한은 l0.process.shutdown.timeoutMs다(L0.process.spec §6, L4.host-service.spec §3.3.5). */
  shutdown(reason: "user" | "signal"): Promise<"clean" | "deadline">;
}

export type ConnectEngine = (options: EngineConnectOptions) => Promise<Result<EngineHandle, EngineStartError>>;
/** 위 표 첫 행의 조합. AssembleError와 EnsureResult 실패를 EngineStartError로 바꾸고 host.hello를 보낸다. */
export declare const connectEngine: ConnectEngine;
```

- `observe`는 `HostConnection` 안쪽의 클라이언트 전송에 붙는 탭이다. 호스트는 관여하지 않는다. CLI는 이 탭으로 JSON 모드 출력을 만들고, 엔진 객체를 만지지 않는다.
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
  readonly clock: { now(): number };                    // Ctrl+C 2회 판정(§4.6). eng.typescript.guide의 Clock
}

/** 프로세스 밖 효과는 io와 deps로만 한다. 테스트는 둘을 가짜로 넣는다. */
export declare function runCli(argv: readonly string[], io: CliIo, deps: CliDeps): Promise<ExitCode>;
```

- `main.ts`의 최상위 코드는 `process.argv.slice(2)`, 실제 `CliIo`, `CliDeps`(`connectEngine`과 `@xeon/host`의 `runHostCommand`)로 `runCli`를 부르고 `process.exit(code)`만 한다.

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
  | { readonly kind: "notice"; readonly text: string };

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
| 1 | 일반 오류 | turn이 `failed`, wire 오류(`internal`, `settings.invalidValue` 등), 없는 세션, `EngineStartError`의 `catalogConflict`·`missingService`(설치본·확장 결함이라 환경을 고쳐도 풀리지 않는다), `runHostCommand`의 1 |
| 2 | 사용법 오류 | 모르는 플래그, 인자 누락, argv에 비밀 값, `--json`을 대화형에 씀 |
| 3 | 환경 문제 | `EngineStartError`의 나머지 kind(FTS5 없음, sops 없음, 데이터 디렉터리 권한, 저장소 열기 실패, 서비스 도달 불가, 계약 버전 불일치) |
| 4 | 세션 잠금 실패 후 사용자 거부 | `thread.locked`에서 관찰·분기·위임을 고르지 않았다. M1은 프롬프트 없이 바로 4다 |
| 129 | SIGHUP | 터미널이 닫혔다(pi print 모드와 같은 값, `~/projects/_ref/pi-src/packages/coding-agent/src/modes/print-mode.ts:60`) |
| 130 | 중단 | Ctrl+C(SIGINT)로 끝냈다. print 모드 turn이 `interrupted`로 끝났다 |
| 143 | SIGTERM | 체크포인트 뒤 끝냈다(pi print 모드와 같은 값) |

- 이 표는 제품 CLI의 종료 코드다. 개발 레시피의 종료코드 규칙(1 고침, 2 환경, 3 사람 확인, `eng.toolchain.guide` 3.2절)과 섞지 않는다. 특히 제품의 3은 "환경 문제"이고 개발 레시피의 3은 "사람 확인 필요"다.
- 129, 143은 pi print 모드의 신호 종료 값을 따라 더한 것이다 [제안](`print-mode.ts:60`).
- `runHostCommand`를 부르는 명령(`host --stdio`, `service *`, `config schema`)은 반환값 0·1·2를 그대로 종료 코드로 쓴다. 이 경로의 시작 거부(SV-05 권한 검사, `AssembleError`)는 3이 아닌 1이다(`L4.host-service.spec` §3.3.5).

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

## 4. 동작 규칙

### 4.1 기동 순서

1. `parseArgv`. 실패하면 사용법 오류를 출력하고 2로 끝낸다.
2. `version`, `help`는 엔진 없이 끝낸다.
3. `host --stdio`, `service *`, `config schema`는 `deps.runHostCommand`를 부르고 그 반환값으로 끝낸다(§3.3 표). `host --stdio` 경로는 사람용 출력을 stdout에 쓰지 않는다(stdout은 JSON Lines 전용).
4. 그 밖의 명령은 `deps.connect`를 부른다. 실패하면 `EngineStartError`의 `message`와 `fix`를 stderr에 쓰고 §4.10 표의 종료 코드(`catalogConflict`·`missingService`는 1, 나머지는 3)로 끝낸다.
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
- print 모드와 비TTY 출력에는 ANSI 제어 문자(색, 커서 이동, CSI 2026 동기화, OSC)를 쓰지 않는다. `--no-color`, `NO_COLOR`, `TERM=dumb`이면 대화형에서도 색을 쓰지 않는다.

### 4.3 엔진 연결

- [결정] CLI 기본 전송은 in-process다(adr.0006 §3.3, `F.wire-settings.spec` §3.1 표).
- [결정] 서비스 사용 설정이 켜져 있으면 시작할 때 `ensure`를 부르고 socket 전송으로 접속한다. 꺼져 있으면 in-process다(adr.0006 §3.4). [제안] `preference: "auto"`이면 `connectEngine`이 `resolveLaunchMode()`로 `l0.process.service.enabled`를 엔진 없이 읽어 정한다(`L4.host-service.spec` HS-37). 키는 `L0.process.spec` §6이 소유한다.
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
| `--continue` | CLI 상태 파일에서 작업 폴더의 항목을 찾는다. 없으면 "이어 열 세션이 없다" + 해결 한 줄, 1로 끝낸다 | `thread.list { workspace, limit: 1 }`의 첫 항목 → `thread.open { mode: "write" }` |
| `--resume <id>` | 상태 파일에 그 id의 위치가 있으면 그 위치부터, 없으면 `{ storeId, seq: 0 }`부터 구독 | `thread.open { threadId, mode: "write" }`의 `position` 사용 |

- 재개 구독 [제안]:
  - print 모드는 저장된 위치부터 구독한다. 그래서 강제 종료 뒤 엔진이 쓴 복구 기록(합성 `effect.result`, `turn.completed{interrupted}`)과 새 turn의 이벤트가 이어서 출력된다.
  - 대화형은 `{ storeId, seq: 0 }`, `filter.threadIds`로 구독해 이전 대화를 접힌 형태(user·assistant 텍스트만)로 그리고, 저장 위치 이후부터 전체 형태로 그린다.
- `replay.outOfRange`:
  - `storeMismatch`: 위치를 버리고 `from: "head"`로 다시 구독한다. "저장소가 바뀌어 이전 기록을 이어 받지 못했다"를 알린다.
  - `tooFar`, `beforeOldest`: 대화형은 `from: "head"`로 다시 구독하고 알린다. print 모드도 같다.
- 구간 검사(F wire §4.5): `applyBatch`가 `from ≠ position.seq`를 받으면 `gap`을 돌려준다. CLI는 마지막 `to`부터 다시 구독한다.
- 상태 파일 갱신: `events.batch`를 반영할 때마다 메모리의 위치를 바꾸고, 파일 쓰기는 turn 경계(`turn.completed`)와 종료 때 한다 [제안]. 강제 종료로 파일이 덜 갱신돼도 더 이른 위치부터 구독하므로 이벤트를 놓치지 않는다. 다시 받은 이벤트는 `applyBatch`가 seq로 걸러 중복 출력하지 않는다.

### 4.5 이벤트 렌더링

- 내구(`events.batch`)는 트랜스크립트, 휘발(`stream.chunk`)은 진행 줄이다(F wire §3.4.4).

| 이벤트 | 처리 |
|---|---|
| `item.recorded`(user) | 사용자 입력 줄 |
| `item.recorded`(assistant) + `part.recorded` | Markdown 본문. thinking 파트는 대화형에서 접힌 한 줄, print 모드에서 생략 [제안] |
| `effect.intent` | 도구 호출 줄: 표시 제목(없으면 기계 이름)과 인자 요약 한 줄 |
| `item.recorded`(toolResult) + `effect.result` | 도구 결과(아래 3채널 규칙) |
| `item.recorded`(custom) | `display: true`면 `content`의 텍스트를 보이고, `false`면 보이지 않는다 |
| `turn.completed` | 상태가 `interrupted`·`failed`면 한 줄 알림. print 모드 종료 코드 결정(§3.6) |
| `step.*`, `checkpoint.step`, `lease.*`, `scope.changed`, `post.accepted` | 트랜스크립트에 그리지 않는다. 대화형 상태 줄에만 반영할 수 있다 |
| `settings.changed` | 대화형에서 한 줄 알림. 값이 비밀 참조면 참조 문자열만 보인다 |
| 확장 kind(`x.<id>.*`, `grp.<id>.*`) | 그리지 않는다. 확장이 보일 내용은 `custom` item으로 낸다(F conversation §3.5.2) |
| `stream.chunk` `item.updated{part_delta}` | 진행 줄에 텍스트를 이어 붙인다 |
| `stream.chunk` `item.updated{tool_progress}` | 진행 줄에 도구 진행을 한 줄로 바꿔 쓴다 |
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

### 4.6 입력, 중단, 신호

| 입력·신호 | 대화형 | print 모드 |
|---|---|---|
| Ctrl+C 1회(turn 진행 중) | M2: `turn.interrupt { threadId }`. M1: 종료 요청과 같다(아래) [제안] | 종료 요청. 끝나면 130 |
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
  - [제안] 값은 wire 프레임에 싣지 않는다(`L4.readme` §4 비밀 행, `L0.secrets.spec` §8.3 R4). `add`·`set`·`rotate`는 값 필드가 없는 `secret.beginEntry { name, action }`으로 시작한다. 서비스 접속이면 서비스 쪽 L0.secrets가 OS 입력 창으로 값을 받는다(`L4.settings-ui.spec` §4.6.4 C안). in-process이면 CLI가 아래 규칙으로 읽은 값을 같은 프로세스의 L0.secrets에 wire 밖 경로로 넘긴다. 이 경로의 API는 `@xeon/host`에 아직 없다 [미결 §10 3번]. wire 메서드 `secret.list`·`meta`·`remove`·`test`·`beginEntry`는 F 표에 M2로 있다.
  - 파서는 `secret add|set|rotate`의 이름 뒤 위치 인자, `--value`, `<name>=<값>` 형식을 `secretValueInArgv` 사용법 오류(2)로 거부한다. 오류 메시지에 그 인자를 다시 쓰지 않는다.
  - TTY면 에코 없는 프롬프트로 두 번 받아 비교한다. TTY가 아니면 stdin을 EOF까지 읽고 끝의 줄바꿈 하나를 지운다.
  - `rotate`는 TTY 프롬프트만 받는다 [제안]. 사람이 직접 입력하는 동작으로 두기 위해서다(`_research/secrets.md` §6.6 "사람이 입력").
- 값은 stdout, stderr, 이벤트, 로그, 오류 `details`, JSON 모드 출력 어디에도 없다.
  - [제안] 비밀 명령에는 `--json` 메시지 탭을 붙이지 않는다. `secret ls`, `secret test`의 `--json`은 결과 객체만 쓴다.
  - 값을 담은 바이트 배열은 L0.secrets에 넘긴 직후 0으로 덮는다. 문자열로 바꾸지 않는다 [제안].
- `secret test`는 존재, 복호화 가능 여부, 길이, SHA-256 hex 앞 8자만 출력한다.
- 값 열람 [결정(잠정): review.decisions-2 U-20]: 열람 경로는 M2 CLI `xeon secret reveal <name>`과 M3 데스크톱 화면(`L4.settings-ui.spec`) 둘이다. 에이전트 경로(모델 도구, 확장 API)에는 열람이 없다.
  - [제안] `reveal`은 stdin과 stdout이 모두 TTY일 때만 동작한다. 아니면 `revealRequiresTty` 사용법 오류(2)다. `--json`을 받지 않는다.
  - [제안] 시작은 값 필드가 없는 `secret.beginReveal { name }`이다. 값 표시는 호스트 쪽 L0.secrets가 맡는다. in-process면 같은 프로세스가 TTY에 직접 쓰고, 서비스 접속이면 서비스 쪽 L0.secrets가 OS 창으로 보인다(`L4.settings-ui.spec` §4.6.4 C안과 같은 경로). 값은 wire 프레임, 로그, 이벤트에 없다.
  - [제안] OS 인증 재확인(macOS Touch ID·암호, Windows Hello 등)이 가능한 플랫폼에서는 표시 전에 재확인한다. 수단은 `L0.secrets.spec`·`L0.os.spec`이 정한다. 재확인을 못 하는 플랫폼에서는 TTY 확인 문구(이름을 다시 입력)만 받는다.
  - 열람은 감사 기록(`L0.secrets.spec`)에 남긴다. 기록에는 값이 없다.

#### 4.7.1 검색 provider 상태 출력

[제안] ADR-0005 ④의 첫 실행 권장 내용(`product.scope.spec` I10)을 CLI에서는 `xeon doctor`의 한 묶음으로 보인다. M3 데스크톱 첫 실행 화면은 `L4.settings-ui.spec`이 맡는다.

- 줄 1: 현재 `web.search` provider(`l2.web.search.provider` 유효 값과 `auto`일 때 고른 provider).
- 줄 2: SearXNG 감지 결과(감지한 주소 또는 "없음"). 없으면 해결 문장으로 `xeon config set l2.web.search.searxng.url <주소>`를 보인다.
- 줄 3: 등록되지 않은 무료 크레딧 API 플러그인 권장 목록(Exa, Brave)과 키 등록 명령 `xeon secret add <이름>`.
- 값은 키 이름과 참조 문자열만 보인다. 비밀 값은 없다.
- 키 이름과 provider 목록의 정본은 `L2.web.spec`이다. 이 출력은 그 값을 읽기만 한다.
- 설정의 비밀 키(`secret: true`)는 `config get`이 참조 문자열(`secret://<name>`)이나 `null`만 보인다(F wire §4.9).

### 4.8 설정 명령과 세션 덮어쓰기

- 값 해석(`config set`, `--set`, `/set`): `raw`를 먼저 JSON으로 해석하고, 실패하면 문자열로 본다(F wire §4.11).
- 최종 판정은 host의 `settings.set`이다. host는 `checkSettingWrite`로 범위·잠금·값을 검사한다(F wire §3.9). CLI는 오류 `kind`를 §4.10 표의 문구로 바꾼다.
- [제안] 미리 검사: `config set`은 `settings.list`의 `SettingDefWire`로 같은 값을 먼저 검사해 왕복 없이 범위 오류를 알린다. 이때 `type`에 `range`를 병합한 스키마(F wire §4.10 3번 규칙)를 `typebox/schema`의 `Check`로 검사한다(`_research/notes/L4-3.md`). 잠금과 비밀 값 거부는 host만 판정한다. 병합 함수는 F에 공통으로 두자는 제안을 따른다 [미결 §10 4번].
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

- [제안] 대화형 TUI는 pi-tui 1.3.0(정확 고정)을 쓴다. 조건은 둘이다.
  1. 스파이크 통과: `_research/notes/L4-1.md` §7의 1번(애드온 없이 Bun 1.4.3 `--compile` 바이너리 시작·종료)과 6번(`process.execPath` 값)을 확인하고, 한글 입력(IME)과 CJK 폭을 macOS·Linux 터미널에서 확인한다(`L4.cli.plan` C8).
  2. 스택 표에 pi-tui 행을 더하는 사용자 승인(`eng.toolchain.guide` TC-04). 현재 `_research/foundation-plan.md` §2 스택 표에 TUI 행이 없다 [미결 §10 6번].
- [제안] 네이티브 애드온은 1차 배포에 넣지 않는다. 빠지는 기능은 Apple Terminal·Windows의 Shift+Enter 판별, Windows Shift+Tab 판별, 네이티브 클립보드뿐이다(`_research/notes/L4-1.md` §3.3). 사이드카 `native/` 디렉터리 배포 여부는 릴리즈 형태와 함께 정한다 [미결 §10 7번].
- [제안] 후퇴 경로: M1은 pi-tui 없이 통과한다. print 모드와 JSON 모드는 어떤 TUI 라이브러리도 쓰지 않는다. M1 대화형은 최소 renderer(`node:readline` 입력 + 줄 출력 + 진행 줄 한 줄 덮어쓰기)로 만든다. 스파이크가 실패하면 M2도 최소 renderer를 유지하고 TUI 라이브러리 선택을 [미결]로 둔다.
- 렌더러 교체가 쉽도록 화면 코드는 `RenderSink` 뒤에 둔다. `TranscriptState`와 `RenderOp`는 라이브러리와 무관하다.

#### 4.9.3 화면 구성(pi-tui 채택 시)

- `TuiMainScreen`을 쓴다. 터미널 스크롤백을 보존하기 위해서다. alt-screen은 쓰지 않는다 [제안].
- 위에서 아래로: 트랜스크립트(`Markdown`, `Text`), 진행 줄(`Loader`), 입력(`Editor`), 상태 줄(`l4.cli.statusLine` 세그먼트).
- 승인 프롬프트와 잠금 선택은 오버레이(`showOverlay`) 안의 `SelectList`로 보인다.

#### 4.9.4 설정 화면

- [미결] TUI 안의 설정 화면(pi `/settings`, omp `/settings`에 해당)을 만들지 정하지 않았다. 만들면 설정 화면의 view-model(탭 배치, 위젯 결정, 범위 배지)을 데스크톱 `settings-ui`와 공유해야 하고, 공유 위치는 앱끼리 import 금지(DR-10) 때문에 L4 아래 층이 되어야 한다. M3의 선택 작업으로 둔다.

### 4.10 오류 문구

모든 오류 출력은 두 줄이다: `xeon: <무엇이 잘못됐다>`와 `  해결: <한 줄>`. wire `message`(영어 개발자용)를 그대로 쓰지 않고 `kind`와 `details`로 만든다(F wire §3.5.1).

| kind | 문구 요지 | 해결 한 줄 | 종료 코드 |
|---|---|---|---|
| `thread.notFound` | 세션 `<id>`가 없다 | `xeon sessions ls`로 id를 확인한다 | 1 |
| `thread.locked` | 다른 프로세스(`ownerKind`)가 이 세션을 쓰고 있다 | M1: 끝날 때까지 두거나 새 세션을 연다. M2: 프롬프트(§4.11) | 4 |
| `turn.busy` | 진행 중인 turn이 있다 | 끝난 뒤 다시 보낸다 | 1 |
| `settings.unknownKey` | 등록되지 않은 키 | `xeon config list`로 키를 확인한다 | 2 |
| `settings.invalidValue` | 값이 형식이나 범위에 맞지 않다(`issues` 첫 항목) | 허용 범위를 확인한다 | 2 |
| `settings.scopeNotAllowed` | 그 범위에 쓸 수 없는 키 | 허용 범위: `allowedScopes` | 2 |
| `settings.locked` | 관리 설정이 잠근 키 | 관리자에게 요청한다 | 1 |
| `settings.secretValue` | 비밀 키에는 참조만 쓸 수 있다 | `xeon secret add <name>` 뒤 `secret://<name>`을 쓴다 | 2 |
| `protocol.unsupported` | CLI와 엔진의 계약 버전이 다르다 | 같은 버전의 바이너리를 쓰거나 서비스를 다시 띄운다 | 3 |
| `host.shuttingDown` | 엔진이 종료 중이다 | 잠시 뒤 다시 실행한다 | 1 |
| `internal` | 내부 오류(`traceId`) | `xeon doctor`를 실행하고 `traceId`를 보고한다 | 1 |
| `EngineStartError`(`catalogConflict`, `missingService`) | `message` | `fix` | 1 |
| `EngineStartError`(그 밖의 kind) | `message` | `fix` | 3 |

### 4.11 승인 요청과 잠금 프롬프트

- 승인(M2) [가정: F wire §4.6 A안]
  1. `approval.requested` 내구 이벤트가 오면 `ApprovalView`를 만들고 프롬프트를 연다. 선택지는 허용, 거부, 답(질문형일 때)이고 기억 범위는 이번만(`once`), 이 세션(`thread`), 항상(`always`)이다.
  2. 사용자의 선택을 `approval.respond { approvalId, decision, answer?, remember? }`로 보낸다.
  3. `approval.resolved` 이벤트가 오면 프롬프트를 닫는다. 다른 클라이언트가 먼저 답한 경우도 같다.
  4. print 모드는 프롬프트를 열 수 없으므로 `decision: "deny"`로 답하고 stderr에 한 줄 알린다 [제안]. 비대화 자동 승인 플래그를 둘지는 [미결 §10 8번].
  5. payload 모양은 `L1.tools.spec` 소관이다. CLI는 제목·본문·질문 여부만 읽는다.
- 잠금(M2): `thread.locked` 오류의 `details.options`(`observe`, `fork`, `delegate`) 중 가능한 것만 보인다.
  - 관찰: `thread.open { mode: "observe" }` 뒤 구독만 한다. 입력란을 잠근다.
  - 분기: `thread.fork { threadId }`로 새 세션을 만들어 연다.
  - 위임: 서비스 전송일 때만 보인다. 소유자에게 입력을 보내는 클라이언트가 된다(adr.0006 §3.6 규칙 3).
  - 아무것도 고르지 않으면 4로 끝낸다. M1은 프롬프트 없이 4다.

### 4.12 슬래시 명령

- 슬래시 명령은 설정 정의에서 만든다 [제안].
  - `/set <key> <value>`: `settings.list` 결과 중 `allowedScopes`에 `session`이 있는 키만 자동 완성에 넣는다. 실행은 `settings.set { scope: "session", threadId }`.
  - `/model [<값>]`: 모델 선택 키의 별칭이다. 값이 없으면 그 키의 `range.enum`으로 목록을 보인다. 키 이름은 `L1.models.spec`이 정한다 [가정: 아직 이름이 정해지지 않았다].
  - `/resume`: `thread.list`로 목록을 보이고 고른 세션으로 바꾼다(M2).
  - `/help`, `/quit`: CLI 내장.
- 별칭 표는 `src/slash.ts`의 상수 하나에 둔다. 키 이름이 없는 별칭은 등록하지 않는다.
- 확장이 슬래시 명령을 더하는 경로(L2-e 프롬프트 템플릿)는 wire 메서드가 없어 이 문서에 두지 않는다.

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
- AC14. 키 플러그인이 없고 SearXNG가 감지되지 않은 설정에서 `xeon doctor`는 검색 provider 묶음 세 줄을 내고, 권장 목록에 Exa와 Brave가 있다.

## 10. 미결 사항

1. [결정(잠정): review.decisions-2 U-15] `apps/cli` → `@xeon/host` import는 허용 목록 `DR-10/cli-host`로 연다(`L4.host-service.spec` §3.1). 남은 [미결]: 엔진 바이너리 이름 `xeon`([제안], 같은 문서 §10 미결 2)과 `EngineHandle.paths.cliStateFile`의 원천. CLI는 경로를 계산하지 않으므로(DR-13) `@xeon/host`가 L0.os 상태 디렉터리를 알려 주는 API를 두도록 host-service에 요청한다.
2. [미결] M1 중단의 wire 지원. `turn.interrupt`가 M2라서 M1의 Ctrl+C 1회가 종료 요청이다(§4.6). M1에 turn만 멈추는 동작이 필요하면 `turn.interrupt`를 M1으로 당기는 F 변경 요청이 필요하다. 기존 세션의 쓰기 소유를 `turn.start`가 얻는 동작은 `L4.host-service.spec` HS-28로 확정되어 이 항목에서 닫았다(§4.3).
3. [미결] 비밀 명령의 wire 경로. 값 없는 메서드 `secret.list`, `secret.meta`, `secret.remove`, `secret.test`, `secret.beginEntry`(add·set·rotate)는 F 표에 M2로 들어왔다. 값을 싣는 메서드는 두지 않는다(`L0.secrets.spec` §8.3 R4). 열람은 `xeon secret reveal`로 정했다 [결정(잠정): review.decisions-2 U-20]. 남은 것: `secret.beginReveal`의 F 추가(review.decisions-2 U-04에 따라 M2 계획에서 정한다), in-process에서 CLI가 읽은 값을 wire 밖으로 L0.secrets에 넘기는 `@xeon/host` API(§4.7), `secret run -- <cmd>`를 둘지.
4. [미결] `type`에 `range`를 병합하는 함수를 F에 공통으로 둘지(`_research/notes/L4-3.md`). `config schema`는 wire 없이 로컬 명령(`L4.host-service.spec` §6.2)으로 정해져 F 변경 요청에서 뺐다.
5. [미결] `doctor`의 진단 경로. FTS5 검사(TC-11)는 `platform-store` 안에만 둔다. [제안] 조립 진입점이 진단 함수를 내거나 F에 `host.diagnose`를 더한다.
6. [미결] pi-tui 채택. 스택 표에 행이 없다. 조건은 §4.9.2. 실패하면 최소 renderer로 유지한다.
7. [미결] 릴리즈 형태: 단일 파일만 배포할지, pi처럼 `native/` 사이드카 디렉터리를 함께 둘지(`_research/notes/L4-1.md` §5). macOS 공증 때 사이드카 `.node`와 FTS5 dylib의 서명 위치는 `_research/notes/L4-2.md`가 다룬다.
8. [미결] print 모드에서 승인 요청이 오면 거부하는 기본값, 비대화 자동 승인 플래그를 둘지.
9. [결정(잠정): review.decisions-2 U-02] 승인 요청은 A안(내구 이벤트 `approval.requested`/`approval.resolved` + `approval.respond`)이다. kind는 F.records 카탈로그에 있다(`F.records.spec` §3.2).
10. [미결] TUI 설정 화면과 view-model 공유 위치(§4.9.4).
11. [미결] stdout EPIPE의 종료 코드(0 제안)와 129·143 추가.
