import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  WIRE_ERRORS,
  type ExtListEntry,
  type ThreadOverlayMark,
  type ThreadProjectRef,
  type ThreadSetProfileParams,
  type ThreadSummary,
} from "@fresnel/contracts/wire";
import { isOn } from "./model.ts";

// 검사 탭의 "이 대화에서" 구역과 대화 영역 오른쪽 "플러그인" 탭의 순수 모델. M5c-1 이후 켜짐은 대화가 참조하는 프로필과
// 공통 묶음에서 계산되므로(docs/xeon/review/m5/profile-project-loader.md §3.4) 대화별 켜기·끄기 스위치는 없다.
// 여기는 대화 쪽 값을 읽는 함수(켜짐, 기다리는 값, 프로필 참조)와 프로필을 이 대화에 쓰는 요청 모양만 둔다.

/** 이 대화에서의 켜짐. 대화가 덮어 쓴 상태(`registration`)가 있으면 그것, 없으면 전역 상태다 */
export function threadOnOf(entry: ExtListEntry): boolean {
  return isOn({ ...entry, status: entry.registration ?? entry.status });
}

/**
 * 다음 단계 경계를 기다리는 중이면 기다리는 켜짐 값(켜는 중 true, 끄는 중 false), 아니면 null.
 * 호스트는 경계 전까지 바뀐 값을 `enabling`·`disabling`으로 보인다(`threadStatus`).
 */
export function threadPendingOf(entry: ExtListEntry): boolean | null {
  const status = entry.registration ?? entry.status;
  if (status === "enabling") return true;
  if (status === "disabling") return false;
  return null;
}

/** 대화가 참조하는 프로필 표지. `ThreadSummary`의 `profileId`, `project`, `overlay`를 한 값으로 모은다 */
export interface ThreadProfileRef {
  /** 참조하는 프로필 id. 대화 요약이 싣지 않은 옛 대화는 `default`다 */
  readonly profileId: string;
  /** 대화 폴더가 속한 프로젝트. 기본 폴더 대화는 null */
  readonly project: ThreadProjectRef | null;
  /** 이 대화에 얹힌 덧씌우기 표지 */
  readonly overlay: readonly ThreadOverlayMark[];
}

export function threadProfileRefOf(thread: ThreadSummary): ThreadProfileRef {
  return {
    profileId: thread.profileId ?? "default",
    project: thread.project ?? null,
    overlay: thread.overlay ?? [],
  };
}

/** 이 대화에 프로필을 쓰는 요청(`thread.setProfile`). 프로필 저장 없이 참조만 바꾼다 */
export function threadSetProfileRequestOf(
  profileId: string,
  threadId: ThreadId,
): ThreadSetProfileParams {
  return { threadId, profileId };
}

/** 프로필 쓰기 실패를 화면이 구분하는 갈래. 나머지 실패(연결, 알 수 없는 오류)는 `failed`다 */
export type ProfileFailure = "not_found" | "trust_required" | "apply_partial" | "limit" | "failed";

/** wire 오류 코드(`profile.*`)를 실패 갈래로 바꾼다. 코드가 없거나 모르면 `failed`다 */
export function profileFailureOf(code: number | null): ProfileFailure {
  if (code === WIRE_ERRORS["profile.notFound"].code) return "not_found";
  if (code === WIRE_ERRORS["profile.trustRequired"].code) return "trust_required";
  if (code === WIRE_ERRORS["profile.applyPartial"].code) return "apply_partial";
  if (code === WIRE_ERRORS["profile.limit"].code) return "limit";
  return "failed";
}
