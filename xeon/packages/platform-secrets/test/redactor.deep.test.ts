import { describe, expect, test } from "bun:test";
import { createRedactor } from "../src/redactor.ts";
import { nameOf } from "./support/names.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const NAME = nameOf("github-token");
const VALUE = "placeholder-value-0123456789";
// 값은 실행 때 만든다(비밀 스캐너가 소스의 고정 문자열을 시크릿으로 읽는다)
function fake(label: string): string {
  return `fixture-${label}-0123456789`;
}
const MARK = "[REDACTED:known:github-token]";

function register(): ReturnType<typeof createRedactor> {
  const redactor = createRedactor();
  expect(redactor.registerKnown(NAME, encoder.encode(VALUE)).ok).toBe(true);
  return redactor;
}

describe("kv rule with quoted keys (P-SECRET)", () => {
  test("masks a JSON quoted key and value", () => {
    const out = createRedactor().mask(`{"password": "${fake("pw")}", "user": "bob"}`);
    expect(out.text).toBe('{"password": "[REDACTED:kv]", "user": "bob"}');
    expect(out.hits).toEqual([{ kind: "kv", count: 1 }]);
  });

  test("masks single-quoted keys and compact JSON", () => {
    const redactor = createRedactor();
    expect(redactor.mask(`{'api_key':'${fake("key")}'}`).text).toBe(`{'api_key':'[REDACTED:kv]'}`);
    expect(redactor.mask(`{"token":"${fake("tok")}"}`).text).toBe('{"token":"[REDACTED:kv]"}');
  });

  test("keeps the unquoted forms working", () => {
    expect(createRedactor().mask(`password=${fake("pw")}`).text).toBe("password=[REDACTED:kv]");
  });
});

describe("maskDeep sensitive keys", () => {
  test("masks string values under sensitive object keys", () => {
    const input = {
      password: fake("pw"),
      accessToken: fake("tok"),
      "x-api-key": fake("key"),
      nested: [{ client_secret: fake("cs") }],
      name: fake("name"),
      short: { token: "abc" },
    };
    const out = createRedactor().maskDeep(input);
    expect(out.value).toEqual({
      password: "[REDACTED:kv]",
      accessToken: "[REDACTED:kv]",
      "x-api-key": "[REDACTED:kv]",
      nested: [{ client_secret: "[REDACTED:kv]" }],
      name: fake("name"),
      short: { token: "abc" },
    });
    expect(out.hits).toEqual([{ kind: "kv", count: 4 }]);
  });
});

describe("maskDeep graph handling (SEC-01)", () => {
  test("masks an object reachable twice in both places", () => {
    const shared = { Authorization: `Bearer ${VALUE}` };
    const out = register().maskDeep({ req: shared, log: shared });
    expect(out.value.req.Authorization).toBe(`Bearer ${MARK}`);
    expect(out.value.log.Authorization).toBe(`Bearer ${MARK}`);
    expect(out.value.req).toBe(out.value.log);
  });

  test("masks a cycle and keeps it a cycle in the copy", () => {
    const loop: Record<string, unknown> = { text: VALUE };
    loop["self"] = loop;
    const out = register().maskDeep(loop);
    expect(out.value["text"]).toBe(MARK);
    expect(out.value["self"]).toBe(out.value);
    expect(out.value).not.toBe(loop);
    expect(loop["text"]).toBe(VALUE);
  });
});

describe("maskDeep non-plain values (SEC-02)", () => {
  test("masks Error message, stack, name and cause", () => {
    const cause = new Error(`inner ${VALUE}`);
    const error = new Error(`failed with ${VALUE}`, { cause });
    const out = register().maskDeep({ error });
    const masked = out.value.error;
    expect(masked).toBeInstanceOf(Error);
    expect(masked.message).toBe(`failed with ${MARK}`);
    expect(masked.stack ?? "").not.toContain(VALUE);
    expect(masked.cause).toBeInstanceOf(Error);
    expect(masked.cause instanceof Error ? masked.cause.message : "").toBe(`inner ${MARK}`);
    expect(error.message).toContain(VALUE);
  });

  test("masks Uint8Array contents", () => {
    const bytes = encoder.encode(`data ${VALUE} end`);
    const out = register().maskDeep({ bytes });
    expect(out.value.bytes).toBeInstanceOf(Uint8Array);
    expect(decoder.decode(out.value.bytes)).toBe(`data ${MARK} end`);
    expect(decoder.decode(bytes)).toContain(VALUE);
  });

  test("masks Map and Set entries", () => {
    const map = new Map<string, unknown>([[`k-${VALUE}`, `v ${VALUE}`]]);
    const set = new Set([VALUE]);
    const out = register().maskDeep({ map, set });
    expect([...out.value.map]).toEqual([[`k-${MARK}`, `v ${MARK}`]]);
    expect([...out.value.set]).toEqual([MARK]);
  });

  test("masks own fields of class instances and keeps the prototype", () => {
    class Holder {
      readonly text = `held ${VALUE}`;
    }
    const out = register().maskDeep({ holder: new Holder() });
    expect(out.value.holder).toBeInstanceOf(Holder);
    expect(out.value.holder.text).toBe(`held ${MARK}`);
  });
});

describe("maskStream (SEC-03)", () => {
  test("masks a value split across chunk boundaries", () => {
    const stream = register().maskStream();
    const cut = 12;
    const first = stream.push(`before ${VALUE.slice(0, cut)}`);
    const second = stream.push(`${VALUE.slice(cut)} after`);
    const rest = stream.flush();
    const joined = first.text + second.text + rest.text;
    expect(joined).toBe(`before ${MARK} after`);
    expect(joined).not.toContain(VALUE.slice(0, cut));
    const total = [...first.hits, ...second.hits, ...rest.hits]
      .filter((hit) => hit.kind === "known:github-token")
      .reduce((sum, hit) => sum + hit.count, 0);
    expect(total).toBe(1);
  });

  test("every split point of the value is masked", () => {
    const redactor = register();
    for (let cut = 1; cut < VALUE.length; cut += 1) {
      const stream = redactor.maskStream();
      const out =
        stream.push(`a ${VALUE.slice(0, cut)}`).text +
        stream.push(`${VALUE.slice(cut)} b`).text +
        stream.flush().text;
      expect(out).toBe(`a ${MARK} b`);
    }
  });

  test("passes plain text through once flushed", () => {
    const stream = register().maskStream();
    const out = stream.push("hello ").text + stream.push("world").text + stream.flush().text;
    expect(out).toBe("hello world");
  });
});

describe("maskStream holding rules", () => {
  test("emits complete lines early and holds a trailing partial value", () => {
    const stream = register().maskStream();
    const first = stream.push(`line one\nsecret ${VALUE.slice(0, 10)}`);
    expect(first.text).toBe("line one\n");
    const second = stream.push(`${VALUE.slice(10)}\nnext\n`);
    expect(second.text).toBe(`secret ${MARK}\nnext\n`);
    expect(stream.flush().text).toBe("");
  });

  test("a long line without newline is released in part and still masked", () => {
    const stream = register().maskStream();
    const filler = "x".repeat(5000);
    const early = stream.push(filler);
    expect(early.text.length).toBeGreaterThan(0);
    const out = early.text + stream.push(VALUE.slice(0, 7)).text;
    const rest = stream.push(VALUE.slice(7)).text + stream.flush().text;
    expect(out + rest).toBe(`${filler}${MARK}`);
  });
});
