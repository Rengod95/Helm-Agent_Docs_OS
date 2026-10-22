import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type { OsService, SecretDiagnostics, SecretError } from "@xeon/contracts/services";
import { err, ok, type Result } from "@xeon/contracts";
import { META_SUBDIR, SECRETS_SUBDIR, type SecretsConfig } from "./config.ts";
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
}

export function createSecretService(deps: SecretsRuntimeDeps): SecretServiceRuntime {
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

  const core = createSecretServiceCore({
    clock: os.time.clock,
    scheduler: os.time.scheduler,
    logger,
    limits: () => deps.config().lease,
    meta: createMetaStore(join(configDir, SECRETS_SUBDIR, META_SUBDIR)),
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
  return {
    ...core,
    [Symbol.dispose]() {
      lifetime.abort();
      core[Symbol.dispose]();
    },
  };
}
