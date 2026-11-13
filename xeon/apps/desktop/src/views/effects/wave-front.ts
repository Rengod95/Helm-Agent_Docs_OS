// 화면 전체 물결의 순수 모델(DP-161). 진행(0~1)에서 물결의 앞선·세기·가장자리 색을 셈한다. 셰이더(wave-shader.ts)가 이 값만 읽는다.
//
// 옮긴 출처: Libraries.dev "Distortion waves" iOS 포트
//   https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/distortion-waves/ports/ios/DistortionWavesKit
//   WaveFront.swift(앞선), WaveRim.swift(가장자리 덩어리), WaveParticles.swift(입자), DistortionWaveStyle.swift(기본값·팔레트·곡선)
// MIT License, Copyright (c) 2026 Jakub Antalik
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation
//   files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy,
//   modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software
//   is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be
//   included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
//
// 다른 점: 원본은 두 화면을 잇는 전환이고, 여기서는 같은 화면 위를 지나간다. 렌즈(당김·부풂·색 갈라짐)와 점진 흐림은 데스크톱 셸이 찍은 창 한 장을
// 텍스처로 읽어 그린다(wave-capture.ts, wave-shader.ts). 그 그림이 없으면(웹 탭, 찍기 실패) 색 띠·가장자리 색·입자만 위에 겹친다.
// 기울기(터치 쪽으로 기욺)는 옮기지 않았다: 데스크톱에서는 누른 자리 없이 입력창이나 화면 아래에서 떠난다.

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
  readonly pull: number;
  readonly inhale: number;
  readonly gatherGlow: number;
  readonly gatherDots: number;
  readonly amplitude: number;
  readonly lensWidth: number;
  readonly aberration: number;
  readonly swell: number;
  readonly blur: number;
  readonly blurAhead: number;
  readonly blurBehind: number;
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
  readonly particleCount: number;
  readonly particleSize: number;
  readonly particleReach: number;
  readonly particleFlight: number;
  readonly particleGap: number;
  readonly particleLife: number;
  readonly particleSpread: number;
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
  pull: 24,
  inhale: 56,
  gatherGlow: 0.33,
  gatherDots: 1,
  amplitude: 34,
  lensWidth: 150,
  aberration: 0.78,
  swell: 22,
  blur: 18,
  blurAhead: 90,
  blurBehind: 240,
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
  particleCount: 64,
  particleSize: 1.8,
  particleReach: 150,
  particleFlight: 30,
  particleGap: 24,
  particleLife: 2.19,
  particleSpread: 1,
};

