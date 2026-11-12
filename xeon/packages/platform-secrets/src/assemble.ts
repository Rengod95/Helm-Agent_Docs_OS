import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { identityToRecipient } from "age-encryption";
import type { LocalIdFactory } from "@fresnel/contracts/conversation";
import type {
  OsService,
  SecretAdminService,
  SecretDiagnostics,
  SecretError,
} from "@fresnel/contracts/services";
import type { SecretHandle } from "@fresnel/contracts/capabilities";
import { assertNever, attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import { META_SUBDIR, SECRETS_SUBDIR, withDefaultSopsFile, type SecretsConfig } from "./config.ts";
import { bunInheritRunner, createSecretAdminService, type ChildRunner } from "./admin.ts";
import { createAuditLog } from "./audit-file.ts";
import { buildPlainEnv } from "./env-filter.ts";
import { errorCode } from "./errors.ts";
import type { KeyProvider } from "./key/provider.ts";
import { readRecipient, recipientPath, writeRecipient } from "./key/recipient.ts";
import { createMetaStore } from "./meta.ts";
import { computeProtectedPaths, defaultAgeKeyPath } from "./protected-paths.ts";
import type { OsAuthProvider } from "./os-auth.ts";
import { createRedactor } from "./redactor.ts";
import {
  fileKeyProvider,
  osKeyProvider,
  selectKeyProvider,
  type KeyProviderInput,
  type KeySelection,
} from "./select.ts";
import {
  bunRunner,
  createSopsProvider,
  createSopsResolver,
  type ProcessRunner,
  type SopsKeyAccess,
} from "./providers/sops.ts";
import {
  createProcessLock,
  type SecretFileLock,
  type SecretFileLockError,
} from "./providers/lock.ts";
import { createSecretServiceCore, type SecretServiceRuntime } from "./service.ts";

// 운영 조립: fresnel.os, 설정, 부모 env를 받아 SOPS 제공자와 메타 파일 읽기를 가진 SecretService를 만든다.
// Cordis 등록(ExtHost.registerPlatform)은 ext-host가 그 API를 낼 때 조립 루트나 plugin.ts가 한다.

/** 이 패키지가 쓰는 fresnel.os의 부분. 테스트는 이 모양만 채운 가짜를 넘긴다 */
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
  /**
   * 첫 키를 파일로 만든 직후 부른다. 조립 루트가 사용자 범위 설정 l0.secrets.ageKey.source = file 을 저장한다(spec §4.7 9번). 실패해도 파일 키는 쓸 수 있으므로 던지지 않는다
   */
  readonly onFileKeyCreated?: () => Promise<void>;
}

/** 열쇠가 있는 곳. `none`은 어느 쪽에도 없다는 뜻이다 */
export type KeyLocation = "none" | "keychain" | "file";

/** `keys.status()`의 값. identity는 들어 있지 않다 */
export interface KeyStatus {
  /** 설정 `l0.secrets.ageKey.source`의 값 */
  readonly source: SecretsConfig["ageKey"]["source"];
  /** 열쇠가 있는 쪽. identity를 읽지 않고 probe, holdsKey, 파일 존재(모양만)로 정한다. 설정한 쪽을 먼저 본다 */
  readonly in: KeyLocation;
  /** 파일 쪽 열쇠 경로(설정값 또는 기본 경로) */
  readonly filePath: string;
  /** 이 컴퓨터에서 OS 키 저장소를 쓸 수 있는가 */
  readonly keychainUsable: boolean;
  /** `auto`가 OS 키 저장소를 쓸 수 없어 사람 확인 없이 파일 폴백으로 떨어져 있다 */
  readonly fallbackUnconfirmed: boolean;
  /** 설정이 열쇠 파일 경로를 가리키는데 그 파일이 없다. 기본 경로에 아직 열쇠가 없는 새 설치는 이것이 아니다 */
  readonly fileMissing: boolean;
}

export type KeyMoveTarget = "keychain" | "file";

