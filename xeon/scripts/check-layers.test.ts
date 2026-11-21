import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import {
  type AllowEntry,
  checkLayers,
  expectedDomain,
  expectedLayer,
  extractImports,
  extractSpawns,
  extractSpecifiers,
  formatViolation,
  loadRouteDomains,
  matchesFrom,
  patternLines,
  RANK,
} from "./check-layers.ts";

let root = "";
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fresnel-layers-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** Directory of a fixture package by name, the same way the real tree is laid out. */
function dirOfName(name: string): string {
  const base = name.replace("@fresnel/", "");
  if (base === "cordis") return "vendor/cordis";
  if (base.startsWith("provider-")) return `plugins/${base}`;
  if (["cli", "host", "desktop"].includes(base)) return `apps/${base}`;
  return `packages/${base}`;
}

interface PkgOptions {
  files?: Record<string, string>;
  domain?: string;
  /** tsconfig references; defaults to every workspace dependency. */
  references?: string[];
  tsconfig?: boolean;
  /** Put the dependencies in devDependencies instead of dependencies. */
  dev?: boolean;
}

function pkg(dir: string, layer: string, deps: string[] = [], options: PkgOptions = {}): void {
  const base = dir.split("/")[1] ?? "";
  const name = `@fresnel/${base}`;
  // orchestration-sdk의 도메인은 문서 id(L3.group-sdk.*)를 따라 group-sdk이다(M3-35)
  const domain =
    options.domain ??
    (base === "orchestration-sdk"
      ? "group-sdk"
      : base.replace(/^(?:platform|core|cap|plugin)-/, ""));
  const dependencies = Object.fromEntries(deps.map((d) => [d, "workspace:*"]));
  mkdirSync(join(root, dir, "src"), { recursive: true });
  writeFileSync(
    join(root, dir, "package.json"),
    JSON.stringify(
      options.dev
        ? { name, fresnel: { layer, domain }, devDependencies: dependencies }
        : { name, fresnel: { layer, domain }, dependencies },
      null,
      2,
    ),
  );
  if (options.tsconfig !== false) {
    const references = options.references ?? deps.map((d) => posix.relative(dir, dirOfName(d)));
    writeFileSync(
      join(root, dir, "tsconfig.json"),
      JSON.stringify({ references: references.map((path) => ({ path })) }, null, 2),
    );
  }
  for (const [file, text] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(root, dir, file)), { recursive: true });
    writeFileSync(join(root, dir, file), text);
  }
}

function allowlist(entries: Partial<AllowEntry>[]): void {
  mkdirSync(join(root, "scripts"), { recursive: true });
  const full = entries.map((entry) => ({
    reason: "approved for the test fixture",
    approvedBy: "test",
    ...entry,
  }));
  writeFileSync(join(root, "scripts/dependency-allowlist.json"), JSON.stringify(full, null, 2));
}

const rules = (): string[] => checkLayers(root).violations.map((v) => v.rule);
const lines = (): string[] => checkLayers(root).violations.map(formatViolation);

test("expectedLayer maps directories to layers", () => {
  expect(expectedLayer("packages/contracts")).toBe("F");
  expect(expectedLayer("packages/ext-host")).toBe("X");
  expect(expectedLayer("packages/platform-store")).toBe("L0");
  expect(expectedLayer("packages/core-loop")).toBe("L1");
  expect(expectedLayer("packages/cap-web")).toBe("P");
  expect(expectedLayer("packages/plugin-helm")).toBe("P");
  expect(expectedLayer("packages/orchestration-sdk")).toBe("P");
  expect(expectedLayer("packages/plugin-builder")).toBe("P");
  expect(expectedLayer("packages/plugin-migration")).toBe("P");
  expect(expectedLayer("plugins/provider-anthropic-oauth")).toBe("L1");
  expect(expectedLayer("apps/cli")).toBe("L4");
  expect(expectedLayer("packages/client")).toBe("L4");
  expect(expectedDomain("packages/client")).toBe("client");
  expect(expectedLayer("vendor/cordis")).toBe("vendor");
});

test("expectedDomain strips the layer prefix", () => {
  expect(expectedDomain("packages/core-loop")).toBe("loop");
  expect(expectedDomain("packages/platform-store")).toBe("store");
  expect(expectedDomain("packages/orchestration-sdk")).toBe("group-sdk");
  expect(expectedDomain("packages/plugin-helm")).toBe("helm");
  expect(expectedDomain("packages/contracts")).toBe("contracts");
  expect(expectedDomain("packages/ext-host")).toBe("ext-host");
  expect(expectedDomain("plugins/provider-anthropic-oauth")).toBe("provider-anthropic-oauth");
  expect(expectedDomain("apps/host")).toBe("host");
  expect(expectedDomain("vendor/cordis")).toBeUndefined();
});

