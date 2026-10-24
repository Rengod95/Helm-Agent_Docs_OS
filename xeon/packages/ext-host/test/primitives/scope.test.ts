import { expect, test } from "bun:test";
import type { ScopeApi } from "@xeon/contracts/extensions";
import { hostInternalsOf, PrimitiveError } from "../../src/primitives/index.ts";
import { createTestHost, memoryRecordStore } from "../../src/testing/index.ts";
import { makeGroupUnit, makeUnit } from "./fixtures/support.ts";

const toolCall = { toolCallId: "call_1", toolName: "read", input: { path: "a" } };

test("disable applies at step boundary", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const order: string[] = [];
  const handlerCalls: string[] = [];
  await t.host.install(
    makeGroupUnit({ name: "scp-group", points: ["tool_call"] }, (g) => {
      g.on("tool_call", () => {
        handlerCalls.push("tool_call");
        return undefined;
      });
      g.onDispose(() => {
        order.push("onDispose-1");
      });
      g.onDispose(() => {
        order.push("onDispose-2");
      });
      g.drive(async (loop) => {
        await loop.turn({ input: { kind: "user", content: "go" } });
      });
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.scopes()[0]?.drive).toBe("holding");

  // 사용자 turn이 도는 중에 끄기를 요청한다
  t.loop.setRunning(thread, true);
  t.host.scope("scp-group")?.disable();
  expect(t.host.scope("scp-group")?.status).toBe("disabling");
  await t.settled();
  // 아직 경계 전이다: 핸들러는 계속 실행되고 켜짐 기록도 그대로다
  await t.host.dispatch("tool_call", toolCall, { threadId: thread, dispatchKey: "before" });
  expect(handlerCalls).toEqual(["tool_call"]);
  expect(order).toEqual([]);

  const signal = { threadId: thread, kind: "step_end" as const };
  const contribution = await t.host.boundary.prepare(signal);
  // 적용 순서: 핸들러 제외 → lease.released → scope.changed → (settle) onDispose
  expect(contribution.drafts.map((draft) => draft.kind)).toEqual([
    "lease.released",
    "scope.changed",
  ]);
  expect(contribution.drafts[0]?.payload).toMatchObject({ reason: "disabled" });
  expect(contribution.drafts[1]?.payload).toMatchObject({
    scopeId: "scp-group",
    status: "disabled",
  });
  await t.host.dispatch("tool_call", toolCall, { threadId: thread, dispatchKey: "after" });
  expect(handlerCalls).toEqual(["tool_call"]);
  expect(order).toEqual([]);
  await t.records.commit({
    threadId: thread,
    requestId: "boundary-1",
    drafts: contribution.drafts,
  });
  await t.host.boundary.settle(signal, "committed");
  expect(order).toEqual(["onDispose-2", "onDispose-1"]);
  expect(t.host.scope("scp-group")?.status).toBe("disabled");
  expect(hostInternalsOf(t.host).core.registry.size()).toBe(0);
});

test("enable while idle", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const handlerCalls: string[] = [];
  const outcome = await t.host.install(
    makeUnit({ name: "scp-idle", points: ["tool_call"], initialEnabled: false }, (g) => {
      g.on("tool_call", () => {
        handlerCalls.push("x");
        return undefined;
      });
    }),
  );
  expect(outcome.setups[0]?.status).toBe("skipped");
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.scope("scp-idle")?.status).toBe("disabled");
  t.host.scope("scp-idle")?.enable();
  expect(t.host.scope("scp-idle")?.status).toBe("enabling");
  await t.settled();
  expect(t.host.scope("scp-idle")?.status).toBe("enabled");
  const changed = t.records.events(thread).filter((event) => event.kind === "scope.changed");
  expect(changed.map((event) => event.payload)).toEqual([
    { scopeId: "scp-idle", status: "enabled" },
  ]);
  await t.host.dispatch("tool_call", toolCall, { threadId: thread, dispatchKey: "k" });
  expect(handlerCalls).toEqual(["x"]);
});

