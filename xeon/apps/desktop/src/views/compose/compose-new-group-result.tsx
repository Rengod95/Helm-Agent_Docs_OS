// "새 그룹"의 결과 부품(§6.28.1): 만든 곳과 파일, 검사 띠, 묶음 결과와 실패 문장. 결과 모양(`CreateResult`)과 명령 표식(`Working`)도 여기서 정한다.
import { t } from "@fresnel/client/i18n";
import { devkitSummaryOf } from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import type { DevkitIssue, PackResult } from "@fresnel/contracts/services";
import { Alert, Button } from "@caustic/react";
import type { ReactNode } from "react";
import { issueToneOf } from "./compose-check.tsx";
import { MONO } from "./compose-new-group-form.tsx";

export type DirCheck =
  | { readonly kind: "done"; readonly issues: readonly DevkitIssue[] }
  | { readonly kind: "failed" };

export type PackRead =
  | { readonly kind: "idle" }
  | { readonly kind: "failed" }
  | { readonly kind: "done"; readonly result: PackResult };

/** 만든 뒤의 결과. 검사와 묶음은 같은 폴더를 가리킨다 */
interface MadeGroup {
  readonly kind: "made";
  readonly dir: string;
  readonly files: readonly string[];
  readonly check: DirCheck;
  readonly pack: PackRead;
}

export type CreateResult = { readonly kind: "failed"; readonly issue: string | null } | MadeGroup;

/** 지금 보내고 있는 명령. 같은 명령의 단추에만 도는 표식을 단다 */
export type Working = "create" | "recheck" | "pack" | null;

function summaryTextOf(errors: number, warnings: number): string {
  if (errors === 0 && warnings === 0) return t("desktop.compose.newGroup.check.passed");
  const parts: string[] = [];
  if (errors > 0) parts.push(t("desktop.compose.newGroup.check.errors", { count: errors }));
  if (warnings > 0) parts.push(t("desktop.compose.newGroup.check.warnings", { count: warnings }));
  return parts.join(" ");
}

/** `ext.validate` 결과: 개수로 요약하는 띠 하나와 문제 줄들. 오류는 danger, 경고만 있으면 warning, 없으면 success */
export function CheckNotice(props: { readonly check: DirCheck }): ReactNode {
  const { check } = props;
  if (check.kind === "failed") {
    return (
      <Alert tone="warning" variant="soft" size="sm">
        {t("desktop.compose.newGroup.check.failed")}
      </Alert>
    );
  }
  const { errors, warnings } = devkitSummaryOf(check.issues);
  const tone = errors > 0 ? "danger" : warnings > 0 ? "warning" : "success";
  return (
    <div className="grid gap-2">
      <Alert tone={tone} variant="soft" size="sm">
        {summaryTextOf(errors, warnings)}
      </Alert>
      {check.issues.length === 0 ? null : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {check.issues.map((issue) => (
            <li
              key={`${issue.code}:${issue.path}:${issue.message}`}
              className={`text-footnote ${issueToneOf(issue.severity)}`}
            >
              <span className="font-mono">{issue.code}</span> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 만들지 못한 까닭. 호스트가 준 거절 문장이 있으면 그대로 보이고, 없으면 일반 문장이다 */
export function FailedNotice(props: { readonly issue: string | null }): ReactNode {
  return (
    <Alert tone="danger" variant="soft" size="sm">
      {props.issue ?? t("desktop.compose.newGroup.failed")}
    </Alert>
  );
}

function PackNote(props: { readonly pack: PackRead }): ReactNode {
  const { pack } = props;
  switch (pack.kind) {
    case "idle":
      return null;
    case "failed":
      return (
        <Alert tone="danger" variant="soft" size="sm">
          {t("desktop.compose.newGroup.pack.failed")}
        </Alert>
      );
    case "done":
      return (
        <dl className="m-0 grid gap-2 text-ui-sm">
          <div className="grid gap-0.5">
            <dt className="text-text-tertiary">{t("desktop.compose.newGroup.pack.path")}</dt>
            <dd className={MONO}>{pack.result.path}</dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-text-tertiary">{t("desktop.compose.newGroup.pack.hash")}</dt>
            <dd className={MONO}>{pack.result.sha256}</dd>
          </div>
        </dl>
      );
    default:
      return assertNever(pack, "PackRead");
  }
}

/** 만든 뒤의 결과: 위치, 만든 파일, 검사, 그리고 다시 돌리기와 묶음 만들기 */
export function MadeResult(props: {
  readonly made: MadeGroup;
  readonly working: Working;
  readonly onRecheck: () => void;
  readonly onPack: () => void;
}): ReactNode {
  const { made, working } = props;
  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <span className="text-title-3 text-text-primary">
          {t("desktop.compose.newGroup.made.dir")}
        </span>
        <p className={MONO}>{made.dir}</p>
      </div>
      <div className="grid gap-1">
        <span className="text-title-3 text-text-primary">
          {t("desktop.compose.newGroup.made.files")}
        </span>
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {made.files.map((file) => (
            <li key={file} className="truncate font-mono text-mono-sm text-text-secondary">
              {file}
            </li>
          ))}
        </ul>
      </div>
      <CheckNotice check={made.check} />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={working !== null}
          loading={working === "recheck"}
          onClick={props.onRecheck}
        >
          {t("desktop.compose.newGroup.recheck")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={working !== null}
          loading={working === "pack"}
          onClick={props.onPack}
        >
          {t("desktop.compose.newGroup.pack")}
        </Button>
      </div>
      <PackNote pack={made.pack} />
    </div>
  );
}
