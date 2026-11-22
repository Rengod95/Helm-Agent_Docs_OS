import { attempt } from "@fresnel/contracts";
import { useSyncExternalStore } from "react";
import { BUILD_CHECKS } from "../../app/build.ts";

// 프로젝트 패널의 두 꼴(C10). 개발 빌드는 전환기(`project-panel-dev.tsx`)로 바꿔 보고 값을 localStorage에 남긴다. 배포 빌드는 늘 권하는 꼴이다.
// 1 `tree`(폴더 나무, 권함): 프로젝트 아래 하위 폴더가 작은 머리로 서고 그 폴더의 대화가 한 칸 들어간다. 폴더마다 "+"로 그 폴더에서 새 대화.
// 2 `flat`(최근 목록): 프로젝트 아래 대화가 최근 차례 그대로 한 줄씩 서고, 하위 폴더는 줄 끝의 흐린 글로만 보인다.

export const PANEL_VARIANTS = ["tree", "flat"] as const;
export type PanelVariant = (typeof PANEL_VARIANTS)[number];

/** 권하는 꼴이자 배포 빌드의 꼴 */
const DEFAULT_PANEL_VARIANT: PanelVariant = "tree";

const KEY = "fresnel.projects.panel";

function read(): PanelVariant {
  if (!BUILD_CHECKS) return DEFAULT_PANEL_VARIANT;
  const got = attempt(() => localStorage.getItem(KEY));
  const value = got.ok ? got.value : null;
  return PANEL_VARIANTS.find((v) => v === value) ?? DEFAULT_PANEL_VARIANT;
}

let current: PanelVariant | null = null;
const listeners = new Set<() => void>();

function snapshot(): PanelVariant {
  current ??= read();
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setPanelVariant(variant: PanelVariant): void {
  current = variant;
  // 저장이 막힌 창(개인 창, 미리 보기)에서는 이번 실행에만 남는다
  attempt(() => {
    localStorage.setItem(KEY, variant);
  });
  for (const listener of listeners) listener();
}

export function usePanelVariant(): PanelVariant {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_PANEL_VARIANT);
}
