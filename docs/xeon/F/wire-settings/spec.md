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

이 문서는 F5 "연결·설정 계약"(`_research/layer-plan-v2.json` F5)의 스펙이다. 1부는 호스트 계약(wire), 2부는 설정 스키마 단일 원천(settings)이다. 두 부분은 한 도메인 디렉터리 `src/wire-settings/`에 있고 서브패스는 둘로 나뉜다.

| 서브패스 | 소스 디렉터리 | 내용 |
|---|---|---|
| `@xeon/contracts/wire` | `xeon/packages/contracts/src/wire-settings/wire/` | JSON-RPC envelope, 메서드 레지스트리, 알림, 커서, 오류, 전송 인터페이스, 버전 |
| `@xeon/contracts/settings` | `xeon/packages/contracts/src/wire-settings/settings/` | `SettingDef`, `defineSettings`, 설정 계층, 유효 값, JSON Schema 출력 규약 |

[제안] 서브패스를 둘로 나눈다. 설정 선언은 모든 층(X~L3)이 import하고 wire는 L4만 import하므로, 설정만 쓰는 층이 wire 타입을 끌어오지 않게 하기 위해서다.

## 1. 목적과 범위

### 1.1 정하는 것

- CLI, 데스크톱, 서비스가 함께 쓰는 호스트 계약 하나와, 그 계약을 나르는 전송(Transport) 인터페이스 3종의 시그니처.
- JSON-RPC 2.0 envelope 규칙, 메서드 이름 규칙, 메서드·알림 레지스트리와 각 params/result 스키마.
- 이벤트 구독의 seq 커서, 재전송 계약, 휘발 스트림 규칙.
- 오류 객체 모양과 오류 코드 구간, `_meta`와 추적 컨텍스트 전파 규약.
- 계약 버전 정책과 기능 수명주기(Active, Deprecated, Removed, 실험 opt-in, 능력 탐지).
- 설정 정의 스키마 `SettingDef`와 선언 함수 `defineSettings`, 키 네임스페이스 규칙.
- 설정 계층(관리, 사용자, 프로젝트, 로컬, 세션)의 우선순위, 잠금, 유효 값과 출처의 모양.
- 같은 `SettingDef`에서 L4 화면, 설정 파일, 명령을 만들 때 F가 보장하는 출력 규약(JSON Schema 출력).

### 1.2 다루지 않는 것

- 전송 구현(stdio 프레이밍 코드, 소켓 서버, 프로세스 기동): `L4.host-service.spec`, `L4.desktop.spec`, `L4.cli.spec`.
- 엔진 쪽 메서드 처리기 구현: `L4.host-service.spec`이 L1 서비스를 엮어 구현한다.
- 세션 소유 잠금 구현: `L0.process.spec`, `L1.persistence.spec`.
- 설정 파일 위치, 파일 감시, 병합 실행: `L1.persistence.spec`과 `L4.host-service.spec` [가정. 아래 §4.9 참조].
- 설정 화면 생성 코드: `L4.settings-ui.spec`.
- 각 층의 설정 키 목록(카탈로그): 각 층 spec의 "설정 노출" 절이 소유한다. F는 F 자신의 키만 둔다(§6).
- 비밀 값 저장과 해석: `L0.secrets.spec`. F는 `secret://` 참조 문자열의 모양만 정한다.

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
| 위치(StreamPosition) | `{storeId, seq}` 쌍. 클라이언트가 저장하는 재개 지점 |
| 설정 키 | `<층>.<도메인>.<이름>` 또는 `ext.<확장id>.<이름>` 형태의 점 표기 이름 |
| 설정 범위(scope) | 값이 저장되는 계층. `managed`, `user`, `project`, `local`, `session` |
| 유효 값 | 모든 범위를 우선순위대로 합친 결과 값과 그 출처 |

thread, turn, step, item 용어는 `F.conversation.spec`을 따른다. 이 문서의 메서드 영역 `thread`는 F.conversation의 thread(대화 하나)를 뜻한다. [가정] F.conversation이 저장 단위인 세션과 thread를 1:1로 둔다. 다르면 메서드 영역 이름을 F.conversation 쪽에 맞춘다.

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
- wire 레지스트리 이름에는 `Wire` 접두를 붙인다(`WireMethodMap`, `WIRE_METHODS`). `F.capabilities.spec`의 `MethodMap`, `MethodDef`(능력 서비스 메서드)와 구분하기 위해서다.

### 3.1 호스트 계약 1부: 연결과 전송

[결정] 엔진은 프로세스와 무관한 라이브러리이고, 호스트 계약은 하나이며, 전송만 바꾼다(`_research/foundation-plan.md` §1 3번, `_research/decisions-log.md` 2026-10-21 계획 v2, `_research/process.md` §6.1).

| 배포 형태 | 전송 | 프레이밍 | 단계 |
|---|---|---|---|
| CLI(`xeon chat`) | in-process | 없음. 메시지 객체를 그대로 넘긴다 | M1 |
| 데스크톱(Tauri 2 + 엔진 사이드카) | stdio | JSON Lines(UTF-8, 메시지 하나당 한 줄, `\n` 구분) | M1(계약), 구현은 L4 plan |
| 서비스(`xeon service`) | socket | Unix 도메인 소켓 위 JSON Lines | M2 이후 |

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
  onNotification<N extends ServerNotificationName>(name: N, handler: (params: ServerNotificationParams<N>) => void): Unsubscribe;
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

- [제안] `HostConnection`과 처리기 표는 전송 종류에 따라 바뀌지 않는다. 전송 적합성 스위트(§9 수용 기준 A10)가 in-process와 stdio에서 같은 케이스를 돌려 이를 확인한다.
- [제안] in-process 전송도 envelope 검사, 메서드 이름 검사, params 검사를 똑같이 한다. 직렬화만 건너뛴다. 개발 빌드는 JSON 왕복(`JSON.parse(JSON.stringify(m))`) 검사를 켤 수 있다. 그래야 in-process에서만 통과하는 비직렬화 값(함수, `undefined`, `Date`, `bigint`)이 생기지 않는다.
- 클라이언트 쪽 `request`의 id 발급은 연결마다 `r1`, `r2`, …를 쓴다(19 §3.3.1과 같다).

### 3.2 JSON-RPC 2.0 규칙

19 §3.3.1을 이식한다. 달라진 점과 그대로인 점을 한 표에 둔다.

