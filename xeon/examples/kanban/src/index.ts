import { parse } from "@fresnel/contracts";
import {
  definePlugin,
  pluginManifest,
  type OrchestrationApi,
  type PluginModule,
} from "@fresnel/orchestration-sdk";
import { Type, type Static } from "typebox";
import manifestJson from "../.fresnel-plugin/plugin.json" with { type: "json" };

// 칸반 본보기. 상태 하나(카드 목록과 새 카드 번호), 읽기 메서드 board, 쓰기 메서드 move와 add,
// 같은 함수를 쓰는 모델 도구 kanban_move_card와 kanban_add_card. 화면(ui/app)은 메서드를 부르고 모델은 도구를 부른다.
// 둘 다 moveCard와 addCard 하나로 상태를 고치므로 같은 보드를 본다.

const COLUMNS = ["todo", "doing", "done"] as const;
type Column = (typeof COLUMNS)[number];

const CARD_MAX = 500;
const TITLE_MAX = 200;
const ID_MAX = 40;

interface Card {
  readonly id: string;
  readonly title: string;
  readonly column: Column;
  /** 칸 안의 자리(0부터). 칸마다 0부터 다시 매긴다 */
  readonly order: number;
}

interface BoardState {
  readonly cards: readonly Card[];
  /** 다음 카드 번호. 새 카드의 id는 `card-<번호>`다 */
  readonly seq: number;
}

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
    }),
    { maxItems: CARD_MAX },
  ),
  seq: Type.Integer({ minimum: 0 }),
});

const initialState: BoardState = { cards: [], seq: 0 };

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
  { title: Type.String({ minLength: 1, maxLength: TITLE_MAX }) },
  { additionalProperties: false },
);
type AddInput = Static<typeof addParams>;

type BoardApi = OrchestrationApi<BoardState>;

type CardOutcome =
  | { readonly ok: true; readonly cards: readonly Card[] }
  | { readonly ok: false; readonly reason: string };

/**
 * 카드를 칸과 자리에 둔다. 나머지 카드는 그대로 두고, 칸마다 순서를 0부터 다시 매긴다.
 * `index`가 칸의 카드 수보다 크면 맨 끝에 둔다.
 */
function placed(
  cards: readonly Card[],
  moving: Card,
  column: Column,
  index: number,
): readonly Card[] {
  const rest = cards.filter((card) => card.id !== moving.id);
  const inColumn = (name: Column): readonly Card[] =>
    rest.filter((card) => card.column === name).toSorted((a, b) => a.order - b.order);
  const target = inColumn(column);
  const at = Math.min(index, target.length);
  const reordered = [...target.slice(0, at), { ...moving, column }, ...target.slice(at)];
  return COLUMNS.flatMap((name) =>
    (name === column ? reordered : inColumn(name)).map((card, order) => ({ ...card, order })),
  );
}

/** 카드 하나를 옮긴다. 메서드 move와 모델 도구 kanban_move_card가 이 함수 하나를 쓴다 */
async function moveCard(g: BoardApi, input: MoveInput): Promise<CardOutcome> {
  const current = g.state();
  const moving = current.cards.find((card) => card.id === input.id);
  if (moving === undefined) return { ok: false, reason: "not_found" };
  const next = placed(current.cards, moving, input.column, input.index);
  const committed = await g.commit({ cards: next, seq: current.seq });
  return { ok: true, cards: committed.cards };
}

/** 할 일 칸 맨 끝에 카드를 더한다. 메서드 add와 모델 도구 kanban_add_card가 이 함수 하나를 쓴다 */
async function addCard(g: BoardApi, input: AddInput): Promise<CardOutcome> {
  const current = g.state();
  if (current.cards.length >= CARD_MAX) return { ok: false, reason: "full" };
  const card: Card = {
    id: `card-${String(current.seq + 1)}`,
    title: input.title,
    column: "todo",
    order: 0,
  };
  const next = placed(current.cards, card, "todo", CARD_MAX);
  const committed = await g.commit({ cards: next, seq: current.seq + 1 });
  return { ok: true, cards: committed.cards };
}

const board: PluginModule = definePlugin<BoardState>({
  manifest: pluginManifest(manifestJson),
  state: { schema: stateSchema, initial: initialState, version: 1 },
  setup(g) {
    g.registerMethod("board", {
      handler: (_params, ctx) => {
        // 대화가 없거나 열려 있지 않으면 상태 문서가 없으므로 빈 보드를 준다
        const open = ctx.threadId !== null && ctx.threadOpen !== false;
        return Promise.resolve({ ok: true, cards: open ? g.state().cards : [] });
      },
    });
    g.registerMethod("move", {
      handler: async (params, ctx) => {
        if (ctx.threadId === null) return { ok: false, reason: "no_thread" };
        const checked = parse(moveParams, params);
        if (!checked.ok) return { ok: false, reason: "invalid_params" };
        return moveCard(g, checked.value);
      },
    });
    g.registerMethod("add", {
      handler: async (params, ctx) => {
        if (ctx.threadId === null) return { ok: false, reason: "no_thread" };
        const checked = parse(addParams, params);
        if (!checked.ok) return { ok: false, reason: "invalid_params" };
        return addCard(g, checked.value);
      },
    });
    g.registerTool({
      name: "kanban_move_card",
      description: "보드의 카드 하나를 칸과 자리로 옮긴다. 화면의 move 메서드와 같은 함수를 쓴다",
      parameters: moveParams,
      replay: "unsafe",
      execute: async (args, ctx) => {
        if (ctx.threadId === null) return { ok: false, reason: "no_thread" };
        const checked = parse(moveParams, args);
        if (!checked.ok) return { ok: false, reason: "invalid_input" };
        return moveCard(g, checked.value);
      },
    });
    g.registerTool({
      name: "kanban_add_card",
      description: "할 일 칸 맨 끝에 카드 하나를 더한다. 화면의 add 메서드와 같은 함수를 쓴다",
      parameters: addParams,
      replay: "unsafe",
      execute: async (args, ctx) => {
        if (ctx.threadId === null) return { ok: false, reason: "no_thread" };
        const checked = parse(addParams, args);
        if (!checked.ok) return { ok: false, reason: "invalid_input" };
        return addCard(g, checked.value);
      },
    });
  },
});

export const extension: PluginModule["entry"] = board.entry;
