import { Button, Chip, Input, List, ListRow, type ListReorderAnnouncement } from "@caustic/react";
import { Plus } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import {
  boardLayoutOf,
  moveCard,
  moveItem,
  placeOf,
  samePlace,
  sortableItemsOf,
  stepPlace,
  type BoardCard,
  type BoardColumn,
  type BoardLayout,
  type BoardPlace,
  type BoardStep,
  type BoardTone,
  type ResolvedNode,
  type SortableItem,
} from "@fresnel/client/views/native";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  basisOf,
  commitDraft,
  shownOf,
  type Draft,
  type DraftUpdate,
} from "./native-board-model.ts";

/** 쓰기 메서드 하나를 부른다. 통과하고 확장이 `{ ok: false }`로 답하지 않으면 참이다. 던지지 않는다(`NativeTreeActions.callMethod`) */
export type CallMethod = (
  verb: string,
  params: Readonly<Record<string, unknown>>,
) => Promise<boolean>;

// 선언형 보드(`Board`)와 순서 목록(`SortableList`)을 caustic 부품과 토큰으로 그린다(ADR-0021 §3.4.1, AGE-78 질문 7).
// - 카드는 끌어서(포인터) 또는 키보드로(스페이스로 들고, 화살표로 옮기고, 스페이스로 놓기, Esc 취소) 옮긴다.
// - 놓는 즉시 화면이 바뀌고(초안), 쓰기 메서드가 실패하면 되돌리고 보드 아래 한 줄로 알린다(`native-board-model.ts`).
// - 메서드는 `callMethod`(`NativeTreeActions.callMethod`)로만 부른다. 확인 줄과 `ownDataOnly` 규칙은 실행기가 정한다(`native-run.ts`).
// - 플러그인이 준 글은 글자로만 들어간다. 색과 간격은 caustic 토큰 클래스뿐이고, 끄는 카드의 자리(포인터 좌표)만 인라인 값이다.
// - 순서 목록은 caustic `List`의 reorderable(포인터와 키보드)을 그대로 쓴다.

/** 끌기로 보기 전에 포인터가 움직여야 하는 거리(px). 누르기와 끌기를 가른다 */
const DRAG_START_DISTANCE = 4;
/** 좁은 폭에서 가로로 넘치는 보드를 끄는 동안 가장자리 근처면 그쪽으로 넘긴다(px) */
const SCROLL_EDGE = 48;
const SCROLL_STEP = 24;

type CausticTone = "neutral" | "success" | "warning" | "danger";

function toneOf(tone: BoardTone | undefined): CausticTone {
  if (tone === "success" || tone === "warning" || tone === "danger") return tone;
  return "neutral";
}

