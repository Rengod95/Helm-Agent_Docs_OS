import { afterEach, expect, test } from "bun:test";
import { assistantItem, turnCompleted, userItem } from "./support/events.ts";
import type { TurnContext } from "./support/fake-server.ts";
import { createHarness, type Harness } from "./support/harness.ts";

const harnesses: Harness[] = [];
afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.dispose();
});

function harness(options: Parameters<typeof createHarness>[0] = {}): Harness {
  const created = createHarness(options);
  harnesses.push(created);
  return created;
}

const ESC = String.fromCodePoint(27);

function answer(context: TurnContext): void {
  context.server.commit(context.threadId, [
    userItem(context.turnId, 1, "q"),
    assistantItem(context.turnId, 2, { text: "plain **text**" }),
    turnCompleted(context.turnId),
  ]);
}

test("a non-tty stdout never gets an escape byte (AC7)", async () => {
  const h = harness({
    terminal: { stdinIsTty: true, stdoutIsTty: false },
    server: { onTurn: answer },
  });
  expect(await h.run(["chat", "-p", "q"])).toBe(0);
  expect(h.stdoutText()).toBe("plain **text**\n");
  expect(h.stdoutText()).not.toContain(ESC);
  expect(h.stderrText()).not.toContain(ESC);
});

test("a non-tty stdin runs print mode and never opens the interactive screen (AC7)", async () => {
  const h = harness({
    terminal: { stdinIsTty: false, stdoutIsTty: true },
    stdin: "from a pipe",
    server: { onTurn: answer },
    lines: ["this must not be read"],
  });
  expect(await h.run(["chat"])).toBe(0);
  const turn = h.server().requests.find((request) => request.method === "turn.start");
  expect(turn?.params).toMatchObject({ input: "from a pipe" });
  expect(h.stdoutText()).not.toContain("xeon chat —");
});

async function stderrOfFailedTurn(
  argv: readonly string[],
  env: Record<string, string>,
): Promise<string> {
  const h = harness({
    terminal: { stdinIsTty: true, stdoutIsTty: true, columns: 80 },
    env,
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [turnCompleted(context.turnId, "failed", "boom")]);
      },
    },
  });
  await h.run(argv);
  return h.stderrText();
}

test("colour is used on a tty stdout and dropped by --no-color, NO_COLOR and TERM=dumb", async () => {
  expect(await stderrOfFailedTurn(["chat", "-p", "q"], {})).toContain(ESC);
  expect(await stderrOfFailedTurn(["chat", "-p", "q", "--no-color"], {})).not.toContain(ESC);
  expect(await stderrOfFailedTurn(["chat", "-p", "q"], { NO_COLOR: "1" })).not.toContain(ESC);
  expect(await stderrOfFailedTurn(["chat", "-p", "q"], { TERM: "dumb" })).not.toContain(ESC);
});
