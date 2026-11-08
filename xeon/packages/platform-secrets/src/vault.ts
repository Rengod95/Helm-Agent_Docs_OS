import { err, ok, type Result } from "@fresnel/contracts";
import type { ProcessRunner, RunOutput } from "./providers/process.ts";

// 데스크톱 셸(Node, Bun 아님)이 `./vault` 진입점만으로 자기 실행기를 타입에 맞춰 만들 수 있게 다시 낸다
export type { ProcessRunner, RunOutput, RunRequest } from "./providers/process.ts";
export { nodeProcessRunner } from "./vault-runner.ts";

// L0 원격 장치 토큰 보관소. macOS Keychain(`security`)과 Linux Secret Service(`secret-tool`)에 토큰을 둔다.
// key/darwin.ts, key/linux.ts와 같은 방식이다. 값은 argv에 싣지 않는다. `security -i`는 명령 줄을,
// `secret-tool store`는 값 바이트를 stdin으로 받고, stdin 버퍼는 쓴 뒤 0으로 덮는다.
// 오류와 로그에는 값을 싣지 않는다. age 키 항목(fresnel.age)과는 서비스 이름이 다르다.

/** 원격 장치 토큰 항목의 서비스 이름 */
export const VAULT_SERVICE = "fresnel.remote-device";

export type VaultError =
  | { readonly kind: "unavailable" }
  | { readonly kind: "not_found" }
  | { readonly kind: "cancelled" }
  /** code는 실행 실패 코드나 작업 이름이다. 값은 싣지 않는다 */
  | { readonly kind: "failed"; readonly code: string };

export interface TokenVault {
  /** 값을 돌려준다. 항목이 없거나 값이 비어 있으면 not_found */
  get(account: string): Promise<Result<string, VaultError>>;
  /** 값을 쓴다. 이미 있으면 덮어쓴다 */
  set(account: string, value: string): Promise<Result<void, VaultError>>;
  /** 항목을 지운다. 항목이 없어도 ok다 */
  remove(account: string): Promise<Result<void, VaultError>>;
}

export interface TokenVaultDeps {
  readonly platform: "darwin" | "linux" | "other";
  /** fresnel.os가 해석한 security 절대 경로. 없으면 null */
  readonly securityPath: string | null;
  /** fresnel.os가 해석한 secret-tool 절대 경로. 없으면 null */
  readonly secretToolPath: string | null;
  readonly runner: ProcessRunner;
  /** 자식 env 전체. 민감 변수는 거른 것이다 */
  readonly env: Readonly<Record<string, string>>;
  /** 서비스가 닫히면 중단된다 */
  readonly signal: AbortSignal;
}

const TIMEOUT_MS = 60_000;
/** `security`가 항목을 찾지 못했을 때의 종료 코드(errSecItemNotFound = -25300, 하위 8비트 44). key/darwin.ts와 같다 */
const DARWIN_NOT_FOUND = 44;
/** `secret-tool lookup`이 항목을 찾지 못했을 때의 종료 코드. key/linux.ts와 같다 */
const LINUX_NOT_FOUND = 1;
const LABEL = "fresnel remote device";
/** 계정 이름: host:port 모양. 공백·따옴표·줄바꿈이 없어 `security -i` 줄을 깨지 못하고, `-`로 시작하지 않아 옵션으로 읽히지 않는다 */
const ACCOUNT_PATTERN = /^[A-Za-z0-9._:[\]][A-Za-z0-9._:[\]-]{0,127}$/;
/** 토큰 값: base64url·hex·base64 계열 문자만. 줄을 깨는 문자가 없다 */
const VALUE_PATTERN = /^[A-Za-z0-9._~+/=-]{8,512}$/;

const UNAVAILABLE: VaultError = { kind: "unavailable" };
const NOT_FOUND: VaultError = { kind: "not_found" };
const CANCELLED: VaultError = { kind: "cancelled" };
const BAD_ACCOUNT: VaultError = { kind: "failed", code: "bad_account" };
const BAD_VALUE: VaultError = { kind: "failed", code: "bad_value" };

function failed(code: string): VaultError {
  return { kind: "failed", code };
}

type Backend =
  | { readonly kind: "darwin"; readonly securityPath: string }
  | { readonly kind: "linux"; readonly secretToolPath: string };

