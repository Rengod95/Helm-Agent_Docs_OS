// 캔버스 위에 뜨는 두 패널: 오른쪽 선택 패널(내용에 맞는 높이, 길면 안에서 스크롤)과 아래 층 패널(고리를 누르면 그 층의 플러그인이 불리는 순서대로 이어진 흐름).
import { Card, IconButton } from "@caustic/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, GripVertical, Pause, Play, X } from "../_shell";
import { T } from "../_shell/terms";
import { LAYER_NAME, groupById, type Plugin } from "./data";
import { CardBody } from "./card";
import { GRP, Mark, SHAPE_OF } from "./marks";
import { useMock } from "./store";
import { reducedMotion } from "./viewport";

export const PANEL_W = 320;
/** 오른쪽 위 셸 도구 모음(떠 있다)과 겹치지 않게 비우는 폭 */
export const RIGHT_GAP = 60;

export function SelectionPanel() {
  const m = useMock();
  const g =
    m.sel.k === "group" ||
    (m.sel.k === "plugin" &&
      m.plugins.some((p) => m.sel.k === "plugin" && p.id === m.sel.id && p.group !== undefined));
  return (
    <Card
      role="region"
      aria-label="선택한 것"
      variant="surface"
      size="sm"
      shadow="4"
      className="wb5-glass animate-enter absolute right-3 top-[108px] z-20 flex max-h-[calc(100%-120px)] flex-col gap-0 overflow-hidden"
      style={{ width: PANEL_W }}
    >
      {g && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5"
          style={{ background: GRP.graphic }}
        />
      )}
      <CardBody />
    </Card>
  );
}

// ── 층 패널: 순서대로 이어진 흐름 ─────────────────────────────────

