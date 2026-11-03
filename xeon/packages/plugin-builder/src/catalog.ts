import type { KindEntry } from "@fresnel/contracts/services";

// L3.authoring.spec §3.4 종류 카탈로그. wire `ext.kinds`가 `single-plugin`과 `plugin-group` 두 종류를 돌려주므로(T-F 계약)
// 항목은 그 둘이다. 그룹 템플릿 세 종류(drive, policy, observe)는 `plugin-group` 항목의 선택지다.
// 항목은 지우지 않고 `status`만 바꾼다(spec §4.4 4번).

export const CATALOG_VERSION = "0.1.0";

export const KIND_CATALOG: readonly KindEntry[] = [
  {
    id: "plugin-group",
    title: "Plugin group",
    layers: ["L3"],
    status: "stable",
    since: CATALOG_VERSION,
    requires: { contracts: "^0.0.0" },
    template: "group-sdk/templates",
    checks: ["AU-001", "AU-002", "AU-003", "AU-004", "AU-009", "AU-012"],
    decisions: ["group.template", "group.composition", "ui.mode"],
    security: ["trust.noBuiltin", "secrets.noLiteral"],
  },
  {
    id: "single-plugin",
    title: "Single plugin",
    layers: ["L1", "L2", "L3", "plugin"],
    status: "stable",
    since: CATALOG_VERSION,
    requires: { contracts: "^0.0.0" },
    template: "plugin-builder/templates/single-plugin",
    checks: ["AU-001", "AU-002", "AU-003", "AU-009"],
    decisions: ["layer", "ui.mode"],
    security: ["trust.noBuiltin", "secrets.noLiteral"],
  },
];

export function kindEntryOf(id: string): KindEntry | undefined {
  return KIND_CATALOG.find((entry) => entry.id === id);
}
