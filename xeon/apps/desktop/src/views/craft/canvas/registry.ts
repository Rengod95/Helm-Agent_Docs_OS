// 프로필 캔버스 시안 목록(개발 빌드의 시안 고르기, AGE-6). 리드마다 항목 하나를 더한다. 통합은 나중에 한 리드가 한다.
import type { MessageId } from "@fresnel/client/i18n";
import type { ComponentType } from "react";
import {
  PluginInside as CvCInside,
  ProfileCanvas as CvCCanvas,
  type PluginInsideProps,
} from "./cvC/index.tsx";

export interface CanvasAlt {
  readonly id: string;
  /** 고르기에 보이는 이름 */
  readonly name: MessageId;
  readonly ProfileCanvas: ComponentType;
  readonly PluginInside: ComponentType<PluginInsideProps>;
}

export const CANVAS_ALTS: readonly CanvasAlt[] = [
  {
    id: "cvC",
    name: "desktop.craft.canvas.cvC.name",
    ProfileCanvas: CvCCanvas,
    PluginInside: CvCInside,
  },
];
