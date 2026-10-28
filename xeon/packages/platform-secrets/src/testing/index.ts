import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Clock, type Logger, type Result, type Scheduler } from "@xeon/contracts";
import type { SecretAuditRecord, SecretHandle, SecretMeta } from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type {
  ProviderEntry,
  SecretAdminService,
  SecretError,
  SecretLease,
  SecretProvider,
} from "@xeon/contracts/services";
import { bunInheritRunner, createSecretAdminService, type ChildRunner } from "../admin.ts";
import type { AuditLog } from "../audit-file.ts";
import { DEFAULT_SECRETS_CONFIG } from "../config.ts";
import { createLease } from "../lease.ts";
import type { OsAuthError, OsAuthProvider } from "../os-auth.ts";
import type { MetaEntry, MetaStore } from "../meta.ts";
import { PROVIDER_PLACEHOLDER_HANDLE } from "../providers/sops.ts";
import { handleForName } from "../ref.ts";
import { createRedactor } from "../redactor.ts";
import {
  createSecretServiceCore,
  type SecretServiceInternal,
  type SecretServiceRuntime,
} from "../service.ts";

// eng.testing.guide TS-05, L0.secrets.plan §2. 다른 패키지의 테스트가 쓰는 가짜들이다(`./testing` 서브패스).
// 정책 판정·lease·Redactor는 운영 구현을 그대로 쓴다. 진짜 sops와 age 키를 쓰지 않는다.

// ── fakeSopsBinary ───────────────────────────────────────────────────────

export interface FakeSopsOptions {
  /** `--version` 출력에 쓸 버전. 기본 3.13.3 */
  readonly version?: string;
  /** 키 경로("GITHUB_TOKEN", "a.b") → 가짜 값 */
  readonly values?: Readonly<Record<string, string>>;
  /** 복호화 호출을 이 종료 코드와 stderr로 실패시킨다 */
  readonly failure?: { readonly exitCode: number; readonly stderr: string };
}

export interface FakeSops {
  /** 실행 파일 경로 */
  readonly path: string;
  /** 호출마다 인자 배열. `--version` 호출도 센다 */
  calls(): Promise<readonly (readonly string[])[]>;
  /** 마지막 복호화 호출의 자식 env 변수 이름(값 없음) */
  lastEnvNames(): Promise<readonly string[]>;
}

function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

/**
 * 테스트 임시 디렉터리 `dir`에 셸 스크립트를 만들어 sops처럼 동작하게 한다. 호출 인자와 자식 env 이름만
 * 파일에 기록한다. 값은 `values`에 준 가짜 값뿐이다.
 */
export async function fakeSopsBinary(
  dir: string,
  options: FakeSopsOptions = {},
): Promise<FakeSops> {
  const version = options.version ?? "3.13.3";
  const callsFile = join(dir, "fake-sops-calls.log");
  const envFile = join(dir, "fake-sops-env.names");
  const lines = [
    "#!/bin/sh",
    `for a in "$@"; do printf '%s\\t' "$a" >> ${shellQuote(callsFile)}; done`,
    `printf '\\n' >> ${shellQuote(callsFile)}`,
    `case " $* " in *" --version "*) printf 'sops ${version}\\n'; exit 0;; esac`,
    `env | cut -d= -f1 | sort > ${shellQuote(envFile)}`,
  ];
  if (options.failure !== undefined) {
    lines.push(
      `printf '%s' ${shellQuote(options.failure.stderr)} >&2`,
      `exit ${options.failure.exitCode}`,
    );
  } else {
    lines.push(
      `extract=''`,
      `prev=''`,
      `for a in "$@"; do if [ "$prev" = "--extract" ]; then extract="$a"; fi; prev="$a"; done`,
      `case "$extract" in`,
    );
    for (const [keyPath, value] of Object.entries(options.values ?? {})) {
      const extract = keyPath
        .split(".")
        .map((part) => `["${part}"]`)
        .join("");
      lines.push(`  ${shellQuote(extract)}) printf '%s' ${shellQuote(value)}; exit 0;;`);
    }
    lines.push("esac", `printf 'key not found\\n' >&2`, "exit 1");
  }
  const path = join(dir, "fake-sops");
  await writeFile(path, `${lines.join("\n")}\n`);
  await chmod(path, 0o755);
  return {
    path,
    async calls() {
      const text = await readFile(callsFile, "utf8").catch(() => "");
      return text
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split("\t").slice(0, -1));
    },
    async lastEnvNames() {
      const text = await readFile(envFile, "utf8").catch(() => "");
      return text.split("\n").filter((line) => line !== "");
    },
  };
}

