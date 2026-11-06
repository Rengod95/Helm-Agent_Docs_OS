---
id: F.wire-settings.spec
layer: F
domain: wire-settings
kind: spec
status: draft
depends_on: [F.records.spec, F.extensions.spec, F.conversation.spec, F.capabilities.spec, eng.events.design]
binds: [xeon/packages/contracts/src/wire-settings/**]
---

# F 연결·설정 계약 (wire-settings)

이 문서는 F5 "연결·설정 계약"(`_research/layer-plan-v2.json` F5)의 스펙이다. 1부는 Runtime API(wire), 2부는 설정 스키마 단일 원천(settings)이다. 두 부분은 한 도메인 디렉터리 `src/wire-settings/`에 있고 서브패스는 둘로 나뉜다.

| 서브패스 | 소스 디렉터리 | 내용 |
|---|---|---|
| `@fresnel/contracts/wire` | `xeon/packages/contracts/src/wire-settings/wire/` | JSON-RPC envelope, 메서드 레지스트리, 알림, 커서, 오류, 전송 인터페이스, 버전 |
| `@fresnel/contracts/settings` | `xeon/packages/contracts/src/wire-settings/settings/` | `SettingDef`, `defineSettings`, 설정 계층, 유효 값, JSON Schema 출력 규약 |

[제안] 서브패스를 둘로 나눈다. 설정 선언은 모든 층(X~L3)이 import하고 wire는 L4만 import하므로, 설정만 쓰는 층이 wire 타입을 끌어오지 않게 하기 위해서다.

## 1. 목적과 범위

### 1.1 정하는 것

- CLI, 데스크톱, 서비스가 함께 쓰는 Runtime API 하나와, 그 계약을 나르는 전송(Transport) 인터페이스 3종의 시그니처.
- JSON-RPC 2.0 envelope 규칙, 메서드 이름 규칙, 메서드·알림 레지스트리와 각 params/result 스키마.
- JSON Lines stdio 전송(`createStdioTransport`, 줄 프레이밍). Bun·Node API 없이 웹 스트림만 쓰고 서버 쪽(`@fresnel/platform-process`, `@fresnel/host`)과 클라이언트가 같은 코드를 쓴다 [결정: m2 F.8].
- 이벤트 구독의 seq 커서, 재전송 계약, 휘발 스트림 규칙.
- 오류 객체 모양과 오류 코드 구간, `_meta`와 추적 컨텍스트 전파 규약.
- 계약 버전 정책과 기능 수명주기(Active, Deprecated, Removed, 실험 opt-in, 기능 탐지).
- 설정 정의 스키마 `SettingDef`와 선언 함수 `defineSettings`, 키 네임스페이스 규칙.
- 설정 계층(관리, 사용자, 작업 폴더, 로컬, 이번 실행)의 우선순위, 잠금, 유효 값과 출처의 모양.
- 같은 `SettingDef`에서 L4 화면, 설정 파일, 명령을 만들 때 F가 보장하는 출력 규약(JSON Schema 출력).

### 1.2 다루지 않는 것

- `HostConnection` 구현(`createHostConnection`)은 L4 공유 패키지 `@fresnel/client`가 가진다(§3.1, [결정: adr.0020]). F는 `HostConnection` 인터페이스만 둔다. 전송 구현 가운데 stdio 줄 프레이밍은 서버 쪽(L0, 호스트)도 써서 F가 가진다. 프로세스 기동, 소켓 서버, 데스크톱 릴레이(Electron 셸 `engine/relay.ts`, 옛 Tauri 구현(커밋 424f338a)은 Tauri 릴레이)는 `L0.process.spec`, `L4.host-service.spec`, `L4.desktop.spec`, `L4.cli.spec`가 맡는다.
- 엔진 쪽 메서드 처리기 구현: `L4.host-service.spec`이 L1 서비스를 엮어 구현한다.
- 대화 소유 잠금 구현: `L0.process.spec`, `L1.persistence.spec`.
- 설정 파일 위치, 파일 감시, 병합 실행: `L1.persistence.spec`과 `L4.host-service.spec` [가정. 아래 §4.9 참조].
- 설정 화면 생성 코드: `L4.settings-ui.spec`.
- 각 층의 설정 키 목록(카탈로그): 각 층 spec의 "설정 노출" 절이 소유한다. F는 F 자신의 키만 둔다(§6).
- 시크릿 값 저장과 해석: `L0.secrets.spec`. F는 `secret://` 참조 문자열의 모양만 정한다.

### 1.3 이식 원칙

- [결정] `docs/design/19-client-protocol.md`는 홈서버 데몬과 기기 인증 전제라 그대로 따르지 않는다(`_research/decisions-log.md` 2026-10-19, `_research/README.md` 마지막 단락).
- [제안] 19에서 가져오는 것은 셋이다. JSON-RPC envelope 규칙(§3.3.1), 메서드 이름 규칙(§3.3.1), seq 커서 재전송 알고리즘(§3.5.3~§3.5.4). 나머지(Tailscale·SSH 경로, 기기 인증 핸드셰이크, 페어링, 뷰 무효화, 커널 거부 코드 대응)는 가져오지 않는다.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 호스트 | 엔진(Cordis 호스트 + 루프 + SQLite)을 소유하고 계약의 서버 쪽을 맡는 코드. `xeon/apps/host` |
| 클라이언트 | CLI TUI, 데스크톱 UI처럼 계약의 요청 쪽을 맡는 코드 |
| 연결(connection) | 클라이언트 하나와 호스트 사이의 논리 연결 하나. 구독과 진행 중 요청은 연결에 속한다 |
| 전송(transport) | 연결 위에서 JSON-RPC 메시지 하나를 통째로 옮기는 수단. in-process, stdio, socket 3종 |
| 메서드 | 요청과 응답 쌍을 갖는 호출. 이름은 `<영역>.<동사>` |
| 알림 | 응답이 없는 메시지. 서버 알림과 클라이언트 알림이 있다 |
| 내구 이벤트 | 저장소에 커밋되어 seq를 가진 이벤트(F.records). 재전송 대상이다 |
| 휘발 스트림 | 토큰 델타처럼 저장하지 않는 조각. seq가 없고 재전송하지 않는다 |
| 위치(StreamPosition) | `{storeId, seq}` 쌍. 클라이언트가 저장하는 재개 시점 |
| 설정 키 | `<층>.<도메인>.<이름>` 또는 `ext.<확장id>.<이름>` 형태의 점 표기 이름 |
| 설정 범위(scope) | 값이 저장되는 계층. `managed`, `user`, `project`, `local`, `launch` |
| 유효 값 | 모든 범위를 우선순위대로 합친 결과 값과 그 출처 |

thread, turn, step, item 용어는 `F.conversation.spec`을 따른다. 이 문서의 메서드 영역 `thread`는 F.conversation의 thread(대화 하나)를 뜻한다. [가정] F.conversation이 저장 단위인 대화와 thread를 1:1로 둔다. 다르면 메서드 영역 이름을 F.conversation 쪽에 맞춘다.

## 3. 인터페이스

### 3.0 코드 블록 표기

- 스키마는 `typebox` 1.3.27(`xeon/package.json` catalog)로 쓴다.
- 이름 규칙은 F 공통 규칙(`F.conversation.spec` §3 첫 단락)을 따른다. 정적 타입은 `X`, 그 런타임 스키마 상수는 `XSchema`다.
- [제안] 이 문서의 코드 블록은 읽기 쉽게 줄여 썼다. `export const X = Obj({...})`라고 적은 것은 코드에서 다음 두 줄이다.
  - `export type X = { ... }`(또는 `Static<typeof XSchema>`)
  - `export const XSchema: TObject<{...}> = Type.Object({...})`(또는 `TUnsafe<X>`)
  - 코드 블록 안에서 다른 스키마를 참조하는 `id: RpcId` 같은 표기도 코드에서는 `RpcIdSchema`다. 본문과 표의 `X`는 타입 이름이다.
  - 명시 타입 주석은 `isolatedDeclarations` 때문에 필요하다(`_research/notes/eng-2.md` §3-3). 이 옵션은 `xeon/tsconfig.base.json`에서 이미 켜져 있다(`_research/foundation-plan.md` §2 언어 행, `F.readme` §3). `satisfies`는 쓸 수 없다. 코드 블록의 주석 생략은 이 문서의 예시에만 해당한다.
- 아래에서 `Obj(p)`는 `Type.Object(p, { additionalProperties: false })`를 줄인 표기다. 코드에서는 `wire/jsonrpc.ts`에 비공개 도우미로 둔다.
- 다른 F 도메인에서 가져오는 이름은 다음과 같다. 이름 정본은 각 spec이다.
  - `F.conversation.spec`: `ThreadId`, `TurnId`, `StepId`, `ItemId`, `EventId`와 각 `XSchema`, `PartDelta`, `TextContentSchema`, `ImageContentSchema`, `UserMessage`(pi 타입 재노출)
  - `F.records.spec`: `DurableEventEnvelope`, `VolatileEventEnvelope`, `EventKind`, `EventKindSchema`, `DetachedField`, `DetachedFieldSchema`. `Seq`, `StoreId`는 F.records에 없어서 wire가 정한다(§3.4.1)
  - `F.capabilities.spec`: `SemVer`, `SemVerSchema`, `CapabilityId`, `CapabilityErrorData`, `toJsonSchema`(TypeBox 스키마 → JSON Schema 2020-12)
  - `F.extensions.spec`: `ExtensionName`(`EXTENSION_NAME_PATTERN` `^[a-z][a-z0-9-]{1,31}$`), `ExtensionManifest`(`userConfig`, `layer`, `defaultEnabled` 필드), `UserConfigEntrySchema`
  - 이름이 확정본과 다르면 이 문서를 고친다(§10 미결 7).
- wire의 JSON-RPC 요청 id 타입은 `RpcId`다. `F.conversation.spec`의 `requestId`(submission 중복 제거 키)와 섞이지 않게 `RequestId`라는 이름을 쓰지 않는다.
- wire 레지스트리 이름에는 `Wire` 접두를 붙인다(`WireMethodMap`, `WIRE_METHODS`). `F.capabilities.spec`의 `MethodMap`, `MethodDef`(기능 서비스 메서드)와 구분하기 위해서다.

### 3.1 Runtime API 1부: 연결과 전송

[결정] 엔진은 프로세스와 무관한 라이브러리이고, Runtime API는 하나이며, 전송만 바꾼다(`_research/foundation-plan.md` §1 3번, `_research/decisions-log.md` 2026-10-21 계획 v2, `_research/process.md` §6.1).

| 배포 형태 | 전송 | 프레이밍 | 단계 |
|---|---|---|---|
| CLI(`fresnel chat`) | in-process | 없음. 메시지 객체를 그대로 넘긴다 | M1 |
| 데스크톱(Electron 셸 + 엔진 사이드카. 옛 Tauri 구현(커밋 424f338a)은 Tauri 2) | stdio | JSON Lines(UTF-8, 메시지 하나당 한 줄, `\n` 구분) | M1(계약), 구현은 L4 plan |
| 서비스(`fresnel service`) | socket | Unix 도메인 소켓 위 JSON Lines | M2 이후 |

```ts
// wire/transport.ts
export type TransportKind = "in-process" | "stdio" | "socket";

export interface CloseInfo {
  readonly reason: "local" | "remote" | "error" | "eof";
  readonly message?: string;
}

export type Unsubscribe = () => void;

/** 메시지 하나를 통째로 옮긴다. 프레이밍과 한도 검사는 구현이 하고, envelope 검사는 HostConnection이 한다. */
export interface Transport {
  readonly kind: TransportKind;
  send(message: JsonRpcMessage): Promise<void>;
  onMessage(handler: (message: unknown) => void): Unsubscribe;   // 검증 전 값. envelope 검사는 위층이 한다
  onClose(handler: (info: CloseInfo) => void): Unsubscribe;
  close(reason?: string): Promise<void>;
}

/** in-process: 같은 프로세스 안의 쌍. client.send는 server.onMessage로, 그 반대도 같다. */
export type InProcessTransportFactory = () => { readonly client: Transport; readonly server: Transport };

export interface StdioTransportOptions {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  readonly maxFrameBytes?: number;                 // 기본 WIRE_LIMITS.maxFrameBytes
}
export type StdioTransportFactory = (options: StdioTransportOptions) => Transport;

export interface SocketTransportOptions {
  readonly path: string;                           // Unix 소켓 경로. 위치는 L0.os가 정한다
  readonly maxFrameBytes?: number;
}
export type SocketTransportFactory = (options: SocketTransportOptions) => Promise<Transport>;
```

```ts
// wire/transport.ts (계속): 클라이언트가 쓰는 쪽. 전송 종류를 모른다
export interface WireRequestOptions {
  readonly signal?: AbortSignal;                   // 중단하면 $/cancelRequest를 보낸다
  readonly timeoutMs?: number;
  readonly meta?: WireMeta;                        // §3.6. M2 이후
}

export interface HostConnection {
  request<M extends WireMethodName>(method: M, params: WireParams<M>, options?: WireRequestOptions): Promise<WireResult<M>>;
  /** 확장 메서드 ext.<확장>.<동사>(§4.2)를 부른다. 결과 모양은 호스트(X)가 확장 선언으로 이미 검사했으므로 unknown이다. 오류, 시한, 중단은 request와 같다 [결정: 2026-11-03 M4 T-VIEW] */
  requestExtension(extension: string, verb: string, params: Readonly<Record<string, unknown>>, options?: WireRequestOptions): Promise<unknown>;
  onNotification<N extends ServerNotificationName>(name: N, handler: (params: ServerNotificationParams<N>) => void): Unsubscribe;
  /** 클라이언트 알림($/cancelRequest, $/connectionReset)을 보낸다. 응답은 없다. 연결이 닫혔으면 거부한다 [결정: m2 F.8] */
  notify<N extends ClientNotificationName>(name: N, params: ClientNotificationParams<N>): Promise<void>;
  close(): Promise<void>;
  readonly closed: Promise<CloseInfo>;
}

/** 서버 쪽. 처리기 표는 L4 host가 채운다. */
export interface WireRequestContext {
  readonly connectionId: string;
  readonly rpcId: RpcId;
  readonly signal: AbortSignal;                    // $/cancelRequest 또는 연결 종료 때 중단된다
  readonly meta?: WireMeta;
  notify<N extends ServerNotificationName>(name: N, params: ServerNotificationParams<N>): void;
}
export type WireHandler<M extends WireMethodName> = (params: WireParams<M>, context: WireRequestContext) => Promise<WireResult<M>>;
export type WireHandlers = { readonly [M in WireMethodName]: WireHandler<M> };
```

[결정: adr.0020] 클라이언트 쪽 `HostConnection` 구현은 L4 공유 패키지 `@fresnel/client`로 옮겼다(m2 F.8에서 F로 옮긴 것을 되돌린다). F는 런타임 로직 없는 계약과 stdio 줄 프레이밍만 둔다. 소비 패키지가 복사본을 두지 않는다.

```ts
// @fresnel/client(src/connection.ts): 런타임 중립. import는 F(`@fresnel/contracts`)뿐이다
export function createHostConnection(transport: Transport, options?: HostConnectionOptions): HostConnection;
export interface HostConnectionOptions {
  readonly defaultTimeoutMs?: number;                         // 요청마다 따로 주지 않았을 때의 시한. 없으면 시한 없음
  readonly onTransportError?: (cause: unknown) => void;       // $/cancelRequest 송신 실패 같은, 응답을 기다리지 않는 전송의 실패(진단용)
}
export class HostClientError extends Error {                  // 서버가 응답하지 못한 요청의 끝. 서버가 오류로 응답한 경우는 WireError다
  readonly kind: "closed" | "timeout" | "aborted" | "sendFailed" | "invalidResponse";
  readonly closeInfo: CloseInfo | undefined;
}

// wire/stdio.ts, wire/framing.ts: JSON Lines. StdioTransportFactory의 구현
export const createStdioTransport: StdioTransportFactory;
export function createStdioTransportWith(options: StdioTransportOptions, deps?: { readonly logger?: Logger }): Transport;
export function createLineFramer(options?: { readonly maxFrameBytes?: number }): LineFramer;  // 줄 프레이밍. 조각 경계, 한도 초과 줄 버리기
```

- 요청 id는 연결마다 `r1`, `r2`, …로 발급한다. 응답은 `WIRE_METHODS[m].result`로, 알림은 `WIRE_NOTIFICATIONS[n].params`로 검증한 뒤 넘긴다. 맞지 않는 응답은 `HostClientError("invalidResponse")`이고 맞지 않는 알림은 처리기를 부르지 않는다(TY-10).
- 전송은 수신 순서를 지키고, 처리기가 붙기 전에 도착한 메시지는 첫 처리기가 붙을 때 비운다. 처리기 없이 EOF가 오면 쌓인 메시지를 먼저 비운 뒤 닫힘을 알린다. 송신은 직렬이다(앞 쓰기가 끝난 뒤 `writer.ready`를 기다려 다음을 쓴다).
- `createStdioTransport`와 줄 프레이밍(`wire/stdio.ts`, `wire/framing.ts`)은 F에 남는다. 서버 쪽 `@fresnel/platform-process`(L0)와 `@fresnel/host`가 같은 코드를 쓰고, L0와 호스트는 L4인 `@fresnel/client`를 import할 수 없기 때문이다. 클라이언트(CLI, 데스크톱 WebView)는 `@fresnel/client/stdio`로 가져온다(F 구현을 다시 내보낸다. Node 모듈을 끌어오지 않는다). `createHostConnection`은 `@fresnel/client`(`.`)에서 가져오고, `@fresnel/cli`와 `@fresnel/host`(`./client`)는 이를 다시 내보내기만 한다.
- [결정: adr.0020] `Transport` 인터페이스(위)가 전송을 꽂는 자리다. 소켓 전송(M3b)과 브라우저 전송(M4)은 이 인터페이스를 구현해 `createHostConnection`에 넘긴다. `@fresnel/client`는 `Transport` 타입을 다시 내보낸다.
- [미결] 줄 프레이밍과 stdio 전송 구현도 `@fresnel/client`로 옮길지(adr.0020 §3.4). 서버 쪽 소비자(L0 `platform-process`, `apps/host`)가 있어 옮기려면 서버용 구현을 따로 두어야 한다.

- [제안] `HostConnection`과 처리기 표는 전송 종류에 따라 바뀌지 않는다. 전송 적합성 스위트(§9 수용 기준 A10)가 in-process와 stdio에서 같은 케이스를 돌려 이를 확인한다.
- [제안] in-process 전송도 envelope 검사, 메서드 이름 검사, params 검사를 똑같이 한다. 직렬화만 건너뛴다. 개발 빌드는 JSON 왕복(`JSON.parse(JSON.stringify(m))`) 검사를 켤 수 있다. 그래야 in-process에서만 통과하는 비직렬화 값(함수, `undefined`, `Date`, `bigint`)이 생기지 않는다.
- 클라이언트 쪽 `request`의 id 발급은 연결마다 `r1`, `r2`, …를 쓴다(19 §3.3.1과 같다).

### 3.2 JSON-RPC 2.0 규칙

19 §3.3.1을 이식한다. 달라진 점과 그대로인 점을 한 표에 둔다.

| 규칙 | 19 §3.3.1 | Fresnel | 표지 |
|---|---|---|---|
| `jsonrpc: "2.0"` 필수 | 같음 | 같음 | [제안] |
| 배치(배열 메시지) | 거부, `-32600` 하나(`id: null`) | 같음. 받으면 `-32600` 하나(`id: null`)를 보내고 연결은 유지한다 | [제안] |
| `id` | 문자열 1~64자 `[A-Za-z0-9._:-]`, 숫자·`null`은 `-32600` | 같음 | [제안] |
| 진행 중 `id` 재사용 | `-32600` | 같음 | [제안] |
| `params` | 항상 객체. 배열은 `-32602`. 없으면 `{}` | 같음 | [제안] |
| `result` | 항상 객체 | 같음. 결과가 없으면 `{}` | [제안] |
| 메서드 이름 | `<영역>.<동사>` 소문자 낙타(M4부터 `<영역>.<하위>.<동사>`도 있다. 예 `work.tasks.list`), `$/` 제어 예약 | 같음. 확장 메서드는 `ext.<확장id>.<동사>`(M2 이후, §4.2) | [제안] |
| 알림 이름 | 메서드와 같은 규칙. 예외로 `events` | 예외 없이 같은 규칙. 내구 이벤트 알림은 `events.batch` | [제안] |
| 서버 → 클라이언트 요청 | 보내지 않음 | 보내지 않는다. 승인은 내구 이벤트 + 응답 메서드(§4.6) | [결정: review.decisions-2 U-02] |
| 클라이언트 → 서버 알림 | `$/cancelRequest`, `presence.report` | `$/cancelRequest` 하나 | [제안] |
| 값 규칙 | strict JSON, 안전 정수, 시각은 ISO 8601 UTC 문자열 | 같음 | [제안] |
| 깊이·길이 한도 | 깊이 64, 배열 10,000 | 같음. 그 위에 프레임 1 MiB(omp RPC v2와 같은 값, `_research/item-catalog.md` F절) | [제안] |
| envelope 검사 | `additionalProperties: false` | 같음 | [제안] |
| 핸드셰이크 | `hello` + 기기 토큰·챌린지 인증 | `host.hello` 하나. in-process와 stdio는 부모-자식이라 인증이 없고, 로컬 Unix 소켓은 파일 권한(0600)으로 막는다. TCP로 열 때만 `auth.token`이 필수다 [결정: review.m3-design-inputs D-M3-16 c, M3-REQ-19] | [결정] |
| 제외 | Tailscale·SSH 경로, 기기 페어링, 기기 인증, `clientKind` 대조, `localConfirm` | 가져오지 않는다. 데몬·홈서버 전제다(`_research/decisions-log.md` 2026-10-19). 원격 사용은 로컬 서비스 소켓을 SSH 터널이나 사설망으로 잇는 방식이라 프로토콜에 원격 전용 요소를 더하지 않는다([결정: review.decisions-2 U-11]) | [결정] |

```ts
// wire/jsonrpc.ts
import { Type, type Static } from "typebox";

export const WIRE_LIMITS = {
  maxDepth: 64,
  maxArrayLength: 10_000,
  maxFrameBytes: 1_048_576,         // 1 MiB. stdio·socket 프레임 하나
  maxMethodNameLength: 96,
} as const;                         // 코드에서는 명시 타입 주석을 단다

export const RpcId = Type.String({ minLength: 1, maxLength: 64, pattern: "^[A-Za-z0-9._:-]+$" });
export const MethodNameString = Type.String({ minLength: 1, maxLength: 96 });
export const Params = Type.Record(Type.String(), Type.Unknown());

export const JsonRpcRequest = Obj({
  jsonrpc: Type.Literal("2.0"),
  id: RpcId,
  method: MethodNameString,
  params: Params,
});
export const JsonRpcNotification = Obj({
  jsonrpc: Type.Literal("2.0"),
  method: MethodNameString,
  params: Params,
});
export const JsonRpcSuccess = Obj({
  jsonrpc: Type.Literal("2.0"),
  id: RpcId,
  result: Params,
});
export const JsonRpcFailure = Obj({
  jsonrpc: Type.Literal("2.0"),
  id: Type.Union([RpcId, Type.Null()]),     // null은 id를 읽을 수 없을 때만
  error: JsonRpcError,                          // §3.5
});
export const JsonRpcMessage = Type.Union([JsonRpcRequest, JsonRpcNotification, JsonRpcSuccess, JsonRpcFailure]);

export type JsonRpcRequest = Static<typeof JsonRpcRequest>;
export type JsonRpcNotification = Static<typeof JsonRpcNotification>;
export type JsonRpcSuccess = Static<typeof JsonRpcSuccess>;
export type JsonRpcFailure = Static<typeof JsonRpcFailure>;
export type JsonRpcMessage = Static<typeof JsonRpcMessage>;
export type RpcId = Static<typeof RpcId>;

/** 순수 함수. 깊이·배열 길이 한도와 envelope 스키마를 함께 검사한다. 프레임 크기는 전송이 먼저 검사한다. */
export type EnvelopeIssue =
  | { readonly code: "batch" }
  | { readonly code: "depth"; readonly depth: number }
  | { readonly code: "arrayLength"; readonly length: number }
  | { readonly code: "schema"; readonly path: string; readonly message: string }
  | { readonly code: "methodName"; readonly method: string };
export type EnvelopeCheck =
  | { readonly ok: true; readonly message: JsonRpcMessage }
  | { readonly ok: false; readonly errorCode: -32600 | -32602; readonly issue: EnvelopeIssue };
export declare function checkEnvelope(value: unknown): EnvelopeCheck;
```

메서드 이름 검사 함수:

```ts
// wire/methods.ts
export const METHOD_NAME_PATTERN = "^(\\$/[a-z][A-Za-z0-9]*|[a-z][A-Za-z0-9]*\\.[a-z][A-Za-z0-9]*|ext\\.[a-z][a-z0-9-]*\\.[a-z][A-Za-z0-9]*)$";
export type MethodNameKind = "core" | "control" | "extension";
export declare function classifyMethodName(name: string): MethodNameKind | undefined;   // 규칙 위반이면 undefined
```

- `core`: `<영역>.<동사>` 두 마디. 예: `turn.start`, `events.subscribe`.
- `control`: `$/` 접두. 예: `$/cancelRequest`.
- `extension`: `ext.<확장id>.<동사>`. `<확장id>`는 `F.extensions.spec`의 `ExtensionName`(`^[a-z][a-z0-9-]{1,31}$`)이다.

### 3.3 메서드 레지스트리

#### 3.3.1 메서드 표

params와 result는 TypeBox 요약이다. 전체 스키마는 `wire/methods.ts`에 둔다. "단계"는 처음 구현하는 마일스톤이다. 상태는 모두 `active`이고 `since: "0.1.0"`이다.

| 영역 | 메서드 | params | result | 단계 |
|---|---|---|---|---|
| host | `host.hello` | `{ protocolVersion: SemVer, client: {name, version, kind: "cli"\|"desktop"\|"other"}, experimental?: FeatureName[], auth?: { token: string } }`(`auth`는 M2) | `{ protocolVersion: SemVer, server: {name, version}, storeId: StoreId, transport: TransportKind, features: FeatureInfo[], experimental: FeatureName[] }` | M1 |
| host | `host.status` | `{ includeBinaries?: boolean }` | `{ mode: "in-process"\|"stdio"\|"service", pid: integer, startedAt: IsoTime, connections: integer, liveTurns: integer, waitingApprovals?: integer(1..), idleShutdownAt: IsoTime \| null, binaries?: HostBinaryReport, safeMode?: boolean, safeModeCause?: "user"\|"startupFailures"\|"flag", startupFailures?: integer, suggestSafeMode?: boolean }` | M2 |
| host | `host.shutdown` | `{ reason: "client_exit"\|"version_replace"\|"user", deadlineMs?: integer }` | `{ accepted: boolean }` | M2 |
| host | `host.clients` | `{}` | `{ clients: { connectionId: string, transport: "in-process"\|"stdio"\|"socket", name?: string, version?: string, writeThreads: integer, observedThreads: integer, self: boolean }[] }`. 연결마다 한 행이고 요청한 연결(`self`)이 맨 앞이다(최대 256개). `name`과 `version`은 `host.hello`를 마친 연결만 싣는다. 인증 토큰은 싣지 않는다 | M4 (W-12) |
| thread | `thread.list` | `{ cursor?: string, limit?: integer(1..200), workspace?: string }` | `{ threads: ThreadSummary[], nextCursor: string \| null }` | M2 |
| thread | `thread.create` | `{ workspace?: string, title?: string, testRun?: boolean, profileId?: string }`(`testRun`, `profileId`는 M4, W-34) | `{ threadId: ThreadId, position: StreamPosition }` | M1 |
| thread | `thread.open` | `{ threadId: ThreadId, mode: "write"\|"observe", includeItems?: boolean, limit?: integer(1..500) }` | `{ threadId: ThreadId, role: "owner"\|"observer", position: StreamPosition, items?: ItemRecord[], hasMore?: boolean, asOfSeq?: integer }` | M2 |
| thread | `thread.read` | `{ threadId: ThreadId, limit?: integer(1..500), before?: ItemId, around?: ItemId }`(`around`는 M4, W-16) | `{ threadId: ThreadId, items: ItemRecord[], position: StreamPosition, hasMore: boolean }` | M2 |
| thread | `thread.close` | `{ threadId: ThreadId }` | `{}` | M2 |
| thread | `thread.delete` | `{ threadId: ThreadId }` | `{}` | M2 |
| thread | `thread.fork` | `{ threadId: ThreadId, at?: ItemId }` | `{ threadId: ThreadId, position: StreamPosition }` | M2 |
| thread | `thread.revert` | `{ threadId: ThreadId, to: ItemId }` | `{ position: StreamPosition }` | M2 |
| thread | `thread.rename` | `{ threadId: ThreadId, title: string(1..200) }` | `{ position: StreamPosition }` | M2 |
| model | `models.list` | `{}` | `{ models: { ref: string, name: string, contextWindow: integer, reasoning: boolean, inputPrice: number \| null, outputPrice: number \| null }[] }`(최대 1000) | M4 |
| thread | `thread.setModel` | `{ threadId: ThreadId, model: string(1..200) \| null }` | `{ position: StreamPosition }` | M4 |
| thread | `thread.compact` | `{ threadId: ThreadId, instructions?: string(1..20000) }` | `{ status: "compacted", eventId: EventId, tokensBefore: integer, tokensAfter: integer, fromExtension: string \| null, position: StreamPosition }`, `{ status: "skipped", why: "nothing_to_summarize"\|"last_entry_is_compaction"\|"disabled" }` | M2 |
| thread | `thread.export` | `{ threadId: ThreadId, format: "markdown"\|"json", after?: ItemId }` | `{ format: "markdown"\|"json", filename: string(1..200), chunk: string, next?: ItemId, itemCount: integer }`. 쪽 나누기, 가림, 파일 이름은 §3.4.7 | M4 |
| turn | `turn.start` | `{ threadId: ThreadId, input: TurnStartInput, requestId?: string(1..64), whenBusy?: "steer"\|"followUp"\|"aside" }` | `{ turnId: TurnId, queued?: true }`. `whenBusy`와 `queued`는 §3.3.1 0a | M1 |
| turn | `turn.interrupt` | `{ threadId: ThreadId, turnId?: TurnId }` | `{ interrupted: boolean }` | M2 |
| turn | `turn.resume` | `{ threadId: ThreadId }` | `{ status: "resumed", turnId: TurnId, from: ResumeFrom }`, `{ status: "closed", turnId: TurnId, reason: "abort_requested"\|"owner_cancelled" }`, `{ status: "nothing" }` | M2 |
| turn | `turn.withdraw` | `{ threadId: string, requestId: string(1..64) }` | `{ withdrawn: boolean }`. 큐에 넣고 아직 배치되지 않은 입력을 요청 키로 거둔다. 쓰기 소유자만 한다(`turn.interrupt`와 같다). 요청 키가 맞는 대기 입력을 찾지 못했거나 이미 배치됐으면 거짓이다 | M4 (W-17) |
| events | `events.subscribe` | `{ from: StreamPosition \| "head", filter?: EventFilter }` | `{ sub: SubId, start: Seq, headSeq: Seq, storeId: StoreId, mode: "replaying"\|"live" }` | M1 |
| events | `events.unsubscribe` | `{ sub: SubId }` | `{}` | M2 |
| approval | `approval.respond` | `{ approvalId: string, decision: "allow"\|"deny"\|"answer", answer?: ApprovalAnswer, remember?: "once"\|"thread"\|"always" }` | `{ applied: boolean, reason?: "answer_invalid"\|"already_resolved"\|"unknown_approval"\|"commit_failed", detail?: string }` | M2 |
| approval | `approval.list` | `{ threadId?: ThreadId }`(생략하면 열려 있는 모든 대화, M4, W-01) | `{ approvals: PendingApproval[], position: StreamPosition }` | M2 |
| command | `command.list` | `{ prefix?: string, includeHidden?: boolean, threadId?: ThreadId }` | `{ commands: CommandInfo[] }` | M2 |
| command | `command.run` | `{ threadId: ThreadId, text: string, confirmShell?: boolean }` | `CommandRunOutput` | M2 |
| trust | `trust.get` | `{ workspace: string }` | `TrustStatus` | M2 |
| trust | `trust.decide` | `{ workspace: string, choice: { kind: "folder"\|"parent"\|"session", verdict: "allow"\|"deny" } }` | `TrustStatus` | M2 |
| settings | `settings.get` | `{ keys?: SettingKey[], threadId?: ThreadId }` | `{ settings: EffectiveSetting[] }` | M1 |
| settings | `settings.set` | `{ key: SettingKey, value: unknown, scope: SettingScope, threadId?: ThreadId }` | `{ setting: EffectiveSetting }` | M2 |
| settings | `settings.reset` | `{ key: SettingKey, scope: SettingScope, threadId?: ThreadId }` | `{ setting: EffectiveSetting }` | M2 |
| settings | `settings.list` | `{ prefix?: string, includeDeprecated?: boolean, includeReserved?: boolean }` | `{ defs: SettingDefWire[] }` | M2 |
| settings | `settings.readFile` | `{ scope: "managed"\|"user"\|"project"\|"local", threadId?: ThreadId }` | `{ scope, path: string \| null, exists: boolean, readOnly: boolean, text: string, sha256: string \| null, unknownKeys: string[] }` | M3 |
| settings | `settings.writeFile` | `{ scope: "user"\|"project"\|"local", text: string, baseSha256: string \| null, threadId?: ThreadId }` | `{ path: string, sha256: string, unknownKeys: string[] }` | M3 |
| status | `status.list` | `{ threadId: ThreadId }` | `{ items: StatusItem[] }` | M3 |
| attachments | `attachments.add` | `{ threadId?: ThreadId, source: AttachmentSource }` | `{ attachment: Attachment, parts: (TextContent\|ImageContent)[] }` | M3 |
| notify | `notify.list` | `{ threadId?: ThreadId, afterSeq: integer, kinds?: NoticeKind[], limit?: integer(1..500) }` | `{ notices: Notice[], nextSeq: integer }` | M3 |
| web | `web.providers` | `{}` | `{ providers: WebProviderStatus[](최대 64), settings: WebSettings }`. 모양은 아래 글머리 | M3 |
| usage | `usage.get` | `{ providerId?: string, threadId?: ThreadId }` | `{ gauges: UsageGauge[], asOf: IsoTime, context?: { model: string, used: number, limit: integer } }`(`context`는 M4 T-MODEL) | M3 |
| secret | `secret.list` | `{ meta?: boolean, usage?: boolean }` | `{ secrets: SecretListEntry[] }` | M2 |
| secret | `secret.meta` | `{ name: SecretName, …메타·정책 필드 }` | `{ secret: SecretListEntry }` | M2 |
| secret | `secret.remove` | `{ name: SecretName }` | `{ removed: boolean }` | M2 |
| secret | `secret.test` | `{ name: SecretName }` | `{ state: "registered"\|"missing", decryptable: boolean, length: integer \| null, sha256Prefix: string \| null }` | M2 |
| secret | `secret.references` | `{ name: SecretName }` | `{ settingKeys: SettingKey[], activeLeases: integer, sessions: ThreadId[] }` | M2 |
| secret | `secret.audit` | `{ name: SecretName, limit?: integer }` | `{ entries: SecretAuditEntry[] }` | M4 |
| secret | `secret.beginEntry` | `{ name: SecretName, action: "add"\|"set"\|"rotate", meta?: SecretEntryMeta }` | `{ started: boolean }` | M2 |
| secret | `secret.beginReveal` | `{ name: SecretName }` | `{ started: boolean }` | M2 |
| proposal | `proposal.list` | `{ source?: "learning"\|"knowledge", status?: ProposalStatusWire[], limit?: integer(1..200), cursor?: string }` | `{ proposals: ProposalRow[], nextCursor: string \| null, unavailable: ProposalSource[] }` | M3 |
| proposal | `proposal.decide` | `{ source, id: string, decision: "approve", revision: integer, scope?: "user"\|"project" }`, `{ source, id, decision: "reject", note?: string }`, `{ source, id, decision: "edit", revision: integer, body: string }`, `{ source, id, decision: "revert" }` | `{ ok: true, proposal: ProposalRow, applied: boolean }`, `{ ok: false, reason: ProposalDecideFailure, detail?: string }` | M3 |
| schedule | `schedule.create` | `{ trigger: ScheduleTrigger, prompt: string(1..20000), workspace?: string(최대 4096), title?: string(1..200), enabled?: boolean }` | `{ ok: true, entry: ScheduleEntryView, warnings: "service_mode_off"[] }`, `{ ok: false, error: ScheduleError }` | M3 |
| schedule | `schedule.list` | `{ enabled?: boolean, before?: ScheduleId, limit?: 1..200 }` | `{ ok: true, items: ScheduleListItem[](최대 200), nextBefore?: ScheduleId }`, `{ ok: false, error: ScheduleError }` | M3 |
| schedule | `schedule.cancel` | `{ scheduleId: ScheduleId }` | `{ ok: true, entry: ScheduleEntryView }`, `{ ok: false, error: ScheduleError }` | M3 |
| schedule | `schedule.fire` | `{ scheduleId: ScheduleId }` | `{ ok: true, run: RunView }`, `{ ok: false, error: ScheduleError }` | M3 |
| ext | `ext.list` | `{ threadId?: string }` | `{ extensions: ExtListEntry[] }`. 행은 확장 하나: `isGroup`, 유효 층 `layer`, 대표 Registration의 `status`·`registration?`(대화 상태)·`enabledSource?`, Registration마다 `plugins: { registrationId, id?, layer, status, thread?, inGroup, enabledSource? }[]`, `hookCount`. 행의 `origin`은 실린 위치(`builtin`, `managed`, `user`, `project`)다. 작업 폴더 확장은 신뢰된 작업 폴더에서 로더가 실은 것이 로더 목록에서 바로 나온다. 선택 필드 `keepOffQuestion: { rule: "consecutive"\|"rate", consecutive, windowFailures }`가 있으면 그 확장이 자동 끄기 기준을 넘어 사용자에게 "끌까요"를 묻는 중이고 아직 켜 둔 채다 [결정: 2026-11-04 사용자, 앞선 B5의 시작 3회 질문을 대체]. "끄기"는 `ext.disableConfirm`, "켜 두기"는 `ext.reenable`이다 | M4 (W-15, W-41) |
| ext | `ext.get` | `{ name: string }` | `{ entry: ExtListEntry, manifest, hooks: ExtHookInfo[], bindings: ExtBindingEdge[] }` | M4 (W-20) |
| ext | `ext.reenable` | `{ name: string }` | `{ appliesAt: "nextStepBoundary"\|"now", diagnostics: ExtDiagnostic[] }` | M4 (W-21) |
| ext | `ext.disableConfirm` | `{ name: string }` | `ext.reenable`과 같음. "끌까요" 질문(`ExtListEntry.keepOffQuestion`)에 "끄기"로 답한다. 호스트가 `AutoDisabler.answer(ext:<이름>, true)`로 끄고 내구 `scope.changed`(reason `auto_disable`)를 남긴다. 질문이 없으면 아무 일도 하지 않고 같은 결과를 돌려준다 [제안]. "켜 두기"는 `ext.reenable`이다 [결정: 2026-11-04 사용자, 질문과 답은 사용자 결정, 메서드 이름과 이 모양은 제안] | M4 |
| ext | `ext.reload` | `{ name: string }` | `ext.reenable`과 같음. `appliesAt`은 `now`(실행 중인 thread가 없어 이 응답 전에 적용을 끝냈다)이거나 `nextStepBoundary`(실행 중인 turn의 step이 끝난 경계에 적용한다)다. 새 버전의 검사나 적용이 실패하면 `diagnostics`에 `error`가 있고 옛 버전이 그대로 돈다 | M4 (W-38) |
| ext | `ext.health` | `{ name?: string, threadId?: string }` | `{ health: ExtHealthEntry[] }`(Registration 단위). 실패 장부 창은 최근 호출 수라서 `windowMs`는 창 안 가장 오래된 호출부터 지금까지의 시간이고 `windowCalls`가 창 안 호출 수다. 호출이 없으면 둘 다 0 | M4 (W-22) |
| ext | `ext.timings` | `{ name: string, threadId?: string }` | `{ traceEnabled: boolean, timings: ExtHookTiming[] }` | M4 (W-23) |
| ext | `ext.versions` | `{ name: string }` | `{ versions: ExtVersionEntry[], bundledVersion?: string }`. `bundledVersion`은 기본 플러그인의 앱에 든 번들 판이고 `version`과 같은 문자열 규칙을 따른다. 확장이 기본 플러그인이 아니거나 번들이 없거나 매니페스트를 읽지 못하면 없다. 번들과 작업 폴더 위치의 확장은 `versions`가 빈 목록이고 `bundledVersion`도 없다 | M4 (W-31) |
| ext | `ext.rollback` | `{ name: string, version: string, clearState?: boolean }` | `{ appliesAt: "nextStepBoundary"\|"restart", stateCleared: boolean }`. 실린 외부 확장은 열린 대화가 있어도 단계 경계에서 새 버전으로 바뀐다(`nextStepBoundary`). 실리지 않은 확장은 재시작 뒤(`restart`)다. 경계를 기다리는 동안은 `stateCleared`가 거짓이다 | M4 (W-31) |
| ext | `ext.bindings` | `{ threadId?: string }` | `{ capabilities: CapabilityBinding[] }`(Registration 단위 엣지). `provider`는 ExtHost가 지금 실제로 바인딩한 공급자다(선언만 있고 바인딩되지 않았으면 null이고 `unmet`이 참) | M4 (W-40) |
| ext | `ext.validateComposition` | `{ composition: CompositionDecl, plugins?: PluginDecl[], threadId?: string }` | `{ issues: ManifestIssue[] }` | M4 (W-47) |
| ext | `ext.ui.list` | `{ threadId?: string }` | `{ items: ExtUiEntry[] }`. 행은 화면 기여 하나다. `version`(SemVer, 매니페스트 값, builtin도 채운다), `trust`(설치 등급 `builtin`·`user`·`project`·`managed`, `origin`과 같은 네 값, builtin은 설치 폴더가 없다), `appRoot?`(절대 경로 = 확장 설치 폴더에 선언된 app root 폴더를 이은 것, 최대 1024자)를 싣는다. card 항목은 `forKind`(레코드 kind)를 싣는다. `appRoot`는 `mode`가 `app`이고 `state`가 `ok`인 항목에만 있고 builtin 항목에는 없다. 스키마는 상대 경로도 받지만 호스트는 절대 경로만 낸다 [결정: 2026-11-04 사용자]. `messages?`(로케일 `ko`·`en` -> 키 -> 문장)는 확장의 `ui.messages` 폴더에서 읽은 카탈로그이고, 화면 `title`과 화면 트리의 정적 글 prop이 이 키이면 클라이언트가 현재 로케일, 영어, 키 자체 순으로 푼다(ADR-0021 §3.8) [결정: 2026-11-04 T-I18N 기본값] | M4 (W-33) |
| ext | `ext.ui.post` | `{ extension, ui, threadId: string, name: string, payload?: unknown, requestId?: string(1..64) }` | `{ accepted: boolean }` | M4 (W-33) |
| ext | `ext.ui.requestApproval` | `{ extension, ui, threadId: string, method: string, params?: unknown, requestId?: string(1..64) }` | `{ approvalId: string }` | M4 (W-33) |
| group | `group.list` | `{ threadId?: string }` | `{ groups: GroupStatusWire[] }` | M4 (W-24) |
| group | `group.metrics` | `{ id: string, threadId?: string, since?: IsoTime }` | `{ id, metrics: GroupMetricsFull \| null, since: IsoTime \| null, sinceIgnoredBy?: string[] }`. 토큰(입력, 출력, 캐시 읽기, 캐시 쓰기)과 `costUsd`는 이벤트 접기 하나에서 온다(drive 턴의 `turn.completed`와 자식의 `agent.settled.usage`, 후자는 `owner`로 귀속). 그래서 재시작해도 같고 두 번 세지 않는다. `since`는 이벤트에서 접는 값(`leases`, `leaseMs`, 토큰, `costUsd`)을 거른다. 메모리 카운터 값(`denies`, `posts` 같은 개수)은 프로세스가 뜬 뒤의 누계라 거르지 못한다. `since`가 있으면 `sinceIgnoredBy`가 그 지표 이름을 싣는다 | M4 (W-25) |
| group | `group.promotion` | `{ threadIds?: string[] }` | `{ throughSeq, threads, candidates: PromotionCandidate[] }` | M4 (W-26) |
| group | `group.driveLock` | `{ threadId: string }` | `{ holder, leaseEpoch, activeDriver, limits, used, candidates: DriveLockWait[], lastRejected }` | M4 (W-42) |
| hooks | `hooks.list` | `{ threadId?: string }` | `{ hooks: HookEntry[] }`. `threadId`를 주면 그 thread의 작업 폴더·로컬 범위 훅도 외부 훅 줄에 든다. 폴더를 신뢰하지 않았으면 그 층을 읽지 않으므로 그 훅은 줄이 없다(실행되지 않는 훅을 "켜짐"으로 보이지 않는다) [결정: 2026-11-04 hookord 기본값]. 없는 thread면 `thread.notFound`다. 생략하면 관리·사용자 범위만이다. 행의 `order`는 호스트 핸들러 레지스트리에 실제로 등록된 핸들러를 디스패치 순서(F.extensions.spec §4.2: tier, 확장 로드 순서, 등록 순서)로 센 `HookHandlerRow[]`(`registrationId`, `extension`, `tier`, `status`, `error`)다. 레지스트리에서 빠진 꺼진 Registration과 setup에 실패한 Registration은 선언한 Hook이 `tier: null`로 뒤에 붙고 `status`·`error`가 그 상태를 말한다. 로더가 통째로 내린 확장(`error` 상태)은 Registration이 없어 `ext.list` 진단에만 있다. `handlers`·`registrations`는 이 목록에서 `tier`가 있는 행만 같은 순서로 낸다(매니페스트 선언에서 만들지 않는다) 외부 훅(설정 `x.operations.hookDefs`의 훅)은 자기 줄을 가진다 [제안: 2026-11-04 hookrun]: `hook`이 훅 id, 선택 필드 `point`(걸린 훅 이름)와 `source`(적힌 설정 범위)가 있고 `external`은 참이다. 훅 이름 줄(`point`가 없는 줄)의 `order`에는 외부 훅이 자기 id로 끼며(`registrationId`와 `extension`은 그 훅의 내장 단위 `fresnel-hooks-<훅 id>`이고 `hooks.order.*`의 이름과 같다), 디스패치와 같이 tier 순위 순이고 같은 순위에서는 확장 뒤에 온다. 정의가 지금 보이지 않는 훅(다른 작업 폴더의 훅)도 질문이나 꺼짐이 있으면 `fold` `external`, `handlers` 0인 줄이 남는다. 선택 필드 `keepOffQuestion { rule, consecutive, windowFailures }`가 있으면 그 외부 훅 줄(`hook:<hook>`, `hook`은 훅 id)이 자동 끄기 기준을 넘어 "끌까요"를 묻는 중이고 아직 켜 둔 채다 [결정: 2026-11-04 사용자]. `autoDisabled`가 참이면 사용자가 끄거나 자동으로 꺼진 훅이다(설정 `x.operations.hookDisabled`에 남아 재시작 뒤에도 유지) [결정: 2026-11-04 사용자, 키 이름은 제안]. 둘 다 없으면 싣지 않는다 | M4 (W-36) |
| hooks | `hooks.disableConfirm` | `{ hook: string }` | `ext.reenable`과 같음(`{ appliesAt, diagnostics }`). 훅 "끌까요" 질문(`HookEntry.keepOffQuestion`)에 "끄기"로 답한다. 호스트가 먼저 설정 `x.operations.hookDisabled`(user 범위)에 훅 id를 쓰고(쓰기가 실패하면 끄지 않고 설정 오류를 돌려준다), `AutoDisabler.answer(hook:<hook>, true)`로 끈다. 질문도 꺼짐 기록도 없는 훅이면 `hooks.notFound`, 안전 모드면 `extension.safeModeActive`다 [결정: 2026-11-04 사용자, 재시작 뒤 유지는 사용자 결정, 메서드 이름과 모양은 제안] | M4 |
| hooks | `hooks.reenable` | `{ hook: string }` | `hooks.disableConfirm`과 같은 결과와 오류. "켜 두기"(질문이 있으면 `answer(hook:<hook>, false)`로 장부를 비운다)와 "다시 켜기"(저장된 꺼짐을 지우고 `AutoDisabler.reenable(hook:<hook>)`)를 함께 맡는다 [결정: 2026-11-04 사용자, 메서드 이름과 모양은 제안] | M4 |
| hooks | `hooks.order.get` | `{}` | `{ hooks: HookOrderEntry[] }`. 저장된 순서 덮어쓰기(`x.operations.hookOrder`)가 있거나 적용 중인 훅마다 한 행: `hook`, `saved`(저장된 Registration id 순서), `applied`(디스패처가 지금 쓰는 순서), `pending`(저장 값과 적용 값이 다르다. 다음 단계 경계에 적용된다). 덮어쓰기가 없는 훅은 나오지 않는다. [결정: 2026-11-03 사용자] guard 핸들러도 순서 칸에 다른 핸들러와 같이 나온다 | M4 (W-51) |
| hooks | `hooks.order.set` | `{ hook: string, order: string[](Registration id, 최대 256) }` | `{ hook, saved: string[], appliesAt: "nextStepBoundary" }`. `saved`는 제안한 순서를 지킨 중복 없는 저장 값이다(guard 핸들러 이름도 남는다). 이름이 없는 핸들러는 기본 자리를 지키고, 지워졌거나 싣지 않았거나 꺼진 핸들러의 이름은 오류 없이 저장되고 디스패치에서 무시된다. guard 핸들러를 옮겨도 거절하지 않는다. [결정: 2026-11-03 사용자] 모르는 훅이면 `hooks.notFound`다. 외부 훅도 훅마다 Registration(`fresnel-hooks-<훅 id>`, X.operations §4.7.4)이라 다른 핸들러처럼 순서에 넣는다 [결정: 2026-11-03 사용자, 15-2]. 그 밖에는 저장을 막는 사유가 없다 [근거: packages/ext-host/src/operations/hook-order.ts `checkOrder`] | M4 (W-51) |
| hooks | `hooks.order.reset` | `{ hook?: string }` | `{ hooks: string[], appliesAt: "nextStepBoundary" }`. 그 훅(생략하면 모든 훅)의 저장된 덮어쓰기를 지우고 기본 순서로 돌린다. `hooks`는 실제로 지운 훅이다. 저장된 값이 없으면 빈 목록이다. 모르는 훅이면 `hooks.notFound` | M4 (W-51) |
| hooks | `hooks.order.preview` | `{ hook: string, order: string[] }` | `{ hook, order: string[], saveable: true, skips: HookSkipNote[], valueChanges: HookValueChangeNote[], autoDisable: HookAutoDisableNote[], guardRisk: HookGuardRiskNote[] }`. 저장하기 전에 읽는다. `order`는 이 제안을 적용했을 때의 전체 순서(덮어쓰기 적용 뒤, 덮어쓰기가 없으면 guard가 먼저)다. `skips`는 핸들러마다 `reason`(`first_answer`: 앞선 first 핸들러가 답하면 실행되지 않는다, `first_failure_deny`: closed first 훅에서 앞선 핸들러가 실패하면 `FIRST_DENY`가 결정이 되고 디스패치가 멈춘다, `chain_stop`: chain 훅의 멈춤 규칙)와 `by`(앞선 핸들러 `{ registrationId, extension, tier }[]`)를 가진다. `valueChanges`는 건너뜀이 아니라 "값이 바뀔 수 있음"이다: chain에서 뒤 핸들러의 패치가 앞 핸들러의 패치를 덮어쓴다. `autoDisable`은 closed first 훅에서 자동 끄기 대상인 핸들러가 실패하는 동안 가려지는 뒤 핸들러(`affects`)다. guard 핸들러는 면제라 나오지 않는다. 외부 훅 단위 이름이 든 `order`는 `jsonrpc.invalidParams`다(`set`과 같다) [제안]. [결정: 2026-11-03 사용자] `saveable`은 항상 참이다(저장을 막는 사유가 없다 [근거: packages/ext-host/src/operations/hook-order.ts `checkOrder`]). `guardRisk`는 guard 핸들러의 위험 노트다. `mayBeSkipped`는 제안이 앞에 둔 핸들러 때문에 이 훅에서 실행되지 않을 수 있다는 뜻이다(기본 순서에서 이미 앞이던 핸들러는 세지 않는다). `losesFirstPosition`은 기본 순서에서 맨 앞이던 guard가 이 제안에서 맨 앞을 잃었다는 뜻이다. `by`는 앞선 핸들러다. 비어 있지 않으면 UI는 "안전 검사가 건너뛰어질 수 있다"는 강한 경고를 띄운다. `skips`와 따로 낸다 | M4 (W-51) |
| review | `review.get` | `{ reviewId: string }` | `{ reviewId, files: { path, hunks: HunkView[] }[] }` | M4 (W-02) |
| goal | `goal.status` | `{ threadId: string }` | `{ goal: GoalView \| null }` | M4 (W-05) |
| work | `work.tasks.list` | `{ threadId: string }` | `{ tasks: TaskView[] }` | M4 (W-06) |
| work | `work.plans.versions` | `{ threadId: string, planId: string }` | `{ versions: PlanVersion[] }`. 계획 id의 꼴이 맞지 않거나 그 계획이 없으면 `jsonrpc.invalidParams`(path `planId`)다. 기능이 없으면 빈 목록이다 | M4 (W-18) |
| knowledge | `knowledge.skills.view` | `{ name: string(1..128), threadId?: string }` | `{ name, scope: "user"\|"project"\|"extension"\|"path", description, body: string, bodyTruncated: boolean, files: string[], treeHash: string }`. 본문은 앞 20000자까지다(넘으면 `bodyTruncated`가 참). 없는 스킬이면 `jsonrpc.invalidParams`(path `name`), 기능이 없거나 스킬 설정이 꺼져 있으면 `jsonrpc.methodNotFound`다 | M4 (W-14) |
| knowledge | `knowledge.skills.list` | `{ threadId?: string }` | `{ skills: { name, description: string(≤1024), scope: "user"\|"project"\|"extension"\|"path", modelInvocable: boolean }[](≤2000), diagnostics: { severity: "warning"\|"collision", message: string(≤512), path: string(≤1024) }[](≤200) }`. 이 대화의 작업 폴더 기준으로 읽은 색인과, 색인에서 빠진 스킬의 이유(형식 오류, 폴더 신뢰 안 됨)다. 슬래시 목록의 "스킬" 묶음이 쓴다. 스킬 설정이 꺼져 있으면 `jsonrpc.methodNotFound`다 [결정: 오케스트레이터 기본값, scI] | M4 (W-14b) |
| knowledge | `knowledge.memory.read` | `{ stores?: ("user"\|"env")[] }` | `{ stores: MemoryStoreView[] }`. 저장소마다 `{ store, entries: { id, text, chars }[], usedChars, limitChars, fileHash, writeBlocked }`다. `stores`를 생략하면 둘 다 읽는다. 기억 설정이 꺼져 있으면 `jsonrpc.methodNotFound`다 | M4 (W-19) |
| knowledge | `knowledge.memory.add` | `{ store, text: string(1..20000) }` | `{ outcome: WriteOutcome, view: MemoryStoreView }`. 사람이 연 호출이라 승인 없이 적용한다. 한도를 넘으면 `internal`(`memory_full`), 위협 검사에 걸리면 `internal`(`scan_blocked`)이다 | M4 (W-19) |
| knowledge | `knowledge.memory.replace` | `{ store, entryId: string(12 hex), text, baseHash: string(64 hex) }` | 같은 모양. `baseHash`는 읽을 때 받은 `fileHash`다. 그 사이 바깥에서 바뀌었으면 `internal`(`base_stale`)이라 화면이 다시 읽는다 | M4 (W-19) |
| knowledge | `knowledge.memory.remove` | `{ store, entryId, baseHash }` | 같은 모양. 지운 항목은 원장에 남는다 | M4 (W-19) |
| schedule | `schedule.update` | `{ scheduleId: string, enabled?: boolean, title?: string, prompt?: string }` | `{ scheduleId, enabled, nextRunAt: IsoTime \| null }` | M4 (W-07) |
| schedule | `schedule.runs` | `{ scheduleId: string, limit?: integer(1..200) }` | `{ runs: ScheduleRunRecord[] }` | M4 (W-07) |
| profile | `profile.list` | `{}` | `{ profiles: Profile[], rev: integer }` | M4 (W-46) |
| profile | `profile.get` | `{ id: string }` | `{ profile: Profile }` | M4 (W-46) |
| profile | `profile.put` | `{ profile: ProfileInput, baseRev: integer \| null }` | `{ profile: Profile }` | M4 (W-46) |
| profile | `profile.delete` | `{ id: string }` | `{ rev: integer }` | M4 (W-46) |
| profile | `profile.apply` | `{ id: string, threadId?: string, layer?: "user"\|"project"\|"thread" }` | `{ written: string[], layer: "user"\|"project"\|"thread", appliesAt: "nextStepBoundary"\|"now" }` | M4 (W-46) |
| profile | `profile.preview` | `{ id: string, threadId?: string, layer?: "user"\|"project"\|"thread" }` | `{ enabled, disabled, candidates: string[], expectedHolder: string \| null, overrides, hookCount, layer }` | M4 (W-44) |
| settings | `settings.explain` | `{ key: string, threadId: string }` | `{ key, value, winningScope: string \| null, writer: "default"\|"user"\|"profile"\|"testRun"\|"session", profileId? }` | M4 (W-45) |
| trace | `trace.turn` | `{ threadId: string, turnId: string }` | `{ traceEnabled: boolean, retained: boolean, entries: { seq, hook, step, handlers: { registrationId, ms, result, atMs, size, skippedBy, reason }[] }[] }`. `result`는 `modified`·`passed`·`blocked`·`failed`·`skipped`, `atMs`는 Turn 시작 후 시점(ms), `size`는 바뀐 크기, `skippedBy`는 앞 핸들러 때문에 건너뛴 경우 그 RegistrationId(아니면 null), `reason`은 `failed`의 이유(`threw`·`timeout`·`result_invalid`·`merge_rejected`, 아니면 null). 정본은 X.operations §4.8.2다 | M4 (W-43) |
| measure | `measure.turn` | `{ threadId: string, turnId: string }` | `{ enabled: boolean, rows: { at: number, kind: string, metrics: Record<string, number>, tags: Record<string, string> }[] }` | M4 (T-MEAS-READ) |
| measure | `measure.daily` | `{ kind: string, metric: string }` | `{ enabled: boolean, days: { day: string, count: integer, sum: number, min: number, max: number }[] }` | M4 (T-MEAS-READ) |
| testRun | `testRun.pause` | `{ threadId: string }` | `{ paused: boolean }` | M4 (W-48) |
| testRun | `testRun.resume` | `{ threadId: string }` | `{ paused: boolean }` | M4 (W-48) |
| testRun | `testRun.step` | `{ threadId: string }` | `{ paused: boolean }` | M4 (W-48) |
| testRun | `testRun.phase` | `{ threadId: string }` | `{ phase: string \| null, group: string \| null, seq: integer \| null, paused: boolean, lock: { holder: string \| null, status: "active"\|"releasing"\|"none", epoch: integer \| null }, guardHits: integer, traceEnabled: boolean, boundaries: { seq: integer, phase: string \| null, paused: boolean }[] }`. 모든 칸은 필수다. `boundaries`는 최대 200개이고 오래된 것부터다(마지막이 가장 최근). 정본은 `TestRunPhaseResultSchema`(`extensions/trace-types.ts`)다 | M4 (W-50) |
| ext | `ext.kinds` | `{}` | `{ kinds: KindEntry[] }`. `KindEntry.id`는 `single-plugin` 또는 `plugin-group`이고 `layers`는 그 종류가 쓸 수 있는 층이다 | M4 (W-27) |
| ext | `ext.scaffold` | `{ kind: "single-plugin"\|"plugin-group", name: string, dir: string, layer?: ExtensionLayer, group?: { members?: string[], composition?: CompositionDecl }, ui?: UiDecl }` | `{ dir: string, files: string[] }` | M4 (W-27) |
| ext | `ext.validate` | `{ dir: string }` | `{ ok: boolean, issues: DevkitIssue[] }`(`schemaVersion: 2` 매니페스트 검사 결과) | M4 (W-28) |
| ext | `ext.package` | `{ dir: string, out?: string }` | `{ path: string, files: string[], sha256: string }` | M4 (W-49) |
| ext | `ext.installPreview` | `{ source: string }` | `InstallPreview`(`name`, `version`, `displayName`, `description`, `source`, `sha256`, `trustRequest`, `installedVersion`, `hooks`, `tools`, `capabilities`, `network`, `files`, `shell`, `drives`, `screens`(`id`, `title`, `placement`, `mode`, `capabilities`: 화면이 선언한 다리 권한), `warnings`) | M4 (W-32) |
| ext | `ext.install` | `{ source: string, sha256: string }` | `{ name: string, version: string, location: string, appliesAt: "now"\|"nextStepBoundary"\|"restart", loadFailure?: { reason: "safe_mode"\|"not_found"\|"rejected"\|"error"\|"disabled"\|"loader_unavailable", diagnostics: ExtDiagnostic[] }, needsReload?: true }` | M4 (W-32) |
| ext | `ext.remove` | `{ name: string, dropData?: boolean }` | `{ name: string, appliesAt: "now"\|"nextStepBoundary"\|"restart", dataDropped?: integer }` | M4 (W-32) |
| ext | `ext.removePreview` | `{ name: string }` | `{ name: string, tables: { name: string, rows: integer }[] }`(최대 64개) | M4 (W-32) |
| ext | `ext.test.run` | `{ kind: "replay"\|"testRun", target: string, options?: { maxCommits?, profileId?, workspace? } }` | `{ testId: string, threadId: string \| null }` | M4 (W-29) |
| ext | `ext.test.list` | `{}` | `{ tests: ExtTestRecord[] }`. `replay`는 `ReplayReport`(`ok`, `commits`, `passed`, `firstDiff`, `cuts`, `effects`, `failure`)이고 `cuts`는 커밋 시점마다 한 칸 `{ commitIndex: integer(1..), equal: boolean, firstDiff: integer \| null }`(커밋 순, 최대 1000칸)이다. 정본은 `ReplayReportShape`(`wire/devkit.ts`)다 | M4 (W-29) |

- 0a. [결정: 2026-11-04 오케스트레이터 기본값] `turn.start`의 `whenBusy`는 실행 중 사용자 입력의 큐 자리다(`L1.loop.spec` `admit`의 `whenBusy`와 같다). 이 문서와 호스트 스펙은 사용자 입력에 `turn.busy`를 쓰라고 정한 적이 없고(3003은 컴팩션·재개 같은 turn 사이 연산의 거절이다), `turn.busy`가 남은 것은 큐를 연결하지 않았기 때문이다. `whenBusy`가 있고 열린 turn이 있으면 호스트는 `loop.admit`으로 그 자리의 큐에 넣고 `{ turnId: <실행 중인 turn>, queued: true }`를 돌려준다(새 turn이 아니다). 입력은 `input.queued`로 보이고 `turn.withdraw { requestId }`로 거둔다. 같은 `requestId`를 다시 보내면 같은 답이다. `whenBusy`가 없으면 전과 같이 `turn.busy`(3003)다: `whenBusy`를 모르는 클라이언트(CLI의 재시도 방식)는 바뀌지 않는다. 열린 turn이 없으면 `whenBusy`는 무시하고 turn을 시작한다.

- [결정: review.m3-design-inputs D-M3-32 a, M3-REQ-18] 지식 제안 대기열 wire(`proposal.*`, `wire/proposals.ts`). 대기열은 둘이다: 학습 그룹의 `x_learning_proposals`(`source: "learning"`)와 L2.knowledge의 쓰기 승인 대기열 `cap_knowledge_proposals`(`source: "knowledge"`). 이 wire는 두 출처를 한 목록으로 보이는 조회와 결정이고, 대기열을 하나로 합치지 않는다.
  - `proposal.list`는 두 출처를 `createdAt` 내림차순(같으면 `(source, id)` 오름차순)으로 합친다. `ProposalRow`는 두 출처가 같은 모양이다: `source`, `id`, `kind`(`skill`, `memory`, `feedback`, `script`), `op`, `target`, `status`(두 대기열 상태의 합집합: `pending`, `approved`, `applied`, `rejected`, `stale`, `expired`, `reverted`), `destructive`, `diff`, `rationale`, `evidence`, `conflictsWith`, `reason`, `revision`, `scope`, `afterUntrusted`, `createdAt`. 출처에 없는 필드는 빈 값(null, false, 빈 배열, `revision` 1)이다. 한 출처를 읽지 못하면(지식 저장소 없음 등) 그 출처만 `unavailable`에 올리고 나머지 행은 돌려준다. `source`와 `status` 필터는 서버가 건다.
  - `proposal.decide`는 `decision`이 나머지 필드를 정하는 합집합이다. `approve`와 `edit`는 목록에서 본 `revision`을 필수로 맞춰 보낸다(생략해 현재 판으로 읽는 경로는 없다. 다르면 `revision_mismatch`다. 지식 출처는 항상 1). 스킬 후보의 `approve`는 `scope`를 고를 수 있다(D-M3-09). `reject`는 `note`를 받는다. `edit`(본문 수정)와 `revert`(원장 롤백)는 학습 출처만 받고 지식 출처에는 `unsupported`다. 결과는 오류 값이다: `ok: false`의 `reason`은 `not_found`, `revision_mismatch`, `closed`, `scope_not_allowed`, `unsupported`, `base_stale`, `scan_failed`, `approval_required`, `unavailable` 가운데 하나이고 출처의 오류(`learning.*`, `proposal_closed`, `base_stale`)를 이 집합으로 옮긴 값이다. JSON-RPC 오류는 params 위반(`-32602`)과 전송 실패에만 쓴다.
  - 승인은 증거로 한 번만 한다: 학습 출처의 승인은 `ApprovalEvidence{ source: "learning.queue" }`로 L2 쓰기 승인과 이어지므로(`L3.learning.spec` §4.5 6번, ADR-0018 §3 5번) 두 대기열을 한 목록으로 보여도 승인이 두 번 생기지 않는다. 새 알림은 없다. 후보가 생기면 그룹 레코드(`grp.learning.*.proposed`)와 `events.batch`로 알리고 L4가 목록을 다시 읽는다.
- [결정: m2c G2-07 후속] `host.status`가 외부 바이너리 점검 결과를 싣는다(`L4.host-service.spec` §10 28번). 사이드카 안의 엔진을 wire로만 보는 데스크톱 첫 실행 화면이 `Engine.diagnose`의 `binaries`를 받는 길이다. 진단 메서드를 새로 만들지 않아서(`host.diagnose` 반려는 그대로) 기존 메서드에 선택 필드만 더한다.
  - params의 `includeBinaries: true`일 때만 호스트가 점검해 result의 `binaries`에 싣는다. 점검은 바이너리마다 자식 프로세스를 띄워 버전을 확인하므로(`L0.os.spec` §3.6.1) 상태 조회마다 하지 않는다. 생략하거나 거짓이면 `binaries`가 없고 이전 클라이언트의 `host.status`는 그대로 동작한다.
  - `HostBinaryReport`는 `BinaryCheckReport`(`L0.os.spec` §3.6.1)에서 실행 파일 경로(`path`)만 뺀 모양이다: `{ platform, ready, blocking, degraded, items }`. `ready`는 필수 바이너리가 모두 쓸 수 있다는 뜻이고 `blocking`은 쓸 수 없는 필수, `degraded`는 쓸 수 없는 선택 바이너리 이름이다. `items`는 표의 행마다 `{ name, need: "required"\|"optional", usedBy, impact, status }`이고 `status`는 `ok { version, source }`, `missing { hint }`, `too_old { found, required }`, `unusable { reason }` 가운데 하나다. `hint`가 첫 실행 화면의 설치 안내 문구다.
  - 점검이 중단되면(`cancelled`) 결과 없이 `request.cancelled`(5001)로 실패한다. 점검 결과가 `ready: false`여도 요청은 성공이다: 환경 문제의 판단과 안내는 클라이언트가 한다.
- [결정: m2c G2-01] `thread.compact`는 사용자가 지금 대화를 요약하라고 요청하는 메서드다(`/compact`). 자동 컴팩션(요청 전 임계, 오버플로우 복구)은 루프가 하고(`L1.loop.spec` §4.2) 이 메서드는 이유 `manual`의 컴팩션 한 번이다(`ContextService.compact`, `CompactRequest.reason`).
  - 쓰기 소유가 필요해서 `turn.start`처럼 암묵 획득을 한 번 시도하고 실패하면 `thread.locked`(3002)다. 진행 중인 turn이 있으면 `turn.busy`(3003)이다: 루프가 같은 가지에 컴팩션을 커밋할 수 있어 끼어들지 않는다. 없는 thread는 `thread.notFound`(3001), 닫힌 thread는 `thread.closed`(3007)다.
  - `instructions`는 `/compact` 뒤에 적은 요약 지침이다. 생략하면 기본 요약 지침을 쓴다. 상한 20000자는 `thread.compact.before`의 `instructions`와 같다.
  - 결과 `compacted`는 `thread.compacted` 이벤트를 커밋했다는 뜻이다. `eventId`가 그 이벤트, `position`이 그 이벤트를 반영한 저장소 위치(`thread.rename`의 `position`과 같은 규칙), `tokensBefore`가 요약 전, `tokensAfter`가 요약 뒤 추정 토큰 수, `fromExtension`이 요약 내용을 낸 확장 이름이다. 컴팩션 뒤 다음 turn에서 스킬 색인과 메모리 스냅샷을 다시 놓는 일은 L1.context가 하고 클라이언트가 할 일이 아니다.
  - 결과 `skipped`는 요약할 것이 없거나(`nothing_to_summarize`), 마지막 항목이 이미 컴팩션이거나(`last_entry_is_compaction`), `l1.context.autoCompact` 같은 설정으로 꺼져 있다(`disabled`)는 뜻이다. 아무것도 커밋하지 않았고 오류가 아니다.
  - 실패는 오류 값이다. 확장이 `thread.compact.before`에서 막으면 `thread.cancelledByExtension`(3006, `point: "thread.compact.before"`), 요약을 만들거나 커밋하지 못하면 `thread.compactFailed`(3008, `reason`)다. 요청이 취소되면 `request.cancelled`(5001)다. 저장소 오류는 `store.*`(5003~5007)다. 오류에 모델 출력이나 제공자 응답 본문은 싣지 않는다.
- [결정: m2c G2-12] `thread.rename`은 대화 제목을 바꾼다. 목록이 모두 "제목 없음"으로 보이는 문제(`L1.persistence.spec` §4.10.5 `setTitle`)를 클라이언트가 풀 길이다. 호스트는 `thread.updated { title }`를 커밋하고 그 위치를 `position`으로 돌려준다. 제목은 1~200자이며(`ThreadSummary.title`, `thread.create`의 `title`과 같은 상한) 지우는 길은 없다. 쓰기 소유가 필요해서 `turn.start`처럼 암묵 획득을 한 번 시도하고 실패하면 `thread.locked`(3002)다. 없는 thread는 `thread.notFound`(3001), 닫힌 thread는 `thread.closed`(3007)다. 진행 중인 turn이 있어도 바꿀 수 있다.
- [결정: 오케스트레이터 기본값, M4 T-MODEL] `thread.setModel`은 대화가 다음 turn부터 쓸 모델을 정한다. 스펙에 정해진 전환 계약이 없어(CLI의 `/model`은 `l1.models.default` 별칭뿐이다, `L4.cli.spec` 슬래시 명령) 가장 작은 계약으로 낸다. 호스트는 `thread.updated { model }`를 커밋하고 그 위치를 `position`으로 돌려준다. `model`은 `provider/id`이고 L1.models 카탈로그(`ModelService.list`)에 없으면 `jsonrpc.invalidParams`(`/model`)로 거절한다. null은 지정을 거두어 기본 모델로 돌아간다. 쓰기 소유 규칙과 오류는 `thread.rename`과 같다(3001, 3002, 3007). 진행 중인 turn은 이미 묶은 모델로 끝나고 다음 turn부터 바뀐다. `ThreadSummary.model`이 저장된 값을 보이고 생략이면 기본 모델이다. 모델을 바꿀 때 비용·캐시 경고를 보일지는 사용자 정책이라 이 계약은 정하지 않는다.
- [결정: 오케스트레이터 기본값, M4 T-MODEL] `models.list`는 대화가 `thread.setModel`로 고를 수 있는 모델을 준다. 클라이언트에 모델 카탈로그를 읽는 길이 없어(설정 `l1.models.providers`는 provider id만 담는다) 더했다. L1.models `list({ available: true })`(자격 증명이 있는 provider의 모델)를 `ref` 순서로 `{ ref, name, contextWindow, reasoning, inputPrice, outputPrice }`만 싣는다. 가격은 입출력 100만 토큰당 USD이고 카탈로그가 가격을 모르면(입력·출력이 모두 0) 둘 다 null이며 화면은 "가격 모름"으로 보인다(0원으로 보이지 않는다). 1000개를 넘으면 뒤를 자른다. 읽기만 하고 쓰기 소유를 얻지 않는다. 허용·차단 목록은 L1.models가 이미 적용한 결과다.
  - 첫 입력에서 제목을 정하는 규칙(M2): 첫 `turn.start` 입력의 앞 80자(줄바꿈은 공백 하나로)를 제목으로 쓴다. 정하는 주체는 호스트이고 이 메서드와 같은 커밋 경로를 쓴다. 이미 제목이 있는 thread는 바꾸지 않는다. 모델이 만드는 자동 제목은 M3다.
- [결정: m2c G1-07] 시크릿 wire 보강 네 가지다(`L4.host-service.spec` §10 19번, 23번).
  - `secret.test`의 결과는 `state`에 `decryptable`, `length`, `sha256Prefix`를 더했다(`L0.secrets.spec`의 `SecretTestResult`). `length`는 값의 바이트 수, `sha256Prefix`는 SHA-256 hex 앞 8자(소문자)이고 값이 없거나 풀 수 없으면 둘 다 null이다. 값은 어디에도 싣지 않는다. 앞 8자는 사람이 같은 값인지 견주는 표시용이고 감사 기록과 로그에는 남기지 않는다. 필드는 모두 필수라 옛 모양(`state`만)은 거부한다.
  - `secret.references { name }`는 삭제 전에 이 시크릿을 가리키는 곳을 보인다(`L0.secrets.spec` `references`, `L4.cli.spec` §4.7 `secret rm`). 결과는 `{ settingKeys, activeLeases, sessions }`다. 메서드는 읽기 전용이다. 활성 drive 락이 있으면 `secret.remove`가 `secret.inUse`로 거부한다.
  - [결정: 2026-11-04 사용자] `secret.audit { name, limit? }`는 시크릿 하나를 쓰려던 시도(사용 `allow`, 거절 `deny`)를 최근 순으로 돌려준다(`L0.secrets.spec` §3.9 감사 파일의 `secret.used`, `secret.denied`, W-13). 읽기 전용이고 알 수 없는 이름은 `secret.notFound`다. 항목은 `{ at, decision, mode, threadId \| null, toolCallId \| null, host \| null, reason \| null }`이다. 호스트가 필드를 하나씩 골라 항목을 만들므로 값, 값의 일부, 해시, 자유 문장(`purpose`), 명령줄 해시는 실리지 않는다. 기록 개수 상한은 없고 `limit`을 줄 때만 자른다. 오류 `secret.auditUnwritable`은 쓰기 실패 오류이며 이 메서드는 쓰지 않는다.
  - 시크릿 오류 kind를 3201~3212로 나눴다(§3.5.2). `SecretError`의 입력 오류(`invalid_ref`, `unsupported_ref_syntax`, `meta_invalid`, `value_too_short`)는 새 kind 없이 `jsonrpc.invalidParams`로 간다. 나머지 `SecretError.kind`는 camelCase로 바꾼 `secret.<kind>`로 1:1 대응한다(`secret_missing` → `secret.notFound`). `details`는 안전한 필드(이름이 아닌 제공자, 사유 코드, 종료 코드, 프로세스 락 수)만 싣고 `stderrMasked` 같은 외부 도구 출력은 싣지 않는다. 이전의 `internal` + `details.secret` 대용(`L4.host-service.spec` HS-47)은 이 kind로 바뀐다.
  - [결정: m2r sec] `secret.writeFailed`의 `target`에 `key_store`(OS 키 저장소에 age 키를 만들지 못함)와 `sops_file`(기본 SOPS 시크릿 파일을 만들지 못함)을 더했다. 첫 `secret add`가 키와 파일을 자동으로 준비하게 되면서(`L0.secrets.spec` §4.8) 준비 실패를 "sops와 age를 설치하라"가 아닌 실제 원인으로 알려야 하기 때문이다. `code`는 OS 오류 코드 또는 `sops_encrypt_failed`, `recipient_unknown`, `unsupported_format`, `lock_timeout` 같은 이름이다.
  - `thread.closed`(3007)는 닫힌 thread에 쓰기나 수명 주기 호출을 했을 때의 오류다. 이전에는 `thread.notFound`로 알렸다. 닫힌 thread의 읽기와 삭제는 허용한다.
  - [결정: M3-REQ-17] `SecretEntryOffer`의 `add`용 메타를 받았다. `SecretEntryMeta`(`capabilities/secrets.ts`)는 `SecretMetaParams`에서 `name`을 뺀 값 없는 메타(`desc`, `scope`, `expiresAt`, `use`, `approval`, `ttlSeconds`, `maxUses`, 모두 선택)이고 `SecretEntryOffer.meta`와 `secret.beginEntry`의 `meta`가 같은 모양으로 싣는다. 생략하면 호스트의 기본 메타다. `secret.test`의 길이·해시 앞 8자 확장은 위 첫 항목대로 이미 있고, 값 열람 경로는 `secret.beginReveal`과 `SecretRevealOffer`(wire 밖 전달)로 정해져 있어 더 두지 않는다.
- [결정: m2c G1-03] `trust.get`·`trust.decide`는 작업 폴더 신뢰(`X.loading-trust.spec` §4.7)를 클라이언트가 묻고 정하는 메서드다. 이름과 모양은 `m2/fx-host`의 구현을 정본으로 하고 `m2/fx-apps`의 `trust.pending`·`trust.decide { projectRoot, choice }` 가정은 버린다. 이유는 둘이다. 첫째, wire에는 서버가 클라이언트에 보내는 요청이 없어서 대기 목록(`trust.pending`)은 호스트가 프롬프트를 쥐고 기다리는 구조를 전제한다. 둘째, 폴더는 클라이언트가 먼저 알고 있다(`workspace`). 호스트는 프롬프트를 띄울 화면이 없고(`headless`), 결정이 없는 폴더는 `undecided`라 불신으로 다룬다(fail-closed). 그래서 `.mcp.json`, 작업 폴더 스킬, `.fresnel/settings.json`, `.fresnel/commands`는 사람이 정하기 전에는 적용되지 않는다. 클라이언트는 폴더에서 thread를 만들거나 열기 전에 `trust.get { workspace }`를 부르고, `verdict`가 `undecided`이고 `required`가 참이면 `options`로 선택지를 보여 준 뒤 `trust.decide`로 보낸다.
  - `TrustStatus`는 `{ projectRoot, required, verdict: "allow"|"deny"|"undecided", via, resources, options }`다. `projectRoot`는 심볼릭 링크를 푼 경로, `resources`는 신뢰가 필요한 자원의 작업 폴더 루트 기준 상대 경로, `via`는 판정의 출처(`override`·`notRequired`·`point`·`store`·`sessionMemory`·`default`·`prompt`·`headless`·`corruptStore`, `X.loading-trust`의 `TrustVia`와 같은 집합)다. `options`는 `{ choice, label, savedPath }`이고 `label`은 현지화 식별자(`trust-folder`, `trust-parent`, `trust-session`, `deny-folder`, `deny-session`)이며 `savedPath`는 결정을 저장하는 폴더(`session`은 null)다.
  - `trust.decide`의 `choice`가 그 폴더의 `options`에 없으면 `jsonrpc.invalidParams`(`path: "choice"`)다. `session`은 저장하지 않고 그 호스트 프로세스 동안만 유지한다. `workspace`가 절대 경로가 아니면 `jsonrpc.invalidParams`(`path: "workspace"`)이고, 결정을 저장하지 못하면(손상된 저장 파일, 쓰기 실패) `store.io`(`details.code: "trust_store"`)다. `trust.get`은 아무것도 바꾸지 않는다. 신뢰 필요 자원이 없는 폴더도 `trust.decide`로 미리 정할 수 있다.
  - 결정 뒤 호스트는 그 폴더의 project·local 설정 파일 층을 다시 읽고 `settings.invalidated`(§3.3.2)를 보낸다. 작업 폴더 스킬은 다음 thread를 열 때, MCP 서버 정의는 다음 서버 로드 때 반영된다. 이미 열린 thread가 새 결정을 모두 받게 하려면 결정을 thread 열기 전에 한다.
  - 저장 파일 `trust.json`은 두 클라이언트(CLI의 `fresnel trust`, 데스크톱 카드)가 같은 호스트를 거쳐 쓴다. 프로세스 사이 쓰기 충돌은 L0.os의 `fileLock`이 막는다(`review.m2-plan` G1-10). wire는 이 잠금을 드러내지 않는다.
  - `thread.trust.before` 훅은 이 메서드와 별개다. 확장이 결정을 내는 길이고 thread 없이 호스트 수준에서 발화한다(`F.extensions.spec` §7). M2에는 그 훅에 핸들러를 거는 확장이 없어 호스트는 발화하지 않고 저장소 판정만 쓴다.
- [결정: m2c G1-02] `turn.resume`은 프로세스 종료로 끊긴 turn을 이어 실행하는 메서드다(`L1.loop.spec` §4.6 `LoopService.resume`, `L4.host-service.spec` §10 21번). `thread.list`가 `ThreadSummary.resumable`로 후보를 알리고(§3.3.1 아래 코드), 클라이언트가 사용자 확인 뒤 이 메서드를 부른다. 호스트는 자동 재개를 하지 않는다. 한 thread에 열린 turn은 하나라서 `turnId`를 받지 않는다.
  - 결과 세 모양은 `ResumeResult`(`services/loop.ts`)와 같아 변환이 없다. `resumed`는 이어 실행을 접수했다는 뜻이고 진행은 `events.subscribe`의 이벤트로 온다. `from`은 이어 시작한 단계다. 승인을 기다리던 turn은 `tools`로 이어지고 `approval.list`의 대기 승인이 다시 응답을 받는다.
  - `closed`는 이어 실행하지 않고 닫았다는 뜻이다. 끊기기 전에 중단 요청이 있었으면 `abort_requested`, 소유자가 취소했으면 `owner_cancelled`다. `nothing`은 열린 turn이 없다는 뜻이다. 둘 다 오류가 아니다.
  - `turn.start`처럼 쓰기 소유가 필요하고 암묵 획득을 한 번 시도한다. 소유하지 못하면 `thread.locked`(3002), 없는 thread는 `thread.notFound`(3001), 이미 도는 turn이 있으면 `turn.busy`(3003)다. 저장소 오류는 `store.*`다.
- [결정: m2c G1-01] `command.list`와 `command.run`은 엔진에 등록된 슬래시 명령(`dialog.commands`, `F.capabilities.spec` §3.9)을 클라이언트가 부르는 길이다. `/plan`, `/tasks`, `/goal`, `/helm start`처럼 L2·L3 코드가 등록한 동작 명령은 엔진 안에서만 돌 수 있어, 이 메서드가 없으면 클라이언트에서 실행되지 않는다. `CommandInfo`와 `CommandRunOutput`은 기능 정의 파일(`capabilities/defs/dialog.ts`)의 스키마를 그대로 쓴다. 호스트는 `command.list`를 `dialog.commands.list`로, `command.run`을 `dialog.commands.run`으로 옮기고 `threadId`를 호출 문맥에 싣는다.
  - 출력은 `CommandRunOutput`의 `done`이 싣는다. `message`는 사람이 읽는 텍스트(4,000자까지)이고 `result`는 구조 값이다. 클라이언트는 `message`를 화면에 내고 `result`는 해석하지 않아도 된다.
  - `expanded`의 `text`는 템플릿을 펼친 최종 입력이다. 클라이언트가 `turn.start`로 보낸다. `command.run`은 turn을 만들지 않는다.
  - `needs_confirmation`을 받으면 클라이언트가 `shell` 목록을 보이고 사용자 확인을 받은 뒤 `confirmShell: true`로 같은 `text`를 다시 보낸다.
  - 명령 실패는 기능 오류 구간(코드 4000, kind `cap.dialog.commands.<code>`: `command_args_invalid`, `command_shell_disabled`)과 `thread.notFound`로 돌아온다. 새 wire 오류 kind는 없다.
  - 이름 없는 입력은 오류가 아니라 `{ status: "not_command" }`다. 클라이언트는 이 값을 받으면 `turn.start`로 보낸다.
  - [결정: M3-REQ-16, M3-20] `status.list`·`attachments.add`·`notify.list`를 코어 표에 둔다(`L2.dialog.spec` §10 D-2의 선택). 값 모양은 기능 정의(`dialog.status.list`, `dialog.attachments.add`, `dialog.notify.list`)의 스키마를 그대로 쓰고 wire는 `threadId`를 더한다. `status.list`는 재접속 뒤 상태줄을 다시 그리는 스냅숏이고 변경은 휘발 이벤트 `dialog.status`로 온다. `attachments.add`의 결과 `parts`를 `turn.start`의 `input`에 넣고, 상대 경로는 `threadId`의 작업 폴더 기준이다. `notify.list`는 `afterSeq` 뒤의 알림을 당겨 읽는다.
  - [결정: M3-REQ-16, review.m3-design-inputs D-M3-17] 알림 전달: 호스트는 `notify.delivered`를 연결된 클라이언트 모두에 보낸다. 클라이언트 창이 앞에 있어도 기본으로 보내고, 보낼지는 호스트의 설정 키로 조정한다. OS 토스트와 앱 안 표시는 클라이언트가 한다. 웹·모바일 푸시는 후순위다. 알림은 내구 이벤트 `dialog.notified`에서 나오므로 놓친 클라이언트는 `notify.list`로 따라잡는다.
  - [결정: M3-REQ-19] 재접속용 목록: `thread.open`에 `includeItems: true`를 주면 결과에 현재 가지의 item 목록(`items`, `hasMore`)과 그것이 반영한 `asOfSeq`를 싣는다. `asOfSeq` 뒤의 이벤트는 `events.subscribe`로 이어 받는다(§3.4.6). 대기 승인은 `approval.list`(`position`)가 같은 규칙으로 준다. 안전 모드로 떠 있으면 `host.status`의 `safeMode`가 참이라 화면이 표시한다.
- [결정: m2c G1-01 후속] `command.list`의 `threadId`는 선택이다. 주면 작업 폴더 명령(`.fresnel/commands`)을 그 thread의 작업 폴더 기준으로 읽고(신뢰 게이트 포함), 생략하면 thread 문맥 없이 읽는다. 작업 폴더가 없는 thread는 작업 폴더 명령 없이 나온다. 없는 thread는 `thread.notFound`(3001)다. 목록만 읽으므로 `command.run`과 달리 쓰기 소유를 얻지 않는다. `dialog.commands.list`의 입력 스키마는 바뀌지 않고, 호스트가 `threadId`를 입력에서 떼어 호출 문맥에 싣는다. 근거: `L4.host-service.spec` §10 29.
- [결정: M3-REQ-96] `web.providers`는 웹 provider 상태와 웹 설정의 유효 값을 읽는 메서드다(`wire/web-providers.ts`). 읽기 전용이고 시크릿 값을 싣지 않는다. 키 값, 주입 위치, 헤더 이름은 결과 어디에도 없다. 호스트는 `cap-web`의 provider 카탈로그와 탐침 캐시에서 값을 채운다(`L4.host-service.spec`).
  - `providers`는 provider마다 한 항목이고 최대 64개다. 항목은 `id`(`ProviderId`, 최대 96자), `capability`(`web.search`, `web.fetch`, `web.browse`), `origin`(`plugin`, `detected`, `builtin`), `displayName`(1~64자), `auth`(`none`, `header`, `bearer`, `query`), `status`, `pricingAsOf`, `pricingStale`, `firstUseNoticed`, `autoRank`를 싣는다.
  - `autoRank`는 자동 선택(`auto`)이 provider를 시도하는 순서에서의 0부터 센 자리다. 설정 provider가 `auto`가 아니어도 이 값은 자동 순서 기준이고, `search.parallel`과 설정 provider 값에 따라 바뀌지 않는다. `web.search`와 `web.browse` 행에만 값이 있고, `web.fetch` 행은 사용자 순서가 없어서 `null`이다. 자동 순서의 규칙은 `L2.web.spec` §4.8.2다. 클라이언트는 이 값으로 순서를 다시 계산하지 않는다.
  - `status.kind`는 `ok` 또는 `unavailable`이다. `unavailable`은 `reason`에 웹 provider의 `ProviderUnavailableReason` 문자열을 싣고(최대 64자), `detail`(최대 512자)을 더할 수 있다.
  - `pricingAsOf`는 가격표 기준일(ISO 날짜)이다. 가격표가 없거나 무료면 `null`이다. `pricingStale`은 기준일이 오래되었을 때 참이다. `firstUseNoticed`는 고지가 필요 없는 provider(`auth: "none"`)거나 첫 사용 고지를 이미 보였을 때 참이다.
  - `settings`는 웹 설정의 유효 값이다. `searchProvider`, `searchOrder`, `searchParallel`(1~4), `browseProvider`, `browseOrder`, `robots`(`auto`, `always`, `never`)를 싣는다. 값을 바꿀 때는 `settings.set`을 쓴다.

  ```ts
  // wire/web-providers.ts
  export const WebProvidersResultSchema = Type.Object({
    providers: Type.Array(WebProviderStatusSchema, { maxItems: 64 }),
    settings: WebSettingsWireSchema,
  }, { additionalProperties: false });
  ```

- [결정: M3b B1-SCH2] `schedule.create`, `schedule.list`, `schedule.cancel`, `schedule.fire`는 예약 항목을 만들고, 읽고, 끄고, 원격으로 한 번 실행하는 메서드다(`wire/schedule.ts`, `L2.schedule.spec` §4.4.9). 기능 `schedule.entries`(`capabilities/defs/schedule.ts`)가 입력과 모델 도구를 정하고, params는 그 기능 입력에 `_meta`를 더한 것이다. 기능 ID는 §3.5의 `schedule.timers`(cron 식)와 다른 기능이다.
  - 기대한 실패는 JSON-RPC 오류가 아니라 `ok: false`의 `error`(`kind`)다. `proposal.decide`와 같은 규칙이다. `kind`는 `interval_too_short`, `at_in_past`, `invalid_trigger`, `limit_reached`, `not_found`, `not_remote`, `disabled`, `store_failed` 여덟이고, `ScheduleError`는 엔진의 `CreateError`, `CancelError`, `FireError`의 합집합이다.
  - 트리거는 `interval`, `at`, `file_watch`, `remote`, `loop` 다섯 모양이고 각 모양은 정해진 필드만 받는다. 간격 최소값 300초와 켜진 예약 수 상한은 스키마가 아니라 엔진이 검사한다.
  - `schedule.list`만 읽기 전용이다(`readOnly`, `replay: "safe"`). `create`, `cancel`, `fire`는 효과가 있는 쓰기이고 `requestId` 기억이 없어 멱등으로 분류하지 않는다(ADR-0015 §3.3). 같은 생성 요청을 두 번 받으면 항목이 두 개 생긴다.
  - `schedule.create`의 `warnings`는 `service_mode_off` 하나를 받는다. `L2.schedule.spec` §4.4.6도 같은 이름을 쓴다 [결정: 2026-11-04 사용자, B13 1안].
  - 모델 도구 `schedule_create`는 `everySeconds`(정수)나 `at`(RFC 3339 날짜시각) 가운데 하나만 받는다. 둘 다 없거나 둘 다 있거나 `at`을 읽지 못하면 메서드 입력 검사가 `invalid_input`으로 거부한다.
- [제안] M1 범위는 브리프의 최소 셋(`turn.start`, `events.subscribe`, `settings.get`)에 선행 조건 둘(`host.hello`, `thread.create`)을 더한다. 대화를 시작하려면 thread가 있어야 하고, 모든 연결은 hello로 시작하기 때문이다.
- [제안] `thread.open`을 추가했다. `_research/process.md` §6.3의 대화 단위 쓰기 소유 규칙을 계약에 드러내기 위해서다. 소유 잠금을 얻지 못하면 `thread.locked`(§3.5.2) 오류에 대안(관찰, 분기, 위임)을 싣는다. in-process 단일 클라이언트인 M1에서는 `thread.create`가 소유를 함께 얻는다.
- [결정: m2 F.2] `thread.read`는 열린 thread의 스냅샷을 돌려주는 읽기 전용 메서드다(L4.desktop 상태 설계 §14 1번). `thread.open` 결과에 items를 싣지 않고 새 메서드를 둔 이유는 셋이다. 첫째, `thread.open`은 쓰기 소유 획득이라는 부작용이 있어서 소유 없이 관찰하는 thread나 재동기화 때마다 부르기에 맞지 않다. 둘째, 스냅샷은 재설정과 재구독마다 다시 읽는데 `thread.open`은 열 때 한 번 부르는 메서드다. 셋째, 긴 thread는 앞부분을 나눠 받아야 해서 `limit`과 `before`가 필요하다. `thread.read`는 소유를 얻지 않고 닫힌 thread도 읽는다. `items`는 현재 가지의 내구 `ItemRecord`를 오래된 것부터 담고, `position`은 그 items가 반영한 저장소 위치다. 이어 붙이는 규칙은 §3.4.6이다.
- [결정: m2 F.2] `approval.list`는 thread의 대기 승인을 돌려준다(L4.desktop 상태 설계 §14 2번, 13번). 대기는 `approval.requested`가 있고 `approval.resolved`가 없는 것이다. `PendingApproval`은 `{ approvalId: EventId, seq: Seq, request: ApprovalRequestedPayload }`이고 `request`는 `approval.requested` 이벤트 payload 그대로다. `approvalId`와 `seq`는 그 이벤트의 envelope `id`와 `seq`이며, 이벤트를 기록한 thread는 `request.surfaceThreadId`다. 목록은 `seq` 오름차순이고 한 thread에 1,000개를 넘지 않는다. 없는 thread는 `thread.notFound`(3001)다. 클라이언트가 목록을 받을 곳은 재설정이나 재동기화 뒤다. 평소에는 `approval.requested`와 `approval.resolved` 이벤트가 같은 일을 한다(§4.6).
- [제안] `turn.start`의 암묵 획득: 이 프로세스가 그 thread의 쓰기 소유를 쥐고 있지 않으면 `turn.start`가 획득을 한 번 시도한다. 실패하면 `thread.locked`(3002)를 돌려준다(`L4.host-service.spec` HS-28). `thread.open`은 관찰이나 분기 선택이 필요할 때 쓰는 명시 경로다.
- [제안] `host.shutdown`은 협조 종료 요청이다. 응답은 참여자 처리가 끝난 뒤 보낸다(`L0.process.spec` FR-P1). 데스크톱 셸이 SIGKILL만 보낼 수 있어서 전송 메시지가 공통 경로다. 이 메서드를 모르는 엔진(-32601)에는 stdin 닫기(EOF)가 같은 종료를 일으킨다(`L4.desktop.spec` §4.3).
- [제안] `secret.*` 여섯 메서드는 값 필드가 없다. 값 입력과 열람은 호스트 쪽 L0.secrets가 OS 입력 창이나 wire 밖 전달로 받는다(`L0.secrets.spec` §8.3 R4, `L4.readme` §8.1). `SecretName`은 `F.capabilities.spec` §3.10이다. `SecretListEntry`의 필드는 [가정] `L0.secrets.spec`의 값 없는 메타 모양을 따르고 M2 착수 때 정한다.
- [결정: m2-plan F.5] `secret.beginReveal { name }`을 M2 메서드로 받았다(`L4.cli.spec` §4.7, review.decisions-2 U-20). 결과 `started`가 거짓이면 호스트가 열람을 시작하지 못한 것이다(맡긴 열람 수단이 없거나 사람 확인이 끝나지 않음). 값은 요청·응답·이벤트·오류 `details` 어디에도 없다.
- [결정: m2-plan F.5] in-process 접속의 wire 밖 값 전달은 `@fresnel/contracts/services`의 `SecretOutOfBandPort`다(`services/secret-admin.ts`). CLI가 값 입력 수단(`SecretEntryOffer`)이나 열람 수단(`SecretRevealOffer`)을 이 포트에 맡긴 뒤 `secret.beginEntry`나 `secret.beginReveal`을 보내면, 호스트 처리기가 같은 이름의 맡긴 수단 하나를 꺼내 `SecretAdminService`에 넘긴다. 맡긴 수단은 한 번 쓰이면 비워진다. 서비스 접속에는 이 포트가 없다. 구현은 `@fresnel/host`다.
- [제안] `turn.start`의 `requestId`는 같은 연결 재시도의 중복 제출을 막는 멱등 키다. 같은 thread에서 같은 키가 오면 처음 발급한 `turnId`를 돌려준다. 의미 정본은 `F.conversation.spec` §3.5의 `requestId`다(`TurnStartedPayload.requestId`, 사용자 `ItemRecord.requestId`). 브랜드 없는 문자열이다.
- [결정: m2-plan F.6] `ThreadSummary`는 `thread.list`의 결과 원소다(`wire/methods.ts` `ThreadSummarySchema`, §10 미결 9). 필드는 `L1.persistence.spec` §3.4 `ThreadSummaryRow`를 따르고 시각은 IsoTime 문자열이다.
- `thread.list`는 저장된 상태가 `running`이어도 `resumable`의 turn 범위가 이 프로세스에 없으면 `status`를 `idle`로 알린다. 강제 종료 뒤 재시작에서 turn은 이미 멈췄기 때문이다. `resumable`은 그대로라 "이어서 실행"은 남는다 [근거: `apps/host/src/assembly/ports.ts`]

  ```ts
  // wire/methods.ts
  export const ThreadResumableSchema = Type.Object({
    turnId: TurnIdSchema,
    runningSince: IsoTimeSchema,          // 끊긴 turn의 turn.started 시각
    resumeAttempts: Type.Integer({ minimum: 0 }),
  }, { additionalProperties: false });
  export const ThreadSummarySchema = Type.Object({
    threadId: ThreadIdSchema,
    title: Nullable(Type.String({ maxLength: 200 })),
    status: ThreadStatusSchema,           // "idle" | "running" | "closed"
    workspace: Nullable(Type.String({ minLength: 1, maxLength: 4096 })),
    createdAt: IsoTimeSchema,
    updatedAt: IsoTimeSchema,             // 마지막 이벤트 시각
    headSeq: Type.Integer({ minimum: 0 }),
    forkedFrom: Nullable(Type.Object({ threadId: ThreadIdSchema, eventId: EventIdSchema }, { additionalProperties: false })),
    resumable: Nullable(ThreadResumableSchema),   // ThreadSummaryRow.marker. 이어서 실행 후보 표식(HS-30)
    queuedInputs: Type.Integer({ minimum: 0 }),
    pendingApprovals: Type.Integer({ minimum: 0 }),
    lastTurnId: Type.Optional(TurnIdSchema),     // 대화의 마지막 turn id(ThreadSummaryRow.lastTurnId). turn이 없으면 생략. 데스크톱이 최근 실행의 기준 턴으로 쓴다
    origin: Type.Optional(ThreadOriginSchema),   // M4, W-16. { kind: "user" } | { kind: "schedule", scheduleId } | { kind: "remote" }
    testRun: Type.Optional(TestRunMarkerSchema), // M4, W-34. { profileId, target, paused }. Test run이 아니면 생략
    spawnedBy: Type.Optional(ThreadSpawnedBySchema), // M4, rtE R-3. { threadId(부모), kind: "subagent"\|"internal" }. 위임으로 만든 자식이 아니면 생략 [결정: 오케스트레이터 기본값, rtE R-3]
    model: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), // M4, T-MODEL. 대화가 다음 turn부터 쓰도록 정한 `provider/id`. 정하지 않았으면 생략(기본 모델)
  }, { additionalProperties: false });
  ```

- [결정: m2-plan F.6] `thread.list`의 `workspace` 필터는 `thread.started.workspace`(`F.conversation.spec` §3.5.3)에 저장한 값과 정확히 같은 문자열을 찾는다. 호스트가 `thread.create`의 `workspace`를 정규 절대 경로로 바꿔 저장하는 규칙은 `L4.host-service.spec`이 정한다.
- `TurnStartInput` [제안]: pi `UserMessage["content"]`와 같은 모양이다. 스키마는 `F.conversation.spec`의 콘텐츠 스키마로 만든다. `F.extensions.spec`의 `TurnInput`(drive 함수의 `loop.turn()` 입력, `{ input: PostItem, requestId? }`)과 모양이 달라서 이름을 나눈다.

  ```ts
  // wire/methods.ts
  export type TurnStartInput = UserMessage["content"];   // string | (TextContent | ImageContent)[]
  export const TurnStartInputSchema: TUnsafe<TurnStartInput> = Type.Unsafe<TurnStartInput>(
    Type.Union([Type.String(), Type.Array(Type.Union([TextContentSchema, ImageContentSchema]), { maxItems: 64 })]),
  );
  ```

- `settings.reset`은 브리프 목록에 없던 메서드다. [제안] 값 지우기를 `settings.set`의 특수 값으로 표현하면 `null`이 유효한 설정 값과 겹치므로 따로 둔다.

- `approval.respond`의 `answer` [결정: m2 F.8]. 승인 body의 kind와 decision이 모양을 정하고, 스키마는 `F.records` `ApprovalAnswerSchema`다. L1.tools(`ApprovalResponse`)와 같은 모양이다.

  | 요청 kind | decision | answer |
  |---|---|---|
  | `question` | `answer` | `QuestionAnswer`: 질문 id → `{ selected: string[], text?: string }`. 키는 `QuestionBody`의 질문 id, `selected`는 그 질문의 선택지 id다. 질문은 최대 4개다 |
  | `plan` | `allow` | `{ mode?, note? }`(선택). `mode`는 승인 뒤에 쓸 다음 권한 모드로 `nextModes` 가운데 하나다. `note`는 계획 도구에 돌려줄 메모(최대 8192자)다 |
  | `review` | `answer` | `ReviewAnswer`: `{ decisions, comments, submit, approveRemaining? }`. 스키마는 `F.records` `ReviewAnswerSchema`이고 모양은 `L2.artifacts.spec` §4.2.4와 같다 [제안: M3-REQ-09] |
  | `tool`, `plan`, `question`, `review` | `deny` | `{ feedback }`(선택). 모델에게 돌려줄 거부 이유(1~8192자) |
  | `tool` | `allow` | 없음 |

  - 그 밖의 조합(예: 도구 승인에 질문 답, 질문에 `allow`)은 모양이 스키마를 통과해도 승인 서비스가 `applied: false`로 돌려준다. 스키마에 맞지 않는 `answer`는 `-32602`다.
  - `applied: false`의 이유 [결정: m2c G1-09, 통합 검토 M2]: 결과의 `reason`이 `applied: false`인 이유를 알리고, 클라이언트는 이 값으로 응답을 고쳐 다시 보낼지 정한다.

    | `reason` | 뜻 | 요청 상태 | 클라이언트 |
    |---|---|---|---|
    | `answer_invalid` | decision이 요청 kind에 맞지 않거나, `answer`가 질문 묶음·계획 모양에 맞지 않거나, 요청이 내지 않은 `remember`다. `detail`이 고칠 곳을 한 줄로 알린다(최대 512자) | 대기 그대로 | 입력을 고쳐 다시 보낸다 |
    | `already_resolved` | 이미 해결됐거나 다른 응답이 해결을 커밋하는 중이다 | 해결됨 | 요청을 목록에서 지운다 |
    | `unknown_approval` | 이 엔진이 모르는 `approvalId`다(저장소에도 미해결 요청이 없다) | 없음 | 목록을 `approval.list`로 다시 읽는다 |
    | `commit_failed` | 응답은 맞았으나 `approval.resolved` 커밋이 실패했다 | 대기 그대로 | 다시 보낼 수 있다 |

    `reason`이 없는 `applied: false`는 이유를 알리지 않는 구현이다. 클라이언트는 `answer_invalid`가 아닌 모든 값을 "다시 보내도 같다"로 다룬다. `applied: true`에는 `reason`이 없다. 요청이 속한 thread의 쓰기 소유가 없으면 결과 대신 3002 오류가 난다(§4.6).
  - L2.dialog의 `AskAnswer`(`{ answers: [{ questionId, selected, text }] }`)는 wire에 나오지 않는다. 클라이언트는 `QuestionBody`를 그려서 답을 `QuestionAnswer`로 만들고, 기능 쪽 어댑터(cap-dialog)가 `AskAnswer`와 서로 옮긴다(`L2.dialog.spec` §4.1.1). 선택지가 없는 질문은 `selected: []`와 `text`로 답한다.

#### 3.3.2 알림 표

| 방향 | 알림 | params | 단계 |
|---|---|---|---|
| 서버 → 클라이언트 | `events.batch` | `{ sub: SubId, from: Seq, to: Seq, events: EventWire[], caughtUp: boolean }` | M1 |
| 서버 → 클라이언트 | `events.ended` | `{ sub: SubId, reason: "replayFailed" }`. 서버가 구독을 끝냈다. 재전송 읽기가 실패해 구독을 지웠을 때 보낸다. 클라이언트는 같은 필터로 다시 구독하거나 오류로 처리한다 | M1 |
| 서버 → 클라이언트 | `stream.chunk` | `{ event: VolatileEventWire }` (`n`, `afterSeq`를 담은 휘발 이벤트) | M1 |
| 서버 → 클라이언트 | `settings.invalidated` | `{ keys: SettingKey[], scopes: SettingScope[], threadId: ThreadId, 없으면 null }`. 값이 없다. 받으면 `settings.get`으로 다시 읽는다(§3.3.4) | M2 |
| 서버 → 클라이언트 | `notify.delivered` | `{ threadId: ThreadId(없으면 null), notice: Notice, deliveredAt: IsoTime }`. 알림 한 건을 연결된 클라이언트 모두에 보낸다(M3-REQ-16, 아래 설명) | M3 |
| 서버 → 클라이언트 | `profile.changed` | `{ rev: integer, ids: string[] }`. 프로필 목록이 바뀌었다. `profile.list`를 다시 읽는다(W-46) | M4 |
| 클라이언트 → 서버 | `$/cancelRequest` | `{ id: RpcId }` | M1 |
| 클라이언트 → 서버 | `$/connectionReset` | `{}`. 클라이언트 화면이 같은 연결 위에서 다시 시작되어 이전 화면의 상태를 버린다(WebView 새로고침, `L4.desktop.spec` §4.5). 동작은 §4.1 5~7번 | M2 |

[제안] 19의 `events` 알림은 이름 규칙의 예외였다. Fresnel은 예외를 두지 않으려고 `events.batch`로 바꾼다. 브리프와 19가 말하는 "`events` 알림"은 이 `events.batch`다.

#### 3.3.3 레지스트리 타입

```ts
// wire/methods.ts
export interface WireMethodMap {
  "host.hello":        { params: HostHelloParams;        result: HostHelloResult };
  "host.status":       { params: HostStatusParams;       result: HostStatusResult };
  "thread.list":       { params: ThreadListParams;       result: ThreadListResult };
  "thread.create":     { params: ThreadCreateParams;     result: ThreadCreateResult };
  "thread.open":       { params: ThreadOpenParams;       result: ThreadOpenResult };
  "thread.read":       { params: ThreadReadParams;       result: ThreadReadResult };
  "thread.close":      { params: ThreadRefParams;        result: EmptyResult };
  "thread.delete":     { params: ThreadRefParams;        result: EmptyResult };
  "thread.fork":       { params: ThreadForkParams;       result: ThreadForkResult };
  "thread.revert":     { params: ThreadRevertParams;     result: ThreadRevertResult };
  "thread.rename":     { params: ThreadRenameParams;     result: ThreadRenameResult };
  "models.list":       { params: ModelsListParams;       result: ModelsListResult };
  "thread.setModel":   { params: ThreadSetModelParams;   result: ThreadSetModelResult };
  "thread.compact":    { params: ThreadCompactParams;    result: ThreadCompactResult };
  "turn.start":        { params: TurnStartParams;        result: TurnStartResult };
  "turn.interrupt":    { params: TurnInterruptParams;    result: TurnInterruptResult };
  "turn.resume":       { params: TurnResumeParams;       result: TurnResumeResult };
  "events.subscribe":  { params: EventsSubscribeParams;  result: EventsSubscribeResult };
  "events.unsubscribe":{ params: EventsUnsubscribeParams;result: EmptyResult };
  "approval.respond":  { params: ApprovalRespondParams;  result: ApprovalRespondResult };
  "approval.list":     { params: ApprovalListParams;     result: ApprovalListResult };
  "command.list":      { params: CommandListParams;      result: CommandListResult };
  "command.run":       { params: CommandRunParams;       result: CommandRunResult };
  "settings.get":      { params: SettingsGetParams;      result: SettingsGetResult };
  "settings.set":      { params: SettingsSetParams;      result: SettingsSetResult };
  "settings.reset":    { params: SettingsResetParams;    result: SettingsSetResult };
  "settings.list":     { params: SettingsListParams;     result: SettingsListResult };
  "settings.readFile":  { params: SettingsReadFileParams;  result: SettingsReadFileResult };
  "settings.writeFile": { params: SettingsWriteFileParams; result: SettingsWriteFileResult };
  "usage.get":          { params: UsageGetParams;         result: UsageGetResult };
  "status.list":        { params: StatusListParams;       result: StatusListResult };
  "attachments.add":    { params: AttachmentsAddParams;   result: AttachmentsAddResult };
  "notify.list":        { params: NotifyListParams;       result: NotifyListResult };
  "host.shutdown":     { params: HostShutdownParams;     result: HostShutdownResult };
  "secret.list":       { params: SecretListParams;       result: SecretListResult };
  "secret.meta":       { params: SecretMetaParams;       result: SecretMetaResult };
  "secret.remove":     { params: SecretNameParams;       result: SecretRemoveResult };
  "secret.test":       { params: SecretNameParams;       result: SecretTestResult };
  "secret.references": { params: SecretNameParams;       result: SecretReferencesResult };
  "secret.audit":      { params: SecretAuditParams;      result: SecretAuditResult };
  "trust.get":         { params: TrustGetParams;         result: TrustStatus };
  "trust.decide":      { params: TrustDecideParams;      result: TrustStatus };
  "secret.beginEntry": { params: SecretBeginEntryParams; result: SecretBeginEntryResult };
}
export type WireMethodName = keyof WireMethodMap;
export type WireParams<M extends WireMethodName> = WireMethodMap[M]["params"];
export type WireResult<M extends WireMethodName> = WireMethodMap[M]["result"];

