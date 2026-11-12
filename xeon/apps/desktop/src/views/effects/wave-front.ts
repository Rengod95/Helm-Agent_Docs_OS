// 화면 전체 물결의 순수 모델(DP-161). 진행(0~1)에서 물결의 앞선·세기·가장자리 색을 셈한다. 셰이더(wave-shader.ts)가 이 값만 읽는다.
//
// 옮긴 출처: Libraries.dev "Distortion waves" iOS 포트
//   https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/distortion-waves/ports/ios/DistortionWavesKit
//   WaveFront.swift(앞선), WaveRim.swift(가장자리 덩어리), DistortionWaveStyle.swift(기본값·팔레트·곡선)
// MIT License, Copyright (c) 2026 Jakub Antalik
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
//   files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
//   modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software
//   is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be
//   included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
//
// 다른 점: 웹은 화면(DOM)을 텍스처로 읽지 못해 렌즈(당김·부풂·색 갈라짐)와 점진 흐림은 옮기지 않았다. 색 띠와 가장자리 색·머리카락 선만
// 위에 겹친다. 기울기(터치 쪽으로 기욺)와 작은 불티(WaveParticles)도 옮기지 않았다(누른 자리가 없고, 불티는 데스크톱 크기에서 먼지처럼 읽힌다).

type WaveType = "vertical" | "horizontal" | "center";

export type WaveRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type WaveSize = { readonly width: number; readonly height: number };

/** CSS `cubic-bezier()`와 같은 조절점 */
export type WaveEasing = readonly [number, number, number, number];

/** 원본 DistortionWaveStyle 가운데 색 띠·가장자리에 쓰는 값. 길이는 CSS px, 시간은 초 */
export type WaveStyle = {
  readonly type: WaveType;
  readonly anticipation: number;
  readonly travel: number;
  readonly launchGap: number;
  readonly linger: number;
  readonly rimFade: number;
  readonly rimEasing: WaveEasing;
  readonly easing: WaveEasing;
  readonly inhale: number;
  readonly gatherGlow: number;
  readonly swell: number;
  readonly lead: number;
  readonly tail: number;
  readonly strength: number;
  readonly rimWidth: number;
  readonly rimUnevenness: number;
  readonly rimStrength: number;
  readonly rimSoftness: number;
  readonly cornerRadius: number;
  readonly rimPulse: number;
  readonly hairlineWidth: number;
  readonly hairlineOpacity: number;
  readonly hairlineWhite: number;
  readonly hairlineLinger: number;
  readonly hairlineFade: number;
};

/** 원본 `.vertical` 기본값(휴대폰 화면 기준) */
export const WAVE_VERTICAL: WaveStyle = {
  type: "vertical",
  anticipation: 0.5,
  travel: 2.28,
  launchGap: 0,
  linger: -0.35,
  rimFade: 3.03,
  rimEasing: [0.42, 0, 0.58, 1],
  easing: [0.22, 1, 0.36, 1],
  inhale: 56,
  gatherGlow: 0.33,
  swell: 22,
  lead: 130,
  tail: 300,
  strength: 0.92,
  rimWidth: 14,
  rimUnevenness: 1,
  rimStrength: 0.82,
  rimSoftness: 343,
  cornerRadius: 62,
  rimPulse: 0.6,
  hairlineWidth: 1.5,
  hairlineOpacity: 0.9,
  hairlineWhite: 0.95,
  hairlineLinger: 0.47,
  hairlineFade: 3,
};

/** 물결 전체 길이(초). 원본 `duration`에서 불티 수명을 뺐다 */
export function waveDurationOf(style: WaveStyle): number {
  return (
    style.anticipation +
    Math.max(
      style.travel * 0.6,
      style.linger + style.rimFade,
      style.linger + style.hairlineLinger + style.hairlineFade,
    )
  );
}

function bezier(s: number, a: number, b: number): number {
  const r = 1 - s;
  return 3 * r * r * s * a + 3 * r * s * s * b + s * s * s;
}

/** 곡선 값. x를 이분법으로 찾아 y를 돌려준다(원본 DistortionWaveEasing) */
export function easeAt(curve: WaveEasing, x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const s = (low + high) / 2;
    if (bezier(s, curve[0], curve[2]) < x) low = s;
    else high = s;
  }
  return bezier((low + high) / 2, curve[1], curve[3]);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/** 셰이더가 읽는 앞선 값(원본 `packed`의 순서와 같은 19칸) */
export type WaveField = readonly number[];

const COVER_ZONE = 60;
const ARC_SQUASH = 1.4;
const GATHERED_GLOW = 0.5;
const OVERSHOOT = 100;
const SETTLE_START = 0.2;
const SETTLE_END = 0.55;

