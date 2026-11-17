// 플러그인 호스트 프로세스 감독(M5b-1). 엔진 쪽이 프로세스 하나를 띄우고, 줄 프레이밍으로 요청과 응답을 주고받고,
// 시작, 유휴 내리기, 시간 초과 종료, 죽음 셈, 재시작 한도를 정한다. 띄우기는 주입된 포트(IsolationProcessPort)가 맡는다.
// 던지지 않는다. 예상 가능한 실패는 모두 Result 값이다. 표준오류는 마스킹한 뒤 줄 수를 제한해 모은다.
import { createHash } from "node:crypto";
import { Type } from "typebox";
import {
  assertNever,
  attempt,
  attemptAsync,
  detach,
  err,
  ok,
  parse,
  repeatAsync,
  type Logger,
  type ParseError,
  type Result,
} from "@fresnel/contracts";
import {
  JsonValueSchema,
  toJsonValue,
  type JsonObject,
  type JsonValue,
} from "@fresnel/contracts/conversation";
import {
  DriveLimitsSchema,
  PLUGIN_HOST_ERROR_KINDS,
  PLUGIN_HOST_PROTOCOL_VERSION,
  PLUGIN_HOST_STDERR_LINE_MAX,
  PLUGIN_HOST_STDERR_LINES_MAX,
  PLUGIN_HOST_MAX_FRAME_BYTES,
  type EngineCallParams,
  type HostDisposeParams,
  type HostInitParams,
  type HostInitResult,
  type IsolatedChild,
  type IsolationProcessPort,
  type IsolationSpawnError,
  type IsolationSpawnSpec,
  type PluginHostError,
  type PluginHostErrorKind,
  type PluginHostFrame,
  type PluginHostNotificationName,
  type PluginHostRequestName,
  type PluginProcessFailureReason,
  type ClassifiedFrame,
} from "@fresnel/contracts/extensions";
import {
  createFrameReader,
  createFrameWriter,
  type FrameReadResult,
  type FrameWriteError,
  type FrameWriter,
} from "./framing.ts";
import { parseEngineCallParams } from "./engine-calls.ts";

const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
const DEFAULT_MAX_RESTARTS = 1;
const MESSAGE_MAX = 4000;
const ENCODER = new TextEncoder();

/** 감독이 보는 프로세스 상태. `starting`은 띄우고 `host.init`을 기다리는 동안이다 */
export type PluginHostStatusState = "idle" | "starting" | "running" | "stopped" | "restart_limit";

export interface PluginHostStatus {
  readonly state: PluginHostStatusState;
  readonly pid: number | null;
  /** 연속으로 죽은 횟수. 성공한 호출 응답이 0으로 되돌린다 */
  readonly deaths: number;
  /** 지금 상태가 된 시각(deps.now) */
  readonly since: number;
}

/** 시작과 감독 수준의 실패. `start`의 값이고, 호출이 시작을 맡을 때도 같은 값을 `CallError`로 돌려준다 */
export type SupervisorError =
  | { readonly kind: "spawn_failed"; readonly message: string }
  | { readonly kind: "sandbox_unavailable"; readonly message: string }
  /** 자식이 `host.init`을 거부했거나 응답이 맞지 않는다. `hostKind`는 자식이 보낸 오류 종류다 */
  | { readonly kind: "init_failed"; readonly hostKind: string; readonly message: string }
  | { readonly kind: "init_timeout"; readonly message: string }
  | { readonly kind: "process_exit"; readonly message: string }
  | { readonly kind: "restart_limit"; readonly message: string }
  | { readonly kind: "declarations_changed"; readonly message: string }
  | { readonly kind: "disposed"; readonly message: string };

/**
 * 호출 실패. 프로세스가 끝났거나(`process_exit`) 엔진이 멈췄거나(`process_killed`) 시작이 실패한 경우는 `SupervisorError`다.
 * 그 밖에는 자식이 답한 오류 종류(`PluginHostErrorKind`)를 그대로 싣는다
 */
export type CallError =
  | SupervisorError
  | {
      readonly kind: "process_killed" | "invalid_response" | PluginHostErrorKind;
      readonly message: string;
    };