// ── memorySecrets ────────────────────────────────────────────────────────

export interface MemorySecretEntry {
  readonly meta: SecretMeta;
  /** 가짜 값. 테스트가 만든 것만 넣는다. null이면 메타만 있고 제공자에 항목이 없는 상태(missing)다 */
  readonly value: string | null;
}

export interface MemorySecretsOptions {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly ids: LocalIdFactory;
  readonly secrets: readonly MemorySecretEntry[];
  /** 메타 없이 제공자에만 있는 항목(orphaned). ref → 가짜 값 */
  readonly orphans?: Readonly<Record<string, string>>;
  readonly logger?: Logger;
  /** 메모리 제공자가 put을 지원하는가. 기본 true */
  readonly putSupported?: boolean;
  /** reveal이 os-auth만 받게 하는가. 기본 false(tty-confirm만 받는다) */
  readonly osAuthAvailable?: boolean;
  /** 핸들을 값으로 가진 설정 키 */
  readonly settingKeysFor?: (handle: SecretHandle) => Promise<readonly string[]>;
  /** secret run의 자식 실행기. 기본은 실제 Bun.spawn이므로 시험은 가짜를 넘긴다 */
  readonly childRunner?: ChildRunner;
  /** 부모 env. secret run 자식 env의 재료 */
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
}

/** 시험은 공개 서비스와 사람 전용 통로를 한 객체로 본다(운영에서는 서로 다른 객체다) */
export interface MemorySecrets extends SecretServiceRuntime, SecretServiceInternal {
  /** 제공자 lease가 불린 횟수. 정책 거부 때 제공자를 부르지 않았는지 확인한다 */
  providerLeaseCalls(): number;
  /** 관리 서비스. 정책 판정·lease·Redactor는 같은 운영 구현이고 값 저장소와 감사 파일만 메모리다 */
  readonly admin: SecretAdminService;
  /** 감사 파일에 쓰였을 레코드 */
  auditRecords(): readonly SecretAuditRecord[];
  /** 감사 파일 쓰기를 실패시킨다(reveal이 값을 보이지 않는지 확인하는 시험용) */
  failAuditWrites(failing: boolean): void;
}

const NOOP_LOGGER: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return NOOP_LOGGER;
  },
};

function memoryAuditLog(): {
  readonly log: AuditLog;
  readonly records: SecretAuditRecord[];
  setFailing(failing: boolean): void;
} {
  const records: SecretAuditRecord[] = [];
  let failing = false;
  const log: AuditLog = {
    record(record) {
      if (!failing) records.push(record);
    },
    appendDurable(record) {
      if (failing) {
        return Promise.resolve(
          err({ kind: "audit_io" as const, code: "EIO", path: "memory://audit.log" }),
        );
      }
      records.push(record);
      return Promise.resolve(ok(undefined));
    },
    read() {
      return Promise.resolve(ok(records.slice()));
    },
    flush() {
      return Promise.resolve();
    },
  };
  return {
    log,
    records,
    setFailing(next) {
      failing = next;
    },
  };
}

/**
 * SecretService와 SecretAdminService를 구현하는 메모리 가짜. 정책 판정, lease, Redactor, 관리 동작은 운영 구현을
 * 그대로 쓰고 값 저장소, 메타 저장소, 감사 파일만 메모리다.
 */
