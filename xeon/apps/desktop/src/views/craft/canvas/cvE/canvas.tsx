// cvE "궤도" 프로필 캔버스. 한 화면이 답하는 질문은 하나다: 이 프로필에서 무엇이 루프의 어디에 어떻게 붙어 있나.
// 왼쪽은 설치된 플러그인 목록(끌어 놓기의 출발점), 가운데는 궤도 판, 고르면 오른쪽에 가벼운 상세가 뜬다.
// 끌기: 목록이나 판의 노드를 잡으면 그 플러그인이 놓일 수 있는 자리(선언한 지점 안의 순서)만 드러난다. 판에서 목록으로 끌면 뺀다.
// 키보드: 목록에서 Enter로 들고 화살표로 자리를 고른 뒤 Enter로 놓는다. 판에서는 화살표로 노드를 옮겨 다니고,
// Enter는 안으로, Delete는 빼기, Alt+화살표는 순서 바꾸기, Esc는 고르기 해제다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { Button, cn, IconButton, Select, SelectOption } from "@caustic/react";
import { ArrowDown, ArrowUp, Maximize, Trash2, X, ZoomIn, ZoomOut } from "@caustic/react/icons";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { useMotionReduced } from "../../../../lib/motion-presets.tsx";
import { HEADER_SELECT_SIZE, ScreenHeader } from "../../../shell/screen-header.tsx";
import { InfoTip } from "../../info-tip.tsx";
import { Backdrop } from "./backdrop.tsx";
import { DecisionGlyph, KindGlyph } from "./glyphs.tsx";
import {
  dropTargets,
  layoutBoard,
  nearestTarget,
  SIZE,
  type DropTarget,
  type PlacedNode,
} from "./layout.ts";
import {
  groupOf,
  handoffs,
  insertAt,
  move,
  readingOrder,
  remove,
  setStart,
  slotOf,
  stackAt,
  STATIONS,
  type Defs,
  type Kind,
  type ProfileModel,
  type Slot,
  type StationId,
} from "./model.ts";
import {
  BundleNode,
  DriveNode,
  HookNode,
  InjectNode,
  KIND_COLOR,
  StationNode,
  ToolNode,
  type NodeHandlers,
} from "./nodes.tsx";
import { defsWithReal, modelOfReal, useRealProfiles } from "./real.ts";
import { SAMPLE_DEFS, SAMPLE_INSTALLED } from "./sample.ts";
import { pickProfile, putSample, select, toggleGroup, useCanvasState } from "./state.ts";
import {
  DECISION_TEXT,
  givesText,
  KIND_TEXT,
  nameText,
  slotText,
  STATION_TEXT,
  usedText,
} from "./text.ts";
import { useViewport, type View } from "./viewport.ts";
import { HandoffLabels, Wires, type WireFocus } from "./wires.tsx";

export interface ProfileCanvasProps {
  /** 머리에 둘 시안 고르기(개발 빌드) */
  readonly picker: ReactNode;
  /** 플러그인 안으로 들어간다 */
  readonly onOpen: (pluginId: string) => void;
}

/** 테마마다 다른 선·면 값. 모두 캐릭터 토큰을 섞는다(색 값을 새로 만들지 않는다) */
export function cveVars(dark: boolean): Record<string, string> {
  const ink = "var(--cs-color-text-primary)";
  const mix = (pct: number, c = ink): string =>
    `color-mix(in oklab, ${c} ${String(pct)}%, transparent)`;
  return {
    "--cve-line": mix(dark ? 13 : 14),
    "--cve-ring": mix(dark ? 42 : 46),
    "--cve-wire": mix(dark ? 30 : 34),
    "--cve-wire-lit": mix(dark ? 80 : 75),
    "--cve-handoff": mix(dark ? 55 : 58),
    "--cve-group": mix(dark ? 45 : 50),
    "--cve-glow": dark ? "var(--cs-color-text-primary)" : "var(--cs-color-identity-slate)",
    "--cve-core-fill": mix(dark ? 1.6 : 2.2),
    "--cve-grid-minor": mix(dark ? 2.6 : 3.4),
    "--cve-grid-major": mix(dark ? 5 : 6),
    "--cve-grid-glow": mix(dark ? 1.6 : 1.8),
    "--cve-hook-tint": mix(dark ? 10 : 9, "var(--cs-color-identity-amber)"),
    "--cve-inject-tint": mix(dark ? 14 : 11, "var(--cs-color-identity-iris)"),
    "--cve-drive-tint": mix(dark ? 4 : 5, "var(--cs-color-identity-mint)"),
    "--cve-drive-glow": mix(dark ? 5 : 6, "var(--cs-color-identity-mint)"),
  };
}

export function useDark(): boolean {
  const [dark, setDark] = useState(readDark);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (): void => {
      setDark(readDark());
    };
    mq.addEventListener("change", on);
    const mo = new MutationObserver(on);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => {
      mq.removeEventListener("change", on);
      mo.disconnect();
    };
  }, []);
  return dark;
}

function readDark(): boolean {
  if (typeof document === "undefined") return true;
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "light") return false;
  if (explicit === "dark") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 정거장에 묶이는 자리들 */
const STATION_SLOTS: Readonly<Record<StationId, readonly Slot[]>> = {
  context: ["input", "inside"],
  model: ["model.before"],
  tools: ["tools.before", "socket", "tools.after"],
  ask: ["ask.before"],
  agents: ["agents.before"],
  record: ["turnEnd"],
};

function isStationId(v: string): v is StationId {
  return STATIONS.some((s) => s === v);
}

