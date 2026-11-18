// 프로필 캔버스 시안 다섯(AGE-31, 개발 빌드만). 시안마다 화면 하나(`Screen`)를 낸다: 프로필 캔버스와, 노드를 열면 들어가는 플러그인 내부.
// 시안 A·C는 내부 들어가기를 스스로 하고, B·D·E는 캔버스와 내부 두 부품을 낸다. 둘을 같은 모양으로 맞추는 얇은 자리만 여기에 둔다.
// 고르기(귀퉁이 전환기, 키 1~5)는 `switcher.tsx`가 한다.
import type { MessageId } from "@fresnel/client/i18n";
import { useState, type ComponentType, type ReactNode } from "react";
import * as cvA from "./cvA/index.tsx";
import * as cvB from "./cvB/index.tsx";
import * as cvC from "./cvC/index.tsx";
import * as cvD from "./cvD/index.tsx";

export interface CanvasDesign {
  readonly id: string;
  /** 전환기 칸에 보이는 글자(A~E) */
  readonly letter: string;
  /** 전환기 칸의 이름(툴팁·화면 읽기) */
  readonly name: MessageId;
  readonly Screen: ComponentType;
}

/** 캔버스 ↔ 플러그인 내부를 이 자리에서 잇는다(B의 원래 고르기 자리가 한 방식 그대로) */
function CvBScreen(): ReactNode {
  const [inside, setInside] = useState<string | null>(null);
  if (inside === null) return <cvB.ProfileCanvas onOpen={setInside} />;
  return (
    <cvB.PluginInside
      key={inside}
      pluginId={inside}
      onOpen={setInside}
      onBack={() => {
        setInside(null);
      }}
    />
  );
}

/** D는 원래 시안 고르기를 목록 판 아래에 받았다. 고르기는 귀퉁이 전환기로 옮겼으므로 빈 자리를 준다 */
function CvDScreen(): ReactNode {
  const [inside, setInside] = useState<string | null>(null);
  if (inside === null) return <cvD.ProfileCanvas onOpen={setInside} picker={null} />;
  return (
    <cvD.PluginInside
      key={inside}
      pluginId={inside}
      onOpen={setInside}
      picker={null}
      onBack={() => {
        setInside(null);
      }}
    />
  );
}

export const CANVAS_DESIGNS: readonly CanvasDesign[] = [
  { id: "cvA", letter: "A", name: "desktop.craft.canvas.cvA.name", Screen: cvA.ProfileCanvas },
  { id: "cvB", letter: "B", name: "desktop.craft.canvas.cvB.name", Screen: CvBScreen },
  { id: "cvC", letter: "C", name: "desktop.craft.canvas.cvC.name", Screen: cvC.ProfileCanvas },
  { id: "cvD", letter: "D", name: "desktop.craft.canvas.cvD.name", Screen: CvDScreen },
];
