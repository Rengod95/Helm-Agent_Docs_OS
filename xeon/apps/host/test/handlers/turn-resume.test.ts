import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { TurnId } from "@xeon/contracts/conversation";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { WireError, type WireResult } from "@xeon/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// turn.resume(F wire §3.3.1, HS-74). 가짜 엔진 위의 실제 처리기다. 실제 저장소 위의 시험은 test/int/approval-restart.int.test.ts다.

const TURN: TurnId = fixedIdFactory(95).next("trn");

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

test("turn.resume takes the write ownership, resumes the thread and returns the loop's answer unchanged", async () => {
  const answers: WireResult<"turn.resume">[] = [
    { status: "resumed", turnId: TURN, from: "tools" },
    { status: "closed", turnId: TURN, reason: "abort_requested" },
    { status: "nothing" },
  ];
  const asked: string[] = [];
  const queue = [...answers];
  const host = createFakeHost({
    overrides: {
      turns: {
        resume: (threadId) => {
          asked.push(threadId);
          const next = queue.shift();
          if (next === undefined) throw new Error("no more answers");
          return Promise.resolve(ok(next));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const { connection, served } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  expect(host.fake.held.has(threadId)).toBe(false);
  const first = await connection.request("turn.resume", { threadId });
  const second = await connection.request("turn.resume", { threadId });
  const third = await connection.request("turn.resume", { threadId });
  expect([first, second, third]).toEqual(answers);
  expect(asked).toEqual([threadId, threadId, threadId]);
  // 소유는 한 번만 얻는다(HS-28)
  expect(host.fake.acquisitions).toHaveLength(1);
  expect(host.hub.state(served.id)?.writeThreads.has(threadId)).toBe(true);
  await connection.close();
});

test("an unknown thread is thread.notFound and another owner is thread.locked, and nothing is resumed", async () => {
  const resumed: string[] = [];
  const overrides = {
    turns: {
      resume: (threadId: string) => {
        resumed.push(threadId);
        return Promise.resolve(ok<WireResult<"turn.resume">>({ status: "nothing" }));
      },
    },
  };
  const host = createFakeHost({ overrides });
  const connection = await open(host);
  const unknown = await wireErrorOf(
    connection.request("turn.resume", { threadId: fixedIdFactory(96).next("thr") }),
  );
  expect(unknown.code).toBe(3001);
  const lockedHost = createFakeHost({ lockedBy: "service", overrides });
  const threadId = lockedHost.fake.seedThread();
  const lockedConnection = await open(lockedHost);
  const locked = await wireErrorOf(lockedConnection.request("turn.resume", { threadId }));
  expect(locked.code).toBe(3002);
  expect(resumed).toEqual([]);
  await connection.close();
  await lockedConnection.close();
});

test("loop errors become wire errors: an aborting turn is turn.busy, a store failure is store.*", async () => {
  const queue = [
    { kind: "turn_aborting", turnId: TURN },
    { kind: "stale_lease", scopeId: "s", leaseEpoch: 1 },
    { kind: "disk_full" },
    { kind: "row_invalid", where: "events.payload" },
  ] as const;
  const remaining = [...queue];
  const host = createFakeHost({
    overrides: {
      turns: {
        resume: () => {
          const next = remaining.shift();
          if (next === undefined) throw new Error("no more errors");
          return Promise.resolve(err(next));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const busy = await wireErrorOf(connection.request("turn.resume", { threadId }));
  expect(busy.data.kind).toBe("turn.busy");
  expect(busy.data.details).toEqual({ turnId: TURN });
  const lost = await wireErrorOf(connection.request("turn.resume", { threadId }));
  expect(lost.data.kind).toBe("thread.locked");
  const full = await wireErrorOf(connection.request("turn.resume", { threadId }));
  expect(full.data.kind).toBe("store.diskFull");
  expect(full.message).toContain("turn.resume rejected");
  const corrupt = await wireErrorOf(connection.request("turn.resume", { threadId }));
  expect(corrupt.data.kind).toBe("store.corrupt");
  await connection.close();
});
