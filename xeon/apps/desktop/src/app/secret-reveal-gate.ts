import { err, type Result } from "@fresnel/contracts";
import type { SecretName } from "@fresnel/contracts/capabilities";
import type { RevealFailure, SecretRevealPort } from "@fresnel/client/settings";

// 값 보기 재인증 관문(DECISION B8). 값은 사람이 기기 인증(Touch ID, 기기 암호)을 마친 뒤에만 보인다.
// 네이티브 인증은 새 의존(LAContext 또는 Tauri 플러그인)이 필요해 아직 승인되지 않았다. 그래서 출하 구현은 `UNAVAILABLE_GATE`다:
// 재인증을 할 수 없으므로 값 경로(`value` 포트)는 한 번도 불리지 않고, 값은 가져오지도 상태에 두지도 않는다.

export interface RevealGate {
  /** 이 기기에서 재인증을 띄울 수 있는가. 거짓이면 화면은 값 보기를 잠그고 이유를 보인다 */
  readonly available: boolean;
  /** 사람이 재인증을 마치면 `ok`다. 거절, 만료, 수단 없음은 `RevealFailure`로 돌려준다. 값은 다루지 않는다 */
  reauth(name: SecretName): Promise<Result<void, RevealFailure>>;
}

const UNAVAILABLE_REAUTH: Result<void, RevealFailure> = err({ kind: "unavailable" });

/** 출하 구현. 재인증 수단이 없으므로 항상 `unavailable`이다 */
export const UNAVAILABLE_GATE: RevealGate = {
  available: false,
  reauth: () => Promise.resolve(UNAVAILABLE_REAUTH),
};

/** 재인증을 먼저 부르고, 통과했을 때만 값 경로를 부른다. 재인증이 실패하면 값 경로는 건드리지 않는다 */
export function gatedRevealPort(gate: RevealGate, value: SecretRevealPort): SecretRevealPort {
  return {
    async reveal(name) {
      const reauthed = await gate.reauth(name);
      if (!reauthed.ok) return reauthed;
      return value.reveal(name);
    },
  };
}
