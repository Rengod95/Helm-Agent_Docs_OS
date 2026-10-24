import { expect, test } from "bun:test";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { WireError } from "@xeon/contracts/wire";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { FAKE_STORE_ID } from "../fixtures/fake-engine.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  try {
    await call;
  } catch (caught) {
    if (caught instanceof WireError) return caught;
    throw caught;
  }
  throw new Error("expected the request to fail with a WireError");
}

test("thread.create makes the thread, takes the write ownership and returns the position", async () => {
  const host = createFakeHost();
  const { connection, served } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const created = await connection.request("thread.create", { title: "t" });
  expect(created.position).toEqual({ storeId: FAKE_STORE_ID, seq: 1 });
  expect(host.fake.held.has(created.threadId)).toBe(true);
  expect(host.fake.acquisitions).toEqual([{ threadId: created.threadId, kind: "cli" }]);
  expect(host.hub.state(served.id)?.openThreads.has(created.threadId)).toBe(true);
  await connection.close();
});

test("the owner kind follows the host mode: in-process cli, stdio app, service service", async () => {
  const kinds = await Promise.all(
    (["in-process", "stdio", "service"] as const).map(async (mode) => {
      const host = createFakeHost({ mode });
      const { connection } = host.connect();
      await connection.request("host.hello", HELLO_PARAMS);
      await connection.request("thread.create", {});
      await connection.close();
      return host.fake.acquisitions[0]?.kind ?? "none";
    }),
  );
  expect(kinds).toEqual(["cli", "app", "service"]);
});

test("thread.create when the lock service refuses is thread.locked with the owner and the alternatives", async () => {
  const host = createFakeHost({ lockedBy: "service" });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(connection.request("thread.create", {}));
  expect(error.code).toBe(3002);
  expect(error.data.retryable).toBe(true);
  expect(error.data.details).toEqual({ ownerKind: "service", options: ["observe", "fork"] });
  await connection.close();
});

test("turn.start on an unknown thread is thread.notFound", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const threadId = fixedIdFactory(77).next("thr");
  const error = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(error.code).toBe(3001);
  expect(error.data.details).toEqual({ threadId });
  await connection.close();
});

test("turn.start takes the ownership implicitly once (HS-28), submits with the request id and opens the thread for chunks", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const { connection, served } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const first = await connection.request("turn.start", {
    threadId,
    input: "hi",
    requestId: "req-1",
  });
  expect(first.turnId.startsWith("trn_")).toBe(true);
  expect(host.fake.acquisitions).toHaveLength(1);
  expect(host.fake.submitted).toEqual([{ threadId, requestId: "req-1" }]);
  expect(host.hub.state(served.id)?.openThreads.has(threadId)).toBe(true);
  // 쥔 뒤에는 다시 얻지 않는다
  await connection.request("turn.start", { threadId, input: "again" });
  expect(host.fake.acquisitions).toHaveLength(1);
  await connection.close();
});

test("turn.start on a thread another process owns is thread.locked and submits nothing", async () => {
  const host = createFakeHost({ lockedBy: "app" });
  const threadId = host.fake.seedThread();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(error.code).toBe(3002);
  expect(error.data.details).toMatchObject({ ownerKind: "app" });
  expect(host.fake.submitted).toHaveLength(0);
  await connection.close();
});

test("turn.start refused by the loop is a typed wire error, not a bare internal error", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);

  host.fake.setRejection({ kind: "thread_not_found", threadId });
  const missing = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(missing.code).toBe(3001);

  host.fake.setRejection({ kind: "turn_aborting", turnId: host.fake.ids.next("trn") });
  const aborting = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(aborting.code).toBe(3003);

  host.fake.setRejection({ kind: "ownership_lost", threadId });
  const lost = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(lost.code).toBe(3002);

  host.fake.setRejection({ kind: "input_invalid", message: "bad input" });
  const invalid = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(invalid.code).toBe(-32602);

  host.fake.setRejection({ kind: "disk_full" });
  const full = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(full.code).toBe(5004);
  expect(full.data.kind).toBe("store.diskFull");
  expect(full.data.retryable).toBe(false);

  host.fake.setRejection({ kind: "busy" });
  const busy = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(busy.code).toBe(5003);
  expect(busy.data.retryable).toBe(true);

  host.fake.setRejection({ kind: "io", code: "SQLITE_IOERR" });
  const io = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(io.code).toBe(5006);
  expect(io.data.details).toEqual({ code: "SQLITE_IOERR" });

  host.fake.setRejection({ kind: "read_only", reason: "observer" });
  const readOnly = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(readOnly.code).toBe(5005);
  expect(readOnly.data.details).toEqual({ reason: "observer" });
  await connection.close();
});

test("turn.start while a turn runs is turn.busy with the running turn id", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const running = host.fake.ids.next("trn");
  host.fake.setRunningTurn(running);
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const error = await wireErrorOf(connection.request("turn.start", { threadId, input: "hi" }));
  expect(error.code).toBe(3003);
  expect(error.data.details).toEqual({ turnId: running });
  await connection.close();
});
