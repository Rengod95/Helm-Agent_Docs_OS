#!/usr/bin/env bun
// Copies the Fresnel Guide skills (scripts/release-bundle.json `guide`, the same folder the release archive ships as guide/skills)
// into <out>. The Electron app packaging (apps/desktop-shell/scripts/package.ts) takes the parent of <out> as an extra resource, so the
// packaged engine finds the skills at Resources/guide/skills (plugin-guide locateGuideSkills). `just desktop-build-electron` runs it for
// the development build and the release. The copy goes file by file the way scripts/release.ts copyTree does, so the staged tree matches
// the archive. Process execution stays out of desktop-shell (DR-07), and this file imports no workspace package.
//   guide-skills --out <dir>
// Exit codes: 0 copied, 2 the config has no valid guide path, the folder is missing, or the arguments are wrong.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

/** Reads `guide` from the parsed release bundle config. Null when it is missing, empty, or leaves the repository. */
export function guideDirOf(config: unknown): string | null {
  if (typeof config !== "object" || config === null) return null;
  const guide: unknown = Object.getOwnPropertyDescriptor(config, "guide")?.value;
  if (typeof guide !== "string" || guide === "") return null;
  if (guide.split(/[\\/]/u).includes("..")) return null;
  return guide;
}

/** Copies every file and folder under `from` into `to`, as release.ts copyTree does. Symlinks and other entries are skipped. */
export function copyTree(from: string, to: string): void {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyTree(join(from, entry.name), join(to, entry.name));
    else if (entry.isFile()) copyFileSync(join(from, entry.name), join(to, entry.name));
  }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (values.out === undefined) {
    process.stderr.write("usage: guide-skills --out <dir>\n");
    process.exit(2);
  }
  const root = resolve(import.meta.dir, "..");
  const out = resolve(values.out);
  const guide = guideDirOf(
    JSON.parse(readFileSync(join(root, "scripts", "release-bundle.json"), "utf8")),
  );
  if (guide === null) {
    process.stderr.write("guide-skills: scripts/release-bundle.json has no valid guide path\n");
    process.exit(2);
  }
  const from = join(root, guide);
  if (!existsSync(from)) {
    process.stderr.write(`guide-skills: ${guide} is missing\n`);
    process.exit(2);
  }
  rmSync(out, { recursive: true, force: true });
  copyTree(from, out);
}
