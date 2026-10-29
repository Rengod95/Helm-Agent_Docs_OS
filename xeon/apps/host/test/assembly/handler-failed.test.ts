import { expect, test } from "bun:test";
import { err, ok, type Clock } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ScopeHandlerFailedPayload, VolatileEventEnvelope } from "@xeon/contracts/records";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createHandlerFailedEmitter } from "../../src/assembly/handler-failed.ts";

// M3-REQ-35(HS-80): 확장 핸들러 실패는 열린 thread마다 `scope.handler_failed` 휘발 이벤트 하나가 된다.
// 열린 thread가 없으면 보내지 않고 운영 로그만 남긴다. 발신이 던져도 호출자에게 던지지 않는다.

const threads = fixedIdFactory(700);
const A: ThreadId = threads.next("thr");
const B: ThreadId = threads.next("thr");

const PAYLOAD: ScopeHandlerFailedPayload = {
  owner: "ext:acme-notes",
  point: "session.start",
  result: "threw",
  message: "boom",
  consecutive: 1,
};

function harness(options: {
  readonly open?: readonly ThreadId[];
  readonly afterSeq?: number;
  readonly emitFor?: (threadId: ThreadId) => boolean;
}): {
  readonly emit: (payload: ScopeHandlerFailedPayload) => void;
  readonly sent: VolatileEventEnvelope[];
  readonly lines: string[];
} {
  const sent: VolatileEventEnvelope[] = [];
  const lines: string[] = [];
  const clock: Clock = { now: () => 4242 };
  const emit = createHandlerFailedEmitter({
    emitVolatile: (event) => {
      if (options.emitFor !== undefined && !options.emitFor(event.threadId)) {
        throw new Error("the sink refused");
      }
      sent.push(event);
    },
    headSeq: () => ok(options.afterSeq ?? 17),
    openThreads: () => options.open ?? [],
    ids: fixedIdFactory(100),
    clock,
    log: (line) => {
      lines.push(line);
    },
  });
  return { emit, sent, lines };
}

test("one open thread gets one envelope with the exact values of a volatile scope.handler_failed", () => {
  const { emit, sent, lines } = harness({ open: [A] });
  emit(PAYLOAD);
  const firstId = fixedIdFactory(100).next("evt");
  expect(sent).toEqual([
    {
      id: firstId,
      kind: "scope.handler_failed",
      version: 1,
      threadId: A,
      turnId: null,
      stepId: null,
      recordedAt: 4242,
      causationId: null,
      correlationId: null,
      payload: PAYLOAD,
      durable: false,
      n: 0,
      afterSeq: 17,
    },
  ]);
  expect(lines).toEqual([]);
});

test("two open threads get two envelopes, one per thread, with the same payload", () => {
  const { emit, sent } = harness({ open: [A, B] });
  emit(PAYLOAD);
  expect(sent.map((event) => event.threadId)).toEqual([A, B]);
  expect(sent.map((event) => event.payload)).toEqual([PAYLOAD, PAYLOAD]);
  expect(sent.map((event) => event.n)).toEqual([0, 0]);
  expect(new Set(sent.map((event) => event.id)).size).toBe(2);
});

test("a thread open on two connections is sent once", () => {
  const { emit, sent } = harness({ open: [A, A] });
  emit(PAYLOAD);
  expect(sent.map((event) => event.threadId)).toEqual([A]);
});

test("with no open thread nothing is sent and one log line says why", () => {
  const { emit, sent, lines } = harness({ open: [] });
  emit(PAYLOAD);
  expect(sent).toEqual([]);
  expect(lines).toEqual([
    "scope.handler_failed not emitted: no open thread (ext:acme-notes session.start)",
  ]);
});

test("n counts each thread on its own and goes up by one per failure", () => {
  const scenario = harness({ open: [A] });
  scenario.emit(PAYLOAD);
  scenario.emit(PAYLOAD);
  const second = harness({ open: [A] });
  second.emit(PAYLOAD);
  expect(scenario.sent.map((event) => event.n)).toEqual([0, 1]);
  expect(second.sent.map((event) => event.n)).toEqual([0]);

  const both = createScenario([A, B]);
  both.emit(PAYLOAD);
  both.emit(PAYLOAD);
  both.emit(PAYLOAD);
  expect(both.sent.map((event) => [event.threadId === A ? "A" : "B", event.n] as const)).toEqual([
    ["A", 0],
    ["B", 0],
    ["A", 1],
    ["B", 1],
    ["A", 2],
    ["B", 2],
  ]);
});

test("an emit that throws does not reach the caller, is logged, and the other threads still get theirs", () => {
  const scenario = harness({ open: [A, B], emitFor: (threadId) => threadId !== A });
  expect(() => {
    scenario.emit(PAYLOAD);
  }).not.toThrow();
  expect(scenario.sent.map((event) => event.threadId)).toEqual([B]);
  expect(scenario.lines).toEqual([
    `scope.handler_failed not emitted: thread ${A} (the sink refused)`,
  ]);
});

test("when the head cannot be read nothing is sent and the reason is logged", () => {
  const lines: string[] = [];
  const sent: VolatileEventEnvelope[] = [];
  const emit = createHandlerFailedEmitter({
    emitVolatile: (event) => {
      sent.push(event);
    },
    headSeq: () => err({ kind: "busy" }),
    openThreads: () => [A],
    ids: fixedIdFactory(100),
    clock: { now: () => 1 },
    log: (line) => {
      lines.push(line);
    },
  });
  emit(PAYLOAD);
  expect(sent).toEqual([]);
  expect(lines).toEqual(["scope.handler_failed not emitted: head read failed (busy)"]);
});

function createScenario(open: readonly ThreadId[]): {
  readonly emit: (payload: ScopeHandlerFailedPayload) => void;
  readonly sent: VolatileEventEnvelope[];
} {
  const sent: VolatileEventEnvelope[] = [];
  const emit = createHandlerFailedEmitter({
    emitVolatile: (event) => {
      sent.push(event);
    },
    headSeq: () => ok(0),
    openThreads: () => open,
    ids: fixedIdFactory(300),
    clock: { now: () => 0 },
    log: () => undefined,
  });
  return { emit, sent };
}
