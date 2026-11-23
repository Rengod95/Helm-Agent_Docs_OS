// 앱 플러그인 뼈대(`authoring_scaffold` mode `app`, pgRe §4.3, ADR-0021 §3.5). 본문은 문자열 모음이고 이 모듈의 함수는 순수하다.
// 시험이 파일 목록과 내용을 값으로 비교하므로 파일을 읽거나 쓰지 않는다. 쓰기는 scaffold.ts가 한다.
//
// 뼈대의 짜임: 화면(`ui/app`, 셸의 다리로 메서드를 부른다)과 엔진 코드(`src/index.ts`, 상태 하나, 읽기 메서드 list,
// 쓰기 메서드 add, 같은 함수를 쓰는 모델 도구)가 같은 `addItem`으로 같은 상태를 고친다.
// 다리 프로토콜은 contracts `extensions/ui.ts`(BRIDGE_VERSION, BRIDGE_OPS, BRIDGE_PUSHES)와 `examples/viewdemo`를 따른다.

export interface AppSkeletonValues {
  /** 플러그인 이름(확장 이름). 도구 이름의 바탕이다 */
  readonly id: string;
  /** 보이는 이름. 매니페스트 `displayName`과 화면 자리 제목이다 */
  readonly title: string;
  readonly version: string;
}

interface SkeletonFile {
  /** 대상 폴더 기준 상대 경로 */
  readonly path: string;
  readonly text: string;
}

/** 뼈대가 `app.reason`에 적는 기본 글. 검사(validate)는 이 글이 그대로면 경고한다(작성자가 까닭을 고친다) */
export const APP_REASON_PLACEHOLDER: string =
  "직접 그리는 화면이 필요한 까닭을 여기에 한 줄로 적는다";

/** 화면 자리의 기본 id. 매니페스트 `ui.items[].id`이고 패턴 `^[a-z][a-z0-9-]{0,31}$`을 지킨다 */
const VIEW_ID = "main";

/** 상태의 항목 목록 상한. 메서드 결과 스키마와 엔진 코드 스키마가 같은 값을 쓴다 */
const ITEM_MAX = 500;
const TITLE_MAX = 200;

/** 모델 도구 이름. 확장 이름의 `-`를 `_`로 바꾼 뒤 `_add_item`을 붙인다(도구 이름 패턴 `^[a-z][a-z0-9_]{0,63}$`) */
function appToolName(id: string): string {
  return `${id.replaceAll("-", "_")}_add_item`;
}

const EMPTY_OBJECT = { type: "object", properties: {}, additionalProperties: false };

/** 항목 하나. `created`는 만든 날의 `YYYY-MM-DD`(이 기기의 시간대, 뼈대의 `today()`가 만든다) */
const ITEM_SHAPE = {
  type: "object",
  properties: { title: { type: "string" }, created: { type: "string" } },
  required: ["title", "created"],
};

/** 두 메서드의 결과 모양. 성공이면 `ok`와 `items`, 실패면 `ok`와 `reason`이다 */
const RESULT_SHAPE = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    items: { type: "array", items: ITEM_SHAPE, maxItems: ITEM_MAX },
    reason: { type: "string" },
  },
  required: ["ok"],
};

const ADD_PARAMS = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 1, maxLength: TITLE_MAX },
  },
  required: ["title"],
  additionalProperties: false,
};

