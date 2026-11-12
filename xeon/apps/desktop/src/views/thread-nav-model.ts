import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { Area } from "../state/shell/index.ts";
import type { Screen } from "../state/ui/index.ts";
import { rowResumable } from "./resume-band-model.ts";

/**
 * 사이드바 행 오른쪽 짧은 표식의 종류. 한 행에는 하나만 보이고, 위에서 먼저 정한 것이 이긴다(DP-104 [결정: 2026-11-11 사용자]):
 * 승인 수(답이 필요), 이어서 실행, 보내지 못함, 예약, 원격, 닫힘, 하위, 갈라냄. 실행 중은 행 머리의 상태 표식이라 여기 들지 않는다.
 */
type RowBadge =
  | "resumable"
  | "approvals"
  | "schedule"
  | "remote"
  | "closed"
  | "unsent"
  | "sub"
  | "forked";

/**
 * 행 오른쪽 표식이 무엇인가. 답이 필요한 승인이 가장 앞이고, 예약이 시작한 대화(`origin.kind === "schedule"`)는 닫혀 있어도 "예약"이다.
 * 아무 표식도 없으면 null이다
 */
export function rowBadgeOf(
  thread: ThreadSummary,
  approvals: number,
  child: boolean,
  unsent = false,
): RowBadge | null {
  if (approvals > 0) return "approvals";
  if (rowResumable(thread, approvals)) return "resumable";
  // 첫 답이 오기 전에 실패한 대화는 제목이 사용자 말 그대로라 이 표시로 구분한다
  if (unsent) return "unsent";
  if (thread.origin?.kind === "schedule") return "schedule";
  if (thread.origin?.kind === "remote") return "remote";
  if (thread.status === "closed") return "closed";
  if (child) return "sub";
  // 분기한 대화는 원본과 제목이 같아 구분이 안 된다. 다른 표식이 없을 때 "갈라냄" 표식을 보인다
  return thread.forkedFrom === null ? null : "forked";
}

/**
 * 행의 글(DP-126 [결정: 2026-11-11 사용자]). 제목이 있으면 제목을 그대로 쓴다. 제목이 없으면 첫 입력 미리보기(`preview`)를 제목 자리에
 * 흐리게 쓴다. 미리보기도 없으면 text가 null이고 호출자가 "제목 없음"을 흐리게 쓴다. dim은 제목이 없는 행이다
 */
export function rowLabelOf(thread: Pick<ThreadSummary, "title" | "preview">): {
  readonly text: string | null;
  readonly dim: boolean;
} {
  if (thread.title !== null) return { text: thread.title, dim: false };
  return { text: thread.preview ?? null, dim: true };
}

/** 제목으로 거르기(대화 목록 맨 위 찾기 칸). 앞뒤 공백을 지운 글이 비면 모두, 아니면 대소문자 없이 제목에 든 대화만. 제목 없는 대화는 빠진다 */
export function threadMatches(thread: Pick<ThreadSummary, "title">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return thread.title !== null && thread.title.toLowerCase().includes(needle);
}

/** 상대 시각의 단위와 수. 1분 미만은 "방금", 7일 이상은 날짜(월·일)다 */
export type RelativeTime =
  | { readonly unit: "now" }
  | { readonly unit: "minutes" | "hours" | "days"; readonly count: number }
  | { readonly unit: "date"; readonly month: number; readonly day: number };

export function relativeTimeOf(iso: string, now: number): RelativeTime {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return { unit: "now" };
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return { unit: "now" };
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: "days", count: days };
  const date = new Date(at);
  return { unit: "date", month: date.getMonth() + 1, day: date.getDate() };
}

/**
 * 사이드바의 대화 행을 눌렀을 때 대화 화면으로 가야 하는가(rtE R-5). 설정이 열려 있거나, 대화 영역의 화면 자리가
 * 대화가 아닌 전체 쪽(받은 요청, 예약, 플러그인 화면 등)이면 간다. 작업대 영역에서는 가지 않는다(대화 목록은 대화 영역에만 있다).
 */
export function rowOpensChat(now: {
  readonly screen: Screen;
  readonly area: Area;
  readonly chatPlaceScreen: string;
}): boolean {
  if (now.screen !== "chat") return true;
  return now.area === "chat" && now.chatPlaceScreen !== "chat";
}
