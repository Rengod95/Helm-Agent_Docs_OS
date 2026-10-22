import { detach, rethrow } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import {
  checkEnvelope,
  isCompatible,
  toRpcError,
  wireError,
  WIRE_PROTOCOL_VERSION,
  type EventsBatchParams,
  type EventWire,
  type JsonRpcMessage,
  type StoreId,
  type Transport,
  type VolatileEventWire,
  type WireError,
  type WireMethodName,
} from "@xeon/contracts/wire";
import { materialize, type EventDraft } from "./events.ts";
import { threadId, turnId } from "./ids.ts";

// 시험용 가짜 호스트 서버. M1 처리기 다섯(host.hello, thread.create, turn.start, events.subscribe, settings.get)을 서버 쪽
// Transport 위에서 흉내 낸다. 실제 엔진이 아니라 호스트 계약(F.wire-settings.spec)만 따른다.

export interface TurnContext {
  readonly threadId: ThreadId;
  readonly turnId: TurnId;
  readonly input: unknown;
  readonly server: FakeServer;
}

export interface FakeServerOptions {
  readonly storeId: StoreId;
  /** turn.start가 접수되면 부른다. 이벤트를 server.commit으로 낸다 */
  readonly onTurn?: (context: TurnContext) => void | Promise<void>;
  /** 참이면 turn.start 응답을 먼저 보내고 onTurn을 그 뒤에 부른다 */
  readonly respondBeforeTurn?: boolean;
  /** settings.get이 아는 키와 값 */
  readonly settings?: Readonly<Record<string, unknown>>;
  /** 메서드별로 던질 오류 */
  readonly failures?: Readonly<Partial<Record<WireMethodName, WireError>>>;
  /** 이미 있는 thread(재개 시험용) */
  readonly knownThreads?: readonly ThreadId[];
}

export interface FakeServer {
  readonly requests: readonly { readonly method: string; readonly params: unknown }[];
  readonly log: readonly EventWire[];
  readonly threads: ReadonlySet<ThreadId>;
  headSeq(): number;
  /** 초안에 seq와 id를 붙여 로그에 더하고, 열려 있는 구독에 알림을 보낸다. notify가 false면 알리지 않는다 */
  commit(
    thread: ThreadId,
    drafts: readonly EventDraft[],
    options?: { readonly notify?: boolean },
  ): readonly EventWire[];
  /** 마지막으로 연 구독에 임의의 events.batch를 보낸다(구멍·중복 시험) */
  sendBatch(range: {
    readonly from: number;
    readonly to: number;
    readonly events: readonly EventWire[];
  }): void;
  chunk(event: VolatileEventWire): void;
  /** 서버 쪽에서 연결을 닫는다 */
  closeFromServer(): Promise<void>;
}

