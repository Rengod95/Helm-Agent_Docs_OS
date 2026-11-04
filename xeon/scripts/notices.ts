#!/usr/bin/env bun
// Third-party notices for the release archive (L4.release.spec section 6, audit prod/P-LEGAL). Walks the production dependency
// closure of the compiled binary's entry packages (apps/host, apps/cli) through each package's `dependencies`, follows
// workspace links and node_modules symlinks, and prints the notice grouped by license: one section per license, each distinct
// license text once with the packages that carry it under it. The Bun runtime that `bun build --compile` embeds is listed as well.
//   notices [--out <file>]
// A third-party package without license information is an error (exit 1), so an unlicensed dependency cannot ship silently.
// This file imports no workspace package (eng.dependency-rules.guide section 1).
// Exit codes: 0 written or printed, 1 a dependency cannot be resolved or has no license information.
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** One entry of the notice: a third-party package or a bundled program. */
export interface NoticeItem {
  readonly name: string;
  readonly version: string;
  /** SPDX expression. Sections are keyed by it; a dual license is narrowed to the chosen alternative (see LICENSE_CHOICE). */
  readonly license: string;
  /** Source or license link (https), or undefined when package.json names none. */
  readonly link: string | undefined;
  /** Copyright lines of the license files' headers (see splitHeader). Empty when none can be read. */
  readonly copyright: readonly string[];
  /** License files (LICENSE, COPYING, NOTICE ...) in file name order. Empty when the package ships none. */
  readonly texts: readonly { readonly file: string; readonly body: string }[];
  /** Lines printed under the package's entry. */
  readonly notes: readonly string[];
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
  "tr46",
  "undici-types",
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
  readonly link: string | undefined;
  readonly dependencies: readonly string[];
  readonly optionalDependencies: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A repository or homepage value as an https link, or undefined for a form this does not read. npm reads `owner/repo` and
 * `github:owner/repo` as GitHub repositories.
 */
export function sourceLink(raw: string): string | undefined {
  const trimmed = raw.trim();
  const url = (
    /^[\w.-]+\/[\w.-]+$/.test(trimmed)
      ? `https://github.com/${trimmed}`
      : trimmed
          .replace(/^github:/, "https://github.com/")
          .replace(/^git@([^:/]+):/, "https://$1/")
          .replace(/^git\+(?=https?:)/, "")
          .replace(/^git:\/\//, "https://")
  )
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  return /^https?:\/\/[^\s/]+\/\S+$/.test(url) ? url : undefined;
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
  const repoUrl =
    typeof repo === "string"
      ? repo
      : isRecord(repo) && typeof repo["url"] === "string"
        ? repo["url"]
        : undefined;
  const homepage = typeof raw["homepage"] === "string" ? raw["homepage"] : undefined;
  const link = [repoUrl, homepage]
    .map((value) => (value === undefined ? undefined : sourceLink(value)))
    .find((value) => value !== undefined);
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
      origin: `${authorText}, ${repoUrl ?? "no repository"}`,
      link,
      dependencies: keys("dependencies"),
      optionalDependencies: keys("optionalDependencies"),
    },
  };
}

