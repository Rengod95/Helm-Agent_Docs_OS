// 링크(Link): 고른 플러그인 하나가 다른 것들과 어떻게 엮였나. 왼쪽 카드가 고른 것이고, 오른쪽 열이 상대들이며,
// 사이를 잇는 실 묶음이 관계 하나씩이다. 같은 종류의 실은 카드 오른쪽 가장자리의 한 점에서 나온다.
import { Badge, Card, Meter } from "@caustic/react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  HOOKS,
  LAYER_CODE,
  LAYER_NAME,
  OTHER_HOOKS,
  groupById,
  type Plugin,
  type Sel,
} from "./data";
import { Mark, SHAPE_OF } from "./marks";
import {
  REL_LABEL,
  REL_ORDER,
  STATE_LABEL,
  relationsOf,
  type Relation,
  type RelKind,
} from "./relations";
import { useMock } from "./store";
import { reducedMotion } from "./viewport";

/** 위: 도구 막대 아래. 아래: 찾기 줄 위 */
const TOP = 60;
const BOTTOM = 64;
/** 좌우 여백의 기본값(화면 px). 실제 폭은 CSS가 칸의 폭(cqw)에 맞춘다. */
const SIDE = 48;
const ROW_H = 40;
/** 떠 있는 정보 카드와 묶음 사이 간격 */
const FLOAT_GAP = 18;
/** 묶음 쪽 가장자리와 카드 사이 숨 쉴 간격 */
const EDGE_GAP = 12;
/** 연속 실패 기준의 기본값(리뷰 그룹의 maxFailures와 같다) */
const FAIL_LIMIT = 5;
/** 훅 전체 수: 순서 화면의 13개와 나머지 33개 */
const HOOK_TOTAL = HOOKS.length + OTHER_HOOKS.length;

/** 종류의 색: 토큰만 쓴다. 위험(danger)은 종류에 쓰지 않는다. */
const HUE: Record<RelKind, string> = {
  hook: "var(--cs-color-info-graphic)",
  cap: "var(--cs-color-agent-graphic)",
  group: "var(--cs-color-neutral-graphic)",
  drive: "var(--cs-color-warning-graphic)",
  record: "var(--cs-color-success-graphic)",
};

/** 실의 기하(화면 px): 점 가장자리에서 모이고, 행 왼쪽 앞에서 펼쳐져 끝난다. */
const START = 4;
const END = 2;
const NEAR = 1.6;
const FAR = 8;
/** 아무것도 가리키지 않을 때 묶음의 밝기 */
const REST = 0.62;
/** 그리기 지연: 묶음마다 60ms, 같은 묶음 안에서는 실마다 14ms */
const STAGGER_BUNDLE = 60;
const STAGGER_STRAND = 14;