interface Sub {
  readonly id: string;
  readonly threadIds: readonly ThreadId[] | undefined;
  pos: number;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

/** 저장소 쪽 상태. 같은 저장소 위에 연결을 여러 번 열 수 있다(재개 시험) */
export interface FakeStore {
  readonly log: EventWire[];
  readonly threads: Set<ThreadId>;
  readonly requestIds: Map<string, TurnId>;
  readonly counters: { thread: number; turn: number; event: number; sub: number };
}

export function createFakeStore(threads: readonly ThreadId[] = []): FakeStore {
  return {
    log: [],
    threads: new Set(threads),
    requestIds: new Map(),
    counters: { thread: 100, turn: 100, event: 1000, sub: 0 },
  };
}

export function startFakeServer(
  transport: Transport,
  options: FakeServerOptions,
  store: FakeStore = createFakeStore(options.knownThreads),
): FakeServer {
  const { log, threads, requestIds, counters } = store;
  const requests: { method: string; params: unknown }[] = [];
  const subs = new Map<string, Sub>();

  const send = (message: JsonRpcMessage): void => {
    // 가짜 서버의 전송 실패는 시험 결함이다: 그대로 다시 던져 시험이 실패하게 한다
    detach(transport.send(message), rethrow);
  };

  const batchFor = (sub: Sub, to: number): EventsBatchParams => {
    const events = log.filter(
      (event) =>
        event.seq > sub.pos &&
        event.seq <= to &&
        (sub.threadIds === undefined || sub.threadIds.includes(event.threadId)),
    );
    return { sub: sub.id, from: sub.pos, to, events, caughtUp: true };
  };

  const pushLive = (): void => {
    const head = log.length;
    for (const sub of subs.values()) {
      if (sub.pos >= head) continue;
      const params = batchFor(sub, head);
      sub.pos = head;
      send({ jsonrpc: "2.0", method: "events.batch", params: { ...params } });
    }
  };

  const server: FakeServer = {
    requests,
    log,
    threads,
    headSeq: () => log.length,
    commit(thread, drafts, commitOptions) {
      const made: EventWire[] = drafts.map((draft) => {
        counters.event += 1;
        const event = materialize(draft, { seq: log.length + 1, id: counters.event, thread });
        log.push(event);
        return event;
      });
      if (commitOptions?.notify !== false) pushLive();
      return made;
    },
    sendBatch(range) {
      const last = Array.from(subs.values()).at(-1);
      if (last === undefined) return;
      send({
        jsonrpc: "2.0",
        method: "events.batch",
        params: { sub: last.id, ...range, events: [...range.events], caughtUp: true },
      });
    },
    chunk(event) {
      send({ jsonrpc: "2.0", method: "stream.chunk", params: { event } });
    },
    closeFromServer: () => transport.close("server"),
  };

  const handle = (method: string, params: Readonly<Record<string, unknown>>): unknown => {
    const failure = Object.entries(options.failures ?? {}).find(([name]) => name === method);
    if (failure?.[1] !== undefined) throw failure[1];
    switch (method) {
      case "host.hello": {
        const client = asRecord(params["client"]);
        const version = params["protocolVersion"];
        if (typeof version !== "string" || !isCompatible(version, WIRE_PROTOCOL_VERSION)) {
          throw wireError("protocol.unsupported", {
            details: { serverVersion: WIRE_PROTOCOL_VERSION, clientVersion: String(version) },
          });
        }
        return {
          protocolVersion: WIRE_PROTOCOL_VERSION,
          server: { name: "xeon", version: "0.0.0" },
          storeId: options.storeId,
          transport: transport.kind,
          features: [],
          experimental: client["name"] === undefined ? [] : [],
        };
      }
      case "settings.get": {
        const known = options.settings ?? {};
        const keys = Array.isArray(params["keys"])
          ? params["keys"].filter((key): key is string => typeof key === "string")
          : Object.keys(known);
        return {
          settings: keys.map((key) => {
            if (!Object.hasOwn(known, key)) {
              throw wireError("settings.unknownKey", { details: { key } });
            }
            return {
              key,
              value: known[key],
              source: { scope: "default" },
              locked: false,
              shadowed: [],
              runtimeChange: "live",
              pendingUntil: null,
              deprecated: false,
            };
          }),
        };
      }
      case "thread.create": {
        counters.thread += 1;
        const created = threadId(counters.thread);
        threads.add(created);
        server.commit(created, [
          { kind: "thread.started", turnId: null, payload: { title: null, forkedFrom: null } },
        ]);
        return { threadId: created, position: { storeId: options.storeId, seq: log.length } };
      }
      case "events.subscribe": {
        const from = params["from"];
        const filter = asRecord(params["filter"]);
        const head = log.length;
        let start = head;
        if (from !== "head") {
          const position = asRecord(from);
          const seq = position["seq"];
          if (position["storeId"] !== options.storeId) {
            throw wireError("replay.outOfRange", {
              details: {
                reason: "storeMismatch",
                storeId: options.storeId,
                headSeq: head,
                oldestReplayableSeq: 0,
              },
            });
          }
          if (typeof seq !== "number" || seq > head) {
            throw wireError("replay.outOfRange", {
              details: {
                reason: "aheadOfHead",
                storeId: options.storeId,
                headSeq: head,
                oldestReplayableSeq: 0,
              },
            });
          }
          start = seq;
        }
        counters.sub += 1;
        const rawIds = filter["threadIds"];
        const sub: Sub = {
          id: `s${counters.sub}`,
          threadIds: Array.isArray(rawIds) ? threadIdsOf(rawIds) : undefined,
          pos: start,
        };
        subs.set(sub.id, sub);
        // 응답 뒤에 재전송한다(실제 호스트와 같은 순서)
        queueMicrotask(() => {
          if (sub.pos < head) {
            const batch = batchFor(sub, head);
            sub.pos = head;
            send({ jsonrpc: "2.0", method: "events.batch", params: { ...batch } });
          }
          pushLive();
        });
        return {
          sub: sub.id,
          start,
          headSeq: head,
          storeId: options.storeId,
          mode: start < head ? "replaying" : "live",
        };
      }
      case "turn.start": {
        const thread = params["threadId"];
        if (typeof thread !== "string" || !threadIdIsKnown(thread)) {
          throw wireError("thread.notFound", { details: { threadId: String(thread) } });
        }
        const requestId = params["requestId"];
        if (typeof requestId === "string") {
          const seen = requestIds.get(requestId);
          if (seen !== undefined) return { turnId: seen };
        }
        counters.turn += 1;
        const turn = turnId(counters.turn);
        if (typeof requestId === "string") requestIds.set(requestId, turn);
        const context: TurnContext = {
          threadId: threadIdOf(thread),
          turnId: turn,
          input: params["input"],
          server,
        };
        if (options.respondBeforeTurn === true) {
          queueMicrotask(() => {
            detach(Promise.resolve(options.onTurn?.(context)), rethrow);
          });
        } else {
          const result = options.onTurn?.(context);
          if (result instanceof Promise) {
            detach(result, rethrow);
          }
        }
        return { turnId: turn };
      }
      default:
        throw wireError("jsonrpc.methodNotFound", { details: { method } });
    }
  };

  const threadIdIsKnown = (value: string): boolean =>
    Array.from(threads).some((candidate) => candidate === value);
  const threadIdOf = (value: string): ThreadId => {
    const found = Array.from(threads).find((candidate) => candidate === value);
    if (found === undefined) throw wireError("thread.notFound", { details: { threadId: value } });
    return found;
  };
  const threadIdsOf = (values: readonly unknown[]): ThreadId[] =>
    values.flatMap((value) => {
      const found = Array.from(threads).find((candidate) => candidate === value);
      return found === undefined ? [] : [found];
    });

  transport.onMessage((raw) => {
    const checked = checkEnvelope(raw);
    if (!checked.ok) return;
    const message = checked.message;
    if (!("method" in message) || !("id" in message)) return;
    requests.push({ method: message.method, params: message.params });
    try {
      const result = handle(message.method, message.params);
      send({ jsonrpc: "2.0", id: message.id, result: asRecord(result) });
    } catch (caught) {
      send({ jsonrpc: "2.0", id: message.id, error: toRpcError(caught) });
    }
  });
  return server;
}