export interface ServerNotificationMap {
  "events.batch": EventsBatchParams;
  "events.ended": EventsEndedParams;
  "stream.chunk": StreamChunkParams;
  "settings.invalidated": SettingsInvalidatedParams;
  "notify.delivered": NotifyDeliveredParams;
}
export type ServerNotificationName = keyof ServerNotificationMap;
export type ServerNotificationParams<N extends ServerNotificationName> = ServerNotificationMap[N];

export interface ClientNotificationMap {
  "$/cancelRequest": CancelRequestParams;
  "$/connectionReset": EmptyParams;
}

/** 런타임 검사용 표. 키 집합은 MethodMap과 같아야 한다(타입 테스트로 확인). */
export interface WireMethodSpec {
  readonly params: TSchema;
  readonly result: TSchema;
  readonly since: SemVer;
  readonly status: FeatureStatus;           // §3.7
  readonly stage: "M1" | "M2" | "M3";
}
export declare const WIRE_METHODS: { readonly [M in WireMethodName]: WireMethodSpec };
export declare const WIRE_NOTIFICATIONS: { readonly [N in ServerNotificationName]: { readonly params: TSchema; readonly since: SemVer } };
```

- 각 `XxxParams`, `XxxResult` 타입은 같은 이름의 스키마 상수에서 `Static`으로 만든다. 그래서 `WireMethodMap`의 타입과 `WIRE_METHODS`의 스키마는 같은 원천을 갖는다.
- [제안] 문서 §3.3.1 표와 `WIRE_METHODS`의 키·단계가 일치하는지 검사한다(plan의 완료 기준).

#### 3.3.4 Runtime API 요청 판정표 [결정: m2c G1-08]

`review.decisions-2` U-04가 M2 계획에서 정하기로 미룬 요청을 하나씩 판정했다. "구현"은 호스트가 처리기를 갖는 단계다. 계약 선언이 필요한 요청은 해당 메서드·알림 표에 있다.

| 요청 | 판정 | 계약 | 구현 | 사유와 대체 경로 |
|---|---|---|---|---|
| `settings.invalidated` 알림(`L4.readme` §8 14번) | 받음 | M2 알림 표 | M2 | 파일 범위 변경을 다른 클라이언트와 MCP 정의 재적재가 알아야 한다. 값이 없어 시크릿이 실리지 않는다 |
| `settings.list`의 `range` 병합(15번) | 받음 | F 공통 함수 `toValueJsonSchema` | M3 | [결정: M3-REQ-15] `settings.list`는 `type`과 `range`를 따로 싣고, 합치는 일은 F의 `toValueJsonSchema(def: SettingDefWire)`가 한다(§4.10). 클라이언트와 호스트와 파일 검사가 한 규칙을 쓴다 |
| `settings.readFile`·`settings.writeFile`(36번) | 받음 | M3 메서드 표 | M3 | [결정: M3-REQ-15] 파일 단위 편집기가 쓴다. 파일 쓰기는 호스트 한 곳이다. 아래 "설정 파일 메서드" 설명을 본다 |
| `SettingsTab`·`SettingUi` 필드(37번) | 받음 | §3.8.2 | M3 | [결정: M3-REQ-15] `SettingsTab`에 `sandbox`를 더하고 `SettingUi`에 선택 필드 `editor`(전용 편집기 힌트)를 더한다 |
| `EffectiveSetting`의 잠금 사유 문구(39번) | 받음 | §3.8.2 | M3 | [결정: M3-REQ-15] 문구가 아니라 종류다. 선택 필드 `lockReason`(`managed_file`·`managed_policy`)을 호스트가 싣고 문장은 클라이언트가 만든다 |
| 사용량 wire 메서드(35번) | 받음 | `usage.get` | M3 | [결정: M3-REQ-15] 레이트 리밋·계정 회전 게이지(review.decisions-2 U-21)가 읽는다. 데이터 원천은 L1.models의 사용량 투영이다. 호스트 처리기는 원천 포트(조립 기본은 빈 목록)로 구현했고, 원천은 B2-MDL 트랙이 채운다 [구현: M3b B1-NTF H4] |
| 사용자 알림 wire 알림(13번) | 보류 | 없음 | M3 | 알림은 M3다(review.decisions-2 S-04). M2는 내구 이벤트 kind로 대상을 고른다 |
| `host.diagnose`(26번) | 반려 | 없음 | - | `doctor`는 `@fresnel/host`의 진단 함수를 직접 부른다. 서비스 모드에서 원격으로 진단할 필요가 생기면 그때 다시 올린다. 데스크톱 첫 실행 화면이 받는 외부 바이너리 점검은 `host.status`의 `includeBinaries`와 `binaries`다(§3.3.1) |
| `turn.interrupt`를 M1으로 당기기(25번) | 반려 | 없음 | - | M1 `chat`은 한 턴이고 프로세스 종료로 멈춘다. `turn.interrupt`는 M2 표에 있다 |
| 적합성 실행기 `testing` 서브패스(19번) | 반려 | 없음 | - | review.decisions-2 U-03. 실행기는 각 패키지 `test/`에 둔다 |

- [결정: M3-REQ-15] 설정 파일 메서드: `settings.readFile`은 범위 하나의 파일 원문을 돌려준다. 파일이 없으면 `exists: false`, `text: ""`, `sha256: null`이다. `managed`는 읽기만 되고 `readOnly: true`다. `project`·`local`은 작업 폴더가 있어야 하므로 `threadId`로 그 thread의 작업 폴더를 쓴다. `unknownKeys`는 카탈로그에 없는 키이고 파일에는 그대로 보존한다(§4.8). `settings.writeFile`은 파일 전체를 바꾼다. 호스트는 `text`를 JSON 객체로 읽고 그 범위의 `settingsJsonSchema`로 검사한 뒤 쓴다. `baseSha256`은 `readFile`이 준 해시이고 파일이 없었으면 null이다. 지금 파일과 다르면 `settings.fileConflict`(3107)이고, JSON 객체가 아니거나 스키마에 맞지 않으면 `settings.fileInvalid`(3108)다. `managed`에 쓰려는 요청은 `jsonrpc.invalidParams`다(params 스키마가 거른다). 쓰기에 성공하면 `settings.invalidated`를 보낸다.
- [결정: M3-REQ-15] `usage.get`은 사용량 게이지를 읽는다. `UsageGauge`는 `{ id, providerId, account, window, unit, used, limit, resetsAt }`이고 `window`는 `minute`·`hour`·`day`·`week`·`month`·`session`, `unit`은 `tokens`·`usd`·`requests`·`cacheRead`·`cacheWrite`다(뒤 둘은 T-MEAS-FIX가 더했다, 가산). `limit`이 null이면 한도를 모르는 것이라 화면은 사용량만 보인다. `threadId`를 주면 그 thread의 `session` 창을 더한다. 데이터 원천(레이트 리밋, 계정 풀)은 B2-MDL 트랙이 채우며, 그 전까지 `gauges`는 빈 목록이다 [구현: M3b B1-NTF H4].
- [결정: 오케스트레이터 기본값, M4 T-MODEL] `usage.get`의 `context`는 `threadId`를 줄 때만 오는 문맥 사용량이다. `used`는 그 대화에서 가장 나중에 끝난 모델 호출의 `usage.totalTokens`(입력, 캐시 읽기·쓰기, 출력의 합. 다음 요청이 담을 문맥의 크기와 같다), `limit`는 그 호출의 모델이 카탈로그에서 가진 `contextWindow`, `model`은 그 호출의 `provider/id`다. 끝난 호출이 없거나 문맥 창을 모르면(카탈로그에서 빠진 모델) 필드를 생략하고 비율을 지어내지 않는다. 게이지 목록(`gauges`)과 단위는 바뀌지 않는다.
- [결정: m2c G1-08] `settings.invalidated`의 `keys`는 바뀐 키 목록이고 비어 있으면 어느 키인지 모르는 변경(파일 통째 교체, 손상 복구)이다. `scopes`는 바뀐 범위이고 1개 이상이다. `threadId`는 `session` 범위 변경이 속한 thread이고 다른 범위면 `null`이다. 호스트는 모든 범위의 `settings.set`·`settings.reset`과 project·local·user 파일 변경 결과에 이 알림을 연결 전체에 보낸다. 같은 연결의 `settings.set` 호출자도 받는다.
- [결정: m2c G1-08] 설정 변경 반영 규칙의 소유자는 호스트다. 알림을 받은 클라이언트는 `settings.get`으로 다시 읽을 뿐이고 값을 추측해 바꾸지 않는다. MCP 정의 재적재는 호스트 안에서 같은 신호를 받아 다음 단계 시작에 처리한다(`L2.mcp.spec`).
- 판정이 "보류"인 요청은 M3 계획(`review.m3-plan`)이 받는다. 정하기 전에는 소비 문서가 이 요청에 의존하지 않는다.

### 3.4 커서, 구독, 휘발 스트림

#### 3.4.1 위치와 커서

```ts
// wire/cursor.ts
// F.records는 seq를 number로 두고 저장소 정체 필드를 두지 않는다. wire가 두 스키마를 정한다 [제안].
export const Seq = Type.Integer({ minimum: 0 });                       // 0은 "아직 이벤트 없음" 위치
export const StoreId = Type.String({ pattern: "^sto_[0-7][0-9A-HJKMNP-TV-Z]{25}$" });   // F.conversation ULID 규칙 + sto 접두

