import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ok, type Clock, type Logger, type Scheduler } from "@xeon/contracts";
import type { SecretMeta } from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type { ProviderEntry, SecretLease, SecretProvider } from "@xeon/contracts/services";
import { DEFAULT_SECRETS_CONFIG } from "../config.ts";
import { createLease } from "../lease.ts";
import type { MetaEntry, MetaStore } from "../meta.ts";
import { PROVIDER_PLACEHOLDER_HANDLE } from "../providers/sops.ts";
import { createRedactor } from "../redactor.ts";
import { createSecretServiceCore, type SecretServiceRuntime } from "../service.ts";

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
  /** 가짜 값. 테스트가 만든 것만 넣는다 */
  readonly value: string;
}

export interface MemorySecretsOptions {
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly ids: LocalIdFactory;
  readonly secrets: readonly MemorySecretEntry[];
  readonly logger?: Logger;
}

export interface MemorySecrets extends SecretServiceRuntime {
  /** 제공자 lease가 불린 횟수. 정책 거부 때 제공자를 부르지 않았는지 확인한다 */
  providerLeaseCalls(): number;
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

/**
 * SecretService를 구현하는 메모리 가짜. 정책 판정, lease, Redactor는 운영 구현을 그대로 쓰고 값 저장소만 메모리다.
 * 관리 서비스(SecretAdminService)는 마일스톤 M2에서 더한다.
 */
export function memorySecrets(options: MemorySecretsOptions): MemorySecrets {
  const encoder = new TextEncoder();
  const values = new Map<string, string>();
  for (const entry of options.secrets) values.set(entry.meta.ref, entry.value);
  let leaseCalls = 0;

  const provider: SecretProvider = {
    id: "sops",
    capabilities: () => ({ list: true, put: false, remove: false, usage: false }),
    list() {
      const entries: ProviderEntry[] = options.secrets.map((s) => ({
        provider: "sops",
        ref: s.meta.ref,
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
  };

  const metaStore: MetaStore = {
    list(): Promise<readonly MetaEntry[]> {
      return Promise.resolve(
        options.secrets.map((s): MetaEntry => ({ kind: "ok", name: s.meta.name, meta: s.meta })),
      );
    },
    get(name): Promise<MetaEntry | null> {
      const found = options.secrets.find((s) => s.meta.name === name);
      return Promise.resolve(
        found === undefined ? null : { kind: "ok", name: found.meta.name, meta: found.meta },
      );
    },
  };

  const runtime = createSecretServiceCore({
    clock: options.clock,
    scheduler: options.scheduler,
    logger: options.logger ?? NOOP_LOGGER,
    limits: () => DEFAULT_SECRETS_CONFIG.lease,
    meta: metaStore,
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
  return Object.assign(runtime, { providerLeaseCalls: () => leaseCalls });
}
