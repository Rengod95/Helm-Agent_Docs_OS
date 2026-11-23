// cv6 프로필 캔버스: 가로 레일(바닥 층) 위에 플러그인 판(뜬 층)이 붙는 자리마다 서고, 상세는 맨 위 층의 플로팅 판에 뜬다.
// 바닥은 아주 옅은 점 격자이고 화면 가장자리로 갈수록 어둠에 묻힌다(비네트). 고른 판 뒤에는 종류 색의 빛이 번지고 그 자리의 점이 물든다.
// 사이드 패널에서 줄을 누르면 캔버스가 그 노드로 부드럽게 옮겨 가고(멀면 확대), 노드가 한 번 밝아지며 상세가 열린다.
// 키보드(캔버스): 화살표 = 그 방향의 다음 노드, Enter = 상세, Shift+Enter = 안으로, Alt+↑↓ = 같은 자리 안 순서, Delete = 빼기, Esc = 닫기.
// 끌기: 목록 줄을 캔버스에 놓으면 넣고(붙는 자리가 미리 밝아진다), 판을 목록으로 끌어 놓으면 뺀다.
import { t, type MessageId } from "@fresnel/client/i18n";
import { FloatingBar, FloatingBarItem, FloatingBarSeparator, ZoomControl } from "@caustic/react";
import { Maximize } from "@caustic/react/icons";
import { detach, rethrow } from "@fresnel/contracts";
import { ReactFlow, useReactFlow, useViewportStore } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useMotionReduced } from "../../../../lib/motion-presets.tsx";
import { ProgressOrb } from "../../../effects/progress-orb.tsx";
import { InfoTip } from "../../info-tip.tsx";
import { useCraftTheme } from "../../craft-theme.ts";
import { Icon, KIND_COLOR, KindTile } from "./glyphs.tsx";
import { RAIL_HALF, layoutProfile, type ProfileLayout, type Rect } from "./layout.ts";
import { dotGrid, dotShift, GLOW_REACH, openViewOf } from "./floor.ts";
import {
  addPlugin,
  laneOf,
  inProfile,
  moveOnto,
  orderFixed,
  nudge,
  swapPlugins,
  placedOf,
  pluginOf,
  relationsOf,
  removeBundle,
  removePlugin,
  requiredByOf,
  setStartDrive,
  type Anchor,
  type CanvasProfile,
  type RelationKind,
} from "./model.ts";
import {
  CanvasActionsContext,
  NODE_TYPES,
  type CanvasActions,
  type CanvasNode,
  type Mark,
} from "./nodes.tsx";
import { Palette } from "./palette.tsx";
import {
  BuilderDetail,
  BundleDetail,
  PANEL_W,
  PluginDetail,
  PointDetail,
  RelationSwatch,
  type PanelActions,
  type PointOrder,
} from "./panel.tsx";
import { bundleMetaOf } from "../shared-meta.ts";
import {
  chooseProfile,
  currentProfile,
  saveProfile,
  setCollapsed,
  titleOf,
  updateStore,
  useCanvasStore,
} from "./store.ts";
import { issuesOf, pointHooks, type PointHook } from "./live.ts";

import { useProfileCommands } from "../profile-source.ts";
import { profileErrorText } from "../../../compose/compose-text.ts";
import { anchorWord, HOOK_ANCHORS, KIND_WORD, RELATION_HINT, RELATION_WORD } from "./words.ts";

/**
 * 블록 상세의 순서. 엔진의 적용 블록은 설치된 모든 플러그인의 핸들러를 세므로, 캔버스가 아는 플러그인 가운데 이 프로필에서 돌지 않는 것
 * (프로필에도 베이스에도 없고 엔진이 늘 싣는 것도 아닌 것)은 뺀다. 캔버스가 모르는 이름(엔진 부품)은 그대로 둔다.
 * 엔진이 이 자리의 Hook을 하나도 알려 주지 않으면(블록 밖 자리) 프로필 순서를 보이고 그렇다고 말한다
 */
function pointOrderOf(hooks: readonly PointHook[], profile: CanvasProfile): PointOrder {
  const runs = (name: string): boolean =>
    pluginOf(name) === undefined ||
    orderFixed(name) ||
    profile.base.includes(name) ||
    inProfile(profile, name);
  const kept = hooks
    .map((h) => ({ hook: h.hook, plugins: h.plugins.filter(runs) }))
    .filter((h) => h.plugins.length > 0);
  return kept.length === 0 ? { type: "unreported" } : { type: "engine", hooks: kept };
}

/** 이보다 좁은 창에서는 사이드 패널을 타일 막대로 접은 채 연다 */
const WIDE_ENOUGH = 1280;
/** 맞춤 보기 여백(화면 픽셀). 위는 프로필 머리, 아래는 도구 막대, 오른쪽은 앱의 세로 도구 자리 */
const FIT_PAD = { top: "72px", left: "28px", right: "60px", bottom: "64px" } as const;
/** 처음 시점의 여백(화면 픽셀): 위는 프로필 머리(40) 아래 24, 오른쪽은 앱의 세로 도구 자리 */
const OPEN_PAD = { top: 76, left: 32, right: 64, bottom: 72 } as const;
const REL_KINDS: readonly RelationKind[] = ["handoff", "depends", "reads", "creates", "replaces"];
/** Hook 자리 누름 칸의 반 폭과 위아래 여유(캔버스 좌표). 소켓 꺾쇠와 줄기 가운데 수 칸(폭 30, 높이 20)을 덮는다 */
const POINT_HALF = 16;
const POINT_PAD = 12;

