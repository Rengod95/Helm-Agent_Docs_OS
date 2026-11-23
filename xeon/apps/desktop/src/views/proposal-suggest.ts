import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useExtListing } from "./plugin/ext-listing.ts";

// 제안(화면 id `proposals`)은 `suggest` 플러그인이 켜져 있을 때만 보인다. 호스트 계약: 플러그인이 꺼져 있거나 프로필에서 빠졌거나
// 설치되지 않았으면 `proposal.list`는 빈 목록을, `proposal.decide`는 `unavailable`을 돌려준다.
// 켜짐은 `ext.list`의 항목 하나에서 읽는다. 연결이 없거나 아직 못 읽었으면 `unknown`이고, 그동안 내비 항목은 숨긴다(깜빡임 방지).

/** 제안을 내는 플러그인의 이름(호스트가 기본 프로필에 넣어 설치한다) */
export const SUGGEST_PLUGIN_NAME = "suggest";

/** 제안 화면의 자리 id(`ScreenDef.id`, `NAV_BY_AREA`의 항목 id와 같다) */
const PROPOSALS_SCREEN_ID = "proposals";

/** 제안 플러그인의 상태. `unknown`은 `ext.list`를 아직 못 읽었거나 연결이 없는 것이다 */
export type SuggestState = "on" | "off" | "unknown";

/**
 * `ext.list` 행들에서 제안 플러그인의 상태를 가른다.
 * 켜짐은 플러그인 목록이 쓰는 뜻과 같다(`isOn`: 켜짐과 켜는 중). 안전 모드에서 실리지 않았으면 꺼짐이다.
 * 행이 없으면(빠짐, 설치 안 됨) 꺼짐이다. 목록이 없으면(읽기 전, 연결 없음) `unknown`이다
 */
export function suggestStateOf(
  entries: readonly Pick<ExtListEntry, "name" | "status" | "safeModeExcluded">[] | undefined,
): SuggestState {
  if (entries === undefined) return "unknown";
  const entry = entries.find((item) => item.name === SUGGEST_PLUGIN_NAME);
  if (entry === undefined) return "off";
  const running = entry.status === "enabled" || entry.status === "enabling";
  return running && entry.safeModeExcluded === null ? "on" : "off";
}

/** 제안 플러그인의 지금 상태. `ext.list` 저장소를 함께 쓴다(구독자가 있는 동안 목록 알림마다 다시 읽는다) */
export function useSuggestState(): SuggestState {
  return suggestStateOf(useExtListing());
}

/** 화면 id가 지금 보여도 되는가. 제안 화면은 제안 플러그인이 켜져 있을 때만이고, 나머지 화면은 늘 보인다 */
export function screenShownOf(screen: string, suggest: SuggestState): boolean {
  return screen !== PROPOSALS_SCREEN_ID || suggest === "on";
}