| 규칙 | 19 §3.3.1 | Xeon | 표지 |
|---|---|---|---|
| `jsonrpc: "2.0"` 필수 | 같음 | 같음 | [제안] |
| 배치(배열 메시지) | 거부, `-32600` 하나(`id: null`) | 같음. 받으면 `-32600` 하나(`id: null`)를 보내고 연결은 유지한다 | [제안] |
| `id` | 문자열 1~64자 `[A-Za-z0-9._:-]`, 숫자·`null`은 `-32600` | 같음 | [제안] |
| 진행 중 `id` 재사용 | `-32600` | 같음 | [제안] |
| `params` | 항상 객체. 배열은 `-32602`. 없으면 `{}` | 같음 | [제안] |
| `result` | 항상 객체 | 같음. 결과가 없으면 `{}` | [제안] |
| 메서드 이름 | `<영역>.<동사>` 소문자 낙타, `$/` 제어 예약 | 같음. 확장 메서드는 `ext.<확장id>.<동사>`(M2 이후, §4.2) | [제안] |
| 알림 이름 | 메서드와 같은 규칙. 예외로 `events` | 예외 없이 같은 규칙. 내구 이벤트 알림은 `events.batch` | [제안] |
| 서버 → 클라이언트 요청 | 보내지 않음 | 보내지 않는다. 승인은 내구 이벤트 + 응답 메서드(§4.6) | [결정: review.decisions-2 U-02] |
| 클라이언트 → 서버 알림 | `$/cancelRequest`, `presence.report` | `$/cancelRequest` 하나 | [제안] |
| 값 규칙 | strict JSON, 안전 정수, 시각은 ISO 8601 UTC 문자열 | 같음 | [제안] |
| 깊이·길이 한도 | 깊이 64, 배열 10,000 | 같음. 그 위에 프레임 1 MiB(omp RPC v2와 같은 값, `_research/item-catalog.md` F절) | [제안] |
| envelope 검사 | `additionalProperties: false` | 같음 | [제안] |
| 핸드셰이크 | `hello` + 기기 토큰·챌린지 인증 | `host.hello` 하나. 인증 없음(in-process, stdio는 부모-자식이라 인증이 필요 없다). 서비스 소켓 인증은 미결 | [미결] |
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
| host | `host.status` | `{}` | `{ mode: "in-process"\|"stdio"\|"service", pid: integer, startedAt: IsoTime, connections: integer, liveTurns: integer, idleShutdownAt: IsoTime \| null }` | M2 |
| host | `host.shutdown` | `{ reason: "client_exit"\|"version_replace"\|"user", deadlineMs?: integer }` | `{ accepted: boolean }` | M2 |
| thread | `thread.list` | `{ cursor?: string, limit?: integer(1..200), workspace?: string }` | `{ threads: ThreadSummary[], nextCursor: string \| null }` | M2 |
| thread | `thread.create` | `{ workspace?: string, title?: string }` | `{ threadId: ThreadId, position: StreamPosition }` | M1 |
| thread | `thread.open` | `{ threadId: ThreadId, mode: "write"\|"observe" }` | `{ threadId: ThreadId, role: "owner"\|"observer", position: StreamPosition }` | M2 |
| thread | `thread.read` | `{ threadId: ThreadId, limit?: integer(1..500), before?: ItemId }` | `{ threadId: ThreadId, items: ItemRecord[], position: StreamPosition, hasMore: boolean }` | M2 |
| thread | `thread.close` | `{ threadId: ThreadId }` | `{}` | M2 |
| thread | `thread.delete` | `{ threadId: ThreadId }` | `{}` | M2 |
| thread | `thread.fork` | `{ threadId: ThreadId, at?: ItemId }` | `{ threadId: ThreadId, position: StreamPosition }` | M2 |
| thread | `thread.revert` | `{ threadId: ThreadId, to: ItemId }` | `{ position: StreamPosition }` | M2 |
| turn | `turn.start` | `{ threadId: ThreadId, input: TurnStartInput, requestId?: string(1..64) }` | `{ turnId: TurnId }` | M1 |
| turn | `turn.interrupt` | `{ threadId: ThreadId, turnId?: TurnId }` | `{ interrupted: boolean }` | M2 |
| events | `events.subscribe` | `{ from: StreamPosition \| "head", filter?: EventFilter }` | `{ sub: SubId, start: Seq, headSeq: Seq, storeId: StoreId, mode: "replaying"\|"live" }` | M1 |
| events | `events.unsubscribe` | `{ sub: SubId }` | `{}` | M2 |
| approval | `approval.respond` | `{ approvalId: string, decision: "allow"\|"deny"\|"answer", answer?: unknown, remember?: "once"\|"thread"\|"always" }` | `{ applied: boolean }` | M2 |
| approval | `approval.list` | `{ threadId: ThreadId }` | `{ approvals: PendingApproval[], position: StreamPosition }` | M2 |
| settings | `settings.get` | `{ keys?: SettingKey[], threadId?: ThreadId }` | `{ settings: EffectiveSetting[] }` | M1 |
| settings | `settings.set` | `{ key: SettingKey, value: unknown, scope: SettingScope, threadId?: ThreadId }` | `{ setting: EffectiveSetting }` | M2 |
| settings | `settings.reset` | `{ key: SettingKey, scope: SettingScope, threadId?: ThreadId }` | `{ setting: EffectiveSetting }` | M2 |
| settings | `settings.list` | `{ prefix?: string, includeDeprecated?: boolean }` | `{ defs: SettingDefWire[] }` | M2 |
| secret | `secret.list` | `{ meta?: boolean, usage?: boolean }` | `{ secrets: SecretListEntry[] }` | M2 |
| secret | `secret.meta` | `{ name: SecretName, …메타·정책 필드 }` | `{ secret: SecretListEntry }` | M2 |
| secret | `secret.remove` | `{ name: SecretName }` | `{ removed: boolean }` | M2 |
| secret | `secret.test` | `{ name: SecretName }` | `{ state: "registered"\|"missing" }` | M2 |
| secret | `secret.beginEntry` | `{ name: SecretName, action: "add"\|"set"\|"rotate" }` | `{ started: boolean }` | M2 |
| secret | `secret.beginReveal` | `{ name: SecretName }` | `{ started: boolean }` | M2 |

