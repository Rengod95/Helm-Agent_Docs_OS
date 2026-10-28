import { Bug, detach, parse } from "@xeon/contracts";
import { DurableEventEnvelopeSchema, type DurableEventEnvelope } from "@xeon/contracts/records";
import {
  RpcIdSchema,
  StreamPositionSchema,
  WIRE_METHODS,
  WIRE_PROTOCOL_VERSION,
  checkEnvelope,
  isCompatible,
  toEventWire,
  toJsonRpcError,
  toRpcError,
  wireError,
  type EventsBatchParams,
  type HostShutdownParams,
  type HostShutdownResult,
  type JsonRpcMessage,
  type Transport,
  type WireErrorKind,
} from "@xeon/contracts/wire";

// 전송 적합성 케이스(F.wire-settings.plan W14, WIRE_CONFORMANCE_CASES)가 돌 수 있는 최소 서버. 메모리 이벤트 목록 위에서
// host.hello, thread.create, turn.start, settings.get, events.subscribe만 흉내 내고 host.shutdown은 주입한 처리기에 넘긴다.
// 실제 처리기는 L4 host가 만든다(DR-02: L0는 apps/host를 import하지 않는다). 전송이 케이스를 같은 결과로 옮기는지만 본다.

const STORE_ID = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const KNOWN_SETTING = "l1.loop.maxSteps";
const BATCH_SIZE = 2;
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export interface ConformanceHostOptions {
  /** `host.shutdown` 처리기. 없으면 M2 메서드라 methodNotFound다 */
  readonly onShutdown?: (params: HostShutdownParams) => Promise<HostShutdownResult>;
}

export interface ConformanceHostHandle {
  readonly failures: readonly unknown[];
}

interface Subscription {
  readonly id: string;
  pos: number;
}

function ulid(n: number): string {
  const hi = ALPHABET[Math.floor(n / 1024) % 32] ?? "0";
  const mid = ALPHABET[Math.floor(n / 32) % 32] ?? "0";
  const lo = ALPHABET[n % 32] ?? "0";
  return `01ARZ3NDEKTSV4RRFFQ${hi}${mid}${lo}ABCD`.slice(0, 26);
}

function fail(kind: WireErrorKind, details?: Record<string, unknown>): never {
  throw details === undefined ? wireError(kind) : wireError(kind, { details });
}

function paramsOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function startOf(from: unknown, head: number): number {
  if (from === "head") return head;
  const position = parse(StreamPositionSchema, from);
  if (!position.ok) return fail("jsonrpc.invalidParams", { issues: [] });
  const base = { storeId: STORE_ID, headSeq: head, oldestReplayableSeq: 0 };
  if (position.value.storeId !== STORE_ID) {
    fail("replay.outOfRange", { ...base, reason: "storeMismatch" });
  }
  if (position.value.seq > head) fail("replay.outOfRange", { ...base, reason: "aheadOfHead" });
  return position.value.seq;
}