interface Pt {
  x: number;
  y: number;
}
interface Geo {
  w: number;
  h: number;
  /** 종류 점의 가운데(카드 오른쪽 가장자리) */
  anchors: Record<string, Pt>;
  /** 상대 행의 왼쪽 가장자리 가운데 */
  rows: Record<string, Pt>;
  /** 열이 보이는 범위(스크롤 안쪽) */
  view: { top: number; bottom: number };
  /** 카드의 오른쪽 끝, 열의 왼쪽 끝 */
  cardRight: number;
  colLeft: number;
}
interface Bundle {
  key: string;
  kind: RelKind;
  otherId: string;
  rel: Relation;
  /** 그리기 순서(묶음 번호) */
  slot: number;
  hue: string;
  gid: string;
  from: Pt;
  to: Pt;
  /** 실 한 가닥의 경로 */
  strands: string[];
  /** 가운데 실: 빛이 지나가고 누르는 것을 받는다 */
  center: string;
  /** 가운데 실의 점 몇 개(카드가 실을 가리지 않게 잰다) */
  pts: Pt[];
  mid: Pt;
}
/** 가리키는 것: 묶음 하나, 상대 행 하나, 종류 하나 */
type Hov = { k: "bundle"; key: string } | { k: "row"; id: string } | { k: "kind"; kind: RelKind };
interface RowItem {
  other: Plugin;
  list: Relation[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const fx = (v: number): string => v.toFixed(2);
const keyOf = (focusId: string, rel: Relation): string => `${focusId}|${rel.kind}|${rel.other.id}`;

/** 고른 것이 플러그인이면 그것, 그룹이면 그룹의 루트 플러그인, 나머지(에이전트·층·훅·내장)는 Helm */
function focusOf(sel: Sel, plugins: readonly Plugin[]): Plugin | undefined {
  const id = sel.k === "plugin" || sel.k === "group" ? sel.id : "helm";
  return plugins.find((p) => p.id === id) ?? plugins.find((p) => p.id === "helm");
}

function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** 묶음 하나: 점 a에서 행 t까지 실 여러 가닥. 가운데 실이 기준이고 나머지는 위상을 달리한다. */
function bundleOf(focusId: string, rel: Relation, slot: number, a: Pt, t: Pt): Bundle {
  const key = keyOf(focusId, rel);
  const sx = a.x + START;
  const ex = t.x - END;
  const dx = ex - sx;
  // 실 수: 한 줄이면 11가닥, 맞닿은 수만큼 늘어 최대 20가닥
  const n = Math.min(20, 11 + 3 * (rel.count - 1));
  const seed = slot * 1.31;
  const strands: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const o = n === 1 ? 0 : (2 * i) / (n - 1) - 1;
    // 실마다 다른 위상: 복사본이 아니라 짜인 묶음처럼 보이게 한다
    const ph = Math.sin(i * 2.4 + seed);
    const s = { x: sx, y: a.y + o * NEAR };
    const e = { x: ex, y: t.y + o * FAR + ph * 0.8 };
    const c1 = { x: s.x + dx * (0.46 + 0.05 * ph), y: s.y + ph * 1.2 };
    const c2 = { x: e.x - dx * (0.46 - 0.05 * ph), y: e.y - ph * 1.2 };
    strands.push(
      `M${fx(s.x)} ${fx(s.y)}C${fx(c1.x)} ${fx(c1.y)} ${fx(c2.x)} ${fx(c2.y)} ${fx(e.x)} ${fx(e.y)}`,
    );
  }
  const p0 = { x: sx, y: a.y };
  const p3 = { x: ex, y: t.y };
  const c1 = { x: sx + dx * 0.46, y: a.y };
  const c2 = { x: ex - dx * 0.46, y: t.y };
  const pts: Pt[] = [];
  for (let k = 0; k <= 32; k += 1) pts.push(bez(p0, c1, c2, p3, k / 32));
  return {
    key,
    kind: rel.kind,
    otherId: rel.other.id,
    rel,
    slot,
    hue: HUE[rel.kind],
    gid: `wb5link-${key.replace(/[^a-zA-Z0-9]/g, "_")}`,
    from: p0,
    to: p3,
    strands,
    center: `M${fx(p0.x)} ${fx(p0.y)}C${fx(c1.x)} ${fx(c1.y)} ${fx(c2.x)} ${fx(c2.y)} ${fx(p3.x)} ${fx(p3.y)}`,
    pts,
    mid: bez(p0, c1, c2, p3, 0.5),
  };
}

function buildBundles(focusId: string, rels: readonly Relation[], geo: Geo | null): Bundle[] {
  if (geo === null) return [];
  const out: Bundle[] = [];
  rels.forEach((rel) => {
    const a = geo.anchors[rel.kind];
    const row = geo.rows[rel.other.id];
    if (a === undefined || row === undefined) return;
    // 열이 스크롤로 밖에 있으면 실의 끝을 보이는 가장자리에 붙인다
    const y = clamp(row.y, geo.view.top + 10, geo.view.bottom - 10);
    out.push(bundleOf(focusId, rel, out.length, a, { x: row.x, y }));
  });
  return out;
}

/** 밝힐 묶음 키. null이면 모두 같은 밝기다. 가리킨 것이 우선이고, 없으면 고른 묶음이다. 가리킨 것이 묶음이 없으면(바뀐 뒤 남은 값) 밝히지 않는다. */
function litOf(
  hov: Hov | null,
  pick: string | null,
  bundles: readonly Bundle[],
): Set<string> | null {
  if (hov === null) return pick === null ? null : new Set([pick]);
  let keys: string[];
  if (hov.k === "bundle") keys = [hov.key];
  else if (hov.k === "row") {
    const id = hov.id;
    keys = bundles.filter((b) => b.otherId === id).map((b) => b.key);
  } else {
    const kind = hov.kind;
    keys = bundles.filter((b) => b.kind === kind).map((b) => b.key);
  }
  return keys.length === 0 ? null : new Set(keys);
}

/** 떠 있는 카드가 가리킬 묶음. 줄이나 종류를 가리킬 때는 고른 묶음이 그 안에 있을 때만 보인다. */
function shownOf(hov: Hov | null, pick: string | null, lit: Set<string> | null): string | null {
  if (hov === null) return pick;
  if (hov.k === "bundle") return hov.key;
  return pick !== null && lit?.has(pick) === true ? pick : null;
}

/**
 * 떠 있는 카드의 좌상단. 중간점 근처에서, 고른 실을 가리지 않는 자리를 고른다:
 * 카드의 가로 구간 안에서 실의 가장 높은 점 위(또는 가장 낮은 점 아래)에 놓는다.
 * 카드는 점과 행을 가리지 않도록 두 사이의 빈 곳 안에만 둔다.
 */
function placeFloat(b: Bundle, geo: Geo, size: { w: number; h: number }): Pt {
  const lo = geo.cardRight + EDGE_GAP;
  const hi = geo.colLeft - EDGE_GAP - size.w;
  const top0 = TOP + 8;
  const bot = geo.h - BOTTOM - 8 - size.h;
  const cands: { p: Pt; cost: number }[] = [];
  const consider = (x: number, y: number): void => {
    if (y < top0 || y > bot) return;
    const cost = Math.abs(x + size.w / 2 - b.mid.x) + 0.6 * Math.abs(y + size.h / 2 - b.mid.y);
    cands.push({ p: { x, y }, cost });
  };
  // 빈 곳이 카드보다 좁으면 가로는 묶음 가운데에 맞추고, 세로만 고른다
  const xs =
    hi >= lo
      ? [clamp(b.mid.x - size.w / 2, lo, hi), clamp(b.mid.x + 12, lo, hi), lo, hi]
      : [clamp(b.mid.x - size.w / 2, 8, geo.w - size.w - 8)];
  for (const x of xs) {
    const under = b.pts.filter((p) => p.x >= x - 4 && p.x <= x + size.w + 4);
    if (under.length === 0) {
      consider(x, b.mid.y - size.h / 2);
    } else {
      consider(x, Math.min(...under.map((p) => p.y)) - FLOAT_GAP - size.h);
      consider(x, Math.max(...under.map((p) => p.y)) + FLOAT_GAP);
    }
  }
  cands.sort((a, c) => a.cost - c.cost);
  return cands[0]?.p ?? { x: xs[0] ?? 8, y: clamp(b.mid.y - size.h / 2, top0, bot) };
}

/** 상대별 묶음: 관계 수 많은 순, 같으면 이름순(한글 정렬) */
function rowsOf(rels: readonly Relation[]): RowItem[] {
  const by = new Map<string, RowItem>();
  for (const rel of rels) {
    const row = by.get(rel.other.id);
    if (row === undefined) by.set(rel.other.id, { other: rel.other, list: [rel] });
    else row.list.push(rel);
  }
  return [...by.values()].sort(
    (a, b) => b.list.length - a.list.length || a.other.name.localeCompare(b.other.name, "ko"),
  );
}

export function Link({ rightInset }: { rightInset: number }) {
  const m = useMock();
  const focus = focusOf(m.sel, m.plugins);
  const focusId = focus?.id ?? "";
  const rels = useMemo<Relation[]>(
    () => (focus === undefined ? [] : relationsOf(focus, m.plugins, m.order, m.isOn)),
    [focus, m.plugins, m.order, m.isOn],
  );
  const rootRef = useRef<HTMLElement>(null);
  const colRef = useRef<HTMLUListElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const anchorEls = useRef(new Map<string, HTMLElement>());
  const rowEls = useRef(new Map<string, HTMLElement>());
  const frame = useRef(0);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [hov, setHov] = useState<Hov | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [fsz, setFsz] = useState({ w: 0, h: 0 });

  const setAnchor = useCallback((k: string, el: HTMLElement | null): void => {
    if (el === null) anchorEls.current.delete(k);
    else anchorEls.current.set(k, el);
  }, []);
  const setRow = useCallback((id: string, el: HTMLElement | null): void => {
    if (el === null) rowEls.current.delete(id);
    else rowEls.current.set(id, el);
  }, []);

  // 점과 행의 자리는 화면 좌표로 잰다. 열이 스크롤되면 다시 잰다.
  const measure = useCallback((): void => {
    const root = rootRef.current;
    if (root === null) return;
    const base = root.getBoundingClientRect();
    const anchors: Record<string, Pt> = {};
    anchorEls.current.forEach((el, k) => {
      const r = el.getBoundingClientRect();
      anchors[k] = { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
    });
    const rows: Record<string, Pt> = {};
    rowEls.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      rows[id] = { x: r.left - base.left, y: r.top + r.height / 2 - base.top };
    });
    const col = colRef.current?.getBoundingClientRect();
    const card = cardRef.current?.getBoundingClientRect();
    const next: Geo = {
      w: base.width,
      h: base.height,
      anchors,
      rows,
      view:
        col === undefined
          ? { top: 0, bottom: base.height }
          : { top: col.top - base.top, bottom: col.bottom - base.top },
      cardRight: card === undefined ? SIDE : card.right - base.left,
      colLeft: col === undefined ? base.width - SIDE : col.left - base.left,
    };
    setGeo((prev) =>
      prev !== null && JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    );
  }, []);

