import { writeFileSync } from "node:fs";
import { afterEach, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import {
  assistantItem,
  effectIntent,
  textChunk,
  toolResultItem,
  turnCompleted,
  userItem,
} from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, waitFor, type Harness } from "./support/harness.ts";
import { threadId } from "./support/ids.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const ESC = String.fromCodePoint(27);
const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 60 } as const;

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness({ terminal: TTY, env: { NO_COLOR: "1" }, ...options });
  harnesses.push(created);
  return created;
}

function answer(text: string, user = "hello"): (context: TurnContext) => void {
  return (context) => {
    context.server.commit(context.threadId, [
      userItem(context.turnId, 1, user),
      assistantItem(context.turnId, 2, { text }),
      turnCompleted(context.turnId),
    ]);
  };
}

/** abort될 때까지 기다리는 입력. 입력 대기 중의 Ctrl+C 시험에 쓴다 */
function blockedReadLine(): (prompt: string, signal: AbortSignal) => Promise<string | null> {
  return (_prompt, signal) =>
    new Promise<string | null>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          resolve(null);
        },
        { once: true },
      );
    });
}

test("a line becomes a turn: the user line, the answer, then the next prompt", async () => {
  const h = harness({ lines: ["hello", "/quit"], server: { onTurn: answer("world") } });
  expect(await h.run(["chat"])).toBe(0);
  expect(h.stdoutText()).toContain("xeon chat — 세션 thr_");
  // 방금 친 줄은 터미널이 보여 주므로 user 이벤트로 되풀이하지 않는다
  expect(h.stdoutText()).not.toContain("> hello");
  expect(h.stdoutText()).toContain("world\n");
  expect(h.stderrText()).toBe("");
  expect(h.closed()).toBe(true);
});

test("the first turn sends exactly the typed line", async () => {
  const h = harness({ lines: ["  hello there  ", "/quit"], server: { onTurn: answer("ok") } });
  await h.run(["chat"]);
  const turn = h.server().requests.find((request) => request.method === "turn.start");
  expect(turn?.params).toMatchObject({ input: "hello there" });
});

test("empty lines are skipped and Ctrl+D (EOF) ends with 0", async () => {
  const h = harness({ lines: ["", "   "] });
  expect(await h.run(["chat"])).toBe(0);
  expect(h.methods()).not.toContain("turn.start");
  expect(h.stdoutText().endsWith("\n")).toBe(true);
});

test("slash commands: /help prints help, an unknown one says so, /exit ends", async () => {
  const h = harness({ lines: ["/help", "/frob", "/exit"] });
  expect(await h.run(["chat"])).toBe(0);
  expect(h.stdoutText()).toContain("/quit");
  expect(h.stdoutText()).toContain("모르는 슬래시 명령: /frob");
  expect(h.methods()).not.toContain("turn.start");
});

test("several turns share one session and one subscription", async () => {
  const h = harness({ lines: ["one", "two", "/quit"], server: { onTurn: answer("ok") } });
  await h.run(["chat"]);
  const methods = h.methods();
  expect(methods.filter((method) => method === "turn.start")).toHaveLength(2);
  expect(methods.filter((method) => method === "events.subscribe")).toHaveLength(1);
  expect(methods.filter((method) => method === "thread.create")).toHaveLength(1);
});

test("streaming text draws one overwritten progress line and clears it for the durable text", async () => {
  const h = harness({
    env: {},
    lines: ["hello", "/quit"],
    server: {
      onTurn: (context) => {
        context.server.chunk(
          textChunk({
            turn: context.turnId,
            item: 2,
            n: 0,
            afterSeq: context.server.headSeq(),
            delta: "Wor",
          }),
        );
        context.server.commit(context.threadId, [
          assistantItem(context.turnId, 2, { text: "World" }),
          turnCompleted(context.turnId),
        ]);
      },
      respondBeforeTurn: true,
    },
  });
  await h.run(["chat"]);
  const out = h.stdoutText();
  expect(out).toContain(`\r${ESC}[2KWor`);
  expect(out.indexOf(`\r${ESC}[2K`)).toBeLessThan(out.indexOf("World\n"));
});

test("a lock denied on the first turn ends the session with 4", async () => {
  const h = harness({
    lines: ["hello", "never read"],
    server: {
      failures: {
        "turn.start": wireError("thread.locked", {
          details: { ownerKind: "app", options: ["observe", "fork"] },
        }),
      },
    },
  });
  expect(await h.run(["chat"])).toBe(EXIT.lockDenied);
  expect(h.stderrText()).toContain("다른 프로세스(app)가 이 세션을 쓰고 있다");
});

