// 층 패널(고리를 누르면 열린다). 그 층의 플러그인을 불리는 순서대로 이음선으로 잇는다.
// 카드는 이름과 한 줄 설명만 보인다. 끌기 손잡이와 켜기·끄기 단추는 올릴 때 가장자리에 나온다.
// 순서는 끌어 놓거나 Alt+←·→로 바꾼다.
// [미결: 사용자 확인] 이 순서가 불러오는 순서(load order)인지 화면만의 순서인지 아직 정해지지 않았다.
// 그래서 순서는 이 컴포넌트의 상태에만 두고 저장하지 않는다. 정해지면 저장 자리를 정한다.
import { Card, IconButton } from "@caustic/react";
import { ChevronLeft, ChevronRight, GripVertical, Pause, Play, X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import {
  dropIndex,
  isOn,
  moveHandler,
  nextOrderForKey,
  type ChipBox,
  type CanvasPlugin,
  type LayerKey,
} from "@fresnel/client/workbench/canvas";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useCraft } from "./craft-context.tsx";
import { applyLayerOrder, layerPlugins } from "./orbit-model.ts";
import { layerTitle } from "./orbit-names.ts";
import { Mark, shapeOf } from "./marks.tsx";
import { useSwitch } from "./use-switch.ts";

/** 끌기를 시작하는 거리(px). 그 아래는 누르기다 */
const DRAG_SLOP = 5;
/** 화살표 단추가 한 번에 넘기는 거리(px) */
const SCROLL_STEP = 280;

interface Drag {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly offX: number;
  readonly offY: number;
  readonly w: number;
  readonly h: number;
  /** 놓일 자리(끌고 있는 카드를 뺀 목록에서의 번호) */
  readonly over: number;
}

