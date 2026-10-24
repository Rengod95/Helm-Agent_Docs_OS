import { expect, test } from "bun:test";
import { parseArgv, type TerminalFacts } from "../src/cli/command.ts";

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };

function parsed(argv: readonly string[]): ReturnType<typeof parseArgv> {
  return parseArgv(argv, TTY, {});
}

test("--set a.b.c=1 becomes a session override with the raw value", () => {
  const result = parsed(["chat", "--set", "l1.loop.maxSteps=50"]);
  expect(result).toMatchObject({
    ok: true,
    value: {
      command: { kind: "chat", overrides: [{ key: "l1.loop.maxSteps", raw: "50" }] },
    },
  });
});

test("--set can repeat and keeps everything after the first = in the value", () => {
  const result = parsed(["chat", "--set", "l4.cli.theme=dark", "--set=l1.models.default=a/b=c"]);
  expect(result).toMatchObject({
    ok: true,
    value: {
      command: {
        overrides: [
          { key: "l4.cli.theme", raw: "dark" },
          { key: "l1.models.default", raw: "a/b=c" },
        ],
      },
    },
  });
});

test("a value is kept raw: JSON or plain text is decided by the host-side rule", () => {
  const result = parsed(["chat", "--set", 'l4.cli.statusLine=["model"]']);
  expect(result).toMatchObject({
    ok: true,
    value: { command: { overrides: [{ raw: '["model"]' }] } },
  });
});

test("a bad key is invalidSettingKey and a missing = is invalidOverride", () => {
  expect(parsed(["chat", "--set", "nokey=1"])).toMatchObject({
    ok: false,
    error: { code: "invalidSettingKey" },
  });
  expect(parsed(["chat", "--set", "l1.loop.maxSteps"])).toMatchObject({
    ok: false,
    error: { code: "invalidOverride" },
  });
  expect(parsed(["chat", "--set", "=1"])).toMatchObject({
    ok: false,
    error: { code: "invalidOverride" },
  });
});

test("an override's value never appears in the error text", () => {
  const result = parsed(["chat", "--set", "bad key=hunter2-secret-value"]);
  expect(result.ok).toBe(false);
  expect(JSON.stringify(result)).not.toContain("hunter2");
});

test("config set parses a key, a value and the file scope", () => {
  expect(parsed(["config", "set", "l4.cli.theme", "dark", "--scope", "project"])).toMatchObject({
    ok: true,
    value: {
      command: { kind: "config.set", key: "l4.cli.theme", raw: "dark", scope: "project" },
    },
  });
  expect(parsed(["config", "set", "l4.cli.theme", "dark"])).toMatchObject({
    ok: true,
    value: { command: { scope: "user" } },
  });
});

test("config set refuses the session and managed scopes", () => {
  expect(parsed(["config", "set", "l4.cli.theme", "dark", "--scope", "session"])).toMatchObject({
    ok: false,
    error: { code: "conflictingFlags" },
  });
  expect(parsed(["config", "reset", "l4.cli.theme", "--scope", "managed"])).toMatchObject({
    ok: false,
    error: { code: "conflictingFlags" },
  });
});

test("config get takes keys and --json; config list takes --prefix and --deprecated", () => {
  expect(parsed(["config", "get", "l4.cli.theme", "l4.cli.outputMode", "--json"])).toMatchObject({
    ok: true,
    value: {
      command: {
        kind: "config.get",
        keys: ["l4.cli.theme", "l4.cli.outputMode"],
        output: "json",
      },
    },
  });
  expect(parsed(["config", "list", "--prefix", "l4.", "--deprecated"])).toMatchObject({
    ok: true,
    value: { command: { kind: "config.list", prefix: "l4.", includeDeprecated: true } },
  });
});

test("config schema needs a scope from the four file scopes", () => {
  expect(parsed(["config", "schema"])).toMatchObject({
    ok: false,
    error: { code: "missingArgument" },
  });
  expect(parsed(["config", "schema", "--scope", "session"])).toMatchObject({
    ok: false,
    error: { code: "unexpectedArgument" },
  });
  expect(
    parsed(["config", "schema", "--scope", "managed", "--out", "s.json", "--core-only"]),
  ).toMatchObject({
    ok: true,
    value: {
      command: { kind: "config.schema", scope: "managed", out: "s.json", coreOnly: true },
    },
  });
});

test("config needs a known subcommand", () => {
  expect(parsed(["config"])).toMatchObject({ ok: false, error: { code: "missingArgument" } });
  expect(parsed(["config", "nope"])).toMatchObject({
    ok: false,
    error: { code: "unknownCommand" },
  });
});
