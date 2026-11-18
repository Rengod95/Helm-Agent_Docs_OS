// 프로필 캔버스 시안 목록(개발 빌드에서만 고른다). 시안마다 프로필 캔버스와 플러그인 내부 두 부품을 낸다.
// 리드마다 한 항목씩 더하고, 통합은 메인 세션이 한다. 고르기는 `views/workbench/craft-screen.tsx`가 한다.
import type { MessageId } from "@fresnel/client/i18n";
import type { ComponentType } from "react";
import { PluginInside as CvBInside, ProfileCanvas as CvBCanvas } from "./cvB/index.tsx";

interface ProfileCanvasProps {
  readonly onOpen: (pluginId: string) => void;
}

interface PluginInsideProps {
  readonly pluginId: string;
  readonly onBack: () => void;
  readonly onOpen: (pluginId: string) => void;
}

export interface CanvasDesign {
  readonly id: string;
  readonly name: MessageId;
  readonly ProfileCanvas: ComponentType<ProfileCanvasProps>;
  readonly PluginInside: ComponentType<PluginInsideProps>;
}

export const CANVAS_DESIGNS: readonly CanvasDesign[] = [
  {
    id: "cvB",
    name: "desktop.craft.canvas.cvB.name",
    ProfileCanvas: CvBCanvas,
    PluginInside: CvBInside,
  },
];
