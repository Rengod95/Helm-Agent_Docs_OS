import { describe, expect, test } from "bun:test";
import { frameInterval, shouldRender, type FrameInput } from "@fresnel/client/workbench/canvas";
import {
  BACKGROUND_FRAG,
  CORE_BOX_SCALE,
  CORE_FRAG,
  DARK_PEAK_LUMA,
  QUAD_VERT,
  backgroundFrame,
  breathScale,
  coreFrame,
  easeEnergy,
  frameDtSeconds,
  initialCoreMotion,
  shapedEnergy,
  speechSignal,
  stepCore,
  viewKey,
} from "../../../src/views/craft/space-math.ts";

describe("easeEnergy", () => {
  test("holds at the target", () => {
    expect(easeEnergy(0.2, 0.2, 16)).toBe(0.2);
  });

  test("first 16 ms step from 0 toward 0.5", () => {
    // 0.5 × (1 - e^(-16/80))
    expect(easeEnergy(0, 0.5, 16)).toBeCloseTo(0.0906346, 6);
  });

  test("100 ms from 0 toward 1 is 1 - e^(-1.25)", () => {
    expect(easeEnergy(0, 1, 100)).toBeCloseTo(0.7134952, 6);
  });

  test("falling toward 0 mirrors the rise", () => {
    expect(easeEnergy(1, 0, 16)).toBeCloseTo(0.8187308, 6);
  });

  test("a full 0 to 1 change lands exactly on the target in 24 steps of 16 ms (384 ms, under 0.4 s)", () => {
    let e = 0;
    let steps = 0;
    while (e !== 1 && steps < 100) {
      e = easeEnergy(e, 1, 16);
      steps += 1;
    }
    expect(steps).toBe(24);
    expect(steps * 16).toBeLessThanOrEqual(400);
  });

  test("one 400 ms step from 0 snaps to the target", () => {
    expect(easeEnergy(0, 1, 400)).toBe(1);
  });

  test("zero or negative time changes nothing", () => {
    expect(easeEnergy(0.3, 1, 0)).toBe(0.3);
    expect(easeEnergy(0.3, 1, -5)).toBe(0.3);
  });
});

