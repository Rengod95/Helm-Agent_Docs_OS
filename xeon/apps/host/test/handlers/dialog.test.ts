import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { WireError, type WireParams, type WireResult } from "@xeon/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// status.list, attachments.add(F wire §3.3.1, HS-81, M3-REQ-16). 가짜 엔진 위의 실제 처리기다. 능력 쪽은 test/assembly/dialog-wire.test.ts,
// 실제 cap-dialog 위의 시험은 test/int/dialog-wire.int.test.ts다.

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

const ITEMS: WireResult<"status.list"> = {
  items: [
    { id: "core.turn", text: "대기", tone: "normal", order: 100 },
    { id: "core.usage", text: "1.5k 토큰 · $0.03", tone: "normal", order: 120 },
  ],
};

const ADDED: WireResult<"attachments.add"> = {
  attachment: {
    kind: "text",
    name: "note.txt",
    mime: "text/plain",
    size: 16,
    blob: null,
    path: "/work/note.txt",
    url: null,
    image: null,
  },
  parts: [
    {
      type: "text",
      text: '<attachment name="note.txt" path="/work/note.txt">\nhello\n</attachment>',
    },
  ],
};

const SOURCE = { kind: "path", path: "/work/note.txt" } as const;

test("status.list hands the thread to the service, returns its items as they are, and takes no write ownership", async () => {
  const asked: string[] = [];
  const host = createFakeHost({
    overrides: {
      dialog: {
        statusList: (threadId) => {
          asked.push(threadId);
          return Promise.resolve(ok(ITEMS));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  expect(await connection.request("status.list", { threadId })).toEqual(ITEMS);
  expect(asked).toEqual([threadId]);
  expect(host.fake.held.has(threadId)).toBe(false);
  await connection.close();
});

test("status.list on an unknown thread is thread.notFound and asks the service nothing", async () => {
  const asked: string[] = [];
  const host = createFakeHost({
    overrides: {
      dialog: {
        statusList: (threadId) => {
          asked.push(threadId);
          return Promise.resolve(ok(ITEMS));
        },
      },
    },
  });
  const connection = await open(host);
  const threadId = fixedIdFactory(88).next("thr");
  const error = await wireErrorOf(connection.request("status.list", { threadId }));
  expect(error.code).toBe(3001);
  expect(error.data.details).toEqual({ threadId });
  expect(asked).toEqual([]);
  await connection.close();
});

test("status.list without a status service is internal and names the method", async () => {
  const host = createFakeHost({
    overrides: { dialog: { statusList: () => Promise.resolve(err({ kind: "unavailable" })) } },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("status.list", { threadId }));
  expect(error.data.kind).toBe("internal");
  expect(error.message).toContain("status.list");
  await connection.close();
});

test("status.list maps input rejections to invalid params and other rejections to internal with the code", async () => {
  const queue = [
    { kind: "rejected" as const, code: "invalid_input", message: "no thread" },
    { kind: "rejected" as const, code: "unavailable", message: "the store is busy" },
  ];
  const host = createFakeHost({
    overrides: {
      dialog: {
        statusList: () => {
          const next = queue.shift();
          if (next === undefined) throw new Error("no more failures");
          return Promise.resolve(err(next));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  const invalid = await wireErrorOf(connection.request("status.list", { threadId }));
  expect(invalid.data.kind).toBe("jsonrpc.invalidParams");
  expect(invalid.data.details).toEqual({ issues: [{ path: "threadId", message: "no thread" }] });
  const other = await wireErrorOf(connection.request("status.list", { threadId }));
  expect(other.data.kind).toBe("internal");
  expect(other.message).toContain("unavailable: the store is busy");
  await connection.close();
});

test("attachments.add hands only the source to the service and returns the attachment and parts unchanged", async () => {
  const asked: WireParams<"attachments.add">[] = [];
  const host = createFakeHost({
    overrides: {
      dialog: {
        attachmentsAdd: (params) => {
          asked.push(params);
          return Promise.resolve(ok(ADDED));
        },
      },
    },
  });
  const connection = await open(host);
  expect(await connection.request("attachments.add", { source: SOURCE })).toEqual(ADDED);
  expect(asked).toEqual([{ source: SOURCE }]);
  await connection.close();
});

test("attachments.add with a thread hands the thread along and takes no write ownership", async () => {
  const asked: WireParams<"attachments.add">[] = [];
  const host = createFakeHost({
    overrides: {
      dialog: {
        attachmentsAdd: (params) => {
          asked.push(params);
          return Promise.resolve(ok(ADDED));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  expect(await connection.request("attachments.add", { threadId, source: SOURCE })).toEqual(ADDED);
  expect(asked).toEqual([{ threadId, source: SOURCE }]);
  expect(host.fake.held.has(threadId)).toBe(false);
  await connection.close();
});

test("attachments.add on an unknown thread is thread.notFound and stores nothing", async () => {
  const asked: WireParams<"attachments.add">[] = [];
  const host = createFakeHost({
    overrides: {
      dialog: {
        attachmentsAdd: (params) => {
          asked.push(params);
          return Promise.resolve(ok(ADDED));
        },
      },
    },
  });
  const connection = await open(host);
  const threadId = fixedIdFactory(88).next("thr");
  const error = await wireErrorOf(
    connection.request("attachments.add", { threadId, source: SOURCE }),
  );
  expect(error.code).toBe(3001);
  expect(asked).toEqual([]);
  await connection.close();
});

test("attachments.add rejections about the source are invalid params on the source, others are internal", async () => {
  const codes = [
    "attachment_too_large",
    "attachment_type_unsupported",
    "not_found",
    "denied",
    "unavailable",
  ] as const;
  const queue = codes.map((code) => ({
    kind: "rejected" as const,
    code,
    message: `${code} happened`,
  }));
  const host = createFakeHost({
    overrides: {
      dialog: {
        attachmentsAdd: () => {
          const next = queue.shift();
          if (next === undefined) throw new Error("no more failures");
          return Promise.resolve(err(next));
        },
      },
    },
  });
  const connection = await open(host);
  const first = await wireErrorOf(connection.request("attachments.add", { source: SOURCE }));
  const second = await wireErrorOf(connection.request("attachments.add", { source: SOURCE }));
  const third = await wireErrorOf(connection.request("attachments.add", { source: SOURCE }));
  const fourth = await wireErrorOf(connection.request("attachments.add", { source: SOURCE }));
  const fifth = await wireErrorOf(connection.request("attachments.add", { source: SOURCE }));
  expect([first, second, third, fourth].map((error) => error.data.kind)).toEqual([
    "jsonrpc.invalidParams",
    "jsonrpc.invalidParams",
    "jsonrpc.invalidParams",
    "jsonrpc.invalidParams",
  ]);
  expect(first.data.details).toEqual({
    issues: [{ path: "source", message: "attachment_too_large happened" }],
  });
  expect(fourth.data.details).toEqual({
    issues: [{ path: "source", message: "denied happened" }],
  });
  expect(fifth.data.kind).toBe("internal");
  expect(fifth.message).toContain("attachments.add: unavailable: unavailable happened");
  await connection.close();
});

test("attachments.add without an attachment service is internal and names the method", async () => {
  const host = createFakeHost({
    overrides: { dialog: { attachmentsAdd: () => Promise.resolve(err({ kind: "unavailable" })) } },
  });
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("attachments.add", { source: SOURCE }));
  expect(error.data.kind).toBe("internal");
  expect(error.message).toContain("attachments.add");
  await connection.close();
});

test("host.hello lists status.list, attachments.add and notify.list now that they have handlers", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  expect(names).toContain("status.list");
  expect(names).toContain("attachments.add");
  expect(names).toContain("notify.list");
  await connection.close();
});

// notify.list(F wire §3.3.1, HS-82, M3-REQ-16). 목록만 읽고 쓰기 소유를 얻지 않는다. 입력 거절은 `afterSeq`를 가리킨다.

const NOTICES: WireResult<"notify.list"> = {
  notices: [
    {
      kind: "completed",
      title: "작업이 끝났다",
      body: null,
      seq: 7,
      sourceType: "turn.completed",
    },
  ],
  nextSeq: 7,
};

test("notify.list hands the list input to the service and returns its notices unchanged", async () => {
  const asked: WireParams<"notify.list">[] = [];
  const host = createFakeHost({
    overrides: {
      dialog: {
        notifyList: (params) => {
          asked.push(params);
          return Promise.resolve(ok(NOTICES));
        },
      },
    },
  });
  const connection = await open(host);
  expect(
    await connection.request("notify.list", { afterSeq: 0, kinds: ["completed"], limit: 10 }),
  ).toEqual(NOTICES);
  expect(asked).toEqual([{ afterSeq: 0, kinds: ["completed"], limit: 10 }]);
  await connection.close();
});

test("notify.list with a thread hands it along and takes no write ownership", async () => {
  const asked: WireParams<"notify.list">[] = [];
  const host = createFakeHost({
    overrides: {
      dialog: {
        notifyList: (params) => {
          asked.push(params);
          return Promise.resolve(ok(NOTICES));
        },
      },
    },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  expect(await connection.request("notify.list", { threadId, afterSeq: 0 })).toEqual(NOTICES);
  expect(asked).toEqual([{ threadId, afterSeq: 0 }]);
  expect(host.fake.held.has(threadId)).toBe(false);
  await connection.close();
});

test("notify.list on an unknown thread is thread.notFound and asks the service nothing", async () => {
  const asked: WireParams<"notify.list">[] = [];
  const host = createFakeHost({
    overrides: {
      dialog: {
        notifyList: (params) => {
          asked.push(params);
          return Promise.resolve(ok(NOTICES));
        },
      },
    },
  });
  const connection = await open(host);
  const threadId = fixedIdFactory(88).next("thr");
  const error = await wireErrorOf(connection.request("notify.list", { threadId, afterSeq: 0 }));
  expect(error.code).toBe(3001);
  expect(error.data.details).toEqual({ threadId });
  expect(asked).toEqual([]);
  await connection.close();
});

test("notify.list without a notify service is internal and names the method", async () => {
  const host = createFakeHost({
    overrides: { dialog: { notifyList: () => Promise.resolve(err({ kind: "unavailable" })) } },
  });
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("notify.list", { afterSeq: 0 }));
  expect(error.data.kind).toBe("internal");
  expect(error.message).toContain("notify.list");
  await connection.close();
});

test("notify.list maps an input rejection to invalid params on afterSeq and other rejections to internal with the code", async () => {
  const queue = [
    { kind: "rejected" as const, code: "invalid_input", message: "bad list" },
    { kind: "rejected" as const, code: "unavailable", message: "the store is busy" },
  ];
  const host = createFakeHost({
    overrides: {
      dialog: {
        notifyList: () => {
          const next = queue.shift();
          if (next === undefined) throw new Error("no more failures");
          return Promise.resolve(err(next));
        },
      },
    },
  });
  const connection = await open(host);
  const invalid = await wireErrorOf(connection.request("notify.list", { afterSeq: 0 }));
  expect(invalid.data.kind).toBe("jsonrpc.invalidParams");
  expect(invalid.data.details).toEqual({ issues: [{ path: "afterSeq", message: "bad list" }] });
  const other = await wireErrorOf(connection.request("notify.list", { afterSeq: 0 }));
  expect(other.data.kind).toBe("internal");
  expect(other.message).toContain("unavailable: the store is busy");
  await connection.close();
});