export const StreamPosition = Obj({ storeId: StoreId, seq: Seq });
export const SubscribeFrom = Type.Union([StreamPosition, Type.Literal("head")]);
export const SubId = Type.String({ minLength: 1, maxLength: 16, pattern: "^[A-Za-z0-9]+$" });

export const EventFilter = Obj({
  threadIds: Type.Optional(Type.Array(ThreadId, { maxItems: 64 })),
  kindPrefixes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { maxItems: 32 })),         // 예: "item.", "x.web-exa."
  excludeKindPrefixes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { maxItems: 32 })),
});

export const EventsSubscribeParams = Obj({ from: SubscribeFrom, filter: Type.Optional(EventFilter) });
export const EventsSubscribeResult = Obj({
  sub: SubId,
  start: Seq,                          // from.seq 또는 응답 시점의 headSeq
  headSeq: Seq,
  storeId: StoreId,
  mode: Type.Union([Type.Literal("replaying"), Type.Literal("live")]),
});
export const EventsUnsubscribeParams = Obj({ sub: SubId });

export const EventsBatchParams = Obj({
  sub: SubId,
  from: Seq,                           // 직전 알림의 to. 첫 알림이면 start
  to: Seq,                             // 이 알림이 책임지는 구간 (from, to]의 끝
  events: Type.Array(EventWire),       // 그 구간에서 필터에 맞는 내구 이벤트 전부, seq 오름차순
  caughtUp: Type.Boolean(),
});

