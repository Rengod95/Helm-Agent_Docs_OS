---
id: L0.process.spec
layer: L0
domain: process
kind: spec
status: draft
depends_on: [adr.0006, adr.0008, adr.0004, F.wire-settings.spec, L0.store.spec, L0.os.spec, L0.exec.spec, architecture.runtime-flow.design]
binds: [xeon/packages/platform-process/**]
---

# L0 프로세스 (process)

이 문서는 L0-d "프로세스"(`_research/layer-plan-v2.json` L0-d)의 스펙이다. 패키지는 `xeon/packages/platform-process`(`@xeon/platform-process`)이고 Cordis 서비스 `xeon.process`(`ProcessService`)를 등록한다(`eng.context-map.design` §5.3). 근거 자료는 `_research/process.md` §3·§5·§6이다.

## 1. 목적과 범위

### 1.1 정하는 것

[결정] 엔진은 프로세스 정책을 갖지 않는 라이브러리이고, 호스트 계약은 하나이며, 전송만 바꾼다(adr.0006 §3.1~§3.3, `F.wire-settings.spec` §3.1). 이 패키지는 그 결정 아래에서 다음 여덟 가지를 정의한다.

1. 전송 구현: `F.wire-settings.spec` §3.1의 `Transport` 세 종류(in-process, stdio, socket)
2. 자식 엔진 수명 임대: stdin EOF와 `shutdown` 요청, 종료 시한
3. 백그라운드 프로세스 레지스트리: 장시간 셸 작업과 MCP 서버의 id·상태·소유, 종료 정리
4. 공유 서비스 모드의 L0 쪽 라이브러리: 등록 파일, `ensure`, 이중 기동 방지, 유휴 종료 판정, 토큰 인증, 감독
5. 세션 잠금 실패 때 동작 정책 `LockFallbackPolicy`
6. 복구 표식 기반 '이어서 실행' 제시 정책
7. OS 서비스 등록 provider(2차)
8. X 포트 `ProcessPort`(`F.extensions.spec` §3.2.1) 구현: 외부 훅 실행 `run`(M2)과 격리 확장 자식 기동 `spawn`(2차). `ProcessService`가 이 포트를 확장한다(§3.1, §4.8)

원격 사용은 1차(M3)이고 새 전송을 두지 않는다. 로컬 서비스 소켓을 SSH 터널이나 사설망(Tailscale 등)으로 연결해 쓴다. 내장 TLS + 토큰 WebSocket은 2차다 [결정: review.decisions-2 U-11].

### 1.2 다루지 않는 것

| 대상 | 정하는 곳 |
|---|---|
| `xeon service start\|status\|stop\|install\|uninstall` 명령줄, 호스트 조립(엔진 열기, 처리기 표, 전송 연결) | `L4.host-service.spec` |
| 엔진 진입점(`Runtime.open`) 구현 | [미결 P-5] 권고는 `L4.host-service.spec`(§3.2) |
| JSON-RPC envelope 검사, 메서드 레지스트리, `HostConnection` | `F.wire-settings.spec` §3.2~§3.5. 이 패키지는 그 함수를 호출만 한다 |
| 세션 소유 잠금 구현(OS 잠금, `sys_leases`) | `L0.store.spec` §4.7 |
| 복구 표식(`p_threads`의 `running_since`·`resume_attempts`)과 재개 커밋(`thread.resumed`) | `L1.persistence.spec` §2·§4.8 |
| 결과 불명 도구 호출의 재실행 판정(`replay: safe`) | `L1.persistence.spec`, `eng.transactions.design` §5 |
| 데스크톱 쪽 사이드카 spawn(Rust) | `L4.desktop.spec`, adr.0008 §3.3 |
| 도구 셸 실행과 백그라운드 셸 작업의 spawn | `L0.exec.spec`(`xeon.exec`). 외부 훅 실행과 격리 확장 자식 기동(`ProcessPort`)은 이 문서 §4.8이다 |
| 예약 작업 테이블과 틱 | `L2.schedule.spec`. 이 문서는 유휴 판정의 입력만 받는다 |

경계 표(L4 host-service와의 나눔):

| 기능 | L0 process(이 문서) | L4 host-service |
|---|---|---|
| 전송 | `Transport` 구현과 프레이밍 | 어느 전송을 열지 고르고 `HostConnection`과 처리기 표에 연결 |
| 서비스 모드 | 등록 파일 읽기·쓰기, `ensure` 알고리즘, 바인드 경합, 유휴 판정기, 토큰 검사, detached 기동 함수 | `xeon service` 명령, 서비스 프로세스 `main`, 처리기에서 `host.status` 값 채우기 |
| 수명 | stdin EOF 감시, `ShutdownCoordinator`, 시한 뒤 강제 종료 | `host.shutdown` 처리기에서 coordinator 호출 |
| 잠금 실패 | `chooseLockFallback` 순수 함수 | `thread.locked`(3002) 오류 조립, 사용자 질문 UI |
| 재개 제시 | `buildResumeOffers` 순수 함수 | `thread.list`·UI에 후보 표시 |
| OS 서비스 등록 | `OsServiceRegistrar` provider | `xeon service install` 명령과 동의 질문 |

### 1.3 배치 [미결 P-3]

`F.readme` §6과 `F.wire-settings.spec` §1.2는 "전송 구현은 L4"라고 적었고, 계획 v2 L0-d("엔진 라이브러리와 전송")는 L0에 두었다. 권고는 L0 구현 + L4 조립이다 [제안]. 근거: 프레이밍과 소켓·파이프 처리는 OS마다 바뀌는 부분이라 DR-13에 따라 L0 안에 두고, L4는 고르고 연결하는 일만 한다. `node:child_process`·`Bun.spawn`의 소유 패키지 목록(DR-07)에 `platform-process`가 이미 있다. 권고를 채택하면 `F.readme` §6과 `F.wire-settings.spec` §1.2의 표 한 줄을 고친다(§8.1 FR-P6).

공유 서비스 모드는 계획 v2 표에서 '2차'였으나 `_research/foundation-plan.md §1` 결정 2로 1차 범위로 올랐다(adr.0006 §1). 구현 시점은 M2 이후다. OS 서비스 등록만 2차다(review.decisions-2 S-01).

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 엔진 | Cordis 호스트 + 루프 + SQLite. 프로세스 정책을 갖지 않는 라이브러리 |
| 호스트 | 엔진을 소유하고 계약의 서버 쪽을 맡는 코드(`apps/host`) |
| 자식 엔진 | 데스크톱이 사이드카로 띄운 엔진 프로세스(`xeon host --stdio`) |
| 수명 임대 | 부모가 쥔 stdin 파이프. 부모가 어떻게 끝나도 OS가 쓰기 끝을 닫아 자식이 EOF를 읽는다 |
| 서비스 | `xeon service`로 뜬 공유 엔진 프로세스. 여러 클라이언트가 socket 전송으로 접속한다 |
| 등록 파일 | 서비스의 소켓 경로·pid·버전·토큰을 담은 JSON 파일(0600) |
| `ensure` | 클라이언트가 서비스를 찾거나 기동하는 절차 |
| live task | 진행 중 턴, 실행 중 도구, 승인 대기 세션, 활성 drive 임대 |
| 안전 경계 | 다음 커밋 지점 직전(`eng.transactions.design` §4.1). 진행 중 모델 스트리밍은 버리고 그 단계를 재개 때 다시 보낸다 |
| 프로세스 지문 | pid와 프로세스 시작 시각의 쌍. pid 재사용을 구분한다 |

## 3. 인터페이스

코드 표기는 `F.conversation.spec` §3 머리말을 따른다. 예상 가능한 실패는 `Result`, 버그는 `Bug`다(`eng.typescript.guide` TY-11). `Clock`(`now()`만)과 `Scheduler`(`setTimeout`, `clearTimeout`)는 `L0.os.spec` §3.4의 분리를 따른다. 타이머가 필요한 팩토리는 `Scheduler`를 따로 받는다. 두 인터페이스는 F 루트 base에 둔다 [결정: review.decisions-2 U-03].

### 3.1 F에 둘 인터페이스 초안

`ProcessService`는 F `@xeon/contracts/services` 서브패스의 `services/process.ts`에 둔다 [결정: review.decisions-2 D-04]. `ProcessService`는 X 포트 `ProcessPort`(`F.extensions.spec` §3.2.1 `ports.ts`, `IsolationProcessPort`와 `HookProcessPort`를 합친 포트)를 확장한다(`F.capabilities.spec` §3.12 표 "확장하는 포트" 열과 규칙 2). 그래서 X는 `ProcessPortKey`(`{ name: "xeon.process" }`)로 같은 서비스 객체를 받는다. 포트 메서드(`spawn`, `run`)와 부속 타입(`IsolationSpawnSpec`, `IsolatedChild`, `HookRunSpec`, `HookRawRun`)은 F.extensions가 정본이고 이 문서는 다시 정의하지 않는다. 이 인터페이스가 더하는 것은 레지스트리와 종료 협조다. 전송, 잠금 실패 정책, 재개 제시는 Cordis 서비스가 아니고 조립 루트(`apps/host`, DR-14 예외 2)가 쓰는 라이브러리 함수다(§3.2).

```ts
// xeon/packages/contracts/src/services/process.ts
import type { Result } from "../base/index.ts";
import type { LocalId } from "../conversation/index.ts";
import type { ProcessPort } from "../extensions/index.ts";        // F.extensions.spec §3.2.1. spawn(2차), run(M2)

export const ProcessServiceName = "xeon.process" as const;

export type BackgroundProcessId = LocalId<"bgp">;                 // "bgp_<ULID>". F.conversation.spec §3.2.1 LocalIdPrefix, 발급은 LocalIdFactory.next("bgp")
export type BackgroundOwnerKind = "tool" | "mcp" | "schedule" | "other";
export type BackgroundState = "running" | "stopping" | "exited" | "killed" | "lost";

export interface BackgroundOwner {
  readonly kind: BackgroundOwnerKind;
  readonly threadId: string | null;                                // 세션에 묶인 작업이면 ThreadId
  readonly ref: string | null;                                     // toolCallId, MCP 서버 이름 등
}

/** 등록자가 넘기는 정지 수단. 프로세스를 띄운 쪽(xeon.exec 등)이 프로세스 그룹 kill을 구현한다 */
export interface BackgroundStopper {
  /** graceful: SIGTERM(Windows는 트리 종료 요청). force: SIGKILL. 프로세스 트리 전체 */
  stop(mode: "graceful" | "force"): Promise<void>;
  /** 종료되면 이행. 종료 코드, 신호 이름 */
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
}

export interface RegisterBackgroundInput {
  readonly label: string;                                          // 화면 표시. 비밀 값을 넣지 않는다
  readonly owner: BackgroundOwner;
  readonly pid: number;
  readonly stopper: BackgroundStopper;
}

export interface BackgroundProcessInfo {
  readonly id: BackgroundProcessId;
  readonly label: string;
  readonly owner: BackgroundOwner;
  readonly pid: number;
  readonly startedAt: number;                                      // epoch ms, 등록 시각
  readonly state: BackgroundState;
  readonly exitCode: number | null;
}

export type BackgroundError =
  | { readonly kind: "not_found"; readonly id: BackgroundProcessId }
  | { readonly kind: "registry_closed" };

export interface BackgroundRegistry {
  register(input: RegisterBackgroundInput): Result<BackgroundProcessId, BackgroundError>;
  list(filter?: { readonly threadId?: string; readonly kind?: BackgroundOwnerKind }): readonly BackgroundProcessInfo[];
  get(id: BackgroundProcessId): BackgroundProcessInfo | undefined;
  /** graceful → graceMs 뒤 force. 이미 끝났으면 ok */
  stop(id: BackgroundProcessId, options?: { readonly graceMs?: number }): Promise<Result<BackgroundState, BackgroundError>>;
  /** 세션을 닫거나 임대를 잃을 때 */
  stopOwnedBy(threadId: string, options?: { readonly graceMs?: number }): Promise<number>;
  onChange(listener: (info: BackgroundProcessInfo) => void): () => void;
}

export type ShutdownReason = "stdin_eof" | "shutdown_request" | "signal" | "idle" | "service_lost" | "version_replace";

/** 엔진 플러그인이 종료 협조에 참여하는 창구 */
export interface ShutdownCoordinator {
  /** 종료가 요청되면 중단되는 신호. 루프는 안전 경계에서 이 신호를 확인한다 */
  readonly signal: AbortSignal;
  readonly reason: ShutdownReason | null;
  /** 참여자. 종료 요청 때 순서대로(등록 역순) 부르고 시한 안에 끝나기를 기다린다 */
  onShutdown(name: string, participant: (reason: ShutdownReason) => Promise<void>): () => void;
}

/** ProcessPort의 spawn·run을 함께 구현한다(§4.8) */
export interface ProcessService extends ProcessPort {
  readonly background: BackgroundRegistry;
  readonly shutdown: ShutdownCoordinator;
}
```

```ts
// xeon/packages/contracts/src/records/lease.ts (L0.store.spec §3.1, FR-S2)
// 이 문서가 쓰는 타입: LockBusy, LeaseOwnerInfo, LeaseKind
// xeon/packages/contracts/src/records/session-service.ts (L1.persistence.spec §3.6, 그 문서 §8.3 FR-P1)
// 이 문서가 쓰는 타입: RecoveryMarker
```

store와 process는 서로 import하지 못한다(DR-02). 두 패키지는 records의 `LockBusy`, `LeaseOwnerInfo`를 같이 쓴다. 복구 표식 모양 `RecoveryMarker`는 `L1.persistence.spec`이 F records에 두도록 요청한 타입이다. L0는 L1 패키지를 import할 수 없으므로 이 패키지는 F 타입만 보고, 값은 호스트(L4)가 `xeon.session`에서 읽어 넘긴다(§4.6).

### 3.2 패키지 공개 API (L0 platform-process)

조립 루트(`apps/host`)만 아래 함수를 import한다(DR-14 예외 2). 8절 표에서 `L4.cli.spec`·`L4.desktop.spec`을 소비자로 적은 항목은 `apps/host`를 거쳐 쓰는 경우다. `apps/cli`는 엔진을 같은 프로세스에서 여는 조립 루트로 `apps/host`를 쓰고, 이 함수들은 `apps/host`가 다시 내보내는 진입점으로만 쓴다. `apps/desktop`(Tauri 쪽)은 wire 메서드로만 결과를 받는다 [제안].

```ts
// xeon/packages/platform-process/src/transport/index.ts
import type {
  InProcessTransportFactory, SocketTransportOptions, StdioTransportFactory, Transport,
} from "@xeon/contracts/wire";
import type { Result } from "@xeon/contracts";

export declare const createInProcessPair: InProcessTransportFactory;
export declare const createStdioTransport: StdioTransportFactory;

/** 클라이언트 쪽 socket 전송 */
export declare function connectSocket(options: SocketTransportOptions): Promise<Result<Transport, SocketError>>;

/** 서버 쪽 리스너. 연결마다 Transport 하나 */
export interface SocketListener extends AsyncDisposable {
  readonly path: string;
  onConnection(handler: (transport: Transport, peer: PeerInfo) => void): () => void;
  readonly connectionCount: number;
  close(): Promise<void>;
}
export interface PeerInfo { readonly connectionId: string }
export type SocketError =
  | { readonly kind: "address_in_use"; readonly path: string }
  | { readonly kind: "not_found"; readonly path: string }
  | { readonly kind: "refused"; readonly path: string }
  | { readonly kind: "path_too_long"; readonly path: string; readonly limit: number }
  | { readonly kind: "permission"; readonly path: string }
  | { readonly kind: "io"; readonly code: string };
export declare function listenSocket(options: SocketTransportOptions): Promise<Result<SocketListener, SocketError>>;
```

```ts
// xeon/packages/platform-process/src/lease/child-lease.ts
import type { Clock, Scheduler } from "@xeon/contracts";              // F 루트 base(review.decisions-2 U-03), L0.os.spec §3.4
import type { ShutdownCoordinator, ShutdownReason } from "@xeon/contracts/services";

export interface ChildLeaseOptions {
  /** 자식 엔진의 stdio 전송. stdin은 전송이 읽는 스트림 하나뿐이라 EOF는 전송의 onClose로 받는다 */
  readonly transport: Pick<Transport, "onClose">;
  readonly exit: (code: number) => never;                          // 협조 종료가 시한 안에 끝나면 0으로 부른다. 테스트에서 주입
  readonly logger?: Logger;
}
/** stdin EOF(전송 onClose reason "eof")나 읽기 오류("error")를 수명 임대 해제로 보고 종료 협조를 시작한다 */
export declare function watchChildLease(coordinator: ProcessShutdown, options: ChildLeaseOptions): Disposable;

export interface HostShutdownHandlerOptions {
  readonly coordinator: ProcessShutdown;
  readonly transport: Pick<Transport, "close">;                    // 응답이 나간 뒤 닫아 쓰기 큐를 비운다
  readonly scheduler: Scheduler;
  readonly exit: (code: number) => never;
  readonly logger?: Logger;
}
/** host.shutdown 처리기 본체(FR-P1). 참여자가 끝난 뒤 { accepted: true }를 돌려주고, 다음 매크로 태스크에서 전송을 닫은 뒤 exit(0) */
export declare function createHostShutdownHandler(options: HostShutdownHandlerOptions): (params: HostShutdownParams) => Promise<HostShutdownResult>;

/** ShutdownCoordinator의 소유자 쪽 */
export interface ProcessShutdown extends ShutdownCoordinator {
  /** 종료를 요청한다. 참여자를 시한 안에서 기다리고, 넘으면 exit(1). 두 번째 호출은 첫 Promise를 돌려준다 */
  request(reason: ShutdownReason): Promise<{ readonly completed: boolean; readonly elapsedMs: number }>;
}
export declare function createProcessShutdown(options: { readonly timeoutMs: number; readonly clock: Clock; readonly scheduler: Scheduler; readonly exit: (code: number) => never }): ProcessShutdown;
```

```ts
// xeon/packages/platform-process/src/service/registration.ts
import { Type, type Static } from "typebox";

/** adr.0006 §3.4 [제안] 스키마를 확정한 모양. 위치는 F wire(FR-P3) */
export const ServiceRegistrationSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    version: Type.String({ minLength: 1, maxLength: 64 }),          // 엔진 버전(semver)
    protocolVersion: Type.String({ minLength: 1, maxLength: 32 }),  // 호스트 계약 버전(SemVer)
    socket: Type.String({ minLength: 1, maxLength: 1024 }),         // Unix 소켓 절대 경로
    pid: Type.Integer({ minimum: 1 }),
    startedAt: Type.Integer({ minimum: 0 }),                        // 프로세스 시작 시각 지문(epoch ms, L0.os)
    token: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),         // 32바이트 무작위, base64url 패딩 없음
    storeId: Type.String({ minLength: 1, maxLength: 64 }),          // 같은 DB인지 확인
  },
  { additionalProperties: true },                                   // 모르는 필드 보존 (adr.0006 §3.7 1번)
);
export type ServiceRegistration = Static<typeof ServiceRegistrationSchema>;

