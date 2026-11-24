import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseJson } from "@fresnel/contracts";
import {
  locateTemplateDirs,
  scaffoldExtension,
  validateExtensionDir,
  type TemplateDirs,
} from "../src/index.ts";
import { isRecord } from "../src/shared.ts";

// 앱 뼈대를 실제 폴더에 만들고 검사한다. 깨뜨린 뒤 검사가 그 자리를 잡고 고칠 방법을 말하는지 본다.

const templates: TemplateDirs | null = locateTemplateDirs({});
let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "app-validate-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

type Manifest = Record<string, unknown>;

async function scaffoldApp(name: string): Promise<string> {
  if (templates === null) throw new Error("the plugin templates are missing in the source tree");
  const dir = join(root, name);
  const made = await scaffoldExtension(
    {
      kind: "single-plugin",
      name,
      dir,
      mode: "app",
      // 목적과 설명은 필수다(AU-013, AGE-31). 뼈대에 넘겨 매니페스트에 쓰게 한다
      purpose: "Keeps a short list.",
      description: "Keeps a short list that the user and the agent can both add to.",
    },
    { templates },
  );
  expect(made.ok).toBe(true);
  return dir;
}

async function codesOf(dir: string): Promise<{ errors: string[]; warnings: string[] }> {
  const report = await validateExtensionDir(dir);
  if (!report.ok) throw new Error(`validate failed to run: ${report.error.message}`);
  const issues = report.value.issues;
  return {
    errors: issues.filter((issue) => issue.severity === "error").map((issue) => issue.code),
    warnings: issues.filter((issue) => issue.severity === "warning").map((issue) => issue.code),
  };
}

/** 매니페스트를 읽어 고치고 다시 쓴다. 고치는 자리는 scaffold가 만든 첫 화면 하나다 */
async function editFirstScreen(dir: string, edit: (app: Manifest) => void): Promise<void> {
  const path = join(dir, ".fresnel-plugin", "plugin.json");
  const parsed = parseJson(await readFile(path, "utf8"));
  if (!parsed.ok || !isRecord(parsed.value)) throw new Error("the manifest is not an object");
  const manifest: Manifest = { ...parsed.value };
  const ui = manifest["ui"];
  if (!isRecord(ui)) throw new Error("the scaffold has no ui");
  const items = ui["items"];
  const first: unknown = Array.isArray(items) ? items[0] : undefined;
  if (!isRecord(first) || !isRecord(first["app"]))
    throw new Error("the scaffold has no app screen");
  edit(first["app"]);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

test("a fresh app scaffold has no error; its two warnings ask the author to finish the reason and the fallback", async () => {
  const dir = await scaffoldApp("fresh");
  const found = await codesOf(dir);
  expect(found.errors).toEqual([]);
  expect([...found.warnings].toSorted()).toEqual(["AU-007", "app_reason_placeholder"]);
});

test("a missing app.root folder is an error that names the fix", async () => {
  const dir = await scaffoldApp("no-root");
  await editFirstScreen(dir, (app) => {
    app["root"] = "./ui/missing";
  });
  const report = await validateExtensionDir(dir);
  if (!report.ok) throw new Error("validate failed to run");
  const issue = report.value.issues.find((found) => found.code === "app_root_missing");
  expect(issue?.severity).toBe("error");
  expect(issue?.path).toBe("/ui/items/0/app/root");
  expect(issue?.message).toContain("create it with index.html inside");
});

test("a missing entry HTML under app.root is an error", async () => {
  const dir = await scaffoldApp("no-html");
  await unlink(join(dir, "ui", "app", "index.html"));
  expect((await codesOf(dir)).errors).toEqual(["app_entry_missing"]);
});

test("an app.root that leaves the extension folder is refused", async () => {
  const dir = await scaffoldApp("escape");
  // 위로 올라가는 경로는 계약의 경로 검사(`ui_path_invalid`)가 잡는다. 그 검사는 매니페스트를 버리므로 화면 검사는 돌지 않는다
  await editFirstScreen(dir, (app) => {
    app["root"] = "../outside";
  });
  expect((await codesOf(dir)).errors).toEqual(["ui_path_invalid"]);
  // 폴더 안에서 돌아 나오는 `..`는 계약을 통과하고, 화면 검사가 `app_path_unsafe`로 잡는다
  await editFirstScreen(dir, (app) => {
    app["root"] = "./ui/../app";
  });
  expect((await codesOf(dir)).errors).toEqual(["app_path_unsafe"]);
});

test("a declared method the entry does not register, and a registration the manifest does not declare, are both errors", async () => {
  const dir = await scaffoldApp("renamed");
  const entry = join(dir, "src", "index.ts");
  const text = await readFile(entry, "utf8");
  await writeFile(entry, text.replace('g.registerMethod("add", {', 'g.registerMethod("save", {'));
  const found = await codesOf(dir);
  expect([...found.errors].toSorted()).toEqual(["method_undeclared", "method_unregistered"]);
});

test("an installed plugin whose entry is a built .js file registers its methods (no method_unregistered)", async () => {
  const dir = await scaffoldApp("built");
  const source = await readFile(join(dir, "src", "index.ts"), "utf8");
  await rm(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, "dist"));
  await writeFile(
    join(dir, "dist", "index.js"),
    source.replaceAll(/: [A-Za-z<>[\]]+(?=[,)=])/g, ""),
  );
  const path = join(dir, ".fresnel-plugin", "plugin.json");
  const parsed = parseJson(await readFile(path, "utf8"));
  if (!parsed.ok || !isRecord(parsed.value)) throw new Error("the manifest is not an object");
  await writeFile(path, JSON.stringify({ ...parsed.value, entry: "./dist/index.js" }));
  expect((await codesOf(dir)).errors).toEqual([]);
  // 등록이 빠지면 빌드한 엔트리에서도 잡는다
  const built = await readFile(join(dir, "dist", "index.js"), "utf8");
  await writeFile(
    join(dir, "dist", "index.js"),
    built.replace('registerMethod("add"', 'registerMethod("save"'),
  );
  expect([...(await codesOf(dir)).errors].toSorted()).toEqual([
    "method_undeclared",
    "method_unregistered",
  ]);
});

test("the default reason is a warning until the author writes the real one", async () => {
  const dir = await scaffoldApp("reason");
  await editFirstScreen(dir, (app) => {
    app["reason"] = "캔버스에 끌어 옮기는 보드가 필요하다";
  });
  expect((await codesOf(dir)).warnings).toEqual(["AU-007"]);
});

test("the app mode takes no members at scaffold time", async () => {
  if (templates === null) throw new Error("the plugin templates are missing in the source tree");
  const made = await scaffoldExtension(
    {
      kind: "single-plugin",
      name: "with-members",
      dir: join(root, "with-members"),
      mode: "app",
      orchestration: { members: ["alpha"] },
    },
    { templates },
  );
  expect(made.ok).toBe(false);
});
