// 링크(Link): 고른 플러그인 하나가 다른 것들과 어떻게 엮였나. 왼쪽 카드가 초점이고, 오른쪽 열이 상대들이며,
// 사이를 잇는 실 묶음이 관계 종류마다 하나다. 같은 종류의 실은 카드 오른쪽 가장자리의 한 점에서 나온다.
import { Badge, Card, Meter, StatusDot } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import {
  HOOKS,
  OTHER_HOOKS,
  hooksInOrder,
  isOn,
  relationsOf,
  type CanvasPlugin,
  type LayerKey,
  type Relation,
  type RelKind,
} from "@fresnel/client/workbench/canvas";
import { Bug } from "@fresnel/contracts";
import {
  Fragment,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useCraft } from "./craft-context.tsx";
import {
  focusOf,
  kindsOf,
  relationContext,
  rowsOf,
  visibleFacts,
  type LinkRow,
} from "./link-model.ts";
import { LINK_CSS } from "./link-style.ts";
import { matchesFilter } from "./strata-model.ts";

// 위: 도구 막대 아래. 아래: 찾기 줄 위. 화면(크래프트 셸)의 막대 높이에 맞춘 여백이다.
const TOP = 60;
const BOTTOM = 64;
/** 좌우 여백의 기본값(화면 px). 실제 폭은 CSS가 칸의 폭(cqw)에 맞춘다 */
const SIDE = 48;
const ROW_H = 40;
/** 떠 있는 정보 카드와 묶음 사이 간격 */
const FLOAT_GAP = 18;
/** 묶음 쪽 가장자리와 카드 사이 숨 쉴 간격 */
const EDGE_GAP = 12;
/** 연속 실패 기준의 기본값. 실패 기록이 없을 때 막대의 최대치로만 쓴다(리뷰 그룹의 maxFailures와 같다) */
const FAIL_LIMIT = 5;
/** 훅 전체 수: 순서 화면의 13개와 나머지 33개 */
const HOOK_TOTAL = HOOKS.length + OTHER_HOOKS.length;

/** 종류의 색. 값은 link.css가 caustic 토큰으로 정한다. 위험(danger)은 종류에 쓰지 않는다. */
const HUE: Readonly<Record<RelKind, string>> = {
  hook: "var(--craft-link-hue-hook)",
  cap: "var(--craft-link-hue-cap)",
  group: "var(--craft-link-hue-group)",
  drive: "var(--craft-link-hue-drive)",
  record: "var(--craft-link-hue-record)",
};

/** 실의 기하(화면 px): 점 가장자리에서 모이고, 행 가장자리의 점에서 끝난다 */
const START = 4;
const DOT_R = 2.4;
const END = DOT_R;
const NEAR = 1.6;
const FAR = 8;
/** 같은 행으로 가는 묶음들의 끝점 간격(세로) */
const ROW_STEP = 6;
/** 아무것도 가리키지 않을 때 묶음의 밝기 */
const REST = 0.8;
/** 가리킨 것이 있을 때 밝히지 않은 묶음의 밝기: 지우지 않고 따라갈 수 있게 남긴다 */
const DIM = 0.2;
/** 그리기 지연: 묶음마다 60ms, 같은 묶음 안에서는 실마다 14ms */
const STAGGER_BUNDLE = 60;
const STAGGER_STRAND = 14;

const KIND_TEXT: Readonly<Record<RelKind, MessageId>> = {
  hook: "desktop.craft.link.kind.hook",
  cap: "desktop.craft.link.kind.cap",
  group: "desktop.craft.link.kind.group",
  drive: "desktop.craft.link.kind.drive",
  record: "desktop.craft.link.kind.record",
};

/** 층 이름은 용어집의 값을 쓴다(term.* 키는 용어 검사가 맡는다). 외부 플러그인만 이 화면의 말이다 */
const LAYER_TEXT: Readonly<Record<LayerKey, MessageId>> = {
  L1: "term.layerAgentCore",
  L2: "term.layerCapabilities",
  L3: "term.layerOrchestration",
  plugin: "desktop.craft.link.layer.plugin",
};

