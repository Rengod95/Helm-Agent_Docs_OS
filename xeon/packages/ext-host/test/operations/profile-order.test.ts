// 대화 프로필의 플러그인 순서(E(T))가 훅 실행 순서를 정한다(F.operations §5.2 O-1, O-2, O-5). 실제 정책, 호스트, 디스패처를 쓴다.
import { expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { PluginSetPortKey, type ExtensionLayer } from "@fresnel/contracts/extensions";
import { hookOrderOf, type HookOrderMap } from "../../src/operations/index.ts";
import { extReadViewOf, type ExtensionUnit } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { makeUnit } from "../primitives/fixtures/support.ts";
import { createOperationsHarness } from "./support/harness.ts";

const TAP = "boundary.settle.after";

function unitOf(
  name: string,
  loadIndex: number,
  layer: ExtensionLayer,
  builtin: boolean,
  calls: string[],
): ExtensionUnit {
  return makeUnit({ name, loadIndex, layer, builtin, hooks: [TAP] }, (g) => {
    g.on(TAP, () => {
      calls.push(name);
    });
  });
}

async function rig() {
  const settings: { hookOrder?: HookOrderMap } = {};
  const { t, policy } = await createOperationsHarness({ settings });
  const state: { plugins: readonly string[] } = { plugins: [] };
  const registered = await t.host.registerPlatform({
    name: "test-plugin-set",
    setup(ctx) {
      ctx.providePort(PluginSetPortKey, {
        resolve: () => ({
          plugins: [...state.plugins],
          profileId: "p",
          profileRev: 1,
          commonRev: 0,
        }),
      });
    },
  });
  expect(registered.ok).toBe(true);
  const thread: ThreadId = t.newThread();
  await t.host.openThread(thread);
  const calls: string[] = [];
  const specs = [
    {
      name: "core-tools",
      source: "builtin",
      trust: "builtin",
      layer: "L1",
      essential: true,
      load: 0,
    },
    { name: "plug-a", source: "user", trust: "user", layer: "plugin", essential: false, load: 1 },
    { name: "plug-b", source: "builtin", trust: "builtin", layer: "L2", essential: false, load: 2 },
    {
      name: "plug-c",
      source: "project",
      trust: "project",
      layer: "plugin",
      essential: false,
      load: 3,
    },
  ] as const;
  await eachInOrder(specs, async (spec) => {
    const admitted = policy.admit(
      { name: spec.name, source: spec.source, trust: spec.trust, essential: spec.essential },
      spec.layer,
    );
    expect(admitted.ok).toBe(true);
    await t.host.install(
      unitOf(spec.name, spec.load, spec.layer, spec.source === "builtin", calls),
    );
    return "continue";
  });
  state.plugins = ["plug-a", "plug-b", "plug-c", "core-tools"];
  await t.settled();
  async function settle(): Promise<string[]> {
    calls.splice(0);
    const turnId = t.ids.next("trn");
    await t.host.dispatch(
      TAP,
      { turnId, aborted: false },
      { threadId: thread, dispatchKey: `${turnId}:${TAP}` },
    );
    return calls.splice(0);
  }
  return { t, state, settings, settle, thread };
}

test("profile order: the profile's plugin list decides the order within the plugin tier, the guard runs first", async () => {
  const r = await rig();
  expect(await r.settle()).toEqual(["core-tools", "plug-a", "plug-b", "plug-c"]);
  r.state.plugins = ["plug-c", "plug-a", "core-tools", "plug-b"];
  expect(await r.settle()).toEqual(["core-tools", "plug-c", "plug-a", "plug-b"]);
  r.state.plugins = ["plug-b", "plug-c", "plug-a"];
  expect(await r.settle()).toEqual(["core-tools", "plug-b", "plug-c", "plug-a"]);
});

test("profile order: the hookOrder override wins over the profile order; the read view takes a thread", async () => {
  const r = await rig();
  r.state.plugins = ["plug-c", "plug-b", "plug-a", "core-tools"];
  r.settings.hookOrder = hookOrderOf({ [TAP]: ["plug-a", "plug-b"] });
  await r.t.host.dispatch(
    "boundary.step.before",
    { stepIndex: 0, stepId: r.t.ids.next("stp"), timestamp: 0 },
    { threadId: r.thread, dispatchKey: "step-0" },
  );
  // 덮어쓰기에 든 둘은 자기들이 차지한 자리(c 뒤쪽 둘)에서 a, b 순으로 바뀐다
  expect(await r.settle()).toEqual(["core-tools", "plug-c", "plug-a", "plug-b"]);
  r.settings.hookOrder = new Map();
  const view = extReadViewOf(r.t.host);
  const names = (rows: ReturnType<typeof view.handlers>): string[] =>
    rows.filter((row) => row.point === TAP).map((row) => row.extension);
  expect(names(view.handlers(r.thread))).toEqual(["core-tools", "plug-c", "plug-a", "plug-b"]);
  expect(names(view.handlers())).toEqual(["core-tools", "plug-a", "plug-b", "plug-c"]);
});
