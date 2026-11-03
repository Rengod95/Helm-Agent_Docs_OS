import { Type } from "typebox";
import { defineSettings, type SettingDef } from "@fresnel/contracts/settings";

// L0.os.spec §6. 모두 layer L0, since 0.1.0이다. 알림 키(l0.os.notify.*)는 두지 않는다: 정본은 l2.dialog.notify.*이다.
// dirs.override는 관리 범위만 받는다: 사용자 설정 파일이 config 디렉터리 안에 있어 사용자 범위에서 읽으면 순환한다.
// 환경 변수 FRESNEL_HOME이 같은 역할을 하며 dirs.ts가 FRESNEL_HOME을 먼저 본다.

const group = defineSettings("l0.os", {
  "telemetry.enabled": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "advanced", widget: "toggle", order: 100, label: "Telemetry export" },
    since: "0.1.0",
  },
  "telemetry.exporter": {
    type: Type.String({ maxLength: 16 }),
    default: "file",
    range: { enum: ["file", "otlp-http"] },
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "advanced", widget: "select", order: 110, label: "Telemetry export method" },
    since: "0.1.0",
  },
  "telemetry.endpoint": {
    type: Type.String({ minLength: 1, maxLength: 2048 }),
    default: "http://localhost:4318/v1/traces",
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "advanced", widget: "text", order: 120, label: "OTLP collector address" },
    since: "0.1.0",
  },
  "dirs.override": {
    type: Type.String({ minLength: 1, maxLength: 4096 }),
    runtimeChange: "restart",
    allowedScopes: ["managed"],
    since: "0.1.0",
  },
  "log.level": {
    type: Type.String({ maxLength: 8 }),
    default: "info",
    range: { enum: ["debug", "info", "warn", "error"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "local", "launch"],
    ui: { tab: "advanced", widget: "select", order: 130, label: "Log level" },
    since: "0.1.0",
  },
});

/** `l0.os.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const OS_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);
