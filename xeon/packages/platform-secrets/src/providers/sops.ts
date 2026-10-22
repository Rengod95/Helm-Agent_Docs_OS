import { readFile } from "node:fs/promises";
import { err, ok, type Clock, type Logger, type Result, type Scheduler } from "@xeon/contracts";
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
import { extractArgument, formatOfPath, parseSopsKeys, type SopsKeyListing } from "./sops-keys.ts";

// L0.secrets.spec §4.6. sops 바이너리 호출 래퍼. `sops`, `age` 바이너리 호출은 이 패키지만 한다(DR-07).
// 값은 sops의 stdout을 부모 프로세스 메모리로 받아 lease에 넘긴다. 디스크에 쓰지 않고 argv에 올리지 않는다.

// ── 프로세스 실행기 ──────────────────────────────────────────────────────

export interface RunRequest {
  readonly argv: readonly string[];
  /** 자식 env 전체. 부모 env를 물려받지 않는다 */
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** 서비스가 닫히면 중단된다. 실행 중인 자식 프로세스를 죽인다 */
  readonly signal: AbortSignal;
}

export interface RunOutput {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

type RunFailure =
  | { readonly kind: "spawn_failed"; readonly code: string }
  | { readonly kind: "cancelled" };

/** 주입 지점. 테스트는 가짜 실행기나 가짜 sops 실행 파일을 쓴다 */
export type ProcessRunner = (request: RunRequest) => Promise<Result<RunOutput, RunFailure>>;

const DEFAULT_TIMEOUT_MS = 30_000;

export const bunRunner: ProcessRunner = async (request) => {
  // 신호는 await 사이에 중단될 수 있어 읽을 때마다 현재 값을 본다
  const cancelled = (): boolean => request.signal.aborted;
  if (cancelled()) return err({ kind: "cancelled" });
  try {
    const proc = Bun.spawn([...request.argv], {
      env: { ...request.env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: request.timeoutMs,
      signal: request.signal,
    });
    const stdoutPending = new Response(proc.stdout).arrayBuffer();
    const stderrPending = new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    const stdout = new Uint8Array(await stdoutPending);
    const stderr = await stderrPending;
    // 중단 신호로 죽은 호출은 출력이 잘렸을 수 있어 결과로 쓰지 않는다
    if (cancelled()) return err({ kind: "cancelled" });
    return ok({ exitCode, stdout, stderr });
  } catch (error: unknown) {
    if (cancelled()) return err({ kind: "cancelled" });
    return err({ kind: "spawn_failed", code: errorCode(error) });
  }
};

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
}

const CAPABILITIES: SecretProviderCapabilities = {
  list: true,
  // put/remove는 sops set의 stdin 입력 지원 확인 뒤에만 켠다(spec §4.6 6번, 마일스톤 M2)
  put: false,
  remove: false,
  usage: false,
};

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

export function createSopsProvider(deps: SopsProviderDeps): SecretProvider {
  async function readListing(file: SecretsSopsFile): Promise<SopsKeyListing | null> {
    let content: string;
    try {
      content = await readFile(file.path, "utf8");
    } catch (error: unknown) {
      deps.logger.warn("secrets.sops.file_unreadable", { env: file.env, code: errorCode(error) });
      return null;
    }
    const parsed = parseSopsKeys(content, formatOfPath(file.path));
    if (!parsed.ok) {
      deps.logger.warn("secrets.sops.file_unparseable", { env: file.env });
      return null;
    }
    return parsed.value;
  }

  return {
    id: "sops",
    capabilities(): SecretProviderCapabilities {
      return CAPABILITIES;
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
