import { err, ok, type Result } from "@xeon/contracts";
import type { SecretError } from "@xeon/contracts/services";
import {
  KEY_ACCOUNT,
  KEY_SERVICE,
  keyCommand,
  type KeyAvailability,
  type KeyProvider,
  type SopsKeyEnvName,
} from "./provider.ts";

// L0.secrets.spec §3.7 표. macOS Keychain: `security find-generic-password -s xeon.age -a default -w`.
// 마일스톤 M1에서는 명령 구성까지만 만든다. 항목 존재·접근 승인 대화상자 확인은 macOS 실기(M2, SC-19)다.

export interface DarwinKeyDeps {
  /** xeon.os가 해석한 security 절대 경로. 없으면 null */
  readonly securityPath: string | null;
}

export function createDarwinKeyProvider(deps: DarwinKeyDeps): KeyProvider {
  return {
    id: "darwin-keychain",
    probe(): Promise<KeyAvailability> {
      return Promise.resolve(
        deps.securityPath === null
          ? { available: false, reason: "not_implemented" }
          : { available: true, reason: "ok" },
      );
    },
    sopsKeyEnv(): Result<Readonly<Partial<Record<SopsKeyEnvName, string>>>, SecretError> {
      if (deps.securityPath === null) {
        return err({ kind: "key_unavailable", key: "darwin-keychain", reason: "item_missing" });
      }
      return ok({
        SOPS_AGE_KEY_CMD: keyCommand([
          deps.securityPath,
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
}
