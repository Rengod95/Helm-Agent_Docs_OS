import { expect, test } from "bun:test";
import { WIRE_METHODS, type WireHandlers, type WireMethodName } from "@fresnel/contracts/wire";
import { isNotImplemented } from "../../src/handlers/not-implemented.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// spec-deltas/t-f.md §5 5번. M4 wire 메서드 50개(hooks.order.* 4개 포함)는 처리기가 있고, 소유 트랙이 채우기 전에는 notImplemented이며
// host.hello의 features에 없다. 이 시험은 어느 메서드가 기본인지 목록을 갖지 않는다: 소유 트랙이 처리기를 채우면
// features에 오르므로 두 쪽이 계속 일치하고, 시험은 고치지 않는다.

function isMethodName(name: string): name is WireMethodName {
  return Object.hasOwn(WIRE_METHODS, name);
}

function m4Methods(): WireMethodName[] {
  return Object.entries(WIRE_METHODS)
    .filter(([, spec]) => spec.stage === "M4")
    .map(([name]) => name)
    .filter(isMethodName);
}

test("m4-defaults: the 59 M4 methods all have a handler and notImplemented matches their absence from hello features", async () => {
  const slot: { table: WireHandlers | undefined } = { table: undefined };
  const host = createFakeHost({
    override: (table) => {
      slot.table = table;
      return table;
    },
  });
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const featured = new Set(hello.features.map((feature) => feature.name));
  const table = slot.table;
  if (table === undefined) throw new Error("the handler table was not captured");

  const names = m4Methods();
  expect(names).toHaveLength(59);
  const actual = names.map((name) => ({
    name,
    hasHandler: typeof table[name] === "function",
    defaulted: isNotImplemented(table[name]),
    featured: featured.has(name),
  }));
  expect(actual).toEqual(
    names.map((name) => ({
      name,
      hasHandler: true,
      defaulted: !featured.has(name),
      featured: featured.has(name),
    })),
  );
  await connection.close();
});

test("m4-defaults: a defaulted M4 method answers -32601 with its name", async () => {
  const slot: { table: WireHandlers | undefined } = { table: undefined };
  const host = createFakeHost({
    override: (table) => {
      slot.table = table;
      return table;
    },
  });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const table = slot.table;
  if (table === undefined) throw new Error("the handler table was not captured");
  // 소유 트랙이 처리기를 채우는 대로 기본 처리기는 줄어든다. 남은 것 하나로 본다(모두 채워졌으면 볼 것이 없다)
  const method = m4Methods().find((name) => isNotImplemented(table[name]));
  if (method !== undefined) {
    const failure = await failureOf(connection.request(method, {}));
    expect(failure).toMatchObject({ code: -32601, data: { details: { method } } });
  }
  await connection.close();
});

async function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

// W-16: `around`과 `before`는 함께 쓰지 않는다. 계약 스키마가 막지 않으므로 처리기가 port를 부르기 전에 거부한다.
test("m4-defaults: thread.read rejects around together with before as invalid params", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const threadId = host.fake.ids.next("thr");
  const failure = await failureOf(
    connection.request("thread.read", {
      threadId,
      around: host.fake.ids.next("itm"),
      before: host.fake.ids.next("itm"),
    }),
  );
  expect(failure).toMatchObject({
    code: -32602,
    data: {
      details: {
        issues: [{ path: "around", message: "around cannot be combined with before" }],
      },
    },
  });
  await connection.close();
});
