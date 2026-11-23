import { err, ok, parse, type Result } from "@fresnel/contracts";
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
// 기록은 항상 플러그인 전용 저장소(g.pluginStore, 키 `board`)에 둔다. 화면 메서드와 모델 도구가 어느 대화에서 불리든 같은 한 보드를 읽고 쓴다.
// 대화마다 따로 가져야 하는 기록은 상태 문서(g.state, g.commit)에 둘 수 있다.
// 옮기기와 더하기 계산은 moveCard와 addCard 하나씩이고, 저장소를 BoardSource로 받아 계산만 한 벌로 쓴다.

const COLUMNS = ["todo", "doing", "done"] as const;
type Column = (typeof COLUMNS)[number];

const CARD_MAX = 500;
const TITLE_MAX = 200;
const ID_MAX = 40;
const BOARD_KEY = "board";

type Card = {
  readonly id: string;
  readonly title: string;
  readonly column: Column;
  /** 칸 안의 자리(0부터). 칸마다 0부터 다시 매긴다 */
  readonly order: number;
};

/**
 * 상태의 모양. 플러그인 저장소에 그대로 쓰므로 JSON 값으로 받아야 한다. 인터페이스는 색인 시그니처를 암묵으로 받지 못하고
 * readonly 배열은 JSON 배열에 닿지 않아서 객체 리터럴 타입과 가변 배열을 쓴다.
 */
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
 * 보드 상태의 출처. 실패는 값으로 돌려주고, 실패의 `error`는 이유 종류다(저장소 오류 종류 또는 `storage_unavailable`).
 */
interface BoardSource {
  read(): Promise<Result<BoardState, string>>;
  write(next: BoardState): Promise<Result<BoardState, string>>;
}

/**
 * 플러그인 저장소의 `board` 키를 읽고 쓴다. 저장된 값이 보드 모양이 아니면 저장 데이터가 깨진 것이다.
 */
function storeBoard(g: BoardApi): BoardSource {
  return {
    read: async () => {
      const stored = await g.pluginStore.get(BOARD_KEY);
      if (!stored.ok) return err(stored.error.kind);
      if (stored.value === null) return ok(initialState);
      const checked = parse(stateSchema, stored.value);
      return checked.ok ? ok(checked.value) : err("storage_unavailable");
    },
    write: async (next) => {
      const put = await g.pluginStore.put(BOARD_KEY, next);
      return put.ok ? ok(next) : err(put.error.kind);
    },
  };
}

/**
 * 저장소 쪽의 읽고-고쳐-쓰기를 한 줄로 세운다. 저장소는 쓰기만 직렬화하므로(한도 검사 때문) 두 더하기가 같은 보드를 읽으면
 * 같은 카드 번호를 쓰고 한쪽 카드가 사라진다. 대화 쪽은 g.commit이 맡는다.
 */
let storeLine: Promise<unknown> = Promise.resolve();
function inStoreLine<T>(work: () => Promise<T>): Promise<T> {
  const run = storeLine.then(work);
  storeLine = run.then(() => undefined);
  return run;
}

/**
 * 카드를 칸과 자리에 둔다. 나머지 카드는 그대로 두고, 칸마다 순서를 0부터 다시 매긴다.
 * `index`가 칸의 카드 수보다 크면 맨 끝에 둔다.
 */
function placed(cards: readonly Card[], moving: Card, column: Column, index: number): Card[] {
  const rest = cards.filter((card) => card.id !== moving.id);
  const inColumn = (name: Column): Card[] =>
    rest.filter((card) => card.column === name).toSorted((a, b) => a.order - b.order);
  const target = inColumn(column);
  const at = Math.min(index, target.length);
  const reordered = [...target.slice(0, at), { ...moving, column }, ...target.slice(at)];
  return COLUMNS.flatMap((name) =>
    (name === column ? reordered : inColumn(name)).map((card, order) => ({ ...card, order })),
  );
}

/** 카드 하나를 옮긴다. 메서드 move와 모델 도구 kanban_move_card가 이 함수 하나를 쓴다 */
async function moveCard(board: BoardSource, input: MoveInput): Promise<CardOutcome> {
  const current = await board.read();
  if (!current.ok) return { ok: false, reason: current.error };
  const moving = current.value.cards.find((card) => card.id === input.id);
  if (moving === undefined) return { ok: false, reason: "not_found" };
  const next = placed(current.value.cards, moving, input.column, input.index);
  const written = await board.write({ cards: next, seq: current.value.seq });
  if (!written.ok) return { ok: false, reason: written.error };
  return { ok: true, cards: written.value.cards };
}

/** 할 일 칸 맨 끝에 카드를 더한다. 메서드 add와 모델 도구 kanban_add_card가 이 함수 하나를 쓴다 */
async function addCard(board: BoardSource, input: AddInput): Promise<CardOutcome> {
  const current = await board.read();
  if (!current.ok) return { ok: false, reason: current.error };
  if (current.value.cards.length >= CARD_MAX) return { ok: false, reason: "full" };
  const card: Card = {
    id: `card-${String(current.value.seq + 1)}`,
    title: input.title,
    column: "todo",
    order: 0,
  };
  const next = placed(current.value.cards, card, "todo", CARD_MAX);
  const written = await board.write({ cards: next, seq: current.value.seq + 1 });
  if (!written.ok) return { ok: false, reason: written.error };
  return { ok: true, cards: written.value.cards };
}

/** 고침 하나를 저장소 줄 위에서 돌린다 */
function editBoard(
  g: BoardApi,
  edit: (board: BoardSource) => Promise<CardOutcome>,
): Promise<CardOutcome> {
  return inStoreLine(() => edit(storeBoard(g)));
}

const board: PluginModule = definePlugin<BoardState>({
  manifest: pluginManifest(manifestJson),
  state: { schema: stateSchema, initial: initialState, version: 1 },
  setup(g) {
    g.registerMethod("board", {
      handler: async () => {
        const read = await storeBoard(g).read();
        return read.ok ? { ok: true, cards: read.value.cards } : { ok: false, reason: read.error };
      },
    });
    g.registerMethod("move", {
      handler: async (params) => {
        const checked = parse(moveParams, params);
        if (!checked.ok) return { ok: false, reason: "invalid_params" };
        return editBoard(g, (source) => moveCard(source, checked.value));
      },
    });
    g.registerMethod("add", {
      handler: async (params) => {
        const checked = parse(addParams, params);
        if (!checked.ok) return { ok: false, reason: "invalid_params" };
        return editBoard(g, (source) => addCard(source, checked.value));
      },
    });
    g.registerTool({
      name: "kanban_move_card",
      description: "보드의 카드 하나를 칸과 자리로 옮긴다.",
      parameters: moveParams,
      replay: "unsafe",
      execute: async (args) => {
        const checked = parse(moveParams, args);
        if (!checked.ok) return { ok: false, reason: "invalid_input" };
        return editBoard(g, (source) => moveCard(source, checked.value));
      },
    });
    g.registerTool({
      name: "kanban_add_card",
      description: "할 일 칸 맨 끝에 카드 하나를 더한다.",
      parameters: addParams,
      replay: "unsafe",
      execute: async (args) => {
        const checked = parse(addParams, args);
        if (!checked.ok) return { ok: false, reason: "invalid_input" };
        return editBoard(g, (source) => addCard(source, checked.value));
      },
    });
  },
});

export const extension: PluginModule["entry"] = board.entry;
