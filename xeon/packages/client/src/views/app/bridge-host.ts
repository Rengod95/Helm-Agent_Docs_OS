import {
  BRIDGE_VERSION,
  BridgeRequestSchema,
  UI_LIMITS,
  bridgeMessageWithinLimit,
  type BridgeError,
  type BridgePush,
  type BridgeResponse,
} from "@fresnel/contracts/extensions";
import {
  assertNever,
  attempt,
  attemptAsync,
  detach,
  parse,
  type Clock,
  type Result,
  type Scheduler,
  type TimerHandle,
} from "@fresnel/contracts";
import type { LedgerFailure, ScreenLedger } from "../ledger.ts";
import {
  decide,
  type BridgeAction,
  type BridgePolicyContext,
  type NavigateTarget,
} from "./policy.ts";

// Plugin App 다리의 셸 쪽(ADR-0021 §3.4.2). MessageChannel 포트 하나로 오는 요청을 모양, 크기, 속도, 판정 순서로 걸러
// 허용된 동작만 `BridgeBackend`에 넘긴다. 프레임은 앱 문서, wire, IPC 어느 것도 받지 않는다(§3.6.4).

/** MessagePort를 구조로만 쓴다. 시험은 서로 이어 둔 대역을, 운영은 MessagePort를 넣는다 */
export interface BridgePort {
  postMessage(message: unknown): void;
  /** 한 번에 하나. 널을 주면 해제한다 */
  setHandler(handler: ((data: unknown) => void) | undefined): void;
  close(): void;
}

export interface HostSnapshot {
  readonly threadId: string | undefined;
  readonly threadTitle: string | undefined;
  readonly connection: "connected" | "offline";
  readonly locale: string;
  readonly theme: "light" | "dark";
  readonly extension: {
    readonly enabled: boolean;
    readonly trust: "builtin" | "user" | "project";
    readonly safeMode: boolean;
  };
}

export interface SettingRead {
  readonly key: string;
  readonly secret: boolean;
  /** 비밀 키는 값이 있는지만 안다. 값 자체는 이 층에 오지 않는 것이 맞지만 와도 건너뛰지 않게 따로 막는다 */
  readonly isSet: boolean;
  readonly value: unknown;
}

export type BackendResult<T> = Result<T, BridgeError>;

/** 허용된 동작을 실제로 하는 쪽. 엔진 wire 호출과 셸 이동은 여기서 한다. 모든 검사는 엔진이 다시 한다 */
export interface BridgeBackend {
  query(verb: string, params: Readonly<Record<string, unknown>>): Promise<BackendResult<unknown>>;
  events(kinds: readonly string[], limit: number): Promise<BackendResult<readonly unknown[]>>;
  settings(keys: readonly string[]): Promise<BackendResult<readonly SettingRead[]>>;
  host(): HostSnapshot;
  call(verb: string, params: Readonly<Record<string, unknown>>): Promise<BackendResult<unknown>>;
  command(name: string, args: string): Promise<BackendResult<unknown>>;
  post(threadId: string, text: string): Promise<BackendResult<unknown>>;
  requestApproval(threadId: string, title: string, detail: string): Promise<BackendResult<unknown>>;
  navigate(target: NavigateTarget, shellConfirmed: boolean): Promise<BackendResult<unknown>>;
  /** 외부 링크는 셸이 먼저 확인한다 */
  confirmExternal(url: string): Promise<boolean>;
  resize(height: number): void;
  /** 진단 줄. op와 크기만 온다 */
  diagnostic(line: { readonly op: string; readonly size: number }): void;
}

export type ConfirmAnswer = "allow" | "allow_always" | "deny";

/** 프레임 `call`·`command` 앞의 확인 줄(§3.4). 글은 매니페스트에서 온 값(확장 이름, 동사)으로만 만든다. 프레임이 준 글은 쓰지 않는다 */
export interface ConfirmRequest {
  readonly extension: string;
  /** `call`이면 동사, `command`이면 `/이름` */
  readonly action: string;
  /** 표준 승인 카드가 따로 뜨는 메서드인가(그 카드는 끌 수 없다) */
  readonly approval: boolean;
}

