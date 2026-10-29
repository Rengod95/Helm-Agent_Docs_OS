#!/usr/bin/env bun
// Layer rule checker (engineering/dependency-rules guide). Prints one line per violation:
//   <file>:<line> <DR-NN> <message>
// Exit codes: 0 pass, 1 violations, 2 tool error (unreadable package.json, tsconfig, allowlist or routes).
// Checks:
//   DR-01 a package imports only lower ranks (package.json dependencies and source imports, tests included)
//   DR-02 no same-layer import (apps/* pairs and apps/* -> packages/client are reported as DR-10), except entries in scripts/dependency-allowlist.json
//   DR-03 package.json "xeon": {layer, domain} exists and matches the package location (domain also matches routes.yaml for L0-L2)
//   DR-04 workspace imports are declared in package.json and tsconfig.json "references" equals the workspace dependency set
//   DR-05 no src/dist deep import and no relative import that leaves the package
//   DR-07 Bun.spawn, Bun.spawnSync and node:child_process: sources of the L0 owner packages only; test files of any platform-*
//         package and of packages with a `scope: "test"` allowlist entry (review.decisions-2 B-06)
//   WEB-R16 no network calls, `Bun.` access or socket construction in packages/cap-web/src/fetch/convert (L2.web.spec 4.9.3)
// Rank: F(0) < X(1) < L0(2) < L1(3) < L2(4) < L3(5) < L4(6). plugins/* count as L1, apps/* and packages/client as L4, vendor/* is excluded.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import { Check } from "typebox/value";

export const RANK = { F: 0, X: 1, L0: 2, L1: 3, L2: 4, L3: 5, L4: 6 } as const;
export type Layer = keyof typeof RANK;

export const ALLOWLIST_FILE = "scripts/dependency-allowlist.json";
const ROUTES_FILE = "../docs/xeon/_routing/routes.yaml";

export interface PackageInfo {
  /** Directory relative to the xeon root, e.g. packages/core-loop. */
  dir: string;
  name: string;
  layer: string | undefined;
  domain: string | undefined;
  /** Line of the "xeon" key in package.json, 1 when absent. */
  xeonLine: number;
  declared: string[];
  /** Line in package.json of each declared dependency. */
  declaredLines: Record<string, number>;
  imports: { spec: string; file: string; line: number }[];
  /** Process spawning: Bun.spawn(Sync) calls and node:child_process imports, with the file and line (DR-07). */
  spawns: { file: string; line: number }[];
  /** tsconfig.json "references" (resolved to package-relative paths); undefined when there is no tsconfig.json. */
  references: { path: string; line: number }[] | undefined;
}

export interface Violation {
  /** Rule id such as DR-01. */
  rule: string;
  /** File relative to the xeon root. */
  file: string;
  line: number;
  message: string;
}

/** One approved exception (guide section 4). TS-NN entries are validated but only DR-NN entries are applied here. */
export interface AllowEntry {
  /** "<rule id>/<name>", e.g. DR-02/group-kit. */
  id: string;
  rule: string;
  /** Package directory on the importing side, or a family pattern "packages/group-*" (a trailing "*" in the last segment). */
  from: string;
  /** Allowed target: a workspace package name or an external module specifier. */
  to: string;
  /** Entry points of the target that are allowed. Defaults to ["."]. */
  entries?: string[];
  reason: string;
  /** Approving document or ADR id. */
  approvedBy: string;
  /** "test": the exception covers the test files of `from` only; the same use in `src/**` stays a violation. */
  scope?: "test";
}

function isAllowList(data: unknown): data is AllowEntry[] {
  const schema = Type.Array(
    Type.Object({
      id: Type.String({ pattern: "^(?:DR|TS)-\\d{2}/[a-z0-9-]+$" }),
      rule: Type.String({ pattern: "^(?:DR|TS)-\\d{2}$" }),
      from: Type.String(),
      to: Type.String(),
      entries: Type.Optional(Type.Array(Type.String())),
      reason: Type.String({ minLength: 10 }),
      approvedBy: Type.String(),
      scope: Type.Optional(Type.Literal("test")),
    }),
  );
  return Check(schema, data);
}

