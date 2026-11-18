import { KIND_CATALOG_VERSION, type KindEntry } from "@fresnel/contracts/services";

// L3.authoring.spec §3.4 종류 카탈로그. 종류는 플러그인 하나뿐이라(review/m5/profile-project-loader.md §4.9.5) 항목도 그 하나다.
// 항목은 지우지 않고 `status`만 바꾼다(spec §4.4 4번).

export const KIND_CATALOG: readonly KindEntry[] = [
  {
    id: "single-plugin",
    title: "Single plugin",
    layers: ["L1", "L2", "L3", "plugin"],
    status: "stable",
    since: KIND_CATALOG_VERSION,
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
