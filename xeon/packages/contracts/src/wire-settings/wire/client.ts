import { detach, parse } from "../../base/index.ts";
import { WireError } from "./errors.ts";
import { checkEnvelope, type JsonRpcMessage } from "./jsonrpc.ts";
import {
  WIRE_METHODS,
  WIRE_NOTIFICATIONS,
  type ClientNotificationName,
  type ClientNotificationParams,
  type ServerNotificationName,
  type ServerNotificationParams,
  type WireMethodName,
  type WireParams,
  type WireResult,
} from "./methods.ts";
import type {
  CloseInfo,
  HostConnection,
  Transport,
  Unsubscribe,
  WireRequestOptions,
} from "./transport.ts";

// F.wire-settings.spec §3.1 `HostConnection`의 런타임 중립 구현(L4.desktop.spec §10 미결 3, L4.host-service.spec §3.3.4 client.ts).
// Bun·Node API를 쓰지 않는다: CLI(Bun), 호스트의 in-process 클라이언트, 데스크톱 WebView가 같은 구현을 쓴다.
// 이 파일이 import하는 것은 F 안의 base와 wire뿐이다. 서비스 모드 소켓 연결(`connectServiceTransport`)은 M3이고 L4 몫이다.

export interface HostConnectionOptions {
  /** 요청마다 따로 주지 않았을 때의 시한(ms). 없으면 시한 없음 */
  readonly defaultTimeoutMs?: number;
  /** 응답을 기다리지 않는 전송(취소 알림)이 실패했을 때 부른다. 진단용이다 */
  readonly onTransportError?: (cause: unknown) => void;
}

export type HostClientErrorKind =
  | "closed"
  | "timeout"
  | "aborted"
  | "sendFailed"
  /** 서버 응답이 계약 스키마와 맞지 않는다 */
  | "invalidResponse";

/**
 * 서버가 응답하지 못한 요청의 끝. 서버가 오류로 응답한 경우는 WireError다.
 * `closed`는 응답 전에 연결이 닫힌 것이고 closeInfo가 있다. 이때 `turn.start`는 접수됐을 수 있으므로
 * 재접속 뒤 이벤트로 확인해야 한다(F.wire-settings.spec §5).
 */
export class HostClientError extends Error {
  override readonly name: string = "HostClientError";
  readonly kind: HostClientErrorKind;
  readonly closeInfo: CloseInfo | undefined;

  constructor(kind: HostClientErrorKind, message: string, closeInfo?: CloseInfo) {
    super(message);
    this.kind = kind;
    this.closeInfo = closeInfo;
  }
}

interface Pending {
  readonly method: string;
  resolve(result: unknown): void;
  reject(error: unknown): void;
}

function paramsRecord(params: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(params));
}

/** 서버 응답을 WIRE_METHODS[m].result로 검증해 도메인 타입으로 들인다. 프로세스 밖에서 온 값이라 타입을 믿지 않는다(TY-10) */
function toResult<M extends WireMethodName>(method: M, value: unknown): WireResult<M> {
  const checked = parse(WIRE_METHODS[method].result, value);
  if (!checked.ok) {
    throw new HostClientError("invalidResponse", `${method} result does not match its schema`);
  }
  return checked.value;
}

/** 알림 params를 WIRE_NOTIFICATIONS[n].params로 검증한다. 맞지 않으면 undefined라 핸들러를 부르지 않는다 */
function toNotification<N extends ServerNotificationName>(
  name: N,
  value: Record<string, unknown>,
): ServerNotificationParams<N> | undefined {
  const checked = parse(WIRE_NOTIFICATIONS[name].params, value);
  return checked.ok ? checked.value : undefined;
}

