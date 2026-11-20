import { err, ok, type Result } from "@fresnel/contracts";
import type { ProtectPathsStore, ProtectPathsWriteFailure } from "@fresnel/cap-workspace";
import { checkSettingWrite } from "@fresnel/contracts/settings";
import type { SettingsStorePort, SettingsWriteFailure } from "../types.ts";
import type { SettingsEngine } from "./settings-engine.ts";

// [제안, AGE-63] 모델 도구 `sandbox_protect`가 사용자 범위 `l0.sandbox.protectedPaths.extra`에 더하는 포트(cap-workspace의
// `ProtectPathsStore`). 읽기는 설정 엔진의 사용자 층에서 하고, 쓰기는 설정 저장소의 `write("user", …)`로 한다. 값 검사는 카탈로그의
// 정의와 `checkSettingWrite`가 한다. 프로젝트와 로컬 범위의 파일은 쓰지 않는다. 쓴 뒤의 `settings.invalidated`는 저장소가 보낸다.

/** 보호 경로 설정 키(L0.sandbox.spec §6). 사용자 범위에만 쓴다 */
const PROTECTED_PATHS_EXTRA_KEY = "l0.sandbox.protectedPaths.extra";

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** 저장소 실패의 값 코드. OS 오류 코드가 있으면 그것을, 없으면 실패 종류를 준다 */
function codeOf(failure: SettingsWriteFailure): string {
  return "code" in failure ? failure.code : failure.kind;
}

/**
 * 사용자 범위 extra를 더하는 포트. `store`는 조립 순서상 설정 저장소가 뒤에 올라올 수 있어 호출 때 읽는다(없으면 unavailable).
 * 같은 값이 이미 있으면 한 번만 둔다. 개수 한도와 managed 잠금은 `checkSettingWrite`가 거른다.
 */
export function protectPathsStoreOf(
  settings: SettingsEngine,
  store: () => SettingsStorePort | undefined,
): ProtectPathsStore {
  return {
    current: () => {
      const raw = settings.userValues().get(PROTECTED_PATHS_EXTRA_KEY);
      return isStringList(raw) ? raw : [];
    },
    add: async (values): Promise<Result<readonly string[], ProtectPathsWriteFailure>> => {
      const port = store();
      if (port === undefined) return err({ kind: "unavailable" });
      const raw = settings.userValues().get(PROTECTED_PATHS_EXTRA_KEY);
      // 저장된 값이 목록 모양이 아니면 덮어쓰지 않는다. 사용자가 고칠 값이다
      if (raw !== undefined && !isStringList(raw)) return err({ kind: "invalid_value" });
      const next = [...new Set([...(raw ?? []), ...values])];
      const checked = checkSettingWrite(
        settings.catalog,
        settings.layers(undefined),
        PROTECTED_PATHS_EXTRA_KEY,
        "user",
        next,
      );
      if (!checked.ok) {
        return err(
          checked.kind === "settings.locked" ? { kind: "locked" } : { kind: "invalid_value" },
        );
      }
      const written = await port.write("user", PROTECTED_PATHS_EXTRA_KEY, next, undefined);
      if (!written.ok) return err({ kind: "store_failed", code: codeOf(written.error) });
      return ok(next);
    },
  };
}
