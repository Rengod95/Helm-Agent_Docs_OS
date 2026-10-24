import { err, ok } from "@xeon/contracts";
import {
  secretRef,
  type SecretHandle,
  type SecretMeta,
  type SecretName,
} from "@xeon/contracts/capabilities";
import type {
  HumanReauth,
  SecretAdminService,
  SecretError,
  SecretListing,
  SecretValueSource,
  SecretValueView,
} from "@xeon/contracts/services";
import { DEFAULT_SECRETS_CONFIG, type SecretsConfig } from "@xeon/platform-secrets";
import { createSecretsPort } from "../../src/assembly/secrets.ts";
import type { SecretsPort } from "../../src/types.ts";

// 비밀 관리 서비스(platform-secrets의 admin)의 메모리 대역. 호스트의 secret.* 처리기와 SecretsPort(기본 메타, 맡긴 수단 저장소)는
// 실제 코드를 쓰고, L0.secrets 쪽만 바꾼다. 값은 길이와 호출 기록으로만 남기고, 시험이 "값이 새지 않았다"를 확인할 수 있게
// 받은 값을 `received`에 둔다(시험 전용).

export const FAKE_SECRETS_CONFIG: SecretsConfig = {
  ...DEFAULT_SECRETS_CONFIG,
  sops: { files: [{ env: "dev", path: "/etc/xeon/dev.sops.json" }], binary: null },
};

export interface FakeSecretRecord {
  meta: SecretMeta;
  /** 제공자에 값이 있는가 */
  exists: boolean;
  decryptable: boolean;
  value: string | null;
  lastUsedAt: number | null;
  activeLeases: number;
}

export interface FakeSecrets {
  readonly port: SecretsPort;
  readonly records: Map<SecretName, FakeSecretRecord>;
  /** 관리 서비스 호출 기록: "<메서드> <이름>" */
  readonly calls: string[];
  /** 서비스가 읽은 값(시험 전용). 와이어 어디에도 나오면 안 된다 */
  readonly received: string[];
  /** 서비스가 show 콜백에 건넨 값(시험 전용) */
  readonly shown: string[];
  /** 메타 없이 제공자에만 있는 항목(orphaned) */
  readonly orphanRefs: string[];
}

export function sampleMeta(name: SecretName, overrides: Partial<SecretMeta> = {}): SecretMeta {
  return {
    name,
    desc: `desc of ${name}`,
    provider: "sops",
    ref: `dev/${name.toUpperCase().replaceAll("-", "_")}`,
    scope: "user",
    expiresAt: null,
    use: { modes: ["env"], tools: ["bash:gh"], hosts: [] },
    approval: "per-session",
    ttlSeconds: 900,
    maxUses: 200,
    ...overrides,
  };
}

function missing(handle: SecretHandle): SecretError {
  return { kind: "secret_missing", handle, where: "meta" };
}

function viewOf(text: string): SecretValueView {
  const bytes = new TextEncoder().encode(text);
  return { bytes, text: () => text };
}