function textProp(node: ResolvedNode, key: string): string | undefined {
  const value = Object.hasOwn(node.props, key) ? node.props[key] : undefined;
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** 키 이름을 키보드 이동 방향으로 */
function stepOf(key: string): BoardStep | undefined {
  if (key === "ArrowUp") return "up";
  if (key === "ArrowDown") return "down";
  if (key === "ArrowLeft") return "left";
  if (key === "ArrowRight") return "right";
  return undefined;
}

function columnTitle(layout: BoardLayout, id: string): string {
  return layout.find((column) => column.id === id)?.title ?? id;
}

function cardTitle(layout: BoardLayout, id: string): string {
  return layout.flatMap((column) => column.cards).find((card) => card.id === id)?.title ?? id;
}

/** 포인터로 끄는 중. `active`가 거짓이면 아직 누르기만 했다 */
interface PointerDrag {
  readonly id: string;
  readonly from: BoardPlace;
  readonly pointerId: number;
  readonly startX: number;
  readonly startY: number;
  readonly x: number;
  readonly y: number;
  /** 누른 곳과 카드 왼쪽 위의 거리. 뜬 카드가 같은 자리를 잡고 따라온다 */
  readonly grabX: number;
  readonly grabY: number;
  readonly width: number;
  readonly active: boolean;
  readonly over: BoardPlace;
}

/** 키보드로 든 카드 */
interface Held {
  readonly id: string;
  readonly from: BoardPlace;
  readonly preview: BoardLayout;
}

export function BoardView(props: {
  readonly node: ResolvedNode;
  readonly callMethod: CallMethod;
}): ReactNode {
  const { node, callMethod } = props;
  const columns = node.lists?.["columns"];
  const cards = node.lists?.["cards"];
  const moveVerb = textProp(node, "move");
  const addVerb = textProp(node, "add");
  const basis = basisOf([columns ?? [], cards ?? []]);
  const server = useMemo(() => boardLayoutOf(columns ?? [], cards ?? []), [columns, cards]);
  const [draft, setDraft] = useState<Draft<BoardLayout> | undefined>(undefined);
  const [drag, setDrag] = useState<PointerDrag | undefined>(undefined);
  const [held, setHeld] = useState<Held | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [spoken, setSpoken] = useState("");
  const seq = useRef(0);
  const rootRef = useRef<HTMLElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const instructionsId = useId();

  const base = shownOf(server, basis, draft);
  const shown =
    held?.preview ??
    (drag?.active === true && !samePlace(drag.over, drag.from)
      ? moveCard(base, drag.id, drag.over)
      : base);

  const commit = (id: string, to: BoardPlace): void => {
    if (moveVerb === undefined) return;
    seq.current += 1;
    setNotice(undefined);
    setSpoken(
      t("desktop.plugin.board.dropped", {
        title: cardTitle(base, id),
        column: columnTitle(base, to.column),
        position: to.index + 1,
      }),
    );
    detach(
      commitDraft({
        draft: { basis, seq: seq.current, value: moveCard(base, id, to) },
        setDraft: (update: DraftUpdate<BoardLayout>) => {
          setDraft(update);
        },
        call: () => callMethod(moveVerb, { id, column: to.column, index: to.index }),
        onFailed: () => {
          setNotice(t("desktop.plugin.board.moveFailed"));
        },
      }),
      rethrow,
    );
  };

  // 키보드로 든 카드가 다른 열로 가면 그 자리의 새 요소에 초점을 다시 둔다
  useEffect(() => {
    if (held === undefined) return;
    const found = [...(rootRef.current?.querySelectorAll("[data-board-card]") ?? [])].find(
      (element) => element.getAttribute("data-board-card") === held.id,
    );
    if (found instanceof HTMLElement && document.activeElement !== found) found.focus();
  }, [held]);

  // 끄는 동안의 포인터는 창에서 듣는다. 카드가 다른 열로 가며 요소가 바뀌어도 끌기가 이어진다
  useEffect(() => {
    if (drag === undefined) return undefined;
    const onMove = (event: PointerEvent): void => {
      if (event.pointerId !== drag.pointerId) return;
      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      const active = drag.active || moved >= DRAG_START_DISTANCE;
      if (!active) return;
      scrollNearEdge(scrollerRef.current, event.clientX);
      const over = placeAt(rootRef.current, drag.id, event.clientX, event.clientY) ?? drag.over;
      setDrag({ ...drag, x: event.clientX, y: event.clientY, active, over });
    };
    const onUp = (event: PointerEvent): void => {
      if (event.pointerId !== drag.pointerId) return;
      setDrag(undefined);
      if (drag.active && !samePlace(drag.over, drag.from)) commit(drag.id, drag.over);
    };
    const onCancel = (event: PointerEvent): void => {
      if (event.pointerId === drag.pointerId) setDrag(undefined);
    };
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setDrag(undefined);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  });

  const startDrag = (event: ReactPointerEvent<HTMLElement>, id: string): void => {
    if (moveVerb === undefined || held !== undefined || event.button !== 0) return;
    const from = placeOf(base, id);
    if (from === undefined) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setDrag({
      id,
      from,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      width: rect.width,
      active: false,
      over: from,
    });
  };

  const onCardKey = (event: KeyboardEvent<HTMLElement>, id: string): void => {
    if (moveVerb === undefined) return;
    const pick = event.key === " " || event.key === "Enter";
    if (held === undefined) {
      if (!pick) return;
      event.preventDefault();
      const from = placeOf(base, id);
      if (from === undefined) return;
      setHeld({ id, from, preview: base });
      setSpoken(
        t("desktop.plugin.board.picked", {
          title: cardTitle(base, id),
          column: columnTitle(base, from.column),
          position: from.index + 1,
        }),
      );
      return;
    }
    if (held.id !== id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setHeld(undefined);
      setSpoken(t("desktop.plugin.board.cancelled"));
      return;
    }
    if (pick) {
      event.preventDefault();
      const to = placeOf(held.preview, id);
      setHeld(undefined);
      if (to !== undefined && !samePlace(to, held.from)) commit(id, to);
      else setSpoken(t("desktop.plugin.board.cancelled"));
      return;
    }
    const step = stepOf(event.key);
    if (step === undefined) return;
    event.preventDefault();
    const next = stepPlace(held.preview, id, step);
    if (next === undefined) return;
    setHeld({ ...held, preview: moveCard(held.preview, id, next) });
    setSpoken(
      t("desktop.plugin.board.moved", {
        column: columnTitle(held.preview, next.column),
        position: next.index + 1,
      }),
    );
  };

  const add = (column: string, title: string): void => {
    if (addVerb === undefined) return;
    setNotice(undefined);
    const run = async (): Promise<void> => {
      const ok = await callMethod(addVerb, { column, title });
      if (!ok) setNotice(t("desktop.plugin.board.addFailed"));
    };
    detach(run(), rethrow);
  };

  const lifted = drag?.active === true ? drag : undefined;
  const liftedCard =
    lifted === undefined
      ? undefined
      : base.flatMap((column) => column.cards).find((card) => card.id === lifted.id);

  return (
    <section
      ref={rootRef}
      aria-label={t("desktop.plugin.board.label")}
      className="grid min-w-0 gap-2"
      data-board=""
      data-dragging={lifted === undefined ? undefined : ""}
    >
      <div ref={scrollerRef} className="flex min-w-0 items-start gap-3 overflow-x-auto pb-2">
        {shown.map((column) => (
          <ColumnView
            key={column.id}
            column={column}
            movable={moveVerb !== undefined}
            canAdd={addVerb !== undefined}
            ghostId={lifted?.id ?? held?.id}
            heldId={held?.id}
            instructionsId={instructionsId}
            onPointerDown={startDrag}
            onKeyDown={onCardKey}
            onAdd={add}
          />
        ))}
      </div>
      {notice === undefined ? null : (
        <p role="status" className="m-0 text-ui-dense text-danger-text" data-board-notice="">
          {notice}
        </p>
      )}
      <p id={instructionsId} className="sr-only">
        {t("desktop.plugin.board.instructions")}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {spoken}
      </p>
      {lifted === undefined || liftedCard === undefined
        ? null
        : createPortal(
            <div
              aria-hidden
              className="pointer-events-none fixed z-100 cursor-grabbing"
              style={{
                left: lifted.x - lifted.grabX,
                top: lifted.y - lifted.grabY,
                width: lifted.width,
              }}
            >
              <CardFace card={liftedCard} lifted />
            </div>,
            document.body,
          )}
    </section>
  );
}

function ColumnView(props: {
  readonly column: BoardColumn;
  readonly movable: boolean;
  readonly canAdd: boolean;
  /** 지금 들려 있는 카드. 보드 안에서는 놓일 자리 표시로 그린다 */
  readonly ghostId: string | undefined;
  readonly heldId: string | undefined;
  readonly instructionsId: string;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>, id: string) => void;
  readonly onAdd: (column: string, title: string) => void;
}): ReactNode {
  const { column, movable, canAdd, ghostId, heldId, instructionsId } = props;
  const titleId = useId();
  const count = column.cards.length;
  return (
    <div
      className="flex w-72 shrink-0 flex-col gap-2 rounded-lg bg-bg-inset p-2"
      data-board-column={column.id}
    >
      {/* 머리의 글은 카드 안 글과 같은 왼쪽 선에 둔다(카드 테두리 1px만큼 투명 테두리를 같이 둔다) */}
      <div className="flex min-w-0 items-center justify-between gap-2 border-x border-transparent px-3 py-1">
        <h3 id={titleId} className="m-0 min-w-0 truncate text-ui-strong text-text-primary">
          {column.title}
        </h3>
        <span className="shrink-0 text-ui-dense text-text-tertiary tabular-nums" aria-hidden>
          {count}
        </span>
        <span className="sr-only">{t("desktop.plugin.board.count", { count })}</span>
      </div>
      <ul aria-labelledby={titleId} className="m-0 flex list-none flex-col gap-2 p-0">
        {column.cards.map((card) =>
          card.id === ghostId && heldId !== card.id ? (
            <li key={card.id} data-board-slot="">
              <CardFace card={card} slot />
            </li>
          ) : (
            <li key={card.id}>
              <div
                role={movable ? "button" : undefined}
                tabIndex={movable ? 0 : undefined}
                aria-describedby={movable ? instructionsId : undefined}
                aria-pressed={movable ? heldId === card.id : undefined}
                data-board-card={card.id}
                className={
                  movable
                    ? "block cursor-grab touch-none rounded-md outline-none select-none focus-visible:shadow-focus"
                    : "block rounded-md"
                }
                onPointerDown={(event) => {
                  props.onPointerDown(event, card.id);
                }}
                onKeyDown={(event) => {
                  props.onKeyDown(event, card.id);
                }}
              >
                <CardFace card={card} lifted={heldId === card.id} />
              </div>
            </li>
          ),
        )}
        {count === 0 ? (
          <li
            className="rounded-md border border-dashed border-border-subtle px-3 py-3 text-ui-dense text-text-tertiary"
            data-board-empty=""
          >
            {t("desktop.plugin.board.empty")}
          </li>
        ) : null}
      </ul>
      {canAdd ? (
        <AddCard
          onAdd={(title) => {
            props.onAdd(column.id, title);
          }}
        />
      ) : null}
    </div>
  );
}

