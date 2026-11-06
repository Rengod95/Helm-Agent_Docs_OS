#!/usr/bin/env bun
// Builds the default plugin bundles (scripts/release-bundle.json `defaultPlugins`, the same list and build scripts as the release
// archive in scripts/release.ts) into <out>/<name>/. The Electron app packaging (apps/desktop-shell/scripts/package.ts) puts <out> in
// Resources/default-plugins, where the engine sidecar reads its install source. `just desktop-build-electron` runs it for both the
// development build and the release, so the status bar and plugin screens have Helm either way. Process execution stays out of
// desktop-shell (DR-07), so this script runs the build scripts.
//   default-plugins --out <dir>
// Exit codes: 0 built, 1 a plugin build failed, 2 the list is missing or malformed.
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

export interface DefaultPluginEntry {
  readonly name: string;
  readonly buildScript: string;
}

/** Reads `defaultPlugins` from the parsed release bundle config. Null when the shape is wrong or a name leaves its folder. */
export function defaultPluginsOf(config: unknown): readonly DefaultPluginEntry[] | null {
  if (typeof config !== "object" || config === null) return null;
  const list: unknown = Object.getOwnPropertyDescriptor(config, "defaultPlugins")?.value;
  if (!Array.isArray(list)) return null;
  const entries: DefaultPluginEntry[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) return null;
    const name: unknown = Object.getOwnPropertyDescriptor(item, "name")?.value;
    const buildScript: unknown = Object.getOwnPropertyDescriptor(item, "buildScript")?.value;
    if (typeof name !== "string" || typeof buildScript !== "string") return null;
    if (name === "" || name === ".." || name.includes("/") || name.includes("\\")) return null;
    entries.push({ name, buildScript });
  }
  return entries;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (values.out === undefined) {
    process.stderr.write("usage: default-plugins --out <dir>\n");
    process.exit(2);
  }
  const root = resolve(import.meta.dir, "..");
  const out = resolve(values.out);
  const list = defaultPluginsOf(
    JSON.parse(readFileSync(join(root, "scripts", "release-bundle.json"), "utf8")),
  );
  if (list === null) {
    process.stderr.write(
      "default-plugins: scripts/release-bundle.json has no valid defaultPlugins\n",
    );
    process.exit(2);
  }
  rmSync(out, { recursive: true, force: true });
  for (const plugin of list) {
    const built = Bun.spawnSync([process.execPath, plugin.buildScript, join(out, plugin.name)], {
      cwd: root,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (built.exitCode !== 0) {
      process.stderr.write(`default-plugins: ${plugin.name} did not build\n`);
      process.exit(1);
    }
  }
}
