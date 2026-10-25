import { expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import { WireError } from "@xeon/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { fixedIdFactory } from "@xeon/ext-host/testing";

// thread.rename(F wire §3.3.1, HS-73)과 첫 입력 자동 제목(G2-12). 가짜 엔진 위의 실제 처리기다.

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

test("the owner renames its thread and gets the position that includes the change", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  const renamed = await connection.request("thread.rename", {
    threadId: created.threadId,
    title: "새 제목",
  });
  expect(host.fake.titles.get(created.threadId)).toBe("새 제목");
  expect(renamed.position.seq).toBe(host.fake.events.length);
  expect(renamed.position.seq).toBeGreaterThan(created.position.seq);
  // 이미 쥔 thread라 다시 얻지도 놓지도 않는다
  expect(host.fake.acquisitions).toHaveLength(1);
  expect(host.fake.released).toEqual([]);
  await connection.close();
});

test("a thread nobody holds is taken for the rename and let go afterwards", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  await connection.request("thread.rename", { threadId, title: "sessions rename" });
  expect(host.fake.titles.get(threadId)).toBe("sessions rename");
  expect(host.fake.acquisitions).toEqual([{ threadId, kind: "cli" }]);
  expect(host.fake.released).toEqual([threadId]);
  expect(host.fake.held.has(threadId)).toBe(false);
  await connection.close();
});

test("a thread another process owns is thread.locked and keeps its title", async () => {
  const host = createFakeHost({ lockedBy: "app" });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("thread.rename", { threadId, title: "x" }));
  expect(error.code).toBe(3002);
  expect(error.data.details).toEqual({ ownerKind: "app", options: ["observe", "fork"] });
  expect(host.fake.titles.size).toBe(0);
  await connection.close();
});

test("an unknown thread is thread.notFound and a closed thread is thread.closed", async () => {
  const closed = fixedIdFactory(91).next("thr");
  const host = createFakeHost({
    overrides: {
      threads: {
        rename: () => err({ kind: "thread_closed", threadId: closed }),
      },
    },
  });
  const known = host.fake.seedThread();
  const connection = await open(host);
  const unknown = await wireErrorOf(
    connection.request("thread.rename", { threadId: fixedIdFactory(92).next("thr"), title: "x" }),
  );
  expect(unknown.code).toBe(3001);
  const refused = await wireErrorOf(
    connection.request("thread.rename", { threadId: known, title: "x" }),
  );
  expect(refused.code).toBe(3007);
  expect(refused.data.details).toEqual({ threadId: closed });
  // 락은 실패해도 놓는다
  expect(host.fake.held.has(known)).toBe(false);
  await connection.close();
});

test("an empty title and a title over 200 characters are refused before the handler", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const empty = await wireErrorOf(connection.request("thread.rename", { threadId, title: "" }));
  expect(empty.code).toBe(-32602);
  const long = await wireErrorOf(
    connection.request("thread.rename", { threadId, title: "t".repeat(201) }),
  );
  expect(long.code).toBe(-32602);
  expect(host.fake.titles.size).toBe(0);
  await connection.close();
});

// ── G2-12: 첫 입력 자동 제목 ───────────────────────────────────────────────────────────────

test("the first input names a thread that has no title: the first 80 characters, whitespace collapsed", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  await connection.request("turn.start", {
    threadId: created.threadId,
    input: `  첫 질문입니다.\n${"가".repeat(100)}`,
  });
  expect(host.fake.titles.get(created.threadId)).toBe(`첫 질문입니다. ${"가".repeat(80 - 9)}`);
  expect(Array.from(host.fake.titles.get(created.threadId) ?? "")).toHaveLength(80);
  await connection.close();
});

test("a later input does not rename, and a title the person chose is never overwritten", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const first = await connection.request("thread.create", {});
  await connection.request("turn.start", { threadId: first.threadId, input: "one" });
  host.fake.setRunningTurn(undefined);
  await connection.request("turn.start", { threadId: first.threadId, input: "two" });
  expect(host.fake.titles.get(first.threadId)).toBe("one");
  await connection.request("thread.rename", { threadId: first.threadId, title: "mine" });
  await connection.request("turn.start", { threadId: first.threadId, input: "three" });
  expect(host.fake.titles.get(first.threadId)).toBe("mine");
  await connection.close();
});

test("an image-only first input leaves the title empty, and a failed rename does not fail the turn", async () => {
  const host = createFakeHost({
    overrides: { threads: { rename: () => err({ kind: "busy" }) } },
  });
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  const started = await connection.request("turn.start", {
    threadId: created.threadId,
    input: [{ type: "image", data: "blob:sha256:00", mimeType: "image/png" }],
  });
  expect(started.turnId.startsWith("trn_")).toBe(true);
  expect(host.fake.log.errors).toEqual([]);
  const text = await connection.request("turn.start", {
    threadId: created.threadId,
    input: "hello",
  });
  expect(text.turnId.startsWith("trn_")).toBe(true);
  expect(host.fake.log.errors).toEqual([
    {
      message: "thread.auto_title_failed",
      fields: { threadId: created.threadId, step: "rename", kind: "busy" },
    },
  ]);
  await connection.close();
});

test("a turn the loop refused names nothing", async () => {
  const host = createFakeHost();
  host.fake.setRejection({ kind: "input_invalid", message: "empty" });
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  await wireErrorOf(connection.request("turn.start", { threadId: created.threadId, input: "x" }));
  expect(host.fake.titles.size).toBe(0);
  await connection.close();
});
