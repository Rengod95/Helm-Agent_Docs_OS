import { statSync } from "node:fs";
import { attempt, err, ok, type Result } from "@xeon/contracts";
import type { SecretError } from "@xeon/contracts/services";
import type { KeyAvailability, KeyProvider, SopsKeyEnvName } from "./provider.ts";

// L0.secrets.spec §4.7 4번. 파일 폴백: identity 파일을 0600으로 두고 SOPS_AGE_KEY_FILE로 넘긴다.
// 이 코드는 파일 내용을 읽지 않는다. 소유자와 권한만 검사하고 틀리면 key_unavailable(file_mode)이다.
// identity 생성(provision)은 age-encryption 의존이 연결된 뒤에 더한다.

interface KeyFileStat {
  readonly mode: number;
  readonly uid: number;
}

export type StatKeyFile = (path: string) => KeyFileStat | null;

const statKeyFile: StatKeyFile = (path) => {
  const stat = attempt(() => statSync(path));
  // 없거나 읽을 수 없는 키 파일은 item_missing으로 다룬다(호출자가 null을 그렇게 해석한다)
  return stat.ok ? { mode: stat.value.mode, uid: stat.value.uid } : null;
};

export interface FileKeyDeps {
  readonly path: string;
  /** POSIX uid. null(Windows)이면 소유자 검사를 건너뛴다 */
  readonly uid: number | null;
  readonly stat?: StatKeyFile;
}

type FileCheck = "ok" | "item_missing" | "file_mode";

function check(deps: FileKeyDeps): FileCheck {
  const stat = (deps.stat ?? statKeyFile)(deps.path);
  if (stat === null) return "item_missing";
  if ((stat.mode & 0o077) !== 0) return "file_mode";
  if (deps.uid !== null && stat.uid !== deps.uid) return "file_mode";
  return "ok";
}

export function createFileKeyProvider(deps: FileKeyDeps): KeyProvider {
  return {
    id: "file",
    probe(): Promise<KeyAvailability> {
      const state = check(deps);
      return Promise.resolve({ available: state === "ok", reason: state });
    },
    sopsKeyEnv(): Result<Readonly<Partial<Record<SopsKeyEnvName, string>>>, SecretError> {
      const state = check(deps);
      if (state === "ok") return ok({ SOPS_AGE_KEY_FILE: deps.path });
      return err({ kind: "key_unavailable", key: "file", reason: state });
    },
  };
}