/** F의 HostConnection 구현. 요청 id는 연결마다 r1, r2, … 를 쓴다(F wire §3.1) */
export function createHostConnection(
  transport: Transport,
  options: HostConnectionOptions = {},
): HostConnection {
  const pending = new Map<string, Pending>();
  const notificationHandlers = new Map<string, Set<(params: Record<string, unknown>) => void>>();
  const closeWaiter = Promise.withResolvers<CloseInfo>();
  const state: { counter: number; closed: CloseInfo | undefined } = {
    counter: 0,
    closed: undefined,
  };

  function failAll(info: CloseInfo): void {
    const entries = [...pending.entries()];
    pending.clear();
    for (const [, entry] of entries) {
      entry.reject(
        new HostClientError(
          "closed",
          `connection closed before ${entry.method} was answered (${info.reason})`,
          info,
        ),
      );
    }
  }

  function dispatch(message: JsonRpcMessage): void {
    if ("method" in message) {
      if ("id" in message) return; // 서버 → 클라이언트 요청은 쓰지 않는다
      for (const handler of Array.from(notificationHandlers.get(message.method) ?? [])) {
        handler(message.params);
      }
      return;
    }
    if (message.id === null) return; // 요청과 짝지을 수 없는 오류(프레임 오류 등)
    const entry = pending.get(message.id);
    if (entry === undefined) return; // 시한이 지났거나 이미 끝난 요청
    pending.delete(message.id);
    if ("error" in message) {
      entry.reject(new WireError(message.error.code, message.error.message, message.error.data));
    } else {
      entry.resolve(message.result);
    }
  }

  transport.onMessage((raw) => {
    const checked = checkEnvelope(raw);
    if (!checked.ok) return;
    dispatch(checked.message);
  });
  transport.onClose((info) => {
    if (state.closed !== undefined) return;
    state.closed = info;
    failAll(info);
    closeWaiter.resolve(info);
  });

  function sendCancel(id: string): void {
    // 취소 알림을 못 보내도 요청은 시한이나 연결 닫힘으로 끝난다. 실패는 진단 훅으로 알린다
    detach(
      transport.send({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } }),
      (cause) => {
        options.onTransportError?.(cause);
      },
    );
  }

  return {
    request<M extends WireMethodName>(
      method: M,
      params: WireParams<M>,
      requestOptions?: WireRequestOptions,
    ): Promise<WireResult<M>> {
      if (state.closed !== undefined) {
        return Promise.reject(new HostClientError("closed", "connection is closed", state.closed));
      }
      const signal = requestOptions?.signal;
      if (signal?.aborted === true) {
        return Promise.reject(
          new HostClientError("aborted", `${method} was aborted before sending`),
        );
      }
      state.counter += 1;
      const id = `r${state.counter}`;
      const waiter = Promise.withResolvers<unknown>();
      const cleanups: (() => void)[] = [];
      const finish = (): void => {
        for (const cleanup of cleanups.splice(0)) cleanup();
      };
      pending.set(id, {
        method,
        resolve(result) {
          finish();
          waiter.resolve(result);
        },
        reject(error) {
          finish();
          waiter.reject(error);
        },
      });

      const timeoutMs = requestOptions?.timeoutMs ?? options.defaultTimeoutMs;
      if (timeoutMs !== undefined) {
        const timer = setTimeout(() => {
          if (!pending.delete(id)) return;
          sendCancel(id);
          finish();
          waiter.reject(new HostClientError("timeout", `${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        cleanups.push(() => {
          clearTimeout(timer);
        });
      }
      if (signal !== undefined) {
        const onAbort = (): void => {
          // 서버가 5001로 응답하거나 이미 낸 결과를 보낸다(F.wire-settings.spec §4.4). 응답을 기다린다
          if (pending.has(id)) sendCancel(id);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        cleanups.push(() => {
          signal.removeEventListener("abort", onAbort);
        });
      }

      transport
        .send({ jsonrpc: "2.0", id, method, params: paramsRecord(params) })
        .catch((caught: unknown) => {
          const entry = pending.get(id);
          if (entry === undefined) return;
          pending.delete(id);
          entry.reject(
            new HostClientError(
              "sendFailed",
              caught instanceof Error ? caught.message : String(caught),
              state.closed,
            ),
          );
        });
      return waiter.promise.then((result) => toResult(method, result));
    },

    onNotification<N extends ServerNotificationName>(
      name: N,
      handler: (params: ServerNotificationParams<N>) => void,
    ): Unsubscribe {
      const wrapper = (params: Record<string, unknown>): void => {
        const checked = toNotification(name, params);
        if (checked !== undefined) handler(checked);
      };
      const set =
        notificationHandlers.get(name) ?? new Set<(params: Record<string, unknown>) => void>();
      set.add(wrapper);
      notificationHandlers.set(name, set);
      return () => {
        set.delete(wrapper);
      };
    },

    notify<N extends ClientNotificationName>(
      name: N,
      params: ClientNotificationParams<N>,
    ): Promise<void> {
      if (state.closed !== undefined) {
        return Promise.reject(new HostClientError("closed", "connection is closed", state.closed));
      }
      return transport.send({ jsonrpc: "2.0", method: name, params: paramsRecord(params) });
    },

    async close(): Promise<void> {
      await transport.close();
      await closeWaiter.promise;
    },

    closed: closeWaiter.promise,
  };
}
