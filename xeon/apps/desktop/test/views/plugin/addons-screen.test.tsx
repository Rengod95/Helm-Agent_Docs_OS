import { beforeEach, describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { INITIAL_WORKBENCH } from "@fresnel/client/workbench";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createShellStore } from "../../../src/state/shell/index.ts";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import {
  addonDetailOf,
  addonMetaOf,
  type AddonMetaMap,
} from "../../../src/views/plugin/addon-model.ts";
import {
  AddonDetailView,
  AddonsScreen,
  addonMovesOf,
  type DetailOps,
} from "../../../src/views/plugin/addons-screen.tsx";
import {
  markAddonRequest,
  pendingAddonRequest,
  requestAddon,
} from "../../../src/views/plugin/plugin-pick.ts";
import { APP_DECL, uiEntryOf } from "../../plugin-ui/support.ts";
import { entry, inContexts } from "../workbench/support.tsx";
import { loadedPluginUi } from "./support.tsx";

// 플레이그라운드 화면(addons-screen.tsx)의 첫 장면(서버 렌더)과 크래프트로 가는 동작.

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

const plain = (html: string): string => html.replaceAll("<!-- -->", "");

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

beforeEach(() => {
  // 다른 시험이 남긴 요청을 따른 것으로 적어 화면이 목록부터 열리게 한다
  const pending = pendingAddonRequest();
  if (pending !== undefined) markAddonRequest(pending);
});

describe("플레이그라운드 목록", () => {
  test("the header says Playground with a find button, and each plugin is one card with its screen count", async () => {
    const html = await screenHtml(VIEWDEMO);
    expect(html).toContain(`>${t("desktop.shell.nav.plugins")}</h1>`);
    expect(t("desktop.shell.nav.plugins")).toBe("플레이그라운드");
    expect(html).toContain(t("desktop.addons.find"));
    expect(html).toContain('data-slot="plugin-card"');
    expect(html).toContain(t("desktop.addons.intro"));
    expect(html).toContain(">viewdemo<");
    expect(html).toContain(t("desktop.addons.count.screens", { count: 2 }));
    // 목록 단계에서는 화면을 바로 열지 않는다
    expect(html).not.toContain(t("desktop.plugin.header.backToChat"));
    expect(html).not.toContain(t("desktop.plugin.thread.title"));
  });

  test("the empty state explains what gathers here and offers find and build, in the list's place", async () => {
    const html = await screenHtml([]);
    expect(html).toContain(t("desktop.addons.empty.title"));
    expect(html).toContain(t("desktop.addons.empty.body"));
    expect(html).toContain(t("desktop.addons.kind.card.title"));
    expect(html).toContain(t("desktop.addons.find"));
    expect(html).toContain(t("desktop.addons.build"));
  });

  test('a plugin asked for before the screen opens (tab menu "details") is the first thing shown', async () => {
    requestAddon("viewdemo");
    const html = await screenHtml(VIEWDEMO);
    expect(html).toContain(t("desktop.addons.detail.back"));
    expect(html).toContain(t("desktop.addons.section.screens"));
    expect(html).not.toContain('data-slot="plugin-card"');
  });
});

const NOOP = (): void => undefined;
const OPS: DetailOps = {
  toggle: { on: true, locked: false, busy: false, onChange: NOOP },
  pin: { pinned: true, onChange: NOOP },
  onKeepOff: NOOP,
  onKeepOn: NOOP,
  onOpenScreen: NOOP,
  onRunCommand: NOOP,
  onAllowApps: NOOP,
  onCopy: NOOP,
};

function detailHtml(entries: readonly ExtUiEntry[], name: string, meta: AddonMetaMap): string {
  const detail = addonDetailOf(name, { entries, inactive: new Set(), settings: {} }, meta, "ko");
  if (detail === undefined) return "";
  return plain(
    renderToString(
      inContexts(
        <AddonDetailView detail={detail} ops={OPS} />,
        createWorkbenchStore(() => INITIAL_WORKBENCH),
      ),
    ),
  );
}
describe("플레이그라운드 상세", () => {
  test("orders the page: head with switch and open, screens, conversation, access, about", () => {
    const html = detailHtml(
      VIEWDEMO,
      "viewdemo",
      new Map([["viewdemo", { displayName: "View demo", description: "예제 플러그인이에요." }]]),
    );
    const order = [
      "View demo",
      "예제 플러그인이에요.",
      'role="switch"',
      t("desktop.addons.detail.open"),
      t("desktop.addons.section.screens"),
      "Native demo",
      "Frame demo",
      t("desktop.addons.section.conversation"),
      t("desktop.addons.thread.title"),
      t("desktop.addons.section.access"),
      t("desktop.addons.cap.files.title"),
      t("desktop.addons.trust.user.body"),
      t("desktop.addons.access.confirm"),
      t("desktop.addons.section.about"),
    ];
    const positions = order.map((text) => html.indexOf(text));
    expect(positions.every((at) => at >= 0)).toBe(true);
    expect(positions).toEqual(positions.toSorted((left, right) => left - right));
    expect(html).toContain(t("desktop.workbench.uiMode.app"));
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
});

describe("플레이그라운드 상세의 실제 위험과 진단", () => {
  test("names tool hooks and write methods, lists every diagnostic with file:line, and asks keep-off with both answers", () => {
    const meta = addonMetaOf(
      entry("viewdemo", {
        diagnostics: [
          {
            severity: "error",
            code: "hook_failed",
            message: "훅이 실패했어요",
            file: "src/index.ts",
            line: 12,
          },
          { severity: "warning", code: "slow", message: "느려요" },
        ],
        keepOffQuestion: { rule: "consecutive", consecutive: 5, windowFailures: 5 },
      }),
      { methods: [{ verb: "save", readOnly: false }] },
      [{ registrationId: "viewdemo", hook: "tool.call.before", budgetClass: "fast", budgetMs: 50 }],
    );
    const html = detailHtml(VIEWDEMO, "viewdemo", new Map([["viewdemo", meta]]));
    expect(html).toContain(t("desktop.addons.keepOff.consecutive", { count: 5 }));
    expect(html).toContain(t("desktop.addons.keepOff.off"));
    expect(html).toContain(t("desktop.addons.keepOff.on"));
    expect(html).toContain(t("desktop.addons.risk.toolHooks.title"));
    expect(html).toContain(t("desktop.addons.risk.methods.write", { count: 1 }));
    expect(html).toContain("src/index.ts:12 · hook_failed");
    expect(html).toContain(">느려요<");
    expect(html).toContain(t("desktop.addons.section.diagnostics"));
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
    expect(shell.read.getState().places.workbench.screen).toBe("overview");
    expect(workbench.read.getState().builder).not.toBeNull();
  });
});