- [제안] M1 범위는 브리프의 최소 셋(`turn.start`, `events.subscribe`, `settings.get`)에 선행 조건 둘(`host.hello`, `thread.create`)을 더한다. 대화를 시작하려면 thread가 있어야 하고, 모든 연결은 hello로 시작하기 때문이다.
- [제안] `thread.open`을 추가했다. `_research/process.md` §6.3의 세션 단위 쓰기 소유 규칙을 계약에 드러내기 위해서다. 소유 잠금을 얻지 못하면 `thread.locked`(§3.5.2) 오류에 대안(관찰, 분기, 위임)을 싣는다. in-process 단일 클라이언트인 M1에서는 `thread.create`가 소유를 함께 얻는다.
- [결정: m2 F.2] `thread.read`는 열린 thread의 스냅샷을 돌려주는 읽기 전용 메서드다(L4.desktop 상태 설계 §14 1번). `thread.open` 결과에 items를 싣지 않고 새 메서드를 둔 이유는 셋이다. 첫째, `thread.open`은 쓰기 소유 획득이라는 부작용이 있어서 소유 없이 관찰하는 thread나 재동기화 때마다 부르기에 맞지 않다. 둘째, 스냅샷은 재설정과 재구독마다 다시 읽는데 `thread.open`은 열 때 한 번 부르는 메서드다. 셋째, 긴 thread는 앞부분을 나눠 받아야 해서 `limit`과 `before`가 필요하다. `thread.read`는 소유를 얻지 않고 닫힌 thread도 읽는다. `items`는 현재 가지의 내구 `ItemRecord`를 오래된 것부터 담고, `position`은 그 items가 반영한 저장소 위치다. 이어 붙이는 규칙은 §3.4.6이다.
- [결정: m2 F.2] `approval.list`는 thread의 대기 승인을 돌려준다(L4.desktop 상태 설계 §14 2번, 13번). 대기는 `approval.requested`가 있고 `approval.resolved`가 없는 것이다. `PendingApproval`은 `{ approvalId: EventId, seq: Seq, request: ApprovalRequestedPayload }`이고 `request`는 `approval.requested` 이벤트 payload 그대로다. `approvalId`와 `seq`는 그 이벤트의 envelope `id`와 `seq`이며, 이벤트를 기록한 thread는 `request.surfaceThreadId`다. 목록은 `seq` 오름차순이고 한 thread에 1,000개를 넘지 않는다. 없는 thread는 `thread.notFound`(3001)다. 클라이언트가 목록을 받을 곳은 재설정이나 재동기화 뒤다. 평소에는 `approval.requested`와 `approval.resolved` 이벤트가 같은 일을 한다(§4.6).
- [제안] `turn.start`의 암묵 획득: 이 프로세스가 그 thread의 쓰기 소유를 쥐고 있지 않으면 `turn.start`가 획득을 한 번 시도한다. 실패하면 `thread.locked`(3002)를 돌려준다(`L4.host-service.spec` HS-28). `thread.open`은 관찰이나 분기 선택이 필요할 때 쓰는 명시 경로다.
- [제안] `host.shutdown`은 협조 종료 요청이다. 응답은 참여자 처리가 끝난 뒤 보낸다(`L0.process.spec` FR-P1). 데스크톱 셸이 SIGKILL만 보낼 수 있어서 전송 메시지가 공통 경로다. 이 메서드를 모르는 엔진(-32601)에는 stdin 닫기(EOF)가 같은 종료를 일으킨다(`L4.desktop.spec` §4.3).
- [제안] `secret.*` 여섯 메서드는 값 필드가 없다. 값 입력과 열람은 호스트 쪽 L0.secrets가 OS 입력 창이나 wire 밖 전달로 받는다(`L0.secrets.spec` §8.3 R4, `L4.readme` §8.1). `SecretName`은 `F.capabilities.spec` §3.10이다. `SecretListEntry`의 필드는 [가정] `L0.secrets.spec`의 값 없는 메타 모양을 따르고 M2 착수 때 정한다.
- [결정: m2-plan F.5] `secret.beginReveal { name }`을 M2 메서드로 받았다(`L4.cli.spec` §4.7, review.decisions-2 U-20). 결과 `started`가 거짓이면 호스트가 열람을 시작하지 못한 것이다(맡긴 열람 수단이 없거나 사람 확인이 끝나지 않음). 값은 요청·응답·이벤트·오류 `details` 어디에도 없다.
- [결정: m2-plan F.5] in-process 접속의 wire 밖 값 전달은 `@xeon/contracts/services`의 `SecretOutOfBandPort`다(`services/secret-admin.ts`). CLI가 값 입력 수단(`SecretEntryOffer`)이나 열람 수단(`SecretRevealOffer`)을 이 포트에 맡긴 뒤 `secret.beginEntry`나 `secret.beginReveal`을 보내면, 호스트 처리기가 같은 이름의 맡긴 수단 하나를 꺼내 `SecretAdminService`에 넘긴다. 맡긴 수단은 한 번 쓰이면 비워진다. 서비스 접속에는 이 포트가 없다. 구현은 `@xeon/host`다.
- [제안] `turn.start`의 `requestId`는 같은 연결 재시도의 중복 제출을 막는 멱등 키다. 같은 thread에서 같은 키가 오면 처음 발급한 `turnId`를 돌려준다. 의미 정본은 `F.conversation.spec` §3.5의 `requestId`다(`TurnStartedPayload.requestId`, 사용자 `ItemRecord.requestId`). 브랜드 없는 문자열이다.
- [결정: m2-plan F.6] `ThreadSummary`는 `thread.list`의 결과 원소다(`wire/methods.ts` `ThreadSummarySchema`, §10 미결 9). 필드는 `L1.persistence.spec` §3.4 `ThreadSummaryRow`를 따르고 시각은 IsoTime 문자열이다.

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

#### 3.3.2 알림 표

| 방향 | 알림 | params | 단계 |
|---|---|---|---|
| 서버 → 클라이언트 | `events.batch` | `{ sub: SubId, from: Seq, to: Seq, events: EventWire[], caughtUp: boolean }` | M1 |
| 서버 → 클라이언트 | `events.ended` | `{ sub: SubId, reason: "replayFailed" }`. 서버가 구독을 끝냈다. 재전송 읽기가 실패해 구독을 지웠을 때 보낸다. 클라이언트는 같은 필터로 다시 구독하거나 오류로 처리한다 | M1 |
| 서버 → 클라이언트 | `stream.chunk` | `{ event: VolatileEventWire }` (`n`, `afterSeq`를 담은 휘발 이벤트) | M1 |
| 클라이언트 → 서버 | `$/cancelRequest` | `{ id: RpcId }` | M1 |
| 클라이언트 → 서버 | `$/connectionReset` | `{}`. 클라이언트 화면이 다시 시작되어 이전 구독을 버린다(WebView 새로고침, `L4.desktop.spec` §10-2) | M2 |

[제안] 19의 `events` 알림은 이름 규칙의 예외였다. Xeon은 예외를 두지 않으려고 `events.batch`로 바꾼다. 브리프와 19가 말하는 "`events` 알림"은 이 `events.batch`다.

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
  "turn.start":        { params: TurnStartParams;        result: TurnStartResult };
  "turn.interrupt":    { params: TurnInterruptParams;    result: TurnInterruptResult };
  "events.subscribe":  { params: EventsSubscribeParams;  result: EventsSubscribeResult };
  "events.unsubscribe":{ params: EventsUnsubscribeParams;result: EmptyResult };
  "approval.respond":  { params: ApprovalRespondParams;  result: ApprovalRespondResult };
  "approval.list":     { params: ApprovalListParams;     result: ApprovalListResult };
  "settings.get":      { params: SettingsGetParams;      result: SettingsGetResult };
  "settings.set":      { params: SettingsSetParams;      result: SettingsSetResult };
  "settings.reset":    { params: SettingsResetParams;    result: SettingsSetResult };
  "settings.list":     { params: SettingsListParams;     result: SettingsListResult };
  "host.shutdown":     { params: HostShutdownParams;     result: HostShutdownResult };
  "secret.list":       { params: SecretListParams;       result: SecretListResult };
  "secret.meta":       { params: SecretMetaParams;       result: SecretMetaResult };
  "secret.remove":     { params: SecretNameParams;       result: SecretRemoveResult };
  "secret.test":       { params: SecretNameParams;       result: SecretTestResult };
  "secret.beginEntry": { params: SecretBeginEntryParams; result: SecretBeginEntryResult };
}
export type WireMethodName = keyof WireMethodMap;
export type WireParams<M extends WireMethodName> = WireMethodMap[M]["params"];
export type WireResult<M extends WireMethodName> = WireMethodMap[M]["result"];

