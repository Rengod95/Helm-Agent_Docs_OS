import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { SecretMetaPatch } from "@xeon/contracts/services";
import type { ChildRequest, ChildResult } from "../src/admin.ts";
import {
  memorySecrets,
  type MemorySecrets,
  type MemorySecretsOptions,
} from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import { httpCtx } from "./support/ctx.ts";
import { forms } from "./support/encode.ts";
import { fixedLocalIds } from "./support/ids.ts";
import { metaOf, type MetaInput } from "./support/meta.ts";
import { handleOf } from "./support/names.ts";
import { fakeValue, seededRandom } from "./support/random.ts";
import { allZero, cancelledSource, trackedSource } from "./support/value-source.ts";

// plan §5 admin.test.ts, spec §4.9, §9 7·10·11번. 값은 모두 seededRandom으로 만든 가짜이고 실패 메시지에 찍히지 않도록
// 값 비교는 불리언으로만 한다.

const HANDLE = handleOf("github-token");
const OTHER = handleOf("other-token");
const OTHER_META: MetaInput = { name: "other-token", ref: "dev/OTHER_TOKEN" };

function setup(
  metaInput: MetaInput = {},
  extra: Partial<MemorySecretsOptions> = {},
): { clock: ReturnType<typeof manualClock>; mem: MemorySecrets; secret: string } {
  const clock = manualClock();
  const secret = fakeValue(seededRandom(91), 24, true);
  const mem = memorySecrets({
    clock,
    scheduler: clock,
    ids: fixedLocalIds(),
    secrets: [{ meta: metaOf(metaInput), value: secret }],
    ...extra,
  });
  return { clock, mem, secret };
}

/** 값과 모든 인코딩 형태, 값 해시의 16자 이상 조각이 문자열에 있는가 */
function leaks(text: string, value: string): boolean {
  if (forms(value).some((form) => text.includes(form.text))) return true;
  const digest = createHash("sha256").update(value).digest("hex");
  for (let i = 0; i + 16 <= digest.length; i += 1) {
    if (text.includes(digest.slice(i, i + 16))) return true;
  }
  return false;
}