/** 카드 사이 이음: 앞에서 뒤로 가는 화살표. 순서는 자리와 이 선이 말하므로 번호는 없다. */
function Connector({ live }: { live: boolean }) {
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
        className={live ? "wb5-flow" : undefined}
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
  index,
  total,
  picked,
  ghost = false,
}: {
  p: Plugin;
  index: number;
  total: number;
  picked: boolean;
  ghost?: boolean;
}) {
  const m = useMock();
  const on = m.isOn(p.id);
  const h = m.health(p.id);
  const grp = p.group !== undefined;
  return (
    <Card
      variant={grp ? "soft" : "surface"}
      tone={grp ? "info" : "neutral"}
      size="xs"
      radius="xl"
      shadow={ghost ? "4" : undefined}
      className={`group/flow relative w-52 flex-none gap-1 ${picked ? "outline outline-2 -outline-offset-2 outline-text-primary" : ""}`}
      data-flow-card={p.id}
      data-position={`${index + 1}/${total}`}
    >
      <div className="flex items-center gap-2">
        <Mark
          shape={SHAPE_OF[p.layer]}
          size={20}
          group={grp}
          on={on}
          failing={h !== undefined}
          autoOff={h?.autoOff === true}
        />
        <span
          className={`min-w-0 flex-1 truncate text-ui-strong ${on ? "text-text-primary" : "text-text-tertiary"}`}
        >
          {p.name}
        </span>
      </div>
      <div className="truncate ps-7 text-footnote text-text-tertiary">
        {grp ? `${groupById(p.group ?? "")?.name ?? ""} ${T.group}` : p.role}
      </div>
      <GripVertical
        aria-hidden
        className="pointer-events-none absolute left-0.5 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary opacity-0 transition-opacity group-hover/flow:opacity-100"
      />
      <button
        type="button"
        data-no-drag
        aria-label={`${p.name} ${on ? "끄기" : "켜기"}`}
        onClick={() => m.toggle(p.id)}
        className="absolute right-1.5 top-1.5 grid size-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 text-text-tertiary opacity-0 outline-none transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover/flow:opacity-100"
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

interface DragInfo {
  id: string;
  x: number;
  y: number;
  offX: number;
  offY: number;
  w: number;
  h: number;
  over: number;
}

export function RingPanel({ right }: { right: number }) {
  const m = useMock();
  const layer = m.ring;
  const list: Plugin[] = layer === null ? [] : m.layerList(layer);
  const [drag, setDrag] = useState<DragInfo | null>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const lefts = useRef(new Map<string, number>());
  const listRef = useRef(list);
  listRef.current = list;
  // 카드가 한 줄에 다 안 들어가면 잘린 쪽에 그늘과 화살표를 둔다: 끝에 닿으면 사라진다.
  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  const measure = useCallback((): void => {
    const el = scroller.current;
    if (el === null) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdge((e) => (e.left === left && e.right === right ? e : { left, right }));
  }, []);
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (el === null) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, list.length, m.ring]);

  // 순서가 바뀌면 카드가 제자리로 미끄러지듯 옮겨 간다(FLIP).
  useLayoutEffect(() => {
    for (const [id, el] of els.current) {
      const left = el.getBoundingClientRect().left;
      const was = lefts.current.get(id);
      if (was !== undefined && Math.abs(was - left) > 1 && !reducedMotion())
        el.animate([{ transform: `translateX(${was - left}px)` }, { transform: "none" }], {
          duration: 240,
          easing: "cubic-bezier(.2,.8,.2,1)",
        });
      lefts.current.set(id, left);
    }
  });

  if (layer === null) return null;
  const ring = layer;

  const overOf = (x: number, id: string): number => {
    let n = 0;
    for (const p of listRef.current) {
      if (p.id === id) continue;
      const el = els.current.get(p.id);
      if (el === undefined) continue;
      const r = el.getBoundingClientRect();
      if (x > r.left + r.width / 2) n += 1;
    }
    return n;
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>, p: Plugin): void => {
    if (e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest("[data-no-drag]") !== null) return;
    const el = els.current.get(p.id);
    if (el === undefined) return;
    const r = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let live: DragInfo | null = null;
    const move = (ev: PointerEvent): void => {
      if (live === null) {
        if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 5) return;
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
      live = { ...live, x: ev.clientX, y: ev.clientY, over: overOf(ev.clientX, p.id) };
      setDrag(live);
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (live === null) m.select({ k: "plugin", id: p.id });
      else m.moveInLayer(ring, p.id, live.over);
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>, p: Plugin, i: number): void => {
    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      m.moveInLayer(ring, p.id, i + (e.key === "ArrowLeft" ? -1 : 1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      m.select({ k: "plugin", id: p.id });
    }
  };

  // 끌고 있는 카드는 흐름에서 빼고, 놓일 자리에 점선 틀을 둔다: 이음선이 그 자리를 따라 이어진다.
  const rest = drag === null ? list : list.filter((p) => p.id !== drag.id);
  const slots: ({ kind: "card"; p: Plugin; i: number } | { kind: "hole" })[] = rest.map((p, i) => ({
    kind: "card",
    p,
    i,
  }));
  if (drag !== null) slots.splice(drag.over, 0, { kind: "hole" });
  const dragged = drag === null ? undefined : list.find((p) => p.id === drag.id);

  return (
    <Card
      role="region"
      aria-label={`${LAYER_NAME[layer]} 층`}
      variant="surface"
      size="sm"
      shadow="4"
      className="wb5-glass animate-enter absolute bottom-14 left-3 z-20 gap-2"
      style={{ right }}
    >
      <header className="flex items-center gap-2">
        <Mark shape={SHAPE_OF[layer]} size={18} />
        <h3 className="m-0 flex-1 text-title-4 text-text-primary">
          {layer === "plugin" ? LAYER_NAME[layer] : `${layer} ${LAYER_NAME[layer]}`}
        </h3>
        <IconButton size="sm" variant="ghost" label="닫기" onClick={m.closeRing}>
          <X />
        </IconButton>
      </header>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={measure}
          role="list"
          className="flex items-center overflow-x-auto pb-1"
        >
          <span aria-hidden className="size-2 flex-none rounded-full bg-text-primary" />
          {slots.map((s, k) => (
            <div key={s.kind === "hole" ? "hole" : s.p.id} className="flex flex-none items-center">
              <Connector live={drag === null} />
              {s.kind === "hole" ? (
                <div
                  aria-hidden
                  className="flex-none rounded-xl border border-dashed border-text-secondary bg-neutral-hover"
                  style={{ width: drag?.w ?? 208, height: drag?.h ?? 56 }}
                />
              ) : (
                <div
                  role="listitem"
                  tabIndex={0}
                  aria-label={`${s.p.name}, ${list.indexOf(s.p) + 1}/${list.length}`}
                  ref={(el) => {
                    if (el === null) els.current.delete(s.p.id);
                    else els.current.set(s.p.id, el);
                  }}
                  onPointerDown={(e) => onDown(e, s.p)}
                  onKeyDown={(e) => onKey(e, s.p, list.indexOf(s.p))}
                  className="flex-none cursor-grab touch-none rounded-xl outline-none focus-visible:shadow-focus"
                  data-index={k}
                >
                  <FlowCard
                    p={s.p}
                    index={list.indexOf(s.p)}
                    total={list.length}
                    picked={m.sel.k === "plugin" && m.sel.id === s.p.id}
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
              label="앞으로"
              onClick={() => scroller.current?.scrollBy({ left: -280, behavior: "smooth" })}
              className="absolute left-0 top-1/2 -translate-y-1/2 bg-surface-raised shadow-2"
            >
              <ChevronLeft />
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
              label="더 보기"
              onClick={() => scroller.current?.scrollBy({ left: 280, behavior: "smooth" })}
              className="absolute right-0 top-1/2 -translate-y-1/2 bg-surface-raised shadow-2"
            >
              <ChevronRight />
            </IconButton>
          </>
        )}
      </div>
      {drag !== null &&
        dragged !== undefined &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 cursor-grabbing"
            style={{
              left: drag.x - drag.offX,
              top: drag.y - drag.offY,
              width: drag.w,
              transform: "rotate(1.2deg)",
            }}
          >
            <FlowCard
              p={dragged}
              index={list.indexOf(dragged)}
              total={list.length}
              picked={false}
              ghost
            />
          </div>,
          document.body,
        )}
    </Card>
  );
}
