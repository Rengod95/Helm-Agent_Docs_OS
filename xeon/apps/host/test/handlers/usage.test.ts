import { expect, test } from "bun:test";
import { WireError, type UsageGauge, type WireParams } from "@xeon/contracts/wire";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// usage.get(F wire §3.3.1, L4.host-service HS-83, M3-REQ-15). 가짜 엔진의 사용량 원천 위에서 실제 처리기를 시험한다. 조립 기본(빈 목록)은
// test/assembly/usage.test.ts다.

/** 가짜 엔진의 시계(RECORDED_AT)가 정한 시각 */
const AS_OF = "2026-01-05T00:00:00.000Z";

const ANTHROPIC: UsageGauge = {
  id: "anthropic:acct1:day:tokens",
  providerId: "anthropic",
  account: "acct1",
  window: "day",
  unit: "tokens",
  used: 1200,
  limit: 100000,
  resetsAt: "2026-01-06T00:00:00.000Z",
};

const OPENAI: UsageGauge = {
  id: "openai:-:minute:requests",
  providerId: "openai",
  account: null,
  window: "minute",
  unit: "requests",
  used: 3,
  limit: null,
  resetsAt: null,
};

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

test("usage.get returns the source's gauges with asOf from the engine clock, and hands the source an empty input", async () => {
  const asked: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      usage: {
        gauges: (input) => {
          asked.push(input);
          return Promise.resolve([ANTHROPIC, OPENAI]);
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("usage.get", {})).toEqual({
    gauges: [ANTHROPIC, OPENAI],
    asOf: AS_OF,
  });
  expect(asked).toEqual([{}]);
  await connection.close();
});

test("usage.get with a providerId hands it to the source and keeps only that provider's gauges", async () => {
  const asked: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      usage: {
        gauges: (input) => {
          asked.push(input);
          return Promise.resolve([ANTHROPIC, OPENAI]);
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("usage.get", { providerId: "openai" })).toEqual({
    gauges: [OPENAI],
    asOf: AS_OF,
  });
  expect(asked).toEqual([{ providerId: "openai" }]);
  await connection.close();
});

test("usage.get with a thread hands the thread to the source and takes no write ownership", async () => {
  const asked: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      usage: {
        gauges: (input) => {
          asked.push(input);
          return Promise.resolve([ANTHROPIC]);
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  expect(await connection.request("usage.get", { threadId })).toEqual({
    gauges: [ANTHROPIC],
    asOf: AS_OF,
  });
  expect(asked).toEqual([{ threadId }]);
  expect(host.fake.held.has(threadId)).toBe(false);
  await connection.close();
});

test("usage.get on an unknown thread is thread.notFound and asks the source nothing", async () => {
  const asked: unknown[] = [];
  const host = createFakeHost({
    overrides: {
      usage: {
        gauges: (input) => {
          asked.push(input);
          return Promise.resolve([ANTHROPIC]);
        },
      },
    },
  });
  const connection = await open(host);
  const threadId = fixedIdFactory(88).next("thr");
  const error = await wireErrorOf(connection.request("usage.get", { threadId }));
  expect(error.code).toBe(3001);
  expect(error.data.details).toEqual({ threadId });
  expect(asked).toEqual([]);
  await connection.close();
});

test("without a gauge source the answer is an empty list at the engine clock", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const params: WireParams<"usage.get"> = {};
  expect(await connection.request("usage.get", params)).toEqual({ gauges: [], asOf: AS_OF });
  await connection.close();
});

test("more gauges than the wire result allows is an internal error, not a silent cut", async () => {
  const many: UsageGauge[] = Array.from({ length: 257 }, (_, index) => ({
    ...ANTHROPIC,
    id: `anthropic:acct1:day:tokens:${String(index)}`,
  }));
  const host = createFakeHost({
    overrides: { usage: { gauges: () => Promise.resolve(many) } },
  });
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("usage.get", {}));
  expect(error.data.kind).toBe("internal");
  expect(error.message).toContain("257");
  expect(error.message).toContain("256");
  await connection.close();
});

test("host.hello lists usage.get among the features the host implements", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  expect(hello.features.map((feature) => feature.name)).toContain("usage.get");
  await connection.close();
});
