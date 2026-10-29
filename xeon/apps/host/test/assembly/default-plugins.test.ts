import {
  renameSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Logger } from "@xeon/contracts";
import {
  DEFAULT_PLUGIN_NAMES,
  DEFAULT_PLUGINS_MARKER_FILE,
  installDefaultPlugins,
  installedAgentDefinitions,
} from "../../src/assembly/default-plugins.ts";

// X.loading-trust.spec §4.4.7: 첫 실행 설치, 갱신, 사용자가 지운 뒤 다시 설치하지 않는 표지

let root: string;
let bundleDir: string;
let extensionsDir: string;
let stateDir: string;
const warnings: string[] = [];

const logger: Logger = {
  debug: () => {},
  info: () => {},
  warn: (message) => {
    warnings.push(message);
  },
  error: () => {},
  child: () => logger,
};

function manifest(version: string, name: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    name,
    version,
    layer: "L3",
    kind: "group",
    entry: "./dist/index.js",
    points: [],
    usesDrive: false,
  });
}

function writeBundle(version: string, name = "helm"): void {
  const dir = join(bundleDir, name);
  mkdirSync(join(dir, ".xeon-plugin"), { recursive: true });
  mkdirSync(join(dir, "dist"), { recursive: true });
  mkdirSync(join(dir, "agents"), { recursive: true });
  writeFileSync(join(dir, ".xeon-plugin", "plugin.json"), manifest(version, name));
  writeFileSync(join(dir, "dist", "index.js"), `export const version = "${version}";\n`);
  writeFileSync(
    join(dir, "agents", "explorer.md"),
    "---\nname: explorer\ndescription: reads things\ntools: [read]\n---\nYou explore.\n",
  );
}

function install(names: readonly string[] = ["helm"]): ReturnType<typeof installDefaultPlugins> {
  return installDefaultPlugins({ bundleDir, extensionsDir, stateDir, logger }, names);
}

function markerOf(): unknown {
  return JSON.parse(readFileSync(join(stateDir, DEFAULT_PLUGINS_MARKER_FILE), "utf8"));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "default-plugins-"));
  bundleDir = join(root, "bundle");
  extensionsDir = join(root, "config", "extensions");
  stateDir = join(root, "state");
  mkdirSync(bundleDir, { recursive: true });
  warnings.length = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("the first run copies the bundled plugin and writes the installed-once marker", async () => {
  writeBundle("0.1.0");
  expect(await install()).toEqual([{ name: "helm", action: "installed", version: "0.1.0" }]);
  expect(readFileSync(join(extensionsDir, "helm", "dist", "index.js"), "utf8")).toContain("0.1.0");
  expect(markerOf()).toEqual({ schemaVersion: 1, installed: { helm: "0.1.0" } });
  // 같은 버전을 다시 설치하려 하면 건드리지 않는다
  expect(await install()).toEqual([{ name: "helm", action: "kept", version: "0.1.0" }]);
});

test("a newer bundle replaces the installed copy and the marker follows the version", async () => {
  writeBundle("0.1.0");
  await install();
  writeBundle("0.2.0");
  expect(await install()).toEqual([{ name: "helm", action: "replaced", version: "0.2.0" }]);
  expect(readFileSync(join(extensionsDir, "helm", "dist", "index.js"), "utf8")).toContain("0.2.0");
  expect(markerOf()).toEqual({ schemaVersion: 1, installed: { helm: "0.2.0" } });
});

test("a plugin the user deleted is not installed again, even when the bundle is newer", async () => {
  writeBundle("0.1.0");
  await install();
  rmSync(join(extensionsDir, "helm"), { recursive: true, force: true });
  expect(await install()).toEqual([{ name: "helm", action: "removed_by_user" }]);
  expect(existsSync(join(extensionsDir, "helm"))).toBe(false);
  writeBundle("0.9.0");
  expect(await install()).toEqual([{ name: "helm", action: "removed_by_user" }]);
  expect(existsSync(join(extensionsDir, "helm"))).toBe(false);
  expect(markerOf()).toEqual({ schemaVersion: 1, installed: { helm: "0.1.0" } });
});

