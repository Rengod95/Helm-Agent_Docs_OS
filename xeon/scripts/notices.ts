#!/usr/bin/env bun
// Third-party notices for the release archive (L4.release.spec section 6, audit prod/P-LEGAL). Walks the production dependency
// closure of the compiled binary's entry packages (apps/host, apps/cli) through each package's `dependencies`, follows
// workspace links and node_modules symlinks, and prints one block per third-party package with its license text. The Bun
// runtime that `bun build --compile` embeds gets its own block.
//   notices [--out <file>]
// A third-party package without a license file is an error (exit 1), so an unlicensed dependency cannot ship silently.
// This file imports no workspace package (eng.dependency-rules.guide section 1).
// Exit codes: 0 written or printed, 1 a dependency cannot be resolved or has no license text.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export interface NoticeEntry {
  readonly name: string;
  readonly version: string;
  /** SPDX expression, with a dual license narrowed to the chosen alternative (see LICENSE_CHOICE). */
  readonly license: string;
  /** Texts of the LICENSE, COPYING and NOTICE files, in file name order. */
  readonly texts: readonly { readonly file: string; readonly body: string }[];
  /** Set when the package ships no license file: who wrote it and where it lives, from its package.json. */
  readonly origin: string | undefined;
}

/** Packages that offer a license choice; the notice names the alternative the product takes. */
export const LICENSE_CHOICE: Readonly<Record<string, string>> = {
  "node-forge": "BSD-3-Clause",
};

/**
 * Packages that declare a license in package.json but ship no license file (checked by hand). The notice names the declared
 * license, the author and the repository instead of the text. A package that is not on this list and has no file fails.
 */
export const NO_LICENSE_FILE: ReadonlySet<string> = new Set([
  "@aws-sdk/credential-provider-http",
  "@aws-sdk/credential-provider-login",
  "@aws-sdk/nested-clients",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-telemetry",
  "@swc/counter",
  "data-uri-to-buffer",
  "proxy-agent-negotiate",
  "standardwebhooks",
]);

/** License fields that a vendored package keeps in UPSTREAM.json instead of package.json. */
export const LICENSE_FIELD: Readonly<Record<string, string>> = {
  "@fresnel/vendor-cordis": "MIT",
};

/** The entry packages of the compiled binary, relative to xeon/. */
export const ENTRY_PACKAGES: readonly string[] = ["apps/host", "apps/cli"];

const LICENSE_FILE = /^(licen[sc]e|copying|notice)([-._].*)?$/i;

interface PackageJson {
  readonly name: string;
  readonly version: string;
  readonly license: string | undefined;
  readonly origin: string;
  readonly dependencies: readonly string[];
  readonly optionalDependencies: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPackageJson(dir: string): Result<PackageJson, string> {
  const path = join(dir, "package.json");
  if (!existsSync(path)) return { ok: false, error: `${dir}: no package.json` };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    return {
      ok: false,
      error: `${path}: ${cause instanceof Error ? cause.message : "unreadable"}`,
    };
  }
  if (!isRecord(raw)) return { ok: false, error: `${path}: not an object` };
  const name = typeof raw["name"] === "string" ? raw["name"] : "";
  const version = typeof raw["version"] === "string" ? raw["version"] : "";
  let license: string | undefined;
  const field = raw["license"];
  if (typeof field === "string") license = field;
  else if (isRecord(field) && typeof field["type"] === "string") license = field["type"];
  else if (Array.isArray(raw["licenses"])) {
    const types = raw["licenses"].flatMap((item: unknown) =>
      isRecord(item) && typeof item["type"] === "string" ? [item["type"]] : [],
    );
    if (types.length > 0) license = types.join(" OR ");
  }
  const author = raw["author"];
  const authorText =
    typeof author === "string"
      ? author
      : isRecord(author) && typeof author["name"] === "string"
        ? author["name"]
        : "unknown author";
  const repo = raw["repository"];
  const repoText =
    typeof repo === "string"
      ? repo
      : isRecord(repo) && typeof repo["url"] === "string"
        ? repo["url"]
        : "no repository";
  const keys = (key: string): string[] => {
    const value = raw[key];
    return isRecord(value) ? Object.keys(value) : [];
  };
  return {
    ok: true,
    value: {
      name,
      version,
      license,
      origin: `${authorText}, ${repoText}`,
      dependencies: keys("dependencies"),
      optionalDependencies: keys("optionalDependencies"),
    },
  };
}