export const ReplayOutOfRangeReason = Type.Union([
  Type.Literal("storeMismatch"), Type.Literal("aheadOfHead"),
  Type.Literal("beforeOldest"), Type.Literal("tooFar"),
]);
```

- [제안] 위치는 항상 `{storeId, seq}` 쌍이다. `storeId`는 DB 파일 하나의 정체이고, 백업 복원이나 DB 재생성 때 바뀐다. 클라이언트는 `storeId`가 다르면 그 위치를 버린다. `StoreId`의 발급과 보관(DB 메타 행)은 `L0.store.spec`에 요구한다. `sto` 접두는 `IdPrefix`에 넣지 않는다. 저장소 정체성 ID 부류(`F.conversation.spec` §3.2.1 ①)로 이 스키마가 정의하고 `L0.store`가 내부 ULID 생성기로 발급한다 [제안].
- `seq`는 내구 이벤트만 받고 DB 전체에서 단조 증가한다(`F.records.spec` §4.1). 대화 저장 C안은 단일 DB이므로 저장소 하나에 seq 수열이 하나다([결정] `_research/decisions-log.md` 2026-10-21 2차).
- [제안] 계약은 seq의 빈칸 없음에 의존하지 않는다. `(from, to]` 구간 계약과 필터 구독은 빈칸이 있어도 같은 결과를 낸다(19 §3.5.1).

#### 3.4.2 구독 계약

19 §3.5.3을 이식한다.

1. 한 구독의 `events.batch` 알림에서 `from`은 직전 알림의 `to`와 같다. 첫 알림의 `from`은 응답의 `start`다.
2. 알림 하나는 `(from, to]`에서 필터에 맞는 내구 이벤트를 빠짐없이, 중복 없이, seq 오름차순으로 담는다.
3. 맞는 이벤트가 없는 구간도 `events: []`로 위치를 넘길 수 있다.
4. 응답보다 그 구독의 알림이 먼저 가지 않는다.
5. `caughtUp: true`를 받은 뒤로는 실시간 단계다.

#### 3.4.3 재전송 알고리즘 [제안]

19 §3.5.4의 알고리즘을 옮긴다. 달라진 점은 데몬 대신 L4 host가 실행한다는 것과, 저장소 읽기가 `L0.store.spec`의 읽기 API라는 것뿐이다.

```text
events.subscribe(params) on connection c:
  1. filter 검사. 실패 → events.filterInvalid
  2. 연결당 구독 수 검사. 초과 → events.subscriptionLimit
  3. 같은 이벤트 루프 턴 안에서(커밋 방송과 섞이지 않게):
       head ← store.headSeq()
       if from == "head": start ← head
       else:
         if from.storeId ≠ storeId          → replay.outOfRange {reason: storeMismatch}
         if from.seq > head                  → replay.outOfRange {reason: aheadOfHead}
         if from.seq < oldestReplayable - 1  → replay.outOfRange {reason: beforeOldest}
         if head - from.seq > maxReplayEvents → replay.outOfRange {reason: tooFar}
         start ← from.seq
       sub ← {id, filter, pos: start, state: start < head ? replaying : live, pending: []}
       c.subs.add(sub)
  4. 응답 {sub.id, start, headSeq: head, storeId, mode}를 송신 큐에 넣는다
  5. if replaying:
       upto ← head
       while sub.pos < upto:
         송신 큐가 lowWater(1 MiB) 아래로 내려갈 때까지 기다린다
         rows ← store.read(seq > sub.pos AND seq ≤ upto, filter, limit = replayBatchMaxEvents, scanLimit)
         to ← rows가 limit만큼 찼으면 마지막 행의 seq, 아니면 이번에 훑은 구간의 끝
         send events.batch{sub, from: sub.pos, to, events: rows, caughtUp: false}
         sub.pos ← to
       for batch in sub.pending (커밋 순서):
         matching ← batch 중 seq > sub.pos 이고 filter에 맞는 것
         send events.batch{sub, from: sub.pos, to: batch.lastSeq, events: matching, caughtUp: batch가 마지막}
         sub.pos ← batch.lastSeq
       sub.pending ← []; sub.state ← live
       (마지막 알림의 caughtUp은 true)

