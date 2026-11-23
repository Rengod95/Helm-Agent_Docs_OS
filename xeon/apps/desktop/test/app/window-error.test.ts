import { expect, test } from "bun:test";
import { windowErrorLogOf } from "../../src/app/window-error.ts";

const base = { error: null, message: "", filename: "", lineno: 0 };

test("the benign ResizeObserver notification is not counted as an error", () => {
  expect(
    windowErrorLogOf({
      ...base,
      message: "ResizeObserver loop completed with undelivered notifications.",
    }),
  ).toBeNull();
  expect(windowErrorLogOf({ ...base, message: "ResizeObserver loop limit exceeded" })).toBeNull();
});

test("a thrown Error keeps its name; a bare browser event keeps its message, file and line", () => {
  expect(
    windowErrorLogOf({
      ...base,
      error: new RangeError("x"),
      message: "Uncaught RangeError: x",
      filename: "app.js",
      lineno: 7,
    }),
  ).toEqual({ name: "RangeError", message: "Uncaught RangeError: x", source: "app.js", line: 7 });
  expect(
    windowErrorLogOf({ ...base, message: "Script error.", filename: "a.js", lineno: 3 }),
  ).toEqual({
    name: "unknown",
    message: "Script error.",
    source: "a.js",
    line: 3,
  });
});
