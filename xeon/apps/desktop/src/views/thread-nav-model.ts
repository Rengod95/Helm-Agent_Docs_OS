import type { ThreadSummary } from "@fresnel/contracts/wire";
import type { Area } from "../state/shell/index.ts";
import type { Screen } from "../state/ui/index.ts";
import { rowResumable } from "./resume-band-model.ts";

/**
 * 사이드바 행 오른쪽 짧은 글자의 종류. 한 행에는 하나만 보이고, 위에서 먼저 정한 것이 이긴다: 이어서 실행, 승인 수, 예약, 닫힘, 하위.
 * 실행 중은 행 머리의 상태 표식이라 여기 들지 않는다.
 */
type RowBadge = "resumable" | "approvals" | "schedule" | "closed" | "sub";

/**
 * 행 오른쪽 글자가 무엇인가. 예약이 시작한 대화(`origin.kind === "schedule"`)는 닫혀 있어도 "예약"이 보인다(닫힘보다 앞).
 * 아무 표식도 없으면 null이다
 */
export function rowBadgeOf(
  thread: ThreadSummary,
  approvals: number,
  child: boolean,
): RowBadge | null {
  if (rowResumable(thread, approvals)) return "resumable";
  if (approvals > 0) return "approvals";
  if (thread.origin?.kind === "schedule") return "schedule";
  if (thread.status === "closed") return "closed";
  return child ? "sub" : null;
}

/**
 * 사이드바의 대화 행을 눌렀을 때 대화 화면으로 가야 하는가(rtE R-5). 설정이 열려 있거나, 대화 영역의 화면 자리가
 * 대화가 아닌 전체 쪽(받은 요청, 예약, 플러그인 화면 등)이면 간다. 작업대 영역에서는 맥락만 따라가므로 가지 않는다.
 */
export function rowOpensChat(now: {
  readonly screen: Screen;
  readonly area: Area;
  readonly chatPlaceScreen: string;
}): boolean {
  if (now.screen !== "chat") return true;
  return now.area === "chat" && now.chatPlaceScreen !== "chat";
}
