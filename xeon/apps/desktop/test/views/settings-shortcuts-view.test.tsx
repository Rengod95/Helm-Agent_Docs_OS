import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { ShortcutsPanelView } from "../../src/views/pages/settings/settings-shortcuts-view.tsx";
import { ACTION_IDS, DEFAULT_KEYMAP, resolveKeymap } from "../../src/views/shell/keybindings.ts";

// 설정 "단축키" 구역(DP-89). 동작마다 한 줄, 바뀐 줄의 표지와 되돌리기, 읽기 전용(웹)을 HTML로 본다.

function htmlOf(over: {
  readonly keymap?: typeof DEFAULT_KEYMAP;
  readonly editable?: boolean;
}): string {
  return renderToString(
    <ShortcutsPanelView
      keymap={over.keymap ?? DEFAULT_KEYMAP}
      mac
      editable={over.editable ?? true}
      onSave={() => {}}
    />,
  );
}

function countOf(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe("shortcut rows", () => {
  test("every action has one row whose key chips are its change button", () => {
    const html = htmlOf({});
    expect(countOf(html, 'data-slot="settings-shortcut"')).toBe(ACTION_IDS.length);
    expect(countOf(html, `title="${t("desktop.settings.shortcuts.change")}"`)).toBe(
      ACTION_IDS.length,
    );
    const label = t("desktop.settings.shortcuts.change.aria", {
      action: t("desktop.shortcuts.action.paletteOpen"),
    });
    const button = html.slice(html.indexOf(`aria-label="${label}"`));
    expect(button.slice(0, button.indexOf("</button>"))).toContain('data-shortcut-keys="Mod+K"');
    expect(html).toContain('data-shortcut-keys="Mod+K"');
  });

  test("with the default keymap nothing is marked changed and reset all is disabled", () => {
    const html = htmlOf({});
    expect(html).not.toContain(`>${t("desktop.settings.shortcuts.changed")}<`);
    const reset = html.slice(
      html.lastIndexOf("<button", html.indexOf(t("desktop.settings.shortcuts.resetAll"))),
    );
    expect(reset.slice(0, reset.indexOf(">"))).toContain("disabled");
  });

  test("a changed key shows the changed badge and its own reset button, once", () => {
    const html = htmlOf({ keymap: resolveKeymap({ "thread.new": "Mod+Shift+N" }) });
    expect(countOf(html, `>${t("desktop.settings.shortcuts.changed")}<`)).toBe(1);
    expect(html).toContain('data-shortcut-keys="Mod+Shift+N"');
    const label = t("desktop.settings.shortcuts.reset", {
      action: t("desktop.shortcuts.action.threadNew"),
    });
    expect(countOf(html, `aria-label="${label}"`)).toBe(1);
  });

  test("read-only (web) says so and draws no change or reset buttons", () => {
    const html = htmlOf({ editable: false });
    expect(html).toContain(t("desktop.settings.shortcuts.readOnly"));
    expect(html).not.toContain(`title="${t("desktop.settings.shortcuts.change")}"`);
    expect(html).not.toContain(t("desktop.settings.shortcuts.resetAll"));
  });
});
