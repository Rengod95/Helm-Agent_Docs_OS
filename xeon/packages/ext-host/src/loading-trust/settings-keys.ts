import { effectiveLayer, type ExtensionManifest } from "@fresnel/contracts/extensions";
import { SecretRef } from "@fresnel/contracts/capabilities";
import {
  checkSettingDef,
  defineSettings,
  type CatalogIssue,
  type SettingDef,
  type SettingDefInput,
  type SettingGroup,
  type SettingNamespace,
} from "@fresnel/contracts/settings";
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
  const shownName = manifest.displayName ?? manifest.name;
  const enabled: SettingDefInput = {
    type: Type.Boolean(),
    default: manifest.defaultEnabled ?? true,
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project", "local", "launch"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 10,
      label: `Enable ${shownName}`,
      labelKey: "settings.ext.enabled.label",
      labelArgs: { name: shownName },
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
      label: `${shownName} isolation`,
      labelKey: "settings.ext.isolation.label",
      labelArgs: { name: shownName },
    },
    since: "0.1.0",
  };
  const inputs: Record<string, SettingDefInput> =
    source === "builtin" ? { enabled } : { enabled, isolation };
  const group = defineSettings(namespace, inputs);
  const layer = effectiveLayer(manifest) === "plugin" ? "L2" : effectiveLayer(manifest);
  const defs: SettingDef[] = Object.values<SettingDef>(group.defs).map((def) =>
    Object.assign({}, def, { layer }),
  );
  return { namespace, defs };
}

/**
 * 매니페스트 `userConfig`를 설정 정의로 바꾼다(F.wire-settings §3.8.3 규칙 1, 순수 함수). 키는 항목의 `setting`(`ext.<이름>.<키>`)이다.
 * 항목에 값 스키마 필드가 아직 없으므로(F.wire-settings §10 미결 8) 값은 문자열이고, `sensitive`는 `SecretRef` 문자열 비밀 키가 된다.
 * 접두가 맞지 않거나 예약 이름이거나 정의 규칙을 어기면 그 항목은 `issues`로 돌려주고 정의에는 넣지 않는다.
 */
export function settingsFromManifest(manifest: ExtensionManifest): {
  readonly defs: readonly SettingDef[];
  readonly issues: readonly CatalogIssue[];
} {
  const defs: SettingDef[] = [];
  const issues: CatalogIssue[] = [];
  const prefix = `ext.${manifest.name}.`;
  const declared = effectiveLayer(manifest);
  const layer = declared === "plugin" ? "L2" : declared;
  let order = 100;
  for (const entry of Object.values(manifest.userConfig ?? {})) {
    order += 10;
    const rest = entry.setting.startsWith(prefix) ? entry.setting.slice(prefix.length) : undefined;
    if (rest === undefined) {
      issues.push({ code: "foreignNamespace", key: entry.setting, owner: manifest.name });
      continue;
    }
    const secret = entry.sensitive === true;
    const def: SettingDef = {
      key: entry.setting,
      type: secret ? SecretRef : Type.String(),
      ...(secret ? {} : { default: "" }),
      runtimeChange: "live",
      layer,
      allowedScopes: ["managed", "user", "project", "local", "launch"],
      ui: {
        tab: "plugins",
        widget: secret ? "secret" : "text",
        order,
        label: entry.title,
        ...(entry.description === undefined ? {} : { help: entry.description }),
      },
      ...(secret ? { secret: true } : {}),
      since: "0.1.0",
    };
    const broken = checkSettingDef(def);
    const reserved = RESERVED_EXT_KEYS.some((name) => name === rest);
    if (reserved || broken.length > 0) {
      issues.push({
        code: "invalidDef",
        key: entry.setting,
        rule: broken[0]?.rule ?? "D1",
        message: reserved ? `"${rest}" is a reserved name` : (broken[0]?.message ?? ""),
      });
      continue;
    }
    defs.push(def);
  }
  return { defs, issues };
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
    ui: { tab: "plugins", widget: "select", order: 400, label: "Default work folder trust" },
    since: "0.1.0",
  },
  paths: {
    type: Type.Array(Type.String()),
    default: [],
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "plugins", widget: "list", order: 410, label: "Extension search paths" },
    since: "0.1.0",
  },
  "isolation.maxRestarts": {
    type: Type.Integer(),
    default: 3,
    range: { min: 0, max: 20 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "plugins",
      widget: "number",
      order: 430,
      label: "Max restarts for isolated extensions",
    },
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
      label: "Isolated extension restart window",
      unit: "s",
    },
    since: "0.1.0",
  },
});
