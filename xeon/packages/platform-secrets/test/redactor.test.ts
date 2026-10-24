import { describe, expect, test } from "bun:test";
import { createRedactor } from "../src/redactor.ts";
import { forms, hexLower } from "./support/encode.ts";
import { nameOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

const encoder = new TextEncoder();
const NAME = nameOf("github-token");

function register(value: string): ReturnType<typeof createRedactor> {
  const redactor = createRedactor();
  expect(redactor.registerKnown(NAME, encoder.encode(value)).ok).toBe(true);
  return redactor;
}

describe("Redactor known values", () => {
  test("masks known value variants", () => {
    const value = fakeValue(seededRandom(11), 24, true);
    const redactor = register(value);
    for (const form of forms(value)) {
      const out = redactor.mask(`before ${form.text} after`);
      expect(out.text).not.toContain(form.text);
      expect(out.text).toContain("[REDACTED:known:github-token]");
      expect(out.hits.some((h) => h.kind === "known:github-token")).toBe(true);
    }
  });

  test("masks the plus-for-space url form", () => {
    const redactor = register("two words and more!");
    const out = redactor.mask("q=two+words+and+more!");
    expect(out.text).not.toContain("two+words");
  });

  test("counts every occurrence", () => {
    const value = fakeValue(seededRandom(12), 20);
    const redactor = register(value);
    const out = redactor.mask(`${value} and ${value} and ${hexLower(value)}`);
    expect(out.hits).toEqual([{ kind: "known:github-token", count: 3 }]);
  });

  test("registerKnown rejects short values", () => {
    const redactor = createRedactor();
    const name = nameOf("short-one");
    const seven = redactor.registerKnown(name, encoder.encode("1234567"));
    expect(seven.ok).toBe(false);
    if (!seven.ok) expect(seven.error).toEqual({ kind: "value_too_short", minBytes: 8 });
    expect(redactor.registerKnown(name, encoder.encode("12345678")).ok).toBe(true);
    expect(redactor.knownCount()).toBe(1);
  });

  test("containsKnown judges without changing text and forget removes the value", () => {
    const value = fakeValue(seededRandom(13), 20);
    const redactor = register(value);
    expect(redactor.containsKnown(`x ${value} y`)).toBe(true);
    expect(redactor.containsKnown("nothing here")).toBe(false);
    redactor.forget(NAME);
    expect(redactor.containsKnown(`x ${value} y`)).toBe(false);
    expect(redactor.mask(value).text).toBe(value);
  });

  test("same value registered twice is idempotent and rotated values coexist until forget", () => {
    const first = fakeValue(seededRandom(14), 20);
    const second = fakeValue(seededRandom(15), 20);
    const redactor = register(first);
    redactor.registerKnown(NAME, encoder.encode(first));
    redactor.registerKnown(NAME, encoder.encode(second));
    expect(redactor.mask(`${first} ${second}`).hits).toEqual([
      { kind: "known:github-token", count: 2 },
    ]);
  });
});

describe("Redactor patterns", () => {
  const rand = seededRandom(21);
  const alnum = (n: number): string => fakeValue(rand, n);
  const upper = (n: number): string =>
    fakeValue(rand, n)
      .toUpperCase()
      .replaceAll(/[^A-Z0-9]/g, "A");
  // 저장소의 비밀 스캐너가 소스 리터럴로 오인하지 않게 토큰은 조각을 이어 만든다
  const tokens: readonly [string, string][] = [
    ["anthropic_key", ["sk", "-ant-", alnum(30)].join("")],
    ["openai_key", ["sk", "-proj-", alnum(30)].join("")],
    ["github_token", ["gh", "p_", alnum(36)].join("")],
    ["github_pat", ["github", "_pat_", alnum(60)].join("")],
    ["slack_token", ["xo", "xb-", alnum(20)].join("")],
    ["aws_access_key", ["AK", "IA", upper(16)].join("")],
    ["age_key", ["AGE-SECRET-", "KEY-1", upper(58).padEnd(58, "A").slice(0, 58)].join("")],
    ["jwt", ["ey", "J", alnum(20), ".", alnum(20), ".", alnum(20)].join("")],
    [
      "private_key",
      ["-----BEGIN ", "PRIVATE KEY-----\n", alnum(40), "\n-----END ", "PRIVATE KEY-----"].join(""),
    ],
  ];

  test("masks prefix patterns and kv context", () => {
    const redactor = createRedactor();
    for (const [kind, token] of tokens) {
      const out = redactor.mask(`value is ${token} end`);
      expect(out.text).toBe(`value is [REDACTED:${kind}] end`);
      expect(out.hits).toEqual([{ kind, count: 1 }]);
    }
    const kv = redactor.mask("password=hunter2hunter2 and api_key: 'abcdefgh1234'");
    expect(kv.text).toBe("password=[REDACTED:kv] and api_key: '[REDACTED:kv]'");
    expect(redactor.mask("Authorization: Bearer abcdefghijkl").text).toBe(
      "Authorization: Bearer [REDACTED:kv]",
    );
    expect(redactor.mask("postgres://app:longpassword@db.example.test/x").text).toBe(
      "postgres://app:[REDACTED:kv]@db.example.test/x",
    );
  });

  test("keeps handles, short values and ordinary words", () => {
    const redactor = createRedactor();
    expect(redactor.mask("use secret://github-token for this").text).toBe(
      "use secret://github-token for this",
    );
    expect(redactor.mask("password=short").text).toBe("password=short");
    expect(redactor.mask("bypassed and tokenizer ok").text).toBe("bypassed and tokenizer ok");
  });

  test("does not apply entropy check to tool output", () => {
    const redactor = createRedactor();
    const uuid = "3f2b8c1e-9d4a-4b7e-8a61-2c5d7e9f0a1b";
    const gitHash = "e83c5163316f89bfbde7d9ab23ca2e25604af290";
    const text = `commit ${gitHash} id ${uuid}`;
    expect(redactor.mask(text).text).toBe(text);
    expect(redactor.mask(text).hits).toEqual([]);
  });

  test("a known-value marker is not masked a second time by the kv rule", () => {
    const value = fakeValue(seededRandom(31), 20);
    const redactor = register(value);
    const out = redactor.mask(`token=${value}`);
    expect(out.text).toBe("token=[REDACTED:known:github-token]");
    expect(out.hits).toEqual([{ kind: "known:github-token", count: 1 }]);
  });
});

describe("maskDeep", () => {
  test("masks every string in plain objects and arrays and leaves other values alone", () => {
    const value = fakeValue(seededRandom(41), 20);
    const redactor = register(value);
    const when = new Date(0);
    const input = {
      a: `x ${value}`,
      b: [1, true, null, `y ${value}`, { c: value }],
      when,
      count: 3,
    };
    const out = redactor.maskDeep(input);
    expect(out.value.a).toBe("x [REDACTED:known:github-token]");
    expect(out.value.b[4]).toEqual({ c: "[REDACTED:known:github-token]" });
    expect(out.value.when).toBe(when);
    expect(out.value.count).toBe(3);
    expect(out.hits).toEqual([{ kind: "known:github-token", count: 3 }]);
    expect(input.a).toContain(value);
  });

  test("tolerates cycles", () => {
    const redactor = createRedactor();
    const loop: Record<string, unknown> = { name: "n" };
    loop["self"] = loop;
    expect(redactor.maskDeep(loop).value["name"]).toBe("n");
  });
});
