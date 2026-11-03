// P-17 측정 탭(§6.24, §6.27): 그룹 하나의 계측(`group.metrics`). 그룹이 아니면 읽지 않고 빈 문장만 보인다.
// 토큰은 입력·출력·캐시 읽기·캐시 쓰기 네 칸(겹치지 않음). 비용은 "정가 기준 추정"이고 구독 청구액과 다를 수 있다고 덧붙인다. 합치는 점수는 없다.
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  costText,
  groupMetricsOf,
  type DurationVM,
  type GroupMetricsVM,
  type TabRead,
  type TokenKey,
} from "@fresnel/client/workbench";
import { assertNever, err, ok } from "@fresnel/contracts";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { useCallback, type ReactNode } from "react";
import { useLinkPhase, useOpenThreadId } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { TabBody, MUTED } from "./tab-body.tsx";
import { tabLinkOf, useTabRead } from "./tab-read.ts";

const TOKEN_TEXT: Readonly<Record<TokenKey, MessageId>> = {
  input: "desktop.workbench.metrics.token.input",
  output: "desktop.workbench.metrics.token.output",
  cacheRead: "desktop.workbench.metrics.token.cacheRead",
  cacheWrite: "desktop.workbench.metrics.token.cacheWrite",
};

const LEAD_TEXT: Readonly<Record<DurationVM["unit"], MessageId>> = {
  ms: "desktop.workbench.metrics.lead.ms",
  sec: "desktop.workbench.metrics.lead.sec",
  min: "desktop.workbench.metrics.lead.min",
};

/** 개수 값의 글(로케일의 수 묶음 표기) */
function numberText(value: number): string {
  return t("desktop.workbench.metrics.number", { value });
}

/** 측정 칸 하나: 이름과 값 */
function Cell(props: { readonly label: string; readonly value: string }): ReactNode {
  return (
    <div className="grid gap-0.5">
      <dt className="text-ui-sm text-text-tertiary">{props.label}</dt>
      <dd className="m-0 font-mono text-text-primary">{props.value}</dd>
    </div>
  );
}

/** 측정 값 그림. 계측이 꺼져 있으면(`metrics`가 null) 빈 문장이다 */
function GroupMetricsBody(props: { readonly metrics: GroupMetricsVM | null }): ReactNode {
  const { metrics } = props;
  if (metrics === null) return <p className={MUTED}>{t("desktop.workbench.metrics.off")}</p>;
  return (
    <div className="grid gap-4 text-ui-sm">
      <section aria-label={t("desktop.workbench.metrics.tokens")} className="grid gap-1.5">
        <h4 className="m-0 font-semibold text-text-secondary">
          {t("desktop.workbench.metrics.tokens")}
        </h4>
        <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {metrics.tokens.map((cell) => (
            <Cell key={cell.key} label={t(TOKEN_TEXT[cell.key])} value={numberText(cell.value)} />
          ))}
        </dl>
      </section>
      <section className="grid gap-0.5">
        <p className="m-0 text-text-primary">
          {t("desktop.workbench.metrics.cost", { amount: costText(metrics.costUsd) })}
        </p>
        <p className={MUTED}>{t("desktop.workbench.metrics.costNote")}</p>
      </section>
      <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Cell
          label={t("desktop.workbench.metrics.lead")}
          value={t(LEAD_TEXT[metrics.lead.unit], { value: metrics.lead.value })}
        />
        <Cell label={t("desktop.workbench.metrics.denies")} value={numberText(metrics.denies)} />
        <Cell
          label={t("desktop.workbench.metrics.handlerErrors")}
          value={numberText(metrics.handlerErrors)}
        />
        <Cell label={t("desktop.workbench.metrics.posts")} value={numberText(metrics.posts)} />
        <Cell label={t("desktop.workbench.metrics.spawns")} value={numberText(metrics.spawns)} />
      </dl>
    </div>
  );
}

/** 측정 탭의 그림. 그룹이 아니면 빈 문장만, 그룹이면 읽기 상태대로 그린다 */
export type MetricsBody =
  | { readonly kind: "none" }
  | { readonly kind: "read"; readonly read: TabRead<GroupMetricsVM | null> };

export function MetricsPanel(props: { readonly view: MetricsBody }): ReactNode {
  const { view } = props;
  switch (view.kind) {
    case "none":
      return <p className={MUTED}>{t("desktop.workbench.metrics.notGroup")}</p>;
    case "read":
      return (
        <TabBody read={view.read} render={(metrics) => <GroupMetricsBody metrics={metrics} />} />
      );
    default:
      return assertNever(view, "MetricsBody");
  }
}

/** 측정 탭: 그룹이면 `group.metrics`를 대화가 열려 있을 때 그 대화 기준으로 읽는다. 그룹이 아니면 읽지 않는다 */
export function MetricsTab(props: {
  readonly entry: Pick<ExtListEntry, "name" | "isGroup">;
}): ReactNode {
  if (!props.entry.isGroup) return <MetricsPanel view={{ kind: "none" }} />;
  return <GroupMetricsTab name={props.entry.name} />;
}

function GroupMetricsTab(props: { readonly name: string }): ReactNode {
  const commands = useCommands();
  const threadId = useOpenThreadId();
  const link = tabLinkOf(useLinkPhase());
  const { name } = props;
  const load = useCallback(async () => {
    const got = await commands.workbench.metrics(name, threadId ?? undefined);
    return got.ok ? ok(groupMetricsOf(got.value)) : err(got.error);
  }, [commands, name, threadId]);
  const read = useTabRead(`${name}\u0000${threadId ?? ""}`, link, load);
  return <MetricsPanel view={{ kind: "read", read }} />;
}
