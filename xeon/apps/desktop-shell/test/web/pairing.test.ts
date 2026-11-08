import { describe, expect, test } from "bun:test";
import { encodeCode, formatCode, normalizeCode } from "../../src/web/auth/crockford.ts";
import {
  createPairingCodes,
  PAIRING_LOCK_MS,
  PAIRING_TTL_MS,
  type PairingEvent,
} from "../../src/web/auth/pairing.ts";
import { manualClock, sequenceBytes } from "./support/fixtures.ts";

describe("crockford code", () => {
  test("encodes one character per byte (low 5 bits)", () => {
    expect(encodeCode(Uint8Array.of(0, 1, 2, 9, 10, 31, 32, 33, 255, 18))).toBe("0129AZ01ZJ");
    expect(formatCode("0129AZ01ZJ")).toBe("0129A-Z01ZJ");
  });

  test("normalizes spaces, hyphens, case and look-alike letters", () => {
    expect(normalizeCode("0129a-z01zj")).toBe("0129AZ01ZJ");
    expect(normalizeCode(" 0129A Z01ZJ ")).toBe("0129AZ01ZJ");
    expect(normalizeCode("o1l9AZ0IZJ")).toBe("0119AZ01ZJ");
  });

  test("rejects wrong length and letters outside the alphabet", () => {
    expect(normalizeCode("0129AZ01Z")).toBeNull();
    expect(normalizeCode("0129AZ01ZJJ")).toBeNull();
    expect(normalizeCode("0129AZ01ZU")).toBeNull();
    expect(normalizeCode("0129AZ01Z!")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });
});

function setup(options: { maxFailuresTotal?: number; maxFailuresPerAddress?: number } = {}): {
  readonly clock: ReturnType<typeof manualClock>;
  readonly codes: ReturnType<typeof createPairingCodes>;
  readonly events: PairingEvent[];
} {
  const clock = manualClock();
  const codes = createPairingCodes({ clock, randomBytes: sequenceBytes(5), ...options });
  const events: PairingEvent[] = [];
  codes.onEvent((event) => events.push(event));
  return { clock, codes, events };
}

describe("pairing codes", () => {
  test("an issued code is ten characters and expires in five minutes", () => {
    const { clock, codes } = setup();
    const issued = codes.issue();
    expect(issued.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/u);
    expect(issued.display).toBe(`${issued.code.slice(0, 5)}-${issued.code.slice(5)}`);
    expect(issued.expiresAt).toBe(clock.now() + 5 * 60_000);
    expect(PAIRING_TTL_MS).toBe(300_000);
    expect(codes.status()).toEqual({
      active: true,
      expiresAt: issued.expiresAt,
      lockedUntil: null,
    });
  });

  test("redeems once: the second use fails", () => {
    const { codes } = setup();
    const issued = codes.issue();
    expect(codes.redeem(issued.display.toLowerCase(), "1.1.1.1")).toEqual({
      ok: true,
      value: null,
    });
    expect(codes.redeem(issued.code, "1.1.1.1")).toEqual({
      ok: false,
      error: { kind: "invalid_code" },
    });
    expect(codes.status().active).toBe(false);
  });

  test("the last millisecond before expiry works and the expiry instant does not", () => {
    const first = setup();
    const a = first.codes.issue();
    first.clock.advance(PAIRING_TTL_MS - 1);
    expect(first.codes.redeem(a.code, "a").ok).toBe(true);

    const second = setup();
    const b = second.codes.issue();
    second.clock.advance(PAIRING_TTL_MS);
    expect(second.codes.redeem(b.code, "a")).toEqual({
      ok: false,
      error: { kind: "invalid_code" },
    });
    expect(second.codes.status().active).toBe(false);
  });

  test("a new code replaces the unused one", () => {
    const { codes } = setup();
    const old = codes.issue();
    const next = codes.issue();
    expect(next.code).not.toBe(old.code);
    expect(codes.redeem(old.code, "a")).toEqual({ ok: false, error: { kind: "invalid_code" } });
    expect(codes.redeem(next.code, "a").ok).toBe(true);
  });

  test("with no code issued every attempt is invalid_code", () => {
    const { codes } = setup();
    expect(codes.redeem("0000000000", "a")).toEqual({ ok: false, error: { kind: "invalid_code" } });
    expect(codes.redeem("garbage", "a")).toEqual({ ok: false, error: { kind: "invalid_code" } });
  });

  test("the fifth failure discards the code and locks for fifteen minutes", () => {
    const { clock, codes, events } = setup();
    const issued = codes.issue();
    for (let i = 0; i < 4; i += 1) {
      expect(codes.redeem("WRONGWRONG", "a")).toEqual({
        ok: false,
        error: { kind: "invalid_code" },
      });
    }
    expect(codes.redeem("WRONGWRONG", "a")).toEqual({
      ok: false,
      error: { kind: "locked", scope: "all", retryAfterMs: PAIRING_LOCK_MS },
    });
    expect(PAIRING_LOCK_MS).toBe(900_000);
    // 맞는 코드도 잠금 중에는 `locked`이고, 코드는 이미 폐기됐다
    clock.advance(60_000);
    expect(codes.redeem(issued.code, "b")).toEqual({
      ok: false,
      error: { kind: "locked", scope: "all", retryAfterMs: PAIRING_LOCK_MS - 60_000 },
    });
    expect(codes.status()).toEqual({
      active: false,
      expiresAt: null,
      lockedUntil: Date.UTC(2026, 10, 8) + PAIRING_LOCK_MS,
    });
    expect(events.filter((event) => event.kind === "failed")).toHaveLength(5);
    expect(events.filter((event) => event.kind === "locked")).toEqual([
      {
        kind: "locked",
        address: "a",
        scope: "all",
        until: Date.UTC(2026, 10, 8) + PAIRING_LOCK_MS,
      },
    ]);
  });

  test("after the lock a freshly issued code works again", () => {
    const { clock, codes } = setup();
    codes.issue();
    for (let i = 0; i < 5; i += 1) codes.redeem("WRONGWRONG", "a");
    clock.advance(PAIRING_LOCK_MS - 1);
    expect(codes.redeem("WRONGWRONG", "a").ok).toBe(false);
    expect(codes.status().lockedUntil).not.toBeNull();
    clock.advance(1);
    const issued = codes.issue();
    expect(codes.redeem(issued.code, "a").ok).toBe(true);
    expect(codes.status().lockedUntil).toBeNull();
  });

  test("one address reaching its limit is locked alone when the total limit is higher", () => {
    const { codes } = setup({ maxFailuresTotal: 20 });
    const issued = codes.issue();
    for (let i = 0; i < 4; i += 1) codes.redeem("WRONGWRONG", "bad");
    expect(codes.redeem("WRONGWRONG", "bad")).toEqual({
      ok: false,
      error: { kind: "locked", scope: "address", retryAfterMs: PAIRING_LOCK_MS },
    });
    // 그 주소가 5번 틀렸으므로 코드는 폐기됐다. 다른 주소는 잠기지 않았다
    expect(codes.redeem(issued.code, "good")).toEqual({
      ok: false,
      error: { kind: "invalid_code" },
    });
    const next = codes.issue();
    expect(codes.redeem(next.code, "bad")).toEqual({
      ok: false,
      error: { kind: "locked", scope: "address", retryAfterMs: PAIRING_LOCK_MS },
    });
    expect(codes.redeem(next.code, "good").ok).toBe(true);
  });

  test("failures from different addresses add up to the total limit", () => {
    const { codes } = setup();
    codes.issue();
    for (const address of ["a", "b", "c", "d"]) codes.redeem("WRONGWRONG", address);
    expect(codes.redeem("WRONGWRONG", "e")).toEqual({
      ok: false,
      error: { kind: "locked", scope: "all", retryAfterMs: PAIRING_LOCK_MS },
    });
  });

  test("old failures are forgotten after the lock window, and a success resets the count", () => {
    const { clock, codes } = setup();
    codes.issue();
    for (let i = 0; i < 4; i += 1) codes.redeem("WRONGWRONG", "a");
    clock.advance(PAIRING_LOCK_MS);
    // 4번의 실패는 잊혔으므로 4번 더 틀려도 잠기지 않는다
    for (let i = 0; i < 4; i += 1) {
      expect(codes.redeem("WRONGWRONG", "a")).toEqual({
        ok: false,
        error: { kind: "invalid_code" },
      });
    }
    const issued = codes.issue();
    expect(codes.redeem(issued.code, "a").ok).toBe(true);
    const again = codes.issue();
    for (let i = 0; i < 4; i += 1) codes.redeem("WRONGWRONG", "a");
    expect(codes.redeem(again.code, "a").ok).toBe(true);
  });
});
