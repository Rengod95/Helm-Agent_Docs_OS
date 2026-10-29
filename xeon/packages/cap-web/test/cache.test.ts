import { describe, expect, test } from "bun:test";
import { createSearchMemo, limitBucket, searchMemoKey } from "../src/cache/search-memo.ts";
import { createSingleFlight } from "../src/cache/single-flight.ts";
import { manualClock } from "./support/clock.ts";

const MINUTE = 60_000;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  const slot: { resolve?: (value: T) => void } = {};
  const promise = new Promise<T>((resolve) => {
    slot.resolve = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      slot.resolve?.(value);
    },
  };
}

describe("single flight", () => {
  test("single flight", async () => {
    const flight = createSingleFlight<string>();
    const gate = deferred<string>();
    let calls = 0;
    const signal = new AbortController().signal;
    const options = { signal, wasCancelled: () => false };
    const factory = (): Promise<string> => {
      calls += 1;
      return gate.promise;
    };
    const first = flight.run("k", factory, options);
    const second = flight.run("k", factory, options);
    const other = flight.run("other", () => Promise.resolve("o"), options);
    expect(flight.size()).toBe(2);
    gate.resolve("shared");
    expect(await Promise.all([first, second, other])).toEqual(["shared", "shared", "o"]);
    expect(calls).toBe(1);
    expect(flight.size()).toBe(0);
    // 끝난 뒤의 같은 키는 새 호출이다
    expect(await flight.run("k", () => Promise.resolve("again"), options)).toBe("again");
  });

  test("a follower restarts when the leader was cancelled", async () => {
    const flight = createSingleFlight<string>();
    const gate = deferred<string>();
    const live = new AbortController().signal;
    const leaderAbort = new AbortController();
    const leader = flight.run("k", () => gate.promise, {
      signal: leaderAbort.signal,
      wasCancelled: (value) => value === "cancelled",
    });
    const follower = flight.run("k", () => Promise.resolve("fresh"), {
      signal: live,
      wasCancelled: (value) => value === "cancelled",
    });
    leaderAbort.abort();
    gate.resolve("cancelled");
    expect(await leader).toBe("cancelled");
    expect(await follower).toBe("fresh");
  });

  test("a cancelled follower gets the shared value as is", async () => {
    const flight = createSingleFlight<string>();
    const gate = deferred<string>();
    const gone = new AbortController();
    gone.abort();
    const leader = flight.run("k", () => gate.promise, {
      signal: new AbortController().signal,
      wasCancelled: (value) => value === "cancelled",
    });
    const follower = flight.run("k", () => Promise.resolve("fresh"), {
      signal: gone.signal,
      wasCancelled: (value) => value === "cancelled",
    });
    gate.resolve("cancelled");
    expect(await leader).toBe("cancelled");
    expect(await follower).toBe("cancelled");
  });

  test("a failure of the factory frees the key", async () => {
    const flight = createSingleFlight<string>();
    const options = { signal: new AbortController().signal, wasCancelled: () => false };
    const rejected = await flight
      .run(
        "k",
        async () => {
          await Promise.resolve();
          throw new Error("boom");
        },
        options,
      )
      .then(
        () => "resolved",
        (caught: unknown) => (caught instanceof Error ? caught.message : "other"),
      );
    expect(rejected).toBe("boom");
    expect(flight.size()).toBe(0);
  });
});

describe("search memo", () => {
  test("entries expire after their ttl", () => {
    const clock = manualClock();
    const memo = createSearchMemo<string>(clock);
    memo.store("k", "v", 20 * MINUTE);
    clock.advance(19 * MINUTE);
    expect(memo.lookup("k")).toEqual({ value: "v", ageMs: 19 * MINUTE, ttlMs: 20 * MINUTE });
    clock.advance(1 * MINUTE);
    expect(memo.lookup("k")).toBeUndefined();
    expect(memo.size()).toBe(0);
  });

  test("a zero ttl stores nothing", () => {
    const memo = createSearchMemo<string>(manualClock());
    memo.store("k", "v", 0);
    expect(memo.size()).toBe(0);
  });

  test("the least recently used entry goes first", () => {
    const memo = createSearchMemo<number>(manualClock(), 3);
    memo.store("a", 1, MINUTE);
    memo.store("b", 2, MINUTE);
    memo.store("c", 3, MINUTE);
    expect(memo.lookup("a")?.value).toBe(1);
    memo.store("d", 4, MINUTE);
    expect(memo.lookup("b")).toBeUndefined();
    expect(memo.lookup("a")?.value).toBe(1);
    expect(memo.lookup("c")?.value).toBe(3);
    expect(memo.lookup("d")?.value).toBe(4);
    expect(memo.size()).toBe(3);
  });

  test("limit bucket", () => {
    expect(limitBucket(1)).toBe(10);
    expect(limitBucket(7)).toBe(10);
    expect(limitBucket(10)).toBe(10);
    expect(limitBucket(11)).toBe(20);
    expect(limitBucket(20)).toBe(20);
    const base = {
      chain: ["searxng"],
      parallel: 1,
      query: "xeon  agents",
      objective: undefined,
      recency: undefined,
      domains: { allow: [], deny: [] },
      content: "snippets",
    } as const;
    // limit 7과 10은 같은 항목, 11은 다른 항목
    expect(searchMemoKey({ ...base, limitBucket: limitBucket(7) })).toBe(
      searchMemoKey({ ...base, limitBucket: limitBucket(10) }),
    );
    expect(searchMemoKey({ ...base, limitBucket: limitBucket(7) })).not.toBe(
      searchMemoKey({ ...base, limitBucket: limitBucket(11) }),
    );
  });

  test("the memo key separates chain, filters and content", () => {
    const base = {
      chain: ["searxng", "builtin-wrapper"],
      parallel: 1,
      query: "xeon",
      objective: undefined,
      recency: undefined,
      domains: { allow: ["a.example", "b.example"], deny: [] },
      content: "snippets",
      limitBucket: 10,
    } as const;
    const key = searchMemoKey(base);
    expect(searchMemoKey({ ...base, query: "  xeon " })).toBe(key);
    expect(
      searchMemoKey({ ...base, domains: { allow: ["b.example", "a.example"], deny: [] } }),
    ).toBe(key);
    expect(searchMemoKey({ ...base, chain: ["builtin-wrapper"] })).not.toBe(key);
    expect(searchMemoKey({ ...base, parallel: 2 })).not.toBe(key);
    expect(searchMemoKey({ ...base, recency: "week" })).not.toBe(key);
    expect(searchMemoKey({ ...base, content: "full" })).not.toBe(key);
    expect(searchMemoKey({ ...base, domains: { allow: [], deny: ["a.example"] } })).not.toBe(key);
    expect(searchMemoKey({ ...base, objective: "find docs" })).not.toBe(key);
  });
});