interface DragState {
  readonly id: string;
  readonly from: "tray" | "canvas";
  readonly origin: { readonly x: number; readonly y: number };
  readonly pointer: { readonly x: number; readonly y: number };
  readonly active: boolean;
  readonly target: DropTarget | null;
  readonly overTray: boolean;
}

interface Placing {
  readonly id: string;
  readonly index: number;
}

type Notice = { readonly text: string; readonly warn: boolean } | null;

function useProfile(): {
  readonly profile: ProfileModel;
  readonly defs: Defs;
  readonly options: readonly { readonly id: string; readonly label: string }[];
} {
  const state = useCanvasState();
  const real = useRealProfiles();
  return useMemo(() => {
    const options = [
      { id: "dev", label: `${nameText("dev")} · ${t("desktop.craft.canvas.cvE.sampleTag")}` },
      { id: "empty", label: `${nameText("empty")} · ${t("desktop.craft.canvas.cvE.sampleTag")}` },
      ...real.map((p) => ({ id: `real:${p.id}`, label: p.title })),
    ];
    const sample = state.samples[state.profileId];
    if (sample !== undefined) return { profile: sample, defs: SAMPLE_DEFS, options };
    const found = real.find((p) => `real:${p.id}` === state.profileId);
    if (found === undefined) {
      return {
        profile: state.samples["dev"] ?? Object.values(state.samples)[0] ?? emptyModel(),
        defs: SAMPLE_DEFS,
        options,
      };
    }
    const profile = modelOfReal(found);
    return { profile, defs: defsWithReal(SAMPLE_DEFS, profile), options };
  }, [state.samples, state.profileId, real]);
}

function emptyModel(): ProfileModel {
  return { id: "none", title: "", sample: true, entries: [], startDrive: null, groups: [] };
}

function nodeLabel(defs: Defs, profile: ProfileModel, id: string): string {
  const def = defs[id];
  if (def === undefined) return id;
  const parts = [
    id,
    t(KIND_TEXT[def.kind]),
    def.unread === true ? t("desktop.craft.canvas.cvE.unread") : slotText(slotOf(def)),
  ];
  if (def.decision !== undefined) parts.push(t(DECISION_TEXT[def.decision]));
  if (def.guard === true) parts.push(t("desktop.craft.canvas.cvE.guard"));
  if (profile.startDrive === id) parts.push(t("desktop.craft.canvas.cvE.startDrive"));
  if (profile.entries.find((e) => e.id === id)?.base === true)
    parts.push(t("desktop.craft.canvas.cvE.base"));
  if (def.draft === true)
    parts.push(t("desktop.craft.canvas.cvE.draft"), t("desktop.craft.canvas.cvE.review"));
  return parts.join(", ");
}

