import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { SecretNameSchema, type SecretName } from "@xeon/contracts/capabilities";
import { WireError } from "@xeon/contracts/wire";
import { createSecretsPort } from "../../src/assembly/secrets.ts";
import { createFakeHost } from "../fixtures/fake-host.ts";
import { createFakeSecrets, sampleMeta } from "../fixtures/fake-secrets.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { DEFAULT_SECRETS_CONFIG } from "@xeon/platform-secrets";

// HOST.3: secret.list·meta·remove·test·beginEntry·beginReveal. 처리기는 실제 코드이고 L0.secrets 관리 서비스만 대역이다.
// 어느 요청·응답·로그에도 값이 없어야 한다.

function nameOf(text: string): SecretName {
  const parsed = parse(SecretNameSchema, text);
  if (!parsed.ok) throw new Error(`not a secret name: ${text}`);
  return parsed.value;
}

const EXA = nameOf("exa-key");
const GITHUB = nameOf("github-token");
const VALUE = "sk-live-0123456789abcdef";

function seeded() {
  const host = createFakeHost();
  const { records } = host.fake.secrets;
  records.set(EXA, {
    meta: sampleMeta(EXA),
    exists: true,
    decryptable: true,
    value: VALUE,
    lastUsedAt: Date.UTC(2026, 9, 20, 1, 2, 3),
    activeLeases: 0,
  });
  records.set(GITHUB, {
    meta: sampleMeta(GITHUB),
    exists: false,
    decryptable: false,
    value: null,
    lastUsedAt: null,
    activeLeases: 0,
  });
  return host;
}

async function open(host: ReturnType<typeof createFakeHost>) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

function sourceOf(text: string) {
  const state = { reads: 0 };
  return {
    state,
    source: {
      read() {
        state.reads += 1;
        return Promise.resolve({ ok: true as const, value: new TextEncoder().encode(text) });
      },
    },
  };
}

function cancelledSource() {
  return {
    read() {
      return Promise.resolve({ ok: false as const, error: { kind: "input_cancelled" as const } });
    },
  };
}

test("the secret methods are implemented, so the hello features list them", async () => {
  const host = createFakeHost();
  const { connection } = host.connect();
  const hello = await connection.request("host.hello", HELLO_PARAMS);
  const names = hello.features.map((feature) => feature.name);
  for (const method of [
    "secret.list",
    "secret.meta",
    "secret.remove",
    "secret.test",
    "secret.beginEntry",
    "secret.beginReveal",
  ]) {
    expect(names).toContain(method);
  }
  await connection.close();
});

test("secret.list gives names and status without meta unless asked, and the last use as ISO time", async () => {
  const host = seeded();
  const connection = await open(host);
  const plain = await connection.request("secret.list", {});
  expect(plain.secrets).toEqual([
    { name: EXA, status: "valid", lastUsedAt: "2026-10-20T01:02:03.000Z" },
    { name: GITHUB, status: "missing" },
  ]);
  const withMeta = await connection.request("secret.list", { meta: true, usage: true });
  expect(withMeta.secrets[0]?.meta).toMatchObject({
    name: EXA,
    provider: "sops",
    ref: "dev/EXA_KEY",
  });
  expect(host.fake.secrets.calls.slice(-1)).toEqual(["ls"]);
  expect(JSON.stringify(withMeta)).not.toContain(VALUE);
  await connection.close();
});

test("secret.list names an orphaned provider entry from its ref and skips one that cannot be named", async () => {
  const host = seeded();
  host.fake.secrets.orphanRefs.push("dev/OLD_TOKEN", "dev/1-bad", "dev/x");
  const connection = await open(host);
  const listed = await connection.request("secret.list", {});
  expect(listed.secrets.filter((entry) => entry.status === "orphaned")).toEqual([
    { name: nameOf("old-token"), status: "orphaned" },
  ]);
  expect(
    host.fake.log.infos.filter((entry) => entry.message === "secret.list_skipped"),
  ).toHaveLength(2);
  await connection.close();
});

