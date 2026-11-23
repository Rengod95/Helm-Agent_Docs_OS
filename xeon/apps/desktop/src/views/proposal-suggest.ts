import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useProfiles, type ProfilesRead } from "./convo/profile-listing.ts";
import { useExtListing } from "./plugin/ext-listing.ts";

// 제안(화면 id `proposals`)은 `suggest` 플러그인이 켜져 있을 때만 보인다. 호스트 계약(HS-79 (5)): 등록이 `enabled`이고 어느 프로필
// (전역 공통 묶음 포함)에든 들어 있어야 `proposal.list`가 지식 대기열을 열고, 아니면 빈 목록과 `unavailable`, `proposal.decide`는 `unavailable`이다.
// 켜짐은 두 원천을 합친다: `ext.list`의 항목(상태와 안전 모드)과 `profile.list`의 프로필 목록(공통 묶음 포함).
// 어느 한쪽이라도 아직 못 읽었으면 `unknown`이고, 그동안 내비 항목은 숨긴다(깜빡임 방지). 확장 목록에서 이미 꺼졌으면 프로필과 무관하게 꺼짐이다.

/** 제안을 내는 플러그인의 이름(호스트가 기본 프로필에 넣어 설치한다) */
export const SUGGEST_PLUGIN_NAME = "suggest";

/** 제안 화면의 자리 id(`ScreenDef.id`, `NAV_BY_AREA`의 항목 id와 같다) */
const PROPOSALS_SCREEN_ID = "proposals";

/** 제안 플러그인의 상태. `unknown`은 `ext.list`를 아직 못 읽었거나 연결이 없는 것이다 */
export type SuggestState = "on" | "off" | "unknown";

/**
 * 제안 플러그인이 프로필 가운데 어디에든 들었는가(전역 공통 묶음 포함). 프로필 목록을 아직 못 읽었거나 읽지 못했으면 `undefined`다.
 */
export function suggestInProfilesOf(read: ProfilesRead): boolean | undefined {
  if (read.kind !== "ready") return undefined;
  return (
    listsSuggest(read.common.plugins) ||
    read.profiles.some((profile) => listsSuggest(profile.plugins))
  );
}

/** 플러그인 목록(프로필 하나 또는 공통 묶음)에 제안 플러그인이 든 줄이 있는가 */
function listsSuggest(plugins: readonly { readonly name: string }[]): boolean {
  return plugins.some((ref) => ref.name === SUGGEST_PLUGIN_NAME);
}

/**
 * 제안 플러그인의 상태를 가른다. `entries`는 `ext.list` 행들, `inProfiles`는 `suggestInProfilesOf`의 값이다.
 * 켜짐은 플러그인 목록이 쓰는 뜻과 같다(`enabled`와 `enabling`, 안전 모드에서 빠지지 않음). 행이 없으면(빠짐, 설치 안 됨) 꺼짐이다.
 * 확장 목록에서 꺼졌으면 프로필과 무관하게 꺼짐이다. 켜져 있는데 프로필을 아직 못 읽었으면(또는 읽지 못했으면) `unknown`이다.
 * 목록이 없으면(읽기 전, 연결 없음) `unknown`이다
 */
export function suggestStateOf(
  entries: readonly Pick<ExtListEntry, "name" | "status" | "safeModeExcluded">[] | undefined,
  inProfiles: boolean | undefined,
): SuggestState {
  if (entries === undefined) return "unknown";
  const entry = entries.find((item) => item.name === SUGGEST_PLUGIN_NAME);
  if (entry === undefined) return "off";
  const running = entry.status === "enabled" || entry.status === "enabling";
  if (!running || entry.safeModeExcluded !== null) return "off";
  if (inProfiles === undefined) return "unknown";
  return inProfiles ? "on" : "off";
}

/** 제안 플러그인의 지금 상태. `ext.list`와 `profile.list` 저장소를 함께 쓴다(구독자가 있는 동안 두 목록의 알림마다 다시 읽는다) */
export function useSuggestState(): SuggestState {
  return suggestStateOf(useExtListing(), suggestInProfilesOf(useProfiles()));
}

/** 화면 id가 지금 보여도 되는가. 제안 화면은 제안 플러그인이 켜져 있을 때만이고, 나머지 화면은 늘 보인다 */
export function screenShownOf(screen: string, suggest: SuggestState): boolean {
  return screen !== PROPOSALS_SCREEN_ID || suggest === "on";
}

/** 머리 줄 고정 탭 후보에서 꺼진 제안 플러그인을 뺀다(내비와 같은 판정) */
export function tabRowsShownOf<T extends { readonly name: string }>(
  rows: readonly T[],
  suggest: SuggestState,
): readonly T[] {
  return suggest === "on" ? rows : rows.filter((row) => row.name !== SUGGEST_PLUGIN_NAME);
}
