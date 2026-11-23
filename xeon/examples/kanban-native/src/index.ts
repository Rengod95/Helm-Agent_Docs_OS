import { err, ok, parse, type Result } from "@fresnel/contracts";
import {
  definePlugin,
  pluginManifest,
  type OrchestrationApi,
  type PluginModule,
} from "@fresnel/orchestration-sdk";
import { Type, type Static } from "typebox";
import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" };

// 칸반 본보기의 native 판. `examples/kanban`과 같은 보드를 앱 코드 없이 Fresnel 기본 부품으로 그린다.
// 화면 트리(ui/native/*.view.json)의 `Board`가 끌어 옮긴 결과로 move({ id, column, index })를, 열 아래 "더하기"로
// add({ column, title })를 부르고, `SortableList`가 할 일 순서를 reorder({ id, index })로 바꾼다.
// 읽기 메서드 board 하나가 열, 카드, 할 일 목록을 같이 준다(데이터 문서의 `/board/...`).
// 모델 도구 kanban_native_move_card와 kanban_native_add_card는 메서드와 같은 함수(moveCard, addCard)를 쓴다.
// 기록은 항상 플러그인 전용 저장소(g.pluginStore, 키 `board`)에 둔다. 메서드와 도구가 어느 대화에서 불리든 같은 한 보드를 읽고 쓴다.
// 대화마다 따로 가져야 하는 기록은 상태 문서(g.state, g.commit)에 둘 수 있다.
// 세 쓰기 메서드는 이 플러그인의 기록만 바꾸므로 `ownDataOnly`이고, 화면에서 부를 때 확인 줄이 뜨지 않는다.

const COLUMNS = ["todo", "doing", "done"] as const;
type Column = (typeof COLUMNS)[number];

const COLUMN_TITLES: Readonly<Record<Column, string>> = {
  todo: "할 일",
  doing: "진행 중",
  done: "끝",
};

const CARD_MAX = 500;
const TITLE_MAX = 200;
const ID_MAX = 40;
const NOTE_MAX = 120;

// 플러그인 저장소에 그대로 쓰는 JSON 값이라 인터페이스와 readonly 배열 대신 객체 리터럴 타입과 가변 배열을 쓴다
type Card = {
  readonly id: string;
  readonly title: string;
  readonly column: Column;
  /** 열 안의 자리(0부터). 열마다 0부터 다시 매긴다 */
  readonly order: number;
  /** 카드 아래 보조 글 한 줄 */
  readonly detail?: string;
  /** 꼬리표 하나 */
  readonly tag?: string;
};

type BoardState = {
  readonly cards: Card[];
  /** 다음 카드 번호. 새 카드의 id는 `card-<번호>`다 */
  readonly seq: number;
};

const columnSchema = Type.Union([
  Type.Literal("todo"),
  Type.Literal("doing"),
  Type.Literal("done"),
]);

const stateSchema = Type.Object({
  cards: Type.Array(
    Type.Object({
      id: Type.String({ minLength: 1, maxLength: ID_MAX }),
      title: Type.String({ minLength: 1, maxLength: TITLE_MAX }),
      column: columnSchema,
      order: Type.Integer({ minimum: 0, maximum: CARD_MAX }),
      detail: Type.Optional(Type.String({ maxLength: NOTE_MAX })),
      tag: Type.Optional(Type.String({ maxLength: NOTE_MAX })),
    }),
    { maxItems: CARD_MAX },
  ),
  seq: Type.Integer({ minimum: 0 }),
});

/** 처음 보드. 본보기라서 카드 넷을 두고 시작한다 */
const initialState: BoardState = {
  cards: [
    { id: "card-1", title: "보드 부품 살펴보기", column: "todo", order: 0, tag: "본보기" },
    {
      id: "card-2",
      title: "열 사이로 카드를 끌어 옮기고, 키보드로도 옮겨 보기",
      column: "todo",
      order: 1,
      detail: "스페이스로 들고 화살표로 옮겨요",
    },
    { id: "card-3", title: "할 일 순서 정하기", column: "doing", order: 0, tag: "순서" },
    { id: "card-4", title: "매니페스트에 쓰기 메서드 선언", column: "done", order: 0 },
  ],
  seq: 4,
};

