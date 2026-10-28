import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  attemptAsync,
  err,
  ok,
  type Clock,
  type Logger,
  type Result,
  type Scheduler,
} from "@xeon/contracts";
import { secretRef, type SecretHandle } from "@xeon/contracts/capabilities";
import type { LocalIdFactory } from "@xeon/contracts/conversation";
import type {
  BinaryError,
  KeyProviderIdPublic,
  ProviderEntry,
  Redactor,
  ResolvedBinary,
  SecretDiagnostics,
  SecretError,
  SecretLease,
  SecretProvider,
  SecretProviderCapabilities,
  UseCtx,
} from "@xeon/contracts/services";
import { SOPS_MIN_VERSION, type SecretsSopsFile } from "../config.ts";
import { buildPlainEnv, buildSopsEnv, type KeyEnv } from "../env-filter.ts";
import { errorCode, maskStderr } from "../errors.ts";
import { createLease } from "../lease.ts";
import { bunRunner, type ProcessRunner, type RunOutput, type RunRequest } from "./process.ts";
import { createProcessLock, lockFailure, type SecretFileLock } from "./lock.ts";
import { createSopsFile, sopsFileExists } from "./sops-create.ts";
import { extractArgument, formatOfPath, parseSopsKeys, type SopsKeyListing } from "./sops-keys.ts";

export { bunRunner, type ProcessRunner, type RunOutput, type RunRequest };

/** `sops set --help`에 이 옵션이 있으면 값을 stdin으로 받을 수 있다(spec §4.6 6번) */
const VALUE_STDIN_FLAG = "--value-stdin";

// L0.secrets.spec §4.6. sops 바이너리 호출 래퍼. `sops`, `age` 바이너리 호출은 이 패키지만 한다(DR-07).
// 값은 sops의 stdout을 부모 프로세스 메모리로 받아 lease에 넘긴다. 디스크에 쓰지 않고 argv에 올리지 않는다.

const DEFAULT_TIMEOUT_MS = 30_000;

// ── 바이너리와 버전 ──────────────────────────────────────────────────────

interface SopsBinary {
  readonly path: string;
  readonly version: string;
}

const VERSION_PATTERN = /(\d+)\.(\d+)\.(\d+)/;

