import { describe, expect, test } from "bun:test";
import { DETAIL_RAIL_INSET } from "../src/views/workbench/detail-rail.ts";

// 상세 칸의 오른쪽 여백(AGE-77 S-09 바): 셸 규칙과 같은 토큰(막대 자리 `--stage-rail`과 `space-3`)을 쓴다.

describe("detail rail inset", () => {
  test("clears the stage rail gap and the space-3 token, the same tokens the shell uses", () => {
    expect(DETAIL_RAIL_INSET).toBe("pe-[calc(var(--stage-rail,0px)+var(--cs-space-3))]");
  });
});
