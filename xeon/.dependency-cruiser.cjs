/**
 * Layer rank: F(0) < X(1) < L0(2) < L1(3) < L2(4) < L3(5) < L4(6).
 * A package imports only lower ranks. Same-layer packages never import each other.
 * plugins/* rank as L1, apps/* as L4. vendor/* is excluded from the graph.
 * Keep in sync with scripts/check-layers.ts (it reads package.json xeon.layer; this reads paths).
 */
const LAYERS = [
  { name: "F", re: "^packages/contracts/" },
  { name: "X", re: "^packages/ext-host/" },
  { name: "L0", re: "^packages/platform-" },
  { name: "L1", re: "^(packages/core-|plugins/)" },
  { name: "L2", re: "^packages/cap-" },
  { name: "L3", re: "^packages/group-" },
  { name: "L4", re: "^apps/" },
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
  { name: "L2", from: "^packages/(cap-[^/]+)/", to: "^packages/cap-", own: "^packages/$1/" },
  { name: "L3", from: "^packages/(group-[^/]+)/", to: "^packages/group-", own: "^packages/$1/" },
  { name: "L4", from: "^apps/([^/]+)/", to: "^apps/", own: "^apps/$1/" },
];

const sameLayer = sameLayerGroups.map((group) => ({
  name: `no-same-layer-import-${group.name}`,
  severity: "error",
  comment: "Packages of the same layer cooperate through F contracts and Cordis services only.",
  from: { path: group.from },
  to: { path: group.to, pathNot: group.own },
}));

module.exports = {
  forbidden: [
    ...upward,
    ...sameLayer,
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
    exclude: { path: ["(^|/)dist/"] },
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