on commit(batch: seq 구간 (a-1, b]), 커밋 직후 같은 턴에서:
  for each sub s of each connection:
    if s.state == replaying: s.pending.push(batch); continue
    matching ← filter(batch)
    if matching이 비었으면: 다음 tick에 빈 알림으로 위치를 넘긴다; continue
    send events.batch{s.id, from: s.pos, to: b, events: matching, caughtUp: true}; s.pos ← b
```

- 3단계의 head 읽기와 구독 등록은 같은 이벤트 루프 턴에서 한다. bun:sqlite는 동기 API이고 커밋 방송도 같은 스레드에서 하므로 그 사이에 커밋이 끼어들 수 없다. [가정] L0.store가 커밋을 다른 스레드로 옮기지 않는다. 옮기면 등록과 방송을 직렬화하는 잠금이 필요하다.
- 한도 기본값 [제안]: `maxReplayEvents` 100,000, `replayBatchMaxEvents` 500, `scanLimit` 10,000, 연결당 구독 16. 값은 L4 host 설정 키로 노출할 수 있고 그 키는 `L4.host-service.spec`이 소유한다.
- `replay.outOfRange`를 받은 클라이언트의 복구 절차는 19 §3.5.5의 1·2단계(위치 버림, `from: "head"`로 재구독)만 이식한다. 뷰 스냅샷(`view.get`)은 Fresnel 계약에 없다. [결정: m2 F.2] thread 상태 재조회는 `thread.read`가, 대기 승인 재조회는 `approval.list`가 맡는다(§3.4.6).

#### 3.4.4 휘발 스트림

| 구분 | 내구 이벤트 | 휘발 스트림 |
|---|---|---|
| 알림 | `events.batch` | `stream.chunk` |
| seq | 있음 | 없음. `(threadId, turnId)` 안 조각 번호 `n`(0부터)과 발신 시점의 마지막 내구 seq `afterSeq` |
| 재전송 | `from` 위치부터 | 없음 |
| 놓쳤을 때 | 재구독 | 버린다. 완성된 내용은 내구 이벤트로 다시 온다 |
| 구독 | `events.subscribe` 필요 | [제안] 연결이 소유한 thread 또는 관찰 중인 thread의 조각을 구독 없이 보낸다 |

```ts
// wire/notifications.ts
/** 휘발 이벤트 하나. F.records VolatileEventEnvelope에서 recordedAt만 IsoTime으로 바꾼 모양이다. */
export const VolatileEventWire = Obj({
  id: EventId,
  kind: EventKind,                     // 휘발 kind: item.started, item.updated, turn.updated, step.updated, 확장 휘발 kind
  version: Type.Integer({ minimum: 1 }),
  durable: Type.Literal(false),
  threadId: ThreadId,
  turnId: Type.Union([TurnId, Type.Null()]),
  stepId: Type.Union([StepId, Type.Null()]),
  recordedAt: IsoTime,
  causationId: Type.Union([EventId, Type.Null()]),
  correlationId: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  n: Type.Integer({ minimum: 0 }),
  afterSeq: Seq,
  payload: Type.Unknown(),             // kind별 payload. 토큰 델타는 item.updated의 ItemUpdatedPayload(update.kind "part_delta", PartDelta)
});
export const StreamChunkParams = Obj({ event: VolatileEventWire });
```

- [결정] 토큰 델타는 휘발로 UI에만 보내고 완성된 파트만 저장한다(`_research/item-catalog.md` F절 "내구·휘발 이벤트 구분", `_research/process.md` §6.1).
- 휘발 kind 목록은 `F.records.spec` §3.3 카탈로그의 durable "아니오" 행이다. wire는 그 목록을 다시 정하지 않는다.
- 클라이언트는 같은 item의 완성 기록(`item.recorded`, `part.recorded`)을 `events.batch`로 받으면 그 item의 휘발 조각을 버린다.
- 클라이언트는 `afterSeq`까지의 내구 이벤트를 받기 전에는 그 조각 적용을 미룰 수 있다(`F.records.spec` §3.1).

#### 3.4.5 EventWire

[제안] `EventWire`는 `F.records.spec`의 `DurableEventEnvelope`에서 파생한다. 바꾸는 점만 정한다.

| 항목 | `DurableEventEnvelope`(저장) | `EventWire`(전송) |
|---|---|---|
| `recordedAt` | ms 정수 | ISO 8601 UTC 문자열(`IsoTime`) |
| `detached` | blob으로 옮긴 필드 목록. payload 자리에는 `blob:sha256:<hex>` 자리표시 | 그대로 싣는다. 클라이언트가 blob 내용을 받는 메서드는 M2 이후 [제안] |
| `redactions` | 없음(`F.records.spec` §3.1.1이 wire로 이관) | 2차 방어로 가린 payload 필드 이름. 1차 방어는 "payload에 시크릿 값을 넣지 않는다"는 기록 규칙이다 |
| `mask` | 없음 | `item.recorded`에만 붙는 화면 가림 표식(선택). §3.4.5a [결정: 2026-11-03 사용자] |
| 그 밖의 필드(`id`, `kind`, `version`, `durable`, `seq`, `parentId`, `threadId`, `turnId`, `stepId`, `causationId`, `correlationId`, `payload`) | `F.records.spec` §3.1 | 이름과 값 그대로 |

```ts
// wire/notifications.ts
export const IsoTime = Type.String({ format: "date-time", maxLength: 32 });

/** 내구 이벤트 하나. DurableEventEnvelope의 필드를 그대로 옮기고 recordedAt만 IsoTime으로 바꾸고 redactions를 더한다. */
export const EventWire = Obj({
  id: EventId,
  kind: EventKind,                     // F.records EventKindSchema
  version: Type.Integer({ minimum: 1 }),
  durable: Type.Literal(true),
  seq: Type.Integer({ minimum: 1 }),
  parentId: Type.Union([EventId, Type.Null()]),
  threadId: ThreadId,
  turnId: Type.Union([TurnId, Type.Null()]),
  stepId: Type.Union([StepId, Type.Null()]),
  recordedAt: IsoTime,
  causationId: Type.Union([EventId, Type.Null()]),
  correlationId: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  payload: Type.Unknown(),
  detached: Type.Optional(Type.Array(DetachedField, { maxItems: 256 })),   // F.records DetachedFieldSchema
  redactions: Type.Array(Type.String({ maxLength: 128 }), { maxItems: 64 }),  // RFC 6901 포인터, payload 기준
});

/** 순수 함수. 저장 이벤트를 전송 표현으로 바꾼다. redact가 돌려준 포인터의 값을 지우고 redactions에 적는다. */
export declare function toEventWire(event: DurableEventEnvelope, redact?: (event: DurableEventEnvelope) => readonly string[]): EventWire;
export declare function toVolatileEventWire(event: VolatileEventEnvelope): VolatileEventWire;
```

#### 3.4.5a 화면 가림 표식 [결정: 2026-11-03 사용자]

[결정: 2026-11-03 사용자] 값을 화면에 보이지 않게 하는 일은 클라이언트가 호스트가 준 구간을 적용하는 것으로 한다. 호스트는 `L0.secrets` §3.5의 `displayRanges`·`displayVisibleLength`·`displayLeafMasks`로 구간을 구하고, 구간·길이·표지 이름만 wire에 싣는다. 값도 값의 모양도 싣지 않는다. 이벤트의 payload와 저장 행은 바뀌지 않는다. 표식은 선택 필드다. 표식이 없는 이벤트는 그대로 그린다.

| 위치 | 필드 | 내용 |
|---|---|---|
| `events.batch`의 `EventWire` | `mask?: LeafMask[]` | `item.recorded`, `approval.requested`, `input.queued`에 붙는다. `item.recorded`의 포인터는 payload의 `item` 기준(예: `/message/content`), `approval.requested`와 `input.queued`의 포인터는 payload 기준이다(`/title`, `/body/tool/args/command`, `/item/content`, `/item/content/0/text`). `input.queued`는 대기 입력 칩이 보이는 글(`/item` 아래 문자열)만 가리고 요청 키와 모드는 가리지 않는다. 클라이언트는 `maskQueuedInput`으로 적용하고, 맞지 않으면 읽을 수 없는 사실로 둔다. 가릴 것이 없으면 필드가 없다 |
| `thread.read` 결과 | `masks?: ItemMaskEntry[]` | 가릴 잎이 있는 item만 `{ itemId, leaves }`로 싣는다. `items`는 바뀌지 않는다 |
| `approval.list` 결과 | `masks?: ApprovalMaskEntry[]` | 출처(caller 등)와 본문의 문자열 전부(도구 인자, 계획, 질문, 검토)에 가릴 것이 있는 승인만 `{ approvalId, leaves }`로 싣는다. `approvals`는 바뀌지 않는다. 요청 키와 식별자는 가리지 않는다 |
| `stream.chunk`의 `item.updated` `part_delta` | `delta.mask?: PartMask` | 진행 중 파트 조각의 누적 표식(아래 규칙 3) |

`LeafMask` = `{ pointer, len, ranges }`. `len`은 호스트가 잰 잎 길이, `ranges`는 `{ start, end, label }`의 목록이다. `[start, end)`는 잎 문자열의 UTF-16 위치이고, 구간은 겹치지 않고 start 순서다. `label`은 표지 안쪽 말(`known:<이름>`, 패턴 kind, `kv`)이다.

규칙:

1. 판정은 호스트만 한다. 클라이언트는 패턴을 모르고 구간만 적용한다. 공용 적용기는 F 층의 `packages/contracts/src/conversation/display-mask-apply.ts`(DR-10: 앱끼리 import하지 않도록 가장 낮은 층에 둔다)의 `applyRanges`, `maskItemRecord`, `maskPartText`다. 데스크톱, 웹, 휴대폰이 같은 함수를 쓴다.
2. 잎의 길이가 `len`과 다르면 그 잎은 `[REDACTED:unverified]`가 된다. 구간이 범위 밖이거나 겹치면 잎 전체를 가린다. 가리킨 자리가 문자열이 아니면 item을 읽지 못한 것으로 두고 거울에 넣지 않는다(닫힌 쪽으로 실패).
3. 진행 중 파트(`part_delta`): 호스트는 파트마다 받은 조각을 이어 누적 원문을 든다(프로세스 메모리, 직렬화하지 않는다). 연결이 없는 thread의 조각도 셈한다. 보이는 앞부분(`visible`)은 마지막 공백까지다. 공백 뒤의 낱말은 값의 일부일 수 있으므로 뺀다. 알려진 값 변형의 앞부분과 닫히지 않은 PEM 블록도 뺀다. 구간(`ranges`)은 그 앞부분에서만 구한다. `end` 조각에서는 누적이 끝났으므로 꼬리를 빼지 않는다. `len`은 누적 전체 길이다.
4. 클라이언트는 조각을 `delta` 단계만 이어 붙여 원문 길이를 본다. 길이가 `len`과 다르면 조각을 놓친 것이므로 파트를 비운다. 조각은 휘발이라 송신 큐가 찬 연결에서 버려질 수 있다(§3.4.4). 확정 item(`item.recorded`)이 오면 그 item을 그린다. 놓친 파트는 확정될 때까지 그리지 않는다.
5. `verified: false`는 호스트가 누적을 믿을 수 없다는 뜻이다(시작 조각을 보지 못했거나 추적 상한 4096을 넘었다). 클라이언트는 그 파트를 그리지 않는다.
6. 호스트는 `part_completed`를 받으면 그 파트의 누적을 버린다. 확정 item이 기록되면 그 item의 파트 누적을 버린다. 누적은 조각이 아니라 파트마다 하나다.
7. 표식의 어떤 필드에도 값이 없다. 시험은 새 필드를 JSON으로 펼쳐 값이나 그 앞부분이 없는지 본다.
8. 표식을 싣지 않는 호스트(이전 빌드)와 이 클라이언트가 섞이면 표식이 없어 그대로 그린다. 같은 빌드의 호스트와 클라이언트가 함께 쓰는 것이 전제다.

#### 3.4.6 스냅샷과 이벤트 이어 붙이기 [결정: m2 F.2]

`thread.list`, `thread.read`, `approval.list`는 이벤트 구독과 별개의 읽기다. 클라이언트(L4 UI)가 재설정이나 재동기화 뒤 `from: "head"`로 다시 구독하면 그 이전 이벤트는 오지 않으므로, 이 읽기 결과 위에 구독 이벤트를 빠짐없이, 중복 없이 이어 붙이는 규칙을 계약으로 정한다.

1. `position`의 뜻: `thread.read`와 `approval.list`는 대상을 읽는 일과 `headSeq()` 읽기를 같은 읽기 트랜잭션에서 한다(`L0.store`의 동기 읽기 한 번). `position.seq`는 그때의 저장소 head이고, 이 seq 이하의 그 thread 이벤트(`approval.list`는 `approval.requested`·`approval.resolved`)는 결과에 모두 반영되어 있으며 이 seq를 넘는 이벤트는 하나도 반영되어 있지 않다. `position.storeId`는 `events.subscribe` 응답의 `storeId`와 같다.
2. 클라이언트 절차:
   1. `events.subscribe({from: "head"})`의 응답을 받는다(`start`).
   2. 그 응답 뒤에 `thread.read`나 `approval.list`를 보낸다. 읽기 시점의 head는 `start` 이상이므로 `(start, position.seq]` 구간의 이벤트는 구독으로도 오고 결과에도 들어 있다.
   3. 결과를 적용한 뒤에는 `seq <= position.seq`인 이벤트를 적용하지 않고 `seq > position.seq`인 이벤트만 적용한다. 응답보다 먼저 도착한 `events.batch`의 이벤트는 응답을 적용할 때까지 보관했다가 같은 규칙으로 거른다.
   4. `position.storeId`가 구독의 `storeId`와 다르면 결과를 버리고 처음부터 다시 한다.
   5. 구독보다 먼저 읽었다면(`position.seq < start`) `(position.seq, start]` 구간이 비는 구멍이 생긴다. 그때는 다시 읽거나 `from: position`으로 구독한다.
3. `thread.read` 페이지: `before`가 없으면 가장 새 item부터 `limit`개(기본 200)이고, 있으면 그 item 바로 앞부터 `limit`개다. `items`는 오래된 것부터 정렬하며 `items[0].itemId`가 다음 페이지의 `before`다. `hasMore`가 거짓이면 `items[0]`이 thread의 첫 item이다. 호스트는 프레임 한도 때문에 `limit`보다 적게 돌려줄 수 있고 그때도 `hasMore`는 정확해야 한다. 이어 붙이기 기준은 `before` 없는 첫 읽기의 `position`뿐이다. 이전 페이지의 item은 바뀌지 않으므로 뒤 페이지의 `position`은 쓰지 않는다. 이 thread에 없는 `before`는 `thread.invalidTarget`(3005, `reason: "item_not_found"`), 현재 가지에 없는 `before`는 `reason: "not_on_branch"`다. 없는 thread는 `thread.notFound`(3001)다.
3.1. fork 연속성 [결정: m2c G2-11]: fork로 만든 thread(`ThreadSummary.forkedFrom`이 있는 thread)의 `thread.read`는 그 thread 자신의 현재 가지 앞에 원본 thread의 `forkedFrom.eventId`까지 활성 사슬의 item을 잇는다. 모델이 보는 컨텍스트 사슬과 같다(`L1.persistence.spec` §4.10.3 "컨텍스트 조립은 출처 thread의 `eventId`까지 활성 사슬을 앞에 잇는다"). 원본 item은 복사하지 않으므로 `itemId`는 원본 그대로이고, 원본이 다시 fork이면 사슬을 거슬러 올라간다.
   - 쪽 나누기는 경계를 넘는다. `before`가 원본 사슬의 item이어도 `item_not_found`가 아니고, 가지가 원본으로 이어지는 동안 `hasMore`는 참이다. 거짓은 맨 위 원본 thread의 첫 item까지 돌려준 뒤다. 이 thread에도 원본 사슬에도 없는 `before`가 `item_not_found`다.
   - 이어 붙이기 기준(`position`)은 이 thread의 이벤트에만 적용한다. 원본 thread에 fork 뒤 쓰기가 있어도 fork 위치까지의 사슬은 바뀌지 않으므로 원본 이벤트는 이 thread의 구독이나 `position`과 무관하다.
   - 원본 사슬 쪽 item은 이 thread에서 되감기나 fork의 대상이 아니다. `thread.revert`·`thread.fork`의 `to`·`at`이 원본 사슬 item이면 `thread.invalidTarget`(`reason: "not_on_branch"`)이다 [제안].
   - 구현은 M3에 해도 된다. 그때까지 호스트가 fork thread의 자기 가지만 돌려주고 `hasMore: false`로 끝나는 것은 이 규칙과 다른 알려진 한계다(`L4.host-service.spec` §10 22번).
4. 스냅샷의 범위: `items`는 커밋된 `ItemRecord`만 담는다. 스트리밍 중인 item(`item.started` 이후 아직 `item.recorded`가 없는 것)은 휘발 사실이라 스냅샷에 없다. 그 item의 조각은 §3.4.4대로 다시 보내지 않고, 완성본은 `item.recorded`로 온다. 되감기(`thread.revert`)로 현재 가지가 바뀌면 클라이언트는 `thread.read`를 처음부터 다시 읽는다.
5. 대기 승인: `approval.list`는 재설정이나 재동기화 뒤 승인 대기열을 다시 만드는 데 쓴다. 이어 붙이기는 `thread.read`와 같다. 목록에 반영된 `approval.requested`가 재전송으로 다시 와도 `seq <= position.seq`라 적용하지 않으므로, 이미 해결된 요청이 대기열에 되살아나지 않는다. 승인이 대기 중인 thread는 `ThreadSummary.pendingApprovals`가 0보다 큰 thread이므로 클라이언트는 그 thread에만 요청한다.
6. "비어 있음"과 "읽는 중"의 구분: F는 `events.subscribe` 응답이나 `ThreadSummary`에 별도 신호를 더하지 않는다(L4.desktop 상태 설계 §14 12번). `thread.list`, `thread.read`, `approval.list`는 모두 요청과 응답이고, 응답이 곧 "읽기를 마쳤다"는 신호이기 때문이다. 클라이언트는 요청을 보낼 때 `loading`, 성공 응답을 적용할 때 `ready`(빈 목록이어도), 오류 응답을 받을 때 `failed`로 둔다. 목록 읽기는 JSON-RPC 오류로 실패하므로 실패와 빈 결과도 구분된다. `events.subscribe` 응답에 "비어 있음" 표시를 두지 않는 이유는, 구독은 이벤트만 책임지고 thread 목록과 스냅샷은 필터와 페이지가 있는 별도 읽기라서 호스트가 응답 시점에 비어 있음을 판정할 수 없기 때문이다. `thread.list` 목록은 모든 페이지(`nextCursor`가 `null`일 때까지)를 받은 뒤 `ready`다.
7. [제안] `thread.list`에는 `position`을 더하지 않는다. 목록 원소의 `ThreadSummary.headSeq`가 그 thread의 마지막 seq이므로, 클라이언트는 같은 thread의 이벤트 중 `seq <= headSeq`인 것을 목록에 다시 적용하지 않는 것으로 이어 붙인다.

#### 3.4.7 대화 내보내기 [제안]

`thread.export`는 현재 가지의 item(§3.4.6 3항의 `thread.read`와 같은 집합과 순서)을 사람이 읽는 문서(`markdown`)나 `ItemRecord` 배열(`json`)로 옮긴다. 소유를 얻지 않는 읽기다. 없는 thread는 3001이다.

1. 쪽과 이어 붙이기: `after`가 없으면 첫 쪽이다. 결과 `next`가 있으면 그 값을 다음 요청의 `after`로 넣어 `next`가 없는 마지막 쪽까지 부른다. 쪽들의 `chunk`를 받은 순서대로 이어 붙이면 한 문서다. 예산보다 큰 item이 없으면 쪽 수와 상관없이 한 번에 만든 문서와 같다. `filename`은 제목을 한 줄로 다듬고 파일 이름에 쓸 수 없는 글자를 `_`로 바꾼 줄기에 `.md`나 `.json`을 붙인 것이다(줄기는 UTF-16 120자 이하). 제목이 없거나 가릴 값이 있으면 줄기는 thread id다.
2. 쪽 크기: 쪽의 `chunk`는 UTF-8 바이트로 `WIRE_LIMITS.maxFrameBytes - 64 KiB` 이하다. `thread.read`의 응답 예산(L4.host-service.spec HS-49)과 같은 계산이다. 쪽 경계는 item 경계다. 첫 쪽은 머리말을 싣는다(markdown은 `# 제목`, `- Thread ID`, `- Items` 줄, json은 `[`). 마지막 쪽은 꼬리를 싣는다(json은 `]`, markdown은 없음). json에서는 문서의 첫 item 앞에 쉼표를 두지 않고 그 밖의 item마다 `,\n`을 앞에 붙인다.
3. 예산보다 큰 item: markdown은 예산 안의 앞부분만 싣고 줄였다는 표지를 붙인다. json은 `{"itemId":…,"omitted":"too_large"}` 객체로 바꾼다. json 문서는 어떤 쪽 나누기에서도 올바른 JSON이다.
4. 화면 가림: 본문은 `thread.read`와 같은 잎 표식(§3.4.5a)을 적용한 item으로 만든다. 가린 값은 본문에도 파일 이름에도 나오지 않는다. 잎 표식을 적용할 수 없는 item은 markdown에 `[unreadable item]`, json에 `{"itemId":…,"omitted":"unreadable"}`로 남긴다.
5. markdown 모양: User, Assistant, Tool result, System, Extension message마다 제목 줄 하나를 둔다. 생각(thinking) 블록과 확장 메시지의 `details`는 싣지 않는다. `Tool call:` 줄 아래 이름과 인자 JSON의 펜스 블록이다. 도구 결과는 2000자까지 싣고 넘으면 표지를 붙인다. 이미지는 `[image: <MIME>]` 한 줄이고 데이터는 싣지 않는다.
6. 오류: `after`가 현재 가지에 없으면 `thread.invalidTarget`(3005, `reason: "item_not_found"`)이다. 같은 thread의 다른 가지에 있는 item도 이 값이다. 저장소를 읽지 못하면 `store.*`다. 이 메서드는 오류 종류를 새로 더하지 않는다.

### 3.5 오류

#### 3.5.1 오류 객체

```ts
// wire/errors.ts
export const WireErrorData = Type.Object({
  kind: Type.String({ minLength: 1, maxLength: 96 }),     // 오류 종류 이름. 예: "settings.locked"
  retryable: Type.Boolean(),
  retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  traceId: Type.Optional(Type.String({ maxLength: 64 })),
});
export const JsonRpcError = Obj({
  code: Type.Integer(),
  message: Type.String({ maxLength: 512 }),               // 개발자용 영어 한 줄. 화면에 그대로 쓰지 않는다
  data: WireErrorData,
});
export type WireErrorData = Static<typeof WireErrorData>;
export type JsonRpcError = Static<typeof JsonRpcError>;

export interface WireErrorSpec {
  readonly code: number;
  readonly kind: string;
  readonly retryable: boolean;
  readonly details?: TSchema;
}
export declare const WIRE_ERRORS: Readonly<Record<string, WireErrorSpec>>;   // kind → 정의
```

- `WireErrorData`는 `additionalProperties`를 열어 둔다. 새 필드를 더해도 옛 클라이언트가 깨지지 않게 하기 위해서다.
- 알 수 없는 예외는 `-32603 internal`로 바꾸고 `message`는 `"Internal error"`로 둔다. 원인은 로그에만 남기고 `traceId`로 연결한다(19 §3.3.3과 같다).
- 화면 문구는 `kind`와 `details`로 L4가 만든다.

#### 3.5.2 M1 오류 목록

