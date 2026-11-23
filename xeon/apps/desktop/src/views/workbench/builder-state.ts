// 플러그인 빌더(`authoring` 플러그인)의 상태를 "새로 만들기" 입구의 모양 하나로 정한다(`builder-entry.tsx`).
// 크래프트에서 빌더는 기본 기능이라 늘 켜 둔다(2026-11-18 결정, AGE-51/AGE-60). 전역 켜기 경로는 없고, 관리자 잠금(managed)만 입구를 바꾼다.
// 옛 구성 화면의 코드 보기(`compose-code.tsx`)에 있던 것을 옮겼다(AGE-69).
import { lockOf, type TabLink } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";

/** 플러그인 빌더의 이름(§6.29) */
export const AUTHORING_EXT = "authoring";

/** 입구의 모양: 만들기, 관리자가 꺼 둠(잠김), 목록에 없음, 연결 전(문장만) */
export type ForwardState =
  | { readonly kind: "make" }
  | { readonly kind: "missing" }
  | { readonly kind: "locked"; readonly lock: "managed" }
  | { readonly kind: "offline" };

/**
 * 엔진에 연결되어 있지 않으면 문장만. 목록에 없으면 만들 수 없다.
 * 관리자 잠금(managed)이면 관리자가 꺼 둔 것이라 그 사실을 보인다. 그 밖의 상태(켜짐, 꺼짐, 켜는 중, 다른 잠금)는 만들기다.
 */
export function forwardStateOf(link: TabLink, entry: ExtListEntry | undefined): ForwardState {
  if (link !== "live") return { kind: "offline" };
  if (entry === undefined) return { kind: "missing" };
  const lock = lockOf(entry);
  return lock === "managed" ? { kind: "locked", lock } : { kind: "make" };
}
