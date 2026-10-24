import { err, type Result } from "@xeon/contracts";
import type { SecretError } from "@xeon/contracts/services";
import type { KeyAvailability, KeyProvider, SopsKeyEnvName } from "./provider.ts";

// L0.secrets.spec §5.1. Windows 자격 증명 관리자는 읽기 수단이 정해지지 않았다(`cmdkey`는 암호를 읽지 못한다).
// 헬퍼 실행 파일이 정해질 때까지 스텁이다.

export function createWin32KeyProvider(): KeyProvider {
  return {
    id: "win32-credential",
    probe(): Promise<KeyAvailability> {
      return Promise.resolve({ available: false, reason: "not_implemented" });
    },
    sopsKeyEnv(): Result<Readonly<Partial<Record<SopsKeyEnvName, string>>>, SecretError> {
      return err({ kind: "key_unavailable", key: "win32-credential", reason: "no_secret_service" });
    },
  };
}