/** 카드 겉모습. `slot`이면 놓일 자리(점선, 내용은 높이만 지킨다), `lifted`면 들린 카드(그림자와 강조 테두리) */
function CardFace(props: {
  readonly card: BoardCard;
  readonly lifted?: boolean;
  readonly slot?: boolean;
}): ReactNode {
  const { card, lifted = false, slot = false } = props;
  const frame = slot
    ? "border-dashed border-accent-border bg-accent-soft"
    : lifted
      ? "border-accent-border bg-surface-raised shadow-lift"
      : "border-border-subtle bg-surface-raised shadow-card";
  return (
    <div
      className={`grid min-w-0 gap-1 rounded-md border px-3 py-2 ${frame}`}
      data-board-face={slot ? "slot" : lifted ? "lifted" : "card"}
    >
      <span
        className={`truncate text-ui text-text-primary ${slot ? "invisible" : ""}`}
        title={card.title}
      >
        {card.title}
      </span>
      {card.detail === undefined ? null : (
        <span
          className={`truncate text-ui-dense text-text-tertiary ${slot ? "invisible" : ""}`}
          title={card.detail}
        >
          {card.detail}
        </span>
      )}
      {card.tag === undefined ? null : (
        <span className={`flex min-w-0 ${slot ? "invisible" : ""}`}>
          <Chip tone={toneOf(card.tone)} variant="soft" size="sm" className="max-w-full truncate">
            {card.tag}
          </Chip>
        </span>
      )}
    </div>
  );
}

