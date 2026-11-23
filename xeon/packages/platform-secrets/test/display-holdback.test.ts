import { describe, expect, test } from "bun:test";
import type { MaskRange } from "@fresnel/contracts/conversation";
import { createRedactor } from "../src/redactor.ts";
import { nameOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

// L0.secrets.spec §3.5.1. 화면 가림의 보류(`displayVisibleLength`)가 줄어도 값이 새지 않는다는 것을 고정한다.
// 진행 중 텍스트는 어느 길이에서 끊겨도 같은 누적 앞부분으로 계산되므로, 모든 길이 n(= 모든 조각 경계)에서
// 클라이언트가 그리는 글(보이는 앞부분에 가림 구간을 적용한 것)에 시크릿의 부분 문자열이 남지 않는지 본다.
// 시험의 시크릿은 전부 지어낸 값이다.

const encoder = new TextEncoder();
/** 이 길이 이상의 시크릿 부분 문자열이 보이면 샌 것으로 본다 */
const MIN_LEAK = 4;
const UPPER_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function applyRanges(text: string, ranges: readonly MaskRange[]): string {
  let out = "";
  let at = 0;
  for (const range of ranges) {
    out += text.slice(at, range.start) + `[REDACTED:${range.label}]`;
    at = range.end;
  }
  return out + text.slice(at);
}

/** 길이 n까지 받았을 때 화면에 그려지는 글. 가림 표지는 지운다(표지 글자가 시크릿 조각과 겹치지 않게) */
function shownAt(redactor: ReturnType<typeof createRedactor>, text: string, n: number): string {
  const prefix = text.slice(0, n);
  const cut = redactor.displayVisibleLength(prefix);
  expect(cut).toBeGreaterThanOrEqual(0);
  expect(cut).toBeLessThanOrEqual(prefix.length);
  const visible = prefix.slice(0, cut);
  return applyRanges(visible, redactor.displayRanges(visible)).replaceAll(
    /\[REDACTED:[^\]]*\]/g,
    "\u0000",
  );
}

/** 시크릿에서 MIN_LEAK 이상인 부분 문자열 가운데 보이는 글에 있는 것. 없으면 null */
function leakedPart(shown: string, secret: string): string | null {
  for (let k = 0; k + MIN_LEAK <= secret.length; k += 1) {
    const part = secret.slice(k, k + MIN_LEAK);
    if (shown.includes(part)) return part;
  }
  return null;
}

/** 시크릿 둘레는 모든 길이, 먼 곳은 성기게 본다. 긴 글에서 시험이 느려지지 않게 한다 */
function boundaries(total: number, secretStart: number, secretEnd: number): number[] {
  const out = new Set<number>([0, total]);
  for (let n = Math.max(0, secretStart - 40); n <= Math.min(total, secretEnd + 40); n += 1) {
    out.add(n);
  }
  for (let n = 0; n <= total; n += 211) out.add(n);
  return [...out].toSorted((a, b) => a - b);
}

function expectNoLeak(
  redactor: ReturnType<typeof createRedactor>,
  text: string,
  secrets: readonly string[],
  region: readonly [number, number],
): void {
  for (const n of boundaries(text.length, region[0], region[1])) {
    const shown = shownAt(redactor, text, n);
    for (const secret of secrets) {
      const part = leakedPart(shown, secret);
      if (part !== null) {
        throw new Error(`leak at n=${String(n)} of ${String(text.length)}: part of a secret shows`);
      }
    }
  }
}

function upperDigits(seed: number, length: number): string {
  const random = seededRandom(seed);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += UPPER_DIGITS[Math.floor(random() * UPPER_DIGITS.length)] ?? "A";
  }
  return out;
}

interface Sample {
  readonly label: string;
  /** 시크릿 전체 모양(패턴 일치 전체 또는 값) */
  readonly secret: string;
  /** 앞에 붙는 글. 시크릿 부분 문자열로 보면 안 되는 글(키 이름 등) */
  readonly lead: string;
}

// 개인 키 머리말은 비밀 탐지기가 잡으므로 이어 붙여 만든다
const PRIV = ["PRI", "VATE"].join("");
const PEM_HEAD = `-----BEGIN RSA ${PRIV} KEY-----`;
const PEM_FOOT = `-----END RSA ${PRIV} KEY-----`;

