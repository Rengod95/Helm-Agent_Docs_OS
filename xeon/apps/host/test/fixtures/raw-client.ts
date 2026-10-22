import type { Transport } from "@xeon/contracts/wire";
import { asFrame } from "./unsafe.ts";

// 규칙을 어긴 프레임까지 보내고 받은 메시지를 도착 순서대로 모으는 시험용 클라이언트. HostConnection은 envelope를 검사해
// 잘못된 프레임을 만들 수 없으므로 적합성 시험과 오류 시험은 이 클라이언트를 쓴다.

interface ReceivedMessage {
  readonly index: number;
  readonly message: unknown;
}

export interface RawClient {
  /** 어떤 값이든 그대로 보낸다 */
  send(frame: unknown): Promise<void>;
  readonly received: readonly ReceivedMessage[];
  /** id가 같은 응답(성공 또는 오류)을 기다린다. null은 id를 읽을 수 없는 오류 응답이다 */
  response(id: string | null, timeoutMs?: number): Promise<ReceivedMessage>;
  /** 조건에 맞는 메시지가 이미 있거나 오면 돌려준다(도착을 기다리는 대기이고 실제 시간을 폴링하지 않는다) */
  waitFor(predicate: (message: unknown) => boolean, timeoutMs?: number): Promise<ReceivedMessage>;
  close(): Promise<void>;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResponseTo(message: unknown, id: string | null): boolean {
  if (!isRecord(message) || "method" in message) return false;
  return message["id"] === id;
}

export function rawClient(transport: Transport): RawClient {
  const received: ReceivedMessage[] = [];
  const waiters = new Set<{
    predicate: (message: unknown) => boolean;
    resolve: (message: ReceivedMessage) => void;
  }>();
  transport.onMessage((message) => {
    const entry: ReceivedMessage = { index: received.length, message };
    received.push(entry);
    for (const waiter of Array.from(waiters)) {
      if (waiter.predicate(message)) {
        waiters.delete(waiter);
        waiter.resolve(entry);
      }
    }
  });

  function waitFor(
    predicate: (message: unknown) => boolean,
    timeoutMs: number,
    what: string,
  ): Promise<ReceivedMessage> {
    const existing = received.find((entry) => predicate(entry.message));
    if (existing !== undefined) return Promise.resolve(existing);
    return new Promise<ReceivedMessage>((resolve, reject) => {
      const waiter = {
        predicate,
        resolve(entry: ReceivedMessage) {
          clearTimeout(timer);
          resolve(entry);
        },
      };
      const timer = setTimeout(() => {
        waiters.delete(waiter);
        reject(new Error(`no message for ${what} within ${timeoutMs}ms`));
      }, timeoutMs);
      waiters.add(waiter);
    });
  }

  return {
    received,
    send(frame) {
      return transport.send(asFrame(frame));
    },
    response(id, timeoutMs = 10_000) {
      return waitFor(
        (message) => isResponseTo(message, id),
        timeoutMs,
        `response id ${String(id)}`,
      );
    },
    waitFor(predicate, timeoutMs = 10_000) {
      return waitFor(predicate, timeoutMs, "the awaited condition");
    },
    close: () => transport.close(),
  };
}