/** 열 아래 "더하기". 누르면 제목 칸이 열리고 Enter로 보내며 Esc로 닫는다. 빈 제목은 보내지 않는다 */
function AddCard(props: { readonly onAdd: (title: string) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  if (!open) {
    return (
      <Button
        size="xs"
        variant="ghost"
        className="justify-start"
        onClick={() => {
          setOpen(true);
        }}
      >
        <Plus aria-hidden />
        {t("desktop.plugin.board.add")}
      </Button>
    );
  }
  const close = (): void => {
    setOpen(false);
    setTitle("");
  };
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const text = title.trim();
        if (text === "") return;
        props.onAdd(text);
        close();
      }}
    >
      <Input
        size="sm"
        // 입력 틀은 테두리 없이 그림자로 그려진다. 투명 테두리 1px로 글자를 카드 글자(테두리 1px + px-3)와 같은 x에 둔다
        containerClassName="border-x border-transparent"
        autoFocus
        aria-label={t("desktop.plugin.board.addField")}
        placeholder={t("desktop.plugin.board.addField")}
        value={title}
        onValueChange={setTitle}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
      />
      <div className="flex items-center gap-2">
        <Button type="submit" size="xs" variant="solid" disabled={title.trim() === ""}>
          {t("desktop.plugin.board.add")}
        </Button>
        <Button type="button" size="xs" variant="ghost" onClick={close}>
          {t("desktop.plugin.board.addCancel")}
        </Button>
      </div>
    </form>
  );
}

