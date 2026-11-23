import type { WorkFacts } from "./review-facts.ts";

// 리뷰 상세 "작동 방식"의 "앱" 줄 값. 플러그인이 낸 화면 가운데 자리가 전체 화면(page)이나 대화 옆 패널(panel)인 것만 본다.
// 카드, 상태 표시 같은 나머지 자리는 이 줄에 싣지 않는다. 자체 코드(app)의 까닭과 다리 권한은 그대로 싣고, 기본 부품(native)은 비운다.

type ScreenFact = WorkFacts["screens"][number];

export interface AppRow {
  readonly id: string;
  readonly where: "page" | "panel";
  readonly mode: "native" | "app" | null;
  readonly reason: string | null;
  readonly capabilities: readonly string[];
}

/** 화면 줄 가운데 전체 화면과 대화 옆 패널만 받은 순서대로 남긴다. 까닭은 앞뒤 공백을 빼고 비면 null이다 */
export function appRowsOf(screens: readonly ScreenFact[]): readonly AppRow[] {
  return screens.flatMap((screen): AppRow[] => {
    const where =
      screen.placement === "page" || screen.placement === "panel" ? screen.placement : null;
    if (where === null) return [];
    if (screen.mode === "native") {
      return [{ id: screen.id, where, mode: "native", reason: null, capabilities: [] }];
    }
    const reason = screen.reason?.trim() ?? "";
    return [
      {
        id: screen.id,
        where,
        mode: screen.mode,
        reason: reason === "" ? null : reason,
        capabilities: [...screen.capabilities],
      },
    ];
  });
}
