import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { scaffoldExtension, validateExtensionDir } from "../src/index.ts";
import { readRecord, tempRoot, templateDirs } from "./support.ts";

const root = tempRoot();
const templates = templateDirs();

async function scaffolded(name: string): Promise<string> {
  const dir = root.path(name);
  const made = await scaffoldExtension({ kind: "plugin-group", name, dir }, { templates });
  if (!made.ok) throw new Error(made.error.message);
  return dir;
}

function editManifest(dir: string, edit: (manifest: Record<string, unknown>) => void): void {
  const path = join(dir, ".fresnel-plugin", "plugin.json");
  const manifest = readRecord(path);
  edit(manifest);
  writeFileSync(path, JSON.stringify(manifest, null, 2));
}

async function issuesOf(
  dir: string,
  code: string,
  providers?: readonly `${string}.${string}`[],
): Promise<readonly { severity: string; path: string; message: string; file?: string }[]> {
  const report = await validateExtensionDir(dir, providers === undefined ? {} : { providers });
  if (!report.ok) throw new Error(report.error.message);
  return report.value.issues
    .filter((found) => found.code === code)
    .map((found) => {
      const entry: { severity: string; path: string; message: string; file?: string } = {
        severity: found.severity,
        path: found.path,
        message: found.message,
      };
      if (found.file !== undefined) entry.file = found.file;
      return entry;
    });
}

const view = (fallback: boolean): Record<string, unknown> => ({
  schemaVersion: 1,
  widgets: "^1.0.0",
  items: [
    {
      id: "graph",
      placement: "page",
      mode: "app",
      title: "Graph",
      app: { root: "./ui", entry: "index.html", bridge: "^1.0.0", reason: "free drawing" },
      ...(fallback ? { fallback: "./ui/fallback.json" } : {}),
    },
  ],
});

test("authoring.AU-004: two drive blocks and a capability call in an on block are errors", async () => {
  const dir = await scaffolded("au4-blocks");
  editManifest(dir, (manifest) => {
    manifest["group"] = {
      composition: {
        blocks: [
          { id: "d1", stage: "run", op: "drive" },
          { id: "d2", stage: "run", op: "drive" },
          {
            id: "o1",
            stage: "watch",
            op: "on",
            hooks: ["boundary.settle.after"],
            consumes: ["web.search"],
          },
        ],
      },
    };
  });
  const found = await issuesOf(dir, "AU-004");
  expect(found.map((entry) => [entry.severity, entry.path, entry.message.split(":")[0]])).toEqual([
    ["error", "/group/composition/blocks/1", "drive_duplicate"],
    ["error", "/group/composition/blocks/2/consumes", "on_capability_call"],
  ]);
});

test("authoring.AU-004: a required capability with no provider is a warning only when providers are known", async () => {
  const dir = await scaffolded("au4-provider");
  editManifest(dir, (manifest) => {
    manifest["plugins"] = [
      { layer: "L3", drives: true, hooks: [], requires: [{ id: "web.search", range: "^1.0.0" }] },
    ];
    manifest["group"] = {
      composition: {
        blocks: [{ id: "d1", stage: "run", op: "drive", consumes: ["web.search"] }],
      },
    };
  });
  expect(await issuesOf(dir, "AU-004")).toEqual([]);
  const missing = await issuesOf(dir, "AU-004", ["knowledge.search"]);
  expect(missing.map((entry) => [entry.severity, entry.path])).toEqual([
    ["warning", "/group/composition/blocks/0/consumes/0"],
  ]);
  expect(await issuesOf(dir, "AU-004", ["web.search"])).toEqual([]);
});

test("authoring.AU-008: a frame view that has a widget tree is reported as information", async () => {
  const dir = await scaffolded("au8");
  editManifest(dir, (manifest) => {
    manifest["ui"] = view(true);
  });
  expect(await issuesOf(dir, "AU-008")).toEqual([
    {
      severity: "info",
      path: "/ui/items/0/app",
      message:
        "the frame view has a widget tree (./ui/fallback.json) that already draws it: consider the declarative mode",
    },
  ]);
  editManifest(dir, (manifest) => {
    manifest["ui"] = view(false);
  });
  expect(await issuesOf(dir, "AU-008")).toEqual([]);
});

test("authoring.AU-010: a spawn step needs a human confirmation", async () => {
  const dir = await scaffolded("au10");
  expect(await issuesOf(dir, "AU-010")).toEqual([]);
  const file = join(dir, "src", "fan-out.ts");
  writeFileSync(
    file,
    "export const fan = async (loop: { spawn(spec: object): Promise<unknown> }) => {\n  await loop.spawn({ agent: 'x', task: 'y' });\n};\n",
  );
  const found = await issuesOf(dir, "AU-010");
  expect(found.map((entry) => [entry.severity, entry.path, entry.file])).toEqual([
    ["warning", "/group", "src/fan-out.ts"],
  ]);
  writeFileSync(
    join(dir, "src", "confirm.ts"),
    "export const confirm = (loop: { ask(r: object): Promise<unknown> }) => loop.ask({});\n",
  );
  expect(await issuesOf(dir, "AU-010")).toEqual([]);
});

test("authoring.AU-011: state without a version, and a version 2 without migrations", async () => {
  const dir = await scaffolded("au11");
  expect(await issuesOf(dir, "AU-011")).toEqual([]);
  const file = join(dir, "src", "index.ts");
  const source = readFileSync(file, "utf8");
  expect(source).toContain("version: 1");
  writeFileSync(file, source.replace("version: 1", "version: 2"));
  expect(
    (await issuesOf(dir, "AU-011")).map((entry) => [entry.severity, entry.message, entry.file]),
  ).toEqual([["warning", "state.version is 2 but no migrations were found", "src/index.ts"]]);
  writeFileSync(file, "export const touch = (g: { commit(s: object): void }) => g.commit({});\n");
  expect((await issuesOf(dir, "AU-011")).map((entry) => [entry.severity, entry.message])).toEqual([
    ["warning", "the state document is used but no state declaration with a version was found"],
  ]);
});