test("an upgrade interrupted between the two renames is recovered, not treated as a user delete", async () => {
  writeBundle("0.1.0");
  await install();
  // 교체 도중 끊긴 상태: 대상은 없고 이전 설치본이 .old에 있다
  const staging = join(root, "config", ".staging");
  mkdirSync(staging, { recursive: true });
  renameSync(join(extensionsDir, "helm"), join(staging, "helm.old"));
  writeBundle("0.2.0");
  expect(await install()).toEqual([{ name: "helm", action: "replaced", version: "0.2.0" }]);
  expect(readFileSync(join(extensionsDir, "helm", "dist", "index.js"), "utf8")).toContain("0.2.0");
  expect(existsSync(join(staging, "helm.old"))).toBe(false);
});

test("deleting the marker too asks for a fresh install", async () => {
  writeBundle("0.1.0");
  await install();
  rmSync(join(extensionsDir, "helm"), { recursive: true, force: true });
  rmSync(join(stateDir, DEFAULT_PLUGINS_MARKER_FILE));
  expect(await install()).toEqual([{ name: "helm", action: "installed", version: "0.1.0" }]);
});

test("a user edited copy with a higher version is kept", async () => {
  writeBundle("0.1.0");
  await install();
  writeFileSync(
    join(extensionsDir, "helm", ".xeon-plugin", "plugin.json"),
    manifest("0.3.0", "helm"),
  );
  expect(await install()).toEqual([{ name: "helm", action: "kept", version: "0.1.0" }]);
  expect(markerOf()).toEqual({ schemaVersion: 1, installed: { helm: "0.3.0" } });
});

test("without a bundle directory nothing is installed and no marker is written", async () => {
  expect(await install()).toEqual([{ name: "helm", action: "no_bundle" }]);
  expect(existsSync(join(stateDir, DEFAULT_PLUGINS_MARKER_FILE))).toBe(false);
});

test("a corrupt marker warns and is treated as empty; an existing install is only kept", async () => {
  writeBundle("0.1.0");
  await install();
  writeFileSync(join(stateDir, DEFAULT_PLUGINS_MARKER_FILE), "{ not json");
  expect(await install()).toEqual([{ name: "helm", action: "kept", version: "0.1.0" }]);
  expect(warnings).toContain("default_plugins.marker_corrupt");
  expect(markerOf()).toEqual({ schemaVersion: 1, installed: { helm: "0.1.0" } });
});

test("a bundle without a valid manifest is a failed install that leaves nothing behind", async () => {
  mkdirSync(join(bundleDir, "helm", ".xeon-plugin"), { recursive: true });
  writeFileSync(join(bundleDir, "helm", ".xeon-plugin", "plugin.json"), "{}");
  const outcomes = await install();
  expect(outcomes).toHaveLength(1);
  expect(outcomes[0]).toMatchObject({ name: "helm", action: "failed" });
  expect(existsSync(join(extensionsDir, "helm"))).toBe(false);
  expect(existsSync(join(stateDir, DEFAULT_PLUGINS_MARKER_FILE))).toBe(false);
});

// 기본 목록은 helm과 account-rotation이다. 위장 provider는 목록에 들지 않는다(L1.models.spec §4.11.4)
test("the default list is helm and account-rotation, and account-rotation installs from its own bundle", async () => {
  expect(DEFAULT_PLUGIN_NAMES).toEqual(["helm", "account-rotation"]);
  writeBundle("0.1.0", "account-rotation");
  expect(await install(DEFAULT_PLUGIN_NAMES)).toEqual([
    { name: "helm", action: "no_bundle" },
    { name: "account-rotation", action: "installed", version: "0.1.0" },
  ]);
  expect(existsSync(join(extensionsDir, "account-rotation", ".xeon-plugin", "plugin.json"))).toBe(
    true,
  );
  expect(markerOf()).toEqual({ schemaVersion: 1, installed: { "account-rotation": "0.1.0" } });
});

test("installed agent definitions come from <extension>/agents/*.md with the extension as their source", async () => {
  writeBundle("0.1.0");
  await install();
  const definitions = await installedAgentDefinitions(extensionsDir, ["helm", "other"], logger);
  expect(definitions).toHaveLength(1);
  expect(definitions[0]).toMatchObject({
    name: "explorer",
    description: "reads things",
    tools: ["read"],
    source: { kind: "extension", extension: "helm" },
  });
});
