import { describe, expect, test } from "bun:test";
import { summary, thr } from "../state/helpers.ts";
import { engineFake, makeApp, until } from "./support.ts";

// 데스크톱 슬래시 입력(B3-SET 이월): `/`로 시작하는 줄은 `command.run`으로 간다. 대화 입력(`turn.start`)으로 가던 `/helm`, `/learning`이
// 이제 엔진 명령으로 실행된다. 가짜 셸과 가짜 엔진 위에서 입력창이 부르는 `sendTurn`을 끝까지 돌린다.

async function liveApp(extra: Parameters<typeof engineFake>[2]) {
  const engine = engineFake([summary(thr(1))], undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  return { app, ...engine };
}

const methodsOf = (params: readonly { method: string }[], method: string): number =>
  params.filter((entry) => entry.method === method).length;

describe("slash input goes to command.run", () => {
  test("/helm start calls command.run exactly once with the whole line, and never turn.start", async () => {
    const { app, params } = await liveApp({
      results: {
        "command.run": { status: "done", name: "helm", message: "시작했다", result: { ok: true } },
      },
    });
    const sent = await app.commands.sendTurn(thr(1), "/helm start", "req-1");
    expect(sent).toEqual({ ok: true, value: null });
    const runs = params.filter((entry) => entry.method === "command.run");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.params).toEqual({ threadId: thr(1), text: "/helm start" });
    expect(methodsOf(params, "turn.start")).toBe(0);
    expect(app.ui.read.getState().commandOutput).toEqual({
      threadId: thr(1),
      name: "helm",
      message: "시작했다",
      result: { ok: true },
    });
    await app.stop();
  });

  test("an expanded template is sent as the user's turn with the same request id", async () => {
    const { app, params } = await liveApp({
      results: { "command.run": { status: "expanded", name: "review", text: "검토해 줘" } },
    });
    const sent = await app.commands.sendTurn(thr(1), "/review src", "req-7");
    expect(sent.ok).toBe(true);
    expect(methodsOf(params, "command.run")).toBe(1);
    expect(params.find((entry) => entry.method === "turn.start")?.params).toEqual({
      threadId: thr(1),
      input: "검토해 줘",
      requestId: "req-7",
    });
    await app.stop();
  });

  test("a line the engine does not know as a command is sent as chat after one command.run", async () => {
    const { app, params } = await liveApp({
      results: { "command.run": { status: "not_command" } },
    });
    await app.commands.sendTurn(thr(1), "/nothing here", "req-2");
    expect(methodsOf(params, "command.run")).toBe(1);
    expect(params.find((entry) => entry.method === "turn.start")?.params).toEqual({
      threadId: thr(1),
      input: "/nothing here",
      requestId: "req-2",
    });
    await app.stop();
  });

  test("a host without command.run gets the line as chat, so an old engine still works", async () => {
    const { app, params } = await liveApp({
      errors: { "command.run": { code: -32601, kind: "jsonrpc.methodNotFound" } },
    });
    const sent = await app.commands.sendTurn(thr(1), "/helm start", "req-3");
    expect(sent.ok).toBe(true);
    expect(methodsOf(params, "command.run")).toBe(1);
    expect(methodsOf(params, "turn.start")).toBe(1);
    await app.stop();
  });

  test("plain text and a path never reach command.run", async () => {
    const { app, params } = await liveApp({});
    await app.commands.sendTurn(thr(1), "hello", "req-4");
    await app.commands.sendTurn(thr(1), "/usr/bin/env is where", "req-5");
    expect(methodsOf(params, "command.run")).toBe(0);
    expect(methodsOf(params, "turn.start")).toBe(2);
    await app.stop();
  });

  test("a shell-injecting template waits for the person, and confirming re-sends the same line with confirmShell", async () => {
    const { app, params } = await liveApp({
      results: {
        "command.run": {
          status: "needs_confirmation",
          name: "review",
          shell: [{ index: 0, command: "git status" }],
        },
      },
    });
    await app.commands.sendTurn(thr(1), "/review", "req-6");
    expect(app.ui.read.getState().shellConfirm).toEqual({
      threadId: thr(1),
      name: "review",
      commands: ["git status"],
      text: "/review",
      requestId: "req-6",
    });
    expect(methodsOf(params, "turn.start")).toBe(0);
    // 가짜 엔진은 같은 답을 다시 주므로 확인 대기가 다시 서 있다. 이 시험은 두 번째 호출이 보낸 params만 본다
    await app.commands.confirmShell();
    const runs = params.filter((entry) => entry.method === "command.run");
    expect(runs.map((entry) => entry.params)).toEqual([
      { threadId: thr(1), text: "/review" },
      { threadId: thr(1), text: "/review", confirmShell: true },
    ]);
    expect(app.ui.read.getState().shellConfirm).not.toBeNull();
    await app.stop();
  });

  test("cancelling a shell confirmation runs nothing", async () => {
    const { app, params } = await liveApp({
      results: {
        "command.run": {
          status: "needs_confirmation",
          name: "review",
          shell: [{ index: 0, command: "git status" }],
        },
      },
    });
    await app.commands.sendTurn(thr(1), "/review", "req-8");
    app.commands.cancelShell();
    expect(app.ui.read.getState().shellConfirm).toBeNull();
    expect(await app.commands.confirmShell()).toEqual({ ok: true, value: null });
    expect(methodsOf(params, "command.run")).toBe(1);
    await app.stop();
  });

  test("command.list becomes list rows for the thread", async () => {
    const { app, params } = await liveApp({
      results: {
        "command.list": {
          commands: [
            {
              name: "helm",
              description: "Helm 그룹",
              argumentHint: "<start|stop>",
              args: [{ name: "action", choices: ["start", "stop"] }],
              kind: "action",
              source: "extension",
              origin: "group-helm",
              hasShell: false,
            },
          ],
        },
      },
    });
    const listed = await app.commands.commandList(thr(1));
    expect(listed).toEqual({
      ok: true,
      value: [
        {
          name: "helm",
          label: "/helm",
          description: "Helm 그룹",
          hint: "<start|stop>",
          kind: "action",
          origin: "group-helm",
          needsShellConfirm: false,
          firstChoices: ["start", "stop"],
        },
      ],
    });
    expect(params.find((entry) => entry.method === "command.list")?.params).toEqual({
      threadId: thr(1),
    });
    await app.stop();
  });
});