  const layoutKey = `${focusId}#${rels.map((r) => keyOf(focusId, r)).join(",")}`;
  // 고른 것이 바뀌면 가리킨 것과 고른 묶음은 새 고른 것의 것이 아니다: 함께 놓는다
  useLayoutEffect(() => {
    setHov(null);
    setPick(null);
  }, [focusId]);
  useLayoutEffect(() => {
    measure();
  }, [measure, layoutKey]);
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => measure());
    for (const el of [rootRef.current, colRef.current, cardRef.current]) {
      if (el !== null) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [measure, layoutKey]);
  const later = useCallback((): void => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => measure());
  }, [measure]);

  const bundles = useMemo(() => buildBundles(focusId, rels, geo), [focusId, rels, geo]);
  const lit = litOf(hov, pick, bundles);
  const shownKey = shownOf(hov, pick, lit);
  const shown = shownKey === null ? undefined : bundles.find((b) => b.key === shownKey);
  // 떠 있는 카드의 크기를 재고, 바뀌면 자리를 다시 잡는다
  useLayoutEffect(() => {
    const w = floatRef.current?.offsetWidth ?? 0;
    const h = floatRef.current?.offsetHeight ?? 0;
    if (w !== fsz.w || h !== fsz.h) setFsz({ w, h });
  }, [shownKey, fsz]);
  const place = shown !== undefined && geo !== null ? placeFloat(shown, geo, fsz) : null;

  const reduced = reducedMotion();
  const kinds = REL_ORDER.filter((k) => rels.some((r) => r.kind === k));
  const rows = rowsOf(rels);
  // 밝힌 묶음이 있는 상대 행은 함께 밝힌다
  const hotIds = new Set<string>();
  if (lit !== null) for (const b of bundles) if (lit.has(b.key)) hotIds.add(b.otherId);
  // 고른 묶음은 맨 위에 그린다
  const ordered =
    lit === null
      ? bundles
      : [...bundles.filter((b) => !lit.has(b.key)), ...bundles.filter((b) => lit.has(b.key))];

  if (focus === undefined) return null;
  return (
    <section
      ref={rootRef}
      aria-label="연결"
      className="wb5-link-root absolute inset-0"
      style={{ right: rightInset }}
      onClick={(e) => {
        // 빈 곳을 누르면 고른 묶음만 놓는다(고른 플러그인과 패널은 그대로)
        if (e.target === e.currentTarget) setPick(null);
      }}
    >
      {geo !== null && bundles.length > 0 && (
        <svg
          className="pointer-events-none absolute inset-0"
          width={geo.w}
          height={geo.h}
          viewBox={`0 0 ${geo.w} ${geo.h}`}
          aria-hidden
        >
          <defs>
            {bundles.map((b) => (
              <linearGradient
                key={b.gid}
                id={b.gid}
                gradientUnits="userSpaceOnUse"
                x1={b.from.x}
                y1={b.from.y}
                x2={b.to.x}
                y2={b.to.y}
              >
                <stop offset={0} style={{ stopColor: b.hue }} stopOpacity={0.95} />
                <stop offset={0.6} style={{ stopColor: b.hue }} stopOpacity={0.5} />
                <stop offset={1} style={{ stopColor: b.hue }} stopOpacity={0.22} />
              </linearGradient>
            ))}
          </defs>
          <g key={focusId}>
            {ordered.map((b) => {
              const isLit = lit === null || lit.has(b.key);
              // 쉴 때는 실이 한 덩이로 조용하다. 필터에 안 맞는 상대와 꺼진 상대는 더 흐리다.
              const rest =
                REST * (m.matches(b.rel.other) ? 1 : 0.35) * (m.isOn(b.otherId) ? 1 : 0.55);
              const opacity = lit === null ? rest : isLit ? 1 : 0.15;
              return (
                <g key={b.key} className="wb5-link-bundle" style={{ opacity }} data-bundle={b.key}>
                  {b.strands.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      pathLength={1}
                      className="wb5-link-strand"
                      stroke={`url(#${b.gid})`}
                      style={{
                        animationDelay: `${b.slot * STAGGER_BUNDLE + (i % 4) * STAGGER_STRAND}ms`,
                      }}
                    />
                  ))}
                  {pick === b.key && !reduced && (
                    <path
                      d={b.center}
                      pathLength={1}
                      className="wb5-link-light"
                      style={{ stroke: b.hue }}
                    />
                  )}
                </g>
              );
            })}
          </g>
          <g>
            {bundles.map((b) => (
              <path
                key={b.key}
                d={b.center}
                className="wb5-link-hit"
                pointerEvents="stroke"
                data-hit={b.key}
                onPointerEnter={() => setHov({ k: "bundle", key: b.key })}
                onPointerLeave={() => setHov(null)}
                onClick={() => setPick((p) => (p === b.key ? null : b.key))}
              />
            ))}
          </g>
        </svg>
      )}

      <div
        className="wb5-link-box absolute inset-x-0 flex items-center justify-between"
        style={{ top: TOP, bottom: BOTTOM }}
      >
        <div ref={cardRef} className="wb5-link-left relative flex-none" data-box="link-card">
          <div key={focusId} className="wb5-link-arrive">
            <FocusCard p={focus} />
          </div>
          {kinds.length > 0 && (
            <Anchors kinds={kinds} hov={hov} setAnchor={setAnchor} setHov={setHov} />
          )}
        </div>
        {rows.length > 0 && (
          <ul
            ref={colRef}
            aria-label="연결된 플러그인"
            onScroll={later}
            className="wb5-link-col flex max-h-full flex-none flex-col gap-1.5 overflow-y-auto py-1"
          >
            {rows.map((row, i) => (
              <RelRow
                key={`${focusId}|${row.other.id}`}
                row={row}
                index={i}
                focusId={focusId}
                hot={hotIds.has(row.other.id)}
                pick={pick}
                setHov={setHov}
                setPick={setPick}
                setRow={setRow}
              />
            ))}
          </ul>
        )}
      </div>

      {shown !== undefined && place !== null && (
        <div
          ref={floatRef}
          className="wb5-link-float pointer-events-none absolute z-20"
          style={{ left: place.x, top: place.y }}
          data-box="link-float"
        >
          <FloatCard rel={shown.rel} />
        </div>
      )}
    </section>
  );
}

