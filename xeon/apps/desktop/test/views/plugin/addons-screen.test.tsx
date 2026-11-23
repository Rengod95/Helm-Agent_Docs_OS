import { beforeEach, describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { INITIAL_WORKBENCH } from "@fresnel/client/workbench";
import { Menu } from "@caustic/react";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { parseHTML } from "linkedom";
import { renderToString } from "react-dom/server";
import { createShellStore } from "../../../src/state/shell/index.ts";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import {
  addonDetailOf,
  addonRowsOf,
  type AddonMetaMap,
} from "../../../src/views/plugin/addon-model.ts";
import { addonMovesOf } from "../../../src/views/plugin/app-moves.ts";
import {
  AddonDetailView,
  AddonsScreen,
  OthersGroup,
  type DetailOps,
} from "../../../src/views/plugin/addons-screen.tsx";
import { AppTile, AppTileMenuItems } from "../../../src/views/plugin/plugin-card.tsx";
import {
  markAddonRequest,
  pendingAddonRequest,
  requestAddon,
} from "../../../src/views/plugin/plugin-pick.ts";
import { APP_DECL, uiEntryOf } from "../../plugin-ui/support.ts";
import { inContexts } from "../workbench/support.tsx";
import { loadedPluginUi } from "./support.tsx";

// 플레이그라운드 홈(addons-screen.tsx: 앱 타일 격자)과 상세, 타일(plugin-card.tsx), 크래프트로 가는 동작. 효과가 없는 서버 렌더로 본다.

const VIEWDEMO: readonly ExtUiEntry[] = [
  uiEntryOf({ extension: "viewdemo", id: "notes", title: "Native demo", version: "1.0.0" }),
  uiEntryOf({
    extension: "viewdemo",
    id: "frame",
    title: "Frame demo",
    mode: "app",
    version: "1.0.0",
    app: { ...APP_DECL, capabilities: ["files"] },
  }),
];

const NOOP = (): void => undefined;
const NO_META: AddonMetaMap = new Map();

const plain = (html: string): string => html.replaceAll("<!-- -->", "");
const countOf = (html: string, text: string): number => html.split(text).length - 1;

async function screenHtml(entries: readonly ExtUiEntry[]): Promise<string> {
  const plugin = await loadedPluginUi(entries);
  return plain(
    renderToString(
      inContexts(
        <AddonsScreen />,
        createWorkbenchStore(() => INITIAL_WORKBENCH),
        undefined,
        plugin,
      ),
    ),
  );
}

/** 플러그인 하나의 타일을 서버 렌더한다. 목록에 없는 이름이면 빈 글 */
function tileHtml(
  entries: readonly ExtUiEntry[],
  name: string,
  options: { readonly meta?: AddonMetaMap; readonly pinned?: boolean } = {},
): string {
  const row = addonRowsOf(
    { entries, inactive: new Set(), settings: {} },
    options.meta ?? NO_META,
    "ko",
  ).find((item) => item.name === name);
  if (row === undefined) return "";
  return plain(
    renderToString(
      <ul>
        <AppTile
          row={row}
          pinned={options.pinned ?? false}
          onOpen={NOOP}
          onPin={NOOP}
          onFix={NOOP}
          onManage={NOOP}
        />
      </ul>,
    ),
  );
}

/** 타일 메뉴를 펼쳐 그린 항목 글. 인라인 메뉴는 효과 없이 열린 채로 그려진다 */
function menuLabelsOf(builtin: boolean, pinned = false): readonly string[] {
  const html = renderToString(
    <Menu inline open size="sm">
      <AppTileMenuItems
        builtin={builtin}
        pinned={pinned}
        onPin={NOOP}
        onFix={NOOP}
        onManage={NOOP}
      />
    </Menu>,
  );
  const doc = parseHTML(`<!doctype html><html><body>${html}</body></html>`).document;
  return [...doc.querySelectorAll('[role^="menuitem"]')].map((item) => item.textContent);
}

beforeEach(() => {
  // 다른 시험이 남긴 요청을 따른 것으로 적어 화면이 목록부터 열리게 한다
  const pending = pendingAddonRequest();
  if (pending !== undefined) markAddonRequest(pending);
});

describe("플레이그라운드 홈", () => {
  test("the home is the title and one app tile per plugin with screens, a create tile after them, and no header action", async () => {
    const html = await screenHtml(VIEWDEMO);
    expect(html).toContain(`>${t("desktop.shell.nav.plugins")}</h1>`);
    expect(t("desktop.shell.nav.plugins")).toBe("플레이그라운드");
    expect(html).not.toContain(t("desktop.addons.find"));
    expect(html).not.toContain(t("desktop.addons.intro"));
    expect(html).toContain(`aria-label="${t("desktop.apps.label")}"`);
    expect(countOf(html, 'data-slot="app-tile"')).toEqual(1);
    expect(html).toContain('data-plugin="viewdemo"');
    expect(countOf(html, 'data-slot="app-create"')).toEqual(1);
    expect(html).toContain(t("desktop.apps.create.title"));
    // 타일에는 화면 수 같은 메타 줄이 없다
    expect(html).not.toContain(t("desktop.addons.count.screens", { count: 2 }));
    // 목록 단계에서는 화면을 바로 열지 않는다
    expect(html).not.toContain(t("desktop.plugin.header.backToChat"));
    expect(html).not.toContain(t("desktop.plugin.thread.title"));
  });

  test("with no apps the home is the empty state: what gathers here and one create button, no tiles", async () => {
    const html = await screenHtml([]);
    expect(html).toContain(t("desktop.addons.empty.title"));
    expect(html).toContain(t("desktop.addons.empty.body"));
    expect(html).toContain(t("desktop.apps.create.title"));
    expect(countOf(html, 'data-slot="app-tile"')).toEqual(0);
    expect(countOf(html, 'data-slot="app-create"')).toEqual(0);
    // 옛 종류 목록은 그리지 않는다
    expect(html).not.toContain(t("desktop.addons.kind.card.title"));
  });

  test('a plugin asked for before the screen opens (tab menu "details") is the first thing shown', async () => {
    requestAddon("viewdemo");
    const html = await screenHtml(VIEWDEMO);
    expect(html).toContain(t("desktop.addons.detail.back"));
    expect(html).toContain(t("desktop.addons.section.screens"));
    expect(countOf(html, 'data-slot="app-tile"')).toEqual(0);
  });
});

describe("앱 타일", () => {
  test("a normal tile is one button with its title; the status orb and pin mark show only when needed", () => {
    const plainTile = tileHtml(VIEWDEMO, "viewdemo");
    expect(plainTile).toContain('data-slot="app-tile"');
    expect(plainTile).not.toContain(t("desktop.addons.badge.off"));
    expect(plainTile).not.toContain(t("desktop.playgroundTabs.attention.danger"));
    expect(plainTile).not.toContain(`aria-label="${t("desktop.addons.card.pinned")}"`);

    const off = tileHtml(VIEWDEMO, "viewdemo", {
      meta: new Map([["viewdemo", { enabled: false }]]),
    });
    expect(off).toContain(t("desktop.addons.badge.off"));

    const broken = tileHtml(
      [uiEntryOf({ extension: "viewdemo", id: "notes", state: "invalid" })],
      "viewdemo",
    );
    expect(broken).toContain(t("desktop.playgroundTabs.attention.danger"));

    const pinned = tileHtml(VIEWDEMO, "viewdemo", { pinned: true });
    expect(pinned).toContain(`aria-label="${t("desktop.addons.card.pinned")}"`);
  });

  test("the tile menu has pin, fix and manage; a builtin app has no fix item", () => {
    expect(menuLabelsOf(false)).toEqual([
      t("desktop.apps.menu.pin"),
      t("desktop.apps.menu.fix"),
      t("desktop.apps.menu.manage"),
    ]);
    expect(menuLabelsOf(true)).toEqual([t("desktop.apps.menu.pin"), t("desktop.apps.menu.manage")]);
    expect(menuLabelsOf(false, true)[0]).toEqual(t("desktop.apps.menu.unpin"));
  });
});

describe("이 프로필에 없는 앱 묶음", () => {
  test("the group is folded at first: its toggle says closed and its apps are not drawn", () => {
    const html = plain(
      renderToString(
        <OthersGroup count={2}>
          <p>숨은 앱</p>
        </OthersGroup>,
      ),
    );
    expect(html).toContain(t("desktop.apps.others.title"));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(">2<");
    expect(html).toContain('data-slot="info-tip"');
    expect(html).not.toContain("숨은 앱");
  });
});

const OPS: DetailOps = {
  pin: { pinned: true, onChange: NOOP },
  onOpenScreen: NOOP,
  onAllowApps: NOOP,
};

function detailHtml(
  entries: readonly ExtUiEntry[],
  name: string,
  meta: AddonMetaMap,
  ops: DetailOps = OPS,
): string {
  const detail = addonDetailOf(name, { entries, inactive: new Set(), settings: {} }, meta, "ko");
  if (detail === undefined) return "";
  return plain(
    renderToString(
      inContexts(
        <AddonDetailView detail={detail} ops={ops} />,
        createWorkbenchStore(() => INITIAL_WORKBENCH),
      ),
    ),
  );
}

describe("플레이그라운드 상세", () => {
  test("shows only the head (pin, open) and the screens; management lives in craft", () => {
    const html = detailHtml(
      VIEWDEMO,
      "viewdemo",
      new Map([["viewdemo", { displayName: "View demo", description: "예제 플러그인이에요." }]]),
    );
    const order = [
      "View demo",
      "예제 플러그인이에요.",
      t("desktop.addons.detail.pinned"),
      t("desktop.addons.detail.open"),
      t("desktop.addons.section.screens"),
      "Native demo",
      "Frame demo",
    ];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((left, right) => left - right));
    expect(html).toContain(t("desktop.workbench.uiMode.app"));
    // 스위치, 대화 기능, 권한, 정보 열은 크래프트 상세 "화면과 설정"으로 옮겼다
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain(t("desktop.addons.section.conversation"));
    expect(html).not.toContain(t("desktop.addons.section.access"));
  });

  test("an off plugin shows the warning, no head open button, and the screen's open is disabled", () => {
    const entries = [
      uiEntryOf({ extension: "viewdemo", id: "notes", title: "Native demo", state: "disabled" }),
    ];
    const html = detailHtml(entries, "viewdemo", new Map([["viewdemo", { enabled: false }]]));
    expect(html).toContain(t("desktop.addons.problem.off"));
    const open = t("desktop.addons.detail.open");
    const buttons = html.match(new RegExp(`<button[^>]*>${open}</button>`, "g")) ?? [];
    expect(buttons.map((button) => button.includes('disabled=""'))).toEqual([true]);
  });

  test("the screen header offers one Manage link instead of the menu", async () => {
    requestAddon("viewdemo");
    const html = await screenHtml(VIEWDEMO);
    expect(html).toContain(t("desktop.addons.manage"));
  });
});

describe("크래프트로 가는 동작", () => {
  test("find goes to craft extensions; manage also picks and opens that extension's detail", () => {
    const shell = createShellStore(1400);
    const workbench = createWorkbenchStore(() => INITIAL_WORKBENCH);
    const moves = addonMovesOf(shell.actions, workbench.actions);
    moves.manage("viewdemo");
    expect(shell.read.getState().area).toBe("workbench");
    expect(shell.read.getState().places.workbench.screen).toBe("extensions");
    expect(workbench.read.getState().detail).toBe("viewdemo");
    moves.buildPlugin();
    expect(shell.read.getState().places.workbench.screen).toBe("extensions");
    expect(workbench.read.getState().builder).not.toBeNull();
  });
});