export function memorySecrets(options: MemorySecretsOptions): MemorySecrets {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const values = new Map<string, string>();
  const metas = new Map<string, SecretMeta>();
  for (const entry of options.secrets) {
    if (entry.value !== null) values.set(entry.meta.ref, entry.value);
    metas.set(entry.meta.name, entry.meta);
  }
  for (const [ref, value] of Object.entries(options.orphans ?? {})) values.set(ref, value);
  let leaseCalls = 0;
  const audit = memoryAuditLog();

  const provider: SecretProvider = {
    id: "sops",
    capabilities: () => ({
      list: true,
      put: options.putSupported ?? true,
      remove: true,
      usage: false,
    }),
    list() {
      const entries: ProviderEntry[] = [...values.keys()].map((ref) => ({
        provider: "sops",
        ref,
        updatedAt: null,
      }));
      return Promise.resolve(ok(entries));
    },
    lease(ref, ctx, limits) {
      leaseCalls += 1;
      const value = values.get(ref);
      if (value === undefined) {
        return Promise.resolve({
          ok: false as const,
          error: {
            kind: "secret_missing" as const,
            handle: PROVIDER_PLACEHOLDER_HANDLE,
            where: "provider" as const,
          },
        });
      }
      const lease: SecretLease = createLease({
        id: options.ids.next("sls"),
        handle: PROVIDER_PLACEHOLDER_HANDLE,
        mode: ctx.mode,
        value: encoder.encode(value),
        ttlSeconds: limits.ttlSeconds,
        maxUses: limits.maxUses,
        clock: options.clock,
        scheduler: options.scheduler,
      });
      return Promise.resolve(ok(lease));
    },
    put(ref, value) {
      values.set(ref, decoder.decode(value));
      return Promise.resolve(ok(undefined));
    },
    remove(ref) {
      values.delete(ref);
      return Promise.resolve(ok(undefined));
    },
  };

  const metaStore: MetaStore = {
    list(): Promise<readonly MetaEntry[]> {
      return Promise.resolve(
        [...metas.values()].map((meta): MetaEntry => ({ kind: "ok", name: meta.name, meta })),
      );
    },
    get(name): Promise<MetaEntry | null> {
      const found = metas.get(name);
      return Promise.resolve(
        found === undefined ? null : { kind: "ok", name: found.name, meta: found },
      );
    },
    write(meta, writeOptions): Promise<Result<void, SecretError>> {
      if (!writeOptions.overwrite && metas.has(meta.name)) {
        const named = handleForName(meta.name);
        return Promise.resolve(
          named.ok ? err({ kind: "already_exists", handle: named.value.handle }) : err(named.error),
        );
      }
      metas.set(meta.name, meta);
      return Promise.resolve(ok(undefined));
    },
    remove(name): Promise<Result<boolean, SecretError>> {
      return Promise.resolve(ok(metas.delete(name)));
    },
  };

  const logger = options.logger ?? NOOP_LOGGER;
  const core = createSecretServiceCore({
    clock: options.clock,
    scheduler: options.scheduler,
    logger,
    limits: () => DEFAULT_SECRETS_CONFIG.lease,
    meta: metaStore,
    auditLog: audit.log,
    providers: [provider],
    redactor: createRedactor(),
    protectedPaths: () => [],
    diagnoseParts: () =>
      Promise.resolve({
        sops: { available: true, version: "3.13.3", reason: "ok" },
        key: { source: "file", available: true, reason: "ok" },
        fileFallbackNotice: false,
        unconfirmedFallback: false,
      }),
    configuredProviders: () => ["sops"],
  });
  const admin = createSecretAdminService({
    service: { ...core.service, ...core.internal },
    meta: metaStore,
    auditLog: audit.log,
    clock: options.clock,
    logger,
    osAuthAvailable: () => options.osAuthAvailable ?? false,
    settingKeysFor: options.settingKeysFor ?? (() => Promise.resolve([])),
    runChild: options.childRunner ?? bunInheritRunner,
    parentEnv: options.parentEnv ?? {},
  });
  return Object.assign(core.service, core.internal, {
    providerLeaseCalls: () => leaseCalls,
    admin,
    auditRecords: () => audit.records.slice(),
    failAuditWrites: (failing: boolean): void => {
      audit.setFailing(failing);
    },
  });
}

// ── 가짜 OS 인증 ─────────────────────────────────────────────────────────

export interface FakeOsAuthOptions {
  readonly clock: Clock;
  /** 다음 verify의 결과. 기본은 성공이다 */
  readonly outcome?: "verified" | OsAuthError;
  readonly available?: boolean;
}

export interface FakeOsAuth extends OsAuthProvider {
  /** verify가 받은 대화상자 문구 */
  readonly reasons: string[];
}

/** 대화상자 없이 정해진 결과를 돌려주는 OS 인증. L4와 reveal 시험이 쓴다 */
export function fakeOsAuth(options: FakeOsAuthOptions): FakeOsAuth {
  const reasons: string[] = [];
  return {
    id: "darwin-osascript",
    reasons,
    available: () => options.available ?? true,
    verify(reason) {
      reasons.push(reason);
      const outcome = options.outcome ?? "verified";
      if (outcome === "verified") {
        return Promise.resolve(ok({ method: "os-auth", verifiedAt: options.clock.now() }));
      }
      return Promise.resolve(err(outcome));
    },
  };
}
