import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.6, §4.8: 테스트 대화(Craft)의 wire. `craftChat.open`·`craftChat.list`, 표지가 있는 대화의 목록 제외,
// 숨은 `craft` 프로필의 보호. 저장소와 엔진은 가짜다. 프로필 저장은 실제 프로필 포트가 한다.

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

async function connect(configDir?: string): Promise<ReturnType<FakeHost["connect"]>["connection"]> {
  const host = createFakeHost(configDir === undefined ? {} : { profiles: { configDir } });
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

test("craftChat.open with plugin null makes an unbound craft thread on the craft profile, hidden from the default list", async () => {
  const connection = await connect();
  const opened = await connection.request("craftChat.open", { plugin: null });
  expect(opened).toMatchObject({ plugin: null, reused: false });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  const listed = await connection.request("thread.list", { include: "craft" });
  expect(
    listed.threads.map((thread) => [thread.threadId, thread.profileId, thread.craftChat]),
  ).toEqual([[opened.threadId, "craft", { plugin: null }]]);
  await connection.close();
});

test("craftChat.open reuses the newest craft thread of the plugin with reuse last, and creates one with reuse new", async () => {
  const connection = await connect();
  const first = await connection.request("craftChat.open", { plugin: "notes" });
  expect(first.reused).toBe(false);
  // `reuse`를 생략하면 새로 만든다. 같은 플러그인의 두 번째 대화도 새로 만들어진다
  const second = await connection.request("craftChat.open", { plugin: "notes", reuse: "new" });
  expect(second).toMatchObject({ plugin: "notes", reused: false });
  expect(second.threadId).not.toBe(first.threadId);
  // `last`는 가장 최근 것(두 번째)을 다시 연다. 새로 만들지 않는다
  const again = await connection.request("craftChat.open", { plugin: "notes", reuse: "last" });
  expect(again).toEqual({ threadId: second.threadId, plugin: "notes", reused: true });
  // 묶이지 않은 대화는 다른 플러그인의 `last`로 열리지 않는다
  const unbound = await connection.request("craftChat.open", { plugin: null, reuse: "last" });
  expect(unbound.reused).toBe(false);
  expect(unbound.threadId).not.toBe(second.threadId);
  await connection.close();
});

test("craftChat.list returns one plugin's craft threads newest first, and plugin null returns only the unbound ones", async () => {
  const connection = await connect();
  const older = await connection.request("craftChat.open", { plugin: "notes" });
  const newer = await connection.request("craftChat.open", { plugin: "notes", reuse: "new" });
  const other = await connection.request("craftChat.open", { plugin: "tasks" });
  const unbound = await connection.request("craftChat.open", { plugin: null });
  expect(
    (await connection.request("craftChat.list", { plugin: "notes" })).threads.map(
      (thread) => thread.threadId,
    ),
  ).toEqual([newer.threadId, older.threadId]);
  expect(
    (await connection.request("craftChat.list", { plugin: "tasks" })).threads.map(
      (thread) => thread.threadId,
    ),
  ).toEqual([other.threadId]);
  expect(
    (await connection.request("craftChat.list", { plugin: null })).threads.map(
      (thread) => thread.threadId,
    ),
  ).toEqual([unbound.threadId]);
  await connection.close();
});

test("a craft thread refuses a profile change, and the craft profile is not a choice for an ordinary thread", async () => {
  const connection = await connect();
  const craft = await connection.request("craftChat.open", { plugin: null });
  expect(
    await failureOf(
      connection.request("thread.setProfile", { threadId: craft.threadId, profileId: "default" }),
    ),
  ).toMatchObject({ data: { kind: "profile.builtinProtected" } });
  const plain = await connection.request("thread.create", {});
  expect(
    await failureOf(connection.request("thread.create", { profileId: "craft" })),
  ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "craft" } } });
  expect(
    await failureOf(
      connection.request("thread.setProfile", { threadId: plain.threadId, profileId: "craft" }),
    ),
  ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "craft" } } });
  await connection.close();
});

