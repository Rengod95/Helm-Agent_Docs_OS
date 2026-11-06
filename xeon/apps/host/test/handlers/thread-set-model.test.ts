import { expect, test } from "bun:test";
import { WireError } from "@fresnel/contracts/wire";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// thread.setModel(F wire §3.3.1, M4 T-MODEL). 가짜 엔진 위의 실제 처리기다. 가짜 카탈로그에는 `tape/tape-1`만 있다.

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

test("the owner chooses a catalog model, the list shows it, and null restores the default", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  const set = await connection.request("thread.setModel", {
    threadId: created.threadId,
    model: "tape/tape-1",
  });
  expect(host.fake.chosenModels.get(created.threadId)).toBe("tape/tape-1");
  expect(set.position.seq).toBe(host.fake.events.length);
  const listed = await connection.request("thread.list", {});
  expect(listed.threads.map((t) => t.model)).toEqual(["tape/tape-1"]);
  await connection.request("thread.setModel", { threadId: created.threadId, model: null });
  expect(host.fake.chosenModels.has(created.threadId)).toBe(false);
  const again = await connection.request("thread.list", {});
  expect(again.threads.map((t) => "model" in t)).toEqual([false]);
  await connection.close();
});

test("a model that is not in the catalog is rejected and nothing is written", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  const before = host.fake.events.length;
  const errors = await Promise.all(
    ["tape/nope", "ghost/tape-1", "noslash"].map((model) =>
      wireErrorOf(connection.request("thread.setModel", { threadId: created.threadId, model })),
    ),
  );
  for (const error of errors) {
    expect(error.code).toBe(-32602);
    expect(error.data.details).toEqual({
      issues: [{ path: "model", message: "model is not in the catalog" }],
    });
  }
  expect(host.fake.events.length).toBe(before);
  expect(host.fake.chosenModels.size).toBe(0);
  await connection.close();
});

test("a thread another process owns is thread.locked and keeps its model", async () => {
  const host = createFakeHost({ lockedBy: "app" });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const error = await wireErrorOf(
    connection.request("thread.setModel", { threadId, model: "tape/tape-1" }),
  );
  expect(error.code).toBe(3002);
  expect(host.fake.chosenModels.size).toBe(0);
  await connection.close();
});

test("an unknown thread is thread.notFound", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const error = await wireErrorOf(
    connection.request("thread.setModel", {
      threadId: fixedIdFactory(91).next("thr"),
      model: "tape/tape-1",
    }),
  );
  expect(error.code).toBe(3001);
  await connection.close();
});
