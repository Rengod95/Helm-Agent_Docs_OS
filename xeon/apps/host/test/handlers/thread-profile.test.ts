import { expect, test } from "bun:test";
import { WireError } from "@fresnel/contracts/wire";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4, §4.1.1: 대화는 프로필 id를 저장한다(thread.create, thread.setProfile). 목록은 저장한 값을 보이고, 프로필을 지우면
// 그 프로필을 참조하는 열린 대화 수를 알린다. 가짜 엔진 위의 실제 처리기다.

const REVIEW = { id: "review", title: "Review", plugins: [], settings: [], driver: null };

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

test("thread.create stores the chosen profile, and thread.list shows it", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  await connection.request("profile.put", { profile: REVIEW, baseRev: null });
  const created = await connection.request("thread.create", { profileId: "review" });
  expect(created.profileId).toBe("review");
  expect(host.fake.chosenProfiles.get(created.threadId)).toBe("review");
  const listed = await connection.request("thread.list", {});
  expect(listed.threads.map((thread) => thread.profileId)).toEqual(["review"]);
  await connection.close();
});

test("a thread created without a profile reads as default in the result and the list", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const created = await connection.request("thread.create", {});
  expect(created.profileId).toBe("default");
  expect(host.fake.chosenProfiles.has(created.threadId)).toBe(false);
  const listed = await connection.request("thread.list", {});
  expect(listed.threads.map((thread) => thread.profileId)).toEqual(["default"]);
  await connection.close();
});

test("thread.create with a profile that does not exist is refused and leaves no thread", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const before = host.fake.events.length;
  const error = await wireErrorOf(connection.request("thread.create", { profileId: "ghost" }));
  expect(error.data).toMatchObject({ kind: "profile.notFound" });
  expect(host.fake.events.length).toBe(before);
  const listed = await connection.request("thread.list", {});
  expect(listed.threads).toEqual([]);
  await connection.close();
});

test("the owner switches the profile of a thread, and the list shows the new value", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  await connection.request("profile.put", { profile: REVIEW, baseRev: null });
  const created = await connection.request("thread.create", {});
  const switched = await connection.request("thread.setProfile", {
    threadId: created.threadId,
    profileId: "review",
  });
  expect(switched.position.seq).toBe(host.fake.events.length);
  expect(host.fake.chosenProfiles.get(created.threadId)).toBe("review");
  expect((await connection.request("thread.list", {})).threads.map((t) => t.profileId)).toEqual([
    "review",
  ]);
  await connection.request("thread.setProfile", {
    threadId: created.threadId,
    profileId: "default",
  });
  expect((await connection.request("thread.list", {})).threads.map((t) => t.profileId)).toEqual([
    "default",
  ]);
  await connection.close();
});

test("thread.setProfile to a profile that does not exist keeps the thread's profile", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  await connection.request("profile.put", { profile: REVIEW, baseRev: null });
  const created = await connection.request("thread.create", { profileId: "review" });
  const before = host.fake.events.length;
  const error = await wireErrorOf(
    connection.request("thread.setProfile", { threadId: created.threadId, profileId: "ghost" }),
  );
  expect(error.data).toMatchObject({ kind: "profile.notFound" });
  expect(host.fake.events.length).toBe(before);
  expect(host.fake.chosenProfiles.get(created.threadId)).toBe("review");
  await connection.close();
});

test("profile.delete reports how many open threads referenced the profile", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  await connection.request("profile.put", { profile: REVIEW, baseRev: null });
  await connection.request("thread.create", { profileId: "review" });
  await connection.request("thread.create", { profileId: "review" });
  // 세 번째 대화는 프로필을 주지 않았다. 기본 값은 같은 폴더의 가장 최근 대화(review)다(review m5 §4.4.8)
  await connection.request("thread.create", {});
  expect(await connection.request("profile.delete", { id: "review" })).toMatchObject({
    reassignedThreads: 3,
  });
  await connection.close();
});