test("the craft profile is hidden from profile.list and protected from put, delete and clone", async () => {
  const connection = await connect();
  const listed = await connection.request("profile.list", {});
  expect(listed.profiles.map((profile) => profile.id)).toEqual(["default"]);
  expect(
    await failureOf(
      connection.request("profile.put", {
        profile: {
          id: "craft",
          title: "craft",
          plugins: [],
          settings: [],
          startDrive: null,
        },
        baseRev: null,
      }),
    ),
  ).toMatchObject({ data: { kind: "profile.builtinProtected", details: { id: "craft" } } });
  expect(await failureOf(connection.request("profile.delete", { id: "craft" }))).toMatchObject({
    data: { kind: "profile.builtinProtected", details: { id: "craft" } },
  });
  expect(
    await failureOf(
      connection.request("profile.clone", { id: "default", newId: "craft", title: "craft" }),
    ),
  ).toMatchObject({ data: { kind: "profile.builtinProtected", details: { id: "craft" } } });
  await connection.close();
});

test("craftChat.open takes the plugin's source folder as the workspace when it exists, and leaves the workspace unset when it does not", async () => {
  const dir = mkdtempSync(join(tmpdir(), "xh-craft-"));
  roots.push(dir);
  mkdirSync(join(dir, "plugins", "notes"), { recursive: true });
  const connection = await connect(dir);
  const withFolder = await connection.request("craftChat.open", { plugin: "notes" });
  const without = await connection.request("craftChat.open", { plugin: "no-such-folder" });
  const listed = await connection.request("thread.list", { include: "craft" });
  const workspaceOf = (threadId: string): string | null | undefined =>
    listed.threads.find((thread) => thread.threadId === threadId)?.workspace;
  expect(workspaceOf(withFolder.threadId)).toBe(realpathSync(join(dir, "plugins", "notes")));
  expect(workspaceOf(without.threadId)).toBeNull();
  await connection.close();
});

test("craftChat.open with context records one craft.context event per open, and the refs read back in order without repeats (M5c §4.8.8)", async () => {
  const host = createFakeHost({});
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const a = { kind: "plugin", name: "demo" } as const;
  const b = { kind: "turn", threadId: "thr_elsewhere", turnId: "turn_1" } as const;
  const c = { kind: "review", itemId: "rvw_1" } as const;
  const opened = await connection.request("craftChat.open", {
    plugin: null,
    intent: "고치기",
    context: [a, b],
  });
  // 같은 대화를 다시 연다(reuse last): 맥락이 있으면 새 사건이 하나 더 남는다
  const again = await connection.request("craftChat.open", {
    plugin: null,
    reuse: "last",
    context: [b, c],
  });
  expect(again).toMatchObject({ threadId: opened.threadId, reused: true });
  // 맥락도 의도도 없이 여는 것은 사건을 남기지 않는다
  await connection.request("craftChat.open", { plugin: null, reuse: "last" });
  const events = host.fake.events
    .filter((event) => event.kind === "craft.context" && event.threadId === opened.threadId)
    .map((event) => event.payload);
  expect(events).toEqual([
    { refs: [a, b], intent: "고치기" },
    { refs: [b, c], intent: null },
  ]);
  expect(await host.fake.engine.ports.craftChat.readContext(opened.threadId)).toEqual({
    ok: true,
    value: [a, b, c],
  });
  await connection.close();
});

test("craftChat.open with a context list longer than the limit is refused before any thread is made", async () => {
  const host = createFakeHost({});
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  const refs = Array.from({ length: 17 }, (_, index) => ({
    kind: "plugin" as const,
    name: `p${String(index)}`,
  }));
  const refused = await failureOf(
    connection.request("craftChat.open", { plugin: null, context: refs }),
  );
  expect(refused).toBeDefined();
  expect((await connection.request("thread.list", { include: "craft" })).threads).toEqual([]);
  await connection.close();
});
