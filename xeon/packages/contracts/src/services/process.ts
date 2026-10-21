import type { Result } from "../base/index.ts";
import type { LocalId } from "../conversation/index.ts";
import type { ProcessPort } from "../extensions/index.ts";

// L0.process.spec §3.1. 구현은 platform-process다. ProcessService는 X 포트 ProcessPort(F.extensions.spec §3.2.1,
// IsolationProcessPort와 HookProcessPort를 합친 포트)를 확장한다. 포트 메서드(spawn, run)와 부속 타입은 extensions가 정본이다.
// 전송, 잠금 실패 정책, 재개 제시, 서비스 등록 파일은 Cordis 서비스가 아니라 조립 루트가 쓰는 라이브러리 함수다(L0.process.spec §3.2, M2).

export const ProcessServiceName = "xeon.process" as const;

/** "bgp_<ULID>". F.conversation.spec §3.2.1 LocalIdPrefix, 발급은 LocalIdFactory.next("bgp") */
export type BackgroundProcessId = LocalId<"bgp">;
export type BackgroundOwnerKind = "tool" | "mcp" | "schedule" | "other";
export type BackgroundState = "running" | "stopping" | "exited" | "killed" | "lost";

export interface BackgroundOwner {
  readonly kind: BackgroundOwnerKind;
  /** 세션에 묶인 작업이면 ThreadId */
  readonly threadId: string | null;
  /** toolCallId, MCP 서버 이름 등 */
  readonly ref: string | null;
}

/** 등록자가 넘기는 정지 수단. 프로세스를 띄운 쪽(xeon.exec 등)이 프로세스 그룹 kill을 구현한다 */
export interface BackgroundStopper {
  /** graceful: SIGTERM(Windows는 트리 종료 요청). force: SIGKILL. 프로세스 트리 전체 */
  stop(mode: "graceful" | "force"): Promise<void>;
  /** 종료되면 이행. 종료 코드, 신호 이름 */
  readonly exited: Promise<{ readonly code: number | null; readonly signal: string | null }>;
}

export interface RegisterBackgroundInput {
  /** 화면 표시. 비밀 값을 넣지 않는다 */
  readonly label: string;
  readonly owner: BackgroundOwner;
  readonly pid: number;
  readonly stopper: BackgroundStopper;
}

export interface BackgroundProcessInfo {
  readonly id: BackgroundProcessId;
  readonly label: string;
  readonly owner: BackgroundOwner;
  readonly pid: number;
  /** epoch ms, 등록 시각 */
  readonly startedAt: number;
  readonly state: BackgroundState;
  readonly exitCode: number | null;
}

export type BackgroundError =
  | { readonly kind: "not_found"; readonly id: BackgroundProcessId }
  | { readonly kind: "registry_closed" };

export interface BackgroundRegistry {
  register(input: RegisterBackgroundInput): Result<BackgroundProcessId, BackgroundError>;
  list(filter?: {
    readonly threadId?: string;
    readonly kind?: BackgroundOwnerKind;
  }): readonly BackgroundProcessInfo[];
  get(id: BackgroundProcessId): BackgroundProcessInfo | undefined;
  /** graceful → graceMs 뒤 force. 이미 끝났으면 ok */
  stop(
    id: BackgroundProcessId,
    options?: { readonly graceMs?: number },
  ): Promise<Result<BackgroundState, BackgroundError>>;
  /** 세션을 닫거나 임대를 잃을 때 */
  stopOwnedBy(threadId: string, options?: { readonly graceMs?: number }): Promise<number>;
  onChange(listener: (info: BackgroundProcessInfo) => void): () => void;
}

export type ShutdownReason =
  | "stdin_eof"
  | "shutdown_request"
  | "signal"
  | "idle"
  | "service_lost"
  | "version_replace";

/** 엔진 플러그인이 종료 협조에 참여하는 창구 */
export interface ShutdownCoordinator {
  /** 종료가 요청되면 중단되는 신호. 루프는 안전 경계에서 이 신호를 확인한다 */
  readonly signal: AbortSignal;
  readonly reason: ShutdownReason | null;
  /** 참여자. 종료 요청 때 순서대로(등록 역순) 부르고 시한 안에 끝나기를 기다린다 */
  onShutdown(name: string, participant: (reason: ShutdownReason) => Promise<void>): () => void;
}

/** ProcessPort의 spawn·run을 함께 구현한다 */
export interface ProcessService extends ProcessPort {
  readonly background: BackgroundRegistry;
  readonly shutdown: ShutdownCoordinator;
}
