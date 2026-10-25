import type {
  HostConnection,
  ServerNotificationName,
  ServerNotificationParams,
  WireMethodName,
  WireParams,
  WireResult,
} from "@xeon/contracts/wire";

type Handler<M extends WireMethodName> = (params: WireParams<M>) => Promise<WireResult<M>>;
export type Table = { [M in WireMethodName]?: Handler<M> };
type Handlers = {
  [N in ServerNotificationName]: Set<(params: ServerNotificationParams<N>) => void>;
};

export function fakeConnection(table: Table): {
  readonly connection: HostConnection;
  emit<N extends ServerNotificationName>(name: N, params: ServerNotificationParams<N>): void;
  readonly calls: { readonly method: string; readonly params: unknown }[];
} {
  const handlers: Handlers = {
    "events.batch": new Set(),
    "events.ended": new Set(),
    "stream.chunk": new Set(),
    "settings.invalidated": new Set(),
  };
  const calls: { method: string; params: unknown }[] = [];
  const connection: HostConnection = {
    request: (method, params) => {
      calls.push({ method, params });
      const handler = table[method];
      if (handler === undefined) return Promise.reject(new Error(`unhandled ${method}`));
      return handler(params);
    },
    onNotification: (name, handler) => {
      handlers[name].add(handler);
      return () => void handlers[name].delete(handler);
    },
    notify: () => Promise.resolve(),
    close: () => Promise.resolve(),
    closed: new Promise(() => {}),
  };
  return {
    connection,
    emit: (name, params) => {
      for (const h of handlers[name]) h(params);
    },
    calls,
  };
}
