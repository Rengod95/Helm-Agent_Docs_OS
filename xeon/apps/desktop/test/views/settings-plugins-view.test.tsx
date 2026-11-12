import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { PluginsPanelView } from "../../src/views/pages/settings/settings-plugins-view.tsx";

// 설정 "플러그인" 구역 맨 위 카드(DP-93). 목록과 스위치는 없고, 플레이그라운드로 보내는 한 줄만 있다.

const plain = (html: string): string => html.replaceAll("<!-- -->", "");

describe("PluginsPanelView", () => {
  test("says plugins are managed in the playground and offers to open it", () => {
    const markup = plain(renderToString(<PluginsPanelView onOpen={() => undefined} />));
    expect(markup).toContain(t("desktop.settings.plugins.moved.title"));
    expect(markup).toContain(t("desktop.settings.plugins.moved.body"));
    expect(markup).toContain(`>${t("desktop.settings.plugins.moved.open")}<`);
    expect(t("desktop.settings.plugins.moved.body")).toContain("플레이그라운드");
  });

  test("outside the shell there is no open button, and never a plugin switch", () => {
    const markup = plain(renderToString(<PluginsPanelView />));
    expect(markup).toContain(t("desktop.settings.plugins.moved.body"));
    expect(markup).not.toContain(`>${t("desktop.settings.plugins.moved.open")}<`);
    expect(markup).not.toContain('role="switch"');
  });
});
