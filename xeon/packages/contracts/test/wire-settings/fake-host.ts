import { parse } from "../../src/index.ts";
import { DurableEventEnvelopeSchema, type DurableEventEnvelope } from "../../src/records/index.ts";
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
  type WireErrorKind,
  type WireError,
} from "../../src/wire-settings/wire/index.ts";
import type { ConformanceLink } from "./conformance-runner.ts";
import { must, rawId } from "../helpers/ids.ts";

// F.wire-settings.plan W14: 메모리 가짜 호스트. WIRE_CONFORMANCE_CASES의 M1 메서드 다섯 개와 오류 경로만 흉내 낸다.
// 실제 처리기는 L4.host-service가 만든다. 여기서는 케이스 데이터와 스키마, 오류 표가 서로 맞는지만 본다.

const STORE_ID = "sto_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const KNOWN_SETTING = "l1.loop.maxSteps";
const BATCH_SIZE = 2;

interface Subscription {
  readonly id: string;
  pos: number;
}

function fail(kind: WireErrorKind, details?: Record<string, unknown>): never {
  throw details === undefined ? wireError(kind) : wireError(kind, { details });
}

export function createFakeHost(): ConformanceLink {
  const handlers = new Set<(message: unknown) => void>();
  const events: DurableEventEnvelope[] = [];
  const threads = new Set<string>();
  const subs: Subscription[] = [];
  let helloDone = false;
  let counter = 0;
  let turns = 0;

  function emit(message: unknown): void {
    for (const handler of handlers) handler(message);
  }

  function respond(id: string | null, error: WireError): void {
    emit({ jsonrpc: "2.0", id, error: toJsonRpcError(error) });
  }

  function append(kind: string, threadId: string, payload: unknown): void {
    counter += 1;
    events.push(
      must(DurableEventEnvelopeSchema, {
        id: rawId("evt", counter),
        kind,
        version: 1,
        threadId,
        turnId: null,
        stepId: null,
        recordedAt: 1_790_000_000_000 + counter,
        causationId: null,
        correlationId: null,
        payload,
        durable: true,
        seq: events.length + 1,
        parentId: events.length === 0 ? null : (events[events.length - 1]?.id ?? null),
      }),
    );
    // 커밋 직후 실시간 구독에 알린다
    const seq = events.length;
    const last = events[seq - 1];
    for (const sub of subs) {
      if (last === undefined || sub.pos >= seq) continue;
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

  function handle(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "host.hello": {
        if (helloDone) fail("host.helloDuplicate");
        const clientVersion = String(params["protocolVersion"]);
        if (!isCompatible(clientVersion, WIRE_PROTOCOL_VERSION)) {
          fail("protocol.unsupported", { serverVersion: WIRE_PROTOCOL_VERSION, clientVersion });
        }
        helloDone = true;
        return {
          protocolVersion: WIRE_PROTOCOL_VERSION,
          server: { name: "fake-host", version: "0.0.0" },
          storeId: STORE_ID,
          transport: "in-process",
          features: [],
          experimental: [],
        };
      }
      case "thread.create": {
        const threadId = rawId("thr", threads.size + 1);
        threads.add(threadId);
        append("thread.started", threadId, {});
        return { threadId, position: { storeId: STORE_ID, seq: events.length } };
      }
      case "turn.start": {
        const threadId = String(params["threadId"]);
        if (!threads.has(threadId)) fail("thread.notFound", { threadId });
        turns += 1;
        return { turnId: rawId("trn", turns) };
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
      case "events.subscribe": {
        const from = params["from"];
        const head = events.length;
        let start = head;
        if (from !== "head") {
          const position = parse(StreamPositionSchema, from);
          if (!position.ok) return fail("jsonrpc.invalidParams", { issues: [] });
          const base = { storeId: STORE_ID, headSeq: head, oldestReplayableSeq: 0 };
          if (position.value.storeId !== STORE_ID) {
            fail("replay.outOfRange", { ...base, reason: "storeMismatch" });
          }
          if (position.value.seq > head) {
            fail("replay.outOfRange", { ...base, reason: "aheadOfHead" });
          }
          start = position.value.seq;
        }
        const sub: Subscription = { id: `s${subs.length + 1}`, pos: start };
        const replaying = start < head;
        subs.push(sub);
        // 응답을 먼저 보내고(규칙 4) 이어서 재전송한다
        queueMicrotask(() => {
          if (!replaying) return;
          while (sub.pos < head) {
            const rows = events
              .filter((e) => e.seq > sub.pos && e.seq <= head)
              .slice(0, BATCH_SIZE);
            const last = rows[rows.length - 1];
            const to = last === undefined ? head : last.seq;
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
      default:
        return fail("jsonrpc.methodNotFound", { method });
    }
  }

  async function receive(frame: unknown): Promise<void> {
    const checked = checkEnvelope(frame);
    if (!checked.ok) {
      const candidateId =
        typeof frame === "object" && frame !== null && !Array.isArray(frame)
          ? Reflect.get(frame, "id")
          : undefined;
      const id =
        parse(RpcIdSchema, candidateId).ok && typeof candidateId === "string" ? candidateId : null;
      const kind: WireErrorKind =
        checked.errorCode === -32602 ? "jsonrpc.invalidParams" : "jsonrpc.invalidRequest";
      respond(
        id,
        wireError(kind, {
          details: checked.errorCode === -32602 ? { issues: [] } : { issue: checked.issue },
        }),
      );
      return;
    }
    const message = checked.message;
    if ("method" in message && !("id" in message)) return; // 알림($/cancelRequest 포함)은 응답이 없다
    if (!("method" in message) || !("id" in message)) return; // 클라이언트가 보낸 응답은 쓰지 않는다
    const { id, method, params } = message;
    try {
      if (!helloDone && method !== "host.hello") fail("host.helloRequired");
      const spec = Object.entries(WIRE_METHODS).find(([name]) => name === method)?.[1];
      if (spec === undefined || spec.stage !== "M1") fail("jsonrpc.methodNotFound", { method });
      const valid = parse(spec.params, params);
      if (!valid.ok) {
        fail("jsonrpc.invalidParams", {
          issues: valid.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
        });
      }
      const result = handle(method, params);
      emit({ jsonrpc: "2.0", id, result });
    } catch (cause) {
      emit({ jsonrpc: "2.0", id, error: toRpcError(cause) });
    }
  }

  return {
    send: (frame) => receive(frame),
    onMessage: (handler) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