function manifestText(values: AppSkeletonValues): string {
  const manifest = {
    schemaVersion: 2,
    name: values.id,
    version: values.version,
    displayName: values.title,
    description: `${values.title} 앱 플러그인. 화면과 모델이 같은 항목 목록을 고친다`,
    purpose: `${values.title}을(를) 화면에서 보고 고치고, 모델도 같은 도구로 고친다`,
    entry: "./src/index.ts",
    plugins: [{ layer: "L3", hooks: [] }],
    defaultEnabled: false,
    trust: { level: "user" },
    tools: [
      {
        name: appToolName(values.id),
        description: "앱 목록에 항목 하나를 더한다. 화면의 add 메서드와 같은 함수를 쓴다",
      },
    ],
    methods: [
      { verb: "list", params: EMPTY_OBJECT, result: RESULT_SHAPE, readOnly: true },
      {
        verb: "add",
        params: ADD_PARAMS,
        result: RESULT_SHAPE,
        readOnly: false,
        label: "항목 추가",
        ownDataOnly: true,
      },
    ],
    ui: {
      schemaVersion: 1,
      items: [
        {
          id: VIEW_ID,
          placement: "page",
          mode: "app",
          title: values.title,
          app: {
            root: "./ui/app",
            entry: "index.html",
            bridge: "^1.0.0",
            reason: APP_REASON_PLACEHOLDER,
          },
        },
      ],
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** 엔진 코드. 생성 글에는 `${`와 역따옴표를 쓰지 않는다(도구 이름만 JSON 문자열로 넣는다) */
function entryText(values: AppSkeletonValues): string {
  const tool = JSON.stringify(appToolName(values.id));
  return [
    'import { parse } from "@fresnel/contracts";',
    "import {",
    "  definePlugin,",
    "  pluginManifest,",
    "  type OrchestrationApi,",
    "  type PluginModule,",
    '} from "@fresnel/orchestration-sdk";',
    'import { Type } from "typebox";',
    'import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" };',
    "",
    "// 앱 플러그인 골격. 상태 하나(items), 읽기 메서드 list, 쓰기 메서드 add, 같은 함수를 쓰는 모델 도구를 둔다.",
    "// 화면(ui/app)은 메서드를 부르고 모델은 도구를 부른다. 둘 다 addItem 하나로 상태를 고치므로 같은 목록을 본다.",
    '// 대화가 열려 있으면 상태 문서(g.state, g.commit)에, 없으면 플러그인 저장소(g.pluginStore, 키 "items")에 둔다.',
    "",
    "interface AppItem {",
    "  readonly title: string;",
    "  readonly created: string;",
    "}",
    "",
    "interface AppState {",
    "  readonly items: readonly AppItem[];",
    "}",
    "",
    "const stateSchema = Type.Object({",
    `  items: Type.Array(Type.Object({ title: Type.String({ maxLength: ${TITLE_MAX} }), created: Type.String({ maxLength: 10 }) }), { maxItems: ${ITEM_MAX} }),`,
    "});",
    "",
    "const initialState: AppState = { items: [] };",
    "",
    "// 날짜는 이 기기의 시간대로 쓴다. UTC 글로 바꾸면 자정 무렵 하루 어긋나므로 그렇게 쓰지 않는다",
    'const pad = (n: number): string => String(n).padStart(2, "0");',
    "const today = (): string => {",
    "  const d = new Date();",
    '  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());',
    "};",
    "",
    'const ITEMS_KEY = "items";',
    "",
    "const addParams = Type.Object(",
    `  { title: Type.String({ minLength: 1, maxLength: ${TITLE_MAX} }) },`,
    "  { additionalProperties: false },",
    ");",
    "",
    "type AppApi = OrchestrationApi<AppState>;",
    "",
    "type ItemsOutcome =",
    "  | { readonly ok: true; readonly items: readonly AppItem[] }",
    "  | { readonly ok: false; readonly reason: string };",
    "",
    "/** 대화 없이 쓰는 목록을 플러그인 저장소에서 읽는다. 저장된 값이 목록 모양이 아니면 저장 데이터가 깨진 것이다 */",
    "async function readStored(g: AppApi): Promise<ItemsOutcome> {",
    "  const stored = await g.pluginStore.get(ITEMS_KEY);",
    "  if (!stored.ok) return { ok: false, reason: stored.error.kind };",
    "  if (stored.value === null) return { ok: true, items: initialState.items };",
    "  const checked = parse(stateSchema, stored.value);",
    '  return checked.ok ? { ok: true, items: checked.value.items } : { ok: false, reason: "storage_unavailable" };',
    "}",
    "",
    "/** 목록을 읽는다. 대화가 열려 있으면 상태 문서, 아니면 플러그인 저장소다 */",
    "async function readItems(g: AppApi, open: boolean): Promise<ItemsOutcome> {",
    "  return open ? { ok: true, items: g.state().items } : readStored(g);",
    "}",
    "",
    "/** 저장소 쪽의 읽고-고쳐-쓰기를 한 줄로 세운다. 줄이 없으면 같은 목록을 읽은 두 추가가 서로를 덮는다 */",
    "let storeLine: Promise<unknown> = Promise.resolve();",
    "function inStoreLine<T>(work: () => Promise<T>): Promise<T> {",
    "  const run = storeLine.then(work);",
    "  storeLine = run.then(() => undefined);",
    "  return run;",
    "}",
    "",
    "/** 항목 하나를 더한다. 대화가 열려 있으면 상태 문서에, 없으면 플러그인 저장소에 쓴다. 메서드 add와 모델 도구가 이 함수 하나를 쓴다 */",
    "async function addItem(g: AppApi, open: boolean, title: string): Promise<ItemsOutcome> {",
    "  const made: AppItem = { title, created: today() };",
    "  if (open) {",
    "    const committed = await g.commit({ items: [...g.state().items, made] });",
    "    return { ok: true, items: committed.items };",
    "  }",
    "  return inStoreLine<ItemsOutcome>(async () => {",
    "    const current = await readStored(g);",
    "    if (!current.ok) return current;",
    `    if (current.items.length >= ${ITEM_MAX}) return { ok: false, reason: "full" };`,
    "    const next = [...current.items, made];",
    "    const put = await g.pluginStore.put(ITEMS_KEY, { items: next });",
    "    return put.ok ? { ok: true, items: next } : { ok: false, reason: put.error.kind };",
    "  });",
    "}",
    "",
    "const app: PluginModule = definePlugin<AppState>({",
    "  manifest: pluginManifest(manifestJson),",
    "  state: { schema: stateSchema, initial: initialState, version: 1 },",
    "  setup(g) {",
    '    g.registerMethod("list", {',
    "      handler: (_params, ctx) => {",
    "        // 대화가 없거나 열려 있지 않으면 상태 문서가 없으므로 플러그인 저장소에서 읽는다",
    "        const open = ctx.threadId !== null && ctx.threadOpen !== false;",
    "        return readItems(g, open);",
    "      },",
    "    });",
    '    g.registerMethod("add", {',
    "      handler: async (params, ctx) => {",
    "        const checked = parse(addParams, params);",
    '        if (!checked.ok) return { ok: false, reason: "invalid_params" };',
    "        const open = ctx.threadId !== null && ctx.threadOpen !== false;",
    "        return addItem(g, open, checked.value.title);",
    "      },",
    "    });",
    "    g.registerTool({",
    `      name: ${tool},`,
    '      description: "앱 목록에 항목 하나를 더한다. 화면의 add 메서드와 같은 함수를 쓴다",',
    "      parameters: addParams,",
    '      replay: "unsafe",',
    "      // risk를 생략한다. 외부 확장이 read나 write를 선언하면 등록이 거부되고, 생략하면 exec가 기본이다",
    "      execute: async (args, ctx) => {",
    "        const checked = parse(addParams, args);",
    '        if (!checked.ok) return { ok: false, reason: "invalid_input" };',
    "        return addItem(g, ctx.threadId !== null, checked.value.title);",
    "      },",
    "    });",
    "  },",
    "});",
    "",
    'export const extension: PluginModule["entry"] = app.entry;',
    "",
  ].join("\n");
}

const INDEX_HTML = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="color-scheme" content="light dark">
  <link rel="stylesheet" href="theme.css">
  <title>앱</title>
</head>
<body>
  <main class="app">
    <h1 class="app-title">앱</h1>
    <div class="app-form">
      <input class="app-input" id="title-input" maxlength="200" aria-label="항목 이름">
      <button class="app-button" id="add-button" type="button">추가</button>
    </div>
    <ul class="app-list" id="items"></ul>
    <p class="app-status" id="status" role="status"></p>
  </main>
  <script src="bridge.js"></script>
  <script src="app.js"></script>
</body>
</html>
`;

// 셸은 인라인 스크립트를 막으므로(CSP script-src) 화면 코드는 모두 파일로 둔다.
const BRIDGE_JS = `// Plugin App 다리. 셸과 준비 신호를 맞추고, 요청에 id를 붙여 응답을 받고, 셸이 보내는 푸시를 나눠 준다.
// 앱 코드는 query, call, navigate와 invalidate 받기만 쓴다. 판정은 셸과 엔진이 한다(ADR-0021 §3.4).
(function () {
  const BRIDGE_RANGE = "^1.0.0";
  const nonce = new URLSearchParams(location.hash.slice(1)).get("n");
  const pending = new Map();
  const invalidateListeners = [];
  let port = null;
  let nextId = 1;
  let markConnected;
  const connected = new Promise((resolve) => {
    markConnected = resolve;
  });

  function applyTheme(theme) {
    const root = document.documentElement;
    root.style.colorScheme = theme.scheme;
    for (const [name, value] of Object.entries(theme.tokens)) root.style.setProperty(name, value);
  }

  function onMessage(message) {
    const data = message.data;
    if (data === null || typeof data !== "object") return;
    if (data.push === "theme") applyTheme(data.value);
    else if (data.push === "invalidate") invalidateListeners.forEach((listener) => listener());
    // 생존 확인에는 답만 하면 된다. 응답을 기다리지 않으므로 요청 id 장부에 넣지 않는다
    else if (data.push === "ping") port.postMessage({ v: 1, id: nextId++, op: "pong", args: { n: data.value.n } });
    else if (data.id !== undefined && pending.has(data.id)) {
      const waiter = pending.get(data.id);
      pending.delete(data.id);
      if (data.ok) waiter.resolve(data.value);
      else waiter.reject(data.error);
    }
  }

  function request(op, args) {
    return connected.then(
      () =>
        new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { resolve, reject });
          port.postMessage({ v: 1, id, op, args });
        }),
    );
  }

  window.addEventListener("message", (event) => {
    if (port !== null || event.ports.length === 0) return;
    port = event.ports[0];
    port.onmessage = onMessage;
    markConnected();
  });

  const ready = { v: 1, ready: true, bridge: BRIDGE_RANGE };
  if (nonce !== null) ready.nonce = nonce;
  window.parent.postMessage(ready, "*");

  window.FresnelBridge = {
    /** 자기 읽기 메서드를 부른다. 값은 메서드의 결과다 */
    query: (verb, params) => request("query", params === undefined ? { verb } : { verb, params }),
    /** 자기 쓰기 메서드를 부른다. 셸은 누를 때마다 확인 줄을 띄운다 */
    call: (verb, params) => request("call", params === undefined ? { verb } : { verb, params }),
    /** 앱 안의 다른 화면, 대화, 외부 링크를 연다. 목표 모양은 contracts 다리 navigate 인자다 */
    navigate: (target) => request("navigate", { target }),
    /** 엔진 상태가 바뀌면 셸이 invalidate를 보낸다. 그때 이 함수가 불린다 */
    onInvalidate: (listener) => {
      invalidateListeners.push(listener);
    },
  };
})();
`;

const APP_JS = `// 앱 화면 한 장. 목록을 읽어 그리고, 입력을 받아 add 메서드를 부른다. 상태는 엔진에 있고 화면은 그때마다 읽는다.
(function () {
  const list = document.getElementById("items");
  const addButton = document.getElementById("add-button");
  const input = document.getElementById("title-input");
  const status = document.getElementById("status");

  function reasonOf(error) {
    return (error && error.kind) || "failed";
  }

  function render(items) {
    list.replaceChildren(
      ...items.map((entry) => {
        const item = document.createElement("li");
        const title = document.createElement("span");
        title.textContent = entry.title;
        const made = document.createElement("time");
        made.className = "app-created";
        made.textContent = entry.created;
        item.append(title, made);
        return item;
      }),
    );
  }

  async function refresh() {
    try {
      const result = await FresnelBridge.query("list");
      render(result.items);
      status.textContent = "";
    } catch (error) {
      status.textContent = "목록을 읽지 못했어요(" + reasonOf(error) + ")";
    }
  }

  // 프레임 sandbox에는 allow-forms가 없어 form 제출은 submit 이벤트도 없이 막힌다. form 대신 단추 클릭과 Enter 키로 받는다
  async function addItem() {
    const title = input.value.trim();
    if (title === "") return;
    try {
      const result = await FresnelBridge.call("add", { title });
      input.value = "";
      render(result.items);
      status.textContent = "";
    } catch (error) {
      status.textContent = "추가하지 못했어요(" + reasonOf(error) + ")";
    }
  }
  addButton.addEventListener("click", addItem);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      addItem();
    }
  });

  FresnelBridge.onInvalidate(refresh);
  refresh();
})();
`;

const THEME_CSS = `/* 앱 화면의 모양. 색은 셸이 푸시하는 토큰(--bg, --fg, --dim, --panel, --border, --accent)만 쓴다.
   간격은 아래 --space 토큰만 쓰고, 화면 규칙에 길이 값을 직접 적지 않는다. */