describe("rotate and set (spec §4.9)", () => {
  test("rotate revokes active leases", async () => {
    const { mem, secret } = setup();
    const a = await mem.lease(HANDLE, httpCtx());
    const b = await mem.lease(HANDLE, httpCtx());
    if (!a.ok || !b.ok) throw new Error("setup failed");
    expect(mem.activeLeaseCount(HANDLE)).toBe(2);
    const fresh = fakeValue(seededRandom(92), 24, true);
    const source = trackedSource(fresh);

    const rotated = await mem.admin.rotate(HANDLE, source);
    expect(rotated).toEqual({ ok: true, value: { revokedLeases: 2 } });
    const afterwards = await Promise.all([a.value.use(() => 1), b.value.use(() => 1)]);
    for (const used of afterwards) {
      expect(used.ok).toBe(false);
      if (!used.ok) expect(used.error).toMatchObject({ kind: "denied", reason: "lease_expired" });
    }
    // 이전 값은 등록부에서 지워지고 새 값은 다음 lease에서 등록된다
    expect(mem.redactor.containsKnown(secret)).toBe(false);
    expect(mem.redactor.containsKnown(fresh)).toBe(false);
    expect((await mem.lease(HANDLE, httpCtx())).ok).toBe(true);
    expect(mem.redactor.containsKnown(fresh)).toBe(true);
    // 받은 버퍼는 제공자에 넘긴 뒤 0으로 덮인다
    expect(source.issued.every(allZero)).toBe(true);
    const rotatedRecord = mem.auditRecords().find((r) => r.type === "secret.rotated");
    expect(rotatedRecord).toMatchObject({ handle: HANDLE, fields: ["value"], actor: "human" });
  });

  test("set replaces the value, closes leases and records an update", async () => {
    const { mem } = setup();
    const lease = await mem.lease(HANDLE, httpCtx());
    if (!lease.ok) throw new Error("setup failed");
    const fresh = fakeValue(seededRandom(93), 24, true);
    expect((await mem.admin.set(HANDLE, trackedSource(fresh))).ok).toBe(true);
    expect((await lease.value.use(() => 1)).ok).toBe(false);
    const again = await mem.lease(HANDLE, httpCtx());
    const matches = again.ok ? await again.value.use((view) => view.text() === fresh) : null;
    expect(matches).toEqual({ ok: true, value: true });
    const updated = mem.auditRecords().find((r) => r.type === "secret.updated");
    expect(updated).toMatchObject({ handle: HANDLE, fields: ["value"] });
  });

  test("add rejects values shorter than 8 bytes", async () => {
    const { mem } = setup();
    const short = trackedSource("1234567");
    const added = await mem.admin.add(metaOf(OTHER_META), short);
    expect(added).toEqual({ ok: false, error: { kind: "value_too_short", minBytes: 8 } });
    expect(short.issued.every(allZero)).toBe(true);
    // 메타도 만들어지지 않는다
    const listed = await mem.admin.ls({ usage: false });
    expect(listed.ok && listed.value.some((l) => l.meta?.name === "other-token")).toBe(false);
    const set = await mem.admin.set(HANDLE, trackedSource("short"));
    expect(set).toEqual({ ok: false, error: { kind: "value_too_short", minBytes: 8 } });
    const rotate = await mem.admin.rotate(HANDLE, trackedSource("short"));
    expect(rotate).toEqual({ ok: false, error: { kind: "value_too_short", minBytes: 8 } });
    expect(mem.auditRecords()).toHaveLength(0);
  });

  test("cancelled or empty input is reported and nothing is recorded", async () => {
    const { mem } = setup();
    expect(await mem.admin.set(HANDLE, cancelledSource("input_cancelled"))).toEqual({
      ok: false,
      error: { kind: "cancelled" },
    });
    expect(await mem.admin.rotate(HANDLE, cancelledSource("input_empty"))).toEqual({
      ok: false,
      error: { kind: "value_too_short", minBytes: 8 },
    });
    expect(mem.auditRecords()).toHaveLength(0);
  });

  test("a provider without put refuses before reading the value", async () => {
    const { mem } = setup({}, { putSupported: false });
    const source = trackedSource("some-fake-value-123");
    const refused = { ok: false, error: { kind: "read_only_provider", provider: "sops" } } as const;
    expect(await mem.admin.set(HANDLE, source)).toEqual(refused);
    expect(await mem.admin.add(metaOf(OTHER_META), source)).toEqual(refused);
    expect(source.reads()).toBe(0);
  });
});