export type RegistrationError =
  | { readonly kind: "absent" }
  | { readonly kind: "malformed"; readonly issue: string }
  | { readonly kind: "insecure_mode"; readonly mode: number }
  | { readonly kind: "io"; readonly code: string };

export interface RegistrationStore {
  readonly path: string;                                            // <runtimeDir>/service.json
  read(): Result<ServiceRegistration, RegistrationError>;
  /** 임시 파일(0600) → fsync → rename. 기존 파일의 모르는 필드는 합쳐서 보존한다 */
  write(value: ServiceRegistration): Result<void, RegistrationError>;
  /** 내용의 pid·startedAt이 자기 것일 때만 지운다 */
  removeIfOwned(pid: number, startedAt: number): Result<boolean, RegistrationError>;
}
```

```ts
// xeon/packages/platform-process/src/service/ensure.ts
export interface EnsureDeps {
  readonly registration: RegistrationStore;
  readonly connect: (socket: string) => Promise<Result<Transport, SocketError>>;
  /** host.hello 왕복. 버전과 한가함(liveTasks 0)을 돌려준다 */
  readonly probe: (transport: Transport, token: string) => Promise<Result<ServiceProbe, ProbeError>>;
  /** detached + unref로 `xeon service start --foreground`를 띄운다 (L4가 명령 배열을 준다) */
  readonly spawnService: () => Result<{ readonly pid: number }, { readonly kind: "spawn_failed"; readonly code: string }>;
  readonly clock: Clock;
  readonly scheduler: Scheduler;                                     // 200 ms 재시도 간격, startTimeoutMs 시한
  readonly engineVersion: string;
  readonly protocolVersion: string;
}
export interface ServiceProbe { readonly version: string; readonly protocolVersion: string; readonly idle: boolean }
export type ProbeError = { readonly kind: "auth_failed" } | { readonly kind: "timeout" } | { readonly kind: "protocol_unsupported" };

