#!/usr/bin/env bun
// Docs router and validator.
//   docs-route --task <t[,t]> [paths|ids|L1/loop ...]   print the docs to read (repo-relative paths)
//   docs-route --check [--allow-missing]                validate front matter, ids, links and binds
// Inputs: docs/xeon/_routing/routes.yaml and the front matter of docs/xeon/**/*.md (except _research).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

export const LAYERS = ["F", "X", "L0", "L1", "L2", "L3", "L4"] as const;
const DOC_LAYERS = [...LAYERS, "product", "architecture", "eng", "adr", "meta"];
const KINDS = ["readme", "spec", "design", "plan", "guide", "adr", "review"];
const STATUSES = ["draft", "review", "accepted"];
const REQUIRED = ["id", "layer", "domain", "kind", "status", "depends_on", "binds"] as const;

export interface Doc {
  /** Path relative to the repository root, e.g. docs/xeon/L1/loop/spec.md. */
  file: string;
  /** Front matter as parsed; undefined when absent or unparsable. */
  front: Record<string, unknown> | undefined;
  frontError: string | undefined;
}

export interface Routes {
  by_task: Record<string, string[]>;
  layout: Record<string, LayoutEntry | LayoutEntry[]>;
  manifest: Record<string, unknown>;
}

interface LayoutEntry {
  package?: string;
  domains?: string[];
  path?: string;
  /** Per-domain path overrides when one template does not fit (e.g. L3 group-kit, helm). */
  paths?: Record<string, string>;
  docs?: string[];
}

export interface Report {
  errors: string[];
  warnings: string[];
}

const layerRank = (layer: string): number => LAYERS.findIndex((known) => known === layer);
const notYet = (message: string): boolean => /is missing$|is not written yet$/.test(message);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

