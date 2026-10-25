import { describe, expect, test } from "bun:test";
import type { EngineState } from "../../src/transport/ipc.ts";
import { fakeIpc, requestId } from "../transport/fake-ipc.ts";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, tick, until } from "./support.ts";

describe("app session over a fake shell and fake engine", () => {
  test("attach, hello, subscribe, thread.list end in a live link with the list ready", async () => {
    const { fake, methods } = engineFake();
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().link.phase === "live", "live link");
    await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
    // 새 연결의 첫 메시지는 $/connectionReset이다(WebView 새로고침 뒤 hello 중복 방지, spec 4.5)
    expect(methods.slice(0, 4)).toEqual([
      "$/connectionReset",
      "host.hello",
      "events.subscribe",
      "thread.list",
    ]);
    expect(app.session.engineVersion()).toBe("1.2.3");
    expect(app.engine.read.getState().threads.ids).toEqual([thr(1)]);
    await app.stop();
  });

  test("selecting a thread loads its snapshot through thread.read; sending goes through turn.start", async () => {
    const { fake, methods } = engineFake();
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
    app.commands.selectThread(thr(1));
    await until(
      () => app.engine.read.getState().transcript?.status === "ready",
      "transcript ready",
    );
    const sent = await app.commands.sendTurn(thr(1), "hi", "req-1");
    expect(sent.ok).toBe(true);
    expect(methods).toContain("thread.read");
    expect(methods).toContain("turn.start");
    await app.stop();
  });

  test("commands report offline before the engine is connected", async () => {
    const fake = fakeIpc({ state: { kind: "starting", source: "sidecar", attempt: 0 } });
    const app = makeApp(fake);
    await tick(20);
    const sent = await app.commands.sendTurn(thr(1), "hi", "req-1");
    expect(!sent.ok && sent.error.kind).toBe("offline");
    await app.stop();
  });

  test("engine restarting takes the link offline; running again reconnects from the mirror cursor", async () => {
    const down: EngineState = {
      kind: "restarting",
      attempt: 1,
      retryAt: "2026-10-24T00:00:01.000Z",
      lastExit: { code: 1, signal: null, at: "2026-10-24T00:00:00.000Z" },
    };
    const { fake, methods } = engineFake([summary(thr(1))], (n) =>
      n === 2 ? down : { kind: "running", source: "sidecar", pid: 1 },
    );
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().link.phase === "live", "live link");
    const phases: string[] = [];
    app.engine.read.subscribe((state) => void phases.push(state.link.phase));
    fake.emitState({
      kind: "restarting",
      attempt: 1,
      retryAt: "2026-10-24T00:00:01.000Z",
      lastExit: { code: 1, signal: null, at: "2026-10-24T00:00:00.000Z" },
    });
    // 새 attach(두 번째)는 아직 restarting을 돌려준다. 곧 running이 온다
    await until(() => fake.epoch() === 2, "re-attach");
    await until(() => app.engine.read.getState().link.phase === "offline", "offline");
    fake.emitState({ kind: "running", source: "sidecar", pid: 2 });
    await until(() => app.engine.read.getState().link.phase === "live", "live again");
    expect(phases).toContain("offline");
    expect(methods.filter((m) => m === "host.hello")).toHaveLength(2);
    expect(app.engine.read.getState().cursor?.seq).toBe(5);
    await app.stop();
  });

  test("a hello error is shown as a connect error and waits for reconnect()", async () => {
    let first = true;
    const fake = fakeIpc({
      onWrite: (message, f) => {
        if (requestId(message) === "") return; // 알림($/connectionReset)에는 응답이 없다
        if (first) {
          first = false;
          f.emitLine({
            jsonrpc: "2.0",
            id: requestId(message),
            error: {
              code: 1002,
              message: "dup",
              data: { kind: "host.helloDuplicate", retryable: false },
            },
          });
        }
      },
    });
    const app = makeApp(fake);
    await until(() => app.ui.read.getState().connectError !== null, "connect error");
    expect(app.ui.read.getState().connectError).toBe("hello:1002");
    await app.stop();
  });
});