:root {
  color-scheme: light dark;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --radius: 6px;
  --stroke: 1px;
  --font-size: 13px;
  --font-size-title: 15px;
  --line: 1.5;
}
body {
  margin: 0;
  padding: var(--space-4);
  background: var(--bg, canvas);
  color: var(--fg, canvastext);
  font: var(--font-size) / var(--line) system-ui, sans-serif;
}
.app { display: grid; gap: var(--space-3); }
.app-title { margin: 0; font-size: var(--font-size-title); font-weight: 600; }
.app-form { display: flex; gap: var(--space-2); }
.app-input {
  flex: 1;
  min-width: 0;
  padding: var(--space-1) var(--space-2);
  border: var(--stroke) solid var(--border, currentColor);
  border-radius: var(--radius);
  background: var(--panel, transparent);
  color: inherit;
  font: inherit;
}
.app-button {
  padding: var(--space-1) var(--space-3);
  border: var(--stroke) solid var(--accent, currentColor);
  border-radius: var(--radius);
  background: var(--accent, transparent);
  color: var(--bg, canvas);
  font: inherit;
  cursor: pointer;
}
.app-list { margin: 0; padding: 0; list-style: none; display: grid; gap: var(--space-1); }
.app-list li {
  padding: var(--space-2);
  border: var(--stroke) solid var(--border, currentColor);
  border-radius: var(--radius);
  background: var(--panel, transparent);
}
.app-created { margin-left: var(--space-2); color: var(--dim, inherit); }
.app-status { margin: 0; color: var(--dim, inherit); }
`;

/**
 * 앱 뼈대의 파일 목록과 내용. 순서는 경로 순이다. `.fresnel-plugin/plugin.json`은 scaffold가 구성 초안 패치를 덧붙인다.
 * 구성원(`members`)은 이 뼈대가 받지 않는다(scaffold가 거절한다)
 */
export function appSkeletonFiles(values: AppSkeletonValues): readonly SkeletonFile[] {
  return [
    { path: ".fresnel-plugin/plugin.json", text: manifestText(values) },
    { path: "src/index.ts", text: entryText(values) },
    { path: "ui/app/app.js", text: APP_JS },
    { path: "ui/app/bridge.js", text: BRIDGE_JS },
    { path: "ui/app/index.html", text: INDEX_HTML },
    { path: "ui/app/theme.css", text: THEME_CSS },
  ];
}
