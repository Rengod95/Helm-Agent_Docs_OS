import { afterAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TemplateDirs } from "../src/templates-dir.ts";
import { locateTemplateDirs, scaffoldExtension, validateExtensionDir } from "../src/index.ts";

// S-01(AGE-77): 앱 프레임의 sandbox에는 allow-forms가 없어 form 제출이 막힌다. 검사는 막지 않고 경고와 고치는 법을 준다.

function templateDirs(): TemplateDirs {
  const found = locateTemplateDirs({}, undefined);
  if (found === null) throw new Error("core-authoring templates are missing");
  return found;
}

const templates = templateDirs();
const root = await mkdtemp(join(tmpdir(), "core-authoring-form-"));
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

let counter = 0;

async function appFolder(name: string): Promise<string> {
  const dir = join(root, name);
  const made = await scaffoldExtension(
    { kind: "single-plugin", name, dir, mode: "app", purpose: "p", description: "d" },
    { templates },
  );
  if (!made.ok) throw new Error(made.error.message);
  return dir;
}

async function formWarnings(dir: string) {
  const report = await validateExtensionDir(dir);
  if (!report.ok) throw new Error(report.error.message);
  return report.value.issues.filter((issue) => issue.code === "app_form_submit");
}

test("the app skeleton itself has no form submit", async () => {
  expect(await formWarnings(await appFolder("form-clean"))).toEqual([]);
});

test.each([
  ['<form id="f"><button type="button">x</button></form>', "index.html", 1],
  ['<button type="submit">x</button>', "index.html", 1],
  ['<input onsubmit="go()">', "index.html", 1],
  ['const a = 1;\nform.addEventListener("submit", go);', "app.js", 2],
])(
  "a screen file with %j gets a warning with its file and line, and the check still passes",
  async (text, file, line) => {
    const dir = await appFolder(`form-case-${String((counter += 1))}`);
    mkdirSync(join(dir, "ui", "app"), { recursive: true });
    writeFileSync(join(dir, "ui", "app", file), text);
    const warnings = await formWarnings(dir);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ severity: "warning", file: `ui/app/${file}`, line });
    expect(warnings[0]?.message).toContain('type="button"');
    const report = await validateExtensionDir(dir);
    if (!report.ok) throw new Error(report.error.message);
    expect(report.value.issues.some((issue) => issue.severity === "error")).toBe(false);
  },
);