export interface ServerNotificationMap {
  "events.batch": EventsBatchParams;
  "events.ended": EventsEndedParams;
  "stream.chunk": StreamChunkParams;
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
  readonly stage: "M1" | "M2";
}
export declare const WIRE_METHODS: { readonly [M in WireMethodName]: WireMethodSpec };
export declare const WIRE_NOTIFICATIONS: { readonly [N in ServerNotificationName]: { readonly params: TSchema; readonly since: SemVer } };
```

- 각 `XxxParams`, `XxxResult` 타입은 같은 이름의 스키마 상수에서 `Static`으로 만든다. 그래서 `WireMethodMap`의 타입과 `WIRE_METHODS`의 스키마는 같은 원천을 갖는다.
- [제안] 문서 §3.3.1 표와 `WIRE_METHODS`의 키·단계가 일치하는지 검사한다(plan의 완료 기준).

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
- `seq`는 내구 이벤트만 받고 DB 전체에서 단조 증가한다(`F.records.spec` §4.1). 세션 저장 C안은 단일 DB이므로 저장소 하나에 seq 수열이 하나다([결정] `_research/decisions-log.md` 2026-10-21 2차).
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
- `replay.outOfRange`를 받은 클라이언트의 복구 절차는 19 §3.5.5의 1·2단계(위치 버림, `from: "head"`로 재구독)만 이식한다. 뷰 스냅샷(`view.get`)은 Xeon 계약에 없다. [결정: m2 F.2] thread 상태 재조회는 `thread.read`가, 대기 승인 재조회는 `approval.list`가 맡는다(§3.4.6).

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
| `redactions` | 없음(`F.records.spec` §3.1.1이 wire로 이관) | 2차 방어로 가린 payload 필드 이름. 1차 방어는 "payload에 비밀 값을 넣지 않는다"는 기록 규칙이다 |
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
4. 스냅샷의 범위: `items`는 커밋된 `ItemRecord`만 담는다. 스트리밍 중인 item(`item.started` 이후 아직 `item.recorded`가 없는 것)은 휘발 사실이라 스냅샷에 없다. 그 item의 조각은 §3.4.4대로 다시 보내지 않고, 완성본은 `item.recorded`로 온다. 되감기(`thread.revert`)로 현재 가지가 바뀌면 클라이언트는 `thread.read`를 처음부터 다시 읽는다.
5. 대기 승인: `approval.list`는 재설정이나 재동기화 뒤 승인 대기열을 다시 만드는 데 쓴다. 이어 붙이기는 `thread.read`와 같다. 목록에 반영된 `approval.requested`가 재전송으로 다시 와도 `seq <= position.seq`라 적용하지 않으므로, 이미 해결된 요청이 대기열에 되살아나지 않는다. 승인이 대기 중인 thread는 `ThreadSummary.pendingApprovals`가 0보다 큰 thread이므로 클라이언트는 그 thread에만 요청한다.
6. "비어 있음"과 "읽는 중"의 구분: F는 `events.subscribe` 응답이나 `ThreadSummary`에 별도 신호를 더하지 않는다(L4.desktop 상태 설계 §14 12번). `thread.list`, `thread.read`, `approval.list`는 모두 요청과 응답이고, 응답이 곧 "읽기를 마쳤다"는 신호이기 때문이다. 클라이언트는 요청을 보낼 때 `loading`, 성공 응답을 적용할 때 `ready`(빈 목록이어도), 오류 응답을 받을 때 `failed`로 둔다. 목록 읽기는 JSON-RPC 오류로 실패하므로 실패와 빈 결과도 구분된다. `events.subscribe` 응답에 "비어 있음" 표시를 두지 않는 이유는, 구독은 이벤트만 책임지고 thread 목록과 스냅샷은 필터와 페이지가 있는 별도 읽기라서 호스트가 응답 시점에 비어 있음을 판정할 수 없기 때문이다. `thread.list` 목록은 모든 페이지(`nextCursor`가 `null`일 때까지)를 받은 뒤 `ready`다.
7. [제안] `thread.list`에는 `position`을 더하지 않는다. 목록 원소의 `ThreadSummary.headSeq`가 그 thread의 마지막 seq이므로, 클라이언트는 같은 thread의 이벤트 중 `seq <= headSeq`인 것을 목록에 다시 적용하지 않는 것으로 이어 붙인다.

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
| 1004 | `host.authFailed` | false | `host.hello`의 `auth.token`이 없거나 맞지 않다. 응답 뒤 연결을 닫는다(M2) | - |
| 2001 | `replay.outOfRange` | false | 그 위치에서 재전송할 수 없다 | `reason`, `storeId`, `headSeq`, `oldestReplayableSeq` |
| 2002 | `events.subscriptionNotFound` | false | 없는 구독 ID | `sub` |
| 2003 | `events.subscriptionLimit` | false | 연결당 구독 한도 초과 | `max` |
| 2004 | `events.filterInvalid` | false | 필터가 잘못되었다 | `issue` |
| 3001 | `thread.notFound` | false | 없는 thread | `threadId` |
| 3002 | `thread.locked` | true | 다른 프로세스가 쓰기 소유 중이다. `thread.open(mode write)`와 `turn.start`의 암묵 획득(§3.3.1)에서 난다 | `ownerKind`, `options: ("observe"\|"fork"\|"delegate")[]` |
| 3003 | `turn.busy` | true | 진행 중 turn이 있어 새 turn을 받을 수 없다 | `turnId` |
| 3004 | `thread.hasForks` | false | 이 thread를 `forkedFrom`으로 가리키는 thread가 있어 `thread.delete`를 거절했다 | `forks: ThreadId[]` |
| 3005 | `thread.invalidTarget` | false | `thread.fork`·`thread.revert`의 대상이 맞지 않는다. `thread.read`의 `before`가 이 thread에 없거나(`item_not_found`) 현재 가지에 없을 때(`not_on_branch`)도 이 오류다 | `reason: "item_not_found"\|"not_on_branch"\|"inside_turn"\|"open_tool_calls"` |
| 3006 | `thread.cancelledByExtension` | false | 확장이 thread 전환·분기·되감기를 막았다 | `point: "session_before_fork"\|"session_before_tree"\|"session_before_switch"`, `reason: string \| null` |
| 3101 | `settings.unknownKey` | false | 등록되지 않은 키 | `key` |
| 3102 | `settings.invalidValue` | false | 값이 스키마나 range에 맞지 않는다 | `key`, `issues` |
| 3103 | `settings.scopeNotAllowed` | false | 그 범위에 쓸 수 없는 키 | `key`, `scope`, `allowedScopes` |
| 3104 | `settings.locked` | false | 관리 범위가 잠근 키 | `key`, `lockedBy: "managed"` |
| 3105 | `settings.secretValue` | false | 비밀 키에 참조가 아닌 값을 넣었다 | `key` |
| 5001 | `request.cancelled` | false | `$/cancelRequest`로 취소했다 | - |
| 5002 | `host.shuttingDown` | true | 호스트가 종료 중이다 | `retryAfterMs` |
| 5003 | `store.busy` | true | 저장소 쓰기 잠금 대기가 시간을 넘었다. 같은 요청을 다시 보내도 된다 | - |
| 5004 | `store.diskFull` | false | 저장 매체가 가득 찼다. 공간을 비운 뒤 다시 보낸다 | - |
| 5005 | `store.readOnly` | false | 저장소가 읽기 전용으로 열려 있어 쓸 수 없다 | `reason` |
| 5006 | `store.io` | false | 저장 매체 입출력 실패. 코드는 OS나 SQLite가 준 값이다 | `code` |

#### 3.5.3 오류 코드 구간 [제안]

| 구간 | 소유 | 용도 |
|---|---|---|
| -32768 ~ -32000 | JSON-RPC 예약 | 표준 다섯 개만 쓴다 |
| 1000 ~ 1999 | F wire | 연결, 핸드셰이크, 버전 |
| 2000 ~ 2999 | F wire | 이벤트, 구독, 재전송 |
| 3000 ~ 3999 | 코어(L1) 메서드 | thread, turn, approval(3000~3099), settings(3100~3199), 나머지 L1 예비 |
| 4000 ~ 4999 | 능력(L2) | 능력 오류는 code 4000 하나로 싣는다. `kind`는 `cap.<CapabilityId>.<code>`, `details`는 `CapabilityErrorData`(`F.capabilities.spec` §3.6)다. 능력의 오류 코드는 문자열이라 숫자 블록을 배정하지 않는다. 4001~4999는 예비 |
| 5000 ~ 5999 | 호스트(L4) | 호스트 상태, 취소, 서비스 모드 |
| 10000 ~ 19999 | 확장(X 이후, 외부 확장) | 확장은 이 구간 안에서 자유롭게 쓰고 `kind`를 `ext.<확장id>.`로 시작한다. 코드가 겹치면 `kind`로 구분한다 |

- [제안] 클라이언트는 분기 판단에 `code`보다 `kind`를 쓴다. 확장 구간은 코드가 겹칠 수 있기 때문이다.
- [결정: m2-plan F.5] 구간 표는 코드 상수 `WIRE_CODE_RANGES`(`wire/errors.ts`)다. 순수 함수 `codeRangeOf(code)`는 코드가 속한 구간을 돌려주고, 어느 구간에도 속하지 않는 코드(0~999, 6000~9999, 20000 이상, 정수가 아닌 값)는 `null`이다. `wireErrorCodeMatchesKind(code, kind)`는 능력 구간의 `cap.`, 확장 구간의 `ext.` 접두를 `kind`가 지키는지 검사한다. 능력 오류 코드 4000은 `WIRE_CAPABILITY_ERROR_CODE`다. 등록된 `WIRE_ERRORS`의 모든 코드는 시험이 이 두 함수로 확인한다.
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
- [결정: m2-plan F.5] W3C Trace Context 세 키 말고는 `<네임스페이스>/<이름>` 형태만 허용한다(예: `xeon/clientTime`). 스키마는 `patternProperties`로 이 키를 받고 값은 검사하지 않는다. 네임스페이스 없는 새 키는 이 문서에서만 더한다.
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
| 버전 대상 | 호스트 계약(wire)과 설정 정의 형식(settings)이 하나의 계약 버전 `WIRE_PROTOCOL_VERSION`을 공유한다 | [제안] |
| semver | 메서드·알림·필드 제거, 의미 변경, 필수 필드 추가는 주 버전. 메서드·선택 필드·오류 kind 추가는 부 버전. 문서·스키마 설명 수정은 수 버전 | [제안] |
| 0.x 기간 | 1.0 전에는 부 버전 변경도 호환을 깰 수 있다. `isCompatible`은 부 버전까지 비교한다 | [제안] |
| 상태 | `experimental` → `active` → `deprecated` → `removed`. `experimental`은 `active`를 거치지 않고 바로 제거할 수 있다 | [제안] |
| 폐기 기간 | `deprecated`가 된 날부터 12개월 뒤 또는 다음 주 버전 중 늦은 쪽에 `removed`가 될 수 있다. MCP 12개월 폐기 창을 참고했다(`_research/item-catalog.md` F절) | [미결] |
| 실험 opt-in | `experimental` 기능은 `host.hello`의 `experimental` 목록에 이름을 넣은 연결에만 열린다. opt-in 없이 부르면 `-32601` | [제안] |
| 능력 탐지 | 클라이언트는 `host.hello` 결과의 `features`로 기능 유무와 상태를 확인한다. 별도 프로브 메서드는 두지 않는다 | [제안] |
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
  Type.Literal("local"), Type.Literal("session"),
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
  - [제안] 확장 접두는 `ext.`다. `F.records.spec`의 이벤트 kind는 확장에 `x.`, 의도 그룹에 `grp.`를 쓰지만, 설정 키에서 `x.`는 X 층 코어 키(`x.loading-trust.…`)와 겹친다. 그래서 설정 키와 wire 확장 메서드는 확장과 외부 의도 그룹 모두 `ext.<id>.`를 쓴다. 대응은 `x.<id>.…`(kind) ↔ `ext.<id>.…`(설정·메서드)다.
  - 이름 부분은 소문자 낙타 표기이고 점으로 더 나눌 수 있다. 예: `l1.models.routing.review`.
- 키 접두와 `layer` 필드는 일치해야 한다(`l1.` ↔ `"L1"`). 확장 키의 `layer`는 그 확장 매니페스트가 선언한 층이다.
- `SettingLayer`에 L4를 포함한다. [제안] 테마, 키 바인딩 같은 표시 설정(`_research/settings.md` §2.13 "층 밖 항목")의 소유자가 L4이기 때문이다. 브리프의 "F..L3"보다 범위를 넓혔다.
- [결정] 비밀 참조 형식은 `secret://<name>`이다(`_research/secrets.md` §6.1, `_research/decisions-log.md` 2026-10-21 2차 "에이전트는 값을 모른 채 참조로 사용").

