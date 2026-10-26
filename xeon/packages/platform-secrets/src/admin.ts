import { createHash } from "node:crypto";
import { assertNever, err, ok, parse, type Clock, type Logger, type Result } from "@xeon/contracts";
import {
  SecretMetaSchema,
  type SecretAuditRecord,
  type SecretHandle,
  type SecretMeta,
  type SecretName,
} from "@xeon/contracts/capabilities";
import type {
  HumanReauth,
  SecretAdminService,
  SecretError,
  SecretLease,
  SecretListing,
  SecretMetaPatch,
  SecretProvider,
  SecretProviderCapabilities,
  SecretReferenceReport,
  SecretTestResult,
  SecretValueSource,
  SecretValueView,
  UseCtx,
} from "@xeon/contracts/services";
import { adminRecord, revealedRecord } from "./audit.ts";
import type { AuditLog } from "./audit-file.ts";
import { filterSensitiveEnv } from "./env-filter.ts";
import type { MetaStore } from "./meta.ts";
import { parseHandle } from "./ref.ts";
import type { SecretServiceInternal, SecretServiceRuntime } from "./service.ts";

// L0.secrets.spec §3.8, §4.9. 사람 전용 관리 서비스(xeon.secretAdmin). 조립 루트가 L4 진입점에만 넘기고 확장과 모델 도구에는 주지 않는다.
// 값은 SecretValueSource로만 받고(argv 경로 없음), 받은 바이트는 제공자에 넘긴 직후 0으로 덮는다.

/** 값 최소 길이. 이보다 짧으면 Redactor가 가릴 수 없다(spec §3.5) */
const MIN_VALUE_BYTES = 8;
/** reveal 재인증 증거의 유효 시간(spec §3.8, 60초) */
const REVEAL_REAUTH_MAX_AGE_MS = 60_000;
/** references가 돌려주는 최근 세션 수 */
const SESSION_LIMIT = 10;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 제공자 lease를 쓰는 관리 동작(test, reveal)의 lease 한도 */
const ADMIN_LEASE_LIMITS = { ttlSeconds: 60, maxUses: 1 } as const;
/** 자식 프로세스를 띄우지 못했을 때의 종료 코드(셸의 command not found 관례) */
const SPAWN_FAILED_EXIT = 127;

// ── 자식 프로세스 실행기 (secret run) ─────────────────────────────────────

export interface ChildRequest {
  readonly argv: readonly string[];
  /** 자식 env 전체. 부모 env를 물려받지 않는다 */
  readonly env: Readonly<Record<string, string>>;
}

export type ChildResult =
  | { readonly kind: "exited"; readonly exitCode: number }
  | { readonly kind: "spawn_failed"; readonly code: string };

/** stdio를 터미널에 그대로 잇는 실행기. 런타임은 출력을 저장하지 않는다. 테스트는 가짜를 넘긴다 */
export type ChildRunner = (request: ChildRequest) => Promise<ChildResult>;

