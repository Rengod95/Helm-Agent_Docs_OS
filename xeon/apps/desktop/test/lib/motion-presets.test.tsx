import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  Collapse,
  PRESETS,
  Presence,
  PresenceItem,
  PresenceList,
  SwapFade,
  ScreenSwap,
  cssBezier,
  isMotionReduced,
  motionReducedOf,
  variantsOf,
} from "../../src/lib/motion-presets.tsx";

// 모션 프리셋(DP-105, DP-108). 값과 판단은 순수하게, 부품은 서버 렌더로 본다(DOM이 없다).

describe("움직임 줄이기 판단", () => {
  test("앱 설정이나 OS 설정 중 하나라도 켜지면 줄인다", () => {
    expect(motionReducedOf(undefined, false)).toBe(false);
    expect(motionReducedOf("reduce", false)).toBe(true);
    expect(motionReducedOf(undefined, true)).toBe(true);
    expect(motionReducedOf("system", false)).toBe(false);
  });

  test("창이 없으면(서버 렌더) 줄이지 않는다", () => {
    expect(isMotionReduced()).toBe(false);
  });
});

describe("variants", () => {
  test("블록은 6px 아래 흐림 4px에서 들어와 2px 위로 사라진다", () => {
    expect(PRESETS.block["hidden"]).toEqual({ opacity: 0, y: 6, filter: "blur(4px)" });
    expect(PRESETS.block["gone"]).toMatchObject({ opacity: 0, y: -2 });
    expect(PRESETS.block["shown"]).toMatchObject({ opacity: 1, y: 0, filter: "blur(0px)" });
  });

  test("들어옴은 0.2초 들어옴 곡선, 나감은 0.12초 나감 곡선이다", () => {
    expect(PRESETS.block["shown"]).toMatchObject({
      transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
    });
    expect(PRESETS.block["gone"]).toMatchObject({
      transition: { duration: 0.12, ease: [0.4, 0, 1, 1] },
    });
  });

  test("떠 있는 면은 0.98보다 작게 줄지 않는다", () => {
    expect(PRESETS.pop["hidden"]).toMatchObject({ scale: 0.98 });
    expect(PRESETS.pop["gone"]).toMatchObject({ scale: 0.98 });
  });

  test("줄이면 어느 프리셋이든 투명도만 남는다", () => {
    for (const name of ["block", "band", "pop", "panelStart"] as const) {
      expect(variantsOf(name, true)["hidden"]).toEqual({ opacity: 0 });
    }
    expect(variantsOf("panelStart", false)["hidden"]).toEqual({ x: "-100%" });
  });

  test("곡선 글자는 CSS cubic-bezier다", () => {
    expect(cssBezier([0.22, 1, 0.36, 1])).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
  });
});

describe("부품", () => {
  test("Presence는 보일 때만 내용을 그린다", () => {
    expect(renderToString(<Presence show>안녕</Presence>)).toContain("안녕");
    expect(renderToString(<Presence show={false}>안녕</Presence>)).not.toContain("안녕");
  });

  test("Collapse는 열렸을 때만 내용을 그린다", () => {
    expect(renderToString(<Collapse open>본문</Collapse>)).toContain("본문");
    expect(renderToString(<Collapse open={false}>본문</Collapse>)).not.toContain("본문");
  });

  test("ScreenSwap은 내용을 받은 클래스의 판에 그린다", () => {
    const html = renderToString(
      <ScreenSwap swapKey="a" className="flex">
        구역
      </ScreenSwap>,
    );
    expect(html).toBe('<div class="flex">구역</div>');
  });

  test("SwapFade는 지금 키의 내용 하나만 그린다(줄 안이면 span)", () => {
    const html = renderToString(
      <SwapFade swapKey="run" inline>
        실행 중
      </SwapFade>,
    );
    expect(html).toContain("<span");
    expect(html).toContain("실행 중");
  });

  test("PresenceList는 처음 그린 항목을 움직이지 않고 모두 그린다", () => {
    const html = renderToString(
      <PresenceList>
        <PresenceItem key="a">첫째</PresenceItem>
        <PresenceItem key="b">둘째</PresenceItem>
      </PresenceList>,
    );
    expect(html).toContain("첫째");
    expect(html).toContain("둘째");
    expect(html).not.toContain("opacity:0");
  });
});
