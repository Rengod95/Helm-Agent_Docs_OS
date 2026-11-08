import { assertNever } from "@fresnel/contracts";
import type { TranscriptDetail } from "./transcript-detail.ts";

// 대화 기록의 생각과 도구 줄을 표시 정도(`TranscriptDetail`)에 따라 어떻게 그릴지 정한다. 그림 부품(`item-view.tsx`)은 이 판정을 따르기만 한다.
//   full: 생각을 펼치고 모든 도구 줄을 보인다.
//   summary: 생각을 한 줄 토글로 접고, 도구 줄을 접는다(실패 줄은 펼친다).
//   hidden: 생각을 그리지 않고, 성공한 도구 줄과 그 부속(출처 칩, 하위 에이전트 줄, 결과 줄)을 그리지 않는다. 실패·실행 중·승인 대기 줄은 보인다.

/** 생각 블록. "open"은 펼쳐 두고, "closed"는 한 줄 토글로 접고, "none"은 그리지 않는다 */
export type ThinkingMode = "open" | "closed" | "none";

/** 도구 줄의 상태(`ToolRow`의 status) */
export type ToolRowStatus = "done" | "failed" | "running";

/** 도구 줄. "hidden"은 그리지 않고, "collapsed"는 접어 두고, "default"는 행의 기존 규칙을 따른다 */
export type ToolRowMode = "hidden" | "collapsed" | "default";

export function thinkingModeOf(detail: TranscriptDetail): ThinkingMode {
  switch (detail) {
    case "full":
      return "open";
    case "summary":
      return "closed";
    case "hidden":
      return "none";
    default:
      return assertNever(detail, "transcript detail");
  }
}

/** 도구 줄을 어떻게 그리는가. 성공한 줄만 숨긴다. 요약에서는 실패 줄만 기존처럼 펼쳐 둔다 */
export function toolRowModeOf(detail: TranscriptDetail, status: ToolRowStatus): ToolRowMode {
  if (detail === "hidden" && status === "done") return "hidden";
  if (detail === "summary" && status !== "failed") return "collapsed";
  return "default";
}

/** 처음 펼쳐 둘지. 기본 규칙은 실패한 줄과 하위 에이전트의 보고를 펼치는 것이고, 접기 모드에서는 펼치지 않는다 */
export function toolRowOpenOf(
  mode: ToolRowMode,
  status: ToolRowStatus,
  openWhenDone: boolean,
): boolean {
  return mode === "default" && (status === "failed" || openWhenDone);
}
