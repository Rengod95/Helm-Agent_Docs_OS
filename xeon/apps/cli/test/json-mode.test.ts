import { afterEach, expect, test } from "bun:test";
import type { JsonRpcMessage } from "@xeon/contracts/wire";
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

function answer(context: TurnContext): void {
  context.server.commit(context.threadId, [
    userItem(context.turnId, 1, "hello"),
    assistantItem(context.turnId, 2, { text: "hi" }),
    turnCompleted(context.turnId),
  ]);
}

function jsonLines(text: string): unknown[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): unknown => JSON.parse(line));
}

function eventsBatches(messages: readonly unknown[]): readonly Record<string, unknown>[] {
  return messages.flatMap((message) => {
    if (typeof message !== "object" || message === null) return [];
    const record: Record<string, unknown> = Object.fromEntries(Object.entries(message));
    if (record["method"] !== "events.batch") return [];
    const params = record["params"];
    if (typeof params !== "object" || params === null) return [];
    const inner: Record<string, unknown> = Object.fromEntries(Object.entries(params));
    return [inner];
  });
}

function observedAsJson(messages: readonly JsonRpcMessage[]): unknown[] {
  return messages.map((message): unknown => JSON.parse(JSON.stringify(message)));
}

test("--json writes exactly the messages the connection carried, in order (AC4)", async () => {
  const h = harness({ server: { onTurn: answer } });
  const code = await h.run(["chat", "-p", "hello", "--json"]);
  expect(code).toBe(0);
  expect(h.stderrText()).toBe("");
  expect(jsonLines(h.stdoutText())).toEqual(observedAsJson(h.observed));
});

test("--json starts with host.hello and contains the completed turn (AC1)", async () => {
  const h = harness({ server: { onTurn: answer } });
  await h.run(["chat", "-p", "hello", "--json"]);
  const lines = jsonLines(h.stdoutText());
  expect(lines[0]).toMatchObject({ jsonrpc: "2.0", method: "host.hello" });
  const completed = eventsBatches(lines).flatMap((params): unknown[] => {
    const events = params["events"];
    return Array.isArray(events) ? events.map((event: unknown) => event) : [];
  });
  expect(completed).toContainEqual(
    expect.objectContaining({
      kind: "turn.completed",
      payload: expect.objectContaining({ status: "completed" }),
    }),
  );
});

test("--json output has no escape bytes and no human text", async () => {
  const h = harness({ server: { onTurn: answer } });
  await h.run(["chat", "-p", "hello", "--json"]);
  expect(h.stdoutText()).not.toContain(String.fromCodePoint(27));
  expect(
    h
      .stdoutText()
      .split("\n")
      .filter((line) => line.length > 0),
  ).toHaveLength(h.observed.length);
});

test("--json does not ask for the output mode setting", async () => {
  const h = harness({ server: { onTurn: answer } });
  await h.run(["chat", "-p", "hello", "--json"]);
  expect(h.methods()).not.toContain("settings.get");
});

test("without --json, l4.cli.outputMode=json turns the tap on from host.hello on", async () => {
  const h = harness({
    server: { onTurn: answer, settings: { "l4.cli.outputMode": "json" } },
  });
  expect(await h.run(["chat", "-p", "hello"])).toBe(0);
  const lines = jsonLines(h.stdoutText());
  expect(lines).toEqual(observedAsJson(h.observed));
  expect(lines[0]).toMatchObject({ method: "host.hello" });
});

test("without --json and outputMode=text, stdout has only the response", async () => {
  const h = harness({ server: { onTurn: answer } });
  await h.run(["chat", "-p", "hello"]);
  expect(h.stdoutText()).toBe("hi\n");
});

test("a failed turn in JSON mode leaves one line on stderr", async () => {
  const h = harness({
    server: {
      onTurn: (context) => {
        context.server.commit(context.threadId, [turnCompleted(context.turnId, "failed", "boom")]);
      },
    },
  });
  expect(await h.run(["chat", "-p", "hello", "--json"])).toBe(1);
  expect(h.stderrText()).toContain("turn이 실패했다: boom");
});