/** "이 화면에서 묻지 않기"의 세션 기억(확장마다). 앱이 하나 만들어 같은 확장의 프레임이 나눠 쓴다. 재시작하면 사라진다 */
export interface ConfirmMemory {
  isSuppressed(extension: string): boolean;
  suppress(extension: string): void;
}

export function createConfirmMemory(): ConfirmMemory {
  const suppressed = new Set<string>();
  return {
    isSuppressed: (extension) => suppressed.has(extension),
    suppress: (extension) => {
      suppressed.add(extension);
    },
  };
}

export interface BridgeHostOptions {
  readonly port: BridgePort;
  /** 화면 키 `<확장이름>/<화면 id>` */
  readonly screenKey: string;
  /** 요청마다 읽는다. 확장 상태와 열린 대화가 바뀌면 다음 요청부터 반영된다 */
  readonly context: () => BridgePolicyContext;
  readonly backend: BridgeBackend;
  readonly ledger: ScreenLedger;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly confirm: (request: ConfirmRequest) => Promise<ConfirmAnswer>;
  readonly confirmMemory: ConfirmMemory;
  /** 닫힘. 이유는 장부 이름이거나 `disposed`다 */
  readonly onClosed: (reason: LedgerFailure | "disposed") => void;
}

export interface BridgeHost {
  /** 푸시 하나를 보낸다. 포트가 닫혔으면 버린다 */
  push(name: BridgePush, value: unknown): void;
  /** 생존 확인을 시작한다 */
  startLiveness(): void;
  dispose(): void;
  readonly closed: boolean;
}

export const LIVENESS_INTERVAL_MS = 5000;
const LIVENESS_MISSES = 2;
export const CONFIRM_TIMEOUT_MS = 60000;
const RATE_WINDOW_MS = 1000;

function failed(kind: BridgeError["kind"], detail?: string): BackendResult<never> {
  return { ok: false, error: detail === undefined ? { kind } : { kind, detail } };
}

/** 요청 원문에서 정수 id만 건져 오류 응답에 쓴다. 믿을 수 없으면 undefined다 */
function idOf(data: unknown): number | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const id: unknown = Object.getOwnPropertyDescriptor(data, "id")?.value;
  return typeof id === "number" && Number.isSafeInteger(id) && id >= 0 ? id : undefined;
}

function sizeOf(value: unknown): number {
  const text = attempt(() => JSON.stringify(value));
  // 직렬화되지 않는 값은 상한을 넘은 것으로 본다
  if (!text.ok) return Number.POSITIVE_INFINITY;
  return new TextEncoder().encode(text.value).byteLength;
}

