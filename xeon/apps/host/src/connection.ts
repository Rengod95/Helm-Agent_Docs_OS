import { parse } from "@xeon/contracts";
import {
  checkEnvelope,
  internalJsonRpcError,
  RpcIdSchema,
  toJsonRpcError,
  WIRE_CLIENT_NOTIFICATIONS,
  WIRE_LIMITS,
  WIRE_METHODS,
  wireError,
  WireError,
  type CloseInfo,
  type JsonRpcError,
  type JsonRpcMessage,
  type JsonRpcRequest,
  type RpcId,
  type ServerNotificationName,
  type ServerNotificationParams,
  type Transport,
  type WireHandlers,
  type WireMethodName,
  type WireParams,
  type WireRequestContext,
  type WireResult,
} from "@xeon/contracts/wire";
import { startEventFanout } from "./handlers/events.ts";
import { isNotImplemented } from "./handlers/not-implemented.ts";
import type {
  ConnectionHub,
  ConnectionState,
  HostLimits,
  SendQueue,
  SendWaitOutcome,
  ServedConnection,
  ServeOptions,
} from "./connection-types.ts";
import type { Engine } from "./types.ts";
import { messageOf, stackOf, toRecord } from "./util.ts";

export type { HostLimits, ServedConnection } from "./connection-types.ts";

// L4.host-service.spec §3.3.3, §4.2~§4.3. 한 호스트 프로세스의 연결 표와 요청 처리 순서(F.wire-settings.spec §4.3).
// 이 파일과 handlers/ 는 EnginePorts만 쓰고 아래 층 패키지를 import하지 않는다(L4.host-service.plan §2).

/** 재전송 묶음 크기(F wire §3.4.3) */
export const REPLAY_BATCH_MAX_EVENTS = 500;
/** 재전송 한 번에 훑는 행 수 상한(F wire §3.4.3) */
export const REPLAY_SCAN_LIMIT = 10_000;
/** 송신 큐가 이 아래로 내려가야 다음 재전송 묶음을 읽는다(HS-05) */
export const SEND_LOW_WATER_BYTES = 1_048_576;
/** 송신 큐가 이 값을 넘으면 연결을 닫는다: WIRE_LIMITS.maxFrameBytes의 64배(HS-05) */
const SEND_QUEUE_MAX_BYTES: number = WIRE_LIMITS.maxFrameBytes * 64;
/** 종료 중 새 요청에 돌려주는 재시도 대기(HS-31) */
const SHUTDOWN_RETRY_AFTER_MS = 1000;

function byteLength(message: JsonRpcMessage): number {
  return Buffer.byteLength(JSON.stringify(message));
}

function isWireMethod(name: string): name is WireMethodName {
  return Object.hasOwn(WIRE_METHODS, name);
}

type RunOutcome<M extends WireMethodName> =
  | { readonly kind: "result"; readonly result: WireResult<M> }
  | {
      readonly kind: "invalidParams";
      readonly issues: readonly { readonly path: string; readonly message: string }[];
    };

function failureMessage(id: string | null, error: JsonRpcError): JsonRpcMessage {
  return { jsonrpc: "2.0", id, error };
}

/** 읽을 수 없는 id는 null이다(F wire §3.2) */
function readableId(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const parsed = parse(RpcIdSchema, Reflect.get(raw, "id"));
  return parsed.ok ? parsed.value : null;
}

interface SendQueueHooks {
  onOverflow(): void;
  onFailure(error: unknown): void;
}