export function ProfileCanvas(props: ProfileCanvasProps): ReactNode {
  const state = useCanvasState();
  const { profile, defs, options } = useProfile();
  const dark = useDark();
  const reduced = useMotionReduced();
  const editable = profile.sample;
  const board = useMemo(
    () => layoutBoard(profile, defs, state.closed),
    [profile, defs, state.closed],
  );
  const stageEl = useRef<HTMLDivElement>(null);
  const trayEl = useRef<HTMLDivElement>(null);
  const vp = useViewport(stageEl, board.bounds, 1.15, state.profileId);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // 끌기 값은 ref와 상태에 함께 둔다(창 이벤트 처리는 ref를, 그리기는 상태를 읽는다)
  const putDrag = useCallback((d: DragState | null) => {
    dragRef.current = d;
    setDrag(d);
  }, []);
  const justDragged = useRef(false);
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = setTimeout(() => {
      setNotice(null);
    }, 3200);
    return () => {
      clearTimeout(timer);
    };
  }, [notice]);

  const commit = useCallback(
    (next: ProfileModel) => {
      if (editable) putSample(next);
    },
    [editable],
  );

  const removeId = useCallback(
    (id: string) => {
      if (!editable) return;
      const got = remove(profile, defs, id);
      if (got.kind === "base") {
        setNotice({ text: t("desktop.craft.canvas.cvE.notice.baseLocked"), warn: true });
        return;
      }
      commit(got.profile);
      if (state.selected === id) select(null);
      setNotice({ text: t("desktop.craft.canvas.cvE.notice.removed", { name: id }), warn: false });
    },
    [commit, defs, editable, profile, state.selected],
  );

  const moveId = useCallback(
    (id: string, delta: -1 | 1) => {
      if (!editable) return;
      const got = move(profile, defs, id, delta);
      if (got.kind === "guard") {
        setNotice({ text: t("desktop.craft.canvas.cvE.notice.guardFirst"), warn: true });
        return;
      }
      if (got.kind === "moved") {
        commit(got.profile);
        const def = defs[id];
        const at = def === undefined ? 0 : stackAt(got.profile, defs, slotOf(def)).indexOf(id);
        setNotice({
          text: t("desktop.craft.canvas.cvE.notice.moved", { name: id, n: at + 1 }),
          warn: false,
        });
      }
    },
    [commit, defs, editable, profile],
  );

  const place = useCallback(
    (id: string, target: DropTarget) => {
      if (!editable) return;
      commit(insertAt(profile, defs, id, target.index));
      setNotice({
        text: t("desktop.craft.canvas.cvE.notice.placed", {
          name: id,
          where: slotText(target.slot),
        }),
        warn: false,
      });
      select(id);
    },
    [commit, defs, editable, profile],
  );

  // ── 끌기 ────────────────────────────────────────────────
  const activeId = drag?.active === true ? drag.id : (placing?.id ?? null);
  const targets = useMemo(
    () => (activeId === null ? [] : dropTargets(profile, defs, activeId)),
    [activeId, profile, defs],
  );
  const legal = useMemo(() => new Set(targets.map((tg) => tg.slot)), [targets]);

  const beginDrag = useCallback(
    (e: PointerEvent<HTMLElement>, id: string, from: "tray" | "canvas") => {
      if (e.button !== 0 || !editable) return;
      if (from === "canvas" && defs[id] === undefined) return;
      const p = { x: e.clientX, y: e.clientY };
      putDrag({ id, from, origin: p, pointer: p, active: false, target: null, overTray: false });
    },
    [defs, editable, putDrag],
  );

  const dragging = drag !== null;
  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e: globalThis.PointerEvent): void => {
      const cur = dragRef.current;
      if (cur === null) return;
      const p = { x: e.clientX, y: e.clientY };
      const active = cur.active || Math.hypot(p.x - cur.origin.x, p.y - cur.origin.y) > 5;
      if (!active) return;
      const stage = stageEl.current?.getBoundingClientRect();
      const tray = trayEl.current?.getBoundingClientRect();
      const overTray =
        tray !== undefined &&
        p.x >= tray.left &&
        p.x <= tray.right &&
        p.y >= tray.top &&
        p.y <= tray.bottom;
      let target: DropTarget | null = null;
      if (stage !== undefined && !overTray) {
        const w = vp.toWorld({ x: p.x - stage.left, y: p.y - stage.top });
        const list = dropTargets(profile, defs, cur.id);
        target = nearestTarget(list, w, 90 / vp.view.k);
      }
      putDrag({ ...cur, pointer: p, active: true, target, overTray });
    };
    const onUp = (): void => {
      const cur = dragRef.current;
      putDrag(null);
      if (cur === null || !cur.active) return;
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 0);
      if (cur.target !== null) place(cur.id, cur.target);
      else if (cur.overTray && cur.from === "canvas") removeId(cur.id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging, profile, defs, vp, place, removeId, putDrag]);

  // ── 옮기기·확대 ─────────────────────────────────────────
  const panRef = useRef<{ x: number; y: number; view: View } | null>(null);
  const onStageDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    panRef.current = { x: e.clientX, y: e.clientY, view: vp.view };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onStageMove = (e: PointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    if (pan === null) return;
    vp.touch();
    setAnimate(false);
    vp.setView({
      ...pan.view,
      x: pan.view.x + e.clientX - pan.x,
      y: pan.view.y + e.clientY - pan.y,
    });
  };
  const onStageUp = (e: PointerEvent<HTMLDivElement>): void => {
    const pan = panRef.current;
    panRef.current = null;
    if (pan !== null && Math.hypot(e.clientX - pan.x, e.clientY - pan.y) < 4) select(null);
  };
  useEffect(() => {
    const el = stageEl.current;
    if (el === null) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      setAnimate(false);
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        vp.zoomBy(Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
        return;
      }
      vp.touch();
      vp.setView({ ...vp.view, x: vp.view.x - e.deltaX, y: vp.view.y - e.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [vp]);

  // ── 고르기와 밝히기 ─────────────────────────────────────
  const selected = state.selected;
  const focus = useMemo((): WireFocus => {
    if (selected === null) return { lit: new Set(), any: false, slots: new Set() };
    const groupHost = (id: string): string => {
      const g = groupOf(profile, id);
      return g !== undefined && state.closed.has(g.id) ? g.id : id;
    };
    const lit = new Set<string>();
    const slots = new Set<Slot>();
    if (selected.startsWith("station:")) {
      const sid = selected.slice(8);
      if (isStationId(sid)) {
        for (const slot of STATION_SLOTS[sid]) {
          slots.add(slot);
          for (const id of stackAt(profile, defs, slot)) lit.add(groupHost(id));
        }
      }
      lit.add(selected);
      return { lit, any: true, slots };
    }
    const group = profile.groups.find((g) => g.id === selected);
    if (group !== undefined) {
      lit.add(group.id);
      for (const m of group.members) lit.add(m);
      return { lit, any: true, slots };
    }
    lit.add(selected);
    const def = defs[selected];
    if (def !== undefined) {
      const slot = slotOf(def);
      slots.add(slot);
      for (const h of handoffs(profile, defs)) {
        if (h.from === selected) lit.add(groupHost(h.to));
        if (h.to === selected) lit.add(groupHost(h.from));
      }
      const station = STATIONS.find((s) => STATION_SLOTS[s].includes(slot));
      if (station !== undefined) lit.add(`station:${station}`);
    }
    return { lit, any: true, slots };
  }, [selected, profile, defs, state.closed]);

  const order = useMemo(() => readingOrder(profile, defs), [profile, defs]);
  const focusNode = (id: string): void => {
    const el = stageEl.current?.querySelector<HTMLElement>(`[data-cve-node="${CSS.escape(id)}"]`);
    el?.focus();
  };

  const onNodeKey = (e: KeyboardEvent<HTMLElement>, id: string): void => {
    if (placing !== null) return;
    if (e.key === "Enter") {
      e.preventDefault();
      openNode(id);
      return;
    }
    if (e.key === "Escape") {
      select(null);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && defs[id] !== undefined) {
      e.preventDefault();
      removeId(id);
      return;
    }
    const vertical = e.key === "ArrowUp" || e.key === "ArrowDown";
    const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
    if (!vertical && !horizontal) return;
    e.preventDefault();
    const delta = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1;
    if (e.altKey && defs[id] !== undefined) {
      moveId(id, delta);
      return;
    }
    const ids = order.filter((o) => board.nodes.some((n) => n.id === o) || o === id);
    const at = ids.indexOf(id);
    const next = ids[(at + delta + ids.length) % ids.length];
    if (next !== undefined) {
      select(next);
      focusNode(next);
    }
  };

  const openNode = (id: string): void => {
    if (profile.groups.some((g) => g.id === id)) {
      toggleGroup(id);
      return;
    }
    if (id.startsWith("station:") || defs[id] === undefined) return;
    props.onOpen(id);
  };

  // 상세 판(오른쪽 위 288px)이 고른 노드를 가리면 그만큼 판을 왼쪽으로 민다
  const reveal = (id: string): void => {
    const n = board.nodes.find((x) => x.id === id);
    if (n === undefined) return;
    const half =
      n.shape === "drive"
        ? (n.r ?? 60)
        : n.shape === "bundle"
          ? SIZE.bundle.x / 2
          : n.shape === "tool"
            ? 30
            : SIZE[n.shape].x / 2;
    const right = (n.c.x + half) * vp.view.k + vp.view.x;
    const limit = vp.size.x - 300;
    if (right > limit) {
      vp.touch();
      setAnimate(!reduced);
      vp.setView({ ...vp.view, x: vp.view.x - (right - limit) });
    }
  };
  const handlers: NodeHandlers = {
    onSelect: (id) => {
      if (justDragged.current) return;
      select(id);
      reveal(id);
    },
    onOpen: openNode,
    onKeyDown: onNodeKey,
    onPointerDown: (e, id) => {
      beginDrag(e, id, "canvas");
    },
  };

  // ── 키보드 놓기 ─────────────────────────────────────────
  const startPlacing = (id: string): void => {
    if (!editable) return;
    const list = dropTargets(profile, defs, id);
    if (list.length === 0) return;
    setPlacing({ id, index: list.length - 1 });
    setNotice({ text: t("desktop.craft.canvas.cvE.notice.placing", { name: id }), warn: false });
  };
  const onRootKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (placing === null) return;
    const n = targets.length;
    if (e.key === "Escape") {
      e.preventDefault();
      setPlacing(null);
      setNotice({ text: t("desktop.craft.canvas.cvE.notice.cancel"), warn: false });
    } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      setPlacing({ ...placing, index: (placing.index + 1) % Math.max(1, n) });
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      setPlacing({ ...placing, index: (placing.index - 1 + n) % Math.max(1, n) });
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const tg = targets[placing.index];
      setPlacing(null);
      if (tg !== undefined) place(placing.id, tg);
    }
  };
  const hot: DropTarget | null =
    drag?.active === true
      ? drag.target
      : placing !== null
        ? (targets[placing.index] ?? null)
        : null;

  const fitAnimated = (): void => {
    setAnimate(!reduced);
    vp.fit();
  };

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const s of STATIONS)
      out[s] = STATION_SLOTS[s].reduce((a, slot) => a + stackAt(profile, defs, slot).length, 0);
    return out;
  }, [profile, defs]);

  const groupTabs = board.groups;
  const lifted = drag?.active === true && drag.from === "canvas" ? drag.id : null;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      style={cveVars(dark)}
      data-cve-root=""
      data-cve-theme={dark ? "dark" : "light"}
      onKeyDown={onRootKey}
    >
      <ScreenHeader
        flush
        title={t("desktop.craft.canvas.cvE.title")}
        meta={
          <Select
            size={HEADER_SELECT_SIZE}
            variant="ghost"
            aria-label={t("desktop.craft.canvas.cvE.profilePick")}
            value={state.profileId}
            onValueChange={pickProfile}
            className="w-auto"
          >
            {options.map((o) => (
              <SelectOption key={o.id} value={o.id}>
                {o.label}
              </SelectOption>
            ))}
          </Select>
        }
        controls={props.picker}
      />
      <div className="relative flex min-h-0 flex-1">
        <Tray
          ref={trayEl}
          profile={profile}
          defs={defs}
          editable={editable}
          active={activeId}
          dropping={drag?.active === true && drag.from === "canvas" && drag.overTray}
          onPointerDown={(e, id) => {
            beginDrag(e, id, "tray");
          }}
          onPlace={startPlacing}
          onSelect={(id) => {
            select(id);
          }}
        />
        <div
          ref={stageEl}
          role="group"
          aria-label={t("desktop.craft.canvas.cvE.canvasAria")}
          data-cve-stage=""
          className={cn(
            "relative min-w-0 flex-1 touch-none overflow-hidden select-none",
            drag?.active === true ? "cursor-grabbing" : "cursor-grab",
          )}
          onPointerDown={onStageDown}
          onPointerMove={onStageMove}
          onPointerUp={onStageUp}
        >
          <Backdrop view={vp.view} dark={dark} />
          <div
            data-cve-world=""
            className={cn(
              "pointer-events-none absolute top-0 left-0 origin-top-left [&_button]:pointer-events-auto",
              animate && "transition-transform duration-gentle ease-out",
            )}
            style={{
              transform: `translate(${String(vp.view.x)}px, ${String(vp.view.y)}px) scale(${String(vp.view.k)})`,
            }}
            onTransitionEnd={() => {
              setAnimate(false);
            }}
          >
            <Wires board={board} defs={defs} focus={focus} legal={legal} />
            {STATIONS.map((s) => (
              <StationNode
                key={s}
                id={s}
                count={counts[s] ?? 0}
                selected={selected === `station:${s}`}
                dimmed={focus.any && !focus.lit.has(`station:${s}`)}
                onSelect={handlers.onSelect}
                onKeyDown={onNodeKey}
              />
            ))}
            <HandoffLabels
              board={board}
              dim={(hid) =>
                focus.any &&
                !board.handoffs.some(
                  (h) => h.id === hid && (focus.lit.has(h.from) || focus.lit.has(h.to)),
                )
              }
            />
            {groupTabs.map((g) =>
              g.open ? (
                <button
                  key={g.id}
                  type="button"
                  data-cve-group={g.id}
                  aria-expanded
                  aria-label={t("desktop.craft.canvas.cvE.groupAria", {
                    name: nameText(g.key),
                    count: g.count,
                  })}
                  onClick={() => {
                    toggleGroup(g.id);
                  }}
                  style={{ left: g.tab.x, top: g.tab.y }}
                  className={cn(
                    "absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-[var(--cve-group)] bg-bg-canvas px-2.5 py-0.5 text-caption text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring",
                    focus.any && !focus.lit.has(g.id) && "opacity-40",
                  )}
                >
                  <KindGlyph kind="bundle" size={12} />
                  {nameText(g.key)}
                  <span className="font-mono text-mono-sm text-text-tertiary">{g.count}</span>
                </button>
              ) : null,
            )}
            {board.nodes.map((n) => (
              <BoardNode
                key={n.id}
                node={n}
                profile={profile}
                defs={defs}
                selected={selected === n.id}
                dimmed={focus.any && !focus.lit.has(n.id)}
                lifted={lifted === n.id}
                h={handlers}
              />
            ))}
            {targets.map((tg) => (
              <TargetMark key={tg.key} target={tg} hot={hot?.key === tg.key} />
            ))}
            {profile.entries.length === 0 ? (
              <p
                className="pointer-events-none absolute m-0 w-64 -translate-x-1/2 -translate-y-1/2 text-center text-footnote text-text-tertiary"
                style={{ left: 0, top: 0 }}
              >
                {t("desktop.craft.canvas.cvE.empty")}
              </p>
            ) : null}
          </div>
          <Toolbar
            k={vp.view.k}
            onZoom={(f) => {
              setAnimate(false);
              vp.zoomBy(f);
            }}
            onFit={fitAnimated}
          />
          {selected !== null ? (
            <Detail
              id={selected}
              profile={profile}
              defs={defs}
              editable={editable}
              onClose={() => {
                select(null);
              }}
              onOpen={openNode}
              onRemove={removeId}
              onMove={moveId}
              onStart={(id) => {
                commit(setStart(profile, defs, id));
              }}
              onToggleGroup={toggleGroup}
              onSelect={select}
            />
          ) : null}
          {notice === null ? null : (
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-lg border px-3 py-1.5 text-footnote shadow-2",
                notice.warn
                  ? "border-[var(--cs-color-warning-border)] bg-surface-raised text-text-primary"
                  : "border-[var(--cve-line)] bg-surface-raised text-text-secondary",
              )}
            >
              {notice.text}
            </div>
          )}
          <div role="status" aria-live="polite" className="sr-only">
            {notice?.text ?? ""}
          </div>
        </div>
      </div>
      {drag?.active === true ? (
        <DragGhost
          id={drag.id}
          defs={defs}
          at={drag.pointer}
          removing={drag.overTray && drag.from === "canvas"}
        />
      ) : null}
    </div>
  );
}

