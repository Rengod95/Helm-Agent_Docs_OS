// cvD 프로필 캔버스: "이 프로필에서 무엇이 턴의 어디에 어떻게 붙어 있나" 하나만 답한다.
// 왼쪽 팔레트에서 끌어 자리에 놓고(키보드도), 노드를 골라 가벼운 상세를 보고, 두 번 누르거나 Enter로 플러그인 안으로 들어간다.
// 블록·경계 목록은 엔진의 블록 모델 상수(`blocks.describe`가 돌려주는 BLOCK_MODEL)에서 읽는다.
import { t } from "@fresnel/client/i18n";
import { BLOCK_MODEL } from "@fresnel/contracts/blocks";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { useCraftTheme } from "../../orbit.tsx";
import { Backdrop } from "./backdrop.tsx";
import {
  ChipBody,
  ChipShell,
  Chips,
  EmptyStart,
  Groups,
  HoverCard,
  Slots,
  Stations,
  Wires,
} from "./graph.tsx";
import { kindVars } from "./glyphs.tsx";
import { Inspector } from "./inspector.tsx";
import { Legend } from "./legend.tsx";
import {
  CHIP_W,
  CHIP_X0,
  layoutProfile,
  nearestSlot,
  placePlugin,
  removePlugin,
  shiftPlugin,
  type Slot,
} from "./model.ts";
import { Palette, choiceName, type ProfileChoice } from "./palette.tsx";
import { useRealProfiles } from "./real.ts";
import { pluginById, SAMPLE_PROFILES } from "./sample.ts";
import {
  currentProfile,
  setCurrentProfile,
  toggleFold,
  updateStore,
  useCanvasStore,
} from "./store.ts";
import { Stage, useViewport, ZoomBar } from "./viewport.tsx";
import { pointWord } from "./words.ts";

const BLOCKS = BLOCK_MODEL.blocks.map((b) => b.id);
const BOUNDARIES = BLOCK_MODEL.boundaries.map((b) => b.id);
const PALETTE_W = 248;
const RAIL_W = 52;
const OPEN_INSET = { left: PALETTE_W, right: 40, top: 52 } as const;
const RAIL_INSET = { left: RAIL_W, right: 40, top: 52 } as const;
/** 이보다 좁은 창에서는 팔레트를 배지 막대로 접은 채 연다(캔버스 폭을 지킨다) */
const WIDE_ENOUGH = 1280;

export interface ProfileCanvasProps {
  readonly onOpen: (pluginId: string) => void;
  readonly picker: ReactNode;
}

interface Drag {
  readonly plugin: string;
  /** 포인터로 끄는 중이면 화면 좌표와 내용 좌표 */
  readonly pointer: {
    readonly x: number;
    readonly y: number;
    readonly cx: number;
    readonly cy: number;
  } | null;
  /** 키보드로 집은 경우 고른 자리 번호 */
  readonly index: number;
}

/** 방향키로 갈 다음 노드. 그 방향의 노드 가운데 주축 거리 + 옆축 거리×2가 가장 작은 것 */
function nextNode(
  nodes: readonly { readonly key: string; readonly x: number; readonly y: number }[],
  from: string,
  dir: "up" | "down" | "left" | "right",
): string | null {
  const here = nodes.find((n) => n.key === from);
  if (here === undefined) return nodes[0]?.key ?? null;
  let best: string | null = null;
  let score = Number.POSITIVE_INFINITY;
  for (const n of nodes) {
    if (n.key === from) continue;
    const dx = n.x - here.x;
    const dy = n.y - here.y;
    const main = dir === "up" ? -dy : dir === "down" ? dy : dir === "left" ? -dx : dx;
    const side = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    if (main <= 2) continue;
    const s = main + side * 2;
    if (s < score) {
      score = s;
      best = n.key;
    }
  }
  return best;
}

