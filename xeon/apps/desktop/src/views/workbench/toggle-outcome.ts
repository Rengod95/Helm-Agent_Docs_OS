// 켜기·끄기 결과 판정(F9). 설정은 저장됐어도 확장이 목표 값에 닿지 않을 수 있다(시작 조건 불충족, 적재 실패).
// 그때 대기 표시를 걷고 사유를 보여 주려고, 목록에서 목표에 못 닿은 대기 항목과 그 사유 코드를 고른다.
import { t } from "@fresnel/client/i18n";
import { isOn } from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";

/** 목표 값에 닿지 못한 대기 켜기·끄기 한 건. `code`는 목록의 마지막 진단 코드이고 진단이 없으면 null이다 */
export interface UnmetToggle {
  readonly name: string;
  readonly target: boolean;
  readonly code: string | null;
}

/** 대기 중인 켜기·끄기 가운데 목록이 목표 값에 닿지 못한 것. 확장이 목록에서 사라졌어도 못 닿은 것으로 본다 */
export function unmetToggleOf(
  entries: readonly ExtListEntry[],
  pending: Readonly<Record<string, boolean>>,
): readonly UnmetToggle[] {
  return Object.entries(pending).flatMap(([name, target]): UnmetToggle[] => {
    const entry = entries.find((item) => item.name === name);
    if (entry !== undefined && isOn(entry) === target) return [];
    return [{ name, target, code: entry?.diagnostics.at(-1)?.code ?? null }];
  });
}

const TRUST_CODES: ReadonlySet<string> = new Set([
  "trust_denied",
  "trust_undecided",
  "trust_exceeds_source",
  "trust_store_corrupt",
]);

/** 진단 코드를 사람 말 사유로 바꾼다. 모르는 코드는 코드 글을 그대로 보인다 */
export function toggleReasonOf(code: string | null): string {
  if (code === null) return t("desktop.workbench.toggle.reason.none");
  if (code === "config_required") return t("desktop.workbench.toggle.reason.configRequired");
  if (TRUST_CODES.has(code)) return t("desktop.workbench.toggle.reason.trust");
  return t("desktop.workbench.toggle.reason.code", { code });
}
