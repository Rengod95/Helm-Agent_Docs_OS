import type { JsonValue } from "@fresnel/contracts/conversation";

// 훅이 막은 도구 호출의 화면 모양(L1.tools §5 사례 3). 엔진은 그 결과의 `details`에 `denied_by_extension`을 싣는다.
// `blocked`는 훅이 결정으로 막은 것이고 `threw`는 훅이 오류를 냈거나 디스패처가 실패한 것이다(확장 이름이 없을 수 있다).
// 모델에 가는 본문은 엔진이 따로 준다. 이 모델은 화면용 details만 읽는다.

const HOOK_DENIAL_CODE = "denied_by_extension";

export type HookDenialView =
  | { readonly outcome: "blocked"; readonly extension: string | null; readonly reason: string }
  | { readonly outcome: "threw"; readonly extension: string | null };

function isObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 도구 결과의 details를 훅 거부 모양으로 읽는다. 훅 거부가 아니거나 값이 빠졌으면 null이다 */
export function hookDenialOf(details: JsonValue | undefined): HookDenialView | null {
  if (!isObject(details) || details["code"] !== HOOK_DENIAL_CODE) return null;
  const extension = details["extension"];
  const name = typeof extension === "string" ? extension : null;
  const outcome = details["outcome"];
  if (outcome === "threw") return { outcome: "threw", extension: name };
  if (outcome !== "blocked") return null;
  const reason = details["reason"];
  return typeof reason === "string" ? { outcome: "blocked", extension: name, reason } : null;
}

const USER_DENIAL_CODE = "denied_by_user";

/** 도구 결과의 details가 사용자 거부인가. 엔진은 사용자가 거부했을 때 `details.code`에 `denied_by_user`를 싣는다(글에는 코드가 없다) */
export function isUserDenial(details: JsonValue | undefined): boolean {
  return isObject(details) && details["code"] === USER_DENIAL_CODE;
}