export function createBridgeHost(options: BridgeHostOptions): BridgeHost {
  const { port, backend, ledger, screenKey } = options;
  let closed = false;
  const isClosed = (): boolean => closed;
  let confirmPending = false;
  let windowStart = options.clock.now();
  let windowCount = 0;
  let livenessTimer: TimerHandle | undefined;
  let pingSeq = 0;
  let outstandingPing: number | undefined;
  let misses = 0;
  let confirmTimer: TimerHandle | undefined;
  let confirmResolve: ((answer: ConfirmAnswer) => void) | undefined;

  function close(reason: LedgerFailure | "disposed"): void {
    if (closed) return;
    closed = true;
    if (livenessTimer !== undefined) options.scheduler.clearTimeout(livenessTimer);
    if (confirmTimer !== undefined) options.scheduler.clearTimeout(confirmTimer);
    confirmResolve?.("deny");
    port.setHandler(undefined);
    port.close();
    options.onClosed(reason);
  }

  /** 실패 하나를 장부에 센다. 이 실패로 화면이 꺼지면 포트를 닫는다 */
  function count(failure: LedgerFailure): void {
    if (ledger.fail(screenKey, failure)) close(failure);
  }

  function send(message: unknown): void {
    if (closed) return;
    port.postMessage(message);
  }
  function respond(response: BridgeResponse): void {
    send(response);
  }
  function respondError(id: number, error: BridgeError): void {
    respond({ v: BRIDGE_VERSION, id, ok: false, error });
  }

  function overRate(): boolean {
    const now = options.clock.now();
    if (now - windowStart >= RATE_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount > UI_LIMITS.bridgeMessagesPerSecond;
  }

  async function askConfirm(request: ConfirmRequest): Promise<ConfirmAnswer> {
    if (options.confirmMemory.isSuppressed(request.extension)) return "allow";
    if (confirmPending) return "deny";
    confirmPending = true;
    const answer = new Promise<ConfirmAnswer>((resolve) => {
      confirmResolve = resolve;
      confirmTimer = options.scheduler.setTimeout(() => resolve("deny"), CONFIRM_TIMEOUT_MS);
    });
    const asked = attemptAsync(() => options.confirm(request));
    const result = await Promise.race([answer, asked.then((r) => (r.ok ? r.value : "deny"))]);
    if (confirmTimer !== undefined) options.scheduler.clearTimeout(confirmTimer);
    confirmTimer = undefined;
    confirmResolve = undefined;
    confirmPending = false;
    if (result === "allow_always") options.confirmMemory.suppress(request.extension);
    return result;
  }

  async function run(action: BridgeAction): Promise<BackendResult<unknown>> {
    switch (action.op) {
      case "query": {
        const result = await backend.query(action.verb, action.params);
        if (!result.ok) return result;
        if (sizeOf(result.value) > UI_LIMITS.queryResultBytes) {
          count("limit_exceeded");
          return failed("too_large");
        }
        return result;
      }
      case "events": {
        const result = await backend.events(action.kinds, action.limit);
        if (!result.ok) return result;
        if (result.value.length > UI_LIMITS.eventRows) {
          count("limit_exceeded");
          return failed("too_large");
        }
        return result;
      }
      case "settings": {
        const result = await backend.settings(action.keys);
        if (!result.ok) return result;
        // 비밀 키는 값 대신 "설정됨/없음"만 건넨다(§3.6.5). 다른 필드는 옮기지 않는다
        const rows = result.value.map((row) =>
          row.secret
            ? { key: row.key, status: row.isSet ? "set" : "unset" }
            : { key: row.key, value: row.value },
        );
        return { ok: true, value: rows };
      }
      case "host": {
        const snapshot = backend.host();
        // 필드를 하나씩 옮긴다. 모르는 필드는 건너뛴다
        return {
          ok: true,
          value: {
            threadId: snapshot.threadId ?? null,
            threadTitle: snapshot.threadTitle ?? null,
            connection: snapshot.connection,
            locale: snapshot.locale,
            theme: snapshot.theme,
            extension: {
              enabled: snapshot.extension.enabled,
              trust: snapshot.extension.trust,
              safeMode: snapshot.extension.safeMode,
            },
          },
        };
      }
      case "call": {
        const answer = await askConfirm({
          extension: options.context().extension,
          action: action.verb,
          approval: action.approval,
        });
        if (answer === "deny") return failed("denied", "not_confirmed");
        // 확인을 기다리는 동안 확장이 꺼졌거나 안전 모드가 되었을 수 있다. 다시 판정한다
        if (isClosed()) return failed("extension_off");
        const context = options.context();
        if (!context.enabled) return failed("extension_off");
        if (context.safeMode) return failed("safe_mode");
        return backend.call(action.verb, action.params);
      }
      case "command": {
        const answer = await askConfirm({
          extension: options.context().extension,
          action: `/${action.name}`,
          approval: false,
        });
        if (answer === "deny") return failed("denied", "not_confirmed");
        if (isClosed()) return failed("extension_off");
        const context = options.context();
        if (!context.enabled) return failed("extension_off");
        if (context.safeMode) return failed("safe_mode");
        return backend.command(action.name, action.args);
      }
      case "post":
        return backend.post(action.threadId, action.text);
      case "requestApproval":
        return backend.requestApproval(action.threadId, action.title, action.detail);
      case "navigate": {
        if (action.target.kind === "external") {
          const allowed = await backend.confirmExternal(action.target.url);
          if (!allowed) return failed("denied", "not_confirmed");
        }
        return backend.navigate(action.target, action.needsShellConfirm);
      }
      case "resize":
        backend.resize(action.height);
        return { ok: true, value: null };
      case "log":
        backend.diagnostic({ op: "log", size: action.size });
        return { ok: true, value: null };
      case "pong":
        if (outstandingPing === action.n) {
          outstandingPing = undefined;
          misses = 0;
        }
        return { ok: true, value: null };
      default:
        return assertNever(action, "BridgeAction");
    }
  }

  async function onMessage(data: unknown): Promise<void> {
    if (closed) return;
    // 1. 크기. 직렬화되지 않는 값도 여기서 걸린다
    if (!bridgeMessageWithinLimit(data)) {
      const id = idOf(data);
      if (id !== undefined) respondError(id, { kind: "too_large" });
      count("limit_exceeded");
      return;
    }
    // 2. 속도
    if (overRate()) {
      const id = idOf(data);
      if (id !== undefined) respondError(id, { kind: "rate_limited" });
      count("limit_exceeded");
      return;
    }
    // 3. 모양
    const parsed = parse(BridgeRequestSchema, data);
    if (!parsed.ok) {
      const id = idOf(data);
      if (id !== undefined) respondError(id, { kind: "args_invalid", detail: "request" });
      count("bridge_format");
      return;
    }
    const request = parsed.value;
    // 4. 판정
    const decision = decide(request, options.context());
    if (!decision.ok) {
      respondError(request.id, decision.error);
      return;
    }
    // 5. 실행
    const outcome = await attemptAsync(() => run(decision.action));
    if (isClosed()) return;
    if (!outcome.ok) {
      respondError(request.id, { kind: "failed" });
      return;
    }
    if (!outcome.value.ok) {
      respondError(request.id, outcome.value.error);
      return;
    }
    const response: BridgeResponse = {
      v: BRIDGE_VERSION,
      id: request.id,
      ok: true,
      value: outcome.value.value,
    };
    if (!bridgeMessageWithinLimit(response)) {
      count("limit_exceeded");
      respondError(request.id, { kind: "too_large" });
      return;
    }
    ledger.succeed(screenKey);
    // 생존 확인 답에는 응답하지 않는다. 답에 답하면 끝이 없다
    if (decision.action.op === "pong") return;
    respond(response);
  }

  port.setHandler((data) => {
    // onMessage는 던지지 않게 짰지만, 빠져나온 거부는 형식 위반 하나로 세어 장부에 남긴다
    detach(onMessage(data), () => {
      count("bridge_format");
    });
  });

  return {
    push(name, value) {
      send({ v: BRIDGE_VERSION, push: name, value });
    },
    startLiveness() {
      if (closed || livenessTimer !== undefined) return;
      const tick = (): void => {
        if (closed) return;
        if (outstandingPing !== undefined) {
          misses += 1;
          if (misses >= LIVENESS_MISSES) {
            count("liveness_lost");
            close("liveness_lost");
            return;
          }
        }
        pingSeq += 1;
        outstandingPing = pingSeq;
        send({ v: BRIDGE_VERSION, push: "ping", value: { n: pingSeq } });
        livenessTimer = options.scheduler.setTimeout(tick, LIVENESS_INTERVAL_MS);
      };
      tick();
    },
    dispose() {
      close("disposed");
    },
    get closed() {
      return closed;
    },
  };
}