describe("add", () => {
  test("add stores the value and meta and records secret.created without a value", async () => {
    const { mem } = setup();
    const fresh = fakeValue(seededRandom(94), 24, true);
    const source = trackedSource(fresh);
    expect(await mem.admin.add(metaOf(OTHER_META), source)).toEqual({ ok: true, value: OTHER });
    expect(source.issued.every(allZero)).toBe(true);
    expect((await mem.lease(OTHER, httpCtx())).ok).toBe(true);
    const records = mem.auditRecords();
    expect(records.find((r) => r.type === "secret.created")).toMatchObject({
      handle: OTHER,
      fields: ["meta", "value"],
      actor: "human",
    });
    expect(leaks(JSON.stringify(records), fresh)).toBe(false);
    const duplicate = await mem.admin.add(metaOf(OTHER_META), trackedSource(fresh));
    expect(duplicate).toEqual({ ok: false, error: { kind: "already_exists", handle: OTHER } });
  });

  test("add attaches meta to an orphaned provider entry without reading a value", async () => {
    const orphanValue = fakeValue(seededRandom(95), 24, true);
    const { mem } = setup({}, { orphans: { "dev/OTHER_TOKEN": orphanValue } });
    const before = await mem.admin.ls({ usage: false });
    expect(before.ok && before.value.some((l) => l.status === "orphaned")).toBe(true);

    const source = trackedSource("never-read-value-1");
    expect(await mem.admin.add(metaOf(OTHER_META), source)).toEqual({ ok: true, value: OTHER });
    expect(source.reads()).toBe(0);
    expect(mem.auditRecords().at(-1)).toMatchObject({ type: "secret.created", fields: ["meta"] });
    const after = await mem.admin.ls({ usage: false });
    expect(after.ok && after.value.some((l) => l.status === "orphaned")).toBe(false);
    // 기존 값은 그대로다
    const lease = await mem.lease(OTHER, httpCtx());
    const same = lease.ok ? await lease.value.use((view) => view.text() === orphanValue) : null;
    expect(same).toEqual({ ok: true, value: true });
  });

  test("add validates the meta against the schema", async () => {
    const { mem } = setup();
    const bad = { ...metaOf(OTHER_META), ttlSeconds: 0 };
    const result = await mem.admin.add(bad, trackedSource("some-fake-value-123"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("meta_invalid");
    expect(mem.auditRecords()).toHaveLength(0);
  });
});

describe("meta", () => {
  test("meta patches fields, closes leases on a policy change and records field names", async () => {
    const { mem } = setup();
    const lease = await mem.lease(HANDLE, httpCtx());
    if (!lease.ok) throw new Error("setup failed");
    const current = metaOf();
    const patch: SecretMetaPatch = {
      desc: "renamed description",
      use: { ...current.use, hosts: ["other.example.test"] },
    };
    const patched = await mem.admin.meta(HANDLE, patch);
    expect(patched.ok && patched.value.desc).toBe("renamed description");
    expect(patched.ok && patched.value.use.hosts).toEqual(["other.example.test"]);
    expect(mem.activeLeaseCount(HANDLE)).toBe(0);
    expect(mem.auditRecords().at(-1)).toMatchObject({
      type: "secret.updated",
      handle: HANDLE,
      fields: ["desc", "use"],
    });
    // 새 정책이 즉시 적용된다
    const denied = await mem.lease(HANDLE, httpCtx());
    expect(denied.ok).toBe(false);
  });

  test("an invalid patch changes nothing and a no-op patch records nothing", async () => {
    const { mem } = setup();
    const lease = await mem.lease(HANDLE, httpCtx());
    expect(lease.ok).toBe(true);
    const invalid = await mem.admin.meta(HANDLE, { ttlSeconds: 0 });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok)
      expect(invalid.error).toMatchObject({ kind: "meta_invalid", name: "github-token" });
    const same = await mem.admin.meta(HANDLE, { desc: metaOf().desc, maxUses: metaOf().maxUses });
    expect(same.ok).toBe(true);
    expect(mem.activeLeaseCount(HANDLE)).toBe(1);
    expect(mem.auditRecords().filter((r) => r.type === "secret.updated")).toHaveLength(0);
    // ttl 변경은 새 lease에만 영향을 주므로 활성 lease를 닫지 않는다
    expect((await mem.admin.meta(HANDLE, { ttlSeconds: 60 })).ok).toBe(true);
    expect(mem.activeLeaseCount(HANDLE)).toBe(1);
  });

  test("meta on an unknown handle is secret_missing", async () => {
    const { mem } = setup();
    const result = await mem.admin.meta(OTHER, { desc: "x" });
    expect(result).toEqual({
      ok: false,
      error: { kind: "secret_missing", handle: OTHER, where: "meta" },
    });
  });
});

describe("rm", () => {
  test("rm refuses when in use", async () => {
    const { mem } = setup();
    const lease = await mem.lease(HANDLE, httpCtx());
    if (!lease.ok) throw new Error("setup failed");
    const refused = await mem.admin.rm(HANDLE, { confirmed: true });
    expect(refused).toEqual({
      ok: false,
      error: { kind: "in_use", handle: HANDLE, activeLeases: 1 },
    });
    expect((await mem.admin.ls({ usage: false })).ok).toBe(true);
    lease.value.dispose();
    expect((await mem.admin.rm(HANDLE, { confirmed: true })).ok).toBe(true);
  });

  test("rm deletes meta and value, forgets the redactor entry and records secret.deleted", async () => {
    const { mem, secret } = setup();
    const lease = await mem.lease(HANDLE, httpCtx());
    if (!lease.ok) throw new Error("setup failed");
    lease.value.dispose();
    expect(mem.redactor.containsKnown(secret)).toBe(true);
    expect((await mem.admin.rm(HANDLE, { confirmed: true })).ok).toBe(true);
    expect(mem.redactor.containsKnown(secret)).toBe(false);
    const listed = await mem.admin.ls({ usage: false });
    expect(listed).toEqual({ ok: true, value: [] });
    expect(mem.auditRecords().at(-1)).toMatchObject({
      type: "secret.deleted",
      handle: HANDLE,
      fields: ["meta", "value"],
    });
    expect(await mem.admin.rm(HANDLE, { confirmed: true })).toEqual({
      ok: false,
      error: { kind: "secret_missing", handle: HANDLE, where: "meta" },
    });
  });
});

describe("test", () => {
  test("test prints length and hash prefix only", async () => {
    const { mem, secret } = setup();
    const result = await mem.admin.test(HANDLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value).toSorted()).toEqual([
      "decryptable",
      "exists",
      "length",
      "sha256Prefix",
    ]);
    expect(result.value.exists).toBe(true);
    expect(result.value.decryptable).toBe(true);
    expect(result.value.length).toBe(new TextEncoder().encode(secret).length);
    expect(result.value.sha256Prefix).toBe(
      createHash("sha256").update(secret).digest("hex").slice(0, 8),
    );
    expect(leaks(JSON.stringify(result.value), secret)).toBe(false);
    // 결과는 감사 레코드에 싣지 않는다
    expect(mem.auditRecords()).toHaveLength(0);
  });

  test("test reports a missing provider entry without failing", async () => {
    const clock = manualClock();
    const mem = memorySecrets({
      clock,
      scheduler: clock,
      ids: fixedLocalIds(),
      secrets: [{ meta: metaOf(), value: null }],
    });
    expect(await mem.admin.test(HANDLE)).toEqual({
      ok: true,
      value: { exists: false, decryptable: false, length: null, sha256Prefix: null },
    });
  });
});