test("secret.meta applies only the given fields and returns the entry with its status", async () => {
  const host = seeded();
  const connection = await open(host);
  const patched = await connection.request("secret.meta", {
    name: EXA,
    desc: "search key",
    approval: "per-use",
    expiresAt: null,
  });
  expect(patched.secret.name).toBe(EXA);
  expect(patched.secret.status).toBe("valid");
  expect(patched.secret.meta).toMatchObject({
    desc: "search key",
    approval: "per-use",
    ttlSeconds: 900,
  });
  expect(host.fake.secrets.records.get(EXA)?.meta.use.modes).toEqual(["env"]);
  await connection.close();
});

test("secret.meta on a name that has no metadata fails, and an invalid patch is -32602", async () => {
  const host = seeded();
  const connection = await open(host);
  const unknown = await rejectionOf(
    connection.request("secret.meta", { name: nameOf("nope-key") }),
  );
  expect(unknown).toBeInstanceOf(WireError);
  if (unknown instanceof WireError) {
    expect(unknown.data.kind).toBe("secret.notFound");
    expect(unknown.code).toBe(3201);
    expect(unknown.data.details).toEqual({ where: "meta" });
  }
  const invalid = await rejectionOf(
    connection.request("secret.meta", { name: EXA, desc: "invalid desc" }),
  );
  expect(invalid).toBeInstanceOf(WireError);
  if (invalid instanceof WireError) {
    expect(invalid.code).toBe(-32602);
    expect(invalid.data.details).toEqual({ issues: [{ path: "", message: "/desc: pattern" }] });
  }
  // 스키마가 허용하는 범위를 넘는 값은 처리기를 부르기 전에 -32602다
  const outOfRange = await rejectionOf(
    connection.request("secret.meta", { name: EXA, ttlSeconds: 100_000 }),
  );
  expect(outOfRange).toBeInstanceOf(WireError);
  if (outOfRange instanceof WireError) expect(outOfRange.code).toBe(-32602);
  await connection.close();
});

test("secret.remove removes, reports a name that is already gone, and refuses while a lease is active", async () => {
  const host = seeded();
  const connection = await open(host);
  expect(await connection.request("secret.remove", { name: GITHUB })).toEqual({ removed: true });
  expect(host.fake.secrets.records.has(GITHUB)).toBe(false);
  expect(await connection.request("secret.remove", { name: GITHUB })).toEqual({ removed: false });
  const record = host.fake.secrets.records.get(EXA);
  if (record !== undefined) record.activeLeases = 2;
  const refused = await rejectionOf(connection.request("secret.remove", { name: EXA }));
  expect(refused).toBeInstanceOf(WireError);
  if (refused instanceof WireError) {
    expect(refused.data.kind).toBe("secret.inUse");
    expect(refused.code).toBe(3206);
    expect(refused.data.details).toEqual({ activeLeases: 2 });
  }
  expect(host.fake.secrets.records.has(EXA)).toBe(true);
  await connection.close();
});

test("secret.test carries the state, decryptability, length and hash prefix without the value", async () => {
  const host = seeded();
  const connection = await open(host);
  expect(await connection.request("secret.test", { name: EXA })).toEqual({
    state: "registered",
    decryptable: true,
    length: VALUE.length,
    sha256Prefix: null,
  });
  const absent = {
    state: "missing",
    decryptable: false,
    length: null,
    sha256Prefix: null,
  } as const;
  expect(await connection.request("secret.test", { name: GITHUB })).toEqual(absent);
  expect(await connection.request("secret.test", { name: nameOf("never-added") })).toEqual(absent);
  await connection.close();
});

test("secret.beginEntry without an offered input is started false and reads nothing", async () => {
  const host = seeded();
  const connection = await open(host);
  expect(await connection.request("secret.beginEntry", { name: EXA, action: "set" })).toEqual({
    started: false,
  });
  expect(host.fake.secrets.received).toEqual([]);
  await connection.close();
});

