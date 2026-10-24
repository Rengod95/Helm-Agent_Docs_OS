import { expect, test } from "bun:test";
import { makeDraft } from "../../src/primitives/drafts.ts";
import { hostInternalsOf, scopeToggleSourceOf } from "../../src/primitives/index.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeGroupUnit, makeUnit } from "./fixtures/support.ts";

type Host = Awaited<ReturnType<typeof createTestHost>>;

async function fire(t: Host, thread: ReturnType<Host["newThread"]>, key: string): Promise<void> {
  await t.host.dispatch(
    "agent_settled",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: key },
  );
}

function changes(t: Host, thread: ReturnType<Host["newThread"]>): readonly unknown[] {
  return t.records
    .events(thread)
    .filter((e) => e.kind === "scope.changed")
    .map((e) => e.payload);
}

test("a scope turned off in one thread keeps running in the other", async () => {
  const t = await createTestHost();
  const a = t.newThread();
  const b = t.newThread();
  const seen: string[] = [];
  const disposed: string[] = [];
  await t.host.install(
    makeUnit({ name: "ts-one", points: ["agent_settled"] }, (g) => {
      g.on("agent_settled", (_payload, ctx) => {
        seen.push(ctx.threadId);
      });
      g.onDispose(() => {
        disposed.push("gen");
      });
    }),
  );
  await t.host.openThread(a);
  await t.host.openThread(b);
  await t.settled();
  scopeToggleSourceOf(t.host).request("ts-one", false, "request", a);
  await t.settled();

  await fire(t, a, "k-a");
  await fire(t, b, "k-b");
  expect(seen).toEqual([b]);
  // 한 thread가 아직 쓰므로 세대는 그대로다
  expect(disposed).toEqual([]);
  expect(t.host.scopes()[0]).toMatchObject({ status: "enabled", generation: 1 });
  expect(changes(t, a)).toEqual([
    { scopeId: "ts-one", status: "enabled" },
    { scopeId: "ts-one", status: "disabled" },
  ]);
  expect(changes(t, b)).toEqual([{ scopeId: "ts-one", status: "enabled" }]);

  // 마지막 thread에서도 끄면 세대가 해제된다
  scopeToggleSourceOf(t.host).request("ts-one", false, "request", b);
  await t.settled();
  expect(disposed).toEqual(["gen"]);
  expect(hostInternalsOf(t.host).core.registry.size()).toBe(0);
  expect(t.host.scopes()[0]).toMatchObject({ status: "disabled" });
});

test("a thread can turn on a scope that is off by default, without touching the others", async () => {
  const t = await createTestHost();
  const a = t.newThread();
  const b = t.newThread();
  const seen: string[] = [];
  await t.host.install(
    makeUnit({ name: "ts-opt", points: ["agent_settled"], initialEnabled: false }, (g) => {
      g.on("agent_settled", (_payload, ctx) => {
        seen.push(ctx.threadId);
      });
    }),
  );
  await t.host.openThread(a);
  await t.host.openThread(b);
  await t.settled();
  scopeToggleSourceOf(t.host).request("ts-opt", true, "request", a);
  await t.settled();
  await fire(t, a, "k1");
  await fire(t, b, "k2");
  expect(seen).toEqual([a]);
  expect(changes(t, a)).toEqual([{ scopeId: "ts-opt", status: "enabled" }]);
  expect(changes(t, b)).toEqual([]);

  // B도 켜면 같은 세대를 쓴다(setup이 다시 실행되지 않는다)
  scopeToggleSourceOf(t.host).request("ts-opt", true, "request", b);
  await t.settled();
  await fire(t, b, "k3");
  expect(seen).toEqual([a, b]);
  expect(t.host.scopes()[0]).toMatchObject({ generation: 1 });
});

test("a whole-scope request replaces the per-thread requests and applies to new threads", async () => {
  const t = await createTestHost();
  const a = t.newThread();
  const seen: string[] = [];
  await t.host.install(
    makeUnit({ name: "ts-all", points: ["agent_settled"] }, (g) => {
      g.on("agent_settled", (_payload, ctx) => {
        seen.push(ctx.threadId);
      });
    }),
  );
  await t.host.openThread(a);
  await t.settled();
  scopeToggleSourceOf(t.host).request("ts-all", false, "request", a);
  await t.settled();
  await fire(t, a, "k1");
  expect(seen).toEqual([]);
  // 전체 켜기는 thread별 끄기 요청을 지운다
  t.host.scope("ts-all")?.enable();
  await t.settled();
  await fire(t, a, "k2");
  expect(seen).toEqual([a]);
  // 전체 끄기 뒤에 연 thread는 꺼진 상태로 시작한다
  t.host.scope("ts-all")?.disable();
  await t.settled();
  const b = t.newThread();
  await t.host.openThread(b);
  await t.settled();
  await fire(t, b, "k3");
  await fire(t, a, "k4");
  expect(seen).toEqual([a]);
  expect(t.host.scopes()[0]).toMatchObject({ status: "disabled" });
});

test("turning a scope off in one thread releases only that thread's lease", async () => {
  const t = await createTestHost();
  const a = t.newThread();
  const b = t.newThread();
  await t.host.install(
    makeGroupUnit({ name: "ts-group" }, (g) => {
      g.drive(async (loop) => {
        await loop.turn({ input: { kind: "user", content: "go" } });
      });
    }),
  );
  await t.host.openThread(a);
  await t.host.openThread(b);
  await t.settled();
  expect(t.host.leaseOf(a)).toMatchObject({ scopeId: "ts-group", status: "active" });
  expect(t.host.leaseOf(b)).toMatchObject({ scopeId: "ts-group", status: "active" });
  scopeToggleSourceOf(t.host).request("ts-group", false, "request", a);
  await t.settled();
  expect(t.host.leaseOf(a)).toBeNull();
  expect(t.host.leaseOf(b)).not.toBeNull();
  const released = t.records.events(a).filter((e) => e.kind === "lease.released");
  expect(released.map((e) => e.payload)).toMatchObject([{ reason: "disabled" }]);
  expect(t.records.events(b).filter((e) => e.kind === "lease.released")).toEqual([]);
});

