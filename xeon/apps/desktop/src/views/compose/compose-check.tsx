// 구성 검사(`ext.validateComposition`)의 읽기 상태와 띠(§6.28.1, DP-28). 설치 그룹의 블록 검사와 흐름 초안 검사가 함께 쓴다.
// 초안 검사는 후보가 바뀔 때마다 다시 읽고, 지난 후보의 결과는 쓰지 않는다. 연결이 없으면 검사하지 않는다.
import { t } from "@fresnel/client/i18n";
import { issueSummaryOf, type TabLink } from "@fresnel/client/workbench";
import { detach, rethrow } from "@fresnel/contracts";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { WireManifestIssue } from "@fresnel/contracts/wire";
import { Alert } from "@caustic/react";
import { useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";

/** 검사 읽기. 구성이 선언되어 있을 때만 부른다 */
export type CheckRead =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "done"; readonly issues: readonly WireManifestIssue[] };

export function CheckBanner(props: { readonly check: CheckRead }): ReactNode {
  const { check } = props;
  if (check.kind === "loading") return null;
  if (check.kind === "failed")
    return <Alert tone="warning">{t("desktop.compose.check.failed")}</Alert>;
  const { errors, warnings } = issueSummaryOf(check.issues);
  if (errors === 0 && warnings === 0) return null;
  return (
    <Alert tone={errors > 0 ? "danger" : "warning"}>
      {errors > 0 ? t("desktop.compose.check.errors", { count: errors }) : null}
      {errors > 0 && warnings > 0 ? " " : null}
      {warnings > 0 ? t("desktop.compose.check.warnings", { count: warnings }) : null}
    </Alert>
  );
}

/** 검사 이슈 줄들: 코드와 문장. 띠의 개수 밑에 모두 보여 경고도 숨기지 않는다 */
export function IssueList(props: { readonly issues: readonly WireManifestIssue[] }): ReactNode {
  if (props.issues.length === 0) return null;
  return (
    <ul className="m-0 grid list-none gap-1.5 p-0">
      {props.issues.map((issue) => (
        <li
          key={`${issue.code}:${issue.path}:${issue.message}`}
          className="text-ui-sm text-text-secondary"
        >
          <span className="font-mono">{issue.code}</span> {issue.message}
        </li>
      ))}
    </ul>
  );
}

interface DraftRead {
  readonly candidate: CompositionDecl;
  readonly check: CheckRead;
}

/**
 * 흐름 초안의 검사. `candidate`는 초안을 `CompositionDecl`로 되돌린 값이라 초안이 바뀔 때만 새 객체여야 한다(호출자가 `useMemo`로 묶는다).
 * 결과에는 그 후보를 함께 적어 두고, 지금 후보와 다르면 `loading`으로 본다. 그래서 바뀐 뒤 옛 결과로 만들기가 열리지 않는다.
 */
export function useDraftCheck(candidate: CompositionDecl | null, link: TabLink): CheckRead {
  const commands = useCommands();
  const [last, setLast] = useState<DraftRead | null>(null);
  useEffect(() => {
    if (candidate === null || link !== "live") return undefined;
    let active = true;
    const run = async (): Promise<void> => {
      const got = await commands.workbench.validateComposition(candidate);
      if (!active) return;
      setLast({
        candidate,
        check: got.ok ? { kind: "done", issues: got.value.issues } : { kind: "failed" },
      });
    };
    detach(run(), rethrow);
    return () => {
      active = false;
    };
  }, [commands, candidate, link]);
  if (candidate === null || link !== "live") return { kind: "loading" };
  return last?.candidate === candidate ? last.check : { kind: "loading" };
}
