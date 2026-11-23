import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { EngineStoreContext } from "../../../src/state/engine/index.ts";
import { createShellStore, openEndTab, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createShellRegistry, type ShellRegistry } from "../../../src/views/shell/registry.ts";
import { EndPanel, shownPluginTabsOf } from "../../../src/views/shell/end-panel.tsx";
import { harness } from "../../state/helpers.ts";

// 오른쪽 막대(DP-192~194)의 서버 렌더: 고정 칸, 구분선 뒤 "플러그인" 단추, well 머리의 제목·요약.

function registry(withPlugin: boolean, pluginNotices = 0): ShellRegistry {
  const r = createShellRegistry();
  r.registerEndTab({
    id: "inbox",
    area: "both",
    label: "desktop.shell.nav.inbox",
    icon: <span>i</span>,
    Count: (p) => p.render(2),
    Summary: () => "요약 한 줄",
    render: () => <p>받은 요청 내용</p>,
  });
  r.registerEndTab({
    id: "work",
    area: "chat",
    label: "desktop.work.tab",
    icon: <span>w</span>,
    render: () => <p>작업 내용</p>,
  });
  if (withPlugin) {
    r.registerPluginEndTab({
      id: "helm",
      area: "chat",
      source: "plugin",
      hiddenKey: "helm/helm-panel",
      label: "desktop.plugin.tab.helm",
      description: "desktop.plugin.tab.helmDescription",
      icon: <span>h</span>,
      render: () => <p>헬름 패널 내용</p>,
    });
    r.registerPluginEndTab({
      id: "plugin-pages",
      area: "chat",
      source: "host",
      label: "desktop.plugin.tab.pages",
      description: "desktop.shell.end.pagesDescription",
      icon: <span>p</span>,
      badge: { read: () => pluginNotices, subscribe: () => () => undefined },
      render: () => <p>플러그인 탭 내용</p>,
    });
  }
  return r;
}

function render(r: ShellRegistry, openTab: string | null): string {
  const store = createShellStore(1440, (m) => (openTab === null ? m : openEndTab(m, openTab)));
  return renderToString(
    <EngineStoreContext value={harness().store.read}>
      <ShellStoreContext value={store}>
        <EndPanel registry={r} keyLabel={() => "⌘⇧X"} />
      </ShellStoreContext>
    </EngineStoreContext>,
  );
}

/** 플러그인 단추 한 개의 글(여는 태그부터 닫는 태그까지). 없으면 빈 글 */
function pluginButtonOf(out: string): string {
  return /<button[^>]*data-end-plugin[^>]*>.*?<\/button>/.exec(out)?.[0] ?? "";
}

/** 플러그인 단추가 확인 표시(`data-attention`)와 구슬을 함께 가졌는지 */
function pluginMarksOf(out: string): readonly [boolean, boolean] {
  const b = pluginButtonOf(out);
  return [b.includes('data-attention=""'), b.includes('data-slot="attention-orb"')];
}

describe("end rail", () => {
  test("a plugin panel whose screen the user hid (x.ui.hidden) leaves the plugin menu", () => {
    const tabs = registry(true).pluginEndTabs("chat");
    const withKey = tabs;
    expect(shownPluginTabsOf(withKey, new Set()).map((tab) => tab.id)).toEqual([
      "helm",
      "plugin-pages",
    ]);
    expect(shownPluginTabsOf(withKey, new Set(["helm/helm-panel"])).map((tab) => tab.id)).toEqual([
      "plugin-pages",
    ]);
    expect(shownPluginTabsOf(withKey, new Set(["other/x"])).map((tab) => tab.id)).toEqual([
      "helm",
      "plugin-pages",
    ]);
  });

  test("bar tabs come first; a separator and one plugin button follow when a plugin panel exists", () => {
    const out = render(registry(true), null);
    const tabs = [...out.matchAll(/data-end-tab="([^"]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(["inbox", "work"]);
    expect(out).toContain('data-slot="floating-bar-separator"');
    expect(out).toContain("data-end-plugin");
    expect(out).toContain(`aria-label="${t("desktop.shell.end.plugins")}"`);
    // 플러그인 패널은 막대 칸이 아니다
    expect(out).not.toContain('data-end-tab="helm"');
  });

  test("with no plugin panel the plugin button and its separator are not drawn", () => {
    const out = render(registry(false), null);
    expect(out).not.toContain("data-end-plugin");
    expect(out).not.toContain('data-slot="floating-bar-separator"');
  });

  test("a bar tab count reads from its Count part and goes into the name", () => {
    const out = render(registry(true), null);
    expect(out).toContain(`aria-label="${t("desktop.shell.nav.inbox")} 2"`);
  });

  test("an open tab's well head carries the title and the tab's summary line", () => {
    const out = render(registry(true), "inbox");
    expect(out).toContain('data-end-well="inbox"');
    expect(out).toContain("요약 한 줄");
    expect(out).toContain("받은 요청 내용");
  });

  test("a plugin panel opens in the same well, and the plugin button reads as active", () => {
    const out = render(registry(true), "helm");
    expect(out).toContain('data-end-well="helm"');
    expect(out).toContain("헬름 패널 내용");
    const button = /<button[^>]*data-end-plugin[^>]*>/.exec(out)?.[0] ?? "";
    expect(button).toContain('data-active="true"');
  });

  test("notices inside the plugin menu show one orb on the plugin button, not a count pill", () => {
    const quiet = /<button[^>]*data-end-plugin[^>]*>/.exec(render(registry(true), null))?.[0] ?? "";
    expect(quiet).not.toContain("data-attention");
    const out = render(registry(true, 3), null);
    const button = /<button[^>]*data-end-plugin[^>]*>.*?<\/button>/.exec(out)?.[0] ?? "";
    expect(button).toContain('data-attention=""');
    expect(button).toContain(`aria-label="${t("desktop.shell.end.pluginsAttention")}"`);
    expect(button).not.toContain('data-slot="floating-bar-badge"');
  });

  test("the plugin button's orb comes exactly when its data-attention mark does, and not while it is open", () => {
    expect([
      pluginMarksOf(render(registry(true), null)),
      pluginMarksOf(render(registry(true, 3), null)),
      pluginMarksOf(render(registry(true, 3), "helm")),
    ]).toEqual([
      [false, false],
      [true, true],
      [false, false],
    ]);
  });
});