/** 포인터 아래의 놓일 자리. 열은 가로 위치로 고르고(열 사이면 가까운 열), 자리는 끄는 카드를 뺀 카드들의 가운데 선과 비교한다 */
function placeAt(
  root: HTMLElement | null,
  id: string,
  x: number,
  y: number,
): BoardPlace | undefined {
  if (root === null) return undefined;
  const columns = [...root.querySelectorAll("[data-board-column]")];
  let best: { readonly element: Element; readonly distance: number } | undefined;
  for (const element of columns) {
    const rect = element.getBoundingClientRect();
    const distance = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (best === undefined || distance < best.distance) best = { element, distance };
  }
  const column = best?.element.getAttribute("data-board-column");
  if (best === undefined || column === null || column === undefined) return undefined;
  const others = [...best.element.querySelectorAll("[data-board-card]")].filter(
    (element) => element.getAttribute("data-board-card") !== id,
  );
  const index = others.filter((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top + rect.height / 2 < y;
  }).length;
  return { column, index };
}

function scrollNearEdge(scroller: HTMLElement | null, x: number): void {
  if (scroller === null || scroller.scrollWidth <= scroller.clientWidth) return;
  const rect = scroller.getBoundingClientRect();
  if (x < rect.left + SCROLL_EDGE) scroller.scrollBy({ left: -SCROLL_STEP });
  else if (x > rect.right - SCROLL_EDGE) scroller.scrollBy({ left: SCROLL_STEP });
}

// ---------- 순서 목록 ----------

function sortableAnnounce(event: ListReorderAnnouncement): string {
  const values = { title: event.title, position: event.position, size: event.size };
  switch (event.type) {
    case "picked":
      return t("desktop.plugin.sortable.picked", values);
    case "moved":
      return t("desktop.plugin.sortable.moved", values);
    case "dropped":
      return t("desktop.plugin.sortable.dropped", values);
    case "cancelled":
      return t("desktop.plugin.sortable.cancelled");
    default:
      return assertNever(event.type, "sortableAnnounce");
  }
}

export function SortableListView(props: {
  readonly node: ResolvedNode;
  readonly callMethod: CallMethod;
}): ReactNode {
  const { node, callMethod } = props;
  const source = node.lists?.["items"];
  const moveVerb = textProp(node, "move");
  const basis = basisOf(source ?? []);
  const server = useMemo(() => sortableItemsOf(source ?? []), [source]);
  const [draft, setDraft] = useState<Draft<readonly SortableItem[]> | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const seq = useRef(0);
  const items = shownOf(server, basis, draft);
  const rows = items.map((item) => (
    <ListRow
      key={item.id}
      itemValue={item.id}
      title={item.title}
      {...(item.detail === undefined ? {} : { description: item.detail })}
    />
  ));
  return (
    <div className="grid min-w-0 gap-2" data-sortable="">
      {items.length === 0 ? (
        <p className="m-0 text-ui-dense text-text-tertiary">{t("desktop.plugin.sortable.empty")}</p>
      ) : moveVerb === undefined ? (
        <List aria-label={t("desktop.plugin.collection.label")}>{rows}</List>
      ) : (
        <List
          aria-label={t("desktop.plugin.collection.label")}
          reorderable
          order={items.map((item) => item.id)}
          handleLabel={(title) => t("desktop.plugin.sortable.handle", { title })}
          instructions={t("desktop.plugin.board.instructions")}
          announce={sortableAnnounce}
          onReorder={(event) => {
            seq.current += 1;
            setNotice(undefined);
            detach(
              commitDraft({
                draft: {
                  basis,
                  seq: seq.current,
                  value: moveItem(items, event.id, event.to),
                },
                setDraft: (update: DraftUpdate<readonly SortableItem[]>) => {
                  setDraft(update);
                },
                call: () => callMethod(moveVerb, { id: event.id, index: event.to }),
                onFailed: () => {
                  setNotice(t("desktop.plugin.sortable.moveFailed"));
                },
              }),
              rethrow,
            );
          }}
        >
          {rows}
        </List>
      )}
      {notice === undefined ? null : (
        <p role="status" className="m-0 text-ui-dense text-danger-text" data-sortable-notice="">
          {notice}
        </p>
      )}
    </div>
  );
}