#### 3.8.2 SettingDef

```ts
// settings/def.ts
export const SettingsTab = Type.Union([
  Type.Literal("overview"), Type.Literal("models"), Type.Literal("budgets"), Type.Literal("providers"),
  Type.Literal("secrets"), Type.Literal("permissions"), Type.Literal("sessions"), Type.Literal("tools"),
  Type.Literal("plugins"), Type.Literal("execution"), Type.Literal("appearance"), Type.Literal("advanced"),
]);
export const SettingWidget = Type.Union([
  Type.Literal("toggle"), Type.Literal("select"), Type.Literal("number"), Type.Literal("text"),
  Type.Literal("list"), Type.Literal("table"), Type.Literal("secret"), Type.Literal("readonly"),
]);
export const SettingUi = Obj({
  tab: SettingsTab,
  widget: SettingWidget,
  order: Type.Integer({ minimum: 0, maximum: 9999 }),
  label: Type.String({ minLength: 1, maxLength: 80 }),
  help: Type.Optional(Type.String({ maxLength: 500 })),
  unit: Type.Optional(Type.String({ maxLength: 16 })),
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
}

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
});
```

`SettingDef` 검사 규칙(`checkSettingDef`, 순수 함수). 하나라도 어기면 정의를 거부한다.

| # | 규칙 | 근거 |
|---|---|---|
| D1 | `key`가 `SETTING_KEY_PATTERN`에 맞고 접두가 `layer`와 맞는다 | §3.8.1 |
| D2 | `secret: true`이면 `default`가 없어야 한다 | 비밀 값이 코드·스키마 출력에 남지 않게 한다 |
| D3 | `secret: true`이면 `type`은 `SecretRef`와 같은 문자열 스키마이고 `ui.widget`은 `"secret"`이다 | 값 대신 참조만 저장한다 |
| D4 | `default`가 있으면 `type`과 `range`를 통과한다 | 기본값이 스스로 무효가 되지 않게 한다 |
| D5 | `range.min ≤ range.max`. `range.min`·`max`는 `type`이 number·integer일 때만, `range.enum`은 string·number일 때만 쓴다 | |
| D6 | `type`에 `minimum`·`maximum`·`enum`을 직접 두면서 `range`도 두면 거부한다 | 같은 제약을 두 곳에 적지 않는다. [제안] UI가 읽을 수 있게 제약은 `range`에 둔다 |
| D7 | `allowedScopes`에 중복이 없다. `runtimeChange: "restart"`이면 `session`을 넣을 수 없다 | 재시작이 필요한 값은 세션 한정으로 바꿀 수 없다 |
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
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: { tab: "budgets", widget: "number", order: 10, label: "턴당 최대 단계", help: "0이면 상한 없음", unit: "단계" },
    since: "0.1.0",
  },
});
```

확장이 키를 더하는 규칙 [제안]:

1. 확장은 `ExtensionManifest.userConfig`(`F.extensions.spec` §3.1)에 설정을 선언한다. 로더(X)가 `settingsFromManifest`로 `SettingDef`를 만들고 `buildCatalog`에 넣는다. 확장 코드가 `defineSettings`를 직접 불러도 되지만 네임스페이스는 `ext.<자기 이름>`만 쓸 수 있다.
   - 대응 [제안]: userConfig 키 `apiKey` → 설정 키 `ext.<name>.apiKey`, `title` → `ui.label`, `description` → `ui.help`, `sensitive: true` → `secret: true`(값은 `secret://` 참조), `required` → 값이 없으면 확장 시작 때 진단. `ui.tab`은 `"plugins"`로 고정한다. `layer`는 매니페스트 `layer`(`"plugin"`이면 `"L2"`로 본다 [가정]).
   - 현재 `UserConfigEntrySchema`에는 값 스키마가 없고 `setting` 필드(형식 `ext.<name>.<key>`)가 설정 키를 가리킨다. JSON 매니페스트만 있는 외부 확장도 값 검사를 받으려면 항목에 `type`(JSON Schema), `default`, `range`, `runtimeChange`, `allowedScopes`가 있어야 한다. [제안] `F.extensions.spec`에 이 필드 추가를 요청하고, `setting` 필드는 위 대응 규칙으로 유도되므로 생략하거나 `ext.<name>.<key>`와 같아야 하는 검사용 값으로 둔다. 키 접두는 `ext.`로 맞췄다(`F.extensions.spec` §3.1 `UserConfigEntry.setting`, §6). 값 스키마 필드 추가 여부는 §10 미결 8로 남긴다.
   - 확장 공통 키 [제안]: `ext.<name>.enabled`, `ext.<name>.isolation`(`F.extensions.spec` §6)은 예약하고 X 로더가 정의한다(소유 문서 `X.loading-trust.spec`). 켜기 키는 플러그인과 L3 그룹(내장 Helm·학습 그룹 포함) 모두 `ext.<name>.enabled` 하나이고, 범위와 적용 시점은 X 정의(`managed`~`session`, `live`)를 따른다 [결정: review.decisions-2 K-04]. userConfig는 이 이름을 쓸 수 없다. drive 임대 상한은 X 층 키 `x.primitives.driveLimits`다(소유 문서 `X.primitives.spec`, `F.extensions.spec` §6). 예전 제안 키 `extensions.<name>.*`, `groups.drive.limits`는 키 문법(§3.8.1)에 맞지 않아 쓰지 않는다.
