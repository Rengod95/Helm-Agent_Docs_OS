import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { CompositionDecl } from "@fresnel/contracts/extensions";
import type { KindEntry } from "@fresnel/contracts/services";
import { KIND_CATALOG, scaffoldExtension, templateKindOf } from "../src/index.ts";
import { parse } from "@fresnel/contracts";
import { TemplateIndexSchema } from "@fresnel/group-sdk";
import { readManifest, tempRoot, templateDirs } from "./support.ts";

const root = tempRoot();
const templates = templateDirs();

function fillExpected(text: string, id: string): string {
  return text
    .replaceAll("__ID__", id)
    .replaceAll("__TITLE__", id)
    .replaceAll("__VERSION__", "0.1.0");
}

test("authoring.scaffold-equals-template: the three group kinds are the template files with the placeholders filled (A-2)", async () => {
  const policy: CompositionDecl = {
    blocks: [{ id: "guard", stage: "guard", op: "on", hooks: ["tool.call.before"] }],
  };
  const observe: CompositionDecl = {
    blocks: [{ id: "count", stage: "observe", op: "on", hooks: ["boundary.settle.after"] }],
  };
  expect(templateKindOf(undefined)).toBe("drive");
  expect(templateKindOf(policy)).toBe("policy");
  expect(templateKindOf(observe)).toBe("observe");

  // 초안 없이 만들면 매니페스트까지 템플릿 글자 그대로다
  const dir = root.path("eq-drive");
  const made = await scaffoldExtension(
    { kind: "plugin-group", name: "eq-drive", dir },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  const indexed = parse(
    TemplateIndexSchema,
    JSON.parse(readFileSync(join(templates.group, "index.json"), "utf8")),
  );
  if (!indexed.ok) throw new Error("index.json is not valid");
  const listed = indexed.value.templates.drive.files;
  expect(made.value.files).toEqual(
    listed
      .map((file) => file.split("/").slice(1).join("/").replaceAll("__ID__", "eq-drive"))
      .toSorted(),
  );
  for (const file of listed) {
    const source = readFileSync(join(templates.group, file), "utf8");
    const written = readFileSync(
      join(dir, file.split("/").slice(1).join("/").replaceAll("__ID__", "eq-drive")),
      "utf8",
    );
    expect(written).toBe(fillExpected(source, "eq-drive"));
  }
});

test("authoring.scaffold: a composition draft is patched into the manifest and the manifest validates", async () => {
  const composition: CompositionDecl = {
    blocks: [{ id: "guard", stage: "guard", op: "on", hooks: ["tool.call.before"] }],
  };
  const dir = root.path("patched");
  const made = await scaffoldExtension(
    { kind: "plugin-group", name: "patched", dir, group: { composition } },
    { templates, displayName: "Patched" },
  );
  if (!made.ok) throw new Error(made.error.message);
  const manifest = readManifest(dir);
  expect(manifest.displayName).toBe("Patched");
  expect(manifest.group).toEqual({ composition });
  expect(manifest.plugins[0]?.hooks).toContain("tool.call.before");
  expect(manifest.plugins[0]?.drives).toBeUndefined();
});

test("authoring.scaffold: a single plugin takes the requested layer", async () => {
  const dir = root.path("single-l2");
  const made = await scaffoldExtension(
    { kind: "single-plugin", name: "single-l2", dir, layer: "L2" },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  const manifest = readManifest(dir);
  expect(manifest.plugins.map((plugin) => plugin.layer)).toEqual(["L2"]);
  expect(manifest.group).toBeUndefined();
});

test("authoring.scaffold: refusals leave the target folder untouched", async () => {
  const empty = root.path("refuse");
  const reserved = await scaffoldExtension(
    { kind: "plugin-group", name: "core", dir: empty },
    { templates },
  );
  expect(reserved).toEqual({
    ok: false,
    error: { kind: "invalid_input", message: 'AU-001: name "core" is reserved' },
  });
  const bad = await scaffoldExtension(
    { kind: "plugin-group", name: "Bad_Name", dir: empty },
    { templates },
  );
  expect(bad).toEqual({
    ok: false,
    error: { kind: "invalid_input", message: 'AU-001: name "Bad_Name" is not valid' },
  });
  const taken = await scaffoldExtension(
    { kind: "plugin-group", name: "taken", dir: empty },
    { templates, installedNames: ["taken"] },
  );
  expect(taken).toEqual({
    ok: false,
    error: { kind: "exists", message: 'AU-001: "taken" is already installed' },
  });
  const occupied = root.path("occupied");
  mkdirSync(occupied);
  writeFileSync(join(occupied, "keep.txt"), "x");
  const notEmpty = await scaffoldExtension(
    { kind: "plugin-group", name: "fresh", dir: occupied },
    { templates },
  );
  expect(notEmpty).toEqual({
    ok: false,
    error: { kind: "exists", message: `${occupied} is not empty` },
  });
  expect(readdirSync(occupied)).toEqual(["keep.txt"]);
  expect(readdirSync(root.path("."))).not.toContain("refuse");
  const relative = await scaffoldExtension(
    { kind: "plugin-group", name: "fresh", dir: "rel/dir" },
    { templates },
  );
  expect(relative).toEqual({
    ok: false,
    error: { kind: "invalid_input", message: "dir must be an absolute path" },
  });
});

test("authoring.blocked-kind-refused: a blocked catalog entry is refused with its reason", async () => {
  const [first] = KIND_CATALOG;
  if (first === undefined) throw new Error("catalog is empty");
  const blocked: KindEntry = {
    ...first,
    status: "blocked",
    blockedReason: "waiting for the hook protocol",
  };
  const result = await scaffoldExtension(
    { kind: "plugin-group", name: "blocked-one", dir: root.path("blocked") },
    { templates, catalog: [blocked] },
  );
  expect(result).toEqual({
    ok: false,
    error: { kind: "blocked_kind", message: "waiting for the hook protocol" },
  });
});