/** `keys.move()`의 결과 */
export interface KeyMoveOutcome {
  /** 열쇠가 `to` 쪽에 있게 됐고 설정 전환(commit)까지 끝났다 */
  readonly moved: boolean;
  /** 이 호출이 `to` 쪽에 항목을 새로 썼다. 이미 같은 키가 있었으면 false다 */
  readonly created: boolean;
  /** 옛 쪽을 지웠다. false면 키가 두 곳에 남아 있다(옛 쪽 삭제만 실패) */
  readonly oldRemoved: boolean;
}

/** 설정 전환 콜백. `keys.move`가 새 쪽 기록과 확인을 마친 뒤, 옛 쪽을 지우기 전에 한 번 부른다 */
export type KeyCommit = () => Promise<Result<void, SecretError>>;

/** 사람 전용. 조립 루트가 L4 진입점에만 넘기고 확장과 모델 도구에는 주지 않는다 */
export interface SecretKeys {
  status(): Promise<KeyStatus>;
  /**
   * 열쇠를 `to` 쪽으로 옮긴다. 순서: 옛 쪽 읽기, 새 쪽 쓰기(같은 키가 이미 있으면 그대로 쓴다. 다르면 덮어쓰지 않는다),
   * 새 쪽을 다시 읽어 수신자 확인, 수신자 기록을 새 쪽 이름으로 복사, `commit`(설정 전환), 옛 쪽 삭제.
   * 쓰기·확인·복사·`commit`이 실패하면 새 쪽에 이 호출이 만든 것을 지우고 옛 쪽은 그대로 둔다. 옛 쪽 삭제만 실패하면
   * `oldRemoved: false`로 성공한다(키가 두 곳에 남는다). 옮길 키가 없으면(`in: none`) 옮기지 않고 `moved: false`다.
   * `to`에 이미 있으면(`in`이 `to`) `moved: false`다. 이 두 경우 `commit`은 부르지 않는다. 설정을 `to`로 바꾸는 일은 호출자 몫이다.
   */
  move(to: KeyMoveTarget, commit: KeyCommit): Promise<Result<KeyMoveOutcome, SecretError>>;
}

export interface SecretsRuntime {
  readonly service: SecretServiceRuntime;
  /** 사람 전용. 조립 루트가 L4 진입점에만 넘기고 확장과 모델 도구에는 주지 않는다 */
  readonly admin: SecretAdminService;
  /** 사람 전용. 열쇠 보관 상태와 보관 위치 옮기기 */
  readonly keys: SecretKeys;
  /**
   * 사람 전용. L4가 reveal 직전에 `verify`를 불러 얻은 증거(`os-auth`)를 `admin.reveal`에 넘긴다.
   * `deps.osAuth`를 넘기지 않았으면 undefined다
   */
  readonly osAuth?: OsAuthProvider;
}

export function createSecretService(deps: SecretsRuntimeDeps): SecretServiceRuntime {
  return createSecretsRuntime(deps).service;
}

/** 두 쪽의 상태(identity는 읽지 않는다) */
interface KeyPlaces {
  readonly keychain: KeyProvider;
  readonly file: KeyProvider;
  readonly keychainUsable: boolean;
  /** 키 저장소에 항목이 있는가. 쓸 수 있는데 조회가 실패했으면 null이다(모른다) */
  readonly keychainHeld: boolean | null;
  /** 키 파일이 있는가. 모양만 본다(stat). 권한이 틀려도 있다고 본다 */
  readonly fileHeld: boolean;
  /** 설정이 파일 경로를 가리키는데 파일이 없다 */
  readonly fileMissing: boolean;
}

function locate(source: SecretsConfig["ageKey"]["source"], where: KeyPlaces): KeyLocation {
  const keychainHeld = where.keychainHeld === true;
  if (source === "file") {
    if (where.fileHeld) return "file";
    return keychainHeld ? "keychain" : "none";
  }
  if (keychainHeld) return "keychain";
  return where.fileHeld ? "file" : "none";
}

/** identity 바이트에서 수신자를 만든다. age-encryption은 문자열을 받으므로 잠깐 문자열을 만든다. 모양이 틀리면 null */
async function recipientOf(identity: Uint8Array): Promise<string | null> {
  const text = new TextDecoder().decode(identity);
  const made = await attemptAsync(() => identityToRecipient(text));
  return made.ok ? made.value : null;
}

