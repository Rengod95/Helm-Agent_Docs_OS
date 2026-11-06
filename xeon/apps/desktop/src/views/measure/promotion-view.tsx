// 승격 보고(P-20, U-04, W-26 `group.promotion`): 소비자가 있는 도구 후보를 읽기 전용 표로 보인다. 값은 호스트가 준 그대로다.
import { t } from "@fresnel/client/i18n";
import type { TabRead } from "@fresnel/client/workbench";
import type { WireResult } from "@fresnel/contracts/wire";
import { Table, type TableColumn } from "@caustic/react";
import type { ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { MUTED, TabBody } from "../workbench/tab-body.tsx";

export type PromotionReport = WireResult<"group.promotion">;
type Candidate = PromotionReport["candidates"][number];

/** 후보 하나의 행 id. 소유자와 도구 이름의 쌍이다 */
function keyOf(candidate: Candidate): string {
  return `${candidate.owner}:${candidate.tool}`;
}

/** 보고 본문. 서버 렌더 시험이 읽기 상태 없이 직접 그린다 */
export function PromotionBody(props: { readonly report: PromotionReport }): ReactNode {
  const { report } = props;
  if (report.candidates.length === 0) {
    return <p className={MUTED}>{t("desktop.measure.promotion.empty")}</p>;
  }
  const columns: TableColumn[] = [
    { key: "tool", header: t("desktop.measure.promotion.col.tool") },
    { key: "owner", header: t("desktop.measure.promotion.col.owner") },
    { key: "consumers", header: t("desktop.measure.promotion.col.consumers") },
    { key: "userCalls", header: t("desktop.measure.promotion.col.userCalls"), align: "end" },
  ];
  const byKey = new Map(
    report.candidates.map((candidate) => [keyOf(candidate), candidate] as const),
  );
  return (
    <div className="grid gap-1.5">
      <p className={MUTED}>
        {t("desktop.measure.promotion.scope", {
          threads: report.threads,
          seq: report.throughSeq,
        })}
      </p>
      <Table
        variant="ghost"
        size="xs"
        dividers={false}
        columns={columns}
        rows={report.candidates.map((candidate) => ({ id: keyOf(candidate) }))}
        renderCell={(picked, column) => {
          const candidate = byKey.get(picked.id);
          if (candidate === undefined) return null;
          if (column.key === "tool") {
            return <span className="font-mono text-text-primary">{candidate.tool}</span>;
          }
          if (column.key === "owner") {
            return <span className="font-mono">{candidate.owner}</span>;
          }
          if (column.key === "consumers") {
            return (
              <span className="font-mono text-text-tertiary">{candidate.consumers.join(", ")}</span>
            );
          }
          if (column.key === "userCalls") {
            return <span className="font-mono">{candidate.userCalls}</span>;
          }
          return null;
        }}
      />
    </div>
  );
}

export function PromotionView(props: { readonly read: TabRead<PromotionReport> }): ReactNode {
  return (
    <section className="grid gap-1.5">
      <h2 className="m-0 flex items-center gap-1 text-title-3 font-semibold text-text-primary">
        {t("desktop.measure.promotion.title")}
        <InfoTip text={t("desktop.measure.promotion.info")} />
      </h2>
      <TabBody read={props.read} render={(report) => <PromotionBody report={report} />} />
    </section>
  );
}
