import type { Area } from "../state/shell/index.ts";
import type { Screen } from "../state/ui/index.ts";

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