2. 확장은 코어 네임스페이스(`f.`~`l4.`)와 다른 확장의 `ext.<id>.`에 키를 더할 수 없다. 어기면 `foreignNamespace`로 그 확장의 설정 전체를 거부한다. 확장 로딩 자체를 막을지는 `X.loading-trust.spec`이 정한다.
3. L3 기본 그룹(Helm, 학습 그룹)은 내장 패키지이므로 자기 설정에 코어 네임스페이스 `l3.helm.`, `l3.learning.`을 쓴다. 켜기 키만은 예외로 `ext.helm.enabled`, `ext.learning.enabled`를 쓴다(1번의 확장 공통 키). 외부 의도 그룹은 확장이므로 `ext.<id>.`를 쓴다.
4. 확장이 제거되면 그 키는 카탈로그에서 빠진다. 파일에 남은 값은 "모르는 키"로 보존하고 적용하지 않는다(§4.8).

### 3.9 설정 계층과 유효 값

```ts
// settings/layers.ts
/** 높은 우선순위가 앞이다. */
export const SCOPE_PRECEDENCE = ["managed", "session", "local", "project", "user"] as const;   // 코드에서는 명시 주석

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

### 4.2 메서드 이름과 확장 메서드

- 코어 메서드는 이 문서의 표에 있는 것만 있다. 새 메서드는 이 문서를 고쳐서 더한다.
- [제안] 확장이 wire 메서드를 더하는 것은 M2 이후에 연다. 이름은 `ext.<확장id>.<동사>`이고 params·result 스키마를 매니페스트에 선언한다. 그 전까지 확장은 내구 이벤트(F.records의 확장 접두 이벤트)로만 클라이언트에 정보를 보낸다.

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

- `_research/layer-plan-v2.json` F5 "설정 계층": "관리, 사용자, 프로젝트, 로컬, 세션 순서로 덮어씁니다. 관리 잠금을 표시합니다." 나열 순서대로 뒤가 앞을 덮어쓴다고 읽으면 세션이 최상위이고 관리가 최하위다.
- `_research/settings.md` §2.1, `_research/item-catalog.md` F절: Claude Code는 관리 > `--settings`(플래그) > local > project > user이고 관리 설정이 최상위다.

두 서술은 "관리 잠금"을 함께 놓고 보면 하나로 맞출 수 있다. 관리를 뺀 나머지는 layer-plan의 덮어쓰기 순서(사용자 → 프로젝트 → 로컬 → 세션)를 따르고, 관리는 잠금으로서 맨 위에 둔다. 세션은 Claude Code의 플래그 자리에 해당한다.

| 순위(높음 → 낮음) | 범위 | 저장 위치 [가정: 경로는 L0.os·L4가 정한다] | 쓰는 쪽 | 잠금 |
|---|---|---|---|---|
| 1 | `managed` | OS별 관리 정책 파일 | 관리자(사용자 앱에서는 읽기 전용) | 이 범위가 정한 키는 잠긴다 |
| 2 | `session` | 저장하지 않음 또는 thread 기록. CLI 플래그, "이번만 적용" | 사용자, CLI 플래그 | - |
| 3 | `local` | 프로젝트의 개인 파일(버전 관리 제외) | 사용자 | - |
| 4 | `project` | 프로젝트 공유 파일(버전 관리 대상) | 사용자, 팀 | - |
| 5 | `user` | 사용자 홈의 설정 파일 | 사용자 | - |
| 6 | `default` | `SettingDef.default` | 코드 | - |

규칙:

1. 유효 값은 순위가 가장 높은, 그 키를 정한 범위의 값이다. 값을 정하지 않은 범위는 건너뛴다.
2. 값의 병합 단위는 키 하나다. 값이 객체나 배열이어도 깊은 병합을 하지 않고 통째로 바꾼다 [제안]. 깊은 병합은 출처 표시를 흐리게 하기 때문이다. 목록을 더해야 하는 키는 그 층 spec이 별도 키(예: `...additional`)로 정의한다.
3. `managed`가 정한 키는 `locked: true`다. 다른 범위의 쓰기는 `settings.locked`(3104)로 거부한다. 다른 범위 파일에 남은 값은 `shadowed`로 보인다.
4. 키의 `allowedScopes`에 없는 범위에 있는 값은 무시하고 경고를 남긴다(§4.8). 쓰기는 `settings.scopeNotAllowed`(3103)로 거부한다. 예: pi `defaultProjectTrust`처럼 사용자 파일 전용인 키는 `allowedScopes: ["managed", "user"]`다(`_research/settings.md` §2.1 "범위 제한 키"). 이런 키를 프로젝트 파일에 적어도 적용하지 않는다. 저장소를 받는 것만으로 신뢰 설정이 바뀌지 않게 하기 위해서다.
5. 잠금 표시 규칙: L4 화면은 `locked: true`인 항목에 잠금 배지와 출처 경로를 보이고 편집을 막는다. `shadowed`가 비어 있지 않으면 "다른 범위의 값이 가려짐"을 보인다. CLI `config get`은 같은 정보를 `source`와 함께 출력한다.
6. `runtimeChange`: `live`는 즉시, `nextTurn`은 다음 turn 시작 때, `restart`는 호스트 재시작 때 적용한다. 적용 전까지 `pendingUntil`에 그 시점을 둔다.

[미결] 이 우선순위 표는 작성자 제안이다. 관리 범위가 "잠금"만 하는지, 사용자가 덮어쓸 수 있는 "관리 기본값"도 둘지(Codex `requirements.toml`과 관리 설정의 구분) 사용자 확인이 필요하다.

### 4.8 파일 값의 검사와 보존

- 설정 파일을 읽을 때 각 값은 `validateSettingValue`로 검사한다. 실패한 값은 그 범위에서 없는 것으로 치고 다음 순위로 넘어간다. 실패는 진단으로 남기고 시작을 막지 않는다.
- 카탈로그에 없는 키(제거된 확장, 오타)는 파일에서 지우지 않고 보존한다. 화면과 `config list`는 "모르는 키"로 보인다.
- 비밀 키 값이 `secret://` 참조가 아니면 그 값을 적용하지 않고 `settings.secretValue` 진단을 남긴다. 파일에 평문 비밀이 있었다는 사실만 기록하고 값은 로그에 쓰지 않는다.