/** 서버 쪽 전송 하나에 서버를 붙인다. 연결마다 상태가 따로다 */
export function serveConformanceHost(
  transport: Transport,
  options: ConformanceHostOptions = {},
): ConformanceHostHandle {
  /** 보내지 못한 응답의 원인. 상대가 먼저 닫았을 때 쌓인다 */
  const failures: unknown[] = [];
  const events: DurableEventEnvelope[] = [];
  const threads = new Set<string>();
  const subs: Subscription[] = [];
  const state = { helloDone: false, counter: 0, turns: 0 };

  function emit(message: JsonRpcMessage): void {
    detach(transport.send(message), (cause) => {
      failures.push(cause);
    });
  }

  function respondError(id: string | null, cause: unknown): void {
    emit({ jsonrpc: "2.0", id, error: toRpcError(cause) });
  }

  function append(kind: string, threadId: string): void {
    state.counter += 1;
    const seq = events.length + 1;
    const parsed = parse(DurableEventEnvelopeSchema, {
      id: `evt_${ulid(state.counter)}`,
      kind,
      version: 1,
      threadId,
      turnId: null,
      stepId: null,
      recordedAt: 1_790_000_000_000 + state.counter,
      causationId: null,
      correlationId: null,
      payload: {},
      durable: true,
      seq,
      parentId: events[events.length - 1]?.id ?? null,
    });
    if (!parsed.ok) throw new Bug("conformance host built an invalid event");
    events.push(parsed.value);
    const last = parsed.value;
    for (const sub of subs) {
      if (sub.pos >= seq) continue;
      const params: EventsBatchParams = {
        sub: sub.id,
        from: sub.pos,
        to: seq,
        events: [toEventWire(last)],
        caughtUp: true,
      };
      sub.pos = seq;
      emit({ jsonrpc: "2.0", method: "events.batch", params });
    }
  }

  function subscribe(from: unknown): Record<string, unknown> {
    const head = events.length;
    const start = startOf(from, head);
    const sub: Subscription = { id: `s${String(subs.length + 1)}`, pos: start };
    const replaying = start < head;
    subs.push(sub);
    // 응답을 먼저 보내고 이어서 재전송한다(F.wire-settings.spec 규칙 4)
    queueMicrotask(() => {
      while (sub.pos < head) {
        const rows = events.filter((e) => e.seq > sub.pos && e.seq <= head).slice(0, BATCH_SIZE);
        const to = rows[rows.length - 1]?.seq ?? head;
        const batch: EventsBatchParams = {
          sub: sub.id,
          from: sub.pos,
          to,
          events: rows.map((row) => toEventWire(row)),
          caughtUp: to >= head,
        };
        sub.pos = to;
        emit({ jsonrpc: "2.0", method: "events.batch", params: batch });
      }
    });
    return {
      sub: sub.id,
      start,
      headSeq: head,
      storeId: STORE_ID,
      mode: replaying ? "replaying" : "live",
    };
  }

  function handle(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "host.hello": {
        if (state.helloDone) fail("host.helloDuplicate");
        const clientVersion = String(params["protocolVersion"]);
        if (!isCompatible(clientVersion, WIRE_PROTOCOL_VERSION)) {
          fail("protocol.unsupported", { serverVersion: WIRE_PROTOCOL_VERSION, clientVersion });
        }
        state.helloDone = true;
        return {
          protocolVersion: WIRE_PROTOCOL_VERSION,
          server: { name: "conformance-host", version: "0.0.0" },
          storeId: STORE_ID,
          transport: transport.kind,
          features: [],
          experimental: [],
        };
      }
      case "thread.create": {
        const threadId = `thr_${ulid(threads.size + 1)}`;
        threads.add(threadId);
        append("thread.started", threadId);
        return { threadId, position: { storeId: STORE_ID, seq: events.length } };
      }
      case "turn.start": {
        const threadId = String(params["threadId"]);
        if (!threads.has(threadId)) fail("thread.notFound", { threadId });
        state.turns += 1;
        return { turnId: `trn_${ulid(state.turns)}` };
      }
      case "settings.get": {
        const keys = params["keys"];
        if (Array.isArray(keys)) {
          for (const key of keys) {
            if (key !== KNOWN_SETTING) fail("settings.unknownKey", { key: String(key) });
          }
        }
        return {
          settings: [
            {
              key: KNOWN_SETTING,
              value: 8,
              source: { scope: "default" },
              locked: false,
              shadowed: [],
              runtimeChange: "live",
              pendingUntil: null,
              deprecated: false,
            },
          ],
        };
      }
      case "events.subscribe":
        return subscribe(params["from"]);
      case "host.shutdown": {
        const handler = options.onShutdown;
        if (handler === undefined) return fail("jsonrpc.methodNotFound", { method });
        const valid = parse(WIRE_METHODS["host.shutdown"].params, params);
        if (!valid.ok) return fail("jsonrpc.invalidParams", { issues: [] });
        return handler(valid.value);
      }
      // xeon-disable-next-line xeon/switch-default-never -- 메서드 이름은 문자열이다. 모르는 메서드는 와이어 오류로 돌려준다 (eng.typescript.guide TY-14)
      default:
        return fail("jsonrpc.methodNotFound", { method });
    }
  }

  function supported(method: string): boolean {
    if (method === "host.shutdown") return options.onShutdown !== undefined;
    const spec = Object.entries(WIRE_METHODS).find(([name]) => name === method)?.[1];
    return spec !== undefined && spec.stage === "M1";
  }

  async function receive(frame: unknown): Promise<void> {
    const checked = checkEnvelope(frame);
    if (!checked.ok) {
      const candidate: unknown =
        typeof frame === "object" && frame !== null && !Array.isArray(frame)
          ? Reflect.get(frame, "id")
          : undefined;
      const id =
        typeof candidate === "string" && parse(RpcIdSchema, candidate).ok ? candidate : null;
      const kind: WireErrorKind =
        checked.errorCode === -32602 ? "jsonrpc.invalidParams" : "jsonrpc.invalidRequest";
      const error = wireError(kind, {
        details: checked.errorCode === -32602 ? { issues: [] } : { issue: checked.issue },
      });
      emit({ jsonrpc: "2.0", id, error: toJsonRpcError(error) });
      return;
    }
    const message = checked.message;
    if ("method" in message && !("id" in message) && message.method === "$/connectionReset") {
      // 클라이언트 화면이 다시 시작됨: 구독을 지우고 hello 이전 상태로 돌아간다(F.wire-settings.spec §4.1 7번)
      subs.length = 0;
      state.helloDone = false;
      return;
    }
    if (!("method" in message) || !("id" in message)) return; // 알림과 응답에는 답하지 않는다
    const { id, method, params } = message;
    try {
      if (!state.helloDone && method !== "host.hello") fail("host.helloRequired");
      if (!supported(method)) fail("jsonrpc.methodNotFound", { method });
      const spec = Object.entries(WIRE_METHODS).find(([name]) => name === method)?.[1];
      if (spec !== undefined) {
        const valid = parse(spec.params, params);
        if (!valid.ok) {
          fail("jsonrpc.invalidParams", {
            issues: valid.error.issues.map((issue) => ({
              path: issue.path,
              message: issue.message,
            })),
          });
        }
      }
      const result = paramsOf(await handle(method, paramsOf(params)));
      emit({ jsonrpc: "2.0", id, result });
    } catch (cause) {
      respondError(id, cause);
    }
  }

  transport.onMessage((frame) => {
    // receive는 던지지 않게 만들었다. 던졌다면 서버 코드 버그이므로 실패 목록에 남겨 드러낸다.
    detach(receive(frame), (cause) => {
      failures.push(cause);
    });
  });
  return { failures };
}
