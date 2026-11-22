// cv6 "G5" 시안의 순수 값: 참고 그림의 점 바닥(엇갈린 격자, 100%에서 칸 8.66, 확대에 따라 두 배·반), 화면 점 층을 옮기는 자리,
// 처음 여는 시점(루프 전체 또는 왼쪽 끝), 참고 그림 크기의 판(316×289)과 탭 자리까지 넣은 판끼리 겹치지 않는 배치,
// 모든 선이 있는 소켓으로 들어가는가. 값은 공용 표본(`shared-sample.ts`)과 cv6의 합성 Hook 표(`sample-ext.ts`)에서 읽는다.
import { describe, expect, test } from "bun:test";
import {
  dotGrid,
  dotShift,
  OPEN_ZOOM_MAX,
  OPEN_ZOOM_MIN,
  openViewOf,
} from "../../../src/views/craft/canvas/cv6/floor.ts";
import {
  layoutProfile,
  PLATE_H,
  RAIL_HALF,
  TAB_ROOM,
  type Rect,
} from "../../../src/views/craft/canvas/cv6/layout.ts";
import { attachProfile, profileFromSample } from "../../../src/views/craft/canvas/cv6/model.ts";

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** 판 위로 탭이 설 자리까지 넣은 상자 */
const withTab = (r: Rect): Rect => ({ x: r.x, y: r.y - TAB_ROOM, w: r.w, h: r.h + TAB_ROOM });

/** 배율 z에서 점 칸(캔버스 단위, 화면 px)을 소수 둘째 자리로 */
const at = (z: number): [number, number] => [
  Math.round(dotGrid(z).gap * 100) / 100,
  Math.round(dotGrid(z).screen * 100) / 100,
];

describe("dotGrid", () => {
  test("100%는 참고 그림의 칸 8.66, 60%는 두 배(화면 10.39), 200%는 반(화면 8.66)", () => {
    expect([at(1), at(0.6), at(0.5), at(2)]).toEqual([
      [8.66, 8.66],
      [17.32, 10.39],
      [17.32, 8.66],
      [4.33, 8.66],
    ]);
  });

  test("화면의 칸은 어느 배율에서도 6.5 이상 13 미만", () => {
    const out = [0.1, 0.2, 0.33, 0.48, 0.6, 0.75, 0.85, 1, 1.5, 1.8, 2].filter((z) => {
      const s = dotGrid(z).screen;
      return !(s >= 6.5 - 1e-9 && s < 13 - 1e-9);
    });
    expect(out).toEqual([]);
  });

  test("배율이 0이면 기본 칸으로 돌아간다", () => {
    expect(dotGrid(0).gap).toBe(8.66);
  });
});

describe("dotShift", () => {
  test("이동 값을 칸으로 나눈 나머지에서 한 칸을 뺀다(늘 -칸 이상 0 미만)", () => {
    expect([0, 5, 24, 30, -5, -30].map((t) => dotShift(t, 24))).toEqual([
      -24, -19, -24, -18, -5, -6,
    ]);
  });
});

