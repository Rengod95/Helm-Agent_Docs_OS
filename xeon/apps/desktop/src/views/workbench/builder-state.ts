// 플러그인 빌더(`authoring` 플러그인)의 상태를 "새로 만들기" 입구의 모양 하나로 정한다(`builder-entry.tsx`).
// 옛 구성 화면의 코드 보기(`compose-code.tsx`)에 있던 것을 옮겼다(AGE-69).
import { lockOf, type TabLink, type ToggleLock } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";

/** 플러그인 빌더의 이름(§6.29). 켜고 끄기는 이 플러그인의 on/off다 */
export const AUTHORING_EXT = "authoring";

/** 목록에 든 플러그인 빌더의 값. 목록에 없으면 null로 넘긴다(`builderOf`) */
export interface BuilderView {
  readonly status: ExtListEntry["status"];
  /** 켜고 끄기를 막는 까닭(안전 모드, 관리자 값). 막지 않으면 null */
  readonly lock: ToggleLock;
}

/** 목록 한 줄을 화면 값으로 옮긴다. 목록에 플러그인 빌더가 없으면 null이다 */
export function builderOf(entry: ExtListEntry | undefined): BuilderView | null {
  return entry === undefined ? null : { status: entry.status, lock: lockOf(entry) };
}

/** 입구의 모양: 만들기, 켜기, 켤 수 없음(목록에 없음 또는 잠김), 연결 전(문장만) */
export type ForwardState =
  | { readonly kind: "make" }
  | { readonly kind: "enable" }
  | { readonly kind: "missing" }
  | { readonly kind: "locked"; readonly lock: Exclude<ToggleLock, null> }
  | { readonly kind: "offline" };

/**
 * 엔진에 연결되어 있지 않으면 문장만. 플러그인 빌더가 켜졌으면 만들기다(잠겨 있어도 만들기는 된다).
 * 목록에 없으면 켤 수 없고, 꺼져 있고 잠겨 있지 않으면 켜기, 잠겨 있으면 잠긴 까닭을 보인다.
 */
export function forwardStateOf(link: TabLink, builder: BuilderView | null): ForwardState {
  if (link !== "live") return { kind: "offline" };
  if (builder === null) return { kind: "missing" };
  if (builder.status === "enabled") return { kind: "make" };
  return builder.lock === null ? { kind: "enable" } : { kind: "locked", lock: builder.lock };
}
