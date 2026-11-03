import { describe, expect, test } from "bun:test";
import type { MaskRange } from "@fresnel/contracts/conversation";
import { createRedactor } from "../src/redactor.ts";
import { forms } from "./support/encode.ts";
import { nameOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// L0.secrets.spec §3.5.1 [결정: 2026-11-03 사용자]. 화면 가림 구간은 원문 위치로 계산하고 값을 돌려주지 않는다.
// 시험은 구간을 원문에 적용한 결과(클라이언트가 그리는 문자열)에 값이나 패턴 일치가 남지 않는지 본다.

const encoder = new TextEncoder();
const NAME = nameOf("display-token");

/** 클라이언트의 적용과 같은 규칙. 구간을 `[REDACTED:<표지>]`로 바꾼다 */
function applyRanges(text: string, ranges: readonly MaskRange[]): string {
  let out = "";
  let at = 0;
  for (const range of ranges) {
    out += text.slice(at, range.start) + `[REDACTED:${range.label}]`;
    at = range.end;
  }
  return out + text.slice(at);
}

function registered(value: string): ReturnType<typeof createRedactor> {
  const redactor = createRedactor();
  expect(redactor.registerKnown(NAME, encoder.encode(value)).ok).toBe(true);
  return redactor;
}

describe("displayRanges", () => {
  test("a registered value in a sentence is covered and the rest is kept", () => {
    const value = fakeValue(seededRandom(21), 24);
    const redactor = registered(value);
    const text = `before ${value} after`;
    const ranges = redactor.displayRanges(text);
    expect(ranges).toEqual([
      {
        start: "before ".length,
        end: "before ".length + value.length,
        label: "known:display-token",
      },
    ]);
    expect(applyRanges(text, ranges)).toBe("before [REDACTED:known:display-token] after");
  });

  test("every registered form is covered, not only the raw value", () => {
    const value = fakeValue(seededRandom(22), 24, true);
    const redactor = registered(value);
    for (const form of forms(value)) {
      const text = `x ${form.text} y`;
      const shown = applyRanges(text, redactor.displayRanges(text));
      expect(shown).not.toContain(form.text);
      expect(shown).toContain("[REDACTED:known:display-token]");
    }
  });

  test("a value that matches only a pattern (no registration) is covered", () => {
    const redactor = createRedactor();
    const token = `ghp_${"a".repeat(36)}`;
    const text = `token is ${token} ok`;
    const ranges = redactor.displayRanges(text);
    expect(ranges).toEqual([{ start: 9, end: 9 + token.length, label: "github_token" }]);
    expect(applyRanges(text, ranges)).not.toContain(token);
  });

  test("key-value context covers only the value part", () => {
    const redactor = createRedactor();
    const text = "password=hunter2hunter2 and more";
    const ranges = redactor.displayRanges(text);
    expect(ranges).toEqual([{ start: 9, end: 9 + "hunter2hunter2".length, label: "kv" }]);
    expect(applyRanges(text, ranges)).toBe("password=[REDACTED:kv] and more");
  });

  test("positions are UTF-16 offsets in the original string (Korean before the value)", () => {
    const value = fakeValue(seededRandom(23), 24);
    const redactor = registered(value);
    const text = `가나다 라마바 ${value}`;
    const ranges = redactor.displayRanges(text);
    expect(ranges[0]?.start).toBe("가나다 라마바 ".length);
    expect(applyRanges(text, ranges)).not.toContain(value);
  });

  test("text without any rule hit has no ranges", () => {
    const redactor = createRedactor();
    expect(redactor.displayRanges("plain words, nothing secret here")).toEqual([]);
  });

  test("overlapping hits merge into one range with the earlier rule's label", () => {
    const redactor = createRedactor();
    // 접두 패턴과 키-값이 같은 값을 가리킨다. 하나의 구간으로 합친다
    const token = `ghp_${"b".repeat(36)}`;
    const text = `token=${token}`;
    const ranges = redactor.displayRanges(text);
    expect(ranges.length).toBe(1);
    expect(applyRanges(text, ranges)).not.toContain(token);
  });
});

describe("displayVisibleLength (streaming holdback)", () => {
  test("a finished word before a space is shown, the open tail is held", () => {
    const redactor = createRedactor();
    const text = "hello wor";
    expect(redactor.displayVisibleLength(text)).toBe("hello ".length);
  });

  test("a partial known value at the tail is held until the rest arrives", () => {
    const value = fakeValue(seededRandom(24), 24);
    const redactor = registered(value);
    const partial = `see ${value.slice(0, 10)}`;
    expect(redactor.displayVisibleLength(partial)).toBe("see ".length);
    expect(redactor.displayVisibleLength(`see ${value} `)).toBe(`see ${value} `.length);
  });

  test("a known value with a space inside is held while its first part is the tail", () => {
    const redactor = registered("correct horse battery");
    expect(redactor.displayVisibleLength("say correct horse")).toBe("say ".length);
    expect(redactor.displayVisibleLength("say correct horse battery ok")).toBe(
      "say correct horse battery ".length,
    );
  });

  test("an open PEM block is held from its BEGIN line until the END line is in the visible part", () => {
    const redactor = createRedactor();
    // 헤더는 인증서로 쓴다. 개인 키 헤더 문자열은 비밀 탐지기가 잡으므로 시험 파일에 두지 않는다. 보류는 BEGIN 줄에 걸린다
    const open = "key:\n-----BEGIN CERTIFICATE-----\nbody-line-one";
    expect(redactor.displayVisibleLength(open)).toBe("key:\n".length);
    const closed = `${open}\n-----END CERTIFICATE-----\n`;
    expect(redactor.displayVisibleLength(closed)).toBe(closed.length);
  });

  test("a complete private key block is one private_key range and its body never shows", () => {
    const redactor = createRedactor();
    const block = "-----BEGIN RSA PRIVATE KEY-----\nbody-line-one\n-----END RSA PRIVATE KEY-----";
    const text = `before ${block} after`;
    const ranges = redactor.displayRanges(text);
    expect(ranges).toEqual([{ start: 7, end: 7 + block.length, label: "private_key" }]);
    expect(applyRanges(text, ranges)).not.toContain("body-line-one");
  });

  test("the visible prefix never cuts a pattern match in half", () => {
    const redactor = createRedactor();
    const token = `ghp_${"c".repeat(36)}`;
    const text = `a ${token} b`;
    for (let n = 0; n <= text.length; n += 1) {
      const cut = redactor.displayVisibleLength(text.slice(0, n));
      const shown = applyRanges(text.slice(0, cut), redactor.displayRanges(text.slice(0, cut)));
      expect(shown).not.toContain(token.slice(0, 8));
    }
  });
});

describe("displayLeafMasks", () => {
  test("reports leaves with hits under their RFC 6901 pointers and skips clean leaves", () => {
    const redactor = createRedactor();
    const value = {
      kind: "assistant",
      content: [
        { type: "text", text: "clean" },
        { type: "text", text: "password=hunter2hunter2" },
      ],
    };
    const masks = redactor.displayLeafMasks(value, "/message");
    expect(masks).toEqual([
      {
        pointer: "/message/content/1/text",
        len: "password=hunter2hunter2".length,
        ranges: [{ start: 9, end: 9 + 14, label: "kv" }],
      },
    ]);
  });

  test("a string under a sensitive key is covered whole even without a pattern hit", () => {
    const redactor = createRedactor();
    const value = { api_key: "mask-probe-one" };
    const masks = redactor.displayLeafMasks(value, "/message");
    expect(masks).toEqual([
      { pointer: "/message/api_key", len: 14, ranges: [{ start: 0, end: 14, label: "kv" }] },
    ]);
  });

  test("short values under a sensitive key and non-sensitive keys are left alone", () => {
    const redactor = createRedactor();
    expect(redactor.displayLeafMasks({ password: "short" }, "")).toEqual([]);
    expect(redactor.displayLeafMasks({ title: "mask-probe-one" }, "")).toEqual([]);
  });

  test("keys are escaped as RFC 6901 tokens", () => {
    const redactor = createRedactor();
    const masks = redactor.displayLeafMasks({ "a/b~c": "password=hunter2hunter2" }, "/m");
    expect(masks.map((m) => m.pointer)).toEqual(["/m/a~1b~0c"]);
  });

  test("the same object reached by two paths is reported on both paths", () => {
    const redactor = createRedactor();
    const shared = { text: "token=maskprobe" };
    const masks = redactor.displayLeafMasks({ a: shared, b: shared }, "");
    expect(masks.map((m) => m.pointer).toSorted()).toEqual(["/a/text", "/b/text"]);
  });

  test("a cycle does not loop forever", () => {
    const redactor = createRedactor();
    const cyclic: Record<string, unknown> = { text: "password=hunter2hunter2" };
    cyclic["self"] = cyclic;
    expect(redactor.displayLeafMasks(cyclic, "").map((m) => m.pointer)).toEqual(["/text"]);
  });

  test("a registered value in a nested leaf is reported", () => {
    const value = fakeValue(seededRandom(25), 24);
    const redactor = registered(value);
    const masks = redactor.displayLeafMasks([{ args: { cmd: `echo ${value}` } }], "/message");
    expect(masks).toEqual([
      {
        pointer: "/message/0/args/cmd",
        len: `echo ${value}`.length,
        ranges: [{ start: 5, end: 5 + value.length, label: "known:display-token" }],
      },
    ]);
  });
});