test("dispose releases registrations", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "scp-dispose", points: ["tool_call", "turn_end"] }, (g) => {
      g.on("tool_call", () => undefined);
      g.on("turn_end", () => undefined);
    }),
  );
  await t.settled();
  const registry = hostInternalsOf(t.host).core.registry;
  expect(registry.size()).toBe(2);
  t.host.scope("scp-dispose")?.disable();
  await t.settled();
  expect(registry.size()).toBe(0);
  expect(t.host.scope("scp-dispose")?.status).toBe("disabled");
});

test("stale generation rejected", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  let captured: ScopeApi<never> | undefined;
  await t.host.install(
    makeUnit({ name: "scp-stale", points: ["tool_call"] }, (g) => {
      captured = g;
    }),
  );
  await t.settled();
  t.host.scope("scp-stale")?.disable();
  await t.settled();
  let code: string | undefined;
  try {
    captured?.on("tool_call", () => undefined);
  } catch (error) {
    code = error instanceof PrimitiveError ? error.code : undefined;
  }
  expect(code).toBe("scope_inactive");
  // 다시 켜면 새 세대가 열리고 옛 g는 여전히 닫혀 있다
  t.host.scope("scp-stale")?.enable();
  await t.settled();
  expect(t.host.scopes()[0]).toMatchObject({ status: "enabled", generation: 2 });
});

test("onDispose runs in reverse order and survives a throwing function", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  const order: string[] = [];
  await t.host.install(
    makeUnit({ name: "scp-order" }, (g) => {
      g.onDispose(() => {
        order.push("first");
      });
      g.onDispose(() => {
        order.push("second");
        throw new Error("cleanup failed");
      });
      g.onDispose(() => {
        order.push("third");
      });
    }),
  );
  await t.settled();
  t.host.scope("scp-order")?.disable();
  await t.settled();
  expect(order).toEqual(["third", "second", "first"]);
});

test("last toggle request wins and a cancelled disable keeps the scope", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "scp-flip", points: ["tool_call"] }, (g) => {
      g.on("tool_call", () => undefined);
    }),
  );
  await t.settled();
  t.loop.setRunning(thread, true);
  const handle = t.host.scope("scp-flip");
  handle?.disable();
  expect(handle?.status).toBe("disabling");
  handle?.enable();
  expect(handle?.status).toBe("enabled");
  const drafts = await t.boundary(thread).stepEnd();
  // 끄기는 취소되었으므로 닫지 않는다. 시작 적용으로 켜진 상태는 install 직후의 유휴 적용에서 이미 기록되었다
  expect(drafts).toEqual([]);
  expect(t.records.events(thread).map((event) => event.payload)).toEqual([
    { scopeId: "scp-flip", status: "enabled" },
  ]);
  expect(handle?.status).toBe("enabled");
  expect(hostInternalsOf(t.host).core.registry.size()).toBe(1);
});

test("a failed commit rolls back the toggle and retries at the next boundary", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const disposed: string[] = [];
  await t.host.openThread(thread);
  await t.host.install(
    makeUnit({ name: "scp-retry", points: ["tool_call"] }, (g) => {
      g.on("tool_call", () => undefined);
      g.onDispose(() => {
        disposed.push("gen");
      });
    }),
  );
  await t.settled();
  t.loop.setRunning(thread, true);
  t.host.scope("scp-retry")?.disable();
  await t.boundary(thread).stepEnd({ fail: true });
  // 되돌려져 핸들러가 다시 열린다. 정리는 하지 않았다
  expect(disposed).toEqual([]);
  expect(hostInternalsOf(t.host).core.registry.size()).toBe(1);
  expect(t.host.scope("scp-retry")?.status).toBe("disabling");
  await t.boundary(thread).stepEnd();
  expect(disposed).toEqual(["gen"]);
  expect(t.host.scope("scp-retry")?.status).toBe("disabled");
});

