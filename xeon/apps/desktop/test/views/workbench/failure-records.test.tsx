// 기록 탭 그림(§6.24 "기록"): 실패 묶음 표, 빈 문장, 오류 한 줄. `FailureRecords`가 `rows`와 `failed`대로 그린다.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { FailureRowVM } from "@fresnel/client/workbench";
import { renderToString } from "react-dom/server";
import { FailureRecords } from "../../../src/views/workbench/ext-detail.tsx";

const render = (rows: readonly FailureRowVM[], failed = false): string =>
  renderToString(<FailureRecords rows={rows} failed={failed} />);

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

/** 표 머리글 글, 그린 순서대로 */
const headingsOf = (html: string): string[] =>
  [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => textOf(m[1] ?? ""));

/** 표 칸 글을 행마다 묶어서 */
const cellsOf = (html: string): string[][] =>
  [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((row) =>
      [...(row[1] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) => textOf(c[1] ?? "")),
    )
    .filter((cells) => cells.length > 0);

const boom: FailureRowVM = {
  point: "tool.call.before",
  result: "error",
  message: "boom",
  count: 3,
  consecutive: 2,
};

describe("기록 탭 그림", () => {
  test("기록이 있으면 표 하나: 머리글은 훅·결과·메시지·횟수·연속이고 칸은 묶음 값 그대로다", () => {
    const html = render([boom]);
    expect(html.match(/data-slot="table"(?=[ >])/g)).toHaveLength(1);
    expect(headingsOf(html)).toEqual([
      t("desktop.workbench.detail.record.col.hook"),
      t("desktop.workbench.detail.record.col.result"),
      t("desktop.workbench.detail.record.col.message"),
      t("desktop.workbench.detail.record.col.count"),
      t("desktop.workbench.detail.record.col.consecutive"),
    ]);
    expect(cellsOf(html)).toEqual([["tool.call.before", "error", "boom", "3", "2"]]);
    expect(textOf(html)).not.toContain(t("desktop.workbench.detail.record.empty"));
  });

  test("기록이 없으면 빈 문장만 보이고 표는 없다", () => {
    const html = render([]);
    expect(textOf(html)).toBe(t("desktop.workbench.detail.record.empty"));
    expect(html).not.toContain("<table");
  });

  test("엔진 연결이 실패했으면 오류 한 줄만 보인다(기록이 있어도 표는 그리지 않는다)", () => {
    const html = render([boom], true);
    expect(textOf(html)).toBe(t("desktop.workbench.detail.record.failed"));
    expect(html).not.toContain("<table");
  });
});