/** 물결 전체 길이(초). 원본 `duration`과 같다 */
export function waveDurationOf(style: WaveStyle): number {
  return (
    style.anticipation +
    Math.max(
      style.travel * 0.6,
      style.linger + style.rimFade,
      style.linger + style.hairlineLinger + style.hairlineFade,
      style.particleLife,
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

/** 한 순간의 물결(원본 WaveFront). 진행만의 함수라 같은 진행에서는 늘 같다 */
export type WaveFront = {
  readonly originX: number;
  readonly originY: number;
  readonly tilt: number;
  readonly spine: number;
  readonly radius: number;
  readonly moved: number;
  readonly squash: number;
  readonly time: number;
  readonly energy: number;
  readonly swell: number;
  readonly width: number;
  readonly height: number;
  /** 원천 쪽으로 당기는 거리(px) */
  readonly gravity: number;
  readonly glow: number;
  readonly clearRadius: number;
  readonly hairClearRadius: number;
  readonly rim: number;
  /** 입자가 떠오르는 정도, 0~1 */
  readonly sparkle: number;
  /** 앞선이 떠난 뒤 지난 초 */
  readonly flying: number;
  readonly launched: boolean;
  /** 앞선이 화면을 다 지났다 */
  readonly hasCleared: boolean;
  readonly ring: boolean;
  readonly sideways: boolean;
  readonly hold: number;
};

const COVER_ZONE = 60;
const ARC_SQUASH = 1.4;
const RELEASE = 0.22;
const GATHERED_GLOW = 0.5;
const OVERSHOOT = 100;
const SETTLE_START = 0.2;
const SETTLE_END = 0.55;

/** 진행(0~1)에서의 물결. 원본 WaveFront.init(누른 자리 없음) */
export function waveFrontAt(
  progress: number,
  source: WaveRect,
  size: WaveSize,
  style: WaveStyle,
): WaveFront {
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
  const gatheredGlow = Math.min(GATHERED_GLOW * Math.max(style.gatherGlow, 0), 1);
  const clearStart = startRadius - style.rimSoftness;
  const clearEnd = reach + (style.rimSoftness + style.swell) * fullSquash;
  return {
    originX: midX,
    originY: midY,
    tilt,
    spine: startSpine * (1 - opening),
    radius,
    moved,
    squash: 1 + (fullSquash - 1) * smooth(0, 0.5, moved),
    time: t,
    energy: smooth(0, 0.05, x) * settling,
    swell: style.swell * smooth(0, 0.3, moved),
    width: size.width,
    height: size.height,
    gravity: style.pull * gathered * (1 - smooth(0, RELEASE, sinceLaunch)),
    glow:
      sinceLaunch < 0
        ? gatheredGlow * gathered
        : (gatheredGlow + (1 - gatheredGlow) * smooth(0, 0.07, x)) * settling,
    clearRadius:
      clearStart +
      (clearEnd - clearStart) *
        easeAt(style.rimEasing, (sinceLaunch - style.linger) / Math.max(style.rimFade, 0.01)),
    hairClearRadius:
      clearStart +
      (clearEnd - clearStart) *
        easeAt(
          style.rimEasing,
          (sinceLaunch - style.linger - style.hairlineLinger) / Math.max(style.hairlineFade, 0.01),
        ),
    rim: style.rimStrength * smooth(0, 0.1, x) * (1 - smooth(0.9, 1, t / waveDurationOf(style))),
    sparkle: smooth(0, Math.max(style.anticipation, 0.001) * 0.35, t),
    flying: Math.max(sinceLaunch, 0),
    launched: sinceLaunch > 0,
    hasCleared: radius > crossed,
    ring,
    sideways,
    hold: ring ? startRadius : 0,
  };
}

/** 셰이더가 읽는 19칸(원본 `packed`) */
export function waveFieldOf(front: WaveFront): WaveField {
  return [
    front.originX,
    front.originY,
    front.spine,
    front.radius,
    front.squash,
    front.time,
    front.energy,
    front.swell,
    front.width,
    front.height,
    front.gravity,
    front.glow,
    front.clearRadius,
    front.rim,
    front.tilt,
    front.ring ? 1 : 0,
    front.hold,
    front.launched ? 1 : 0,
    front.hairClearRadius,
  ];
}

/** 진행(0~1)에서의 셰이더 값 */
export function waveFieldAt(
  progress: number,
  source: WaveRect,
  size: WaveSize,
  style: WaveStyle,
): WaveField {
  return waveFieldOf(waveFrontAt(progress, source, size, style));
}

// ── 입자(원본 WaveParticles.swift) ───────────────────────────────────

/** 입자 하나의 늘 같은 값(원본 WaveParticle.init). 저차 불일치 수열이라 매번 같은 자리에 고르게 흩어진다 */
type Particle = {
  readonly index: number;
  readonly column: number;
  readonly heading: number;
  readonly pace: number;
  readonly drift: number;
  readonly sway: number;
  readonly swayRate: number;
  readonly twinkleRate: number;
  readonly phase: number;
  readonly life: number;
  readonly size: number;
  readonly brightness: number;
  readonly hop: number;
  readonly hopOffset: number;
};

/** 가장 빠른 입자가 원천보다 넓게 퍼지는 몫(앞선이 열리는 호) */
const FAN = 0.22;
/** 원천 양 끝에서 가운데보다 낮게 나는 몫(앞선처럼 휜다) */
const BOW = 0.3;

function particleOf(index: number, style: WaveStyle): Particle {
  const i = index + 1;
  const scatter = (step: number): number => (i * step) % 1;
  const small = scatter(0.5497004779);
  return {
    index: i,
    column: (scatter(0.7548776662) * 2 - 1) * 0.92,
    heading: scatter(0.7548776662) * 2 * Math.PI,
    pace: 0.35 + 0.72 * Math.sqrt(scatter(0.8191725134)),
    drift: 15 + 50 * scatter(0.6710436067),
    sway: 3 + 11 * scatter(0.4142135624),
    swayRate: 2.5 + 3.5 * scatter(0.7320508076),
    twinkleRate: 8 + 12 * scatter(0.2360679775),
    phase: scatter(0.6180339887) * 2 * Math.PI,
    life: style.particleLife * (0.4 + 0.6 * scatter(0.6457513111)),
    size: style.particleSize * (0.55 + 0.45 * small * small),
    brightness: 0.3 + 0.7 * scatter(0.6055512755),
    hop: 0.16 + 0.14 * scatter(0.1231056256),
    hopOffset: scatter(0.472135955),
  };
}

function particleHash(i: number, n: number, salt: number): number {
  const v = Math.sin(i * 12.9898 + n * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

function hopAt(p: Particle, time: number): { readonly count: number; readonly along: number } {
  const hops = time / p.hop + p.hopOffset;
  const count = Math.floor(hops);
  return { count, along: hops - count };
}

type Point = { readonly x: number; readonly y: number };

function onSource(source: WaveRect, sideways: boolean, along: number, out: number): Point {
  const midX = source.x + source.width / 2;
  const midY = source.y + source.height / 2;
  return sideways ? { x: midX + out, y: midY + along } : { x: midX + along, y: midY - out };
}

function pointOf(p: Particle, front: WaveFront, source: WaveRect, style: WaveStyle): Point {
  const spread = Math.min(Math.max(style.particleSpread, 0), 1);
  const midX = source.x + source.width / 2;
  const midY = source.y + source.height / 2;
  const edge = Math.min(source.width, source.height) / 2;
  const swaying =
    p.sway * Math.sin(p.swayRate * front.flying + p.phase) * Math.min(front.flying / 0.25, 1);
  if (front.ring) {
    if (!front.launched) {
      const { count, along } = hopAt(p, front.time);
      const angle = particleHash(p.index, count, 1) * 2 * Math.PI;
      const nearest = edge + style.particleGap + style.particleFlight;
      const away =
        nearest + Math.max(style.particleReach - nearest, 0) * particleHash(p.index, count, 2);
      const distance = away - style.particleFlight * along * along;
      return { x: midX + Math.cos(angle) * distance, y: midY + Math.sin(angle) * distance };
    }
    const distance = edge + ((front.radius - edge) * p.pace + p.drift * front.flying) * spread;
    const dx = Math.cos(p.heading);
    const dy = Math.sin(p.heading);
    return {
      x: front.originX + dx * distance - dy * swaying,
      y: front.originY + dy * distance + dx * swaying,
    };
  }
  if (!front.launched) {
    const { count, along } = hopAt(p, front.time);
    const half = (front.sideways ? source.height : source.width) / 2;
    const face = (front.sideways ? source.width : source.height) / 2;
    const x = (particleHash(p.index, count, 1) * 2 - 1) * (half + 24);
    const nearest = style.particleGap + style.particleFlight;
    const away =
      nearest + Math.max(style.particleReach - nearest, 0) * particleHash(p.index, count, 2);
    const start = onSource(source, front.sideways, x, face + away);
    const target = onSource(
      source,
      front.sideways,
      Math.min(Math.max(x, -half + edge), half - edge),
      face,
    );
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const length = Math.max(Math.hypot(dx, dy), 1);
    const travelled = style.particleFlight * along * along;
    return { x: start.x + (dx / length) * travelled, y: start.y + (dy / length) * travelled };
  }
  const widening = 1 + FAN * front.moved * p.pace * spread;
  const x = ((p.column * (front.sideways ? source.height : source.width)) / 2) * widening + swaying;
  const height =
    (edge + (front.radius - edge) * p.pace * spread) * (1 - BOW * p.column * p.column) +
    p.drift * front.flying * spread;
  const cs = Math.cos(front.tilt);
  const sn = Math.sin(front.tilt);
  return {
    x: front.originX + cs * x + sn * height,
    y: front.originY + sn * x - cs * height,
  };
}

function opacityOf(p: Particle, front: WaveFront, style: WaveStyle): number {
  const twinkle = 0.5 + 0.5 * Math.sin(front.time * p.twinkleRate + p.phase);
  const glint = p.brightness * (0.7 + 0.3 * twinkle);
  if (!front.launched) {
    const { along } = hopAt(p, front.time);
    const hopping = smooth(0, 0.25, along) * (1 - smooth(0.55, 1, along));
    const ending = 1 - smooth(style.anticipation * 0.75, style.anticipation, front.time);
    return front.sparkle * hopping * ending * glint * style.gatherDots;
  }
  return (1 - smooth(p.life * 0.55, p.life, front.flying)) * glint;
}

/** 입자 하나에 4칸(가운데 x, y, 지름, 불투명도). 보이지 않는 입자도 자리를 지킨다(불투명도 0) */
export const PARTICLE_STRIDE = 4;

/** 이 순간의 입자들. 원본처럼 앞선만의 함수라 같은 순간에는 늘 같다 */
export function waveParticlesAt(
  front: WaveFront,
  source: WaveRect,
  style: WaveStyle,
): Float32Array {
  const out = new Float32Array(style.particleCount * PARTICLE_STRIDE);
  for (let i = 0; i < style.particleCount; i += 1) {
    const p = particleOf(i, style);
    const opacity = opacityOf(p, front, style);
    const at = opacity > 0 ? pointOf(p, front, source, style) : { x: 0, y: 0 };
    out.set([at.x, at.y, p.size, Math.max(opacity, 0)], i * PARTICLE_STRIDE);
  }
  return out;
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
