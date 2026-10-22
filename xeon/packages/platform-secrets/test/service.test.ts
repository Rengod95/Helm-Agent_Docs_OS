import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { SecretAuditRecord } from "@xeon/contracts/capabilities";
import type { SecretError, SecretProvider } from "@xeon/contracts/services";
import { memorySecrets, type MemorySecrets } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { APPROVAL_PER_SESSION, APPROVAL_PER_USE, envCtx, httpCtx } from "./support/ctx.ts";
import { forms } from "./support/encode.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf, type MetaInput } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";

const HANDLE = handleOf("github-token");
const ENV_META: MetaInput = {
  modes: ["env"],
  tools: ["bash:gh"],
  commands: ["gh api *"],
  approval: "none",
};

function setup(metaInput: MetaInput = {}, value?: string) {
  const clock = manualClock();
  const secret = value ?? fakeValue(seededRandom(77), 24, true);
  const service: MemorySecrets = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: [{ meta: metaOf(metaInput), value: secret }],
  });
  const records: SecretAuditRecord[] = [];
  service.onAudit((record) => records.push(record));
  return { clock, service, secret, records };
}

/** 값 자체와 값의 SHA-256 hex의 16자 이상 조각이 문자열에 없는가 */
function expectNoValue(text: string, value: string): void {
  for (const form of forms(value)) expect(text).not.toContain(form.text);
  const digest = createHash("sha256").update(value).digest("hex");
  for (let i = 0; i + 16 <= digest.length; i += 1) {
    expect(text).not.toContain(digest.slice(i, i + 16));
  }
}

describe("lease flow (spec §4.1)", () => {
  test("lease emits secret.used without value", async () => {
    const { service, secret, records } = setup();
    const lease = await service.lease(HANDLE, httpCtx());
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "secret.used",
      handle: HANDLE,
      mode: "runtime-http",
      toolCallId: "call_1",
      threadId: "thr_test",
      host: "api.example.test",
      commandHash: null,
      decision: "allow",
      leaseId: lease.value.leaseId,
    });
    expectNoValue(JSON.stringify(records), secret);
    const read = await lease.value.use((view) => view.text());
    expect(read).toEqual({ ok: true, value: secret });
  });

  test("denies host outside allowlist without touching the provider", async () => {
    const { service, records } = setup();
    const result = await service.lease(
      HANDLE,
      httpCtx({ target: { kind: "host", host: "other.example.test", port: 443 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ kind: "denied", handle: HANDLE, reason: "host_mismatch" });
    }
    expect(service.providerLeaseCalls()).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "secret.denied",
      reason: "host_mismatch",
      purpose: "http.request",
    });
  });

  // 수용 기준 14: 모델 provider 키(runtime-http, 마일스톤 M1)
  test("a model provider key leases in runtime-http mode and a wrong host never reaches the provider", async () => {
    const { service, records, secret } = setup({
      modes: ["runtime-http"],
      tools: ["model.provider:*"],
      hosts: ["api.example.test"],
    });
    const ctx = httpCtx({
      purpose: "model.provider:example",
      target: { kind: "host", host: "api.example.test", port: null },
      approval: null,
    });
    const allowed = await service.lease(HANDLE, ctx);
    expect(allowed.ok).toBe(true);
    expect(service.providerLeaseCalls()).toBe(1);
    const denied = await service.lease(HANDLE, {
      ...ctx,
      target: { kind: "host", host: "evil.example.test", port: null },
    });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.error).toEqual({ kind: "denied", handle: HANDLE, reason: "host_mismatch" });
    }
    expect(service.providerLeaseCalls()).toBe(1);
    expect(records.map((record) => record.type)).toEqual(["secret.used", "secret.denied"]);
    expectNoValue(JSON.stringify(records), secret);
  });

  test("unknown names and malformed handles are errors without audit records", async () => {
    const { service, records } = setup();
    const missing = await service.lease(handleOf("nope-token"), httpCtx());
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toEqual({
        kind: "secret_missing",
        handle: handleOf("nope-token"),
        where: "meta",
      });
    }
    expect(records).toHaveLength(0);
    expect(service.providerLeaseCalls()).toBe(0);
  });

  test("lease respects ttl and maxUses taken from the meta", async () => {
    const { clock, service } = setup({ ttlSeconds: 1, maxUses: 2 });
    const lease = await service.lease(HANDLE, httpCtx());
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    expect(lease.value.usesLeft).toBe(2);
    expect((await lease.value.use(() => 1)).ok).toBe(true);
    expect((await lease.value.use(() => 2)).ok).toBe(true);
    const third = await lease.value.use(() => 3);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error).toMatchObject({ reason: "lease_exhausted" });
    const second = await service.lease(HANDLE, httpCtx());
    clock.advance(1001);
    if (second.ok) {
      const late = await second.value.use(() => 4);
      expect(late.ok).toBe(false);
      if (!late.ok) expect(late.error).toMatchObject({ reason: "lease_expired" });
    }
  });

  test("meta expiry is checked again at every use", async () => {
    const { clock, service } = setup({ expiresAt: "2026-01-06" });
    const lease = await service.lease(HANDLE, httpCtx());
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    expect((await lease.value.use(() => 1)).ok).toBe(true);
    clock.advance(86_400_000);
    const late = await lease.value.use(() => 2);
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error).toMatchObject({ kind: "denied", reason: "expired" });
    expect(service.activeLeaseCount(HANDLE)).toBe(0);
  });

  test("revokeLeases closes active leases and counts them", async () => {
    const { service } = setup();
    const a = await service.lease(HANDLE, httpCtx());
    const b = await service.lease(HANDLE, httpCtx());
    expect(service.activeLeaseCount(HANDLE)).toBe(2);
    expect(service.revokeLeases(HANDLE)).toBe(2);
    expect(service.activeLeaseCount(HANDLE)).toBe(0);
    if (!a.ok || !b.ok) throw new Error("setup failed");
    const after = await Promise.all([a.value.use(() => 1), b.value.use(() => 1)]);
    expect(after.map((r) => r.ok)).toEqual([false, false]);
  });

  test("disposing the service closes every lease", async () => {
    const { service } = setup();
    const lease = await service.lease(HANDLE, httpCtx());
    service[Symbol.dispose]();
    if (!lease.ok) throw new Error("setup failed");
    expect((await lease.value.use(() => 1)).ok).toBe(false);
  });
});