test("secret.beginEntry add makes the secret with the default metadata and takes the offered input once", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  const input = sourceOf(VALUE);
  host.fake.secrets.port.offers.offerEntry({ name: EXA, action: "add", source: input.source });
  const started = await connection.request("secret.beginEntry", { name: EXA, action: "add" });
  expect(started).toEqual({ started: true });
  expect(input.state.reads).toBe(1);
  expect(host.fake.secrets.received).toEqual([VALUE]);
  const record = host.fake.secrets.records.get(EXA);
  expect(record?.meta).toEqual({
    name: EXA,
    desc: EXA,
    provider: "sops",
    ref: "dev/EXA_KEY",
    scope: "user",
    expiresAt: null,
    use: { modes: [], tools: [], hosts: [] },
    approval: "per-session",
    ttlSeconds: 900,
    maxUses: 200,
  });
  // 한 번 쓰이면 비워진다
  expect(await connection.request("secret.beginEntry", { name: EXA, action: "add" })).toEqual({
    started: false,
  });
  expect(input.state.reads).toBe(1);
  await connection.close();
});

test("secret.beginEntry takes the offer by name and action, set and rotate replace the value", async () => {
  const host = seeded();
  const connection = await open(host);
  const { offers } = host.fake.secrets.port;
  const forSet = sourceOf("set-value-111111");
  offers.offerEntry({ name: EXA, action: "set", source: forSet.source });
  // 동작이 다르면 꺼내지 않고 맡긴 수단이 남는다
  expect(await connection.request("secret.beginEntry", { name: EXA, action: "rotate" })).toEqual({
    started: false,
  });
  expect(forSet.state.reads).toBe(0);
  expect(await connection.request("secret.beginEntry", { name: EXA, action: "set" })).toEqual({
    started: true,
  });
  expect(host.fake.secrets.records.get(EXA)?.value).toBe("set-value-111111");
  const forRotate = sourceOf("rotated-value-2222");
  offers.offerEntry({ name: EXA, action: "rotate", source: forRotate.source });
  expect(await connection.request("secret.beginEntry", { name: EXA, action: "rotate" })).toEqual({
    started: true,
  });
  expect(host.fake.secrets.records.get(EXA)?.value).toBe("rotated-value-2222");
  await connection.close();
});

test("a withdrawn offer is not used, and a withdrawal after use does nothing", async () => {
  const host = seeded();
  const connection = await open(host);
  const input = sourceOf(VALUE);
  const withdraw = host.fake.secrets.port.offers.offerEntry({
    name: EXA,
    action: "set",
    source: input.source,
  });
  withdraw();
  expect(await connection.request("secret.beginEntry", { name: EXA, action: "set" })).toEqual({
    started: false,
  });
  expect(input.state.reads).toBe(0);
  await connection.close();
});

test("a cancelled input is started false and stores nothing; a short value is -32602 without the value", async () => {
  const host = seeded();
  const connection = await open(host);
  const { offers } = host.fake.secrets.port;
  offers.offerEntry({ name: EXA, action: "set", source: cancelledSource() });
  expect(await connection.request("secret.beginEntry", { name: EXA, action: "set" })).toEqual({
    started: false,
  });
  expect(host.fake.secrets.records.get(EXA)?.value).toBe(VALUE);

  offers.offerEntry({ name: EXA, action: "set", source: sourceOf("abc123").source });
  const refused = await rejectionOf(
    connection.request("secret.beginEntry", { name: EXA, action: "set" }),
  );
  expect(refused).toBeInstanceOf(WireError);
  if (refused instanceof WireError) {
    expect(refused.code).toBe(-32602);
    expect(JSON.stringify(refused.data)).not.toContain("abc123");
  }
  expect(host.fake.secrets.records.get(EXA)?.value).toBe(VALUE);
  await connection.close();
});

test("secret.beginEntry add needs a SOPS file in the settings to place the value", async () => {
  const bare = createFakeSecrets({ ...DEFAULT_SECRETS_CONFIG });
  expect(bare.port.newMeta(EXA)).toBeUndefined();
  const host = createFakeHost();
  const connection = await open(host);
  // 대역의 설정은 파일이 있다. 파일이 없는 포트로 바꿔 끼워 같은 경로를 확인한다
  const { admin, offers } = host.fake.engine.ports.secrets;
  const noFile = createSecretsPort(admin, () => ({ ...DEFAULT_SECRETS_CONFIG }));
  expect(noFile.newMeta(EXA)).toBeUndefined();
  offers.offerEntry({ name: EXA, action: "add", source: sourceOf(VALUE).source });
  expect(host.fake.secrets.port.newMeta(EXA)?.ref).toBe("dev/EXA_KEY");
  await connection.close();
});

