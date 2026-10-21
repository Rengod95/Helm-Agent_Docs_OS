import { describe, expect, test } from "bun:test";
import { createLease, wrapLease } from "../src/lease.ts";
import { manualClock } from "./support/clock.ts";
import { forms } from "./support/encode.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

const encoder = new TextEncoder();
const HANDLE = handleOf("github-token");

interface Printable {
  toString(): string;
}

function open(options: { ttlSeconds?: number; maxUses?: number; value?: string } = {}) {
  const clock = manualClock();
  const value = options.value ?? fakeValue(seededRandom(5), 24, true);
  const lease = createLease({
    id: fixedLocalIds().next("sls"),
    handle: HANDLE,
    mode: "runtime-http",
    value: encoder.encode(value),
    ttlSeconds: options.ttlSeconds ?? 900,
    maxUses: options.maxUses ?? 200,
    clock,
    scheduler: clock,
  });
  return { clock, lease, value };
}

describe("lease lifetime (spec §4.1)", () => {
  test("expires after ttl", async () => {
    const { clock, lease } = open({ ttlSeconds: 1 });
    expect((await lease.use(() => "ok")).ok).toBe(true);
    clock.advance(1001);
    const result = await lease.use(() => "late");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: "denied", handle: HANDLE, reason: "lease_expired" });
    }
  });

  test("exhausts after maxUses", async () => {
    const { lease } = open({ maxUses: 2 });
    expect((await lease.use(() => 1)).ok).toBe(true);
    expect((await lease.use(() => 2)).ok).toBe(true);
    const third = await lease.use(() => 3);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error).toMatchObject({ kind: "denied", reason: "lease_exhausted" });
    expect(lease.usesLeft).toBe(0);
  });

  test("dispose zeroes bytes", async () => {
    const { lease } = open();
    const kept: Uint8Array[] = [];
    await lease.use((view) => {
      kept.push(view.bytes);
      expect(view.bytes.some((b) => b !== 0)).toBe(true);
    });
    // 콜백이 끝나면 복사본이 이미 0이다
    expect(kept).toHaveLength(1);
    expect(kept[0]?.every((b) => b === 0)).toBe(true);
  });

  test("dispose closes the lease, is idempotent, and later use is denied", async () => {
    const { lease } = open();
    lease.dispose();
    lease.dispose();
    const result = await lease.use(() => "x");
    expect(result.ok).toBe(false);
    expect(lease.usesLeft).toBe(0);
  });

  test("ttl timer zeroes the master copy even if the lease is never used again", async () => {
    const { clock, lease } = open({ ttlSeconds: 5 });
    expect(clock.pendingTimers()).toBe(1);
    clock.advance(5000);
    expect(clock.pendingTimers()).toBe(0);
    expect((await lease.use(() => "x")).ok).toBe(false);
  });

  test("a use callback in flight finishes after dispose", async () => {
    const { lease, value } = open();
    const seen = await lease.use(async (view) => {
      lease.dispose();
      await Promise.resolve();
      return view.text();
    });
    expect(seen).toEqual({ ok: true, value });
  });

  test("bytes handed to a callback are a copy zeroed afterwards, not the master buffer", async () => {
    const { lease } = open();
    await lease.use(() => 0);
    const second = await lease.use((view) => view.bytes.some((b) => b !== 0));
    expect(second).toEqual({ ok: true, value: true });
  });
});

describe("lease serialization", () => {
  test("serialization never shows value", async () => {
    const { lease, value } = open();
    const printable: Printable = lease;
    const form = forms(value);
    const outputs: string[] = [
      JSON.stringify(lease),
      JSON.stringify({ nested: lease }),
      Bun.inspect(lease),
      Bun.inspect({ lease }),
      printable.toString(),
      String(printable),
      [printable].join(","),
      new Error("failed", { cause: lease }).message,
      Bun.inspect(new Error("failed", { cause: lease })),
    ];
    for (const out of outputs) {
      for (const f of form) expect(out).not.toContain(f.text);
    }
    expect(JSON.stringify(lease)).toBe(`"[SecretLease ${lease.leaseId}]"`);
    expect(Bun.inspect(lease)).toContain("[SecretLease ");
    expect(Object.keys(lease)).not.toContain("value");
    expect(Object.keys(lease)).not.toContain("bytes");
  });

  test("errors from a failed use carry no value", async () => {
    const { clock, lease, value } = open({ ttlSeconds: 1 });
    clock.advance(1500);
    const result = await lease.use(() => 0);
    expect(result.ok).toBe(false);
    for (const f of forms(value)) expect(JSON.stringify(result)).not.toContain(f.text);
  });
});

describe("wrapLease", () => {
  test("fills the handle, applies the outer gate and notifies once on close", async () => {
    const { lease } = open();
    const other = handleOf("other-token");
    let closed = 0;
    let gate: "expired" | null = null;
    const wrapped = wrapLease(lease, {
      handle: other,
      gate: () => gate,
      onClose: () => (closed += 1),
    });
    expect(wrapped.handle).toBe(other);
    expect((await wrapped.use(() => 1)).ok).toBe(true);
    gate = "expired";
    const denied = await wrapped.use(() => 2);
    expect(denied.ok).toBe(false);
    if (!denied.ok)
      expect(denied.error).toEqual({ kind: "denied", handle: other, reason: "expired" });
    wrapped.dispose();
    expect(closed).toBe(1);
    expect(lease.usesLeft).toBe(0);
  });
});