/** 플랫폼과 바이너리 경로가 모두 있을 때만 백엔드가 있다. 그 밖은 unavailable이다 */
function backendOf(deps: TokenVaultDeps): Backend | null {
  if (deps.platform === "darwin" && deps.securityPath !== null) {
    return { kind: "darwin", securityPath: deps.securityPath };
  }
  if (deps.platform === "linux" && deps.secretToolPath !== null) {
    return { kind: "linux", secretToolPath: deps.secretToolPath };
  }
  return null;
}

interface ExecOptions {
  readonly stdin?: Uint8Array;
  /** 참이면 stdout을 읽지 않는다. 존재 확인처럼 출력이 필요 없는 호출에 쓴다 */
  readonly discardStdout?: boolean;
}

type Exec = (
  argv: readonly string[],
  options?: ExecOptions,
) => Promise<Result<RunOutput, VaultError>>;

/** 실행 한 번. 실행 실패는 취소와 나머지로 나눠 오류 값으로 옮긴다 */
function execOf(deps: TokenVaultDeps): Exec {
  return async (argv, options = {}) => {
    const run = await deps.runner({
      argv,
      env: deps.env,
      timeoutMs: TIMEOUT_MS,
      signal: deps.signal,
      ...options,
    });
    if (!run.ok) {
      return err(run.error.kind === "cancelled" ? CANCELLED : failed(run.error.code));
    }
    return ok(run.value);
  };
}

/** stdin 버퍼는 실행이 끝나면 성패와 무관하게 0으로 덮는다 */
async function execWithStdin(
  exec: Exec,
  argv: readonly string[],
  stdin: Uint8Array,
): Promise<Result<RunOutput, VaultError>> {
  try {
    return await exec(argv, { stdin });
  } finally {
    stdin.fill(0);
  }
}

