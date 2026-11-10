import { describe, expect, test } from "bun:test";
import { createAppRoots } from "../../../src/main/view-scheme.ts";
import {
  createViewTokens,
  MAX_VIEW_TOKENS_PER_TAB,
  VIEW_TOKEN_MAX_AGE_MS,
  VIEW_TOKEN_TTL_MS,
} from "../../../src/web/view/tokens.ts";

function clockAt(start: number): { now: () => number; set: (ms: number) => void } {
  const state = { ms: start };
  return {
    now: () => state.ms,
    set: (ms) => {
      state.ms = ms;
    },
  };
}

describe("view tokens", () => {
  test("a token resolves to the roots of its own tab only", () => {
    const clock = clockAt(1000);
    const tokens = createViewTokens({ clock });
    const rootsA = createAppRoots();
    const rootsB = createAppRoots();
    const a = tokens.issue("tab-a", rootsA);
    const b = tokens.issue("tab-b", rootsB);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(tokens.lookup(a.token) === rootsA).toBe(true);
    expect(tokens.lookup(a.token) === rootsB).toBe(false);
    expect(tokens.lookup(b.token) === rootsB).toBe(true);
    expect(a.expiresAt).toBe(1000 + VIEW_TOKEN_TTL_MS);
  });

  test("unknown, malformed and empty tokens resolve to nothing", () => {
    const tokens = createViewTokens({ clock: clockAt(0) });
    tokens.issue("tab-a", createAppRoots());
    for (const text of ["", "x", "A".repeat(43), "../".repeat(20), "A".repeat(44)]) {
      expect(tokens.lookup(text)).toBeUndefined();
    }
  });

  test("an unused token expires exactly at its lifetime", () => {
    const clock = clockAt(5000);
    const tokens = createViewTokens({ clock });
    const early = tokens.issue("tab-a", createAppRoots());
    const exact = tokens.issue("tab-a", createAppRoots());
    clock.set(5000 + VIEW_TOKEN_TTL_MS - 1);
    expect(tokens.lookup(early.token)).toBeDefined();
    clock.set(5000 + VIEW_TOKEN_TTL_MS);
    expect(tokens.lookup(exact.token)).toBeUndefined();
  });

  test("use renews the lifetime but never past the maximum age", () => {
    const clock = clockAt(0);
    const tokens = createViewTokens({ clock });
    const issued = tokens.issue("tab-a", createAppRoots());
    clock.set(VIEW_TOKEN_TTL_MS - 1);
    expect(tokens.lookup(issued.token)).toBeDefined();
    clock.set(2 * VIEW_TOKEN_TTL_MS - 2);
    expect(tokens.lookup(issued.token)).toBeDefined();
    // 쓰지 않고 한 시간이 지나면 만료다
    clock.set(3 * VIEW_TOKEN_TTL_MS - 2);
    expect(tokens.lookup(issued.token)).toBeUndefined();
    // 계속 써도 발급 12시간 뒤에는 끝난다
    const long = tokens.issue("tab-a", createAppRoots());
    let at = 0;
    while (at + VIEW_TOKEN_TTL_MS / 2 < VIEW_TOKEN_MAX_AGE_MS) {
      at += VIEW_TOKEN_TTL_MS / 2;
      clock.set(3 * VIEW_TOKEN_TTL_MS + at);
      expect(tokens.lookup(long.token)).toBeDefined();
    }
    clock.set(3 * VIEW_TOKEN_TTL_MS + VIEW_TOKEN_MAX_AGE_MS);
    expect(tokens.lookup(long.token)).toBeUndefined();
  });

  test("closing a tab revokes its tokens and keeps the others", () => {
    const tokens = createViewTokens({ clock: clockAt(0) });
    const a = tokens.issue("tab-a", createAppRoots());
    const b = tokens.issue("tab-b", createAppRoots());
    tokens.revokeTab("tab-a");
    expect(tokens.lookup(a.token)).toBeUndefined();
    expect(tokens.lookup(b.token)).toBeDefined();
  });

  test("a tab keeps at most the newest tokens", () => {
    const tokens = createViewTokens({ clock: clockAt(0) });
    const roots = createAppRoots();
    const issued = Array.from({ length: MAX_VIEW_TOKENS_PER_TAB + 2 }, () =>
      tokens.issue("tab-a", roots),
    );
    expect(tokens.lookup(issued[0]?.token ?? "")).toBeUndefined();
    expect(tokens.lookup(issued[1]?.token ?? "")).toBeUndefined();
    expect(tokens.lookup(issued[2]?.token ?? "")).toBeDefined();
    expect(tokens.lookup(issued[issued.length - 1]?.token ?? "")).toBeDefined();
  });

  test("the injected random source decides the token text", () => {
    const tokens = createViewTokens({
      clock: clockAt(0),
      random: () => new Uint8Array(32).fill(7),
    });
    expect(tokens.issue("t", createAppRoots()).token).toBe(
      Buffer.from(new Uint8Array(32).fill(7)).toString("base64url"),
    );
  });
});