const reopenUnit = () => makeUnit({ name: "ts-reopen", points: ["agent_settled"] }, () => {});

test("reopening a thread does not write scope.changed again for scopes it already recorded", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.install(reopenUnit());
  await first.host.openThread(thread);
  await first.settled();
  expect(changes(first, thread)).toHaveLength(1);
  // 같은 호스트에서 닫았다 다시 연다
  await first.host.closeThread(thread);
  await first.host.openThread(thread);
  await first.settled();
  expect(changes(first, thread)).toHaveLength(1);
  // 프로세스를 다시 시작해도 같다
  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  await second.host.install(reopenUnit());
  await second.host.openThread(thread);
  await second.settled();
  expect(changes(second, thread)).toHaveLength(1);
});

test("a default-enabled scope turned off in a thread stays off after reopening and after a restart", async () => {
  const first = await createTestHost();
  const a = first.newThread();
  const b = first.newThread();
  const seen: string[] = [];
  const unitOf = () =>
    makeUnit({ name: "ts-off", points: ["agent_settled"] }, (g) => {
      g.on("agent_settled", (_payload, ctx) => {
        seen.push(ctx.threadId);
      });
    });
  await first.host.install(unitOf());
  await first.host.openThread(a);
  await first.host.openThread(b);
  await first.settled();
  scopeToggleSourceOf(first.host).request("ts-off", false, "request", a);
  await first.settled();
  expect((await first.records.loadThread(a)).disabled).toEqual(["ts-off"]);
  expect((await first.records.loadThread(a)).enabled).toEqual([]);

  // 같은 호스트에서 닫았다 다시 연다
  await first.host.closeThread(a);
  await first.host.openThread(a);
  await first.settled();
  await fire(first, a, "k-reopen-a");
  await fire(first, b, "k-reopen-b");
  expect(seen).toEqual([b]);
  expect(changes(first, a)).toHaveLength(2);

  // 프로세스를 다시 시작해도 같다
  seen.length = 0;
  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  await second.host.install(unitOf());
  await second.host.openThread(a);
  await second.host.openThread(b);
  await second.settled();
  await fire(second, a, "k-restart-a");
  await fire(second, b, "k-restart-b");
  expect(seen).toEqual([b]);
  expect(changes(second, a)).toHaveLength(2);
  expect(changes(second, b)).toHaveLength(1);

  // 끈 thread에서 다시 켜면 새 키로 기록된다
  scopeToggleSourceOf(second.host).request("ts-off", true, "request", a);
  await second.settled();
  expect(changes(second, a).at(-1)).toEqual({ scopeId: "ts-off", status: "enabled" });
  expect((await second.records.loadThread(a)).scopeTransitions["ts-off"]).toBe(3);
  // 재시작한 호스트가 낸 이벤트 id는 이전 호스트의 것과 겹치지 않는다
  const eventIds = second.records.events(a).map((draft) => draft.id);
  expect(new Set(eventIds).size).toBe(eventIds.length);
});

test("the in-memory record store rejects a draft whose id is already stored instead of looping on a cyclic branch", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const draft = makeDraft(t.ids, {
    threadId: thread,
    kind: "scope.changed",
    payload: { scopeId: "dup", status: "enabled" },
  });
  const first = await t.records.commit({ threadId: thread, requestId: "dup-1", drafts: [draft] });
  expect(first.status).toBe("committed");
  const second = await t.records.commit({ threadId: thread, requestId: "dup-2", drafts: [draft] });
  expect(second).toEqual({ status: "rejected", code: "invalid" });
  expect((await t.records.loadThread(thread)).enabled).toEqual(["dup"]);
});

test("onChange reports toggle requests, their application and lease changes; a throwing listener does not stop the others", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.install(
    makeGroupUnit({ name: "ts-notify" }, (g) => {
      g.drive(() => Promise.resolve());
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  const seen: string[] = [];
  t.host.onChange(() => {
    throw new Error("listener failure");
  });
  const off = t.host.onChange((change) => {
    seen.push(`${change.kind}:${change.scopeId}:${change.threadId ?? "all"}`);
  });
  t.host.scope("ts-notify")?.disable();
  // 요청은 곧바로 알린다(상태줄의 "다음 단계 경계에 적용")
  expect(seen).toEqual(["scope:ts-notify:all"]);
  await t.settled();
  expect(seen).toContain(`lease:ts-notify:${thread}`);
  expect(seen).toContain(`scope:ts-notify:${thread}`);
  expect(t.diagnostics.some((d) => d.message.includes("onChange listener threw"))).toBe(true);
  off();
  const before = seen.length;
  t.host.scope("ts-notify")?.enable();
  await t.settled();
  expect(seen).toHaveLength(before);
});

test("restart gives a new host over the same stores", async () => {
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.install(makeUnit({ name: "ts-restart" }, () => {}));
  await first.host.openThread(thread);
  await first.settled();
  const second = await first.restart();
  expect(second.records).toBe(first.records);
  expect(second.host).not.toBe(first.host);
  await second.host.install(makeUnit({ name: "ts-restart" }, () => {}));
  await second.host.openThread(thread);
  await second.settled();
  expect(
    second.records.events(thread).filter((event) => event.kind === "scope.changed"),
  ).toHaveLength(1);
});
