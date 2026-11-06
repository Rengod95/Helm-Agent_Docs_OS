// 지도(Orbit): 기본 에이전트를 가운데 두고, 층을 원 고리로, 플러그인을 고리 위 점으로, 그룹을 바깥 호로 그린다.
// 세계 좌표(1000×1000)에 모두 놓고, 화면 배율과 이동은 CSS 변수(--k --tx --ty)로만 옮긴다: 휠·끌기 동안 React를 다시 그리지 않는다.
// 이 지도에는 편집 동작이 없다. 켜고 끄는 스위치는 선택 패널과 층 패널에만 있다.
import { Tooltip } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import {
  CENTER,
  isOn,
  labelScale,
  type CanvasPlugin,
  type CanvasSnapshot,
  type LayerKey,
} from "@fresnel/client/workbench/canvas";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useCraft } from "./craft-context.tsx";
import { CoreSphere } from "./core-sphere.tsx";
import { Finder, ZoomBar } from "./finder.tsx";
import { LayerPanel } from "./layer-panel.tsx";
import { Mark, shapeOf } from "./marks.tsx";
import {
  groupShown,
  isDimmed,
  litOf,
  matchesQuery,
  passesFilter,
  shownOnMap,
} from "./orbit-model.ts";
import { RING_ORDER, layoutOrbit, pointAt, ringRadius, type OrbitArc } from "./orbit-layout.ts";
import { chipWidth, visibleChips, type ChipCandidate, type ChipObstacle } from "./orbit-chips.ts";
import { layerTitle, stateText } from "./orbit-names.ts";
import { PANEL_W } from "./selection-panel.tsx";
import { SPRING_MS, springLinear } from "./spring.ts";
import { SpaceBackground } from "./space-bg.tsx";
import { useViewport } from "./use-viewport.ts";

// ── 배치 상수 ─────────────────────────────────────────────────────

/** 떠 있는 줄(도구 막대)이 차지하는 윗여백(px) */
const TOP_INSET = 64;
/** 선택 패널이 열렸을 때 오른쪽 여백(패널 폭과 가장자리) */
const PANEL_INSET = PANEL_W + 24;
/** 가장자리 여백 */
const EDGE = 12;
/** 찾기와 확대 막대 줄이 차지하는 아랫여백 */
const BOTTOM_INSET = 64;
/** 층 패널이 열렸을 때 추가로 비우는 높이(px) */
const LAYER_INSET = 150;
/** 중심 구체의 지름(CSS px, 배율 1): 첫 고리(L1) 안지름의 75%. 고리와 함께 같은 비율로 앉는다 */
const CORE = 0.75 * 2 * ringRadius("L1");
/** 구체는 자기 크기를 고정 px로 그리므로, 지도 배율(--k)을 글자 배율(--ls)로 나눈 값만큼 부모가 키운다 */
const CORE_SCALE = "scale(calc(var(--k) / var(--ls)))";
/** 고리의 빛 토막 반폭(도)과 고리마다 시작 각도(도). 움직임 줄이기에서는 이 자리에 멈춘다 */
const LIGHT_HALF = 21.5;
const LIGHT_START: readonly number[] = [30, 150, 250, 320];
/** 중심 구체의 에너지. 엔진 신호가 오기 전이라 쉰 값이다 */
const CORE_ENERGY = 0;

// ── 그리기 도우미 ─────────────────────────────────────────────────

const rad = (deg: number): number => (deg * Math.PI) / 180;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
/** 화면 px 굵기를 세계 좌표로: 확대해도 굵기가 같다 */
const sw = (px: number): string => `calc(${px}px / var(--k))`;
/** 고리·호의 불투명도: 세기에 판의 배율을 곱하고 1을 넘기지 않는다 */
const lineAlpha = (a: number): string =>
  `min(1, calc(${a.toFixed(3)} * var(--craft-line-gain, 1)))`;
