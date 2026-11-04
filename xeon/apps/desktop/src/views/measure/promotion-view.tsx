// 승격 보고(P-20, U-04, W-26 `group.promotion`): 소비자가 있는 도구 후보를 읽기 전용 표로 보인다. 값은 호스트가 준 그대로다.
import { t } from "@fresnel/client/i18n";
import type { TabRead } from "@fresnel/client/workbench";
import type { WireResult } from "@fresnel/contracts/wire";
import type { ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { MUTED, TabBody } from "../workbench/tab-body.tsx";

export type PromotionReport = WireResult<"group.promotion">;

/** 보고 본문. 서버 렌더 시험이 읽기 상태 없이 직접 그린다 */
export function PromotionBody(props: { readonly report: PromotionReport }): ReactNode {
  const { report } = props;
  if (report.candidates.length === 0) {
    return <p className={MUTED}>{t("desktop.measure.promotion.empty")}</p>;
  }
  return (
    <div className="grid gap-1.5">
      <p className={MUTED}>
        {t("desktop.measure.promotion.scope", {
          threads: report.threads,
          seq: report.throughSeq,
        })}
      </p>
      <table className="w-full border-collapse text-ui-sm">
        <thead>
          <tr className="text-start text-text-tertiary">
            <th scope="col" className="text-start font-medium">
              {t("desktop.measure.promotion.col.tool")}
            </th>
            <th scope="col" className="text-start font-medium">
              {t("desktop.measure.promotion.col.owner")}
            </th>
            <th scope="col" className="text-start font-medium">
              {t("desktop.measure.promotion.col.consumers")}
            </th>
            <th scope="col" className="text-end font-medium">
              {t("desktop.measure.promotion.col.userCalls")}
            </th>
          </tr>
        </thead>
        <tbody>
          {report.candidates.map((candidate) => (
            <tr key={`${candidate.owner}:${candidate.tool}`}>
              <th scope="row" className="text-start font-mono font-normal text-text-primary">
                {candidate.tool}
              </th>
              <td className="font-mono">{candidate.owner}</td>
              <td className="font-mono text-text-tertiary">{candidate.consumers.join(", ")}</td>
              <td className="text-end font-mono">{candidate.userCalls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PromotionView(props: { readonly read: TabRead<PromotionReport> }): ReactNode {
  return (
    <section className="grid gap-1.5">
      <h2 className="m-0 flex items-center gap-1 text-ui-sm font-semibold text-text-primary">
        {t("desktop.measure.promotion.title")}
        <InfoTip text={t("desktop.measure.promotion.info")} />
      </h2>
      <TabBody read={props.read} render={(report) => <PromotionBody report={report} />} />
    </section>
  );
}
