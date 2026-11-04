import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { scanDriveSource } from "@fresnel/group-sdk/testing";
import { catalogConformance, KIND_CATALOG } from "../src/index.ts";
import { tempRoot, templateDirs } from "./support.ts";

const root = tempRoot();

test("authoring.catalog-conformance: every stable or preview entry scaffolds and validates with zero errors (A-1)", async () => {
  expect(KIND_CATALOG.map((entry) => `${entry.id}:${entry.status}`)).toEqual([
    "plugin-group:stable",
    "single-plugin:stable",
  ]);
  expect(
    await catalogConformance(templateDirs(), KIND_CATALOG, { scanDrive: scanDriveSource }),
  ).toEqual([]);
});

test("authoring.catalog-conformance: a renamed hook in a template fails conformance and names the entry (A-7)", async () => {
  const real = templateDirs();
  const group = root.path("group-templates");
  cpSync(real.group, group, { recursive: true });
  const manifestPath = join(group, "drive", ".fresnel-plugin", "plugin.json");
  const original = readFileSync(manifestPath, "utf8");
  expect(original).toContain('"boundary.settle.after"');
  writeFileSync(manifestPath, original.replace("boundary.settle.after", "boundary.settle.renamed"));
  const problems = await catalogConformance({ group, single: real.single });
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.every((line) => line.startsWith("plugin-group/conf-drive:"))).toBe(true);
});
