import { describe, expect, test } from "bun:test";
import {
  WAVE_PALETTE,
  WAVE_VERTICAL,
  easeAt,
  oklabOf,
  waveDurationOf,
  waveFieldAt,
  waveFrontAt,
  waveLumpsAt,
  waveParticlesAt,
} from "../../../src/views/effects/wave-front.ts";

// 화면 전체 물결의 순수 모델(DP-161). 원본(DistortionWavesKit)의 식을 옮긴 값이 맞는지 본다.

const size = { width: 1440, height: 900 };
const source = { x: 540, y: 800, width: 360, height: 48 };
const round = (values: readonly number[], digits = 3): readonly number[] =>
  values.map((v) => Number(v.toFixed(digits)));

describe("waveDurationOf", () => {
  test("원본 기본값은 0.5 + max(1.368, 2.68, 3.12) = 3.62초", () => {
    expect(Number(waveDurationOf(WAVE_VERTICAL).toFixed(3))).toBe(3.62);
  });
});

describe("easeAt", () => {
  test("양 끝은 0과 1, 선형 곡선은 제자리", () => {
    expect([easeAt([0.22, 1, 0.36, 1], 0), easeAt([0.22, 1, 0.36, 1], 1)]).toEqual([0, 1]);
    expect(Number(easeAt([0, 0, 1, 1], 0.3).toFixed(4))).toBe(0.3);
  });

  test("빠르게 떠나는 곡선은 중간에 이미 많이 갔다", () => {
    expect(easeAt([0.22, 1, 0.36, 1], 0.5)).toBeGreaterThan(0.85);
  });
});

describe("waveFieldAt", () => {
  test("시작: 앞선이 원천 알약에서 inhale만큼 바깥에 있고 아직 떠나지 않았다", () => {
    const f = waveFieldAt(0, source, size, WAVE_VERTICAL);
    expect(f.length).toBe(19);
    expect(round([f[0] ?? 0, f[1] ?? 0, f[2] ?? 0, f[3] ?? 0, f[17] ?? 0])).toEqual([
      720, 824, 156, 80, 0,
    ]);
  });

  test("끝: 앞선은 화면 밖으로 지나갔고 색 띠·가장자리 색은 사라졌다", () => {
    const f = waveFieldAt(1, source, size, WAVE_VERTICAL);
    expect(f[3] ?? 0).toBeGreaterThan(Math.hypot(720 * 1.4, 824));
    expect([f[11], f[13], f[17]]).toEqual([0, 0, 1]);
  });

  test("반지름은 진행에 따라 줄지 않는다", () => {
    const radii = [0.15, 0.2, 0.4, 0.6, 0.8].map(
      (p) => waveFieldAt(p, source, size, WAVE_VERTICAL)[3] ?? 0,
    );
    expect(radii).toEqual(radii.toSorted((a, b) => a - b));
  });
});

describe("모으기와 렌즈(원본 WaveFront.gravity·energy)", () => {
  test("모으기 끝(앞선이 떠나는 순간)에 당김은 pull 전부, 떠난 뒤 0.22초 안에 놓는다", () => {
    const duration = waveDurationOf(WAVE_VERTICAL);
    const at = (seconds: number) => waveFrontAt(seconds / duration, source, size, WAVE_VERTICAL);
    expect([at(0).gravity, Number(at(0.5).gravity.toFixed(3)), at(0.8).gravity]).toEqual([
      0, 24, 0,
    ]);
    expect(at(0.5).energy).toBe(0);
    expect(at(0.6).energy).toBeGreaterThan(0.9);
    expect(at(3.6).energy).toBe(0);
  });

  test("셰이더 칸 10이 당김이다", () => {
    const f = waveFieldAt(0.5 / waveDurationOf(WAVE_VERTICAL), source, size, WAVE_VERTICAL);
    expect(Number((f[10] ?? 0).toFixed(3))).toBe(24);
  });
});

/** 보이는(불투명도 > 0) 입자의 y */
function visibleY(dots: Float32Array): number[] {
  return Array.from({ length: 64 }, (_, i) => i)
    .filter((i) => (dots[i * 4 + 3] ?? 0) > 0)
    .map((i) => dots[i * 4 + 1] ?? 0);
}

describe("waveParticlesAt(원본 WaveParticles)", () => {
  const duration = waveDurationOf(WAVE_VERTICAL);
  const dotsAt = (seconds: number): Float32Array =>
    waveParticlesAt(
      waveFrontAt(seconds / duration, source, size, WAVE_VERTICAL),
      source,
      WAVE_VERTICAL,
    );

  test("64개 × (x, y, 지름, 불투명도), 지름은 1.8의 0.55~1배", () => {
    const dots = dotsAt(1);
    expect(dots.length).toBe(256);
    const sizes = Array.from({ length: 64 }, (_, i) => dots[i * 4 + 2] ?? 0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(0.99);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(1.8);
  });

  test("모으기 동안은 원천 위에서 원천 쪽으로 날아들고, 떠난 뒤에는 앞선과 함께 위로 흩어진다", () => {
    const before = dotsAt(0.3);
    const after = dotsAt(1.2);
    const gather = visibleY(before);
    expect(gather.length).toBeGreaterThan(0);
    // 원천 윗면(800)에서 위로 gap 24 ~ reach 150 사이
    expect(Math.min(...gather)).toBeGreaterThanOrEqual(800 - 150 - 1);
    expect(Math.max(...gather)).toBeLessThanOrEqual(800);
    expect(Math.min(...visibleY(after))).toBeLessThan(400);
  });

  test("수명이 지나면 모두 사라진다", () => {
    const dots = dotsAt(0.5 + 2.2);
    expect(Array.from({ length: 64 }, (_, i) => dots[i * 4 + 3])).toEqual(
      Array.from({ length: 64 }, () => 0),
    );
  });
});

describe("waveLumpsAt", () => {
  test("덩어리 7개 × (가운데, 길이, 깊이), 같은 때에는 같은 값", () => {
    const a = waveLumpsAt(1.2, size, 12, 0.6);
    expect(a.length).toBe(21);
    expect(waveLumpsAt(1.2, size, 12, 0.6)).toEqual(a);
  });
});

describe("팔레트", () => {
  test("흰색은 OKLab (1, 0, 0), 검정은 (0, 0, 0)", () => {
    expect(round(oklabOf([255, 255, 255]))).toEqual([1, 0, 0]);
    expect(round(oklabOf([0, 0, 0]))).toEqual([0, 0, 0]);
  });

  test("일곱 색과 앞·뒤 가장자리, 9 × 3", () => {
    expect(WAVE_PALETTE.length).toBe(27);
  });
});