interface Drag {
  readonly name: string;
  readonly from: "palette" | "canvas";
  readonly x: number;
  readonly y: number;
  readonly over: "canvas" | "palette" | "none";
  /** 캔버스에서 끌 때 아래에 있는 같은 자리의 다른 판(놓으면 그 자리로 순서가 바뀐다) */
  readonly onto: string | null;
}

/** 화면 점 아래의 플러그인 판 이름 */
function plateAt(x: number, y: number): string | null {
  const el = document
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>('.react-flow__node[data-id^="p:"]');
  const id = el?.getAttribute("data-id");
  return id === null || id === undefined ? null : id.slice(2);
}

function detachView(work: Promise<boolean>): void {
  detach(work, rethrow);
}

function intersects(
  a: DOMRect,
  b: { left: number; top: number; right: number; bottom: number },
): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 붙는 자리의 레일 위 점(끌 때 미리 밝히는 곳) */
function anchorPoint(layout: ProfileLayout, a: Anchor): { x: number; y: number } | null {
  if (a === "drive") {
    const b = layout.boundaries.find((x) => x.id === "input-received");
    return b === undefined ? null : { x: b.x, y: -RAIL_HALF };
  }
  if (a.startsWith("boundary:")) {
    const b = layout.boundaries.find((x) => `boundary:${x.id}` === a);
    return b === undefined ? null : { x: b.x, y: RAIL_HALF };
  }
  const spot =
    layout.sockets.find((k) => k.anchor === a) ?? layout.ticks.find((k) => k.anchor === a);
  if (spot === undefined) return null;
  return { x: spot.x, y: laneOf(a) === "feed" ? -RAIL_HALF : RAIL_HALF };
}

function rectIn(layout: ProfileLayout, id: string): Rect | null {
  if (id === "@builder") return layout.builder;
  if (id.startsWith("bundle:")) return layout.bundles.find((b) => `bundle:${b.id}` === id) ?? null;
  const plate = layout.plates.find((p) => p.placed.plugin.name === id);
  if (plate !== undefined) return plate;
  return layout.bundles.find((b) => b.collapsed && b.members.includes(id)) ?? null;
}

