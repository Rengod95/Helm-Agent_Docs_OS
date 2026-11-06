#!/usr/bin/env bun
// Third-party notices for the Rust crates of the desktop shell (apps/desktop/src-tauri). The file
// apps/desktop/src-tauri/resources/THIRD-PARTY-NOTICES-RUST.txt is bundled with the app (tauri.conf.json, bundle.resources).
// The crates are those that the cargo resolve graph reaches from the root package `fresnel-desktop` through normal dependency
// edges: dev and build dependencies are not linked into the app. Target-specific normal dependencies are listed whatever the
// host platform, because `cargo metadata` without a platform filter lists every target, so the output is the same on every
// machine. Workspace path packages are walked but not listed. The grouping and the format come from notices.ts.
//   rust-notices [--manifest <Cargo.toml>] [--out <file>] [--check]
// Without --check the file is written. With --check nothing is written: the file (--out names another one) must equal the
// text that would be written, and a difference is one line on stderr.
// Exit codes: 0 written, or identical with --check; 1 a crate has no license information, or has no license file and is not in
// NO_LICENSE_FILE_CRATES, cargo metadata fails (for example Cargo.lock is out of date), or the file differs; 2 cargo cannot be run.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  groupedNoticesText,
  type NoticeItem,
  type Result,
  sourceLink,
  splitHeader,
} from "./notices.ts";

/** The root package: the code that its normal dependency closure links is the code the desktop app ships. */
const ROOT_CRATE = "fresnel-desktop";
/** The manifest of the root package, relative to xeon/. */
const MANIFEST = "apps/desktop/src-tauri/Cargo.toml";
/** The notice file, relative to xeon/. tauri.conf.json bundles it (bundle.resources). */
const NOTICE_FILE = "apps/desktop/src-tauri/resources/THIRD-PARTY-NOTICES-RUST.txt";

/**
 * Crates whose package ships no license file. Checked by hand against the crate directory and the upstream repository: the
 * repository root holds the license files that the declared license names, except where noted. The notice names the declared
 * license, the authors and the repository instead of the text. A crate that is not on this list and has no file fails. The list
 * only applies when no file is found: a later version that ships one is read from its file.
 * - madsmtm/objc2 root: LICENSE-APACHE.txt, LICENSE-MIT.txt, LICENSE-ZLIB.txt (block2, dispatch2, objc2 and the objc2-* crates)
 * - OpenByteDev/dlopen2 root: LICENSE (dlopen2, dlopen2_derive)
 * - jni-rs/jni-sys root: LICENSE-APACHE, LICENSE-MIT (jni-sys-macros); jni-rs/jni-rs root: the same (jni, jni-macros)
 * - h4llow3En/mac-notification-sys root: LICENSE-Apache, LICENSE-MIT (mac-notification-sys)
 * - rustls/rustls-platform-verifier root: LICENSE-APACHE, LICENSE-MIT (rustls-platform-verifier-android)
 * - rust-mobile/ndk root: LICENSE-APACHE, LICENSE-MIT (ndk, ndk-sys); rust-windowing/android-ndk-rs root: the same (ndk-context)
 * - wravery/webview2-rs root: LICENSE (webview2-com, webview2-com-macros, webview2-com-sys)
 * - retep998/winapi-rs root: LICENSE-APACHE, LICENSE-MIT (winapi-*-pc-windows-gnu)
 * - dropbox/rust-alloc-no-stdlib root: LICENSE, BSD-style (alloc-stdlib)
 * - tauri-apps/libappindicator-rs root: LICENSE-APACHE, LICENSE-MIT (libappindicator-sys, in its sys/ crate)
 * - r-efi/r-efi: no license file; the README names MIT OR Apache-2.0 OR LGPL-2.1-or-later
 * - servo/stylo: no MPL-2.0 file in the repository (selectors)
 */
