import { Type } from "typebox";
import type { SettingDef } from "../../src/wire-settings/settings/index.ts";

/** 규칙을 모두 만족하는 기본 정의. 필드를 덮어써 규칙 하나씩 어긴다. */
export function intDef(overrides: Partial<SettingDef> = {}): SettingDef {
  return {
    key: "l1.loop.maxSteps",
    type: Type.Integer(),
    default: 0,
    range: { min: 0, max: 10_000 },
    runtimeChange: "nextTurn",
    layer: "L1",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: { tab: "budgets", widget: "number", order: 10, label: "턴당 최대 단계", unit: "단계" },
    since: "0.1.0",
    ...overrides,
  };
}

export function secretDef(overrides: Partial<SettingDef> = {}): SettingDef {
  return {
    key: "l1.models.apiKey",
    type: Type.String({ pattern: "^secret://[a-z][a-z0-9-]{1,63}$", maxLength: 75 }),
    runtimeChange: "live",
    layer: "L1",
    allowedScopes: ["managed", "user"],
    ui: { tab: "secrets", widget: "secret", order: 1, label: "API 키" },
    secret: true,
    since: "0.1.0",
    ...overrides,
  };
}

export function boolDef(overrides: Partial<SettingDef> = {}): SettingDef {
  return {
    key: "l2.web.enabled",
    type: Type.Boolean(),
    default: true,
    runtimeChange: "live",
    layer: "L2",
    allowedScopes: ["managed", "user", "project", "local", "session"],
    ui: { tab: "tools", widget: "toggle", order: 1, label: "웹 도구" },
    since: "0.1.0",
    ...overrides,
  };
}