export function ProfileCanvas(props: { readonly onOpen: (name: string) => void }): ReactNode {
  const store = useCanvasStore();
  const profile = currentProfile(store);
  const rf = useReactFlow();
  const theme = useCraftTheme();
  const reduced = useMotionReduced();
  const zoom = useViewportStore((s) => s.transform[2]);
  const [selected, setSelected] = useState<string | null>(null);
  const commands = useProfileCommands();
  /** 저장이 거절된 까닭(보이는 줄). 다음 바꿈이나 닫기에서 지운다 */
  const [failure, setFailure] = useState<string | null>(null);
  const [arrive, setArrive] = useState<{ id: string; n: number }>({ id: "", n: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [say, setSay] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(() => window.innerWidth >= WIDE_ENOUGH);
  const wrapRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutProfile(profile, store.collapsed), [profile, store.collapsed]);
  const empty = profile.entries.length === 0;
  const placed = useMemo(() => placedOf(profile), [profile]);
  const relations = useMemo(() => relationsOf(profile), [profile]);
  const bundleList = useMemo(
    () =>
      profile.entries.flatMap((e) =>
        e.type === "bundle" ? [{ id: e.id, members: e.members }] : [],
      ),
    [profile],
  );

  // 맞춤 보기: 배치가 아는 테두리(판·묶음·레일·빌더)로 맞춘다. 끝없이 긴 바닥 띠는 넣지 않는다.
  // 처음(ReactFlow가 준비되면), 맞춤 단추, 패널을 접고 펼 때(폭이 바뀐 다음 프레임). 프로필을 바꾸면 index.tsx가 새로 그린다
  const fitLayout = useCallback(
    (duration: number): void => {
      const b = layout.bounds;
      detachView(
        rf.fitBounds(
          { x: b.x, y: b.y, width: b.w, height: b.h },
          { padding: FIT_PAD, duration: reduced ? 0 : duration },
        ),
      );
    },
    [layout, rf, reduced],
  );
  /**
   * 처음 보는 시점: 루프 전체(레일 양 끝 포함)가 들어가는 배율로 연다(50~80%). 그보다 작아져야 하면 50%로 열고 루프의 시작을
   * 화면 왼쪽에 붙인다. 그때는 오른쪽 가장자리에 "루프 계속" 표시가 떠 옆으로 옮겨 볼 수 있음을 알린다(`floor.ts`의 openViewOf)
   */
  const openView = useCallback((): void => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    const top = empty ? OPEN_PAD.top + 48 : OPEN_PAD.top;
    const v = openViewOf(layout.bounds, {
      x: OPEN_PAD.left,
      y: top,
      w: box.width - OPEN_PAD.left - OPEN_PAD.right,
      h: box.height - top - OPEN_PAD.bottom,
    });
    detachView(rf.setViewport({ x: v.x, y: v.y, zoom: v.zoom }, { duration: 0 }));
  }, [layout, rf, empty]);
  // 사용자가 직접 옮기거나 확대하기 전까지는 캔버스 크기가 바뀔 때마다(처음 잴 때, 패널을 접고 펼 때) 처음 시점으로 다시 맞춘다
  const autoFit = useRef(true);
  const paneW = useViewportStore((s) => s.width);
  const paneH = useViewportStore((s) => s.height);
  useEffect(() => {
    if (!autoFit.current || paneW === 0 || paneH === 0) return;
    openView();
  }, [paneW, paneH, openView]);
  const togglePalette = useCallback((): void => {
    autoFit.current = true;
    setPaletteOpen((o) => !o);
  }, []);

  const rectOf = useCallback((id: string): Rect | null => rectIn(layout, id), [layout]);

  /** 노드로 시점을 옮긴다: 플로팅 판이 가리지 않는 왼쪽 빈 자리 가운데로. 멀면 읽을 만큼 확대 */
  const glideTo = useCallback(
    (r: Rect | null, keepZoom: boolean): void => {
      const box = wrapRef.current?.getBoundingClientRect();
      if (r === null || box === undefined) return;
      autoFit.current = false;
      const free = box.width - PANEL_W - 32;
      // 판 하나는 읽을 만큼(92~105%) 키우고, 넓은 받침판은 빈 자리에 다 들어오게 줄인다
      const room = Math.min((free - 64) / r.w, (box.height - 180) / r.h);
      const z = keepZoom ? zoom : Math.max(0.4, Math.min(Math.max(zoom, 0.92), 1.05, room));
      const shift = (box.width / 2 - free / 2) / z;
      detachView(
        rf.setCenter(r.x + r.w / 2 + shift, r.y + r.h / 2, {
          zoom: z,
          duration: reduced ? 0 : 420,
        }),
      );
    },
    [zoom, rf, reduced],
  );
  const glide = useCallback(
    (id: string, keepZoom: boolean): void => glideTo(rectOf(id), keepZoom),
    [glideTo, rectOf],
  );

  /** 포커스: 접힌 묶음 안이면 먼저 펼친다(펼친 뒤 배치가 바뀌면 이어서 옮긴다) */
  const focusOn = useCallback(
    (id: string): void => {
      const p = pluginOf(id);
      const inBundle = placed.find((x) => x.plugin.name === id)?.source;
      if (p !== undefined && placed.every((x) => x.plugin.name !== id)) {
        setSelected(id);
        setSay(t("desktop.craft.canvas.cv3.say.notIn", { name: id }));
        return;
      }
      setSelected(id);
      setArrive((a) => ({ id, n: a.n + 1 }));
      setSay(t("desktop.craft.canvas.cv3.say.focused", { name: id.replace(/^bundle:/, "") }));
      if (inBundle?.type === "bundle" && store.collapsed.has(inBundle.id)) {
        // 접힌 묶음 안이면 펼치고, 펼친 배치에서의 자리로 간다
        const open = new Set([...store.collapsed].filter((b) => b !== inBundle.id));
        setCollapsed(inBundle.id, false);
        glideTo(rectIn(layoutProfile(profile, open), id), false);
        return;
      }
      glide(id, false);
    },
    [placed, store.collapsed, profile, glide, glideTo],
  );

  const selectFromCanvas = useCallback(
    (id: string): void => {
      setSelected(id);
      // 플로팅 판이 노드를 가리면 시점만 옮긴다(확대는 그대로)
      const el = wrapRef.current?.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(id.startsWith("bundle:") || id.startsWith("point:") || id === "@builder" ? id : `p:${id}`)}"]`,
      );
      const box = wrapRef.current?.getBoundingClientRect();
      if (el === null || el === undefined || box === undefined) return;
      const r = el.getBoundingClientRect();
      const panel = {
        left: box.right - PANEL_W - 32,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      };
      if (intersects(r, panel) || r.left < box.left || r.top < box.top + 48) glide(id, true);
    },
    [glide],
  );

  /** 바꾼 프로필을 그리고 저장한다. 거절되면 저장된 모양으로 돌아가고 그 까닭이 보인다 */
  const commit = useCallback(
    (next: CanvasProfile, done: string): void => {
      setFailure(null);
      setSay(done);
      detach(
        saveProfile(commands, next).then((saved) => {
          if (saved.ok) return null;
          const why = t(profileErrorText(saved.error));
          setFailure(why);
          setSay(why);
          return null;
        }),
        rethrow,
      );
    },
    [commands],
  );

  const add = useCallback(
    (name: string): void => {
      const next = addPlugin(profile, name);
      if (next === profile) return;
      commit(next, t("desktop.craft.canvas.cv3.say.added", { name }));
      setSelected(name);
      setArrive((a) => ({ id: name, n: a.n + 1 }));
      glideTo(rectIn(layoutProfile(next, store.collapsed), name), false);
    },
    [profile, store.collapsed, glideTo, commit],
  );

  const remove = useCallback(
    (name: string): void => {
      const r = removePlugin(profile, name);
      if (!r.ok) {
        setSay(
          r.reason === "required"
            ? t("desktop.craft.canvas.cv9.say.required", {
                name,
                parts: requiredByOf(name).join(", "),
              })
            : t(
                r.reason === "base"
                  ? "desktop.craft.canvas.cv3.say.baseFixed"
                  : "desktop.craft.canvas.cv3.say.absent",
              ),
        );
        return;
      }
      setSelected(null);
      commit(r.profile, t("desktop.craft.canvas.cv3.say.removed", { names: r.removed.join(", ") }));
    },
    [profile, commit],
  );

  const toggleBundle = useCallback(
    (id: string): void => {
      const next = !store.collapsed.has(id);
      setCollapsed(id, next);
      setSay(
        t(next ? "desktop.craft.canvas.cv3.say.folded" : "desktop.craft.canvas.cv3.say.unfolded", {
          name: bundleMetaOf(id).displayName,
        }),
      );
    },
    [store.collapsed],
  );

  // ── 끌기 ──
  /** 끌어 놓기로 순서 바꾸기: 같은 자리의 다른 판 위에 놓으면 그 자리로 간다 */
  const reorder = useCallback(
    (name: string, onto: string): void => {
      const next = moveOnto(profile, name, onto);
      if (next === profile) return;
      commit(next, t("desktop.craft.canvas.cv3.say.moved", { name }));
    },
    [profile, commit],
  );
  /** 끄는 판 아래의 판이 같은 자리이고 옮길 수 있으면 그 이름 */
  const ontoOf = useCallback(
    (name: string, x: number, y: number): string | null => {
      const under = plateAt(x, y);
      if (under === null || under === name) return null;
      return moveOnto(profile, name, under) === profile ? null : under;
    },
    [profile],
  );
  const latest = useRef({ add, remove, reorder, ontoOf });
  useLayoutEffect(() => {
    latest.current = { add, remove, reorder, ontoOf };
  }, [add, remove, reorder, ontoOf]);
  const whereIs = useCallback((x: number, y: number): Drag["over"] => {
    const inRect = (r: DOMRect | undefined): boolean =>
      r !== undefined && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    if (inRect(paletteRef.current?.getBoundingClientRect())) return "palette";
    if (inRect(wrapRef.current?.getBoundingClientRect())) return "canvas";
    return "none";
  }, []);
  const startPointer = useCallback(
    (name: string, from: Drag["from"], e: ReactPointerEvent<HTMLElement>): void => {
      if (e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      const move = (m: PointerEvent): void => {
        if (!dragging && Math.hypot(m.clientX - sx, m.clientY - sy) < 6) return;
        dragging = true;
        const over = whereIs(m.clientX, m.clientY);
        const onto =
          from === "canvas" && over === "canvas"
            ? latest.current.ontoOf(name, m.clientX, m.clientY)
            : null;
        setDrag({ name, from, x: m.clientX, y: m.clientY, over, onto });
      };
      const end = (m: PointerEvent): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
        if (!dragging) return;
        setDrag(null);
        const over = whereIs(m.clientX, m.clientY);
        if (from === "palette" && over === "canvas") latest.current.add(name);
        if (from === "canvas" && over === "palette") latest.current.remove(name);
        if (from === "canvas" && over === "canvas") {
          const onto = latest.current.ontoOf(name, m.clientX, m.clientY);
          if (onto !== null) latest.current.reorder(name, onto);
        }
      };
      const cancel = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", cancel);
        setDrag(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", cancel);
    },
    [whereIs],
  );

  // ── 키보드 ──
  const nodeIds = useMemo(
    (): readonly { readonly id: string; readonly r: Rect }[] => [
      ...layout.plates.map((p) => ({ id: p.placed.plugin.name, r: p })),
      ...layout.bundles.filter((b) => b.collapsed).map((b) => ({ id: `bundle:${b.id}`, r: b })),
    ],
    [layout],
  );
  const focusNodeEl = (id: string): void => {
    const key = id.startsWith("bundle:") ? id : `p:${id}`;
    wrapRef.current
      ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(key)}"]`)
      ?.focus();
  };
  const onKey = (id: string, e: KeyboardEvent<HTMLElement>): void => {
    const name = id;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey && pluginOf(name) !== undefined) props.onOpen(name);
      else selectFromCanvas(name);
      return;
    }
    if (e.key === "Escape") {
      setSelected(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && pluginOf(name) !== undefined) {
      e.preventDefault();
      remove(name);
      return;
    }
    const dirs: Readonly<Record<string, readonly [number, number]>> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const dir = dirs[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    if (
      e.altKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      pluginOf(name) !== undefined
    ) {
      if (orderFixed(name)) {
        setSay(t("desktop.craft.canvas.cv9.say.fixedOrder", { name }));
        return;
      }
      const next = nudge(profile, name, e.key === "ArrowUp" ? -1 : 1);
      if (next !== profile) commit(next, t("desktop.craft.canvas.cv3.say.moved", { name }));
      return;
    }
    const here = nodeIds.find((n) => n.id === name);
    if (here === undefined) return;
    const hx = here.r.x + here.r.w / 2;
    const hy = here.r.y + here.r.h / 2;
    let best: string | null = null;
    let score = Number.POSITIVE_INFINITY;
    for (const n of nodeIds) {
      if (n.id === name) continue;
      const dx = n.r.x + n.r.w / 2 - hx;
      const dy = n.r.y + n.r.h / 2 - hy;
      const main = dx * dir[0] + dy * dir[1];
      if (main <= 4) continue;
      const side = Math.abs(dir[0] === 0 ? dx : dy);
      const s = main + side * 2;
      if (s < score) {
        score = s;
        best = n.id;
      }
    }
    if (best !== null) {
      focusNodeEl(best);
      glide(best, true);
    }
  };

  const actions: CanvasActions = {
    select: selectFromCanvas,
    open: props.onOpen,
    toggleBundle,
    pointerDown: (name, e) => {
      startPointer(name, "canvas", e);
    },
    key: onKey,
  };

  // ── 밝힐 것 ──
  const litRel = useMemo(() => {
    const s = new Set<number>();
    if (selected === null) return s;
    layout.relations.forEach((r, i) => {
      if (r.relation.from === selected || r.relation.to === selected) s.add(i);
      if (selected === "@builder" && r.relation.kind === "creates") s.add(i);
    });
    return s;
  }, [selected, layout]);
  const visibleRel = useMemo(() => {
    const s = new Set<number>();
    layout.relations.forEach((r, i) => {
      if (store.allRelations || r.relation.kind === "handoff" || litRel.has(i)) s.add(i);
    });
    return s;
  }, [layout, store.allRelations, litRel]);
  const related = useMemo(() => {
    const s = new Set<string>();
    for (const i of litRel) {
      const r = layout.relations[i];
      if (r === undefined) continue;
      s.add(r.relation.from);
      s.add(r.relation.to);
    }
    if (selected !== null) s.add(selected);
    return s;
  }, [litRel, layout, selected]);

  const dragTarget = useMemo(() => {
    if (drag === null || drag.from !== "palette") return null;
    const p = pluginOf(drag.name);
    if (p === undefined) return null;
    const pt = anchorPoint(layout, p.anchor);
    return pt === null ? null : { ...pt, kind: p.kind };
  }, [drag, layout]);

  // 층 순서(xyflow는 음수 zIndex를 판 아래 바닥 뒤로 보내 누를 수 없게 하므로 0부터):
  // 빛 0 · 바닥 1 · 받침판·빌더 2 · 관계 선 3 · 판·더미 4
  const nodes = useMemo((): CanvasNode[] => {
    const markOf = (id: string): Mark =>
      id === selected || id === drag?.onto ? "selected" : related.has(id) ? "related" : "none";
    const b = layout.bounds;
    const list: CanvasNode[] = [
      {
        id: "floor",
        type: "floor",
        position: { x: b.x - 80, y: b.y - 80 },
        data: {
          layout,
          lit: related,
          target: dragTarget,
          showCross: store.allRelations || selected !== null,
        },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: 1,
      },
      {
        id: "links",
        type: "links",
        position: { x: b.x - 80, y: b.y - 80 },
        data: { layout, visible: visibleRel, lit: litRel },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: 3,
      },
    ];
    for (const g of layout.bundles) {
      const id = `bundle:${g.id}`;
      list.push({
        id,
        type: g.collapsed ? "pile" : "pedestal",
        position: { x: g.x, y: g.y },
        data: { geo: g, mark: markOf(id), arrive: arrive.id === id ? arrive.n : 0 },
        draggable: false,
        selectable: false,
        focusable: g.collapsed,
        zIndex: g.collapsed ? 4 : 2,
        ariaLabel: t("desktop.craft.canvas.cv3.a11y.bundle", {
          name: bundleMetaOf(g.id).displayName,
          n: g.members.length,
        }),
      });
    }
    for (const p of layout.plates) {
      const name = p.placed.plugin.name;
      list.push({
        id: `p:${name}`,
        type: "plate",
        position: { x: p.x, y: p.y },
        data: {
          geo: p,
          mark: markOf(name),
          arrive: arrive.id === name ? arrive.n : 0,
          dim: drag?.from === "canvas" && drag.name === name,
        },
        draggable: false,
        selectable: false,
        focusable: true,
        zIndex: 4,
        ariaLabel: t("desktop.craft.canvas.cv3.a11y.plate", {
          name,
          kind: t(KIND_WORD[p.placed.plugin.kind]),
          where: "",
        }),
      });
    }
    // Hook 자리: 소켓마다 누름 칸 하나(블록 상세를 연다)
    for (const k of layout.sockets) {
      if (laneOf(k.anchor) !== "hook") continue;
      const id = `point:${k.anchor}`;
      const top = k.side === "top" ? k.cy - POINT_PAD : RAIL_HALF - POINT_PAD / 2;
      const bottom = k.side === "top" ? -RAIL_HALF + POINT_PAD / 2 : k.cy + POINT_PAD;
      list.push({
        id,
        type: "point",
        position: { x: k.x - POINT_HALF, y: top },
        data: { anchor: k.anchor, mark: id === selected ? "selected" : "none" },
        width: POINT_HALF * 2,
        height: bottom - top,
        draggable: false,
        selectable: false,
        focusable: true,
        zIndex: 4,
        ariaLabel: t("desktop.craft.canvas.cv9.point.label", { at: t(anchorWord(k.anchor)) }),
      });
    }
    if (layout.builder !== null) {
      list.push({
        id: "@builder",
        type: "builder",
        position: { x: layout.builder.x, y: layout.builder.y },
        data: { mark: markOf("@builder") },
        draggable: false,
        selectable: false,
        focusable: true,
        zIndex: 2,
      });
    }
    return list;
  }, [layout, related, selected, arrive, drag, dragTarget, visibleRel, litRel, store.allRelations]);

  // 빛: 고른 판 뒤에 하나. 다른 노드와 따로 만들어, 고름이 바뀔 때 판들의 데이터는 그대로 둔다
  const glowNodes = useMemo((): CanvasNode[] => {
    if (selected === null) return [];
    const r = rectIn(layout, selected);
    if (r === null) return [];
    return [
      {
        id: "glow",
        type: "glow",
        position: { x: r.x - GLOW_REACH, y: r.y - GLOW_REACH },
        data: { x: r.x, y: r.y, w: r.w, h: r.h, kind: pluginOf(selected)?.kind ?? null },
        width: r.w + GLOW_REACH * 2,
        height: r.h + GLOW_REACH * 2,
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: 0,
      },
    ];
  }, [layout, selected]);
  const allNodes = useMemo(() => [...glowNodes, ...nodes], [glowNodes, nodes]);

  const onWrapKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains("react-flow__node")) {
      if (e.key === "Escape") setSelected(null);
      return;
    }
    const raw = e.target.getAttribute("data-id");
    if (raw === null) return;
    const id = raw.startsWith("p:") ? raw.slice(2) : raw;
    onKey(id, e);
  };

  const removeBundleById = (id: string): void => {
    setSelected(null);
    commit(
      removeBundle(profile, id),
      t("desktop.craft.canvas.cv3.say.removed", { names: bundleMetaOf(id).displayName }),
    );
  };

  const panelActions: PanelActions = {
    close: () => {
      setSelected(null);
    },
    focus: focusOn,
    open: props.onOpen,
    remove,
    add,
    nudge: (name, delta) => {
      const next = nudge(profile, name, delta);
      if (next !== profile) commit(next, t("desktop.craft.canvas.cv3.say.moved", { name }));
    },
    swap: (name, other) => {
      const next = swapPlugins(profile, name, other);
      if (next !== profile) commit(next, t("desktop.craft.canvas.cv3.say.moved", { name }));
    },
    setStart: (name) => {
      commit(setStartDrive(profile, name), t("desktop.craft.canvas.cv3.say.start", { name }));
    },
    toggleBundle,
    removeBundle: removeBundleById,
    testRun: (name) => {
      setSay(t("desktop.craft.canvas.cv3.say.testRun", { name }));
    },
    point: (anchor) => {
      setSelected(`point:${anchor}`);
      setSay(t("desktop.craft.canvas.cv9.say.point", { at: t(anchorWord(anchor)) }));
    },
  };

  const pendingReview = placed.filter(
    (p) => p.plugin.meta.review.state === "draft" || p.plugin.meta.pending !== null,
  ).length;
  const selectedPlaced =
    selected === null ? undefined : placed.find((p) => p.plugin.name === selected);
  const selectedBundle =
    selected !== null && selected.startsWith("bundle:")
      ? bundleList.find((b) => `bundle:${b.id}` === selected)
      : undefined;
  const dragPlugin = drag === null ? undefined : pluginOf(drag.name);
  const selectedPoint = pointAnchorOf(selected);
  const applied = store.live?.applied[store.current];
  const pointOrder: PointOrder =
    store.live === null
      ? { type: "sample" }
      : applied === undefined || selectedPoint === null
        ? { type: "loading" }
        : pointOrderOf(pointHooks(applied, store.live.positions, selectedPoint), profile);
  const pointIssues =
    selectedPoint === null
      ? []
      : issuesOf(
          store.live?.issues[store.current] ?? [],
          placed.filter((x) => x.plugin.anchor === selectedPoint).map((x) => x.plugin.name),
        );

  return (
    <CanvasActionsContext value={actions}>
      {/* Esc는 어디에 포커스가 있든(목록 줄 포함) 떠 있는 상세를 닫는다 */}
      <div
        className="cv6-root flex min-h-0 flex-1"
        data-scheme={theme}
        onKeyDown={(e) => {
          if (e.key === "Escape" && selected !== null) setSelected(null);
        }}
      >
        <div ref={paletteRef} className="flex">
          <Palette
            profile={profile}
            current={store.current}
            bundles={bundleList}
            focused={selected}
            open={paletteOpen}
            choices={store.order.map((id) => ({ id, title: titleOf(store, id) }))}
            onProfile={(id) => {
              setSelected(null);
              setFailure(null);
              detach(chooseProfile(commands, id), rethrow);
            }}
            onPick={focusOn}
            onAdd={add}
            onRemove={remove}
            onRemoveBundle={removeBundleById}
            onPointerDown={(name, e) => {
              startPointer(name, "palette", e);
            }}
            onToggle={togglePalette}
          />
        </div>
        <div
          ref={wrapRef}
          className={`cv6-stage relative min-h-0 min-w-0 flex-1 overflow-hidden${drag?.over === "canvas" && drag.from === "palette" ? " cv6-drop" : ""}`}
          onKeyDown={onWrapKey}
        >
          <DotFloor />
          <span aria-hidden="true" className="cv6-vignette" />
          <ReactFlow
            className="cv6-flow"
            nodes={allNodes}
            edges={[]}
            nodeTypes={NODE_TYPES}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            nodesFocusable
            edgesFocusable={false}
            disableKeyboardA11y
            deleteKeyCode={null}
            selectionKeyCode={null}
            multiSelectionKeyCode={null}
            zoomOnDoubleClick={false}
            minZoom={0.2}
            maxZoom={1.8}
            onMoveStart={(e) => {
              if (e !== null) autoFit.current = false;
            }}
            attributionPosition="bottom-left"
            aria-label={t("desktop.craft.canvas.cv3.canvas")}
            onPaneClick={() => {
              setSelected(null);
            }}
          />

          <MoreRight
            bounds={layout.bounds}
            onMore={() => {
              autoFit.current = false;
              const v = rf.getViewport();
              const step = ((wrapRef.current?.clientWidth ?? 800) * 0.6) / v.zoom;
              detachView(
                rf.setViewport(
                  { x: v.x - step * v.zoom, y: v.y, zoom: v.zoom },
                  { duration: reduced ? 0 : 360 },
                ),
              );
            }}
          />

          {/* 위 왼쪽: 프로필 머리 */}
          <div className="glass glass-shadow-3 rounded-toolbar absolute top-3 left-3 z-10 flex h-10 items-center gap-3 ps-3.5 pe-3">
            <span className="text-[13px] font-semibold text-text-primary">
              {titleOf(store, store.current) ?? t(sampleTitle(store.current))}
            </span>
            <span className="flex items-center gap-3 text-[12px] text-text-tertiary tabular-nums">
              <span>{t("desktop.craft.canvas.cv6.count.plugins", { n: placed.length })}</span>
              <span>{t("desktop.craft.canvas.cv6.count.base", { n: profile.base.length })}</span>
              <span>{t("desktop.craft.canvas.cv6.count.bundles", { n: bundleList.length })}</span>
            </span>
            {profile.startDrive === null ? (
              <span className="text-[12px] text-text-tertiary">
                {t("desktop.craft.canvas.cv3.head.noStart")}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                <KindTile kind="drive" size={16} />
                {t("desktop.craft.canvas.cv3.head.start", { name: profile.startDrive })}
              </span>
            )}
            {pendingReview > 0 ? (
              <span className="cv6-pill cv6-pill-warn">
                {t("desktop.craft.canvas.cv3.head.review", { n: pendingReview })}
              </span>
            ) : null}
            {store.live?.saving === store.current ? (
              <span className="flex items-center gap-1.5 text-[12px] text-text-tertiary">
                <ProgressOrb />
                {t("desktop.craft.canvas.cv9.point.saving")}
              </span>
            ) : null}
          </div>
          {failure === null ? null : (
            <div
              role="status"
              className="glass glass-shadow-3 rounded-toolbar absolute top-16 left-3 z-10 flex h-9 items-center gap-2 px-3.5 text-[12.5px] text-text-primary"
            >
              <span aria-hidden="true" className="cv6-orb" data-tone="danger" />
              {failure}
            </div>
          )}

          {/* 아래 오른쪽 도구 막대: 막대 하나만 면(caustic FloatingBar의 유리)을 갖고, 안의 단추는 전부 ghost다.
              앱의 확대 막대(`craft/finder.tsx`의 ZoomBar)와 같은 부품·크기: 관계 보기, 범례(정보), 확대·축소, 맞춤 */}
          <div className="absolute right-3 bottom-3 z-10">
            <FloatingBar label={t("desktop.craft.canvas.cv3.tool.label")} size="sm">
              <FloatingBarItem
                icon={<Icon name="links" size={16} />}
                active={store.allRelations}
                aria-label={t("desktop.craft.canvas.cv3.tool.relations")}
                title={t("desktop.craft.canvas.cv3.tool.relations")}
                onClick={() => {
                  updateStore((s) => ({ ...s, allRelations: !s.allRelations }));
                }}
              />
              <span className="grid size-control-sm place-items-center">
                <InfoTip
                  label={t("desktop.craft.canvas.cv3.legend.label")}
                  text={[
                    t("desktop.craft.canvas.cv3.legend.layers"),
                    ...REL_KINDS.map((k) => `${t(RELATION_WORD[k])}: ${t(RELATION_HINT[k])}`),
                    t("desktop.craft.canvas.cv3.legend.keys"),
                  ]}
                />
              </span>
              <FloatingBarSeparator />
              <ZoomControl
                variant="ghost"
                size="sm"
                readout="static"
                value={`${String(Math.round(zoom * 100))}%`}
                label={t("desktop.craft.canvas.cv3.tool.zoom")}
                zoomOutLabel={t("desktop.craft.canvas.cv3.tool.zoomOut")}
                zoomInLabel={t("desktop.craft.canvas.cv3.tool.zoomIn")}
                onZoomOut={() => {
                  detachView(rf.zoomOut({ duration: reduced ? 0 : 160 }));
                }}
                onZoomIn={() => {
                  detachView(rf.zoomIn({ duration: reduced ? 0 : 160 }));
                }}
              />
              <FloatingBarSeparator />
              <FloatingBarItem
                icon={<Maximize aria-hidden />}
                aria-label={t("desktop.craft.canvas.cv3.tool.fit")}
                title={t("desktop.craft.canvas.cv3.tool.fit")}
                onClick={() => {
                  autoFit.current = true;
                  fitLayout(260);
                }}
              />
            </FloatingBar>
          </div>

          {/* 관계 보기를 켜면 선의 문법을 보이게 둔다(그림 옆의 말) */}
          {store.allRelations ? (
            <div className="glass glass-shadow-3 rounded-xl absolute bottom-16 right-3 z-10 flex flex-col gap-1 px-3 py-2.5">
              {REL_KINDS.map((k) => (
                <span key={k} className="flex items-center gap-2 text-[12px] text-text-secondary">
                  <RelationSwatch kind={k} />
                  {t(RELATION_WORD[k])}
                </span>
              ))}
            </div>
          ) : null}

          {empty ? (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center">
              <div className="glass glass-shadow-3 rounded-toolbar flex items-center gap-2 px-3.5 py-2 text-[13px] text-text-secondary">
                <Icon name="left" size={14} />
                {t("desktop.craft.canvas.cv3.empty")}
              </div>
            </div>
          ) : null}

          {selected !== null && selected.startsWith("bundle:") && selectedBundle !== undefined ? (
            <BundleDetail
              key={selected}
              id={selectedBundle.id}
              members={placed.filter(
                (p) => p.source.type === "bundle" && p.source.id === selectedBundle.id,
              )}
              collapsed={store.collapsed.has(selectedBundle.id)}
              actions={panelActions}
            />
          ) : selected === "@builder" ? (
            <BuilderDetail
              created={relations.filter((r) => r.kind === "creates").map((r) => r.to)}
              actions={panelActions}
            />
          ) : selectedPoint !== null ? (
            <PointDetail
              key={selected}
              anchor={selectedPoint}
              profile={profile}
              order={pointOrder}
              issues={pointIssues}
              saving={store.live?.saving === store.current}
              actions={panelActions}
            />
          ) : selected !== null && pluginOf(selected) !== undefined ? (
            <PluginDetail
              key={selected}
              name={selected}
              profile={profile}
              placed={selectedPlaced}
              actions={panelActions}
            />
          ) : null}

          {drag?.from === "canvas" ? (
            <div className="pointer-events-none absolute top-16 left-3 z-20 glass glass-shadow-3 rounded-xl px-3 py-2 text-[12.5px] text-text-secondary">
              {t(
                orderFixed(drag.name)
                  ? "desktop.craft.canvas.cv9.say.fixedOrder"
                  : drag.onto === null
                    ? "desktop.craft.canvas.cv9.say.dragHint"
                    : "desktop.craft.canvas.cv9.say.dropToMove",
                { name: orderFixed(drag.name) ? drag.name : (drag.onto ?? "") },
              )}
            </div>
          ) : null}
        </div>
        {drag !== null && dragPlugin !== undefined ? (
          <div
            className="cv6-ghost cv6-chrome pointer-events-none fixed top-0 left-0 z-50 flex h-9 items-center gap-2 px-2.5"
            style={{ transform: `translate(${String(drag.x + 12)}px, ${String(drag.y + 10)}px)` }}
          >
            <KindTile kind={dragPlugin.kind} size={20} />
            <span className="text-[13px] text-text-primary">{dragPlugin.name}</span>
            <span className="text-[11.5px]" style={{ color: KIND_COLOR[dragPlugin.kind] }}>
              {t(KIND_WORD[dragPlugin.kind])}
            </span>
          </div>
        ) : null}
        <div aria-live="polite" className="sr-only">
          {say}
        </div>
      </div>
    </CanvasActionsContext>
  );
}

