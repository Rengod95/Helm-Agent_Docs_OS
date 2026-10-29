import { Type } from "typebox";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";

// L4 데스크톱 설정 키 (L4.desktop.spec §6 표 세 행). 셸은 시작할 때 이 키들을 `desktop-settings.json`에서 읽는다(§3.6).
// Rust 쪽은 같은 기본값과 범위를 따로 갖는다: engine.rs `EngineConfig::default`와 `from_values`,
// desktop_settings.rs `CloseBehavior`와 범위 상수. test/settings-defs.test.ts가 두 쪽의 기본값을 맞춘다.
// 여기서는 선언만 한다. 화면과 쓰기는 M4 settings-ui가 붙인다.

const DESKTOP_SCOPES = ["managed", "user"] as const;

const desktopSettings = defineSettings("l4.desktop", {
  "window.closeBehavior": {
    type: Type.String(),
    default: "quit",
    range: { enum: ["quit", "tray"] },
    runtimeChange: "live",
    allowedScopes: DESKTOP_SCOPES,
    ui: {
      tab: "appearance",
      widget: "select",
      order: 10,
      // 대체 문구는 영어다. 화면은 labelKey·helpKey로 카탈로그 문장을 읽고, 키가 없을 때만 이 문구를 쓴다
      label: "Window close behavior",
      labelKey: "settings.l4.desktop.window.closeBehavior.label",
      help: "With tray, the engine and any running turn keep going after the window closes. Reopen the window by launching the app again or clicking the Dock icon.",
      helpKey: "settings.l4.desktop.window.closeBehavior.help",
    },
    since: "0.1.0",
  },
  "engine.restartLimit": {
    type: Type.Integer(),
    default: 3,
    range: { min: 0, max: 10 },
    runtimeChange: "live",
    allowedScopes: DESKTOP_SCOPES,
    ui: {
      tab: "execution",
      widget: "number",
      order: 20,
      label: "Engine automatic restart limit",
      labelKey: "settings.l4.desktop.engine.restartLimit.label",
      help: "How many times the engine restarts by itself if it exits abnormally within 10 minutes. 0 turns automatic restart off.",
      helpKey: "settings.l4.desktop.engine.restartLimit.help",
    },
    since: "0.1.0",
  },
  "engine.shutdownGraceMs": {
    type: Type.Integer(),
    default: 7000,
    range: { min: 1000, max: 180000 },
    runtimeChange: "live",
    allowedScopes: DESKTOP_SCOPES,
    ui: {
      tab: "advanced",
      widget: "number",
      order: 30,
      label: "Engine shutdown grace period",
      labelKey: "settings.l4.desktop.engine.shutdownGraceMs.label",
      help: "How long to wait for the engine to finish after a shutdown is requested. It must be at least 2000 ms longer than the engine's shutdown timeout.",
      helpKey: "settings.l4.desktop.engine.shutdownGraceMs.help",
      unit: "ms",
    },
    since: "0.1.0",
  },
});

/** 셸이 읽는 `l4.desktop.*` 정의 세 개. 순서는 키 이름순이 아니라 선언 순이다. */
export const DESKTOP_SETTING_DEFS: readonly SettingDef[] = Object.values(desktopSettings.defs);
