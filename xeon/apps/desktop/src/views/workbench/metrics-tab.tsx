// P-17 측정 탭(§6.24, §6.27): 그룹이면 그룹 계측(`group.metrics`), 그룹이 아니면 성능 측정 화면의 플러그인 부담 표와 같은 값(`measure.turn`의 최근 Turn)을 이 확장 몫으로 보인다.
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
import { CardStat } from "@caustic/react";
import { useCallback, type ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { useLinkPhase, useOpenThreadId, useRecentTurnIds } from "../../state/engine/index.ts";
import { useCommands } from "../commands.ts";
import { SectionTitle } from "../measure/measure-parts.tsx";
import { useMeasureRead } from "../measure/measure-read.ts";
import { loadOwnerBurden, type OwnerBurden } from "../measure/perf-read.ts";
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

/** 측정 칸 하나: 이름과 값(caustic `CardStat` 유령 면) */
function Cell(props: { readonly label: string; readonly value: string }): ReactNode {
  return <CardStat variant="ghost" size="sm" label={props.label} value={props.value} />;
}

/** 측정 값 그림. 계측이 꺼져 있으면(`metrics`가 null) 빈 문장이다 */
function GroupMetricsBody(props: { readonly metrics: GroupMetricsVM | null }): ReactNode {
  const { metrics } = props;
  if (metrics === null) return <p className={MUTED}>{t("desktop.workbench.metrics.off")}</p>;
  return (
    <div className="grid gap-3 text-ui">
      <section aria-label={t("desktop.workbench.metrics.tokens")} className="grid gap-2">
        <SectionTitle level={3} title={t("desktop.workbench.metrics.tokens")} />
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 compact:grid-cols-4">
          {metrics.tokens.map((cell) => (
            <Cell key={cell.key} label={t(TOKEN_TEXT[cell.key])} value={numberText(cell.value)} />
          ))}
        </div>
      </section>
      <section className="grid gap-0.5">
        {/* 설명 한 줄은 정보 아이콘 뒤에 둔다(DP-58) */}
        <p className="m-0 flex items-center gap-1 text-text-primary">
          {t("desktop.workbench.metrics.cost", { amount: costText(metrics.costUsd) })}
          <InfoTip text={t("desktop.workbench.metrics.costNote")} />
        </p>
      </section>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 compact:grid-cols-5">
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
      </div>
    </div>
  );
}

/** 그룹이 아닌 확장의 부담 그림. 성능 측정 화면의 표 한 줄과 같은 칸이다 */
function OwnerBurdenBody(props: { readonly burden: OwnerBurden }): ReactNode {
  const { burden } = props;
  if (burden.kind === "off") return <p className={MUTED}>{t("desktop.workbench.metrics.off")}</p>;
  if (burden.kind === "empty") {
    return <p className={MUTED}>{t("desktop.workbench.metrics.plugin.empty")}</p>;
  }
  const { row } = burden;
  if (row === null) {
    return (
      <p className={MUTED}>
        {t("desktop.workbench.metrics.plugin.unused", { turns: burden.turns })}
      </p>
    );
  }
  return (
    <div className="grid gap-3 text-ui">
      {/* 어느 Turn을 읽었는지와 성능 측정 화면과의 관계는 정보 아이콘 뒤에 둔다(DP-58) */}
      <p className="m-0 flex items-center gap-1 text-text-primary">
        {t("desktop.workbench.metrics.plugin.range", { turns: burden.turns })}
        <InfoTip text={t("desktop.workbench.metrics.plugin.note")} />
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 compact:grid-cols-5">
        <Cell
          label={t("desktop.measure.perf.col.time")}
          value={t("desktop.measure.ms", { ms: row.msPerTurn })}
        />
        <Cell
          label={t("desktop.measure.perf.col.tokens")}
          value={
            row.tokensEstimated
              ? t("desktop.measure.perf.tokensEstimated", { count: numberText(row.tokensPerTurn) })
              : numberText(row.tokensPerTurn)
          }
        />
        <Cell
          label={t("desktop.workbench.metrics.plugin.calls")}
          value={numberText(row.callCount)}
        />
        <Cell label={t("desktop.measure.perf.col.cache")} value={numberText(row.cacheEvents)} />
        <Cell label={t("desktop.measure.perf.col.problems")} value={numberText(row.problems)} />
      </div>
    </div>
  );
}

/** 측정 탭의 그림. 그룹이면 그룹 계측, 그룹이 아니면 이 확장의 부담을 읽기 상태대로 그린다 */
export type MetricsBody =
  | { readonly kind: "read"; readonly read: TabRead<GroupMetricsVM | null> }
  | { readonly kind: "plugin"; readonly read: TabRead<OwnerBurden> };

export function MetricsPanel(props: { readonly view: MetricsBody }): ReactNode {
  const { view } = props;
  switch (view.kind) {
    case "plugin":
      return <TabBody read={view.read} render={(burden) => <OwnerBurdenBody burden={burden} />} />;
    case "read":
      return (
        <TabBody read={view.read} render={(metrics) => <GroupMetricsBody metrics={metrics} />} />
      );
    default:
      return assertNever(view, "MetricsBody");
  }
}

/** 측정 탭: 그룹이면 `group.metrics`를, 아니면 열린 대화의 최근 Turn에서 이 확장의 부담을 읽는다(둘 다 대화가 열려 있을 때 그 대화 기준) */
export function MetricsTab(props: {
  readonly entry: Pick<ExtListEntry, "name" | "isGroup">;
}): ReactNode {
  if (!props.entry.isGroup) return <PluginMetricsTab name={props.entry.name} />;
  return <GroupMetricsTab name={props.entry.name} />;
}

function PluginMetricsTab(props: { readonly name: string }): ReactNode {
  const threadId = useOpenThreadId();
  const turns = useRecentTurnIds(threadId);
  const link = tabLinkOf(useLinkPhase());
  const { name } = props;
  const read = useMeasureRead(
    `plugin-burden:${name}:${threadId ?? ""}:${turns.join(",")}`,
    link,
    (commands) => loadOwnerBurden(commands, threadId, turns, name),
  );
  return <MetricsPanel view={{ kind: "plugin", read }} />;
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
