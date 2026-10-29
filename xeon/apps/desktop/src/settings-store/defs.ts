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
      label: "창 닫기 동작",
      help: "tray이면 창을 닫아도 엔진과 진행 중 turn이 남는다. 창은 다시 실행하거나 Dock을 눌러 다시 연다",
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
      label: "엔진 자동 재기동 횟수",
      help: "10분 안에서 엔진이 비정상 종료하면 자동으로 다시 띄우는 횟수다. 0이면 자동 재기동을 끈다",
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
      label: "엔진 종료 대기 시간",
      help: "종료를 요청한 뒤 엔진이 끝나기를 기다리는 시간이다. 엔진의 종료 시한보다 2000 ms 이상 길어야 한다",
      unit: "ms",
    },
    since: "0.1.0",
  },
});

/** 셸이 읽는 `l4.desktop.*` 정의 세 개. 순서는 키 이름순이 아니라 선언 순이다. */
export const DESKTOP_SETTING_DEFS: readonly SettingDef[] = Object.values(desktopSettings.defs);
