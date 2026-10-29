import { expect, test } from "bun:test";
import { parseArgv, type ChatCommand, type TerminalFacts } from "../src/cli/command.ts";
import { threadId } from "./support/ids.ts";

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };
const PIPE_IN: TerminalFacts = { stdinIsTty: false, stdoutIsTty: true };
const PIPE_OUT: TerminalFacts = { stdinIsTty: true, stdoutIsTty: false };

function chat(argv: readonly string[], terminal: TerminalFacts = TTY): ChatCommand {
  const parsed = parseArgv(argv, terminal, {});
  if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.code}`);
  if (parsed.value.command.kind !== "chat") throw new Error("not a chat command");
  return parsed.value.command;
}

function colorOf(env: Record<string, string>): boolean | undefined {
  const parsed = parseArgv(["chat"], TTY, env);
  return parsed.ok ? parsed.value.global.color : undefined;
}

function code(argv: readonly string[], terminal: TerminalFacts = TTY): string {
  const parsed = parseArgv(argv, terminal, {});
  return parsed.ok ? "ok" : parsed.error.code;
}

test("no arguments on a tty is the interactive chat", () => {
  expect(chat([])).toEqual({
    kind: "chat",
    mode: "interactive",
    input: null,
    output: "text",
    target: { kind: "new" },
    overrides: [],
    safeMode: false,
    autoApprove: false,
  });
  expect(chat(["chat"])).toEqual(chat([]));
});

test("-p <input> is print mode with that input", () => {
  expect(chat(["chat", "-p", "hello world"])).toMatchObject({
    mode: "print",
    input: "hello world",
    output: "text",
  });
  expect(chat(["-p", "x"])).toMatchObject({ mode: "print", input: "x" });
  expect(chat(["chat", "--print", "x"])).toMatchObject({ mode: "print", input: "x" });
  expect(chat(["chat", "--print=x"])).toMatchObject({ mode: "print", input: "x" });
});

test("-p - and a bare -p read stdin", () => {
  expect(chat(["chat", "-p", "-"])).toMatchObject({ mode: "print", input: "-" });
  expect(chat(["chat", "-p"])).toMatchObject({ mode: "print", input: "-" });
  expect(chat(["chat", "-p", "--json"])).toMatchObject({
    mode: "print",
    input: "-",
    output: "json",
  });
});

test("--json selects the JSON output in print mode", () => {
  expect(chat(["chat", "-p", "x", "--json"])).toMatchObject({ mode: "print", output: "json" });
});

test("--continue and --resume <id> choose the target", () => {
  expect(chat(["chat", "--continue"]).target).toEqual({ kind: "continue" });
  const id = threadId(7);
  expect(chat(["chat", "--resume", id]).target).toEqual({ kind: "resume", threadId: id });
});

test("--json with the interactive mode is jsonRequiresPrint", () => {
  expect(code(["chat", "--json"])).toBe("jsonRequiresPrint");
});

test("--auto-approve is accepted in print mode, sets autoApprove, and is off by default", () => {
  expect(chat(["chat", "-p", "x", "--auto-approve"])).toMatchObject({
    mode: "print",
    input: "x",
    autoApprove: true,
  });
  expect(chat(["--auto-approve"], PIPE_IN)).toMatchObject({ mode: "print", autoApprove: true });
  expect(chat(["chat", "-p", "x"]).autoApprove).toBe(false);
});

test("--auto-approve with the interactive mode is autoApproveRequiresPrint", () => {
  expect(code(["chat", "--auto-approve"])).toBe("autoApproveRequiresPrint");
  expect(code(["chat", "--auto-approve", "--json"])).toBe("jsonRequiresPrint");
});

test("--continue together with --resume is conflictingFlags", () => {
  expect(code(["chat", "--continue", "--resume", threadId(7)])).toBe("conflictingFlags");
});

test("a malformed session id is invalidThreadId", () => {
  expect(code(["chat", "--resume", "thr_nope"])).toBe("invalidThreadId");
});

test("positional arguments and unknown flags are rejected", () => {
  expect(code(["chat", "hello"])).toBe("unexpectedArgument");
  expect(code(["chat", "--nope"])).toBe("unknownFlag");
  expect(code(["frobnicate"])).toBe("unknownCommand");
  expect(code(["chat", "--resume"])).toBe("missingArgument");
});

test("a repeated single-value flag is conflictingFlags", () => {
  expect(code(["chat", "-p", "a", "-p", "b"])).toBe("conflictingFlags");
});

test("a non-tty stdin switches to print mode reading stdin", () => {
  expect(chat([], PIPE_IN)).toMatchObject({ mode: "print", input: "-" });
});

test("a non-tty stdout without input is inputRequired", () => {
  expect(code([], PIPE_OUT)).toBe("inputRequired");
  expect(chat(["-p", "x"], PIPE_OUT)).toMatchObject({ mode: "print", input: "x" });
});

test("global flags before and after the command are read", () => {
  const before = parseArgv(["--no-color", "-C", "/tmp/w", "chat", "-p", "x"], TTY, {});
  expect(before.ok && before.value.global).toEqual({ cwd: "/tmp/w", color: false, remote: null });
  const after = parseArgv(["chat", "-p", "x", "--no-color", "-C", "/tmp/v"], TTY, {});
  expect(after.ok && after.value.global).toEqual({ cwd: "/tmp/v", color: false, remote: null });
});

test("--remote is a global flag: before or after the command, with its value, default null", () => {
  const before = parseArgv(["--remote", "unix:/run/x.sock", "chat", "-p", "x"], TTY, {});
  expect(before.ok && before.value.global.remote).toBe("unix:/run/x.sock");
  expect(before.ok && before.value.command.kind).toBe("chat");
  const after = parseArgv(["chat", "-p", "x", "--remote", "tcp://box:7000"], TTY, {});
  expect(after.ok && after.value.global.remote).toBe("tcp://box:7000");
  const both = parseArgv(["sessions", "ls", "--remote", "ssh://me@box/run/x.sock"], TTY, {});
  expect(both.ok && both.value.global.remote).toBe("ssh://me@box/run/x.sock");
  const none = parseArgv(["chat", "-p", "x"], TTY, {});
  expect(none.ok && none.value.global.remote).toBeNull();
});

test("--remote without a value is a usage error, before or after the command", () => {
  expect(code(["--remote"])).toBe("missingArgument");
  expect(code(["chat", "-p", "x", "--remote"])).toBe("missingArgument");
  expect(code(["--remote", "", "chat", "-p", "x"])).toBe("missingArgument");
  expect(code(["chat", "-p", "x", "--remote", ""])).toBe("missingArgument");
});

test("color is off for NO_COLOR and TERM=dumb and on otherwise", () => {
  expect(colorOf({})).toBe(true);
  expect(colorOf({ NO_COLOR: "1" })).toBe(false);
  expect(colorOf({ TERM: "dumb" })).toBe(false);
});

test("--help, -h and help produce a help command", () => {
  expect(parseArgv(["--help"], TTY, {})).toMatchObject({
    ok: true,
    value: { command: { kind: "help", topic: null } },
  });
  expect(parseArgv(["chat", "-h"], TTY, {})).toMatchObject({
    ok: true,
    value: { command: { kind: "help", topic: "chat" } },
  });
  expect(parseArgv(["help", "config"], TTY, {})).toMatchObject({
    ok: true,
    value: { command: { kind: "help", topic: "config" } },
  });
});

test("help wins over a parse error in the same command line", () => {
  expect(parseArgv(["chat", "--nope", "--help"], TTY, {})).toMatchObject({
    ok: true,
    value: { command: { kind: "help", topic: "chat" } },
  });
});

test("--safe-mode is a chat flag in any position and defaults to off", () => {
  expect(chat(["--safe-mode"]).safeMode).toBe(true);
  expect(chat(["chat", "--safe-mode"]).safeMode).toBe(true);
  expect(chat(["chat", "-p", "x", "--safe-mode"]).safeMode).toBe(true);
  expect(chat(["chat"]).safeMode).toBe(false);
  expect(code(["sessions", "ls", "--safe-mode"])).toBe("unknownFlag");
});