/** 저장된 쪽을 다시 읽어 수신자를 만든다. 읽은 버퍼는 여기서 0으로 덮는다 */
async function storedRecipient(side: KeyProvider): Promise<Result<string, SecretError>> {
  const read = await side.readIdentity?.();
  if (read === undefined)
    return err({ kind: "key_unavailable", key: side.id, reason: "no_secret_service" });
  if (!read.ok) return err(read.error);
  try {
    const made = await recipientOf(read.value);
    if (made === null)
      return err({ kind: "key_unavailable", key: side.id, reason: "item_missing" });
    return ok(made);
  } finally {
    read.value.fill(0);
  }
}

function isExists(error: SecretError): boolean {
  return error.kind === "write_failed" && error.code === "EEXIST";
}

/** 쓰기 실패 오류. 키 파일이면 파일 경로를, OS 저장소면 저장소 이름을 싣는다. 값은 싣지 않는다 */
function storeFailure(side: KeyProvider, filePath: string, code: string): SecretError {
  return side.id === "file"
    ? { kind: "write_failed", target: "key_file", path: filePath, code }
    : { kind: "write_failed", target: "key_store", path: side.id, code };
}

function moveLockFailure(error: SecretFileLockError, path: string): SecretError {
  switch (error.kind) {
    case "cancelled":
      return { kind: "cancelled" };
    case "timeout":
      return { kind: "write_failed", target: "key_file", path, code: "lock_timeout" };
    case "io":
      return { kind: "write_failed", target: "key_file", path, code: error.code };
    default:
      return assertNever(error, "SecretFileLockError");
  }
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

  /** 두 쪽의 제공자를 만드는 입력(선택 방식과 무관하다) */
  function selectInput(cfg: SecretsConfig): KeyProviderInput {
    return {
      filePath: cfg.ageKey.filePath ?? defaultAgeKeyPath(configDir),
      info: os.info,
      userId: os.userId,
      env: deps.env,
      resolveTool,
      pathExists: existsSync,
      exec: { runner, env: buildPlainEnv(deps.env), signal: lifetime.signal },
    };
  }

  async function selection(): Promise<KeySelection> {
    const cfg = config();
    return selectKeyProvider({ ...selectInput(cfg), source: cfg.ageKey.source });
  }

  async function keyAccess(): Promise<Result<SopsKeyAccess, SecretError>> {
    const chosen = await selection();
    if (chosen.unconfirmedFallback) {
      // auto가 파일 폴백으로 떨어졌고 사람이 아직 확인하지 않았다(spec §4.7 5번)
      return err({ kind: "key_unavailable", key: "file", reason: "fallback_unconfirmed" });
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
      return err({ kind: "key_unavailable", key: "file", reason: "fallback_unconfirmed" });
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
    if (chosen.newFileKey && deps.onFileKeyCreated !== undefined) await deps.onFileKeyCreated();
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

  /** 설정이 키 파일 경로를 가리키는데 그 파일이 없는가(기본 경로는 해당하지 않는다) */
  async function fileMissingOf(cfg: SecretsConfig): Promise<boolean> {
    if (cfg.ageKey.filePath === null) return false;
    return (await fileKeyProvider(selectInput(cfg)).probe()).reason === "item_missing";
  }

  async function keyDiagnostics(): Promise<{
    readonly key: SecretDiagnostics["key"];
    readonly fileFallbackNotice: boolean;
    readonly unconfirmedFallback: boolean;
  }> {
    const cfg = config();
    const chosen = await selection();
    const availability = await chosen.provider.probe();
    const unconfirmed = chosen.unconfirmedFallback;
    return {
      key: {
        source: chosen.provider.id,
        available: availability.available && !unconfirmed,
        reason: unconfirmed ? "no_secret_service" : availability.reason,
        fileMissing: await fileMissingOf(cfg),
      },
      fileFallbackNotice: chosen.fileNotice,
      unconfirmedFallback: unconfirmed,
    };
  }

  /** 두 쪽을 살핀다. identity는 읽지 않는다. 키 저장소 항목은 holdsKey로만 묻는다 */
  async function placesOf(cfg: SecretsConfig): Promise<KeyPlaces> {
    const input = selectInput(cfg);
    const keychain = await osKeyProvider(input);
    const file = fileKeyProvider(input);
    const keychainUsable = (await keychain.probe()).available;
    // 쓸 수 없는 저장소에는 키가 없다고 본다. holdsKey가 없는 제공자는 항목을 묻지 못하므로 없다고 본다
    const held = keychainUsable ? await keychain.holdsKey?.() : false;
    const keychainHeld = held === undefined ? false : held;
    const fileHeld = (await file.probe()).reason !== "item_missing";
    return {
      keychain,
      file,
      keychainUsable,
      keychainHeld,
      fileHeld,
      fileMissing: cfg.ageKey.filePath !== null && !fileHeld,
    };
  }

  async function status(): Promise<KeyStatus> {
    const cfg = config();
    const where = await placesOf(cfg);
    const chosen = await selection();
    return {
      source: cfg.ageKey.source,
      in: locate(cfg.ageKey.source, where),
      filePath: cfg.ageKey.filePath ?? defaultAgeKeyPath(configDir),
      keychainUsable: where.keychainUsable,
      fallbackUnconfirmed: chosen.unconfirmedFallback,
      fileMissing: where.fileMissing,
    };
  }

  /**
   * 옮기기의 본체. 호출자가 옮기기 잠금을 쥔 상태에서 부른다. 옮기는 동안 열쇠는 두 곳에 있고, 어느 쪽을 읽어도 풀린다.
   * 이 패키지 밖의 다른 프로세스(다른 sops 호출)는 이 잠금을 보지 않으므로 막을 수 없다. 그래서 새 쪽 기록, 확인,
   * 설정 전환, 옛 쪽 삭제 순서를 지킨다. 설정 전환 전에는 옛 쪽이 남아 있어 그 사이 읽는 쪽은 옛 키로 풀린다.
   */
  async function transfer(
    source: KeyProvider,
    target: KeyProvider,
    commit: KeyCommit,
    filePath: string,
  ): Promise<Result<KeyMoveOutcome, SecretError>> {
    if (
      source.readIdentity === undefined ||
      source.removeKey === undefined ||
      target.storeIdentity === undefined ||
      target.readIdentity === undefined ||
      target.removeKey === undefined
    ) {
      return err({ kind: "key_unavailable", key: target.id, reason: "no_secret_service" });
    }
    // 옛 쪽의 identity. 이 호출이 끝나면 0으로 덮는다(spec §4.7 1번의 예외)
    const read = await source.readIdentity();
    if (!read.ok) return err(read.error);
    const identity = read.value;
    const targetRecipientPath = recipientPath(configDir, target.id);
    const priorCopy = await readRecipient(targetRecipientPath);
    let created = false;
    let copied = false;
    // 되돌리기: 이 호출이 새 쪽에 쓴 항목과 수신자 복사만 지운다. 이미 있던 것과 옛 쪽은 건드리지 않는다
    const undo = async (): Promise<void> => {
      if (created) {
        const undone = await target.removeKey?.();
        if (undone !== undefined && !undone.ok) {
          logger.warn("secrets.key.move.undo_failed", { provider: target.id });
        }
      }
      if (copied && priorCopy === null) {
        await attemptAsync(() => rm(targetRecipientPath, { force: true }));
      }
    };
    try {
      const oldRecipient = await recipientOf(identity);
      if (oldRecipient === null) {
        return err({ kind: "key_unavailable", key: source.id, reason: "item_missing" });
      }
      // 기록된 수신자가 있으면 그것을 기준으로 하고, 없으면 옛 키의 수신자를 기준으로 한다(spec §4.7 7번)
      const recorded = await readRecipient(recipientPath(configDir, source.id));
      const expected = recorded ?? oldRecipient;

      // 새 쪽에 쓴다. 이미 항목이 있으면 같은 키인지만 본다. 다르면 덮어쓰지 않고 쓰기 오류를 돌려준다
      const stored = await target.storeIdentity(identity);
      if (stored.ok) {
        created = true;
      } else {
        if (!isExists(stored.error)) return err(stored.error);
        const there = await storedRecipient(target);
        if (!there.ok || there.value !== oldRecipient) return err(stored.error);
      }

      // 확인: 새 쪽을 다시 읽어 만든 수신자가 기준과 같아야 한다. 이때 새 쪽이 읽히는지도 함께 본다
      const back = await storedRecipient(target);
      if (!back.ok) {
        await undo();
        return err(back.error);
      }
      if (back.value !== expected) {
        await undo();
        return err(storeFailure(target, filePath, "recipient_mismatch"));
      }

      // 수신자 기록을 새 쪽 이름으로 복사한다. 공개 정보라 평문 파일이다
      const saved = await writeRecipient(targetRecipientPath, back.value);
      if (!saved.ok) {
        await undo();
        return err({
          kind: "write_failed",
          target: "key_file",
          path: targetRecipientPath,
          code: saved.error.code,
        });
      }
      copied = true;

      // 설정 전환(호출자). 실패하면 새 쪽을 되돌리고 옛 쪽은 그대로 둔다
      const switched = await commit();
      if (!switched.ok) {
        await undo();
        return err(switched.error);
      }

      // 옛 쪽 삭제. 여기서 실패해도 새 쪽은 유지한다. 키가 두 곳에 남았다는 사실은 oldRemoved로 알린다
      const removed = await source.removeKey();
      if (!removed.ok) logger.warn("secrets.key.move.old_kept", { provider: source.id });
      return ok({ moved: true, created, oldRemoved: removed.ok });
    } finally {
      identity.fill(0);
    }
  }

  /** 옮기기 한 번의 본체(잠금 안). 설정 전환은 `commit`으로 받는다 */
  async function moveWhileLocked(
    to: KeyMoveTarget,
    commit: KeyCommit,
  ): Promise<Result<KeyMoveOutcome, SecretError>> {
    const cfg = config();
    const where = await placesOf(cfg);
    if (where.keychainHeld === null) {
      // 키 저장소 조회가 실패했다. 없다고 잘못 보고 옮기면 새 키를 만들어 옛 키로 암호화한 파일을 못 풀게 된다
      return err({
        kind: "key_unavailable",
        key: where.keychain.id,
        reason: where.keychain.id === "darwin-keychain" ? "locked" : "no_secret_service",
      });
    }
    const from = locate(cfg.ageKey.source, where);
    if (from === "none" || from === to)
      return ok({ moved: false, created: false, oldRemoved: false });
    const source = from === "keychain" ? where.keychain : where.file;
    const target = to === "keychain" ? where.keychain : where.file;
    return transfer(source, target, commit, cfg.ageKey.filePath ?? defaultAgeKeyPath(configDir));
  }

  const moveLockDir = join(configDir, SECRETS_SUBDIR, "age");
  const moveLockPath = join(moveLockDir, "keys.move.lock");
  const moveLock: SecretFileLock = deps.fileLock ?? createProcessLock();

  async function move(
    to: KeyMoveTarget,
    commit: KeyCommit,
  ): Promise<Result<KeyMoveOutcome, SecretError>> {
    const dir = await attemptAsync(() => mkdir(moveLockDir, { recursive: true, mode: 0o700 }));
    if (!dir.ok) {
      return err({
        kind: "write_failed",
        target: "key_file",
        path: moveLockDir,
        code: errorCode(dir.error.cause),
      });
    }
    const locked = await moveLock.withLock(moveLockPath, () => moveWhileLocked(to, commit));
    if (!locked.ok) return err(moveLockFailure(locked.error, moveLockPath));
    return locked.value;
  }

  const keys: SecretKeys = { status, move };

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
      const [sopsStatus, keyParts] = await Promise.all([resolver.status(), keyDiagnostics()]);
      return { sops: sopsStatus, ...keyParts };
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
  return osAuth === undefined ? { service, admin, keys } : { service, admin, keys, osAuth };
}