function parseVersion(text: string): readonly [number, number, number] | null {
  const m = VERSION_PATTERN.exec(text);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function versionAtLeast(found: string, required: string): boolean {
  const a = parseVersion(found);
  const b = parseVersion(required);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export interface SopsResolverDeps {
  /** l0.secrets.sops.binary. null이면 xeon.os가 해석한다 */
  readonly configured: () => string | null;
  readonly resolveBinary: (
    options: { readonly minVersion: string },
    signal: AbortSignal,
  ) => Promise<Result<ResolvedBinary, BinaryError>>;
  readonly runner: ProcessRunner;
  /** 서비스 수명 신호. 닫히면 해석과 호출이 cancelled로 끝난다 */
  readonly signal: AbortSignal;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
}

export interface SopsResolver {
  resolve(): Promise<Result<SopsBinary, SecretError>>;
  /** doctor용 상태. 값 없음 */
  status(): Promise<SecretDiagnostics["sops"]>;
}

function unavailable(reason: "binary_missing" | "version_too_old"): SecretError {
  return { kind: "provider_unavailable", provider: "sops", reason };
}

export function createSopsResolver(deps: SopsResolverDeps): SopsResolver {
  let cached: SopsBinary | null = null;

  async function resolveConfigured(path: string): Promise<Result<SopsBinary, SecretError>> {
    // 최신 버전 확인(네트워크)을 끄고 버전만 읽는다
    const run = await deps.runner({
      argv: [path, "--disable-version-check", "--version"],
      env: buildPlainEnv(deps.parentEnv),
      timeoutMs: DEFAULT_TIMEOUT_MS,
      signal: deps.signal,
    });
    if (!run.ok && run.error.kind === "cancelled") return err({ kind: "cancelled" });
    if (!run.ok || run.value.exitCode !== 0) return err(unavailable("binary_missing"));
    const stdout = new TextDecoder().decode(run.value.stdout);
    const parsed = parseVersion(stdout);
    if (parsed === null) return err(unavailable("binary_missing"));
    const version = parsed.join(".");
    if (!versionAtLeast(version, SOPS_MIN_VERSION)) return err(unavailable("version_too_old"));
    return ok({ path, version });
  }

  async function resolveViaOs(): Promise<Result<SopsBinary, SecretError>> {
    const found = await deps.resolveBinary({ minVersion: SOPS_MIN_VERSION }, deps.signal);
    if (found.ok) return ok({ path: found.value.path, version: found.value.version });
    if (found.error.kind === "cancelled") return err({ kind: "cancelled" });
    return err(
      unavailable(found.error.kind === "version_too_old" ? "version_too_old" : "binary_missing"),
    );
  }

  async function resolve(): Promise<Result<SopsBinary, SecretError>> {
    if (cached !== null) return ok(cached);
    const configured = deps.configured();
    const result = configured === null ? await resolveViaOs() : await resolveConfigured(configured);
    if (result.ok) cached = result.value;
    return result;
  }

  return {
    resolve,
    async status(): Promise<SecretDiagnostics["sops"]> {
      const result = await resolve();
      if (result.ok) return { available: true, version: result.value.version, reason: "ok" };
      const error = result.error;
      const reason =
        error.kind === "provider_unavailable" && error.reason === "version_too_old"
          ? "version_too_old"
          : "binary_missing";
      return { available: false, version: null, reason };
    },
  };
}

// ── 제공자 ───────────────────────────────────────────────────────────────

/** 제공자 lease에는 핸들이 없다(F SecretProvider.lease에 핸들 인자가 없다). 서비스가 바깥 lease로 감싸 핸들을 채운다 */
export const PROVIDER_PLACEHOLDER_HANDLE: SecretHandle = secretRef("provider-lease");

export interface SopsKeyAccess {
  readonly id: KeyProviderIdPublic;
  readonly env: KeyEnv;
}

export interface SopsProviderDeps {
  readonly files: () => readonly SecretsSopsFile[];
  readonly binary: () => Promise<Result<SopsBinary, SecretError>>;
  readonly key: () => Promise<Result<SopsKeyAccess, SecretError>>;
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly runner: ProcessRunner;
  /** 서비스 수명 신호. 닫히면 진행 중인 sops 호출을 중단한다 */
  readonly signal: AbortSignal;
  readonly redactor: Pick<Redactor, "mask">;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly ids: LocalIdFactory;
  readonly logger: Logger;
  /**
   * 첫 쓰기로 SOPS 파일을 만들 때 쓸 age 수신자(공개키)를 준다. 키가 없으면 만든다(spec §4.7 7번).
   * 없으면 파일을 만들지 않는다: 없는 파일에 대한 쓰기는 sops가 실패한다
   */
  readonly recipient?: () => Promise<Result<string, SecretError>>;
  /** 파일 하나의 쓰기를 프로세스 사이에서 차례로 한다. 없으면 프로세스 안 직렬화만 한다 */
  readonly lock?: SecretFileLock;
}

/** 다른 쓰기가 잠금을 쥐고 있을 때 기다리는 시간. 첫 쓰기는 키 저장소 승인 대화상자를 기다릴 수 있다 */
const LOCK_TIMEOUT_MS = 60_000;

/** sops 제공자. put은 `sops set --value-stdin` 지원을 확인한 뒤에만 켜진다(refreshCapabilities) */
export interface SopsProvider extends SecretProvider {
  /** 바이너리의 `set --help`를 읽어 put 지원을 다시 판정하고 현재 능력을 돌려준다 */
  refreshCapabilities(): Promise<SecretProviderCapabilities>;
  /** put이 꺼져 있는 이유. sops 바이너리를 쓸 수 없으면 그 오류, 아니면 `read_only_provider`(`set --value-stdin` 미지원) */
  readOnlyReason(): Promise<SecretError>;
}

/**
 * 값 바이트를 JSON 문자열 리터럴 바이트로 바꾼다(`sops set`의 값은 JSON 인코딩 문자열이어야 한다).
 * JS 문자열을 거치지 않고 바이트에서 바로 만든다. 입력이 UTF-8이면 결과도 UTF-8이다.
 */
export function jsonStringBytes(value: Uint8Array): Uint8Array {
  // 값이 일반 배열에 남지 않도록 최악의 크기(제어 문자마다 6바이트)를 미리 잡고, 쓴 뒤 남은 버퍼를 지운다
  const scratch = new Uint8Array(value.length * 6 + 2);
  let length = 0;
  scratch[length++] = 0x22;
  for (const byte of value) {
    if (byte === 0x22 || byte === 0x5c) {
      scratch[length++] = 0x5c;
      scratch[length++] = byte;
    } else if (byte < 0x20) {
      // \u00XX
      scratch.set(
        [0x5c, 0x75, 0x30, 0x30, HEX[byte >> 4] ?? 0x30, HEX[byte & 0xf] ?? 0x30],
        length,
      );
      length += 6;
    } else {
      scratch[length++] = byte;
    }
  }
  scratch[length++] = 0x22;
  const out = scratch.slice(0, length);
  scratch.fill(0);
  return out;
}

/** 소문자 16진 숫자의 ASCII 코드 */
const HEX: readonly number[] = Array.from("0123456789abcdef", (digit) => digit.charCodeAt(0));

function missing(): SecretError {
  return { kind: "secret_missing", handle: PROVIDER_PLACEHOLDER_HANDLE, where: "provider" };
}

function splitRef(ref: string): { readonly env: string; readonly keyPath: string } | null {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return null;
  return { env: ref.slice(0, slash), keyPath: ref.slice(slash + 1) };
}

/**
 * 키 명령 실패를 stderr로 구분한다. sops가 키 명령의 stderr를 그대로 남긴다는 [가정]에 기댄 것이라
 * 맞지 않으면 decrypt_failed로 떨어진다. 파일 폴백에는 잠금·승인 개념이 없다.
 */
function classifyFailure(
  stderr: string,
  keyId: KeyProviderIdPublic,
  exitCode: number,
  redactor: Pick<Redactor, "mask">,
): SecretError {
  if (keyId !== "file") {
    const lower = stderr.toLowerCase();
    if (lower.includes("locked")) return { kind: "key_unavailable", key: keyId, reason: "locked" };
    if (lower.includes("denied") || lower.includes("cancel")) {
      return { kind: "key_unavailable", key: keyId, reason: "access_denied" };
    }
    if (/could not be found|item not found|no such (?:secret|item)/.test(lower)) {
      return { kind: "key_unavailable", key: keyId, reason: "item_missing" };
    }
  }
  return {
    kind: "decrypt_failed",
    provider: "sops",
    exitCode,
    stderrMasked: maskStderr(redactor, stderr),
  };
}

export function createSopsProvider(deps: SopsProviderDeps): SopsProvider {
  let putSupported = false;

  async function readListing(file: SecretsSopsFile): Promise<SopsKeyListing | null> {
    let content: string;
    try {
      content = await readFile(file.path, "utf8");
    } catch (error: unknown) {
      const code = errorCode(error);
      // 기본 파일은 첫 쓰기 전에는 없다. 없는 것은 경고가 아니다
      if (code !== "ENOENT") {
        deps.logger.warn("secrets.sops.file_unreadable", { env: file.env, code });
      }
      return null;
    }
    const parsed = parseSopsKeys(content, formatOfPath(file.path));
    if (!parsed.ok) {
      deps.logger.warn("secrets.sops.file_unparseable", { env: file.env });
      return null;
    }
    return parsed.value;
  }

  /** ref("<env>/<KEY>")를 설정된 파일과 sops 인덱스 인자로 풀고, 키가 이미 있는지 본다 */
  async function locate(
    ref: string,
  ): Promise<
    Result<
      { readonly file: SecretsSopsFile; readonly index: string; readonly exists: boolean },
      SecretError
    >
  > {
    const parts = splitRef(ref);
    if (parts === null) return err(missing());
    const file = deps.files().find((f) => f.env === parts.env);
    if (file === undefined) return err(missing());
    const index = extractArgument(parts.keyPath);
    if (!index.ok) return err(missing());
    const listing = await readListing(file);
    const exists = listing !== null && listing.keys.includes(parts.keyPath);
    return ok({ file, index: index.value, exists });
  }

  async function prepare(): Promise<
    Result<
      {
        readonly binary: string;
        readonly env: Record<string, string>;
        readonly keyId: KeyProviderIdPublic;
      },
      SecretError
    >
  > {
    const binary = await deps.binary();
    if (!binary.ok) return binary;
    const key = await deps.key();
    if (!key.ok) return key;
    return ok({
      binary: binary.value.path,
      env: buildSopsEnv(deps.parentEnv, key.value.env),
      keyId: key.value.id,
    });
  }

  function settle(
    run: Awaited<ReturnType<ProcessRunner>>,
    keyId: KeyProviderIdPublic,
  ): Result<void, SecretError> {
    if (!run.ok) {
      return err(
        run.error.kind === "cancelled" ? { kind: "cancelled" } : unavailable("binary_missing"),
      );
    }
    if (run.value.exitCode !== 0) {
      return err(classifyFailure(run.value.stderr, keyId, run.value.exitCode, deps.redactor));
    }
    return ok(undefined);
  }

  const lock = deps.lock ?? createProcessLock();

  /** 파일 하나에 대한 변경을 프로세스 안팎에서 차례로 한다. 읽고-고치고-쓰기가 서로 덮어쓰지 않게 한다 */
  async function exclusive(
    path: string,
    fn: () => Promise<Result<void, SecretError>>,
  ): Promise<Result<void, SecretError>> {
    const locked = await lock.withLock(path, fn, {
      timeoutMs: LOCK_TIMEOUT_MS,
      signal: deps.signal,
    });
    return locked.ok ? locked.value : err(lockFailure(locked.error, path));
  }

  /**
   * 파일이 없으면 만든다(잠금 안에서 부른다). 순서: sops 바이너리 확인, 수신자(키가 없으면 새로 만든다), 암호화한 빈 파일.
   * sops가 없는 기기에서 키만 만들어 두는 일이 없도록 바이너리를 먼저 본다.
   */
  async function ensureFile(file: SecretsSopsFile): Promise<Result<void, SecretError>> {
    const recipient = deps.recipient;
    if (recipient === undefined) return ok(undefined);
    if (await sopsFileExists(file.path)) return ok(undefined);
    // 빈 문서를 암호화할 수 없는 형식은 키를 만들기 전에 거절한다
    if (formatOfPath(file.path) === "dotenv") {
      return err({
        kind: "write_failed",
        target: "sops_file",
        path: file.path,
        code: "unsupported_format",
      });
    }
    const binary = await deps.binary();
    if (!binary.ok) return binary;
    const found = await recipient();
    if (!found.ok) {
      // 키는 이미 있는데 수신자를 알 수 없다: 이 파일을 만들 수 없는 이유로 알린다
      const error = found.error;
      if (error.kind === "write_failed" && error.code === "EEXIST") {
        return err({
          kind: "write_failed",
          target: "sops_file",
          path: file.path,
          code: "recipient_unknown",
        });
      }
      return found;
    }
    const created = await createSopsFile({
      sops: binary.value.path,
      path: file.path,
      recipient: found.value,
      parentEnv: deps.parentEnv,
      runner: deps.runner,
      signal: deps.signal,
    });
    if (created.ok) deps.logger.info("secrets.sops.file_created", { env: file.env });
    return created;
  }

  async function refresh(): Promise<SecretProviderCapabilities> {
    const binary = await deps.binary();
    if (binary.ok) {
      const help = await deps.runner({
        argv: [binary.value.path, "set", "--help"],
        env: buildPlainEnv(deps.parentEnv),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        signal: deps.signal,
      });
      const text = help.ok
        ? `${new TextDecoder().decode(help.value.stdout)}${help.value.stderr}`
        : "";
      putSupported = text.includes(VALUE_STDIN_FLAG);
    } else {
      putSupported = false;
    }
    return { list: true, put: putSupported, remove: true, usage: false };
  }

  return {
    id: "sops",
    capabilities(): SecretProviderCapabilities {
      return { list: true, put: putSupported, remove: true, usage: false };
    },
    refreshCapabilities: refresh,
    async readOnlyReason(): Promise<SecretError> {
      const binary = await deps.binary();
      return binary.ok ? { kind: "read_only_provider", provider: "sops" } : binary.error;
    },
    async put(ref: string, value: Uint8Array): Promise<Result<void, SecretError>> {
      const target = await locate(ref);
      if (!target.ok) return target;
      // sops가 없으면 쓰기 지원을 판정할 수 없다. 읽기 전용이라고 잘못 알리지 않고 바이너리 오류를 그대로 돌려준다
      const binary = await deps.binary();
      if (!binary.ok) return binary;
      const caps = await refresh();
      if (!caps.put) return err({ kind: "read_only_provider", provider: "sops" });
      const { file, index } = target.value;
      if (deps.recipient !== undefined) {
        // 잠금 파일(`<path>.lock`)이 들어갈 디렉터리가 먼저 있어야 한다
        const dir = await attemptAsync(() =>
          mkdir(dirname(file.path), { recursive: true, mode: 0o700 }),
        );
        if (!dir.ok) {
          return err({
            kind: "write_failed",
            target: "sops_file",
            path: file.path,
            code: errorCode(dir.error.cause),
          });
        }
      }
      return exclusive(file.path, async () => {
        const ready = await ensureFile(file);
        if (!ready.ok) return ready;
        const prepared = await prepare();
        if (!prepared.ok) return prepared;
        const stdin = jsonStringBytes(value);
        try {
          // 값은 stdin으로만 보낸다. argv에는 파일 경로와 키 이름만 들어간다
          const run = await deps.runner({
            argv: [prepared.value.binary, "set", VALUE_STDIN_FLAG, file.path, index],
            env: prepared.value.env,
            timeoutMs: DEFAULT_TIMEOUT_MS,
            signal: deps.signal,
            stdin,
          });
          return settle(run, prepared.value.keyId);
        } finally {
          stdin.fill(0);
        }
      });
    },
    async remove(ref: string): Promise<Result<void, SecretError>> {
      const target = await locate(ref);
      if (!target.ok) return target;
      if (!target.value.exists) return err(missing());
      const { file, index } = target.value;
      return exclusive(file.path, async () => {
        const prepared = await prepare();
        if (!prepared.ok) return prepared;
        const run = await deps.runner({
          argv: [prepared.value.binary, "unset", file.path, index],
          env: prepared.value.env,
          timeoutMs: DEFAULT_TIMEOUT_MS,
          signal: deps.signal,
        });
        return settle(run, prepared.value.keyId);
      });
    },
    async list(): Promise<Result<readonly ProviderEntry[], SecretError>> {
      const files = deps.files();
      const listings = await Promise.all(files.map((file) => readListing(file)));
      const entries: ProviderEntry[] = [];
      for (const [index, file] of files.entries()) {
        const listing = listings[index] ?? null;
        if (listing === null) continue;
        for (const key of listing.keys) {
          entries.push({
            provider: "sops",
            ref: `${file.env}/${key}`,
            updatedAt: listing.lastModified,
          });
        }
      }
      return ok(entries);
    },
    async lease(
      ref: string,
      ctx: UseCtx,
      limits: { readonly ttlSeconds: number; readonly maxUses: number },
    ): Promise<Result<SecretLease, SecretError>> {
      const parts = splitRef(ref);
      if (parts === null) return err(missing());
      const file = deps.files().find((f) => f.env === parts.env);
      if (file === undefined) return err(missing());
      const listing = await readListing(file);
      if (listing === null || !listing.keys.includes(parts.keyPath)) return err(missing());
      const extract = extractArgument(parts.keyPath);
      if (!extract.ok) return err(missing());

      const binary = await deps.binary();
      if (!binary.ok) return binary;
      const key = await deps.key();
      if (!key.ok) return key;

      // 인자에는 경로와 키 이름만 들어간다. 값은 stdout으로만 나온다
      const run = await deps.runner({
        argv: [binary.value.path, "decrypt", "--extract", extract.value, file.path],
        env: buildSopsEnv(deps.parentEnv, key.value.env),
        timeoutMs: DEFAULT_TIMEOUT_MS,
        signal: deps.signal,
      });
      if (!run.ok) {
        return err(
          run.error.kind === "cancelled" ? { kind: "cancelled" } : unavailable("binary_missing"),
        );
      }
      if (run.value.exitCode !== 0) {
        return err(
          classifyFailure(run.value.stderr, key.value.id, run.value.exitCode, deps.redactor),
        );
      }
      return ok(
        createLease({
          id: deps.ids.next("sls"),
          handle: PROVIDER_PLACEHOLDER_HANDLE,
          mode: ctx.mode,
          value: run.value.stdout,
          ttlSeconds: limits.ttlSeconds,
          maxUses: limits.maxUses,
          clock: deps.clock,
          scheduler: deps.scheduler,
        }),
      );
    },
  };
}