export type EnsureOutcome =
  | { readonly kind: "connected"; readonly transport: Transport; readonly registration: ServiceRegistration; readonly started: boolean }
  | { readonly kind: "version_mismatch_busy"; readonly transport: Transport; readonly registration: ServiceRegistration };   // 경고 후 그대로 접속
export type EnsureError =
  | { readonly kind: "start_timeout"; readonly waitedMs: number }
  | { readonly kind: "protocol_unsupported"; readonly serviceVersion: string }
  | { readonly kind: "auth_failed" }
  | { readonly kind: "spawn_failed"; readonly code: string };

export declare function ensureService(deps: EnsureDeps, options?: { readonly startTimeoutMs?: number }): Promise<Result<EnsureOutcome, EnsureError>>;
```

```ts
// xeon/packages/platform-process/src/service/idle.ts
export interface IdleInputs {
  readonly connections: number;
  readonly liveTasks: number;                                       // 승인 대기 세션 포함 (§4.4.4)
  readonly pendingSchedules: number;                                // L2 schedule의 대기 예약 수
}
export interface IdleMonitor extends Disposable {
  /** 입력이 바뀔 때마다 부른다 */
  update(inputs: IdleInputs): void;
  /** 유휴 종료 예정 시각(epoch ms). 없으면 null. host.status의 idleShutdownAt */
  readonly idleShutdownAt: number | null;
  onIdle(handler: () => void): () => void;
}
export declare function createIdleMonitor(options: { readonly clock: Clock; readonly scheduler: Scheduler; readonly startupGraceMs: number; readonly idleGraceMs: number }): IdleMonitor;
```

```ts
// xeon/packages/platform-process/src/service/auth.ts
/** 상수 시간 비교. initialize(host.hello) 전에 호출한다 */
export declare function verifyToken(expected: string, presented: unknown): boolean;
export declare function newServiceToken(random: (bytes: number) => Uint8Array): string;
```

```ts
// xeon/packages/platform-process/src/lock-fallback.ts
import type { LockBusy } from "@xeon/contracts/records";

export type LockFallbackChoice = "delegate" | "observe" | "fork";
export type LockFallbackDefault = "ask" | "observe" | "fork";       // l0.process.lockFallback.default

export interface LockFallbackContext {
  readonly busy: LockBusy;
  /** 지금 클라이언트가 공유 서비스에 접속해 있고 그 서비스가 소유자인가 */
  readonly serviceOwnsSession: boolean;
  readonly interactive: boolean;                                    // 사용자에게 물을 수 있는가
  readonly requested: LockFallbackChoice | null;                    // 명령줄·UI에서 명시한 선택
}
export type LockFallbackDecision =
  | { readonly kind: "act"; readonly choice: LockFallbackChoice }
  | { readonly kind: "ask"; readonly options: readonly LockFallbackChoice[]; readonly suggested: LockFallbackChoice };

export interface LockFallbackPolicy {
  decide(context: LockFallbackContext): LockFallbackDecision;
}
export declare function createLockFallbackPolicy(settings: { readonly default: LockFallbackDefault }): LockFallbackPolicy;
```

```ts
// xeon/packages/platform-process/src/resume-offer.ts
import type { LeaseOwnerInfo, RecoveryMarker } from "@xeon/contracts/records";

/** 표식이 있는 thread 하나. 호스트가 ProjectionQuery.thread(threadId).marker(L1.persistence.spec §3.4)에서 만든다 */
export interface ResumeCandidate {
  readonly threadId: string;
  readonly marker: RecoveryMarker;
}

export interface ResumeOffer {
  readonly threadId: string;
  readonly runningSince: number;
  readonly resumeAttempts: number;
  readonly action: "auto_resume" | "offer" | "exhausted";
  /** 다른 프로세스가 지금 그 세션을 쥐고 있으면 그 소유 정보. 제시만 하고 재개하지 않는다 */
  readonly heldBy: LeaseOwnerInfo | null;
}
export interface ResumePolicyInput {
  readonly serviceMode: boolean;
  readonly autoResumeEnabled: boolean;                              // l1.persistence.autoResume
  readonly maxAttempts: number;                                     // l1.persistence.maxResumeAttempts
}
export declare function buildResumeOffers(
  candidates: readonly ResumeCandidate[],
  heldBy: (threadId: string) => LeaseOwnerInfo | null,
  policy: ResumePolicyInput,
): readonly ResumeOffer[];
```

```ts
// xeon/packages/platform-process/src/registrar/provider.ts (2차)
export interface OsServiceSpec {
  readonly label: string;                                           // 예: "dev.xeon.service" [제안]
  readonly program: readonly string[];                              // 절대 경로 실행 파일 + 인자
  readonly environment: Readonly<Record<string, string>>;           // 비밀 값 금지
  readonly logDir: string;
}
export type RegistrarError =
  | { readonly kind: "consent_required" }
  | { readonly kind: "unsupported"; readonly platform: string }
  | { readonly kind: "command_failed"; readonly command: string; readonly code: number | null }
  | { readonly kind: "io"; readonly code: string };
