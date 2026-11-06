// 지도에 보이는 이름: 층, 상태, 점의 말. 문장은 전부 번역 키로 만들고, 이 파일만 `t`를 부른다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { CanvasPlugin, LayerKey } from "@fresnel/client/workbench/canvas";
import { isOn } from "@fresnel/client/workbench/canvas";

/** 층의 이름(코드 없이). 외부 플러그인은 "외부"다 */
export function layerName(layer: LayerKey): string {
  switch (layer) {
    case "L1":
      return t("term.layerAgentCore");
    case "L2":
      return t("term.capability");
    case "L3":
      return t("term.layerOrchestration");
    case "plugin":
      return t("desktop.craft.orbit.layer.plugin");
    default:
      return assertNever(layer, "layerName");
  }
}

/** 층의 제목: 고리 이름표와 층 패널 머리("L1 에이전트 코어"). 외부는 이름만 */
export function layerTitle(layer: LayerKey): string {
  if (layer === "plugin") return layerName(layer);
  return t("desktop.craft.orbit.ringName", { code: layer, name: layerName(layer) });
}

/** 주도 중인 점: 주도를 선언했고 켜져 있고 실패가 없다 */
export const isLead = (p: CanvasPlugin): boolean =>
  p.drives === true && isOn(p) && p.health === undefined;

/** 점의 상태 말: 실패와 자동 꺼짐은 색과 함께 글로도 적는다 */
export function stateText(p: CanvasPlugin): string {
  if (p.health?.autoOff === true) return t("desktop.craft.orbit.state.autoOff");
  if (p.health !== undefined) return t("desktop.craft.orbit.state.failing");
  if (isLead(p)) return t("desktop.craft.orbit.state.lead");
  return isOn(p) ? t("desktop.craft.orbit.state.on") : t("desktop.craft.orbit.state.off");
}