test("extractSpecifiers finds static, dynamic, type and re-export imports, ignoring comments", () => {
  const text = [
    'import { a } from "@fresnel/one";',
    "import type { B } from '@fresnel/two/sub';",
    'import "@fresnel/three";',
    'export * from "./local.ts";',
    'const c = await import("@fresnel/four");',
    'import {\n  x,\n  y,\n} from "@fresnel/five";',
    '// import z from "@fresnel/commented";',
    '/* import q from "@fresnel/blocked"; */',
  ].join("\n");
  expect(extractSpecifiers(text).toSorted()).toEqual([
    "./local.ts",
    "@fresnel/five",
    "@fresnel/four",
    "@fresnel/one",
    "@fresnel/three",
    "@fresnel/two/sub",
  ]);
  expect(extractSpecifiers(text)).not.toContain("@fresnel/commented");
  expect(extractSpecifiers(text)).not.toContain("@fresnel/blocked");
});

test("extractImports reports the line of the specifier and keeps lines across comments", () => {
  const text = [
    "/* header",
    "   spanning lines */",
    'import { a } from "@fresnel/one";',
    "",
    "// import z from '@fresnel/commented';",
    "import {",
    "  x,",
    '} from "@fresnel/two";',
    'const c = await import("@fresnel/three");',
  ].join("\n");
  expect(extractImports(text)).toEqual([
    { spec: "@fresnel/one", line: 3 },
    { spec: "@fresnel/two", line: 8 },
    { spec: "@fresnel/three", line: 9 },
  ]);
});

test("downward dependencies pass", () => {
  pkg("packages/contracts", "F", [], { domain: "contracts" });
  pkg("packages/core-loop", "L1", ["@fresnel/contracts"], {
    files: { "src/a.ts": 'import "@fresnel/contracts";' },
  });
  pkg("apps/cli", "L4", ["@fresnel/core-loop"], {
    files: { "src/a.ts": 'import "@fresnel/core-loop";' },
  });
  expect(lines()).toEqual([]);
});

test("DR-01: upward package.json dependency fails at the dependency line", () => {
  pkg("packages/core-loop", "L1", ["@fresnel/cap-web"]);
  pkg("packages/cap-web", "L2");
  const found = checkLayers(root).violations;
  expect(found.map((v) => v.rule)).toEqual(["DR-01"]);
  expect(found[0]?.file).toBe("packages/core-loop/package.json");
  expect(found[0]?.line).toBeGreaterThan(1);
});

test("DR-01: upward source import is reported as file:line with the guide format", () => {
  pkg("packages/core-loop", "L1", ["@fresnel/cap-web"], {
    files: { "src/turn.ts": '\n\nimport type { X } from "@fresnel/cap-web";\n' },
  });
  pkg("packages/cap-web", "L2");
  expect(lines()).toEqual([
    "packages/core-loop/src/turn.ts:3 DR-01 L1 package @fresnel/core-loop imports higher layer P (@fresnel/cap-web)",
  ]);
});

test("DR-04: an undeclared upward import reports both rules", () => {
  pkg("packages/core-loop", "L1", [], { files: { "src/a.ts": 'import "@fresnel/cap-web";' } });
  pkg("packages/cap-web", "L2");
  expect(rules().toSorted()).toEqual(["DR-01", "DR-04"]);
});

test("DR-02: same-layer import fails", () => {
  pkg("packages/core-loop", "L1", ["@fresnel/core-tools"], {
    files: { "src/a.ts": 'import "@fresnel/core-tools";' },
  });
  pkg("packages/core-tools", "L1");
  expect(rules()).toEqual(["DR-02"]);
});

test("DR-02: plugins count as L1, so importing core-* fails and platform-* passes", () => {
  pkg("packages/core-models", "L1");
  pkg("packages/platform-secrets", "L0");
  pkg("plugins/provider-x", "L1", ["@fresnel/core-models", "@fresnel/platform-secrets"], {
    domain: "provider-x",
  });
  expect(rules()).toEqual(["DR-02"]);
});

test("DR-10: apps importing apps fail under DR-10", () => {
  pkg("apps/cli", "L4", ["@fresnel/host"], { files: { "src/a.ts": 'import "@fresnel/host";' } });
  pkg("apps/host", "L4");
  expect(rules()).toEqual(["DR-10"]);
});

test("DR-10: an app importing packages/client fails until the allowlist names it, and client importing an app fails under DR-02", () => {
  pkg("packages/contracts", "F");
  pkg("packages/client", "L4", ["@fresnel/contracts", "@fresnel/host"], {
    domain: "client",
    files: { "src/a.ts": 'import "@fresnel/contracts";\nimport "@fresnel/host";' },
  });
  pkg("apps/host", "L4");
  pkg("apps/cli", "L4", ["@fresnel/client"], {
    files: { "src/a.ts": 'import "@fresnel/client";' },
  });
  expect(rules().toSorted()).toEqual(["DR-02", "DR-10"]);
  allowlist([{ id: "DR-10/cli-client", rule: "DR-10", from: "apps/cli", to: "@fresnel/client" }]);
  expect(rules()).toEqual(["DR-02"]);
});