const moveParams = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: ID_MAX }),
    column: columnSchema,
    index: Type.Integer({ minimum: 0, maximum: CARD_MAX }),
  },
  { additionalProperties: false },
);
type MoveInput = Static<typeof moveParams>;

const addParams = Type.Object(
  { column: columnSchema, title: Type.String({ minLength: 1, maxLength: TITLE_MAX }) },
  { additionalProperties: false },
);

/** 모델 도구의 더하기. 열은 생략하면 할 일이고, 보조 글과 꼬리표를 같이 줄 수 있다 */
const addToolParams = Type.Object(
  {
    title: Type.String({ minLength: 1, maxLength: TITLE_MAX }),
    column: Type.Optional(columnSchema),
    detail: Type.Optional(Type.String({ minLength: 1, maxLength: NOTE_MAX })),
    tag: Type.Optional(Type.String({ minLength: 1, maxLength: NOTE_MAX })),
  },
  { additionalProperties: false },
);
type AddInput = Static<typeof addToolParams>;

const reorderParams = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: ID_MAX }),
    index: Type.Integer({ minimum: 0, maximum: CARD_MAX }),
  },
  { additionalProperties: false },
);

type BoardApi = OrchestrationApi<BoardState>;

type CardOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

function inColumn(cards: readonly Card[], name: Column): readonly Card[] {
  return cards.filter((card) => card.column === name).toSorted((a, b) => a.order - b.order);
}

/**
 * 카드를 열과 자리에 둔다. `index`는 카드를 뺀 뒤 그 열 안의 자리이고(보드 부품이 보내는 값과 같다),
 * 열의 카드 수보다 크면 맨 끝이다. 나머지 카드는 그대로 두고 열마다 순서를 0부터 다시 매긴다
 */
function placed(
  cards: readonly Card[],
  moving: Card,
  column: Column,
  index: number,
): readonly Card[] {
  const rest = cards.filter((card) => card.id !== moving.id);
  const target = inColumn(rest, column);
  const at = Math.min(index, target.length);
  const reordered = [...target.slice(0, at), { ...moving, column }, ...target.slice(at)];
  return COLUMNS.flatMap((name) =>
    (name === column ? reordered : inColumn(rest, name)).map((card, order) => ({ ...card, order })),
  );
}

const BOARD_KEY = "board";

/** 플러그인 저장소의 `board` 키를 읽는다. 값이 없으면 처음 보드, 저장된 값이 보드 모양이 아니면 저장 데이터가 깨진 것이다 */
async function readBoard(g: BoardApi): Promise<Result<BoardState, string>> {
  const stored = await g.pluginStore.get(BOARD_KEY);
  if (!stored.ok) return err(stored.error.kind);
  if (stored.value === null) return ok(initialState);
  const checked = parse(stateSchema, stored.value);
  return checked.ok ? ok(checked.value) : err("storage_unavailable");
}

/** 저장소 쪽의 읽고-고쳐-쓰기를 한 줄로 세운다. 줄이 없으면 같은 보드를 읽은 두 고침이 서로를 덮는다 */
let storeLine: Promise<unknown> = Promise.resolve();
function inStoreLine<T>(work: () => Promise<T>): Promise<T> {
  const run = storeLine.then(work);
  storeLine = run.then(() => undefined);
  return run;
}