/** 호출 옵션. 취소 신호는 `TimeoutError` 사유로 abort하면 프로세스를 멈추고, 그 밖의 사유면 이 호출만 취소한다 */
export interface PluginCallOptions {
  readonly signal?: AbortSignal;
  /** 시간 한도(ms). 넘으면 프로세스를 멈춘다 */
  readonly deadlineMs?: number;
  /**
   * 요청 프레임의 id를 알려 준다(쓰기 직전, 동기). 자식이 이 요청 때문에 보낸 `engine.call`은 `requestId`로 이 id를 실어 온다.
   * 대리 등록이 호출 때의 디스패치 문맥을 그 호출에 잇는 데 쓴다(isolation/proxy-entry.ts)
   */
  readonly onRequestId?: (id: number) => void;
}

/** 재시작 한도를 넘었을 때 한 번 알린다. 앱은 이 알림으로 플러그인을 끌지 묻는다 */
export interface RestartLimitInfo {
  readonly deaths: number;
  readonly reason: PluginProcessFailureReason;
  /** 띄울 때의 라벨 `ext:<이름>:<versionId>` */
  readonly label: string;
}

export interface PluginHostSupervisorDeps {
  readonly process: IsolationProcessPort;
  /** 띄울 때마다 읽는다. 허용 목록 환경만 담는다 */
  readonly specOf: () => IsolationSpawnSpec;
  /** 취소 함수를 돌려준다. ext-host의 시계 주입과 같은 모양이다 */
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  readonly now: () => number;
  readonly logger: Logger;
  /** `host.init`의 params. 엔진이 만든다 */
  readonly initParams: () => HostInitParams;
  /** 마지막 호출 뒤 이 시간이 지나면 프로세스를 내린다. 기본 60초 */
  readonly idleMs?: number;
  /** `host.init` 응답 시간 한도 */
  readonly initTimeoutMs: number;
  /** 멈춤 요청 뒤 강제 종료까지 기다리는 시간. 기본 2초 */
  readonly killGraceMs?: number;
  /** 죽은 뒤 다시 띄우는 횟수. 기본 1 */
  readonly maxRestarts?: number;
  /** 자식이 보낸 `engine.call`을 처리한다. 등록 라우터(`createEngineCallRouter`)가 맡는다 */
  readonly onEngineCall: (params: EngineCallParams) => Promise<Result<JsonValue, PluginHostError>>;
  readonly onRestartLimit: (info: RestartLimitInfo) => void;
  /** 표준오류 한 줄을 저장하기 전에 거른다(시크릿 마스킹). 던지면 그 줄은 버린다 */
  readonly maskSecrets?: (line: string) => string;
}

export interface PluginHostSupervisor {
  /** 띄우고 `host.init`을 기다린다. 이미 떠 있으면 같은 결과를 돌려준다 */
  start(): Promise<Result<HostInitResult, SupervisorError>>;
  /** 요청 하나를 보내고 응답을 기다린다. 떠 있지 않으면 먼저 띄운다 */
  call(
    method: PluginHostRequestName,
    params: JsonValue,
    options?: PluginCallOptions,
  ): Promise<Result<JsonValue, CallError>>;
  /** 응답 없는 알림을 보낸다 */
  notify(method: PluginHostNotificationName, params: JsonValue): Promise<Result<void, CallError>>;
  /** 프로세스를 끝낸다. 되풀이해 불러도 된다. 이 감독은 다시 띄우지 않는다 */
  dispose(reason: HostDisposeParams["reason"]): void;
  status(): PluginHostStatus;
  /** 표준오류의 마지막 줄들(줄 수와 길이 상한 안, 마스킹 뒤) */
  stderrTail(): readonly string[];
}

// ── 내부 상태 ─────────────────────────────────────────────────────────────

/** 프로세스가 멈추는 이유. 셈은 이 값으로 정한다: `undefined`(스스로 끝남)만 죽음으로 센다 */
type EndReason = "idle" | "dispose" | "timeout" | "init_failed";

interface ExitInfo {
  readonly code: number | null;
  readonly signal: string | null;
}

interface Pending {
  readonly settle: (outcome: Result<JsonValue, CallError>) => void;
}

interface Proc {
  readonly child: IsolatedChild;
  readonly writer: FrameWriter;
  /** 응답을 기다리는 요청. 응답, 취소, 시간 초과, 종료 가운데 하나가 한 번 정한다 */
  readonly pending: Map<number, Pending>;
  /** 프로세스 단위 타이머(강제 종료 대기, 시작 시간 한도). 종료 때 모두 푼다 */
  readonly timers: Set<() => void>;
  /** 끝나는 이유. 정해지면 새 호출을 받지 않는다 */
  endReason: EndReason | undefined;
  exited: boolean;
  /** `host.init` 응답을 검사해 받은 결과. 없으면 아직 준비되지 않았다 */
  init: HostInitResult | undefined;
  /** 종료되면 끝나는 약속. 멈추는 중인 프로세스를 기다릴 때 쓴다 */
  readonly done: Promise<void>;
  readonly finish: () => void;
}

