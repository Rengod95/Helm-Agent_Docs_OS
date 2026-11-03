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
  stripUnsafeText,
  type BridgeAction,
  type BridgePolicyContext,
  type ExternalLink,
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
  /** 외부 링크는 셸이 먼저 확인한다. 확인 글과 OS 브라우저 열기 모두 `link.href`만 쓴다 */
  confirmExternal(link: ExternalLink): Promise<boolean>;
  resize(height: number): void;
  /** 진단 줄. op와 크기만 온다 */
  diagnostic(line: { readonly op: string; readonly size: number }): void;
}

export type ConfirmAnswer = "allow" | "deny";

/** 프레임 `call`·`command` 앞의 확인 줄(§3.4). 글은 매니페스트에서 온 값(확장 이름, 동사)으로만 만든다. 프레임이 준 글은 쓰지 않는다 */
export interface ConfirmRequest {
  readonly extension: string;
  /** 확장의 신뢰 등급. `project`이면 줄에 프로젝트 배지를 단다 */
  readonly trust: "builtin" | "user" | "project";
  /** `call`이면 동사, `command`이면 `/이름` */
  readonly action: string;
  /** 매니페스트 라벨. 있으면 줄이 동사 대신 이것을 보인다 */
  readonly label: string | undefined;
  /** 실제로 실행될 params의 요약(키=값, 제어·방향 제어 글자 제거, 길이 제한). 빈 객체면 빈 글이다. 확인한 값과 실행하는 값은 같은 객체다 */
  readonly paramsSummary: string;
  /** 표준 승인 카드가 따로 뜨는 메서드인가(그 카드는 끌 수 없다) */
  readonly approval: boolean;
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
/** 연속 거부·시간 초과가 이 횟수에 이르면 잠시 묻지 않고 거부한다 */
export const CONFIRM_DENY_STREAK = 3;
export const CONFIRM_COOLDOWN_MS = 5000;
/** 읽기 길 동시 처리 상한 */
export const QUERY_INFLIGHT_MAX = 8;
/** `post`, `requestApproval` 화면당 예산: 5초에 1번, 미결 5개 */
export const POST_MIN_INTERVAL_MS = 5000;
export const POST_OUTSTANDING_MAX = 5;
const PARAMS_SUMMARY_MAX = 160;

/** 장부의 연속 실패를 되돌리는 성공은 일을 한 것뿐이다. 생존 확인, 크기 조절, 진단, host 읽기는 세지 않는다 */
const SUBSTANTIVE_OPS: ReadonlySet<string> = new Set([
  "query",
  "events",
  "settings",
  "call",
  "command",
  "post",
  "requestApproval",
  "navigate",
]);

/** params 요약. 키를 정렬하고 값은 JSON으로 줄인다. 프레임이 준 글이라 제어·방향 제어 글자를 뺀다 */
export function summarizeParams(params: Readonly<Record<string, unknown>>): string {
  const parts = Object.keys(params)
    .toSorted()
    .map((key) => {
      const text = attempt(() =>
        JSON.stringify(Object.getOwnPropertyDescriptor(params, key)?.value),
      );
      return `${key}=${text.ok ? text.value : "?"}`;
    });
  const joined = stripUnsafeText(parts.join(", "), false);
  return joined.length <= PARAMS_SUMMARY_MAX ? joined : `${joined.slice(0, PARAMS_SUMMARY_MAX)}…`;
}

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
  let denyStreak = 0;
  let cooldownUntil = 0;
  let queriesInflight = 0;
  let outstanding = 0;
  let lastPostAt = Number.NEGATIVE_INFINITY;
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

  /** 확인 줄은 끌 수 없어 호출마다 묻는다. 같은 확장이라도 앞의 허용을 기억하지 않는다(2026-11-04 사용자, B2 1안) */
  async function askConfirm(request: ConfirmRequest): Promise<"allow" | "deny" | "timeout"> {
    if (confirmPending) return "deny";
    confirmPending = true;
    const answer = new Promise<"timeout">((resolve) => {
      confirmResolve = () => resolve("timeout");
      confirmTimer = options.scheduler.setTimeout(() => resolve("timeout"), CONFIRM_TIMEOUT_MS);
    });
    const asked = attemptAsync(() => options.confirm(request));
    const result = await Promise.race([answer, asked.then((r) => (r.ok ? r.value : "deny"))]);
    if (confirmTimer !== undefined) options.scheduler.clearTimeout(confirmTimer);
    confirmTimer = undefined;
    confirmResolve = undefined;
    confirmPending = false;
    return result;
  }