describe("env mode (spec §3.6 withEnv, 마일스톤 M1)", () => {
  test("env mode requires per-use approval", async () => {
    const { service, records } = setup(ENV_META);
    const none = await service.withEnv(HANDLE, envCtx("gh api user", { approval: null }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error).toMatchObject({ kind: "denied", reason: "approval_missing" });
    const session = await service.withEnv(
      HANDLE,
      envCtx("gh api user", { approval: APPROVAL_PER_SESSION }),
    );
    expect(session.ok).toBe(false);
    expect(service.providerLeaseCalls()).toBe(0);
    expect(records.map((r) => r.type)).toEqual(["secret.denied", "secret.denied"]);
  });

  test("withEnv opens lease for matching command", async () => {
    const { service, secret, records } = setup(ENV_META);
    const lease = await service.withEnv(HANDLE, envCtx("gh api user"));
    expect(lease.ok).toBe(true);
    if (!lease.ok) return;
    expect(lease.value.mode).toBe("env");
    expect(records.map((r) => r.type)).toEqual(["secret.approved", "secret.used"]);
    const used = records[1];
    expect(used).toMatchObject({ type: "secret.used", mode: "env", host: null });
    expect(used?.type === "secret.used" ? used.commandHash : null).toMatch(/^[0-9a-f]{16}$/);
    expectNoValue(JSON.stringify(records), secret);
  });

  test("withEnv denies command outside pattern", async () => {
    const { service, records } = setup(ENV_META);
    const result = await service.withEnv(HANDLE, envCtx("curl https://evil.example.test"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ reason: "command_mismatch" });
    expect(service.providerLeaseCalls()).toBe(0);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      type: "secret.denied",
      reason: "command_mismatch",
      mode: "env",
    });
  });

  test("withEnv with a host target is mode_not_allowed", async () => {
    const { service } = setup(ENV_META);
    const result = await service.withEnv(
      HANDLE,
      envCtx("gh api user", { target: { kind: "host", host: "api.example.test", port: 443 } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ reason: "mode_not_allowed" });
    expect(service.providerLeaseCalls()).toBe(0);
  });

  test("a per-use approval opens one lease only", async () => {
    const { service } = setup(ENV_META);
    expect((await service.withEnv(HANDLE, envCtx("gh api user"))).ok).toBe(true);
    const replay = await service.withEnv(HANDLE, envCtx("gh api user"));
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toMatchObject({ reason: "approval_missing" });
    const fresh = { ...APPROVAL_PER_USE, approvalId: "apr_test_9" };
    expect((await service.withEnv(HANDLE, envCtx("gh api user", { approval: fresh }))).ok).toBe(
      true,
    );
  });

  test("registerKnown rejects short values: env lease is refused, http is allowed", async () => {
    const short = "1234567";
    const envSetup = setup(ENV_META, short);
    const denied = await envSetup.service.withEnv(HANDLE, envCtx("gh api user"));
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error).toMatchObject({ reason: "mode_not_allowed" });
    expect(envSetup.service.activeLeaseCount(HANDLE)).toBe(0);
    expect(envSetup.records.at(-1)).toMatchObject({
      type: "secret.denied",
      reason: "mode_not_allowed",
    });

    const httpSetup = setup({}, short);
    const allowed = await httpSetup.service.lease(HANDLE, httpCtx());
    expect(allowed.ok).toBe(true);
    expect(httpSetup.service.redactor.containsKnown(short)).toBe(false);
  });

  test("lease registers the value with the redactor", async () => {
    const { service, secret } = setup();
    expect(service.redactor.containsKnown(secret)).toBe(false);
    await service.lease(HANDLE, httpCtx());
    expect(service.redactor.containsKnown(secret)).toBe(true);
    expect(service.redactor.mask(`x ${secret}`).text).toBe("x [REDACTED:known:github-token]");
  });
});

