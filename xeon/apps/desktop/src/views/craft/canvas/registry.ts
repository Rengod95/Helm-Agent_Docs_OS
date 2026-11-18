// 프로필 캔버스 시안 목록(개발 빌드만, AGE-6). 시안마다 프로필 캔버스와 플러그인 내부 두 부품을 낸다. 리드마다 한 항목씩 더한다.
// 개요 화면(`views/workbench/craft-screen.tsx`)이 `CanvasDraftHost`로 지금 캔버스와 시안 사이를 바꾼다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { Select, SelectOption } from "@caustic/react";
import { createElement, useState, type ComponentType, type ReactNode } from "react";
import { BUILD_CHECKS } from "../../../app/build.ts";
import * as cvD from "./cvD/index.tsx";

interface ProfileCanvasProps {
  readonly onOpen: (pluginId: string) => void;
  readonly picker: ReactNode;
}

interface PluginInsideProps {
  readonly pluginId: string;
  readonly onBack: () => void;
  readonly onOpen: (pluginId: string) => void;
  readonly picker: ReactNode;
}

interface CanvasDraft {
  readonly id: string;
  readonly name: MessageId;
  readonly ProfileCanvas: ComponentType<ProfileCanvasProps>;
  readonly PluginInside: ComponentType<PluginInsideProps>;
}

const CANVAS_DRAFTS: readonly CanvasDraft[] = [
  {
    id: "cvD",
    name: "desktop.craft.canvas.cvD.name",
    ProfileCanvas: cvD.ProfileCanvas,
    PluginInside: cvD.PluginInside,
  },
];

const KEY = "fresnel.craft.canvasDraft";
/** 지금 캔버스(시안 아님) */
export const CURRENT = "current";

function stored(): string {
  if (!BUILD_CHECKS) return CURRENT;
  const value = localStorage.getItem(KEY) ?? CURRENT;
  return CANVAS_DRAFTS.some((d) => d.id === value) ? value : CURRENT;
}

/** 고른 시안(localStorage에 남는다. 찍기 도구가 미리 정할 수 있다) */
export function useCanvasDraft(): readonly [string, (id: string) => void] {
  const [choice, setChoice] = useState<string>(stored);
  return [
    choice,
    (id) => {
      localStorage.setItem(KEY, id);
      setChoice(id);
    },
  ];
}

export function CanvasDraftPicker(props: {
  readonly value: string;
  readonly onValueChange: (id: string) => void;
}): ReactNode {
  return createElement(
    Select,
    {
      size: "sm",
      "aria-label": t("desktop.craft.canvas.cvD.picker.label"),
      value: props.value,
      onValueChange: props.onValueChange,
      className: "w-full",
    },
    createElement(SelectOption, { value: CURRENT }, t("desktop.craft.canvas.cvD.picker.current")),
    ...CANVAS_DRAFTS.map((d) => createElement(SelectOption, { key: d.id, value: d.id }, t(d.name))),
  );
}

/** 시안 하나를 띄우고 프로필 캔버스 ↔ 플러그인 내부를 잇는다 */
export function CanvasDraftHost(props: {
  readonly id: string;
  readonly picker: ReactNode;
}): ReactNode {
  const draft = CANVAS_DRAFTS.find((d) => d.id === props.id);
  const [inside, setInside] = useState<string | null>(null);
  if (draft === undefined) return null;
  if (inside !== null)
    return createElement(draft.PluginInside, {
      key: inside,
      pluginId: inside,
      onBack: () => setInside(null),
      onOpen: setInside,
      picker: props.picker,
    });
  return createElement(draft.ProfileCanvas, { onOpen: setInside, picker: props.picker });
}