describe("ls, usage and references", () => {
  test("ls --usage fills the last use from the audit file; plain ls does not", async () => {
    const { clock, mem } = setup();
    const lease = await mem.lease(HANDLE, httpCtx());
    if (!lease.ok) throw new Error("setup failed");
    const usedAt = clock.now();
    clock.advance(5000);
    const plain = await mem.admin.ls({ usage: false });
    const withUsage = await mem.admin.ls({ usage: true });
    expect(plain.ok && plain.value[0]?.status).toBe("valid");
    expect(withUsage.ok && withUsage.value[0]?.lastUsedAt).toBe(usedAt);
  });

  test("usage filters by decision and since", async () => {
    const { clock, mem } = setup();
    await mem.lease(HANDLE, httpCtx());
    clock.advance(1000);
    await mem.lease(
      HANDLE,
      httpCtx({ target: { kind: "host", host: "other.example.test", port: 443 } }),
    );
    const all = await mem.admin.usage(HANDLE, {});
    expect(all.ok && all.value.map((r) => r.type)).toEqual(["secret.used", "secret.denied"]);
    const allowed = await mem.admin.usage(HANDLE, { decision: "allow" });
    expect(allowed.ok && allowed.value.map((r) => r.type)).toEqual(["secret.used"]);
    const denied = await mem.admin.usage(HANDLE, { decision: "deny" });
    expect(denied.ok && denied.value.map((r) => r.type)).toEqual(["secret.denied"]);
    const recent = await mem.admin.usage(HANDLE, { since: clock.now() });
    expect(recent.ok && recent.value.map((r) => r.type)).toEqual(["secret.denied"]);
  });

  test("references report setting keys, active leases and recent sessions", async () => {
    const { mem } = setup(
      {},
      {
        settingKeysFor: (handle) => Promise.resolve(handle === HANDLE ? ["l2.web.exa.apiKey"] : []),
      },
    );
    await mem.lease(HANDLE, httpCtx({ threadId: "thr_a" }));
    await mem.lease(HANDLE, httpCtx({ threadId: "thr_b" }));
    await mem.lease(HANDLE, httpCtx({ threadId: "thr_a" }));
    await mem.lease(HANDLE, httpCtx({ threadId: null }));
    const report = await mem.admin.references(HANDLE);
    expect(report).toEqual({
      ok: true,
      value: { settingKeys: ["l2.web.exa.apiKey"], activeLeases: 4, sessions: ["thr_a", "thr_b"] },
    });
  });
});

