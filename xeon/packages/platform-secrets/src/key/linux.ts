import { generateIdentity, identityToRecipient } from "age-encryption";
import { err, ok, type Result } from "@xeon/contracts";
import type { SecretError } from "@xeon/contracts/services";
import type { ProcessRunner } from "../providers/process.ts";
import {
  KEY_ACCOUNT,
  KEY_SERVICE,
  keyCommand,
  type KeyAvailability,
  type KeyProvider,
  type SopsKeyEnvName,
} from "./provider.ts";

// L0.secrets.spec §3.7, §4.7 3번. Linux Secret Service. 키 명령: `secret-tool lookup service xeon.age account default`.
// probe는 D-Bus 이름 org.freedesktop.secrets의 존재를 완전하게 확인하지 못하므로(D-Bus 호출 수단이 없다)
// secret-tool 바이너리와 세션 버스 단서(env, 소켓)만 본다 [가정]. WSL과 헤드리스는 없다고 본다.

export interface LinuxKeyExec {
  readonly runner: ProcessRunner;
  /** secret-tool 자식 env. 세션 버스 변수를 포함해야 한다. 민감 변수는 거른 것이다 */
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface LinuxKeyDeps {
  /** xeon.os가 해석한 secret-tool 절대 경로. 없으면 null */
  readonly secretToolPath: string | null;
  readonly isWsl: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly pathExists: (path: string) => boolean;
  /** 있으면 provision을 켠다. 시험은 가짜 실행기를 넣는다 */
  readonly exec?: LinuxKeyExec;
}

const TIMEOUT_MS = 60_000;
const ITEM_LABEL = "xeon age key";

function keyStoreFailure(code: string): SecretError {
  return { kind: "write_failed", target: "key_store", path: "secret-service", code };
}

type Lookup = "found" | "absent";

/**
 * 항목 존재만 본다. `secret-tool lookup`은 비밀을 stdout에 쓰므로 stdout을 버리고 종료 코드만 본다.
 * 이 코드는 identity 바이트를 받지 않는다. 종료 코드 0은 있음, 1은 없음(Secret Service가 없을 때도 1이라 만든 뒤 다시 확인한다)
 */
async function lookup(
  secretToolPath: string,
  exec: LinuxKeyExec,
): Promise<Result<Lookup, SecretError>> {
  const run = await exec.runner({
    argv: [secretToolPath, "lookup", "service", KEY_SERVICE, "account", KEY_ACCOUNT],
    env: exec.env,
    timeoutMs: TIMEOUT_MS,
    signal: exec.signal,
    discardStdout: true,
  });
  if (!run.ok) {
    return err(
      run.error.kind === "cancelled" ? { kind: "cancelled" } : keyStoreFailure(run.error.code),
    );
  }
  if (run.value.exitCode === 0) return ok("found");
  if (run.value.exitCode === 1) return ok("absent");
  return err(keyStoreFailure("lookup_failed"));
}

/**
 * identity를 만들어 Secret Service 항목으로 저장하고 수신자만 돌려준다(M3-m2c-04 (b)). 이미 항목이 있으면 만들지 않고 EEXIST다.
 * identity는 argv에 올리지 않고 `secret-tool store`의 stdin으로만 보낸다. stdin 버퍼는 쓴 직후 0으로 덮는다.
 * 저장 결과는 종료 코드와 함께 항목을 다시 찾아서 확인한다.
 */
async function provisionItem(
  secretToolPath: string,
  exec: LinuxKeyExec,
): Promise<Result<{ readonly recipient: string }, SecretError>> {
  const before = await lookup(secretToolPath, exec);
  if (!before.ok) return before;
  if (before.value === "found") return err(keyStoreFailure("EEXIST"));

  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const stdin = new TextEncoder().encode(identity);
  try {
    const run = await exec.runner({
      argv: [
        secretToolPath,
        "store",
        `--label=${ITEM_LABEL}`,
        "service",
        KEY_SERVICE,
        "account",
        KEY_ACCOUNT,
      ],
      env: exec.env,
      timeoutMs: TIMEOUT_MS,
      signal: exec.signal,
      stdin,
    });
    if (!run.ok) {
      return err(
        run.error.kind === "cancelled" ? { kind: "cancelled" } : keyStoreFailure(run.error.code),
      );
    }
    if (run.value.exitCode !== 0) return err(keyStoreFailure("store_failed"));
  } finally {
    stdin.fill(0);
  }
  const after = await lookup(secretToolPath, exec);
  if (!after.ok) return after;
  if (after.value !== "found") return err(keyStoreFailure("add_failed"));
  return ok({ recipient });
}

function hasSessionBus(deps: LinuxKeyDeps): boolean {
  const address = deps.env["DBUS_SESSION_BUS_ADDRESS"];
  if (address !== undefined && address !== "") return true;
  const runtime = deps.env["XDG_RUNTIME_DIR"];
  return runtime !== undefined && runtime !== "" && deps.pathExists(`${runtime}/bus`);
}

export function createLinuxKeyProvider(deps: LinuxKeyDeps): KeyProvider {
  const { secretToolPath, exec } = deps;
  const base: KeyProvider = {
    id: "linux-secret-service",
    probe(): Promise<KeyAvailability> {
      const available = !deps.isWsl && deps.secretToolPath !== null && hasSessionBus(deps);
      return Promise.resolve(
        available
          ? { available: true, reason: "ok" }
          : { available: false, reason: "no_secret_service" },
      );
    },
    sopsKeyEnv(): Result<Readonly<Partial<Record<SopsKeyEnvName, string>>>, SecretError> {
      if (deps.secretToolPath === null || deps.isWsl) {
        return err({
          kind: "key_unavailable",
          key: "linux-secret-service",
          reason: "no_secret_service",
        });
      }
      return ok({
        SOPS_AGE_KEY_CMD: keyCommand([
          deps.secretToolPath,
          "lookup",
          "service",
          KEY_SERVICE,
          "account",
          KEY_ACCOUNT,
        ]),
      });
    },
  };
  if (secretToolPath === null || exec === undefined || deps.isWsl) return base;
  return { ...base, provision: () => provisionItem(secretToolPath, exec) };
}
