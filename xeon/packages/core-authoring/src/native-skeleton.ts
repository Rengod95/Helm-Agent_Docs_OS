// 선언형 화면 플러그인 뼈대(`authoring_scaffold` mode `native`, ADR-0021 §3.5). 본문은 문자열과 JSON 값이고 이 모듈의 함수는 순수하다.
// 시험이 파일 목록과 내용을 값으로 비교하므로 파일을 읽거나 쓰지 않는다. 쓰기는 scaffold.ts가 한다.
//
// 뼈대의 짜임: 보통 플러그인 하나(`definePlugin`, 구성원과 `orchestration` 없음), 상태 하나(items), 읽기 메서드 list,
// 선언형 화면 하나(`ui/native/main.view.json`). 데이터 문서의 뿌리 키는 읽기 전용 메서드 동사와 `host`이므로
// list의 결과는 `/list/…` 경로로 읽는다. 화면에는 코드가 없어 플러그인 코드는 화면 안에서 돌지 않는다.

export interface NativeSkeletonValues {
  /** 플러그인 이름(확장 이름) */
  readonly id: string;
  /** 보이는 이름. 매니페스트 `displayName`과 화면 제목이다 */
  readonly title: string;
  readonly version: string;
}

interface SkeletonFile {
  /** 대상 폴더 기준 상대 경로 */
  readonly path: string;
  readonly text: string;
}

/** 화면 자리의 기본 id. 매니페스트 `ui.items[].id`이고 패턴 `^[a-z][a-z0-9-]{0,31}$`을 지킨다 */
const VIEW_ID = "main";
/** 화면 트리 파일. 매니페스트 `ui.items[].file`과 같은 값이다 */
const VIEW_FILE = "./ui/native/main.view.json";
/** 위젯 카탈로그 범위. 화면 파일이 있으면 매니페스트 `ui.widgets`가 필수다(widgets_required) */
const WIDGETS_RANGE = "^1.0.0";

/** 상태의 항목 목록 상한. 메서드 결과 스키마와 엔진 코드 스키마가 같은 값을 쓴다 */
const ITEM_MAX = 500;
const TITLE_MAX = 200;

const EMPTY_OBJECT = { type: "object", properties: {}, additionalProperties: false };

/** 읽기 메서드의 결과 모양. 성공이면 `ok`와 `items`, 실패면 `ok`와 `reason`이다 */
const RESULT_SHAPE = {
  type: "object",
  properties: {
    ok: { type: "boolean" },
    items: { type: "array", items: { type: "string" }, maxItems: ITEM_MAX },
    today: { type: "string" },
    reason: { type: "string" },
  },
  required: ["ok"],
};

function manifestText(values: NativeSkeletonValues): string {
  const manifest = {
    schemaVersion: 2,
    name: values.id,
    version: values.version,
    displayName: values.title,
    description: `${values.title} 화면 플러그인. 선언형 화면이 항목 목록을 보여 준다`,
    purpose: `${values.title}의 항목 목록을 화면에서 본다`,
    entry: "./src/index.ts",
    plugins: [{ layer: "L3", hooks: [] }],
    defaultEnabled: false,
    trust: { level: "user" },
    methods: [{ verb: "list", params: EMPTY_OBJECT, result: RESULT_SHAPE, readOnly: true }],
    ui: {
      schemaVersion: 1,
      widgets: WIDGETS_RANGE,
      items: [
        {
          id: VIEW_ID,
          placement: "page",
          mode: "native",
          title: values.title,
          file: VIEW_FILE,
        },
      ],
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** 엔진 코드. 상태 하나와 읽기 메서드 list만 있다. 항목을 더하는 쓰기 메서드와 모델 도구는 뼈대에 없다 */
function entryText(): string {
  return [
    "import {",
    "  definePlugin,",
    "  pluginManifest,",
    "  type PluginModule,",
    '} from "@fresnel/orchestration-sdk";',
    'import { Type } from "typebox";',
    'import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" };',
    "",
    "// 선언형 화면 플러그인 골격. 상태 하나(items)와 읽기 메서드 list를 둔다.",
    "// 화면(ui/native/main.view.json)은 코드가 없는 트리라서 list의 결과를 `/list/items`로 읽어 목록으로 그린다.",
    "// 항목을 더하는 쓰기 메서드와 모델 도구는 뼈대에 없다. 더할 때는 메서드를 registerMethod로 등록하고 manifest methods에 선언한다.",
    "// 보드(열과 카드)와 끌어 순서를 바꾸는 목록도 native로 된다: 트리의 Board, SortableList가 move에 적은 쓰기 메서드를 부른다(examples/kanban-native).",
    "",
    "interface NativeState {",
    "  readonly items: readonly string[];",
    "}",
    "",
    "const stateSchema = Type.Object({",
    `  items: Type.Array(Type.String({ maxLength: ${TITLE_MAX} }), { maxItems: ${ITEM_MAX} }),`,
    "});",
    "",
    "const initialState: NativeState = { items: [] };",
    "",
    "// 날짜는 이 기기의 시간대로 쓴다. UTC 글로 바꾸면 자정 무렵 하루 어긋나므로 그렇게 쓰지 않는다",
    'const pad = (n: number): string => String(n).padStart(2, "0");',
    "const today = (): string => {",
    "  const d = new Date();",
    '  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());',
    "};",
    "",
    "const plugin: PluginModule = definePlugin<NativeState>({",
    "  manifest: pluginManifest(manifestJson),",
    "  state: { schema: stateSchema, initial: initialState, version: 1 },",
    "  setup(g) {",
    '    g.registerMethod("list", {',
    "      handler: (_params, ctx) => {",
    "        // 대화가 없거나 열려 있지 않으면 상태 문서가 없으므로 빈 목록을 준다. 날짜는 화면 트리의 글이 바인드를 받지 않아 결과로만 준다",
    "        const open = ctx.threadId !== null && ctx.threadOpen !== false;",
    "        return Promise.resolve({",
    "          ok: true,",
    "          items: open ? g.state().items : initialState.items,",
    "          today: today(),",
    "        });",
    "      },",
    "    });",
    "  },",
    "});",
    "",
    'export const extension: PluginModule["entry"] = plugin.entry;',
    "",
  ].join("\n");
}

/** 화면 트리. 제목 글과, 데이터 문서의 `list` 뿌리 아래 `items` 배열을 `List`에 bind한 목록 하나다 */
function viewText(values: NativeSkeletonValues): string {
  const tree = {
    type: "Stack",
    props: { gap: "md" },
    children: [
      { type: "Heading", props: { text: values.title, level: 2 } },
      { type: "List", bind: { items: { path: "/list/items" } } },
    ],
  };
  return `${JSON.stringify(tree, null, 2)}\n`;
}

/**
 * 선언형 화면 뼈대의 파일 목록과 내용. 순서는 경로 순이다. `.fresnel-plugin/plugin.json`은 scaffold가 목적과 설명을 다시 적는다.
 * 구성원(`members`)은 이 뼈대가 받지 않는다(scaffold가 거절한다)
 */
export function nativeSkeletonFiles(values: NativeSkeletonValues): readonly SkeletonFile[] {
  return [
    { path: ".fresnel-plugin/plugin.json", text: manifestText(values) },
    { path: "src/index.ts", text: entryText() },
    { path: "ui/native/main.view.json", text: viewText(values) },
  ];
}