test("allowlist: a listed same-layer pair passes, an unlisted pair still fails", () => {
  pkg("apps/cli", "L4", ["@fresnel/host", "@fresnel/desktop"], {
    files: { "src/a.ts": 'import "@fresnel/host";\nimport "@fresnel/desktop";' },
  });
  pkg("apps/host", "L4");
  pkg("apps/desktop", "L4");
  allowlist([
    { id: "DR-10/cli-host", rule: "DR-10", from: "apps/cli", to: "@fresnel/host", entries: ["."] },
  ]);
  expect(lines()).toEqual([
    "apps/cli/src/a.ts:2 DR-10 L4 package @fresnel/cli imports same-layer package @fresnel/desktop; apps connect through the sidecar",
  ]);
});

test("allowlist: only the listed entry points are allowed", () => {
  pkg("packages/plugin-helm", "L3", ["@fresnel/orchestration-sdk"], {
    files: {
      "src/a.ts":
        'import "@fresnel/orchestration-sdk";\nimport "@fresnel/orchestration-sdk/internal";',
    },
  });
  pkg("packages/orchestration-sdk", "L3");
  allowlist([
    {
      id: "DR-02/orchestration-sdk-helm",
      rule: "DR-02",
      from: "packages/plugin-helm",
      to: "@fresnel/orchestration-sdk",
    },
  ]);
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toContain("src/a.ts:2 DR-02");
});

test("allowlist: the entry must match the rule and the importing package", () => {
  pkg("packages/plugin-helm", "L3", ["@fresnel/orchestration-sdk"], {
    files: { "src/a.ts": 'import "@fresnel/orchestration-sdk";' },
  });
  pkg("packages/plugin-learning", "L3", ["@fresnel/orchestration-sdk"], {
    files: { "src/a.ts": 'import "@fresnel/orchestration-sdk";' },
  });
  pkg("packages/orchestration-sdk", "L3");
  allowlist([
    {
      id: "DR-02/orchestration-sdk-helm",
      rule: "DR-02",
      from: "packages/plugin-helm",
      to: "@fresnel/orchestration-sdk",
    },
  ]);
  const found = checkLayers(root).violations;
  expect(found.map((v) => `${v.file}:${v.line} ${v.rule}`)).toEqual([
    "packages/plugin-learning/src/a.ts:1 DR-02",
  ]);
});

test("allowlist: a family pattern matches each package of the family and no deeper path", () => {
  expect(matchesFrom("packages/plugin-*", "packages/plugin-helm")).toBe(true);
  expect(matchesFrom("packages/plugin-*", "packages/orchestration-sdk")).toBe(false);
  expect(matchesFrom("packages/plugin-*", "packages/plugin-x/sub")).toBe(false);
  expect(matchesFrom("packages/plugin-*", "packages/core-loop")).toBe(false);
  expect(matchesFrom("packages/plugin-*", "packages/plugin-")).toBe(false);
  expect(matchesFrom("packages/plugin-helm", "packages/plugin-helm")).toBe(true);
  expect(matchesFrom("packages/plugin-helm", "packages/plugin-learning")).toBe(false);
});

test("allowlist: the orchestration-sdk family entry covers each group, its two entries and nothing else", () => {
  pkg("packages/plugin-helm", "L3", ["@fresnel/orchestration-sdk", "@fresnel/plugin-learning"], {
    files: {
      "src/a.ts": [
        'import "@fresnel/orchestration-sdk";',
        'import "@fresnel/orchestration-sdk/testing";',
        'import "@fresnel/orchestration-sdk/internal";',
        'import "@fresnel/plugin-learning";',
      ].join("\n"),
    },
  });
  pkg("packages/plugin-learning", "L3", ["@fresnel/orchestration-sdk"], {
    files: { "src/a.ts": 'import "@fresnel/orchestration-sdk";' },
  });
  pkg("packages/orchestration-sdk", "L3");
  allowlist([
    {
      id: "DR-02/orchestration-sdk",
      rule: "DR-02",
      from: "packages/plugin-*",
      to: "@fresnel/orchestration-sdk",
      entries: [".", "./testing"],
    },
  ]);
  // plugin-helm의 두 허용 진입점은 통과한다. 내부 진입점과 다른 그룹 import는 소스 파일에서 위반이다
  const sources = checkLayers(root)
    .violations.filter((v) => v.file === "packages/plugin-helm/src/a.ts")
    .map(formatViolation);
  expect(sources).toEqual([
    "packages/plugin-helm/src/a.ts:3 DR-02 P package @fresnel/plugin-helm imports same-layer package @fresnel/orchestration-sdk; share through F contracts or Cordis services",
    "packages/plugin-helm/src/a.ts:4 DR-02 P package @fresnel/plugin-helm imports same-layer package @fresnel/plugin-learning; share through F contracts or Cordis services",
  ]);
});

test("allowlist: a family pattern must match at least one workspace package", () => {
  pkg("packages/core-loop", "L1");
  allowlist([
    { id: "DR-02/ghost", rule: "DR-02", from: "packages/ghost-*", to: "@fresnel/core-loop" },
  ]);
  const found = checkLayers(root).violations;
  expect(found.map((v) => v.message)).toEqual([
    "from packages/ghost-* is not a workspace package directory",
  ]);
});