export interface OsServiceRegistrar {
  readonly kind: "launchd" | "systemd" | "none";
  status(label: string): Promise<Result<"installed" | "absent" | "running", RegistrarError>>;
  install(spec: OsServiceSpec, consent: { readonly grantedAt: number }): Promise<Result<void, RegistrarError>>;
  uninstall(label: string): Promise<Result<void, RegistrarError>>;
}
```

### 3.3 전송 대조표

adr.0006 §3.3 [제안]의 이름은 `F.wire-settings.spec` §3.1의 이름으로 대체되었다. 이 문서는 F 이름을 쓴다.

| adr.0006 §3.3 | F.wire-settings §3.1 | 비고 |
|---|---|---|
| `HostTransport` | `Transport` | 메서드 `send`, `onMessage`, `onClose`, `close` 같음. `send`가 `Promise<void>`를 돌려준다 |
| `TransportKind` `"service"` | `TransportKind` `"socket"` | 서비스 모드의 전송 매체 이름. `host.status`의 `mode`는 `"service"`를 그대로 쓴다(`F.wire-settings.spec` §3.3.1) |
| `HostMessage` | `JsonRpcMessage`(송신), `unknown`(수신) | 수신 값의 envelope 검사는 위층 `HostConnection`이 한다 |
| `TransportCloseReason` `"peer-eof"`·`"local-close"`·`"error"` | `CloseInfo.reason` `"eof"`·`"local"`·`"error"`·`"remote"` | `"remote"`는 소켓 상대가 정상 종료한 경우 |

## 4. 동작 규칙

### 4.1 전송

공통:

- 수신 순서를 보존한다. 송신은 직렬화하고 앞 `send`가 끝난 뒤 다음을 쓴다(순서 보장, `F.wire-settings.spec` §4.1 3번).
- `onClose`는 한 번만 부른다. 그 뒤 `send`는 거부된 Promise(`Error("transport closed")`)를 돌려준다 [제안]. 연결 종료는 예상 가능한 사건이므로 Bug를 던지지 않는다.
- envelope 검사, 메서드 검사, params 검사는 전송 종류와 무관하게 `HostConnection`(F 함수, L4 조립)이 한다. 전송은 프레임 한도와 JSON 해석만 한다(`F.wire-settings.spec` §4.3 1·2번).

in-process(`createInProcessPair`):

- `client.send(m)`는 `queueMicrotask`로 `server`의 핸들러에 전달한다. 같은 JS 턴 안 재진입을 피한다.
- [제안] 테스트·개발 빌드는 메시지를 `JSON.parse(JSON.stringify(m))`로 왕복해 전달한다. 운영 빌드는 `structuredClone`도 하지 않고 같은 객체를 넘기되 `Object.freeze`(얕게)한다. 직렬화할 수 없는 값(함수, `undefined`, `Date`, `bigint`)이 in-process에서만 통과하는 일을 개발 단계에서 잡는다(`F.wire-settings.spec` §3.1 둘째 [제안]).
- 한쪽 `close()`는 양쪽 `onClose`를 부른다(`local`, `remote`).

stdio(`createStdioTransport`):

- JSON Lines, UTF-8, `\n` 구분. 송신 메시지 안의 줄바꿈은 `JSON.stringify`가 이스케이프하므로 한 줄이다.
- 수신은 `TextDecoder`(stream 모드)로 조각을 이어 붙이고 `\n`마다 자른다. `\r\n`의 `\r`은 지운다.
- 한 프레임이 `maxFrameBytes`(기본 `WIRE_LIMITS.maxFrameBytes` 1 MiB)를 넘으면 그 프레임을 다음 `\n`까지 버리고, 전송이 상대에게 `{"jsonrpc":"2.0","id":null,"error":{"code":-32600,…,"data":{"kind":"jsonrpc.invalidRequest","details":{"issue":"frameTooLarge"}}}}`를 보낸다(이름은 `F.wire-settings.spec` §5가 정본이다). 연결은 유지한다.
- JSON 해석 실패는 `-32700`(`id: null`)을 보낸다(`F.wire-settings.spec` §4.3 2번).
- 빈 줄은 무시한다.
- readable이 끝나면(EOF) `onClose({ reason: "eof" })`. 끝에 줄바꿈 없이 남은 조각은 버리고 진단에 남긴다.
- 읽기는 첫 구독(`onMessage` 또는 `onClose`)에서 시작한다. 처리기가 없을 때 도착한 메시지는 쌓아 두었다가 첫 `onMessage`가 붙을 때 도착 순서대로 비운다. 처리기가 던지면 읽기 루프를 죽이지 않고 전송을 `reason: "error"`로 닫는다.
- writable 쓰기는 백프레셔를 따른다(`writer.ready`를 기다린다).
- 자식 엔진 쪽 stdout은 이 전송 전용이다. 로그는 stderr로 보낸다(`L4.host-service.spec`이 로그 설정을 정한다).

socket(`listenSocket`, `connectSocket`):

- Unix 도메인 소켓 위 JSON Lines. 프레이밍은 stdio와 같은 `framing.ts`를 쓴다.
- 구현 수단은 `Bun.listen({ unix })`/`Bun.connect({ unix })` [가정: Bun 1.4.3 선언 `bun.d.ts:7401-7406`]. 실패하면 `node:net`으로 바꾼다.
- 소켓 경로 길이를 열기 전에 검사한다(macOS 104바이트, Linux 108바이트, §5.1). 넘으면 `path_too_long`.
- 리스너는 바인드 뒤 소켓 파일을 0600으로 바꾸고, 부모 디렉터리는 0700이어야 한다.
- 원격 사용(1차, M3)은 이 소켓을 SSH 터널(Unix 소켓 전달)이나 사설망으로 연결한다. 원격 클라이언트도 같은 socket 전송과 인증 규칙(§4.4.5)을 쓴다. 내장 TCP·WebSocket 원격 전송은 2차다 [결정: review.decisions-2 U-11].

### 4.2 자식 엔진 수명 임대

[결정] 데스크톱이 엔진 사이드카를 띄우고 stdin EOF를 임대 해제 신호로 쓴다(adr.0008 §3.3, adr.0006 §3.7 6번, opencode `standalone.ts:23-27`).

1. 자식 엔진(`xeon host --stdio`)은 시작 때 `watchChildLease`를 건다. stdin은 stdio 전송이 읽는 스트림 하나뿐이라(reader를 둘 붙일 수 없다) 감시는 전송의 `onClose`(`eof` 또는 `error`)를 듣는다.
2. 종료 요청은 두 경로로 온다.
   - `host.shutdown` 요청(§8.1 FR-P1): 데스크톱은 SIGKILL만 보내는 Tauri 셸 플러그인 제약 때문에 신호 전에 이 요청을 먼저 보낸다(adr.0006 §3.7 7번, adr.0008 §3.3 [제안] 3번). 응답을 받은 뒤 데스크톱이 프로세스를 정리한다.
   - stdin EOF: 데스크톱이 비정상 종료해도 OS가 파이프 쓰기 끝을 닫는다.
3. 어느 경로든 `ProcessShutdown.request(reason)`을 부른다. 처리 순서:
   1. `signal`을 중단한다. 루프(L1)는 안전 경계에서 이 신호를 보고 새 단계를 시작하지 않는다. 진행 중 스트리밍은 버린다(재개 때 같은 단계를 다시 보낸다, `eng.transactions.design` §5.4 K1).
   2. 참여자(`onShutdown`)를 등록 역순으로 부른다. `core-persistence`는 마지막 체크포인트와 임대 반납을, 백그라운드 레지스트리는 `stopAll`을 한다.
   3. 모두 끝나면 종료코드 0으로 끝낸다. 복구 표식은 지우지 않는다(`L1.persistence.spec` §4.8.1, 열린 turn이 남는다). 다음 실행이 '이어서 실행' 후보로 보인다.
   4. 시한(`l0.process.shutdown.timeoutMs`, 기본 3000 [제안], opencode 3초 선례)을 넘으면 남은 참여자를 기다리지 않고 종료코드 1로 끝낸다.
4. 비협조 확장 코드가 이벤트 루프를 막으면 시한 타이머도 돌지 않는다. 이 경우는 부모(데스크톱)의 SIGKILL만 정리할 수 있다(adr.0006 §4.2, durable `spec.md:5096`).

수용 기준: 부모를 `kill -9`해도 자식 엔진이 시한 + 1초 안에 종료한다(§9).

### 4.3 백그라운드 프로세스 레지스트리

- 장시간 셸 작업(`run_in_background`류 도구), MCP 서버 자식 프로세스, 예약 실행이 띄운 프로세스를 메모리에 등록한다. DB 테이블은 두지 않는다(`eng.context-map.design` §4.1 platform-execution "레지스트리는 메모리").
- 종료 정리의 실제 kill: 이 문서는 L0끼리 import하지 않는 규칙(DR-02)을 지키기 위해 등록자가 `pid`와 `BackgroundStopper`를 넘기는 방식을 쓴다 [제안]. 등록자가 쓰는 실행 수단은 `xeon.exec`의 `ExecService.startBackground`(`L0.exec.spec` §3.9)다. 이 호출은 종료를 기다리지 않고 `pid`, `stop("graceful" | "force")`, `exited`를 가진 `BackgroundExecHandle`을 돌려주고, 그 모양이 `BackgroundStopper`와 같아 L1 tools, L2 mcp가 그대로 넘긴다. 종료까지 기다리는 `Shell.exec`와 `withCwd` 파생 env의 `cleanup`(pid 없음, SIGKILL만)으로는 이 계약을 채울 수 없어서 exec에 별도 계약을 두었다. 레지스트리는 kill 수단을 갖지 않고 순서와 시한만 관리한다. 등록자가 정지 수단을 갖지 못하는 경우를 위해 자체 프로세스 트리 종료 provider(`posix`: `process.kill(-pgid)`, `win32`: `taskkill /T /F`)를 둘지가 [미결 P-4]의 남은 부분이다.
- `stop(id)`: 상태를 `stopping`으로 바꾸고 `stopper.stop("graceful")`, `graceMs`(기본 2000 [제안]) 안에 `exited`가 이행하지 않으면 `stopper.stop("force")`. 결과 상태는 `exited`(스스로 끝남) 또는 `killed`.
- `stopOwnedBy(threadId)`: 세션 닫기, 임대 상실(`L0.store.spec` §4.7.3 `keepAlive` onLost)에서 부른다.
- 종료 협조 참여자로 자신을 등록해 `ProcessShutdown` 때 모든 항목을 병렬로 `stop`한다.
- 프로세스가 먼저 끝나면 `exited` 이행으로 상태를 갱신한다. 등록 정보는 끝난 뒤 10분 [제안] 동안 `list`에 남기고 지운다.
- 서비스 모드에서는 서비스 프로세스의 레지스트리 하나가 모든 클라이언트 세션의 작업을 가진다. 클라이언트 연결이 끊겨도 정지하지 않는다(작업 지속이 서비스 모드의 목적이다).

### 4.4 공유 서비스 모드

[결정] 등록 파일(0600), `ensure`, 고정 소켓 경로 바인드 경합, 유휴 종료(adr.0006 §3.4). 제품 1차 범위이고 구현은 M2 이후다(`L0.readme` §2.2).

#### 4.4.1 위치

- 등록 파일 `<runtimeDir>/service.json`, 소켓 `<runtimeDir>/xeon.sock`. `runtimeDir`은 `xeon.os`의 `OsDirs.runtime`이다(§8.1 FR-P4). 경로 값(Linux `$XDG_RUNTIME_DIR/xeon`, macOS `$TMPDIR/xeon`)과 길이 초과 때 `/tmp/xeon-<uid>`로 내려가는 폴백, 디렉터리 0700·소유자 검사는 `L0.os.spec` §3.2만 정한다. 이 패키지는 경로를 다시 계산하지 않는다.
- [제안] 소켓 상대 경로 상한 `SOCKET_RELATIVE_PATH_MAX_BYTES = 24`. `runtimeDir` 아래 소켓 상대 경로(하위 디렉터리 포함)의 UTF-8 바이트 수는 24 이하다. `L0.os.spec` §3.2 runtime 길이 규칙의 여유 24바이트가 이 값이다. 기본 이름 `xeon.sock`은 9바이트, 아래 데이터 디렉터리 구분 이름 `d<8 hex>/xeon.sock`은 19바이트다.
- 같은 DB를 쓰는 서비스는 기계당 하나다. 데이터 디렉터리가 여럿이면(`--data-dir`) 그 경로 SHA-256 hex 앞 8자로 하위 디렉터리 `d<8 hex>/`를 만든다 [제안].
- 등록 파일에 실제 소켓 경로를 적으므로 클라이언트는 경로를 다시 계산하지 않는다.

#### 4.4.2 ensure

```text
ensureService():
  1. reg = registration.read()
  2. reg가 있으면:
       t = connect(reg.socket)               실패(refused, not_found) → 3
       p = probe(t, reg.token)               auth_failed → err(auth_failed). timeout → 3
       p.protocolVersion 주 버전이 다르고 p.idle → host.shutdown 요청, 종료 대기 → 3
       p.protocolVersion 주 버전이 다르고 바쁨 → err(protocol_unsupported) (경고 문구는 L4)
       p.version ≠ engineVersion이고 p.idle → host.shutdown 요청(reason version_replace), 종료 대기 → 3
       p.version ≠ engineVersion이고 바쁨 → ok(version_mismatch_busy) (경고하고 그대로 접속)
       그 밖 → ok(connected, started: false)
  3. spawnService()                         detached + unref
  4. startTimeoutMs(기본 10000 [제안]) 안에서 200 ms 간격으로 1~2를 다시 한다
       등록 파일이 새로 쓰이고 접속되면 ok(connected, started: true)
       시한을 넘으면 err(start_timeout)
