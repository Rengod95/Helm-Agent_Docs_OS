import { describe, expect, test } from "bun:test";
import { settingsFileWith, type AccountEntry } from "../../src/accounts/index.ts";
import { parseJson, type Result } from "@xeon/contracts";

const account: AccountEntry = {
  provider: "anthropic",
  accountId: "a",
  credential: "secret://acct-a",
  priority: 1,
  reservePct: 0,
};

/** 성공이 아니면 시험을 실패시킨다(조용히 통과하지 않게) */
function textOf(result: Result<string, unknown>): string {
  if (!result.ok) throw new Error(`expected a file text, got ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("settings file text", () => {
  test("an empty file becomes an object holding only the edited keys, pretty printed with a trailing newline", () => {
    expect(settingsFileWith("", { acknowledged: true })).toEqual({
      ok: true,
      value: '{\n  "ext.account-rotation.acknowledgeRisk": true\n}\n',
    });
  });

  test("the other keys and their order stay, and an edited key keeps its place", () => {
    const text = '{"b":1,"l1.models.accounts":[],"a":{"k":[1]}}';
    const result = settingsFileWith(text, { accounts: [account], acknowledged: false });
    expect(textOf(result)).toBe(
      [
        "{",
        '  "b": 1,',
        '  "l1.models.accounts": [',
        "    {",
        '      "provider": "anthropic",',
        '      "accountId": "a",',
        '      "credential": "secret://acct-a",',
        '      "priority": 1,',
        '      "reservePct": 0',
        "    }",
        "  ],",
        '  "a": {',
        '    "k": [',
        "      1",
        "    ]",
        "  },",
        '  "ext.account-rotation.acknowledgeRisk": false',
        "}",
        "",
      ].join("\n"),
    );
  });

  test("keys that are not edited keep their values exactly", () => {
    const text =
      '{"l1.models.default":"anthropic/claude-sonnet-5-5","ext.unknown.key":{"keep":true}}';
    const result = settingsFileWith(text, { acknowledged: true });
    expect(parseJson(textOf(result))).toEqual({
      ok: true,
      value: {
        "l1.models.default": "anthropic/claude-sonnet-5-5",
        "ext.unknown.key": { keep: true },
        "ext.account-rotation.acknowledgeRisk": true,
      },
    });
  });

  test("an edit with no keys only reformats the file", () => {
    expect(settingsFileWith('{"a":1}', {})).toEqual({ ok: true, value: '{\n  "a": 1\n}\n' });
  });

  test("text that is not a JSON object is not_object and nothing is written", () => {
    expect(settingsFileWith("[1]", { acknowledged: true })).toEqual({
      ok: false,
      error: { kind: "not_object" },
    });
    expect(settingsFileWith("5", { acknowledged: true })).toEqual({
      ok: false,
      error: { kind: "not_object" },
    });
    expect(settingsFileWith("null", { acknowledged: true })).toEqual({
      ok: false,
      error: { kind: "not_object" },
    });
    expect(settingsFileWith('{"a":', { acknowledged: true })).toEqual({
      ok: false,
      error: { kind: "not_object" },
    });
  });
});