test("allowlist: stale and inconsistent entries are violations", () => {
  pkg("packages/core-loop", "L1");
  allowlist([
    { id: "DR-02/ghost", rule: "DR-02", from: "packages/ghost", to: "@fresnel/core-loop" },
    { id: "DR-02/other", rule: "DR-10", from: "packages/core-loop", to: "@fresnel/ghost" },
  ]);
  const found = checkLayers(root).violations;
  expect(found.every((v) => v.file === "scripts/dependency-allowlist.json")).toBe(true);
  expect(found).toHaveLength(3);
  expect(found.map((v) => v.message).join("\n")).toContain("is not a workspace package directory");
  expect(found.map((v) => v.message).join("\n")).toContain("must start with DR-10/");
});

test("allowlist: a malformed file is a tool error, not a violation", () => {
  pkg("packages/core-loop", "L1");
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts/dependency-allowlist.json"), '[{"id": "bad"}]');
  expect(() => checkLayers(root)).toThrow("allowlist format");
  writeFileSync(join(root, "scripts/dependency-allowlist.json"), "not json");
  expect(() => checkLayers(root)).toThrow("cannot parse");
});

test("DR-03: layer must match directory", () => {
  pkg("packages/cap-web", "L1");
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatch(
    /^packages\/cap-web\/package\.json:\d+ DR-03 packages\/cap-web must declare layer P but declares L1/,
  );
});

test("DR-03: missing or invalid layer fails", () => {
  pkg("packages/cap-web", "L9");
  expect(rules()).toEqual(["DR-03"]);
});

test("DR-03: layer vendor outside vendor/ fails", () => {
  pkg("packages/cap-web", "vendor");
  expect(rules()).toEqual(["DR-03"]);
});

test("DR-03: domain must equal the directory name without its prefix", () => {
  pkg("packages/core-loop", "L1", [], { domain: "turns" });
  expect(lines()[0]).toMatch(
    /DR-03 packages\/core-loop must declare domain loop but declares turns/,
  );
});

test("DR-03: a package without domain fails", () => {
  pkg("packages/core-loop", "L1");
  writeFileSync(
    join(root, "packages/core-loop/package.json"),
    JSON.stringify({ name: "@fresnel/core-loop", fresnel: { layer: "L1" } }),
  );
  expect(lines()[0]).toMatch(/DR-03 .*domain is missing/);
});

test("DR-03: a workspace directory without package.json fails", () => {
  mkdirSync(join(root, "packages/core-ghost/src"), { recursive: true });
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toStartWith("packages/core-ghost/package.json:1 DR-03");
});

test("DR-03: domain must appear in routes.yaml for L0-L2 packages", () => {
  const routes = join(root, "routes.yaml");
  writeFileSync(
    routes,
    [
      "layout:",
      "  L0:",
      "    domains: [store]",
      "  L1:",
      "    domains: [loop]",
      "  L2:",
      "    domains: [web]",
    ].join("\n"),
  );
  pkg("packages/core-loop", "L1");
  pkg("packages/core-newthing", "L1");
  const { violations } = checkLayers(root, { routesFile: routes });
  expect(violations.map((v) => `${v.file} ${v.rule}`)).toEqual([
    "packages/core-newthing/package.json DR-03",
  ]);
  expect(violations[0]?.message).toContain("routes.yaml layout.L1.domains");
  expect(loadRouteDomains(routes)).toEqual({ L0: ["store"], L1: ["loop"], L2: ["web"] });
});

test("DR-03: an unreadable routes.yaml is a tool error", () => {
  pkg("packages/core-loop", "L1");
  expect(() => checkLayers(root, { routesFile: join(root, "missing.yaml") })).toThrow(
    "cannot read",
  );
});

test("vendor is excluded in both directions", () => {
  pkg("vendor/cordis", "vendor");
  pkg("packages/ext-host", "X", ["@fresnel/cordis"], {
    domain: "ext-host",
    files: { "src/a.ts": 'import "@fresnel/cordis";' },
  });
  expect(lines()).toEqual([]);
});

test("DR-05: relative import out of the package fails", () => {
  pkg("packages/core-loop", "L1", [], {
    files: { "src/a.ts": '\nimport "../../cap-web/src/index.ts";' },
  });
  pkg("packages/cap-web", "L2");
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatch(/^packages\/core-loop\/src\/a\.ts:2 DR-05 /);
});

test("DR-05: importing @fresnel/<name>/src fails", () => {
  pkg("packages/platform-store", "L0");
  pkg("packages/core-loop", "L1", ["@fresnel/platform-store"], {
    files: { "src/index.ts": 'import { z } from "@fresnel/platform-store/src/index.ts";' },
  });
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatch(/^packages\/core-loop\/src\/index\.ts:1 DR-05 /);
});

test("test files are scanned too", () => {
  pkg("packages/contracts", "F", [], {
    domain: "contracts",
    files: { "test/a.test.ts": 'import "@fresnel/core-loop";' },
  });
  pkg("packages/core-loop", "L1");
  expect(rules()).toContain("DR-01");
});

