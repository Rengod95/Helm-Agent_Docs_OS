import { describe, expect, test } from "bun:test";
import { createRedactor } from "../src/redactor.ts";

// maskFix (AGE-75). 최종 가림(mask)과 화면 가림(displayRanges)의 남은 구멍 둘, 지나친 보류 둘을 고정한다.
// 값은 전부 지어낸 것이고 gitleaks에 걸리지 않게 실행 중에 조립한다.

const SECRET = ["ZQ7X", "K2MW", "P9TD", "4RVN"].join("");
const PRIV = ["PRI", "VATE"].join("");

function coveredByRanges(redactor: ReturnType<typeof createRedactor>, text: string): boolean {
  const at = text.indexOf(SECRET);
  if (at === -1) return false;
  return redactor
    .displayRanges(text)
    .some((range) => range.start <= at && range.end >= at + SECRET.length);
}

describe("hole 1: a later key-value after a swallowed earlier value", () => {
  for (const sep of ["&", ";", ","]) {
    test(`separator ${sep} without a space`, () => {
      const redactor = createRedactor();
      const text = `token=qrstuvwx${sep}Authorization: Bearer ${SECRET}`;
      expect(redactor.mask(text).text).toBe("token=[REDACTED:kv] Bearer [REDACTED:kv]");
      expect(coveredByRanges(redactor, text)).toBe(true);
    });
  }

  test("a value that holds & stays masked whole", () => {
    const redactor = createRedactor();
    expect(redactor.mask("password=abc&defghijk12 tail").text).toBe("password=[REDACTED:kv] tail");
  });

  test("a key name inside a long value does not slow the scan", () => {
    const redactor = createRedactor();
    const text = "token=".repeat(200_000);
    const started = performance.now();
    redactor.mask(text);
    expect(performance.now() - started).toBeLessThan(5000);
  });
});

describe("hole 2: key-value inside escaped JSON", () => {
  test("one level of escaping", () => {
    const redactor = createRedactor();
    const text = String.raw`x \"api_key\": \"${SECRET}\", \"n\": 1`;
    expect(redactor.mask(text).text).toBe(String.raw`x \"api_key\": \"[REDACTED:kv]\", \"n\": 1`);
    expect(coveredByRanges(redactor, text)).toBe(true);
  });

  test("two levels of escaping", () => {
    const redactor = createRedactor();
    const text = String.raw`x \\\"api_key\\\": \\\"${SECRET}\\\", y`;
    expect(redactor.mask(text).text).toBe(String.raw`x \\\"api_key\\\": \\\"[REDACTED:kv]\\\", y`);
    expect(coveredByRanges(redactor, text)).toBe(true);
  });

  test("JSON.stringify output, once and twice", () => {
    const redactor = createRedactor();
    const once = JSON.stringify({ log: JSON.stringify({ api_key: SECRET }) });
    const twice = JSON.stringify({ outer: once });
    for (const text of [once, twice]) {
      expect(redactor.mask(text).text.includes(SECRET)).toBe(false);
      expect(coveredByRanges(redactor, text)).toBe(true);
    }
  });
});

describe("over-holding 1: a BEGIN line that cannot be a PEM header", () => {
  const cases = [
    "-----BEGIN-----",
    "-----BEGIN rsa key-----",
    "-----BEGIN 12-----",
    "-----BEGINNING of the file",
    "-----BEGIN RSA, then more",
  ];
  for (const head of cases) {
    test(`released: ${head}`, () => {
      const text = `note ${head}\nand the rest of the line goes on`;
      expect(createRedactor().displayVisibleLength(text)).toBe(text.length);
    });
  }

  test("a header still being typed stays held", () => {
    for (const head of ["-----BEGIN", "-----BEGIN ", "-----BEGIN RSA PRIV", "-----BEGIN RSA --"]) {
      const text = `note ${head}`;
      expect(createRedactor().displayVisibleLength(text)).toBe(5);
    }
  });
});

describe("over-holding 2: PEM blocks that are not private keys", () => {
  test("public key and certificate are not held", () => {
    for (const kind of ["PUBLIC KEY", "CERTIFICATE", "RSA PUBLIC KEY"]) {
      const text = `see\n-----BEGIN ${kind}-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A\nMIIBCgKCAQEAu1SU1LfVLPHCozMxH2Mo`;
      expect(createRedactor().displayVisibleLength(text)).toBe(text.length);
    }
  });

  test("a private key stays held until its end line, then is covered", () => {
    const redactor = createRedactor();
    const head = `-----BEGIN RSA ${PRIV} KEY-----`;
    const foot = `-----END RSA ${PRIV} KEY-----`;
    const open = `see\n${head}\n${SECRET}\n${SECRET}`;
    expect(redactor.displayVisibleLength(open)).toBe(4);
    const closed = `${open}\n${foot}`;
    const ranges = redactor.displayRanges(closed);
    expect(ranges).toEqual([{ start: 4, end: closed.length, label: "private_key" }]);
    expect(redactor.displayVisibleLength(closed)).toBe(closed.length);
  });

  test("a public block before an open private block does not hide the private start", () => {
    const head = `-----BEGIN ${PRIV} KEY-----`;
    const text = `-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n${head}\n${SECRET}`;
    const at = text.indexOf(head);
    expect(createRedactor().displayVisibleLength(text)).toBe(at);
  });
});
