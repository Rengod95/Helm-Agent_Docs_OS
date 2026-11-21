// 이펙트 설정 한 곳(dzE 시안 §2.5, dzU 시안). 세기·자리·조건을 이 파일의 상수로만 바꾼다.
// - 오로라 자리(DP-126): 입력창 오로라는 border-beam으로 바뀌어(DP-160) 지금 띠 바탕만 남았다. 기본은 끔.
// - 입력창 아래 변 빛(DP-167), 화면 전체 물결(DP-161·166), 생각 중 orb(DP-162·168)의 값.
// 견본·검수에서는 `<html data-fx-aurora="strip">`로 오로라를 덮어 견줄 수 있다.

import type { OrbState } from "thinking-orbs";
import { WAVE_VERTICAL, type WaveStyle } from "./wave-front.ts";

// ── 오로라(지금 띠 바탕) ─────────────────────────────────────────────

export type AuroraSite = "strip" | "off";

/** 제품 기본값. 입력창은 테두리 빛 하나로 말하고, 띠 바탕 오로라는 견본에서만 켠다 */
export const AURORA_SITE: AuroraSite = "off";

function isAuroraSite(value: string | undefined): value is AuroraSite {
  return value === "strip" || value === "off";
}

/** 지금 쓰는 자리. `<html data-fx-aurora>`가 있으면 그 값, 없으면 AURORA_SITE */
function auroraSiteOf(): AuroraSite {
  if (typeof document === "undefined") return AURORA_SITE;
  const value = document.documentElement.dataset["fxAurora"];
  return isAuroraSite(value) ? value : AURORA_SITE;
}

/** 이 자리(지금 띠)에 오로라를 그리는가 */
export function auroraOn(site: "strip", current: AuroraSite = auroraSiteOf()): boolean {
  return current === site;
}

// ── 테마 ─────────────────────────────────────────────────────────────

export type FxScheme = "dark" | "light";

/** 앱이 정한 테마(`<html data-theme>`)가 있으면 그 값, 없으면 운영체제 설정 */
export function schemeOf(root: HTMLElement, osDark: boolean): FxScheme {
  const explicit = root.dataset["theme"];
  if (explicit === "dark" || explicit === "light") return explicit;
  return osDark ? "dark" : "light";
}

// ── 입력창 아래 변 빛(DP-167) ────────────────────────────────────────

/**
 * 크기 변형. field는 입력창(선 + 안쪽 번짐), chip은 실행 중 칩(선만: 번짐이 칩 글을 덮는다),
 * band는 Drive 띠(lcM6c·lcM6d): 띠의 윗변 곧은 구간에만 선, 그 바로 아래 6px의 옅은 번짐. 빛깔은 붉은 기운을 뺀 띠 전용 팔레트
 */
export type GlowVariant = "field" | "chip" | "band";

/** 빛깔 이름. beam.css의 `--fx-glow-<이름>`(border-beam `line` colorful 팔레트) */
type GlowTint =
  | "teal"
  | "purple"
  | "green"
  | "blue"
  | "pink"
  | "core"
  | "indigo"
  | "cyan"
  | "orange"
  | "magenta"
  | "yellow";

/** 아래 변 위의 빛 알갱이 하나. 자리와 폭은 상자 폭에 대한 비율이다 */
export type GlowSpark = {
  /** 가운데 자리(0 왼끝, 1 오른끝) */
  readonly at: number;
  readonly width: number;
  readonly tint: GlowTint;
  /** 숨의 위상(4분의 1 주기 단위). beam.css의 키프레임 `fx-glow-spark-<위상>`·`fx-glow-rise-<위상>`이 같은 곡선을 그만큼 밀어 둔다 */
  readonly phase: GlowPhase;
};

type GlowPhase = 0 | 1 | 2 | 3;

export type GlowTune = {
  /** 1px 선 위의 알갱이 */
  readonly line: readonly GlowSpark[];
  /** 상자 안쪽으로 번지는 알갱이. 비면 번짐이 없다 */
  readonly bloom: readonly GlowSpark[];
};

