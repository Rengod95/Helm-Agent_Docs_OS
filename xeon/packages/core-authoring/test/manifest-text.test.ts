import { afterAll, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson, type Result } from "@fresnel/contracts";
import type { DevkitError, DevkitIssue, ScaffoldInput } from "@fresnel/contracts/services";
import { locateTemplateDirs, scaffoldExtension, validateExtensionDir } from "../src/index.ts";
import { isRecord } from "../src/shared.ts";
import type { TemplateDirs } from "../src/templates-dir.ts";

// 목적(purpose)과 설명(description) 칸. 뼈대는 두 칸을 항상 쓰고, 제작 검사 AU-013이 빈 칸을 오류로 알린다.

function templateDirs(): TemplateDirs {
  const found = locateTemplateDirs({}, undefined);
  if (found === null) throw new Error("core-authoring templates are missing");
  return found;
}

const templates = templateDirs();
const root = await mkdtemp(join(tmpdir(), "core-authoring-text-"));
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function must<T>(result: Result<T, DevkitError>): T {
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

async function scaffoldWith(
  name: string,
  extra: Omit<ScaffoldInput, "kind" | "name" | "dir"> = {},
): Promise<string> {
  const dir = join(root, name);
  must(await scaffoldExtension({ kind: "single-plugin", name, dir, ...extra }, { templates }));
  return dir;
}

function rawOf(dir: string): Record<string, unknown> {
  const parsed = parseJson(readFileSync(join(dir, ".fresnel-plugin/plugin.json"), "utf8"));
  if (!parsed.ok || !isRecord(parsed.value)) throw new Error("manifest is not an object");
  return parsed.value;
}

function writeRaw(dir: string, raw: Record<string, unknown>): void {
  writeFileSync(join(dir, ".fresnel-plugin/plugin.json"), `${JSON.stringify(raw, null, 2)}\n`);
}

async function textIssues(dir: string): Promise<readonly DevkitIssue[]> {
  const report = must(await validateExtensionDir(dir));
  return report.issues.filter((issue) => issue.code === "AU-013");
}

const PURPOSE_GAP: DevkitIssue = {
  severity: "error",
  code: "AU-013",
  path: "/purpose",
  message:
    "purpose is empty: write one sentence in the user's words that says what the plugin does for them (up to 200 characters)",
};
const DESCRIPTION_GAP: DevkitIssue = {
  severity: "error",
  code: "AU-013",
  path: "/description",
  message:
    "description is empty: write one plain sentence a user reads on the plugin card that says what the plugin does and when (up to 1024 characters)",
};

test("AU-013 lists both gaps when the scaffold got no purpose or description", async () => {
  const dir = await scaffoldWith("no-text");
  expect(await textIssues(dir)).toEqual([PURPOSE_GAP, DESCRIPTION_GAP]);
});

test("AU-013 counts absent keys as gaps too", async () => {
  const dir = await scaffoldWith("absent-keys", {
    purpose: "Keeps notes.",
    description: "Keeps notes for the user.",
  });
  const kept = Object.entries(rawOf(dir)).filter(
    ([key]) => key !== "purpose" && key !== "description",
  );
  writeRaw(dir, Object.fromEntries(kept));
  expect(await textIssues(dir)).toEqual([PURPOSE_GAP, DESCRIPTION_GAP]);
});

test("AU-013 reports only the purpose when it is blank, and spaces alone count as blank", async () => {
  const dir = await scaffoldWith("blank-purpose", {
    purpose: "   ",
    description: "Keeps notes for the user.",
  });
  expect(await textIssues(dir)).toEqual([PURPOSE_GAP]);
});

test("AU-013 reports nothing when both purpose and description are filled", async () => {
  const dir = await scaffoldWith("filled", {
    purpose: "Keeps notes.",
    description: "Keeps notes for the user.",
  });
  expect(await textIssues(dir)).toEqual([]);
});

test("AU-013 still reports the gaps when the manifest has a schema error", async () => {
  const dir = await scaffoldWith("schema-error");
  writeRaw(dir, { ...rawOf(dir), unknownKey: true });
  expect(await textIssues(dir)).toEqual([PURPOSE_GAP, DESCRIPTION_GAP]);
});

test("scaffold writes the given purpose and description right after displayName", async () => {
  const dir = await scaffoldWith("given", {
    purpose: "Keeps notes.",
    description: "Keeps notes for the user.",
  });
  const raw = rawOf(dir);
  expect(raw["purpose"]).toBe("Keeps notes.");
  expect(raw["description"]).toBe("Keeps notes for the user.");
  const keys = Object.keys(raw);
  const at = keys.indexOf("displayName");
  expect(keys.slice(at, at + 3)).toEqual(["displayName", "purpose", "description"]);
});

test("scaffold writes empty purpose and description when the input has none", async () => {
  const dir = await scaffoldWith("absent");
  const raw = rawOf(dir);
  expect(raw["purpose"]).toBe("");
  expect(raw["description"]).toBe("");
});
