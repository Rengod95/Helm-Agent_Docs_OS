import { describe, expect, test } from "bun:test";
import { createRedactor } from "../src/redactor.ts";
import { nameOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// L0.secrets.spec §3.5.1 [결정: 2026-11-23 사용자, AGE-75]. 보류는 시크릿이 될 수 있는 열린 꼬리뿐이라서,
// 공백 없는 긴 도구 인자가 흐르는 동안 보이는 앞부분이 계속 나아간다. 가림을 지키는 시험은 `display-holdback.test.ts`다.

const HEX = "0123456789abcdef";

function hexText(seed: number, length: number): string {
  const random = seededRandom(seed);
  let out = "";
  for (let i = 0; i < length; i += 1) out += HEX[Math.floor(random() * HEX.length)] ?? "0";
  return out;
}

/**
 * 이 길이 넘게 뒤처지면 보류가 너무 넓은 것이다. 16진 글자만 있는 글에서 열린 꼬리 후보는 키 이름의 앞부분(`acce`)이나
 * `eyJ`의 앞부분(`e`)처럼 몇 글자뿐이다
 */
const MAX_LAG_PLAIN = 4;

describe("visible part keeps advancing", () => {
  test("a minified JSON tool argument with no whitespace is shown to within a few characters", () => {
    const redactor = createRedactor();
    const json = JSON.stringify({ path: "a/b.ts", content: hexText(1, 6000), mode: "w" });
    expect(json).not.toMatch(/\s/);
    let previous = 0;
    for (let n = 1; n <= json.length; n += 7) {
      const visible = redactor.displayVisibleLength(json.slice(0, n));
      expect(n - visible).toBeLessThanOrEqual(MAX_LAG_PLAIN);
      expect(visible).toBeGreaterThanOrEqual(previous);
      previous = visible;
    }
    expect(redactor.displayVisibleLength(json)).toBe(json.length);
  });

  test("a long run after a finished secret catches up once the secret is complete", () => {
    const redactor = createRedactor();
    const token = `ghp_${"B".repeat(36)}`;
    const text = `{"a":"${token}","b":"${hexText(2, 3000)}"}`;
    const start = text.indexOf(token);
    let sawHeld = false;
    for (let n = start; n <= text.length; n += 1) {
      const visible = redactor.displayVisibleLength(text.slice(0, n));
      if (n < start + token.length) {
        expect(visible).toBeLessThanOrEqual(start + "ghp_".length);
        sawHeld = sawHeld || visible < n;
      } else {
        expect(n - visible).toBeLessThanOrEqual(MAX_LAG_PLAIN);
      }
    }
    expect(sawHeld).toBe(true);
  });

  test("a known value is held while it is open and the text after it flows", () => {
    const value = fakeValue(seededRandom(3), 30);
    const redactor = createRedactor();
    expect(
      redactor.registerKnown(nameOf("progress-known"), new TextEncoder().encode(value)).ok,
    ).toBe(true);
    const text = `${hexText(4, 500)}${value}${hexText(5, 2000)}`;
    const start = 500;
    for (let n = start + 1; n <= text.length; n += 1) {
      const visible = redactor.displayVisibleLength(text.slice(0, n));
      if (n < start + value.length) expect(visible).toBeLessThanOrEqual(start + 1);
      else expect(n - visible).toBeLessThanOrEqual(MAX_LAG_PLAIN);
    }
  });

  test("each open secret shape is held from its start and nothing else", () => {
    const redactor = createRedactor();
    const upper = "A".repeat(80);
    const cases: readonly (readonly [string, string])[] = [
      ["see sk-ant-", "see "],
      ["see sk-ant-ABCDEFGHIJ", "see "],
      ["see AIza1234", "see "],
      ["see github_pat_AAAA", "see "],
      ["see xoxb-12345", "see "],
      ["see AKIAABCD", "see "],
      ["see AGE-SECRET-KEY-1ABC", "see "],
      ["see eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM", "see "],
      ["see eyJhbGciOiJIUzI1NiJ9", "see "],
      ["see postgres://app:pw", "see postgres://"],
      ["see password=abc", "see "],
      ["see api_key", "see "],
      ["see Authorization: Bearer ab", "see "],
      ["see token", "see "],
      ["see pas", "see "],
    ];
    for (const [text, held] of cases) {
      expect(redactor.displayVisibleLength(text)).toBe(held.length);
    }
    // 패턴이 다 오면 보류가 풀린다: 가림 구간이 덮는다
    for (const done of [
      `see sk-ant-${"A".repeat(20)}`,
      `see AIza${"A".repeat(35)}`,
      `see ghp_${"A".repeat(36)}`,
      `see AKIA${"A".repeat(16)}`,
      `see password=${"A".repeat(8)}`,
      `see github_pat_${upper.slice(0, 50)}`,
    ]) {
      expect(redactor.displayVisibleLength(done)).toBe(done.length);
    }
  });

  test("an open PEM block is held until its end line, other text keeps flowing before it", () => {
    const redactor = createRedactor();
    const head = `-----BEGIN RSA ${["PRI", "VATE"].join("")} KEY-----`;
    const foot = `-----END RSA ${["PRI", "VATE"].join("")} KEY-----`;
    const open = `${hexText(6, 300)}${head}\n${hexText(7, 200)}`;
    expect(redactor.displayVisibleLength(open)).toBe(300);
    const closed = `${open}\n${foot}`;
    expect(redactor.displayVisibleLength(closed)).toBe(closed.length);
  });
});
