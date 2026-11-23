// 플러그인 상세 "구성" 탭의 검사(`ext.validateComposition`)의 읽기 상태와 띠(§6.28.1, DP-28). 구성이 선언되어 있을 때만 검사하고, 연결이 없으면 검사하지 않는다.
import { t } from "@fresnel/client/i18n";
import { issueSummaryOf, type TabLink } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { WireManifestIssue } from "@fresnel/contracts/wire";
import { Alert } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../../commands.ts";

/** 검사 읽기. 구성이 선언되어 있을 때만 부른다 */
export type CheckRead =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "done"; readonly issues: readonly WireManifestIssue[] };

/** 구성 검사 한 번 읽기. 연결이 살아 있을 때 `validateComposition`을 부르고, 결과를 읽기 상태로 바꾼다 */
export function useCompositionCheck(composition: CompositionDecl | null, link: TabLink): CheckRead {
  const commands = useCommands();
  const [read, setRead] = useState<CheckRead>({ kind: "loading" });
  useEffect(() => {
    if (composition === null || link !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const got = await commands.workbench.validateComposition(composition);
      if (!active) return;
      setRead(got.ok ? { kind: "done", issues: got.value.issues } : { kind: "failed" });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, composition, link]);
  return read;
}

/** 검사 띠: 읽는 중이면 아무것도 없고, 못 읽었으면 경고 한 줄, 막힌 곳이 있으면 개수를 보인다 */
export function CheckBanner(props: { readonly check: CheckRead }): ReactNode {
  const { check } = props;
  if (check.kind === "loading") return null;
  if (check.kind === "failed")
    return (
      <Alert tone="warning" variant="soft" size="sm">
        {t("desktop.craft.composition.check.failed")}
      </Alert>
    );
  const { errors, warnings } = issueSummaryOf(check.issues);
  if (errors === 0 && warnings === 0) return null;
  return (
    <Alert tone={errors > 0 ? "danger" : "warning"} variant="soft" size="sm">
      {errors > 0 ? t("desktop.craft.composition.check.errors", { count: errors }) : null}
      {errors > 0 && warnings > 0 ? " " : null}
      {warnings > 0 ? t("desktop.craft.composition.check.warnings", { count: warnings }) : null}
    </Alert>
  );
}
