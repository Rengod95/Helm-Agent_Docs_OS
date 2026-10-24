import { describe, expect, test } from "bun:test";
import { attempt, attemptAsync, detach, parseJson, rethrow } from "../../src/index.ts";

describe("attempt", () => {
  test("returns the value of a call that does not throw", () => {
    expect(attempt(() => 3)).toEqual({ ok: true, value: 3 });
  });

  test("keeps the thrown value as cause", () => {
    const boom = new Error("boom");
    const result = attempt(() => {
      throw boom;
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("threw");
      expect(result.error.cause).toBe(boom);
    }
  });

  test("attemptAsync keeps a rejection as cause", async () => {
    const boom = new Error("late");
    const rejected = await attemptAsync(() => Promise.reject(boom));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.cause).toBe(boom);
    expect(await attemptAsync(() => Promise.resolve("fine"))).toEqual({ ok: true, value: "fine" });
  });
});

describe("parseJson", () => {
  test("reads JSON as unknown", () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  test("a non-JSON string is a parse_json error with the cause", () => {
    const result = parseJson("{nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("parse_json");
      expect(result.error.cause).toBeInstanceOf(SyntaxError);
    }
  });
});

describe("detach", () => {
  test("hands a rejection to onFailure", async () => {
    const seen: unknown[] = [];
    const boom = new Error("boom");
    detach(Promise.reject(boom), (cause) => seen.push(cause));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([boom]);
  });

  test("does not call onFailure when the work succeeds", async () => {
    const seen: unknown[] = [];
    detach(Promise.resolve(1), (cause) => seen.push(cause));
    await Promise.resolve();
    expect(seen).toEqual([]);
  });
});

describe("rethrow", () => {
  test("throws an Error as it is", () => {
    const boom = new Error("boom");
    expect(() => rethrow(boom)).toThrow(boom);
  });

  test("wraps a non-Error value and keeps it as cause", () => {
    const thrown = attempt(() => rethrow("text"));
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) {
      expect(thrown.error.cause).toBeInstanceOf(Error);
      expect(thrown.error.cause instanceof Error && thrown.error.cause.cause).toBe("text");
    }
  });
});
