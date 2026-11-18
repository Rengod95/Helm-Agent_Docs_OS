import { describe, expect, test } from "bun:test";
import { createRedactor } from "../src/redactor.ts";
import { findJwts, findPrivateKeyBlocks, findUserinfoValues } from "../src/linear-scan.ts";
import { seededRandom } from "./support/random.ts";

// L0.secrets.spec §3.5 큰 내용의 시간. 가림 규칙은 분리된(큰) 값에도 같은 규칙으로 적용되고(AGE-59), 입력 길이에 선형이어야 한다.
// 선형 탐색은 옛 정규식과 같은 자리를 찾아야 한다(옛 정규식을 기준으로 견준다).

const DASHES = "-----";
const BEGIN_KEY = `${DASHES}BEGIN PRIVATE KEY${DASHES}`;
const OLD_PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const OLD_JWT = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const OLD_USERINFO = /([a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)([^\s@/]+)(@)/gi;

const PIECES = [
  BEGIN_KEY,
  `${DASHES}BEGIN RSA PRIVATE KEY${DASHES}`,
  `${DASHES}END PRIVATE KEY${DASHES}`,
  `${DASHES}END RSA PRIVATE KEY${DASHES}`,
  `${DASHES}BEGIN CERTIFICATE${DASHES}`,
  "eyJ",
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJhbGciOiJIUzI1NiJ9.",
  "abcdefghij.",
  "xyz1234567.",
  "Zk9-_0aaaaa",
  "http://user:",
  "HTTP://u:",
  "1ab://a:",
  "p@",
  "pw@h",
  ".",
  "..",
  "abcdefghij",
  "ABCDEFGHIJ1",
  "http",
  "https",
  "://",
  "a1",
  "1",
  "+x",
  "user",
  ":",
  "pw123456",
  "@",
  "host",
  "/",
  " ",
  "\n",
  "-",
  "_",
  "x",
];

function randomText(random: () => number): string {
  const count = 1 + Math.floor(random() * 14);
  let out = "";
  for (let i = 0; i < count; i += 1) {
    out += PIECES[Math.floor(random() * PIECES.length)] ?? "";
  }
  return out;
}

describe("linear scans match the old regular expressions", () => {
  test("PEM, JWT and userinfo spans equal the old matches on 4000 random texts", () => {
    const random = seededRandom(20260519);
    for (let i = 0; i < 4000; i += 1) {
      const text = randomText(random);
      const pem = [...text.matchAll(OLD_PEM)].map((m) => [m.index, m.index + m[0].length]);
      expect(findPrivateKeyBlocks(text).map((s) => [s.start, s.end])).toEqual(pem);
      const jwt = [...text.matchAll(OLD_JWT)].map((m) => [m.index, m.index + m[0].length]);
      expect(findJwts(text).map((s) => [s.start, s.end])).toEqual(jwt);
      const user = [...text.matchAll(OLD_USERINFO)].map((m) => {
        const start = m.index + (m[1] ?? "").length;
        return [start, start + (m[2] ?? "").length];
      });
      expect(findUserinfoValues(text).map((s) => [s.start, s.end])).toEqual(user);
    }
  });
});

const MIB = 1024 * 1024;

function timed<T>(work: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = work();
  return { value, ms: performance.now() - started };
}

describe("large text is masked in linear time", () => {
  const redactor = createRedactor();
  const DEADLINE_MS = 5000;

  test("a single lowercase run of 4 MiB has no match and finishes quickly", () => {
    const text = "a".repeat(4 * MIB);
    const masked = timed(() => redactor.mask(text));
    const ranges = timed(() => redactor.displayRanges(text));
    expect(masked.value.text.length).toBe(text.length);
    expect(masked.value.hits).toEqual([]);
    expect(ranges.value).toEqual([]);
    expect(masked.ms + ranges.ms).toBeLessThan(DEADLINE_MS);
  });

  test("4 MiB of unterminated private key headers is left alone quickly", () => {
    const text = `${BEGIN_KEY}\n`.repeat(Math.ceil((4 * MIB) / 28));
    const masked = timed(() => redactor.mask(text));
    expect(masked.value.text).toBe(text);
    expect(timed(() => redactor.displayRanges(text)).value).toEqual([]);
    expect(masked.ms).toBeLessThan(DEADLINE_MS);
  });

  test("many eyJ starts inside one token run do not rescan the run", () => {
    const text = "eyJabcdefghij".repeat(Math.ceil((4 * MIB) / 13));
    const masked = timed(() => redactor.mask(text));
    expect(masked.value.text).toBe(text);
    expect(masked.ms).toBeLessThan(DEADLINE_MS);
  });

  test("a secret after 4 MiB of lowercase is still masked, and so is one before it", () => {
    const filler = "a".repeat(4 * MIB);
    const key = "sk-" + "Z".repeat(30);
    const text = `${key} ${filler} password=hunter2hunter2 postgres://admin:s3cretpw@db`;
    const masked = redactor.mask(text);
    expect(masked.text).toBe(
      `[REDACTED:openai_key] ${filler} password=[REDACTED:kv] postgres://admin:[REDACTED:kv]@db`,
    );
    expect(masked.hits).toEqual([
      { kind: "openai_key", count: 1 },
      { kind: "kv", count: 2 },
    ]);
  });
});
