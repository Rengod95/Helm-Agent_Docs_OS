import { describe, expect, test } from "bun:test";
import { CANVAS_BLEED, PANEL_END } from "../src/views/workbench/detail-rail.ts";

// 상세의 오른쪽 여백(AGE-77 S-09 바)은 상세가 시스템 머리줄을 쓰게 되어 셸 규칙이 준다(plugHead).
// 구성 탭 캔버스와 떠 있는 설명 판은 그 규칙과 같은 토큰(막대 자리 `--stage-rail`, `space-3`, 본문 좌우 `space-8`)을 쓴다.

describe("detail rail tokens (plugHead)", () => {
  test("the canvas bleeds out by the detail side margins: space-8 on the start, the rail gap or space-8 on the end", () => {
    expect(CANVAS_BLEED).toBe(
      "-ms-8 -me-[max(var(--cs-space-8),calc(var(--stage-rail,0px)+var(--cs-space-3)))]",
    );
  });

  test("the floating panel clears the stage rail gap and the space-3 token, the same tokens the shell uses", () => {
    expect(PANEL_END).toBe("end-[calc(var(--stage-rail,0px)+var(--cs-space-3))]");
  });
});
