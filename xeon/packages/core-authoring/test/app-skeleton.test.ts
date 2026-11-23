import { expect, test } from "bun:test";
import { validateManifest } from "@fresnel/contracts/extensions";
import { appSkeletonFiles, type AppSkeletonValues } from "../src/app-skeleton.ts";

// 앱 뼈대(mode `app`)의 파일 목록과 내용을 값으로 비교한다. 내용은 순수 함수가 주므로 파일을 쓰지 않는다.

const VALUES: AppSkeletonValues = { id: "kanban", title: "칸반", version: "0.1.0" };

function fileText(path: string): string {
  const found = appSkeletonFiles(VALUES).find((file) => file.path === path);
  if (found === undefined) throw new Error(`no skeleton file ${path}`);
  return found.text;
}

test("the app skeleton makes exactly the manifest, the engine entry, and the screen folder", () => {
  expect(appSkeletonFiles(VALUES).map((file) => file.path)).toEqual([
    ".fresnel-plugin/plugin.json",
    "src/index.ts",
    "ui/app/app.js",
    "ui/app/bridge.js",
    "ui/app/index.html",
    "ui/app/theme.css",
  ]);
});

test("the app manifest's model tools are the read tool and the write tool, in that order", () => {
  const manifest: unknown = JSON.parse(fileText(".fresnel-plugin/plugin.json"));
  expect(manifest).toMatchObject({
    tools: [{ name: "kanban_list_items" }, { name: "kanban_add_item" }],
    methods: [
      { verb: "list", readOnly: true },
      { verb: "add", readOnly: false },
    ],
  });
});

test("the manifest value: one app page, two methods (read and write), two model tools (read and write)", () => {
  expect(JSON.parse(fileText(".fresnel-plugin/plugin.json"))).toEqual({
    schemaVersion: 2,
    name: "kanban",
    version: "0.1.0",
    displayName: "칸반",
    description: "칸반 앱 플러그인. 화면과 모델이 같은 항목 목록을 고친다",
    purpose: "칸반을(를) 화면에서 보고 고치고, 모델도 같은 도구로 고친다",
    entry: "./src/index.ts",
    plugins: [{ layer: "L3", hooks: [] }],
    defaultEnabled: false,
    trust: { level: "user" },
    tools: [
      { name: "kanban_list_items", description: "앱 목록의 항목을 모두 보여 준다." },
      { name: "kanban_add_item", description: "앱 목록에 항목 하나를 더한다." },
    ],
    methods: [
      {
        verb: "list",
        params: { type: "object", properties: {}, additionalProperties: false },
        result: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: { title: { type: "string" }, created: { type: "string" } },
                required: ["title", "created"],
              },
              maxItems: 500,
            },
            reason: { type: "string" },
          },
          required: ["ok"],
        },
        readOnly: true,
      },
      {
        verb: "add",
        params: {
          type: "object",
          properties: { title: { type: "string", minLength: 1, maxLength: 200 } },
          required: ["title"],
          additionalProperties: false,
        },
        result: {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            items: {
              type: "array",
              items: {
                type: "object",
                properties: { title: { type: "string" }, created: { type: "string" } },
                required: ["title", "created"],
              },
              maxItems: 500,
            },
            reason: { type: "string" },
          },
          required: ["ok"],
        },
        readOnly: false,
        label: "항목 추가",
        ownDataOnly: true,
      },
    ],
    ui: {
      schemaVersion: 1,
      items: [
        {
          id: "main",
          placement: "page",
          mode: "app",
          title: "칸반",
          app: {
            root: "./ui/app",
            entry: "index.html",
            bridge: "^1.0.0",
            reason: "직접 그리는 화면이 필요한 까닭을 여기에 한 줄로 적는다",
          },
        },
      ],
    },
  });
});