interface Ready {
  readonly proc: Proc;
  readonly init: HostInitResult;
}

// ── 자식 응답의 모양 ─────────────────────────────────────────────────────

const DeclSchema = Type.Object({
  id: Type.String(),
  defaultEnabled: Type.Union([Type.Boolean(), Type.Null()]),
  state: Type.Union([
    Type.Null(),
    Type.Object({
      schema: JsonValueSchema,
      initial: JsonValueSchema,
      version: Type.Integer(),
    }),
  ]),
  hooks: Type.Array(
    Type.Object({ point: Type.String(), handlerIndex: Type.Integer({ minimum: 0 }) }),
  ),
  tools: Type.Array(Type.Object({ name: Type.String(), def: JsonValueSchema })),
  commands: Type.Array(
    Type.Object({ name: Type.String(), description: Type.Union([Type.String(), Type.Null()]) }),
  ),
  methods: Type.Array(Type.Object({ verb: Type.String() })),
  flags: Type.Array(Type.Object({ name: Type.String(), def: JsonValueSchema })),
  providers: Type.Array(Type.Object({ name: Type.String(), config: JsonValueSchema })),
  mcpServers: Type.Array(Type.Object({ name: Type.String(), config: JsonValueSchema })),
  renderers: Type.Array(
    Type.Object({ customType: Type.String(), module: Type.String(), export: Type.String() }),
  ),
  hasDisposers: Type.Boolean(),
  hasMigration: Type.Boolean(),
  drive: Type.Union([
    Type.Null(),
    Type.Object({ limits: Type.Union([DriveLimitsSchema, Type.Null()]) }),
  ]),
});

const HostInitResultSchema = Type.Object({
  protocolVersion: Type.Integer(),
  registrations: Type.Array(DeclSchema),
});

const SUPERVISOR_ERROR_KINDS: ReadonlySet<string> = new Set<string>([
  "spawn_failed",
  "sandbox_unavailable",
  "init_failed",
  "init_timeout",
  "process_exit",
  "restart_limit",
  "declarations_changed",
  "disposed",
]);

function isSupervisorError(error: CallError): error is SupervisorError {
  return SUPERVISOR_ERROR_KINDS.has(error.kind);
}

function exitedError(detail: string): CallError {
  return { kind: "process_exit", message: detail };
}

function cancelledError(): CallError {
  return { kind: "cancelled", message: "the call was cancelled" };
}

/** 열림 한 번짜리 문. 프로세스가 끝나면 `opened`가 풀린다 */
interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

function gateOf(): Gate {
  const holder: { release?: () => void } = {};
  const opened = new Promise<void>((resolve) => {
    holder.release = () => resolve();
  });
  return { opened, open: () => holder.release?.() };
}

function isPluginHostErrorKind(value: string): value is PluginHostErrorKind {
  return PLUGIN_HOST_ERROR_KINDS.some((kind) => kind === value);
}

/** 시간 초과 abort인가(DispatchPolicy 예산 초과가 쓰는 사유: DOMException `TimeoutError`) */
function isTimeoutAbort(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "TimeoutError";
}

