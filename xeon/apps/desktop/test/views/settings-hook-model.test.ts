import { describe, expect, test } from "bun:test";
import {
  commandLineOf,
  draftOfHook,
  EMPTY_HOOK_DRAFT,
  hookOfDraft,
  hooksOf,
  withHook,
  withoutHook,
} from "../../src/views/pages/settings/settings-hook-model.ts";

// 외부 훅 정의 편집기의 순수 모델(X.operations §4.7.1). 값은 `toEqual`로 비교한다.

const POINTS = ["tool.call.before", "thread.start"];

describe("hookOfDraft", () => {
  test("a filled form becomes a hook with only the fields that were set", () => {
    const result = hookOfDraft(
      {
        ...EMPTY_HOOK_DRAFT,
        id: "no-rm",
        point: "tool.call.before",
        command: "./check.sh\n--fast\n",
        tools: "bash, shell",
        cwd: "home",
        timeoutMs: "5000",
        env: "MY_VAR",
      },
      POINTS,
      [],
    );
    expect(result).toEqual({
      ok: true,
      row: {
        id: "no-rm",
        point: "tool.call.before",
        command: ["./check.sh", "--fast"],
        tools: ["bash", "shell"],
        cwd: "home",
        timeoutMs: 5000,
        env: ["MY_VAR"],
      },
    });
  });

  test("the minimal form leaves optional fields out", () => {
    expect(
      hookOfDraft(
        { ...EMPTY_HOOK_DRAFT, id: "log-start", point: "thread.start", command: "/bin/true" },
        POINTS,
        [],
      ),
    ).toEqual({
      ok: true,
      row: { id: "log-start", point: "thread.start", command: ["/bin/true"] },
    });
  });

  test("each bad field names its issue", () => {
    const base = { ...EMPTY_HOOK_DRAFT, id: "ok-id", point: "thread.start", command: "x" };
    const issue = (patch: Partial<typeof base>, others: readonly string[] = []) => {
      const result = hookOfDraft({ ...base, ...patch }, POINTS, others);
      return result.ok ? "none" : result.issue;
    };
    expect(issue({ id: "A" })).toBe("id");
    expect(issue({}, ["ok-id"])).toBe("idDuplicate");
    expect(issue({ point: "nope" })).toBe("point");
    expect(issue({ command: "  \n " })).toBe("command");
    expect(issue({ tools: "a b" })).toBe("tools");
    expect(issue({ timeoutMs: "50" })).toBe("timeout");
    expect(issue({ timeoutMs: "1.5" })).toBe("timeout");
    expect(issue({ env: "lower" })).toBe("env");
    expect(issue({})).toBe("none");
  });
});

describe("hooksOf and list edits", () => {
  const value = [
    { id: "aa", point: "thread.start", command: ["x", "y"], timeoutMs: 200, cwd: "home" },
    { id: "bb", point: "tool.call.before", command: ["z"], tools: ["bash"], env: ["A"] },
  ] as const;

  test("reads a well-formed value and round-trips through the draft form", () => {
    const rows = hooksOf(value);
    expect(rows).toEqual(value);
    const first = rows?.[0];
    if (first === undefined) throw new Error("row expected");
    expect(hookOfDraft(draftOfHook(first), POINTS, [])).toEqual({ ok: true, row: first });
  });

  test("a malformed element makes the whole value unreadable", () => {
    expect(hooksOf([{ id: "aa", point: "thread.start", command: "not-a-list" }])).toBeNull();
    expect(hooksOf({})).toBeNull();
    expect(hooksOf([1])).toBeNull();
  });

  test("withHook replaces or appends, withoutHook drops one", () => {
    const rows = hooksOf(value) ?? [];
    const added = withHook(rows, null, { id: "cc", point: "thread.start", command: ["q"] });
    expect(added.map((row) => row.id)).toEqual(["aa", "bb", "cc"]);
    const replaced = withHook(rows, 0, { id: "aa", point: "thread.start", command: ["new"] });
    expect(replaced[0]?.command).toEqual(["new"]);
    expect(withoutHook(rows, 0).map((row) => row.id)).toEqual(["bb"]);
  });

  test("commandLineOf quotes arguments that contain spaces", () => {
    expect(commandLineOf(["./a.sh", "two words", "--x"])).toBe('./a.sh "two words" --x');
  });
});
