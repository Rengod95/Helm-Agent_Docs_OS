#!/usr/bin/env bun
// Layer rule checker. Reads each workspace package's package.json "xeon.layer" and fails (exit 1) when
//   - a dependency (package.json) or an import (source) points at the same or a higher layer,
//   - a package uses a layer that does not match its directory,
//   - a source file imports a workspace package that package.json does not declare,
//   - a source file reaches outside its package by relative path.
// Rank: F(0) < X(1) < L0(2) < L1(3) < L2(4) < L3(5) < L4(6). plugins/* count as L1, apps/* as L4, vendor/* is excluded.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export const RANK = { F: 0, X: 1, L0: 2, L1: 3, L2: 4, L3: 5, L4: 6 } as const;
export type Layer = keyof typeof RANK;

export interface PackageInfo {
  /** Directory relative to the xeon root, e.g. packages/core-loop. */
  dir: string;
  name: string;
  layer: string | undefined;
  declared: string[];
  imports: { spec: string; file: string }[];
}

export interface Violation {
  rule: string;
  pkg: string;
  message: string;
}

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,mjs,cjs}";
const SKIP = /(^|\/)(node_modules|dist|\.turbo|coverage)(\/|$)/;
const WORKSPACE_ROOTS = ["packages", "apps", "plugins", "vendor"] as const;

function isLayer(value: string | undefined): value is Layer {
  return value !== undefined && Object.hasOwn(RANK, value);
}

/** Layer a package must declare, derived from where it lives. undefined means unconstrained or excluded. */
export function expectedLayer(dir: string): Layer | "vendor" | undefined {
  const [root, name = ""] = dir.split("/");
  if (root === "vendor") return "vendor";
  if (root === "plugins") return "L1";
  if (root === "apps") return "L4";
  if (root !== "packages") return undefined;
  if (name === "contracts") return "F";
  if (name === "ext-host") return "X";
  if (name.startsWith("platform-")) return "L0";
  if (name.startsWith("core-")) return "L1";
  if (name.startsWith("cap-")) return "L2";
  if (name.startsWith("group-")) return "L3";
  return undefined;
}

/** Module specifiers found in source text. Comments are ignored. */
export function extractSpecifiers(text: string): string[] {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const found: string[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1] !== undefined) found.push(match[1]);
    }
  }
  return found;
}

function workspaceName(spec: string): string | undefined {
  const match = /^@xeon\/([^/]+)/.exec(spec);
  return match?.[1] === undefined ? undefined : `@xeon/${match[1]}`;
}

const stringRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

function readPackage(root: string, dir: string): PackageInfo {
  const json = stringRecord(JSON.parse(readFileSync(join(root, dir, "package.json"), "utf8")));
  const declared = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ].flatMap((key) => Object.keys(stringRecord(json[key])));
  const layer = stringRecord(json["xeon"])["layer"];
  const imports: PackageInfo["imports"] = [];
  for (const file of new Bun.Glob(SOURCE_GLOB).scanSync({ cwd: join(root, dir) })) {
    if (SKIP.test(file)) {
      continue;
    }
    const text = readFileSync(join(root, dir, file), "utf8");
    for (const spec of extractSpecifiers(text)) {
      imports.push({ spec, file });
    }
  }
  return {
    dir,
    name: typeof json["name"] === "string" ? json["name"] : dir,
    layer: typeof layer === "string" ? layer : undefined,
    declared,
    imports,
  };
}

export function collectPackages(root: string): PackageInfo[] {
  const packages: PackageInfo[] = [];
  for (const base of WORKSPACE_ROOTS) {
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) {
      continue;
    }
    for (const manifest of new Bun.Glob("*/package.json").scanSync({ cwd: baseDir })) {
      packages.push(readPackage(root, `${base}/${dirname(manifest)}`));
    }
  }
  return packages.toSorted((a, b) => a.dir.localeCompare(b.dir));
}