```

- 버전 규칙: "한가하면 자동 재기동, 작업 중이면 경고"(adr.0006 §3.7 3번). 주 버전이 같고 부 버전만 다르면 바쁠 때 그대로 접속한다. 주 버전이 다르면 계약이 맞지 않으므로 접속하지 않는다(`F.wire-settings.spec` §4.1 2번 `isCompatible`).
- 재기동 중 진행 작업 손실을 막기 위해 "한가함"은 §4.4.4의 유휴 조건 중 `liveTasks = 0`과 `pendingSchedules = 0`만 본다(연결은 자기 자신이 있다).

#### 4.4.3 이중 기동 방지

[결정] 고정 소켓 경로를 먼저 바인드한 쪽이 이긴다(adr.0006 §3.7 2번, opencode contender, pi `acquireServerActivation` `PX/server.ts:154,200`).

1. 서비스 프로세스는 시작하자마자 `listenSocket(path)`를 시도한다.
2. `address_in_use`면 `connect(path)`로 상대를 확인한다. 접속되면 진 쪽이다. 등록 파일을 건드리지 않고 종료코드 0으로 끝난다.
3. `refused`(이전 서비스가 죽고 소켓 파일이 남음)면 stale 소켓이다. 지우기 전에 `xeon.store`의 `leases.acquire("service", holder)`를 얻는다(`L0.store.spec` §4.7). 임대를 얻은 쪽만 소켓 파일을 unlink하고 다시 바인드한다. 임대를 못 얻으면 다른 경합자가 처리 중이므로 진 쪽으로 끝난다. 판정과 unlink 사이의 경쟁(`_research/notes/L0-2.md §2.4`)을 이 임대로 막는다 [제안].
4. 바인드에 이긴 서비스만 엔진을 열고 등록 파일을 쓴다. 등록 파일 쓰기 전에 들어온 클라이언트 접속은 대기열에 두고 엔진이 열린 뒤 `host.hello`를 처리한다 [제안]. 바인드 직후 접속한 클라이언트가 오류 없이 이어지게 하기 위해서다.
5. 서비스는 종료 때 `removeIfOwned(pid, startedAt)`로 자기 등록 파일만 지운다.

#### 4.4.4 유휴 종료

- 조건: 연결 0 + live task 0 + 대기 예약 0이 `idleGraceMs`(기본 60000 [제안]) 동안 이어질 때만 종료한다(adr.0006 §3.7 4번). 시작 직후 `startupGraceMs`(10000, pi 선례) 동안은 판정하지 않는다.
- 승인 대기 세션은 live로 센다 [제안](adr.0006 §6 미결, Claude Code 선례 `CC/agent-view.md:819`). 사용자가 나중에 승인하러 돌아왔을 때 서비스가 떠 있어야 바로 이어지기 때문이다.
- 대기 예약이 하나라도 있으면 종료하지 않는다. 예약 틱은 서비스 프로세스 안에서 돈다(adr.0006 §3.5).
- 판정기는 상태 없이 입력 표본만 받는다. 입력이 바뀔 때마다 타이머를 다시 건다. 시계는 주입한다(수동 시계로 시험, TS-03).
- 유휴 종료도 `ProcessShutdown.request("idle")`을 거친다.

| 연결 | live task | 대기 예약 | 유예 경과 | 종료 |
|---|---|---|---|---|
| 0 | 0 | 0 | 예 | 예 |
| 0 | 0 | 0 | 아니오 | 아니오 |
| ≥1 | 0 | 0 | - | 아니오 |
| 0 | ≥1(승인 대기 포함) | 0 | - | 아니오 |
| 0 | 0 | ≥1 | - | 아니오 |

#### 4.4.5 인증

- 로컬 Unix 소켓: 소켓 파일 0600, 디렉터리 0700, 소유자 검사로 같은 사용자만 접속한다(adr.0006 §3.7 5번).
- [제안] Unix 소켓에서도 등록 파일의 토큰을 `host.hello` params의 `auth.token`으로 보낸다(심층 방어). 서버는 `verifyToken`(상수 시간 비교)이 거짓이면 `host.hello`를 거부하고 연결을 닫는다. hello 전 다른 메서드는 이미 1001로 거부된다(`F.wire-settings.spec` §4.1 1번). wire 스키마 변경 요청은 §8.1 FR-P2이고 `F.wire-settings.spec` §10 미결 4와 같은 질문이다.
- 원격(1차, M3): SSH 터널이나 사설망으로 연결된 클라이언트도 로컬 소켓에 접속하므로 같은 규칙을 쓴다. 터널 끝이 서버 쪽 사용자 권한으로 소켓에 접속하기 때문이다. 토큰 검사는 이 경로의 추가 방어다(미결 P-10).
- 내장 TCP·WebSocket(2차): 무작위 토큰 필수, `initialize`(`host.hello`) 전에 인증한다. 비루프백 리스너는 토큰 없이 기동하지 않는다(Codex app-server 선례).
- 토큰은 32바이트 무작위(`crypto.getRandomValues`, 주입), base64url. 등록 파일 밖으로 쓰지 않고 로그에 남기지 않는다.

#### 4.4.6 기동과 분리, 종료 협조, 소실

- 서비스는 `node:child_process.spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true })` 후 `unref()`로 부모에서 분리한다(adr.0006 §3.7 6번, pi `PX/process.ts:40-70`) [가정: Bun 1.4.3의 node 호환 `detached` 동작은 실측 전]. 서비스의 cwd는 홈 디렉터리로 둔다(opencode `server-process.ts:60-64`).
- 종료 협조: SIGTERM을 받으면 `ProcessShutdown.request("signal")`. 시한(`shutdown.timeoutMs`) 뒤 스스로 종료코드 1로 끝난다. `xeon service stop`(L4)은 먼저 `host.shutdown`을 보내고, 시한 + 1초 뒤에도 살아 있으면 SIGTERM, 다시 시한 뒤 SIGKILL을 보낸다(adr.0006 §3.7 7번).
- 서비스 소실: 클라이언트 쪽 socket 전송이 `onClose`(`eof`, `error`)를 받았고 자신이 닫지 않았다면, 클라이언트는 진행 중 요청을 실패로 끝내고 입력을 받지 않는 정지 상태로 간다. 자동 재접속은 하지 않는다 [제안]. 다음 `ensure`가 서비스를 다시 띄우고 복구 표식(§4.6)으로 재개 후보를 보인다(adr.0006 §3.7 8번).

#### 4.4.7 adr.0006 §3.7 체크리스트의 테스트 문장

| # | 항목 | 테스트 가능한 문장 |
|---|---|---|
| 1 | 등록 파일 | `write` 뒤 파일 모드가 0600이다. 스키마에 없는 필드 `{"future":1}`가 든 파일을 읽고 다시 쓰면 그 필드가 남는다. 모드가 0644인 파일은 `insecure_mode`로 읽기를 거부한다 |
| 2 | 기동 경합 | 같은 runtimeDir에서 `ensureService`를 동시에 두 번 부르면 살아 남는 서비스 프로세스가 하나이고, 두 호출 모두 같은 `pid`의 등록 정보로 `connected`를 받는다 |
| 3 | 버전 불일치 | 한가한 구버전 서비스에 `ensure`하면 구버전이 종료되고 새 버전이 뜬다. live task가 있는 구버전에는 `version_mismatch_busy`로 접속하고 구버전이 계속 돈다 |
| 4 | 유휴 종료 | §4.4.4 표의 다섯 행이 수동 시계 테스트에서 그대로 성립한다. 승인 대기 세션 1개만 있으면 종료하지 않는다 |
| 5 | 인증 | 토큰이 틀린 `host.hello`는 거부되고 연결이 닫힌다. hello 전 `turn.start`는 1001이다. 소켓 파일 모드가 0600이다 |
| 6 | 부모-자식 수명 | stdio 자식 엔진의 부모를 SIGKILL하면 자식이 `shutdown.timeoutMs` + 1초 안에 끝난다. `ensure`로 띄운 서비스는 띄운 CLI가 끝나도 살아 있다 |
| 7 | 종료 협조 | `host.shutdown` 요청에 서비스가 참여자를 모두 부른 뒤 응답하고 종료한다. 참여자가 시한을 넘기면 종료코드 1로 끝난다 |
| 8 | 단일 장애점 | 서비스를 SIGKILL하면 접속 중 클라이언트는 정지 상태가 되고 쓰기를 보내지 않는다. 다음 `ensure`가 새 서비스를 띄우고 복구 표식(`RecoveryMarker`)이 남은 세션을 재개 후보로 돌려준다 |

### 4.5 잠금 실패 동작 정책

- 세션 소유 판정은 OS 잠금(생존 판정) + `sys_leases.epoch` 펜싱이다(`L0.store.spec` §4.7.1과 같은 문장) [결정: review.decisions-2 U-09]. ADR-0004 §3.4와 ADR-0006은 이에 맞게 개정한다.
- store는 `LockBusy{ owner }` 정보만 돌려주고, 위임·관찰·분기 선택은 이 패키지의 `LockFallbackPolicy`가 정한다.
- `decide(context)` 규칙 [제안]:
  1. `requested`가 있으면 그 선택을 `act`로 돌려준다. 단 `delegate`인데 `serviceOwnsSession`이 거짓이면 `ask`로 바꾼다.
  2. `serviceOwnsSession`이면 `act(delegate)`(서비스가 있으면 위임이 기본, adr.0006 §3.6 3번).
  3. `interactive`이면 `ask`, 선택지 `[observe, fork]`(서비스가 소유자이면 규칙 2가 묻지 않고 위임하므로 `delegate`는 목록에 없다), 제안값은 설정 `l0.process.lockFallback.default`가 `ask`가 아니면 그 값, `ask`면 `observe`.
  4. 비대화(스크립트 실행, 예약)면 설정 기본값을 쓰고, 기본값이 `ask`면 `observe`.
- 세 선택의 동작(실행은 L4·L1):
  - 위임: 서비스 전송으로 소유자에게 입력을 보낸다(`turn.start`를 서비스가 처리).
  - 관찰: `thread.open { mode: "observe" }`, 읽기 전용으로 DB를 따라간다(`eng.events.design` §4.6).
  - 분기: `thread.fork`로 현재 시점에서 `parentId`를 가진 새 세션을 만들어 연다.
- wire 오류 `thread.locked`(3002)의 `details.options`는 이 결정의 선택지 목록과 같다. `ownerKind`는 `LockBusy.owner?.kind`다.
- 소유 표시: 별도 소유 테이블을 두지 않고 `sys_leases` 행이 표시를 겸한다(`kind` 열: cli|app|service) [결정: review.decisions-2 U-09]. 소유 판정은 OS 잠금과 epoch가 하고 `kind`·`pid`·`host`는 표시용이며, 표시 정보가 틀려도 안전하다(`L0.store.spec` §3.3과 같은 문장).

### 4.6 복구 표식 제시('이어서 실행')

- 세션 목록을 열 때와 서비스 시작 때 호스트(L4)가 `xeon.session`의 `query.thread(threadId).marker`(`ThreadSummaryRow.marker`, `L1.persistence.spec` §3.4)가 `null`이 아닌 thread를 모아 `ResumeCandidate[]`로 넘기고, `buildResumeOffers`가 후보를 만든다. 이 패키지는 DB를 직접 읽지 않는다. `runningSince`·`resumeAttempts`는 `RecoveryMarker`의 값을 그대로 옮긴다.
- `action` 판정 [제안]:
  - `resumeAttempts >= maxAttempts` → `exhausted`. 자동 재개하지 않고 사용자에게 "재개가 반복해서 실패했다"를 보인다.
  - `serviceMode && autoResumeEnabled` → `auto_resume`.
  - 그 밖 → `offer`.
- 자동 재개 설정은 `l1.persistence.autoResume`(기본 꺼짐)과 `l1.persistence.maxResumeAttempts` 둘이고 L1.persistence가 소유한다. 이 패키지는 설정 키를 두지 않고 호스트가 읽은 값을 `ResumePolicyInput`으로 받는다 [결정: review.decisions-2 S-03]. 자동 재개는 서비스 모드에서만 켠다(adr.0006 §3.6 5번). CLI·데스크톱 단독 모드에서는 설정이 켜져 있어도 `offer`다. 사용자가 없는 동안 비용과 부작용이 나는 일을 서비스 모드로 한정하기 위해서다.
- 다른 프로세스가 그 세션 임대를 쥐고 있으면(`heldBy`) 후보에 표시만 하고 재개 버튼 대신 §4.5 선택지를 보인다. 이 후보는 자동 재개 조건을 채워도 `offer`로 내리고, 시도 횟수 상한(`exhausted`)은 그대로 둔다.
- 재개 실행은 L1(`L1.persistence.spec` 재개 절차, `eng.events.design` §7.2)이 한다. 재개 시작 때 `thread.resumed`를 커밋하고, 투영 `p_threads.resume_attempts`가 그 커밋에서 오른다(`L1.persistence.spec` §4.8.1).
- 경계: 결과 불명 도구 호출은 자동 재실행하지 않고, 저장된 정책과 현재 선언이 모두 `replay: safe`인 도구만 재실행한다(adr.0006 §3.6 6번). 이 판정은 L1 몫이고 이 패키지는 관여하지 않는다.

### 4.7 OS 서비스 등록 (2차)

- `OsServiceRegistrar` provider를 `select.ts`가 고른다(DR-13).

| provider | 대상 | 위치 | 동작 |
|---|---|---|---|
| `launchd` | macOS 사용자 에이전트 | `~/Library/LaunchAgents/<label>.plist` | plist 쓰기(0644) 뒤 `launchctl bootstrap gui/<uid> <plist>`. 해제는 `launchctl bootout` 후 파일 삭제 |
| `systemd` | Linux 사용자 유닛 | `~/.config/systemd/user/<label>.service` | 유닛 쓰기 뒤 `systemctl --user daemon-reload`, `enable --now`. 해제는 `disable --now` 후 파일 삭제 |
| `none` | Windows(작업 스케줄러 또는 Windows 서비스, 미정), WSL에서 systemd가 없을 때 | - | `unsupported` |

- 명시 동의가 있어야만 설치한다. `install`은 `consent` 인자 없이 부를 수 없고, 동의 질문과 기록은 `xeon service install`(L4)이 한다(Hermes 선례 `HM/website/docs/user-guide/windows-native.md:243`).
- 등록된 유닛이 실행하는 명령은 `xeon service start --foreground`다. 이중 기동 방지는 §4.4.3 규칙이 그대로 막는다.
- 설정 충돌로 시작할 수 없을 때는 종료코드 78로 끝내 감독자의 재시작 반복을 멈춘다 [제안](Hermes `gateway-internals.md:613`).
- 예약 틱은 서비스 프로세스 안에서 돈다(adr.0006 §3.5). OS 등록은 재부팅 뒤 자동 시작만 더한다.

### 4.8 X 포트 `ProcessPort` 구현

`ProcessService`는 `ProcessPort`의 두 메서드를 구현한다. 메서드 이름과 인자 모양은 `F.extensions.spec` §3.2.1이 정본이고, 아래는 이 패키지의 동작 규칙이다 [제안]. ext-host는 `Bun.spawn`, `node:child_process`를 import하지 않으므로(DR-07) 이 두 경로는 이 패키지만 실행한다.

`run(spec: HookRunSpec): Promise<HookRawRun>`(외부 훅, `X.operations.spec` §3.7, M2):

1. `argv[0]`을 셸 없이 직접 실행한다. `cwd`와 `env`는 받은 값만 쓰고 부모 env를 상속하지 않는다. env 허용 목록 구성은 호출자(`hookEnv`, `X.operations.spec` §3.7)의 일이다.
2. `stdin` 문자열을 쓰고 닫는다. stdout·stderr는 각각 `maxStdoutChars`·`maxStderrChars`에서 자르고, stdout을 잘랐으면 `stdoutTruncated: true`다.
3. `signal`이 중단되면 프로세스 트리를 graceful로 멈추고 `l0.process.shutdown.timeoutMs` 뒤 force로 멈춘다. 결과는 `timedOut: true`다. 시간 예산은 호출자가 `signal`로 정한다.
4. 실행 파일이 없거나 권한이 없어 기동하지 못하면 거부(reject)하지 않고 `exitCode: null`, `spawnError: <코드>`(`"ENOENT"` 등)로 돌려준다. 해석은 `interpretHookRun`(X)이 한다. `argv`가 비었으면 `"EINVAL"`, 트리 종료 수단이 없는 OS면 `"unsupported_platform"`이다. 호출 시점에 `signal`이 이미 중단되어 있으면 띄우지 않고 `timedOut: true`로 돌려준다. 중단된 실행은 자식이 끝난 뒤에도 트리에 force를 한 번 더 보내 손자를 남기지 않는다.
5. 훅 프로세스는 레지스트리에 등록하지 않는다. 짧은 실행이므로 `signal`과 종료 협조(§4.2) 참여로 정리한다. 종료 협조가 시작되면 실행 중인 훅을 3번 규칙대로 멈춘다.

`spawn(spec: IsolationSpawnSpec): Promise<IsolatedChild>`(격리 확장 자식, `X.loading-trust.spec` §3.8, 2차):

1. `main`을 Bun으로 실행하고 `args`, `cwd`, `env`만 넘긴다. `env`는 호출자가 허용 목록으로 만든 값이다(DB 경로와 비밀 없음).
2. 기동한 자식은 레지스트리에 `owner.kind: "other"`, `owner.ref: spec.label`(`"ext:<name>:<generation>"`)로 등록한다. 그래서 `stopOwnedBy`와 종료 협조(§4.3)가 격리 자식도 정리한다.
3. `IsolatedChild.kill("SIGTERM" | "SIGKILL")`은 프로세스 트리 전체에 보낸다. `exited`는 레지스트리 항목의 종료와 같은 사건이다.
4. 1차 구현의 `spawn`은 자식을 띄우지 않고 거부(reject)한다. 조립 루트는 1차에서 `LoaderDeps.process`를 넣지 않으므로(`X.loading-trust.spec` §3.5) 운영 경로는 이 메서드를 부르지 않고, 격리 설정 확장은 `isolation_unavailable`이 된다 [제안].

### 4.9 MCP stdio 서버 포트 `McpProcessPort`

L2.mcp가 stdio 서버의 표준 입출력을 SDK 전송으로 감싸려면 스트림이 필요하다. `ProcessPort.spawn`(격리 확장용)과 `ExecService.startBackground`(스트림 없음)는 이 모양을 주지 못해서, 이 패키지가 `createMcpProcessPort(deps)`를 내놓는다 [결정: review.m2-plan §8 D6, 사용자 권한 실행]. 같은 모양을 `cap-mcp`가 `McpProcessPort`로 선언해 두었고(L2는 L0를 import하지 않는다), 조립 루트가 이 구현을 그 포트로 넘긴다. 두 선언은 구조가 같아야 한다.

파이프 기동은 `spawnPiped(input, deps)`(`src/port/spawn-piped.ts`)가 맡는다. 셸 없이 직접 실행하고, 부모 env를 상속하지 않고 받은 env만 쓰고, POSIX에서는 새 프로세스 그룹에 둔다. 레지스트리 등록과 비밀 주입은 하지 않는다. `createMcpProcessPort`가 그 위에 비밀 주입, 레지스트리 등록, 정지 순서를 더한다.

`spawn(spec: McpSpawnSpec, signal): Promise<Result<McpChild, McpSpawnError>>`:

1. `command`와 `args`를 셸 없이 직접 실행한다. 샌드박스를 거치지 않는다(사용자 권한, 위협 모델은 `architecture.security.spec`). Windows의 `.cmd` 셔임은 셸 없이 실행되지 않으므로 이 구현의 범위 밖이다 [미결 P-11].
2. 자식 env는 부모 env의 허용 목록(`L0.exec.spec` §3.5 `BASE_ENV_POLICY.pass`와 같은 이름, 거부 패턴 제외)에 `secretEnv`로 푼 값을 더해 만든다. 부모의 나머지 env는 넘기지 않는다.
3. `secretEnv`의 `secret://` 참조는 spawn 직전에 `SecretService.withEnv`로 푼다. `purpose`는 `mcp:<서버 id>`, `target`은 `{ kind: "command", argv0: command, commandLine: "<command> <args…>" }`, `actor`는 `runtime`, `approval`은 `null`이다. lease는 spawn 호출이 끝나면 닫고 값 사본을 지운다. 같은 핸들을 가리키는 env 이름이 여럿이어도 각각 푼다(승인은 `L0.secrets.spec` §4.2가 한 호출로 센다). 오류와 로그에는 참조 이름만 쓴다. 결과 매핑: 항목 없음은 `secret_missing`, 정책 거부는 `secret_denied`, 그 밖의 비밀 오류와 secrets 서비스가 없는 경우는 `spawn_failed`(`code: "secret_unavailable"`)다. 참조 형식이 아닌 값은 `secret_missing`이다.
4. env 모드는 실행마다 승인 증거를 요구하는데(`L0.secrets.spec` §4.2 6단계) 서버 시작에는 사람이 승인하는 지점이 없다. 그래서 M2에서는 `secretEnv`가 있는 서버가 `secret_denied`로 끝난다 [미결 P-12, M3로 이월]. 비밀 없는 서버는 영향이 없다.
5. 기동하지 못하면(`ENOENT`, `EACCES`) 거부(reject)하지 않고 `spawn_failed`와 errno 코드를 돌려준다. 트리 종료 수단이 없는 OS는 `unsupported_platform`, 호출 시점에 `signal`이 중단되어 있으면 `aborted`다.
6. 기동한 서버는 레지스트리에 `owner.kind: "mcp"`, `owner.ref: <서버 id>`, `label`로 등록한다. `McpChild.kill("SIGTERM" | "SIGKILL")`은 트리 전체에 보낸다.
7. 정지 순서는 stdin 닫기, 유예(`stdinCloseMs`, 기본 500ms), SIGTERM, 유예(레지스트리의 `graceMs`), SIGKILL이다. 레지스트리의 `graceful` 단계가 stdin을 닫고 서버가 그 사이에 끝나면 신호를 보내지 않는다. 끝나지 않으면 트리에 SIGTERM을 보내고, 레지스트리가 시한 뒤 `force`(SIGKILL)를 부른다. 그래서 종료 협조(§4.3)가 모든 MCP 서버의 트리를 이 순서로 정지한다.
8. `exited`는 프로세스 종료와 stdout 닫힘이 모두 끝난 뒤 이행한다. 서버가 마지막 응답을 쓰고 바로 끝나도 그 출력을 읽을 수 있다. 프로세스가 끝나면 남은 손자를 force로 정리하고, 그래도 파이프가 `drainMs` 안에 닫히지 않으면 스트림을 닫고 이행한다.
9. stdin 오류(`EPIPE`)는 처리기를 달아 둔다. 전송이 시작하기 전에 서버가 죽어도 엔진이 처리되지 않은 오류로 끝나지 않는다.

