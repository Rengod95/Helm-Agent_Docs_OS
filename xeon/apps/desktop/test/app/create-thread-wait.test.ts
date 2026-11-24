import { describe, expect, test } from "bun:test";
import type { EngineState } from "../../src/transport/ipc.ts";
import { CONNECT_WAIT_MS } from "../../src/app/commands.ts";
import { STORE, summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, makeAppOver, tick, until } from "./support.ts";

// 엔진 연결이 열리기 전(앱을 막 켰을 때, 복원·재시작 뒤 다시 붙는 중)에 누른 "새 대화"(AGE-73 railFix).
// 전에는 바로 `offline`이 되어 "명령을 실행하지 못했어요" 빨간 토스트가 누를 때마다 떴다. 이제 연결을 기다렸다가 만든다.

const STARTING: EngineState = { kind: "starting", source: "sidecar", attempt: 0 };
const RUNNING: EngineState = { kind: "running", source: "sidecar", pid: 1 };
const CREATED = {
  "thread.create": { threadId: thr(2), position: { storeId: STORE, seq: 6 }, sameFolder: [] },
};

describe("new thread before the engine connection is open", () => {
  test("waits for the connection, then creates and selects the thread", async () => {
    const { fake, methods } = engineFake([summary(thr(1))], () => STARTING, { results: CREATED });
    const app = makeApp(fake);
    await tick(20);
    const pending = app.commands.createThread();
    await tick(20);
    expect(methods.filter((m) => m === "thread.create")).toEqual([]);
    fake.emitState(RUNNING);
    const created = await pending;
    expect(created).toEqual({ ok: true, value: null });
    const order = methods.filter((m) => m === "host.hello" || m === "thread.create");
    expect(order).toEqual(["host.hello", "thread.create"]);
    expect(app.ui.read.getState().selectedThreadId).toBe(thr(2));
    await app.stop();
  });

  test("clicks made while waiting share one new thread instead of making one each", async () => {
    const { fake, methods } = engineFake([summary(thr(1))], () => STARTING, { results: CREATED });
    const app = makeApp(fake);
    await tick(20);
    const pending = [
      app.commands.createThread(),
      app.commands.createThread(),
      app.commands.createThread(),
    ];
    await tick(20);
    fake.emitState(RUNNING);
    expect(await Promise.all(pending)).toEqual([
      { ok: true, value: null },
      { ok: true, value: null },
      { ok: true, value: null },
    ]);
    expect(methods.filter((m) => m === "thread.create")).toEqual(["thread.create"]);
    expect(app.ui.read.getState().selectedThreadId).toBe(thr(2));
    await app.stop();
  });

  test("if no connection opens before the deadline it is still reported as offline", async () => {
    const { fake, methods } = engineFake([summary(thr(1))], () => STARTING, { results: CREATED });
    const waits: number[] = [];
    const app = makeAppOver(fake.ipc, {
      scheduler: {
        // 연결 기다림의 마감만 바로 지나가게 한다. 다른 타이머는 그대로다
        setTimeout: (fn, ms) => {
          if (ms === CONNECT_WAIT_MS) waits.push(ms);
          return Number(setTimeout(fn, ms === CONNECT_WAIT_MS ? 0 : ms));
        },
        clearTimeout: (h) => clearTimeout(h),
      },
    });
    await tick(20);
    const created = await app.commands.createThread();
    expect(created).toEqual({ ok: false, error: { kind: "offline" } });
    expect(waits).toEqual([CONNECT_WAIT_MS]);
    expect(methods.filter((m) => m === "thread.create")).toEqual([]);
    await app.stop();
  });

  test("with the connection already open it does not wait", async () => {
    const { fake, params } = engineFake([summary(thr(1))], () => RUNNING, { results: CREATED });
    const waits: number[] = [];
    const app = makeAppOver(fake.ipc, {
      scheduler: {
        setTimeout: (fn, ms) => {
          if (ms === CONNECT_WAIT_MS) waits.push(ms);
          return Number(setTimeout(fn, ms));
        },
        clearTimeout: (h) => clearTimeout(h),
      },
    });
    await until(() => app.engine.read.getState().link.phase === "live", "live link");
    const created = await app.commands.createThread("/Users/me/project");
    expect(created).toEqual({ ok: true, value: null });
    expect(waits).toEqual([]);
    expect(params.filter((p) => p.method === "thread.create").map((p) => p.params)).toEqual([
      { workspace: "/Users/me/project" },
    ]);
    await app.stop();
  });
});
