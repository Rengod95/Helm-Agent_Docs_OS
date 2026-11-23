import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import {
  DEFAULT_FILTER,
  EMPTY_PROMOTION,
  type MetricsFilter,
  type PromotionReport,
} from "../../../src/views/craft/metrics/model.ts";
import { InsightPanel } from "../../../src/views/craft/metrics/insights.tsx";
import { sampleData } from "../../../src/views/craft/metrics/sample.ts";
import type { MetricsData } from "../../../src/views/craft/metrics/source.ts";

// 인사이트 열의 "같이 쓰는 도구" 묶음. 후보가 있으면 제목(플러그인 수)과 묶음 머리가 보이고, 없거나 못 읽었으면 묶음이 빠진다.
// 플러그인 좁히기는 주인이나 쓰는 쪽인 후보만 남긴다.

function panelOf(filter: MetricsFilter, promotion: PromotionReport | "loading"): string {
  const base = sampleData("sample", filter, () => undefined, {});
  const data: MetricsData =
    promotion === "loading"
      ? { ...base, promotion: { kind: "loading" } }
      : { ...base, promotion: { kind: "ready", value: promotion, stale: false } };
  return renderToString(<InsightPanel data={data} locale="ko" onShowEvidence={() => undefined} />);
}

describe("insight panel shared tools group", () => {
  test("candidates show their count and the plugin-count title", () => {
    const html = panelOf(DEFAULT_FILTER, {
      throughSeq: 412,
      threads: 6,
      candidates: [
        {
          tool: "search_docs",
          owner: "docs-voice",
          consumers: ["review-flow", "release-notes", "web-research"],
          userCalls: 14,
        },
        { tool: "run_tests", owner: "test-runner", consumers: ["repo-guard"], userCalls: 6 },
      ],
    });
    expect([
      html.includes("같이 쓰는 도구"),
      html.includes("이 도구를 플러그인 4개가 같이 써요"),
      html.includes("이 도구를 플러그인 2개가 같이 써요"),
      html.includes("직접 부른 횟수"),
      // 후보가 있으면 "볼 인사이트가 없어요"를 두지 않는다
      html.includes(t("desktop.craft.metrics.insight.none")),
    ]).toEqual([true, true, true, true, false]);
  });

  test("no candidates, or a report not read yet, leaves the group out", () => {
    const none = panelOf(DEFAULT_FILTER, EMPTY_PROMOTION);
    const loading = panelOf(DEFAULT_FILTER, "loading");
    expect([none.includes("같이 쓰는 도구"), loading.includes("같이 쓰는 도구")]).toEqual([
      false,
      false,
    ]);
  });

  test("a plugin focus keeps only the candidates that plugin owns or uses", () => {
    const report: PromotionReport = {
      throughSeq: 412,
      threads: 6,
      candidates: [
        {
          tool: "search_docs",
          owner: "docs-voice",
          consumers: ["review-flow", "release-notes", "web-research"],
          userCalls: 14,
        },
        { tool: "run_tests", owner: "test-runner", consumers: ["repo-guard"], userCalls: 6 },
      ],
    };
    const html = panelOf({ ...DEFAULT_FILTER, plugin: "test-runner" }, report);
    expect([
      html.includes("이 도구를 플러그인 2개가 같이 써요"),
      html.includes("이 도구를 플러그인 4개가 같이 써요"),
    ]).toEqual([true, false]);
  });
});

/** 발견도 닫은 것도 없는 인사이트 열 */
function withFindings(candidates: PromotionReport): string {
  const base = sampleData("sample", DEFAULT_FILTER, () => undefined, {});
  const none = { asOf: 0, dataRevision: 1, findings: [] };
  const data: MetricsData = {
    ...base,
    findings: { kind: "ready", value: none, stale: false },
    dismissed: { kind: "ready", value: none, stale: false },
    promotion: { kind: "ready", value: candidates, stale: false },
  };
  return renderToString(<InsightPanel data={data} locale="ko" onShowEvidence={() => undefined} />);
}

describe("shared tools next to an empty insight list", () => {
  const report: PromotionReport = {
    throughSeq: 9,
    threads: 1,
    candidates: [
      { tool: "run_tests", owner: "test-runner", consumers: ["repo-guard"], userCalls: 2 },
    ],
  };

  test("with a candidate the empty-insight sentence is left out; without one it shows", () => {
    expect([
      withFindings(report).includes(t("desktop.craft.metrics.insight.none")),
      withFindings(EMPTY_PROMOTION).includes(t("desktop.craft.metrics.insight.none")),
    ]).toEqual([false, true]);
  });
});
