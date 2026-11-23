import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  INITIAL_WORKBENCH,
  listLoaded,
  openDetail,
  pickPlugin,
  rowOf,
  setCoreOpen,
  setQuery,
  type WorkbenchState,
} from "@fresnel/client/workbench";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import { ExtensionsScreen } from "../../../src/views/workbench/extensions-screen.tsx";
import { PluginCardGrid } from "../../../src/views/workbench/plugin-cards.tsx";
import type { PluginCards } from "../../../src/views/workbench/use-plugin-cards.ts";
import { entry, inContexts, screenStore } from "./support.tsx";

// 크래프트 플러그인 목록(P-13, AGE-76 plugMin): 세 묶음, 앱 핵심은 접힌 채 시작, 켜기 스위치 없음, 줄마다 "프로필에 넣기".

function render(prepare?: (state: WorkbenchState) => WorkbenchState): string {
  return renderToString(inContexts(<ExtensionsScreen />, screenStore(prepare)));
}

/** 주어진 상태로 화면을 그린다. 서버 렌더는 스토어의 처음 상태만 읽으므로 그 값을 처음 상태로 가진 스토어로 그린다 */
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

/** 목록 묶음 이름, 그린 순서대로 */
function groupsOf(html: string): string[] {
  return [...html.matchAll(/<section aria-label="([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** 표의 행(`<tr>`)마다 칸 글(태그는 뺀다. 이름 칸은 표시 이름 뒤에 id가 붙는다)과 마크업 */
function rowsOf(html: string): { readonly markup: string; readonly cells: readonly string[] }[] {
  return [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)]
    .filter((m) => (m[1] ?? "").includes('data-slot="table-row"'))
    .map((m) => ({
      markup: m[2] ?? "",
      cells: [...(m[2] ?? "").matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
        textOf(c[1] ?? ""),
      ),
    }));
}

/** 표마다 머리글 글, 그린 순서대로 */
function headingsOf(html: string): string[][] {
  return [...html.matchAll(/<thead\b[^>]*data-slot="table-head"[^>]*>([\s\S]*?)<\/thead>/g)].map(
    (m) =>
      [...(m[1] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((h) => textOf(h[1] ?? "")),
  );
}

const MINE = t("desktop.workbench.group.mine");
const BUNDLED = t("desktop.workbench.group.bundled");
const CORE = t("desktop.workbench.group.core");
const PUT = t("desktop.workbench.use.put");

describe("플러그인 목록: 세 묶음", () => {
  test("묶음은 내가 넣은 것, 기본 제공, 앱 핵심 순서이고 빈 묶음은 그리지 않는다", () => {
    const state = listLoaded(INITIAL_WORKBENCH, [
      entry("core-loop", { layer: "L1", tier: "core", origin: "builtin" }),
      entry("web", { displayName: "웹 검색" }),
      entry("notes", { origin: "builtin" }),
    ]);
    expect(groupsOf(renderState(state))).toEqual([MINE, BUNDLED, CORE]);
    expect(
      groupsOf(renderState(listLoaded(INITIAL_WORKBENCH, [entry("web", { origin: "user" })]))),
    ).toEqual([MINE]);
  });

  test("앱 핵심은 접힌 채 시작하고, 접혀 있어도 자물쇠 문장이 머리에 보인다", () => {
    const html = render();
    expect(html).toContain(t("desktop.workbench.core.locked"));
    expect(html).toContain('aria-expanded="false"');
    expect(rowsOf(html).map((row) => row.cells[0])).toEqual(["review", "웹 검색web"]);
  });

  test("앱 핵심을 펴면 그 줄이 보이고, 그 줄에는 프로필 메뉴가 없다", () => {
    const html = render((s) => setCoreOpen(s, true));
    expect(html).toContain('aria-expanded="true"');
    const rows = rowsOf(html);
    // core-loop은 카탈로그의 한국어 이름(ext.name.coreLoop)으로 그려진다
    const core = rows.find((row) => (row.cells[0] ?? "").includes("에이전트 루프"));
    // 쓰는 곳 칸(셋째 열)은 프로필 목록을 읽기 전이라 빈 글이다
    expect(core?.cells[2]).toBe("");
    expect(core?.markup).not.toContain(PUT);
    expect(rows.filter((row) => row.markup.includes(PUT)).map((row) => row.cells[0])).toEqual([
      "review",
      "웹 검색web",
    ]);
  });

  test("찾는 중에는 앱 핵심도 펼쳐 찾은 줄을 보인다", () => {
    const html = render((s) => setQuery(s, "core-loop"));
    expect(rowsOf(html).map((row) => row.cells[0])).toEqual(["에이전트 루프core-loop"]);
  });
});

describe("플러그인 목록: 줄과 칸", () => {
  test("열은 이름, 종류, 쓰는 곳, 출처, 버전, 상태, 프로필 메뉴 칸이다", () => {
    expect(headingsOf(render())).toEqual([
      [
        t("desktop.workbench.col.name"),
        t("desktop.workbench.col.kind"),
        t("desktop.workbench.col.use"),
        t("desktop.workbench.versions.col.source"),
        t("desktop.workbench.versions.col.version"),
        t("desktop.workbench.col.state"),
        "",
      ],
    ]);
  });

  test("목록에는 켜기 스위치가 하나도 없다(켜고 끔은 프로필에서만)", () => {
    const html = render((s) => setCoreOpen(s, true));
    expect(html).not.toContain('role="switch"');
  });

  test("자동으로 멈춘 플러그인은 상태 칸에 '멈춤'을, 문제없는 줄은 '준비됨'을 보인다", () => {
    const rows = rowsOf(render());
    expect(rows.map((row) => [row.cells[0], row.cells[5]])).toEqual([
      ["review", t("desktop.workbench.health.stopped")],
      ["웹 검색web", t("desktop.workbench.health.ready")],
    ]);
  });

  test("찾기는 같은 줄만 남기고, 찾는 플러그인이 없으면 빈 상태를 보인다", () => {
    expect(rowsOf(render((s) => setQuery(s, "웹"))).map((row) => row.cells[0])).toEqual([
      "웹 검색web",
    ]);
    expect(render((s) => setQuery(s, "zzz"))).toContain("찾는 플러그인이 없어요");
  });

  test("머리에 플러그인 가져오기 단추가 있고 닫힌 채로 시작한다", () => {
    const html = render();
    expect(html).toContain(t("desktop.install.open"));
    expect(html).not.toContain(t("desktop.install.source.label"));
  });
});

describe("플러그인 상세(P-17)는 목록 대신 그린다", () => {
  test("상세가 열리면 탭과 뒤로 가기, '화면과 설정' 탭이 보이고 목록 묶음은 빠진다", () => {
    const html = render((s) => openDetail(pickPlugin(s, "web"), "web"));
    expect(html).toContain(t("desktop.workbench.detail.back"));
    for (const tab of [
      t("desktop.workbench.detail.tab.overview"),
      t("desktop.workbench.detail.tab.surfaces"),
      t("desktop.workbench.detail.tab.versions"),
    ]) {
      expect(html).toContain(tab);
    }
    expect(html).not.toContain('role="switch"');
    expect(groupsOf(html)).not.toContain(MINE);
  });
});

describe("플러그인 목록: 카드 보기", () => {
  test("줄마다 카드 하나를 그리고, 카드를 못 읽었으면 목적이 없다는 글을 보인다", () => {
    const cards: PluginCards = {
      cardOf: () => null,
      readinessOf: () => null,
      recheck: () => undefined,
    };
    const rows = [rowOf(entry("web", { displayName: "웹 검색" }))];
    const html = renderToString(
      inContexts(
        <PluginCardGrid
          label={MINE}
          rows={rows}
          profiles={{ set: null, reload: () => undefined }}
          cards={cards}
        />,
        screenStore(),
      ),
    );
    expect(html.match(/<li\b/g)?.length).toBe(1);
    expect(html).toContain("웹 검색");
    expect(html).toContain(t("desktop.workbench.card.noPurpose"));
  });
});
