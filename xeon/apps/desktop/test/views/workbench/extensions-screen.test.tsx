import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  INITIAL_WORKBENCH,
  listLoaded,
  openDetail,
  pickGroup,
  pickPlugin,
  setQuery,
  visibleRows,
  type WorkbenchState,
} from "@fresnel/client/workbench";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { ExtensionsScreen } from "../../../src/views/workbench/extensions-screen.tsx";
import { needsTrustConfirm } from "../../../src/views/workbench/trust-dialog.tsx";
import { entry, inContexts, screenStore } from "./support.tsx";

function render(prepare?: (state: WorkbenchState) => WorkbenchState): string {
  return renderToString(inContexts(<ExtensionsScreen />, screenStore(prepare)));
}

/**
 * 주어진 상태로 화면을 그린다. 서버 렌더(`renderToString`)는 스토어의 처음 상태만 읽으므로(zustand `getInitialState`),
 * 값을 바꾼 뒤의 그림은 그 값을 처음 상태로 가진 스토어로 그린다.
 */
function renderState(state: WorkbenchState): string {
  return renderToString(
    inContexts(
      <ExtensionsScreen />,
      createWorkbenchStore(() => state),
    ),
  );
}

/** 태그를 뺀 글 */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

/** 자동 꺼진 review가 다시 켜져 자동 꺼짐 기록이 풀린 목록 한 줄 */
const reviewRecovered = (e: ExtListEntry): ExtListEntry =>
  e.name === "review" ? { ...e, autoDisabled: false, status: "enabled" } : e;