## 5. 실패와 경계 사례

| 경우 | 동작 |
|---|---|
| stdio 프레임이 1 MiB 초과 | 그 프레임 버림, `-32600`(`details.issue: "frameTooLarge"`) 송신, 연결 유지 |
| JSON 아닌 줄 | `-32700` 송신, 연결 유지 |
| 자식 엔진 stdout에 로그가 섞임 | 클라이언트 쪽 `-32700`이 반복된다. 엔진 로그는 stderr 전용(§4.1) |
| `host.shutdown` 응답 전에 stdin EOF | 같은 종료 요청으로 합친다(두 번째 `request`는 첫 Promise) |
| 종료 참여자가 예외 | 진단에 남기고 다음 참여자를 부른다. 종료코드는 0을 유지한다 [제안] |
| 등록 파일은 있으나 pid가 다른 프로세스(pid 재사용) | 접속이 `refused`이므로 3단계로 간다. `startedAt` 지문은 진단과 `removeIfOwned`에 쓴다 |
| 등록 파일 모드가 0600이 아님 | `insecure_mode`. 접속하지 않고 L4가 경고한다. 서비스는 다음 기동 때 다시 0600으로 쓴다 |
| 소켓 경로 길이 초과 | 폴백은 `xeon.os`가 `OsDirs.runtime`을 정할 때 이미 했다(`L0.os.spec` §3.2). 그래도 넘으면 `path_too_long`. runtime 디렉터리 소유자가 다르면 `xeon.os` 등록이 `not_owned`로 실패한다 |
| 서비스 기동 시한 초과 | `start_timeout`. L4가 로그 위치를 보인다 |
| 유휴 종료 직전에 새 연결 | `update`가 타이머를 취소한다. 종료 요청이 이미 시작됐으면 새 연결은 `host.shuttingDown`(5002) |
| 버전 교체 재기동 중 다른 클라이언트가 접속 | 구서비스는 `host.shuttingDown`, 클라이언트는 `retryAfterMs` 뒤 `ensure`를 다시 한다 |
| 백그라운드 프로세스가 정지 요청을 무시 | `graceMs` 뒤 `force`. 그래도 남으면 `lost`로 표시하고 진단에 남긴다 |
| launchd·systemd 명령 실패 | `command_failed`. 파일을 되돌린다 |

