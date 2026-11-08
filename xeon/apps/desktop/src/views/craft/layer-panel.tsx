// 층 패널(고리를 누르면 열린다). 그 층의 플러그인을 불러오는 순서대로 이음선으로 잇는다.
// 이 순서가 곧 실행 순서라서 화면에서 바꾸지 않는다(보기 전용). 카드는 이름과 한 줄 설명만 보이고, 켜기·끄기 단추는 올릴 때 가장자리에 나온다.
// 카드를 누르면 고른다.
import { Card, IconButton } from "@caustic/react";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { isOn, type CanvasPlugin, type LayerKey } from "@fresnel/client/workbench/canvas";
import { InfoTip } from "./info-tip.tsx";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useCraft } from "./craft-context.tsx";
import { layerPlugins } from "./orbit-model.ts";
import { layerTitle } from "./orbit-names.ts";
import { Mark, shapeOf } from "./marks.tsx";
import { useSwitch } from "./use-switch.ts";

/** 화살표 단추가 한 번에 넘기는 거리(px) */
const SCROLL_STEP = 280;

export function LayerPanel({ layer }: { readonly layer: LayerKey }): ReactNode {
  const { source, state, dispatch } = useCraft();
  const sw = useSwitch();
  // 불러오는 순서 그대로(스냅샷 순서). 화면에서 바꾸지 않으므로 순서를 따로 담지 않는다
  const cards = layerPlugins(source.snapshot, layer, state.contrib);

  const scroller = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

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

  const onKey = (e: KeyboardEvent<HTMLDivElement>, p: CanvasPlugin): void => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      dispatch({ t: "selectPlugin", id: p.id });
    }
  };

  const title = layerTitle(layer);

  return (
    <Card
      role="region"
      aria-label={t("desktop.craft.orbit.layer.label", { name: title })}
      variant="surface"
      size="sm"
      shadow="4"
      className="craft-glass animate-enter absolute bottom-14 left-3 right-14 z-20 gap-2"
    >
      <header className="flex items-center gap-2">
        <Mark shape={shapeOf(layer)} size={18} />
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <h3 className="m-0 text-title-4 text-text-primary">{title}</h3>
          <InfoTip text={t("desktop.craft.orbit.layer.hint")} />
        </div>
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
          {cards.map((p, k) => (
            <div key={p.id} className="flex flex-none items-center">
              <Connector />
              <div
                role="listitem"
                tabIndex={0}
                aria-label={t("desktop.craft.orbit.layer.cardLabel", {
                  name: p.name,
                  n: k + 1,
                  total: cards.length,
                })}
                onClick={() => dispatch({ t: "selectPlugin", id: p.id })}
                onKeyDown={(e) => onKey(e, p)}
                className="flex-none cursor-pointer rounded-xl outline-none focus-visible:shadow-focus"
                data-index={k}
              >
                <FlowCard
                  p={p}
                  picked={state.sel.k === "plugin" && state.sel.id === p.id}
                  busy={sw.pending !== null}
                  onSwitch={() => sw.set(p.id, !isOn(p))}
                />
              </div>
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
    </Card>
  );
}

/** 카드 사이의 이음선. 앞에서 뒤로 가는 화살표이고, 순서는 자리와 이 선이 말한다 */
function Connector(): ReactNode {
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
        strokeDasharray="3 4"
        className="craft-flow"
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
}: {
  readonly p: CanvasPlugin;
  readonly picked?: boolean;
  readonly busy: boolean;
  readonly onSwitch: () => void;
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
      <button
        type="button"
        disabled={busy}
        aria-label={
          on
            ? t("desktop.craft.orbit.layer.off", { name: p.name })
            : t("desktop.craft.orbit.layer.on", { name: p.name })
        }
        onClick={(e) => {
          // 켜기·끄기 단추는 카드 고르기로 새지 않는다
          e.stopPropagation();
          onSwitch();
        }}
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
