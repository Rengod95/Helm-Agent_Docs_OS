import { afterEach, expect, test } from "bun:test";
import { wireError } from "@xeon/contracts/wire";
import { EXIT } from "../src/exit-codes.ts";
import { assistantItem, turnCompleted } from "./support/events.ts";
import type { FakeServer, TurnContext } from "./support/fake-server.ts";
import { createHarness, waitFor, type Harness } from "./support/harness.ts";
import { scriptedInput } from "./support/script.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: 80 } as const;

interface Run {
  readonly h: Harness;
  readonly interrupts: Record<string, unknown>[];
}

/** 대화형. "go"로 turn을 시작하면 서버는 끝내지 않고 기다린다. interrupt 처리기는 시험이 정한다 */
function interactive(options: {
  readonly interrupt?: (server: FakeServer, context: TurnContext) => unknown;
}): Run {
  const interrupts: Record<string, unknown>[] = [];
  const open: { context?: TurnContext } = {};
  const input = scriptedInput(["go", "/quit"]);
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (prompt, signal) => input.readLine(prompt, signal),
    server: {
      onTurn: (context) => {
        open.context = context;
      },
      ...(options.interrupt === undefined
        ? {}
        : {
            handlers: {
              "turn.interrupt": (params, server) => {
                interrupts.push({ ...params });
                const { context } = open;
                if (context === undefined) return { interrupted: false };
                return options.interrupt?.(server, context);
              },
            },
          }),
    },
  });
  harnesses.push(h);
  return { h, interrupts };
}

function interruptsTheTurn(server: FakeServer, context: TurnContext): unknown {
  server.commit(context.threadId, [turnCompleted(context.turnId, "interrupted")]);
  return { interrupted: true };
}

test("the first ctrl+c during a turn sends exactly one turn.interrupt and the session goes on", async () => {
  const run = interactive({ interrupt: interruptsTheTurn });
  const done = run.h.run(["chat"]);
  await waitFor(() => run.h.methods().includes("turn.start"));
  run.h.signal("SIGINT");
  expect(await done).toBe(EXIT.ok);
  expect(run.interrupts).toHaveLength(1);
  expect(run.interrupts[0]).toMatchObject({ threadId: expect.any(String) });
  // 입력 줄로 돌아와 /quit까지 읽었다
  expect(run.h.stderrText()).toContain("turn이 중단되었다");
});

test("a second ctrl+c within two seconds asks to exit with 130 and does not interrupt again", async () => {
  const run = interactive({ interrupt: () => ({ interrupted: true }) });
  const done = run.h.run(["chat"]);
  await waitFor(() => run.h.methods().includes("turn.start"));
  run.h.signal("SIGINT");
  await waitFor(() => run.interrupts.length === 1);
  run.h.clock.advance(500);
  run.h.signal("SIGINT");
  expect(await done).toBe(EXIT.interrupted);
  expect(run.interrupts).toHaveLength(1);
});

test("when the host cannot interrupt, the first ctrl+c is an exit request", async () => {
  const run = interactive({});
  const done = run.h.run(["chat"]);
  await waitFor(() => run.h.methods().includes("turn.start"));
  run.h.signal("SIGINT");
  expect(await done).toBe(EXIT.interrupted);
  expect(run.h.methods()).not.toContain("turn.interrupt");
});

test("when turn.interrupt itself fails, ctrl+c falls back to an exit request", async () => {
  const run = interactive({
    interrupt: () => {
      throw wireError("internal", {});
    },
  });
  const done = run.h.run(["chat"]);
  await waitFor(() => run.h.methods().includes("turn.start"));
  run.h.signal("SIGINT");
  expect(await done).toBe(EXIT.interrupted);
  expect(run.interrupts).toHaveLength(1);
});

test("print mode keeps ctrl+c as an exit request even when the host can interrupt", async () => {
  const interrupts: unknown[] = [];
  const h = createHarness({
    server: {
      onTurn: () => undefined,
      handlers: { "turn.interrupt": (params) => (interrupts.push(params), { interrupted: true }) },
    },
  });
  harnesses.push(h);
  const done = h.run(["chat", "-p", "hello"]);
  await waitFor(() => h.methods().includes("turn.start"));
  h.signal("SIGINT");
  expect(await done).toBe(EXIT.interrupted);
  expect(interrupts).toEqual([]);
});

test("ctrl+c with no turn running only hints, then the second press exits 0", async () => {
  const h = createHarness({
    terminal: TTY,
    env: { NO_COLOR: "1" },
    readLine: (_prompt, signal) =>
      new Promise<string | null>((resolve) => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
      }),
    server: {
      handlers: { "turn.interrupt": () => ({ interrupted: false }) },
      onTurn: (context) => {
        context.server.commit(context.threadId, [
          assistantItem(context.turnId, 1, { text: "x" }),
          turnCompleted(context.turnId),
        ]);
      },
    },
  });
  harnesses.push(h);
  const done = h.run(["chat"]);
  await waitFor(() => h.stdoutText().includes("xeon chat"));
  h.signal("SIGINT");
  await waitFor(() => h.stdoutText().includes("한 번 더 누르면 끝낸다"));
  h.signal("SIGINT");
  expect(await done).toBe(EXIT.ok);
  expect(h.methods()).not.toContain("turn.interrupt");
});