export const NO_LICENSE_FILE_CRATES: ReadonlySet<string> = new Set([
  "alloc-stdlib",
  "block2",
  "dispatch2",
  "dlopen2",
  "dlopen2_derive",
  "jni",
  "jni-macros",
  "jni-sys-macros",
  "libappindicator-sys",
  "mac-notification-sys",
  "ndk",
  "ndk-context",
  "ndk-sys",
  "objc2",
  "objc2-app-kit",
  "objc2-cloud-kit",
  "objc2-core-data",
  "objc2-core-foundation",
  "objc2-core-graphics",
  "objc2-core-image",
  "objc2-core-location",
  "objc2-core-text",
  "objc2-encode",
  "objc2-exception-helper",
  "objc2-foundation",
  "objc2-io-surface",
  "objc2-local-authentication",
  "objc2-osa-kit",
  "objc2-quartz-core",
  "objc2-ui-kit",
  "objc2-user-notifications",
  "objc2-web-kit",
  "r-efi",
  "rustls-platform-verifier-android",
  "selectors",
  "webview2-com",
  "webview2-com-macros",
  "webview2-com-sys",
  "winapi-i686-pc-windows-gnu",
  "winapi-x86_64-pc-windows-gnu",
]);

/**
 * The repository of a crate that declares none in Cargo.toml. Checked by hand: the upstream Cargo.toml (root for libappindicator,
 * sys/ for libappindicator-sys) declares the same name, version and license.
 */
export const REPOSITORY_FALLBACK: Readonly<Record<string, string>> = {
  libappindicator: "https://github.com/tauri-apps/libappindicator-rs",
  "libappindicator-sys": "https://github.com/tauri-apps/libappindicator-rs",
};

/**
 * License files of a crate: the names notices.ts reads, COPYRIGHT (emk/cesu8-rs ships COPYRIGHT-RUST.txt, the license text of
 * the Rust Project's dual license, and no LICENSE file) and UNLICENSE.
 */
const LICENSE_FILE = /^(licen[sc]e|copying|copyright|notice|unlicense)([-._].*)?$/i;

/** A license file of a crate source directory. */
export interface CrateLicenseFile {
  readonly file: string;
  readonly body: string;
}

/** Reads the license files of one crate source directory, in any order. A read failure is a message. */
export type LicenseFileReader = (dir: string) => Result<readonly CrateLicenseFile[], string>;

const HEADER = [
  "Third-party notices for the Rust crates of the Fresnel desktop shell (apps/desktop/src-tauri).",
  "The desktop app bundle carries this file. The JS and Bun notices are in the release archive (THIRD-PARTY-NOTICES.txt).",
  "Generated from Cargo.lock by xeon/scripts/rust-notices.ts (just desktop-notices). Do not edit by hand.",
].join("\n");

/**
 * The declared license as an SPDX expression. A slash between identifiers (`MIT/Apache-2.0`, which many crates declare) means
 * OR. The section of a dual license keeps the whole expression: the product takes either alternative.
 */
export function normalizeLicense(declared: string): string {
  return declared
    .trim()
    .replace(/\s*\/\s*/g, " OR ")
    .replace(/\s+/g, " ");
}

/** Code point order, so the order does not depend on the locale of the machine that runs the script. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareCrates(a: NoticeItem, b: NoticeItem): number {
  return compareText(a.name, b.name) || compareText(a.version, b.version);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listOf(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : "unknown error";
}

interface CrateEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** The crate source directory: the folder of its manifest. */
  readonly dir: string;
  /** A workspace or path package (no source): walked, not listed. */
  readonly local: boolean;
  readonly license: string | undefined;
  readonly repository: string | undefined;
  readonly authors: readonly string[];
}

interface GraphNode {
  readonly id: string;
  /** The ids this package depends on through normal edges (a dep_kinds entry with kind null). */
  readonly normal: readonly string[];
}

function parseCrate(raw: unknown): Result<CrateEntry, string> {
  if (!isRecord(raw)) return { ok: false, error: "a package entry is not an object" };
  const id = raw["id"];
  const name = raw["name"];
  const version = raw["version"];
  const manifest = raw["manifest_path"];
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    typeof version !== "string" ||
    typeof manifest !== "string"
  ) {
    return { ok: false, error: "a package entry lacks id, name, version or manifest_path" };
  }
  const license = raw["license"];
  const repository = raw["repository"];
  return {
    ok: true,
    value: {
      id,
      name,
      version,
      dir: dirname(manifest),
      local: typeof raw["source"] !== "string",
      license: typeof license === "string" ? license : undefined,
      repository: typeof repository === "string" ? repository : undefined,
      authors: (listOf(raw["authors"]) ?? []).filter(
        (author): author is string => typeof author === "string",
      ),
    },
  };
}

