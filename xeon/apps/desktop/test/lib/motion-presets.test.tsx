import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  Collapse,
  HeightGlide,
  PRESETS,
  Presence,
  PresenceItem,
  PresenceList,
  ROW_ENTER,
  SwapFade,
  ScreenSwap,
  cssBezier,
  flipDeltaOf,
  handoffHeight,
  handoffHeightOf,
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

describe("줄 들어옴 값(dzM2 시안 §2, DP-117)", () => {
  const tracks = Object.entries(ROW_ENTER).flatMap(([kind, list]) =>
    list.map((track) => ({ kind, track })),
  );

  test("곡선 조절점이 0~1 안이라 넘침이 없다", () => {
    const out = tracks.filter(({ track }) =>
      [track.easing[1], track.easing[3]].some((y) => y < 0 || y > 1),
    );
    expect(out.map(({ kind }) => kind)).toEqual([]);
  });

  test("끝 값은 제자리다: 투명도 1, 오름 0, 흐림 0, 선은 다 그어진다(빛 줄기만 0으로 사라진다)", () => {
    const ends = tracks
      .filter(({ track }) => track.child !== ".convo-compact-sweep")
      .map(({ track }) => track.keyframes.at(-1));
    const wrong = ends.filter(
      (end) =>
        end === undefined ||
        (end.opacity !== undefined && end.opacity !== 1) ||
        (end.transform !== undefined &&
          !["translateY(0px)", "scaleX(1)", "scaleY(1)"].includes(String(end.transform))) ||
        (end.filter !== undefined && end.filter !== "blur(0px)"),
    );
    expect(wrong).toEqual([]);
    const sweep = ROW_ENTER.compaction.find((track) => track.child === ".convo-compact-sweep");
    expect(sweep?.keyframes.at(-1)?.opacity).toBe(0);
  });

  test("들어옴은 300ms 안에 끝난다(요약 빛 줄기 제외)", () => {
    const slow = tracks.filter(
      ({ track }) =>
        track.child !== ".convo-compact-sweep" && track.duration + (track.delay ?? 0) > 300,
    );
    expect(slow.map(({ kind }) => kind)).toEqual([]);
  });

  test("답 들어옴은 6px 오름 + 흐림 4에서 시작한다", () => {
    expect(ROW_ENTER.reply[0]?.keyframes[0]).toEqual({
      opacity: 0,
      transform: "translateY(6px)",
      filter: "blur(4px)",
    });
  });
});

describe("FLIP 변화량", () => {
  test("모르는 키는 삽입, 0.5px 미만은 그대로, 나머지는 옛 자리와의 차", () => {
    const before = new Map([
      ["a", 0],
      ["b", 40],
    ]);
    expect(flipDeltaOf(before, "z", 10)).toEqual({ kind: "enter" });
    expect(flipDeltaOf(before, "a", 0.3)).toBe(null);
    expect(flipDeltaOf(before, "b", 0)).toEqual({ kind: "move", dy: 40 });
  });
});

describe("줄 넘겨받기와 높이 잇기(dzM2 시안 §4, DP-140)", () => {
  test("떠난 줄의 높이는 같은 틱 안에서만 읽힌다", async () => {
    handoffHeight("itm-handoff-1", 121);
    expect(handoffHeightOf("itm-handoff-1")).toBe(121);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(handoffHeightOf("itm-handoff-1")).toBeUndefined();
  });

  test("넘긴 적 없는 키는 높이가 없다", () => {
    expect(handoffHeightOf("itm-never")).toBeUndefined();
  });

  test("HeightGlide는 바깥 상자와 안쪽 내용 상자로 그리고, 넘겨받는 키는 그릴 때 모양을 바꾸지 않는다", () => {
    expect(renderToString(<HeightGlide className="x">내용</HeightGlide>)).toBe(
      '<div class="x"><div>내용</div></div>',
    );
    expect(
      renderToString(
        <HeightGlide className="x" handoff="itm-handoff-2">
          내용
        </HeightGlide>,
      ),
    ).toBe('<div class="x"><div>내용</div></div>');
  });
});