/** 출력 바이트를 문자열로 바꾸고 바이트는 0으로 덮는다. 끝의 줄바꿈 하나는 뺀다 */
function takeOutput(stdout: Uint8Array): string {
  const text = new TextDecoder().decode(stdout);
  stdout.fill(0);
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

// ── macOS Keychain ───────────────────────────────────────────────────────

async function darwinGet(
  exec: Exec,
  securityPath: string,
  account: string,
): Promise<Result<string, VaultError>> {
  const run = await exec([
    securityPath,
    "find-generic-password",
    "-s",
    VAULT_SERVICE,
    "-a",
    account,
    "-w",
  ]);
  if (!run.ok) return err(run.error);
  if (run.value.exitCode === DARWIN_NOT_FOUND) return err(NOT_FOUND);
  if (run.value.exitCode !== 0) return err(failed("find_failed"));
  const value = takeOutput(run.value.stdout);
  if (value === "") return err(NOT_FOUND);
  return ok(value);
}

/** 항목이 있는가. 비밀번호 데이터를 읽지 않는다(`-w` 없음) */
async function darwinHas(
  exec: Exec,
  securityPath: string,
  account: string,
): Promise<Result<boolean, VaultError>> {
  const run = await exec(
    [securityPath, "find-generic-password", "-s", VAULT_SERVICE, "-a", account],
    { discardStdout: true },
  );
  if (!run.ok) return err(run.error);
  if (run.value.exitCode === 0) return ok(true);
  if (run.value.exitCode === DARWIN_NOT_FOUND) return ok(false);
  return err(failed("find_failed"));
}

async function darwinSet(
  exec: Exec,
  securityPath: string,
  account: string,
  value: string,
): Promise<Result<void, VaultError>> {
  // key/darwin.ts의 provision과 같은 방식이다. 계정과 값이 패턴을 통과해 줄을 깨지 못한다.
  // `-U`는 있으면 갱신이다. 종료 코드는 개별 명령의 성패를 싣는다고 단정할 수 없어 항목을 다시 찾아 확인한다.
  const line = `add-generic-password -U -s ${VAULT_SERVICE} -a ${account} -l "${LABEL}" -w ${value}\n`;
  const run = await execWithStdin(exec, [securityPath, "-i"], new TextEncoder().encode(line));
  if (!run.ok) return err(run.error);
  const stored = await darwinHas(exec, securityPath, account);
  if (!stored.ok) return err(stored.error);
  if (!stored.value) return err(failed("add_failed"));
  return ok(undefined);
}

async function darwinRemove(
  exec: Exec,
  securityPath: string,
  account: string,
): Promise<Result<void, VaultError>> {
  const run = await exec(
    [securityPath, "delete-generic-password", "-s", VAULT_SERVICE, "-a", account],
    { discardStdout: true },
  );
  if (!run.ok) return err(run.error);
  if (run.value.exitCode === 0 || run.value.exitCode === DARWIN_NOT_FOUND) return ok(undefined);
  return err(failed("delete_failed"));
}

// ── Linux Secret Service ─────────────────────────────────────────────────

async function linuxGet(
  exec: Exec,
  secretToolPath: string,
  account: string,
): Promise<Result<string, VaultError>> {
  const run = await exec([secretToolPath, "lookup", "service", VAULT_SERVICE, "account", account]);
  if (!run.ok) return err(run.error);
  if (run.value.exitCode === LINUX_NOT_FOUND) return err(NOT_FOUND);
  if (run.value.exitCode !== 0) return err(failed("lookup_failed"));
  const value = takeOutput(run.value.stdout);
  if (value === "") return err(NOT_FOUND);
  return ok(value);
}

/** 항목이 있는가. stdout을 버리고 종료 코드만 본다 */
async function linuxHas(
  exec: Exec,
  secretToolPath: string,
  account: string,
): Promise<Result<boolean, VaultError>> {
  const run = await exec([secretToolPath, "lookup", "service", VAULT_SERVICE, "account", account], {
    discardStdout: true,
  });
  if (!run.ok) return err(run.error);
  if (run.value.exitCode === 0) return ok(true);
  if (run.value.exitCode === LINUX_NOT_FOUND) return ok(false);
  return err(failed("lookup_failed"));
}

async function linuxSet(
  exec: Exec,
  secretToolPath: string,
  account: string,
  value: string,
): Promise<Result<void, VaultError>> {
  // 값은 stdin으로만 보낸다. `secret-tool store`는 같은 속성의 항목을 덮어쓴다
  const run = await execWithStdin(
    exec,
    [secretToolPath, "store", `--label=${LABEL}`, "service", VAULT_SERVICE, "account", account],
    new TextEncoder().encode(value),
  );
  if (!run.ok) return err(run.error);
  if (run.value.exitCode !== 0) return err(failed("store_failed"));
  const stored = await linuxHas(exec, secretToolPath, account);
  if (!stored.ok) return err(stored.error);
  if (!stored.value) return err(failed("add_failed"));
  return ok(undefined);
}

async function linuxRemove(
  exec: Exec,
  secretToolPath: string,
  account: string,
): Promise<Result<void, VaultError>> {
  const run = await exec([secretToolPath, "clear", "service", VAULT_SERVICE, "account", account], {
    discardStdout: true,
  });
  if (!run.ok) return err(run.error);
  if (run.value.exitCode !== 0) return err(failed("clear_failed"));
  return ok(undefined);
}

// ── 공개 진입점 ──────────────────────────────────────────────────────────

export function createTokenVault(deps: TokenVaultDeps): TokenVault {
  const exec = execOf(deps);
  const backend = backendOf(deps);
  return {
    async get(account) {
      if (!ACCOUNT_PATTERN.test(account)) return err(BAD_ACCOUNT);
      if (backend === null) return err(UNAVAILABLE);
      return backend.kind === "darwin"
        ? darwinGet(exec, backend.securityPath, account)
        : linuxGet(exec, backend.secretToolPath, account);
    },
    async set(account, value) {
      if (!ACCOUNT_PATTERN.test(account)) return err(BAD_ACCOUNT);
      if (!VALUE_PATTERN.test(value)) return err(BAD_VALUE);
      if (backend === null) return err(UNAVAILABLE);
      return backend.kind === "darwin"
        ? darwinSet(exec, backend.securityPath, account, value)
        : linuxSet(exec, backend.secretToolPath, account, value);
    },
    async remove(account) {
      if (!ACCOUNT_PATTERN.test(account)) return err(BAD_ACCOUNT);
      if (backend === null) return err(UNAVAILABLE);
      return backend.kind === "darwin"
        ? darwinRemove(exec, backend.securityPath, account)
        : linuxRemove(exec, backend.secretToolPath, account);
    },
  };
}
