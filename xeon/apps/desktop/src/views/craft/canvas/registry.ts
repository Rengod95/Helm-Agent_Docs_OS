// 프로필 캔버스 시안 고르기(개발 빌드만). 시안마다 프로필 캔버스와 플러그인 내부 두 부품을 낸다.
// 리드마다 항목 하나씩 더하고 통합 리드가 합친다. 개요 화면(`views/workbench/craft-screen.tsx`)이 이 목록으로 시안을 바꾼다.
import type { MessageId } from "@fresnel/client/i18n";
import type { ComponentType } from "react";
import { PluginInside as CvAInside, ProfileCanvas as CvACanvas } from "./cvA/index.tsx";

export interface CanvasDesign {
  readonly id: string;
  readonly name: MessageId;
  readonly ProfileCanvas: ComponentType;
  readonly PluginInside: ComponentType<{ readonly plugin: string; readonly onBack: () => void }>;
}

export const CANVAS_DESIGNS: readonly CanvasDesign[] = [
  {
    id: "cvA",
    name: "desktop.craft.canvas.cvA.name",
    ProfileCanvas: CvACanvas,
    PluginInside: CvAInside,
  },
];