/** Finds node_modules/<name> by walking up from `fromDir`, like Node resolution without package exports. */
function locate(name: string, fromDir: string): string | undefined {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Collects the third-party packages reachable from `entries`. A package is first-party when its real path is inside
 * `root` and outside node_modules and vendor/; first-party packages are walked but not listed.
 */
export function collectNotices(
  root: string,
  entries: readonly string[],
  options: { readonly choice?: Readonly<Record<string, string>> } = {},
): Result<NoticeEntry[], string[]> {
  const choice = options.choice ?? LICENSE_CHOICE;
  const realRoot = realpathSync(root);
  const vendorDir = join(realRoot, "vendor") + sep;
  const seen = new Set<string>();
  const listed = new Map<string, NoticeEntry>();
  const problems: string[] = [];

  const isThirdParty = (dir: string): boolean =>
    dir.includes(`${sep}node_modules${sep}`) || dir.startsWith(vendorDir);

  const visit = (dir: string, optional: boolean): void => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const pkg = readPackageJson(dir);
    if (!pkg.ok) {
      if (!optional) problems.push(pkg.error);
      return;
    }
    if (isThirdParty(dir)) {
      const texts = readdirSync(dir)
        .filter((file) => LICENSE_FILE.test(file))
        .toSorted()
        .map((file) => ({ file, body: readFileSync(join(dir, file), "utf8").trim() }))
        .filter((text) => text.body !== "");
      const label = `${pkg.value.name}@${pkg.value.version}`;
      const declared = pkg.value.license ?? LICENSE_FIELD[pkg.value.name];
      if (declared === undefined) problems.push(`${label}: no license field`);
      const noFileOk = NO_LICENSE_FILE.has(pkg.value.name);
      if (texts.length === 0 && !noFileOk) {
        problems.push(`${label}: no license file in ${relative(realRoot, dir)}`);
      }
      const license = choice[pkg.value.name] ?? declared ?? "UNKNOWN";
      const origin = texts.length === 0 ? pkg.value.origin : undefined;
      listed.set(label, {
        name: pkg.value.name,
        version: pkg.value.version,
        license,
        texts,
        origin,
      });
    }
    for (const [names, isOptional] of [
      [pkg.value.dependencies, false],
      [pkg.value.optionalDependencies, true],
    ] as const) {
      for (const name of names) {
        const found = locate(name, dir);
        if (found === undefined) {
          if (!isOptional) problems.push(`${pkg.value.name}: cannot resolve ${name} from ${dir}`);
          continue;
        }
        visit(found, isOptional);
      }
    }
  };

  for (const entry of entries) visit(realpathSync(resolve(root, entry)), false);
  if (problems.length > 0) return { ok: false, error: problems.toSorted() };
  const sorted = [...listed.values()].toSorted(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  return { ok: true, value: sorted };
}

/** The Bun runtime that `bun build --compile` embeds in the binary. */
export const BUN_NOTICE = [
  "Bun runtime (embedded in the compiled binary by `bun build --compile`)",
  "  license: MIT (Copyright (c) Oven, the Bun authors)",
  "  source:  https://github.com/oven-sh/bun",
  "  Bun embeds JavaScriptCore (LGPL-2.0 and BSD-2-Clause parts) and other components; their notices are listed in",
  "  https://github.com/oven-sh/bun/blob/main/LICENSE.md, which applies to the embedded runtime as a whole.",
].join("\n");

/** Renders the npm block and the Bun block as one text. */
export function noticesText(entries: readonly NoticeEntry[]): string {
  const rule = "=".repeat(78);
  const parts = [
    BUN_NOTICE,
    "",
    `npm packages bundled into the binary (${String(entries.length)})`,
    "",
  ];
  for (const entry of entries) {
    parts.push(rule, `${entry.name} ${entry.version}`, `license: ${entry.license}`, rule);
    if (entry.origin !== undefined) {
      parts.push(
        `The package ships no license file. Declared license: ${entry.license}. Origin: ${entry.origin}.`,
        "",
      );
    }
    for (const text of entry.texts) parts.push(`[${text.file}]`, text.body, "");
  }
  return `${parts.join("\n")}\n`;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string" } }, strict: true });
  const root = resolve(import.meta.dir, "..");
  const result = collectNotices(root, ENTRY_PACKAGES);
  if (!result.ok) {
    for (const problem of result.error) process.stderr.write(`notices: ${problem}\n`);
    process.exit(1);
  }
  const text = noticesText(result.value);
  if (values.out === undefined) process.stdout.write(text);
  else writeFileSync(values.out, text);
  process.stderr.write(`notices: ${String(result.value.length)} npm packages\n`);
}