function BoardNode(props: {
  readonly node: PlacedNode;
  readonly profile: ProfileModel;
  readonly defs: Defs;
  readonly selected: boolean;
  readonly dimmed: boolean;
  readonly lifted: boolean;
  readonly h: NodeHandlers;
}): ReactNode {
  const { node, profile, defs } = props;
  if (node.shape === "bundle") {
    const group = profile.groups.find((g) => g.id === node.id);
    if (group === undefined) return null;
    const kinds: Kind[] = [];
    for (const m of group.members) {
      const k = defs[m]?.kind;
      if (k !== undefined) kinds.push(k);
    }
    return (
      <BundleNode
        node={node}
        group={group}
        kinds={kinds}
        selected={props.selected}
        dimmed={props.dimmed}
        label={t("desktop.craft.canvas.cvE.groupAria", {
          name: nameText(group.key),
          count: group.members.length,
        })}
        h={props.h}
      />
    );
  }
  const def = defs[node.id];
  if (def === undefined) return null;
  const p = {
    node,
    def,
    base: profile.entries.find((e) => e.id === node.id)?.base === true,
    start: profile.startDrive === node.id,
    group: groupOf(profile, node.id),
    selected: props.selected,
    dimmed: props.dimmed,
    lifted: props.lifted,
    label: nodeLabel(defs, profile, node.id),
    h: props.h,
  };
  switch (node.shape) {
    case "hook":
      return <HookNode {...p} />;
    case "inject":
      return <InjectNode {...p} />;
    case "tool":
      return <ToolNode {...p} />;
    case "drive":
      return <DriveNode {...p} />;
    default:
      return assertNever(node.shape, "cvE BoardNode shape");
  }
}

