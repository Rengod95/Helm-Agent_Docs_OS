import { expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import { WireError } from "@xeon/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { settleUntil } from "../fixtures/clock.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// 쓰기 소유가 필요한 일(`thread.rename`, `thread.delete`)이 소유를 쥐지 않았을 때 한 번 얻어 쓰고 놓는 규칙(HS-28, HS-73)과 소유 이어받기
// (M2 마감 재검토 결함 10). `holds`는 이 프로세스의 모든 처리기에게 같은 값이라, 빌린 잠금도 쥔 것으로 보인다. 같은 thread의 다른 연결이
// 그동안 `turn.start`로 소유를 이어받았으면 빌린 쪽이 놓아서는 안 된다. 잠금 획득을 붙잡는 가짜 엔진(`acquireGate`)으로 겹침을 만든다.

async function open(host: FakeHost) {
  const { connection, served } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return { connection, served };
}

function gate(): { readonly open: () => void; readonly promise: Promise<void> } {
  const waiter = Promise.withResolvers<void>();
  return { open: () => waiter.resolve(), promise: waiter.promise };
}

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

test("a rename that borrowed the lock does not release it when another connection took the ownership meanwhile", async () => {
  const acquire = gate();
  const host = createFakeHost({ acquireGate: acquire.promise });
  const threadId = host.fake.seedThread();
  const renamer = await open(host);
  const writer = await open(host);
  const renaming = renamer.connection.request("thread.rename", { threadId, title: "새 제목" });
  const starting = writer.connection.request("turn.start", { threadId, input: "hi" });
  // 두 요청이 모두 잠금을 기다리는 중이다
  await settleUntil(() => host.fake.acquisitions.length === 2);
  acquire.open();
  await renaming;
  await starting;
  expect(host.fake.titles.get(threadId)).toBe("새 제목");
  // 쓰는 연결이 있으니 잠금은 그 연결의 소유로 남는다
  expect(host.hub.state(writer.served.id)?.writeThreads.has(threadId)).toBe(true);
  expect(host.fake.held.has(threadId)).toBe(true);
  expect(host.fake.released).toEqual([]);
  await renamer.connection.close();
  await writer.connection.close();
});

test("two renames at once on a thread nobody holds give the lock back once, after the last one", async () => {
  const acquire = gate();
  const host = createFakeHost({ acquireGate: acquire.promise });
  const threadId = host.fake.seedThread();
  const first = await open(host);
  const second = await open(host);
  const one = first.connection.request("thread.rename", { threadId, title: "하나" });
  const two = second.connection.request("thread.rename", { threadId, title: "둘" });
  await settleUntil(() => host.fake.acquisitions.length === 2);
  acquire.open();
  await Promise.all([one, two]);
  expect(host.fake.released).toEqual([threadId]);
  expect(host.fake.held.has(threadId)).toBe(false);
  await first.connection.close();
  await second.connection.close();
});

test("a delete the store refuses does not release a lock another connection took meanwhile", async () => {
  const acquire = gate();
  const host = createFakeHost({
    acquireGate: acquire.promise,
    overrides: {
      threads: { remove: () => Promise.resolve(err({ kind: "has_forks", forks: [] })) },
    },
  });
  const threadId = host.fake.seedThread();
  const deleter = await open(host);
  const writer = await open(host);
  const deleting = wireErrorOf(deleter.connection.request("thread.delete", { threadId }));
  const starting = writer.connection.request("turn.start", { threadId, input: "hi" });
  await settleUntil(() => host.fake.acquisitions.length === 2);
  acquire.open();
  expect((await deleting).code).toBe(3004);
  await starting;
  expect(host.fake.held.has(threadId)).toBe(true);
  expect(host.fake.released).toEqual([]);
  await deleter.connection.close();
  await writer.connection.close();
});

test("a lock a rename borrowed is gone afterwards: the next turn.start takes the thread again", async () => {
  const host = createFakeHost();
  const threadId = host.fake.seedThread();
  const { connection, served } = await open(host);
  await connection.request("thread.rename", { threadId, title: "빌린 뒤" });
  expect(host.fake.held.has(threadId)).toBe(false);
  await connection.request("turn.start", { threadId, input: "hi" });
  expect(host.fake.held.has(threadId)).toBe(true);
  expect(host.fake.acquisitions).toHaveLength(2);
  expect(host.hub.state(served.id)?.writeThreads.has(threadId)).toBe(true);
  await connection.close();
});
