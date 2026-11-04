// 구성기의 그룹 보기와 흐름 보기(§6.28.1, §6.28.2). 설치 그룹의 매니페스트 `group.composition`을 읽기 전용으로 보인다.
// 선언이 없으면 "구성 정보 없음" 블록 하나, 단계 선언이 없으면 "단계 선언이 없어요"다. 훅 이름으로 짐작하지 않는다.
// 검사는 `ext.validateComposition`이고 막힌 곳이 있으면 목록 위에 Alert 하나로 보인다(DP-28).
import { t } from "@fresnel/client/i18n";
import {
  blockRowsOf,
  compositionOf,
  issueSummaryOf,
  issuesByBlockOf,
  phaseRowsOf,
  type BlockRow,
  type PhaseRow,
  type TabLink,
  type TabRead,
} from "@fresnel/client/workbench";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { WireManifestIssue } from "@fresnel/contracts/wire";
import { Alert, Badge, Button, EmptyState, Skeleton } from "@caustic/react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useCommands } from "../commands.ts";
import { InfoTip } from "../craft/info-tip.tsx";
import { useTabRead } from "../workbench/tab-read.ts";
import { NODE_TEXT, OP_TEXT, PRODUCT_TEXT } from "./compose-text.ts";

const MUTED = "m-0 text-ui-sm text-text-tertiary";

/** 검사 읽기. 구성이 선언되어 있을 때만 부른다 */
export type CheckRead =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "done"; readonly issues: readonly WireManifestIssue[] };

