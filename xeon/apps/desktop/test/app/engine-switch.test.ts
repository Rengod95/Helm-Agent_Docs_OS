import { describe, expect, test } from "bun:test";
import { evt, thr } from "../state/helpers.ts";
import { fakeIpc } from "../transport/fake-ipc.ts";
import { engineFake, makeApp, until } from "./support.ts";
import type { EngineState } from "../../src/transport/ipc.ts";

// 엔진 대상을 바꾸는 동안(W-08) 쓰기를 보류한다. 옛 엔진은 shutdownGraceMs까지 쓰기를 받을 수 있어서다.

const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
const STOPPING: EngineState = { kind: "stopping" };

async function ready() {
  // 두 번째 attach부터는 내려간 엔진을 돌려준다. 엔진 상태가 내려가면 연결 수명이 새로 attach한다
  const { fake } = engineFake([], (n) => (n === 1 ? RUNNING : STOPPING));
  const app = makeApp(fake);
  await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
  return { fake, app };
}

describe("engine retarget holds writes", () => {
  test("writes are rejected as switching from the retarget call until the new engine is running", async () => {
    const { fake, app } = await ready();
    const target = { kind: "remote", address: "10.0.0.2:7000" } as const;
    expect(await app.commands.retargetEngine(target, 7000)).toEqual({ ok: true, value: null });
    expect(fake.retargeted).toEqual([target]);
    expect(app.ui.read.getState().engineSwitching).toBe(true);
    // 쓰기는 연결에 닿지 않고 거절된다
    const before = fake.written.length;
    expect(await app.commands.sendTurn(thr(1), "hi", "r1")).toEqual({
      ok: false,
      error: { kind: "switching" },
    });
    expect(await app.commands.interrupt(thr(1))).toEqual({
      ok: false,
      error: { kind: "switching" },
    });
    expect(fake.written.length).toBe(before);
    // 옛 엔진이 내려갔다 새 엔진이 running이 되면 풀린다
    fake.emitState(STOPPING);
    await until(() => app.engine.read.getState().engine?.kind === "stopping", "stopping");
    expect(app.ui.read.getState().engineSwitching).toBe(true);
    fake.emitState(RUNNING);
    await until(() => !app.ui.read.getState().engineSwitching, "hold released");
    await app.stop();
  });

  test("an approval answer during the switch is not sent and the card shows switching", async () => {
    const { fake, app } = await ready();
    await app.commands.retargetEngine({ kind: "remote", address: "10.0.0.2:7000" }, 7000);
    const before = fake.written.length;
    await app.commands.respondApproval(evt(1), { decision: "deny" });
    expect(fake.written.length).toBe(before);
    expect(app.ui.read.getState().approvalSends).toEqual({ [evt(1)]: "switching" });
    await app.stop();
  });

  test("a second retarget while switching is rejected, and the same target again does not hold", async () => {
    const { fake, app } = await ready();
    const target = { kind: "local" } as const;
    await app.commands.retargetEngine(target, 7000);
    expect(await app.commands.retargetEngine({ kind: "remote", address: "h:1" }, 7000)).toEqual({
      ok: false,
      error: { kind: "switching" },
    });
    fake.emitState(STOPPING);
    await until(() => app.engine.read.getState().engine?.kind === "stopping", "stopping");
    fake.emitState(RUNNING);
    await until(() => !app.ui.read.getState().engineSwitching, "hold released");
    expect(await app.commands.retargetEngine(target, 7000)).toEqual({ ok: true, value: null });
    expect(app.ui.read.getState().engineSwitching).toBe(false);
    expect(fake.retargeted).toEqual([target]);
    await app.stop();
  });

  test("a new engine that fails to start releases the hold so another target can be chosen at once", async () => {
    const { fake, app } = await ready();
    await app.commands.retargetEngine({ kind: "remote", address: "10.0.0.2:7000" }, 7000);
    expect(app.ui.read.getState().engineSwitching).toBe(true);
    fake.emitState(STOPPING);
    await until(() => app.engine.read.getState().engine?.kind === "stopping", "stopping");
    fake.emitState({
      kind: "failed",
      attempts: 1,
      lastExit: { code: 3, signal: null, at: "2026-11-07T00:00:00.000Z", detail: "refused" },
    });
    await until(() => !app.ui.read.getState().engineSwitching, "hold released");
    expect(await app.commands.retargetEngine({ kind: "local" }, 7000)).toEqual({
      ok: true,
      value: null,
    });
    await app.stop();
  });

  test("a failed retarget releases the hold", async () => {
    const fake = fakeIpc();
    const failing = {
      ...fake.ipc,
      retarget: () =>
        Promise.resolve({
          ok: false as const,
          error: { kind: "command" as const, command: "engine_retarget", code: "x" },
        }),
    };
    const app = (await import("./support.ts")).makeAppOver(failing);
    await until(() => app.engine.read.getState().engine?.kind === "running", "engine running");
    expect(await app.commands.retargetEngine({ kind: "local" }, 7000)).toEqual({
      ok: false,
      error: { kind: "failed" },
    });
    expect(app.ui.read.getState().engineSwitching).toBe(false);
    await app.stop();
  });
});

describe("the switch remembers the target it sent", () => {
  test("the restore section reads no target before a retarget, then the target that was sent", async () => {
    const { app } = await ready();
    expect(app.commands.restore.engineTarget()).toBeNull();
    const target = { kind: "remote", address: "10.0.0.2:7000" } as const;
    expect(await app.commands.retargetEngine(target, 7000)).toEqual({ ok: true, value: null });
    expect(app.commands.restore.engineTarget()).toEqual(target);
    await app.stop();
  });
});
