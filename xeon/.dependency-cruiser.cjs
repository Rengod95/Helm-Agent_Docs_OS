/**
 * Layer rank: F(0) < X(1) < L0(2) < L1(3) < P(4) < L4(5).
 * A package imports only lower ranks. Same-layer packages never import each other.
 * P is the plugin rank (6.3 DR-15): packages/cap-*, packages/plugin-*, packages/plugin-builder, packages/plugin-migration. plugins/* rank as L1,
 * apps/* and packages/client (adr.0020) as L4. vendor/* is excluded from the graph.
 * Keep in sync with scripts/check-layers.ts (it reads package.json fresnel.layer; this reads paths).
 */
const P_RE = "^(packages/cap-|packages/plugin-|packages/orchestration-sdk/)";
const LAYERS = [
  { name: "F", re: "^packages/contracts/" },
  { name: "X", re: "^packages/ext-host/" },
  { name: "L0", re: "^packages/platform-" },
  { name: "L1", re: "^(packages/core-|plugins/)" },
  { name: "P", re: P_RE },
  { name: "L4", re: "^(apps/|packages/client/)" },
];

const upward = LAYERS.slice(0, -1).map((layer, index) => ({
  name: `no-upward-import-from-${layer.name}`,
  severity: "error",
  comment: `${layer.name} must not import a higher layer.`,
  from: { path: layer.re },
  to: { path: LAYERS.slice(index + 1).map((higher) => higher.re) },
}));

// Same-layer packages: $1 is the importing package directory name.
const sameLayerGroups = [
  {
    name: "L0",
    from: "^packages/(platform-[^/]+)/",
    to: "^packages/platform-",
    own: "^packages/$1/",
  },
  {
    name: "L1-core",
    from: "^packages/(core-[^/]+)/",
    to: "^(packages/core-|plugins/)",
    own: "^packages/$1/",
  },
  {
    name: "L1-plugins",
    from: "^plugins/([^/]+)/",
    to: "^(packages/core-|plugins/)",
    own: "^plugins/$1/",
  },
  // P (6.3 DR-15): a plugin imports no other plugin. "to" is every P package (cap-*, plugin-*, orchestration-sdk).
  {
    name: "P-cap",
    from: "^packages/(cap-[^/]+)/",
    to: "^packages/(cap-|plugin-|orchestration-sdk/)",
    own: "^packages/$1/",
  },
  // DR-02/orchestration-sdk and DR-02/plugin-builder-orchestration-sdk (scripts/dependency-allowlist.json): every group and the Plugin Builder may import
  // the orchestration-sdk entries "." and "./testing" and nothing else of orchestration-sdk or of another plugin.
  {
    name: "P-group",
    from: "^packages/(plugin-(?!migration)[^/]+)/",
    to: "^packages/(cap-|plugin-|orchestration-sdk/)",
    own: ["^packages/$1/", "^packages/orchestration-sdk/src/(index|testing/index)\\.ts$"],
  },
  // DR-10/cli-host (scripts/dependency-allowlist.json): apps/cli may import @fresnel/host entries ".", "./client" and "./plugin-host" only.
  // DR-10/cli-client, DR-10/desktop-client, DR-10/host-client: apps may import packages/client, so it is not in the "to" of the app groups.
  {
    name: "L4",
    from: "^apps/(?!cli/)([^/]+)/",
    to: "^apps/",
    own: "^apps/$1/",
  },
  {
    name: "L4-cli",
    from: "^apps/(cli)/",
    to: "^apps/",
    own: ["^apps/$1/", "^apps/host/src/(index|client|plugin-host/run)\\.ts$"],
  },
];

// packages/client (L4, adr.0020) imports F only: no app, no engine package.
sameLayerGroups.push({
  name: "L4-client",
  from: "^packages/(client)/",
  to: "^apps/",
  own: "^packages/$1/",
});

const sameLayer = sameLayerGroups.map((group) => ({
  name: `no-same-layer-import-${group.name}`,
  severity: "error",
  comment: "Packages of the same layer cooperate through F contracts and Cordis services only.",
  from: { path: group.from },
  to: { path: group.to, pathNot: group.own },
}));

// DR-15 (6.3 P.2): a plugin imports no L0 or L1 package (platform-*, core-*, plugins/*) in its sources. Test files are exempt.
// There is no exception: plugins get core services injected by the assembly root through ports typed in contracts.
// check-layers checks the same rule and still reads DR-15/<name> allowlist entries.
const P_TEST = "(^|/)(test|tests)/|\\.(test|spec)\\.[cm]?[jt]sx?$";
const P_LOWER = "^(packages/platform-|packages/core-|plugins/)";
const pLowerImports = [
  {
    name: "no-l0-or-l1-import-from-P",
    severity: "error",
    comment:
      "A plugin imports only contracts, ext-host, orchestration-sdk and external packages (DR-15).",
    from: { path: P_RE, pathNot: P_TEST },
    to: { path: P_LOWER },
  },
];

module.exports = {
  forbidden: [
    ...upward,
    ...sameLayer,
    ...pLowerImports,
    {
      name: "no-circular",
      severity: "error",
      comment: "Cycles break the layer graph and the build order.",
      from: {},
      to: { circular: true },
    },
    {
      name: "cordis-only-in-ext-host",
      severity: "error",
      comment: "Cordis stays behind ext-host.",
      from: { pathNot: "^packages/ext-host/" },
      to: { path: "^vendor/cordis/" },
    },
    {
      name: "no-non-package-json",
      severity: "error",
      comment: "Import only declared dependencies.",
      from: {},
      to: { dependencyTypes: ["npm-no-pkg", "npm-unknown"] },
    },
    {
      name: "no-deprecated-core",
      severity: "warn",
      from: {},
      to: {
        dependencyTypes: ["core"],
        path: "^(punycode|domain|constants|sys|_linklist|_stream_wrap)$",
      },
    },
  ],
  options: {
    // vendor stays in the graph only so cordis-only-in-ext-host can fire; its internals are not followed.
    doNotFollow: { path: ["node_modules", "^vendor/", "(^|/)dist/"] },
    exclude: { path: ["(^|/)dist/", "^apps/desktop/mockups/"] }, // 셸 목업은 제품 코드가 아니다(lint·knip·TS 규칙과 같이 제외)
    includeOnly: { path: "^(packages|apps|plugins|vendor)/" },
    // typescript >= 7 has no programmatic API; dependency-cruiser parses with swc instead.
    parser: "swc",
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types"],
    },
    skipAnalysisNotInRules: true,
  },
};