function useCheck(composition: CompositionDecl | null, link: TabLink): CheckRead {
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

function Loading(): ReactNode {
  return (
    <div role="status" aria-busy="true" className="grid gap-2">
      <span className="sr-only">{t("desktop.compose.loading")}</span>
      {[0, 1, 2].map((line) => (
        <Skeleton key={line} height={48} />
      ))}
    </div>
  );
}

/** 읽기 상태 가르기. 값이 있으면 `children`을 그린다 */
export function ReadGate<T>(props: {
  readonly read: TabRead<T>;
  readonly onRetry: () => void;
  readonly children: (value: T) => ReactNode;
}): ReactNode {
  const { read } = props;
  switch (read.kind) {
    case "loading":
      return <Loading />;
    case "offline":
      return <p className={MUTED}>{t("desktop.compose.offline")}</p>;
    case "error":
      return (
        <Alert
          tone="danger"
          action={
            <Button size="xs" variant="outline" onClick={props.onRetry}>
              {t("desktop.compose.retry")}
            </Button>
          }
        >
          {t("desktop.compose.loadFailed")}
        </Alert>
      );
    case "ready":
      return (
        <div className="grid gap-3">
          {read.stale ? <p className={MUTED}>{t("desktop.compose.stale")}</p> : null}
          {props.children(read.value)}
        </div>
      );
    default:
      return assertNever(read, "TabRead");
  }
}

function CheckBanner(props: { readonly check: CheckRead }): ReactNode {
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

function BlockCard(props: {
  readonly row: BlockRow;
  readonly issues: readonly WireManifestIssue[];
}): ReactNode {
  const { row, issues } = props;
  const invalid = issues.some((issue) => issue.severity === "error");
  return (
    <li
      className={`grid gap-1.5 rounded-lg border p-3 ${invalid ? "border-danger" : "border-border-subtle"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-ui-sm font-semibold text-text-primary">{row.title}</h3>
        <Badge size="xs" mono>
          {t(OP_TEXT[row.op])}
        </Badge>
        <Badge size="xs" mono variant="outline">
          {row.stage}
        </Badge>
      </div>
      {row.summary === null ? null : <p className={MUTED}>{row.summary}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {row.hooks.map((hook) => (
          <Badge key={`hook:${hook}`} size="xs" mono variant="outline">
            {hook}
          </Badge>
        ))}
        {row.consumes.map((id) => (
          <Badge key={`use:${id}`} size="xs" mono variant="outline">
            {t("desktop.compose.block.consumes", { id })}
          </Badge>
        ))}
        {row.produces.map((product) => (
          <Badge
            key={`out:${product.kind}:${product.recordKind ?? ""}`}
            size="xs"
            mono
            variant="outline"
          >
            {t(PRODUCT_TEXT[product.kind])}
            {product.recordKind === null ? "" : ` ${product.recordKind}`}
          </Badge>
        ))}
      </div>
      {issues.map((issue) => (
        <p
          key={`${issue.code}:${issue.path}`}
          role="alert"
          className="m-0 text-ui-sm text-text-secondary"
        >
          <span className="font-mono">{issue.code}</span> {issue.message}
        </p>
      ))}
    </li>
  );
}

export function NoComposition(): ReactNode {
  return (
    <EmptyState
      size="sm"
      surface="none"
      title={t("desktop.compose.none.title")}
      description={t("desktop.compose.none.body")}
    />
  );
}

/** 블록 목록과 검사 띠. 검사 값은 호출자가 읽어 준다 */
export function GroupBlocks(props: {
  readonly composition: CompositionDecl;
  readonly check: CheckRead;
}): ReactNode {
  const issues = props.check.kind === "done" ? props.check.issues : [];
  const byBlock = issuesByBlockOf(props.composition, issues);
  return (
    <>
      <CheckBanner check={props.check} />
      <ul aria-label={t("desktop.compose.blocks")} className="m-0 grid list-none gap-2 p-0">
        {blockRowsOf(props.composition).map((row) => (
          <BlockCard key={row.id} row={row} issues={byBlock.get(row.id) ?? []} />
        ))}
      </ul>
    </>
  );
}

function GroupBody(props: {
  readonly composition: CompositionDecl;
  readonly link: TabLink;
}): ReactNode {
  const check = useCheck(props.composition, props.link);
  return <GroupBlocks composition={props.composition} check={check} />;
}

function PhaseCard(props: { readonly row: PhaseRow }): ReactNode {
  const { row } = props;
  return (
    <li className="grid gap-1 rounded-lg border border-border-subtle p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="m-0 text-ui-sm font-semibold text-text-primary">{row.title}</h3>
        <Badge size="xs" mono variant="outline">
          {t(NODE_TEXT[row.kind])}
        </Badge>
        {row.initial ? (
          <Badge size="xs" mono>
            {t("desktop.compose.flow.initial")}
          </Badge>
        ) : null}
      </div>
      {row.out.map((out) => (
        <p key={`${out.to}:${out.event ?? ""}`} className="m-0 ml-3 text-ui-sm text-text-secondary">
          {t("desktop.compose.flow.to", { to: out.to })}
          {out.event === null ? "" : ` · ${out.event}`}
          {out.when === null ? "" : ` · ${out.when}`}
        </p>
      ))}
    </li>
  );
}

export function FlowBody(props: { readonly composition: CompositionDecl }): ReactNode {
  const rows = phaseRowsOf(props.composition);
  if (rows === null) {
    return (
      <EmptyState
        size="sm"
        surface="none"
        title={t("desktop.compose.flow.none.head")}
        description={t("desktop.compose.flow.none.body")}
      />
    );
  }
  return (
    <>
      <p className="m-0 flex items-center gap-1 text-ui-sm text-text-secondary">
        {t("desktop.compose.flow.head")}
        <InfoTip text={t("desktop.compose.flow.boundary")} />
      </p>
      <ol aria-label={t("desktop.compose.view.flow")} className="m-0 grid list-none gap-2 p-0">
        {rows.map((row) => (
          <PhaseCard key={row.id} row={row} />
        ))}
      </ol>
    </>
  );
}

/** 고른 그룹 하나의 그룹 보기 또는 흐름 보기. 이름이 바뀌면 새로 읽는다 */
export function GroupSource(props: {
  readonly name: string;
  readonly link: TabLink;
  readonly mode: "group" | "flow";
}): ReactNode {
  const commands = useCommands();
  const [version, setVersion] = useState(0);
  const load = useCallback(() => commands.workbench.get(props.name), [commands, props.name]);
  const read = useTabRead(`compose:${props.name}:${version}`, props.link, load);
  return (
    <ReadGate
      read={read}
      onRetry={() => {
        setVersion((current) => current + 1);
      }}
    >
      {(detail) => {
        const composition = compositionOf(detail.manifest);
        if (composition.kind === "none") return <NoComposition />;
        return props.mode === "group" ? (
          <GroupBody composition={composition.composition} link={props.link} />
        ) : (
          <FlowBody composition={composition.composition} />
        );
      }}
    </ReadGate>
  );
}
