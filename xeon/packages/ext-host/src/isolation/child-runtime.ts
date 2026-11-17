// 플러그인 호스트 프로세스의 자식 쪽 실행 루프(isolation-protocol.ts). 엔진과 줄 단위 JSON으로 말한다.
// host.init에서 엔트리를 싣고 setup을 돌려 등록을 만든 뒤, 훅·도구·명령·메서드 호출과 알림을 처리한다.
// 여기서는 프로세스를 끝내지 않는다. 끝나는 이유를 PluginHostExit로 돌려주고, 종료는 앱 층이 한다.
import { AsyncLocalStorage } from "node:async_hooks";
import { realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assertNever,
  attempt,
  attemptAsync,
  detach,
  eachAsync,
  err,
  ok,
  parse,
  repeatAsync,
  type ParseError,
  type Result,
} from "@fresnel/contracts";
import { JsonValueSchema, toJsonValue, type JsonValue } from "@fresnel/contracts/conversation";
import {
  HOOKS,
  PLUGIN_HOST_PROTOCOL_VERSION,
  pluginsOf,
  PLUGIN_HOST_REQUESTS,
  PLUGIN_HOST_STDERR_LINE_MAX,
  validateManifest,
  type EngineCallParams,
  type ExtensionEntry,
  type HookName,
  type PluginHostError,
  type ToolChangeReport,
  type PluginHostRequestName,
  type PluginRegistrationDecl,
  type RawPluginHostFrame,
  type RegistrationFn,
  type RegistrationId,
} from "@fresnel/contracts/extensions";
import { eraseRegistration, stateAs } from "../erase.ts";
import { PrimitiveError } from "../primitives/errors.ts";
import {
  registerSdkModules,
  X_SDK_MODULES,
  type SdkModules,
} from "../loading-trust/virtual-modules.ts";
import {
  createChildRegistration,
  declOf,
  describeParse,
  isHookName,
  messageOf,
  PluginEngineCallError,
  type CallScope,
  type ChildEnv,
  type ChildRegistration,
  type HandlerSlot,
  type RegState,
} from "./child-api.ts";
import {
  createFrameReader,
  createFrameWriter,
  type FrameReadResult,
  type FrameSink,
} from "./framing.ts";
import {
  parseCommandRun,
  parseEventNotify,
  parseHookInvoke,
  parseHostDispose,
  parseHostInit,
  parseMethodCall,
  parseRequestCancel,
  parseScopeDispose,
  parseToolExecute,
  type CommandRunInput,
  type EventNotifyInput,
  type HookInvokeInput,
  type HostInitInput,
  type MethodCallInput,
  type ToolExecuteInput,
} from "./params.ts";

/** 프로세스가 끝나는 이유. `init_failed`는 host.init이 실패해 응답 뒤 끝난 것, `fault`는 루프 자체가 실패한 것이다 */
export type PluginHostExit = "disposed" | "stdin_closed" | "init_failed" | "fault";

/** 엔트리를 싣지 못한 이유. 값이다 */
export interface ImportEntryError {
  readonly kind:
    | "entry_not_found"
    | "entry_outside_root"
    | "entry_import_failed"
    | "entry_not_function";
  readonly message: string;
}

/** 확장 루트와 엔트리 경로로 엔트리를 싣는다. 테스트는 다른 구현을 넣는다 */
export type ImportEntry = (
  root: string,
  entry: string,
) => Promise<Result<ExtensionEntry, ImportEntryError>>;

export interface PluginHostDeps {
  /** 엔진이 보내는 바이트 스트림(표준입력). 끝나면 엔진이 닫았거나 죽은 것이다 */
  readonly input: AsyncIterable<Uint8Array>;
  /** 엔진으로 가는 쓰기(표준출력). 줄 하나가 프레임 하나다 */
  readonly output: FrameSink;
  /** 진단 줄을 쓰는 표준오류. 없으면 진단을 버린다 */
  readonly stderr?: FrameSink;
  /** 플러그인 번들이 import할 SDK 가상 모듈. X의 고정 모듈에 더해 등록한다(예: `@fresnel/group-sdk`) */
  readonly sdkModules: SdkModules;
  /** 엔트리를 싣는 함수. 생략하면 확장 루트 안의 파일을 import한다 */
  readonly importEntry?: ImportEntry;
}

