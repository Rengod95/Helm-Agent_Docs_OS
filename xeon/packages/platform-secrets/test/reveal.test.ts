import { describe, expect, test } from "bun:test";
import type { HumanReauth, SecretValueView } from "@xeon/contracts/services";
import { memorySecrets, type MemorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";
import { allZero } from "./support/value-source.ts";

// plan §5 SC-23, m2-plan §5 SEC: reveal 재인증 실패 시 값 미출력. WSL에는 OS 인증이 없어 tty-confirm 경로만 확인한다.
// 값은 불리언 비교로만 확인하고 단언 실패 메시지에 찍히지 않게 한다.

const HANDLE = handleOf("github-token");

function setup(osAuthAvailable = false) {
  const clock = manualClock();
  const secret = fakeValue(seededRandom(7), 24, true);
  const mem: MemorySecrets = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: [{ meta: metaOf(), value: secret }],
    osAuthAvailable,
  });
  return { clock, mem, secret };
}

interface Shown {
  calls: number;
  matches: boolean;
  view: SecretValueView | null;
  copy: Uint8Array | null;
}

function showInto(secret: string): { shown: Shown; show: (v: SecretValueView) => Promise<void> } {
  const shown: Shown = { calls: 0, matches: false, view: null, copy: null };
  return {
    shown,
    show(view) {
      shown.calls += 1;
      shown.matches = view.text() === secret;
      shown.view = view;
      shown.copy = view.bytes;
      return Promise.resolve();
    },
  };
}

describe("reveal reauth (spec §4.9, U-20)", () => {
  test("a fresh tty-confirm shows the value once, zeroes it afterwards and records secret.revealed", async () => {
    const { clock, mem, secret } = setup();
    const { shown, show } = showInto(secret);
    const reauth: HumanReauth = { method: "tty-confirm", verifiedAt: clock.now() - 1000 };
    expect(await mem.admin.reveal(HANDLE, reauth, show)).toEqual({ ok: true, value: undefined });
    expect(shown.calls).toBe(1);
    expect(shown.matches).toBe(true);
    // show가 끝난 뒤 넘긴 바이트는 0으로 덮인다
    expect(shown.copy !== null && allZero(shown.copy)).toBe(true);
    const revealed = mem.auditRecords().filter((r) => r.type === "secret.revealed");
    expect(revealed).toEqual([
      {
        type: "secret.revealed",
        handle: HANDLE,
        reauth: "tty-confirm",
        actor: "human",
        at: clock.now(),
      },
    ]);
    expect(JSON.stringify(mem.auditRecords()).includes(secret)).toBe(false);
    // lease는 남지 않는다
    expect(mem.activeLeaseCount(HANDLE)).toBe(0);
  });

  test("the audit record is written before the value is shown", async () => {
    const { clock, mem, secret } = setup();
    let recordedWhenShown = -1;
    const result = await mem.admin.reveal(
      HANDLE,
      { method: "tty-confirm", verifiedAt: clock.now() },
      () => {
        recordedWhenShown = mem.auditRecords().filter((r) => r.type === "secret.revealed").length;
        return Promise.resolve();
      },
    );
    expect(result.ok).toBe(true);
    expect(recordedWhenShown).toBe(1);
    expect(secret.length).toBeGreaterThan(0);
  });

  const rejected: readonly { name: string; os: boolean; reauth: (now: number) => HumanReauth }[] = [
    {
      name: "stale",
      os: false,
      reauth: (now) => ({ method: "tty-confirm", verifiedAt: now - 60_001 }),
    },
    {
      name: "future",
      os: false,
      reauth: (now) => ({ method: "tty-confirm", verifiedAt: now + 1 }),
    },
    { name: "passphrase", os: false, reauth: (now) => ({ method: "passphrase", verifiedAt: now }) },
    {
      name: "tty-confirm where OS auth exists",
      os: true,
      reauth: (now) => ({ method: "tty-confirm", verifiedAt: now }),
    },
  ];
  for (const item of rejected) {
    test(`reveal needs reauth: ${item.name} never shows the value`, async () => {
      const { clock, mem, secret } = setup(item.os);
      const { shown, show } = showInto(secret);
      const result = await mem.admin.reveal(HANDLE, item.reauth(clock.now()), show);
      expect(result).toEqual({ ok: false, error: { kind: "reauth_required" } });
      expect(shown.calls).toBe(0);
      // 제공자도 부르지 않고 기록도 남기지 않는다
      expect(mem.providerLeaseCalls()).toBe(0);
      expect(mem.auditRecords()).toHaveLength(0);
    });
  }

  test("the 60 second window is inclusive and os-auth is accepted", async () => {
    const { clock, mem, secret } = setup(true);
    const { shown, show } = showInto(secret);
    const edge = await mem.admin.reveal(
      HANDLE,
      { method: "os-auth", verifiedAt: clock.now() - 60_000 },
      show,
    );
    expect(edge.ok).toBe(true);
    expect(shown.calls).toBe(1);
    expect(mem.auditRecords().at(-1)).toMatchObject({ type: "secret.revealed", reauth: "os-auth" });
  });

  test("a failing audit write stops the reveal before the value is shown", async () => {
    const { clock, mem, secret } = setup();
    mem.failAuditWrites(true);
    const { shown, show } = showInto(secret);
    const result = await mem.admin.reveal(
      HANDLE,
      { method: "tty-confirm", verifiedAt: clock.now() },
      show,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ kind: "meta_invalid", name: "audit.log" });
    expect(shown.calls).toBe(0);
    expect(mem.activeLeaseCount(HANDLE)).toBe(0);
  });

  test("unknown handles and missing provider entries are errors without a prompt", async () => {
    const { clock, mem, secret } = setup();
    const { shown, show } = showInto(secret);
    const reauth: HumanReauth = { method: "tty-confirm", verifiedAt: clock.now() };
    const unknown = await mem.admin.reveal(handleOf("nope-token"), reauth, show);
    expect(unknown).toEqual({
      ok: false,
      error: { kind: "secret_missing", handle: handleOf("nope-token"), where: "meta" },
    });
    expect(shown.calls).toBe(0);

    const missingClock = manualClock();
    const missing = memorySecrets({
      clock: missingClock,
      scheduler: missingClock,
      ids: fixedLocalIds(),
      secrets: [{ meta: metaOf(), value: null }],
    });
    const result = await missing.admin.reveal(
      HANDLE,
      { method: "tty-confirm", verifiedAt: missingClock.now() },
      show,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "secret_missing", handle: HANDLE, where: "provider" },
    });
    expect(shown.calls).toBe(0);
    expect(missing.auditRecords()).toHaveLength(0);
  });

  test("the value is zeroed even when show throws, and the error is not swallowed", async () => {
    const { clock, mem } = setup();
    const seen: { bytes: Uint8Array | null } = { bytes: null };
    const attempt = mem.admin.reveal(
      HANDLE,
      { method: "tty-confirm", verifiedAt: clock.now() },
      (view) => {
        seen.bytes = view.bytes;
        return Promise.reject(new Error("terminal closed"));
      },
    );
    const outcome = await attempt.then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(outcome instanceof Error && outcome.message).toBe("terminal closed");
    expect(seen.bytes !== null && allZero(seen.bytes)).toBe(true);
    expect(mem.activeLeaseCount(HANDLE)).toBe(0);
  });
});
