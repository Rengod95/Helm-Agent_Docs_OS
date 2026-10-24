import { Bug } from "@xeon/contracts";
import type {
  CloseInfo,
  InProcessTransportFactory,
  Transport,
  Unsubscribe,
} from "@xeon/contracts/wire";

// L0.process.spec §4.1 in-process, L0.process.plan PR-01.
// client.send(m)는 queueMicrotask로 상대 onMessage에 전달한다(같은 JS 턴 안 재진입 방지).
// 한쪽 close()는 양쪽 onClose를 한 번씩 부른다(local, remote).

/**
 * round-trip: 개발·테스트 빌드. JSON.parse(JSON.stringify(m))로 왕복해 직렬화할 수 없는 값이 in-process에서만 통과하는 일을 잡는다.
 * freeze: 운영 빌드. 같은 객체를 얕게 freeze해 넘긴다.
 */
export type InProcessMode = "round-trip" | "freeze";

export interface InProcessPairOptions {
  /** 기본 round-trip. 운영 빌드를 고르는 수단은 L4 조립 루트가 정한다 [미결] */
  readonly mode?: InProcessMode;
}

interface SideState {
  readonly messageHandlers: Set<(message: unknown) => void>;
  readonly closeHandlers: Set<(info: CloseInfo) => void>;
  /** 처리기가 하나도 없을 때 도착한 메시지. 첫 처리기가 붙으면 도착 순서대로 비운다 */
  backlog: unknown[];
  /** 마감되면 채워진다. 한 번만 */
  closeInfo: CloseInfo | undefined;
}

interface SharedState {
  closed: boolean;
  closing: Promise<void> | undefined;
}

function newSide(): SideState {
  return {
    messageHandlers: new Set(),
    closeHandlers: new Set(),
    backlog: [],
    closeInfo: undefined,
  };
}

/** 처리기를 모두 부르고, 던진 첫 오류는 모두 부른 뒤 다시 던진다 */
function callAll<T>(handlers: readonly ((value: T) => void)[], value: T): void {
  let failed = false;
  let failure: unknown = undefined;
  for (const handler of handlers) {
    try {
      handler(value);
    } catch (caught) {
      if (!failed) {
        failed = true;
        failure = caught;
      }
    }
  }
  if (failed) throw failure;
}

function drain(side: SideState): void {
  while (side.backlog.length > 0 && side.messageHandlers.size > 0) {
    const batch = side.backlog;
    side.backlog = [];
    for (const [index, message] of batch.entries()) {
      if (side.messageHandlers.size === 0) {
        side.backlog = [...batch.slice(index), ...side.backlog];
        return;
      }
      callAll([...side.messageHandlers], message);
    }
  }
}

function deliver(side: SideState, message: unknown): void {
  if (side.closeInfo !== undefined) return;
  side.backlog.push(message);
  drain(side);
}

function finalize(side: SideState, info: CloseInfo): void {
  if (side.closeInfo !== undefined) return;
  side.closeInfo = info;
  const handlers = [...side.closeHandlers];
  side.closeHandlers.clear();
  side.messageHandlers.clear();
  side.backlog = [];
  callAll(handlers, info);
}

type Prepared =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: Bug };

/** JSON.stringify는 함수·undefined 같은 값에는 문자열이 아니라 undefined를 돌려준다. 타입 선언에는 그 경우가 빠져 있다 */
function stringify(message: unknown): string | undefined {
  return JSON.stringify(message);
}

function prepare(message: unknown, mode: InProcessMode): Prepared {
  if (mode === "freeze") {
    if (typeof message === "object" && message !== null) Object.freeze(message);
    return { ok: true, value: message };
  }
  try {
    const text = stringify(message);
    if (text === undefined) {
      return { ok: false, error: new Bug("in-process message is not JSON-serializable") };
    }
    const parsed: unknown = JSON.parse(text);
    return { ok: true, value: parsed };
  } catch (caught) {
    return {
      ok: false,
      error: new Bug("in-process message is not JSON-serializable", { cause: caught }),
    };
  }
}

function infoFor(reason: CloseInfo["reason"], message: string | undefined): CloseInfo {
  return message === undefined ? { reason } : { reason, message };
}

function createSide(
  self: SideState,
  peer: SideState,
  shared: SharedState,
  mode: InProcessMode,
): Transport {
  return {
    kind: "in-process",
    send(message): Promise<void> {
      if (shared.closed) return Promise.reject(new Error("transport closed"));
      const prepared = prepare(message, mode);
      if (!prepared.ok) return Promise.reject(prepared.error);
      const value = prepared.value;
      queueMicrotask(() => {
        deliver(peer, value);
      });
      return Promise.resolve();
    },
    onMessage(handler): Unsubscribe {
      self.messageHandlers.add(handler);
      if (self.backlog.length > 0) {
        queueMicrotask(() => {
          drain(self);
        });
      }
      return () => {
        self.messageHandlers.delete(handler);
      };
    },
    onClose(handler): Unsubscribe {
      const info = self.closeInfo;
      if (info !== undefined) {
        queueMicrotask(() => {
          handler(info);
        });
        return () => undefined;
      }
      self.closeHandlers.add(handler);
      return () => {
        self.closeHandlers.delete(handler);
      };
    },
    close(reason): Promise<void> {
      if (shared.closing !== undefined) return shared.closing;
      shared.closed = true;
      shared.closing = new Promise<void>((resolve) => {
        queueMicrotask(() => {
          try {
            finalize(self, infoFor("local", reason));
          } finally {
            try {
              finalize(peer, infoFor("remote", reason));
            } finally {
              resolve();
            }
          }
        });
      });
      return shared.closing;
    },
  };
}

/** 모드를 고르는 팩토리. 쌍의 두 끝은 같은 모드를 쓴다 */
export function createInProcessPairWith(
  options: InProcessPairOptions,
): ReturnType<InProcessTransportFactory> {
  const mode = options.mode ?? "round-trip";
  const shared: SharedState = { closed: false, closing: undefined };
  const clientSide = newSide();
  const serverSide = newSide();
  return {
    client: createSide(clientSide, serverSide, shared, mode),
    server: createSide(serverSide, clientSide, shared, mode),
  };
}

/** F `InProcessTransportFactory` 구현. 개발 빌드 동작(JSON 왕복)이 기본이다 */
export const createInProcessPair: InProcessTransportFactory = () => createInProcessPairWith({});
