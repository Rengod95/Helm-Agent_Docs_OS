// 실제 ext-host의 hostOf(g).callContext()를 쓰는 delegate 시험. 호출 문맥만 대역이 아니다(X.primitives.spec §3.8)
import { expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { createTestHost } from "@xeon/ext-host/testing";
import { AgentServicePortKey } from "@xeon/contracts/services";
import { defineGroup, type GroupApi } from "../src/index.ts";
import { fakeAgents } from "../src/testing/index.ts";
import { installInjected } from "./support/injected-group.ts";
import { groupManifestOf } from "./support/manifests.ts";
import { fireSettled } from "./support/host.ts";

const SPEC = { agent: "a", task: "t" } as const;

async function rig(name: string, kind: "on" | "drive") {
  const t = await createTestHost();
  const thread = t.newThread();
  const agents = fakeAgents({ ids: t.ids });
  const seen: { results: unknown[] } = { results: [] };
  const manifest =
    kind === "on"
      ? groupManifestOf({ name, points: ["boundary.settle.after"] })
      : groupManifestOf({ name, usesDrive: true });
  const g = await installInjected(
    t,
    manifest,
    () => ({ agents: () => agents }),
    (api: GroupApi<never>) => {
      const run = async (): Promise<void> => {
        seen.results.push(
          await api.delegate({ ...SPEC, requestId: `${name}:1` }),
          api.delegateStatus(`${name}:1`),
          await api.cancelDelegates(),
        );
      };
      if (kind === "on") api.on("boundary.settle.after", run);
      else api.drive(run);
    },
  );
  return { t, thread, agents, g, seen };
}

test("real-host.delegate-in-on-takes-the-thread-and-signal-from-the-context", async () => {
  const { t, thread, agents, seen } = await rig("rh-on", "on");
  await t.host.openThread(thread);
  await fireSettled(t, thread, "k");
  expect(agents.delegated).toHaveLength(1);
  expect(agents.delegated[0]?.origin.parentThreadId).toBe(thread);
  expect(agents.delegated[0]?.origin.signal.aborted).toBe(false);
  expect(seen.results[0]).toMatchObject({ ok: true, receipt: { status: "accepted" } });
  // on 핸들러 안에서 delegateStatus와 cancelDelegates는 거부된다
  expect(seen.results[1]).toEqual({
    ok: false,
    error: { kind: "group.effectNotAllowed", effect: "g.delegateStatus", context: "on" },
  });
  expect(seen.results[2]).toEqual({
    ok: false,
    error: { kind: "group.effectNotAllowed", effect: "g.cancelDelegates", context: "on" },
  });
  expect(agents.cancels).toEqual([]);
});

test("real-host.delegate-in-drive-takes-the-thread-from-the-context", async () => {
  const { t, thread, agents, seen } = await rig("rh-drive", "drive");
  await t.host.openThread(thread);
  await t.settled();
  expect(agents.delegated[0]?.origin.parentThreadId).toBe(thread);
  expect(seen.results[0]).toMatchObject({ ok: true, receipt: { status: "accepted" } });
  // drive 안에서 delegateStatus는 읽을 수 있고 cancelDelegates는 거부된다
  expect(seen.results[1]).toMatchObject({ ok: true, status: { state: "running" } });
  expect(seen.results[2]).toEqual({
    ok: false,
    error: { kind: "group.effectNotAllowed", effect: "g.cancelDelegates", context: "drive" },
  });
  expect(agents.cancels).toEqual([]);
});

test("real-host.outside-on-and-drive-needs-an-explicit-thread", async () => {
  const { t, thread, agents, g } = await rig("rh-cmd", "on");
  await t.host.openThread(thread);
  const spec = { ...SPEC, requestId: "rh-cmd:1" };
  expect(await g.delegate(spec)).toEqual({
    ok: false,
    error: { kind: "group.delegateUnavailable" },
  });
  const abort = new AbortController();
  const given: ThreadId = thread;
  const done = await g.delegate(spec, { threadId: given, signal: abort.signal });
  expect(done).toMatchObject({ ok: true, receipt: { status: "accepted" } });
  expect(agents.delegated[0]?.origin.signal).toBe(abort.signal);
  expect(await g.cancelDelegates()).toEqual({ ok: true, cancelled: true });
});

test("real-host.cancel-delegates-works-inside-on-dispose-after-the-generation-closed", async () => {
  const t = await createTestHost();
  const agents = fakeAgents({ ids: t.ids });
  await t.host.registerPlatform({
    name: "real-agents",
    setup(ctx) {
      ctx.providePort(AgentServicePortKey, agents);
    },
  });
  const results: unknown[] = [];
  const module = defineGroup({
    manifest: groupManifestOf({ name: "rh-dispose" }),
    setup(g) {
      g.onDispose(async () => {
        results.push(await g.cancelDelegates("group_disabled"));
      });
    },
  });
  await t.host.install({
    manifest: module.manifest,
    entry: module.entry,
    loadIndex: 0,
    builtin: true,
  });
  await t.host.uninstall("rh-dispose");
  // onDispose는 scope의 generation이 닫힌 뒤에 돈다. 포트를 다시 조회하지 않고 setup에서 잡아 둔 서비스로 취소한다
  expect(results).toEqual([{ ok: true, cancelled: false }]);
  expect(agents.cancels).toEqual([
    { target: { ownerScopeId: "rh-dispose" }, reason: "group_disabled" },
  ]);
  expect(t.diagnostics.filter((entry) => entry.level === "error")).toEqual([]);
});
