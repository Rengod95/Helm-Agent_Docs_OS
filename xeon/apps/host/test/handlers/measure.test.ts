import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import { WireError } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// measure.turn, measure.daily(F wire §3.3.8, T-MEAS-READ). 가짜 엔진의 측정 포트 위에서 실제 처리기를 시험한다.

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

const ROW = {
  at: 1000,
  kind: "call",
  metrics: { firstTokenMs: 80, input: 10 },
  tags: { role: "main" },
};

test("measure.turn returns the rows of one turn as the port gave them and asks with the typed ids", async () => {
  const asked: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      measure: {
        turn: (threadId, turnId) => {
          asked.push([threadId, turnId]);
          return ok({ enabled: true, rows: [ROW] });
        },
      },
    },
  });
  const connection = await open(host);
  const threadId = host.fake.seedThread();
  expect(await connection.request("measure.turn", { threadId, turnId: "trn_x" })).toEqual({
    enabled: true,
    rows: [ROW],
  });
  expect(asked).toEqual([[threadId, "trn_x"]]);
  await connection.close();
});

test("measure.turn is thread.notFound for an unknown thread and store.io when the store cannot be read", async () => {
  const host = createFakeHost({
    overrides: { measure: { turn: () => err({ kind: "closed" }) } },
  });
  const connection = await open(host);
  const unknown = fixedIdFactory(77).next("thr");
  const missing = await wireErrorOf(
    connection.request("measure.turn", { threadId: unknown, turnId: "trn_x" }),
  );
  expect(missing.data.kind).toBe("thread.notFound");
  expect(missing.data.details).toEqual({ threadId: unknown });
  const threadId = host.fake.seedThread();
  const broken = await wireErrorOf(
    connection.request("measure.turn", { threadId, turnId: "trn_x" }),
  );
  expect(broken.data.kind).toBe("store.io");
  await connection.close();
});

test("measure.daily returns the daily aggregate of one kind and metric", async () => {
  const asked: unknown[] = [];
  const day = { day: "2026-11-04", count: 3, sum: 240, min: 60, max: 100 };
  const host = createFakeHost({
    overrides: {
      measure: {
        daily: (kind, metric) => {
          asked.push([kind, metric]);
          return ok({ enabled: true, days: [day] });
        },
      },
    },
  });
  const connection = await open(host);
  expect(
    await connection.request("measure.daily", { kind: "call", metric: "firstTokenMs" }),
  ).toEqual({
    enabled: true,
    days: [day],
  });
  expect(asked).toEqual([["call", "firstTokenMs"]]);
  await connection.close();
});
