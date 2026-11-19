// Hook 자리와 블록의 화면 말. 내부 이름(`tool.call.before`)을 보이지 않고 블록 이름 + 앞·뒤·중으로 말한다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { BLOCK_IDS, blockLabelOf, hookPlaceOf, type BlockId, type HookPlace } from "./model.ts";

export function placeText(place: HookPlace, locale: string): string {
  switch (place.kind) {
    case "block":
      return `${blockLabelOf(place.block, locale)} ${t(
        place.side === "before"
          ? "desktop.craft.trace.side.before"
          : place.side === "after"
            ? "desktop.craft.trace.side.after"
            : "desktop.craft.trace.side.event",
      )}`;
    case "boundary":
      return locale.startsWith("ko") ? place.label.ko : place.label.en;
    case "unknown":
      return "";
    default:
      return assertNever(place, "HookPlace");
  }
}

function isBlockId(ref: string): ref is BlockId {
  return BLOCK_IDS.some((b) => b === ref);
}

/** 인사이트 대상의 참조 글. Hook은 자리로, 블록은 블록 이름으로, 나머지(도구·스킬·지침 이름)는 그대로다 */
export function subjectRefText(kind: string, ref: string, locale: string): string {
  if (kind === "hook") {
    const place = hookPlaceOf(ref);
    return place.kind === "unknown" ? "" : placeText(place, locale);
  }
  if (kind === "block") return isBlockId(ref) ? blockLabelOf(ref, locale) : "";
  return ref;
}