/** 표본 장면의 이름(엔진 프로필이 아닐 때) */
function sampleTitle(id: string): MessageId {
  if (id === "dev") return "desktop.craft.canvas.cv3.profile.dev";
  if (id === "empty") return "desktop.craft.canvas.cv3.profile.empty";
  if (id === "attach") return "desktop.craft.canvas.cv4.profile.attach";
  return "desktop.craft.canvas.sample.scale";
}

/** 고른 것이 Hook 자리(`point:<자리>`)면 그 자리 */
function pointAnchorOf(selected: string | null): Anchor | null {
  if (selected === null || !selected.startsWith("point:")) return null;
  const at = selected.slice("point:".length);
  return HOOK_ANCHORS.find((a) => a === at) ?? null;
}

/**
 * 바닥의 점 격자(참고 그림 그대로: 엇갈린 격자, 칸 하나에 점 둘). 화면을 덮는 면 하나(무늬 칸 하나만큼 더 크다)에 같은 점 무늬 두 겹을
 * 반 칸 엇갈려 깔고, 캔버스를 옮기면 면을 transform으로만 옮긴다(다시 칠하지 않고 합성만 한다). 확대하면 칸 크기가 바뀌어 한 번 다시
 * 칠한다. 쉬는 동안은 아무 일도 하지 않는다
 */