/**
 * border-beam `line`(사용자 이미지 1112c-4)의 결을 아래 변 전체로 편 값. 그 빛 한 점은 선 길이 78px·번짐 높이 28~40px이고 2.4~4초 주기로
 * 숨 쉰다(breathe 1.3배, spike 1.33·1.7배). 712px 입력창에 그 점을 일곱 개 겹쳐 놓고(폭 26%, 이웃과 반쯤 겹침) 이웃끼리 숨의 위상을
 * 달리해 자리마다 세기·빛깔이 다르게 숨 쉬고 흐른다. 번짐은 여섯 덩이(폭 30%)가 높이가 오르내린다.
 * 주기는 하나(beam.css 3.6초)이고 늦춤 없이 위상을 키프레임에 넣었다: 주기·늦춤이 다른 CSS 애니메이션은 그 조합 수만큼 메인 스레드 스타일
 * 재계산을 부른다(실측 dzU2 §6: 조합 13개 3초에 약 90ms, 하나면 14ms)
 */
export const GLOW_TUNE: Readonly<Record<GlowVariant, GlowTune>> = {
  field: {
    line: [
      { at: 0.07, width: 0.26, tint: "teal", phase: 0 },
      { at: 0.21, width: 0.26, tint: "purple", phase: 2 },
      { at: 0.36, width: 0.26, tint: "blue", phase: 1 },
      { at: 0.5, width: 0.26, tint: "core", phase: 3 },
      { at: 0.64, width: 0.26, tint: "indigo", phase: 0 },
      { at: 0.79, width: 0.26, tint: "cyan", phase: 2 },
      { at: 0.93, width: 0.26, tint: "magenta", phase: 1 },
    ],
    bloom: [
      { at: 0.1, width: 0.3, tint: "teal", phase: 1 },
      { at: 0.27, width: 0.3, tint: "purple", phase: 3 },
      { at: 0.44, width: 0.3, tint: "pink", phase: 0 },
      { at: 0.6, width: 0.3, tint: "blue", phase: 2 },
      { at: 0.76, width: 0.3, tint: "indigo", phase: 1 },
      { at: 0.92, width: 0.3, tint: "orange", phase: 3 },
    ],
  },
  // 띠(lcM6d): 붉은 기운(분홍·주황·자홍)을 뺀 초록·파랑·보라·노랑 계열만 쓴다(사용자 2026-11-20, 입력창 빛은 그대로).
  // 흰 심(core)도 띠는 차가운 흰빛이다(beam.css). 번짐은 테두리 바로 아래 6px만, 덩이 넷이다
  band: {
    line: [
      { at: 0.07, width: 0.26, tint: "teal", phase: 0 },
      { at: 0.21, width: 0.26, tint: "blue", phase: 2 },
      { at: 0.36, width: 0.26, tint: "purple", phase: 1 },
      { at: 0.5, width: 0.26, tint: "core", phase: 3 },
      { at: 0.64, width: 0.26, tint: "green", phase: 0 },
      { at: 0.79, width: 0.26, tint: "yellow", phase: 2 },
      { at: 0.93, width: 0.26, tint: "indigo", phase: 1 },
    ],
    bloom: [
      { at: 0.16, width: 0.34, tint: "teal", phase: 1 },
      { at: 0.4, width: 0.34, tint: "blue", phase: 3 },
      { at: 0.62, width: 0.34, tint: "green", phase: 0 },
      { at: 0.84, width: 0.34, tint: "purple", phase: 2 },
    ],
  },
  chip: {
    line: [
      { at: 0.2, width: 0.55, tint: "teal", phase: 0 },
      { at: 0.5, width: 0.55, tint: "core", phase: 2 },
      { at: 0.8, width: 0.55, tint: "magenta", phase: 1 },
    ],
    bloom: [],
  },
};

/**
 * 입력창 빛의 양 끝이 옅어지는 길이(px). 빛은 아래 변의 곧은 구간(모서리 반경 r부터 폭 − r까지)에만 서고, 그 양 끝에서 이 길이만큼
 * 옅어져 곡선이 시작하는 자리(r)에서 0이 된다(DP-167 개정 [결정: 2026-11-21 사용자, AGE-65 lcQ2]). 712px 입력창(r 23.2)에서 곧은 구간 665.6px의
 * 2.4%라 끝이 뚝 끊기지 않을 만큼만 짧다
 */
export const GLOW_EDGE_FADE = 16;

/** 대화를 불러오는 동안 머리 줄 아래를 흐르는 선(border-beam `line`). 한 번 지나가는 데 걸리는 초와 세기 */
export const LINE_TUNE: Readonly<
  Record<FxScheme, { readonly duration: number; readonly strength: number }>
> = {
  dark: { duration: 2.4, strength: 0.85 },
  light: { duration: 2.4, strength: 0.95 },
};

// ── 생각 중 orb(DP-162) ──────────────────────────────────────────────

