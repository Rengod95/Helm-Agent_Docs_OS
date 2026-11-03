// Fresnel 런타임 일러스트 세트. SVG 원문을 ?raw로 읽어 인라인으로 그린다(CSS 변수로 테마가 바뀌려면 인라인이어야 한다).
// 쓰는 법: import "../_art/art.css"; <Art name="hero-lifecycle" className="w-[640px]" />
// 그라디언트 id는 인스턴스마다 접두어를 붙여 밝음·어두움 사본이 한 페이지에 있어도 섞이지 않는다.
import { createElement, useId, useMemo } from "react";
import emptyContext from "./empty-context.svg?raw";
import emptyNoPlugins from "./empty-no-plugins.svg?raw";
import emptyOffline from "./empty-offline.svg?raw";
import heroLifecycleActive from "./hero-lifecycle-active.svg?raw";
import heroLifecycle from "./hero-lifecycle.svg?raw";
import layerStackInsert from "./layer-stack-insert.svg?raw";
import layerStack from "./layer-stack.svg?raw";
import spotCapability from "./spot-capability.svg?raw";
import spotContext from "./spot-context.svg?raw";
import spotHook from "./spot-hook.svg?raw";
import spotIntentGroup from "./spot-intent-group.svg?raw";
import spotPlugin from "./spot-plugin.svg?raw";
import spotProfile from "./spot-profile.svg?raw";
import spotReplay from "./spot-replay.svg?raw";
import spotTrial from "./spot-trial.svg?raw";

export { anchors } from "./anchors";

export const artSvgs = {
  "hero-lifecycle": heroLifecycle,
  "hero-lifecycle-active": heroLifecycleActive,
  "layer-stack": layerStack,
  "layer-stack-insert": layerStackInsert,
  "spot-plugin": spotPlugin,
  "spot-intent-group": spotIntentGroup,
  "spot-context": spotContext,
  "spot-profile": spotProfile,
  "spot-trial": spotTrial,
  "spot-replay": spotReplay,
  "spot-hook": spotHook,
  "spot-capability": spotCapability,
  "empty-no-plugins": emptyNoPlugins,
  "empty-context": emptyContext,
  "empty-offline": emptyOffline,
} as const;

export type ArtName = keyof typeof artSvgs;

/** 크기 기준(viewBox): 영웅 640×400, 층 쌓기 400×380, 개념 160×120, 빈 상태 240×160 */
export const artSize: Record<ArtName, { w: number; h: number }> = Object.fromEntries(
  Object.entries(artSvgs).map(([k, svg]) => {
    const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    return [k, { w: Number(m?.[1] ?? 0), h: Number(m?.[2] ?? 0) }];
  }),
) as Record<ArtName, { w: number; h: number }>;

function scoped(svg: string, prefix: string): string {
  return svg
    .replace(/id="a-/g, `id="${prefix}a-`)
    .replace(/url\(#a-/g, `url(#${prefix}a-`)
    .replace("<svg ", '<svg class="xart" ');
}

export interface ArtProps {
  name: ArtName;
  className?: string;
  /** 접근 이름. 장식이면 비워 두면 aria-hidden */
  label?: string;
}

export function Art({ name, className, label }: ArtProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const html = useMemo(() => {
    let s = scoped(artSvgs[name], `${id}-`);
    s =
      label === undefined
        ? s.replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"')
        : s.replace(/aria-label="[^"]*"/, `aria-label="${label.replace(/"/g, "&quot;")}"`);
    return s;
  }, [name, id, label]);
  return createElement("span", {
    className: ["block", className].filter(Boolean).join(" "),
    dangerouslySetInnerHTML: { __html: html },
  });
}
