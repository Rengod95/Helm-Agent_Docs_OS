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
import { META_SUBDIR, SECRETS_SUBDIR, withDefaultSopsFile, type SecretsConfig } from "./config.ts";
import { bunInheritRunner, createSecretAdminService, type ChildRunner } from "./admin.ts";
import { createAuditLog } from "./audit-file.ts";
import { buildPlainEnv } from "./env-filter.ts";
import { readRecipient, recipientPath, writeRecipient } from "./key/recipient.ts";
import { createMetaStore } from "./meta.ts";
import { computeProtectedPaths, defaultAgeKeyPath } from "./protected-paths.ts";
import type { OsAuthProvider } from "./os-auth.ts";
import { createRedactor } from "./redactor.ts";
import { selectKeyProvider, type KeySelection } from "./select.ts";
import {
  bunRunner,
  createSopsProvider,
  createSopsResolver,
  type ProcessRunner,
  type SopsKeyAccess,
} from "./providers/sops.ts";
import type { SecretFileLock } from "./providers/lock.ts";
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
  /** OS 인증 재확인 수단(`selectOsAuth`로 만든다). 없으면 reveal은 `tty-confirm`만 받는다 */
  readonly osAuth?: OsAuthProvider;
  /** OS 인증 재확인을 쓸 수 있는가(reveal). 없으면 `osAuth`가 있고 쓸 수 있을 때 참이다 */
  readonly osAuthAvailable?: () => boolean;
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`). SOPS 파일의 첫 만들기와 쓰기를 차례로 한다. 없으면 프로세스 안 직렬화만 한다 */
  readonly fileLock?: SecretFileLock;
  /** 핸들을 값으로 가진 설정 키 조회. 설정 저장소는 이 층 밖이라 조립 루트가 넘긴다 */
  readonly settingKeysFor?: (handle: SecretHandle) => Promise<readonly string[]>;
}

export interface SecretsRuntime {
  readonly service: SecretServiceRuntime;
  /** 사람 전용. 조립 루트가 L4 진입점에만 넘기고 확장과 모델 도구에는 주지 않는다 */
  readonly admin: SecretAdminService;
  /**
   * 사람 전용. L4가 reveal 직전에 `verify`를 불러 얻은 증거(`os-auth`)를 `admin.reveal`에 넘긴다.
   * `deps.osAuth`를 넘기지 않았으면 undefined다
   */
  readonly osAuth?: OsAuthProvider;
}

export function createSecretService(deps: SecretsRuntimeDeps): SecretServiceRuntime {
  return createSecretsRuntime(deps).service;
}

export function createSecretsRuntime(deps: SecretsRuntimeDeps): SecretsRuntime {
  const { os } = deps;
  const logger = os.logger("secrets");
  const runner = deps.runner ?? bunRunner;
  const redactor = createRedactor();
  // OS 인증은 조립 루트가 `osAuth`를 넘길 때만 켠다. 켜면 reveal은 `tty-confirm`을 거부하므로 L4가 `verify`를 연결한 뒤에 넘긴다
  const osAuth = deps.osAuth;
  const configDir = os.dirs.config;
  /** 설정에 SOPS 파일이 없으면 사용자 기본 파일을 채운 유효 설정(spec §4.8). 이 패키지는 모두 이 값을 읽는다 */
  const config = (): SecretsConfig => withDefaultSopsFile(deps.config(), configDir);

  /** 서비스 수명 신호. dispose하면 진행 중인 바이너리 해석과 sops 호출이 중단된다 */
  const lifetime = new AbortController();

  async function resolveTool(name: "security" | "secret-tool"): Promise<string | null> {
    const found = await os.resolveBinary(name, {}, lifetime.signal);
    return found.ok ? found.value.path : null;
  }

  async function selection(): Promise<KeySelection> {
    const cfg = config();
    return selectKeyProvider({
      source: cfg.ageKey.source,
      filePath: cfg.ageKey.filePath ?? defaultAgeKeyPath(configDir),
      info: os.info,
      userId: os.userId,
      env: deps.env,
      resolveTool,
      pathExists: existsSync,
      exec: { runner, env: buildPlainEnv(deps.env), signal: lifetime.signal },
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

  /**
   * 첫 쓰기에서 SOPS 파일을 암호화할 수신자. 기록된 수신자가 있으면 그것, 없으면 키를 만들고(OS 키 저장소 또는 파일 폴백)
   * 수신자를 기록한다. 이미 있는 키는 덮어쓰지 않는다(provision이 EEXIST). 호출자가 파일 잠금 안에서 부른다
   */
  async function recipient(): Promise<Result<string, SecretError>> {
    const chosen = await selection();
    if (chosen.unconfirmedFallback) {
      return err({ kind: "key_unavailable", key: "file", reason: "access_denied" });
    }
    const recorded = recipientPath(configDir, chosen.provider.id);
    const known = await readRecipient(recorded);
    if (known !== null) return ok(known);
    if (chosen.provider.provision === undefined) {
      return err({ kind: "key_unavailable", key: chosen.provider.id, reason: "item_missing" });
    }
    const made = await chosen.provider.provision();
    if (!made.ok) return made;
    const saved = await writeRecipient(recorded, made.value.recipient);
    if (!saved.ok) {
      // 키는 만들어졌고 수신자 기록만 실패했다. 이번 파일은 만들 수 있으므로 진행하고 로그만 남긴다
      logger.warn("secrets.age.recipient_unsaved", { code: saved.error.code });
    }
    return ok(made.value.recipient);
  }

  const resolver = createSopsResolver({
    configured: () => config().sops.binary,
    resolveBinary: (options, signal) =>
      os.resolveBinary("sops", { minVersion: options.minVersion }, signal),
    runner,
    signal: lifetime.signal,
    parentEnv: deps.env,
  });

  const sops = createSopsProvider({
    files: () => config().sops.files,
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
    recipient,
    ...(deps.fileLock === undefined ? {} : { lock: deps.fileLock }),
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
    retentionDays: () => config().audit.retentionDays,
    ...(deps.fileLock === undefined ? {} : { lock: deps.fileLock }),
  });

  const core = createSecretServiceCore({
    clock: os.time.clock,
    scheduler: os.time.scheduler,
    logger,
    limits: () => config().lease,
    meta: metaStore,
    auditLog,
    providers: [sops],
    redactor,
    protectedPaths: () => {
      const cfg = config();
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
    configuredProviders: () => config().providers,
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
    osAuthAvailable: deps.osAuthAvailable ?? (() => osAuth?.available() ?? false),
    settingKeysFor: deps.settingKeysFor ?? (() => Promise.resolve([])),
    runChild: deps.childRunner ?? bunInheritRunner,
    parentEnv: deps.env,
  });
  return osAuth === undefined ? { service, admin } : { service, admin, osAuth };
}