test("DR-04: import of an unknown @fresnel package fails", () => {
  pkg("packages/core-loop", "L1", [], { files: { "src/a.ts": 'import "@fresnel/ghost";' } });
  expect(lines()).toEqual([
    "packages/core-loop/src/a.ts:1 DR-04 @fresnel/ghost is not a workspace package",
  ]);
});

test("DR-04: a workspace dependency needs a tsconfig reference", () => {
  pkg("packages/contracts", "F", [], { domain: "contracts" });
  pkg("packages/core-loop", "L1", ["@fresnel/contracts"], { references: [] });
  expect(lines()).toEqual([
    "packages/core-loop/tsconfig.json:1 DR-04 package.json declares @fresnel/contracts but tsconfig.json has no reference to packages/contracts",
  ]);
});

test("DR-04: a tsconfig reference needs a workspace dependency", () => {
  pkg("packages/contracts", "F", [], { domain: "contracts" });
  pkg("packages/core-loop", "L1", [], { references: ["../contracts", "../ghost"] });
  const found = lines();
  expect(found).toHaveLength(2);
  expect(found.join("\n")).toContain(
    "references @fresnel/contracts but package.json does not declare it",
  );
  expect(found.join("\n")).toContain("reference packages/ghost is not a workspace package");
  expect(found.every((line) => /^packages\/core-loop\/tsconfig\.json:\d+ DR-04 /.test(line))).toBe(
    true,
  );
});

test("DR-04: references accept tsconfig.json file paths and comments in tsconfig", () => {
  pkg("packages/contracts", "F", [], { domain: "contracts" });
  pkg("packages/core-loop", "L1", ["@fresnel/contracts"]);
  writeFileSync(
    join(root, "packages/core-loop/tsconfig.json"),
    '// comment\n{ "references": [{ "path": "../contracts/tsconfig.json", },], }',
  );
  expect(lines()).toEqual([]);
});

test("DR-04: a missing tsconfig.json fails and an unreadable one is a tool error", () => {
  pkg("packages/core-loop", "L1", [], { tsconfig: false });
  expect(lines()).toEqual([
    "packages/core-loop/tsconfig.json:1 DR-04 tsconfig.json is missing; it must reference every workspace dependency",
  ]);
  writeFileSync(join(root, "packages/core-loop/tsconfig.json"), "{ not json");
  expect(() => checkLayers(root)).toThrow("cannot parse");
});

test("an unreadable package.json is a tool error", () => {
  pkg("packages/core-loop", "L1");
  writeFileSync(join(root, "packages/core-loop/package.json"), "{");
  expect(() => checkLayers(root)).toThrow("cannot parse");
});