describe("secret.approved and check", () => {
  test("secret.approved is emitted the first time an approval is seen", async () => {
    const { service, records } = setup({ approval: "per-session" });
    const ctx = httpCtx({ approval: APPROVAL_PER_SESSION });
    await service.lease(HANDLE, ctx);
    await service.lease(HANDLE, ctx);
    expect(records.map((r) => r.type)).toEqual(["secret.approved", "secret.used", "secret.used"]);
    expect(records[0]).toMatchObject({
      approvalId: APPROVAL_PER_SESSION.approvalId,
      scope: "per-session",
      threadId: "thr_test",
    });
  });

  test("check returns allow, deny and needs_approval with a prompt, and writes no audit", async () => {
    const { service, records } = setup({ approval: "per-use", ttlSeconds: 120 });
    const needs = await service.check(HANDLE, httpCtx());
    expect(needs.ok).toBe(true);
    if (needs.ok) {
      expect(needs.value).toEqual({
        kind: "needs_approval",
        approval: "per-use",
        prompt: {
          handle: HANDLE,
          desc: "test token",
          purpose: "http.request",
          target: { kind: "host", host: "api.example.test", port: 443 },
          ttlSeconds: 120,
        },
      });
    }
    const allow = await service.check(HANDLE, httpCtx({ approval: APPROVAL_PER_USE }));
    expect(allow).toEqual({ ok: true, value: { kind: "allow" } });
    const deny = await service.check(
      HANDLE,
      httpCtx({ target: { kind: "host", host: "x.test", port: 443 } }),
    );
    expect(deny).toEqual({ ok: true, value: { kind: "deny", reason: "host_mismatch" } });
    expect(records).toHaveLength(0);
    expect(service.providerLeaseCalls()).toBe(0);
  });
});

describe("audit bus and provider registry", () => {
  test("a failing sink does not stop the others or the lease", async () => {
    const { service } = setup();
    const seen: string[] = [];
    service.onAudit(() => {
      throw new Error("sink failure");
    });
    service.onAudit((record) => seen.push(record.type));
    expect((await service.lease(HANDLE, httpCtx())).ok).toBe(true);
    expect(seen).toEqual(["secret.used"]);
  });

  test("disposing a sink stops delivery", async () => {
    const { service } = setup();
    const seen: string[] = [];
    const sub = service.onAudit((record) => seen.push(record.type));
    sub[Symbol.dispose]();
    await service.lease(HANDLE, httpCtx());
    expect(seen).toEqual([]);
  });

  test("registerProvider refuses the built-in id and duplicates, and unregisters on dispose", async () => {
    const { service } = setup();
    const op: SecretProvider = {
      id: "op",
      capabilities: () => ({ list: true, put: false, remove: false, usage: false }),
      list: () => Promise.resolve({ ok: true, value: [] }),
      lease: () =>
        Promise.resolve({ ok: false, error: { kind: "reauth_required" } satisfies SecretError }),
    };
    const builtIn = service.registerProvider({ ...op, id: "sops" });
    expect(builtIn.ok).toBe(false);
    if (!builtIn.ok)
      expect(builtIn.error).toEqual({ kind: "read_only_provider", provider: "sops" });
    const first = service.registerProvider(op);
    expect(first.ok).toBe(true);
    expect(service.registerProvider(op).ok).toBe(false);
    if (first.ok) first.value[Symbol.dispose]();
    expect(service.registerProvider(op).ok).toBe(true);
  });

  test("withBrowserInput is refused until it is implemented (마일스톤 M2)", async () => {
    const { service, records } = setup({
      modes: ["browser-input"],
      origins: ["https://a.example.test"],
    });
    let filled = false;
    const result = await service.withBrowserInput(
      HANDLE,
      "https://a.example.test",
      {
        purpose: "web.browse",
        actor: "agent",
        threadId: null,
        toolCallId: null,
        projectId: null,
        approval: null,
      },
      () => {
        filled = true;
        return Promise.resolve(1);
      },
    );
    expect(result.ok).toBe(false);
    expect(filled).toBe(false);
    expect(records[0]).toMatchObject({ type: "secret.denied", mode: "browser-input" });
  });
});

describe("resolve and list", () => {
  test("resolve returns the meta and a valid status without decrypting", async () => {
    const { service } = setup();
    const resolved = await service.resolve(HANDLE);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.status).toBe("valid");
      expect(resolved.value.handle).toBe(HANDLE);
      expect(resolved.value.lastUsedAt).toBeNull();
    }
    await service.lease(HANDLE, httpCtx());
    const after = await service.resolve(HANDLE);
    expect(after.ok && after.value.lastUsedAt).not.toBeNull();
    const listed = await service.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  test("status reflects expiry", async () => {
    const soon = setup({ expiresAt: "2026-01-08" });
    const a = await soon.service.resolve(HANDLE);
    expect(a.ok && a.value.status).toBe("expiring");
    const gone = setup({ expiresAt: "2026-01-05" });
    const b = await gone.service.resolve(HANDLE);
    expect(b.ok && b.value.status).toBe("expired");
  });
});