function createSendQueue(
  transport: Transport,
  limits: HostLimits,
  hooks: SendQueueHooks,
): SendQueue & { close(): void } {
  const queue: { readonly message: JsonRpcMessage; readonly bytes: number }[] = [];
  const waiters = new Set<{ readonly resolve: (outcome: SendWaitOutcome) => void }>();
  const state = { queued: 0, pumping: false, closed: false };
  const maxBytes = limits.sendQueueMaxBytes ?? SEND_QUEUE_MAX_BYTES;

  function settleWaiters(): void {
    if (state.queued >= limits.sendLowWaterBytes && !state.closed) return;
    for (const waiter of Array.from(waiters)) {
      waiters.delete(waiter);
      waiter.resolve(state.closed ? "closed" : "ready");
    }
  }

  function dropAll(): void {
    state.closed = true;
    state.pumping = false;
    queue.length = 0;
    state.queued = 0;
    settleWaiters();
  }

  function fail(caught: unknown): void {
    dropAll();
    hooks.onFailure(caught);
  }

  /** 맨 앞 메시지를 보내고 끝나면 다음을 보낸다. 약속 사슬을 늘리지 않으려고 then 콜백에서 이어 간다 */
  function drain(): void {
    const head = queue[0];
    if (head === undefined || state.closed) {
      state.pumping = false;
      return;
    }
    let sending: Promise<void>;
    try {
      sending = transport.send(head.message);
    } catch (caught) {
      fail(caught);
      return;
    }
    sending.then(
      () => {
        if (state.closed) return undefined;
        queue.shift();
        state.queued -= head.bytes;
        settleWaiters();
        drain();
        return undefined;
      },
      (caught: unknown) => {
        fail(caught);
      },
    );
  }

  return {
    push(message) {
      if (state.closed) return;
      const bytes = byteLength(message);
      queue.push({ message, bytes });
      state.queued += bytes;
      if (state.queued > maxBytes) {
        dropAll();
        hooks.onOverflow();
        return;
      }
      if (state.pumping) return;
      state.pumping = true;
      drain();
    },
    get bytes() {
      return state.queued;
    },
    waitBelowLowWater(signal) {
      if (state.closed) return Promise.resolve("closed");
      if (state.queued < limits.sendLowWaterBytes) return Promise.resolve("ready");
      if (signal?.aborted === true) return Promise.resolve("aborted");
      return new Promise<SendWaitOutcome>((resolve) => {
        const waiter = {
          resolve(outcome: SendWaitOutcome) {
            signal?.removeEventListener("abort", onAbort);
            resolve(outcome);
          },
        };
        const onAbort = (): void => {
          waiters.delete(waiter);
          waiter.resolve("aborted");
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        waiters.add(waiter);
      });
    },
    close: dropAll,
  };
}

interface HubInternals {
  readonly connections: Map<string, ConnectionState>;
  readonly sizeListeners: Set<(size: number) => void>;
  readonly served: Map<string, ServedConnection>;
  shuttingDown: boolean;
}

export function createConnectionHub(engine: Engine, handlers: WireHandlers): ConnectionHub {
  const internals: HubInternals = {
    connections: new Map(),
    sizeListeners: new Set(),
    served: new Map(),
    shuttingDown: false,
  };
  const { log, ids } = engine.ports;
  const counter = { connections: 0 };

  function emitSize(): void {
    for (const listener of Array.from(internals.sizeListeners)) {
      listener(internals.connections.size);
    }
  }

  async function runHandler<M extends WireMethodName>(
    method: M,
    rawParams: Record<string, unknown>,
    context: WireRequestContext,
  ): Promise<RunOutcome<M>> {
    const checked = parse(WIRE_METHODS[method].params, rawParams);
    if (!checked.ok) {
      return {
        kind: "invalidParams",
        issues: checked.error.issues.map((issue) => ({
          path: issue.path.slice(0, 512),
          message: issue.message.slice(0, 512),
        })),
      };
    }
    const params: WireParams<M> = checked.value;
    const result: WireResult<M> = await handlers[method](params, context);
    return { kind: "result", result };
  }

  function serve(transport: Transport, serveOptions: ServeOptions): ServedConnection {
    counter.connections += 1;
    const connectionId = `c${counter.connections}`;
    const closedWaiter = Promise.withResolvers<CloseInfo>();
    const closing: { override: CloseInfo | undefined } = { override: undefined };
    const inflight = new Map<RpcId, AbortController>();
    const afterResponse = new Map<RpcId, (() => void)[]>();
    const subCounter = { value: 0 };

    const sender = createSendQueue(transport, serveOptions.limits, {
      onOverflow() {
        log.error("connection.send_queue_overflow", { connectionId });
        closeWith({ reason: "error", message: "sendQueueOverflow" }, "sendQueueOverflow");
      },
      onFailure(error) {
        log.error("connection.send_failed", { connectionId, message: messageOf(error) });
        closeWith({ reason: "error", message: messageOf(error) }, undefined);
      },
    });

    const state: ConnectionState = {
      id: connectionId,
      transportKind: transport.kind,
      phase: "awaitingHello",
      experimental: [],
      subs: new Map(),
      openThreads: new Set(),
      limits: serveOptions.limits,
      sender,
      afterResponse(rpcId, fn) {
        const list = afterResponse.get(rpcId) ?? [];
        list.push(fn);
        afterResponse.set(rpcId, list);
      },
      nextSubId() {
        subCounter.value += 1;
        return `s${subCounter.value}`;
      },
    };
    internals.connections.set(connectionId, state);
    emitSize();

    function closeWith(info: CloseInfo, reason: string | undefined): void {
      if (closing.override === undefined) closing.override = info;
      transport.close(reason).catch(() => undefined);
    }

    function teardown(info: CloseInfo): void {
      if (state.phase === "closed") return;
      state.phase = "closed";
      sender.close();
      for (const controller of inflight.values()) controller.abort();
      inflight.clear();
      afterResponse.clear();
      for (const sub of state.subs.values()) sub.open = false;
      state.subs.clear();
      state.openThreads.clear();
      internals.connections.delete(connectionId);
      internals.served.delete(connectionId);
      emitSize();
      closedWaiter.resolve(closing.override ?? info);
    }

    function respondError(id: string | null, error: JsonRpcError): void {
      sender.push(failureMessage(id, error));
    }

    function notFound(id: string, method: string): void {
      respondError(
        id,
        toJsonRpcError(wireError("jsonrpc.methodNotFound", { details: { method } })),
      );
    }

    function makeContext(rpcId: RpcId, controller: AbortController): WireRequestContext {
      return {
        connectionId,
        rpcId,
        signal: controller.signal,
        notify<N extends ServerNotificationName>(name: N, params: ServerNotificationParams<N>) {
          if (state.phase === "closed") return;
          sender.push({ jsonrpc: "2.0", method: name, params: toRecord(params) });
        },
      };
    }

    async function invoke(
      method: WireMethodName,
      rawParams: Record<string, unknown>,
      rpcId: RpcId,
      controller: AbortController,
    ): Promise<void> {
      try {
        const outcome = await runHandler(method, rawParams, makeContext(rpcId, controller));
        if (outcome.kind === "invalidParams") {
          respondError(
            rpcId,
            toJsonRpcError(
              wireError("jsonrpc.invalidParams", { details: { issues: outcome.issues } }),
            ),
          );
          return;
        }
        if (serveOptions.devChecks) {
          const verdict = parse(WIRE_METHODS[method].result, outcome.result);
          if (!verdict.ok) {
            const traceId = ids.next("evt");
            log.error("handler.result_schema", {
              traceId,
              method,
              issues: verdict.error.issues.map((issue) => `${issue.path} ${issue.message}`),
            });
            respondError(rpcId, internalJsonRpcError(traceId));
            return;
          }
        }
        sender.push({ jsonrpc: "2.0", id: rpcId, result: toRecord(outcome.result) });
        runAfterResponse(rpcId);
      } catch (caught) {
        afterResponse.delete(rpcId);
        if (caught instanceof WireError) {
          respondError(rpcId, toJsonRpcError(caught));
        } else if (controller.signal.aborted) {
          respondError(rpcId, toJsonRpcError(wireError("request.cancelled")));
        } else {
          const traceId = ids.next("evt");
          log.error("handler.threw", {
            traceId,
            method,
            message: messageOf(caught),
            stack: stackOf(caught),
          });
          respondError(rpcId, internalJsonRpcError(traceId));
        }
      }
    }

    function runAfterResponse(rpcId: RpcId): void {
      const list = afterResponse.get(rpcId);
      afterResponse.delete(rpcId);
      for (const fn of list ?? []) fn();
    }

    async function handleRequest(request: JsonRpcRequest): Promise<void> {
      const { id, method } = request;
      if (internals.shuttingDown) {
        respondError(
          id,
          toJsonRpcError(
            wireError("host.shuttingDown", {
              retryAfterMs: SHUTDOWN_RETRY_AFTER_MS,
              details: { retryAfterMs: SHUTDOWN_RETRY_AFTER_MS },
            }),
          ),
        );
        return;
      }
      if (inflight.has(id)) {
        respondError(
          null,
          toJsonRpcError(
            wireError("jsonrpc.invalidRequest", {
              details: { issue: { code: "duplicateId", id } },
            }),
          ),
        );
        return;
      }
      if (state.phase === "awaitingHello" && method !== "host.hello") {
        respondError(id, toJsonRpcError(wireError("host.helloRequired")));
        return;
      }
      if (!isWireMethod(method) || isNotImplemented(handlers[method])) {
        notFound(id, method);
        return;
      }
      const controller = new AbortController();
      inflight.set(id, controller);
      try {
        await invoke(method, request.params, id, controller);
      } finally {
        inflight.delete(id);
      }
    }

    function handleNotification(method: string, params: Record<string, unknown>): void {
      if (method !== "$/cancelRequest") return;
      if (state.phase === "awaitingHello") return; // F wire §4.1 1: hello 전의 취소는 무시한다
      const parsed = parse(WIRE_CLIENT_NOTIFICATIONS["$/cancelRequest"].params, params);
      if (!parsed.ok) return;
      inflight.get(parsed.value.id)?.abort();
    }

    async function onRaw(raw: unknown): Promise<void> {
      if (state.phase === "closed") return;
      const checked = checkEnvelope(raw);
      if (!checked.ok) {
        const issue = checked.issue;
        const error =
          checked.errorCode === -32602
            ? wireError("jsonrpc.invalidParams", {
                details: {
                  issues: [
                    {
                      path: issue.code === "schema" ? issue.path : "",
                      message: issue.code === "schema" ? issue.message : issue.code,
                    },
                  ],
                },
              })
            : wireError("jsonrpc.invalidRequest", { details: { issue } });
        respondError(readableId(raw), toJsonRpcError(error));
        return;
      }
      const message = checked.message;
      if ("method" in message) {
        if ("id" in message) await handleRequest(message);
        else handleNotification(message.method, message.params);
      }
      // 클라이언트가 보낸 응답은 쓰지 않는다
    }

    transport.onMessage((raw) => {
      onRaw(raw).catch((caught: unknown) => {
        log.error("connection.dispatch_failed", { connectionId, message: messageOf(caught) });
      });
    });
    transport.onClose(teardown);

    const served: ServedConnection = {
      id: connectionId,
      transportKind: transport.kind,
      closed: closedWaiter.promise,
      async close(reason) {
        if (state.phase === "closed") return;
        await transport.close(reason);
        await closedWaiter.promise;
      },
    };
    internals.served.set(connectionId, served);
    return served;
  }

  const hub: ConnectionHub = {
    get size() {
      return internals.connections.size;
    },
    serve,
    onSizeChange(listener) {
      internals.sizeListeners.add(listener);
      return () => {
        internals.sizeListeners.delete(listener);
      };
    },
    async closeAll(reason) {
      const all = Array.from(internals.served.values());
      await Promise.all(all.map((connection) => connection.close(reason)));
    },
    state(connectionId) {
      return internals.connections.get(connectionId);
    },
    connections() {
      return Array.from(internals.connections.values());
    },
    beginShutdown() {
      internals.shuttingDown = true;
    },
    dispose() {
      stopFanout();
    },
  };
  const stopFanout = startEventFanout(engine, hub);
  return hub;
}
