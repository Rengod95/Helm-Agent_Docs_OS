import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { RevealGrant } from "@fresnel/client/settings";
import { ok, parse } from "@fresnel/contracts";
import { SecretNameSchema, type SecretName } from "@fresnel/contracts/capabilities";
import {
  createOsReauthGate,
  gatedRevealPort,
  type GatedValuePort,
} from "../../src/app/secret-reveal-gate.ts";
import type { OsAuthEvidence, OsReauthInvoke } from "../../src/views/os-reauth.ts";

// 값 보기 재인증 관문(B8): 재인증이 먼저이고 통과했을 때만 값 경로를 연다. 창은 한 번에 하나만 뜬다.
// 실제 Touch ID 창은 Mac에서만 뜨므로 여기서는 `os_reauth` invoke를 가짜로 둔다.

const unwrapName = (text: string): SecretName => {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`bad secret name ${text}`);
  return parsed.value;
};
const FIRST = unwrapName("anthropic-main");
const SECOND = unwrapName("exa-search");

interface Deferred {
  readonly resolve: (reply: unknown) => void;
  readonly reject: (cause: Error) => void;
}

/** 부르면 대기하는 가짜 invoke. 누가 어떤 사유로 불렀는지와 동시에 떠 있던 창 수의 최댓값을 센다 */
function pendingInvoke(): {
  readonly invoke: OsReauthInvoke;
  readonly reasons: string[];
  readonly open: Deferred[];
  readonly peak: () => number;
} {
  const reasons: string[] = [];
  const open: Deferred[] = [];
  const state = { live: 0, peak: 0 };
  const invoke: OsReauthInvoke = (_command, args) => {
    reasons.push(args.reason);
    state.live += 1;
    state.peak = Math.max(state.peak, state.live);
    return new Promise((resolve, reject) => {
      open.push({
        resolve: (reply) => {
          state.live -= 1;
          resolve(reply);
        },
        reject: (cause) => {
          state.live -= 1;
          reject(cause);
        },
      });
    });
  };
  return { invoke, reasons, open, peak: () => state.peak };
}

const VALUE_BYTES = new TextEncoder().encode("fake-value-for-the-gate-test");

/** 값 경로. 부른 횟수와 받은 증거를 센다. 값은 가짜 바이트다 */
function valuePort(): {
  readonly port: GatedValuePort;
  readonly calls: () => number;
  readonly evidence: () => readonly OsAuthEvidence[];
} {
  const state: { calls: number; evidence: OsAuthEvidence[] } = { calls: 0, evidence: [] };
  return {
    port: {
      reveal(_name, reauth) {
        state.calls += 1;
        state.evidence.push(reauth);
        const grant: RevealGrant = { kind: "value", bytes: VALUE_BYTES.slice() };
        return Promise.resolve(ok(grant));
      },
    },
    calls: () => state.calls,
    evidence: () => state.evidence.slice(),
  };
}

/** Rust 명령이 거부하는 `{ kind }` 값을 Error에 실어 흉내 낸다 */
const shellError = (kind: string): Error => Object.assign(new Error("os_reauth"), { kind });

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("the OS re-auth gate", () => {
  test("it is available and asks for the device check with a reason that names the secret", async () => {
    const fake = pendingInvoke();
    const gate = createOsReauthGate(fake.invoke);
    expect(gate.available).toBe(true);
    const pending = gate.reauth(FIRST);
    await tick();
    expect(fake.reasons).toEqual([t("desktop.secrets.reveal.reauthReason", { name: FIRST })]);
    fake.open[0]?.resolve({ verifiedAtMs: 1_000 });
    expect(await pending).toEqual({
      ok: true,
      value: { method: "os-auth", verifiedAt: 1_000 },
    });
  });

  test("the value port runs only after the re-auth passes, and not at all when it fails", async () => {
    const passed = pendingInvoke();
    const value = valuePort();
    const revealed = gatedRevealPort(createOsReauthGate(passed.invoke), value.port).reveal(FIRST);
    await tick();
    expect(value.calls()).toBe(0);
    passed.open[0]?.resolve({ verifiedAtMs: 1_000 });
    expect(await revealed).toEqual({
      ok: true,
      value: { kind: "value", bytes: VALUE_BYTES },
    });
    expect(value.calls()).toBe(1);
    // 통과한 증거(인증 시각)가 값 경로에 그대로 간다
    expect(value.evidence()).toEqual([{ method: "os-auth", verifiedAt: 1_000 }]);

    const denied = pendingInvoke();
    const blocked = valuePort();
    const refused = gatedRevealPort(createOsReauthGate(denied.invoke), blocked.port).reveal(FIRST);
    await tick();
    denied.open[0]?.reject(shellError("denied"));
    expect(await refused).toEqual({ ok: false, error: { kind: "reauth_denied" } });
    expect(blocked.calls()).toBe(0);
  });

  test("each shell error kind maps to one reveal failure", async () => {
    const expected = [
      ["cancelled", "reauth_denied"],
      ["denied", "reauth_denied"],
      ["unavailable", "unavailable"],
      ["failed", "failed"],
    ] as const;
    const results = await Promise.all(
      expected.map(async ([shell, reveal]) => {
        const fake = pendingInvoke();
        const pending = createOsReauthGate(fake.invoke).reauth(FIRST);
        await tick();
        fake.open[0]?.reject(shellError(shell));
        return { got: await pending, reveal };
      }),
    );
    for (const { got, reveal } of results) {
      expect(got).toEqual({ ok: false, error: { kind: reveal } });
    }
    const odd = pendingInvoke();
    const pending = createOsReauthGate(odd.invoke).reauth(FIRST);
    await tick();
    odd.open[0]?.reject(new Error("boom"));
    expect(await pending).toEqual({ ok: false, error: { kind: "failed" } });
  });

  test("two calls for the same secret while the window is up share one window", async () => {
    const fake = pendingInvoke();
    const gate = createOsReauthGate(fake.invoke);
    const a = gate.reauth(FIRST);
    const b = gate.reauth(FIRST);
    await tick();
    expect(fake.open).toHaveLength(1);
    fake.open[0]?.resolve({ verifiedAtMs: 5 });
    expect(await a).toEqual({ ok: true, value: { method: "os-auth", verifiedAt: 5 } });
    expect(await b).toEqual({ ok: true, value: { method: "os-auth", verifiedAt: 5 } });
    // 끝난 뒤의 새 호출은 새 창을 연다(이전 통과를 재사용하지 않는다)
    const c = gate.reauth(FIRST);
    await tick();
    expect(fake.open).toHaveLength(2);
    fake.open[1]?.reject(shellError("cancelled"));
    expect(await c).toEqual({ ok: false, error: { kind: "reauth_denied" } });
  });

  test("a call for another secret waits for the open window, so two windows never show at once", async () => {
    const fake = pendingInvoke();
    const gate = createOsReauthGate(fake.invoke);
    const a = gate.reauth(FIRST);
    const b = gate.reauth(SECOND);
    await tick();
    expect(fake.open).toHaveLength(1);
    fake.open[0]?.resolve({ verifiedAtMs: 5 });
    await a;
    await tick();
    expect(fake.open).toHaveLength(2);
    fake.open[1]?.resolve({ verifiedAtMs: 6 });
    expect(await b).toEqual({ ok: true, value: { method: "os-auth", verifiedAt: 6 } });
    expect(fake.peak()).toBe(1);
    expect(fake.reasons).toEqual([
      t("desktop.secrets.reveal.reauthReason", { name: FIRST }),
      t("desktop.secrets.reveal.reauthReason", { name: SECOND }),
    ]);
  });
});