test("secret.beginReveal hands the value to the offered show callback only", async () => {
  const host = seeded();
  const connection = await open(host);
  expect(await connection.request("secret.beginReveal", { name: EXA })).toEqual({ started: false });
  const printed: string[] = [];
  host.fake.secrets.port.offers.offerReveal({
    name: EXA,
    reauth: { method: "tty-confirm", verifiedAt: Date.now() },
    show: (value) => {
      printed.push(value.text());
      return Promise.resolve();
    },
  });
  const started = await connection.request("secret.beginReveal", { name: EXA });
  expect(started).toEqual({ started: true });
  expect(printed).toEqual([VALUE]);
  expect(JSON.stringify(started)).not.toContain(VALUE);
  // 한 번 쓰이면 비워진다
  expect(await connection.request("secret.beginReveal", { name: EXA })).toEqual({ started: false });
  expect(printed).toHaveLength(1);
  await connection.close();
});

test("a reveal whose human confirmation is not valid is started false and shows nothing", async () => {
  const host = seeded();
  const connection = await open(host);
  const printed: string[] = [];
  host.fake.secrets.port.offers.offerReveal({
    name: EXA,
    reauth: { method: "tty-confirm", verifiedAt: -1 },
    show: (value) => {
      printed.push(value.text());
      return Promise.resolve();
    },
  });
  expect(await connection.request("secret.beginReveal", { name: EXA })).toEqual({ started: false });
  expect(printed).toEqual([]);
  await connection.close();
});

test("no value reaches the host log, whatever the secret flow", async () => {
  const host = createFakeHost();
  const connection = await open(host);
  host.fake.secrets.port.offers.offerEntry({
    name: EXA,
    action: "add",
    source: sourceOf(VALUE).source,
  });
  await connection.request("secret.beginEntry", { name: EXA, action: "add" });
  host.fake.secrets.port.offers.offerReveal({
    name: EXA,
    reauth: { method: "tty-confirm", verifiedAt: Date.now() },
    show: () => Promise.resolve(),
  });
  await connection.request("secret.beginReveal", { name: EXA });
  const logged = JSON.stringify([host.fake.log.infos, host.fake.log.errors]);
  expect(logged).not.toContain(VALUE);
  expect(logged).toContain("secret.entry");
  await connection.close();
});

// ── M2 마감 G1-07: secret.references ───────────────────────────────────────────────────────

test("secret.references reports the setting keys, the active leases and the recent threads that point at a secret", async () => {
  const host = seeded();
  const thread = host.fake.seedThread();
  const record = host.fake.secrets.records.get(EXA);
  if (record === undefined) throw new Error("the seeded secret is missing");
  record.activeLeases = 1;
  record.references = {
    settingKeys: ["l2.web.search.exa.apiKey", "l1.models.providers"],
    sessions: [thread, "not-a-thread-id"],
  };
  const connection = await open(host);
  expect(await connection.request("secret.references", { name: EXA })).toEqual({
    settingKeys: ["l2.web.search.exa.apiKey", "l1.models.providers"],
    activeLeases: 1,
    sessions: [thread],
  });
  // 읽기 전용이다: 비밀은 그대로 있다
  expect(host.fake.secrets.records.has(EXA)).toBe(true);
  expect(host.fake.secrets.calls).toEqual(["references exa-key"]);
  await connection.close();
});

test("secret.references on a name without metadata is secret.notFound, and no value is in the log", async () => {
  const host = seeded();
  const connection = await open(host);
  const unknown = await rejectionOf(
    connection.request("secret.references", { name: nameOf("nope-key") }),
  );
  expect(unknown).toBeInstanceOf(WireError);
  if (unknown instanceof WireError) {
    expect(unknown.data.kind).toBe("secret.notFound");
    expect(JSON.stringify(unknown)).not.toContain(VALUE);
  }
  await connection.close();
});
