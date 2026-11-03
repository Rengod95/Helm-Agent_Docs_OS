import { expect, test } from "bun:test";
import type { TurnId } from "@fresnel/contracts/conversation";
import type { TraceReadPort } from "@fresnel/contracts/extensions";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// Y4 host 부분(spec-deltas/t-wb.md §5). trace.turn: 계측 꺼짐, 버퍼 밖, 정상. 계측 읽기는 가짜 포트다(실제 ext-host 연결은 T-XD).

const KEPT = {
  traceEnabled: true,
  retained: true,
  entries: [
    {
      seq: 7,
      hook: "input.before",
      step: 0,
      handlers: [
        {
          registrationId: "helm",
          ms: 1.5,
          result: "passed",
          atMs: 4,
          size: 0,
          skippedBy: null,
          reason: null,
        },
      ],
    },
  ],
} as const;

function portOf(enabled: boolean, kept: Map<TurnId, typeof KEPT>): TraceReadPort {
  return {
    enabled: () => enabled,
    turn: (_threadId, turnId) => kept.get(turnId),
    timings: () => ({ traceEnabled: enabled, timings: [] }),
  };
}

async function open(enabled: boolean, keep: boolean) {
  const kept = new Map<TurnId, typeof KEPT>();
  const host = createFakeHost({ profiles: { traceRead: portOf(enabled, kept) } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const threadId = host.fake.seedThread();
  const turnId = host.fake.ids.next("trn");
  if (keep) kept.set(turnId, KEPT);
  return { connection, host, threadId, turnId };
}

test("trace.turn with tracing off is traceEnabled false and retained false, even for a turn that was kept", async () => {
  const { connection, threadId, turnId } = await open(false, true);
  expect(await connection.request("trace.turn", { threadId, turnId })).toEqual({
    traceEnabled: false,
    retained: false,
    entries: [],
  });
  await connection.close();
});

test("trace.turn for a turn outside the buffer is retained false with tracing on", async () => {
  const { connection, threadId, turnId } = await open(true, false);
  expect(await connection.request("trace.turn", { threadId, turnId })).toEqual({
    traceEnabled: true,
    retained: false,
    entries: [],
  });
  expect(await connection.request("trace.turn", { threadId, turnId: "not-a-turn" })).toEqual({
    traceEnabled: true,
    retained: false,
    entries: [],
  });
  await connection.close();
});

test("trace.turn returns the entries the buffer kept, and an unknown thread is thread.notFound", async () => {
  const { connection, host, threadId, turnId } = await open(true, true);
  expect(await connection.request("trace.turn", { threadId, turnId })).toEqual(KEPT);
  const ghost = host.fake.ids.next("thr");
  const failure = await connection.request("trace.turn", { threadId: ghost, turnId }).then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(failure).toMatchObject({
    data: { kind: "thread.notFound", details: { threadId: ghost } },
  });
  await connection.close();
});