function clipTo(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function describeParse(error: ParseError): string {
  return error.issues.map((issue) => `${issue.path || "/"} ${issue.message}`).join("; ");
}

function entriesOf(value: JsonObject): readonly (readonly [string, JsonValue])[] {
  return Object.entries(value);
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** JSON 값의 정규 문자열. 객체 키를 정렬해 같은 선언이면 같은 문자열이 나온다 */
function canonicalJson(value: JsonValue): string {
  if (isJsonArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const members = entriesOf(value)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

function declarationsHashOf(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** 바이트 덩어리(문자열이면 UTF-8로 바꾼다)를 바이트 스트림으로 쓴다. 표준출력과 표준오류가 같이 쓴다 */
async function* bytesOf(source: AsyncIterable<string | Uint8Array>): AsyncGenerator<Uint8Array> {
  for await (const chunk of source) {
    yield typeof chunk === "string" ? ENCODER.encode(chunk) : chunk;
  }
}

function spawnErrorOf(error: IsolationSpawnError): SupervisorError {
  switch (error.kind) {
    case "spawn_failed":
      return { kind: "spawn_failed", message: `${error.code}: ${error.message}` };
    case "sandbox_unavailable":
      return { kind: "sandbox_unavailable", message: error.reason };
    default:
      return assertNever(error, "IsolationSpawnError");
  }
}

/** 시작 중 호출의 실패를 시작 실패로 옮긴다. 시간 초과는 `init_timeout`, 자식의 오류 종류는 `init_failed`다 */
function startErrorOf(error: CallError): SupervisorError {
  if (error.kind === "process_killed") {
    return { kind: "init_timeout", message: "the plugin host did not answer host.init in time" };
  }
  if (isSupervisorError(error)) return error;
  return { kind: "init_failed", hostKind: error.kind, message: error.message };
}

function hostErrorOf(error: { readonly kind: string; readonly message: string }): CallError {
  if (!isPluginHostErrorKind(error.kind)) {
    return { kind: "invalid_response", message: "the plugin host reported an unknown error kind" };
  }
  return { kind: error.kind, message: error.message };
}

function writeFrameError(error: FrameWriteError): CallError {
  switch (error.kind) {
    case "frame_too_large":
      return {
        kind: "frame_too_large",
        message: `the frame is larger than ${error.max} bytes; nothing was sent`,
      };
    case "encode_failed":
      return { kind: "invalid_params", message: "the frame is not JSON" };
    case "write_failed":
      return { kind: "process_exit", message: "the plugin host did not take the frame" };
    default:
      return assertNever(error, "FrameWriteError");
  }
}

// ── 감독 ─────────────────────────────────────────────────────────────────

export function createPluginHostSupervisor(deps: PluginHostSupervisorDeps): PluginHostSupervisor {
  const idleMs = deps.idleMs ?? DEFAULT_IDLE_MS;
  const killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  const maxRestarts = deps.maxRestarts ?? DEFAULT_MAX_RESTARTS;

  let state: PluginHostStatusState = "idle";
  let since = deps.now();
  let deaths = 0;
  let nextId = 1;
  let current: Proc | undefined;
  let starting: Promise<Result<Ready, SupervisorError>> | undefined;
  let declarations: string | undefined;
  let label = "";
  let disposed = false;
  let cancelIdle: (() => void) | undefined;
  const tail: string[] = [];

  function setState(next: PluginHostStatusState): void {
    state = next;
    since = deps.now();
  }

  /** 멈춤 상태로 바꾼다. 재시작 한도 상태는 덮지 않는다 */
  function markStopped(): void {
    if (state !== "restart_limit") setState("stopped");
  }

  function allocateId(): number {
    const id = nextId;
    nextId += 1;
    return id;
  }

  /** 프로세스에 묶인 타이머. 종료 때 모두 취소하고, 실행된 타이머는 목록에서 뺀다 */
  function scheduleFor(proc: Proc, ms: number, fn: () => void): void {
    const cancel = deps.setTimer(ms, () => {
      proc.timers.delete(cancel);
      fn();
    });
    proc.timers.add(cancel);
  }

  function recordDeath(reason: PluginProcessFailureReason): void {
    deaths += 1;
    if (deaths <= maxRestarts || state === "restart_limit") return;
    setState("restart_limit");
    const notified = attempt(() => deps.onRestartLimit({ deaths, reason, label }));
    if (!notified.ok) deps.logger.error("plugin_host.restart_limit_handler_failed", {});
  }

  function sendSignal(proc: Proc, signal: "SIGTERM" | "SIGKILL"): void {
    if (proc.exited) return;
    const sent = attempt(() => proc.child.kill(signal));
    if (!sent.ok) deps.logger.warn("plugin_host.signal_failed", { signal });
  }

  /** 멈춤 요청: 먼저 SIGTERM, 대기 뒤 SIGKILL */
  function terminate(proc: Proc): void {
    sendSignal(proc, "SIGTERM");
    scheduleFor(proc, killGraceMs, () => {
      if (!proc.exited) sendSignal(proc, "SIGKILL");
    });
  }

  function writeFrame(proc: Proc, frame: PluginHostFrame): Result<void, CallError> {
    const written = proc.writer.write(frame);
    return written.ok ? ok(undefined) : err(writeFrameError(written.error));
  }

  /** 프로세스가 스스로 끝나는 순서: `host.dispose`를 보내고 입력을 닫고, 대기 뒤 강제 종료한다 */
  function stopGracefully(
    proc: Proc,
    end: "idle" | "dispose",
    reason: HostDisposeParams["reason"],
  ): void {
    if (proc.exited || proc.endReason !== undefined) return;
    proc.endReason = end;
    const asked = writeFrame(proc, {
      id: allocateId(),
      method: "host.dispose",
      params: { reason },
    });
    if (!asked.ok) deps.logger.warn("plugin_host.dispose_not_sent", { reason });
    const ended = attempt(() => proc.child.stdin.end());
    if (!ended.ok) deps.logger.warn("plugin_host.stdin_end_failed", {});
    scheduleFor(proc, killGraceMs, () => {
      if (!proc.exited) terminate(proc);
    });
  }

  function disarmIdle(): void {
    cancelIdle?.();
    cancelIdle = undefined;
  }

  /** 대기 중 요청이 없으면 유휴 시간을 잰다. 준비되지 않았거나 멈추는 중이면 재지 않는다 */
  function armIdle(): void {
    disarmIdle();
    const proc = current;
    if (proc === undefined || proc.init === undefined || proc.exited) return;
    if (proc.endReason !== undefined || proc.pending.size > 0) return;
    cancelIdle = deps.setTimer(idleMs, () => {
      cancelIdle = undefined;
      if (current === proc && proc.pending.size === 0) stopGracefully(proc, "idle", "idle");
    });
  }

  /**
   * 시간 초과 종료. 대상 요청은 `process_killed`, 함께 떠 있던 나머지는 `process_exit`로 끝낸다.
   * 시간 초과 종료는 죽음으로 센다
   */
  function timeoutKill(proc: Proc, targetId: number, why: string): void {
    const target = proc.pending.get(targetId);
    if (target === undefined) return;
    if (proc.exited || proc.endReason !== undefined) {
      target.settle(err(exitedError("the plugin host was already stopping")));
      return;
    }
    proc.endReason = "timeout";
    recordDeath("process_killed");
    target.settle(err({ kind: "process_killed", message: `${why}; the plugin host was stopped` }));
    for (const other of Array.from(proc.pending.values())) {
      other.settle(err(exitedError("the plugin host was stopped after another call timed out")));
    }
    terminate(proc);
  }

  /** 요청 하나를 보낸다. 응답, 취소, 시간 초과, 종료 가운데 가장 먼저 오는 것이 결과를 정한다 */
  function request(
    proc: Proc,
    method: PluginHostRequestName,
    params: JsonValue,
    options: PluginCallOptions | undefined,
  ): Promise<Result<JsonValue, CallError>> {
    const signal = options?.signal;
    if (signal?.aborted === true) return Promise.resolve(err(cancelledError()));
    if (proc.exited || proc.endReason !== undefined) {
      return Promise.resolve(err(exitedError("the plugin host is not running")));
    }
    const id = allocateId();
    options?.onRequestId?.(id);
    const sent = writeFrame(proc, { id, method, params });
    if (!sent.ok) return Promise.resolve(err(sent.error));
    disarmIdle();
    return new Promise((resolve) => {
      const cleanups: (() => void)[] = [];
      let settled = false;
      const settle = (outcome: Result<JsonValue, CallError>): void => {
        if (settled) return;
        settled = true;
        proc.pending.delete(id);
        for (const cleanup of cleanups) cleanup();
        // 성공한 호출 응답은 죽음 셈을 0으로 되돌린다. 시작 응답은 되돌리지 않는다(죽는 시작이 한도를 피하지 못하게)
        if (outcome.ok && method !== "host.init") deaths = 0;
        resolve(outcome);
        if (proc.pending.size === 0) armIdle();
      };
      proc.pending.set(id, { settle });
      if (signal !== undefined) {
        const onAbort = (): void => {
          if (isTimeoutAbort(signal.reason)) {
            timeoutKill(proc, id, "the call was stopped by its time limit");
            return;
          }
          // 취소 알림을 보내고 이 호출만 끝낸다. 늦게 오는 응답은 대기 목록에 없어 버린다
          const notice = writeFrame(proc, { method: "request.cancel", params: { id } });
          if (!notice.ok) deps.logger.warn("plugin_host.cancel_not_sent", {});
          settle(err(cancelledError()));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => signal.removeEventListener("abort", onAbort));
      }
      const deadlineMs = options?.deadlineMs;
      if (deadlineMs !== undefined) {
        cleanups.push(
          deps.setTimer(deadlineMs, () => {
            timeoutKill(proc, id, "the call passed its deadline");
          }),
        );
      }
    });
  }

  function replyTo(proc: Proc, id: number, outcome: Result<JsonValue, PluginHostError>): void {
    const frame: PluginHostFrame = outcome.ok
      ? { id, result: outcome.value }
      : {
          id,
          error: {
            kind: outcome.error.kind,
            message: clipTo(outcome.error.message, MESSAGE_MAX),
            // 엔진 호출 실패의 원래 종류는 자식이 엔진 안과 같은 오류로 되던지는 데 쓴다(isolation-protocol.ts)
            ...(outcome.error.origin === undefined ? {} : { origin: outcome.error.origin }),
          },
        };
    const sent = writeFrame(proc, frame);
    if (sent.ok) return;
    if (outcome.ok && sent.error.kind === "frame_too_large") {
      // 결과가 상한을 넘으면 결과 대신 오류를 보낸다. 오류 프레임은 작다
      const replaced = writeFrame(proc, {
        id,
        error: {
          kind: "frame_too_large",
          message: `the reply exceeds ${PLUGIN_HOST_MAX_FRAME_BYTES} bytes`,
        },
      });
      if (!replaced.ok)
        deps.logger.warn("plugin_host.reply_not_sent", { kind: replaced.error.kind });
      return;
    }
    deps.logger.warn("plugin_host.reply_not_sent", { kind: sent.error.kind });
  }

  async function serveEngineCall(proc: Proc, id: number, params: unknown): Promise<void> {
    const parsed = parseEngineCallParams(params);
    if (!parsed.ok) {
      replyTo(proc, id, err({ kind: "invalid_params", message: describeParse(parsed.error) }));
      return;
    }
    const input = parsed.value;
    const called = await attemptAsync(() => deps.onEngineCall(input));
    const outcome: Result<JsonValue, PluginHostError> = called.ok
      ? called.value
      : err({ kind: "engine_call_failed", message: messageOf(called.error.cause) });
    replyTo(proc, id, outcome);
  }

  function answerRequest(proc: Proc, id: number, method: string, params: unknown): void {
    if (method !== "engine.call") {
      replyTo(proc, id, err({ kind: "unknown_target", message: "the engine has no such method" }));
      return;
    }
    detach(serveEngineCall(proc, id, params), () => {
      deps.logger.error("plugin_host.engine_call_unhandled", {});
    });
  }

  function settleById(proc: Proc, id: number, outcome: Result<JsonValue, CallError>): void {
    const entry = proc.pending.get(id);
    if (entry === undefined) {
      deps.logger.debug("plugin_host.late_reply_dropped", {});
      return;
    }
    entry.settle(outcome);
  }

  function onFrame(proc: Proc, read: FrameReadResult): void {
    if (!read.ok) {
      deps.logger.warn("plugin_host.frame_invalid", { kind: read.error.kind });
      return;
    }
    dispatchFrame(proc, read.value);
  }

  function dispatchFrame(proc: Proc, frame: ClassifiedFrame): void {
    switch (frame.kind) {
      case "response": {
        const result = parse(JsonValueSchema, frame.result);
        const outcome: Result<JsonValue, CallError> = result.ok
          ? ok(result.value)
          : err({
              kind: "invalid_response",
              message: "the plugin host replied with a value that is not JSON",
            });
        settleById(proc, frame.id, outcome);
        return;
      }
      case "failure": {
        const reported = frame.error;
        const outcome: Result<JsonValue, CallError> =
          reported === undefined
            ? err({
                kind: "invalid_response",
                message: "the plugin host sent a failure without an error",
              })
            : err(hostErrorOf(reported));
        settleById(proc, frame.id, outcome);
        return;
      }
      case "request":
        answerRequest(proc, frame.id, frame.method, frame.params);
        return;
      case "notification":
        deps.logger.debug("plugin_host.notification_ignored", {});
        return;
      default:
        return assertNever(frame, "ClassifiedFrame");
    }
  }

  async function pumpFrames(proc: Proc, stdout: NodeJS.ReadableStream): Promise<void> {
    const reader = createFrameReader(bytesOf(stdout));
    await repeatAsync<void>(async () => {
      const next = await reader.next();
      if (next === null) return { value: undefined };
      onFrame(proc, next);
      return undefined;
    });
  }

  function keepStderrLine(raw: string): void {
    const masked = attempt(() => (deps.maskSecrets === undefined ? raw : deps.maskSecrets(raw)));
    // 마스킹이 실패한 줄은 원문을 남기지 않고 버린다
    if (!masked.ok) {
      deps.logger.warn("plugin_host.stderr_mask_failed", {});
      return;
    }
    tail.push(clipTo(masked.value, PLUGIN_HOST_STDERR_LINE_MAX));
    if (tail.length > PLUGIN_HOST_STDERR_LINES_MAX) {
      tail.splice(0, tail.length - PLUGIN_HOST_STDERR_LINES_MAX);
    }
  }

  async function pumpStderr(stderr: NodeJS.ReadableStream): Promise<void> {
    const decoder = new TextDecoder();
    let partial = "";
    for await (const bytes of bytesOf(stderr)) {
      const lines = `${partial}${decoder.decode(bytes, { stream: true })}`.split("\n");
      partial = clipTo(lines.pop() ?? "", PLUGIN_HOST_STDERR_LINE_MAX);
      for (const line of lines) keepStderrLine(line);
    }
    const rest = `${partial}${decoder.decode()}`;
    if (rest.length > 0) keepStderrLine(rest);
  }

  /** 프로세스가 끝났을 때. 대기 호출을 끝내고, 스스로 끝난 것만 죽음으로 센다 */
  function onExit(proc: Proc, info: ExitInfo): void {
    proc.exited = true;
    for (const cancel of Array.from(proc.timers)) cancel();
    proc.timers.clear();
    if (current === proc) current = undefined;
    disarmIdle();
    const detail = `the plugin host exited (code ${info.code ?? "none"}, signal ${info.signal ?? "none"})`;
    for (const entry of Array.from(proc.pending.values())) {
      entry.settle(err(exitedError(detail)));
    }
    const reason = proc.endReason;
    deps.logger.info("plugin_host.exited", {
      reason: reason ?? "unexpected",
      code: info.code,
      signal: info.signal,
    });
    if (reason === undefined) recordDeath("process_exit");
    if (reason === "idle" && state !== "restart_limit") setState("idle");
    else markStopped();
    proc.finish();
  }

  /**
   * 표준출력이 끝날 때까지 기다린다. 끝내기 전에 쓴 응답을 먼저 읽어야 종료가 대기 요청을 `process_exit`로 바꾸지 않는다.
   * 파이프가 자식 밖에 남아 끝나지 않을 수 있으므로 기다림은 `killGraceMs`를 넘지 않는다
   */
  function outputDrained(drained: Promise<void>): Promise<void> {
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        cancel();
        resolve();
      };
      const cancel = deps.setTimer(killGraceMs, finish);
      detach(drained.then(finish), finish);
    });
  }

  /** 자식 프로세스 하나를 감독에 붙인다. 표준입력은 프레임 쓰기로, 표준출력은 프레임 읽기로, 종료는 `exited`로 본다 */
  function attach(child: IsolatedChild): Proc {
    const gate = gateOf();
    const proc: Proc = {
      child,
      writer: createFrameWriter({
        write: (line) => {
          child.stdin.write(line);
        },
      }),
      pending: new Map(),
      timers: new Set(),
      endReason: undefined,
      exited: false,
      init: undefined,
      done: gate.opened,
      finish: gate.open,
    };
    child.stdin.on("error", () => {
      deps.logger.warn("plugin_host.stdin_error", {});
    });
    const drained = pumpFrames(proc, child.stdout);
    detach(drained, () => {
      deps.logger.error("plugin_host.pump_failed", {});
    });
    detach(pumpStderr(child.stderr), () => {
      deps.logger.error("plugin_host.stderr_failed", {});
    });
    detach(
      child.exited.then(async (info) => {
        await outputDrained(drained);
        return onExit(proc, info);
      }),
      () => {
        deps.logger.error("plugin_host.exit_watch_failed", {});
      },
    );
    return proc;
  }

  /** `host.init`을 보내고 응답을 검사한다. 맞지 않으면 그 프로세스를 멈춘다(죽음으로 세지 않는다) */
  async function handshake(proc: Proc): Promise<Result<Ready, SupervisorError>> {
    const params = toJsonValue(deps.initParams());
    if (params === undefined) {
      return abandon(proc, {
        kind: "init_failed",
        hostKind: "invalid_params",
        message: "the init params are not JSON",
      });
    }
    const reply = await request(proc, "host.init", params, { deadlineMs: deps.initTimeoutMs });
    if (!reply.ok) return abandon(proc, startErrorOf(reply.error));
    const decoded = parse(HostInitResultSchema, reply.value);
    if (!decoded.ok) {
      return abandon(proc, {
        kind: "init_failed",
        hostKind: "invalid_response",
        message: describeParse(decoded.error),
      });
    }
    if (decoded.value.protocolVersion !== PLUGIN_HOST_PROTOCOL_VERSION) {
      return abandon(proc, {
        kind: "init_failed",
        hostKind: "protocol_version",
        message: `the plugin host speaks protocol ${decoded.value.protocolVersion}, expected ${PLUGIN_HOST_PROTOCOL_VERSION}`,
      });
    }
    const hash = declarationsHashOf(reply.value);
    if (declarations === undefined) {
      declarations = hash;
    } else if (declarations !== hash) {
      return abandon(proc, {
        kind: "declarations_changed",
        message: "the plugin declared different registrations than when it first started",
      });
    }
    proc.init = decoded.value;
    setState("running");
    armIdle();
    return ok({ proc, init: decoded.value });
  }

  /** 시작을 버린다. 프로세스가 이미 끝났거나 시간 초과로 멈추는 중이면 더 하지 않는다 */
  function abandon(proc: Proc, error: SupervisorError): Result<Ready, SupervisorError> {
    if (!proc.exited && proc.endReason === undefined) {
      proc.endReason = "init_failed";
      terminate(proc);
    }
    return err(error);
  }

  async function launch(): Promise<Result<Ready, SupervisorError>> {
    setState("starting");
    const spec = deps.specOf();
    label = spec.label;
    const spawned = await attemptAsync(() => deps.process.spawn(spec));
    if (!spawned.ok) {
      markStopped();
      return err({ kind: "spawn_failed", message: messageOf(spawned.error.cause) });
    }
    if (!spawned.value.ok) {
      markStopped();
      return err(spawnErrorOf(spawned.value.error));
    }
    const proc = attach(spawned.value.value);
    current = proc;
    const started = await handshake(proc);
    if (!started.ok) markStopped();
    return started;
  }

  /** 떠 있는 프로세스를 돌려준다. 없으면 띄운다. 띄우는 중이면 그 결과를 같이 기다린다 */
  function ensureRunning(): Promise<Result<Ready, SupervisorError>> {
    if (disposed)
      return Promise.resolve(err({ kind: "disposed", message: "the plugin host was disposed" }));
    if (state === "restart_limit") {
      return Promise.resolve(
        err({
          kind: "restart_limit",
          message: `the plugin host died ${deaths} times; it is not restarted`,
        }),
      );
    }
    const running = current;
    if (running !== undefined && !running.exited && running.endReason !== undefined) {
      // 멈추는 중인 프로세스가 끝난 뒤 다시 띄운다(유휴 내리기와 겹친 호출이 실패하지 않게)
      return running.done.then(() => ensureRunning());
    }
    if (running !== undefined && running.init !== undefined && !running.exited) {
      return Promise.resolve(ok({ proc: running, init: running.init }));
    }
    if (starting === undefined) {
      starting = launch().finally(() => {
        starting = undefined;
      });
    }
    return starting;
  }

  return {
    async start() {
      const ready = await ensureRunning();
      if (!ready.ok) return err(ready.error);
      return ok(ready.value.init);
    },
    async call(method, params, options) {
      const ready = await ensureRunning();
      if (!ready.ok) return err(ready.error);
      return request(ready.value.proc, method, params, options);
    },
    async notify(method, params) {
      const ready = await ensureRunning();
      if (!ready.ok) return err(ready.error);
      const sent = writeFrame(ready.value.proc, { method, params });
      if (!sent.ok) return err(sent.error);
      if (ready.value.proc.pending.size === 0) armIdle();
      return ok(undefined);
    },
    dispose(reason) {
      if (disposed) return;
      disposed = true;
      disarmIdle();
      const proc = current;
      if (proc !== undefined) stopGracefully(proc, "dispose", reason);
    },
    status() {
      const proc = current;
      return {
        state,
        pid: proc !== undefined && !proc.exited ? proc.child.pid : null,
        deaths,
        since,
      };
    },
    stderrTail() {
      return tail.slice();
    },
  };
}