export interface AnalyzeOptions {
  allow?: readonly AllowEntry[];
  /** routes.yaml layout.<layer>.domains for the layers whose package names map one to one. */
  routeDomains?: Partial<Record<Layer, readonly string[]>>;
}

const SOURCE_GLOB = "**/*.{ts,tsx,mts,cts,js,mjs,cjs}";
const SKIP = /(^|\/)(node_modules|dist|\.turbo|coverage)(\/|$)/;
const WORKSPACE_ROOTS = ["packages", "apps", "plugins", "vendor"] as const;
const ROUTED_LAYERS = ["L0", "L1", "L2"] as const;

function isLayer(value: string | undefined): value is Layer {
  return value !== undefined && Object.hasOwn(RANK, value);
}

/** packages/client is the shared L4 client package (adr.0020); its directory name has no layer prefix, so it is matched by name. */
const CLIENT_DIR_NAME = "client";
const CLIENT_DIR = `packages/${CLIENT_DIR_NAME}`;

/** Layer a package must declare, derived from where it lives. undefined means unconstrained or excluded. */
export function expectedLayer(dir: string): Layer | "vendor" | undefined {
  const [root, name = ""] = dir.split("/");
  if (root === "vendor") return "vendor";
  if (root === "plugins") return "L1";
  if (root === "apps") return "L4";
  if (root !== "packages") return undefined;
  if (name === "contracts") return "F";
  if (name === "ext-host") return "X";
  if (name === CLIENT_DIR_NAME) return "L4";
  if (name.startsWith("platform-")) return "L0";
  if (name.startsWith("core-")) return "L1";
  if (name.startsWith("cap-")) return "L2";
  if (name.startsWith("group-")) return "L3";
  return undefined;
}

/**
 * Domain a package must declare: the directory name without its layer prefix (DR-03).
 * `group-kit` is the one exception: its domain is the routes.yaml name `group-kit` (M3-35, L3.group-kit.spec §10).
 */
export function expectedDomain(dir: string): string | undefined {
  const [root, name = ""] = dir.split("/");
  if (root === "plugins" || root === "apps") return name;
  if (root !== "packages") return undefined;
  if (name === "contracts" || name === "ext-host" || name === CLIENT_DIR_NAME) return name;
  if (name === "group-kit") return name;
  for (const prefix of ["platform-", "core-", "cap-", "group-"]) {
    if (name.startsWith(prefix)) return name.slice(prefix.length);
  }
  return undefined;
}

const lineAt = (text: string, index: number): number => {
  let line = 1;
  for (let at = text.indexOf("\n"); at !== -1 && at < index; at = text.indexOf("\n", at + 1)) {
    line += 1;
  }
  return line;
};

/** Line of the first quoted occurrence of value in text, 1 when absent. */
function lineOfString(text: string, value: string): number {
  const index = text.indexOf(JSON.stringify(value));
  return index === -1 ? 1 : lineAt(text, index);
}

const blank = (match: string): string => match.replace(/[^\n]/g, " ");

/** The text with block comments and whole-line comments blanked; offsets and lines are preserved. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/^[ \t]*\/\/.*$/gm, blank);
}

/** Module specifiers with their 1-based line. Comments are ignored; offsets and lines are preserved. */
export function extractImports(text: string): { spec: string; line: number }[] {
  const code = withoutComments(text);
  const found: { spec: string; line: number }[] = [];
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']/dg,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/dg,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/dg,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const spec = match[1];
      const span = match.indices?.[1];
      if (spec !== undefined && span !== undefined) {
        found.push({ spec, line: lineAt(code, span[0]) });
      }
    }
  }
  return found.toSorted((a, b) => a.line - b.line);
}

const SPAWN_CALL = /\bBun\.spawn(?:Sync)?\b/g;
const CHILD_PROCESS_SPEC = /^(?:node:)?child_process$/;