function DotFloor(): ReactNode {
  const tx = useViewportStore((s) => s.transform[0]);
  const ty = useViewportStore((s) => s.transform[1]);
  const zoom = useViewportStore((s) => s.transform[2]);
  const grid = dotGrid(zoom);
  const size = grid.screen;
  const dot = `radial-gradient(circle, var(--cv6-dot) ${String(grid.radius)}px, transparent ${String(grid.radius + 0.7)}px)`;
  return (
    <span
      aria-hidden="true"
      className="cv6-dots"
      style={{
        inset: `0 ${String(-size)}px ${String(-size)}px 0`,
        backgroundImage: `${dot}, ${dot}`,
        backgroundSize: `${String(size)}px ${String(size)}px`,
        backgroundPosition: `${String(-size / 2)}px ${String(-size / 2)}px, 0 0`,
        transform: `translate3d(${String(dotShift(tx, size))}px, ${String(dotShift(ty, size))}px, 0)`,
      }}
    />
  );
}

/**
 * 루프의 오른쪽이 화면 밖으로 넘치면 오른쪽 가장자리, 레일 블록 바로 아래에 "루프 계속" 단추를 띄운다(누르면 오른쪽으로 옮긴다).
 * 블록 이름을 가리지 않게 블록 아래 변에서 20px 밑에 서고, 그 자리가 화면 밑으로 넘치면 블록 위 변에서 20px 위에 선다.
 * 둘 다 화면 밖이면 가장자리 안쪽에 머문다.
 * 넘침 여부와 그 높이가 바뀔 때만 다시 그린다
 */
