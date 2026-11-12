// 이펙트 설정 한 곳(dzE 시안 §2.5, dzU 시안). 세기·자리·조건을 이 파일의 상수로만 바꾼다.
// - 오로라 자리(DP-126): 입력창 오로라는 border-beam으로 바뀌어(DP-160) 지금 띠 바탕만 남았다. 기본은 끔.
// - 입력창 테두리 빛(DP-160), 화면 전체 물결(DP-161), 생각 중 orb(DP-162)의 값.
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

// ── 입력창 테두리 빛(DP-160) ─────────────────────────────────────────

/** 물마루 크기 변형. field는 입력창(선 + 안쪽 번짐), chip은 실행 중 칩(선만: 번짐이 칩 글을 덮는다) */
export type CrestVariant = "field" | "chip";

export type CrestTune = {
  /** 한 바퀴(ms). 둘레 길이와 상관없이 같은 시간이라 긴 상자는 빨리, 짧은 칩은 천천히 돈다 */
  readonly periodMs: number;
  /** 1px 무지개 선을 이루는 점 수와 간격(px). 선 길이는 대략 count × gap */
  readonly line: { readonly count: number; readonly gap: number };
  /** 안쪽 번짐 점 수와 간격(px). 0이면 번짐이 없다 */
  readonly bloom: { readonly count: number; readonly gap: number };
};

/**
 * border-beam `line`(4번 이미지)의 선 길이(마스크 78px × 숨 0.5~1.5)와 번짐 높이(28~40px)에 맞춘 값. 입력창 둘레(약 1,590px)를
 * 4.8초에 돌아 초당 330px쯤이다(border-beam `line`은 한 변 520px을 3.1초, 초당 170px. 둘레가 세 배라 조금 빠르게).
 * 빛깔·세기는 beam.css(`--fx-crest-*`)가 테마마다 정한다
 */
export const CREST_TUNE: Readonly<Record<CrestVariant, CrestTune>> = {
  field: { periodMs: 4800, line: { count: 15, gap: 8 }, bloom: { count: 9, gap: 14 } },
  chip: { periodMs: 2000, line: { count: 7, gap: 5 }, bloom: { count: 0, gap: 0 } },
};

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
 * 가장자리 색이 남는 시간을 3.0s → 2.2s로 줄였다. 모서리는 창 모서리(macOS 10px)에 가깝게 12
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
};

export type WaveTune = {
  readonly wave: WaveStyle;
  /** canvas 전체 불투명도. 글 대비를 지키는 마지막 손잡이 */
  readonly opacity: number;
};

/** 테마별 세기. 라이트는 흰 바탕에서 띠 가운데(흰빛)가 사라지므로 색 쪽을 조금 올린다 */
const WAVE_TUNE: Readonly<Record<FxScheme, WaveTune>> = {
  dark: { wave: { ...WAVE_DESKTOP, strength: 0.62, rimStrength: 0.75 }, opacity: 1 },
  light: { wave: { ...WAVE_DESKTOP, strength: 0.7, rimStrength: 0.8 }, opacity: 0.9 },
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