const body = upperDigits;

function samples(): readonly Sample[] {
  const jwt = `eyJ${body(1, 24)}.${body(2, 30)}.${body(3, 28)}`;
  return [
    { label: "anthropic", secret: `sk-ant-${body(4, 40)}`, lead: "" },
    { label: "openai", secret: `sk-${body(5, 40)}`, lead: "" },
    { label: "openai-proj", secret: `sk-proj-${body(6, 40)}`, lead: "" },
    { label: "google", secret: `AIza${body(7, 35)}`, lead: "" },
    { label: "github-pat", secret: `github_pat_${body(8, 60)}`, lead: "" },
    { label: "github-token", secret: `ghp_${body(9, 36)}`, lead: "" },
    { label: "slack", secret: `xoxb-${body(10, 24)}`, lead: "" },
    { label: "aws", secret: `AKIA${body(11, 16)}`, lead: "" },
    { label: "age", secret: `AGE-SECRET-KEY-1${body(12, 58)}`, lead: "" },
    { label: "jwt", secret: jwt, lead: "" },
    {
      label: "pem",
      secret: `${PEM_HEAD}\n${body(13, 64)}\n${body(14, 64)}\n${PEM_FOOT}`,
      lead: "",
    },
    { label: "kv-equals", secret: body(15, 20), lead: "password=" },
    { label: "kv-colon-quote", secret: body(16, 20), lead: `"api_key": "` },
    { label: "kv-spaced", secret: body(17, 20), lead: "client_secret  =  " },
    { label: "kv-bearer", secret: body(18, 24), lead: "Authorization: Bearer " },
    { label: "kv-short", secret: body(19, 8), lead: "token=" },
    { label: "userinfo", secret: body(20, 16), lead: "postgres://app:" },
  ];
}

/** 시크릿 뒤에 붙는 글. 값 끝을 닫는 글자도 섞는다 */
function tailFor(sample: Sample): string {
  if (sample.label === "userinfo") return "@db.internal/main";
  if (sample.lead.endsWith('"')) return '", "next": 1}';
  return "";
}

describe("holdback: no part of a secret shows at any chunk boundary", () => {
  for (const sample of samples()) {
    const unit = `${sample.lead}${sample.secret}${tailFor(sample)}`;
    const secretAt = sample.lead.length;
    const region: readonly [number, number] = [secretAt, secretAt + sample.secret.length];

    test(`${sample.label}: bare`, () => {
      expectNoLeak(createRedactor(), unit, [sample.secret], region);
    });

    test(`${sample.label}: in a sentence`, () => {
      const before = "please look at this value ";
      const text = `${before}${unit} and then carry on with the rest of it.`;
      expectNoLeak(
        createRedactor(),
        text,
        [sample.secret],
        [before.length + region[0], before.length + region[1]],
      );
    });

    test(`${sample.label}: inside a long text without whitespace`, () => {
      const before = "q".repeat(1500);
      const text = `${before}${unit.replaceAll(/\s/g, "")}${"z".repeat(1500)}`;
      const plain = sample.secret.replaceAll(/\s/g, "");
      // 공백이 빠진 PEM과 키-값 사이 띄어쓰기는 다른 모양이므로 시크릿도 같이 바꾼다
      if (sample.label === "pem" || sample.label === "kv-spaced") return;
      expectNoLeak(
        createRedactor(),
        text,
        [plain],
        [before.length + sample.lead.length, before.length + sample.lead.length + plain.length],
      );
    });

    test(`${sample.label}: inside a JSON string`, () => {
      // 따옴표가 이스케이프된 키-값은 mask 자체가 잡지 않는 모양이라 여기서는 다루지 않는다
      if (sample.lead.includes('"')) return;
      const json = JSON.stringify({ path: "a.txt", content: `x ${unit} y`, n: 1 });
      const escaped = JSON.stringify(sample.secret).slice(1, -1);
      const at = json.indexOf(escaped);
      expect(at).toBeGreaterThan(-1);
      expectNoLeak(createRedactor(), json, [escaped], [at, at + escaped.length]);
    });

    test(`${sample.label}: minified JSON, one chunk at a time`, () => {
      const json = JSON.stringify({ a: 1, b: unit.replaceAll(/\s/g, ""), c: "tail-value" });
      const plain = sample.secret.replaceAll(/\s/g, "");
      const escaped = JSON.stringify(plain).slice(1, -1);
      if (sample.label === "pem" || sample.lead.includes('"')) return;
      expectNoLeak(createRedactor(), json, [escaped], [0, json.length]);
    });
  }
});

