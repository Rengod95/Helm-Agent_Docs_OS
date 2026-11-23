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

test("the manifest value: one app page, two methods (read and write), one model tool", () => {
  expect(JSON.parse(fileText(".fresnel-plugin/plugin.json"))).toEqual({
    schemaVersion: 2,
    name: "kanban",
    version: "0.1.0",
    displayName: "칸반",
    description: "칸반 앱 플러그인. 화면과 모델이 같은 항목 목록을 고친다",
    purpose: "칸반을(를) 화면에서 보고 고치고, 모델도 같은 도구로 고친다",
    entry: "./src/index.ts",
    plugins: [{ layer: "L3", hooks: [] }],
    orchestration: {},
    defaultEnabled: false,
    trust: { level: "user" },
    tools: [
      {
        name: "kanban_add_item",
        description: "앱 목록에 항목 하나를 더한다. 화면의 add 메서드와 같은 함수를 쓴다",
      },
    ],
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
            items: { type: "array", items: { type: "string" }, maxItems: 500 },
            reason: { type: "string" },
          },
          required: ["ok"],
        },
        readOnly: false,
        label: "항목 추가",
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
  expect(entry).toContain('name: "kanban_add_item",');
  expect(entry).toContain("return g.commit({ items: [...g.state().items, title] });");
  // 메서드 add와 모델 도구가 같은 addItem을 부른다
  expect(entry.split("addItem(g, checked.value.title)")).toHaveLength(3);
});

test("the entry has one state with a schema and an initial value, at version 1", () => {
  const entry = fileText("src/index.ts");
  expect(entry).toContain("const initialState: AppState = { items: [] };");
  expect(entry).toContain("state: { schema: stateSchema, initial: initialState, version: 1 },");
  expect(entry).toContain('export const extension: OrchestrationModule["entry"] = app.entry;');
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
