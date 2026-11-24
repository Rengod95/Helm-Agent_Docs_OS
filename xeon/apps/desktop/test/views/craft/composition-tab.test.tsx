import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  detailTabOf,
  INITIAL_WORKBENCH,
  isDetailTab,
  listLoaded,
  type DetailTab,
} from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { CheckBanner } from "../../../src/views/craft/composition/composition-check.tsx";
import { ExtDetail } from "../../../src/views/workbench/ext-detail.tsx";
import { entry, inContexts } from "../workbench/support.tsx";

// 구성 탭의 정적 마크업과 상세 탭 입구. 블록 이름, 캔버스, 빈 상태, 검사 띠 글, 블록 이슈 줄,
// 구성 탭(plugTab)은 모든 플러그인에 있고, 그 내용은 루프 캔버스와 떠 있는 설명 판이다(plugHead). 효과는 돌지 않는다.

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

describe("검사 띠", () => {
  test("막힌 곳이 있으면 개수로 보인다", () => {
    const html = renderToString(
      <CheckBanner
        check={{
          kind: "done",
          issues: [{ severity: "error", code: "drive_duplicate", path: "blocks[1]", message: "x" }],
        }}
      />,
    );
    expect(textOf(html)).toContain("검사에서 막힌 곳이 1개 있어요.");
  });

  test("검사를 못 하면 경고 한 줄이다", () => {
    const html = renderToString(<CheckBanner check={{ kind: "failed" }} />);
    expect(textOf(html)).toContain("구성 검사를 하지 못했어요.");
  });

  test("경고만 있으면 경고 개수로 보인다", () => {
    const html = renderToString(
      <CheckBanner
        check={{
          kind: "done",
          issues: [
            { severity: "warning", code: "w1", path: "blocks[0]", message: "a" },
            { severity: "warning", code: "w2", path: "blocks[1]", message: "b" },
          ],
        }}
      />,
    );
    expect(textOf(html)).toContain("경고 2개");
  });
});
/** 상세를 그린다. 엔진은 끊긴 거울이라 구성 탭은 읽는 중으로 보인다 */
function detailOf(row: ExtListEntry, tab: DetailTab): string {
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <ExtDetail
        entry={row}
        tab={tab}
        card={null}
        readiness={null}
        profiles={{ set: null, reload: () => undefined }}
        onTab={() => undefined}
        onRetry={() => undefined}
        onStop={() => undefined}
        onRecheck={() => undefined}
      />,
      createWorkbenchStore(() => state),
    ),
  );
}

/** 탭 고르기(segmented control, plugHead)의 칸 글과 고른 상태, 그린 순서대로 */
function triggersOf(html: string): { text: string; selected: boolean }[] {
  return [...html.matchAll(/<button[^>]*role="radio"[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({
    text: textOf(m[1] ?? ""),
    selected: m[0].includes('aria-checked="true"'),
  }));
}

const DRIVE = entry("kit", { isOrchestration: true, layer: "L2" });
const PLAIN = entry("web");
const BUILD_LABEL = t("desktop.workbench.detail.tab.build");

describe("상세의 구성 탭(plugTab)", () => {
  test("구성 탭은 모든 플러그인에 있고, 개요 다음, 의존 앞에 선다", () => {
    for (const row of [DRIVE, PLAIN]) {
      const labels = triggersOf(detailOf(row, "overview")).map((tab) => tab.text);
      const overview = labels.indexOf(t("desktop.workbench.detail.tab.overview"));
      expect(labels.indexOf(BUILD_LABEL)).toBe(overview + 1);
      expect(labels.indexOf(t("desktop.craft.deps.tab"))).toBe(overview + 2);
    }
  });

  test("구성 탭(plugHead)은 루프 캔버스다: Drive 플러그인이면 매니페스트를 읽는 중에도 Drive 카드와 설명 판의 요약이 보이고 훅 표는 없다", () => {
    const html = detailOf(DRIVE, "build");
    const selected = triggersOf(html).filter((tab) => tab.selected);
    expect(selected.map((tab) => tab.text)).toEqual([BUILD_LABEL]);
    expect(html).toContain(`aria-label="${t("desktop.craft.loop.label")}"`);
    expect(html).toContain(`aria-label="${t("desktop.craft.loop.panel.title")}"`);
    const text = textOf(html);
    expect(text).toContain(t("desktop.craft.canvas.cv3.fact.changes.holdsTurn"));
    expect(text).toContain(t("desktop.craft.loop.panel.attaches"));
    expect(text).toContain(t("desktop.craft.loop.steps", { count: 0 }));
    // 좁은 칸(DP-49)의 개요도 같이 그려지고 CSS 컨테이너 질의로 하나만 보인다
    expect(text).toContain(t("desktop.craft.loop.panel.hintList"));
    expect(html).not.toContain(`aria-label="${t("desktop.workbench.detail.tab.hooks")}"`);
  });

  test("Drive 플러그인이 아니고 카드도 매니페스트도 아직 없으면 캔버스에는 루프 뼈대만 있고 설명 판은 붙는 곳이 없다고 말한다", () => {
    const html = detailOf(PLAIN, "build");
    expect(html).toContain(`aria-label="${t("desktop.craft.loop.label")}"`);
    const text = textOf(html);
    expect(text).toContain(t("desktop.craft.loop.panel.empty"));
    expect(text).toContain(t("desktop.craft.canvas.cv3.block.context"));
    expect(text).toContain(t("desktop.craft.canvas.cv3.boundary.end"));
    expect(text).not.toContain(t("desktop.craft.canvas.cv3.fact.changes.holdsTurn"));
  });

  test("구성 탭은 DETAIL_TABS의 탭 이름이고, 옛 구성 탭 이름은 구성 탭으로 옮겨진다", () => {
    expect(isDetailTab("build")).toBe(true);
    expect(isDetailTab("composition")).toBe(false);
    expect(detailTabOf("composition")).toBe("build");
  });
});