describe("speech-like energy signal", () => {
  test("first sample is the fixed value of the wave and no burst", () => {
    expect(speechSignal(0)).toBeCloseTo(0.1606112, 6);
  });

  test("stays within 0..1 and is deterministic", () => {
    for (let t = 0; t <= 60; t += 0.05) {
      const v = speechSignal(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(speechSignal(3.25)).toBe(speechSignal(3.25));
  });

  test("shaped energy is zero at zero and never drops below 0.6 of the target", () => {
    expect(shapedEnergy(0, 5)).toBe(0);
    for (let t = 0; t <= 30; t += 0.1) {
      const v = shapedEnergy(1, t);
      expect(v).toBeGreaterThanOrEqual(0.6);
      expect(v).toBeLessThanOrEqual(1);
      expect(shapedEnergy(0.5, t)).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("core motion", () => {
  test("starts at the target energy, clamped to 0..1", () => {
    expect(initialCoreMotion(0.4).e).toBe(0.4);
    expect(initialCoreMotion(1.7).e).toBe(1);
  });

  test("one 0.1 s step at zero energy advances spin, clocks and real time exactly", () => {
    const m = stepCore(initialCoreMotion(0), 0.1, 0);
    // 시작 0.4 + 0.5 × 0.1 × (0.7 + 2×0)
    expect(m.rot[0]).toBeCloseTo(0.435, 9);
    expect(m.tm).toBeCloseTo(0.06, 9);
    expect(m.fl).toBeCloseTo(0.05, 9);
    expect(m.real).toBeCloseTo(0.1, 9);
  });

  test("a 0.1 s step toward energy 1 eases only part of the way", () => {
    expect(stepCore(initialCoreMotion(0), 0.1, 1).e).toBeCloseTo(0.7134952, 6);
  });

  test("frame interval is clamped: first frame 0, backwards 0, long gaps capped at 0.1 s", () => {
    expect(frameDtSeconds(null, 500)).toBe(0);
    expect(frameDtSeconds(1000, 1016)).toBeCloseTo(0.016, 9);
    expect(frameDtSeconds(1000, 900)).toBe(0);
    expect(frameDtSeconds(0, 5000)).toBe(0.1);
  });

  test("breathing at zero energy and real time 0", () => {
    const [sx, sy] = breathScale(0, 0);
    expect(sx).toBeCloseTo(0.9911814, 6);
    expect(sy).toBeCloseTo(0.9843186, 6);
  });

  test("still frame freezes the clocks and shows the target energy as is", () => {
    expect(coreFrame(initialCoreMotion(0), 0.7, true)).toEqual({
      time: 12,
      flow: 12,
      rot: [0.3, -0.2, 0.25, -0.3],
      energy: 0.7,
      scale: [1, 1],
    });
  });

  test("a moving frame at zero energy has zero energy and the breathing scale", () => {
    const f = coreFrame(initialCoreMotion(0), 0, false);
    expect(f.energy).toBe(0);
    expect(f.time).toBe(0);
    expect(f.scale[0]).toBeCloseTo(0.9911814, 6);
  });
});

describe("background uniforms", () => {
  test("parallax values and core position are computed from the view", () => {
    expect(backgroundFrame({ k: 2, x: -100, y: 50 }, [800, 600], 1.25, 3, false, true)).toEqual({
      res: [800, 600],
      ratio: 1.25,
      time: 3,
      pan: [-100, 50],
      k: 2,
      core: [900, 1050],
      dark: 1,
    });
  });

  test("reduced motion pins time to 0 and light theme sets dark to 0", () => {
    const f = backgroundFrame({ k: 1, x: 0, y: 0 }, [10, 10], 1, 7, true, false);
    expect(f.time).toBe(0);
    expect(f.dark).toBe(0);
  });

  test("the core sits where the map's world centre is on screen", () => {
    expect(backgroundFrame({ k: 1, x: 0, y: 0 }, [10, 10], 1, 0, false, false).core).toEqual([
      500, 500,
    ]);
  });

  test("view key changes with every component", () => {
    expect(viewKey({ k: 1, x: 10, y: 20 })).toBe("1|10|20");
    expect(viewKey({ k: 1, x: 10, y: 21 })).not.toBe(viewKey({ k: 1, x: 10, y: 20 }));
  });
});

describe("frame policy the loop relies on", () => {
  const base: FrameInput = {
    now: 0,
    last: 1000,
    mode: "idle",
    hidden: false,
    reducedMotion: false,
    contextLost: false,
    drawnOnce: true,
  };

  test("idle cadence is about 33.3 ms (30 fps)", () => {
    expect(frameInterval("idle")).toBeCloseTo(33.3333, 3);
    expect(shouldRender({ ...base, now: 1016 })).toBe(false);
    expect(shouldRender({ ...base, now: 1034 })).toBe(true);
  });

  test("active cadence is about 16.7 ms (60 fps)", () => {
    expect(shouldRender({ ...base, mode: "active", now: 1016 })).toBe(true);
  });

  test("reduced motion draws once, hidden or lost draws nothing", () => {
    expect(shouldRender({ ...base, reducedMotion: true, drawnOnce: false })).toBe(true);
    expect(shouldRender({ ...base, reducedMotion: true })).toBe(false);
    expect(shouldRender({ ...base, hidden: true, now: 5000 })).toBe(false);
    expect(shouldRender({ ...base, contextLost: true, now: 5000 })).toBe(false);
  });
});

/** 여는 중괄호와 닫는 중괄호의 개수. 셰이더 문자열이 잘리지 않았는지 보는 가장 싼 검사다. */
function braceCounts(src: string): [number, number] {
  return [src.split("{").length - 1, src.split("}").length - 1];
}

describe("shader sources", () => {
  test("the dark luminance cap is 0.14 and the background shader carries it", () => {
    expect(DARK_PEAK_LUMA).toBe(0.14);
    expect(BACKGROUND_FRAG).toContain("const float CAP = 0.14;");
  });

  test("both fragment shaders are compile-shaped: entry point, output, balanced braces", () => {
    for (const src of [BACKGROUND_FRAG, CORE_FRAG]) {
      expect(src).toContain("void main()");
      expect(src).toContain("gl_FragColor");
      const [open, close] = braceCounts(src);
      expect(open).toBe(close);
    }
  });

  test("the core shader declares the uniforms the component sets", () => {
    for (const name of [
      "uCenter",
      "uR",
      "uEdge",
      "uDark",
      "uTime",
      "uFlow",
      "uRot",
      "uEnergy",
      "uScale",
    ]) {
      expect(CORE_FRAG).toContain(name);
    }
  });

  test("the background shader declares the uniforms the component sets", () => {
    for (const name of ["uRes", "uDpr", "uTime", "uPan", "uK", "uDark", "uCore"]) {
      expect(BACKGROUND_FRAG).toContain(name);
    }
  });

  test("the vertex shader writes a position and the core canvas is 2.4 times the sphere", () => {
    expect(QUAD_VERT).toContain("gl_Position");
    expect(CORE_BOX_SCALE).toBe(2.4);
  });
});