function parseNode(raw: unknown): Result<GraphNode, string> {
  const id = isRecord(raw) ? raw["id"] : undefined;
  const deps = isRecord(raw) ? listOf(raw["deps"]) : undefined;
  if (typeof id !== "string" || deps === undefined) {
    return { ok: false, error: "a resolve node lacks id or deps" };
  }
  const normal: string[] = [];
  for (const dep of deps) {
    const pkg = isRecord(dep) ? dep["pkg"] : undefined;
    const kinds = isRecord(dep) ? listOf(dep["dep_kinds"]) : undefined;
    if (typeof pkg !== "string" || kinds === undefined) {
      return { ok: false, error: "a resolve dependency lacks pkg or dep_kinds" };
    }
    // An edge is linked into the app when one of its kinds is normal (kind null). Dev and build kinds are not.
    if (kinds.some((kind) => isRecord(kind) && kind["kind"] === null)) normal.push(pkg);
  }
  return { ok: true, value: { id, normal } };
}

function parseMetadata(
  raw: unknown,
): Result<
  { readonly crates: readonly CrateEntry[]; readonly nodes: ReadonlyMap<string, GraphNode> },
  string
> {
  const packages = isRecord(raw) ? listOf(raw["packages"]) : undefined;
  const resolved = isRecord(raw) ? raw["resolve"] : undefined;
  const graph = isRecord(resolved) ? listOf(resolved["nodes"]) : undefined;
  if (packages === undefined || graph === undefined) {
    return { ok: false, error: "cargo metadata has no packages or resolve.nodes" };
  }
  const crates: CrateEntry[] = [];
  for (const entry of packages) {
    const parsed = parseCrate(entry);
    if (!parsed.ok) return parsed;
    crates.push(parsed.value);
  }
  const nodes = new Map<string, GraphNode>();
  for (const entry of graph) {
    const parsed = parseNode(entry);
    if (!parsed.ok) return parsed;
    nodes.set(parsed.value.id, parsed.value);
  }
  return { ok: true, value: { crates, nodes } };
}

