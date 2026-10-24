import { expect, test } from "bun:test";
import { parseArgv, type TerminalFacts } from "../src/cli/command.ts";

const TTY: TerminalFacts = { stdinIsTty: true, stdoutIsTty: true };
const VALUE = "s3cr3t-value-0123456789";

function errorOf(argv: readonly string[], terminal: TerminalFacts = TTY): string | null {
  const result = parseArgv(argv, terminal, {});
  if (result.ok) return null;
  // 오류 문구는 두 줄의 원료다: 값이 한 글자라도 들어 있으면 안 된다
  expect(JSON.stringify(result.error)).not.toContain(VALUE);
  return result.error.code;
}

test("a value after the name is secretValueInArgv and is never echoed (AC6)", () => {
  expect(errorOf(["secret", "add", "api-key", VALUE])).toBe("secretValueInArgv");
  expect(errorOf(["secret", "set", "api-key", VALUE])).toBe("secretValueInArgv");
  expect(errorOf(["secret", "rotate", "api-key", VALUE])).toBe("secretValueInArgv");
});

test("--value in any spelling is secretValueInArgv", () => {
  expect(errorOf(["secret", "set", "api-key", "--value", VALUE])).toBe("secretValueInArgv");
  expect(errorOf(["secret", "set", "api-key", `--value=${VALUE}`])).toBe("secretValueInArgv");
  expect(errorOf(["secret", "add", "api-key", "--password", VALUE])).toBe("secretValueInArgv");
  expect(errorOf(["secret", "add", "api-key", "--token", VALUE])).toBe("secretValueInArgv");
});

test("name=value is secretValueInArgv", () => {
  expect(errorOf(["secret", "add", `api-key=${VALUE}`])).toBe("secretValueInArgv");
  expect(errorOf(["secret", "meta", `api-key=${VALUE}`])).toBe("secretValueInArgv");
});

test("a bad name is invalidSecretName", () => {
  expect(errorOf(["secret", "add", "Bad_Name"])).toBe("invalidSecretName");
  expect(errorOf(["secret", "rm", "x"])).toBe("invalidSecretName");
});

test("add, set and rotate with only a name parse", () => {
  expect(errorOf(["secret", "add", "api-key", "--provider", "sops", "--desc", "x"])).toBeNull();
  expect(errorOf(["secret", "set", "api-key"])).toBeNull();
  expect(errorOf(["secret", "rotate", "api-key"])).toBeNull();
  expect(
    parseArgv(
      ["secret", "add", "api-key", "--hosts", "a.com,b.com", "--expires", "2027-01-31"],
      TTY,
      {},
    ),
  ).toMatchObject({
    ok: true,
    value: {
      command: {
        kind: "secret.add",
        name: "api-key",
        meta: { hosts: ["a.com", "b.com"], expires: "2027-01-31" },
      },
    },
  });
});

test("a malformed expiry date is rejected", () => {
  expect(errorOf(["secret", "add", "api-key", "--expires", "next-week"])).toBe(
    "unexpectedArgument",
  );
});

test("ls, rm, test parse; rm takes --yes and test/ls take --json", () => {
  expect(parseArgv(["secret", "ls", "--meta", "--usage", "--json"], TTY, {})).toMatchObject({
    ok: true,
    value: { command: { kind: "secret.ls", meta: true, usage: true, output: "json" } },
  });
  expect(parseArgv(["secret", "rm", "api-key", "--yes"], TTY, {})).toMatchObject({
    ok: true,
    value: { command: { kind: "secret.rm", yes: true } },
  });
  expect(parseArgv(["secret", "test", "api-key", "--json"], TTY, {})).toMatchObject({
    ok: true,
    value: { command: { kind: "secret.test", output: "json" } },
  });
});

test("secret reveal needs a tty on both ends and refuses --json (AC13)", () => {
  expect(errorOf(["secret", "reveal", "api-key"], { stdinIsTty: true, stdoutIsTty: false })).toBe(
    "revealRequiresTty",
  );
  expect(errorOf(["secret", "reveal", "api-key"], { stdinIsTty: false, stdoutIsTty: true })).toBe(
    "revealRequiresTty",
  );
  expect(errorOf(["secret", "reveal", "api-key"])).toBeNull();
  expect(errorOf(["secret", "reveal", "api-key", "--json"])).toBe("unknownFlag");
});

test("secret needs a known subcommand", () => {
  expect(errorOf(["secret"])).toBe("missingArgument");
  expect(errorOf(["secret", "frob"])).toBe("unknownCommand");
});
