import { describe, expect, test } from "bun:test";
import { repeatAsync } from "@xeon/contracts";
import type { EngineState } from "../../src/transport/ipc.ts";
import { createApp, type App } from "../../src/app/bootstrap.ts";
import { fakeIpc, requestId, type FakeIpc } from "../transport/fake-ipc.ts";
import { STORE, summary, thr, userItem } from "../state/helpers.ts";

const tick = (ms = 5): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, label: string): Promise<void> {
  let left = 200;
  await repeatAsync<undefined>(async () => {
    if (condition()) return { value: undefined };
    left -= 1;
    if (left <= 0) throw new Error(`timed out waiting for ${label}`);
    await tick();
    return undefined;
  });
}

function methodOf(message: unknown): string {
  const method: unknown =
    typeof message === "object" && message !== null ? Reflect.get(message, "method") : undefined;
  return typeof method === "string" ? method : "";
}

/** 엔진 역할: 요청에 결과를 돌려준다. 시험이 호출 목록을 본다 */
function engineFake(
  threads = [summary(thr(1))],
  stateForAttach?: (n: number) => EngineState,
): { fake: FakeIpc; methods: string[] } {
  const methods: string[] = [];
  const results: Readonly<Record<string, unknown>> = {
    "host.hello": {
      protocolVersion: "0.1.0",
      server: { name: "xeon", version: "1.2.3" },
      storeId: STORE,
      transport: "stdio",
      features: [],
      experimental: [],
    },
    "events.subscribe": { sub: "s1", start: 5, headSeq: 5, storeId: STORE, mode: "live" },
    "thread.list": { threads, nextCursor: null },
    "thread.read": {
      threadId: thr(1),
      items: [userItem(1, "hello")],
      position: { storeId: STORE, seq: 5 },
      hasMore: false,
    },
    "turn.start": { turnId: "trn_00000000000000000000000001" },
  };
  const result = (method: string): unknown => results[method] ?? {};
  const fake = fakeIpc({
    ...(stateForAttach === undefined ? {} : { stateForAttach }),
    onWrite: (message, f) => {
      const method = methodOf(message);
      methods.push(method);
      f.emitLine({ jsonrpc: "2.0", id: requestId(message), result: result(method) });
    },
  });
  return { fake, methods };
}

function makeApp(fake: FakeIpc): App {
  return createApp({
    ipc: fake.ipc,
    clock: { now: () => Date.now() },
    scheduler: {
      setTimeout: (fn, ms) => Number(setTimeout(fn, ms)),
      clearTimeout: (h) => clearTimeout(h),
    },
    frames: {
      requestAnimationFrame: (cb) => Number(setTimeout(() => cb(0), 0)),
      cancelAnimationFrame: (h) => clearTimeout(h),
    },
    monotonic: () => performance.now(),
    clipboard: { writeText: () => Promise.resolve() },
    appVersion: "0.0.0",
    frameFallbackMs: 20,
    logSink: () => {},
  });
}

describe("app session over a fake shell and fake engine", () => {
  test("attach, hello, subscribe, thread.list end in a live link with the list ready", async () => {
    const { fake, methods } = engineFake();
    const app = makeApp(fake);
    await until(() => app.engine.read.getState().link.phase === "live", "live link");
    await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
    expect(methods.slice(0, 3)).toEqual(["host.hello", "events.subscribe", "thread.list"]);
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