export function createFakeSecrets(config: SecretsConfig = FAKE_SECRETS_CONFIG): FakeSecrets {
  const records = new Map<SecretName, FakeSecretRecord>();
  const calls: string[] = [];
  const received: string[] = [];
  const shown: string[] = [];
  const orphanRefs: string[] = [];
  const decoder = new TextDecoder();

  function nameOf(handle: SecretHandle): SecretName | undefined {
    return Array.from(records.keys()).find((name) => secretRef(name) === handle);
  }

  async function readValue(source: SecretValueSource): Promise<string | SecretError> {
    const read = await source.read();
    if (!read.ok) {
      return read.error.kind === "input_cancelled"
        ? { kind: "cancelled" }
        : { kind: "value_too_short", minBytes: 8 };
    }
    const text = decoder.decode(read.value);
    received.push(text);
    read.value.fill(0);
    if (text.length < 8) return { kind: "value_too_short", minBytes: 8 };
    return text;
  }

  function listingOf(record: FakeSecretRecord): SecretListing {
    return {
      meta: record.meta,
      entry: record.exists ? { provider: "sops", ref: record.meta.ref, updatedAt: null } : null,
      handle: secretRef(record.meta.name),
      status: record.exists ? "valid" : "missing",
      lastUsedAt: record.lastUsedAt,
    };
  }

  const admin: SecretAdminService = {
    ls() {
      calls.push("ls");
      const listings = Array.from(records.values()).map(listingOf);
      for (const ref of orphanRefs) {
        listings.push({
          meta: null,
          entry: { provider: "sops", ref, updatedAt: null },
          handle: null,
          status: "orphaned",
          lastUsedAt: null,
        });
      }
      return Promise.resolve(ok(listings));
    },
    usage: () => Promise.reject(new Error("usage is not part of the fake")),
    async add(meta, source) {
      calls.push(`add ${meta.name}`);
      const handle = secretRef(meta.name);
      if (records.has(meta.name)) return err({ kind: "already_exists", handle });
      const value = await readValue(source);
      if (typeof value !== "string") return err(value);
      records.set(meta.name, {
        meta,
        exists: true,
        decryptable: true,
        value,
        lastUsedAt: null,
        activeLeases: 0,
      });
      return ok(handle);
    },
    async set(handle, source) {
      const name = nameOf(handle);
      calls.push(`set ${name ?? "?"}`);
      const record = name === undefined ? undefined : records.get(name);
      if (record === undefined) return err(missing(handle));
      const value = await readValue(source);
      if (typeof value !== "string") return err(value);
      record.value = value;
      record.exists = true;
      return ok(undefined);
    },
    meta(handle, patch) {
      const name = nameOf(handle);
      calls.push(`meta ${name ?? "?"}`);
      const record = name === undefined ? undefined : records.get(name);
      if (record === undefined) return Promise.resolve(err(missing(handle)));
      if (patch.desc === "invalid desc") {
        return Promise.resolve(
          err({
            kind: "meta_invalid",
            name: record.meta.name,
            path: "",
            errors: ["/desc: pattern"],
          }),
        );
      }
      record.meta = {
        ...record.meta,
        ...(patch.desc === undefined ? {} : { desc: patch.desc }),
        ...(patch.scope === undefined ? {} : { scope: patch.scope }),
        ...(patch.expiresAt === undefined ? {} : { expiresAt: patch.expiresAt }),
        ...(patch.use === undefined ? {} : { use: patch.use }),
        ...(patch.approval === undefined ? {} : { approval: patch.approval }),
        ...(patch.ttlSeconds === undefined ? {} : { ttlSeconds: patch.ttlSeconds }),
        ...(patch.maxUses === undefined ? {} : { maxUses: patch.maxUses }),
      };
      return Promise.resolve(ok(record.meta));
    },
    async rotate(handle, source) {
      const name = nameOf(handle);
      calls.push(`rotate ${name ?? "?"}`);
      const record = name === undefined ? undefined : records.get(name);
      if (record === undefined) return err(missing(handle));
      const value = await readValue(source);
      if (typeof value !== "string") return err(value);
      record.value = value;
      const revokedLeases = record.activeLeases;
      record.activeLeases = 0;
      return ok({ revokedLeases });
    },
    references: () => Promise.reject(new Error("references is not part of the fake")),
    rm(handle) {
      const name = nameOf(handle);
      calls.push(`rm ${name ?? "?"}`);
      const record = name === undefined ? undefined : records.get(name);
      if (record === undefined) return Promise.resolve(err(missing(handle)));
      if (record.activeLeases > 0) {
        return Promise.resolve(err({ kind: "in_use", handle, activeLeases: record.activeLeases }));
      }
      records.delete(record.meta.name);
      return Promise.resolve(ok(undefined));
    },
    test(handle) {
      const name = nameOf(handle);
      calls.push(`test ${name ?? "?"}`);
      const record = name === undefined ? undefined : records.get(name);
      if (record === undefined) return Promise.resolve(err(missing(handle)));
      return Promise.resolve(
        ok({
          exists: record.exists,
          decryptable: record.decryptable,
          length: record.value === null ? null : record.value.length,
          sha256Prefix: null,
        }),
      );
    },
    run: () => Promise.reject(new Error("run is not part of the fake")),
    async reveal(handle, reauth: HumanReauth, show) {
      const name = nameOf(handle);
      calls.push(`reveal ${name ?? "?"}`);
      if (reauth.method === "tty-confirm" && reauth.verifiedAt < 0) {
        return err({ kind: "reauth_required" });
      }
      const record = name === undefined ? undefined : records.get(name);
      if (record === undefined || record.value === null) return err(missing(handle));
      const view = viewOf(record.value);
      shown.push(record.value);
      await show(view);
      view.bytes.fill(0);
      return ok(undefined);
    },
  };

  return {
    port: createSecretsPort(admin, () => config),
    records,
    calls,
    received,
    shown,
    orphanRefs,
  };
}
