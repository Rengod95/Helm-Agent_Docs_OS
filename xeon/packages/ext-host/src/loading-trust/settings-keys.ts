import type { ExtensionManifest } from "@xeon/contracts/extensions";
import {
  defineSettings,
  type SettingDef,
  type SettingDefInput,
  type SettingGroup,
  type SettingNamespace,
} from "@xeon/contracts/settings";
import { Type } from "typebox";
import type { InstallSource } from "./trust/levels.ts";

/** 예약 키 이름. 확장 userConfig는 이 이름을 쓸 수 없다(X.loading-trust.spec §4.5.1) */
export const RESERVED_EXT_KEYS: readonly ["enabled", "isolation"] = ["enabled", "isolation"];

/**
 * ext.<name>.enabled, ext.<name>.isolation. 확장마다 로더가 만든다(§4.5.2).
 * 내장 확장에는 isolation 키를 만들지 않는다. 예약 키의 layer는 매니페스트 layer를 따른다(plugin이면 L2)
 */
export function reservedExtensionSettings(
  manifest: ExtensionManifest,
  source: InstallSource,
): { readonly namespace: SettingNamespace; readonly defs: readonly SettingDef[] } {
  const namespace: SettingNamespace = `ext.${manifest.name}`;
  const enabled: SettingDefInput = {
    type: Type.Boolean(),
    default: manifest.defaultEnabled ?? true,
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 10,
      label: `${manifest.displayName ?? manifest.name} 켜기`,
    },
    since: "0.1.0",
  };
  const isolation: SettingDefInput = {
    // 열거는 range.enum이 정한다(F.wire-settings D5·D6: 타입과 range에 같은 제약을 두지 않는다)
    type: Type.String(),
    default: manifest.isolation ?? "none",
    range: { enum: ["none", "process"] },
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "plugins",
      widget: "select",
      order: 20,
      label: `${manifest.displayName ?? manifest.name} 격리`,
    },
    since: "0.1.0",
  };
  const inputs: Record<string, SettingDefInput> =
    source === "builtin" ? { enabled } : { enabled, isolation };
  const group = defineSettings(namespace, inputs);
  const layer = manifest.layer === "plugin" ? "L2" : manifest.layer;
  const defs: SettingDef[] = Object.values<SettingDef>(group.defs).map((def) =>
    Object.assign({}, def, { layer }),
  );
  return { namespace, defs };
}

/** X 층 키. defineSettings("x.loading-trust", …). 프로젝트 범위를 허용하지 않는다(§6) */
export const loadingTrustSettings: SettingGroup<
  "x.loading-trust",
  {
    readonly defaultProjectTrust: SettingDefInput;
    readonly paths: SettingDefInput;
    readonly "isolation.maxRestarts": SettingDefInput;
    readonly "isolation.restartWindowSec": SettingDefInput;
  }
> = defineSettings("x.loading-trust", {
  defaultProjectTrust: {
    type: Type.String(),
    default: "ask",
    range: { enum: ["ask", "always", "never"] },
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "plugins", widget: "select", order: 400, label: "프로젝트 신뢰 기본값" },
    since: "0.1.0",
  },
  paths: {
    type: Type.Array(Type.String()),
    default: [],
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "plugins", widget: "list", order: 410, label: "확장 탐색 경로" },
    since: "0.1.0",
  },
  "isolation.maxRestarts": {
    type: Type.Integer(),
    default: 3,
    range: { min: 0, max: 20 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: { tab: "plugins", widget: "number", order: 430, label: "격리 확장 최대 재시작 수" },
    since: "0.1.0",
  },
  "isolation.restartWindowSec": {
    type: Type.Integer(),
    default: 600,
    range: { min: 10, max: 86_400 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "plugins",
      widget: "number",
      order: 440,
      label: "격리 확장 재시작 창",
      unit: "s",
    },
    since: "0.1.0",
  },
});