test("the CLI exits 1 on violations, 2 on tool errors and 0 on a clean tree", () => {
  const run = (): { code: number; err: string } => {
    const result = Bun.spawnSync(["bun", join(import.meta.dir, "check-layers.ts"), root], {
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: result.exitCode, err: result.stderr.toString() };
  };
  const routes = join(root, "../docs/xeon/_routing/routes.yaml");
  mkdirSync(dirname(routes), { recursive: true });
  writeFileSync(
    routes,
    "layout:\n  L0:\n    domains: []\n  L1:\n    domains: [loop]\n  L2:\n    domains: []\n",
  );
  try {
    pkg("packages/core-loop", "L1");
    expect(run().code).toBe(0);
    pkg("packages/core-loop", "L2");
    const failed = run();
    expect(failed.code).toBe(1);
    expect(failed.err).toMatch(/packages\/core-loop\/package\.json:\d+ DR-03 /);
    writeFileSync(join(root, "packages/core-loop/package.json"), "{");
    expect(run().code).toBe(2);
  } finally {
    rmSync(join(root, "../docs"), { recursive: true, force: true });
  }
});

test("allowlist: a listed pair also passes when only package.json declares it", () => {
  pkg("apps/cli", "L4", ["@fresnel/host"]);
  pkg("apps/host", "L4");
  expect(rules()).toEqual(["DR-10"]);
  allowlist([{ id: "DR-10/cli-host", rule: "DR-10", from: "apps/cli", to: "@fresnel/host" }]);
  expect(rules()).toEqual([]);
});

// DR-07 process spawning (review.decisions-2 B-06)
const SPAWN_SRC = 'const proc = Bun.spawn(["echo", "x"]);\n';
const spawnEntry = (from: string): Partial<AllowEntry> => ({
  id: `DR-07/${from.split("/")[1]}-test-spawn`,
  rule: "DR-07",
  from,
  to: "Bun.spawn",
  scope: "test",
});

test("extractSpawns finds Bun.spawn, Bun.spawnSync and node:child_process, ignoring comments", () => {
  expect(extractSpawns(SPAWN_SRC)).toEqual([1]);
  expect(extractSpawns('// Bun.spawn(x)\n/* Bun.spawnSync */\nBun.spawnSync(["a"]);')).toEqual([3]);
  expect(extractSpawns('import { spawn } from "node:child_process";')).toEqual([1]);
  expect(extractSpawns('const cp = require("child_process");')).toEqual([1]);
  expect(extractSpawns('import { x } from "node:fs";')).toEqual([]);
});

test("DR-07: a source file outside the L0 owners fails even with a test-scope entry", () => {
  pkg("packages/core-persistence", "L1", [], { files: { "src/run.ts": SPAWN_SRC } });
  allowlist([spawnEntry("packages/core-persistence")]);
  const found = checkLayers(root).violations;
  expect(found.map((v) => `${v.file}:${v.line} ${v.rule}`)).toEqual([
    "packages/core-persistence/src/run.ts:1 DR-07",
  ]);
  expect(found[0]?.message).toContain("sources");
});

test("DR-07: a test file needs a scope test entry of its own package", () => {
  pkg("apps/cli", "L4", [], { files: { "test/chat.scenario.test.ts": SPAWN_SRC } });
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toContain("apps/cli/test/chat.scenario.test.ts:1 DR-07");
  allowlist([spawnEntry("apps/cli")]);
  expect(lines()).toEqual([]);
  // an entry of another package does not cover it
  allowlist([spawnEntry("packages/core-persistence")]);
  pkg("packages/core-persistence", "L1");
  expect(rules()).toEqual(["DR-07"]);
});

test("DR-07: the owners spawn in sources, and any platform-* package spawns in tests", () => {
  pkg("packages/platform-exec", "L0", [], { files: { "src/run.ts": SPAWN_SRC } });
  pkg("packages/platform-store", "L0", [], {
    files: { "test/support/child.ts": SPAWN_SRC },
  });
  expect(lines()).toEqual([]);
});

test("DR-07: platform-store sources are not an owner of process execution", () => {
  pkg("packages/platform-store", "L0", [], { files: { "src/run.ts": SPAWN_SRC } });
  expect(rules()).toEqual(["DR-07"]);
});

test("DR-07: a node:child_process import in a test is covered by the same entry", () => {
  pkg("packages/cap-workspace", "L2", [], {
    files: { "test/fork-records.test.ts": 'import { execFileSync } from "node:child_process";' },
  });
  expect(rules()).toEqual(["DR-07"]);
  allowlist([spawnEntry("packages/cap-workspace")]);
  expect(rules()).toEqual([]);
});

test("DR-07: allowlist entries need scope test and the Bun.spawn target", () => {
  pkg("apps/cli", "L4");
  allowlist([
    { id: "DR-07/cli-all", rule: "DR-07", from: "apps/cli", to: "Bun.spawn" },
    { id: "DR-07/cli-other", rule: "DR-07", from: "apps/cli", to: "bun:sqlite", scope: "test" },
  ]);
  const messages = checkLayers(root)
    .violations.map((v) => v.message)
    .join("\n");
  expect(messages).toContain('need scope "test"');
  expect(messages).toContain("cover Bun.spawn only");
});

const CONVERT = "src/fetch/convert";

test("WEB-R16: network calls, Bun access and socket construction in the convert directory fail", () => {
  pkg("packages/cap-web", "L2", [], {
    files: {
      [`${CONVERT}/a.ts`]: "export const a = await fetch(url);",
      [`${CONVERT}/nested/b.ts`]: "export const b = Bun.version;",
      [`${CONVERT}/c.ts`]: "export const c = new WebSocket(url);",
    },
  });
  expect(lines()).toEqual([
    "packages/cap-web/src/fetch/convert/a.ts:1 WEB-R16 conversion modules never call the network (fetch, WebSocket, EventSource, XMLHttpRequest)",
    "packages/cap-web/src/fetch/convert/c.ts:1 WEB-R16 conversion modules never call the network (fetch, WebSocket, EventSource, XMLHttpRequest)",
    "packages/cap-web/src/fetch/convert/c.ts:1 WEB-R16 conversion modules never construct network objects",
    "packages/cap-web/src/fetch/convert/nested/b.ts:1 WEB-R16 conversion modules are pure functions and never touch the Bun runtime API",
  ]);
});

test("WEB-R16: dynamic imports and globalThis access in the convert directory fail", () => {
  pkg("packages/cap-web", "L2", [], {
    files: {
      [`${CONVERT}/d.ts`]: 'export const d = await import("node:https");',
      [`${CONVERT}/e.ts`]: 'export const e = globalThis["fetch"];',
    },
  });
  expect(lines()).toEqual([
    "packages/cap-web/src/fetch/convert/d.ts:1 WEB-R16 conversion modules use static imports only (a dynamic import escapes the no-network import lint)",
    'packages/cap-web/src/fetch/convert/e.ts:1 WEB-R16 conversion modules never reach globals through globalThis (globalThis["fetch"] escapes the call check)',
  ]);
});

test("WEB-R16: other cap-web directories, comments and test files are not scanned", () => {
  pkg("packages/cap-web", "L2", [], {
    files: {
      "src/fetch/pipeline.ts": "export const a = await fetch(url);",
      [`${CONVERT}/ok.ts`]: "// fetch(url) is not allowed here\nexport const ok = 1;",
      [`${CONVERT}/ok.test.ts`]: "export const t = Bun.version;",
    },
  });
  expect(lines()).toEqual([]);
});

test("patternLines reports each matching line once", () => {
  expect(
    patternLines("a\nfetch(x); fetch(y)\n/* fetch(z) */\nrefetch(q)", /\bfetch\s*\(/g),
  ).toEqual([2]);
});

// DR-15 plugin rank P (6.3): P sits between L1 and L4; cap-*, plugin-* and plugin-builder are P; L2 and L3 are aliases of P
const P_REASON =
  "; a plugin imports only contracts, ext-host, orchestration-sdk and external packages";

test("the rank order is F X L0 L1 P L4 and P is above L1 and below L4", () => {
  expect(Object.keys(RANK)).toEqual(["F", "X", "L0", "L1", "P", "L4"]);
  expect(RANK.P).toBeGreaterThan(RANK.L1);
  expect(RANK.L4).toBeGreaterThan(RANK.P);
});

test("L2 and L3 are accepted as P only where the directory is a plugin", () => {
  pkg("packages/contracts", "F", [], { domain: "contracts" });
  pkg("packages/cap-web", "L2", ["@fresnel/contracts"], {
    files: { "src/a.ts": 'import "@fresnel/contracts";' },
  });
  pkg("packages/plugin-helm", "L3", ["@fresnel/contracts"], {
    files: { "src/a.ts": 'import "@fresnel/contracts";' },
  });
  pkg("packages/plugin-builder", "P", ["@fresnel/contracts"], {
    files: { "src/a.ts": 'import "@fresnel/contracts";' },
  });
  expect(lines()).toEqual([]);
});

test("L2 and L3 are refused outside the plugin directories", () => {
  pkg("packages/core-loop", "L2");
  pkg("plugins/provider-x", "L3", [], { domain: "provider-x" });
  expect(checkLayers(root).violations.map((v) => `${v.file} ${v.rule}`)).toEqual([
    "packages/core-loop/package.json DR-03",
    "plugins/provider-x/package.json DR-03",
  ]);
});

test("DR-03: a cap-* domain must be in routes.yaml layout.L2, group domains are not listed there", () => {
  const routes = join(root, "routes.yaml");
  writeFileSync(
    routes,
    [
      "layout:",
      "  L0:",
      "    domains: [store]",
      "  L1:",
      "    domains: [loop]",
      "  L2:",
      "    domains: [web]",
    ].join("\n"),
  );
  pkg("packages/cap-web", "P");
  pkg("packages/cap-newthing", "L2");
  pkg("packages/plugin-newthing", "L3");
  const { violations } = checkLayers(root, { routesFile: routes });
  expect(violations.map((v) => `${v.file} ${v.rule}`)).toEqual([
    "packages/cap-newthing/package.json DR-03",
  ]);
  expect(violations[0]?.message).toContain("routes.yaml layout.L2.domains");
});

test("DR-01: a plugin imports no L4 package", () => {
  pkg("packages/cap-web", "P", ["@fresnel/host"], {
    files: { "src/a.ts": 'import "@fresnel/host";' },
  });
  pkg("apps/host", "L4");
  expect(lines()).toEqual([
    "packages/cap-web/src/a.ts:1 DR-01 P package @fresnel/cap-web imports higher layer L4 (@fresnel/host)",
  ]);
});

test("DR-02: plugins never import each other, cap-* or plugin-*", () => {
  pkg("packages/cap-web", "L2", ["@fresnel/cap-mcp"], {
    files: { "src/a.ts": 'import "@fresnel/cap-mcp";' },
  });
  pkg("packages/cap-mcp", "L2");
  pkg("packages/plugin-helm", "L3", ["@fresnel/cap-web"], {
    files: { "src/a.ts": 'import "@fresnel/cap-web";' },
  });
  expect(lines()).toEqual([
    "packages/cap-web/src/a.ts:1 DR-02 P package @fresnel/cap-web imports same-layer package @fresnel/cap-mcp; share through F contracts or Cordis services",
    "packages/plugin-helm/src/a.ts:1 DR-02 P package @fresnel/plugin-helm imports same-layer package @fresnel/cap-web; share through F contracts or Cordis services",
  ]);
});

test("DR-02/orchestration-sdk: the family entry covers the groups and the Plugin Builder, not cap-*", () => {
  pkg("packages/plugin-helm", "L3", ["@fresnel/orchestration-sdk"], {
    files: { "src/a.ts": 'import "@fresnel/orchestration-sdk";' },
  });
  pkg("packages/plugin-builder", "L3", ["@fresnel/orchestration-sdk"], {
    files: { "src/a.ts": 'import "@fresnel/orchestration-sdk";' },
  });
  pkg("packages/cap-web", "L2", ["@fresnel/orchestration-sdk"], {
    files: { "src/a.ts": 'import "@fresnel/orchestration-sdk";' },
  });
  pkg("packages/orchestration-sdk", "L3");
  allowlist([
    {
      id: "DR-02/orchestration-sdk",
      rule: "DR-02",
      from: "packages/plugin-*",
      to: "@fresnel/orchestration-sdk",
      entries: [".", "./testing"],
    },
    {
      id: "DR-02/plugin-builder-orchestration-sdk",
      rule: "DR-02",
      from: "packages/plugin-builder",
      to: "@fresnel/orchestration-sdk",
      entries: [".", "./testing"],
    },
  ]);
  expect(checkLayers(root).violations.map((v) => `${v.file}:${v.line} ${v.rule}`)).toEqual([
    "packages/cap-web/src/a.ts:1 DR-02",
  ]);
});

test("DR-15: a plugin imports no L1 or L0 package in its sources", () => {
  pkg("packages/cap-web", "P", ["@fresnel/core-loop", "@fresnel/platform-store"], {
    dev: true,
    files: { "src/a.ts": 'import "@fresnel/core-loop";\nimport "@fresnel/platform-store";' },
  });
  pkg("packages/core-loop", "L1");
  pkg("packages/platform-store", "L0");
  expect(lines()).toEqual([
    `packages/cap-web/src/a.ts:1 DR-15 P package @fresnel/cap-web imports L1 package @fresnel/core-loop${P_REASON}`,
    `packages/cap-web/src/a.ts:2 DR-15 P package @fresnel/cap-web imports L0 package @fresnel/platform-store${P_REASON}`,
  ]);
});

test("DR-15: a plugin imports no plugins/* package either (they rank as L1)", () => {
  pkg("packages/cap-web", "P", ["@fresnel/provider-x"], {
    dev: true,
    files: { "src/a.ts": 'import "@fresnel/provider-x";' },
  });
  pkg("plugins/provider-x", "L1", [], { domain: "provider-x" });
  expect(lines()).toEqual([
    `packages/cap-web/src/a.ts:1 DR-15 P package @fresnel/cap-web imports L1 package @fresnel/provider-x${P_REASON}`,
  ]);
});

test("DR-15: test files may import core-* and platform-*", () => {
  pkg("packages/cap-web", "P", ["@fresnel/core-loop", "@fresnel/platform-store"], {
    dev: true,
    files: {
      "test/a.test.ts": 'import "@fresnel/core-loop";\nimport "@fresnel/platform-store";',
    },
  });
  pkg("packages/core-loop", "L1");
  pkg("packages/platform-store", "L0");
  expect(lines()).toEqual([]);
});

test("DR-15: a devDependency on core-* is exempt, but its src import is not", () => {
  pkg("packages/cap-web", "P", ["@fresnel/core-loop"], {
    dev: true,
    files: { "src/a.ts": 'import "@fresnel/core-loop";' },
  });
  pkg("packages/core-loop", "L1");
  expect(lines()).toEqual([
    `packages/cap-web/src/a.ts:1 DR-15 P package @fresnel/cap-web imports L1 package @fresnel/core-loop${P_REASON}`,
  ]);
});

test("DR-15: a runtime dependency on core-* fails at its package.json line, with no import", () => {
  pkg("packages/cap-web", "P", ["@fresnel/platform-store"]);
  pkg("packages/platform-store", "L0");
  expect(lines()).toHaveLength(1);
  expect(lines()[0]).toMatch(
    /^packages\/cap-web\/package\.json:\d+ DR-15 P package @fresnel\/cap-web declares a runtime dependency on L0 package @fresnel\/platform-store;/,
  );
});

test("DR-15 allowlist: an edge passes for its entry point only, other targets and packages stay violations", () => {
  pkg("packages/cap-dialog", "P", ["@fresnel/core-tools", "@fresnel/platform-store"], {
    files: {
      "src/a.ts": [
        'import "@fresnel/core-tools";',
        'import "@fresnel/platform-store";',
        'import "@fresnel/core-tools/testing";',
      ].join("\n"),
    },
  });
  pkg("packages/cap-web", "P", ["@fresnel/core-tools"], {
    files: { "src/a.ts": 'import "@fresnel/core-tools";' },
  });
  pkg("packages/core-tools", "L1");
  pkg("packages/platform-store", "L0");
  allowlist([
    {
      id: "DR-15/cap-dialog-core-tools",
      rule: "DR-15",
      from: "packages/cap-dialog",
      to: "@fresnel/core-tools",
    },
  ]);
  // package.json lines carry a line number from the fixture text; they are listed by file only
  const found = checkLayers(root).violations.map((v) =>
    v.file.endsWith("package.json") ? `${v.file} ${v.rule}` : `${v.file}:${v.line} ${v.rule}`,
  );
  expect(found).toEqual([
    "packages/cap-dialog/package.json DR-15",
    "packages/cap-dialog/src/a.ts:2 DR-15",
    "packages/cap-dialog/src/a.ts:3 DR-15",
    "packages/cap-web/package.json DR-15",
    "packages/cap-web/src/a.ts:1 DR-15",
  ]);
});

test("DR-15 allowlist: a listed edge also covers the package.json dependency line", () => {
  pkg("packages/cap-dialog", "P", ["@fresnel/core-tools"], {
    files: { "src/a.ts": 'import "@fresnel/core-tools";' },
  });
  pkg("packages/core-tools", "L1");
  expect(lines()).toHaveLength(2);
  allowlist([
    {
      id: "DR-15/cap-dialog-core-tools",
      rule: "DR-15",
      from: "packages/cap-dialog",
      to: "@fresnel/core-tools",
    },
  ]);
  expect(lines()).toEqual([]);
});
