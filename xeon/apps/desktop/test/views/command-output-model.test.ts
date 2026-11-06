import { describe, expect, test } from "bun:test";
import {
  copyTextOf,
  hasResultOf,
  presentationOf,
  resultJsonOf,
} from "../../src/views/command-output-model.ts";

// 명령 결과 시트(O-03)의 모델. `done { message, result }`를 JSON 글과 복사 글로 바꾼다. 값은 `toEqual`로 비교한다.

describe("resultJsonOf", () => {
  test("a result is pretty-printed with two spaces", () => {
    expect(resultJsonOf({ ok: true, count: 2, tags: ["a"] })).toBe(
      '{\n  "ok": true,\n  "count": 2,\n  "tags": [\n    "a"\n  ]\n}',
    );
  });
});

describe("hasResultOf", () => {
  test("a null result has nothing to fold, every other value does", () => {
    expect(hasResultOf(null)).toBe(false);
    expect(hasResultOf({})).toBe(true);
    expect(hasResultOf(0)).toBe(true);
  });
});

describe("copyTextOf", () => {
  test("the message comes first and the JSON after a blank line", () => {
    expect(copyTextOf({ message: "시작했다", result: { ok: true } })).toBe(
      '시작했다\n\n{\n  "ok": true\n}',
    );
  });

  test("without a message only the JSON is copied", () => {
    expect(copyTextOf({ message: null, result: { ok: true } })).toBe('{\n  "ok": true\n}');
  });

  test("a null result with a message copies the message alone", () => {
    expect(copyTextOf({ message: "끝났다", result: null })).toBe("끝났다");
  });

  test("an empty message is treated as no message", () => {
    expect(copyTextOf({ message: "", result: { ok: true } })).toBe('{\n  "ok": true\n}');
  });
});

describe("presentationOf", () => {
  test("nothing to show opens nothing, one short line is a toast, the rest is a sheet", () => {
    expect(presentationOf({ message: null, result: null })).toBe("none");
    expect(presentationOf({ message: "  ", result: null })).toBe("none");
    expect(presentationOf({ message: "목표를 걸었습니다.", result: null })).toBe("toast");
    expect(presentationOf({ message: "첫 줄\n둘째 줄", result: null })).toBe("sheet");
    expect(presentationOf({ message: "가".repeat(101), result: null })).toBe("sheet");
    expect(presentationOf({ message: "끝", result: { ok: true } })).toBe("sheet");
    expect(presentationOf({ message: null, result: { ok: true } })).toBe("sheet");
  });
});