/**
 * libraries.dev/orbs 미리보기 격자 4번째 칸의 상태. 그 칸은 `connecting`을 64 프리셋으로 56px에 그리고, 옆에 반짝이는 글을 둔
 * 알약이다(사이트 번들 `orbs-*.js`의 격자 코드와 렌더된 칸의 aria-label "Connecting…"으로 확인, 2026-11-12)
 */
export const ORB_STATE: OrbState = "connecting";

// ── 화면 전체 물결(DP-161) ───────────────────────────────────────────

export type WaveCause = "intro" | "done";

/**
 * 원본 휴대폰 값에서 데스크톱으로 옮긴 값. 본문 위를 지나는 시간을 줄이고(앞 띠 lead 130 → 110, 뒤 꼬리 300 → 220),
 * 가장자리 색이 남는 시간을 3.0s → 2.2s로, 입자 수명을 2.19s → 2.0s로(전체 2.45s 안에 끝나게) 줄였다. 모서리는 창 모서리(macOS 10px)에 가깝게 12.
 * 렌즈(amplitude 34, lensWidth 150, aberration 0.78, pull 24)·흐림(18, 앞 90, 뒤 240)·입자 수와 크기는 원본 그대로다(DP-166)
 */
const WAVE_DESKTOP: WaveStyle = {
  ...WAVE_VERTICAL,
  anticipation: 0.3,
  travel: 2,
  rimFade: 2.2,
  hairlineFade: 2.2,
  hairlineLinger: 0.3,
  lead: 110,
  tail: 220,
  rimWidth: 12,
  cornerRadius: 12,
  particleLife: 2,
};

export type WaveTune = {
  readonly wave: WaveStyle;
  /** 색 띠·가장자리·입자의 불투명도. 글 대비를 지키는 마지막 손잡이(렌즈에는 걸지 않는다) */
  readonly opacity: number;
  /** 입자 빛깔(sRGB 0~1). 원본은 흰 점이고, 라이트에서는 흰 바탕에 묻혀 짙은 남보라로 둔다 */
  readonly dot: readonly [number, number, number];
};

/** 테마별 세기. 라이트는 흰 바탕에서 띠 가운데(흰빛)가 사라지므로 색 쪽을 조금 올린다 */
const WAVE_TUNE: Readonly<Record<FxScheme, WaveTune>> = {
  dark: {
    wave: { ...WAVE_DESKTOP, strength: 0.62, rimStrength: 0.75 },
    opacity: 1,
    dot: [1, 1, 1],
  },
  light: {
    wave: { ...WAVE_DESKTOP, strength: 0.7, rimStrength: 0.8 },
    opacity: 0.9,
    dot: [0.33, 0.29, 0.7],
  },
};

/** 원인과 지금 테마에 맞는 물결 값. 첫 진입과 작업 완료는 같은 모양이다 */
export function waveStyleOf(_cause: WaveCause, root: HTMLElement): WaveTune {
  const osDark =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  return WAVE_TUNE[schemeOf(root, osDark)];
}

/**
 * 작업 완료 물결의 조건. 짧은 문답마다 화면이 번쩍이지 않게 "일을 한 턴"만 고르고, 연달아 끝나는 턴(대기 입력)에는 간격을 둔다.
 * - 도구를 쓴 턴: 모델 단계가 2 이상(도구 호출 뒤 한 번 더 부른다). 또는 오래 걸린 턴(20초 이상, 긴 답 하나).
 * - 앞 물결에서 45초 안이면 건너뛴다.
 */
const WAVE_DONE_MIN_STEPS = 2;
const WAVE_DONE_MIN_MS = 20_000;
export const WAVE_DONE_GAP_MS = 45_000;

export type FinishedTurn = {
  /** 턴이 끝난 이유. completed만 물결을 띄운다(멈춤·실패·한도는 아니다) */
  readonly endKind: "completed" | "limit" | "interrupted" | "failed";
  readonly steps: number;
  readonly durationMs: number | null;
};

/** 이 턴의 끝에 물결을 띄우는가 */
export function waveDueOnDone(turn: FinishedTurn, sinceLastWaveMs: number | null): boolean {
  if (turn.endKind !== "completed") return false;
  if (sinceLastWaveMs !== null && sinceLastWaveMs < WAVE_DONE_GAP_MS) return false;
  return turn.steps >= WAVE_DONE_MIN_STEPS || (turn.durationMs ?? 0) >= WAVE_DONE_MIN_MS;
}