/** 놓을 자리: 쌓인 노드 사이의 바, 맨 끝의 빈 상자, Drive 줄의 빈 고리. 가장 가까운 것이 꽉 찬다 */
function TargetMark(props: { readonly target: DropTarget; readonly hot: boolean }): ReactNode {
  const { target: tg, hot } = props;
  const tone = hot
    ? "border-[var(--cs-color-canvas-selection)] bg-[color-mix(in_oklab,var(--cs-color-canvas-selection)_16%,transparent)]"
    : "border-[color-mix(in_oklab,var(--cs-color-canvas-selection)_60%,transparent)]";
  if (tg.shape === "ring") {
    const r = tg.size.x;
    return (
      <span
        aria-hidden
        data-cve-target={tg.key}
        style={{ left: tg.c.x - r, top: tg.c.y - r, width: r * 2, height: r * 2 }}
        className={cn(
          "pointer-events-none absolute rounded-full border-[1.5px] border-dashed",
          tone,
        )}
      />
    );
  }
  if (tg.shape === "bar") {
    // 쌓이는 방향(deg)에 수직인 짧은 바. 노드 폭의 절반쯤이라 고리나 이웃 노드를 가로지르지 않는다
    const a = (tg.deg * Math.PI) / 180;
    const w = Math.min(
      64,
      (Math.abs(Math.sin(a)) * tg.size.x + Math.abs(Math.cos(a)) * tg.size.y) * 0.5,
    );
    const h = 3;
    return (
      <span
        aria-hidden
        data-cve-target={tg.key}
        style={{
          left: tg.c.x - w / 2,
          top: tg.c.y - h / 2,
          width: w,
          height: h,
          transform: `rotate(${String(tg.deg + 90)}deg)`,
        }}
        className={cn(
          "pointer-events-none absolute rounded-full",
          hot
            ? "bg-[var(--cs-color-canvas-selection)] shadow-[0_0_10px_var(--cs-color-canvas-selection)]"
            : "bg-[color-mix(in_oklab,var(--cs-color-canvas-selection)_45%,transparent)]",
        )}
      />
    );
  }
  const round =
    tg.slot === "inside" ? "rounded-full" : tg.slot === "socket" ? "rounded-[14px]" : "rounded-lg";
  return (
    <span
      aria-hidden
      data-cve-target={tg.key}
      style={{
        left: tg.c.x - tg.size.x / 2,
        top: tg.c.y - tg.size.y / 2,
        width: tg.size.x,
        height: tg.size.y,
      }}
      className={cn("pointer-events-none absolute border-[1.5px] border-dashed", round, tone)}
    />
  );
}

