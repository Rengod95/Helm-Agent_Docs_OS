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

// L0.secrets.spec §3.7, §4.7 3번. Linux Secret Service. 키 명령: `secret-tool lookup service xeon.age account default`.
// probe는 D-Bus 이름 org.freedesktop.secrets의 존재를 완전하게 확인하지 못하므로(D-Bus 호출 수단이 없다)
// secret-tool 바이너리와 세션 버스 단서(env, 소켓)만 본다 [가정]. WSL과 헤드리스는 없다고 본다.

export interface LinuxKeyDeps {
  /** xeon.os가 해석한 secret-tool 절대 경로. 없으면 null */
  readonly secretToolPath: string | null;
  readonly isWsl: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly pathExists: (path: string) => boolean;
}

function hasSessionBus(deps: LinuxKeyDeps): boolean {
  const address = deps.env["DBUS_SESSION_BUS_ADDRESS"];
  if (address !== undefined && address !== "") return true;
  const runtime = deps.env["XDG_RUNTIME_DIR"];
  return runtime !== undefined && runtime !== "" && deps.pathExists(`${runtime}/bus`);
}

export function createLinuxKeyProvider(deps: LinuxKeyDeps): KeyProvider {
  return {
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
}
