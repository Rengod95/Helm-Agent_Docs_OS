import { expect, test } from "bun:test";
import type { ChatCommand } from "../src/cli/command.ts";
import { readAllText, resolvePrintInput } from "../src/commands/chat-input.ts";

function stream(...chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

function command(input: string | null): ChatCommand {
  return {
    kind: "chat",
    mode: "print",
    input,
    output: "text",
    target: { kind: "new" },
    overrides: [],
    safeMode: false,
  };
}

const PIPED = { stdinIsTty: false, stdoutIsTty: false, columns: null } as const;
const TTY = { stdinIsTty: true, stdoutIsTty: true, columns: null } as const;

test("readAllText joins chunks, including a multi-byte character split across chunks", async () => {
  const bytes = new TextEncoder().encode("가나다");
  const result = await readAllText(stream(bytes.slice(0, 4), bytes.slice(4)), 1000);
  expect(result).toEqual({ kind: "ok", text: "가나다" });
});

test("readAllText stops at the limit", async () => {
  expect(await readAllText(stream("x".repeat(11)), 10)).toEqual({ kind: "tooLarge" });
  expect(await readAllText(stream("x".repeat(10)), 10)).toEqual({
    kind: "ok",
    text: "x".repeat(10),
  });
});

test("an input given with -p on a tty stdin is used as is and stdin is not read", async () => {
  const result = await resolvePrintInput(command("hello"), {
    stdin: stream("must not be read"),
    terminal: TTY,
  });
  expect(result).toEqual({ ok: true, value: "hello" });
});

test("-p - takes the whole stdin and -p text appends a non-empty stdin after a blank line", async () => {
  expect(await resolvePrintInput(command("-"), { stdin: stream("a\nb"), terminal: PIPED })).toEqual(
    { ok: true, value: "a\nb" },
  );
  expect(await resolvePrintInput(command("q"), { stdin: stream("data"), terminal: PIPED })).toEqual(
    { ok: true, value: "q\n\ndata" },
  );
  expect(await resolvePrintInput(command("q"), { stdin: stream(""), terminal: PIPED })).toEqual({
    ok: true,
    value: "q",
  });
});

test("an empty or whitespace input is a usage failure with code 2", async () => {
  const result = await resolvePrintInput(command("-"), { stdin: stream("  \n"), terminal: PIPED });
  expect(result).toMatchObject({ ok: false, error: { code: 2, message: "입력이 비어 있다" } });
});

test("an input over 1 MiB is a usage failure with code 2, whichever way it arrives", async () => {
  const big = "x".repeat(1_048_577);
  expect(
    await resolvePrintInput(command("-"), { stdin: stream(big), terminal: PIPED }),
  ).toMatchObject({
    ok: false,
    error: { code: 2 },
  });
  expect(await resolvePrintInput(command(big), { stdin: stream(""), terminal: TTY })).toMatchObject(
    {
      ok: false,
      error: { code: 2 },
    },
  );
});
