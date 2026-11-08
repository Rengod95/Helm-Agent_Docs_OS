import type { LocalSettings } from "../settings-store/index.ts";
import { LOCAL } from "../settings-store/index.ts";
import {
  DEFAULT_TRANSCRIPT_DETAIL,
  setTranscriptDetailValue,
  transcriptDetailOf,
  type TranscriptDetail,
} from "./transcript-detail.ts";

// 화면 접근성 값(시안 e01 "접근성"): 움직임 줄이기와 확대 비율. 엔진 설정에는 이 키들이 없어(`packages/contracts` 검색) 이 기기의 로컬 설정(`LOCAL`)에 둔다.
// 움직임 줄이기는 `<html data-motion="reduce">`로 걸고 `styles.css`가 미디어 쿼리와 같은 규칙을 건다. 확대는 `<html>`의 `zoom`이다.
// 고대비(강제 색)는 OS가 켜는 것이라 화면 안에서 켤 수 없어 넣지 않았다.
// 대화 기록의 생각·도구 표시 정도도 같은 로컬 설정에 있다. 화면 속성이 아니라 `transcript-detail.ts`의 저장소에 밀어 넣는다.

export const ZOOM_STEPS: readonly number[] = [90, 100, 125, 150, 200];

export type MotionPref = "system" | "reduce";

export interface AppearancePrefs {
  readonly motion: MotionPref;
  /** 퍼센트. `ZOOM_STEPS` 중 하나 */
  readonly zoom: number;
  /** 대화 기록의 생각·도구 표시 정도. 기본은 "full"이다 */
  readonly transcriptDetail: TranscriptDetail;
}

const DEFAULT_APPEARANCE: AppearancePrefs = {
  motion: "system",
  zoom: 100,
  transcriptDetail: DEFAULT_TRANSCRIPT_DETAIL,
};

/** 설정 화면이 쓰는 면. 쓰기는 저장에 성공했는지만 돌려준다. 저장되면 화면에도 바로 건다 */
export interface AppearancePort {
  readonly get: () => AppearancePrefs;
  readonly setMotion: (motion: MotionPref) => Promise<boolean>;
  readonly setZoom: (zoom: number) => Promise<boolean>;
  readonly setTranscriptDetail: (detail: TranscriptDetail) => Promise<boolean>;
}

/** `<html>`에서 쓰는 면 */
export interface AppearanceRoot {
  readonly style: { zoom: string };
  readonly dataset: Record<string, string | undefined>;
}

export function zoomStepOf(zoom: number | undefined): number {
  return zoom !== undefined && ZOOM_STEPS.includes(zoom) ? zoom : DEFAULT_APPEARANCE.zoom;
}

export function appearancePrefsOf(local: Pick<LocalSettings, "get">): AppearancePrefs {
  return {
    motion: local.get(LOCAL.motionReduce) === true ? "reduce" : "system",
    zoom: zoomStepOf(local.get(LOCAL.zoomPercent)),
    transcriptDetail: transcriptDetailOf(local.get(LOCAL.transcriptDetail)),
  };
}

/** 값을 화면에 건다. 100%는 속성을 비워 기본 배치를 그대로 둔다. 대화 기록 표시 정도는 저장소에 민다 */
export function applyAppearance(root: AppearanceRoot, prefs: AppearancePrefs): void {
  if (prefs.motion === "reduce") root.dataset["motion"] = "reduce";
  else delete root.dataset["motion"];
  root.style.zoom = prefs.zoom === 100 ? "" : String(prefs.zoom / 100);
  // 팝오버 자리 보정이 확대 단계를 CSS에서 알 수 있게 한다(styles.css `data-zoom`)
  if (prefs.zoom === 100) delete root.dataset["zoom"];
  else root.dataset["zoom"] = String(prefs.zoom);
  // 시작할 때와 저장한 뒤 모두 이 함수를 거치므로 대화 기록 화면이 저장된 값을 여기서 받는다
  setTranscriptDetailValue(prefs.transcriptDetail);
}

export function appearancePortOf(local: LocalSettings, root: AppearanceRoot): AppearancePort {
  return {
    get: () => appearancePrefsOf(local),
    setMotion: async (motion) => {
      const saved = await local.set(LOCAL.motionReduce, motion === "reduce");
      if (saved.ok) applyAppearance(root, appearancePrefsOf(local));
      return saved.ok;
    },
    setZoom: async (zoom) => {
      const saved = await local.set(LOCAL.zoomPercent, zoomStepOf(zoom));
      if (saved.ok) applyAppearance(root, appearancePrefsOf(local));
      return saved.ok;
    },
    setTranscriptDetail: async (detail) => {
      const saved = await local.set(LOCAL.transcriptDetail, detail);
      if (saved.ok) applyAppearance(root, appearancePrefsOf(local));
      return saved.ok;
    },
  };
}