| code | kind | retryable | 뜻 | details |
|---|---|---|---|---|
| -32700 | `jsonrpc.parseError` | false | JSON으로 읽을 수 없다 | - |
| -32600 | `jsonrpc.invalidRequest` | false | envelope 위반, 배치, id 형식, 진행 중 id 재사용, 깊이·길이·프레임 한도 | `issue` |
| -32601 | `jsonrpc.methodNotFound` | false | 모르는 메서드, 또는 opt-in하지 않은 실험 메서드 | `method` |
| -32602 | `jsonrpc.invalidParams` | false | params 스키마 위반 | `issues: {path, message}[]` |
| -32603 | `internal` | true | 내부 오류(정제됨) | - |
| 1001 | `host.helloRequired` | false | `host.hello` 전에 다른 메서드를 불렀다 | - |
| 1002 | `host.helloDuplicate` | false | `host.hello`를 두 번 보냈다 | - |
| 1003 | `protocol.unsupported` | false | 주 버전이 다르다 | `serverVersion`, `clientVersion` |
| 1004 | `host.authFailed` | false | `host.hello`의 `auth.token`이 없거나 맞지 않다. TCP로 열 때만 난다(로컬 Unix 소켓은 파일 권한이 막는다). 응답 뒤 연결을 닫는다 | `reason: "missing"\|"invalid"` |
| 2001 | `replay.outOfRange` | false | 그 위치에서 재전송할 수 없다 | `reason`, `storeId`, `headSeq`, `oldestReplayableSeq` |
| 2002 | `events.subscriptionNotFound` | false | 없는 구독 ID | `sub` |
| 2003 | `events.subscriptionLimit` | false | 연결당 구독 한도 초과 | `max` |
| 2004 | `events.filterInvalid` | false | 필터가 잘못되었다 | `issue` |
| 3001 | `thread.notFound` | false | 없는 thread | `threadId` |
| 3002 | `thread.locked` | true | 다른 프로세스가 쓰기 소유 중이다. `thread.open(mode write)`와 `turn.start`의 암묵 획득(§3.3.1)에서 난다 | `ownerKind`, `options: ("observe"\|"fork"\|"delegate")[]` |
| 3003 | `turn.busy` | true | 진행 중 turn이 있어 새 turn을 받을 수 없다 | `turnId` |
| 3004 | `thread.hasForks` | false | 이 thread를 `forkedFrom`으로 가리키는 thread가 있어 `thread.delete`를 거절했다 | `forks: ThreadId[]` |
| 3005 | `thread.invalidTarget` | false | `thread.fork`·`thread.revert`의 대상이 맞지 않는다. `thread.read`의 `before`가 이 thread에 없거나(`item_not_found`) 현재 가지에 없을 때(`not_on_branch`)도 이 오류다 | `reason: "item_not_found"\|"not_on_branch"\|"inside_turn"\|"open_tool_calls"` |
| 3006 | `thread.cancelledByExtension` | false | 확장이 thread 전환·분기·되감기·컴팩션을 막았다 | `point: "thread.fork.before"\|"thread.tree.before"\|"thread.switch.before"\|"thread.compact.before"`, `reason: string \| null` |
| 3007 | `thread.closed` | false | 이미 닫힌 thread에 쓰기나 수명 주기 호출(`turn.start`, `turn.resume`, `thread.open(write)`, `thread.fork`, `thread.revert`)을 했다. `thread.read`, `thread.list`, `thread.delete`는 닫힌 thread에도 된다 | `threadId` |
| 3008 | `thread.compactFailed` | false | `thread.compact`가 요약을 만들거나 커밋하지 못했다. 요청 취소는 5001이고 확장이 막은 것은 3006이다 | `reason: "read_failed"\|"projection_failed"\|"summary_failed"\|"summary_has_tool_call"\|"summary_truncated"\|"commit_failed"` |
| 3101 | `settings.unknownKey` | false | 등록되지 않은 키 | `key` |
| 3102 | `settings.invalidValue` | false | 값이 스키마나 range에 맞지 않는다 | `key`, `issues` |
| 3103 | `settings.scopeNotAllowed` | false | 그 범위에 쓸 수 없는 키 | `key`, `scope`, `allowedScopes` |
| 3104 | `settings.locked` | false | 관리 범위가 잠근 키 | `key`, `lockedBy: "managed"` |
| 3105 | `settings.secretValue` | false | 시크릿 키에 참조가 아닌 값을 넣었다 | `key` |
| 3106 | `settings.reserved` | false | 읽는 코드가 아직 없는 `stage: "reserved"` 키에 쓰려 했다(§3.8.2) | `key` |
| 3107 | `settings.fileConflict` | false | `settings.writeFile`의 `baseSha256`이 지금 파일과 다르다. 다시 읽고 합친 뒤 보낸다 | `scope` |
| 3108 | `settings.fileInvalid` | false | `settings.writeFile`의 `text`가 JSON 객체가 아니거나 그 범위의 스키마에 맞지 않는다 | `scope`, `issues: {path, message}[]` |
| 3201 | `secret.notFound` | false | 그 이름의 시크릿이 메타(`meta`)나 제공자(`provider`)에 없다. `secret.remove`는 이미 없는 이름이면 오류 없이 `removed: false`다 | `where` |
| 3202 | `secret.denied` | false | 사용 정책이 거부했다(`SecretDenyReason`) | `reason` |
| 3203 | `secret.providerUnavailable` | false | 제공자를 쓸 수 없다(바이너리 없음, 버전이 낮음, 등록 안 됨) | `provider`, `reason` |
| 3204 | `secret.keyUnavailable` | false | 복호화 키를 쓸 수 없다(키체인 잠금, 항목 없음, 접근 거부, 파일 모드) | `key`, `reason` |
| 3205 | `secret.decryptFailed` | false | 제공자가 값을 풀지 못했다. 외부 도구의 출력은 싣지 않는다 | `provider`, `exitCode` |
| 3206 | `secret.inUse` | false | 열려 있는 drive 락이 있어 삭제할 수 없다 | `activeLeases` |
| 3207 | `secret.alreadyExists` | false | 같은 이름이 이미 있다(`beginEntry add`) | - |
| 3208 | `secret.readOnlyProvider` | false | 쓰기를 지원하지 않는 제공자다 | `provider` |
| 3209 | `secret.reauthRequired` | false | 사람 재확인이 끝나지 않았다 | - |
| 3210 | `secret.cancelled` | false | 사람이 입력이나 확인을 취소했다. 아무것도 저장되지 않았다 | - |
| 3211 | `secret.auditUnwritable` | false | 감사 기록을 쓸 수 없어 동작을 멈췄다 | `code` |
| 3212 | `secret.writeFailed` | false | 키 파일, OS 키 저장소, 기본 SOPS 시크릿 파일 쓰기에 실패했다. 값과 경로는 싣지 않는다 | `target`(`key_file`, `key_store`, `sops_file`), `code` |
| 3301 | `profile.notFound` | false | 그 id의 프로필이 없다(`profile.get`, `profile.delete`, `profile.apply`, `profile.preview`, `thread.create { profileId }`) | `id` |
| 3302 | `profile.conflict` | false | `profile.put`의 `baseRev`가 저장된 `rev`와 다르다. `rev`가 null이면 저장된 프로필이 없다. 다시 읽고 합친 뒤 보낸다 | `id`, `rev`, `baseRev` |
| 3303 | `profile.fileCorrupt` | false | `profiles.json`이 JSON이 아니거나 모양이 틀리다. 호스트는 덮어쓰지 않는다 | `reason`(200자까지) |
| 3304 | `profile.trustRequired` | false | 신뢰하지 않은 작업 폴더의 `project` 층에는 적용하지 않는다 | `workspace` |
| 3305 | `profile.applyPartial` | false | 적용이 중간에 실패했고 되돌리기도 실패했다. 쓰인 채 남은 키를 알린다 | `written`(256개까지), `failed` |
| 3306 | `profile.limit` | false | 프로필 개수가 상한을 넘는다 | `max` |
| 3311 | `testRun.unavailable` | false | 이 호스트에는 Test run 제어 포트가 없다 | - |
| 3312 | `testRun.notATestRun` | false | 그 대화는 Test run이 아니다 | - |
| 3313 | `testRun.notPaused` | false | Test run이 멈춰 있지 않아 `testRun.resume`·`testRun.step`을 받지 않는다 | - |
| 3401 | `extension.notFound` | false | 그 이름의 확장이 설치되어 있지 않다(`ext.get`, `ext.reenable`, `ext.reload`, `ext.health`, `ext.timings`) | `name` |
| 3402 | `group.notFound` | false | 그 id의 그룹이 설치되어 있지 않다(`group.metrics`) | `id` |
| 3403 | `extension.safeModeActive` | false | 안전 모드라 `ext.reenable`·`ext.reload`를 받지 않는다. 안전 모드를 끄고 다시 시작해야 한다 | - |
| 3405 | `hooks.notFound` | false | 그런 이름의 훅이 없다(`hooks.order.set`, `hooks.order.reset`, `hooks.order.preview`, `hooks.disableConfirm`, `hooks.reenable`). [결정: 2026-11-03 사용자] 3404는 옛 `hooks.guardPinned`(guard 고정 거절)가 쓰던 번호라 지금은 비어 있다. guard 이동은 거절하지 않는다 [근거: `apps/host/src/assembly/m4/ext-read-port.ts`의 `hookKnown`] | `hook` |
| 5001 | `request.cancelled` | false | `$/cancelRequest`로 취소했다 | - |
| 5002 | `host.shuttingDown` | true | 호스트가 종료 중이다 | `retryAfterMs` |
| 5003 | `store.busy` | true | 저장소 쓰기 잠금 대기가 시간을 넘었다. 같은 요청을 다시 보내도 된다 | - |
| 5004 | `store.diskFull` | false | 저장 매체가 가득 찼다. 공간을 비운 뒤 다시 보낸다 | - |
| 5005 | `store.readOnly` | false | 저장소가 읽기 전용으로 열려 있어 쓸 수 없다 | `reason` |
| 5006 | `store.io` | false | 저장 매체 입출력 실패. 코드는 OS나 SQLite가 준 값이다 | `code` |
| 5007 | `store.corrupt` | false | 저장된 행이 스키마와 다르다(손상, 수동 편집). 매체 오류(`store.io`)와 복구 안내가 달라서 나눈다. 복구 길은 `F.records.spec` §3.7 7항이다 | `where` |

#### 3.5.3 오류 코드 구간 [제안]

| 구간 | 소유 | 용도 |
|---|---|---|
| -32768 ~ -32000 | JSON-RPC 예약 | 표준 다섯 개만 쓴다 |
| 1000 ~ 1999 | F wire | 연결, 핸드셰이크, 버전 |
| 2000 ~ 2999 | F wire | 이벤트, 구독, 재전송 |
| 3000 ~ 3999 | 코어(L1) 메서드 | thread, turn, approval(3000~3099), settings(3100~3199), secret(3200~3299), 프로필·Test run(3300~3399), 확장 읽기(3400~3499), 나머지 L1 예비 |
| 4000 ~ 4999 | 기능(L2) | 기능 오류는 code 4000 하나로 싣는다. `kind`는 `cap.<CapabilityId>.<code>`, `details`는 `CapabilityErrorData`(`F.capabilities.spec` §3.6)다. 기능의 오류 코드는 문자열이라 숫자 블록을 배정하지 않는다. 4001~4999는 예비 |
| 5000 ~ 5999 | 호스트(L4) | 호스트 상태, 취소, 서비스 모드 |
| 10000 ~ 19999 | 확장(X 이후, 외부 확장) | 확장은 이 구간 안에서 자유롭게 쓰고 `kind`를 `ext.<확장id>.`로 시작한다. 코드가 겹치면 `kind`로 구분한다 |

- [결정: M3-REQ-21, M3-REQ-112, adr.0016] 오류 문장은 wire에 싣지 않는다. 오류는 `kind`와 인자로 가고 문장은 클라이언트가 `kind`를 메시지 키로 ko·en 카탈로그(`@fresnel/client`, JSON [제안])에서 만든다. 문장에 끼울 값은 `WireErrorData.args`(문자열·숫자·불리언·null, 시크릿 값 금지)다. `details`는 구조 정보로 그대로 둔다. `message`는 개발자용 영어 한 줄로 남고 화면에 쓰지 않는다. 설정 라벨과 설명은 `SettingUi.labelKey`·`helpKey`(`MessageKey`)로 싣고 `label`·`help`는 키가 없을 때의 대체 문구다. 내장 층(`ext.`가 아닌 이름공간)은 `defineSettings`가 키를 `settings.<설정 키>.label|help|unit`(이름공간의 `-`는 camelCase, 예 `x.loading-trust.…` → `settings.x.loadingTrust.…`)으로 채우고 정의가 직접 적은 키가 앞서며, `label`·`help`·`unit`은 영어 대체 문구다. 한국어는 클라이언트 카탈로그에만 둔다(`apps/host`의 시험이 키의 존재와 en 대체 문구 일치를 확인한다). 확장 설정(`ext.<이름>`)은 확장 패키지의 `locales`가 푼다(ADR-0021 §3.8). 저장소 안의 그룹(`group-helm`, `group-account-rotation`, `group-provider-anthropic-oauth`)은 정의가 `settings.ext.<camelCase 이름>.<키>.label|help|unit`을 직접 적고 클라이언트 카탈로그가 푼다. 예약 키 라벨은 `settings.ext.enabled.label`·`settings.ext.isolation.label`에 `labelArgs.name`(표시 이름)을 끼운다 [결정: 2026-11-04 T-I18N 기본값]. 모델용 도구 설명은 영어 원문을 유지한다. 시각은 UTC로 저장하고 날짜·숫자 표시는 클라이언트의 `Intl`이 한다.
- [제안] 클라이언트는 분기 판단에 `code`보다 `kind`를 쓴다. 확장 구간은 코드가 겹칠 수 있기 때문이다.
- [결정: m2-plan F.5] 구간 표는 코드 상수 `WIRE_CODE_RANGES`(`wire/errors.ts`)다. 순수 함수 `codeRangeOf(code)`는 코드가 속한 구간을 돌려주고, 어느 구간에도 속하지 않는 코드(0~999, 6000~9999, 20000 이상, 정수가 아닌 값)는 `null`이다. `wireErrorCodeMatchesKind(code, kind)`는 기능 구간의 `cap.`, 확장 구간의 `ext.` 접두를 `kind`가 지키는지 검사한다. 기능 오류 코드 4000은 `WIRE_CAPABILITY_ERROR_CODE`다. 등록된 `WIRE_ERRORS`의 모든 코드는 시험이 이 두 함수로 확인한다.
- 근거: MCP `JSON_RPC_ERROR_CODES`(`_research/packages.md` §4.1 F5 "오류 코드 구간"), 19 §3.3.4.

### 3.6 `_meta`와 추적 컨텍스트

```ts
// wire/jsonrpc.ts
export const TRACEPARENT_PATTERN = "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$";
export const WIRE_META_NAMESPACED_KEY_PATTERN = "^[a-z][a-z0-9-]*/[A-Za-z][A-Za-z0-9._-]*$";
export const WireMetaSchema = Type.Object({
  traceparent: Type.Optional(Type.String({ pattern: TRACEPARENT_PATTERN })),
  tracestate: Type.Optional(Type.String({ maxLength: 512 })),
  baggage: Type.Optional(Type.String({ maxLength: 8192 })),
}, { additionalProperties: false, patternProperties: { [WIRE_META_NAMESPACED_KEY_PATTERN]: Type.Unknown() } });
export type WireMeta = Static<typeof WireMetaSchema>;   // 정적 타입에는 세 W3C 키만 나타난다

export interface TraceContext { readonly traceId: string; readonly spanId: string; readonly flags: number }
export type TraceparentError =
  | { readonly kind: "malformed" }
  | { readonly kind: "unsupported_version"; readonly version: string }
  | { readonly kind: "zero_id" };
export declare function parseTraceparent(value: string): Result<TraceContext, TraceparentError>;
export declare function formatTraceparent(context: TraceContext): Result<string, TraceparentError>;
```

- [결정: m2-plan F.5] `_meta`는 params 안의 예약 키다. 모든 요청 메서드의 params 스키마는 `_meta?: WireMeta`를 받는다. 레지스트리가 `withMeta(schema)`(`wire/methods.ts`)로 각 메서드 스키마에 자동으로 더한다. 원래 필드와 `additionalProperties: false`는 그대로이고 `WireParams<M>`에 `_meta?`가 들어간다. `host.status`처럼 params가 비어 있던 메서드도 `_meta`만 받는 객체가 된다. 알림 params에는 더하지 않는다.
- [결정: m2-plan F.5] W3C Trace Context 세 키 말고는 `<네임스페이스>/<이름>` 형태만 허용한다(예: `fresnel/clientTime`). 스키마는 `patternProperties`로 이 키를 받고 값은 검사하지 않는다. 네임스페이스 없는 새 키는 이 문서에서만 더한다.
- [결정] 추적 API는 `@opentelemetry/api` 1.10.0을 그대로 쓴다(`_research/packages.md` §4.1 F5 "_meta 키와 추적 컨텍스트"). F는 `import type`만 하고, `traceparent` 직렬화·역직렬화 함수(순수)를 `wire/jsonrpc.ts`에 둔다. 현재 함수 둘(`parseTraceparent`, `formatTraceparent`)은 OpenTelemetry 타입을 쓰지 않아 F는 아직 `@opentelemetry/api`에 의존하지 않는다. 호스트(L4)가 `Tracer`와 이어 줄 때 그 패키지를 쓴다(`L0.os.spec`).

### 3.7 버전 정책과 기능 수명주기

```ts
// wire/version.ts
// SemVer, SemVerSchema는 F.capabilities.spec(capabilities/ids.ts)의 것을 그대로 쓴다.
export const WIRE_PROTOCOL_VERSION = "0.1.0";            // 코드에서는 명시 타입 주석
export const FeatureStatus = Type.Union([
  Type.Literal("experimental"), Type.Literal("active"),
  Type.Literal("deprecated"), Type.Literal("removed"),
]);
export const FeatureName = Type.String({ minLength: 1, maxLength: 96 });   // 메서드 이름 또는 "<영역>.<기능>"
export const FeatureInfo = Obj({
  name: FeatureName,
  status: FeatureStatus,
  since: SemVer,
  deprecatedIn: Type.Optional(SemVer),
  removeAfter: Type.Optional(Type.String({ format: "date" })),
  replacedBy: Type.Optional(FeatureName),
});

/** 순수 함수. 주 버전이 같으면 호환이다. 0.x 동안은 부 버전까지 같아야 한다. */
export declare function isCompatible(client: SemVer, server: SemVer): boolean;
```

| 규칙 | 내용 | 표지 |
|---|---|---|
| 버전 대상 | Runtime API(wire)와 설정 정의 형식(settings)이 하나의 계약 버전 `WIRE_PROTOCOL_VERSION`을 공유한다 | [제안] |
| semver | 메서드·알림·필드 제거, 의미 변경, 필수 필드 추가는 주 버전. 메서드·선택 필드·오류 kind 추가는 부 버전. 문서·스키마 설명 수정은 수 버전 | [제안] |
| 0.x 기간 | 1.0 전에는 부 버전 변경도 호환을 깰 수 있다. `isCompatible`은 부 버전까지 비교한다 | [제안] |
| 상태 | `experimental` → `active` → `deprecated` → `removed`. `experimental`은 `active`를 거치지 않고 바로 제거할 수 있다 | [제안] |
| 폐기 기간 | `deprecated`가 된 날부터 12개월 뒤 또는 다음 주 버전 중 늦은 쪽에 `removed`가 될 수 있다. MCP 12개월 폐기 창을 참고했다(`_research/item-catalog.md` F절) | [미결] |
| 실험 opt-in | `experimental` 기능은 `host.hello`의 `experimental` 목록에 이름을 넣은 연결에만 열린다. opt-in 없이 부르면 `-32601` | [제안] |
| 기능 탐지 | 클라이언트는 `host.hello` 결과의 `features`로 기능 유무와 상태를 확인한다. 별도 프로브 메서드는 두지 않는다 | [제안] |
| 모르는 것 무시 | 클라이언트는 모르는 알림, 아는 알림의 모르는 필드, 모르는 오류 kind를 무시하거나 일반 오류로 처리한다(19 §3.12) | [제안] |
| 설정 키 수명 | `SettingDef.since`, `SettingDef.deprecated`가 같은 상태 규칙을 따른다. 폐기된 키를 쓰면 값은 적용하고 경고를 남긴다 | [제안] |

### 3.8 설정 2부: SettingDef

#### 3.8.1 키와 범위

```ts
// settings/def.ts
export const SETTING_KEY_PATTERN =
  "^((f|x|l[0-4])\\.[a-z][a-z0-9-]*|ext\\.[a-z][a-z0-9-]*)(\\.[a-z][A-Za-z0-9]*)+$";
export const SettingKey = Type.String({ minLength: 3, maxLength: 128, pattern: SETTING_KEY_PATTERN });

export const SettingScope = Type.Union([
  Type.Literal("managed"), Type.Literal("user"), Type.Literal("project"),
  Type.Literal("local"), Type.Literal("launch"),
]);
export const RuntimeChange = Type.Union([Type.Literal("live"), Type.Literal("nextTurn"), Type.Literal("restart")]);
export const SettingLayer = Type.Union([
  Type.Literal("F"), Type.Literal("X"), Type.Literal("L0"), Type.Literal("L1"),
  Type.Literal("L2"), Type.Literal("L3"), Type.Literal("L4"),
]);
export { SecretRef } from "../../capabilities/secrets.ts";   // 형식 정본은 F.capabilities.spec §3.10
```

- 키 문법 [제안]
  - 코어 키: `<층>.<도메인>.<이름>`. 층은 소문자(`f`, `x`, `l0`~`l4`), 도메인은 `_routing/routes.yaml` layout의 도메인 이름이다. 예: `l1.loop.maxSteps`, `l3.helm.driveLimits`. 확장과 L3 그룹의 켜기 키는 코어 키로 두지 않고 `ext.<name>.enabled` 하나만 쓴다(§3.8.3).
  - 확장 키: `ext.<확장id>.<이름>`. 예: `ext.web-exa.apiKey`.
  - [제안] 확장 접두는 `ext.`다. `F.records.spec`의 이벤트 kind는 확장에 `x.`, 플러그인 그룹에 `grp.`를 쓰지만, 설정 키에서 `x.`는 X 층 코어 키(`x.loading-trust.…`)와 겹친다. 그래서 설정 키와 wire 확장 메서드는 확장과 외부 플러그인 그룹 모두 `ext.<id>.`를 쓴다. 대응은 `x.<id>.…`(kind) ↔ `ext.<id>.…`(설정·메서드)다.
  - 이름 부분은 소문자 낙타 표기이고 점으로 더 나눌 수 있다. 예: `l1.models.routing.review`.
- 키 접두와 `layer` 필드는 일치해야 한다(`l1.` ↔ `"L1"`). 확장 키의 `layer`는 그 확장 매니페스트가 선언한 층이다.
- `SettingLayer`에 L4를 포함한다. [제안] 테마, 키 바인딩 같은 표시 설정(`_research/settings.md` §2.13 "층 밖 항목")의 소유자가 L4이기 때문이다. 브리프의 "F..L3"보다 범위를 넓혔다.
- [결정] 시크릿 참조 형식은 `secret://<name>`이다(`_research/secrets.md` §6.1, `_research/decisions-log.md` 2026-10-21 2차 "에이전트는 값을 모른 채 참조로 사용").

#### 3.8.2 SettingDef

```ts
// settings/def.ts
export const SettingsTab = Type.Union([
  Type.Literal("overview"), Type.Literal("models"), Type.Literal("budgets"), Type.Literal("providers"),
  Type.Literal("secrets"), Type.Literal("permissions"), Type.Literal("sessions"), Type.Literal("tools"),
  Type.Literal("plugins"), Type.Literal("execution"), Type.Literal("sandbox"), Type.Literal("appearance"), Type.Literal("advanced"),
]);
export const SettingWidget = Type.Union([
  Type.Literal("toggle"), Type.Literal("select"), Type.Literal("number"), Type.Literal("text"),
  Type.Literal("list"), Type.Literal("table"), Type.Literal("secret"), Type.Literal("readonly"),
]);
/** 전용 편집기 힌트 [결정: M3-REQ-15]. 모르는 값은 일반 위젯으로 그린다 */
export const SettingEditor = Type.Union([
  Type.Literal("modelRoles"), Type.Literal("fallbackChain"), Type.Literal("permissionRules"),
  Type.Literal("sandboxLists"), Type.Literal("searchOrder"), Type.Literal("accountPool"),
]);
/** 점으로 이은 낙타 표기 식별자: ^[a-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$, 최대 128자 */
export const MessageKey = Type.String({ minLength: 1, maxLength: 128, pattern: MESSAGE_KEY_PATTERN });
export const SettingUi = Obj({
  tab: SettingsTab,
  widget: SettingWidget,
  editor: Type.Optional(SettingEditor),
  order: Type.Integer({ minimum: 0, maximum: 9999 }),
  label: Type.String({ minLength: 1, maxLength: 80 }),     // 대체 문구. labelKey가 있으면 카탈로그 문장이 앞선다
  labelKey: Type.Optional(MessageKey),                     // 메시지 키 [결정: M3-REQ-21, adr.0016]
  labelArgs: Type.Optional(Type.Record(Type.String(), Type.String({ maxLength: 80 }))), // 라벨 문장에 끼울 값. 예약 키 `ext.<이름>.enabled|isolation`이 확장 이름을 싣는다
  help: Type.Optional(Type.String({ maxLength: 500 })),
  helpKey: Type.Optional(MessageKey),
  unit: Type.Optional(Type.String({ maxLength: 16 })),     // 대체 문구(영어)
  unitKey: Type.Optional(MessageKey),                      // 단위의 메시지 키
});
export const SettingRange = Obj({
  min: Type.Optional(Type.Number()),
  max: Type.Optional(Type.Number()),
  enum: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Number()]), { minItems: 1, maxItems: 64 })),
});
export const SettingDeprecation = Obj({
  since: SemVer,
  replacedBy: Type.Optional(SettingKey),
  note: Type.Optional(Type.String({ maxLength: 200 })),
});

/** 코드에서 쓰는 형태. type은 TypeBox 스키마이고 default는 그 정적 타입이다. */
export interface SettingDef<S extends TSchema = TSchema> {
  readonly key: SettingKey;
  readonly type: S;
  readonly default?: Static<S>;            // secret이면 두지 않는다
  readonly range?: SettingRange;
  readonly runtimeChange: RuntimeChange;
  readonly layer: SettingLayer;
  readonly allowedScopes: readonly [SettingScope, ...SettingScope[]];
  readonly ui?: SettingUi;                 // 없으면 화면에 두지 않는다(파일·명령만, advanced 탭의 파일 편집기에서만 보인다)
  readonly secret?: boolean;               // 기본 false
  readonly since: SemVer;
  readonly deprecated?: SettingDeprecation;
  readonly stage?: SettingStage;           // 생략하면 "active". 읽는 코드가 없는 키는 "reserved" [결정: m2c G5-04]
}

/** 구현 단계. active는 값을 읽어 동작을 바꾼다. reserved는 이름과 모양만 선언했다 */
export const SettingStage = Type.Union([Type.Literal("active"), Type.Literal("reserved")]);

/** 전송·검사용 형태(settings.list 결과, 확장 매니페스트 userConfig 변환 결과). type은 JSON Schema 객체다. */
export const SettingDefWire = Obj({
  key: SettingKey,
  type: Type.Record(Type.String(), Type.Unknown()),
  default: Type.Optional(Type.Unknown()),
  range: Type.Optional(SettingRange),
  runtimeChange: RuntimeChange,
  layer: SettingLayer,
  allowedScopes: Type.Array(SettingScope, { minItems: 1, maxItems: 5, uniqueItems: true }),
  ui: Type.Optional(SettingUi),
  secret: Type.Optional(Type.Boolean()),
  since: SemVer,
  deprecated: Type.Optional(SettingDeprecation),
  stage: Type.Optional(SettingStage),
});
```

- [결정: m2c G5-04] `SettingDef.stage`는 값을 읽는 코드가 있는지를 알린다. 선언만 하고 읽지 않는 키(2차·M3 기능의 키)가 `fresnel config set`과 설정 화면에서 일반 키처럼 보이고 값을 바꿔도 아무 일도 일어나지 않는 문제를 막는다. 규칙은 넷이다.
  1. `reserved` 키는 `settings.list`에서 기본으로 빠진다. `includeReserved: true`를 주면 들어간다. `settings.get`은 지정한 키를 그대로 돌려준다.
  2. `reserved` 키는 `ui`를 가져도 화면에 그리지 않는다. 클라이언트는 `settings.list` 결과에 `stage: "reserved"`가 보이면 건너뛴다.
  3. `reserved` 키에 쓰는 `settings.set`, `fresnel config set`(`checkSettingWrite`)은 `settings.reserved`(3106)로 거부한다. 키·구현 단계·범위·잠금·값 순으로 검사해서 범위나 값이 틀려도 이 오류가 먼저다. `settings.reset`은 값을 지우는 일이라 막지 않는다.
  4. 파일에 이미 적힌 `reserved` 키 값은 읽히지만 쓰는 코드가 없다. 키를 `active`로 올리는 일은 읽는 코드를 넣는 커밋이 한다. `stage`는 `checkSettingDef` 규칙(D1~D9)을 바꾸지 않는다.
  - 소유 층이 어느 키를 `reserved`로 표시할지는 각 층의 몫이다(`review.m2-plan` G5-04). 이 변경은 필드와 거부 규칙만 정한다. 표시 대상 후보는 `l4.cli.theme`·`statusLine`·`keybindingsFile`, `l0.process.service.*`, `l0.process.lockFallback.default`, `l0.os.telemetry.*`, `l2.web.browse.*`·`research.*`다.

`SettingDef` 검사 규칙(`checkSettingDef`, 순수 함수). 하나라도 어기면 정의를 거부한다.

| # | 규칙 | 근거 |
|---|---|---|
| D1 | `key`가 `SETTING_KEY_PATTERN`에 맞고 접두가 `layer`와 맞는다 | §3.8.1 |
| D2 | `secret: true`이면 `default`가 없어야 한다 | 시크릿 값이 코드·스키마 출력에 남지 않게 한다 |
| D3 | `secret: true`이면 `type`은 `SecretRef`와 같은 문자열 스키마이고 `ui.widget`은 `"secret"`이다 | 값 대신 참조만 저장한다 |
| D4 | `default`가 있으면 `type`과 `range`를 통과한다 | 기본값이 스스로 무효가 되지 않게 한다 |
| D5 | `range.min ≤ range.max`. `range.min`·`max`는 `type`이 number·integer일 때만, `range.enum`은 string·number일 때만 쓴다 | |
| D6 | `type`에 `minimum`·`maximum`·`enum`을 직접 두면서 `range`도 두면 거부한다 | 같은 제약을 두 곳에 적지 않는다. [제안] UI가 읽을 수 있게 제약은 `range`에 둔다 |
| D7 | `allowedScopes`에 중복이 없다. `runtimeChange: "restart"`이면 `launch`를 넣을 수 없다 | 재시작이 필요한 값은 이번 실행 한정으로 바꿀 수 없다 |
| D8 | `ui.widget`이 `type`과 맞는다(`toggle`↔boolean, `number`↔number·integer, `select`↔`range.enum`) | |
| D9 | `deprecated.replacedBy`가 있으면 그 키는 같은 카탈로그에 있다(카탈로그 조립 때 검사) | |

#### 3.8.3 defineSettings와 카탈로그

```ts
// settings/define.ts
export type SettingNamespace = `${"f" | "x" | "l0" | "l1" | "l2" | "l3" | "l4"}.${string}` | `ext.${string}`;

/** 이름 부분만 적는 입력 형태. key는 namespace와 이름으로 만들고 layer는 namespace에서 정한다. */
export type SettingDefInput<S extends TSchema = TSchema> = Omit<SettingDef<S>, "key" | "layer">;

export interface SettingGroup<N extends SettingNamespace, D extends Readonly<Record<string, SettingDefInput>>> {
  readonly namespace: N;
  readonly defs: { readonly [K in keyof D & string]: SettingDef<D[K]["type"]> & { readonly key: `${N}.${K}` } };
}

/** 선언만 한다. 등록(카탈로그에 넣기)은 X·L1의 로딩 경로가 buildCatalog로 한다. 규칙 위반이면 SettingDefError를 던진다. */
export declare function defineSettings<const N extends SettingNamespace, const D extends Readonly<Record<string, SettingDefInput>>>(
  namespace: N,
  defs: D,
): SettingGroup<N, D>;

export type SettingCatalog = ReadonlyMap<SettingKey, SettingDef>;
export type CatalogIssue =
  | { readonly code: "duplicateKey"; readonly key: SettingKey; readonly owners: readonly string[] }
  | { readonly code: "invalidDef"; readonly key: string; readonly rule: `D${number}`; readonly message: string }
  | { readonly code: "foreignNamespace"; readonly key: SettingKey; readonly owner: string };

/** 순수 함수. 여러 그룹을 합친다. 키 중복, 네임스페이스 침범을 모아 돌려준다. */
export declare function buildCatalog(
  groups: readonly { readonly owner: string; readonly namespace: SettingNamespace; readonly defs: readonly SettingDef[] }[],
): { readonly ok: true; readonly catalog: SettingCatalog } | { readonly ok: false; readonly issues: readonly CatalogIssue[] };

/** 순수 함수. 확장 매니페스트의 userConfig 항목을 SettingDef로 바꾼다. 키는 ext.<name>.<userConfig 키>가 된다.
 *  항목에 값 스키마(type)가 없으면 CatalogIssue(invalidDef)로 돌려준다. */
export declare function settingsFromManifest(manifest: ExtensionManifest):
  { readonly defs: readonly SettingDef[]; readonly issues: readonly CatalogIssue[] };
```

사용 예:

```ts
// xeon/packages/core-loop/src/settings.ts (L1.loop.spec이 소유하는 키의 예. 실제 키는 L1.loop.spec이 정한다)
export const loopSettings: SettingGroup<"l1.loop", { maxSteps: SettingDefInput<TInteger> }> = defineSettings("l1.loop", {
  maxSteps: {
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 10_000 },
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "local", "launch"],
    ui: { tab: "budgets", widget: "number", order: 10, label: "턴당 최대 단계", help: "0이면 상한 없음", unit: "단계" },
    since: "0.1.0",
  },
});
```

확장이 키를 더하는 규칙 [제안]:

1. 확장은 `ExtensionManifest.userConfig`(`F.extensions.spec` §3.1)에 설정을 선언한다. 로더(X)가 `settingsFromManifest`로 `SettingDef`를 만들고 `buildCatalog`에 넣는다. 확장 코드가 `defineSettings`를 직접 불러도 되지만 네임스페이스는 `ext.<자기 이름>`만 쓸 수 있다.
   - 대응 [제안]: userConfig 키 `apiKey` → 설정 키 `ext.<name>.apiKey`, `title` → `ui.label`, `description` → `ui.help`, `sensitive: true` → `secret: true`(값은 `secret://` 참조), `required` → 값이 없으면 확장 시작 때 진단. `ui.tab`은 `"plugins"`로 고정한다. `layer`는 매니페스트 `layer`(`"plugin"`이면 `"L2"`로 본다 [가정]).
   - 현재 `UserConfigEntrySchema`에는 값 스키마가 없고 `setting` 필드(형식 `ext.<name>.<key>`)가 설정 키를 가리킨다. JSON 매니페스트만 있는 외부 확장도 값 검사를 받으려면 항목에 `type`(JSON Schema), `default`, `range`, `runtimeChange`, `allowedScopes`가 있어야 한다. [제안] `F.extensions.spec`에 이 필드 추가를 요청하고, `setting` 필드는 위 대응 규칙으로 유도되므로 생략하거나 `ext.<name>.<key>`와 같아야 하는 검사용 값으로 둔다. 키 접두는 `ext.`로 맞췄다(`F.extensions.spec` §3.1 `UserConfigEntry.setting`, §6). 값 스키마 필드 추가 여부는 §10 미결 8로 남긴다.
   - 확장 공통 키 [제안]: `ext.<name>.enabled`, `ext.<name>.isolation`(`F.extensions.spec` §6)은 예약하고 X 로더가 정의한다(소유 문서 `X.loading-trust.spec`). 켜기 키는 플러그인과 플러그인 그룹(내장 Helm·학습 포함) 모두 `ext.<name>.enabled` 하나이고, 범위와 적용 시점은 X 정의(`managed`~`session`, `live`)를 따른다 [결정: review.decisions-2 K-04]. userConfig는 이 이름을 쓸 수 없다. drive lock 상한은 X 층 키 `x.primitives.driveLimits`다. 주도하는 Registration을 고르는 키는 `x.primitives.activeDriver`(이전 이름 `activeDriveGroup`, 옛 키는 읽지 않는다), drive 정책 키는 `x.primitives.driveRequiresGroup`(boolean, 기본 `true`, 범위 `user`·`managed`)이다(소유 문서 `X.primitives.spec`, `F.extensions.spec` §6) [결정: 2026-11-01 사용자, 정책 키 이름과 범위는 제안]. 예전 제안 키 `extensions.<name>.*`, `groups.drive.limits`는 키 문법(§3.8.1)에 맞지 않아 쓰지 않는다.