/** 관계 모형이 내는 번역 키(relations.ts의 labelKey·msg keys)를 이 조각의 메시지 id로 옮긴다 */
const REL_TEXT: Readonly<Record<string, MessageId>> = {
  "rel.fact.hook": "desktop.craft.link.rel.fact.hook",
  "rel.fact.dir": "desktop.craft.link.rel.fact.dir",
  "rel.fact.rule": "desktop.craft.link.rel.fact.rule",
  "rel.fact.order": "desktop.craft.link.rel.fact.order",
  "rel.fact.failure": "desktop.craft.link.rel.fact.failure",
  "rel.fact.cap": "desktop.craft.link.rel.fact.cap",
  "rel.fact.need": "desktop.craft.link.rel.fact.need",
  "rel.fact.providers": "desktop.craft.link.rel.fact.providers",
  "rel.fact.peer": "desktop.craft.link.rel.fact.peer",
  "rel.fact.group": "desktop.craft.link.rel.fact.group",
  "rel.fact.version": "desktop.craft.link.rel.fact.version",
  "rel.fact.members": "desktop.craft.link.rel.fact.members",
  "rel.fact.drive": "desktop.craft.link.rel.fact.drive",
  "rel.fact.limit": "desktop.craft.link.rel.fact.limit",
  "rel.fact.recordKind": "desktop.craft.link.rel.fact.recordKind",
  "rel.fact.prefix": "desktop.craft.link.rel.fact.prefix",
  "rel.dir.before": "desktop.craft.link.rel.dir.before",
  "rel.dir.after": "desktop.craft.link.rel.dir.after",
  "rel.dir.provide": "desktop.craft.link.rel.dir.provide",
  "rel.dir.use": "desktop.craft.link.rel.dir.use",
  "rel.dir.write": "desktop.craft.link.rel.dir.write",
  "rel.dir.read": "desktop.craft.link.rel.dir.read",
  "rel.fold.tap": "desktop.craft.link.rel.fold.tap",
  "rel.fold.first": "desktop.craft.link.rel.fold.first",
  "rel.fold.chain": "desktop.craft.link.rel.fold.chain",
  "rel.fold.collect": "desktop.craft.link.rel.fold.collect",
  "rel.fail.closed": "desktop.craft.link.rel.fail.closed",
  "rel.fail.open": "desktop.craft.link.rel.fail.open",
  "rel.fail.skip": "desktop.craft.link.rel.fail.skip",
  "rel.need.required": "desktop.craft.link.rel.need.required",
  "rel.need.optional": "desktop.craft.link.rel.need.optional",
  "rel.state.on": "desktop.craft.link.state.on",
  "rel.state.off": "desktop.craft.link.state.off",
  "rel.drive.holds": "desktop.craft.link.rel.drive.holds",
  "rel.drive.contend": "desktop.craft.link.rel.drive.contend",
};

/** 모형이 낸 키가 표에 없으면 모형과 표가 어긋난 것이라 Bug다 */
function relText(key: string): string {
  const id = REL_TEXT[key];
  if (id === undefined) throw new Bug(`link: relation key ${key} has no message id`);
  return t(id);
}

type FactValue = Relation["facts"][number]["value"];
function valueText(value: FactValue): string {
  return value.k === "msg" ? value.keys.map(relText).join(" · ") : value.text;
}

interface Pt {
  readonly x: number;
  readonly y: number;
}
interface Geo {
  readonly w: number;
  readonly h: number;
  /** 종류 점의 가운데(카드 오른쪽 가장자리) */
  readonly anchors: Readonly<Record<string, Pt>>;
  /** 상대 행의 왼쪽 가장자리 가운데 */
  readonly rows: Readonly<Record<string, Pt>>;
  /** 열이 보이는 범위(스크롤 안쪽) */
  readonly view: { readonly top: number; readonly bottom: number };
  /** 카드의 오른쪽 끝, 열의 왼쪽 끝 */
  readonly cardRight: number;
  readonly colLeft: number;
}
interface Strand {
  readonly full: string;
  readonly head: string;
}
interface Bundle {
  readonly key: string;
  readonly kind: RelKind;
  readonly otherId: string;
  readonly rel: Relation;
  readonly slot: number;
  readonly gid: string;
  readonly from: Pt;
  readonly to: Pt;
  readonly strands: readonly Strand[];
  /** 가운데 실: 빛이 지나가고 누르는 것을 받는다 */
  readonly center: string;
  /** 가운데 실의 점들(카드가 실을 가리지 않게 잰다) */
  readonly pts: readonly Pt[];
  readonly mid: Pt;
}
/** 가리키는 것: 묶음 하나, 상대 행 하나, 종류 하나 */
type Hov =
  | { readonly k: "bundle"; readonly key: string }
  | { readonly k: "row"; readonly id: string }
  | { readonly k: "kind"; readonly kind: RelKind };