/** The ids reached from the root through normal edges, the root included. */
function linkedIds(
  rootId: string,
  nodes: ReadonlyMap<string, GraphNode>,
): Result<Set<string>, string> {
  const seen = new Set<string>([rootId]);
  const pending: string[] = [rootId];
  let id = pending.pop();
  while (id !== undefined) {
    const node = nodes.get(id);
    if (node === undefined)
      return { ok: false, error: "cargo metadata has a resolve edge to a missing node" };
    for (const next of node.normal) {
      if (!seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
    id = pending.pop();
  }
  return { ok: true, value: seen };
}

function noticeItem(crate: CrateEntry, readFiles: LicenseFileReader): Result<NoticeItem, string> {
  const label = `${crate.name}@${crate.version}`;
  if (crate.license === undefined)
    return { ok: false, error: `${label}: no license in Cargo.toml` };
  const license = normalizeLicense(crate.license);
  const read = readFiles(crate.dir);
  if (!read.ok) return { ok: false, error: `${label}: ${read.error}` };
  const texts = read.value
    .map((file) => ({ file: file.file, body: file.body.replace(/\r\n?/g, "\n").trim() }))
    .filter((text) => text.body !== "")
    .toSorted((a, b) => compareText(a.file, b.file));
  if (texts.length === 0 && !NO_LICENSE_FILE_CRATES.has(crate.name)) {
    return {
      ok: false,
      error: `${label}: no license file in the crate package (check the upstream repository, then list the crate in NO_LICENSE_FILE_CRATES)`,
    };
  }
  const repository = crate.repository ?? REPOSITORY_FALLBACK[crate.name];
  const origin = `${crate.authors.join(", ") || "unknown author"}, ${repository ?? "no repository"}`;
  return {
    ok: true,
    value: {
      name: crate.name,
      version: crate.version,
      license,
      link: repository === undefined ? undefined : sourceLink(repository),
      copyright: [...new Set(texts.flatMap((text) => splitHeader(text.body).copyright))],
      texts,
      notes:
        texts.length === 0
          ? [
              `The crate ships no license file in its package. Declared license: ${license}. Origin: ${origin}.`,
            ]
          : [],
    },
  };
}

/**
 * The notice items of the crates that the root package links, from the parsed `cargo metadata` JSON and a license file reader.
 * Pure: with a fake reader it runs without cargo or disk. Every problem is listed (sorted), not only the first.
 */
export function rustNotices(
  metadata: unknown,
  readFiles: LicenseFileReader,
): Result<NoticeItem[], string[]> {
  const parsed = parseMetadata(metadata);
  if (!parsed.ok) return { ok: false, error: [parsed.error] };
  const { crates, nodes } = parsed.value;
  const root = crates.find((crate) => crate.local && crate.name === ROOT_CRATE);
  if (root === undefined) {
    return { ok: false, error: [`cargo metadata has no workspace package ${ROOT_CRATE}`] };
  }
  const linked = linkedIds(root.id, nodes);
  if (!linked.ok) return { ok: false, error: [linked.error] };
  const items: NoticeItem[] = [];
  const problems: string[] = [];
  for (const crate of crates) {
    if (crate.local || !linked.value.has(crate.id)) continue;
    const item = noticeItem(crate, readFiles);
    if (item.ok) items.push(item.value);
    else problems.push(item.error);
  }
  if (problems.length > 0) return { ok: false, error: problems.toSorted(compareText) };
  return { ok: true, value: items.toSorted(compareCrates) };
}

/** The whole notice file: the header, then the notices grouped by license (notices.ts groupedNoticesText). */
export function rustNoticesText(items: readonly NoticeItem[]): string {
  return `${HEADER}\n\n${groupedNoticesText(items, "The desktop bundle")}`;
}

/** The license files of a crate source directory, read as UTF-8, in file name order. */
export function readCrateLicenseFiles(dir: string): Result<CrateLicenseFile[], string> {
  try {
    const files = readdirSync(dir)
      .filter((file) => LICENSE_FILE.test(file))
      .toSorted(compareText)
      .map((file) => ({ file, body: readFileSync(join(dir, file), "utf8") }));
    return { ok: true, value: files };
  } catch (cause) {
    return { ok: false, error: `license files cannot be read: ${errorText(cause)}` };
  }
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/** `cargo metadata` for the manifest: offline, and --locked so that the lock file is not updated. */
function runCargoMetadata(
  manifest: string,
): Result<string, { readonly code: 1 | 2; readonly message: string }> {
  try {
    const run = Bun.spawnSync(
      [
        "cargo",
        "metadata",
        "--format-version",
        "1",
        "--locked",
        "--offline",
        "--manifest-path",
        manifest,
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    if (run.exitCode !== 0) {
      return {
        ok: false,
        error: { code: 1, message: `cargo metadata failed: ${firstLine(run.stderr.toString())}` },
      };
    }
    return { ok: true, value: run.stdout.toString() };
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 2,
        message: `cargo cannot be run (${errorText(cause)}); the Rust toolchain in xeon/mise.toml is needed`,
      },
    };
  }
}

function parseJsonText(text: string): Result<unknown, string> {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch (cause) {
    return { ok: false, error: `cargo metadata printed no JSON: ${errorText(cause)}` };
  }
}

function fail(code: 1 | 2, message: string): never {
  process.stderr.write(`rust-notices: ${message}\n`);
  process.exit(code);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      out: { type: "string" },
      check: { type: "boolean" },
    },
    strict: true,
  });
  const xeon = resolve(import.meta.dir, "..");
  const manifest = resolve(values.manifest ?? join(xeon, MANIFEST));
  const outPath = resolve(values.out ?? join(xeon, NOTICE_FILE));
  const shown = values.out ?? NOTICE_FILE;

  const run = runCargoMetadata(manifest);
  if (!run.ok) fail(run.error.code, run.error.message);
  const metadata = parseJsonText(run.value);
  if (!metadata.ok) fail(1, metadata.error);
  const notice = rustNotices(metadata.value, readCrateLicenseFiles);
  if (!notice.ok) {
    for (const problem of notice.error) process.stderr.write(`rust-notices: ${problem}\n`);
    process.exit(1);
  }
  const text = rustNoticesText(notice.value);
  const count = String(notice.value.length);
  if (values.check) {
    const committed = existsSync(outPath) ? readFileSync(outPath, "utf8") : undefined;
    if (committed !== text) {
      fail(1, `${shown} is out of date with Cargo.lock; run just desktop-notices`);
    }
    process.stderr.write(`rust-notices: ${shown} is in sync (${count} crates)\n`);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, text);
    process.stderr.write(`rust-notices: wrote ${shown} (${count} crates)\n`);
  }
}
