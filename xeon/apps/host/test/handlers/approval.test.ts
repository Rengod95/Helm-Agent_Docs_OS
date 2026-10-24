import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { WireError, type WireParams } from "@xeon/contracts/wire";
import { FAKE_STORE_ID } from "../fixtures/fake-engine.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.4: approval.respond(F wire §4.6 A안), approval.list(§3.4.6 5항). 가짜 엔진 위의 실제 처리기다.
// 실제 승인 서비스와 저장소 위의 시험은 test/int/approval.int.test.ts다.

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

async function open(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

interface Located {
  threadId: ThreadId | undefined;
}

function hostWithApproval(located: Located, responded: WireParams<"approval.respond">[]): FakeHost {
  return createFakeHost({
    overrides: {
      approvals: {
        locate: () => Promise.resolve(ok(located.threadId)),
        respond: (params) => {
          responded.push(params);
          return Promise.resolve({ applied: true });
        },
      },
    },
  });
}

const PARAMS: WireParams<"approval.respond"> = {
  approvalId: "evt_known",
  decision: "answer",
  answer: { q1: { selected: ["a"] } },
  remember: "once",
};

test("approval.respond for an approval nobody knows is applied false and never reaches the service", async () => {
  const responded: WireParams<"approval.respond">[] = [];
  const host = hostWithApproval({ threadId: undefined }, responded);
  const connection = await open(host);
  expect(await connection.request("approval.respond", PARAMS)).toEqual({ applied: false });
  expect(responded).toEqual([]);
  await connection.close();
});

test("approval.respond passes the response on when this process owns the approval's thread", async () => {
  const located: Located = { threadId: undefined };
  const responded: WireParams<"approval.respond">[] = [];
  const host = hostWithApproval(located, responded);
  const threadId = host.fake.seedThread();
  located.threadId = threadId;
  const connection = await open(host);
  await connection.request("thread.open", { threadId, mode: "write" });
  expect(await connection.request("approval.respond", PARAMS)).toEqual({ applied: true });
  expect(responded).toEqual([PARAMS]);
  await connection.close();
});

test("approval.respond for a thread another process owns is thread.locked and is not forwarded", async () => {
  const located: Located = { threadId: undefined };
  const responded: WireParams<"approval.respond">[] = [];
  const host = hostWithApproval(located, responded);
  located.threadId = host.fake.seedThread();
  const connection = await open(host);
  const error = await wireErrorOf(connection.request("approval.respond", PARAMS));
  expect(error.code).toBe(3002);
  expect(responded).toEqual([]);
  // 응답을 위해 잠금을 얻지는 않는다
  expect(host.fake.acquisitions).toEqual([]);
  await connection.close();
});

test("approval.respond reports an unreadable store as a store error", async () => {
  const host = createFakeHost({
    overrides: { approvals: { locate: () => Promise.resolve(err({ kind: "busy" })) } },
  });
  const connection = await open(host);
  expect((await wireErrorOf(connection.request("approval.respond", PARAMS))).code).toBe(5003);
  await connection.close();
});

test("approval.list returns what the port read and maps its failures", async () => {
  const position = { storeId: FAKE_STORE_ID, seq: 4 };
  const host = createFakeHost({
    overrides: { approvals: { list: () => Promise.resolve(ok({ approvals: [], position })) } },
  });
  const threadId = host.fake.seedThread();
  const connection = await open(host);
  expect(await connection.request("approval.list", { threadId })).toEqual({
    approvals: [],
    position,
  });
  await connection.close();

  const failing = createFakeHost({
    overrides: {
      approvals: {
        list: (id) => Promise.resolve(err({ kind: "thread_not_found", threadId: id })),
      },
    },
  });
  const other = await open(failing);
  const error = await wireErrorOf(
    other.request("approval.list", { threadId: failing.fake.ids.next("thr") }),
  );
  expect(error.code).toBe(3001);
  await other.close();
});