export function parseFrontmatter(text: string): {
  front?: Record<string, unknown>;
  error?: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match?.[1] === undefined) return { error: "front matter missing" };
  try {
    const data: unknown = Bun.YAML.parse(match[1]);
    if (!isRecord(data)) return { error: "front matter is not a mapping" };
    return { front: data };
  } catch (error) {
    return {
      error: `front matter YAML error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function walkMarkdown(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "_research" || entry.name === "node_modules" || entry.name.startsWith("."))
      continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
}

export function loadDocs(repoRoot: string): Doc[] {
  const docsRoot = join(repoRoot, "docs/xeon");
  if (!existsSync(docsRoot)) return [];
  const files: string[] = [];
  walkMarkdown(docsRoot, files);
  return files.toSorted().map((full) => {
    const { front, error } = parseFrontmatter(readFileSync(full, "utf8"));
    return { file: relative(repoRoot, full), front, frontError: error };
  });
}

function toLayoutEntry(value: unknown): LayoutEntry {
  if (!isRecord(value)) {
    throw new Error("routes.yaml layout entries must be mappings");
  }
  const entry: LayoutEntry = {};
  if (typeof value["package"] === "string") entry.package = value["package"];
  if (typeof value["path"] === "string") entry.path = value["path"];
  if (isStringArray(value["domains"])) entry.domains = value["domains"];
  if (isStringArray(value["docs"])) entry.docs = value["docs"];
  const paths = value["paths"];
  if (isRecord(paths)) {
    entry.paths = {};
    for (const [domain, path] of Object.entries(paths)) {
      if (typeof path === "string") entry.paths[domain] = path;
    }
  }
  return entry;
}

export function loadRoutes(repoRoot: string): Routes {
  const file = join(repoRoot, "docs/xeon/_routing/routes.yaml");
  const data: unknown = Bun.YAML.parse(readFileSync(file, "utf8"));
  if (!isRecord(data)) {
    throw new Error("routes.yaml is not a mapping");
  }
  const byTask = data["by_task"];
  const layout = data["layout"];
  const manifest = data["manifest"];
  if (!isRecord(byTask) || !isRecord(layout) || !isRecord(manifest)) {
    throw new Error("routes.yaml needs by_task, layout and manifest mappings");
  }
  const tasks: Routes["by_task"] = {};
  for (const [task, ids] of Object.entries(byTask)) {
    if (!isStringArray(ids)) {
      throw new Error(`routes.yaml by_task.${task} must be a list of ids`);
    }
    tasks[task] = ids;
  }
  const layouts: Routes["layout"] = {};
  for (const [layer, value] of Object.entries(layout)) {
    layouts[layer] = Array.isArray(value) ? value.map(toLayoutEntry) : toLayoutEntry(value);
  }
  return { by_task: tasks, layout: layouts, manifest };
}

const str = (doc: Doc, key: string): string => {
  const value = doc.front?.[key];
  return typeof value === "string" ? value : "";
};
const list = (doc: Doc, key: string): string[] => {
  const value = doc.front?.[key];
  return isStringArray(value) ? value : [];
};

function layoutEntry(routes: Routes, layer: string): LayoutEntry | undefined {
  const entry = routes.layout[layer];
  return entry !== undefined && !Array.isArray(entry) ? entry : undefined;
}

function expandPath(entry: LayoutEntry, domain: string): string | undefined {
  return entry.paths?.[domain] ?? entry.path?.replaceAll("{domain}", domain);
}

/** Package-root glob for an expanded layout path: everything before /src/ plus /**. */
function packageRoot(expanded: string): string {
  const cut = expanded.indexOf("/src/");
  return cut === -1 ? expanded : `${expanded.slice(0, cut)}/**`;
}

/** Binds a doc of this layer may use. */
function allowedBinds(routes: Routes, layer: string): Set<string> {
  const allowed = new Set<string>();
  const add = (entry: LayoutEntry | undefined): void => {
    if (entry === undefined) return;
    if (entry.path !== undefined) allowed.add(entry.path.replaceAll("{domain}", "*"));
    for (const domain of entry.domains ?? []) {
      const expanded = expandPath(entry, domain);
      if (expanded === undefined) continue;
      allowed.add(expanded);
      allowed.add(packageRoot(expanded));
    }
    // paths keys outside domains are layer-level subpaths (e.g. F services)
    for (const path of Object.values(entry.paths ?? {})) allowed.add(path);
    if (entry.package !== undefined) allowed.add(`${entry.package}/**`);
  };
  if (layer in routes.layout) add(layoutEntry(routes, layer));
  else for (const key of Object.keys(routes.layout)) add(layoutEntry(routes, key));
  return allowed;
}

function pluginBinds(routes: Routes, docId: string): Set<string> {
  const allowed = new Set<string>();
  const plugins = routes.layout["plugins"];
  if (Array.isArray(plugins)) {
    for (const plugin of plugins) {
      if (plugin.path !== undefined && (plugin.docs ?? []).includes(docId))
        allowed.add(plugin.path);
    }
  }
  return allowed;
}

/** Ids the manifest and by_task promise. */
export function expectedIds(routes: Routes): Set<string> {
  const ids = new Set<string>();
  for (const value of Object.values(routes.manifest)) {
    if (isStringArray(value)) for (const id of value) ids.add(id);
  }
  for (const layer of LAYERS) {
    const entry = layoutEntry(routes, layer);
    if (entry === undefined) continue;
    ids.add(`${layer}.readme`);
    for (const domain of entry.domains ?? []) {
      ids.add(`${layer}.${domain}.spec`);
      ids.add(`${layer}.${domain}.plan`);
    }
  }
  for (const taskIds of Object.values(routes.by_task)) for (const id of taskIds) ids.add(id);
  return ids;
}

export function checkDocs(repoRoot: string, options: { allowMissing: boolean }): Report {
  const report: Report = { errors: [], warnings: [] };
  const error = (file: string, message: string): void => {
    report.errors.push(`${file}: ${message}`);
  };
  const warn = (file: string, message: string): void => {
    report.warnings.push(`${file}: ${message}`);
  };

  let routes: Routes;
  try {
    routes = loadRoutes(repoRoot);
  } catch (cause) {
    error("docs/xeon/_routing/routes.yaml", cause instanceof Error ? cause.message : String(cause));
    return report;
  }
  const docs = loadDocs(repoRoot);
  const expected = expectedIds(routes);
  const missing = (file: string, message: string): void => {
    if (options.allowMissing) {
      warn(file, message);
    } else {
      error(file, message);
    }
  };

  const ids = new Map<string, Doc>();
  for (const doc of docs) {
    if (doc.front === undefined) {
      error(doc.file, doc.frontError ?? "front matter missing");
      continue;
    }
    let wellFormed = true;
    for (const key of REQUIRED) {
      if (!(key in doc.front)) {
        error(doc.file, `front matter field "${key}" is missing`);
        wellFormed = false;
      }
    }
    for (const key of ["id", "layer", "domain", "kind", "status"]) {
      if (key in doc.front && (typeof doc.front[key] !== "string" || doc.front[key] === "")) {
        error(doc.file, `"${key}" must be a non-empty string`);
        wellFormed = false;
      }
    }
    for (const key of ["depends_on", "binds"]) {
      if (key in doc.front && !isStringArray(doc.front[key])) {
        error(doc.file, `"${key}" must be a list of strings`);
        wellFormed = false;
      }
    }
    if (!wellFormed) continue;

    const id = str(doc, "id");
    const layer = str(doc, "layer");
    const kind = str(doc, "kind");
    if (!DOC_LAYERS.includes(layer))
      error(doc.file, `layer "${layer}" is not one of ${DOC_LAYERS.join(", ")}`);
    if (!KINDS.includes(kind)) error(doc.file, `kind "${kind}" is not one of ${KINDS.join(", ")}`);
    if (!STATUSES.includes(str(doc, "status")))
      error(doc.file, `status "${str(doc, "status")}" is not one of ${STATUSES.join(", ")}`);

    const previous = ids.get(id);
    if (previous === undefined) ids.set(id, doc);
    else error(doc.file, `duplicate id "${id}" (also in ${previous.file})`);

    const domain = str(doc, "domain");
    const expectedId = kind === "readme" ? `${layer}.readme` : `${layer}.${domain}.${kind}`;
    if (layer !== "meta" && kind !== "adr" && id !== expectedId) {
      warn(doc.file, `id "${id}" differs from the convention "${expectedId}"`);
    }

    const entry = layoutEntry(routes, layer);
    if (entry?.domains !== undefined && kind !== "readme" && !entry.domains.includes(domain)) {
      error(
        doc.file,
        `domain "${domain}" is not in layout.${layer}.domains (${entry.domains.join(", ")})`,
      );
    }

    const allowed = new Set([...allowedBinds(routes, layer), ...pluginBinds(routes, id)]);
    for (const bind of list(doc, "binds")) {
      if (!allowed.has(bind)) {
        error(doc.file, `binds "${bind}" does not match routes.yaml layout for layer ${layer}`);
      }
    }
  }

  for (const doc of docs) {
    if (doc.front === undefined || !isStringArray(doc.front["depends_on"])) continue;
    for (const target of doc.front["depends_on"]) {
      if (ids.has(target)) continue;
      if (expected.has(target)) missing(doc.file, `depends_on "${target}" is not written yet`);
      else error(doc.file, `depends_on "${target}" does not exist and is not in the manifest`);
    }
  }
  for (const id of [...expected].toSorted()) {
    if (!ids.has(id)) missing("docs/xeon", `manifest document "${id}" is missing`);
  }
  return report;
}

function normalizeInput(input: string, repoRoot: string): string {
  let path = input.replaceAll("\\", "/");
  const absolute = resolve(path);
  if (path.startsWith("/")) path = relative(repoRoot, absolute).replaceAll("\\", "/");
  path = path.replace(/^\.\//, "");
  if (/^(packages|apps|plugins|scripts|vendor)\//.test(path)) path = `xeon/${path}`;
  return path;
}

export interface RouteResult {
  files: string[];
  ids: string[];
  warnings: string[];
}

export function routeDocs(
  repoRoot: string,
  options: { tasks: string[]; inputs: string[] },
): RouteResult {
  const routes = loadRoutes(repoRoot);
  const docs = loadDocs(repoRoot).filter((doc) => doc.front !== undefined && str(doc, "id") !== "");
  const byId = new Map(docs.map((doc) => [str(doc, "id"), doc]));
  const warnings: string[] = [];
  const picked = new Map<string, Doc>();
  const pick = (id: string, source: string): void => {
    const doc = byId.get(id);
    if (doc === undefined) warnings.push(`${source}: document "${id}" is not written yet`);
    else picked.set(id, doc);
  };

  for (const task of options.tasks) {
    const ids = routes.by_task[task];
    if (ids === undefined)
      throw new Error(`unknown task "${task}" (known: ${Object.keys(routes.by_task).join(", ")})`);
    for (const id of ids) pick(id, `task ${task}`);
  }

  const matched = new Map<string, Doc>();
  for (const input of options.inputs) {
    const hits: Doc[] = [];
    const byRef = byId.get(input);
    const layerDomain = /^(F|X|L[0-4])\/([^/]+)$/.exec(input);
    if (byRef !== undefined) hits.push(byRef);
    else if (layerDomain?.[1] !== undefined && layerDomain[2] !== undefined) {
      const [, layer, domain] = layerDomain;
      hits.push(...docs.filter((d) => str(d, "layer") === layer && str(d, "domain") === domain));
    } else {
      const path = normalizeInput(input, repoRoot);
      const probe = path.endsWith("/") ? `${path}_` : path;
      for (const doc of docs) {
        if (doc.file === path) hits.push(doc);
        else if (
          list(doc, "binds").some(
            (bind) => new Bun.Glob(bind).match(probe) || new Bun.Glob(bind).match(`${probe}/_`),
          )
        )
          hits.push(doc);
      }
    }
    if (hits.length === 0) warnings.push(`${input}: no document binds this path`);
    for (const doc of hits) {
      matched.set(str(doc, "id"), doc);
      const readme = byId.get(`${str(doc, "layer")}.readme`);
      if (readme !== undefined) matched.set(str(readme, "id"), readme);
    }
  }
  const kindOrder = ["readme", "spec", "design", "plan"];
  const ordered = [...matched.values()].toSorted(
    (a, b) =>
      layerRank(str(a, "layer")) - layerRank(str(b, "layer")) ||
      str(a, "domain").localeCompare(str(b, "domain")) ||
      kindOrder.indexOf(str(a, "kind")) - kindOrder.indexOf(str(b, "kind")),
  );
  for (const doc of ordered) picked.set(str(doc, "id"), doc);

  // One-step depends_on expansion of the path-selected documents.
  for (const doc of ordered) {
    for (const dep of list(doc, "depends_on")) pick(dep, `${doc.file} depends_on`);
  }
  const result = [...picked.values()];
  return {
    files: result.map((doc) => doc.file),
    ids: result.map((doc) => str(doc, "id")),
    warnings,
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      task: { type: "string", multiple: true },
      check: { type: "boolean", default: false },
      "allow-missing": { type: "boolean", default: false },
      ids: { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      "repo-root": { type: "string" },
    },
  });
  const repoRoot = resolve(values["repo-root"] ?? join(import.meta.dir, "..", ".."));
  if (values.check) {
    const report = checkDocs(repoRoot, { allowMissing: values["allow-missing"] });
    const shown = values.verbose
      ? report.warnings
      : report.warnings.filter((message) => !notYet(message));
    for (const message of shown) process.stderr.write(`WARN  ${message}\n`);
    const hidden = report.warnings.length - shown.length;
    if (hidden > 0)
      process.stderr.write(
        `WARN  ${hidden} documents/links not written yet (--verbose lists them)\n`,
      );
    for (const message of report.errors) process.stderr.write(`ERROR ${message}\n`);
    process.stdout.write(
      `docs-route: ${report.errors.length} error(s), ${report.warnings.length} warning(s)\n`,
    );
    process.exit(report.errors.length > 0 ? 1 : 0);
  }
  const tasks = (values.task ?? [])
    .flatMap((value) => value.split(","))
    .filter((value) => value !== "");
  if (tasks.length === 0 && positionals.length === 0) {
    process.stderr.write(
      "usage: docs-route --task <task[,task]> [path|id|L1/loop ...] | --check [--allow-missing]\n",
    );
    process.exit(1);
  }
  try {
    const result = routeDocs(repoRoot, { tasks, inputs: positionals });
    for (const message of result.warnings) process.stderr.write(`WARN  ${message}\n`);
    for (const line of values.ids ? result.ids : result.files) process.stdout.write(`${line}\n`);
  } catch (cause) {
    process.stderr.write(`docs-route: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exit(1);
  }
}