### 5.1 플랫폼별 제약

| 항목 | macOS | Linux(WSL2 포함) | Windows(이후) |
|---|---|---|---|
| Unix 소켓 경로 길이 | `sun_path` 104바이트 | 108바이트 | AF_UNIX 지원(Windows 10 1803 이후) [가정], 경로 108바이트 [가정] |
| 서비스 전송 | Unix 소켓 | Unix 소켓. WSL은 리눅스 쪽 경로(`/mnt/*` 금지) | 대안 비교표 아래, [미결 P-6] |
| 협조 종료 신호 | SIGTERM | SIGTERM | SIGTERM이 협조 종료로 전달되지 않는다. 전송 메시지 `host.shutdown`이 유일한 협조 경로 |
| 자식 분리 | `detached` + `unref`(새 세션) | 같음 | `detached`는 새 콘솔 창을 만들 수 있다. `windowsHide: true` 필수 [가정] |
| 사이드카 정리 | stdin EOF 임대 | 같음 | 같음. Tauri의 job 핸들 정리는 확인되지 않았다(adr.0008 §4.2) |
| 프로세스 지문 | `sysctl kern.proc.pid`의 시작 시각 또는 `ps -o lstart=` [가정] | `/proc/<pid>/stat` 22번째 필드(부팅 뒤 클록 틱) + `/proc/sys/kernel/random/boot_id` | `GetProcessTimes` 생성 시각 [가정] |
| OS 서비스 등록 | launchd 사용자 에이전트 | systemd 사용자 유닛. WSL은 systemd 켜짐 여부에 따른다 | 미정(작업 스케줄러 또는 Windows 서비스) |
| 프로세스 트리 종료 | 프로세스 그룹 kill | 같음 | `taskkill /T` 또는 job 객체 [가정] |
| 파일 권한 0600/0700 | 지원 | 지원. `/mnt/*`는 권한이 의미 없으므로 runtimeDir로 쓰지 않는다 | ACL. `L0.os.spec` [가정] |

Windows 서비스 전송 대안 비교(조사 대상 아님, 비교만):

| 안 | 인증 | 장점 | 단점 | F `TransportKind` 영향 |
|---|---|---|---|---|
| AF_UNIX 소켓 | 파일 ACL | 코드가 macOS·Linux와 같다 | Bun의 Windows AF_UNIX 지원 [가정], ACL 설정 코드 필요 | 없음(`socket`) |
| named pipe(`\\.\pipe\xeon-<user>`) | 파이프 보안 기술자 | Windows 표준 IPC | 별도 구현, Bun 지원 [가정] | `socket`에 경로 형식만 다르게 둘지, 새 종류를 둘지 |
| loopback TCP + 토큰 | 토큰(필수) | 어디서나 동작 | 같은 기계 다른 사용자가 포트에 접속 시도 가능. 토큰이 유일한 방어 | 새 종류(`tcp`) 필요 |

## 6. 설정 노출

`defineSettings("l0.process", …)`로 선언한다. 모두 `layer: "L0"`, `since: "0.1.0"`, L4 탭은 `execution`("실행과 서비스", adr.0006 §3.4)이다.

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | L4 노출 |
|---|---|---|---|---|---|---|
| `l0.process.service.enabled` | boolean | false | - | restart | managed, user | `execution` 탭 토글 "공유 서비스 모드" |
| `l0.process.service.idleGraceMs` | integer | 60000 [제안] | 1000~86400000 | live | managed, user | `execution` 탭 |
| `l0.process.service.startTimeoutMs` | integer | 10000 [제안] | 1000~120000 | live | managed, user | 파일만 |
| `l0.process.shutdown.timeoutMs` | integer | 3000 | 500~60000 | live | managed, user | `execution` 탭 |
| `l0.process.lockFallback.default` | string | `"ask"` | enum `ask`, `observe`, `fork` | live | managed, user, project | `execution` 탭 select |

- 자동 재개 키는 이 표에 두지 않는다. `l1.persistence.autoResume`, `l1.persistence.maxResumeAttempts`(`L1.persistence.spec` §6)가 정본이다 [결정: review.decisions-2 S-03].
- `startupGraceMs`(10000)는 설정으로 열지 않는다 [제안].

## 7. 확장 지점

- 이 도메인은 on·post·drive·scope 지점을 선언하지 않는다.
- 확장은 `xeon.process`의 `shutdown.onShutdown`으로 종료 협조에 참여할 수 있다. 시한 안에 끝나지 않는 참여자는 기다리지 않는다.
- 확장이 장시간 프로세스를 띄우면 `background.register`로 등록해야 세션 닫기와 종료에서 정리된다. 확장은 `node:child_process`를 직접 쓸 수 없고 `xeon.exec`를 거친다(DR-07).
- X는 `ProcessPortKey`로 이 서비스를 `ProcessPort`로 받아 외부 훅(`run`)과 격리 자식(`spawn`)을 실행한다(§4.8). 확장 코드는 이 포트를 직접 받지 않는다.

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `ProcessService`(`ProcessPort` 확장), `ProcessServiceName`(`xeon.process`), `BackgroundRegistry`, `ShutdownCoordinator` | X.operations.spec §3.7(`run`), X.loading-trust.spec §3.8(`spawn`, 2차), L1.tools.spec, L1.loop.spec, L1.persistence.spec, L2.mcp.spec, L2.schedule.spec, L4.host-service.spec. `eng.context-map.design` §5.3의 소비 열(mcp, schedule, host)에 tool-runtime, run-engine(loop), session-core(persistence)를 더하도록 요청한다(`L0.readme` §9 미결 9) |
| `createInProcessPair`, `createStdioTransport`, `listenSocket`, `connectSocket` | L4.host-service.spec, L4.cli.spec, F.wire-settings.plan(전송 적합성 스위트 A10) |
| `watchChildLease`, `createProcessShutdown` | L4.host-service.spec |
| `ServiceRegistration`, `RegistrationStore`, `ensureService`, `createIdleMonitor`, `verifyToken` | L4.host-service.spec. L4.cli.spec·L4.desktop.spec은 `apps/host` 경유(§3.2) |
| `LockFallbackPolicy`, `LockFallbackChoice` | L4.host-service.spec(`thread.locked` 조립). L4.cli.spec·L4.desktop.spec은 `apps/host` 경유 또는 wire 오류 `thread.locked`로 받는다 |
| `buildResumeOffers`, `ResumeOffer`, `ResumeCandidate` | L4.host-service.spec. L4.desktop.spec은 wire(`thread.list`)로 받는다 |
| `OsServiceRegistrar`(2차) | L4.host-service.spec(`xeon service install`) |
| 설정 `l0.process.*` | L4.settings-ui.spec |
| `@xeon/platform-process/testing`: `runFakeEngine`·`spawnFakeEngine`(stdio 전송 + `watchChildLease` + `host.shutdown` 처리기 + 지연 가능한 종료 참여자를 가진 자식 진입점과 실행기), `serveConformanceHost`(적합성 케이스가 도는 최소 서버), `idleClock`(수동 시계와 `Scheduler`를 묶은 유휴 타이머 도우미, 서비스 모드 때 추가) | L4.host-service.plan, L4.desktop.plan(사이드카 시험), `L0.process.plan` |

요구:

| 이름 | 출처 |
|---|---|
| `Transport`, `TransportKind`, `CloseInfo`, `InProcessTransportFactory`, `StdioTransportFactory`, `SocketTransportOptions`, `WIRE_LIMITS`, `JsonRpcMessage` | F.wire-settings.spec §3.1·§3.2 |
| `LockBusy`, `LeaseOwnerInfo`, `StoreService.leases` | L0.store.spec §3.1(FR-S2) |
| `RecoveryMarker` 타입, 표식 값(호스트가 `query.thread(threadId).marker`로 읽어 넘김) | L1.persistence.spec §3.4·§3.6(그 문서 §8.3 FR-P1), L4.host-service.spec |
| `ThreadId` | F.conversation.spec §3.2 |
| `dirs.runtime`(폴백 포함), `dirs.home`, `processStartFingerprint(pid)`, `userId`, `time.clock`·`time.scheduler` | L0.os.spec §3.2·§3.4·§3.10 |
| `ExecService.startBackground`와 `BackgroundExecHandle`(pid, graceful·force 정지, `exited`) | L0.exec.spec §3.9(등록자가 핸들을 `BackgroundStopper`로 넘긴다) |
| 대기 예약 수 | L2.schedule.spec(`ScheduleService`) |
| live task 수(진행 턴, 승인 대기) | L1.tasks.spec `ActivitySnapshot`, L4.host-service.spec |

### 8.1 F와 다른 문서에 요청