/** A vendored package keeps its upstream address in UPSTREAM.json. */
function upstreamLink(dir: string): Result<string | undefined, string> {
  const path = join(dir, "UPSTREAM.json");
  if (!existsSync(path)) return { ok: true, value: undefined };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    return {
      ok: false,
      error: `${path}: ${cause instanceof Error ? cause.message : "unreadable"}`,
    };
  }
  return {
    ok: true,
    value:
      isRecord(raw) && typeof raw["upstream"] === "string"
        ? sourceLink(raw["upstream"])
        : undefined,
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
): Result<NoticeItem[], string[]> {
  const choice = options.choice ?? LICENSE_CHOICE;
  const realRoot = realpathSync(root);
  const vendorDir = join(realRoot, "vendor") + sep;
  const seen = new Set<string>();
  const listed = new Map<string, NoticeItem>();
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
        .map((file) => ({
          file,
          body: readFileSync(join(dir, file), "utf8").replace(/\r\n?/g, "\n").trim(),
        }))
        .filter((text) => text.body !== "");
      const label = `${pkg.value.name}@${pkg.value.version}`;
      const declared = pkg.value.license ?? LICENSE_FIELD[pkg.value.name];
      if (declared === undefined) problems.push(`${label}: no license field`);
      const noFileOk = NO_LICENSE_FILE.has(pkg.value.name);
      if (texts.length === 0 && !noFileOk) {
        problems.push(`${label}: no license file in ${relative(realRoot, dir)}`);
      }
      const license = choice[pkg.value.name] ?? declared ?? "UNKNOWN";
      let link = pkg.value.link;
      if (link === undefined) {
        const upstream = upstreamLink(dir);
        if (upstream.ok) link = upstream.value;
        else problems.push(`${label}: ${upstream.error}`);
      }
      listed.set(label, {
        name: pkg.value.name,
        version: pkg.value.version,
        license,
        link,
        copyright: [...new Set(texts.flatMap((text) => splitHeader(text.body).copyright))],
        texts,
        notes:
          texts.length === 0
            ? [
                `The package ships no license file. Declared license: ${license}. Origin: ${pkg.value.origin}.`,
              ]
            : [],
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
  const sorted = [...listed.values()].toSorted(byNameVersion);
  return { ok: true, value: sorted };
}

/** The Bun runtime that `bun build --compile` embeds in the binary. */
export const BUN_ITEM: NoticeItem = {
  name: "Bun runtime",
  version: Bun.version,
  license: "MIT",
  link: "https://github.com/oven-sh/bun",
  copyright: ["Copyright (c) Oven, the Bun authors"],
  texts: [],
  notes: [
    "Bun embeds JavaScriptCore (LGPL-2.0 and BSD-2-Clause parts) and other components. Their notices are listed in",
    "https://github.com/oven-sh/bun/blob/main/LICENSE.md, which applies to the embedded runtime as a whole.",
  ],
};

/** A copyright line. A template such as "Copyright [yyyy] ..." is not one. */
const COPYRIGHT_START = /^(?:copyright\b(?!\s*\[)|\(c\)|©)/i;
const RESERVED = /^all rights reserved\.?$/i;
/** The first line of the license text itself (after comment or bullet marks). Copyright lines come before it. */
const BODY_START =
  /^(?:permission\b|redistribution|licensed under\b|terms and conditions\b|the software is provided\b|this software is provided\b|the above copyright notice\b)/i;
const HEADER_MAX_LINES = 60;

/**
 * Splits a license file into the copyright lines of its header and the rest of the text. The header runs from the top to
 * the first line of the license text (BODY_START), at most HEADER_MAX_LINES lines. Titles and introductory sentences stay in
 * the rest of the text, so `MIT License`, `The MIT License (MIT)` or an intro before the copyright line do not hide it.
 * Copyright lines of an Apache-2.0 appendix come after the license text and are not header lines.
 */
export function splitHeader(body: string): {
  readonly copyright: readonly string[];
  readonly rest: string;
} {
  const lines = body.split("\n");
  let end = 0;
  while (
    end < lines.length &&
    end < HEADER_MAX_LINES &&
    !BODY_START.test((lines[end] ?? "").trim().replace(/^[*#>-]+\s*/, ""))
  ) {
    end++;
  }
  const copyright: string[] = [];
  const rest: string[] = [];
  lines.forEach((line, index) => {
    const text = line.trim();
    if (index < end && COPYRIGHT_START.test(text)) copyright.push(text);
    else if (index < end && RESERVED.test(text)) return;
    else rest.push(line);
  });
  return {
    copyright: [...new Set(copyright)],
    rest: rest
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
}

/** The text of a package's license files without their header copyright lines (the lines are printed under the package). */
function textOf(texts: NoticeItem["texts"]): string {
  return texts
    .map((text) => {
      const body = splitHeader(text.body).rest;
      return texts.length === 1 ? body : `[${text.file}]\n${body}`;
    })
    .join("\n\n");
}

/**
 * The identity of a package's license text: no copyright lines (header lines, and the filled or template copyright line of an
 * Apache appendix), no title lines (`MIT License`, `License`, `(The MIT License)` ...), lower case words only. Packages with
 * the same license text compare equal, whatever their copyright holders and title lines, and share one printed copy (textGroups).
 */
function comparableText(texts: NoticeItem["texts"]): string {
  return texts
    .map((text) => {
      const lines = splitHeader(text.body)
        .rest.split("\n")
        .map((line) => line.trim())
        .filter(
          (line) =>
            /[a-z0-9]/i.test(line) &&
            !/^(?:copyright\s*(?:\[|\d{4}|\(c\))|\(c\)|©|all rights reserved)/i.test(line),
        );
      while (lines[0] !== undefined && lines[0].length <= 60 && /licen/i.test(lines[0]))
        lines.shift();
      return lines
        .join(" ")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    })
    .join(" ");
}

/** A license text of a section, printed once, and the packages that carry it (name order). */
interface TextGroup {
  readonly body: string;
  readonly packages: readonly NoticeItem[];
}

/**
 * The packages of a section that ship a license file, grouped by identical license text (comparableText). Each group prints its
 * text once. The most common text comes first; the sort is stable, so equally common texts keep the order of their first package.
 */
function textGroups(members: readonly NoticeItem[]): readonly TextGroup[] {
  const groups = new Map<string, { body: string; packages: NoticeItem[] }>();
  for (const member of members) {
    if (member.texts.length === 0) continue;
    const key = comparableText(member.texts);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { body: textOf(member.texts), packages: [member] });
    else group.packages.push(member);
  }
  return [...groups.values()].toSorted((a, b) => b.packages.length - a.packages.length);
}

function byNameVersion(a: NoticeItem, b: NoticeItem): number {
  return a.name.localeCompare(b.name) || a.version.localeCompare(b.version);
}

/** The SPDX text links that a license expression names, one per identifier. */
function spdxLinks(license: string): string {
  const ids = license
    .split(/[\s()]+/)
    .filter((id) => /^[A-Za-z0-9.-]+$/.test(id) && !["AND", "OR", "WITH"].includes(id));
  return `License text (SPDX): ${ids.map((id) => `https://spdx.org/licenses/${id}.html`).join(", ")}`;
}

const RULE = "=".repeat(78);

/** The lines of one package's entry: name and version, header copyright lines, source link, notes, then a blank line. */
function entryLines(member: NoticeItem): string[] {
  return [
    `${member.name} ${member.version}`,
    ...member.copyright.map((line) => `  ${line}`),
    `  link: ${member.link ?? "not stated in package.json"}`,
    ...member.notes.map((note) => `  ${note}`),
    "",
  ];
}

/** "1 package" or "3 packages". */
function countOf(count: number): string {
  return `${String(count)} ${count === 1 ? "package" : "packages"}`;
}

/**
 * The notice text grouped by license: per license a header with its SPDX text links, then each distinct license text once
 * (packages with identical text share it, see textGroups), each followed by the packages that carry it with name, version,
 * header copyright lines and source link. Packages without a license file come last, with their notes. `carrier` names the
 * file that ships the notice, for the sentence about a license with no text in it (the release archive by default;
 * rust-notices.ts names its own file).
 */
export function groupedNoticesText(items: readonly NoticeItem[], carrier = "The archive"): string {
  if (items.length === 0) return "";
  const licenses = [...new Set(items.map((item) => item.license))].toSorted((a, b) =>
    a.localeCompare(b),
  );
  const parts: string[] = [];
  for (const license of licenses) {
    const members = items.filter((item) => item.license === license).toSorted(byNameVersion);
    const groups = textGroups(members);
    parts.push(
      RULE,
      `License: ${license} (${countOf(members.length)})`,
      spdxLinks(license),
      RULE,
      "",
    );
    if (groups.length === 0) {
      parts.push(
        `${carrier} ships no license text for this license. The license text link above has it.`,
        "",
      );
    }
    groups.forEach((group, index) => {
      parts.push(
        `License text ${String(index + 1)} of ${String(groups.length)} (printed once; ${countOf(group.packages.length)} ${group.packages.length === 1 ? "carries" : "carry"} it; copyright lines are listed under each package):`,
        "",
        group.body,
        "",
        "Packages with this text:",
        "",
      );
      for (const member of group.packages) parts.push(...entryLines(member));
    });
    const withoutText = members.filter((member) => member.texts.length === 0);
    if (withoutText.length > 0) {
      parts.push(groups.length === 0 ? "Packages:" : "Packages without license text:", "");
      for (const member of withoutText) parts.push(...entryLines(member));
    }
  }
  return parts.length === 0 ? "" : `${parts.join("\n").trimEnd()}\n`;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string" } }, strict: true });
  const root = resolve(import.meta.dir, "..");
  const result = collectNotices(root, ENTRY_PACKAGES);
  if (!result.ok) {
    for (const problem of result.error) process.stderr.write(`notices: ${problem}\n`);
    process.exit(1);
  }
  const text = groupedNoticesText([BUN_ITEM, ...result.value]);
  if (values.out === undefined) process.stdout.write(text);
  else writeFileSync(values.out, text);
  process.stderr.write(`notices: ${String(result.value.length)} npm packages\n`);
}
