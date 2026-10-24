import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type {
  OsService,
  SecretAdminService,
  SecretDiagnostics,
  SecretError,
} from "@xeon/contracts/services";
import type { SecretHandle } from "@xeon/contracts/capabilities";
import { err, ok, type Result } from "@xeon/contracts";
import { META_SUBDIR, SECRETS_SUBDIR, type SecretsConfig } from "./config.ts";
import { bunInheritRunner, createSecretAdminService, type ChildRunner } from "./admin.ts";
import { createAuditLog } from "./audit-file.ts";
import { createMetaStore } from "./meta.ts";
import { computeProtectedPaths, defaultAgeKeyPath } from "./protected-paths.ts";
import { createRedactor } from "./redactor.ts";
import { selectKeyProvider, type KeySelection } from "./select.ts";
import {
  bunRunner,
  createSopsProvider,
  createSopsResolver,
  type ProcessRunner,
  type SopsKeyAccess,
} from "./providers/sops.ts";
import { createSecretServiceCore, type SecretServiceRuntime } from "./service.ts";

// 운영 조립: xeon.os, 설정, 부모 env를 받아 SOPS 제공자와 메타 파일 읽기를 가진 SecretService를 만든다.
// Cordis 등록(ExtHost.registerPlatform)은 ext-host가 그 API를 낼 때 조립 루트나 plugin.ts가 한다.

/** 이 패키지가 쓰는 xeon.os의 부분. 테스트는 이 모양만 채운 가짜를 넘긴다 */
export type SecretsOs = Pick<OsService, "info" | "time" | "logger" | "resolveBinary" | "userId"> & {
  readonly dirs: Pick<OsService["dirs"], "config">;
};

export interface SecretsRuntimeDeps {
  readonly os: SecretsOs;
  readonly ids: LocalIdFactory;
  /** l0.secrets.* 설정. live 키가 있어 호출마다 읽는다 */
  readonly config: () => SecretsConfig;
  /** 부모 프로세스 env. sops 호출 env의 재료다. 프로세스 전역 환경을 직접 읽지 않는다 */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 주입 실행기. 없으면 Bun.spawn을 쓴다 */
  readonly runner?: ProcessRunner;
  /** secret run 자식 실행기. 없으면 stdio를 터미널에 잇는 Bun.spawn을 쓴다 */
  readonly childRunner?: ChildRunner;
  /** OS 인증 재확인을 쓸 수 있는가(reveal). L4·L0.os 연결 전에는 없음(false)이라 tty-confirm만 받는다 */
  readonly osAuthAvailable?: () => boolean;
  /** 핸들을 값으로 가진 설정 키 조회. 설정 저장소는 이 층 밖이라 조립 루트가 넘긴다 */
  readonly settingKeysFor?: (handle: SecretHandle) => Promise<readonly string[]>;
}

export interface SecretsRuntime {
  readonly service: SecretServiceRuntime;
  /** 사람 전용. 조립 루트가 L4 진입점에만 넘기고 확장과 모델 도구에는 주지 않는다 */
  readonly admin: SecretAdminService;
}

export function createSecretService(deps: SecretsRuntimeDeps): SecretServiceRuntime {
  return createSecretsRuntime(deps).service;
}

export function createSecretsRuntime(deps: SecretsRuntimeDeps): SecretsRuntime {
  const { os } = deps;
  const logger = os.logger("secrets");
  const runner = deps.runner ?? bunRunner;
  const redactor = createRedactor();
  const configDir = os.dirs.config;

  /** 서비스 수명 신호. dispose하면 진행 중인 바이너리 해석과 sops 호출이 중단된다 */
  const lifetime = new AbortController();

  async function resolveTool(name: "security" | "secret-tool"): Promise<string | null> {
    const found = await os.resolveBinary(name, {}, lifetime.signal);
    return found.ok ? found.value.path : null;
  }

  async function selection(): Promise<KeySelection> {
    const cfg = deps.config();
    return selectKeyProvider({
      source: cfg.ageKey.source,
      filePath: cfg.ageKey.filePath ?? defaultAgeKeyPath(configDir),
      info: os.info,
      userId: os.userId,
      env: deps.env,
      resolveTool,
      pathExists: existsSync,
    });
  }

  async function keyAccess(): Promise<Result<SopsKeyAccess, SecretError>> {
    const chosen = await selection();
    if (chosen.unconfirmedFallback) {
      // auto가 파일 폴백으로 떨어졌고 사람이 아직 확인하지 않았다(spec §4.7 5번)
      return err({ kind: "key_unavailable", key: "file", reason: "access_denied" });
    }
    const env = chosen.provider.sopsKeyEnv();
    if (!env.ok) return env;
    return ok({ id: chosen.provider.id, env: env.value });
  }

  const resolver = createSopsResolver({
    configured: () => deps.config().sops.binary,
    resolveBinary: (options, signal) =>
      os.resolveBinary("sops", { minVersion: options.minVersion }, signal),
    runner,
    signal: lifetime.signal,
    parentEnv: deps.env,
  });

  const sops = createSopsProvider({
    files: () => deps.config().sops.files,
    binary: () => resolver.resolve(),
    key: keyAccess,
    parentEnv: deps.env,
    runner,
    signal: lifetime.signal,
    redactor,
    clock: os.time.clock,
    scheduler: os.time.scheduler,
    ids: deps.ids,
    logger,
  });

  async function keyDiagnostics(): Promise<{
    readonly key: SecretDiagnostics["key"];
    readonly fileFallbackNotice: boolean;
    readonly unconfirmedFallback: boolean;
  }> {
    const chosen = await selection();
    const availability = await chosen.provider.probe();
    const unconfirmed = chosen.unconfirmedFallback;
    return {
      key: {
        source: chosen.provider.id,
        available: availability.available && !unconfirmed,
        reason: unconfirmed ? "no_secret_service" : availability.reason,
      },
      fileFallbackNotice: chosen.fileNotice,
      unconfirmedFallback: unconfirmed,
    };
  }

  const metaStore = createMetaStore(join(configDir, SECRETS_SUBDIR, META_SUBDIR));
  const auditLog = createAuditLog({
    configDir,
    clock: os.time.clock,
    logger,
    retentionDays: () => deps.config().audit.retentionDays,
  });

  const core = createSecretServiceCore({
    clock: os.time.clock,
    scheduler: os.time.scheduler,
    logger,
    limits: () => deps.config().lease,
    meta: metaStore,
    auditLog,
    providers: [sops],
    redactor,
    protectedPaths: () => {
      const cfg = deps.config();
      return computeProtectedPaths({
        files: cfg.sops.files,
        configDir,
        ageKeyFilePath: cfg.ageKey.filePath,
      });
    },
    diagnoseParts: async () => {
      const [sopsStatus, keys] = await Promise.all([resolver.status(), keyDiagnostics()]);
      return { sops: sopsStatus, ...keys };
    },
    configuredProviders: () => deps.config().providers,
  });
  const service: SecretServiceRuntime = {
    ...core.service,
    [Symbol.dispose]() {
      lifetime.abort();
      core.service[Symbol.dispose]();
    },
  };
  const admin = createSecretAdminService({
    service: { ...core.service, ...core.internal },
    meta: metaStore,
    auditLog,
    clock: os.time.clock,
    logger,
    osAuthAvailable: deps.osAuthAvailable ?? (() => false),
    settingKeysFor: deps.settingKeysFor ?? (() => Promise.resolve([])),
    runChild: deps.childRunner ?? bunInheritRunner,
    parentEnv: deps.env,
  });
  return { service, admin };
}