type Outcome = Result<JsonValue, PluginHostError>;
/** 응답을 만드는 엔진 요청. host.init과 host.dispose는 따로 다룬다 */
type ServedName = "hook.invoke" | "tool.execute" | "command.run" | "method.call" | "scope.dispose";
type UnknownCallable = (...args: readonly unknown[]) => unknown;

/** 프로토콜 FrameShape의 error.message 상한(isolation-protocol.ts)과 같다 */
const MESSAGE_MAX = 4000;

interface PendingEngineCall {
  readonly resolve: (value: JsonValue) => void;
  readonly reject: (reason: unknown) => void;
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      settle?.(value);
    },
  };
}

function threw(message: string): PluginHostError {
  return { kind: "handler_threw", message };
}

function unknownTarget(what: string): Outcome {
  return err({ kind: "unknown_target", message: `no ${what}` });
}

function invalidParamsError(error: ParseError): PluginHostError {
  return { kind: "invalid_params", message: describeParse(error) };
}

function invalidParams(error: ParseError): Outcome {
  return err(invalidParamsError(error));
}

function clip(text: string): string {
  return text.length > MESSAGE_MAX ? text.slice(0, MESSAGE_MAX) : text;
}

function requestNameOf(method: string): PluginHostRequestName | undefined {
  return PLUGIN_HOST_REQUESTS.find((name) => name === method);
}

/** 핸들러 결과를 응답 값으로 바꾼다. undefined는 null이고 JSON이 아니면 실패다 */
function resultOf(value: unknown): Outcome {
  if (value === undefined) return ok(null);
  const json = toJsonValue(value);
  return json === undefined
    ? err(threw("the handler returned a value that is not JSON"))
    : ok(json);
}

/** 훅 인자: chain은 (payload, current, ctx), 그 밖은 (payload, ctx) */
function handlerArgs(
  point: HookName,
  payload: JsonValue,
  current: JsonValue,
  ctx: {
    readonly scopeId: string;
    readonly state: unknown;
    readonly threadId: unknown;
    readonly signal: AbortSignal;
  },
): readonly unknown[] {
  return HOOKS[point].fold === "chain" ? [payload, current, ctx] : [payload, ctx];
}

function replyOf(value: unknown): Result<JsonValue, Error> {
  const json = parse(JsonValueSchema, value);
  return json.ok
    ? ok(json.value)
    : err(new PluginEngineCallError("invalid_reply", "the engine reply is not JSON"));
}

function failureOf(error: RawPluginHostFrame["error"]): Result<JsonValue, Error> {
  return err(
    new PluginEngineCallError(
      error?.kind ?? "invalid_reply",
      error?.message ?? "the engine sent a failure without an error",
    ),
  );
}

/** 상태 응답이 막힌 이유를 찾는다. `setup`이 `err(SetupRefusal)`을 돌려주면 그 reason이다 */
function refusalOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("ok" in value)) return undefined;
  if (value.ok !== false || !("error" in value)) return undefined;
  const error = value.error;
  if (typeof error !== "object" || error === null || !("reason" in error)) return undefined;
  return typeof error.reason === "string" ? error.reason : undefined;
}

function hasKey<K extends string>(value: object, key: K): value is Record<K, unknown> {
  return key in value;
}

function isCallable(value: unknown): value is UnknownCallable {
  return typeof value === "function";
}