### 4.9 생성 규칙: 화면, 파일, 명령

[결정] 모든 설정은 F5 설정 스키마 하나에서 L4 화면, 설정 파일, 명령을 함께 만든다(`_research/layer-plan-v2-notes.md` 층 사이 규칙 6).

| 산출물 | 만드는 쪽 | F가 보장하는 입력 |
|---|---|---|
| 설정 화면(탭 12개) | `L4.settings-ui.spec` | `SettingDef.ui`, `range`, `secret`, `allowedScopes`, `EffectiveSetting` |
| 설정 파일 JSON Schema | `L4.host-service.spec`(생성 명령) | `settingsJsonSchema` 출력 규약(§4.10) |
| 명령 | `L4.cli.spec`(`xeon config get/set/reset/list`), wire `settings.*` | `checkSettingWrite`, `validateSettingValue`, `EffectiveSetting` |

- 탭 [제안]: `SettingsTab`의 12개 값. `_research/settings.md` §4의 13개 탭 초안에서 "에이전트"를 "모델"에 합치고(`_research/layer-plan-v2-notes.md` L4 설정 화면 구성안의 모델 탭이 서브에이전트를 포함한다), "비밀"(같은 구성안)과 "외관"(층 밖 항목)을 따로 둔 결과다. 최종 배치는 `L4.settings-ui.spec`이 정하고 enum 변경은 F 버전 정책(부 버전)을 따른다.
- 화면 공통 규칙(`_research/settings.md` §4)에서 F 데이터로 보장하는 것: 범위 배지(`EffectiveSetting.source.scope`), 세션 중 변경 가능 여부(`runtimeChange`, `allowedScopes`에 `session` 포함 여부), 관리 잠금(`locked`), 저장 파일 경로(`source.path`).
- 비밀 값 비표시 규칙 [제안]
  1. 설정에는 비밀 값이 없다. 비밀 키의 값은 `secret://<name>` 참조 문자열뿐이다.
  2. `settings.get`, `EffectiveSetting`, JSON Schema 출력, 로그, 이벤트 어디에도 해석한 비밀 값을 싣지 않는다. 참조 문자열만 싣는다.
  3. 화면은 참조 이름과 상태(등록됨, 없음)만 보인다. 값 등록·열람은 `L0.secrets.spec`의 흐름으로 하고 설정 화면은 그 화면으로 이동만 한다.
  4. `settings.set`에 참조가 아닌 문자열이 오면 `settings.secretValue`(3105)로 거부하고, 오류 `details`에도 그 값을 넣지 않는다.

### 4.10 JSON Schema 출력 규약

```ts
// settings/jsonschema.ts
export interface SettingsJsonSchemaOptions {
  readonly scope: Exclude<SettingScope, "session">;    // 파일이 있는 범위
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
5. `additionalProperties: true`다. 모르는 키를 보존하기 위해서다(§4.8). 편집기 경고는 `x-xeon-unknownKeys: "warn"`로 표시한다.
6. `default`는 `def.default`가 있을 때만 싣는다. 비밀 키는 `default`가 없고 `pattern`이 `SecretRef`와 같다.
7. `deprecated`가 있으면 JSON Schema `deprecated: true`와 `description`에 대체 키를 적는다.
8. 확장 정보는 `x-xeon` 객체에 싣는다: `{ layer, runtimeChange, allowedScopes, secret, since, ui }`.
9. 같은 카탈로그와 같은 옵션이면 출력은 바이트 단위로 같다(키 정렬). CI가 커밋본과 diff할 수 있게 하기 위해서다.

### 4.11 CLI 파서와 같은 검사

- [제안] CLI `xeon config set <key> <raw>`는 `raw`를 먼저 JSON으로 해석하고, 실패하면 문자열로 본다. 해석한 값은 `checkSettingWrite`로 검사한다. 이 함수 안의 값 검사는 `validateSettingValue`이고, 이 함수는 `settingsJsonSchema`가 내는 스키마와 같은 TypeBox 스키마(`type` + `range`)로 `Value.Check`를 한다. 그래서 파일 검사, CLI 검사, wire `settings.set` 검사의 결과가 같다.

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
| `session` 범위 쓰기인데 키가 `session`을 허용하지 않음 | `settings.scopeNotAllowed`(3103) |
| 관리 범위가 잠근 키를 사용자가 바꾸려 함 | `settings.locked`(3104). 화면은 편집을 미리 막는다 |
| 파일 값이 스키마에 맞지 않음 | 그 값을 건너뛰고 다음 순위 값을 쓴다. 진단을 남긴다 |
| 폐기된 키를 씀 | 값은 적용하고 `deprecated: true`와 대체 키를 보인다. `removed`가 된 뒤에는 모르는 키로 보존만 한다 |

## 6. 설정 노출

- F 자신의 설정 키: 없음. F에는 런타임 로직이 없어 바꿀 값이 없다.
- wire 한도(`maxReplayEvents`, 연결당 구독 수, 프레임 크기)를 사용자에게 열지는 `L4.host-service.spec`이 정하고, 연다면 키도 그 문서가 소유한다(`l4.host-service.*`).
- 이 문서가 정하는 것은 다른 층이 설정을 노출하는 형식(§3.8~§4.11)이다. 각 층 spec의 "설정 노출" 절은 `defineSettings` 선언과 같은 열(키, 타입, 기본값, range, runtimeChange, allowedScopes, ui.tab, secret)로 표를 쓴다.

## 7. 확장 지점

- 이 도메인은 on·post·drive·scope 지점을 선언하지 않는다.
- 확장과의 관계는 둘이다.
  - 확장 설정: `ExtensionManifest.userConfig` → `settingsFromManifest` → 카탈로그(§3.8.3).
  - 확장 메서드와 오류: 확장 wire 메서드는 M2 이후(§4.2), 확장 오류 코드는 10000~19999와 `ext.<id>.` kind(§3.5.3).
- [제안] 설정 변경 통지를 확장 지점(post)으로 둘지는 `X.primitives.spec`과 `L1.persistence.spec`이 정한다. F는 변경 이벤트의 payload로 `EffectiveSetting`을 쓸 수 있게 해 둔다.

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
- A6. `classifyMethodName`은 `turn.start`를 `core`, `$/cancelRequest`를 `control`, `ext.web-exa.search`를 `extension`으로 분류하고 `Turn.start`, `turn`, `turn.start.now`, `turn_start`는 거부한다.
- A7. `host.hello` 전의 `turn.start`는 1001을 받는다. opt-in하지 않은 `experimental` 메서드는 `-32601`을 받는다.
- A8. `WireParams<"turn.start">`와 `Static<typeof WIRE_METHODS["turn.start"]["params"]>`가 같은 타입이다(타입 테스트). `WireMethodMap`과 `WIRE_METHODS`의 키 집합이 같다.
- A9. 이 문서 §3.3.1 표의 메서드 이름·단계 집합과 `WIRE_METHODS`의 것이 같다(문서 검사).
- A10. 전송 적합성 케이스 전부를 in-process 전송과 stdio 전송이 같은 결과로 통과한다.
- A11. `stream.chunk`는 재전송되지 않는다. 재구독 뒤에 이전 조각이 다시 오지 않는다.
- A12. 처리기가 던진 알 수 없는 예외는 `-32603`, `message: "Internal error"`로 바뀌고 원래 메시지가 응답에 없다.
- A13. `thread.read`가 돌려준 `position.seq` 이하의 그 thread 이벤트는 `items`에 모두 반영되어 있고 그 seq를 넘는 이벤트는 하나도 반영되어 있지 않다. `before` 페이지를 끝까지 이어 붙이면 중복도 빠짐도 없는 item 열이 된다. 없는 `before`는 3005, 없는 thread는 3001이다.
- A14. 구독(`from: "head"`) 뒤 `thread.read`를 보내고 `seq > position.seq`인 이벤트만 적용하면, 읽기와 겹치는 구간에 이벤트가 커밋되어도 최종 item 집합이 중단 없이 구독한 클라이언트의 것과 같다.
- A15. `approval.list`의 `approvals`는 `position.seq` 시점에 `approval.resolved`가 없는 `approval.requested` 전부이고 각 항목의 `request`가 이벤트 payload와 같다. 응답한 뒤에는 목록에서 빠진다.

settings:

- S1. `secret: true`이고 `default`가 있는 정의는 `defineSettings`가 거부한다(D2).
- S2. `range.min > range.max`인 정의, `default`가 range 밖인 정의는 거부한다(D4, D5).
- S3. `allowedScopes`에 `session`이 없는 키를 `session` 범위로 쓰면 `checkSettingWrite`가 `settings.scopeNotAllowed`를 돌려준다.
- S4. `managed` 범위가 정한 키는 유효 값이 managed 값이고 `locked: true`다. 다른 범위의 쓰기는 `settings.locked`다.
- S5. managed가 없을 때 같은 키를 user, project, local, session이 모두 정하면 유효 값은 session 값이고 `shadowed`는 local, project, user 순이다.
- S6. 같은 `SettingDef`에 대해, 임의 값 v의 `validateSettingValue(def, v).ok`와 `settingsJsonSchema`가 낸 `properties[key]`로 v를 검사한 결과가 같다(속성 기반 테스트 포함). CLI 파서도 같은 결과를 낸다.
- S7. `settingsJsonSchema({scope: "project"})`에는 `allowedScopes`에 `project`가 없는 키가 없다.
- S8. 비밀 키의 `EffectiveSetting.value`는 `secret://` 문자열이거나 `null`이다. 참조가 아닌 값 쓰기는 `settings.secretValue`이고 오류 `details`에 그 값이 없다.
- S9. 두 그룹이 같은 키를 정의하면 `buildCatalog`가 `duplicateKey`를 돌려준다. 확장 매니페스트가 `l1.` 키를 정의하면 `foreignNamespace`다.
- S10. `settingsJsonSchema`는 같은 입력에 바이트 단위로 같은 출력을 낸다.

