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

// L0.secrets.spec §3.7 표, §4.7 7번. macOS Keychain: `security find-generic-password -s xeon.age -a default -w`.
// 항목 존재·접근 승인 대화상자 확인은 macOS 실기(SC-19)다. provision은 `security -i`로 항목을 만든다.

export interface DarwinKeyExec {
  readonly runner: ProcessRunner;
  /** security 자식 env. 민감 변수를 거른 것이다 */
  readonly env: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

export interface DarwinKeyDeps {
  /** xeon.os가 해석한 security 절대 경로. 없으면 null */
  readonly securityPath: string | null;
  /** 있으면 provision을 켠다. 시험은 가짜 실행기를 넣는다 */
  readonly exec?: DarwinKeyExec;
}

const TIMEOUT_MS = 60_000;
/** `security`가 항목을 찾지 못했을 때의 종료 코드(errSecItemNotFound = -25300, 하위 8비트 44) */
const EXIT_ITEM_NOT_FOUND = 44;
const ITEM_LABEL = "xeon age key";

function keyStoreFailure(code: string): SecretError {
  return { kind: "write_failed", target: "key_store", path: "keychain", code };
}

type Lookup = "found" | "absent";

/** 항목 존재만 본다. `-w`나 `-g`가 없어 비밀번호 데이터를 읽지 않고 접근 승인 대화상자도 뜨지 않는다 */
async function lookup(
  securityPath: string,
  exec: DarwinKeyExec,
): Promise<Result<Lookup, SecretError>> {
  const run = await exec.runner({
    argv: [securityPath, "find-generic-password", "-s", KEY_SERVICE, "-a", KEY_ACCOUNT],
    env: exec.env,
    timeoutMs: TIMEOUT_MS,
    signal: exec.signal,
  });
  if (!run.ok) {
    return err(
      run.error.kind === "cancelled" ? { kind: "cancelled" } : keyStoreFailure(run.error.code),
    );
  }
  if (run.value.exitCode === 0) return ok("found");
  if (run.value.exitCode === EXIT_ITEM_NOT_FOUND) return ok("absent");
  return err(keyStoreFailure("find_failed"));
}

/**
 * identity를 만들어 Keychain 항목으로 저장하고 수신자만 돌려준다. 이미 항목이 있으면 만들지 않고 EEXIST다.
 * identity는 argv에 올리지 않는다: `security -i`가 stdin으로 명령 줄을 받는다. 저장 결과는 종료 코드가 아니라
 * 항목을 다시 찾아서 확인한다(interactive 모드의 종료 코드는 개별 명령의 성패를 싣는다고 단정할 수 없다 [가정]).
 */
async function provisionItem(
  securityPath: string,
  exec: DarwinKeyExec,
): Promise<Result<{ readonly recipient: string }, SecretError>> {
  const before = await lookup(securityPath, exec);
  if (!before.ok) return before;
  if (before.value === "found") return err(keyStoreFailure("EEXIST"));

  const identity = await generateIdentity();
  const recipient = await identityToRecipient(identity);
  const stdin = new TextEncoder().encode(
    `add-generic-password -s ${KEY_SERVICE} -a ${KEY_ACCOUNT} -l "${ITEM_LABEL}" -w ${identity}\n`,
  );
  try {
    const run = await exec.runner({
      argv: [securityPath, "-i"],
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
  } finally {
    stdin.fill(0);
  }
  const after = await lookup(securityPath, exec);
  if (!after.ok) return after;
  if (after.value !== "found") return err(keyStoreFailure("add_failed"));
  return ok({ recipient });
}

export function createDarwinKeyProvider(deps: DarwinKeyDeps): KeyProvider {
  const { securityPath, exec } = deps;
  const base: KeyProvider = {
    id: "darwin-keychain",
    probe(): Promise<KeyAvailability> {
      return Promise.resolve(
        securityPath === null
          ? { available: false, reason: "not_implemented" }
          : { available: true, reason: "ok" },
      );
    },
    sopsKeyEnv(): Result<Readonly<Partial<Record<SopsKeyEnvName, string>>>, SecretError> {
      if (securityPath === null) {
        return err({ kind: "key_unavailable", key: "darwin-keychain", reason: "item_missing" });
      }
      return ok({
        SOPS_AGE_KEY_CMD: keyCommand([
          securityPath,
          "find-generic-password",
          "-s",
          KEY_SERVICE,
          "-a",
          KEY_ACCOUNT,
          "-w",
        ]),
      });
    },
  };
  if (securityPath === null || exec === undefined) return base;
  return { ...base, provision: () => provisionItem(securityPath, exec) };
}
