import { describe, expect, test } from "bun:test";
import {
  codeOfInput,
  defaultDeviceName,
  formatCodeInput,
  languageOf,
  retrySecondsFrom,
  STRINGS,
} from "../../src/web/static/login-form.ts";

// 로그인 화면의 순수 부분: 코드 칸 모양, 기본 기기 이름, 잠김 문구.

describe("formatCodeInput", () => {
  test("uppercases, drops other characters and hyphenates after five", () => {
    expect(formatCodeInput("abcde")).toBe("ABCDE");
    expect(formatCodeInput("abcde1")).toBe("ABCDE-1");
    expect(formatCodeInput(" ab cd-e12 345 ")).toBe("ABCDE-12345");
    expect(formatCodeInput("ABCDE-12345XYZ")).toBe("ABCDE-12345");
    expect(codeOfInput("ABCDE-12345")).toBe("ABCDE12345");
  });
});

describe("defaultDeviceName", () => {
  test("device · browser", () => {
    expect(
      defaultDeviceName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      defaultDeviceName(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0",
      ),
    ).toBe("Windows · Edge");
    expect(defaultDeviceName("curl/8")).toBe("Browser");
  });
});

describe("strings", () => {
  test("language and locked wait", () => {
    expect(languageOf("ko-KR")).toBe("ko");
    expect(languageOf("en-US")).toBe("en");
    expect(retrySecondsFrom("42")).toBe(42);
    expect(retrySecondsFrom(null)).toBe(60);
    expect(STRINGS.ko.locked(42)).toBe("틀린 코드가 많아 잠겼어요. 42초 뒤에 다시 해 봐요.");
    expect(STRINGS.en.locked(125)).toBe("Too many wrong codes. Try again in 3 min.");
  });

  test("no internal words on the page", () => {
    for (const lang of ["ko", "en"] as const) {
      const text = Object.values(STRINGS[lang])
        .filter((value): value is string => typeof value === "string")
        .join(" ");
      expect(text).not.toMatch(/페어링|pairing/i);
    }
  });
});
