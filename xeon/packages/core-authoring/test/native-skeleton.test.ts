import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateManifest, validateUiTree } from "@fresnel/contracts/extensions";
import { validateExtensionDir } from "../src/index.ts";
import { nativeSkeletonFiles, type NativeSkeletonValues } from "../src/native-skeleton.ts";

// 선언형 화면 뼈대(mode `native`)의 파일 목록과 내용을 값으로 비교한다. 검사는 뼈대를 실제 폴더에 쓰고 돌린다.

const VALUES: NativeSkeletonValues = { id: "notes", title: "메모", version: "0.1.0" };

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "native-skeleton-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function fileText(path: string): string {
  const found = nativeSkeletonFiles(VALUES).find((file) => file.path === path);
  if (found === undefined) throw new Error(`no skeleton file ${path}`);
  return found.text;
}

test("the native skeleton makes exactly the manifest, the engine entry, and the screen file", () => {
  expect(nativeSkeletonFiles(VALUES).map((file) => file.path)).toEqual([
    ".fresnel-plugin/plugin.json",
    "src/index.ts",
    "ui/native/main.view.json",
  ]);
});

test("the manifest value: one native page, one read method, no tool, no orchestration", () => {
  expect(JSON.parse(fileText(".fresnel-plugin/plugin.json"))).toEqual({
    schemaVersion: 2,
    name: "notes",
    version: "0.1.0",
    displayName: "메모",
    description: "메모 화면 플러그인. 선언형 화면이 항목 목록을 보여 준다",
    purpose: "메모의 항목 목록을 화면에서 본다",
    entry: "./src/index.ts",
    plugins: [{ layer: "L3", hooks: [] }],
    defaultEnabled: false,
    trust: { level: "user" },
    methods: [
      {
        verb: "list",
        params: { type: "object", properties: {}, additionalProperties: false },
        result: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            items: { type: "array", items: { type: "string" }, maxItems: 500 },
            reason: { type: "string" },
          },
          required: ["ok"],
        },
        readOnly: true,
      },
    ],
    ui: {
      schemaVersion: 1,
      widgets: "^1.0.0",
      items: [
        {
          id: "main",
          placement: "page",
          mode: "native",
          title: "메모",
          file: "./ui/native/main.view.json",
        },
      ],
    },
  });
});

test("the generated manifest passes the contracts manifest check with no error", () => {
  const checked = validateManifest(JSON.parse(fileText(".fresnel-plugin/plugin.json")));
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(checked.manifest?.name).toBe("notes");
});

test("the screen file is a declarative tree: a heading and a list bound to the read method's root", () => {
  const tree: unknown = JSON.parse(fileText("ui/native/main.view.json"));
  expect(validateUiTree(tree).ok).toBe(true);
  expect(tree).toEqual({
    type: "Stack",
    props: { gap: "md" },
    children: [
      { type: "Heading", props: { text: "메모", level: 2 } },
      { type: "List", bind: { items: { path: "/list/items" } } },
    ],
  });
});

test("the entry is a plain plugin: definePlugin, one state, one read method, no model tool", () => {
  const manifest: unknown = JSON.parse(fileText(".fresnel-plugin/plugin.json"));
  expect(manifest).not.toHaveProperty("orchestration");
  const entry = fileText("src/index.ts");
  expect(entry).toContain("const plugin: PluginModule = definePlugin<NativeState>({");
  expect(entry).toContain("state: { schema: stateSchema, initial: initialState, version: 1 },");
  expect(entry).toContain('g.registerMethod("list", {');
  expect(entry).not.toContain("registerTool");
  expect(entry).not.toContain("registerCommand");
  expect(entry).toContain('export const extension: PluginModule["entry"] = plugin.entry;');
});

test("the native skeleton passes validateExtensionDir with no error once its files are written", async () => {
  const dir = join(root, "notes");
  await Promise.all(
    nativeSkeletonFiles(VALUES).map(async (file) => {
      const target = join(dir, file.path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.text);
    }),
  );
  const report = await validateExtensionDir(dir);
  if (!report.ok) throw new Error(report.error.message);
  expect(report.value.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(report.value.ok).toBe(true);
});