export function LayerPanel({ layer }: { readonly layer: LayerKey }): ReactNode {
  const { source, state, dispatch } = useCraft();
  const sw = useSwitch();
  const list = layerPlugins(source.snapshot, layer);
  const ids = list.map((p) => p.id);
  // [미결] 순서는 상태에만 둔다(위 주석). 층이 바뀌면 호출하는 쪽이 key로 새로 만든다.
  const [saved, setSaved] = useState<readonly string[]>([]);
  const order = applyLayerOrder(saved, ids);
  const byId = new Map(list.map((p) => [p.id, p] as const));
  const cards = order.flatMap((id) => {
    const p = byId.get(id);
    return p === undefined ? [] : [p];
  });

  const els = useRef(new Map<string, HTMLElement>());
  const lefts = useRef(new Map<string, number>());
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const [drag, setDrag] = useState<Drag | null>(null);

  const measure = useCallback((): void => {
    const el = scroller.current;
    if (el === null) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);

  // 카드 수가 바뀌면 줄이 넘치는 쪽도 바뀌므로 매 렌더 다시 잰다(값이 같으면 상태는 그대로다)
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // 순서가 바뀌면 카드가 제자리로 미끄러져 간다(FLIP)
  useLayoutEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    for (const [id, el] of els.current) {
      const left = el.getBoundingClientRect().left;
      const was = lefts.current.get(id);
      if (was !== undefined && Math.abs(was - left) > 1 && !reduced)
        el.animate([{ transform: `translateX(${was - left}px)` }, { transform: "none" }], {
          duration: 240,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      lefts.current.set(id, left);
    }
  });

  const overAt = (x: number, y: number, id: string): number => {
    const boxes: ChipBox[] = [];
    for (const [cid, el] of els.current) {
      if (cid === id) continue;
      const r = el.getBoundingClientRect();
      boxes.push({ id: cid, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    return dropIndex(boxes, id, x, y);
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>, p: CanvasPlugin): void => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("[data-no-drag]") !== null) return;
    const el = els.current.get(p.id);
    if (el === undefined) return;
    const r = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let live: Drag | null = null;
    const move = (ev: PointerEvent): void => {
      if (live === null) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_SLOP) return;
        live = {
          id: p.id,
          x: ev.clientX,
          y: ev.clientY,
          offX: start.x - r.left,
          offY: start.y - r.top,
          w: r.width,
          h: r.height,
          over: 0,
        };
      }
      live = { ...live, x: ev.clientX, y: ev.clientY, over: overAt(ev.clientX, ev.clientY, p.id) };
      setDrag(live);
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (live === null) dispatch({ t: "selectPlugin", id: p.id });
      else {
        const target = live;
        setSaved(moveHandler(order, target.id, target.over));
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, p: CanvasPlugin): void => {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      setSaved(nextOrderForKey(order, p.id, e.key === "ArrowLeft" ? "left" : "right"));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dispatch({ t: "selectPlugin", id: p.id });
    }
  };

  // 끌고 있는 카드는 흐름에서 빼고, 놓일 자리에 점선 틀을 둔다
  const rest = drag === null ? cards : cards.filter((p) => p.id !== drag.id);
  const slots: ({ readonly kind: "card"; readonly p: CanvasPlugin } | { readonly kind: "hole" })[] =
    rest.map((p) => ({ kind: "card", p }));
  if (drag !== null) slots.splice(drag.over, 0, { kind: "hole" });
  const dragged = drag === null ? undefined : cards.find((p) => p.id === drag.id);
  const title = layerTitle(layer);

  return (
    <Card
      role="region"
      aria-label={t("desktop.craft.orbit.layer.label", { name: title })}
      variant="surface"
      size="sm"
      shadow="4"
      className="craft-glass animate-enter absolute bottom-16 left-3 right-3 z-20 gap-2"
    >
      <header className="flex items-center gap-2">
        <Mark shape={shapeOf(layer)} size={18} />
        <h3 className="m-0 flex-1 text-title-4 text-text-primary">{title}</h3>
        <span className="hidden text-footnote text-text-tertiary sm:inline">
          {t("desktop.craft.orbit.layer.hint")}
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.orbit.panel.close")}
          onClick={() => dispatch({ t: "clear" })}
        >
          <X aria-hidden />
        </IconButton>
      </header>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={measure}
          role="list"
          aria-label={title}
          className="flex items-center overflow-x-auto pb-1"
        >
          <span aria-hidden className="size-2 flex-none rounded-full bg-text-primary" />
          {slots.map((s, k) => (
            <div key={s.kind === "hole" ? "hole" : s.p.id} className="flex flex-none items-center">
              <Connector live={drag === null} />
              {s.kind === "hole" ? (
                <div
                  aria-hidden
                  className="flex-none rounded-xl border border-dashed border-text-secondary"
                  style={{ width: drag?.w ?? 208, height: drag?.h ?? 56 }}
                />
              ) : (
                <div
                  role="listitem"
                  tabIndex={0}
                  aria-label={t("desktop.craft.orbit.layer.cardLabel", {
                    name: s.p.name,
                    n: cards.indexOf(s.p) + 1,
                    total: cards.length,
                  })}
                  ref={(el) => {
                    if (el === null) els.current.delete(s.p.id);
                    else els.current.set(s.p.id, el);
                  }}
                  onPointerDown={(e) => onDown(e, s.p)}
                  onKeyDown={(e) => onKey(e, s.p)}
                  className="flex-none cursor-grab touch-none rounded-xl outline-none focus-visible:shadow-focus"
                  data-index={k}
                >
                  <FlowCard
                    p={s.p}
                    picked={state.sel.k === "plugin" && state.sel.id === s.p.id}
                    busy={sw.pending !== null}
                    onSwitch={() => sw.set(s.p.id, !isOn(s.p))}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        {edge.left && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-surface-raised to-transparent"
            />
            <IconButton
              size="sm"
              variant="outline"
              label={t("desktop.craft.orbit.layer.prev")}
              onClick={() => scroller.current?.scrollBy({ left: -SCROLL_STEP, behavior: "smooth" })}
              className="absolute left-0 top-1/2 -translate-y-1/2 bg-surface-raised shadow-2"
            >
              <ChevronLeft aria-hidden />
            </IconButton>
          </>
        )}
        {edge.right && (
          <>
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-14 bg-gradient-to-l from-surface-raised to-transparent"
            />
            <IconButton
              size="sm"
              variant="outline"
              label={t("desktop.craft.orbit.layer.next")}
              onClick={() => scroller.current?.scrollBy({ left: SCROLL_STEP, behavior: "smooth" })}
              className="absolute right-0 top-1/2 -translate-y-1/2 bg-surface-raised shadow-2"
            >
              <ChevronRight aria-hidden />
            </IconButton>
          </>
        )}
      </div>
      {drag !== null &&
        dragged !== undefined &&
        createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed z-50 cursor-grabbing"
            style={{
              left: drag.x - drag.offX,
              top: drag.y - drag.offY,
              width: drag.w,
              transform: "rotate(1.2deg)",
            }}
          >
            <FlowCard p={dragged} busy={false} onSwitch={noop} ghost />
          </div>,
          document.body,
        )}
    </Card>
  );
}

const noop = (): void => {};

/** 카드 사이의 이음선. 앞에서 뒤로 가는 화살표이고, 순서는 자리와 이 선이 말한다 */
function Connector({ live }: { readonly live: boolean }): ReactNode {
  return (
    <svg
      aria-hidden
      width={36}
      height={16}
      viewBox="0 0 36 16"
      className="flex-none text-text-tertiary"
    >
      <line
        x1={2}
        y1={8}
        x2={30}
        y2={8}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeDasharray={live ? "3 4" : undefined}
      />
      <path
        d="M26 3.5 L32.5 8 L26 12.5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlowCard({
  p,
  picked = false,
  busy,
  onSwitch,
  ghost = false,
}: {
  readonly p: CanvasPlugin;
  readonly picked?: boolean;
  readonly busy: boolean;
  readonly onSwitch: () => void;
  readonly ghost?: boolean;
}): ReactNode {
  const on = isOn(p);
  const grouped = p.group !== undefined;
  const failing = p.health !== undefined;
  return (
    <Card
      variant={grouped ? "soft" : "surface"}
      tone={grouped ? "info" : "neutral"}
      size="xs"
      radius="xl"
      {...(ghost ? { shadow: "4" as const } : {})}
      className={`group/flow relative w-52 flex-none gap-1 ${picked ? "outline outline-2 -outline-offset-2 outline-text-primary" : ""}`}
    >
      <div className="flex items-center gap-2">
        <Mark
          shape={shapeOf(p.layer)}
          size={20}
          group={grouped}
          on={on}
          failing={failing}
          autoOff={p.health?.autoOff === true}
        />
        <span
          className={`min-w-0 flex-1 truncate text-ui-strong ${on ? "text-text-primary" : "text-text-tertiary"}`}
        >
          {p.name}
        </span>
      </div>
      {p.role !== undefined && (
        <div className="truncate ps-7 text-footnote text-text-tertiary">{p.role}</div>
      )}
      <GripVertical
        aria-hidden
        className="pointer-events-none absolute left-0.5 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary opacity-0 transition-opacity group-hover/flow:opacity-100"
      />
      <button
        type="button"
        data-no-drag
        disabled={busy}
        aria-label={
          on
            ? t("desktop.craft.orbit.layer.off", { name: p.name })
            : t("desktop.craft.orbit.layer.on", { name: p.name })
        }
        onClick={onSwitch}
        className="absolute right-1.5 top-1.5 grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-text-tertiary opacity-0 outline-none transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover/flow:opacity-100 disabled:opacity-40"
      >
        {on ? (
          <Pause aria-hidden className="size-3.5" />
        ) : (
          <Play aria-hidden className="size-3.5" />
        )}
      </button>
    </Card>
  );
}