function MoreRight(props: { readonly bounds: Rect; readonly onMore: () => void }): ReactNode {
  const { bounds } = props;
  const over = useViewportStore(
    (s) => bounds.x * s.transform[2] + s.transform[0] + bounds.w * s.transform[2] > s.width + 24,
  );
  const railY = useViewportStore((s) => {
    const below = s.transform[1] + RAIL_HALF * s.transform[2] + 34;
    const above = s.transform[1] - RAIL_HALF * s.transform[2] - 34;
    const floor = Math.max(72, s.height - 72);
    // 블록 아래가 화면 밑으로 넘치면 블록 위로 올린다(가장자리에 눌려 블록 이름을 덮지 않게)
    if (below <= floor) return Math.round(Math.max(below, 72));
    if (above >= 72) return Math.round(above);
    return Math.round(floor);
  });
  if (!over) return null;
  return (
    <span className="cv6-more" style={{ top: railY }}>
      <button
        type="button"
        data-slot="cv6-button"
        className="cv6-more-btn glass glass-shadow-3"
        onClick={props.onMore}
        aria-label={t("desktop.craft.canvas.cv5.more.label")}
        title={t("desktop.craft.canvas.cv5.more.label")}
      >
        <span>{t("desktop.craft.canvas.cv5.more.word")}</span>
        <Icon name="right" size={14} />
      </button>
    </span>
  );
}
