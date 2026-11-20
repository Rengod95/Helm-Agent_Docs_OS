// 프로필 캔버스 시안(AGE-31, 개발 빌드만). 다섯째 판 G4(cv5)가 맨 앞에, 넷째 판 G3, 셋째 판 G2, 둘째 판 F·G·H와 첫 판 A~E가 뒤에 선다(비교용). 시안마다 화면 하나(`Screen`)를 낸다:
// 프로필 캔버스와, 노드를 열면 들어가는 플러그인 내부. A·C·F·G·H·G2·G3·G4는 내부 들어가기를 스스로 하고, B·D·E는 캔버스와 내부 두 부품을 낸다.
// 둘을 같은 모양으로 맞추는 얇은 자리만 여기에 둔다. 고르기(왼쪽 아래 전환기, 키 1~8)는 `switcher.tsx`가 한다.
import type { MessageId } from "@fresnel/client/i18n";
import { useState, type ComponentType, type ReactNode } from "react";
import * as cvA from "./cvA/index.tsx";
import * as cvB from "./cvB/index.tsx";
import * as cvC from "./cvC/index.tsx";
import * as cvD from "./cvD/index.tsx";
import * as cvE from "./cvE/index.tsx";
import * as cvF from "./cvF/index.tsx";
import * as cvG from "./cvG/index.tsx";
import * as cvH from "./cvH/index.tsx";
import * as cv3 from "./cv3/index.tsx";
import * as cv4 from "./cv4/index.tsx";
import * as cv5 from "./cv5/index.tsx";

export interface CanvasDesign {
  readonly id: string;
  /** 전환기 칸에 보이는 글자(G2, A~H) */
  readonly letter: string;
  /** 몇째 판인가. 전환기가 새 판을 앞에 두고 판 사이를 가른다 */
  readonly round: 1 | 2 | 3 | 4 | 5;
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

/** E는 원래 시안 고르기를 머리 오른쪽에 받았다. 고르기는 귀퉁이 전환기로 옮겼다 */
function CvEScreen(): ReactNode {
  const [inside, setInside] = useState<string | null>(null);
  if (inside === null) return <cvE.ProfileCanvas onOpen={setInside} picker={null} />;
  return (
    <cvE.PluginInside
      key={inside}
      pluginId={inside}
      picker={null}
      onBack={() => {
        setInside(null);
      }}
    />
  );
}

/** 전환기 순서: 다섯째 판 G4, 넷째 판 G3·셋째 판 G2·둘째 판 F·G·H, 그다음 첫 판 A~E */
export const CANVAS_DESIGNS: readonly CanvasDesign[] = [
  { id: "cv5", letter: "G4", round: 5, name: "desktop.craft.canvas.cv5.name", Screen: cv5.Screen },
  { id: "cv4", letter: "G3", round: 4, name: "desktop.craft.canvas.cv4.name", Screen: cv4.Screen },
  { id: "cv3", letter: "G2", round: 3, name: "desktop.craft.canvas.cv3.name", Screen: cv3.Screen },
  { id: "cvF", letter: "F", round: 2, name: "desktop.craft.canvas.cvF.name", Screen: cvF.Screen },
  { id: "cvG", letter: "G", round: 2, name: "desktop.craft.canvas.cvG.name", Screen: cvG.Screen },
  {
    id: "cvH",
    letter: "H",
    round: 2,
    name: "desktop.craft.canvas.cvH.name",
    Screen: cvH.ProfileCanvas,
  },
  {
    id: "cvA",
    letter: "A",
    round: 1,
    name: "desktop.craft.canvas.cvA.name",
    Screen: cvA.ProfileCanvas,
  },
  { id: "cvB", letter: "B", round: 1, name: "desktop.craft.canvas.cvB.name", Screen: CvBScreen },
  {
    id: "cvC",
    letter: "C",
    round: 1,
    name: "desktop.craft.canvas.cvC.name",
    Screen: cvC.ProfileCanvas,
  },
  { id: "cvD", letter: "D", round: 1, name: "desktop.craft.canvas.cvD.name", Screen: CvDScreen },
  { id: "cvE", letter: "E", round: 1, name: "desktop.craft.canvas.cvE.name", Screen: CvEScreen },
];