2. 확장은 코어 네임스페이스(`f.`~`l4.`)와 다른 확장의 `ext.<id>.`에 키를 더할 수 없다. 어기면 `foreignNamespace`로 그 확장의 설정 전체를 거부한다. 확장 로딩 자체를 막을지는 `X.loading-trust.spec`이 정한다.
3. L3 기본 그룹(Helm, 학습 그룹)은 내장 패키지이므로 자기 설정에 코어 네임스페이스 `l3.helm.`, `l3.learning.`을 쓴다. 켜기 키만은 예외로 `ext.helm.enabled`, `ext.learning.enabled`를 쓴다(1번의 확장 공통 키). 외부 플러그인 그룹은 확장이므로 `ext.<id>.`를 쓴다.
4. 확장이 제거되면 그 키는 카탈로그에서 빠진다. 파일에 남은 값은 "모르는 키"로 보존하고 적용하지 않는다(§4.8).

### 3.9 설정 계층과 유효 값

```ts
// settings/layers.ts
/** 높은 우선순위가 앞이다. */
export const SCOPE_PRECEDENCE = ["managed", "launch", "local", "project", "user"] as const;   // 코드에서는 명시 주석

export interface ScopeLayer {
  readonly scope: SettingScope;
  readonly values: ReadonlyMap<SettingKey, unknown>;
  readonly path?: string;                      // 파일 범위면 그 파일 경로. session이면 없음
}
export type ScopeStack = readonly ScopeLayer[];

// settings/effective.ts
export const SettingSource = Obj({
  scope: Type.Union([SettingScope, Type.Literal("default")]),
  path: Type.Optional(Type.String({ maxLength: 4096 })),
});
export const EffectiveSetting = Obj({
  key: SettingKey,
  value: Type.Unknown(),                       // secret이면 SecretRef 문자열 또는 null. 해석한 값은 절대 없다
  source: SettingSource,                       // 이 값을 정한 범위
  locked: Type.Boolean(),                      // managed가 값을 정했으면 true
  lockReason: Type.Optional(Type.Union([Type.Literal("managed_file"), Type.Literal("managed_policy")])),   // 호스트가 채운다. 생략하면 managed_file
  problem: Type.Optional(Obj({ kind: Type.String(), args: Type.Optional(Type.Record(Type.String(), Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]))) })),   // 호스트만 아는 사실로 값을 쓸 수 없을 때
  shadowed: Type.Array(SettingSource),         // 같은 키를 정했지만 가려진 범위들, 우선순위 순
  runtimeChange: RuntimeChange,
  pendingUntil: Type.Union([Type.Literal("nextTurn"), Type.Literal("restart"), Type.Null()]),
  deprecated: Type.Boolean(),
});

/** 순수 함수. 한 키의 유효 값을 계산한다. 값 검사를 통과하지 못한 층의 값은 건너뛰고 issues에 남긴다. */
export declare function resolveSetting(def: SettingDef, layers: ScopeStack): {
  readonly setting: EffectiveSetting;
  readonly issues: readonly { readonly scope: SettingScope; readonly message: string }[];
};

/** 순수 함수. 쓰기 전에 범위·잠금·값을 검사한다. settings.set과 CLI config set이 같은 함수를 쓴다. */
export type WriteCheck =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly kind: "settings.unknownKey" | "settings.invalidValue" | "settings.scopeNotAllowed" | "settings.locked" | "settings.secretValue"; readonly details: Readonly<Record<string, unknown>> };
export declare function checkSettingWrite(
  catalog: SettingCatalog, layers: ScopeStack, key: string, scope: SettingScope, value: unknown,
): WriteCheck;

/** 순수 함수. 값 하나를 def의 type과 range로 검사한다. JSON Schema 출력과 같은 검사다. */
export declare function validateSettingValue(def: SettingDef, value: unknown):
  { readonly ok: true } | { readonly ok: false; readonly issues: readonly { readonly path: string; readonly message: string }[] };
```

## 4. 동작 규칙

### 4.1 연결 수명

1. 연결이 열리면 클라이언트의 첫 요청은 `host.hello`다. 다른 요청은 `host.helloRequired`(1001)로 거부한다. `$/cancelRequest`는 무시한다.
2. `host.hello`에서 `isCompatible(client, server)`가 거짓이면 `protocol.unsupported`(1003)를 돌려주고 연결은 유지한다. 클라이언트가 닫는다.
3. hello 응답 뒤로 서버는 메서드를 받는다. 한 연결 안에서 서버가 보내는 응답과 알림은 보낸 순서대로 도착한다(전송이 순서를 보장한다).
4. 연결이 닫히면 그 연결의 구독과 진행 중 요청의 `signal`이 중단된다. 진행 중 turn은 중단하지 않는다. turn 중단은 `turn.interrupt`나 소유 프로세스 종료만 한다.
5. [결정: m2 F.8] 서버는 `$/connectionReset`을 hello 이후에 받으면 그 연결을 `host.hello` 이전 상태로 돌린다. stdio 연결은 엔진 프로세스 하나에 하나뿐이라, 클라이언트 화면(WebView 새로고침)이 다시 시작해도 연결은 그대로이고 클라이언트 쪽 상태(요청 id, 구독, hello 상태)만 사라지기 때문이다. 새 화면은 첫 메시지로 `$/connectionReset`을 보낸 뒤 `host.hello`를 다시 보낸다. 엔진이 막 시작해 hello 전이면 서버가 무시하므로 화면은 항상 먼저 보내도 된다.
6. 재설정을 받은 서버가 하는 일은 넷이다. (a) 진행 중 요청의 `signal`을 중단하고 그 요청에는 응답을 내지 않는다. 이전 화면이 보낸 id가 새 화면의 id(`r1`, `r2`)와 겹치므로 `request.cancelled`(5001)도 보내지 않는다. (b) 이 연결의 구독을 지운다. 이전 구독의 `events.batch`는 더 보내지 않고 `SubId`는 다시 쓰지 않는다. (c) 이 연결이 연 thread 표시(`stream.chunk` 수신 대상, 관찰)를 지운다. (d) 연결 상태를 `awaitingHello`로 돌리고 실험 기능 opt-in을 지운다. 서버가 이미 송신 큐에 넣은 이전 화면의 메시지는 지우지 못할 수 있다. 클라이언트는 자기가 보낸 요청과 짝이 맞지 않는 응답과 모르는 `sub`의 알림을 무시한다(`createHostConnection`이 이미 그렇게 한다).
7. 재설정은 진행 중인 turn을 중단하지 않고 thread 쓰기 소유(잠금)도 풀지 않는다. 새 화면은 `thread.list`, `thread.open`, `thread.read`, `approval.list`, `events.subscribe`를 다시 불러 상태를 되살린다(`L4.desktop.spec` §4.6).

### 4.2 메서드 이름과 확장 메서드

- 코어 메서드는 이 문서의 표에 있는 것만 있다. 새 메서드는 이 문서를 고쳐서 더한다.
- [결정: 2026-10-31 사용자, M4 T-F] 확장이 더하는 wire 메서드의 이름은 `ext.<확장이름>.<동사>`로 확정한다(`extMethodName`). 동사는 `EXT_VERB_PATTERN`, params·result는 매니페스트 확장 수준 `methods`의 `ExtMethodDecl`(JSON Schema)이 선언하고 `validateManifest`가 검사한다(F.extensions.spec §3.1.1). 오류 코드는 확장 구간 10000~19999와 `ext.<확장이름>.` kind다(§3.5.3).
- 세 마디 이름 중 `ext.ui.*`, `ext.test.*`는 코어 메서드다(옛 `ext.view.*`는 없다). 그래서 `ui`, `test`는 확장 이름으로 쓸 수 없다(`RESERVED_EXTENSION_NAMES`, `CORE_EXT_NAMESPACES`, `classifyMethodName`). 이름 `ui`, `ext.ui.*`, 설정 `x.ui.apps`, `x.ui.allowProjectApps`는 ADR-0022 §3.6이 정하지 않은 [제안]이다. 설정 키의 정의와 소유 문서는 X 트랙이 정한다. [근거: `xeon/packages/ext-host/src/loading-trust/ui-settings.ts`, 결정 2026-11-04 이름 x.ui.*]
- [결정: 2026-11-02 M4 T-GK, 기본값] 확장 메서드 디스패치(X-2). 닫힌 표(`WIRE_METHODS`)에 없는 이름이 `classifyMethodName`으로 `extension`(`ext.<확장>.<동사>`)이면 서버가 X의 `ExtHost.methods.call`로 넘긴다. 코어 세 마디 이름(`ext.ui.*`, `ext.test.*`)은 이 길로 가지 않는다. (1) 요청 params는 매니페스트 `ExtMethodDecl.params`가 정한 객체다. 대화가 필요하면 예약 키 `threadId`(대화 id)를 params 최상위에 실을 수 있고, 서버는 이 키를 떼어 처리기의 `ctx.threadId`로 넘기며 `decl.params` 검사에는 넣지 않는다. 모양이 틀리면 `jsonrpc.invalidParams`(`/threadId`)다. 그 대화가 호스트에 열려 있고 그 확장이 그 대화에서 켜져 있어야 처리기에 닿는다. (2) 결과는 `decl.result` 검사를 통과한 값이고 JSON-RPC `result`는 객체여야 한다(객체가 아니면 아래 `failed`의 `result_not_object`). (3) 실패 대응: 없는 확장·동사는 `jsonrpc.methodNotFound`(-32601), `decl.params` 위반은 `jsonrpc.invalidParams`(-32602, `issues`는 X 검사기의 JSON Pointer 문제 20개까지), 호출자의 취소는 `request.cancelled`(5001), 확장이 꺼짐은 코드 10002 `ext.<확장>.off`(`details: { verb }`), 처리기가 던짐·결과가 선언과 다름·시간 예산 초과는 코드 10001 `ext.<확장>.failed`(`details: { verb, outcome: "threw" \| "result_invalid" \| "timeout" \| "result_not_object", budgetMs? }`). 둘 다 `retryable: false`이고 구간 10000~19999와 `ext.<확장>.` kind 규칙(§3.5.3)을 따른다. 처리기 오류 메시지는 256자까지, 스택은 싣지 않는다. (4) `host.hello`의 `features`에는 확장 메서드를 싣지 않는다(확장 목록은 `ext.list`와 `ext.ui.list`가 준다). 시험: `apps/host/test/handlers/ext-method.test.ts`, `test/int/ext-method.int.test.ts`.
- [결정: 2026-11-03 M4 T-UIPOST, 제안 기본값] `ext.ui.post`와 `ext.ui.requestApproval`의 params에 `threadId`를 필수로 더한다(W-33, `L4.host-service.spec` §10 52). "활성 대화"로 추정하지 않는다. 화면이 대화 전환보다 오래 남을 수 있어서다. `requestId`(1~64자)는 선택이고 멱등 키다. 같은 `(확장, requestId)`의 두 번째 호출은 새 입력이나 새 승인을 만들지 않는다. 생략하면 호출마다 새 키를 쓴다. 호출한 대화가 열려 있지 않으면 `thread.notFound`, 확장이 없으면 `extension.notFound`, 그 대화에서 확장이 꺼졌으면 `ext.<확장>.off`다. 매니페스트가 허용하지 않는 호출(선언하지 않은 `ui`·`method`, `usesPost` 플러그인이 없는 `post`)은 `jsonrpc.invalidParams`의 `issues`로 알린다.
- [결정: 2026-11-03 M4 T-ORDER, 사용자 결정 m4-decisions 15-2] 훅별 핸들러 순서(W-51, `hooks.order.*`)의 스키마는 `wire/ext-read.ts`다. 순서는 설정 `x.operations.hookOrder`(범위 managed, user)에 저장되고 `hooks.order.set`은 사용자 범위에 쓴다. 적용은 다음 단계 경계다(`pending`). [결정: 2026-11-03 사용자] guard tier 핸들러도 옮길 수 있다(고정 없음, `X.operations.spec` §4.1.5). 저장을 막는 사유는 없다. 옮긴 guard가 건너뛰어질 수 있는 위험은 `hooks.order.preview`의 `guardRisk`로 미리 알리고, 화면은 강한 경고를 띄운다. 설정 범위는 `managed`, `user`이고 `project`는 받지 않는다.
- [결정: 2026-10-31 사용자, M4 T-F] 확장 읽기(W-15, W-20~W-26, W-31, W-33, W-35~W-42, W-47)의 스키마는 `wire/ext-read.ts`다. 행의 단위는 확장이고 Registration(플러그인 하나)은 `plugins`와 `registrationId`로 나온다(ADR-0022 §3.2). `ext.list`의 `enabledSource`는 켜짐 요청이 온 층(`managed`, `thread`, `project`, `user`, `default`)이다(T-REG §7 5번). `group.driveLock`(옛 `group.lease`, 저장 이름 `lease.*`는 그대로)은 drive lock을 가진 Registration과 후보·대기 수, 설정 `x.primitives.activeDriver` 값, 최근 `lease.rejected`를 돌려준다. `host.status`는 `safeModeCause`(`user`, `startupFailures`, `flag`)를 더한다(W-35, W-39).
- [결정: 2026-10-31 사용자, M4 T-F] 대화 영역 변경(W-01, W-16, W-37): `approval.list`의 `threadId`는 선택이고 생략하면 모든 대화의 대기 승인이다. `thread.read`는 `around: ItemId`(가운데 창, `before`와 함께 쓰지 않음)를 받고, `ThreadSummary.origin`(`user`, `schedule`+`scheduleId`, `remote`)은 선택 필드다. W-37(런타임 이벤트만 거르는 구독)은 이미 있는 `events.subscribe`의 `filter.kindPrefixes`와 `threadIds` 생략으로 닫는다. 새 인자가 없다. 새 메서드(`review.get`, `goal.status`, `work.tasks.list`, `schedule.update`, `schedule.runs`, `host.clients`, `turn.withdraw`, `knowledge.skills.view`, `work.plans.versions`, `knowledge.memory.read`·`add`·`replace`·`remove`)의 스키마는 `wire/dialog-area.ts`다.
- [결정: 2026-10-31 사용자, M4 T-F] 프로필·Test run·계측(W-34, W-43~W-46, W-48, W-50): 프로필 `{ id, title, enable, disable, settings: {key, value}[], driver, updatedAt, rev }`는 런타임 호스트의 `profiles.json`(`ProfilesFile`)에 저장하고 `profile.put`은 `baseRev` 비교로 충돌을 막는다. `enable`·`disable`은 확장 이름이고 Registration id가 아니다 [제안: 플러그인 단위 켜기는 아직 프로필이 다루지 않는다]. `driver`(옛 `driveGroup`)는 설정 `x.primitives.activeDriver`에 쓴다. `thread.create`는 `testRun`, `profileId`를 받고 `ThreadSummary.testRun`은 `{ profileId, target, paused }`다(선택). Test run 대화만 `testRun.pause|resume|step`이 있고 drive lock을 쥔 채 멈춘다. 스키마는 `wire/profile-test-run.ts`이고 계측·Test run 결과 타입은 `extensions/trace-types.ts`다.
  - `profile.apply`·`profile.preview`의 `layer`(`user`, `project`, `thread`)는 [제안, T-REG §7 4번 사용자 확인 대기]이다. 생략하면 호스트는 `user`로 읽고, 결과가 쓴 층을 돌려준다. `thread` 층이면 `threadId`가 필요하다. `SETTING_WRITERS`에는 `thread`를 더하지 않는다. 대화 층에 쓴 설정 값은 `session` 범위의 값이므로 `writer: "profile"`, `winningScope: "session"`으로 나온다 [제안: 미결 4번의 기본 선택].
  - 처리기 동작(T-WB, `apps/host`): `profile.put`은 `baseRev`가 저장된 `rev`(없으면 null)와 다르면 `profile.conflict`(3302, `details: { id, rev, baseRev }`)이고 성공하면 `rev`를 올린다. `profile.apply`는 쓰기 전에 모든 키를 `checkSettingWrite`로 검사해(카탈로그에 없으면 `settings.unknownKey`) 하나라도 거절되면 아무것도 쓰지 않고, 쓰는 중 실패하면 이미 쓴 키를 거꾸로 이전 값(없던 키는 지움)으로 되돌린 뒤 그 실패를 돌려준다. 되돌리기도 실패하면 `profile.applyPartial`(3305, `details: { written, failed }`)이다. `layer`가 `user`이면 `enable`·`disable`은 `ext.<이름>.enabled`(카탈로그에 선언된 확장만, 아니면 `settings.unknownKey`)와 `settings`, `driver`(`x.primitives.activeDriver`, null이면 쓰지 않음)를 그 범위에 쓴다. `project`와 `thread`는 `threadId`가 필요하고(`project`는 작업 폴더를 알아야 한다), `thread` 층은 `settings`·`driver`를 `launch` 범위의 thread 값으로 쓰고 `enable`·`disable`은 설정이 아니라 확장의 대화별 켜짐 요청으로 보내며 `appliesAt`은 `nextStepBoundary`다. 신뢰하지 않은 작업 폴더의 `project` 층은 `profile.trustRequired`(3304)다. `thread.create { testRun: true, profileId }`는 대화를 만들고 쓰기 소유를 얻은 뒤 `thread` 층에 적용하며, 적용이 실패하면 그 대화를 지우고 실패를 돌려준다. `profileId`가 있는데 `testRun`이 참이 아니면 `-32602`다. 오류 kind 아홉(`profile.notFound`·`conflict`·`fileCorrupt`·`trustRequired`·`applyPartial`·`limit`, `testRun.unavailable`·`notATestRun`·`notPaused`)은 §3.5.2 표와 `WIRE_ERRORS`에 있다(코드 3301~3306, 3311~3313, 코어 구간의 3300~3399). 처리기는 비공개 표를 두지 않고 `wireError(kind)`로 낸다. 모든 `profile.*` 실패(`ProfileStoreFailure`, `ProfileApplyFailure`)는 이 kind나 기존 kind(`store.io`, `settings.*`, `thread.*`, `jsonrpc.invalidParams`, `internal`)로 옮겨지며 옮김 표는 시험(`apps/host/test/handlers/profile-wire-errors.test.ts`)이 값으로 비교한다. 클라이언트는 옛 문자열 형태에 기대지 말고 `kind`로 분기한다. `testRun.*`는 호스트가 Test run으로 적어 둔 대화에만 포트를 부른다. `profile.preview`의 `hookCount`는 확장 호스트가 등록별 Hook 수를 내놓을 때까지 0이다 [미결].
  - `trace.turn`은 계측이 꺼져 있으면 `traceEnabled: false`, 켜져 있는데 링 버퍼에서 밀려난 Turn이면 `traceEnabled: true`, `retained: false`이고 어느 쪽이든 `entries`는 비어 있다. `ext.timings`의 `traceEnabled`도 같은 뜻이다. 두 결과는 호스트 포트 `TraceReadPort`(`extensions/ports.ts`)가 같은 원천에서 주고, `testRun.*`는 `TestRunControlPort`가 준다. 제어가 실패하면 `TestRunControlError.kind`(`not_a_test_run`, `not_paused`, `not_available`)가 있는 값이다.
- [결정: 2026-11-04 사용자 지시에 따른 기본값] `testRun.phase`의 결과를 넓힌다(W-50). f01–f03 시안이 필요로 하는 값이다. 단계 칸 `phase`, `group`, `seq`는 그대로이고 칸 다섯을 더한다. `paused`는 이 대화에 멈춤 요청이 걸려 있는가다. `lock`은 drive lock이다. `holder`는 쥔 그룹 확장 이름, `status`는 `active`(쓰는 중)·`releasing`(반납이 정해져 다음 경계에서 커밋된다)·`none`(커밋된 drive lock 없음)이고, `none`이면 `holder`와 `epoch`가 null이다. `guardHits`는 이 대화의 계측 기록에서 핸들러 결과가 `blocked`인 수다. `traceEnabled`는 그 수가 측정된 값인지 알리며, 거짓이면 화면은 "측정 꺼짐"을 보이고 `guardHits`는 0이다. `boundaries`는 호스트가 남긴 최근 단계 경계 기록을 최대 200개까지 오래된 것부터 싣는다. 칸은 `seq`(그 경계의 상태 revision), `phase`(그때 커밋된 단계, 없으면 null), `paused`(멈춰 기다렸는가)다. 칸은 모두 필수이고 `additionalProperties`는 거짓이다. 값은 ext-host(`testRunControlOf.phase`)가 채운다(`X.primitives.spec` X-19).
- [결정: 2026-11-04 사용자 지시에 따른 기본값] `ext.test.list`의 replay 보고 `ReplayReport`에 칸별 `cuts`를 더한다. f02 시안의 절단 띠가 필요로 하는 값이다. `cuts`는 group-sdk `ReplayCut`의 wire 모양이고(`commitIndex`는 1 이상, `equal`, `firstDiff`는 0 이상 또는 null), 커밋 시점마다 한 칸, 커밋 순, 최대 1000칸이다. `passed`는 `cuts`에서 `equal`인 칸의 수다. `ext.test.run`의 `maxCommits` 상한을 1000으로 낮춰 `cuts`의 칸 수와 맞춘다(기본 200은 그대로) [근거: `packages/contracts/src/wire-settings/wire/devkit.ts`의 `ExtTestRunParamsShape`와 `ReplayReportShape`].
- [결정: 2026-11-04 사용자 지시에 따른 기본값] `ext.test.run`과 `ext.test.list`의 저장과 실행 규칙(HS-112와 같다). 기록은 사용자 설정 폴더의 `ext-tests.json` 하나이고 시작 순서이며 최대 500개다(넘으면 가장 오래된 것부터 버린다). `replay`는 동기다. 기록을 `running`으로 남기고 끝나면 `passed` 또는 `failed`와 `ReplayReport`를 채워 돌려준다. 한 번에 하나만 돈다(돌고 있으면 `denied`). 개발 모드(`l3.authoring.devMode`)가 거짓이면 `dev_mode_required`이고 기록을 남기지 않는다. 이 프로세스가 처음 읽을 때 앞 프로세스에서 `running`으로 남은 기록은 `failed`(중단됨, `durationMs` null)로 바꿔 저장한다. 손상된 기록 파일은 `io`이고 덮어쓰지 않는다. `testRun`은 Test run 대화를 열고 `running`으로 남긴다(끝내기는 사용자가 한다). 재생기는 `@fresnel/plugin-builder`의 `runInstalledReplay`다. 재생이 실행되지 못하면(매니페스트나 엔트리가 없음, 그룹이 아님, 엔트리가 폴더 밖, 함수 export 없음, 가져오기 실패) `replay`는 그 오류를 돌려주고 기록은 `failed`(보고 null)로 남는다 [결정: 2026-11-04 사용자 지시에 따른 기본값] [근거: packages/plugin-builder/src/replay.ts, apps/host/src/assembly/m4/replay-run.ts]. 설치된 그룹이 `defaultEnabled: false`로 있으면 drive가 돌지 않아 보고는 `no-commits`다 [미결: 재생에서 꺼진 그룹을 켜서 볼지].
- [결정: 2026-10-31 사용자, M4 T-F] 제작(W-27~W-29, W-32, W-49)은 서비스 `fresnel.devkit`(`services/devkit.ts`, `L3.authoring.spec` §3.3, 구현은 L4)을 wire로 노출한다. `ext.kinds`는 새 모델의 `single-plugin`, `plugin-group` 둘을 돌려주고(옛 plugin·group 종류를 대체한다) `ext.scaffold`는 `group`(`members`, `composition`)과 `ui` 초안을 받는다 [제안: T-REG §8]. `ext.validate`의 `issues`는 F 검사와 AU 규칙(`AU-NNN`)을 함께 싣는다. `ext.test.run`의 replay는 개발 모드가 아니면 오류 `dev_mode_required`다. 이름 `ext.test.run`, `ext.test.list`(플러그인 시험 묶음 실행)는 Test run(격리 대화)과 헷갈리지만 그대로 둔다 [결정: 2026-11-03 제안 기본값 자동 승인, 대안 `ext.suite.run`, `ext.suite.list`는 쓰지 않는다. `test`는 어느 쪽이든 확장 이름으로 쓸 수 없다]. `ext.test.list`의 `kind`는 `replay`와 `testRun`뿐이다. benchmark와 코어 변경 검사 결과는 이 목록에 없다. W-30(benchmark·코어 변경 검사)은 wire가 아니라 개발 모드 전용 셸 명령이라 이 문서에 없다. 스키마는 `wire/devkit.ts`다.
- [결정: 2026-11-04 사용자, Q9] 플러그인은 앱 안에서 설치한다(W-32). 설치 전에 권한을 확인받는다. 출처는 지금 지원하는 것만 받는다: 이 컴퓨터의 폴더(묶은 `.js`·`.mjs` 엔트리, 절대 경로). URL·마켓플레이스·원격 카탈로그·자동 업데이트는 범위 밖이다.
  - [제안] `ext.installPreview`는 디스크에 쓰지 않고 `InstallPreview`를 돌려준다. `network`, `files`, `shell`은 요청한 기능 id를 접두로 가른 것이다(`web.*`·`mcp.*`, `workspace.files`·`workspace.images`, `workspace.shell`). 매니페스트에 네트워크·파일 권한 필드가 따로 없어서다. `tools`는 `replaces`로 바꿔 놓겠다고 선언한 내장 도구다. `sha256`은 폴더 내용 해시(`folderHash`)다.
  - [제안] `ext.install`은 `sha256`을 필수로 받는다. 호스트가 복사한 사본의 해시가 다르면 `source_changed`(`jsonrpc.invalidParams`의 `issues`)로 거부하고 사본을 지운다. 안전 모드는 `extension.safeModeActive`, `managed` 범위가 잠근 이름은 `managed_locked`(`invalidParams`)로 거부한다. 결과 `appliesAt`은 같은 이름이 실행 중이면 `nextStepBoundary`에 `needsReload: true`(호출자가 `ext.reload`를 부른다. 설치는 `ext.reload`를 부르지 않는다. `needsReload`가 없는 `nextStepBoundary`는 새 이름의 켜기가 경계로 미뤄진 것이라 부를 일이 없다), 새 이름이면 설치 뒤 로더가 곧바로 싣고(`ExtensionLoader.loadInstalled`, `X.loading-trust.spec` §4.4.4) 실행 중인 turn이 없으면 `now`, 있으면 켜기가 다음 단계 경계로 미뤄져 `nextStepBoundary`다 [결정: 2026-11-04 사용자: 새 이름 플러그인도 재시작 없이 바로 불러온다]. `restart`는 파일은 복사됐지만 싣지 못했을 때(`loadFailure`에 `reason`과 진단)와 로더가 없을 때만 남는다. `ext.remove`의 `appliesAt`은 로더가 내리면 `now`(목록에서 바로 빠진다)다. `dropData`가 참이면 호스트는 먼저 확장을 내리고 그 확장의 저장 테이블을 지운 뒤 폴더를 지운다. 결과 `dataDropped`는 지운 테이블 수다. 데이터를 지우지 못하면 `io`(`store.io`)로 거절하고 폴더는 남겨 같은 요청을 다시 보낼 수 있게 한다. `dropData`가 없거나 거짓이면 저장 테이블은 남고 `dataDropped` 칸은 나오지 않는다. 지우기 확인 화면은 `ext.removePreview`(`{ name }`)로 그 확장이 소유한 테이블과 행 수를 미리 읽는다. 미리 보기는 아무것도 바꾸지 않고, 이름이 없으면 `extension.notFound`, 사용자 확장 위치가 없으면 빈 목록이다.
- [제안, T-MEAS-READ] 측정 읽기: 스키마는 `wire/measure.ts`다. 이름 `measure.turn`, `measure.daily`는 제안이다. `measure.turn`은 한 Turn의 측정 행(`turn`, `call`, `hook`, `ctx`, `cache`, 쓰는 칸은 L4.host-service.spec §4.20)을 시간 순으로 돌려준다. `kind`마다 `metrics`(이름 → 숫자)와 `tags`(이름 → 짧은 문자열) 이름이 다르다. 측정이 꺼져 있으면 `enabled: false`이고 목록은 비며, 보존 기간이 지나 접힌 Turn도 빈 목록이다. `thread`가 없으면 3001이고 저장소를 읽지 못하면 `store.io`다. 요청 본문은 어떤 행에도 없다. `measure.daily`는 `kind`와 `metric` 하나의 일별 집계(개수, 합, 최소, 최대)를 UTC 날짜 순으로 돌려준다. 원본이 남은 날과 이미 접힌 날을 합친 값이다. 백분위는 wire에 내지 않는다(원본이 접히면 계산할 수 없다). 결과 상한은 `measure.turn` 4000행, `measure.daily` 3650일이다.
- M4 메서드(단계 M4)는 §3.3.1 표에 있다.

### 4.3 요청 처리 순서

1. 프레임 크기 검사(전송). 넘으면 `-32600`, 프레임은 버린다.
2. JSON 해석. 실패하면 `-32700`(`id: null`).
3. `checkEnvelope`: 배치, 깊이, 배열 길이, envelope 스키마, 메서드 이름.
4. 메서드 조회. 없거나 opt-in하지 않은 실험 기능이면 `-32601`.
5. params 검사(`WIRE_METHODS[m].params`). 실패하면 `-32602`와 `issues`.
6. 처리기 실행. 처리기가 던진 `WireError`는 그대로, 그 밖의 예외는 `-32603`으로 바꾼다.
7. 결과 검사는 개발 빌드에서만 한다(`WIRE_METHODS[m].result`). 운영 빌드는 비용 때문에 건너뛴다 [제안].

### 4.4 취소