/** 고른 플러그인의 카드: 이름, 역할, 칩 세 개, 네 개의 값 막대 */
function FocusCard({ p }: { p: Plugin }) {
  const m = useMock();
  const on = m.isOn(p.id);
  const h = m.health(p.id);
  const failing = h !== undefined;
  const grpName = p.group === undefined ? undefined : (groupById(p.group)?.name ?? p.group);
  const state: { text: string; tone: "danger" | "success" | "neutral" } = failing
    ? { text: STATE_LABEL.fail, tone: "danger" }
    : on
      ? { text: STATE_LABEL.on, tone: "success" }
      : { text: STATE_LABEL.off, tone: "neutral" };
  const layerText =
    p.layer === "plugin" ? LAYER_NAME.plugin : `${LAYER_CODE[p.layer]} ${LAYER_NAME[p.layer]}`;
  const capsOf = (q: Plugin): string[] => [
    ...q.provides,
    ...(q.requires ?? []),
    ...(q.optional ?? []),
  ];
  const fails = h?.fails ?? 0;
  const limit = h?.limit ?? FAIL_LIMIT;
  const pieces = m.plugins.reduce((n, q) => n + q.pieces.length, 0);
  const meters = [
    { label: "훅", value: p.hooks.length, max: HOOK_TOTAL, danger: false },
    {
      label: "기능",
      value: new Set(capsOf(p)).size,
      max: new Set(m.plugins.flatMap(capsOf)).size,
      danger: false,
    },
    { label: "구성 요소", value: p.pieces.length, max: pieces, danger: false },
    { label: "연속 실패", value: fails, max: limit, danger: fails >= limit },
  ].map((r) => ({ ...r, text: `${r.value}/${r.max}` }));
  return (
    <Card
      variant="surface"
      size="md"
      shadow="3"
      role="region"
      aria-label={`${p.name} 연결`}
      className="gap-3"
      data-box="link-card-body"
    >
      <div className="flex items-center gap-3">
        <Mark
          shape={SHAPE_OF[p.layer]}
          size={28}
          group={grpName !== undefined}
          on={on}
          failing={failing}
          autoOff={h?.autoOff === true}
        />
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-title-4 text-text-primary">{p.name}</span>
          <span className="truncate text-footnote text-text-tertiary">{p.role}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge size="sm">{layerText}</Badge>
        {grpName !== undefined && (
          <Badge size="sm" tone="info">
            {grpName}
          </Badge>
        )}
        <Badge size="sm" tone={state.tone} dot>
          {state.text}
        </Badge>
      </div>
      <div className="grid gap-2.5 border-t border-border-subtle pt-3">
        {meters.map((r) => (
          <div key={r.label} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-2 text-footnote">
              <span className="text-text-tertiary">{r.label}</span>
              <span className="font-mono text-mono-sm text-text-primary">{r.text}</span>
            </div>
            <Meter
              size="sm"
              value={r.value}
              max={r.max}
              level={r.danger ? "danger" : "normal"}
              label={r.label}
              valueText={r.text}
            />
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 카드 오른쪽 가장자리의 점: 종류마다 하나, 그 종류의 실이 여기서 나온다 */
function Anchors({
  kinds,
  hov,
  setAnchor,
  setHov,
}: {
  kinds: RelKind[];
  hov: Hov | null;
  setAnchor: (k: string, el: HTMLElement | null) => void;
  setHov: Dispatch<SetStateAction<Hov | null>>;
}) {
  return (
    <div className="absolute right-0 top-1/2 flex -translate-y-1/2 translate-x-1/2 flex-col items-center gap-3.5">
      {kinds.map((k) => (
        <span
          key={k}
          ref={(el) => setAnchor(k, el)}
          aria-hidden
          title={REL_LABEL[k]}
          data-kind={k}
          data-hot={hov?.k === "kind" && hov.kind === k ? "" : undefined}
          className="wb5-link-anchor"
          style={{ color: HUE[k] }}
          onPointerEnter={() => setHov({ k: "kind", kind: k })}
          onPointerLeave={() => setHov(null)}
        />
      ))}
    </div>
  );
}

/** 오른쪽 열의 상대 한 줄: 이름, 관계 수, 종류 점(누르면 그 실을 고른다) */
function RelRow({
  row,
  index,
  focusId,
  hot,
  pick,
  setHov,
  setPick,
  setRow,
}: {
  row: RowItem;
  index: number;
  focusId: string;
  hot: boolean;
  pick: string | null;
  setHov: Dispatch<SetStateAction<Hov | null>>;
  setPick: Dispatch<SetStateAction<string | null>>;
  setRow: (id: string, el: HTMLElement | null) => void;
}) {
  const m = useMock();
  const { other, list } = row;
  const on = m.isOn(other.id);
  const h = m.health(other.id);
  const picked = list.some((r) => keyOf(focusId, r) === pick);
  return (
    <li
      ref={(el) => setRow(other.id, el)}
      className="flex-none"
      style={{ height: ROW_H }}
      onPointerEnter={() => setHov({ k: "row", id: other.id })}
      onPointerLeave={() => setHov(null)}
    >
      <div
        className="wb5-link-arrive wb5-link-row flex h-full items-center gap-1 rounded-xl border border-border-subtle bg-surface-raised ps-1 pe-1.5 shadow-1"
        style={{ animationDelay: `${index * 28}ms`, opacity: m.matches(other) ? 1 : 0.35 }}
        data-hot={hot ? "" : undefined}
        data-pick={picked ? "" : undefined}
        data-box={`link-row-${other.id}`}
      >
        <button
          type="button"
          className="wb5-link-main flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent p-0 text-start outline-none"
          onClick={() => {
            setPick(null);
            m.select({ k: "plugin", id: other.id }, m.panel);
          }}
          onFocus={() => setHov({ k: "row", id: other.id })}
          onBlur={() => setHov(null)}
        >
          <Mark
            shape={SHAPE_OF[other.layer]}
            size={18}
            group={other.group !== undefined}
            on={on}
            failing={h !== undefined}
            autoOff={h?.autoOff === true}
          />
          <span
            className={`min-w-0 flex-1 truncate text-ui-strong ${on ? "text-text-primary" : "text-text-tertiary"}`}
          >
            {other.name}
          </span>
          <Badge size="xs">{list.length}</Badge>
        </button>
        <span className="flex flex-none items-center">
          {list.map((r) => {
            const k = keyOf(focusId, r);
            return (
              <button
                key={r.kind}
                type="button"
                className="wb5-link-dot"
                style={{ color: HUE[r.kind] }}
                aria-pressed={pick === k}
                aria-label={`${other.name} ${REL_LABEL[r.kind]}`}
                title={REL_LABEL[r.kind]}
                onClick={() => setPick((p) => (p === k ? null : k))}
                onPointerEnter={() => setHov({ k: "bundle", key: k })}
                onPointerLeave={() => setHov({ k: "row", id: other.id })}
                onFocus={() => setHov({ k: "bundle", key: k })}
                onBlur={() => setHov(null)}
              >
                <span aria-hidden />
              </button>
            );
          })}
        </span>
      </div>
    </li>
  );
}

/** 떠 있는 정보 카드: 종류 이름, 상대 이름, 줄마다 이름과 값(경계가 있으면 막대) */
function FloatCard({ rel }: { rel: Relation }) {
  return (
    <Card
      variant="surface"
      size="sm"
      shadow="4"
      className="wb5-link-arrive gap-2"
      data-box="link-float-card"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="wb5-link-caps flex items-center gap-1.5">
          <span aria-hidden className="wb5-link-tick" style={{ color: HUE[rel.kind] }} />
          {REL_LABEL[rel.kind]}
        </span>
        {rel.count > 1 && <Badge size="xs">+{rel.count - 1}</Badge>}
      </div>
      <span className="truncate text-title-4 text-text-primary">{rel.other.name}</span>
      <div className="grid gap-2 border-t border-border-subtle pt-2.5">
        {rel.facts.map((f) => (
          <div key={f.label} className="grid gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-footnote text-text-tertiary">{f.label}</span>
              <span className="grid min-w-0 justify-items-end">
                <span
                  className={`max-w-[10rem] truncate text-ui-sm text-text-primary ${f.mono ? "font-mono text-mono-sm" : ""}`}
                >
                  {f.value}
                </span>
                {f.note !== "" && (
                  <span className="font-mono text-mono-sm text-text-tertiary">{f.note}</span>
                )}
              </span>
            </div>
            {f.meter !== null && (
              <Meter
                size="sm"
                value={f.meter.value}
                max={f.meter.max}
                label={f.label}
                valueText={f.value}
              />
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
