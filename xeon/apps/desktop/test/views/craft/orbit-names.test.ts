import { describe, expect, test } from "bun:test";
import type { CanvasHealth, CanvasPlugin } from "@fresnel/client/workbench/canvas";
import { isLead, stateText } from "../../../src/views/craft/orbit-names.ts";

function plug(extra: Partial<CanvasPlugin> = {}): CanvasPlugin {
  return {
    id: "x",
    name: "x",
    layer: "L3",
    origin: "builtin",
    hooks: [],
    provides: [],
    pieces: [],
    on: true,
    ...extra,
  };
}

const failing: CanvasHealth = { fails: 2, text: "t", at: "14:01", limit: 5, autoOff: false };
const autoOff: CanvasHealth = { ...failing, fails: 5, autoOff: true };

describe("지도 점의 상태", () => {
  test("주도를 선언한 켜진 점만 주도다", () => {
    expect(isLead(plug({ drives: true }))).toBe(true);
    expect(isLead(plug({ drives: true, on: false }))).toBe(false);
    expect(isLead(plug())).toBe(false);
    expect(isLead(plug({ drives: true, health: failing }))).toBe(false);
  });

  test("상태 글은 자동 꺼짐, 실패, 주도, 켜짐, 꺼짐 순으로 정해진다", () => {
    expect(stateText(plug({ drives: true, health: autoOff }))).toBe("자동으로 꺼짐");
    expect(stateText(plug({ drives: true, health: failing }))).toBe("실패");
    expect(stateText(plug({ drives: true }))).toBe("주도");
    expect(stateText(plug())).toBe("켜짐");
    expect(stateText(plug({ on: false }))).toBe("꺼짐");
  });
});