export const bunInheritRunner: ChildRunner = async (request) => {
  try {
    const proc = Bun.spawn([...request.argv], {
      env: { ...request.env },
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    return { kind: "exited", exitCode: await proc.exited };
  } catch (error: unknown) {
    const code: unknown = error instanceof Error ? Reflect.get(error, "code") : undefined;
    return { kind: "spawn_failed", code: typeof code === "string" ? code : "unknown" };
  }
};

// ── 의존 ─────────────────────────────────────────────────────────────────

export interface SecretAdminDeps {
  /** 공개 서비스와 사람 전용 통로를 합친 값. 조립이 관리 서비스에만 넘기고 `xeon.secrets`로는 공개 쪽 객체만 등록한다 */
  readonly service: Pick<SecretServiceRuntime, "redactor" | "list"> & SecretServiceInternal;
  readonly meta: MetaStore;
  /** 감사 파일. 없으면 usage·references의 세션 목록이 비어 있다 */
  readonly auditLog: AuditLog | null;
  readonly clock: Clock;
  readonly logger: Logger;
  /** OS 인증 재확인을 쓸 수 있는 환경인가. 쓸 수 있으면 reveal은 os-auth만 받는다(spec §4.9, U-20) */
  readonly osAuthAvailable: () => boolean;
  /** 핸들을 값으로 가진 설정 키. 설정 저장소는 이 층 밖이라 조립 루트가 넘긴다 */
  readonly settingKeysFor: (handle: SecretHandle) => Promise<readonly string[]>;
  readonly runChild: ChildRunner;
  /** secret run 자식 env의 재료. 민감 이름은 거른다 */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
}

// ── 도우미 ───────────────────────────────────────────────────────────────

function handleOfName(name: SecretName): Result<SecretHandle, SecretError> {
  const parsed = parseHandle(`secret://${name}`);
  return parsed.ok ? ok(parsed.value.handle) : err(parsed.error);
}

function sha256Prefix(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 8);
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface RefreshableProvider extends SecretProvider {
  refreshCapabilities(): Promise<SecretProviderCapabilities>;
}

function isRefreshable(provider: SecretProvider): provider is RefreshableProvider {
  return typeof Reflect.get(provider, "refreshCapabilities") === "function";
}

/** 쓰기를 못 하는 이유를 더 정확히 밝힐 수 있는 제공자(예: sops 바이너리가 없어 쓰기 지원을 판정하지 못함) */
function explainsReadOnly(
  provider: SecretProvider,
): provider is SecretProvider & { readOnlyReason(): Promise<SecretError> } {
  return "readOnlyReason" in provider && typeof provider.readOnlyReason === "function";
}

async function capabilitiesOf(provider: SecretProvider): Promise<SecretProviderCapabilities> {
  return isRefreshable(provider) ? provider.refreshCapabilities() : provider.capabilities();
}

/** 사람이 직접 하는 동작의 UseCtx. 제공자 lease와 감사에 쓴다 */
function humanCtx(purpose: string, commandLine: string): UseCtx {
  const argv0 = commandLine.split(" ")[0] ?? "";
  return {
    mode: "env",
    purpose,
    target: { kind: "command", argv0, commandLine },
    actor: "human",
    threadId: null,
    toolCallId: null,
    projectId: null,
    approval: null,
  };
}

/** 사람이 입력한 값을 받는다. 8바이트 미만은 거부하고 바이트를 덮는다 */
async function readValue(source: SecretValueSource): Promise<Result<Uint8Array, SecretError>> {
  const read = await source.read();
  if (!read.ok) {
    return read.error.kind === "input_cancelled"
      ? err({ kind: "cancelled" })
      : err({ kind: "value_too_short", minBytes: MIN_VALUE_BYTES });
  }
  if (read.value.length < MIN_VALUE_BYTES) {
    read.value.fill(0);
    return err({ kind: "value_too_short", minBytes: MIN_VALUE_BYTES });
  }
  return ok(read.value);
}

async function putValue(
  provider: SecretProvider,
  meta: SecretMeta,
  source: SecretValueSource,
): Promise<Result<void, SecretError>> {
  const caps = await capabilitiesOf(provider);
  if (!caps.put || provider.put === undefined) {
    return err(
      explainsReadOnly(provider)
        ? await provider.readOnlyReason()
        : { kind: "read_only_provider", provider: meta.provider },
    );
  }
  const value = await readValue(source);
  if (!value.ok) return value;
  try {
    return await provider.put(meta.ref, value.value);
  } finally {
    value.value.fill(0);
  }
}

// ── 서비스 ───────────────────────────────────────────────────────────────

export function createSecretAdminService(deps: SecretAdminDeps): SecretAdminService {
  const { service, clock, logger } = deps;

  async function loadMeta(
    handle: SecretHandle,
  ): Promise<Result<{ readonly name: SecretName; readonly meta: SecretMeta }, SecretError>> {
    const parsed = parseHandle(handle);
    if (!parsed.ok) return err(parsed.error);
    const entry = await deps.meta.get(parsed.value.name);
    if (entry === null) return err({ kind: "secret_missing", handle, where: "meta" });
    if (entry.kind === "invalid") return err(entry.error);
    return ok({ name: entry.name, meta: entry.meta });
  }

  function providerOf(meta: SecretMeta): Result<SecretProvider, SecretError> {
    const provider = service.providerFor(meta.provider);
    if (provider === undefined) {
      return err({
        kind: "provider_unavailable",
        provider: meta.provider,
        reason: "not_registered",
      });
    }
    return ok(provider);
  }

  /** 상태를 이미 바꾼 동작의 감사 기록. 파일에 못 써도 결과를 뒤집지 않고 기록만 남긴다(열람은 따로 닫는다) */
  async function note(record: SecretAuditRecord): Promise<void> {
    const recorded = await service.recordAdmin(record);
    if (!recorded.ok) logger.error("secrets.admin.audit_failed", { type: record.type });
  }

  /** set·rotate 공통: 값을 넣고 활성 lease를 닫고 이전 값 변형을 지운다 */
  async function replaceValue(
    handle: SecretHandle,
    source: SecretValueSource,
  ): Promise<Result<{ readonly name: SecretName; readonly revoked: number }, SecretError>> {
    const loaded = await loadMeta(handle);
    if (!loaded.ok) return loaded;
    const provider = providerOf(loaded.value.meta);
    if (!provider.ok) return provider;
    const put = await putValue(provider.value, loaded.value.meta, source);
    if (!put.ok) return put;
    const revoked = service.revokeLeases(handle);
    service.redactor.forget(loaded.value.name);
    return ok({ name: loaded.value.name, revoked });
  }

  async function auditRecords(): Promise<readonly SecretAuditRecord[]> {
    if (deps.auditLog === null) return [];
    const read = await deps.auditLog.read();
    if (!read.ok) {
      logger.warn("secrets.admin.audit_unreadable", { code: read.error.code });
      return [];
    }
    return read.value;
  }

  // ── 목록·이력 ──────────────────────────────────────────────────────────

  async function ls(options: {
    readonly usage: boolean;
  }): Promise<Result<readonly SecretListing[], SecretError>> {
    const listed = await service.list();
    if (!listed.ok || !options.usage) return listed;
    // 다른 프로세스(호스트, 이전 실행)의 사용도 보이도록 감사 파일에서 마지막 사용 시각을 채운다
    const lastUsed = new Map<SecretHandle, number>();
    for (const record of await auditRecords()) {
      if (record.type !== "secret.used") continue;
      lastUsed.set(record.handle, Math.max(lastUsed.get(record.handle) ?? 0, record.at));
    }
    const filled: SecretListing[] = [];
    for (const listing of listed.value) {
      const handle = listing.handle;
      const fromFile = handle === null ? undefined : lastUsed.get(handle);
      filled.push(
        fromFile === undefined
          ? listing
          : { ...listing, lastUsedAt: Math.max(listing.lastUsedAt ?? 0, fromFile) },
      );
    }
    return ok(filled);
  }

  async function usage(
    handle: SecretHandle,
    filter: { readonly since?: number; readonly decision?: "allow" | "deny" },
  ): Promise<Result<readonly SecretAuditRecord[], SecretError>> {
    const loaded = await loadMeta(handle);
    if (!loaded.ok) return loaded;
    const wanted = filter.decision === "allow" ? "secret.used" : "secret.denied";
    const since = filter.since;
    return ok(
      (await auditRecords()).filter((record) => {
        if (!("handle" in record) || record.handle !== handle) return false;
        if (since !== undefined && record.at < since) return false;
        if (filter.decision === undefined) {
          return record.type === "secret.used" || record.type === "secret.denied";
        }
        return record.type === wanted;
      }),
    );
  }

  // ── 쓰기 ───────────────────────────────────────────────────────────────

  async function add(
    meta: SecretMeta,
    source: SecretValueSource,
  ): Promise<Result<SecretHandle, SecretError>> {
    const handle = handleOfName(meta.name);
    if (!handle.ok) return handle;
    const checked = parse(SecretMetaSchema, meta);
    if (!checked.ok) {
      return err({
        kind: "meta_invalid",
        name: meta.name,
        path: "",
        errors: checked.error.issues.map((i) => `${i.path === "" ? "/" : i.path}: ${i.keyword}`),
      });
    }
    if ((await deps.meta.get(meta.name)) !== null) {
      return err({ kind: "already_exists", handle: handle.value });
    }
    const provider = providerOf(meta);
    if (!provider.ok) return provider;

    const entries = await provider.value.list();
    if (!entries.ok) return entries;
    const present = entries.value.some((entry) => entry.ref === meta.ref);
    // 제공자에 이미 항목이 있으면(예: `just secret-add`가 만든 SOPS 키) 값은 건드리지 않고 메타만 붙인다(spec §4.8 (b))
    const fields = present ? ["meta"] : ["meta", "value"];
    if (!present) {
      const put = await putValue(provider.value, meta, source);
      if (!put.ok) return put;
    }
    const written = await deps.meta.write(meta, { overwrite: false });
    if (!written.ok) {
      if (!present) await rollbackValue(provider.value, meta);
      return written;
    }
    await note(
      adminRecord({ type: "secret.created", handle: handle.value, fields, at: clock.now() }),
    );
    return ok(handle.value);
  }

  /** 메타 쓰기에 실패했을 때 방금 넣은 값을 되돌린다. 되돌리지 못하면 orphaned 항목으로 남으므로 기록한다 */
  async function rollbackValue(provider: SecretProvider, meta: SecretMeta): Promise<void> {
    if (provider.remove === undefined) {
      logger.warn("secrets.admin.rollback_unavailable", { name: meta.name });
      return;
    }
    const removed = await provider.remove(meta.ref);
    if (!removed.ok) logger.warn("secrets.admin.rollback_failed", { name: meta.name });
  }

  async function set(
    handle: SecretHandle,
    source: SecretValueSource,
  ): Promise<Result<void, SecretError>> {
    const replaced = await replaceValue(handle, source);
    if (!replaced.ok) return replaced;
    await note(adminRecord({ type: "secret.updated", handle, fields: ["value"], at: clock.now() }));
    return ok(undefined);
  }

  async function rotate(
    handle: SecretHandle,
    source: SecretValueSource,
  ): Promise<Result<{ readonly revokedLeases: number }, SecretError>> {
    const replaced = await replaceValue(handle, source);
    if (!replaced.ok) return replaced;
    await note(adminRecord({ type: "secret.rotated", handle, fields: ["value"], at: clock.now() }));
    return ok({ revokedLeases: replaced.value.revoked });
  }

  async function patchMeta(
    handle: SecretHandle,
    patch: SecretMetaPatch,
  ): Promise<Result<SecretMeta, SecretError>> {
    const loaded = await loadMeta(handle);
    if (!loaded.ok) return loaded;
    const current = loaded.value.meta;
    const merged = {
      ...current,
      ...(patch.desc === undefined ? {} : { desc: patch.desc }),
      ...(patch.scope === undefined ? {} : { scope: patch.scope }),
      ...(patch.expiresAt === undefined ? {} : { expiresAt: patch.expiresAt }),
      ...(patch.use === undefined ? {} : { use: patch.use }),
      ...(patch.approval === undefined ? {} : { approval: patch.approval }),
      ...(patch.ttlSeconds === undefined ? {} : { ttlSeconds: patch.ttlSeconds }),
      ...(patch.maxUses === undefined ? {} : { maxUses: patch.maxUses }),
    };
    const checked = parse(SecretMetaSchema, merged);
    if (!checked.ok) {
      return err({
        kind: "meta_invalid",
        name: loaded.value.name,
        path: "",
        errors: checked.error.issues.map((i) => `${i.path === "" ? "/" : i.path}: ${i.keyword}`),
      });
    }
    const next = checked.value;
    const changed = (
      ["desc", "scope", "expiresAt", "use", "approval", "ttlSeconds", "maxUses"] as const
    ).filter((field) => !sameJson(current[field], next[field]));
    if (changed.length === 0) return ok(current);

    const written = await deps.meta.write(next, { overwrite: true });
    if (!written.ok) return written;
    // 사용 정책을 바꾸면 이전 정책으로 연 lease가 남지 않게 닫는다(좁히는 변경이 즉시 적용되도록)
    const policyFields = new Set(["scope", "expiresAt", "use", "approval"]);
    if (changed.some((field) => policyFields.has(field))) service.revokeLeases(handle);
    await note(adminRecord({ type: "secret.updated", handle, fields: changed, at: clock.now() }));
    return ok(next);
  }

  async function references(
    handle: SecretHandle,
  ): Promise<Result<SecretReferenceReport, SecretError>> {
    const loaded = await loadMeta(handle);
    if (!loaded.ok) return loaded;
    const sessions: string[] = [];
    const records = await auditRecords();
    for (const record of records.toReversed()) {
      if (record.type !== "secret.used" || record.handle !== handle) continue;
      if (record.threadId === null || sessions.includes(record.threadId)) continue;
      sessions.push(record.threadId);
      if (sessions.length >= SESSION_LIMIT) break;
    }
    return ok({
      settingKeys: await deps.settingKeysFor(handle),
      activeLeases: service.activeLeaseCount(handle),
      sessions,
    });
  }

  async function rm(
    handle: SecretHandle,
    _confirm: { readonly confirmed: true },
  ): Promise<Result<void, SecretError>> {
    // 확인 없는 삭제는 인자 타입(confirmed: true)이 막는다
    const loaded = await loadMeta(handle);
    if (!loaded.ok) return loaded;
    const active = service.activeLeaseCount(handle);
    if (active > 0) return err({ kind: "in_use", handle, activeLeases: active });
    const { name, meta: current } = loaded.value;
    const provider = providerOf(current);
    if (!provider.ok) return provider;

    // 제공자가 지울 수 있으면 값까지 지운다. 지울 수 없으면 메타만 지워 사용을 막고 항목은 orphaned로 남긴다
    const fields = ["meta"];
    if (provider.value.remove !== undefined && (await capabilitiesOf(provider.value)).remove) {
      const entries = await provider.value.list();
      if (!entries.ok) return entries;
      if (entries.value.some((entry) => entry.ref === current.ref)) {
        const removed = await provider.value.remove(current.ref);
        if (!removed.ok) return removed;
        fields.push("value");
      }
    }
    const dropped = await deps.meta.remove(name);
    if (!dropped.ok) return dropped;
    service.redactor.forget(name);
    await note(adminRecord({ type: "secret.deleted", handle, fields, at: clock.now() }));
    return ok(undefined);
  }

  async function test(handle: SecretHandle): Promise<Result<SecretTestResult, SecretError>> {
    const loaded = await loadMeta(handle);
    if (!loaded.ok) return loaded;
    const provider = providerOf(loaded.value.meta);
    if (!provider.ok) return provider;
    const opened = await provider.value.lease(
      loaded.value.meta.ref,
      humanCtx("secret.test", "xeon secret test"),
      ADMIN_LEASE_LIMITS,
    );
    if (!opened.ok) {
      const error = opened.error;
      if (error.kind === "secret_missing") {
        return ok({ exists: false, decryptable: false, length: null, sha256Prefix: null });
      }
      if (error.kind === "decrypt_failed") {
        return ok({ exists: true, decryptable: false, length: null, sha256Prefix: null });
      }
      return err(error);
    }
    const lease = opened.value;
    try {
      const measured = await lease.use((view: SecretValueView) => ({
        length: view.bytes.length,
        prefix: sha256Prefix(view.bytes),
      }));
      if (!measured.ok) return measured;
      return ok({
        exists: true,
        decryptable: true,
        length: measured.value.length,
        sha256Prefix: measured.value.prefix,
      });
    } finally {
      lease.dispose();
    }
  }

  // ── 사람 실행 ──────────────────────────────────────────────────────────

  async function run(
    env: Readonly<Record<string, SecretHandle>>,
    argv: readonly string[],
    _io: { readonly inheritStdio: true },
  ): Promise<Result<{ readonly exitCode: number }, SecretError>> {
    if (argv.length === 0) return err({ kind: "cancelled" });
    const childEnv: Record<string, string> = filterSensitiveEnv(deps.parentEnv);
    const commandLine = argv.join(" ");
    const leases: SecretLease[] = [];
    try {
      const entries = Object.entries(env);
      if (entries.some(([name]) => !ENV_NAME.test(name))) {
        // 환경 변수 이름 규칙 위반은 이름 형식 오류로 돌려준다
        return err({ kind: "invalid_ref", reason: "name_pattern" });
      }
      const opened = await Promise.all(
        entries.map(([, handle]) =>
          service.leaseAsHuman(handle, humanCtx("secret.run", commandLine)),
        ),
      );
      for (const result of opened) {
        if (result.ok) leases.push(result.value);
      }
      for (const result of opened) {
        if (!result.ok) return result;
      }
      const texts = await Promise.all(leases.map((lease) => lease.use((view) => view.text())));
      for (const [index, text] of texts.entries()) {
        const name = entries[index]?.[0];
        if (!text.ok) return text;
        if (name !== undefined) childEnv[name] = text.value;
      }
      const result = await deps.runChild({ argv, env: childEnv });
      if (result.kind === "spawn_failed") {
        logger.warn("secrets.admin.spawn_failed", { code: result.code });
        return ok({ exitCode: SPAWN_FAILED_EXIT });
      }
      return ok({ exitCode: result.exitCode });
    } finally {
      for (const lease of leases) lease.dispose();
    }
  }

  // ── 열람 ───────────────────────────────────────────────────────────────

  function reauthAllowed(reauth: HumanReauth): boolean {
    const age = clock.now() - reauth.verifiedAt;
    if (age < 0 || age > REVEAL_REAUTH_MAX_AGE_MS) return false;
    switch (reauth.method) {
      case "os-auth":
        return true;
      case "tty-confirm":
        // OS 인증을 쓸 수 있는 환경에서는 TTY 확인으로 대신하지 못한다
        return !deps.osAuthAvailable();
      case "passphrase":
        // 마일스톤 M2에는 암호 재확인 경로가 없다
        return false;
      default:
        return assertNever(reauth.method, "reauthAllowed");
    }
  }

  async function reveal(
    handle: SecretHandle,
    reauth: HumanReauth,
    show: (value: SecretValueView) => Promise<void>,
  ): Promise<Result<void, SecretError>> {
    if (!reauthAllowed(reauth)) {
      logger.warn("secrets.reveal.reauth_rejected", { method: reauth.method });
      return err({ kind: "reauth_required" });
    }
    const loaded = await loadMeta(handle);
    if (!loaded.ok) return loaded;
    const provider = providerOf(loaded.value.meta);
    if (!provider.ok) return provider;
    const opened = await provider.value.lease(
      loaded.value.meta.ref,
      humanCtx("secret.reveal", "xeon secret reveal"),
      ADMIN_LEASE_LIMITS,
    );
    if (!opened.ok)
      return opened.error.kind === "secret_missing"
        ? err({ kind: "secret_missing", handle, where: "provider" })
        : opened;
    const lease = opened.value;
    try {
      // 기록이 디스크에 남은 뒤에만 보인다. 기록하지 못하면 값을 보이지 않는다
      const recorded = await service.recordAdmin(
        revealedRecord({ handle, reauth: reauth.method, at: clock.now() }),
      );
      if (!recorded.ok) return recorded;
      const shown = await lease.use(show);
      if (!shown.ok) return shown;
      return ok(undefined);
    } finally {
      lease.dispose();
    }
  }

  return { ls, usage, add, set, meta: patchMeta, rotate, references, rm, test, run, reveal };
}
