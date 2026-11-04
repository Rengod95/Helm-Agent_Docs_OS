import { describe, expect, test } from "bun:test";
import type { SettingDefWire } from "@fresnel/contracts/settings";
import { buildSettingsView } from "../../src/settings/index.ts";
import { effectiveOf, wireDef } from "./fixtures.ts";

// 개발 모드 설정(`l3.authoring.devMode`)의 정의는 plugin-builder의 `authoringSettings`(카탈로그)에서 온다.
// 클라이언트는 그 패키지를 import하지 않으므로 같은 모양의 와이어 정의로 시험한다. 설정 화면은 카탈로그의 정의를
// 탭과 위젯 표로 바로 그리므로(view.ts `buildSettingsView`), 정의만 있으면 "플러그인" 탭에 토글 행이 생긴다. 행을 따로 더하지 않는다.

const KEY = "l3.authoring.devMode";

const DEV_MODE_DEF: SettingDefWire = wireDef({
  key: KEY,
  type: { type: "boolean" },
  default: false,
  layer: "L3",
  runtimeChange: "live",
  allowedScopes: ["managed", "user"],
  ui: {
    tab: "plugins",
    widget: "toggle",
    order: 240,
    label: "Plugin development mode",
    labelKey: "settings.l3.authoring.devMode.label",
    help: "When on, this computer can run plugin replay checks and benchmarks.",
    helpKey: "settings.l3.authoring.devMode.help",
  },
  since: "0.1.0",
});

describe("개발 모드 설정의 설정 화면 행", () => {
  test("a catalog def for the dev mode key yields one toggle row in the plugins tab and no file-only entry", () => {
    const view = buildSettingsView({
      defs: [DEV_MODE_DEF],
      values: new Map([[KEY, effectiveOf(KEY, false)]]),
      hasThread: false,
    });
    const plugins = view.tabs.find((tab) => tab.id === "plugins");
    expect(plugins?.fields.map((field) => [field.key, field.widget.kind])).toEqual([
      [KEY, "toggle"],
    ]);
    expect(plugins?.emptyText).toBeNull();
    expect(view.fileOnly).toEqual([]);
    expect(view.tabs.filter((tab) => tab.fields.some((field) => field.key === KEY))).toHaveLength(
      1,
    );
  });

  test("the row carries the stored value, the scope it came from, and the default-off value", () => {
    const view = buildSettingsView({
      defs: [DEV_MODE_DEF],
      values: new Map([[KEY, effectiveOf(KEY, true, { source: { scope: "managed" } })]]),
      hasThread: false,
    });
    const field = view.tabs.find((tab) => tab.id === "plugins")?.fields[0];
    expect(field?.value).toBe(true);
    expect(field?.scope.scope).toBe("managed");
    expect(field?.editable).toBe(true);
  });

  test("without a stored value the row is read-only and the view says the value is missing", () => {
    const view = buildSettingsView({ defs: [DEV_MODE_DEF], values: new Map(), hasThread: false });
    const field = view.tabs.find((tab) => tab.id === "plugins")?.fields[0];
    expect(field?.widget.kind).toBe("readonly");
    expect(view.diagnostics).toContainEqual({ code: "missingValue", key: KEY });
  });
});