/** 보드를 읽어 고친 값을 쓴다. 고칠 수 없으면 이유를 돌려준다 */
function editBoard(
  g: BoardApi,
  edit: (current: BoardState) => Result<BoardState, string>,
): Promise<CardOutcome> {
  return inStoreLine(async () => {
    const current = await readBoard(g);
    if (!current.ok) return { ok: false, reason: current.error };
    const next = edit(current.value);
    if (!next.ok) return { ok: false, reason: next.error };
    const put = await g.pluginStore.put(BOARD_KEY, next.value);
    return put.ok ? { ok: true } : { ok: false, reason: put.error.kind };
  });
}

/** 카드 하나를 옮긴다. 메서드 move, reorder와 모델 도구 kanban_native_move_card가 이 함수 하나를 쓴다 */
function moveCard(g: BoardApi, input: MoveInput): Promise<CardOutcome> {
  return editBoard(g, (current) => {
    const moving = current.cards.find((card) => card.id === input.id);
    if (moving === undefined) return err("not_found");
    return ok({
      cards: [...placed(current.cards, moving, input.column, input.index)],
      seq: current.seq,
    });
  });
}

/** 열 맨 끝에 카드를 더한다. 메서드 add와 모델 도구 kanban_native_add_card가 이 함수 하나를 쓴다 */
function addCard(g: BoardApi, input: AddInput): Promise<CardOutcome> {
  return editBoard(g, (current) => {
    if (current.cards.length >= CARD_MAX) return err("full");
    const column = input.column ?? "todo";
    const card: Card = {
      id: `card-${String(current.seq + 1)}`,
      title: input.title,
      column,
      order: 0,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      ...(input.tag === undefined ? {} : { tag: input.tag }),
    };
    return ok({
      cards: [...placed(current.cards, card, column, CARD_MAX)],
      seq: current.seq + 1,
    });
  });
}

const board: PluginModule = definePlugin<BoardState>({
  manifest: pluginManifest(manifestJson),
  state: { schema: stateSchema, initial: initialState, version: 1 },
  setup(g) {
    g.registerMethod("board", {
      handler: async () => {
        const read = await readBoard(g);
        if (!read.ok) return { ok: false, reason: read.error };
        const cards = read.value.cards;
        return {
          ok: true,
          columns: COLUMNS.map((id) => ({ id, title: COLUMN_TITLES[id] })),
          cards,
          todo: inColumn(cards, "todo"),
        };
      },
    });
    g.registerMethod("move", {
      handler: async (params) => {
        const checked = parse(moveParams, params);
        if (!checked.ok) return { ok: false, reason: "invalid_params" };
        return moveCard(g, checked.value);
      },
    });
    g.registerMethod("add", {
      handler: async (params) => {
        const checked = parse(addParams, params);
        if (!checked.ok) return { ok: false, reason: "invalid_params" };
        return addCard(g, checked.value);
      },
    });
    g.registerMethod("reorder", {
      handler: async (params) => {
        const checked = parse(reorderParams, params);
        if (!checked.ok) return { ok: false, reason: "invalid_params" };
        // 순서 목록은 할 일 열만 보여 준다. 자리는 그 열 안의 자리다
        return moveCard(g, { id: checked.value.id, column: "todo", index: checked.value.index });
      },
    });
    g.registerTool({
      name: "kanban_native_move_card",
      description: "보드의 카드 하나를 열과 자리로 옮긴다.",
      parameters: moveParams,
      replay: "unsafe",
      execute: async (args) => {
        const checked = parse(moveParams, args);
        if (!checked.ok) return { ok: false, reason: "invalid_input" };
        return moveCard(g, checked.value);
      },
    });
    g.registerTool({
      name: "kanban_native_add_card",
      description: "열 맨 끝에 카드 하나를 더한다(열을 안 주면 할 일).",
      parameters: addToolParams,
      replay: "unsafe",
      execute: async (args) => {
        const checked = parse(addToolParams, args);
        if (!checked.ok) return { ok: false, reason: "invalid_input" };
        return addCard(g, checked.value);
      },
    });
  },
});

export const extension: PluginModule["entry"] = board.entry;
