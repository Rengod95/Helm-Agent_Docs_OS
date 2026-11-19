// 화면 사이에 남기는 cvB 상태(프로필 캔버스 → 플러그인 내부 → 돌아오기). 시안이라 저장하지 않고 앱이 떠 있는 동안만 둔다.
import type { ProfileState } from "./model.ts";
import { initialScene } from "../shared-sample.ts";
import { EMPTY_PROFILE, SAMPLE_PROFILE, SCALE_PROFILE } from "./sample.ts";

/** 보는 프로필의 출처: 표본("sample"), 빈 프로필("empty"), 노드 30개("scale"), 실제 프로필("real:<id>") */
export type Source = string;

export interface CanvasMemory {
  source: Source;
  state: ProfileState;
  open: ReadonlySet<string>;
  selected: string | null;
}

const SCENE = initialScene();

export const memory: CanvasMemory = {
  source: SCENE === "dev" ? "sample" : SCENE,
  state: SCENE === "empty" ? EMPTY_PROFILE : SCENE === "scale" ? SCALE_PROFILE : SAMPLE_PROFILE,
  open: new Set(["quality"]),
  selected: null,
};