export function analyze(packages: readonly PackageInfo[]): Violation[] {
  const violations: Violation[] = [];
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const add = (rule: string, pkg: PackageInfo, message: string): void => {
    violations.push({ rule, pkg: pkg.name, message });
  };

  for (const pkg of packages) {
    const expected = expectedLayer(pkg.dir);
    if (expected === "vendor" || pkg.layer === "vendor") continue;
    if (!isLayer(pkg.layer)) {
      add(
        "layer-invalid",
        pkg,
        `xeon.layer is ${String(pkg.layer)}; expected one of ${Object.keys(RANK).join(", ")}`,
      );
      continue;
    }
    if (expected !== undefined && expected !== pkg.layer) {
      add(
        "layer-location",
        pkg,
        `${pkg.dir} must declare layer ${expected} but declares ${pkg.layer}`,
      );
    }
    const rank = RANK[pkg.layer];

    const targets = new Map<string, string>();
    for (const dep of pkg.declared) {
      if (byName.has(dep)) targets.set(dep, "package.json dependency");
    }
    for (const { spec, file } of pkg.imports) {
      const name = workspaceName(spec);
      if (name === undefined || name === pkg.name) continue;
      if (!byName.has(name)) {
        add("unknown-package", pkg, `${file} imports ${spec}, which is not a workspace package`);
        continue;
      }
      if (!pkg.declared.includes(name)) {
        add(
          "undeclared-dependency",
          pkg,
          `${file} imports ${name} but package.json does not declare it`,
        );
      }
      if (!targets.has(name)) targets.set(name, `import in ${file}`);
    }

    for (const [name, via] of targets) {
      const target = byName.get(name);
      if (target === undefined) continue;
      const targetLayer = expectedLayer(target.dir) === "vendor" ? "vendor" : target.layer;
      if (targetLayer === "vendor" || !isLayer(targetLayer)) continue;
      const targetRank = RANK[targetLayer];
      if (targetRank > rank) {
        add(
          "upward-dependency",
          pkg,
          `${pkg.layer} depends on higher layer ${targetLayer} (${name}) via ${via}`,
        );
      } else if (targetRank === rank) {
        add(
          "same-layer-dependency",
          pkg,
          `${pkg.layer} depends on same-layer package ${name} via ${via}; share through F contracts or Cordis services`,
        );
      }
    }
  }
  return violations;
}

/** Relative imports that leave their package directory. Needs the filesystem root. */
export function relativeEscapes(root: string, packages: readonly PackageInfo[]): Violation[] {
  const violations: Violation[] = [];
  for (const pkg of packages) {
    if (expectedLayer(pkg.dir) === "vendor") continue;
    const pkgRoot = resolve(root, pkg.dir);
    for (const { spec, file } of pkg.imports) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(pkgRoot, dirname(file), spec);
      const rel = relative(pkgRoot, target);
      if (rel === ".." || rel.startsWith(`..${sep}`)) {
        violations.push({
          rule: "relative-escape",
          pkg: pkg.name,
          message: `${file} imports ${spec}, which leaves the package; declare a dependency and import @xeon/<name>`,
        });
      }
    }
  }
  return violations;
}

export function checkLayers(root: string): { packages: number; violations: Violation[] } {
  const packages = collectPackages(root);
  return {
    packages: packages.length,
    violations: [...analyze(packages), ...relativeEscapes(root, packages)],
  };
}

if (import.meta.main) {
  const rootArg = Bun.argv[2];
  const root = rootArg === undefined ? resolve(import.meta.dir, "..") : resolve(rootArg);
  const { packages, violations } = checkLayers(root);
  if (violations.length > 0) {
    for (const v of violations) process.stderr.write(`FAIL ${v.rule} ${v.pkg}: ${v.message}\n`);
    process.stderr.write(
      `check-layers: ${violations.length} violation(s) in ${packages} packages\n`,
    );
    process.exit(1);
  }
  process.stdout.write(`check-layers: ${packages} packages, 0 violations\n`);
}