function runSetup(result: ChildResult = { kind: "exited", exitCode: 3 }) {
  const requests: ChildRequest[] = [];
  const parentEnv = {
    PATH: "/usr/bin",
    SOPS_AGE_KEY: "parent-should-not-reach-child",
    OP_SERVICE_ACCOUNT_TOKEN: "parent-should-not-reach-child",
  };
  const built = setup(
    {},
    {
      parentEnv,
      childRunner: (request) => {
        requests.push(request);
        return Promise.resolve(result);
      },
    },
  );
  return { ...built, requests };
}

describe("run (human only, spec §4.9)", () => {
  test("injects the value into the child env only, drops sensitive parent names and returns the exit code", async () => {
    const { mem, secret, requests } = runSetup();
    const result = await mem.admin.run({ GH_TOKEN: HANDLE }, ["gh", "api", "user"], {
      inheritStdio: true,
    });
    expect(result).toEqual({ ok: true, value: { exitCode: 3 } });
    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.argv).toEqual(["gh", "api", "user"]);
    expect(request?.env["GH_TOKEN"] === secret).toBe(true);
    expect(request?.env["PATH"]).toBe("/usr/bin");
    expect(
      Object.keys(request?.env ?? {}).some((n) => n === "SOPS_AGE_KEY" || n.startsWith("OP_")),
    ).toBe(false);
    // argv에는 값이 없고, 사용 뒤 lease는 모두 닫힌다
    expect(leaks(JSON.stringify(request?.argv), secret)).toBe(false);
    expect(mem.activeLeaseCount(HANDLE)).toBe(0);
    const used = mem.auditRecords().find((r) => r.type === "secret.used");
    expect(used).toMatchObject({ mode: "env", threadId: null, host: null });
    expect(leaks(JSON.stringify(mem.auditRecords()), secret)).toBe(false);
  });

  test("a spawn failure becomes exit code 127 and still closes the leases", async () => {
    const { mem } = runSetup({ kind: "spawn_failed", code: "ENOENT" });
    const result = await mem.admin.run({ GH_TOKEN: HANDLE }, ["no-such-binary"], {
      inheritStdio: true,
    });
    expect(result).toEqual({ ok: true, value: { exitCode: 127 } });
    expect(mem.activeLeaseCount(HANDLE)).toBe(0);
  });

  test("rejects bad variable names, empty commands and expired secrets without spawning", async () => {
    const { mem, requests } = runSetup();
    const badName = await mem.admin.run({ "NOT-VALID": HANDLE }, ["x"], { inheritStdio: true });
    expect(badName).toEqual({ ok: false, error: { kind: "invalid_ref", reason: "name_pattern" } });
    const empty = await mem.admin.run({}, [], { inheritStdio: true });
    expect(empty.ok).toBe(false);
    const unknown = await mem.admin.run({ X: OTHER }, ["x"], { inheritStdio: true });
    expect(unknown).toEqual({
      ok: false,
      error: { kind: "secret_missing", handle: OTHER, where: "meta" },
    });
    expect(requests).toHaveLength(0);

    const expired = setup({ expiresAt: "2026-01-05" });
    const result = await expired.mem.admin.run({ X: HANDLE }, ["x"], { inheritStdio: true });
    expect(result).toEqual({
      ok: false,
      error: { kind: "denied", handle: HANDLE, reason: "expired" },
    });
  });
});
