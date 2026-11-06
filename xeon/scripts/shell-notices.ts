#!/usr/bin/env bun
// Third-party notices for the npm dependencies of the Electron desktop shell (apps/desktop-shell). `bun build` folds the shell's production dependency closure (workspace packages, electron-updater and what
// it pulls in) into dist/bundle/main.mjs, so those packages ship inside Fresnel.app. Electron and Chromium are not listed here:
// their own files (LICENSE, LICENSES.chromium.html) are copied into the app by apps/desktop-shell/scripts/package.ts.
// The file apps/desktop-shell/resources/THIRD-PARTY-NOTICES-SHELL.txt is committed and copied into Resources/licenses/.
// The walk and the format come from notices.ts.
//   shell-notices [--out <file>] [--check]
// Without --check the file is written. With --check nothing is written: the file must equal the text that would be written,
// and a difference is one line on stderr.
// Exit codes: 0 written, or identical with --check; 1 a package has no license information, or the file differs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { collectNotices, groupedNoticesText, type NoticeItem, type Result } from "./notices.ts";

/** The entry package, relative to xeon/. */
export const SHELL_PACKAGE = "apps/desktop-shell";
/** The notice file, relative to xeon/. package.ts copies it into Resources/licenses/. */
export const SHELL_NOTICE_FILE = "apps/desktop-shell/resources/THIRD-PARTY-NOTICES-SHELL.txt";

const HEADER = [
  "Fresnel desktop shell (Electron) third-party notices: npm packages bundled into the shell's main process.",
  "Electron and Chromium licenses are in LICENSE.electron and LICENSES.chromium.html next to this file.",
  "",
].join("\n");

/** The notice text for the shell's npm dependencies: a header, then one section per license. */
export function shellNoticesText(items: readonly NoticeItem[]): string {
  return `${HEADER}\n${groupedNoticesText(items, "This file")}`;
}

/** Collects the shell's npm packages and builds the text; a package without license information is an error. */
export function shellNotices(xeonRoot: string): Result<{ text: string; count: number }, string[]> {
  const collected = collectNotices(xeonRoot, [SHELL_PACKAGE]);
  if (!collected.ok) return collected;
  return {
    ok: true,
    value: { text: shellNoticesText(collected.value), count: collected.value.length },
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: { out: { type: "string" }, check: { type: "boolean" } },
    strict: true,
  });
  const xeon = resolve(import.meta.dir, "..");
  const outPath = resolve(values.out ?? join(xeon, SHELL_NOTICE_FILE));
  const shown = values.out ?? SHELL_NOTICE_FILE;
  const built = shellNotices(xeon);
  if (!built.ok) {
    for (const problem of built.error) process.stderr.write(`shell-notices: ${problem}\n`);
    process.exit(1);
  }
  const count = String(built.value.count);
  if (values.check) {
    const committed = existsSync(outPath) ? readFileSync(outPath, "utf8") : undefined;
    if (committed !== built.value.text) {
      process.stderr.write(
        `shell-notices: ${shown} is out of date with the shell dependencies; run just desktop-notices-electron\n`,
      );
      process.exit(1);
    }
    process.stderr.write(`shell-notices: ${shown} is in sync (${count} npm packages)\n`);
  } else {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, built.value.text);
    process.stderr.write(`shell-notices: wrote ${shown} (${count} npm packages)\n`);
  }
}
