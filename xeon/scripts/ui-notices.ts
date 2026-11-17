#!/usr/bin/env bun
// Third-party notices for the npm packages the desktop screen bundle (apps/desktop, Vite) really contains. The Vite build writes
// the ids of the modules it bundled to apps/desktop/dist/ui-modules.json (vite.config.ts, moduleManifest); this script keeps the
// packages those ids live in, lists each with collectNotices (no dependency walk: the bundler's list is the exact set that ships)
// and writes apps/desktop/dist/ui-notices.txt. apps/desktop-shell/scripts/package.ts copies it to Resources/licenses/
// THIRD-PARTY-NOTICES-UI.txt. New screen dependencies need no hand edit: they appear in the next build's module list.
//   ui-notices [--modules <file>] [--out <file>]
// Exit codes: 0 written; 1 a package has no license information, or has a license outside ALLOWED_LICENSES (nothing is written);
// 2 the module list does not exist (build the screen first: just desktop-ui).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { collectNotices, groupedNoticesText, type NoticeItem, type Result } from "./notices.ts";

/** The module list the Vite build writes, relative to xeon/. */
export const UI_MODULES_FILE = "apps/desktop/dist/ui-modules.json";
/** The notice file this script writes, relative to xeon/. package.ts copies it into Resources/licenses/. */
export const UI_NOTICE_FILE = "apps/desktop/dist/ui-notices.txt";

/**
 * SPDX identifiers a screen-bundle package may carry [제안: permissive licenses only]. A package under any other license is not
 * written into the notice; the script fails and the package is a human decision (ship it, replace it, or extend this list).
 */
export const ALLOWED_LICENSES: ReadonlySet<string> = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "ISC",
  "MIT",
  "Unlicense",
]);

const HEADER = [
  "Fresnel desktop screen bundle third-party notices: npm packages bundled into the screen (apps/desktop, Vite).",
  "The list comes from the modules the bundler included, not from package.json.",
  "",
].join("\n");

/** The package directory (`.../node_modules/<name>`) a module id lives in, or undefined for first-party and virtual modules. */
export function packageDirOf(moduleId: string): string | undefined {
  const id = moduleId.replace(/^\0/u, "").replace(/[?#].*$/u, "");
  const marker = "/node_modules/";
  const at = id.lastIndexOf(marker);
  if (at < 0) return undefined;
  const rest = id.slice(at + marker.length).split("/");
  const first = rest[0];
  if (first === undefined || first === "") return undefined;
  const parts = first.startsWith("@") ? rest.slice(0, 2) : rest.slice(0, 1);
  if (parts.length === 0 || parts.some((part) => part === "")) return undefined;
  return `${id.slice(0, at + marker.length)}${parts.join("/")}`;
}

/** The distinct package directories of a module list, in name order. */
export function packageDirs(moduleIds: readonly string[]): string[] {
  const dirs = new Set<string>();
  for (const id of moduleIds) {
    const dir = packageDirOf(id);
    if (dir !== undefined) dirs.add(dir);
  }
  return [...dirs].toSorted();
}

/** Licenses of `items` that ALLOWED_LICENSES does not name, as "name@version: license" lines. */
export function disallowed(items: readonly NoticeItem[]): string[] {
  return items
    .filter((item) => !ALLOWED_LICENSES.has(item.license))
    .map(
      (item) => `${item.name}@${item.version}: license ${item.license} is not in the allowed list`,
    );
}

/** The names from `items` that the text does not list (an entry line is "<name> <version>"). */
export function missingFromText(items: readonly NoticeItem[], text: string): string[] {
  const lines = new Set(text.split("\n"));
  return items
    .filter((item) => !lines.has(`${item.name} ${item.version}`))
    .map((item) => `${item.name}@${item.version}`);
}

/** The notice text for the packages a module list contains; a missing license or a license outside the allowed list is an error. */
export function uiNotices(
  xeonRoot: string,
  moduleIds: readonly string[],
): Result<{ text: string; items: readonly NoticeItem[] }, string[]> {
  const collected = collectNotices(xeonRoot, packageDirs(moduleIds), { walk: false });
  if (!collected.ok) return collected;
  const problems = disallowed(collected.value);
  if (problems.length > 0) return { ok: false, error: problems };
  const text = `${HEADER}\n${groupedNoticesText(collected.value, "This file")}`;
  const missing = missingFromText(collected.value, text);
  if (missing.length > 0) {
    return { ok: false, error: missing.map((name) => `${name}: not listed in the notice text`) };
  }
  return { ok: true, value: { text, items: collected.value } };
}

/** Reads the module ids out of the JSON the Vite plugin wrote. */
export function readModuleIds(file: string): Result<string[], string> {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("modules" in parsed)) {
    return { ok: false, error: `${file}: no "modules" list` };
  }
  const modules: unknown = parsed.modules;
  if (!Array.isArray(modules) || !modules.every((id): id is string => typeof id === "string")) {
    return { ok: false, error: `${file}: "modules" is not a list of strings` };
  }
  return { ok: true, value: modules };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { modules: { type: "string" }, out: { type: "string" } },
    strict: true,
  });
  const xeon = resolve(import.meta.dir, "..");
  const modulesPath = resolve(values.modules ?? join(xeon, UI_MODULES_FILE));
  const outPath = resolve(values.out ?? join(xeon, UI_NOTICE_FILE));
  if (!existsSync(modulesPath)) {
    process.stderr.write(
      `ui-notices: ${modulesPath} is missing; build the screen first: just desktop-ui\n`,
    );
    process.exit(2);
  }
  const ids = readModuleIds(modulesPath);
  if (!ids.ok) {
    process.stderr.write(`ui-notices: ${ids.error}\n`);
    process.exit(1);
  }
  const built = uiNotices(xeon, ids.value);
  if (!built.ok) {
    for (const problem of built.error) process.stderr.write(`ui-notices: ${problem}\n`);
    process.exit(1);
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, built.value.text);
  process.stderr.write(
    `ui-notices: wrote ${outPath} (${String(built.value.items.length)} npm packages)\n`,
  );
}
