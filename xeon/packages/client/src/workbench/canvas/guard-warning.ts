// 순서 저장 전 경고 모델. 문구는 없고 이름과 wire 열거값만 담는다. 화면이 문구를 입힌다.
import type { HooksOrderPreviewResult, HookSkipNote } from "./order-wire.ts";

/** none은 바로 저장, skip과 guard는 `그대로 저장`을 묻는다. guard가 더 강하다 */
type WarningSeverity = "none" | "skip" | "guard";

interface SkippedHandler {
  readonly registrationId: string;
  readonly name: string;
  readonly reason: HookSkipNote["reason"];
  readonly by: readonly string[];
}

export interface OrderWarning {
  readonly severity: WarningSeverity;
  readonly skipped: readonly SkippedHandler[];
  readonly guardLosesFirst: readonly string[];
  readonly guardMayBeSkipped: readonly string[];
  readonly valueChanges: readonly string[];
  readonly autoDisable: readonly string[];
}

/** 미리보기를 화면이 읽을 경고 모델로 바꾼다. 이름은 nameOf가 정한다 */
export function buildOrderWarning(
  preview: HooksOrderPreviewResult,
  nameOf: (registrationId: string) => string,
): OrderWarning {
  const skipped = preview.skips.map((s) => ({
    registrationId: s.registrationId,
    name: nameOf(s.registrationId),
    reason: s.reason,
    by: s.by.map((r) => nameOf(r.registrationId)),
  }));
  const guardLosesFirst = preview.guardRisk
    .filter((g) => g.losesFirstPosition)
    .map((g) => nameOf(g.registrationId));
  const guardMayBeSkipped = preview.guardRisk
    .filter((g) => g.mayBeSkipped)
    .map((g) => nameOf(g.registrationId));
  const valueChanges = preview.valueChanges.map((v) => nameOf(v.registrationId));
  const autoDisable = preview.autoDisable.map((a) => nameOf(a.registrationId));

  let severity: WarningSeverity = "none";
  if (skipped.length > 0 || valueChanges.length > 0 || autoDisable.length > 0) severity = "skip";
  // guard 위험은 건너뜀 경고를 덮는다: 같은 자리에서 더 강한 문구를 보이기 위해서다
  if (guardLosesFirst.length > 0 || guardMayBeSkipped.length > 0) severity = "guard";

  return { severity, skipped, guardLosesFirst, guardMayBeSkipped, valueChanges, autoDisable };
}

/** 확인을 물을지. none이 아니면 `그대로 저장`을 묻는다 */
export function needsConfirm(warning: OrderWarning): boolean {
  return warning.severity !== "none";
}