- 클라이언트는 `$/cancelRequest {id}`를 보낸다. 서버는 그 요청의 `signal`을 중단하고, 처리기가 멈추면 `request.cancelled`(5001)로 응답한다. 이미 응답한 요청이면 무시한다.
- `turn.start`의 응답은 turn 접수만 뜻한다. 이미 접수된 turn을 멈추려면 `turn.interrupt`를 쓴다.

### 4.5 재전송과 순서

- §3.4.2의 다섯 규칙과 §3.4.3의 알고리즘을 따른다.
- 클라이언트 gap 감지는 19 §3.5.7을 따른다. `from ≠ 저장한 pos`이면 이미 받은 구간은 버리고, 구멍이면 마지막 `to`부터 다시 구독한다.

### 4.6 승인 요청 방향

[결정: review.decisions-2 U-02] L1-d 승인 프로토콜(`_research/foundation-plan.md` §1 5번: 질문과 계획 승인을 하나로 합침)은 A안으로 wire에 싣는다. 승인 대기 중 프로세스가 죽어도 재개 뒤 같은 요청을 다시 보일 수 있기 때문이다.

| 안 | 흐름 | 장점 | 단점 |
|---|---|---|---|
| A. 내구 이벤트 + 응답 메서드 [결정] | 엔진이 `approval.requested` 내구 이벤트를 커밋한다. 클라이언트는 `events.batch`로 받고 `approval.respond`로 답한다. 결과는 `approval.resolved` 이벤트로 남는다 | 재접속·재시작 뒤에도 대기 상태가 저장소에서 복구된다. 여러 클라이언트 중 아무나 답할 수 있다. 서버 → 클라이언트 요청이 필요 없다 | 대기 시간 제한을 엔진이 따로 관리한다 |
| B. 서버 → 클라이언트 요청 | 엔진이 JSON-RPC 요청 `approval.request`를 보내고 클라이언트 응답을 기다린다 | ACP·MCP의 elicitation과 모양이 같다 | 연결이 끊기면 요청이 사라진다. 클라이언트가 여럿이면 누구에게 보낼지 정해야 한다 |

- A안이라 승인 요청·해결 이벤트가 필요하다. `approval.requested`, `approval.resolved` kind를 `F.records.spec` §3.3.1 코어 카탈로그에 두었다(`body.kind`는 `tool`, `question`, `plan`). 하위 모양의 필드 뜻은 `L1.tools.spec`(승인 프로토콜) 소관이다. 이 문서는 `approval.respond` 메서드만 정한다. 사용자가 B안으로 답하면 두 kind를 `retired: true`로 두고 이 절을 고친다.
- `approvalId`는 [가정] 승인 요청 이벤트의 id(`EventId`)를 그대로 쓴다.

### 4.7 설정 우선순위 [제안]

자료마다 서술이 다르다.

- `_research/layer-plan-v2.json` F5 "설정 계층": "관리, 사용자, 작업 폴더, 로컬, 세션 순서로 덮어씁니다. 관리 잠금을 표시합니다." 나열 순서대로 뒤가 앞을 덮어쓴다고 읽으면 이번 실행이 최상위이고 관리가 최하위다.
- `_research/settings.md` §2.1, `_research/item-catalog.md` F절: Claude Code는 관리 > `--settings`(플래그) > local > project > user이고 관리 설정이 최상위다.

두 서술은 "관리 잠금"을 함께 놓고 보면 하나로 맞출 수 있다. 관리를 뺀 나머지는 layer-plan의 덮어쓰기 순서(사용자 → 작업 폴더 → 로컬 → 이번 실행)를 따르고, 관리는 잠금으로서 맨 위에 둔다. 이번 실행은 Claude Code의 플래그 자리에 해당한다.

| 순위(높음 → 낮음) | 범위 | 저장 위치 [가정: 경로는 L0.os·L4가 정한다] | 쓰는 쪽 | 잠금 |
|---|---|---|---|---|
| 1 | `managed` | OS별 관리 정책 파일 | 관리자(사용자 앱에서는 읽기 전용) | 이 범위가 정한 키는 잠긴다 |
| 2 | `launch` | 저장하지 않음 또는 thread 기록. CLI 플래그, "이번만 적용" | 사용자, CLI 플래그 | - |
| 3 | `local` | 작업 폴더의 개인 파일(버전 관리 제외) | 사용자 | - |
| 4 | `project` | 작업 폴더 공유 파일(버전 관리 대상) | 사용자, 팀 | - |
| 5 | `user` | 사용자 홈의 설정 파일 | 사용자 | - |
| 6 | `default` | `SettingDef.default` | 코드 | - |

규칙:

1. 유효 값은 순위가 가장 높은, 그 키를 정한 범위의 값이다. 값을 정하지 않은 범위는 건너뛴다.
2. 값의 병합 단위는 키 하나다. 값이 객체나 배열이어도 깊은 병합을 하지 않고 통째로 바꾼다 [제안]. 깊은 병합은 출처 표시를 흐리게 하기 때문이다. 목록을 더해야 하는 키는 그 층 spec이 별도 키(예: `...additional`)로 정의한다.
3. `managed`가 정한 키는 `locked: true`다. 다른 범위의 쓰기는 `settings.locked`(3104)로 거부한다. 다른 범위 파일에 남은 값은 `shadowed`로 보인다.
4. 키의 `allowedScopes`에 없는 범위에 있는 값은 무시하고 경고를 남긴다(§4.8). 쓰기는 `settings.scopeNotAllowed`(3103)로 거부한다. 예: pi `defaultProjectTrust`처럼 사용자 파일 전용인 키는 `allowedScopes: ["managed", "user"]`다(`_research/settings.md` §2.1 "범위 제한 키"). 이런 키를 작업 폴더 파일에 적어도 적용하지 않는다. 저장소를 받는 것만으로 신뢰 설정이 바뀌지 않게 하기 위해서다.
5. 잠금 표시 규칙: L4 화면은 `locked: true`인 항목에 잠금 배지와 출처 경로를 보이고 편집을 막는다. `shadowed`가 비어 있지 않으면 "다른 범위의 값이 가려짐"을 보인다. CLI `config get`은 같은 정보를 `source`와 함께 출력한다.
6. `runtimeChange`: `live`는 즉시, `nextTurn`은 다음 turn 시작 때, `restart`는 호스트 재시작 때 적용한다. 적용 전까지 `pendingUntil`에 그 시점을 둔다.

[결정: 2026-11-04 사용자, B10 1안] 관리 범위는 "잠금"만 합니다. 사용자가 덮어쓸 수 있는 "관리 기본값"은 두지 않습니다(관리자 배포 사례가 생기면 더합니다). 우선순위 표는 이 결정으로 확정입니다.

### 4.8 파일 값의 검사와 보존

- 설정 파일을 읽을 때 각 값은 `validateSettingValue`로 검사한다. 실패한 값은 그 범위에서 없는 것으로 치고 다음 순위로 넘어간다. 실패는 진단으로 남기고 시작을 막지 않는다.
- 카탈로그에 없는 키(제거된 확장, 오타)는 파일에서 지우지 않고 보존한다. 화면과 `config list`는 "모르는 키"로 보인다.
- 시크릿 키 값이 `secret://` 참조가 아니면 그 값을 적용하지 않고 `settings.secretValue` 진단을 남긴다. 파일에 평문 시크릿이 있었다는 사실만 기록하고 값은 로그에 쓰지 않는다.

### 4.9 생성 규칙: 화면, 파일, 명령

[결정] 모든 설정은 F5 설정 스키마 하나에서 L4 화면, 설정 파일, 명령을 함께 만든다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 6).

| 산출물 | 만드는 쪽 | F가 보장하는 입력 |
|---|---|---|
| 설정 화면(탭 12개) | `L4.settings-ui.spec` | `SettingDef.ui`, `range`, `secret`, `allowedScopes`, `EffectiveSetting` |
| 설정 파일 JSON Schema | `L4.host-service.spec`(생성 명령) | `settingsJsonSchema` 출력 규약(§4.10) |
| 명령 | `L4.cli.spec`(`fresnel config get/set/reset/list`), wire `settings.*` | `checkSettingWrite`, `validateSettingValue`, `EffectiveSetting` |

- 탭 [제안]: `SettingsTab`의 13개 값(M3-REQ-15가 `sandbox`를 더했다). `_research/settings.md` §4의 13개 탭 초안에서 "에이전트"를 "모델"에 합치고(`_research/layer-plan-v2-notes.md` L4 설정 화면 구성안의 모델 탭이 서브에이전트를 포함한다), "시크릿"(같은 구성안)과 "외관"(층 밖 항목)을 따로 둔 결과다. 최종 배치는 `L4.settings-ui.spec`이 정하고 enum 변경은 F 버전 정책(부 버전)을 따른다.
- 화면 공통 규칙(`_research/settings.md` §4)에서 F 데이터로 보장하는 것: 범위 배지(`EffectiveSetting.source.scope`), 대화 중 변경 가능 여부(`runtimeChange`, `allowedScopes`에 `launch` 포함 여부), 관리 잠금(`locked`), 저장 파일 경로(`source.path`).
- 시크릿 값 비표시 규칙 [제안]
  1. 설정에는 시크릿 값이 없다. 시크릿 키의 값은 `secret://<name>` 참조 문자열뿐이다.
  2. `settings.get`, `EffectiveSetting`, JSON Schema 출력, 로그, 이벤트 어디에도 해석한 시크릿 값을 싣지 않는다. 참조 문자열만 싣는다.
  3. 화면은 참조 이름과 상태(등록됨, 없음)만 보인다. 값 등록·열람은 `L0.secrets.spec`의 흐름으로 하고 설정 화면은 그 화면으로 이동만 한다.
  4. `settings.set`에 참조가 아닌 문자열이 오면 `settings.secretValue`(3105)로 거부하고, 오류 `details`에도 그 값을 넣지 않는다.

### 4.10 JSON Schema 출력 규약

```ts
// settings/jsonschema.ts
export interface SettingsJsonSchemaOptions {
  readonly scope: Exclude<SettingScope, "launch">;    // 파일이 있는 범위
  readonly includeDeprecated?: boolean;                 // 기본 true(경고 표시용)
}
export type JsonSchemaDocument = Readonly<Record<string, unknown>>;

/** 순수 함수. 카탈로그를 한 범위의 설정 파일 스키마로 만든다. */
export declare function settingsJsonSchema(catalog: SettingCatalog, options: SettingsJsonSchemaOptions): JsonSchemaDocument;
```

1. 방언은 JSON Schema 2020-12다(`$schema: "https://json-schema.org/draft/2020-12/schema"`).
2. 파일 모양은 평평한 객체다. 키는 전체 설정 키(`"l1.loop.maxSteps"`)다. [제안] 중첩 객체 대신 평평한 키를 쓰면 병합 단위(키 하나)와 파일 모양이 같아진다.
3. `properties[key]`는 `def.type`의 JSON Schema에 `range`를 합친 것이다(`minimum`, `maximum`, `enum`). 변환은 `F.capabilities.spec`의 `toJsonSchema(schema)`(TypeBox → JSON Schema 2020-12, `~` 접두 키 제거)를 쓴다.
4. 그 범위가 `allowedScopes`에 없는 키는 `properties`에 넣지 않는다. 그래서 편집기 자동 완성과 검사가 범위 제한을 그대로 보인다.
5. `additionalProperties: true`다. 모르는 키를 보존하기 위해서다(§4.8). 편집기 경고는 `x-fresnel-unknownKeys: "warn"`로 표시한다.
6. `default`는 `def.default`가 있을 때만 싣는다. 시크릿 키는 `default`가 없고 `pattern`이 `SecretRef`와 같다.
7. `deprecated`가 있으면 JSON Schema `deprecated: true`와 `description`에 대체 키를 적는다.
8. 확장 정보는 `x-fresnel` 객체에 싣는다: `{ layer, runtimeChange, allowedScopes, secret, since, ui }`.
9. 같은 카탈로그와 같은 옵션이면 출력은 바이트 단위로 같다(키 정렬). CI가 커밋본과 diff할 수 있게 하기 위해서다.

10. [결정: M3-REQ-15] 전송용 정의에서도 같은 병합을 한다. `toValueJsonSchema(def: SettingDefWire): JsonObject`는 `def.type`에 `def.range`를 합친다(`settings/jsonschema.ts`). `effectiveSchemaJson`과 규칙이 같아 클라이언트 검사, 파일 검사, `settings.set` 검사가 같은 판정을 낸다.
11. [결정: M3-REQ-15, M3-m2c-02] `EffectiveSetting.problem`은 값이 검사를 통과했어도 호스트만 아는 사실로 쓸 수 없을 때 호스트가 싣는다. 예: 저장해 둔 기본 모델 id가 지금 카탈로그에 없으면 `l1.models.default`의 `problem`이 `{ kind: "unknownModel", args: { id } }`다. 데스크톱 첫 실행 안내는 이 필드가 없어야 "기본 모델 선택" 단계를 완료로 본다. 모델 목록 wire는 따로 두지 않는다.

### 4.11 CLI 파서와 같은 검사

- [제안] CLI `fresnel config set <key> <raw>`는 `raw`를 먼저 JSON으로 해석하고, 실패하면 문자열로 본다. 해석한 값은 `checkSettingWrite`로 검사한다. 이 함수 안의 값 검사는 `validateSettingValue`이고, 이 함수는 `settingsJsonSchema`가 내는 스키마와 같은 TypeBox 스키마(`type` + `range`)로 `Value.Check`를 한다. 그래서 파일 검사, CLI 검사, wire `settings.set` 검사의 결과가 같다.

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| 프레임이 1 MiB를 넘는다 | 전송이 `-32600`(`issue: "frameTooLarge"`)을 보내고 그 프레임을 버린다. stdio는 줄 끝까지 읽고 버린다 |
| stdio에서 줄이 JSON이 아니다 | `-32700`(`id: null`). 연결은 유지한다 |
| stdio 상대가 EOF | `onClose({reason: "eof"})`. 자식 엔진은 안전 경계에서 멈춘다(`_research/process.md` §6.2 단계 1, 구현은 L4) |
| 응답 전에 연결이 닫힌다 | 클라이언트의 대기 중 `request`는 `CloseInfo`를 담은 오류로 끝난다. 서버는 처리 결과를 버린다. `turn.start`는 접수됐을 수 있으므로 재접속 뒤 이벤트로 확인한다 |
| 재전송 중 연결이 닫힌다 | 읽기를 멈춘다. 클라이언트는 마지막 `to`부터 다시 구독한다 |
| DB가 복원되어 `storeId`가 바뀌었다 | `replay.outOfRange{storeMismatch}`. 클라이언트는 위치와 캐시를 버리고 `from: "head"`로 재구독한다 |
| 같은 키를 두 패키지가 정의 | `buildCatalog`가 `duplicateKey`로 거부한다. 코어 키 중복은 시작 실패, 확장 키 중복은 뒤에 로드된 확장의 설정을 거부한다 |
| 확장이 `l1.` 키를 정의 | `foreignNamespace`로 거부한다 |
| `secret: true`에 `default` 지정 | `defineSettings`가 D2 위반으로 `SettingDefError`를 던진다. 매니페스트에서 온 정의면 그 확장의 설정 전체를 거부한다 |
| `launch` 범위 쓰기인데 키가 `launch`를 허용하지 않음 | `settings.scopeNotAllowed`(3103) |
| 관리 범위가 잠근 키를 사용자가 바꾸려 함 | `settings.locked`(3104). 화면은 편집을 미리 막는다 |
| 파일 값이 스키마에 맞지 않음 | 그 값을 건너뛰고 다음 순위 값을 쓴다. 진단을 남긴다 |
| 폐기된 키를 씀 | 값은 적용하고 `deprecated: true`와 대체 키를 보인다. `removed`가 된 뒤에는 모르는 키로 보존만 한다 |

## 6. 설정 노출

- F 자신의 설정 키: 없음. F에는 런타임 로직이 없어 바꿀 값이 없다.
- wire 한도(`maxReplayEvents`, 연결당 구독 수, 프레임 크기)를 사용자에게 열지는 `L4.host-service.spec`이 정하고, 연다면 키도 그 문서가 소유한다(`l4.host-service.*`).
- 이 문서가 정하는 것은 다른 층이 설정을 노출하는 형식(§3.8~§4.11)이다. 각 층 spec의 "설정 노출" 절은 `defineSettings` 선언과 같은 열(키, 타입, 기본값, range, runtimeChange, allowedScopes, ui.tab, secret)로 표를 쓴다.

## 7. 훅

- 이 도메인은 on·post·drive·register 훅을 선언하지 않는다.
- 확장과의 관계는 둘이다.
  - 확장 설정: `ExtensionManifest.userConfig` → `settingsFromManifest` → 카탈로그(§3.8.3).
  - 확장 메서드와 오류: 확장 wire 메서드는 M2 이후(§4.2), 확장 오류 코드는 10000~19999와 `ext.<id>.` kind(§3.5.3).
- [제안] 설정 변경 통지를 훅(post)으로 둘지는 `X.primitives.spec`과 `L1.persistence.spec`이 정한다. F는 변경 이벤트의 payload로 `EffectiveSetting`을 쓸 수 있게 해 둔다.

## 8. 다른 문서와의 인터페이스

| 방향 | 문서 | 내용 |
|---|---|---|
| 요구 | `F.records.spec` | `DurableEventEnvelope`, `VolatileEventEnvelope`, `EventKindSchema`, `DetachedFieldSchema`, seq 규칙(§4.1), 휘발 kind 목록. 승인 이벤트 kind(`F.records.spec` §3.3.1, A안 [결정: review.decisions-2 U-02]) |
| 제공 | `F.records.spec` | `settings.changed` payload의 `key`·`scope` 값 집합(`SettingKey`, `SettingScope`). records는 settings보다 낮은 순위라 스키마를 import하지 않고 문자열로 둔다(`F.readme` §3). 값 집합 일치는 `F.wire-settings.plan`의 테스트가 확인한다. `redactions` 규칙(§3.4.5) |
| 요구 | `L0.store.spec` | `StoreId` 발급·보관, `headSeq()`와 구간 읽기, 커밋 직후 같은 턴의 방송 |
| 요구 | `F.conversation.spec` | ID 타입과 `XSchema`, `PartDelta`, `TextContentSchema`, `ImageContentSchema`, `UserMessage`, 수명주기 알림 이름(`item.updated` 등) |
| 요구 | `F.capabilities.spec` | `SemVer`, `SemVerSchema`, `CapabilityErrorData`, `toJsonSchema`, `SecretRef`·`SecretNameSchema`(§3.10) |
| 요구 | `F.extensions.spec` | `ExtensionName` 문법, `ExtensionManifest.userConfig` 모양(설정 키 접두 `ext.<name>.`). 요청: `UserConfigEntry`에 값 스키마 필드 추가 |
| 요구 | `eng.events.design` | 내구·휘발 이벤트 구분, 순서 보장, 재생 규칙 |
| 요구 | `L1.persistence.spec`, `L0.store.spec` | `thread.read`: 현재 가지의 item을 `before`부터 거꾸로 `limit`개 읽고 같은 읽기 트랜잭션에서 `headSeq()`를 재는 조회. `approval.list`: thread의 미해결 `approval.requested` 조회(`ThreadSummary.pendingApprovals`와 같은 원천) |
| 제공 | `L4.host-service.spec` | `WireHandlers`, `Transport`, `WIRE_ERRORS`, 재전송 알고리즘, `settingsJsonSchema` |
| 제공 | `L4.cli.spec`, `L4.desktop.spec` | `HostConnection`, `WIRE_METHODS`, 알림 타입, `checkSettingWrite` |
| 제공 | `L4.settings-ui.spec` | `SettingDef.ui`, `SettingsTab`, `EffectiveSetting` |
| 제공 | X·L0·L1·L2·L3 각 spec | `defineSettings`, `SettingDef`, 키 네임스페이스 규칙 |
| 제공 | `X.loading-trust.spec` | `settingsFromManifest`, `buildCatalog`, `CatalogIssue` |
| 제공 | `L0.secrets.spec` | `SecretRef` 재노출(정본 `F.capabilities.spec` §3.10), 값 없는 `secret.*` 메서드(M2) |
| 제공 | `L0.process.spec` | `host.shutdown`, `host.hello` `auth?`, `host.authFailed`(M2) |
| 제공 | `L1.persistence.spec` | `resolveSetting`, `ScopeStack`, 우선순위 규칙 |

## 9. 수용 기준

wire:

- A1. `events.subscribe({from: {storeId, seq: k}})`는 seq가 k보다 큰 내구 이벤트를 빠짐없이, 중복 없이, seq 오름차순으로 보낸다. 재전송 도중 새로 커밋된 이벤트도 한 번씩만 온다.
- A2. 연속한 `events.batch` 알림에서 `from`은 직전 `to`와 같고, 첫 알림의 `from`은 응답의 `start`다.
- A3. `from: "head"`이면 응답 시점 이후에 커밋된 이벤트만 온다.
- A4. `from.storeId`가 다르면 `2001`에 `reason: "storeMismatch"`, `from.seq > headSeq`이면 `reason: "aheadOfHead"`가 온다.
- A5. 배열 메시지는 `-32600` 하나(`id: null`)를 받는다. 숫자 `id`는 `-32600`, 배열 `params`는 `-32602`, 깊이 65 메시지는 `-32600`이다.
- A6. `classifyMethodName`은 `turn.start`를 `core`, `$/cancelRequest`를 `control`, `ext.web-exa.search`를 `extension`으로 분류하고 `Turn.start`, `turn`, `turn.start.now`, `boundary.step.before`는 거부한다.
- A7. `host.hello` 전의 `turn.start`는 1001을 받는다. opt-in하지 않은 `experimental` 메서드는 `-32601`을 받는다. hello 뒤에 `$/connectionReset`을 보내면 `host.hello`를 다시 보내도 성공하고(`host.helloDuplicate`가 아니다), hello 전의 `$/connectionReset`은 무시된다.
- A8. `WireParams<"turn.start">`와 `Static<typeof WIRE_METHODS["turn.start"]["params"]>`가 같은 타입이다(타입 테스트). `WireMethodMap`과 `WIRE_METHODS`의 키 집합이 같다.
- A9. 이 문서 §3.3.1 표의 메서드 이름·단계 집합과 `WIRE_METHODS`의 것이 같다(문서 검사).
- A10. 전송 적합성 케이스 전부를 in-process 전송과 stdio 전송이 같은 결과로 통과한다.
- A11. `stream.chunk`는 재전송되지 않는다. 재구독 뒤에 이전 조각이 다시 오지 않는다.
- A12. 처리기가 던진 알 수 없는 예외는 `-32603`, `message: "Internal error"`로 바뀌고 원래 메시지가 응답에 없다.
- A13. `thread.read`가 돌려준 `position.seq` 이하의 그 thread 이벤트는 `items`에 모두 반영되어 있고 그 seq를 넘는 이벤트는 하나도 반영되어 있지 않다. `before` 페이지를 끝까지 이어 붙이면 중복도 빠짐도 없는 item 열이 된다. 없는 `before`는 3005, 없는 thread는 3001이다.
- A14. 구독(`from: "head"`) 뒤 `thread.read`를 보내고 `seq > position.seq`인 이벤트만 적용하면, 읽기와 겹치는 구간에 이벤트가 커밋되어도 최종 item 집합이 중단 없이 구독한 클라이언트의 것과 같다.
- A15. `approval.list`의 `approvals`는 `position.seq` 시점에 `approval.resolved`가 없는 `approval.requested` 전부이고 각 항목의 `request`가 이벤트 payload와 같다. 응답한 뒤에는 목록에서 빠진다.
- A16. `createHostConnection`과 `createStdioTransport`는 `@fresnel/contracts/wire`의 같은 구현을 CLI, 호스트, 데스크톱이 쓴다. 이 구현의 소스는 Bun·Node 모듈을 import하지 않는다. `HostConnection.notify`는 `$/connectionReset`을 id 없는 알림으로 보낸다.
- A17. `approval.respond`의 `answer`는 `QuestionAnswer`, `{ mode?, note? }`, `{ feedback }`, `ReviewAnswer` 가운데 하나여야 한다. 질문 id 아래 문자열 하나만 둔 값이나 `AskAnswer` 배열 모양은 `-32602`다.
- A18. `web.providers`의 결과는 값으로 왕복한다. `capability`가 `web.search`, `web.fetch`, `web.browse`가 아니거나 `status.kind`가 `ok`, `unavailable`이 아니거나 필드가 빠지면 거부된다. 결과와 항목의 속성 이름에는 키나 토큰을 담을 이름이 없고, 알 수 없는 필드는 거부된다(M3-REQ-96).
- A19. `schedule.create`, `schedule.list`, `schedule.cancel`, `schedule.fire`의 params는 기능 입력에 `_meta`를 더한 모양이고 알 수 없는 필드를 거부한다. 트리거 다섯 모양은 정해진 필드만 받고 `atMs: 0`은 거부된다. 결과의 `ok: false`는 `ScheduleError`의 여덟 `kind`를 모두 왕복한다. 네 메서드는 단계 M3다(M3b B1-SCH2).

settings:

- S1. `secret: true`이고 `default`가 있는 정의는 `defineSettings`가 거부한다(D2).
- S2. `range.min > range.max`인 정의, `default`가 range 밖인 정의는 거부한다(D4, D5).
- S3. `allowedScopes`에 `launch`가 없는 키를 `launch` 범위로 쓰면 `checkSettingWrite`가 `settings.scopeNotAllowed`를 돌려준다.
- S4. `managed` 범위가 정한 키는 유효 값이 managed 값이고 `locked: true`다. 다른 범위의 쓰기는 `settings.locked`다.
- S5. managed가 없을 때 같은 키를 user, project, local, launch가 모두 정하면 유효 값은 launch 값이고 `shadowed`는 local, project, user 순이다.
- S6. 같은 `SettingDef`에 대해, 임의 값 v의 `validateSettingValue(def, v).ok`와 `settingsJsonSchema`가 낸 `properties[key]`로 v를 검사한 결과가 같다(속성 기반 테스트 포함). CLI 파서도 같은 결과를 낸다.
- S7. `settingsJsonSchema({scope: "project"})`에는 `allowedScopes`에 `project`가 없는 키가 없다.
- S8. 시크릿 키의 `EffectiveSetting.value`는 `secret://` 문자열이거나 `null`이다. 참조가 아닌 값 쓰기는 `settings.secretValue`이고 오류 `details`에 그 값이 없다.
- S9. 두 그룹이 같은 키를 정의하면 `buildCatalog`가 `duplicateKey`를 돌려준다. 확장 매니페스트가 `l1.` 키를 정의하면 `foreignNamespace`다.
- S10. `settingsJsonSchema`는 같은 입력에 바이트 단위로 같은 출력을 낸다.

## 10. 미결 사항

1. [결정: review.decisions-2 U-02] 승인 요청 방향은 A안(내구 이벤트 `approval.requested` + `approval.respond`)이다(§4.6).
2. [결정: 2026-11-04 사용자, B10 1안] 설정 우선순위 표(§4.7)는 확정입니다. 관리 범위는 잠금 전용이고 관리 기본값은 두지 않습니다.
3. [미결] 폐기 기간(§3.7). 제안은 12개월 또는 다음 주 버전 중 늦은 쪽.
4. [결정: review.m3-design-inputs D-M3-16 c, M3-REQ-19] 서비스 모드 인증. 로컬 Unix 소켓은 파일 권한(0600)만으로 막고 `auth`를 받지 않는다. TCP로 열 때만 `host.hello`의 `auth.token`이 필수이고, 없거나 맞지 않으면 `host.authFailed`(`details.reason`: `missing`·`invalid`, 토큰 값은 싣지 않는다)로 응답한 뒤 연결을 닫는다. 어느 전송이 토큰을 요구하는지는 호스트가 정한다(계약은 `auth?`와 오류만 둔다). 토큰 열기 옵션과 회전은 `L0.process.spec`이 정한다(M3-REQ-43). 원격은 [결정: review.decisions-2 U-11]로 M3에 넣되, 로컬 서비스 소켓을 SSH 터널이나 사설망(Tailscale 등)으로 연결하는 방식이다. 그래서 원격도 소켓 인증 규칙을 그대로 쓴다. 내장 TLS + 토큰 WebSocket 전송은 2차다.
5. [결정: 2026-10-31 사용자, M4 T-F] 확장이 wire 메서드를 더하는 것은 허용한다. 이름은 `ext.<확장이름>.<동사>`다(§4.2).
6. [결정: review.decisions-2 U-24] TypeBox 버전은 1.3.27(catalog 정확 고정)이다. pi-ai가 1.3.27을 정확 고정하므로 같은 판으로 맞춰 한 사본만 설치한다. 1.4로 올리는 시점은 pi가 올릴 때다.
7. [미결] `Seq`·`StoreId`를 F.records로 옮길지. `sto` 접두는 `IdPrefix`에 넣지 않고 저장소 정체성 ID 부류로 둔다(`F.conversation.spec` §3.2.1 ①) [제안].
8. [미결] `UserConfigEntry`에 값 스키마 필드(`type`, `default`, `range`, `runtimeChange`, `allowedScopes`)를 둘지(§3.8.3). 확장 설정 키 접두는 `ext.<name>.`로 맞췄다(`F.extensions.spec` §3.1, §6).
9. [결정: m2-plan F.6] `ThreadSummary`의 필드는 §3.3.1 아래 코드로 정했다. 이어서 실행 후보는 전용 메서드 없이 `resumable` 필드로 알린다.
10. [결정: m2c G1-08] U-04가 미룬 Runtime API 요청은 §3.3.4 판정표로 하나씩 받거나 보류하거나 반려했다. 보류 항목은 M3 계획이 받는다. 이전에 받은 항목은 그대로다: 이어서 실행 후보는 `ThreadSummary.resumable`(미결 9), thread 오류 kind 3004~3006(§3.5.2), `secret.beginReveal`(§3.3.1 표).
11. [결정: m2 F.2] L4.desktop 상태 설계 §14의 1번(스냅샷), 2번과 13번(대기 승인 목록)을 `thread.read`, `approval.list`로 받았다(§3.3.1, §3.4.6). 12번(로딩 신호)은 새 신호 없이 클라이언트가 요청 수명주기로 얻는다(§3.4.6 6항).
12. [결정: 2026-11-04 사용자, B13 1안] `schedule.create`의 `warnings` 값 이름은 `service_mode_off`로 하나입니다. `L2.schedule.spec` §4.4.6을 이 이름으로 고쳤습니다(경고 값은 늘리지 않음).

- [결정: 2026-11-04 사용자] `schedule.list`는 선택 쪽 나누기를 가진다(l2/F-01). 항목은 저장 순서(오래된 것부터)이고 쪽은 가장 새 쪽부터 거슬러 올라간다. `limit`(기본 200)을 생략하면 이전처럼 가장 새 200개다. 더 오래된 항목이 남으면 결과의 `nextBefore`가 이 쪽의 가장 오래된 항목 ID이고, 이것을 다음 호출의 `before`로 주면 그 항목보다 오래된 쪽이 온다. 알 수 없는 `before`는 빈 쪽이다(항목은 지우지 않고 끄기만 한다). 기능 `schedule.entries.list`도 같은 입력과 출력이다.