  /**
   * 확인 한 번. 거부와 시간 초과는 장부에 센다. 연속 3번이면 CONFIRM_COOLDOWN_MS 동안 줄을 띄우지 않고 거부한다(그 거부도 센다).
   * 허용이면 undefined, 아니면 돌려줄 오류다
   */
  async function confirmGate(
    action: string,
    label: string | undefined,
    params: Readonly<Record<string, unknown>>,
    approval: boolean,
  ): Promise<BridgeError | undefined> {
    if (options.clock.now() < cooldownUntil) {
      count("confirm_denied");
      return { kind: "denied", detail: "confirm_cooldown" };
    }
    const outcome = await askConfirm({
      extension: options.context().extension,
      trust: options.context().trust,
      action,
      label,
      paramsSummary: summarizeParams(params),
      approval,
    });
    if (outcome === "allow") {
      denyStreak = 0;
      return undefined;
    }
    denyStreak += 1;
    if (denyStreak >= CONFIRM_DENY_STREAK) {
      denyStreak = 0;
      cooldownUntil = options.clock.now() + CONFIRM_COOLDOWN_MS;
    }
    count(outcome === "timeout" ? "confirm_timeout" : "confirm_denied");
    return { kind: "denied", detail: "not_confirmed" };
  }

  /** `post`와 `requestApproval`의 화면당 예산. 넘으면 오류 이름을 돌려주고 장부에 센다 */
  function postBudgetError(): BridgeError | undefined {
    const now = options.clock.now();
    if (outstanding >= POST_OUTSTANDING_MAX || now - lastPostAt < POST_MIN_INTERVAL_MS) {
      count("limit_exceeded");
      return { kind: "rate_limited" };
    }
    lastPostAt = now;
    return undefined;
  }

  /** 확인을 기다리는 동안 확장이 꺼졌거나 안전 모드가 되었을 수 있다. 실행 직전에 다시 판정한다 */
  function stillRunnable(): BridgeError | undefined {
    if (isClosed()) return { kind: "extension_off" };
    const context = options.context();
    if (!context.enabled) return { kind: "extension_off" };
    if (context.safeMode) return { kind: "safe_mode" };
    return undefined;
  }

  async function runQuery(
    action: Extract<BridgeAction, { op: "query" }>,
  ): Promise<BackendResult<unknown>> {
    if (queriesInflight >= QUERY_INFLIGHT_MAX) {
      count("limit_exceeded");
      return failed("rate_limited", "query_inflight");
    }
    queriesInflight += 1;
    const result = await attemptAsync(() => backend.query(action.verb, action.params));
    queriesInflight -= 1;
    if (!result.ok) return failed("failed");
    if (!result.value.ok) return result.value;
    if (sizeOf(result.value.value) > UI_LIMITS.queryResultBytes) {
      count("limit_exceeded");
      return failed("too_large");
    }
    return result.value;
  }

  async function runPosted(
    action: Extract<BridgeAction, { op: "post" | "requestApproval" }>,
  ): Promise<BackendResult<unknown>> {
    const over = postBudgetError();
    if (over !== undefined) return { ok: false, error: over };
    outstanding += 1;
    const result = await attemptAsync(() =>
      action.op === "post"
        ? backend.post(action.threadId, action.text)
        : backend.requestApproval(action.threadId, action.title, action.detail),
    );
    outstanding -= 1;
    return result.ok ? result.value : failed("failed");
  }

  async function run(action: BridgeAction): Promise<BackendResult<unknown>> {
    switch (action.op) {
      case "query":
        return runQuery(action);
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
        const declared = options.context().declaredSettingKeys;
        // 값은 매니페스트가 선언한 키만 건넨다. 선언 없는 키와 비밀 키는 "설정됨/없음"만 준다(§3.6.5). 다른 필드는 옮기지 않는다
        const rows = result.value.map((row) =>
          row.secret || !declared.has(row.key)
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
              trust: options.context().trust,
              safeMode: snapshot.extension.safeMode,
            },
          },
        };
      }
      case "call": {
        const grant = options.context().methods.get(action.verb);
        const refused = await confirmGate(
          action.verb,
          grant?.label,
          action.params,
          action.approval,
        );
        if (refused !== undefined) return { ok: false, error: refused };
        const gone = stillRunnable();
        if (gone !== undefined) return { ok: false, error: gone };
        return backend.call(action.verb, action.params);
      }
      case "command": {
        const refused = await confirmGate(`/${action.name}`, undefined, {}, false);
        if (refused !== undefined) return { ok: false, error: refused };
        const gone = stillRunnable();
        if (gone !== undefined) return { ok: false, error: gone };
        return backend.command(action.name, action.args);
      }
      case "post":
      case "requestApproval":
        return runPosted(action);
      case "navigate": {
        if (action.target.kind === "external") {
          const allowed = await backend.confirmExternal(action.target.link);
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
    // 일을 한 요청만 연속 실패를 되돌린다(host, pong, resize, log는 싸서 실패 사이에 끼워 넣어 장부를 비울 수 있다)
    if (SUBSTANTIVE_OPS.has(decision.action.op)) ledger.succeed(screenKey);
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