/** 화면 위치에 놓는 틀: 위치는 세계 좌표 × 배율 + 이동(변수), 글자는 배율(--ls)을 따른다 */
const place = (x: number, y: number): string =>
  `translate(calc(var(--tx) + var(--k) * ${x.toFixed(1)}px), calc(var(--ty) + var(--k) * ${y.toFixed(1)}px))`;

/** 둘레 위 한 호: 반지름, 각도 from→to(위가 0, 시계 방향) */
function arcPath(radius: number, from: number, to: number): string {
  const a = pointAt(radius, from);
  const b = pointAt(radius, to);
  const r = radius.toFixed(1);
  return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

/** 고리·호를 이루는 짧은 조각 하나: 경로와 세기(0~1) */
interface Seg {
  readonly d: string;
  readonly a: number;
}

/** 고리 조각 수. 이웃과 0.3도씩 겹쳐 이음매가 비지 않는다 */
const RING_SEGS = 30;
/** 둘레 한 점의 세기(0~1): 사인 셋의 합이라 부드럽고, 고리마다 위상이 다르다 */
function ringSample(i: number, deg: number): number {
  const theta = rad(deg);
  return clamp01(
    0.5 +
      0.28 * Math.sin(2 * theta + 0.4 + i * 1.9) +
      0.14 * Math.sin(3 * theta + 2.1 + i * 2.7) +
      0.08 * Math.sin(5 * theta + 4 + i * 1.3),
  );
}

function ringSegs(radius: number, i: number): Seg[] {
  const step = 360 / RING_SEGS;
  const samples = Array.from({ length: RING_SEGS }, (_, j) => ringSample(i, j * step + step / 2));
  // 세기는 고리마다 자기 최대에 맞춘다: 가장 밝은 조각은 0.835, 흐린 조각은 0.035 근처
  const top = Math.max(...samples);
  return samples.map((s, j) => ({
    d: arcPath(radius, j * step - 0.3, (j + 1) * step + 0.3),
    a: 0.035 + 0.8 * (s / top) ** 2.2,
  }));
}

/** 그룹 호 조각: 양 끝 20%에서 0까지 스며들고, 둘레를 따라 세기가 조금씩 흔들린다 */
function groupSegs(radius: number, from: number, to: number): Seg[] {
  const span = to - from;
  const n = Math.max(8, Math.round(span / 5));
  return Array.from({ length: n }, (_, j) => {
    const u = (j + 0.5) / n;
    const deg = from + span * u;
    const edge = clamp01(Math.min(1, u / 0.2, (1 - u) / 0.2));
    const fade = edge * edge * (3 - 2 * edge);
    const wave = 0.62 + 0.38 * Math.sin(4 * rad(deg) + from / 17);
    return {
      d: arcPath(radius, from + span * (j / n) - 0.3, from + span * ((j + 1) / n) + 0.3),
      a: 0.92 * fade * wave,
    };
  });
}

/** 고리 다섯 개의 그림 재료(고리 넷과 외부): 한 번만 계산한다 */
const RINGS = RING_ORDER.map((layer, i) => {
  const radius = ringRadius(layer);
  return {
    layer,
    i,
    radius,
    segs: ringSegs(radius, i),
    light: arcPath(radius, -LIGHT_HALF, LIGHT_HALF),
    start: LIGHT_START[i] ?? 0,
    a: pointAt(radius, -LIGHT_HALF),
    b: pointAt(radius, LIGHT_HALF),
  };
});

/** 그룹 호마다 흐르는 빛: 주기(초)와 시작 지연(초). 번호로 정해 같은 지도는 같은 모양이다 */
function travelOf(i: number): { readonly sec: number; readonly lag: number } {
  return { sec: 72 + ((i * 13) % 30), lag: (i * 17) % 60 };
}

// ── 테마 ──────────────────────────────────────────────────────────

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeScheme(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** 앱이 정한 테마(data-theme)가 있으면 따르고, 없으면 시스템 설정을 따른다 */
function schemeNow(): "dark" | "light" {
  if (typeof document === "undefined") return "dark";
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light" || explicit === "dark") return explicit;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function useCraftTheme(): "dark" | "light" {
  return useSyncExternalStore(subscribeScheme, schemeNow, () => "dark");
}

// ── 점 ────────────────────────────────────────────────────────────

/** 이름표 안쪽의 빛이 포인터를 따라온다(CSS 변수 둘). 렌더를 거치지 않는다. */
function spot(e: ReactPointerEvent<HTMLElement>): void {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/** 화면 위치에 놓는 틀. 안쪽은 글자 배율만큼 키운다 */
function Pin({
  x,
  y,
  children,
  style,
}: {
  readonly x: number;
  readonly y: number;
  readonly children: ReactNode;
  readonly style?: CSSProperties | undefined;
}): ReactNode {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0"
      style={{ transform: place(x, y), ...style }}
    >
      <div style={{ transform: "scale(var(--ls))", transformOrigin: "0 0" }}>{children}</div>
    </div>
  );
}

interface NodeProps {
  readonly plugin: CanvasPlugin;
  readonly x: number;
  readonly y: number;
  /** 점이 가운데보다 오른쪽이면 이름표는 오른쪽에 앉는다 */
  readonly right: boolean;
  readonly lit: boolean;
  readonly picked: boolean;
  readonly dim: boolean;
  readonly chip: boolean;
  readonly groupName: string | undefined;
  readonly onPick: (id: string) => void;
}

/** 점 하나와 이름표. 가리킴은 이 점만 다시 그린다 */
const Node = memo(function Node(props: NodeProps): ReactNode {
  const { plugin: p, x, y, right, lit, picked, dim, chip, groupName, onPick } = props;
  const [hot, setHot] = useState(false);
  const on = isOn(p);
  const failing = p.health !== undefined;
  const autoOff = p.health?.autoOff === true;
  const grouped = p.group !== undefined;
  const label = t("desktop.craft.orbit.dot.name", { name: p.name, state: stateText(p) });
  const showChip = chip || lit || picked || hot;
  const tip = (
    <span className="flex flex-col gap-0.5">
      <span>{layerTitle(p.layer)}</span>
      {groupName !== undefined && (
        <span>{t("desktop.craft.orbit.tip.group", { name: groupName })}</span>
      )}
      {p.role !== undefined && <span>{p.role}</span>}
    </span>
  );
  return (
    <Pin x={x} y={y} style={{ opacity: dim ? 0.32 : 1, transition: "opacity 250ms" }}>
      <div onPointerEnter={() => setHot(true)} onPointerLeave={() => setHot(false)}>
        <Tooltip content={tip} side={right ? "right" : "left"} delayDuration={500}>
          <button
            type="button"
            data-dot={p.id}
            aria-label={label}
            aria-pressed={picked}
            onClick={() => onPick(p.id)}
            className="pointer-events-auto absolute grid size-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full border-0 bg-transparent p-0 outline-none focus-visible:shadow-focus"
          >
            <Mark
              shape={shapeOf(p.layer)}
              size={28}
              on={on}
              group={grouped}
              failing={failing}
              autoOff={autoOff}
              picked={picked}
              hot={hot}
            />
          </button>
        </Tooltip>
        {showChip && (
          <div
            className="pointer-events-auto absolute top-0 -translate-y-1/2"
            style={right ? { left: 19 } : { right: 19 }}
          >
            {/* 이름표는 보기용이다: 키보드는 점에서 간다(점이 이름을 말한다) */}
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              data-group={grouped ? "" : undefined}
              data-picked={picked ? "" : undefined}
              data-lit={lit && !picked ? "" : undefined}
              data-off={!on && !failing ? "" : undefined}
              data-fail={failing ? "" : undefined}
              onClick={() => onPick(p.id)}
              onPointerMove={spot}
              onPointerEnter={() => setHot(true)}
              onPointerLeave={() => setHot(false)}
              className="craft-label flex h-7 items-center whitespace-nowrap rounded-full px-3 text-ui-strong"
            >
              {p.name}
            </button>
          </div>
        )}
      </div>
    </Pin>
  );
});

// ── 지도 ──────────────────────────────────────────────────────────

export function Orbit(): ReactNode {
  const { source, state, dispatch } = useCraft();
  const theme = useCraftTheme();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hoverRing, setHoverRing] = useState<LayerKey | null>(null);
  const snapshot = source.snapshot;

  const panelOpen = state.panel && (state.sel.k === "plugin" || state.sel.k === "group");
  const layerOpen = state.sel.k === "layer";
  const insets = {
    top: TOP_INSET,
    right: panelOpen ? PANEL_INSET : EDGE,
    bottom: BOTTOM_INSET + (layerOpen ? LAYER_INSET : 0),
    left: EDGE,
  };

  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const measure = (): void =>
      setSize((prev) =>
        prev.w === el.clientWidth && prev.h === el.clientHeight
          ? prev
          : { w: el.clientWidth, h: el.clientHeight },
      );
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 용수철 곡선은 지원하는 곳에서만 쓴다. 없으면 CSS의 기본 곡선이 대신한다.
  useEffect(() => {
    const el = box.current;
    if (el === null || typeof CSS === "undefined") return;
    if (!CSS.supports("transition-timing-function", "linear(0, 1)")) return;
    el.style.setProperty("--craft-spring", springLinear());
    el.style.setProperty("--craft-spring-t", `${SPRING_MS}ms`);
  }, []);

  const vp = useViewport(box, size, insets);
  const view = vp.view;

  const layout = useMemo(() => layoutOrbit(snapshot), [snapshot]);
  const pluginOf = useMemo(
    () => new Map(snapshot.plugins.map((p) => [p.id, p] as const)),
    [snapshot],
  );
  const dotOf = useMemo(() => new Map(layout.dots.map((d) => [d.id, d] as const)), [layout]);
  // 구성 요소 거르기에 맞지 않는 점과 호는 그리지 않는다(숨긴다). 위치는 전체 스냅샷으로 정해진 그대로다
  const onMap = useMemo(() => shownOnMap(snapshot, state.contrib), [snapshot, state.contrib]);
  const lit = useMemo(
    () => litOf(state.sel, snapshot, source.order),
    [state.sel, snapshot, source.order],
  );
  const picked = state.sel.k === "plugin" ? state.sel.id : null;
  const openLayer = state.sel.k === "layer" ? state.sel.id : null;
  const groupSel =
    state.sel.k === "group"
      ? state.sel.id
      : state.sel.k === "plugin"
        ? (pluginOf.get(state.sel.id)?.group ?? null)
        : null;

  // 이름표는 겹치지 않는 것만 보인다(고른 것·밝힌 것은 늘 보인다). 배율(percent)이 바뀌면 다시 센다
  const chips = useMemo(() => {
    const items = onMap.flatMap((p): ChipCandidate[] => {
      const d = dotOf.get(p.id);
      if (d === undefined) return [];
      const forced = lit.ids.has(p.id) || picked === p.id;
      const dim = isDimmed(p, lit, state.kind, state.contrib, state.query);
      const priority = dim
        ? -1
        : p.health !== undefined
          ? 3
          : p.group !== undefined
            ? 2
            : isOn(p)
              ? 1
              : 0;
      return [
        { id: p.id, x: d.x, y: d.y, name: p.name, right: d.x >= CENTER - 1, priority, forced },
      ];
    });
    const obstacles: ChipObstacle[] = [
      ...RING_ORDER.map((layer) => {
        const at = pointAt(ringRadius(layer), 0);
        return { x: at.x, y: at.y, w: chipWidth(layerTitle(layer)), h: 24 };
      }),
      { x: CENTER, y: CENTER + ringRadius("L1"), w: 150, h: 36 },
      ...layout.arcs.flatMap((arc) => {
        const group = snapshot.groups.find((g) => g.id === arc.groupId);
        if (group === undefined || !groupShown(snapshot, arc.groupId, state.contrib)) return [];
        const mid = pointAt(arc.radius + 16, (arc.from + arc.to) / 2);
        return [{ x: mid.x, y: mid.y, w: chipWidth(group.name), h: 28 }];
      }),
    ];
    // 배율은 화면에 보이는 정수 퍼센트에서 얻는다(오차 0.5% 안). 정수가 바뀔 때만 다시 센다
    const k = vp.percent / 100;
    return visibleChips(items, obstacles, k, labelScale(k));
  }, [
    onMap,
    dotOf,
    layout,
    lit,
    picked,
    snapshot,
    state.kind,
    state.contrib,
    state.query,
    vp.percent,
  ]);

  const onPick = useCallback(
    (id: string) => {
      if (pluginOf.has(id)) dispatch({ t: "selectPlugin", id });
    },
    [dispatch, pluginOf],
  );
  const onPickGroup = (id: string): void => dispatch({ t: "selectGroup", id });
  const onOpenRing = (layer: LayerKey): void =>
    dispatch({ t: "selectOther", sel: { k: "layer", id: layer } });

  /** 빈 곳을 누르면 고른 것을 놓는다. 끌고 난 직후의 클릭은 시점 쪽에서 막혀 여기 오지 않는다 */
  const onBackground = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const target = e.target;
    if (
      target === e.currentTarget ||
      target instanceof SVGElement ||
      target instanceof HTMLCanvasElement
    )
      dispatch({ t: "clear" });
  };

  const groupRows = layout.arcs.flatMap((arc, i) => {
    const group = snapshot.groups.find((g) => g.id === arc.groupId);
    if (group === undefined) return [];
    const members = group.members.flatMap((id) => {
      const p = pluginOf.get(id);
      return p === undefined ? [] : [p];
    });
    const inLit = members.some((p) => lit.ids.has(p.id));
    const passes = members.some(
      (p) => passesFilter(p, state.kind, state.contrib) && matchesQuery(p, state.query),
    );
    return [{ arc, index: i, inLit, passes, allOff: members.every((p) => !isOn(p)) }];
  });

  return (
    <div className="absolute inset-0" role="region" aria-label={t("desktop.craft.orbit.label")}>
      <div
        ref={box}
        data-craft-theme={theme}
        onClick={onBackground}
        className={`craft-map absolute inset-0 touch-none overflow-hidden ${vp.panning ? "cursor-grabbing" : "cursor-grab"}`}
        style={{ opacity: size.w === 0 ? 0 : 1 }}
      >
        <div className="pointer-events-none absolute inset-0">
          <SpaceBackground view={view} theme={theme} />
        </div>

        <svg className="absolute inset-0 size-full" aria-hidden>
          <defs>
            {RINGS.map((r) => (
              <linearGradient
                key={`g${r.i}`}
                id={`craft-lg-${r.i}`}
                gradientUnits="userSpaceOnUse"
                x1={r.a.x}
                y1={r.a.y}
                x2={r.b.x}
                y2={r.b.y}
              >
                <stop
                  offset={0}
                  style={{ stopColor: "var(--cs-color-info-graphic)" }}
                  stopOpacity={0}
                />
                <stop
                  offset={0.5}
                  style={{ stopColor: "var(--cs-color-info-graphic)" }}
                  stopOpacity={0.5}
                />
                <stop
                  offset={1}
                  style={{ stopColor: "var(--cs-color-info-graphic)" }}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
            {RINGS.map((r) => (
              <linearGradient
                key={`c${r.i}`}
                id={`craft-lc-${r.i}`}
                gradientUnits="userSpaceOnUse"
                x1={r.a.x}
                y1={r.a.y}
                x2={r.b.x}
                y2={r.b.y}
              >
                <stop
                  offset={0}
                  style={{ stopColor: "var(--cs-color-text-primary)" }}
                  stopOpacity={0}
                />
                <stop
                  offset={0.5}
                  style={{ stopColor: "var(--cs-color-text-primary)" }}
                  stopOpacity={1}
                />
                <stop
                  offset={1}
                  style={{ stopColor: "var(--cs-color-text-primary)" }}
                  stopOpacity={0}
                />
              </linearGradient>
            ))}
          </defs>
          <g className="craft-world">
            {RINGS.map((r) => {
              const open = openLayer === r.layer;
              const hot = hoverRing === r.layer;
              const circ = 2 * Math.PI * r.radius;
              return (
                <g key={r.layer}>
                  <g style={{ opacity: open ? 1 : hot ? 0.95 : 0.9, transition: "opacity 200ms" }}>
                    {r.segs.map((s) => (
                      <path
                        pointerEvents="none"
                        key={s.d}
                        d={s.d}
                        fill="none"
                        style={{
                          stroke: "var(--cs-color-info-graphic)",
                          strokeOpacity: lineAlpha(s.a),
                          strokeWidth: `calc(${(open ? 2 : hot ? 1.6 : 1.25).toFixed(2)}px * var(--craft-lw, 1) * ${(0.75 + (0.5 * (s.a - 0.035)) / 0.8).toFixed(3)} / var(--k))`,
                        }}
                      />
                    ))}
                  </g>
                  <g className={r.i % 2 === 0 ? "craft-drift" : "craft-drift craft-drift-rev"}>
                    <circle
                      cx={CENTER}
                      cy={CENTER}
                      r={r.radius - 3.5}
                      fill="none"
                      style={{
                        stroke: "var(--cs-color-text-secondary)",
                        strokeOpacity: 0.2,
                        strokeWidth: sw(1.4),
                        strokeDasharray: `calc(1px / var(--k)) calc(${(circ / 120).toFixed(2)}px - 1px / var(--k))`,
                      }}
                    />
                  </g>
                  <g
                    className={`craft-light craft-light-${r.i}`}
                    transform={`rotate(${r.start} ${CENTER} ${CENTER})`}
                  >
                    <path
                      pointerEvents="none"
                      d={r.light}
                      fill="none"
                      style={{ stroke: `url(#craft-lg-${r.i})`, strokeWidth: sw(7) }}
                    />
                    <path
                      pointerEvents="none"
                      d={r.light}
                      fill="none"
                      style={{ stroke: `url(#craft-lc-${r.i})`, strokeWidth: sw(1.6) }}
                    />
                  </g>
                  {/* 고리를 누르면 그 층의 패널이 열린다. 보이지 않는 넓은 선 하나가 누름을 받는다 */}
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={r.radius}
                    fill="none"
                    stroke="var(--cs-color-text-primary)"
                    strokeOpacity={0}
                    style={{ strokeWidth: sw(26), pointerEvents: "stroke", cursor: "pointer" }}
                    onPointerEnter={() => setHoverRing(r.layer)}
                    onPointerLeave={() => setHoverRing((h) => (h === r.layer ? null : h))}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenRing(r.layer);
                    }}
                  />
                </g>
              );
            })}

            {groupRows.map(({ arc, index, inLit, passes, allOff }) => (
              <GroupArc
                key={arc.groupId}
                arc={arc}
                index={index}
                on={groupSel === arc.groupId}
                dim={lit.active && !inLit}
                faded={!passes}
                allOff={allOff}
              />
            ))}

            {lit.active &&
              [...lit.ids].map((id) => {
                const d = dotOf.get(id);
                const p = pluginOf.get(id);
                if (d === undefined || p === undefined) return null;
                return (
                  <line
                    key={`s-${id}`}
                    pathLength={1}
                    x1={CENTER}
                    y1={CENTER}
                    x2={d.x}
                    y2={d.y}
                    className="craft-draw"
                    style={{
                      stroke:
                        p.group !== undefined
                          ? "var(--cs-color-info-graphic)"
                          : "var(--cs-color-text-primary)",
                      strokeOpacity: 0.5,
                      strokeWidth: sw(1.4),
                      pointerEvents: "none",
                    }}
                  />
                );
              })}
          </g>
        </svg>

        <div className="pointer-events-none absolute inset-0">
          {RING_ORDER.map((layer) => {
            const at = pointAt(ringRadius(layer), 0);
            return (
              <Pin key={layer} x={at.x} y={at.y}>
                <div className="pointer-events-auto -translate-x-1/2 -translate-y-1/2">
                  <button
                    type="button"
                    className="craft-label flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-ui-sm"
                    data-picked={openLayer === layer ? "" : undefined}
                    aria-label={t("desktop.craft.orbit.ring.open", { name: layerTitle(layer) })}
                    onClick={() => onOpenRing(layer)}
                    onPointerEnter={() => setHoverRing(layer)}
                    onPointerLeave={() => setHoverRing((h) => (h === layer ? null : h))}
                    onPointerMove={spot}
                  >
                    {layerTitle(layer)}
                  </button>
                </div>
              </Pin>
            );
          })}

          <Pin x={CENTER} y={CENTER}>
            <div
              className="pointer-events-none absolute"
              style={{
                left: -CORE / 2,
                top: -CORE / 2,
                width: CORE,
                height: CORE,
                transform: CORE_SCALE,
              }}
            >
              <CoreSphere energy={CORE_ENERGY} size={CORE} theme={theme} />
            </div>
          </Pin>
          {/* 이름표는 구체 아래 첫 고리의 바깥쪽에 앉는다(글자 배율만 따른다) */}
          <Pin x={CENTER} y={CENTER + ringRadius("L1")}>
            <div className="pointer-events-none -translate-x-1/2 pt-1.5">
              <span className="craft-label flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-ui-sm">
                {t("desktop.craft.orbit.core.name")}
                <span className="font-mono text-mono-sm opacity-60">
                  {t("desktop.craft.orbit.core.id")}
                </span>
              </span>
            </div>
          </Pin>

          {layout.arcs.map((arc) => {
            const group = snapshot.groups.find((g) => g.id === arc.groupId);
            if (group === undefined) return null;
            if (!groupShown(snapshot, arc.groupId, state.contrib)) return null;
            const mid = pointAt(arc.radius + 16, (arc.from + arc.to) / 2);
            const row = groupRows.find((g) => g.arc.groupId === arc.groupId);
            const dim = row === undefined ? false : (lit.active && !row.inLit) || !row.passes;
            const pickedGroup = state.sel.k === "group" && state.sel.id === group.id;
            return (
              <Pin key={group.id} x={mid.x} y={mid.y}>
                <div
                  className="pointer-events-auto -translate-x-1/2 -translate-y-1/2"
                  style={{ opacity: dim ? 0.4 : 1, transition: "opacity 250ms" }}
                >
                  <button
                    type="button"
                    className="craft-label flex h-7 items-center whitespace-nowrap rounded-full px-3 text-ui-strong font-semibold"
                    data-group=""
                    data-picked={pickedGroup ? "" : undefined}
                    data-lit={groupSel === group.id && !pickedGroup ? "" : undefined}
                    aria-label={t("desktop.craft.orbit.group.name", {
                      name: group.name,
                      term: t("term.pluginGroup"),
                    })}
                    aria-pressed={pickedGroup}
                    onClick={() => onPickGroup(group.id)}
                    onPointerMove={spot}
                  >
                    {group.name}
                  </button>
                </div>
              </Pin>
            );
          })}

          {onMap.map((p) => {
            const d = dotOf.get(p.id);
            if (d === undefined) return null;
            return (
              <Node
                key={p.id}
                plugin={p}
                x={d.x}
                y={d.y}
                right={d.x >= CENTER - 1}
                lit={lit.ids.has(p.id)}
                picked={picked === p.id}
                dim={isDimmed(p, lit, state.kind, state.contrib, state.query)}
                chip={chips.has(p.id)}
                groupName={p.group === undefined ? undefined : groupNameOf(snapshot, p.group)}
                onPick={onPick}
              />
            );
          })}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-20 flex items-center gap-2">
        <ZoomBar percent={vp.percent} onZoom={vp.zoomBy} onFit={vp.fit} />
        <Finder />
      </div>
      {state.sel.k === "layer" && <LayerPanel key={state.sel.id} layer={state.sel.id} />}
    </div>
  );
}

function groupNameOf(snapshot: CanvasSnapshot, gid: string): string {
  return snapshot.groups.find((g) => g.id === gid)?.name ?? gid;
}

/** 그룹 호 하나: 몸(번짐 조각과 본선 조각), 빛 한 칸이 지나는 두 겹, 꺼졌으면 점선 한 줄 */
const GroupArc = memo(function GroupArc(props: {
  readonly arc: OrbitArc;
  readonly index: number;
  readonly on: boolean;
  readonly dim: boolean;
  readonly faded: boolean;
  readonly allOff: boolean;
}): ReactNode {
  const { arc, index, on, dim, faded, allOff } = props;
  const d = arcPath(arc.radius, arc.from, arc.to);
  const opacity = on ? 1 : dim || faded ? 0.25 : 0.7;
  if (allOff) {
    return (
      <g style={{ opacity, transition: "opacity 250ms" }}>
        <path
          pointerEvents="none"
          d={d}
          fill="none"
          strokeLinecap="round"
          style={{
            stroke: "var(--cs-color-info-graphic)",
            strokeOpacity: 0.7,
            strokeWidth: sw(on ? 3 : 2.4),
            strokeDasharray: "calc(2px / var(--k)) calc(10px / var(--k))",
          }}
        />
      </g>
    );
  }
  const segs = groupSegs(arc.radius, arc.from, arc.to);
  const tr = travelOf(index);
  return (
    <g style={{ opacity, transition: "opacity 250ms" }}>
      <g className="craft-fade" style={{ animationDelay: `${420 + index * 40}ms` }}>
        {segs.map((s) => (
          <path
            pointerEvents="none"
            key={`w${s.d}`}
            d={s.d}
            fill="none"
            style={{
              stroke: "var(--cs-color-info-graphic)",
              strokeOpacity: s.a * 0.14,
              strokeWidth: sw(11),
            }}
          />
        ))}
        {segs.map((s) => (
          <path
            pointerEvents="none"
            key={`c${s.d}`}
            d={s.d}
            fill="none"
            style={{
              stroke: "var(--cs-color-info-graphic)",
              strokeOpacity: lineAlpha(s.a),
              strokeWidth: `calc(${on ? 5.2 : 3.6}px * var(--craft-lw, 1) / var(--k))`,
            }}
          />
        ))}
      </g>
      <path
        pointerEvents="none"
        d={d}
        pathLength={1}
        className="craft-travel craft-travel-glow"
        style={{
          stroke: "var(--cs-color-info-graphic)",
          strokeWidth: sw(9),
          strokeOpacity: 0.32,
          animationDuration: `${tr.sec}s`,
          animationDelay: `-${tr.lag}s`,
        }}
      />
      <path
        pointerEvents="none"
        d={d}
        pathLength={1}
        className="craft-travel craft-travel-core"
        style={{
          stroke: "var(--cs-color-text-primary)",
          strokeWidth: sw(2.2),
          animationDuration: `${tr.sec}s`,
          animationDelay: `-${tr.lag}s`,
        }}
      />
    </g>
  );
});