test("the generated manifest passes the contracts manifest check with no error", () => {
  const checked = validateManifest(JSON.parse(fileText(".fresnel-plugin/plugin.json")));
  expect(checked.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  expect(checked.manifest?.name).toBe("kanban");
});

test("the model tool and the screen's write method share one function in the entry", () => {
  const entry = fileText("src/index.ts");
  expect(entry).toContain('g.registerMethod("list", {');
  expect(entry).toContain('g.registerMethod("add", {');
  expect(entry).toContain('name: "kanban_list_items",');
  expect(entry).toContain('name: "kanban_add_item",');
  expect(entry).toContain("return readStored(g);");
  expect(entry).toContain("const put = await g.pluginStore.put(ITEMS_KEY, { items: next });");
  // 메서드 add와 모델 도구가 같은 addItem을 부른다(정의는 "addItem(g: "라서 셈에 들지 않는다)
  expect(entry.split("addItem(g, ")).toHaveLength(3);
});

test("the day an item is made comes from the local calendar (today), and no skeleton file turns the date into UTC", () => {
  const entry = fileText("src/index.ts");
  expect(entry).toContain("const made: AppItem = { title, created: today() };");
  expect(entry).toContain("const today = (): string => {");
  expect(entry).toContain("d.getFullYear()");
  expect(entry).toContain("pad(d.getMonth() + 1)");
  expect(entry).toContain("pad(d.getDate())");
  for (const file of appSkeletonFiles(VALUES)) {
    expect(file.text.includes("toISOString")).toBe(false);
  }
});

test("without a conversation the entry keeps its items in the plugin store and never answers no_thread", () => {
  const entry = fileText("src/index.ts");
  expect(entry).not.toContain("no_thread");
  expect(entry).toContain('const ITEMS_KEY = "items";');
  expect(entry).toContain("g.pluginStore.get(ITEMS_KEY)");
  expect(entry).toContain("g.pluginStore.put(ITEMS_KEY, { items: next })");
});

test("the manifest has no orchestration declaration, so the app is not a Drive or member plugin", () => {
  const manifest: unknown = JSON.parse(fileText(".fresnel-plugin/plugin.json"));
  expect(manifest).not.toHaveProperty("orchestration");
  expect(fileText("src/index.ts")).toContain("definePlugin<AppState>({");
});

test("the entry has one state with a schema and an initial value, at version 1", () => {
  const entry = fileText("src/index.ts");
  expect(entry).toContain("const initialState: AppState = { items: [] };");
  expect(entry).toContain("state: { schema: stateSchema, initial: initialState, version: 1 },");
  expect(entry).toContain('export const extension: PluginModule["entry"] = app.entry;');
});

test("the screen loads its code from files, never inline (the frame CSP forbids inline scripts)", () => {
  const html = fileText("ui/app/index.html");
  expect(html).toContain('<script src="bridge.js"></script>');
  expect(html).toContain('<script src="app.js"></script>');
  expect(html).toContain('<link rel="stylesheet" href="theme.css">');
  expect(/<script(?![^>]*\ssrc=)[^>]*>/.test(html)).toBe(false);
});

test("the bridge speaks the ready handshake and answers pushes with the contract's ops", () => {
  const bridge = fileText("ui/app/bridge.js");
  expect(bridge).toContain('const BRIDGE_RANGE = "^1.0.0";');
  expect(bridge).toContain("const ready = { v: 1, ready: true, bridge: BRIDGE_RANGE };");
  expect(bridge).toContain('if (data.push === "theme") applyTheme(data.value);');
  expect(bridge).toContain('else if (data.push === "invalidate")');
  expect(bridge).toContain('op: "pong", args: { n: data.value.n }');
  expect(bridge).toContain('request("query", params === undefined');
  expect(bridge).toContain('request("call", params === undefined');
  expect(bridge).toContain('request("navigate", { target })');
});

test("the theme sheet takes its colors from tokens and its spacing from its own variables", () => {
  const css = fileText("ui/app/theme.css");
  // 날 색 값이 없다
  expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
  expect(/\b(rgb|hsl)a?\(/.test(css)).toBe(false);
  // px는 토큰 정의(`--…: Npx`) 줄에만 있다
  const pxLines = css.split("\n").filter((line) => line.includes("px"));
  expect(pxLines.every((line) => /^\s*--[a-z0-9-]+:\s*\d+px;$/.test(line))).toBe(true);
  expect(css).toContain("var(--bg, canvas)");
  expect(css).toContain("var(--accent, currentColor)");
});

test("no screen file reaches the network", () => {
  for (const path of [
    "ui/app/app.js",
    "ui/app/bridge.js",
    "ui/app/index.html",
    "ui/app/theme.css",
  ]) {
    const text = fileText(path);
    expect(text.includes("fetch(")).toBe(false);
    expect(text.includes("XMLHttpRequest")).toBe(false);
    expect(/https?:\/\//.test(text)).toBe(false);
  }
});

test("the example screen labels its input and spaces the items of a list row with a gap token", () => {
  const html = fileText("ui/app/index.html");
  expect(html).toContain('<label class="app-label" for="title-input">항목 이름</label>');
  expect(html).toContain('<input class="app-input" id="title-input" maxlength="200">');
  const css = fileText("ui/app/theme.css");
  expect(css).toContain(
    ".app-list li {\n  display: flex;\n  align-items: center;\n  gap: var(--space-3);",
  );
  expect(css).not.toContain("margin-left");
});