function DragGhost(props: {
  readonly id: string;
  readonly defs: Defs;
  readonly at: { readonly x: number; readonly y: number };
  readonly removing: boolean;
}): ReactNode {
  const def = props.defs[props.id];
  if (def === undefined) return null;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed z-50 flex items-center gap-2 rounded-full border bg-surface-raised py-1 ps-2 pe-3 shadow-3",
        props.removing
          ? "border-dashed border-border-strong opacity-70"
          : "border-[var(--cs-color-canvas-selection)]",
      )}
      style={{ left: props.at.x + 10, top: props.at.y + 10 }}
    >
      <span style={{ color: KIND_COLOR[def.kind] }}>
        <KindGlyph kind={def.kind} size={14} />
      </span>
      <span className="font-mono text-mono text-text-primary">{def.id}</span>
      {props.removing ? <Trash2 className="size-icon-sm text-text-tertiary" /> : null}
    </div>
  );
}

function Toolbar(props: {
  readonly k: number;
  readonly onZoom: (factor: number) => void;
  readonly onFit: () => void;
}): ReactNode {
  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-toolbar border border-[var(--cve-line)] bg-surface-raised p-1 shadow-2">
      <IconButton
        size="sm"
        variant="ghost"
        label={t("desktop.craft.canvas.cvE.zoomOut")}
        onClick={() => {
          props.onZoom(1 / 1.2);
        }}
      >
        <ZoomOut />
      </IconButton>
      <span className="w-11 text-center font-mono text-mono-sm text-text-tertiary">
        {Math.round(props.k * 100)}%
      </span>
      <IconButton
        size="sm"
        variant="ghost"
        label={t("desktop.craft.canvas.cvE.zoomIn")}
        onClick={() => {
          props.onZoom(1.2);
        }}
      >
        <ZoomIn />
      </IconButton>
      <IconButton
        size="sm"
        variant="ghost"
        label={t("desktop.craft.canvas.cvE.fit")}
        onClick={props.onFit}
      >
        <Maximize />
      </IconButton>
      <span aria-hidden className="mx-1 h-4 w-px bg-[var(--cve-line)]" />
      <span className="flex items-center px-1.5">
        <InfoTip
          label={t("desktop.craft.canvas.cvE.legend")}
          text={[
            t("desktop.craft.canvas.cvE.legendInject"),
            t("desktop.craft.canvas.cvE.legendHook"),
            t("desktop.craft.canvas.cvE.legendTool"),
            t("desktop.craft.canvas.cvE.legendDrive"),
            t("desktop.craft.canvas.cvE.legendLinks"),
            t("desktop.craft.canvas.cvE.legendMarks"),
            t("desktop.craft.canvas.cvE.legendKeys"),
          ]}
        />
      </span>
    </div>
  );
}

const TRAY_KINDS: readonly Kind[] = ["drive", "inject", "hook", "tool"];