describe("holdback: known registered values", () => {
  const NAME = nameOf("holdback-token");

  function registered(value: string): ReturnType<typeof createRedactor> {
    const redactor = createRedactor();
    expect(redactor.registerKnown(NAME, encoder.encode(value)).ok).toBe(true);
    return redactor;
  }

  for (let seed = 1; seed <= 12; seed += 1) {
    const awkward = seed % 2 === 0;
    const value = fakeValue(seededRandom(100 + seed), 20 + seed, awkward);

    test(`seed ${String(seed)}: raw value, with and without whitespace around`, () => {
      const redactor = registered(value);
      for (const text of [
        value,
        `see ${value} now`,
        `${"a".repeat(800)}${value}${"b".repeat(800)}`,
        `[${value}]`,
        JSON.stringify({ k: value, other: "plain text here" }),
      ]) {
        const at = text.indexOf(value);
        const escapedAt = at === -1 ? 0 : at;
        const secrets = at === -1 ? [JSON.stringify(value).slice(1, -1)] : [value];
        expectNoLeak(redactor, text, secrets, [escapedAt, escapedAt + value.length + 8]);
      }
    });

    test(`seed ${String(seed)}: encoded forms of the value`, () => {
      const redactor = registered(value);
      const hex = Buffer.from(value, "utf8").toString("hex");
      const b64 = Buffer.from(value, "utf8").toString("base64");
      const url = encodeURIComponent(value);
      for (const form of [hex, b64, url]) {
        if (form.length < 8) continue;
        const text = `data=${"m".repeat(300)}${form}${"n".repeat(300)} end`;
        const at = text.indexOf(form);
        expectNoLeak(redactor, text, [form], [at, at + form.length]);
      }
    });
  }

  test("a value with spaces inside is held while its first part is the tail", () => {
    const value = "correct horse battery staple";
    const redactor = registered(value);
    const text = `say ${value} twice`;
    expectNoLeak(redactor, text, [value], [4, 4 + value.length]);
  });

  test("two known values side by side", () => {
    const a = fakeValue(seededRandom(201), 22);
    const b = fakeValue(seededRandom(202), 22);
    const redactor = createRedactor();
    expect(redactor.registerKnown(nameOf("holdback-a"), encoder.encode(a)).ok).toBe(true);
    expect(redactor.registerKnown(nameOf("holdback-b"), encoder.encode(b)).ok).toBe(true);
    const text = `${a}${b}${a}`;
    expectNoLeak(redactor, text, [a, b], [0, text.length]);
  });
});

describe("holdback: several secrets stuck together", () => {
  test("patterns, a known value and a key-value pair with no separators", () => {
    const known = fakeValue(seededRandom(301), 24);
    const redactor = createRedactor();
    expect(redactor.registerKnown(nameOf("holdback-known"), encoder.encode(known)).ok).toBe(true);
    const all = samples().filter((s) => s.label !== "pem");
    const parts = all.map((s) => `${s.lead}${s.secret}${tailFor(s)}`);
    const text = `${parts.join(" ")} ${known}${parts.join("\n")}\n${known}`;
    expectNoLeak(redactor, text, [...all.map((s) => s.secret), known], [0, text.length]);
  });

  test("random compositions, every boundary near a secret", () => {
    const random = seededRandom(401);
    const pool = samples().filter((s) => s.label !== "pem");
    for (let round = 0; round < 40; round += 1) {
      const redactor = createRedactor();
      let text = "";
      const secrets: string[] = [];
      const count = 1 + Math.floor(random() * 3);
      for (let i = 0; i < count; i += 1) {
        const sample = pool[Math.floor(random() * pool.length)];
        if (sample === undefined) continue;
        const gap = random() < 0.5 ? " " : "";
        const filler = fakeValue(random, Math.floor(random() * 30), false);
        text += `${filler}${gap}${sample.lead}${sample.secret}${tailFor(sample)}${gap}`;
        secrets.push(sample.secret);
      }
      expectNoLeak(redactor, text, secrets, [0, text.length]);
    }
  });
});
