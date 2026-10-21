import { wireError, type WireHandler, type WireMethodName } from "@xeon/contracts/wire";

// L4.host-service.spec §3.3.3. 아직 구현하지 않은 메서드의 처리기. -32601을 돌려주고 host.hello의 features에서 빠진다.

const marked = new WeakSet<object>();

export function notImplemented<M extends WireMethodName>(method: M): WireHandler<M> {
  const handler: WireHandler<M> = () =>
    Promise.reject(wireError("jsonrpc.methodNotFound", { details: { method } }));
  marked.add(handler);
  return handler;
}

export function isNotImplemented(handler: object): boolean {
  return marked.has(handler);
}
