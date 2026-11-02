import {
  wireError,
  type WireError,
  type WireHandler,
  type WireMethodName,
} from "@fresnel/contracts/wire";

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

/**
 * 계약이 넓어졌지만 처리기가 아직 새 인자를 다루지 않을 때(M4 T-F 병합 B) 그 인자를 -32602로 거부한다.
 * 조용히 무시하면 클라이언트가 지원하는 줄 알고 틀린 결과를 받는다. 소유 트랙이 인자를 구현하면 이 호출을 지운다
 */
export function paramNotYetImplemented(path: string, owner: string): WireError {
  return wireError("jsonrpc.invalidParams", {
    details: { issues: [{ path, message: `${path} is not implemented yet (${owner})` }] },
  });
}