/** 모듈의 `default` 또는 `extension` 중 함수인 쪽. `default`가 먼저다(X.loading-trust.spec §4.4.2) */
function callableExportOf(loaded: unknown): UnknownCallable | undefined {
  if (typeof loaded !== "object" || loaded === null) return undefined;
  for (const key of ["default", "extension"] as const) {
    if (hasKey(loaded, key)) {
      const value = loaded[key];
      if (isCallable(value)) return value;
    }
  }
  return undefined;
}

/**
 * 확장 루트 안의 엔트리 파일을 싣는다. 정규 경로가 루트 밖이면 싣지 않는다(X.loading-trust.spec §4.4.2와 같은 규칙).
 * 실패는 모두 값이다
 */
async function importEntryFile(
  root: string,
  entry: string,
): Promise<Result<ExtensionEntry, ImportEntryError>> {
  const realRoot = await attemptAsync(() => realpath(root));
  if (!realRoot.ok) {
    return err({ kind: "entry_not_found", message: `extension root ${root} cannot be resolved` });
  }
  const resolved = await attemptAsync(() => realpath(join(realRoot.value, entry)));
  if (!resolved.ok) {
    return err({ kind: "entry_not_found", message: `entry ${entry} does not exist` });
  }
  const prefix = realRoot.value.endsWith(sep) ? realRoot.value : `${realRoot.value}${sep}`;
  if (!resolved.value.startsWith(prefix)) {
    return err({
      kind: "entry_outside_root",
      message: `entry ${entry} resolves outside the extension root`,
    });
  }
  const loaded = await attemptAsync(async () => {
    const loadedModule: unknown = await import(pathToFileURL(resolved.value).href);
    return loadedModule;
  });
  if (!loaded.ok) {
    return err({
      kind: "entry_import_failed",
      message: `entry ${entry} failed to import: ${messageOf(loaded.error.cause)}`,
    });
  }
  const exported = callableExportOf(loaded.value);
  if (exported === undefined) {
    return err({
      kind: "entry_not_function",
      message: `entry ${entry} exports neither a default nor an "extension" function`,
    });
  }
  const entryFn: ExtensionEntry = async (host) => {
    await exported(host);
  };
  return ok(entryFn);
}