test("sub-scope ids and duplicates", async () => {
  const t = await createTestHost();
  const codes: string[] = [];
  const outcome = await t.host.install({
    ...makeUnit({ name: "scp-multi" }, () => {}),
    entry: ({ scope }) => {
      scope("scp-multi", {}, () => {});
      scope("scp-multi/review", {}, () => {});
      for (const id of ["other-ext", "scp-multi"]) {
        try {
          scope(id, {}, () => {});
        } catch (error) {
          if (error instanceof PrimitiveError) codes.push(error.code);
        }
      }
    },
  });
  expect(outcome.scopes).toEqual(["scp-multi", "scp-multi/review"]);
  expect(codes).toEqual(["scope_foreign_id", "scope_duplicate"]);
  // 하위 scope의 기본값은 꺼짐이다
  expect(outcome.setups.map((setup) => setup.status)).toEqual(["applied", "skipped"]);
});

test("idle application commits under a key derived from committed values, so a retry after a lost reply is replayed", async () => {
  const base = memoryRecordStore();
  const keys: string[] = [];
  let lostReplies = 1;
  const flaky = Object.assign(Object.create(base), {
    async commit(request: Parameters<typeof base.commit>[0]) {
      keys.push(request.requestId);
      const result = await base.commit(request);
      // 저장은 됐지만 응답이 사라진 것으로 보인다
      if (lostReplies > 0 && result.status === "committed") {
        lostReplies -= 1;
        return { status: "rejected", code: "busy" } as const;
      }
      return result;
    },
  });
  const t = await createTestHost({ shared: { records: flaky } });
  const thread = t.newThread();
  await t.host.install(
    makeUnit({ name: "scp-key", points: ["tool_call"], initialEnabled: false }, (g) => {
      g.on("tool_call", () => undefined);
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  t.host.scope("scp-key")?.enable();
  await t.settled();
  // 첫 적용은 응답을 잃어 실패로 정산됐다. 다시 적용하면 같은 키라 기록된 결과를 받고 이벤트가 겹치지 않는다
  t.host.scope("scp-key")?.enable();
  await t.settled();
  const changed = base.events(thread).filter((event) => event.kind === "scope.changed");
  expect(changed).toHaveLength(1);
  expect(keys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(keys).size).toBe(1);
  expect(keys[0]).toBe("scope:scp-key:1:enabled");
  expect(t.host.scope("scp-key")?.status).toBe("enabled");
});

const restartUnitOf = () =>
  makeUnit({ name: "scp-restart", points: ["tool_call"], initialEnabled: false }, (g) => {
    g.on("tool_call", () => undefined);
  });

test("re-enabling a scope after a restart is not swallowed by a commit key an earlier run already used", async () => {
  const unitOf = restartUnitOf;
  const first = await createTestHost();
  const thread = first.newThread();
  await first.host.install(unitOf());
  await first.host.openThread(thread);
  await first.settled();
  first.host.scope("scp-restart")?.enable();
  await first.settled();
  first.host.scope("scp-restart")?.disable();
  await first.settled();

  // 재시작: 세대 번호는 다시 세지만 전이 횟수는 스냅샷(scopeTransitions)에서 이어받아 이전 실행의 키와 겹치지 않는다
  const second = await createTestHost({
    shared: { records: first.records, loop: first.loop, queue: first.queue },
  });
  await second.host.install(unitOf());
  await second.host.openThread(thread);
  await second.settled();
  second.host.scope("scp-restart")?.enable();
  await second.settled();
  const changed = second.records
    .events(thread)
    .filter((event) => event.kind === "scope.changed")
    .map((event) => event.payload);
  expect(changed).toEqual([
    { scopeId: "scp-restart", status: "enabled" },
    { scopeId: "scp-restart", status: "disabled" },
    { scopeId: "scp-restart", status: "enabled" },
  ]);
  const snapshot = await second.records.loadThread(thread);
  expect(snapshot.enabled).toEqual(["scp-restart"]);
  expect(snapshot.scopeTransitions).toEqual({ "scp-restart": 3 });
  // 이전 실행이 이미 쓴 키를 다시 만나 재생으로 돌려받는 일(재시도)이 없다: 커밋은 한 번에 통과했다
  expect(second.records.commitCalls).toBe(first.records.commitCalls);
});
