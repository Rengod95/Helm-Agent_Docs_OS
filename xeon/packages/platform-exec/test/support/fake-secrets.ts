import { err, ok } from "@xeon/contracts";
import type { SecretHandle } from "@xeon/contracts/capabilities";
import type { SecretLease, SecretService, UseCtx } from "@xeon/contracts/services";
import type { SecretEnvSource } from "../../src/secret-env.ts";

interface FakeSecretCall {
  readonly handle: SecretHandle;
  readonly ctx: Omit<UseCtx, "mode">;
}

export interface FakeSecrets extends SecretEnvSource {
  /** 성공한 withEnv 횟수 */
  readonly acquired: () => number;
  /** lease.dispose() 호출 횟수(두 번째 이후 호출도 센다) */
  readonly disposed: () => number;
  readonly calls: readonly FakeSecretCall[];
}

/** 이름(secret://<name>)별 값을 돌려주는 가짜. `missing`에 든 이름은 provider_unavailable 계열 오류다 */
export function fakeSecrets(
  values: Readonly<Record<string, string>>,
  options: { readonly missing?: readonly string[] } = {},
): FakeSecrets {
  let acquired = 0;
  let disposed = 0;
  const calls: FakeSecretCall[] = [];
  const withEnv: SecretService["withEnv"] = (handle, ctx) => {
    calls.push({ handle, ctx });
    const name = handle.slice("secret://".length);
    const value = values[name];
    if (value === undefined || options.missing?.includes(name) === true) {
      return Promise.resolve(err({ kind: "secret_missing", handle, where: "provider" }));
    }
    acquired++;
    let closed = false;
    const lease: SecretLease = {
      leaseId: `sls_${acquired}`,
      handle,
      mode: "env",
      expiresAt: 0,
      usesLeft: 1,
      use: (fn) => {
        if (closed) return Promise.resolve(err({ kind: "reauth_required" }));
        return Promise.resolve(
          fn({ bytes: new TextEncoder().encode(value), text: () => value }),
        ).then((result) => ok(result));
      },
      dispose: () => {
        disposed++;
        closed = true;
      },
      toJSON: () => `[SecretLease sls_${acquired}]`,
    };
    return Promise.resolve(ok(lease));
  };
  return { withEnv, acquired: () => acquired, disposed: () => disposed, calls };
}