function createRuntime(deps: PluginHostDeps) {
  const writer = createFrameWriter(deps.output);
  const scopes = new AsyncLocalStorage<CallScope>();
  const exit = deferred<PluginHostExit>();
  // host.init의 결과. true면 등록이 끝났고 요청을 처리해도 된다
  const ready = deferred<boolean>();
  const registrations = new Map<RegistrationId, ChildRegistration>();
  const inFlight = new Map<number, AbortController>();
  const pending = new Map<number, PendingEngineCall>();
  const lifetime = new AbortController();
  let started = false;
  let finished = false;
  let engineCallCount = 0;

  function diag(text: string): void {
    // 표준오류 채널이 실패하면 알릴 다른 길이 없다. 줄 상한은 PLUGIN_HOST_STDERR_LINE_MAX다(TY-25 기록 후 계속)
    attempt(() => deps.stderr?.write(`${text.slice(0, PLUGIN_HOST_STDERR_LINE_MAX)}\n`));
  }

  function fault(where: string, cause: unknown): void {
    diag(`${where} failed: ${messageOf(cause)}`);
  }

  function respond(id: number, outcome: Outcome): void {
    const frame = outcome.ok
      ? { id, result: outcome.value }
      : { id, error: { kind: outcome.error.kind, message: clip(outcome.error.message) } };
    const sent = writer.write(frame);
    if (sent.ok) return;
    if (outcome.ok && sent.error.kind === "frame_too_large") {
      // 결과가 상한을 넘으면 결과 대신 오류를 보낸다. 오류 프레임은 작다
      const replaced = writer.write({
        id,
        error: { kind: "frame_too_large", message: `the reply exceeds ${sent.error.max} bytes` },
      });
      if (!replaced.ok) diag(`reply ${id} could not be sent (${replaced.error.kind})`);
      return;
    }
    diag(`reply ${id} could not be sent (${sent.error.kind})`);
  }

  /** 엔진에 `engine.call` 요청을 보내고 응답을 기다린다. 응답 id는 이 호출의 카운터다 */
  function engineCall(params: EngineCallParams): Promise<JsonValue> {
    engineCallCount += 1;
    const id = engineCallCount;
    return new Promise<JsonValue>((resolve, reject) => {
      const body = toJsonValue(params);
      if (body === undefined) {
        reject(new PluginEngineCallError("encode_failed", "the engine call params are not JSON"));
        return;
      }
      pending.set(id, { resolve, reject });
      const sent = writer.write({ id, method: "engine.call", params: body });
      if (!sent.ok) {
        pending.delete(id);
        reject(
          new PluginEngineCallError(
            sent.error.kind,
            `the engine call could not be sent (${sent.error.kind})`,
          ),
        );
      }
    });
  }

  function settleEngineCall(id: number, reply: Result<JsonValue, Error>): void {
    const call = pending.get(id);
    if (call === undefined) {
      diag(`a reply came for no engine call (${id})`);
      return;
    }
    pending.delete(id);
    if (reply.ok) call.resolve(reply.value);
    else call.reject(reply.error);
  }

  function handlerOf(
    registration: string,
    point: string,
    handlerIndex: number,
  ): { readonly state: RegState; readonly slot: HandlerSlot } | undefined {
    const reg = registrations.get(registration);
    if (reg === undefined || !isHookName(point)) return undefined;
    const slot = reg.state.slots.get(point)?.[handlerIndex];
    if (slot === undefined || !slot.active) return undefined;
    return { state: reg.state, slot };
  }

  /** 요청 문맥 안에서 일을 한다. 던지거나 거부되면 `handler_threw`다 */
  async function runIn(scope: CallScope, work: () => unknown): Promise<Outcome> {
    const called = await attemptAsync(() => Promise.resolve(scopes.run(scope, work)));
    if (!called.ok) return err(threw(messageOf(called.error.cause)));
    return resultOf(called.value);
  }

  async function invokeHook(
    id: number,
    input: HookInvokeInput,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const found = handlerOf(input.registration, input.point, input.handlerIndex);
    if (found === undefined) {
      return unknownTarget(`hook ${input.point} #${input.handlerIndex} of ${input.registration}`);
    }
    const { state, slot } = found;
    const scope: CallScope = {
      kind: "hook",
      registration: state.id,
      requestId: id,
      threadId: input.threadId,
      signal,
      point: slot.point,
      settings: input.settings,
      snapshot: { doc: input.state },
      ...(input.dispatchKey === undefined ? {} : { dispatchKey: input.dispatchKey }),
    };
    const ctx = {
      scopeId: state.id,
      state: stateAs(input.state),
      threadId: input.threadId,
      signal,
    };
    const args = handlerArgs(slot.point, input.payload, input.current, ctx);
    return runIn(scope, () => slot.fn(...args));
  }

  async function executeTool(
    id: number,
    input: ToolExecuteInput,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const state = registrations.get(input.registration)?.state;
    const tool = state?.tools.get(input.name);
    if (state === undefined || tool === undefined) {
      return unknownTarget(`tool ${input.name} of ${input.registration}`);
    }
    const scope: CallScope = {
      kind: "tool",
      registration: state.id,
      requestId: id,
      threadId: input.threadId,
      signal,
      point: null,
      settings: input.settings,
      snapshot: { doc: input.state },
    };
    // `ctx.changes.report`는 기다리지 않는 호출이다. 엔진이 도구 요청을 끝내기 전에 닿도록 응답 앞에 모두 기다린다
    const reports: Promise<boolean>[] = [];
    const changes: ToolChangeReport = {
      report(entries) {
        const json = toJsonValue(entries);
        if (json === undefined) {
          diag(`ctx.changes.report of ${state.id} ignored entries that are not JSON`);
          return;
        }
        reports.push(
          sendReport(state.id, id, json).then((sent) => {
            if (sent.ok) return true;
            diag(`ctx.changes.report of ${state.id} failed: ${messageOf(sent.error)}`);
            return false;
          }),
        );
      },
    };
    const outcome = await runIn(scope, () =>
      tool.execute(input.args, {
        threadId: input.threadId,
        signal,
        toolCallId: input.toolCallId,
        caller: input.callerInfo,
        changes,
      }),
    );
    await Promise.all(reports);
    return outcome;
  }

  async function sendReport(
    registration: string,
    requestId: number,
    entries: JsonValue,
  ): Promise<Result<null, Error>> {
    const sent = await attemptAsync(() =>
      engineCall({ method: "reportChanges", registration, requestId, params: { entries } }),
    );
    return sent.ok
      ? ok(null)
      : err(
          sent.error.cause instanceof Error
            ? sent.error.cause
            : new Error(String(sent.error.cause)),
        );
  }

  async function runCommand(
    id: number,
    input: CommandRunInput,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const state = registrations.get(input.registration)?.state;
    const command = state?.commands.get(input.name);
    if (state === undefined || command === undefined) {
      return unknownTarget(`command ${input.name} of ${input.registration}`);
    }
    const scope: CallScope = {
      kind: "command",
      registration: state.id,
      requestId: id,
      threadId: input.threadId,
      signal,
      point: null,
      settings: input.settings,
      snapshot: { doc: input.state },
    };
    return runIn(scope, () =>
      command.handler(input.args, {
        threadId: input.threadId,
        invocationId: input.invocationId,
        signal,
      }),
    );
  }

  async function runMethod(
    id: number,
    input: MethodCallInput,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const state = registrations.get(input.registration)?.state;
    const method = state?.methods.get(input.verb);
    if (state === undefined || method === undefined) {
      return unknownTarget(`method ${input.verb} of ${input.registration}`);
    }
    const scope: CallScope = {
      kind: "method",
      registration: state.id,
      requestId: id,
      threadId: input.threadId,
      signal,
      point: null,
      settings: input.settings,
      snapshot: { doc: input.state },
    };
    return runIn(scope, () =>
      method.handler(input.params, {
        threadId: input.threadId,
        callId: input.callId,
        signal,
        caller: input.callerKind,
      }),
    );
  }

  /** 정리 동작을 등록 순서대로 하나씩 돈다. 실패는 진단으로 남기고 계속한다(TY-25, 정리 단계) */
  async function runDisposers(state: RegState): Promise<void> {
    const list = state.disposers.splice(0, state.disposers.length);
    await eachAsync(list, async (dispose) => {
      const done = await attemptAsync(() => Promise.resolve(dispose()));
      if (!done.ok) diag(`onDispose of ${state.id} failed: ${messageOf(done.error.cause)}`);
      return undefined;
    });
  }

  async function disposeRegistration(registration: string): Promise<Outcome> {
    const reg = registrations.get(registration);
    if (reg === undefined) return unknownTarget(`registration ${registration}`);
    await runDisposers(reg.state);
    return ok(null);
  }

  async function dispatch(
    id: number,
    name: ServedName,
    params: unknown,
    signal: AbortSignal,
  ): Promise<Outcome> {
    switch (name) {
      case "hook.invoke": {
        const input = parseHookInvoke(params);
        return input.ok ? await invokeHook(id, input.value, signal) : invalidParams(input.error);
      }
      case "tool.execute": {
        const input = parseToolExecute(params);
        return input.ok ? await executeTool(id, input.value, signal) : invalidParams(input.error);
      }
      case "command.run": {
        const input = parseCommandRun(params);
        return input.ok ? await runCommand(id, input.value, signal) : invalidParams(input.error);
      }
      case "method.call": {
        const input = parseMethodCall(params);
        return input.ok ? await runMethod(id, input.value, signal) : invalidParams(input.error);
      }
      case "scope.dispose": {
        const input = parseScopeDispose(params);
        return input.ok
          ? await disposeRegistration(input.value.registration)
          : invalidParams(input.error);
      }
      default:
        return assertNever(name, "dispatch");
    }
  }

  async function serve(id: number, name: ServedName, params: unknown): Promise<void> {
    const up = await ready.promise;
    if (!up) {
      respond(id, err({ kind: "unknown_target", message: "the plugin host did not initialize" }));
      return;
    }
    const controller = new AbortController();
    inFlight.set(id, controller);
    const outcome = await dispatch(id, name, params, controller.signal);
    inFlight.delete(id);
    respond(id, outcome);
  }

  /** 스트림 관찰 알림. 같은 핸들러에는 발화 순서대로 하나씩 전달하고, 결과는 버리고 실패는 진단으로 남긴다 */
  async function deliver(params: unknown): Promise<void> {
    const up = await ready.promise;
    if (!up) return;
    const input = parseEventNotify(params);
    if (!input.ok) {
      diag(`event.notify dropped: ${describeParse(input.error)}`);
      return;
    }
    const event: EventNotifyInput = input.value;
    const found = handlerOf(event.registration, event.point, event.handlerIndex);
    if (found === undefined) {
      diag(`event.notify for no handler: ${event.registration} ${event.point}`);
      return;
    }
    const { state, slot } = found;
    const scope: CallScope = {
      kind: "notify",
      registration: state.id,
      requestId: null,
      threadId: event.threadId,
      signal: lifetime.signal,
      point: slot.point,
      settings: event.settings,
      snapshot: { doc: event.state },
      dispatchKey: event.dispatchKey ?? event.eventKey,
    };
    const ctx = {
      scopeId: state.id,
      state: stateAs(event.state),
      threadId: event.threadId,
      signal: lifetime.signal,
    };
    const args = handlerArgs(slot.point, event.payload, null, ctx);
    const run = slot.tail.then(() => deliverOne(scope, slot, args));
    slot.tail = run;
    await run;
  }

  /** 알림 하나를 핸들러에 돌린다. 결과는 버리고 실패는 진단으로 남긴다 */
  async function deliverOne(
    scope: CallScope,
    slot: HandlerSlot,
    args: readonly unknown[],
  ): Promise<void> {
    const outcome = await runIn(scope, () => slot.fn(...args));
    if (!outcome.ok)
      diag(`event handler of ${scope.registration} failed: ${outcome.error.message}`);
  }

  function onRequest(id: number, method: string, params: unknown): void {
    const name = requestNameOf(method);
    if (name === undefined) {
      respond(id, unknownTarget(`request ${method}`));
      return;
    }
    switch (name) {
      case "host.init":
        detach(handleInit(id, params), (cause) => fault("host.init", cause));
        return;
      case "host.dispose":
        detach(handleDispose(id, params), (cause) => fault("host.dispose", cause));
        return;
      case "hook.invoke":
      case "tool.execute":
      case "command.run":
      case "method.call":
      case "scope.dispose":
        // host.init이 먼저 와야 한다. 그 전의 요청은 준비를 기다리지 않고 바로 오류로 답한다
        if (!started) {
          respond(
            id,
            err({ kind: "invalid_params", message: "host.init must be the first request" }),
          );
          return;
        }
        detach(serve(id, name, params), (cause) => fault(name, cause));
        return;
      default:
        return assertNever(name, "onRequest");
    }
  }

  function onNotification(method: string, params: unknown): void {
    if (method === "request.cancel") {
      const input = parseRequestCancel(params);
      if (!input.ok) {
        diag(`request.cancel dropped: ${describeParse(input.error)}`);
        return;
      }
      // 취소한 요청의 늦은 응답은 보낸다. 버리는 일은 엔진이 한다
      inFlight.get(input.value.id)?.abort();
      return;
    }
    if (method === "event.notify") {
      detach(deliver(params), (cause) => fault("event.notify", cause));
      return;
    }
    diag(`unknown notification ${method}`);
  }

  function onFrame(item: FrameReadResult): void {
    if (!item.ok) {
      diag(`frame dropped: ${item.error.kind}`);
      return;
    }
    const frame = item.value;
    switch (frame.kind) {
      case "request":
        onRequest(frame.id, frame.method, frame.params);
        return;
      case "notification":
        onNotification(frame.method, frame.params);
        return;
      case "response":
        settleEngineCall(frame.id, replyOf(frame.result));
        return;
      case "failure":
        settleEngineCall(frame.id, failureOf(frame.error));
        return;
      default:
        return assertNever(frame, "onFrame");
    }
  }

  /** 등록을 만든다: 엔트리 실행, setup 실행, 막힌 API 검사, 선언 만들기 */
  async function boot(input: HostInitInput): Promise<Outcome> {
    if (input.protocolVersion !== PLUGIN_HOST_PROTOCOL_VERSION) {
      return err({
        kind: "protocol_version",
        message: `this host speaks protocol ${String(PLUGIN_HOST_PROTOCOL_VERSION)}, the engine sent ${String(input.protocolVersion)}`,
      });
    }
    const sdk = registerSdkModules({ ...X_SDK_MODULES, ...deps.sdkModules });
    if (!sdk.ok) return err(threw(`SDK module registration failed (${sdk.error.kind})`));

    const verdict = validateManifest(input.manifest);
    const manifest = verdict.manifest;
    const firstError = verdict.issues.find((issue) => issue.severity === "error");
    if (manifest === undefined || firstError !== undefined) {
      return err({
        kind: "invalid_params",
        message: `host.init manifest is invalid${firstError === undefined ? "" : `: ${firstError.message}`}`,
      });
    }

    const importer = deps.importEntry ?? importEntryFile;
    const imported = await importer(input.root, input.entry);
    if (!imported.ok) return err(threw(imported.error.message));

    const env: ChildEnv = {
      extension: input.extension,
      initSettings: input.settings,
      scopes,
      engineCall,
      declaredHooks: new Map(
        pluginsOf(manifest).map((entry) => [entry.registrationId, entry.decl.hooks]),
      ),
      report: diag,
    };
    let registering = true;
    const register: RegistrationFn = (id, def, setup) => {
      if (!registering) {
        throw new PrimitiveError(
          "registration_inactive",
          `register of ${id} is only callable while the entry runs`,
        );
      }
      if (registrations.has(id)) {
        throw new PrimitiveError(
          "registration_duplicate",
          `registration ${id} is already registered`,
          {
            scopeId: id,
          },
        );
      }
      const erased = eraseRegistration(def, setup);
      registrations.set(id, createChildRegistration(id, erased.def, erased.setup, env));
      return {
        id,
        status: "enabled",
        enable: () => undefined,
        disable: () => undefined,
      };
    };
    const ran = await attemptAsync(() => Promise.resolve(imported.value({ manifest, register })));
    registering = false;
    if (!ran.ok) {
      return err(threw(`entry of ${input.extension} threw: ${messageOf(ran.error.cause)}`));
    }

    for (const reg of registrations.values()) reg.state.inSetup = true;
    const setupFailure = await eachAsync(registrations.values(), async (reg) => {
      const outcome = await attemptAsync(() => Promise.resolve(reg.setup(reg.api)));
      if (!outcome.ok) {
        return {
          value: threw(`setup of ${reg.state.id} threw: ${messageOf(outcome.error.cause)}`),
        };
      }
      const refusal = refusalOf(outcome.value);
      if (refusal !== undefined) {
        return { value: threw(`setup of ${reg.state.id} refused to start: ${refusal}`) };
      }
      return undefined;
    });
    for (const reg of registrations.values()) reg.state.inSetup = false;

    // 막힌 API를 쓴 등록은 setup이 오류를 삼켰더라도 실패다. 실패 이유 가운데 이것을 먼저 보고한다
    for (const reg of registrations.values()) {
      if (reg.state.unsupported.length > 0) {
        return err({
          kind: "unsupported_api",
          message: `plugin ${reg.state.id} uses ${reg.state.unsupported.join(", ")}, which an isolated plugin host does not support`,
        });
      }
    }
    if (setupFailure !== undefined) return err(setupFailure.value);

    const decls: PluginRegistrationDecl[] = [];
    for (const reg of registrations.values()) {
      const decl = declOf(reg.state);
      if (!decl.ok) return decl;
      decls.push(decl.value);
    }
    const body = toJsonValue({
      protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
      registrations: decls,
    });
    return body === undefined ? err(threw("the registration declarations are not JSON")) : ok(body);
  }

  async function failInit(id: number, error: PluginHostError): Promise<void> {
    respond(id, err(error));
    ready.resolve(false);
    await decide("init_failed");
  }

  async function handleInit(id: number, params: unknown): Promise<void> {
    if (started) {
      respond(id, err({ kind: "invalid_params", message: "host.init was already received" }));
      return;
    }
    started = true;
    const input = parseHostInit(params);
    if (!input.ok) {
      await failInit(id, invalidParamsError(input.error));
      return;
    }
    const booted = await boot(input.value);
    if (!booted.ok) {
      await failInit(id, booted.error);
      return;
    }
    ready.resolve(true);
    respond(id, booted);
  }

  async function handleDispose(id: number, params: unknown): Promise<void> {
    const input = parseHostDispose(params);
    if (!input.ok) {
      respond(id, invalidParams(input.error));
      return;
    }
    if (finished) {
      respond(id, ok(null));
      return;
    }
    finished = true;
    await shutdown();
    respond(id, ok(null));
    exit.resolve("disposed");
  }

  /** 떠나는 길: 요청과 엔진 호출을 끊고 모든 정리 동작을 돈다. 한 번만 한다 */
  async function shutdown(): Promise<void> {
    lifetime.abort();
    for (const controller of inFlight.values()) controller.abort();
    for (const call of pending.values()) {
      call.reject(new PluginEngineCallError("engine_closed", "the engine connection closed"));
    }
    pending.clear();
    await eachAsync(registrations.values(), async (reg) => {
      await runDisposers(reg.state);
      return undefined;
    });
  }

  async function decide(kind: PluginHostExit): Promise<void> {
    if (finished) return;
    finished = true;
    await shutdown();
    exit.resolve(kind);
  }

  /** 입력이 끝날 때까지 프레임을 읽는다. 끝나면 `stdin_closed`로 끝낸다. 종료가 먼저 정해졌으면 읽기를 멈춘다 */
  async function readAll(): Promise<void> {
    const reader = createFrameReader(deps.input);
    const inputEnded = await repeatAsync<boolean>(async () => {
      const item = await reader.next();
      if (item === null) return { value: true };
      if (finished) return { value: false };
      onFrame(item);
      return undefined;
    });
    if (inputEnded) await decide("stdin_closed");
  }

  function crash(cause: unknown): void {
    fault("frame loop", cause);
    detach(decide("fault"), (inner) => fault("shutdown", inner));
  }

  return { exit, readAll, crash };
}

/**
 * 플러그인 호스트의 자식 쪽 실행. 입력 스트림을 읽는 루프를 돌리고, 끝나는 이유를 돌려준다.
 * 함수는 던지지 않는다. 예상할 수 있는 실패는 엔진에 오류 응답으로 가고, 끝남은 `PluginHostExit`다
 */
export function runPluginHost(deps: PluginHostDeps): Promise<PluginHostExit> {
  const runtime = createRuntime(deps);
  detach(runtime.readAll(), runtime.crash);
  return runtime.exit.promise;
}