test("turn.busy is reported and the prompt comes back", async () => {
  const h = harness({
    lines: ["one", "/quit"],
    server: {
      failures: { "turn.start": wireError("turn.busy", { details: { turnId: "trn_x" } }) },
    },
  });
  expect(await h.run(["chat"])).toBe(0);
  expect(h.stderrText()).toContain("진행 중인 turn이 있다");
});

test("ctrl+c during a turn exits 130 (M1: no turn.interrupt)", async () => {
  const h = harness({ lines: ["hello"], server: { onTurn: () => undefined } });
  const running = h.run(["chat"]);
  await waitFor(() => h.methods().includes("turn.start"));
  h.signal("SIGINT");
  expect(await running).toBe(EXIT.interrupted);
  expect(h.closed()).toBe(true);
});

test("ctrl+c at an empty prompt hints once and a second one within 2s exits 0", async () => {
  const h = harness({ readLine: blockedReadLine() });
  const running = h.run(["chat"]);
  await waitFor(() => h.methods().includes("thread.create"));
  await waitFor(() => h.stdoutText().includes("xeon chat —"));
  h.signal("SIGINT");
  await waitFor(() => h.stdoutText().includes("한 번 더 누르면 끝낸다"));
  h.clock.advance(500);
  h.signal("SIGINT");
  expect(await running).toBe(EXIT.ok);
});

function conversationWithTool(context: TurnContext): void {
  context.server.commit(context.threadId, [
    userItem(context.turnId, 1, "list files"),
    assistantItem(context.turnId, 2, { thinking: "plan", text: "checking", toolCallId: "c1" }),
    effectIntent(context.turnId, {
      effect: 1,
      item: 3,
      toolCallId: "c1",
      toolName: "ls",
      args: { path: "." },
    }),
    toolResultItem(context.turnId, {
      item: 4,
      effect: 1,
      toolCallId: "c1",
      toolName: "ls",
      text: "a.txt",
    }),
    assistantItem(context.turnId, 5, { text: "one file" }),
    turnCompleted(context.turnId),
  ]);
}

test("--continue shows the earlier conversation folded and the new events in full (§4.4)", async () => {
  const h = harness({ server: { onTurn: conversationWithTool } });
  h.useTerminal({ stdinIsTty: false, stdoutIsTty: false });
  await h.run(["chat", "-p", "list files"]);
  h.stdout.length = 0;
  h.stderr.length = 0;

  h.useTerminal(TTY);
  h.useLines(["next", "/quit"]);
  h.useServer({
    onTurn: (context) => {
      context.server.commit(context.threadId, [
        userItem(context.turnId, 11, "next"),
        effectIntent(context.turnId, {
          effect: 2,
          item: 12,
          toolCallId: "c2",
          toolName: "read",
          args: { path: "a.txt" },
        }),
        assistantItem(context.turnId, 13, { text: "fresh" }),
        turnCompleted(context.turnId),
      ]);
    },
  });
  expect(await h.run(["chat", "--continue"])).toBe(0);
  const out = h.stdoutText();
  // 이전 기록: user·assistant 텍스트만, 도구 줄과 생각은 접힌다
  expect(out).toContain("> list files\n");
  expect(out).toContain("checking\n");
  expect(out).toContain("one file\n");
  expect(out).not.toContain("● ls");
  expect(out).not.toContain("(생각) plan");
  // 저장 위치 이후: 전체 형태
  expect(out).toContain("● read");
  expect(out).toContain("fresh\n");
  const subscribe = h.server().requests.find((request) => request.method === "events.subscribe");
  expect(subscribe?.params).toMatchObject({ from: { seq: expect.any(Number) } });
});

test("--resume without a saved position folds everything up to the current head", async () => {
  const h = harness({ server: { onTurn: conversationWithTool } });
  h.useTerminal({ stdinIsTty: false, stdoutIsTty: false });
  await h.run(["chat", "-p", "list files"]);
  h.stdout.length = 0;
  writeEmptyState(h);

  h.useTerminal(TTY);
  h.useLines(["/quit"]);
  expect(await h.run(["chat", "--resume", threadId(101)])).toBe(0);
  const subscribe = h.server().requests.find((request) => request.method === "events.subscribe");
  expect(subscribe?.params).toMatchObject({ from: { seq: 0 } });
  expect(h.stdoutText()).toContain("> list files\n");
  expect(h.stdoutText()).not.toContain("● ls");
});

function writeEmptyState(h: Harness): void {
  writeFileSync(h.stateFile, JSON.stringify({ version: 1, workspaces: {} }));
}
