// 프로필 캔버스 시안 고르기(개발 빌드만, AGE-6). 시안마다 프로필 캔버스와 플러그인 내부 두 부품을 낸다.
// 리드마다 항목 하나씩 더하고 통합 리드가 합친다. 개요 화면(`views/workbench/craft-screen.tsx`)이 이 목록으로 고른다.
import type { MessageId } from "@fresnel/client/i18n";
import type { ComponentType, ReactNode } from "react";
import { PluginInside as CvEInside, ProfileCanvas as CvECanvas } from "./cvE/index.tsx";

interface ProfileCanvasProps {
  /** 머리에 둘 시안 고르기 */
  readonly picker: ReactNode;
  readonly onOpen: (pluginId: string) => void;
}

interface PluginInsideProps {
  readonly picker: ReactNode;
  readonly pluginId: string;
  readonly onBack: () => void;
}

export interface CanvasAlt {
  readonly id: string;
  readonly name: MessageId;
  readonly ProfileCanvas: ComponentType<ProfileCanvasProps>;
  readonly PluginInside: ComponentType<PluginInsideProps>;
}

export const CANVAS_ALTS: readonly CanvasAlt[] = [
  {
    id: "cvE",
    name: "desktop.craft.canvas.cvE.name",
    ProfileCanvas: CvECanvas,
    PluginInside: CvEInside,
  },
];