/** Lines that spawn a process: Bun.spawn(Sync) calls and imports of node:child_process. Comments are ignored. */
export function extractSpawns(text: string): number[] {
  const code = withoutComments(text);
  const lines = new Set<number>();
  for (const match of code.matchAll(SPAWN_CALL)) lines.add(lineAt(code, match.index));
  for (const { spec, line } of extractImports(text)) {
    if (CHILD_PROCESS_SPEC.test(spec)) lines.add(line);
  }
  return [...lines].toSorted((a, b) => a - b);
}

/** Module specifiers found in source text. Comments are ignored. */
export function extractSpecifiers(text: string): string[] {
  return extractImports(text).map((found) => found.spec);
}

function workspaceName(spec: string): string | undefined {
  const match = /^@xeon\/([^/]+)/.exec(spec);
  return match?.[1] === undefined ? undefined : `@xeon/${match[1]}`;
}

/** Entry point of a workspace import: "." or "./sub". */
function entryOf(spec: string, name: string): string {
  const rest = spec.slice(name.length);
  return rest === "" ? "." : `.${rest}`;
}

const stringRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {};

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

function parseJson(path: string, text: string, jsonc: boolean): unknown {
  try {
    return jsonc ? Bun.JSONC.parse(text) : JSON.parse(text);
  } catch (error) {
    throw new Error(
      `cannot parse ${path}: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    );
  }
}

function readReferences(root: string, dir: string): { path: string; line: number }[] | undefined {
  const file = join(root, dir, "tsconfig.json");
  if (!existsSync(file)) return undefined;
  const text = readText(file);
  const refs = stringRecord(parseJson(file, text, true))["references"];
  if (refs === undefined) return [];
  if (!Array.isArray(refs)) throw new Error(`${file}: references must be an array`);
  const result: { path: string; line: number }[] = [];
  for (const ref of refs) {
    const path = stringRecord(ref)["path"];
    if (typeof path !== "string") throw new Error(`${file}: every reference needs a string path`);
    const target = path.endsWith(".json") ? posix.dirname(path) : path;
    result.push({ path: posix.normalize(posix.join(dir, target)), line: lineOfString(text, path) });
  }
  return result;
}

function readPackage(root: string, dir: string): PackageInfo {
  const manifest = join(root, dir, "package.json");
  const text = readText(manifest);
  const json = stringRecord(parseJson(manifest, text, false));
  const declared: string[] = [];
  const declaredLines: Record<string, number> = {};
  for (const key of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
  ]) {
    for (const dep of Object.keys(stringRecord(json[key]))) {
      declared.push(dep);
      declaredLines[dep] ??= lineOfString(text, dep);
    }
  }
  const xeon = stringRecord(json["xeon"]);
  const layer = xeon["layer"];
  const domain = xeon["domain"];
  const imports: PackageInfo["imports"] = [];
  const spawns: PackageInfo["spawns"] = [];
  for (const file of new Bun.Glob(SOURCE_GLOB).scanSync({ cwd: join(root, dir) })) {
    if (SKIP.test(file)) {
      continue;
    }
    const source = readText(join(root, dir, file));
    for (const found of extractImports(source)) {
      imports.push({ spec: found.spec, file, line: found.line });
    }
    for (const line of extractSpawns(source)) spawns.push({ file, line });
  }
  return {
    dir,
    name: typeof json["name"] === "string" ? json["name"] : dir,
    layer: typeof layer === "string" ? layer : undefined,
    domain: typeof domain === "string" ? domain : undefined,
    xeonLine: lineOfString(text, "xeon"),
    declared,
    declaredLines,
    imports,
    spawns,
    references: readReferences(root, dir),
  };
}

function workspaceDirs(root: string): { dirs: string[]; withoutManifest: string[] } {
  const dirs: string[] = [];
  const withoutManifest: string[] = [];
  for (const base of WORKSPACE_ROOTS) {
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) {
      continue;
    }
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }
      const dir = `${base}/${entry.name}`;
      (existsSync(join(root, dir, "package.json")) ? dirs : withoutManifest).push(dir);
    }
  }
  return { dirs, withoutManifest };
}

export function collectPackages(root: string): PackageInfo[] {
  return workspaceDirs(root)
    .dirs.map((dir) => readPackage(root, dir))
    .toSorted((a, b) => a.dir.localeCompare(b.dir));
}

/** Rule that governs a same-layer import: DR-10 from an app to another app or to packages/client (adr.0020), DR-02 elsewhere. */
function sameLayerRule(fromDir: string, toDir: string): "DR-02" | "DR-10" {
  return fromDir.startsWith("apps/") && (toDir.startsWith("apps/") || toDir === CLIENT_DIR)
    ? "DR-10"
    : "DR-02";
}

/**
 * `from` 값이 패키지 디렉터리 `dir`을 가리키는가. 끝의 `*`는 마지막 이름 한 단계를 가리키는 패턴이다.
 * "packages/group-*"는 packages/group-helm, packages/group-kit 같은 그룹 전부를 가리키고 packages/group-x/sub는 가리키지 않는다.
 */
export function matchesFrom(from: string, dir: string): boolean {
  if (!from.endsWith("*")) return from === dir;
  const prefix = from.slice(0, -1);
  const rest = dir.slice(prefix.length);
  return dir.startsWith(prefix) && rest.length > 0 && !rest.includes("/");
}

function isAllowed(
  allow: readonly AllowEntry[],
  rule: string,
  fromDir: string,
  to: string,
  entry: string | undefined,
): boolean {
  return allow.some(
    (item) =>
      item.rule === rule &&
      matchesFrom(item.from, fromDir) &&
      item.to === to &&
      (entry === undefined || (item.entries ?? ["."]).includes(entry)),
  );
}

export function analyze(
  packages: readonly PackageInfo[],
  options: AnalyzeOptions = {},
): Violation[] {
  const allow = options.allow ?? [];
  const violations: Violation[] = [];
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const add = (rule: string, pkg: PackageInfo, message: string, file?: string, line?: number) => {
    violations.push({
      rule,
      file: file === undefined ? `${pkg.dir}/package.json` : `${pkg.dir}/${file}`,
      line: line ?? 1,
      message,
    });
  };

  for (const pkg of packages) {
    const expected = expectedLayer(pkg.dir);
    if (expected === "vendor") {
      if (pkg.layer !== undefined && pkg.layer !== "vendor") {
        add(
          "DR-03",
          pkg,
          `vendor packages must not declare layer ${pkg.layer}`,
          undefined,
          pkg.xeonLine,
        );
      }
      continue;
    }
    if (pkg.layer === "vendor") {
      add(
        "DR-03",
        pkg,
        `layer vendor is only valid under vendor/, not ${pkg.dir}`,
        undefined,
        pkg.xeonLine,
      );
      continue;
    }

    const wantDomain = expectedDomain(pkg.dir);
    if (pkg.domain === undefined) {
      add(
        "DR-03",
        pkg,
        'package.json needs "xeon": {"layer", "domain"}; domain is missing',
        undefined,
        pkg.xeonLine,
      );
    } else if (wantDomain !== undefined && pkg.domain !== wantDomain) {
      add(
        "DR-03",
        pkg,
        `${pkg.dir} must declare domain ${wantDomain} but declares ${pkg.domain}`,
        undefined,
        pkg.xeonLine,
      );
    } else if (isLayer(expected) && pkg.dir.startsWith("packages/")) {
      const known = options.routeDomains?.[expected];
      if (known !== undefined && !known.includes(pkg.domain)) {
        add(
          "DR-03",
          pkg,
          `domain ${pkg.domain} is not in routes.yaml layout.${expected}.domains`,
          undefined,
          pkg.xeonLine,
        );
      }
    }

    if (!isLayer(pkg.layer)) {
      add(
        "DR-03",
        pkg,
        `xeon.layer is ${String(pkg.layer)}; expected one of ${Object.keys(RANK).join(", ")}`,
        undefined,
        pkg.xeonLine,
      );
      continue;
    }
    if (expected !== undefined && expected !== pkg.layer) {
      add(
        "DR-03",
        pkg,
        `${pkg.dir} must declare layer ${expected} but declares ${pkg.layer}`,
        undefined,
        pkg.xeonLine,
      );
    }
    const layer = pkg.layer;
    const rank = RANK[layer];

    const rankCheck = (name: string, entry: string | undefined, file?: string, line?: number) => {
      const target = byName.get(name);
      if (target === undefined) return;
      const targetLayer = expectedLayer(target.dir) === "vendor" ? "vendor" : target.layer;
      if (targetLayer === "vendor" || !isLayer(targetLayer)) return;
      const targetRank = RANK[targetLayer];
      const how = file === undefined ? "declares a dependency on" : "imports";
      if (targetRank > rank) {
        if (!isAllowed(allow, "DR-01", pkg.dir, name, entry)) {
          add(
            "DR-01",
            pkg,
            `${layer} package ${pkg.name} ${how} higher layer ${targetLayer} (${name})`,
            file,
            line,
          );
        }
      } else if (targetRank === rank) {
        const rule = sameLayerRule(pkg.dir, target.dir);
        if (!isAllowed(allow, rule, pkg.dir, name, entry)) {
          const hint =
            rule === "DR-10"
              ? "apps connect through the sidecar"
              : "share through F contracts or Cordis services";
          add(
            rule,
            pkg,
            `${layer} package ${pkg.name} ${how} same-layer package ${name}; ${hint}`,
            file,
            line,
          );
        }
      }
    };

    const imported = new Set<string>();
    for (const { spec, file, line } of pkg.imports) {
      const name = workspaceName(spec);
      if (name === undefined || name === pkg.name) continue;
      if (!byName.has(name)) {
        add("DR-04", pkg, `${spec} is not a workspace package`, file, line);
        continue;
      }
      imported.add(name);
      if (!pkg.declared.includes(name)) {
        add("DR-04", pkg, `${name} is imported but package.json does not declare it`, file, line);
      }
      if (/^\/(?:src|dist)(?:\/|$)/.test(spec.slice(name.length))) {
        add(
          "DR-05",
          pkg,
          `${spec} reaches into ${name}/src or dist; import only the exports entry points`,
          file,
          line,
        );
      }
      rankCheck(name, entryOf(spec, name), file, line);
    }
    for (const dep of pkg.declared) {
      if (byName.has(dep) && dep !== pkg.name && !imported.has(dep)) {
        rankCheck(dep, undefined, undefined, undefined);
        const last = violations.at(-1);
        if (last !== undefined && last.file === `${pkg.dir}/package.json` && last.line === 1) {
          last.line = pkg.declaredLines[dep] ?? 1;
        }
      }
    }
  }
  return violations;
}

/** DR-04: tsconfig.json references and the workspace dependencies of package.json are the same set. */
export function checkReferences(packages: readonly PackageInfo[]): Violation[] {
  const violations: Violation[] = [];
  const byDir = new Map(packages.map((pkg) => [pkg.dir, pkg]));
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  for (const pkg of packages) {
    if (expectedLayer(pkg.dir) === "vendor") continue;
    if (pkg.references === undefined) {
      violations.push({
        rule: "DR-04",
        file: `${pkg.dir}/tsconfig.json`,
        line: 1,
        message: "tsconfig.json is missing; it must reference every workspace dependency",
      });
      continue;
    }
    const wanted = new Map<string, PackageInfo>();
    for (const dep of pkg.declared) {
      const target = byName.get(dep);
      if (target !== undefined && target.dir !== pkg.dir) wanted.set(target.dir, target);
    }
    const seen = new Set<string>();
    for (const ref of pkg.references) {
      seen.add(ref.path);
      if (!wanted.has(ref.path)) {
        const target = byDir.get(ref.path);
        violations.push({
          rule: "DR-04",
          file: `${pkg.dir}/tsconfig.json`,
          line: ref.line,
          message:
            target === undefined
              ? `reference ${ref.path} is not a workspace package`
              : `references ${target.name} but package.json does not declare it`,
        });
      }
    }
    for (const [dir, target] of wanted) {
      if (!seen.has(dir)) {
        violations.push({
          rule: "DR-04",
          file: `${pkg.dir}/tsconfig.json`,
          line: 1,
          message: `package.json declares ${target.name} but tsconfig.json has no reference to ${dir}`,
        });
      }
    }
  }
  return violations;
}

/** Relative imports that leave their package directory (DR-05). Needs the filesystem root. */
export function relativeEscapes(root: string, packages: readonly PackageInfo[]): Violation[] {
  const violations: Violation[] = [];
  for (const pkg of packages) {
    if (expectedLayer(pkg.dir) === "vendor") continue;
    const pkgRoot = resolve(root, pkg.dir);
    for (const { spec, file, line } of pkg.imports) {
      if (!spec.startsWith(".")) continue;
      const target = resolve(pkgRoot, dirname(file), spec);
      const rel = relative(pkgRoot, target);
      if (rel === ".." || rel.startsWith(`..${sep}`)) {
        violations.push({
          rule: "DR-05",
          file: `${pkg.dir}/${file}`,
          line,
          message: `${spec} leaves the package; declare a dependency and import @xeon/<name>`,
        });
      }
    }
  }
  return violations;
}

/** Reads scripts/dependency-allowlist.json. A missing file means no exceptions; a malformed one is a tool error. */
export function loadAllowlist(root: string): { entries: AllowEntry[]; text: string } {
  const file = join(root, ALLOWLIST_FILE);
  if (!existsSync(file)) return { entries: [], text: "" };
  const text = readText(file);
  const data = parseJson(file, text, false);
  if (!isAllowList(data)) {
    throw new Error(
      `${file} does not match the allowlist format (id, rule, from, to, entries?, reason, approvedBy)`,
    );
  }
  return { entries: data, text };
}

/** Exceptions must name an existing importer and target, a matching id prefix and be unique. */
export function checkAllowlist(
  entries: readonly AllowEntry[],
  text: string,
  packages: readonly PackageInfo[],
): Violation[] {
  const violations: Violation[] = [];
  const dirs = new Set(packages.map((pkg) => pkg.dir));
  const names = new Set(packages.map((pkg) => pkg.name));
  const ids = new Set<string>();
  const add = (entry: AllowEntry, message: string): void => {
    violations.push({
      rule: entry.rule,
      file: ALLOWLIST_FILE,
      line: lineOfString(text, entry.id),
      message,
    });
  };
  for (const entry of entries) {
    if (ids.has(entry.id)) add(entry, `duplicate allowlist id ${entry.id}`);
    ids.add(entry.id);
    if (!entry.id.startsWith(`${entry.rule}/`)) {
      add(entry, `id ${entry.id} must start with ${entry.rule}/`);
    }
    if (!entry.rule.startsWith("DR-")) continue;
    if (![...dirs].some((dir) => matchesFrom(entry.from, dir)))
      add(entry, `from ${entry.from} is not a workspace package directory`);
    if (entry.rule === "DR-07") {
      if (entry.to !== SPAWN_ALLOW_TARGET) {
        add(entry, `DR-07 entries cover ${SPAWN_ALLOW_TARGET} only, not ${entry.to}`);
      }
      if (entry.scope !== "test") {
        add(entry, `DR-07 ${SPAWN_ALLOW_TARGET} entries need scope "test"; sources stay with L0`);
      }
      continue;
    }
    if (entry.scope !== undefined) add(entry, `scope "${entry.scope}" is only valid for DR-07`);
    if (!names.has(entry.to)) add(entry, `to ${entry.to} is not a workspace package`);
  }
  return violations;
}

/** A source text pattern that is forbidden inside the files of one directory. */
export interface SourcePattern {
  readonly rule: "WEB-R16";
  /** Directory relative to the xeon root; every source file below it is scanned (tests under test/ are not). */
  readonly dir: string;
  readonly pattern: RegExp;
  readonly message: string;
}

/** WEB-R16 (L2.web.spec 4.9.3): the conversion modules of cap-web are pure functions without network or runtime access. */
export const WEB_R16_DIR = "packages/cap-web/src/fetch/convert";

export const SOURCE_PATTERNS: readonly SourcePattern[] = [
  {
    rule: "WEB-R16",
    dir: WEB_R16_DIR,
    pattern: /\b(?:fetch|WebSocket|EventSource|XMLHttpRequest)\s*\(/g,
    message:
      "conversion modules never call the network (fetch, WebSocket, EventSource, XMLHttpRequest)",
  },
  {
    rule: "WEB-R16",
    dir: WEB_R16_DIR,
    pattern: /\bBun\./g,
    message: "conversion modules are pure functions and never touch the Bun runtime API",
  },
  {
    rule: "WEB-R16",
    dir: WEB_R16_DIR,
    pattern: /\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b/g,
    message: "conversion modules never construct network objects",
  },
  {
    rule: "WEB-R16",
    dir: WEB_R16_DIR,
    pattern: /\bimport\s*\(/g,
    message:
      "conversion modules use static imports only (a dynamic import escapes the no-network import lint)",
  },
  {
    rule: "WEB-R16",
    dir: WEB_R16_DIR,
    pattern: /\bglobalThis\b/g,
    message:
      'conversion modules never reach globals through globalThis (globalThis["fetch"] escapes the call check)',
  },
];

/** Lines of `text` that match `pattern`. Comments are ignored; the pattern needs the `g` flag. */
export function patternLines(text: string, pattern: RegExp): number[] {
  const code = withoutComments(text);
  const lines = new Set<number>();
  for (const match of code.matchAll(pattern)) lines.add(lineAt(code, match.index));
  return [...lines].toSorted((a, b) => a - b);
}

/** Source text patterns (WEB-R16). Files under a test directory or named *.test.* are skipped; the lint override covers imports. */
export function checkSourcePatterns(
  root: string,
  patterns: readonly SourcePattern[] = SOURCE_PATTERNS,
): Violation[] {
  const violations: Violation[] = [];
  for (const dir of new Set(patterns.map((item) => item.dir))) {
    const base = join(root, dir);
    if (!existsSync(base)) continue;
    for (const file of new Bun.Glob(SOURCE_GLOB).scanSync({ cwd: base })) {
      if (SKIP.test(file) || isTestFile(file)) continue;
      const text = readText(join(base, file));
      for (const item of patterns) {
        if (item.dir !== dir) continue;
        for (const line of patternLines(text, item.pattern)) {
          violations.push({ rule: item.rule, file: `${dir}/${file}`, line, message: item.message });
        }
      }
    }
  }
  return violations;
}

/** `to` of a DR-07 allowlist entry; one entry covers Bun.spawn, Bun.spawnSync and node:child_process. */
export const SPAWN_ALLOW_TARGET = "Bun.spawn";

/** L0 packages whose sources may spawn processes (guide DR-07 table; processes stay behind L0 interfaces, DR-13). */
const SPAWN_OWNERS: ReadonlySet<string> = new Set([
  "packages/platform-exec",
  "packages/platform-process",
  "packages/platform-sandbox",
  "packages/platform-secrets",
  "packages/platform-os",
]);

/** Test files: anything under test/ or tests/, or named *.test.* / *.spec.*. */
export function isTestFile(file: string): boolean {
  return /(^|\/)tests?\//.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/**
 * DR-07 process spawning. Sources of the owner packages may spawn. A test file may spawn in any platform-* package
 * (the owners' test fixtures run real processes) and in a package with an allowlist entry
 * `{ rule: "DR-07", to: "Bun.spawn", scope: "test" }` (review.decisions-2 B-06). Everything else is a violation.
 */
export function checkSpawns(
  packages: readonly PackageInfo[],
  allow: readonly AllowEntry[],
): Violation[] {
  const violations: Violation[] = [];
  for (const pkg of packages) {
    if (expectedLayer(pkg.dir) === "vendor" || SPAWN_OWNERS.has(pkg.dir)) continue;
    const testAllowed =
      pkg.dir.startsWith("packages/platform-") ||
      allow.some(
        (entry) =>
          entry.rule === "DR-07" &&
          entry.from === pkg.dir &&
          entry.to === SPAWN_ALLOW_TARGET &&
          entry.scope === "test",
      );
    for (const { file, line } of pkg.spawns) {
      if (isTestFile(file)) {
        if (testAllowed) continue;
        violations.push({
          rule: "DR-07",
          file: `${pkg.dir}/${file}`,
          line,
          message: `${pkg.name} spawns a process in a test; add a scope "test" allowlist entry (DR-07/<name>) after approval`,
        });
      } else {
        violations.push({
          rule: "DR-07",
          file: `${pkg.dir}/${file}`,
          line,
          message: `${pkg.name} spawns a process in its sources; process execution stays in the L0 owners (platform-exec, platform-process, platform-sandbox, platform-secrets, platform-os)`,
        });
      }
    }
  }
  return violations;
}

/** DR-03: workspace directories without package.json escape every other check. */
export function missingManifests(root: string): Violation[] {
  return workspaceDirs(root).withoutManifest.map((dir) => ({
    rule: "DR-03",
    file: `${dir}/package.json`,
    line: 1,
    message: "package.json is missing; every workspace package needs xeon.layer and xeon.domain",
  }));
}

/** domains of the layers whose package names map one to one onto routes.yaml (L0, L1, L2). */
export function loadRouteDomains(file: string): Partial<Record<Layer, string[]>> {
  const parsed: unknown = Bun.YAML.parse(readText(file));
  const layout = stringRecord(stringRecord(parsed)["layout"]);
  const result: Partial<Record<Layer, string[]>> = {};
  for (const layer of ROUTED_LAYERS) {
    const domains = stringRecord(layout[layer])["domains"];
    if (!Array.isArray(domains) || !domains.every((item) => typeof item === "string")) {
      throw new Error(`${file}: layout.${layer}.domains must be a list of names`);
    }
    result[layer] = domains.filter((item) => typeof item === "string");
  }
  return result;
}

export function checkLayers(
  root: string,
  options: { routesFile?: string } = {},
): { packages: number; violations: Violation[] } {
  const packages = collectPackages(root);
  const { entries, text } = loadAllowlist(root);
  const routeDomains =
    options.routesFile === undefined ? undefined : loadRouteDomains(options.routesFile);
  const violations = [
    ...missingManifests(root),
    ...checkAllowlist(entries, text, packages),
    ...analyze(
      packages,
      routeDomains === undefined ? { allow: entries } : { allow: entries, routeDomains },
    ),
    ...checkReferences(packages),
    ...checkSpawns(packages, entries),
    ...relativeEscapes(root, packages),
    ...checkSourcePatterns(root),
  ];
  return {
    packages: packages.length,
    violations: violations.toSorted(
      (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule),
    ),
  };
}

export function formatViolation(v: Violation): string {
  return `${v.file}:${v.line} ${v.rule} ${v.message}`;
}

if (import.meta.main) {
  try {
    const rootArg = Bun.argv[2];
    const root = rootArg === undefined ? resolve(import.meta.dir, "..") : resolve(rootArg);
    const { packages, violations } = checkLayers(root, { routesFile: resolve(root, ROUTES_FILE) });
    if (violations.length > 0) {
      for (const v of violations) process.stderr.write(`${formatViolation(v)}\n`);
      process.stderr.write(
        `check-layers: ${violations.length} violation(s) in ${packages} packages\n`,
      );
      process.exit(1);
    }
    process.stdout.write(`check-layers: ${packages} packages, 0 violations\n`);
  } catch (error) {
    process.stderr.write(
      `check-layers: tool error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }
}
