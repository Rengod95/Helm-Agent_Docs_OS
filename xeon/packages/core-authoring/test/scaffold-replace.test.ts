import { afterAll, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "@fresnel/contracts";
import type { DevkitError } from "@fresnel/contracts/services";
import { locateTemplateDirs, scaffoldExtension } from "../src/index.ts";

// S-05(AGE-77): 같은 제작 세션에서 방식을 바꿔 뼈대를 다시 만든다. 뼈대 그대로인 파일만 바꾸고 고친 파일은 덮지 않는다.

const templates = locateTemplateDirs({}, undefined);
if (templates === null) throw new Error("core-authoring templates are missing");
const root = await mkdtemp(join(tmpdir(), "core-authoring-replace-"));
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function must<T>(result: Result<T, DevkitError>): T {
  if (!result.ok) throw new Error(`${result.error.kind}: ${result.error.message}`);
  return result.value;
}

test("replace turns an untouched hook skeleton into an app skeleton and drops the hook-only files", async () => {
  const dir = join(root, "swap-a");
  const hook = must(
    await scaffoldExtension(
      { kind: "single-plugin", name: "swap-a", dir, mode: "hook" },
      { templates },
    ),
  );
  expect(hook.files).toContain("src/index.ts");
  const app = must(
    await scaffoldExtension(
      { kind: "single-plugin", name: "swap-a", dir, mode: "app", purpose: "p", replace: true },
      { templates },
    ),
  );
  expect(app.files.some((file) => file.startsWith("ui/app"))).toBe(true);
  expect(JSON.parse(readFileSync(join(dir, ".fresnel-plugin/plugin.json"), "utf8")).purpose).toBe(
    "p",
  );
  for (const file of hook.files) {
    if (!app.files.includes(file)) expect(existsSync(join(dir, file))).toBe(false);
  }
});

test("replace refuses a folder with an edited file, names it, and changes nothing", async () => {
  const dir = join(root, "swap-b");
  const hook = must(
    await scaffoldExtension(
      { kind: "single-plugin", name: "swap-b", dir, mode: "hook" },
      { templates },
    ),
  );
  const edited = hook.files.find((file) => file.startsWith("src/"));
  if (edited === undefined) throw new Error("the hook skeleton has no source file");
  writeFileSync(join(dir, edited), "// my own code\n");
  const refused = await scaffoldExtension(
    { kind: "single-plugin", name: "swap-b", dir, mode: "app", replace: true },
    { templates },
  );
  expect(refused.ok).toBe(false);
  if (refused.ok) return;
  expect(refused.error.kind).toBe("exists");
  expect(refused.error.message).toContain(edited);
  expect(readFileSync(join(dir, edited), "utf8")).toBe("// my own code\n");
  expect(existsSync(join(dir, "ui/app"))).toBe(false);
});

test("without replace a non-empty folder is still refused", async () => {
  const dir = join(root, "swap-c");
  must(await scaffoldExtension({ kind: "single-plugin", name: "swap-c", dir }, { templates }));
  const refused = await scaffoldExtension(
    { kind: "single-plugin", name: "swap-c", dir, mode: "app" },
    { templates },
  );
  expect(refused.ok).toBe(false);
});