| id | 대상 | 요청 | 이유 |
|---|---|---|---|
| FR-P1 | F.wire-settings.spec §3.3.1 | 메서드 `host.shutdown { reason: "client_exit"\|"version_replace"\|"user", deadlineMs?: integer }` → `{ accepted: boolean }`를 더한다(M2). 응답은 참여자 처리가 끝난 뒤 보낸다 | Tauri가 SIGKILL만 보내고 Windows에 SIGTERM 협조가 없어 전송 메시지가 협조 종료의 유일한 공통 경로다(adr.0006 §3.7 7번, adr.0008 §3.3) |
| FR-P2 | F.wire-settings.spec §3.3.1, §10 미결 4 | `host.hello` params에 `auth?: { token: string }`을 더하고 오류 `host.authFailed`를 정한다 | 서비스 모드 인증을 hello 전에 끝낸다(adr.0006 §3.2) |
| FR-P3 | F.wire-settings.spec(새 파일 `wire/service-registration.ts`) | `ServiceRegistrationSchema`를 F에 둔다 | CLI·데스크톱(L4)과 platform-process가 같은 스키마를 읽는다. L4 앱끼리 import하지 않는다(DR-10) |
| FR-P4 | L0.os.spec | `runtimeDir()`, `processStartFingerprint(pid)`, `userId()`를 `OsService`에 둔다(반영됨: `dirs.runtime`, `processStartFingerprint`, `userId`, `L0.os.spec` §3.10) | DR-13. L0끼리는 서비스로만 협력한다 |
| FR-P5 | F.conversation.spec §3.2.1 | 반영되었다. `LocalIdPrefix`에 `bgp`가 있다. `BackgroundProcessId`는 `LocalId<"bgp">`다 | `BackgroundProcessId` 형식 |
| FR-P6 | F.readme §6, F.wire-settings.spec §1.2 | "전송 구현은 L4" 줄을 "전송 구현은 `L0.process.spec`, 조립은 L4"로 고친다(미결 P-3 권고 채택 시) | 배치 정합 |
| FR-P7 | F `@xeon/contracts/services`(`services/process.ts`, review.decisions-2 D-04) | §3.1의 `ProcessServiceName`, `ProcessService`(`ProcessPort` 확장), `BackgroundRegistry`와 관련 타입, `ShutdownCoordinator`, `ShutdownReason`을 둔다. 이름은 `F.capabilities.spec` §3.12 표와 `services/process.ts` 행에 반영되었고, 필드는 §3.1 블록을 옮겨 확정한다(`F.capabilities.plan` P9) | 같은 층 import 금지(DR-02). X가 `ProcessPortKey`로 받는다(`F.extensions.spec` §9 13) |
| FR-P8 | adr.0006 §3.3, §3.6 규칙 1·4, adr.0004 §3.4 | `HostTransport`·`service` 이름을 F 이름으로, 소유 판정을 OS 잠금 + epoch 펜싱으로, `session_owner`를 지우고 `sys_leases` 행이 표시를 겸하게 고친다 [결정: review.decisions-2 U-09] | 문서 사이 상충 |

## 9. 수용 기준

1. `ensureService`를 같은 runtimeDir에서 동시에 두 번 부르면 서비스 프로세스는 하나만 남고, 두 결과가 같은 `pid`를 가리킨다.
2. stdio 자식 엔진을 띄운 부모를 `kill -9`하면 자식이 `shutdown.timeoutMs` + 1초 안에 종료하고 남은 프로세스가 없다.
3. 등록 파일은 0600으로 쓰이고, 모르는 필드를 보존하며, 쓰기 중 프로세스를 죽여도 이전 내용이나 새 내용 중 하나가 온전하다(임시 파일 + rename).
4. 유휴 종료 판정기가 §4.4.4 표의 다섯 조합을 수동 시계에서 그대로 낸다. 승인 대기 세션을 live로 센다.
5. 토큰이 다른 `host.hello`는 거부되고 연결이 닫힌다.
6. `LockFallbackPolicy.decide`가 위임(서비스 소유), 관찰, 분기 각각의 입력에서 §4.5 규칙대로 결정하고, 세 선택 각각에 대해 L4 통합에서 `turn.start` 전달, 읽기 전용 열기, `parentId` 있는 새 세션이 확인된다.
7. 같은 전송 적합성 케이스(`F.wire-settings.spec` §9 A10)를 in-process와 stdio가 같은 결과로 통과한다.
8. 1 MiB + 1바이트 프레임은 버려지고 `-32600`이 오며, 다음 프레임은 정상 처리된다. 프레임이 여러 청크로 나뉘거나 한 청크에 여러 프레임이 와도 같은 메시지열이 나온다.
9. `host.shutdown` 요청 뒤 참여자가 시한을 넘기면 종료코드 1, 시한 안이면 0이다. 복구 표식은 지워지지 않는다.
10. 레지스트리에 등록한 프로세스 트리(자식 + 손자)가 `stopOwnedBy`와 종료 협조 뒤 모두 사라진다.
11. 자동 재개는 기본값에서 `offer`이고, 서비스 모드 + `l1.persistence.autoResume` 켬일 때만 `auto_resume`, `resumeAttempts >= l1.persistence.maxResumeAttempts`면 `exhausted`다. `l0.process.*` 설정 선언에 자동 재개 키가 없다.
12. 서비스를 SIGKILL하면 접속 중 클라이언트가 정지 상태로 가고, 다음 `ensure`가 재개 후보를 돌려준다.
13. `platform-process`가 다른 `@xeon/platform-*` 패키지를 import하지 않는다(DR-02).
14. `ProcessService` 구현 객체가 `ProcessPort`에 대입된다(타입 테스트). `run`은 없는 실행 파일에 대해 거부하지 않고 `spawnError`를 채운 `HookRawRun`을 돌려주고, `maxStdoutChars`보다 긴 출력은 잘리고 `stdoutTruncated: true`이며, `signal` 중단 뒤 프로세스 트리가 남지 않고 `timedOut: true`다(실제 자식 프로세스).
15. `run`에 넘긴 `env`에 없는 부모 env 변수(예: 시험 부모의 `PATH`, `HOME`)가 훅 프로세스 env에 없다.
16. `McpProcessPort.spawn`(실제 자식 프로세스, `mcp-spawn.int.test.ts`): 줄 단위 JSON이 양방향으로 오가고, 레지스트리에 `owner.kind: "mcp"`로 등록되며, 자식 env에 부모의 제공자 키(`ANTHROPIC_*`, `XEON_*`)가 없고 `secretEnv` 값만 더해진다. 기동 실패는 `spawn_failed`(`ENOENT`), 비밀 실패는 `secret_missing`·`secret_denied`로 돌아오며 이미 연 lease는 모두 닫힌다. 종료 직전에 쓴 출력을 읽는다.
17. MCP 서버 정지 순서: stdin 닫힘과 SIGTERM을 모두 무시하는 서버에 `background.stop`을 하면 서버가 받은 사건 순서가 `stdin-closed`, `sigterm`이고 마지막에 `SIGKILL`로 끝난다. stdin을 닫으면 끝나는 서버는 신호 없이 `exited`가 된다. 레지스트리를 닫으면 자식과 SIGTERM을 무시하는 손자가 모두 사라진다.

## 10. 미결 사항

- [결정: review.decisions-2 U-09] P-1. 세션 소유 판정은 OS 잠금 + `sys_leases` epoch 펜싱이다. adr.0004 §3.4 개정 대상이다. `L0.store.spec` S-1과 같은 항목이다.
- [결정: review.decisions-2 U-09] P-2. adr.0006 §3.6 규칙 4의 `session_owner`는 두지 않고 `sys_leases` 행이 표시를 겸한다. `L0.store.spec` S-2와 같은 항목이다.
- [미결 P-3] 전송 구현 배치: L0 구현 + L4 조립(권고) 또는 L4 구현(`F.readme` §6).
- [미결 P-4] 백그라운드 프로세스 종료 수단. 권고는 `xeon.exec`의 `startBackground`(`L0.exec.spec` §3.9) 핸들을 등록자가 `BackgroundStopper`로 넘기는 방식이다. stdin 파이프가 필요한 MCP stdio 서버(`L0.exec.spec` §10 9번)는 §4.9에서 이 패키지가 `select.ts`의 provider(`signalTree`)로 직접 띄우고 등록한다. 남은 것은 그 밖의 등록자다.
- [미결 P-5] 엔진 진입점 `Runtime.open(dbPath)`의 시그니처와 소유. 권고는 L4 `apps/host`가 소유하고 `openRuntime({ dbPath, transport, … }): Promise<Result<Runtime, RuntimeOpenError>>` 모양이다. F에 둘지 함께 정한다.
- [미결 P-6] Windows 서비스 전송(AF_UNIX, named pipe, loopback TCP + 토큰). §5.1 비교표.
- [미결 P-7] 자동 재개 기본값(adr.0006 §6). 키 소유는 `L1.persistence.spec`이고 기본값 판단도 그 문서 미결 4로 옮겼다. 이 문서의 권고는 꺼짐, 서비스 모드에서만 켤 수 있음이다.
- [미결 P-8] 승인 대기 세션을 유휴 판정에서 live로 볼지(adr.0006 §6). 권고는 live.
- [결정: review.decisions-2 U-11] P-9. 원격은 1차(M3)이고 로컬 서비스 소켓을 SSH 터널이나 사설망으로 연결한다. 내장 TLS + 토큰 WebSocket(PR-18)은 2차다.
- [미결 P-10] Unix 소켓에서도 토큰을 요구할지(FR-P2, `F.wire-settings.spec` §10 미결 4).
- [미결 P-11] Windows에서 `.cmd` 셔임(`npx.cmd` 등)으로 stdio MCP 서버를 띄우는 방법. 셸 없이 실행할 수 없어 `cross-spawn` 같은 해석이 필요하다. 1차 지원 OS(macOS, Linux, WSL)에는 해당이 없다.
- [미결 P-12] 비밀 env가 있는 MCP stdio 서버(M3). env 모드는 실행마다 승인 증거를 요구하고(`L0.secrets.spec` §4.2), 서버 시작에는 승인 지점이 없어 `secret_denied`가 된다. 서버 정의를 추가하거나 처음 연결할 때 사람이 승인하고 그 증거를 `McpSpawnSpec`에 싣는 흐름이 필요하다. 승인 서비스와 `L2.mcp.spec`의 합의 사항이다.
- [가정] Bun 1.4.3의 `node:child_process` `detached`·`unref`와 `Bun.listen({ unix })`의 macOS 동작은 실측하지 않았다.