type BundleState = "sel" | "hot" | "dim" | "rest";
const RANK: Readonly<Record<BundleState, number>> = { dim: 0, rest: 1, hot: 2, sel: 3 };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const fx = (v: number): string => v.toFixed(2);
const keyOf = (focusId: string, rel: Relation): string => `${focusId}|${rel.kind}|${rel.other.id}`;

/** 움직임 줄이기 설정. 창이나 matchMedia가 없으면(그리기 전 시험 환경) 줄이지 않는다 */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function bez(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): Pt {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** 가닥 하나의 전체와 앞 절반(t=0.5까지의 곡선, 드 카스텔조 분할) */
function strandOf(s: Pt, c1: Pt, c2: Pt, e: Pt): Strand {
  const half = (p: Pt, q: Pt): Pt => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  const m01 = half(s, c1);
  const m12 = half(c1, c2);
  const m23 = half(c2, e);
  const m012 = half(m01, m12);
  const m123 = half(m12, m23);
  const mid = half(m012, m123);
  return {
    full: `M${fx(s.x)} ${fx(s.y)}C${fx(c1.x)} ${fx(c1.y)} ${fx(c2.x)} ${fx(c2.y)} ${fx(e.x)} ${fx(e.y)}`,
    head: `M${fx(s.x)} ${fx(s.y)}C${fx(m01.x)} ${fx(m01.y)} ${fx(m012.x)} ${fx(m012.y)} ${fx(mid.x)} ${fx(mid.y)}`,
  };
}

/** 묶음 하나: 점 a에서 행 end까지 실 여러 가닥. 가운데 실이 기준이고 나머지는 위상을 달리한다 */
function bundleOf(focusId: string, rel: Relation, slot: number, a: Pt, end: Pt): Bundle {
  const key = keyOf(focusId, rel);
  const sx = a.x + START;
  const ex = end.x - END;
  const dx = ex - sx;
  // 실 수: 한 줄이면 11가닥, 맞닿은 수만큼 늘어 최대 20가닥
  const n = Math.min(20, 11 + 3 * (rel.count - 1));
  const seed = slot * 1.31;
  const strands: Strand[] = [];
  for (let i = 0; i < n; i += 1) {
    const o = n === 1 ? 0 : (2 * i) / (n - 1) - 1;
    // 실마다 다른 위상: 복사본이 아니라 짜인 묶음처럼 보이게 한다
    const ph = Math.sin(i * 2.4 + seed);
    const s = { x: sx, y: a.y + o * NEAR };
    const e = { x: ex, y: end.y + o * FAR + ph * 0.8 };
    const c1 = { x: s.x + dx * (0.46 + 0.05 * ph), y: s.y + ph * 1.2 };
    const c2 = { x: e.x - dx * (0.46 - 0.05 * ph), y: e.y - ph * 1.2 };
    strands.push(strandOf(s, c1, c2, e));
  }
  const p0 = { x: sx, y: a.y };
  const p3 = { x: ex, y: end.y };
  const c1 = { x: sx + dx * 0.46, y: a.y };
  const c2 = { x: ex - dx * 0.46, y: end.y };
  const pts: Pt[] = [];
  for (let k = 0; k <= 32; k += 1) pts.push(bez(p0, c1, c2, p3, k / 32));
  return {
    key,
    kind: rel.kind,
    otherId: rel.other.id,
    rel,
    slot,
    gid: `craft-link-${key.replace(/[^a-zA-Z0-9]/g, "_")}`,
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
  // 같은 행으로 가는 묶음은 끝점을 세로로 나눠 점이 겹치지 않게 한다
  const perRow = new Map<string, number>();
  for (const rel of rels) perRow.set(rel.other.id, (perRow.get(rel.other.id) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const rel of rels) {
    const a = geo.anchors[rel.kind];
    const row = geo.rows[rel.other.id];
    if (a === undefined || row === undefined) continue;
    const n = perRow.get(rel.other.id) ?? 1;
    const k = seen.get(rel.other.id) ?? 0;
    seen.set(rel.other.id, k + 1);
    // 열이 스크롤로 밖에 있으면 실의 끝을 보이는 가장자리에 붙인다
    const y = clamp(row.y + (k - (n - 1) / 2) * ROW_STEP, geo.view.top + 10, geo.view.bottom - 10);
    out.push(bundleOf(focusId, rel, out.length, a, { x: row.x, y }));
  }
  return out;
}

/** 가리킨 것이 밝히는 묶음 키들. 묶음이 없는 것은 아무것도 밝히지 않는다 */
function hotOf(hov: Hov | null, bundles: readonly Bundle[]): Set<string> {
  if (hov === null) return new Set();
  let keys: Bundle[];
  if (hov.k === "bundle") {
    const key = hov.key;
    keys = bundles.filter((b) => b.key === key);
  } else if (hov.k === "row") {
    const id = hov.id;
    keys = bundles.filter((b) => b.otherId === id);
  } else {
    const kind = hov.kind;
    keys = bundles.filter((b) => b.kind === kind);
  }
  return new Set(keys.map((b) => b.key));
}

/** 떠 있는 카드가 가리킬 묶음. 줄이나 종류를 가리킬 때는 고른 묶음이 그 안에 있을 때만 보인다 */
function shownOf(hov: Hov | null, pick: string | null, hot: ReadonlySet<string>): string | null {
  if (hov === null) return pick;
  if (hov.k === "bundle") return hov.key;
  return pick !== null && hot.has(pick) ? pick : null;
}

/**
 * 떠 있는 카드의 좌상단. 묶음의 가운데 근처에서, 실을 가리지 않는 빈 곳에 둔다:
 * 카드의 가로 구간 안에서 실의 가장 높은 점 위(또는 가장 낮은 점 아래)에 놓는다.
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

/** 링크 보기. 고른 것에서 초점 플러그인을 고르고, 초점이 바뀌면 캔버스를 새로 만든다 */
export function LinkView(): ReactNode {
  const { source, state } = useCraft();
  const focus = focusOf(state.sel, source.snapshot);
  if (focus === undefined) {
    return <p className="m-0 p-6 text-ui-sm text-text-tertiary">{t("desktop.craft.link.empty")}</p>;
  }
  return <LinkCanvas key={focus.id} focus={focus} />;
}

function LinkCanvas({ focus }: { readonly focus: CanvasPlugin }): ReactNode {
  const { source, state, dispatch } = useCraft();
  const { snapshot } = source;
  const focusId = focus.id;
  const rels = useMemo<Relation[]>(
    () =>
      relationsOf(
        focus,
        snapshot,
        relationContext(snapshot, hooksInOrder(snapshot.plugins, source.order)),
      ),
    [focus, snapshot, source.order],
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
    // 떠 있는 카드의 크기도 여기서 잰다(같은 값이면 상태를 그대로 둔다)
    const fw = floatRef.current?.offsetWidth ?? 0;
    const fh = floatRef.current?.offsetHeight ?? 0;
    setFsz((prev) => (prev.w === fw && prev.h === fh ? prev : { w: fw, h: fh }));
  }, []);

  // 그릴 때마다 잰다. 값이 같으면 measure가 상태를 그대로 둬서 다시 그리지 않는다
  useLayoutEffect(() => {
    measure();
  });
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => measure());
    for (const el of [rootRef.current, cardRef.current]) {
      if (el !== null) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [measure]);
  const later = useCallback((): void => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => measure());
  }, [measure]);

  const bundles = useMemo(() => buildBundles(focusId, rels, geo), [focusId, rels, geo]);
  const hot = hotOf(hov, bundles);
  const selKey = bundles.some((b) => b.key === pick) ? pick : null;
  const shownKey = shownOf(hov, pick, hot);
  const shown = shownKey === null ? undefined : bundles.find((b) => b.key === shownKey);
  const place = shown !== undefined && geo !== null ? placeFloat(shown, geo, fsz) : null;

  const reduced = prefersReducedMotion();
  const kinds = kindsOf(rels);
  const rows = rowsOf(rels);
  // 가리키거나 고른 묶음이 있는 상대 행은 함께 옅게 깐다
  const hotIds = new Set<string>();
  for (const b of bundles) if (b.key === selKey || hot.has(b.key)) hotIds.add(b.otherId);
  // 묶음의 상태: 고른 것 > 가리킨 것 > 쉬는 것. 가리킨 것이 있을 때는 나머지는 흐리다
  const dimming = hot.size > 0 || selKey !== null;
  const markOf = (key: string): BundleState =>
    key === selKey ? "sel" : hot.has(key) ? "hot" : dimming ? "dim" : "rest";
  // 밝은 것은 위에 그린다: 흐린 것, 쉬는 것, 가리킨 것, 고른 것 순
  const ordered = bundles.toSorted((a, c) => RANK[markOf(a.key)] - RANK[markOf(c.key)]);

  return (
    <section
      ref={rootRef}
      aria-label={t("desktop.craft.link.label")}
      className="craft-link-root absolute inset-0"
      onClick={(e) => {
        // 빈 곳을 누르면 고른 묶음만 놓는다(고른 플러그인과 패널은 그대로)
        if (e.target === e.currentTarget) setPick(null);
      }}
    >
      <style>{LINK_CSS}</style>
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
                <stop offset={0} style={{ stopColor: HUE[b.kind] }} stopOpacity={1} />
                <stop offset={0.55} style={{ stopColor: HUE[b.kind] }} stopOpacity={0.8} />
                <stop offset={1} style={{ stopColor: HUE[b.kind] }} stopOpacity={0.6} />
              </linearGradient>
            ))}
          </defs>
          <g key={focusId}>
            {ordered.map((b) => {
              const mark = markOf(b.key);
              // 쉴 때는 실이 한 덩이로 조용하다. 필터에 안 맞는 상대와 꺼진 상대는 더 흐리다
              const other = snapshot.plugins.find((p) => p.id === b.otherId);
              const rest =
                REST *
                (other !== undefined && matchesFilter(other, state.kind, state.contrib)
                  ? 1
                  : 0.35) *
                (other !== undefined && isOn(other) ? 1 : 0.55);
              const opacity = mark === "rest" ? rest : mark === "dim" ? DIM : 1;
              return (
                <g
                  key={b.key}
                  className="craft-link-bundle"
                  style={{ opacity }}
                  data-bundle={b.key}
                  data-state={mark}
                >
                  {b.strands.map((s, i) => {
                    const delay = b.slot * STAGGER_BUNDLE + (i % 4) * STAGGER_STRAND;
                    return (
                      <Fragment key={s.full}>
                        <path
                          d={s.full}
                          pathLength={1}
                          className="craft-link-strand"
                          stroke={`url(#${b.gid})`}
                          style={{ animationDelay: `${delay}ms` }}
                        />
                        <path
                          d={s.head}
                          pathLength={1}
                          className="craft-link-strand craft-link-head"
                          stroke={`url(#${b.gid})`}
                          style={{ animationDelay: `${delay}ms`, animationDuration: "350ms" }}
                        />
                      </Fragment>
                    );
                  })}
                  <circle
                    cx={b.to.x}
                    cy={b.to.y}
                    r={DOT_R}
                    className="craft-link-end"
                    style={{
                      fill: HUE[b.kind],
                      animationDelay: `${b.slot * STAGGER_BUNDLE + 600}ms`,
                    }}
                  />
                  {mark === "sel" && !reduced && (
                    <path
                      d={b.center}
                      pathLength={1}
                      className="craft-link-light"
                      style={{ stroke: HUE[b.kind] }}
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
                className="craft-link-hit"
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
        className="craft-link-box absolute inset-x-0 flex items-center justify-between"
        style={{ top: TOP, bottom: BOTTOM }}
      >
        <div ref={cardRef} className="craft-link-left relative flex-none" data-box="link-card">
          <div className="craft-link-arrive">
            <FocusCard p={focus} />
          </div>
          {kinds.length > 0 && (
            <Anchors kinds={kinds} hov={hov} setAnchor={setAnchor} setHov={setHov} />
          )}
        </div>
        {rows.length > 0 && (
          <ul
            ref={colRef}
            aria-label={t("desktop.craft.link.list")}
            onScroll={later}
            className="craft-link-col flex max-h-full flex-none flex-col gap-1.5 overflow-y-auto py-1"
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
                onSelect={(id) => dispatch({ t: "selectPlugin", id })}
              />
            ))}
          </ul>
        )}
      </div>

      {shown !== undefined && place !== null && (
        <div
          ref={floatRef}
          className="craft-link-float pointer-events-none absolute z-20"
          style={{ left: place.x, top: place.y }}
        >
          <FloatCard rel={shown.rel} />
        </div>
      )}
    </section>
  );
}

/** 기능 이름들: 제공, 필요, 선택을 모두 모은다(중복은 호출한 쪽이 센다) */
function capsOf(q: CanvasPlugin): string[] {
  return [...q.provides, ...(q.requires ?? []), ...(q.optional ?? [])];
}

interface MeterRow {
  readonly label: string;
  readonly value: number;
  readonly max: number;
  readonly danger: boolean;
  readonly text: string;
}
function meterOf(label: string, value: number, max: number, danger: boolean): MeterRow {
  return { label, value, max, danger, text: `${value}/${max}` };
}

/** 상태 점: 실패는 붉은 채움, 켜짐은 채움, 꺼짐은 속 빔. 색만으로 읽히지 않게 모양을 다르게 둔다 */
function StateDot({ on, failing }: { readonly on: boolean; readonly failing: boolean }): ReactNode {
  const fill = failing
    ? "bg-danger-graphic"
    : on
      ? "bg-text-primary"
      : "border border-text-tertiary bg-transparent";
  return <span aria-hidden className={`inline-block size-2.5 flex-none rounded-full ${fill}`} />;
}

/** 고른 플러그인의 카드: 이름, 역할, 칩 세 개, 네 개의 값 막대 */
function FocusCard({ p }: { readonly p: CanvasPlugin }): ReactNode {
  const { source } = useCraft();
  const { snapshot } = source;
  const on = isOn(p);
  const h = p.health;
  const failing = h !== undefined;
  const group = p.group === undefined ? undefined : snapshot.groups.find((g) => g.id === p.group);
  const grpName = p.group === undefined ? undefined : (group?.name ?? p.group);
  const stateText: { text: string; tone: "danger" | "success" | "neutral" } = failing
    ? { text: t("desktop.craft.link.state.fail"), tone: "danger" }
    : on
      ? { text: t("desktop.craft.link.state.on"), tone: "success" }
      : { text: t("desktop.craft.link.state.off"), tone: "neutral" };
  const fails = h?.fails ?? 0;
  const limit = h?.limit ?? FAIL_LIMIT;
  const pieces = snapshot.plugins.reduce((n, q) => n + q.pieces.length, 0);
  const meters = [
    meterOf(t("desktop.craft.link.meter.hook"), p.hooks.length, HOOK_TOTAL, false),
    meterOf(
      t("desktop.craft.link.meter.cap"),
      new Set(capsOf(p)).size,
      new Set(snapshot.plugins.flatMap(capsOf)).size,
      false,
    ),
    meterOf(t("desktop.craft.link.meter.pieces"), p.pieces.length, pieces, false),
    meterOf(t("desktop.craft.link.meter.fails"), fails, limit, fails >= limit),
  ];
  return (
    <Card
      variant="surface"
      size="md"
      shadow="3"
      role="region"
      aria-label={t("desktop.craft.link.card", { name: p.name })}
      className="gap-3"
    >
      <div className="flex items-center gap-3">
        <StateDot on={on} failing={failing} />
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-title-4 text-text-primary">{p.name}</span>
          {p.role !== undefined && (
            <span className="truncate text-footnote text-text-tertiary">{p.role}</span>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge size="sm">{t(LAYER_TEXT[p.layer])}</Badge>
        {grpName !== undefined && <Badge size="sm">{grpName}</Badge>}
        <StatusDot tone={stateText.tone} label={stateText.text} />
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
  readonly kinds: readonly RelKind[];
  readonly hov: Hov | null;
  readonly setAnchor: (k: string, el: HTMLElement | null) => void;
  readonly setHov: Dispatch<SetStateAction<Hov | null>>;
}): ReactNode {
  return (
    <div className="absolute right-0 top-1/2 flex -translate-y-1/2 translate-x-1/2 flex-col items-center gap-3.5">
      {kinds.map((k) => (
        <span
          key={k}
          ref={(el) => setAnchor(k, el)}
          aria-hidden
          title={t(KIND_TEXT[k])}
          data-kind={k}
          data-hot={hov?.k === "kind" && hov.kind === k ? "" : undefined}
          className="craft-link-anchor"
          style={{ color: HUE[k] }}
          onPointerEnter={() => setHov({ k: "kind", kind: k })}
          onPointerLeave={() => setHov(null)}
        />
      ))}
    </div>
  );
}

/** 오른쪽 열의 상대 한 줄: 이름, 관계가 여럿이면 그 수, 종류 점(누르면 그 실을 고른다) */
function RelRow({
  row,
  index,
  focusId,
  hot,
  pick,
  setHov,
  setPick,
  setRow,
  onSelect,
}: {
  readonly row: LinkRow;
  readonly index: number;
  readonly focusId: string;
  readonly hot: boolean;
  readonly pick: string | null;
  readonly setHov: Dispatch<SetStateAction<Hov | null>>;
  readonly setPick: Dispatch<SetStateAction<string | null>>;
  readonly setRow: (id: string, el: HTMLElement | null) => void;
  readonly onSelect: (id: string) => void;
}): ReactNode {
  const { state } = useCraft();
  const { other, list } = row;
  const on = isOn(other);
  const failing = other.health !== undefined;
  const picked = list.some((r) => keyOf(focusId, r) === pick);
  const matches = matchesFilter(other, state.kind, state.contrib);
  return (
    <li
      ref={(el) => setRow(other.id, el)}
      className="flex-none"
      style={{ height: ROW_H }}
      onPointerEnter={() => setHov({ k: "row", id: other.id })}
      onPointerLeave={() => setHov(null)}
    >
      <div
        className="craft-link-arrive craft-link-row flex h-full items-center gap-1 rounded-xl border border-border-subtle bg-surface-raised ps-1 pe-1.5 shadow-1"
        style={{ animationDelay: `${index * 28}ms`, opacity: matches ? 1 : 0.35 }}
        data-hot={hot ? "" : undefined}
        data-pick={picked ? "" : undefined}
      >
        <button
          type="button"
          className="craft-link-main flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border-0 bg-transparent p-0 text-start outline-none"
          onClick={() => {
            // 줄을 누르면 그 플러그인이 새 초점이 된다(선택이 바뀌면 카드와 실이 다시 그려진다)
            setPick(null);
            onSelect(other.id);
          }}
          onFocus={() => setHov({ k: "row", id: other.id })}
          onBlur={() => setHov(null)}
        >
          <StateDot on={on} failing={failing} />
          <span
            className={`min-w-0 flex-1 truncate text-ui-strong ${on ? "text-text-primary" : "text-text-tertiary"}`}
          >
            {other.name}
          </span>
          {list.length > 1 && <Badge size="xs">{list.length}</Badge>}
        </button>
        <span className="flex flex-none items-center">
          {list.map((r) => {
            const k = keyOf(focusId, r);
            return (
              <button
                key={r.kind}
                type="button"
                className="craft-link-dot"
                style={{ color: HUE[r.kind] }}
                aria-pressed={pick === k}
                aria-label={t("desktop.craft.link.dot", {
                  name: other.name,
                  kind: t(KIND_TEXT[r.kind]),
                })}
                title={t(KIND_TEXT[r.kind])}
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
function FloatCard({ rel }: { readonly rel: Relation }): ReactNode {
  const facts = visibleFacts(rel);
  return (
    <Card variant="surface" size="sm" shadow="4" className="craft-link-arrive gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="craft-link-caps flex items-center gap-1.5">
          <span aria-hidden className="craft-link-tick" style={{ color: HUE[rel.kind] }} />
          {t(KIND_TEXT[rel.kind])}
        </span>
        {rel.count > 1 && <Badge size="xs">{`+${rel.count - 1}`}</Badge>}
      </div>
      <span className="truncate text-title-4 text-text-primary">{rel.other.name}</span>
      <div className="grid gap-2 border-t border-border-subtle pt-2.5">
        {facts.map((f) => {
          const label = relText(f.labelKey);
          const value = valueText(f.value);
          return (
            <div key={f.labelKey} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-footnote text-text-tertiary">{label}</span>
                <span className="grid min-w-0 justify-items-end">
                  <span
                    className={`max-w-[10rem] truncate text-ui-sm text-text-primary ${f.mono ? "font-mono text-mono-sm" : ""}`}
                  >
                    {value}
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
                  label={label}
                  valueText={value}
                />
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