/** 층 목록이 그린 층 이름, 그린 순서대로 */
function sectionLayers(html: string): string[] {
  return [...html.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** 층 목록의 표 하나마다 행(`<tr>`). 속성 글, 행의 마크업, 칸 글(태그는 뺀다) */
function rowsOf(html: string): {
  readonly attrs: string;
  readonly markup: string;
  readonly cells: readonly string[];
}[] {
  return [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)]
    .filter((m) => (m[1] ?? "").includes('data-slot="table-row"'))
    .map((m) => ({
      attrs: m[1] ?? "",
      markup: m[2] ?? "",
      cells: [...(m[2] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
        textOf(c[1] ?? ""),
      ),
    }));
}

/** 행 하나의 켜짐 스위치 태그(없으면 빈 글) */
function switchOf(html: string, name: string): string {
  const row = rowsOf(html).find((r) => r.cells[0]?.includes(name));
  return row?.markup.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? "";
}

/** 고른 행의 칸 글. 고른 행이 없으면 빈 목록 */
function selectedRows(html: string): (readonly string[])[] {
  return rowsOf(html)
    .filter((row) => row.attrs.includes('aria-selected="true"'))
    .map((row) => row.cells);
}

/** 층 표마다 머리글 글, 그린 순서대로 */
function headingsOf(html: string): string[][] {
  return [...html.matchAll(/<thead\b[^>]*data-slot="table-head"[^>]*>([\s\S]*?)<\/thead>/g)].map(
    (m) =>
      [...(m[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((h) => textOf(h[1] ?? "")),
  );
}

describe("확장 화면: 층별 목록과 찾기", () => {
  test("행은 층 순서(오케스트레이션, 기능, 에이전트 코어)로 늘어서고 층 칸은 사람 말 이름이다", () => {
    const html = render();
    expect(rowsOf(html).map((row) => row.cells[1])).toEqual([
      t("term.layerOrchestration"),
      t("term.layerCapabilities"),
      t("term.layerAgentCore"),
    ]);
    expect(sectionLayers(html)).toEqual([]);
  });

  test("머리에 플러그인 가져오기 단추가 있고 닫힌 채로 시작한다", () => {
    const html = render();
    expect(html).toContain(t("desktop.install.open"));
    expect(html).not.toContain(t("desktop.install.source.label"));
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

describe("확장 화면: 층 표(caustic Table, §6.23)", () => {
  test("표는 하나이고 열은 이름, 층, 신뢰 수준, 상태, 켜짐이다", () => {
    const html = render();
    expect(html.match(/data-slot="table"(?=[ >])/g)).toHaveLength(1);
    const columns = [
      t("desktop.workbench.col.name"),
      t("desktop.workbench.col.layer"),
      t("desktop.workbench.col.trust"),
      t("desktop.workbench.col.state"),
      t("desktop.workbench.col.switch"),
    ];
    expect(headingsOf(html)).toEqual([columns]);
  });

  test("행은 칸마다 이름, 상태, 켜짐 스위치를 보인다", () => {
    const web = rowsOf(render()).find((row) => row.cells[0]?.includes("웹 검색"));
    expect(web?.cells).toEqual([
      "웹 검색",
      t("term.layerCapabilities"),
      t("desktop.workbench.origin.user"),
      t("desktop.workbench.state.on"),
      "",
    ]);
  });

  test("행의 켜짐 칸에는 스위치가 있고 이름표는 표시 이름이다", () => {
    const html = render();
    expect(html).toContain('aria-label="웹 검색 사용"');
  });

  test("스위치 이름은 상태와 상관없이 '사용'이고 상태는 aria-checked로 전한다", () => {
    const on = switchOf(render(), "웹 검색");
    expect(on).toContain('aria-label="웹 검색 사용"');
    expect(on).toContain('aria-checked="true"');
    const off = switchOf(
      renderState(
        listLoaded(INITIAL_WORKBENCH, [
          entry("web", { displayName: "웹 검색", status: "disabled" }),
        ]),
      ),
      "웹 검색",
    );
    expect(off).toContain('aria-label="웹 검색 사용"');
    expect(off).toContain('aria-checked="false"');
  });

  test("키보드로 들어가는 행은 표에서 하나다(고른 행, 없으면 첫 행)", () => {
    const html = render((s) => pickPlugin(s, "web"));
    const stops = rowsOf(html).filter((row) => row.attrs.includes('tabindex="0"'));
    expect(stops).toHaveLength(1);
    expect(stops.find((row) => row.cells[0]?.includes("웹 검색"))).toBeDefined();
  });
});

describe("확장 화면: 고른 확장과 선택 패널", () => {
  test("고른 플러그인의 행만 고른 상태(aria-selected)로 보인다", () => {
    const selected = selectedRows(render((s) => pickPlugin(s, "web")));
    expect(selected).toHaveLength(1);
    expect(selected[0]?.[0]).toContain("웹 검색");
  });

  test("고른 그룹도 그 행이 고른 상태이고 선택 패널이 그 그룹을 보인다", () => {
    const html = render((s) => pickGroup(s, "review"));
    expect(selectedRows(html).some((cells) => (cells[0] ?? "").includes("review"))).toBe(true);
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

  test("자동 꺼진 확장은 위 띠에 알림을 두지 않고, 고른 선택 패널에 다시 켜기를 보인다", () => {
    expect(render()).not.toContain(t("desktop.workbench.autoDisabled", { name: "review" }));
    expect(render((s) => pickGroup(s, "review"))).toContain(t("desktop.workbench.reenable"));
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

describe("확장 화면: 잠긴 스위치의 이유는 Tooltip으로 보인다", () => {
  test("ext-list.exempt-tier-switch-locked: core와 guard tier 행의 켜짐 스위치는 꺼져 잠기고 이유를 보인다", () => {
    const state = listLoaded(INITIAL_WORKBENCH, [
      entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" }),
      entry("gate", { layer: "L2", tier: "guard" }),
      entry("web", { displayName: "웹 검색" }),
    ]);
    expect(visibleRows(state).map((r) => [r.name, r.lock])).toEqual([
      ["core-loop", "exempt"],
      ["gate", "exempt"],
      ["web", null],
    ]);
    const rows = rowsOf(renderState(state));
    // core-loop은 카탈로그의 한국어 이름(ext.name.coreLoop)으로 그려진다
    for (const name of ["에이전트 실행기", "gate"]) {
      const row = rows.find((r) => r.cells[0]?.includes(name));
      expect(row?.markup).toContain(`aria-description="${t("desktop.workbench.lock.exempt")}"`);
      expect(row?.markup).toContain('data-slot="tooltip-trigger"');
      // 스위치 여는 태그에 disabled가 있어야 잠긴 것이다
      expect(row?.markup).toMatch(/<button[^>]*role="switch"[^>]*disabled=""/);
    }
    const web = rows.find((r) => r.cells[0]?.includes("웹 검색"));
    expect(web?.markup).not.toMatch(/<button[^>]*role="switch"[^>]*disabled=""/);
  });

  test("잠기지 않은 행은 Tooltip 칸이 없고 이유 설명도 없다", () => {
    const web = rowsOf(render()).find((row) => row.cells[0]?.includes("웹 검색"));
    expect(web?.markup).not.toContain("tooltip-trigger");
    expect(web?.markup).not.toContain("aria-description");
  });
});

describe("확장 화면: 배지는 스토어를 따른다(목록을 다시 읽으면 같은 화면이 바뀐다)", () => {
  test("목록이 새 값으로 바뀌면 그 값으로 그린 선택 패널과 개수가 새 값을 보인다", () => {
    const store = screenStore();
    const reenable = t("desktop.workbench.reenable");
    const before = renderState(pickGroup(store.actions.snapshot(), "review"));
    expect(before).toContain(reenable);

    store.actions.listLoaded(store.actions.snapshot().entries.map(reviewRecovered));

    const after = renderState(pickGroup(store.actions.snapshot(), "review"));
    expect(after).not.toContain(reenable);
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