const ARROWS: Readonly<Record<string, "up" | "down" | "left" | "right">> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function CvdProfileCanvas(props: ProfileCanvasProps): ReactElement {
  const store = useCanvasStore();
  const profile = currentProfile(store);
  const theme = useCraftTheme();
  const real = useRealProfiles();
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [focusKey, setFocusKey] = useState<string>("plugin:helm");
  const [announce, setAnnounce] = useState("");
  const suppressClick = useRef(false);

  const layout = useMemo(
    () =>
      layoutProfile(profile, {
        blocks: BLOCKS,
        boundaries: BOUNDARIES,
        folded: store.folded,
        dragging: drag?.plugin ?? null,
      }),
    [profile, store.folded, drag?.plugin],
  );
  // 화면 맞춤은 끌기 전 크기로 한다(끄는 동안 열린 줄 때문에 시점이 뛰지 않게)
  const box = useRef<HTMLDivElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(() => window.innerWidth >= WIDE_ENOUGH);
  const paletteW = paletteOpen ? PALETTE_W : RAIL_W;
  const vp = useViewport(box, layout.width, layout.height, paletteOpen ? OPEN_INSET : RAIL_INSET);

  const active: Slot | null = useMemo(() => {
    if (drag === null) return null;
    if (drag.pointer !== null) return nearestSlot(layout.slots, drag.pointer.cx, drag.pointer.cy);
    const n = layout.slots.length;
    return n === 0 ? null : (layout.slots[((drag.index % n) + n) % n] ?? null);
  }, [drag, layout.slots]);
  const activeRef = useRef<Slot | null>(null);
  useLayoutEffect(() => {
    activeRef.current = active;
  });

  const choices: ProfileChoice[] = useMemo(
    () => [
      ...SAMPLE_PROFILES.map((p) => ({ id: p.id, name: { id: p.name } })),
      ...real.map((r) => ({ id: r.id, name: { text: r.title } })),
    ],
    [real],
  );
  const chooseProfile = (id: string): void => {
    const hit = real.find((r) => r.id === id);
    updateStore((s) => ({
      ...s,
      current: id,
      profiles:
        hit === undefined || s.profiles[id] !== undefined
          ? s.profiles
          : { ...s.profiles, [id]: hit.profile },
    }));
    setSelected(null);
  };

  const commit = useCallback(
    (plugin: string, slot: Slot | null): void => {
      setDrag(null);
      if (slot === null) return;
      setCurrentProfile(placePlugin(profile, plugin, slot.point, slot.index, slot.asStart));
      setSelected(`plugin:${plugin}`);
      setFocusKey(`plugin:${plugin}`);
      setAnnounce(
        t("desktop.craft.canvas.cvD.a11y.placed", {
          name: plugin,
          where: t(pointWord(slot.point)),
        }),
      );
    },
    [profile],
  );

  /** 팔레트 줄이나 노드에서 포인터로 끌기 시작(4px 넘게 움직여야 끌기다) */
  const beginDrag = useCallback(
    (plugin: string, e: ReactPointerEvent<HTMLElement>): void => {
      if (e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let started = false;
      const move = (m: PointerEvent): void => {
        if (!started && Math.hypot(m.clientX - sx, m.clientY - sy) < 4) return;
        started = true;
        const [cx, cy] = vp.toContent(m.clientX, m.clientY);
        setHover(null);
        setDrag({ plugin, pointer: { x: m.clientX, y: m.clientY, cx, cy }, index: 0 });
      };
      const up = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        if (!started) return;
        suppressClick.current = true;
        commit(plugin, activeRef.current);
      };
      const cancel = (): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        setDrag(null);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    },
    [commit, vp],
  );

  /** 팔레트 줄의 키보드 집기 */
  const paletteKey = (plugin: string, e: KeyboardEvent<HTMLElement>): void => {
    const picking = drag !== null && drag.pointer === null && drag.plugin === plugin;
    if (!picking) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setDrag({ plugin, pointer: null, index: 0 });
        setAnnounce(t("desktop.craft.canvas.cvD.a11y.picked", { name: plugin }));
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDrag(null);
      setAnnounce(t("desktop.craft.canvas.cvD.a11y.cancelled"));
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      commit(plugin, active);
      return;
    }
    const dir = ARROWS[e.key];
    if (dir === undefined) return;
    e.preventDefault();
    const step = dir === "up" || dir === "left" ? -1 : 1;
    const next = drag.index + step;
    setDrag({ ...drag, index: next });
    const n = layout.slots.length;
    const slot = layout.slots[((next % n) + n) % n];
    if (slot !== undefined)
      setAnnounce(
        t("desktop.craft.canvas.cvD.a11y.slot", {
          where: t(pointWord(slot.point)),
          n: (((next % n) + n) % n) + 1,
          total: n,
        }),
      );
  };

  const select = (key: string): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    setSelected((s) => (s === key ? null : key));
    setFocusKey(key);
  };
  const remove = (plugin: string): void => {
    const next = removePlugin(profile, plugin);
    if (next === profile) return;
    setCurrentProfile(next);
    setSelected(null);
    setFocusKey("station:context");
    setAnnounce(t("desktop.craft.canvas.cvD.a11y.removed", { name: plugin }));
  };
  const shift = (plugin: string, delta: -1 | 1): void => {
    setCurrentProfile(shiftPlugin(profile, plugin, delta));
  };

  // 키보드로 노드 사이를 다닌다(로빙 tabindex)
  const nodes = useMemo(
    () => [
      ...layout.rows
        .filter((r) => (r.kind === "station" || r.kind === "record") && r.block !== null)
        .map((r) => ({ key: `station:${r.block ?? ""}`, x: 216, y: r.y })),
      ...layout.chips
        .filter((c) => !c.hidden)
        .map((c) => ({ key: `plugin:${c.plugin}`, x: c.x + c.w / 2, y: c.y + c.h / 2 })),
      ...layout.groups.map((g) => ({ key: `group:${g.id}`, x: g.x + 40, y: g.top + 14 })),
    ],
    [layout],
  );
  const roving = nodes.some((n) => n.key === focusKey) ? focusKey : (nodes[0]?.key ?? "");
  const nodeProps = (key: string): { readonly tabIndex: number; readonly "data-node": string } => ({
    tabIndex: key === roving ? 0 : -1,
    "data-node": key,
  });
  const focusNode = (key: string): void => {
    setFocusKey(key);
    const el = box.current?.querySelector(`[data-node="${CSS.escape(key)}"]`);
    if (el instanceof HTMLElement) el.focus();
  };
  const stageKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const target = e.target instanceof HTMLElement ? e.target.dataset["node"] : undefined;
    if (target === undefined) return;
    const [kind, id] = [
      target.slice(0, target.indexOf(":")),
      target.slice(target.indexOf(":") + 1),
    ];
    const dir = ARROWS[e.key];
    if (dir !== undefined && e.altKey && kind === "plugin" && (dir === "left" || dir === "right")) {
      e.preventDefault();
      shift(id, dir === "left" ? -1 : 1);
      return;
    }
    if (dir !== undefined) {
      e.preventDefault();
      const next = nextNode(nodes, target, dir);
      if (next !== null) focusNode(next);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (kind === "plugin") props.onOpen(id);
      else if (kind === "group") toggleFold(id);
      else setSelected(target);
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && kind === "plugin") {
      e.preventDefault();
      remove(id);
      return;
    }
    if (e.key === "Escape") setSelected(null);
  };

  const hoverChip =
    drag === null && hover !== null
      ? layout.chips.find((c) => c.plugin === hover && !c.hidden)
      : undefined;
  const dragPlugin = drag === null ? undefined : pluginById(drag.plugin);
  const groupNames = new Map(profile.groups.map((g) => [g.id, g.name]));
  const contextRow = layout.rows.find((r) => r.block === "context");
  const onlyBase = profile.entries.every((e) => e.origin === "base");
  const drafts = profile.entries.filter((e) => pluginById(e.plugin)?.draft === true).length;
  const currentChoice = choices.find((c) => c.id === profile.id);

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden" style={kindVars(theme)}>
      <div
        ref={box}
        data-pan=""
        role="group"
        aria-roledescription={t("desktop.craft.canvas.cvD.a11y.canvas")}
        aria-label={t("desktop.craft.canvas.cvD.a11y.canvasLabel", {
          name: currentChoice === undefined ? profile.id : choiceName(currentChoice),
        })}
        className={`absolute inset-0 ${drag !== null && drag.pointer !== null ? "cursor-grabbing" : "cursor-default"}`}
        onPointerDown={vp.onPointerDown}
        onKeyDown={stageKey}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelected(null);
        }}
      >
        <Backdrop view={vp.view} theme={theme} />
        <Stage view={vp.view} w={layout.width} h={layout.height}>
          <Groups
            layout={layout}
            names={groupNames}
            selected={selected}
            onToggle={toggleFold}
            onSelect={select}
            nodeProps={nodeProps}
          />
          <Wires layout={layout} dragKind={dragPlugin?.kind ?? null} />
          <Stations layout={layout} selected={selected} onSelect={select} nodeProps={nodeProps} />
          <EmptyStart layout={layout} />
          {drag !== null && dragPlugin !== undefined && (
            <Slots
              slots={layout.slots}
              active={active?.key ?? null}
              kind={dragPlugin.kind}
              emptyStart={layout.emptyStart}
            />
          )}
          <Chips
            layout={layout}
            selected={selected}
            dimmed={drag?.plugin ?? null}
            onSelect={select}
            onOpen={props.onOpen}
            onHover={setHover}
            onDragStart={beginDrag}
            nodeProps={nodeProps}
          />
          {onlyBase && contextRow !== undefined && drag === null && (
            <div
              className="absolute flex items-center whitespace-nowrap rounded-[8px] border border-dashed px-3 text-[12px] text-text-tertiary"
              style={{
                left: CHIP_X0 + CHIP_W + 32,
                top: contextRow.y - 14,
                height: 28,
                borderColor: "color-mix(in oklab, var(--cs-color-text-primary) 18%, transparent)",
              }}
            >
              {t("desktop.craft.canvas.cvD.emptyHint")}
            </div>
          )}
          {hoverChip !== undefined && <HoverCard chip={hoverChip} />}
        </Stage>
      </div>

      <Palette
        profile={profile}
        choices={choices}
        onProfile={chooseProfile}
        picking={drag !== null && drag.pointer === null ? drag.plugin : null}
        onPointerDown={beginDrag}
        onKeyDown={paletteKey}
        picker={props.picker}
        open={paletteOpen}
        onToggle={() => setPaletteOpen((v) => !v)}
      />
      {!paletteOpen && (
        <div className="absolute bottom-3 z-20 w-44" style={{ left: RAIL_W + 12 }}>
          {props.picker}
        </div>
      )}

      <div
        className="pointer-events-none absolute top-3 z-10 flex items-center gap-2"
        style={{ left: paletteW + 12 }}
      >
        <div className="pointer-events-auto flex h-8 items-center gap-2 rounded-[14px] border border-border-subtle bg-surface-base pr-1.5 pl-3 shadow-[var(--cs-elevation-1)]">
          <span className="text-[11px] text-text-tertiary">
            {t("desktop.craft.canvas.cvD.profile")}
          </span>
          <span className="text-[13px] font-medium text-text-primary">
            {currentChoice === undefined ? profile.id : choiceName(currentChoice)}
          </span>
          <Legend />
        </div>
        {drafts > 0 && (
          <span className="pointer-events-auto flex h-8 items-center gap-2 rounded-[14px] border border-border-subtle bg-surface-base px-3 text-[12px] text-[var(--cs-color-warning-text)] shadow-[var(--cs-elevation-1)]">
            <span
              aria-hidden="true"
              className="size-2 rounded-[2px] border border-dashed border-[var(--cs-color-warning-graphic)]"
            />
            {t("desktop.craft.canvas.cvD.draftWarning", { count: drafts })}
          </span>
        )}
      </div>

      {selected !== null && drag === null && (
        <Inspector
          selected={selected}
          profile={profile}
          layout={layout}
          actions={{
            close: () => setSelected(null),
            open: props.onOpen,
            remove,
            shift,
            select: (key) => {
              setSelected(key);
              setFocusKey(key);
            },
            toggle: toggleFold,
          }}
        />
      )}

      <div className="absolute right-3 bottom-3 z-20">
        <ZoomBar vp={vp} />
      </div>

      {drag !== null && drag.pointer !== null && dragPlugin !== undefined && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50"
          style={{
            left: drag.pointer.x - 20,
            top: drag.pointer.y - 13,
            width: CHIP_W,
            height: 26,
            transform: `scale(${vp.view.k})`,
            transformOrigin: "20px 13px",
          }}
        >
          <span
            className="absolute inset-0 shadow-[var(--cs-elevation-3)]"
            style={{ borderRadius: 8 }}
          />
          <ChipShell
            kind={dragPlugin.kind}
            draft={dragPlugin.draft === true}
            selected={false}
            start={false}
          >
            <ChipBody
              chip={{
                plugin: dragPlugin.id,
                kind: dragPlugin.kind,
                guard: dragPlugin.guard === true,
                draft: dragPlugin.draft === true,
                origin: "profile",
                start: false,
              }}
            />
          </ChipShell>
        </div>
      )}
      <div aria-live="polite" className="sr-only">
        {announce}
      </div>
    </div>
  );
}
