import { describe, expect, test } from "bun:test";
import { evt, STORE, summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

// 데스크톱 명령이 wire 오류와 결과를 화면 상태로 바꾸는 흐름을 가짜 셸과 가짜 엔진 위에서 끝까지 돌린다.

const LOCKED = {
  code: 3002,
  kind: "thread.locked",
  details: { ownerKind: "cli", options: ["observe", "fork", "delegate"] },
};

async function liveApp(extra: Parameters<typeof engineFake>[2]) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  return { app, ...engine };
}

describe("thread.locked", () => {
  test("a refused turn.start opens the dialog with the owner and the options this screen draws", async () => {
    const { app } = await liveApp({ errors: { "turn.start": LOCKED } });
    const sent = await app.commands.sendTurn(thr(1), "hi", "req-1");
    expect(sent).toEqual({
      ok: false,
      error: { kind: "locked", ownerKind: "cli", options: ["observe", "fork"] },
    });
    expect(app.ui.read.getState().locked).toEqual({
      threadId: thr(1),
      ownerKind: "cli",
      options: ["observe", "fork"],
    });
    await app.stop();
  });

  test("observing opens the thread in observe mode, closes the dialog and locks the composer flag", async () => {
    const { app, params } = await liveApp({
      errors: { "turn.start": LOCKED },
      results: {
        "thread.open": { threadId: thr(1), role: "observer", position: { storeId: STORE, seq: 5 } },
      },
    });
    await app.commands.sendTurn(thr(1), "hi", "req-1");
    const observed = await app.commands.observeThread(thr(1));
    expect(observed.ok).toBe(true);
    expect(params.find((p) => p.method === "thread.open")?.params).toEqual({
      threadId: thr(1),
      mode: "observe",
    });
    expect(app.ui.read.getState().locked).toBeNull();
    expect(app.ui.read.getState().observing).toEqual({ [thr(1)]: true });
    app.commands.retryWrite(thr(1));
    expect(app.ui.read.getState().observing).toEqual({});
    await app.stop();
  });

  test("forking selects the new thread and closes the dialog", async () => {
    const { app, params } = await liveApp({
      errors: { "turn.start": LOCKED },
      results: { "thread.fork": { threadId: thr(2), position: { storeId: STORE, seq: 6 } } },
    });
    await app.commands.sendTurn(thr(1), "hi", "req-1");
    const forked = await app.commands.forkThread(thr(1));
    expect(forked.ok).toBe(true);
    expect(params.find((p) => p.method === "thread.fork")?.params).toEqual({ threadId: thr(1) });
    expect(app.ui.read.getState().selectedThreadId).toBe(thr(2));
    expect(app.ui.read.getState().locked).toBeNull();
    await app.stop();
  });

  test("a successful turn.start clears a stale observing flag", async () => {
    const { app } = await liveApp({});
    app.ui.actions.setObserving(thr(1), true);
    expect((await app.commands.sendTurn(thr(1), "hi", "req-1")).ok).toBe(true);
    expect(app.ui.read.getState().observing).toEqual({});
    await app.stop();
  });
});

describe("trust wire", () => {
  const status = {
    projectRoot: "/work/repo",
    required: true,
    verdict: "undecided",
    via: "default",
    resources: [".mcp.json"],
    options: [],
  };

  test("status and decide send the workspace and return the host's verdict", async () => {
    const { app, params } = await liveApp({
      results: {
        "trust.get": status,
        "trust.decide": { ...status, verdict: "allow", via: "store" },
      },
    });
    const got = await app.commands.trust.status("/work/repo");
    expect(got.ok && got.value.verdict).toBe("undecided");
    const decided = await app.commands.trust.decide("/work/repo", {
      kind: "folder",
      verdict: "allow",
    });
    expect(decided.ok && decided.value.verdict).toBe("allow");
    expect(params.filter((p) => p.method.startsWith("trust."))).toEqual([
      { method: "trust.get", params: { workspace: "/work/repo" } },
      {
        method: "trust.decide",
        params: { workspace: "/work/repo", choice: { kind: "folder", verdict: "allow" } },
      },
    ]);
    await app.stop();
  });

  test("a host without trust.get reports unsupported, so no card is drawn", async () => {
    const { app } = await liveApp({
      errors: { "trust.get": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    expect(await app.commands.trust.status("/work/repo")).toEqual({
      ok: false,
      error: { kind: "unsupported" },
    });
    await app.stop();
  });
});

describe("approval.respond reasons", () => {
  test("answer_invalid keeps the host's detail on the card state", async () => {
    const { app } = await liveApp({
      results: {
        "approval.respond": {
          applied: false,
          reason: "answer_invalid",
          detail: "q1: unknown option",
        },
      },
    });
    await app.commands.respondApproval(evt(7), {
      decision: "answer",
      answer: { q1: { selected: ["zz"] } },
    });
    const state = app.ui.read.getState();
    expect(state.approvalSends[evt(7)]).toBe("invalid");
    expect(state.approvalDetails[evt(7)]).toBe("q1: unknown option");
    await app.stop();
  });
});