## 10. 미결 사항

1. [결정: review.decisions-2 U-02] 승인 요청 방향은 A안(내구 이벤트 `approval.requested` + `approval.respond`)이다(§4.6).
2. [미결] 설정 우선순위 표(§4.7). 관리 범위를 잠금 전용으로 둘지, 관리 기본값을 따로 둘지.
3. [미결] 폐기 기간(§3.7). 제안은 12개월 또는 다음 주 버전 중 늦은 쪽.
4. [미결] 서비스 모드 인증. Unix 소켓 + 파일 권한만으로 충분한지, 토큰을 필수로 할지(`_research/process.md` §6.4). 토큰을 실을 자리(`host.hello` `auth?`)와 오류 `host.authFailed`는 M2 선택 필드로 두었다(§3.3.1, §3.5.2). 원격은 [결정: review.decisions-2 U-11]로 M3에 넣되, 로컬 서비스 소켓을 SSH 터널이나 사설망(Tailscale 등)으로 연결하는 방식이다. 그래서 원격도 소켓 인증 규칙을 그대로 쓴다. 내장 TLS + 토큰 WebSocket 전송은 2차다.
5. [미결] 확장이 wire 메서드를 더하는 것을 허용할지(§4.2).
6. [결정: review.decisions-2 U-24] TypeBox 버전은 1.3.27(catalog 정확 고정)이다. pi-ai가 1.3.27을 정확 고정하므로 같은 판으로 맞춰 한 사본만 설치한다. 1.4로 올리는 시점은 pi가 올릴 때다.
7. [미결] `Seq`·`StoreId`를 F.records로 옮길지. `sto` 접두는 `IdPrefix`에 넣지 않고 저장소 정체성 ID 부류로 둔다(`F.conversation.spec` §3.2.1 ①) [제안].
8. [미결] `UserConfigEntry`에 값 스키마 필드(`type`, `default`, `range`, `runtimeChange`, `allowedScopes`)를 둘지(§3.8.3). 확장 설정 키 접두는 `ext.<name>.`로 맞췄다(`F.extensions.spec` §3.1, §6).
9. [결정: m2-plan F.6] `ThreadSummary`의 필드는 §3.3.1 아래 코드로 정했다. 이어서 실행 후보는 전용 메서드 없이 `resumable` 필드로 알린다.
10. [결정: review.decisions-2 U-04] 판정하지 않은 아래 호스트 계약 요청은 M1에 넣지 않는다. M2 계획에서 하나씩 받을지 반려할지 정하고, 그때까지 이 항목에 미결로 남긴다. 정하기 전에는 소비 문서가 이 항목에 의존하지 않고 각자 대체 경로를 둔다.
    - `settings.invalidated` 알림(`L4.readme` §8 14번), `settings.list`의 `range` 병합(15번), `settings.readFile`·`settings.writeFile`(36번), `SettingsTab`·`SettingUi` 필드(37번), `EffectiveSetting`의 잠금 사유 문구(39번)
    - 사용량 wire 메서드(35번), 사용자 알림 wire 알림(13번)
    - 이어서 실행 후보 조회(11번): [결정: m2-plan F.6] `ThreadSummary.resumable` 필드로 받았다(미결 9)
    - thread 오류 kind `thread.hasForks`, `thread.invalidTarget`, `thread.cancelledByExtension`(`L1.persistence.spec` FR-P6): [결정: m2-plan F.6] 3004~3006으로 받았다(§3.5.2)
    - `turn.interrupt`를 M1으로 당기기(25번), `host.diagnose`(26번), 적합성 실행기의 `testing` 서브패스(19번. review.decisions-2 U-03으로 F에는 `testing` 서브패스를 두지 않는다. 실행기 틀은 각 패키지 `test/` 안에 둔다)
    - `secret.beginReveal`(`L4.readme` §8.1): [결정: m2-plan F.5] M2 메서드로 받았다(§3.3.1 표)
11. [결정: m2 F.2] L4.desktop 상태 설계 §14의 1번(스냅샷), 2번과 13번(대기 승인 목록)을 `thread.read`, `approval.list`로 받았다(§3.3.1, §3.4.6). 12번(로딩 신호)은 새 신호 없이 클라이언트가 요청 수명주기로 얻는다(§3.4.6 6항).
