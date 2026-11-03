import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  openDetail,
  pickGroup,
  pickPlugin,
  setQuery,
  type WorkbenchState,
} from "@fresnel/client/workbench";
import { renderToString } from "react-dom/server";
import { ExtensionsScreen } from "../../../src/views/workbench/extensions-screen.tsx";
import { needsTrustConfirm } from "../../../src/views/workbench/trust-dialog.tsx";
import { entry, inContexts, screenStore } from "./support.tsx";

function render(prepare?: (state: WorkbenchState) => WorkbenchState): string {
  return renderToString(inContexts(<ExtensionsScreen />, screenStore(prepare)));
}

/** 누름 상태가 켜진 단추의 글(태그는 뺀다) */
function pressedLabels(html: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)]
    .filter((m) => m[0].includes('aria-pressed="true"'))
    .map((m) => (m[1] ?? "").replace(/<[^>]*>/g, ""));
}

/** 층 목록이 그린 층 이름, 그린 순서대로 */
function sectionLayers(html: string): string[] {
  return [...html.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1] ?? "");
}

describe("확장 화면: 층별 목록과 찾기", () => {
  test("층 묶음은 L1, L2, L3 순서이고 층마다 켜짐 수를 보인다", () => {
    const html = render();
    expect(sectionLayers(html)).toEqual(["L1", "L2", "L3"]);
    expect(html.indexOf("L1")).toBeLessThan(html.indexOf("L2"));
    expect(html).toContain(t("desktop.workbench.layers.count", { on: 1, total: 1 }));
  });

  test("찾기는 같은 행만 남기고 나머지는 목록에서 빠진다", () => {
    const html = render((s) => setQuery(s, "웹"));
    expect(html).toContain("웹 검색");
    expect(html).not.toContain("core-loop");
  });

  test("찾는 확장이 없으면 빈 상태를 보인다", () => {
    const html = render((s) => setQuery(s, "zzz"));
    expect(html).toContain("찾는 확장이 없어요");
  });
});

describe("확장 화면: 고른 확장과 선택 패널", () => {
  test("고른 플러그인의 행만 눌린 상태로 보인다", () => {
    const pressed = pressedLabels(render((s) => pickPlugin(s, "web")));
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toContain("웹 검색");
  });

  test("고른 그룹도 그 행이 눌리고 선택 패널이 그 그룹을 보인다", () => {
    const html = render((s) => pickGroup(s, "review"));
    expect(pressedLabels(html).some((label) => label.includes("review"))).toBe(true);
    expect(html).toContain(t("desktop.workbench.selection.label"));
  });

  test("고른 확장은 선택 패널에 훅 수와 자세히 보기 단추를 보인다", () => {
    const html = render((s) => pickPlugin(s, "web"));
    expect(html).toContain(`aria-label="${t("desktop.workbench.selection.label")}"`);
    expect(html).toContain(t("desktop.workbench.selection.detail"));
    expect(html).toContain(t("desktop.workbench.selection.hooks", { count: 2 }));
  });

  test("면제 tier 확장은 스위치가 잠기고 이유를 선택 패널에 쓴다", () => {
    const html = render((s) => pickPlugin(s, "core-loop"));
    expect(html).toContain("보안·기본 동작이라 끌 수 없어요");
  });

  test("자동 꺼진 확장은 위 띠에 알림과 다시 켜기 단추를 보인다", () => {
    const html = render();
    expect(html).toContain(t("desktop.workbench.autoDisabled", { name: "review" }));
    expect(html).toContain(t("desktop.workbench.reenable"));
  });
});

describe("확장 화면: 자세히 보기(P-17)는 목록 대신 그린다", () => {
  test("자세히 보기가 열리면 탭과 뒤로 가기가 보이고 층 목록은 빠진다", () => {
    const html = render((s) => openDetail(pickPlugin(s, "web"), "web"));
    expect(html).toContain(t("desktop.workbench.detail.back"));
    for (const tab of [
      t("desktop.workbench.detail.tab.overview"),
      t("desktop.workbench.detail.tab.hooks"),
      t("desktop.workbench.detail.tab.versions"),
    ]) {
      expect(html).toContain(tab);
    }
    expect(sectionLayers(html)).toEqual([]);
  });
});

describe("신뢰 확인(O-10)", () => {
  test("user·project 위치만 켜기 전에 묻는다", () => {
    expect(needsTrustConfirm(entry("a", { origin: "user" }))).toBe(true);
    expect(needsTrustConfirm(entry("a", { origin: "project" }))).toBe(true);
    expect(needsTrustConfirm(entry("a", { origin: "builtin" }))).toBe(false);
    expect(needsTrustConfirm(entry("a", { origin: "managed" }))).toBe(false);
  });
});