/** 진행(0~1)에서의 물결. 원본 WaveFront.init(누른 자리 없음) */
export function waveFieldAt(
  progress: number,
  source: WaveRect,
  size: WaveSize,
  style: WaveStyle,
): WaveField {
  const t = Math.min(Math.max(progress, 0), 1) * waveDurationOf(style);
  const sinceLaunch = t - style.anticipation;
  const gathered = smooth(0, Math.max(style.anticipation, 0.001), t);
  const x = Math.min(Math.max(sinceLaunch / style.travel, 0), 1);
  const moved = easeAt(style.easing, x);

  const ring = style.type === "center";
  const sideways = style.type === "horizontal";
  const fullSquash = ring ? 1 : ARC_SQUASH;
  const startRadius = Math.min(source.width, source.height) / 2;
  const length = sideways ? source.height : source.width;
  const startSpine = ring ? 0 : Math.max(0, length / 2 - startRadius);
  const tilt = sideways ? Math.PI / 2 : 0;
  const opening = smooth(0, 0.45, moved);
  const midX = source.x + source.width / 2;
  const midY = source.y + source.height / 2;

  const cs = Math.cos(tilt);
  const sn = Math.sin(tilt);
  let reach = 0;
  for (const [cx, cy] of [
    [0, 0],
    [size.width, 0],
    [0, size.height],
    [size.width, size.height],
  ] as const) {
    const dx = cx - midX;
    const dy = cy - midY;
    reach = Math.max(reach, Math.hypot((cs * dx + sn * dy) * fullSquash, -sn * dx + cs * dy));
  }
  const crossed = reach + (style.swell + COVER_ZONE) * fullSquash;
  const settling = 1 - smooth(SETTLE_START, SETTLE_END, x);

  const launchRadius = startRadius + Math.max(style.launchGap, 0);
  const radius =
    sinceLaunch < 0
      ? launchRadius + style.inhale * (1 - gathered)
      : launchRadius + (crossed + OVERSHOOT - launchRadius) * moved;
  const squash = 1 + (fullSquash - 1) * smooth(0, 0.5, moved);
  const energy = smooth(0, 0.05, x) * settling;
  const swell = style.swell * smooth(0, 0.3, moved);
  const gatheredGlow = Math.min(GATHERED_GLOW * Math.max(style.gatherGlow, 0), 1);
  const glow =
    sinceLaunch < 0
      ? gatheredGlow * gathered
      : (gatheredGlow + (1 - gatheredGlow) * smooth(0, 0.07, x)) * settling;
  const clearStart = startRadius - style.rimSoftness;
  const clearEnd = reach + (style.rimSoftness + style.swell) * fullSquash;
  const clearRadius =
    clearStart +
    (clearEnd - clearStart) *
      easeAt(style.rimEasing, (sinceLaunch - style.linger) / Math.max(style.rimFade, 0.01));
  const hairClearRadius =
    clearStart +
    (clearEnd - clearStart) *
      easeAt(
        style.rimEasing,
        (sinceLaunch - style.linger - style.hairlineLinger) / Math.max(style.hairlineFade, 0.01),
      );
  const rim =
    style.rimStrength * smooth(0, 0.1, x) * (1 - smooth(0.9, 1, t / waveDurationOf(style)));
  return [
    midX,
    midY,
    startSpine * (1 - opening),
    radius,
    squash,
    t,
    energy,
    swell,
    size.width,
    size.height,
    0,
    glow,
    clearRadius,
    rim,
    tilt,
    ring ? 1 : 0,
    ring ? startRadius : 0,
    sinceLaunch > 0 ? 1 : 0,
    hairClearRadius,
  ];
}

/** 자리마다 늘 같은 0~1 값(원본 WaveRim.hash) */
function hash(i: number, a: number, b: number): number {
  const x = Math.sin(i * a + b) * 43758.5453;
  return x - Math.floor(x);
}

/** 가장자리 색을 고르지 않게 하는 덩어리 7개(둘레 위 가운데, 길이, 깊이). 원본 WaveRim.lumps */
export function waveLumpsAt(
  time: number,
  size: WaveSize,
  cornerRadius: number,
  pulse: number,
): readonly number[] {
  const count = 7;
  const ex = Math.max(size.width / 2 - cornerRadius, 0);
  const ey = Math.max(size.height / 2 - cornerRadius, 0);
  const perimeter = 4 * (ex + ey + 0.5 * Math.PI * cornerRadius);
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = hash(i, 12.9898, 1.3);
    const b = hash(i, 78.233, 4.1);
    const c = hash(i, 39.425, 2.7);
    const centre = (perimeter * (i + 0.35 * a)) / count + time * (-22 + 44 * b) * (1 + 2 * pulse);
    const length = (perimeter / count) * (0.2 + 0.25 * c);
    const breath = (0.25 + 0.3 * pulse) * Math.sin(time * (1.1 + 1.2 * a) * (1 + pulse) + i * 2.4);
    const depth = (0.2 + 2.6 * b) * (1 + breath);
    out.push(centre, length, depth);
  }
  return out;
}

type Rgb = readonly [number, number, number];

/** sRGB(0~255)를 OKLab으로(원본 DistortionWaveColor.oklab) */
function linear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function oklabOf(rgb: Rgb): readonly [number, number, number] {
  const [lr, lg, lb] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** 원본 `.colorful`(VoiceGlow): 일곱 색, 앞 가장자리 분홍, 뒤 가장자리 파랑 */
const COLORFUL: readonly Rgb[] = [
  [255, 201, 21],
  [126, 196, 255],
  [180, 40, 230],
  [235, 100, 160],
  [255, 176, 122],
  [154, 160, 255],
  [127, 217, 238],
  [255, 122, 182],
  [90, 190, 255],
];

/** 셰이더에 넘길 팔레트(OKLab 9개 × 3, 마지막 둘이 앞·뒤 가장자리) */
export const WAVE_PALETTE: readonly number[] = COLORFUL.flatMap((rgb) => oklabOf(rgb));
