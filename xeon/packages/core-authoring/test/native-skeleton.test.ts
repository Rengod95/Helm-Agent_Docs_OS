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
            today: { type: "string" },
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

test("the list result carries the local day (today), and no skeleton file turns the date into UTC", () => {
  const entry = fileText("src/index.ts");
  expect(entry).toContain("const today = (): string => {");
  expect(entry).toContain("d.getFullYear()");
  expect(entry).toContain("pad(d.getMonth() + 1)");
  expect(entry).toContain("pad(d.getDate())");
  expect(entry).toContain("return { ok: true, items, today: today() };");
  for (const file of nativeSkeletonFiles(VALUES)) {
    expect(file.text.includes("toISOString")).toBe(false);
  }
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

test("the entry says in one comment line that boards and reorderable lists are native too", () => {
  const lines = fileText("src/index.ts")
    .split("\n")
    .filter((line) => line.includes("Board") || line.includes("SortableList"));
  expect(lines).toEqual([
    "// 보드(열과 카드)와 끌어 순서를 바꾸는 목록도 native로 된다: 트리의 Board, SortableList가 move에 적은 쓰기 메서드를 부른다(examples/kanban-native).",
  ]);
});

/** 뼈대를 폴더에 쓰고 화면 파일만 바꾼다. 바꾼 글이 undefined면 화면 파일을 쓰지 않는다 */
async function skeletonWithView(name: string, view: string | undefined): Promise<string> {
  const dir = join(root, name);
  await Promise.all(
    nativeSkeletonFiles({ ...VALUES, id: name })
      .filter((file) => view !== undefined || file.path !== "ui/native/main.view.json")
      .map(async (file) => {
        const target = join(dir, file.path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(
          target,
          file.path === "ui/native/main.view.json" ? (view ?? "") : file.text,
        );
      }),
  );
  return dir;
}

test("authoring validate reads the native view: a board naming an undeclared write method is an error that says how to fix it", async () => {
  const board = {
    type: "Board",
    props: { move: "move" },
    bind: { columns: { path: "/list/columns" }, cards: { path: "/list/cards" } },
  };
  const dir = await skeletonWithView("boardbad", JSON.stringify(board));
  const report = await validateExtensionDir(dir);
  if (!report.ok) throw new Error(report.error.message);
  expect(report.value.ok).toBe(false);
  expect(report.value.issues.filter((issue) => issue.code.startsWith("native_"))).toEqual([
    {
      severity: "error",
      code: "native_tree_invalid",
      path: "/ui/items/0/file#/props/move",
      message:
        'ui/native/main.view.json: Board.move names "move", but manifest methods does not declare it: add { "verb": "move", "readOnly": false, ... } to methods',
      file: "ui/native/main.view.json",
    },
  ]);
});

test("authoring validate reports a missing view file and a tree that breaks the schema", async () => {
  const missing = await validateExtensionDir(await skeletonWithView("noview", undefined));
  if (!missing.ok) throw new Error(missing.error.message);
  expect(
    missing.value.issues
      .filter((issue) => issue.code.startsWith("native_"))
      .map((issue) => [issue.code, issue.path]),
  ).toEqual([["native_file_missing", "/ui/items/0/file"]]);

  const broken = await validateExtensionDir(
    await skeletonWithView("lowercase", '{"type":"board"}'),
  );
  if (!broken.ok) throw new Error(broken.error.message);
  expect(
    broken.value.issues
      .filter((issue) => issue.code.startsWith("native_"))
      .map((issue) => [issue.code, issue.path]),
  ).toEqual([["native_tree_invalid", "/ui/items/0/file#/type"]]);
});