describe("openViewOf", () => {
  test("넉넉한 화면: 루프 전체가 들어가고 가로 가운데, 배율은 OPEN_ZOOM_MAX를 넘지 않는다", () => {
    const v = openViewOf({ x: 0, y: 0, w: 1000, h: 500 }, { x: 0, y: 0, w: 2000, h: 1000 });
    expect(v).toEqual({
      x: (2000 - 800) / 2,
      y: (1000 - 400) / 3,
      zoom: OPEN_ZOOM_MAX,
      overflowRight: false,
    });
  });

  test("좁은 화면: OPEN_ZOOM_MIN으로 열고 루프 왼쪽 끝을 화면 왼쪽에 붙이며 넘친다고 알린다", () => {
    const v = openViewOf({ x: -80, y: -710, w: 2032, h: 1126 }, { x: 32, y: 76, w: 500, h: 752 });
    expect(v).toEqual({
      x: 32 + 80 * OPEN_ZOOM_MIN,
      y: 76 + (752 - 1126 * OPEN_ZOOM_MIN) / 3 + 710 * OPEN_ZOOM_MIN,
      zoom: OPEN_ZOOM_MIN,
      overflowRight: true,
    });
  });

  test("판 전체가 창에 들어가는 배율이 50%보다 작아도 30%까지는 그 배율로 다 보인다(아래 Hook 판이 잘리지 않는다)", () => {
    const v = openViewOf({ x: 0, y: -900, w: 2400, h: 1800 }, { x: 0, y: 0, w: 1200, h: 720 });
    expect([v.zoom, v.overflowRight, OPEN_ZOOM_MIN]).toEqual([0.4, false, 0.3]);
  });

  test("그 사이: 들어가는 배율 그대로", () => {
    const v = openViewOf({ x: 0, y: 0, w: 2000, h: 800 }, { x: 0, y: 0, w: 1300, h: 900 });
    expect([v.zoom, v.overflowRight]).toEqual([0.65, false]);
  });
});

describe("layoutProfile", () => {
  test("판 크기는 참고 그림의 카드를 실제 px로 옮긴 316×289다(안쪽 글 네 줄)", () => {
    const l = layoutProfile(profileFromSample("dev"), new Set());
    const sizes = new Set(l.plates.map((p) => `${p.w}×${p.h}`));
    expect([PLATE_H, [...sizes]]).toEqual([289, ["316×289"]]);
  });

  test("레일과 판 사이 80: 첫 판이 레일 가운데에서 ±104, 멀리 단계의 탭(36)과 버스(블록 변에서 32) 사이 12, 루프 높이 1937", () => {
    const l = layoutProfile(profileFromSample("dev"), new Set());
    const below = Math.min(...l.plates.filter((p) => p.y > 0).map((p) => p.y));
    const above = Math.max(
      ...l.plates
        .filter((p) => p.y + p.h < 0 && p.placed.plugin.kind !== "drive")
        .map((p) => p.y + p.h),
    );
    // G5는 레일과 판 사이 96, 재료 줄 위 Drive 줄까지 112였다(루프 높이 1985). 처음 여는 50%에서 1920×1080에 다 들게 줄였다
    expect([below, above, below - TAB_ROOM - (RAIL_HALF + 32), l.bounds.h]).toEqual([
      104, -104, 12, 1937,
    ]);
  });

  test("탭 자리까지 넣어도 판끼리 겹치지 않는다(개발, 30개, 한 자리 1·5·20)", () => {
    const scenes = [
      ["dev", profileFromSample("dev")],
      ["scale", profileFromSample("scale")],
      ["attach1", attachProfile(1)],
      ["attach5", attachProfile(5)],
      ["attach20", attachProfile(20)],
    ] as const;
    const hits = scenes.flatMap(([id, p]) => {
      const l = layoutProfile(p, new Set());
      return l.plates.flatMap((a, i) =>
        l.plates
          .slice(i + 1)
          .flatMap((b) =>
            overlaps(withTab(a), withTab(b))
              ? [`${id}:${a.placed.plugin.name}×${b.placed.plugin.name}`]
              : [],
          ),
      );
    });
    expect(hits).toEqual([]);
  });

  test("모든 선은 있는 소켓(자리|변) 또는 대화 시작으로 들어간다", () => {
    const stray = (["dev", "scale"] as const).flatMap((id) => {
      const l = layoutProfile(profileFromSample(id), new Set());
      const keys = new Set([
        ...l.sockets.map((s) => `${s.anchor}|${s.side}`),
        "boundary:input-received|top",
      ]);
      return l.wires.filter((w) => !keys.has(w.socket)).map((w) => `${id}:${w.id}:${w.socket}`);
    });
    expect(stray).toEqual([]);
  });
});