function Tray({
  ref,
  ...props
}: {
  readonly ref: Ref<HTMLDivElement>;
  readonly profile: ProfileModel;
  readonly defs: Defs;
  readonly editable: boolean;
  readonly active: string | null;
  readonly dropping: boolean;
  readonly onPointerDown: (e: PointerEvent<HTMLElement>, id: string) => void;
  readonly onPlace: (id: string) => void;
  readonly onSelect: (id: string) => void;
}): ReactNode {
  const { profile, defs } = props;
  const installed = [
    ...SAMPLE_INSTALLED,
    ...profile.entries.map((e) => e.id).filter((id) => !SAMPLE_INSTALLED.includes(id)),
  ];
  return (
    <aside
      ref={ref}
      aria-label={t("desktop.craft.canvas.cvE.trayTitle")}
      className={cn(
        "relative z-10 flex w-56 flex-none flex-col gap-3 max-[1279px]:w-44 overflow-y-auto border-e border-[var(--cve-line)] bg-bg-app px-2 py-3 transition-colors duration-quick",
        props.dropping &&
          "bg-[color-mix(in_oklab,var(--cs-color-danger-solid)_6%,var(--cs-color-bg-app))]",
      )}
    >
      <div className="flex items-center gap-1 px-2">
        <h2 className="m-0 text-footnote font-medium text-text-secondary">
          {t("desktop.craft.canvas.cvE.trayTitle")}
        </h2>
        <InfoTip text={t("desktop.craft.canvas.cvE.trayHint")} />
      </div>
      {TRAY_KINDS.map((kind) => {
        const ids = installed.filter((id) => {
          const d = defs[id];
          return d !== undefined && d.kind === kind && d.unread !== true;
        });
        if (ids.length === 0) return null;
        return (
          <section key={kind} className="flex flex-col">
            <h3 className="m-0 flex items-center gap-1.5 px-2 pb-1 text-caption font-normal text-text-tertiary">
              <span style={{ color: KIND_COLOR[kind] }}>
                <KindGlyph kind={kind} size={12} />
              </span>
              {t(KIND_TEXT[kind])}
            </h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {ids.map((id) => {
                const entry = profile.entries.find((e) => e.id === id);
                const def = defs[id];
                return (
                  <li key={id}>
                    <button
                      type="button"
                      data-cve-tray={id}
                      aria-label={`${id}, ${t(KIND_TEXT[kind])}${entry === undefined ? "" : `, ${t("desktop.craft.canvas.cvE.inProfile")}`}`}
                      className={cn(
                        "flex h-8 w-full cursor-grab items-center gap-2 rounded-md border-0 bg-transparent px-2 text-start outline-none hover:bg-neutral-hover focus-visible:focus-ring",
                        props.active === id && "bg-neutral-selected",
                      )}
                      onPointerDown={(e) => {
                        props.onPointerDown(e, id);
                      }}
                      onClick={() => {
                        if (entry !== undefined) props.onSelect(id);
                      }}
                      onKeyDown={(e) => {
                        if (
                          (e.key === "Enter" || e.key === " ") &&
                          props.active === null &&
                          props.editable
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          props.onPlace(id);
                        }
                      }}
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate font-mono text-mono",
                          entry === undefined ? "text-text-primary" : "text-text-secondary",
                        )}
                      >
                        {id}
                      </span>
                      {def?.draft === true ? (
                        <span className="rounded-xs border border-dashed border-border-strong px-1 text-caption text-text-secondary">
                          {t("desktop.craft.canvas.cvE.draft")}
                        </span>
                      ) : entry?.base === true ? (
                        <span className="text-caption text-text-tertiary">
                          {t("desktop.craft.canvas.cvE.base")}
                        </span>
                      ) : null}
                      {entry === undefined ? null : <OnLoopMark />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}

/** 프로필에 있음: 작은 고리 위 점(색 없음) */
function OnLoopMark(): ReactNode {
  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className="flex-none text-text-tertiary"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
    >
      <circle cx="6" cy="6" r="4.2" />
      <circle cx="6" cy="1.8" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

function Row(props: { readonly label: string; readonly children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3">
      <span className="text-footnote text-text-tertiary">{props.label}</span>
      <span className="flex min-w-0 items-center gap-1.5 text-footnote text-text-primary">
        {props.children}
      </span>
    </div>
  );
}

function Detail(props: {
  readonly id: string;
  readonly profile: ProfileModel;
  readonly defs: Defs;
  readonly editable: boolean;
  readonly onClose: () => void;
  readonly onOpen: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onMove: (id: string, delta: -1 | 1) => void;
  readonly onStart: (id: string) => void;
  readonly onToggleGroup: (id: string) => void;
  readonly onSelect: (id: string) => void;
}): ReactNode {
  const { id, profile, defs } = props;
  let head: ReactNode = null;
  let body: ReactNode = null;
  let foot: ReactNode = null;
  if (id.startsWith("station:")) {
    const sid = id.slice(8);
    if (!isStationId(sid)) return null;
    const attached = STATION_SLOTS[sid].flatMap((slot) =>
      stackAt(profile, defs, slot).map((p) => ({ p, slot })),
    );
    head = (
      <>
        <span className="flex size-6 items-center justify-center">
          <span className="flex size-4 items-center justify-center rounded-full border-[1.5px] border-text-secondary">
            <span className="size-1.5 rounded-full bg-text-primary" />
          </span>
        </span>
        <span className="truncate text-ui font-medium text-text-primary">
          {t(STATION_TEXT[sid])}
        </span>
        <span className="text-caption text-text-tertiary">
          {t("desktop.craft.canvas.cvE.block")}
        </span>
      </>
    );
    body =
      attached.length === 0 ? (
        <p className="m-0 text-footnote text-text-tertiary">
          {t("desktop.craft.canvas.cvE.stationEmpty")}
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {attached.map(({ p, slot }) => (
            <li key={p}>
              <button
                type="button"
                className="flex h-7 w-full cursor-pointer items-center justify-between gap-2 rounded-md border-0 bg-transparent px-1.5 text-start outline-none hover:bg-neutral-hover focus-visible:focus-ring"
                onClick={() => {
                  props.onSelect(p);
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span style={{ color: KIND_COLOR[defs[p]?.kind ?? "inject"] }}>
                    <KindGlyph kind={defs[p]?.kind ?? "inject"} size={12} />
                  </span>
                  <span className="truncate font-mono text-mono text-text-primary">{p}</span>
                </span>
                <span className="flex-none text-caption text-text-tertiary">{slotText(slot)}</span>
              </button>
            </li>
          ))}
        </ul>
      );
  } else {
    const group = profile.groups.find((g) => g.id === id);
    if (group !== undefined) {
      head = (
        <>
          <KindGlyph kind="bundle" size={16} className="text-text-secondary" />
          <span className="truncate text-ui font-medium text-text-primary">
            {nameText(group.key)}
          </span>
          <span className="text-caption text-text-tertiary">
            {t("desktop.craft.canvas.cvE.group")}
          </span>
        </>
      );
      body = (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {group.members.map((m) => (
            <li key={m} className="flex h-7 items-center gap-2 px-1.5">
              <span style={{ color: KIND_COLOR[defs[m]?.kind ?? "inject"] }}>
                <KindGlyph kind={defs[m]?.kind ?? "inject"} size={12} />
              </span>
              <span className="truncate font-mono text-mono text-text-primary">{m}</span>
            </li>
          ))}
        </ul>
      );
      foot = (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            props.onToggleGroup(group.id);
          }}
        >
          {t("desktop.craft.canvas.cvE.groupToggle")}
        </Button>
      );
    } else {
      const def = defs[id];
      if (def === undefined) return null;
      const entry = profile.entries.find((e) => e.id === id);
      const slot = slotOf(def);
      const stack = stackAt(profile, defs, slot);
      const at = stack.indexOf(id);
      head = (
        <>
          <span
            className="flex size-6 items-center justify-center"
            style={{ color: KIND_COLOR[def.kind] }}
          >
            <KindGlyph kind={def.kind} size={16} />
          </span>
          <span className="truncate font-mono text-mono-md text-text-primary">{id}</span>
          <span className="text-caption text-text-tertiary">{t(KIND_TEXT[def.kind])}</span>
        </>
      );
      const chips: string[] = [];
      if (entry?.base === true) chips.push(t("desktop.craft.canvas.cvE.base"));
      if (profile.startDrive === id) chips.push(t("desktop.craft.canvas.cvE.startDrive"));
      if (def.guard === true) chips.push(t("desktop.craft.canvas.cvE.guard"));
      body = (
        <div className="flex flex-col">
          {def.draft === true ? (
            <p className="m-0 mb-2 rounded-md border border-[var(--cs-color-warning-border)] px-2 py-1.5 text-footnote text-text-primary">
              {t("desktop.craft.canvas.cvE.draftNotice")}
            </p>
          ) : null}
          <Row label={t("desktop.craft.canvas.cvE.where")}>
            {def.unread === true ? t("desktop.craft.canvas.cvE.unread") : slotText(slot)}
          </Row>
          {def.decision === undefined ? null : (
            <Row label={t("desktop.craft.canvas.cvE.decisionLabel")}>
              <DecisionGlyph decision={def.decision} size={12} className="text-text-secondary" />
              {t(DECISION_TEXT[def.decision])}
            </Row>
          )}
          {def.gives === undefined ? null : (
            <Row label={t("desktop.craft.canvas.cvE.gives")}>
              {givesText(def.gives.what, def.gives.count)}
            </Row>
          )}
          {def.kind === "drive" && def.handoff !== undefined && def.handoff.length > 0 ? (
            <Row label={t("desktop.craft.canvas.cvE.handoff")}>
              <span className="font-mono text-mono">→ {def.handoff.join(", ")}</span>
            </Row>
          ) : null}
          {stack.length > 1 && entry !== undefined ? (
            <Row label={t("desktop.craft.canvas.cvE.order")}>
              <span className="font-mono text-mono-sm text-text-secondary">
                {at + 1} / {stack.length}
              </span>
              {props.editable ? (
                <>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    label={t("desktop.craft.canvas.cvE.earlier")}
                    disabled={at <= 0}
                    onClick={() => {
                      props.onMove(id, -1);
                    }}
                  >
                    <ArrowUp />
                  </IconButton>
                  <IconButton
                    size="xs"
                    variant="ghost"
                    label={t("desktop.craft.canvas.cvE.later")}
                    disabled={at >= stack.length - 1}
                    onClick={() => {
                      props.onMove(id, 1);
                    }}
                  >
                    <ArrowDown />
                  </IconButton>
                </>
              ) : null}
            </Row>
          ) : null}
          {def.usedMin === undefined ? null : (
            <Row label={t("desktop.craft.canvas.cvE.usedLabel")}>{usedText(def.usedMin)}</Row>
          )}
          {chips.length === 0 ? null : (
            <div className="mt-2 flex flex-wrap gap-1">
              {chips.map((c) => (
                <span
                  key={c}
                  className="rounded-sm border border-[var(--cve-line)] px-1.5 text-caption text-text-secondary"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
      );
      foot = (
        <>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              props.onOpen(id);
            }}
          >
            {t("desktop.craft.canvas.cvE.open")}
          </Button>
          {def.kind === "drive" &&
          profile.startDrive !== id &&
          entry !== undefined &&
          props.editable ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                props.onStart(id);
              }}
            >
              {t("desktop.craft.canvas.cvE.makeStart")}
            </Button>
          ) : null}
          {entry !== undefined && props.editable ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={entry.base}
              title={entry.base ? t("desktop.craft.canvas.cvE.notice.baseLocked") : undefined}
              onClick={() => {
                props.onRemove(id);
              }}
            >
              {t("desktop.craft.canvas.cvE.remove")}
            </Button>
          ) : null}
        </>
      );
    }
  }
  return (
    <section
      aria-label={t("desktop.craft.canvas.cvE.detailAria")}
      data-cve-detail=""
      className="absolute top-3 right-3 z-10 flex w-68 flex-col gap-2.5 rounded-2xl border border-[var(--cve-line)] bg-surface-raised p-3.5 shadow-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      <header className="flex items-center gap-2">
        {head}
        <span className="flex-1" />
        <IconButton
          size="xs"
          variant="ghost"
          label={t("desktop.craft.canvas.cvE.close")}
          onClick={props.onClose}
        >
          <X />
        </IconButton>
      </header>
      {body}
      {foot === null ? null : <footer className="flex flex-wrap gap-1.5 pt-1">{foot}</footer>}
    </section>
  );
}
