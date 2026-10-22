import { describe, expect, test } from "bun:test";
import { attemptAsync, eachAsync, repeatAsync } from "../../src/index.ts";

describe("repeatAsync", () => {
  test("calls step until it reports a value and never overlaps two calls", async () => {
    let running = 0;
    let overlapped = false;
    let calls = 0;
    const value = await repeatAsync(async () => {
      running += 1;
      overlapped ||= running > 1;
      calls += 1;
      await Promise.resolve();
      running -= 1;
      return calls === 4 ? { value: calls * 10 } : undefined;
    });
    expect(value).toBe(40);
    expect(calls).toBe(4);
    expect(overlapped).toBe(false);
  });

  test("a rejected step rejects the loop", async () => {
    const outcome = await attemptAsync(() =>
      repeatAsync<number>(() => Promise.reject(new Error("boom"))),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.cause).toEqual(new Error("boom"));
  });
});

describe("eachAsync", () => {
  test("stops at the first item that reports a value", async () => {
    const seen: number[] = [];
    const found = await eachAsync([1, 2, 3, 4], async (item) => {
      await Promise.resolve();
      seen.push(item);
      return item === 2 ? { value: "two" } : undefined;
    });
    expect(found).toEqual({ value: "two" });
    expect(seen).toEqual([1, 2]);
  });

  test("returns undefined when no item reports a value", async () => {
    expect(await eachAsync([1, 2], () => Promise.resolve(undefined))).toBeUndefined();
  });
});
