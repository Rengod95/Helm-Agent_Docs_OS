// cvA 프로필 판: 배경·레일·노드(React Flow), 왼쪽 플러그인 목록, 위 왼쪽 프로필 표시, 오른쪽 위 상세, 아래 도구 막대.
// 끌기는 React Flow의 노드 끌기가 아니라 포인터를 직접 따른다: 목록이나 노드에서 끌면 놓을 수 있는 자리만 드러나고,
// 가장 가까운 자리가 밝아진다. 목록에 놓으면 빠진다. 키보드: 목록에서 Enter로 들고 화살표로 자리를 고른 뒤 Enter, Esc는 취소.
// 노드에서 Enter는 내부 열기, Alt+화살표는 순서, Delete는 빼기, 화살표는 다음 노드로.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Select, SelectOption } from "@caustic/react";
import { ReactFlow, useReactFlow, type FitViewOptions } from "@xyflow/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { useMotionReduced } from "../../../../lib/motion-presets.tsx";
import { InfoTip } from "../../info-tip.tsx";
import { useCraftTheme } from "../../orbit.tsx";
import { Backdrop } from "./backdrop.tsx";
import { KIND_INK, KindGlyph } from "./glyphs.tsx";
import { layoutProfile, nearestSlot, readingOrder, slotsFor, type SlotGeo } from "./layout.ts";
import {
  effectiveOrder,
  handoffsOf,
  inProfile,
  isBase,
  nudge,
  place,
  removeFrom,
  stackKeyOf,
  stackId,
  type Catalog,
  type PluginSpec,
  type ProfileModel,
  type Target,
} from "./model.ts";
import { CanvasActionsContext, NODE_TYPES, type CanvasActions, type CanvasNode } from "./nodes.tsx";
import { Palette } from "./palette.tsx";
import { GroupReadout, PluginReadout } from "./readout.tsx";
import { KIND_KEY, groupName, metaOf, portName, stationName } from "./words.ts";

export interface ProfileChoice {
  readonly id: string;
  readonly title: string;
}

export interface BoardProps {
  readonly profile: ProfileModel;
  readonly choices: readonly ProfileChoice[];
  readonly specs: readonly PluginSpec[];
  readonly catalog: Catalog;
  readonly closed: ReadonlySet<string>;
  readonly onProfile: (next: ProfileModel) => void;
  readonly onChoose: (id: string) => void;
  readonly onToggleGroup: (group: string) => void;
  readonly onOpen: (name: string) => void;
}

interface Drag {
  readonly name: string;
  readonly from: "palette" | "canvas";
  readonly x: number;
  readonly y: number;
  /** 포인터가 왼쪽 목록 위에 있다(캔버스에서 끌어 온 것을 놓으면 빠진다). 움직일 때 잰다 */
  readonly overPalette: boolean;
}

interface Carry {
  readonly name: string;
  readonly index: number;
}

/** 자리 하나를 말로: "도구 실행 앞, 2번째" */
function targetText(target: Target): string {
  const k = target.key;
  const n = target.index + 1;
  if (k.lane === "feed")
    return t("desktop.craft.canvas.cvA.where.feed", { station: stationName(k.station), n });
  if (k.lane === "hook")
    return t("desktop.craft.canvas.cvA.where.hook", { port: portName(k.port), n });
  if (target.index === 0)
    return t("desktop.craft.canvas.cvA.where.start", { station: stationName("input-received") });
  return t("desktop.craft.canvas.cvA.where.drive");
}

function sortSlots(slots: readonly SlotGeo[]): readonly SlotGeo[] {
  return slots.toSorted((a, b) => a.anchor.x - b.anchor.x || a.anchor.y - b.anchor.y);
}

export function Board(props: BoardProps): ReactNode {
  const { profile, catalog, specs, closed } = props;
  const rf = useReactFlow();
  const theme = useCraftTheme();
  const reduced = useMotionReduced();
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [carry, setCarry] = useState<Carry | null>(null);
  // 좁은 창(1100 폭 등)에서는 목록을 접은 채 시작해 레일을 읽을 수 있는 배율을 지킨다
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < 1280);
  const [say, setSay] = useState("");
  const paletteRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => layoutProfile(profile, catalog, closed), [profile, catalog, closed]);
  const moving = drag?.name ?? carry?.name ?? null;
  const movingSpec = moving === null ? undefined : catalog.get(moving);
  const slots = useMemo(
    () => (moving === null ? [] : sortSlots(slotsFor(layout, profile, catalog, moving))),
    [layout, profile, catalog, moving],
  );

  const overPalette = useCallback((x: number, y: number): boolean => {
    const r = paletteRef.current?.getBoundingClientRect();
    return r !== undefined && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }, []);
  const removeHot =
    drag !== null && drag.from === "canvas" && drag.overPalette && !isBase(profile, drag.name);
  const hot: SlotGeo | null =
    drag !== null
      ? removeHot
        ? null
        : nearestSlot(slots, rf.screenToFlowPosition({ x: drag.x, y: drag.y }))
      : carry !== null
        ? (slots[carry.index] ?? null)
        : null;

  // 화면 맞춤: 왼쪽 목록과 위 머리를 피한다
  const fitOptions = useMemo(
    (): FitViewOptions => ({
      padding: { top: "72px", left: collapsed ? "84px" : "232px", right: "76px", bottom: "64px" },
      maxZoom: 1.15,
      minZoom: 0.4,
    }),
    [collapsed],
  );
  const fit = useCallback((): void => {
    detachFit(rf.fitView({ ...fitOptions, duration: reduced ? 0 : 220 }));
  }, [rf, fitOptions, reduced]);
  // 처음 그릴 때와 목록을 접고 펼 때 맞춘다(프로필을 바꾸면 index.tsx가 보드를 새로 띄운다)
  useEffect(() => {
    detachFit(rf.fitView({ ...fitOptions, duration: 0 }));
  }, [rf, fitOptions]);

  const apply = useCallback(
    (name: string, target: Target): void => {
      props.onProfile(place(profile, catalog, name, target));
      setSelected(name);
      setSay(t("desktop.craft.canvas.cvA.say.placed", { name, where: targetText(target) }));
    },
    [props, profile, catalog],
  );

  const remove = useCallback(
    (name: string): void => {
      if (isBase(profile, name)) {
        setSay(t("desktop.craft.canvas.cvA.action.removeBase"));
        return;
      }
      props.onProfile(removeFrom(profile, name));
      setSelected(null);
      setSay(t("desktop.craft.canvas.cvA.say.removed", { name }));
    },
    [props, profile],
  );

  // 포인터 끌기: 5px 넘게 움직이면 끌기, 아니면 누르기(고르기)
  // 놓는 순간의 값: 렌더가 끝난 뒤 옮겨 둔다(창 단위 포인터 처리기가 읽는다)
  const latest = useRef({ slots, apply, remove });
  useLayoutEffect(() => {
    latest.current = { slots, apply, remove };
  }, [slots, apply, remove]);
  const startPointer = useCallback(
    (id: string, from: Drag["from"], e: PointerEvent<HTMLElement>): void => {
      if (e.button !== 0) return;
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      const draggable = !id.startsWith("group:");
      const move = (ev: globalThis.PointerEvent): void => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        if (!draggable) return;
        dragging = true;
        setCarry(null);
        setDrag({
          name: id,
          from,
          x: ev.clientX,
          y: ev.clientY,
          overPalette: overPalette(ev.clientX, ev.clientY),
        });
      };
      const up = (ev: globalThis.PointerEvent): void => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        if (!dragging) {
          if (from === "canvas") setSelected(id);
          return;
        }
        setDrag(null);
        const cur = latest.current;
        if (from === "canvas" && overPalette(ev.clientX, ev.clientY)) {
          cur.remove(id);
          return;
        }
        const hit = nearestSlot(
          cur.slots,
          rf.screenToFlowPosition({ x: ev.clientX, y: ev.clientY }),
        );
        if (hit !== null) cur.apply(id, hit.target);
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
    [rf, overPalette],
  );

  // 키보드 들기: 들고 있는 동안 화살표·Enter·Esc를 먼저 받는다
  useEffect(() => {
    if (carry === null) return undefined;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      const n = slots.length;
      if (n === 0) return;
      let next = carry.index;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (carry.index + 1) % n;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (carry.index - 1 + n) % n;
      else if (e.key === "Enter" || e.key === " ") {
        const slot = slots[carry.index];
        e.preventDefault();
        e.stopPropagation();
        setCarry(null);
        if (slot !== undefined) apply(carry.name, slot.target);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setCarry(null);
        setSay(t("desktop.craft.canvas.cvA.say.cancel"));
        return;
      } else return;
      e.preventDefault();
      e.stopPropagation();
      setCarry({ name: carry.name, index: next });
      const slot = slots[next];
      if (slot !== undefined) setSay(targetText(slot.target));
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [carry, slots, apply]);

  const lift = useCallback(
    (name: string): void => {
      setDrag(null);
      const options = sortSlots(slotsFor(layout, profile, catalog, name));
      const first = options[options.length - 1];
      setCarry({ name, index: Math.max(0, options.length - 1) });
      setSay(
        t("desktop.craft.canvas.cvA.say.lifted", {
          name,
          where: first === undefined ? "" : targetText(first.target),
        }),
      );
    },
    [layout, profile, catalog],
  );

  const order = useMemo(() => readingOrder(layout), [layout]);
  const focusNode = (id: string): void => {
    const el = wrapRef.current?.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${CSS.escape(id)}"]`,
    );
    el?.focus();
  };

  const nodeKey = (id: string, e: KeyboardEvent<HTMLElement>): void => {
    const group = id.startsWith("group:") ? id.slice(6) : null;
    if (e.key === "Enter") {
      e.preventDefault();
      if (group !== null) props.onToggleGroup(group);
      else props.onOpen(id);
      return;
    }
    if (e.key === "Escape") {
      setSelected(null);
      return;
    }
    if (group === null && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      remove(id);
      return;
    }
    const back = e.key === "ArrowUp" || e.key === "ArrowLeft";
    const fwd = e.key === "ArrowDown" || e.key === "ArrowRight";
    if (!back && !fwd) return;
    e.preventDefault();
    if (e.altKey && group === null) {
      const next = nudge(profile, catalog, id, back ? -1 : 1);
      if (next !== profile) {
        props.onProfile(next);
        setSay(t("desktop.craft.canvas.cvA.say.moved", { name: id }));
      }
      return;
    }
    const i = order.indexOf(id);
    const to = order[(i + (back ? -1 : 1) + order.length) % order.length];
    if (to !== undefined) focusNode(to);
  };

  const actions: CanvasActions = {
    pointerDown: (id, e) => {
      startPointer(id, "canvas", e);
    },
    select: setSelected,
    open: props.onOpen,
    toggleGroup: props.onToggleGroup,
    key: nodeKey,
  };

  // 밝힐 것: 고른 노드, 그 핸드오프 상대, 묶음의 구성원
  const lit = useMemo(() => {
    const s = new Set<string>();
    if (selected === null) return s;
    s.add(selected);
    for (const h of handoffsOf(profile, catalog)) {
      if (h.from === selected) s.add(h.to);
      if (h.to === selected) s.add(h.from);
    }
    return s;
  }, [selected, profile, catalog]);

  const movingStack = movingSpec === undefined ? null : stackId(stackKeyOf(movingSpec));
  const receivers = useMemo(
    () => new Set(handoffsOf(profile, catalog).map((h) => h.to)),
    [profile, catalog],
  );

  const nodes = useMemo((): CanvasNode[] => {
    const list: CanvasNode[] = [
      {
        id: "scene",
        type: "scene",
        position: { x: layout.bounds.x, y: layout.bounds.y },
        width: layout.bounds.w,
        height: layout.bounds.h,
        data: {
          layout,
          lit,
          slots,
          hot,
          carryKind: movingSpec?.kind ?? null,
        },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: -1,
      },
    ];
    for (const f of layout.frames) {
      const g = profile.groups.find((x) => x.id === f.group);
      list.push({
        id: `frame:${f.group}`,
        type: "frame",
        position: { x: f.x, y: f.y },
        width: f.w,
        height: f.h,
        data: { frame: f, name: groupName(g?.name ?? f.group) },
        draggable: false,
        selectable: false,
        focusable: false,
        style: { pointerEvents: "none" },
        zIndex: 0,
      });
    }
    for (const n of layout.nodes) {
      const dim = movingStack !== null && n.stack !== movingStack;
      if (n.item.type === "group") {
        const members = n.item.members;
        const g = profile.groups.find(
          (x) => x.id === (n.item.type === "group" ? n.item.group : ""),
        );
        const name = groupName(g?.name ?? n.id);
        const kinds = [
          ...new Set(members.map((m) => catalog.get(m)?.kind).filter((k) => k !== undefined)),
        ];
        list.push({
          id: n.id,
          type: "group",
          position: { x: n.x, y: n.y },
          width: n.w,
          height: n.h,
          data: {
            group: n.item.group,
            name,
            kinds,
            count: members.length,
            selected: selected === n.id,
            dim,
          },
          ariaLabel: t("desktop.craft.canvas.cvA.group.aria", { name, n: members.length }),
          draggable: false,
          selectable: false,
          focusable: true,
          zIndex: 2,
        });
        continue;
      }
      const spec = catalog.get(n.item.name);
      if (spec === undefined) continue;
      const start = profile.startDrive === spec.name;
      const base = isBase(profile, spec.name);
      list.push({
        id: n.id,
        type: "plugin",
        position: { x: n.x, y: n.y },
        width: n.w,
        height: n.h,
        data: {
          spec,
          base,
          start,
          receives: receivers.has(spec.name),
          selected: selected === n.id,
          dim: dim || (drag?.from === "canvas" && drag.name === n.id),
        },
        ariaLabel: t("desktop.craft.canvas.cvA.node.aria", {
          name: spec.name,
          kind: t(KIND_KEY[spec.kind]),
          meta: metaOf(spec, start, receivers.has(spec.name)),
          base: base ? "yes" : "no",
          draft: spec.draft === true ? "yes" : "no",
        }),
        draggable: false,
        selectable: false,
        focusable: true,
        zIndex: 2,
      });
    }
    return list;
  }, [
    layout,
    lit,
    slots,
    hot,
    movingSpec,
    movingStack,
    profile,
    catalog,
    selected,
    receivers,
    drag,
  ]);

  const onFocus = (e: FocusEvent<HTMLDivElement>): void => {
    const el = e.target.closest(".react-flow__node");
    const id = el?.getAttribute("data-id");
    if (id === undefined || id === null || id === "scene" || id.startsWith("frame:")) return;
    if (e.target === el) setSelected(id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (!(e.target instanceof HTMLElement) || !e.target.classList.contains("react-flow__node"))
      return;
    const id = e.target.getAttribute("data-id");
    if (id !== null) nodeKey(id, e);
  };

  const selSpec = selected === null ? undefined : catalog.get(selected);
  const selGroup =
    selected !== null && selected.startsWith("group:")
      ? profile.groups.find((g) => `group:${g.id}` === selected)
      : undefined;
  const empty = effectiveOrder(profile).length === 0;
  const choice = props.choices.find((c) => c.id === profile.id);

  return (
    <CanvasActionsContext value={actions}>
      <div
        ref={wrapRef}
        className="cva-root relative min-h-0 flex-1 overflow-hidden"
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      >
        <ReactFlow
          className="cva-flow"
          nodes={nodes}
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
          minZoom={0.35}
          maxZoom={1.8}
          proOptions={{ hideAttribution: true }}
          aria-label={t("desktop.craft.canvas.cvA.canvas", { profile: choice?.title ?? "" })}
          onPaneClick={() => {
            setSelected(null);
          }}
          onNodeClick={(_, node) => {
            if (node.type === "plugin" || node.type === "group") setSelected(node.id);
          }}
        >
          <Backdrop theme={theme} />
        </ReactFlow>

        {/* 위 왼쪽: 지금 보는 프로필 */}
        <div className="cva-panel absolute top-3 left-3 z-10 flex h-10 items-center gap-2 ps-3 pe-1.5">
          <span className="cva-mono text-[11px] text-text-tertiary">
            {t("desktop.craft.canvas.cvA.profile.label")}
          </span>
          <Select
            size="sm"
            aria-label={t("desktop.craft.canvas.cvA.profile.pick")}
            value={profile.id}
            onValueChange={props.onChoose}
            className="w-40"
          >
            {props.choices.map((c) => (
              <SelectOption key={c.id} value={c.id}>
                {c.title}
              </SelectOption>
            ))}
          </Select>
        </div>

        <Palette
          specs={specs}
          profile={profile}
          collapsed={collapsed}
          carrying={moving}
          removeHot={removeHot}
          ref={paletteRef}
          onToggle={() => {
            setCollapsed((c) => !c);
          }}
          onPointerDown={(name, e) => {
            startPointer(name, "palette", e);
          }}
          onLift={lift}
        />

        {selSpec !== undefined && inProfile(profile, selSpec.name) && moving === null ? (
          <PluginReadout
            spec={selSpec}
            profile={profile}
            catalog={catalog}
            actions={{
              open: props.onOpen,
              nudge: (name, delta) => {
                props.onProfile(nudge(profile, catalog, name, delta));
              },
              remove,
              close: () => {
                setSelected(null);
              },
            }}
          />
        ) : null}
        {selGroup !== undefined && moving === null ? (
          <GroupReadout
            group={selGroup}
            catalog={catalog}
            closed={closed.has(selGroup.id)}
            onToggle={() => {
              props.onToggleGroup(selGroup.id);
            }}
            onPick={(name) => {
              if (closed.has(selGroup.id)) props.onToggleGroup(selGroup.id);
              setSelected(name);
            }}
            onClose={() => {
              setSelected(null);
            }}
          />
        ) : null}

        {empty ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center">
            <div className="cva-mono flex items-center gap-2 text-[12px] text-text-secondary">
              <svg aria-hidden width="14" height="14" viewBox="0 0 14 14">
                <path d="M9 3 5 7l4 4" fill="none" stroke="currentColor" strokeWidth="1.4" />
              </svg>
              {t("desktop.craft.canvas.cvA.empty")}
            </div>
          </div>
        ) : null}

        {/* 아래 가운데: 확대·맞춤과 읽는 법(정보 아이콘 뒤) */}
        <div className="cva-panel absolute bottom-3 left-1/2 z-10 flex h-9 -translate-x-1/2 items-center gap-0.5 px-1.5">
          <ToolButton
            label={t("desktop.craft.orbit.zoom.out")}
            d="M3 7h8"
            onClick={() => {
              detachFit(rf.zoomOut({ duration: reduced ? 0 : 160 }));
            }}
          />
          <ToolButton
            label={t("desktop.craft.orbit.zoom.fit")}
            d="M2.5 5V2.5H5M9 2.5h2.5V5M11.5 9v2.5H9M5 11.5H2.5V9"
            onClick={fit}
          />
          <ToolButton
            label={t("desktop.craft.orbit.zoom.in")}
            d="M3 7h8M7 3v8"
            onClick={() => {
              detachFit(rf.zoomIn({ duration: reduced ? 0 : 160 }));
            }}
          />
          <span aria-hidden className="mx-1 h-4 w-px bg-[var(--cva-line-soft)]" />
          <span className="flex size-7 items-center justify-center">
            <InfoTip
              label={t("desktop.craft.canvas.cvA.legend.label")}
              text={[
                t("desktop.craft.canvas.cvA.legend.rail"),
                t("desktop.craft.canvas.cvA.legend.links"),
                t("desktop.craft.canvas.cvA.legend.marks"),
                t("desktop.craft.canvas.cvA.legend.keys"),
              ]}
            />
          </span>
        </div>

        {drag !== null && movingSpec !== undefined ? (
          <Ghost spec={movingSpec} x={drag.x} y={drag.y} />
        ) : null}
        <div aria-live="polite" className="sr-only">
          {say}
        </div>
      </div>
    </CanvasActionsContext>
  );
}

function ToolButton(props: {
  readonly label: string;
  readonly d: string;
  readonly onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      className="cva-row flex size-7 items-center justify-center text-text-secondary"
    >
      <svg aria-hidden width="14" height="14" viewBox="0 0 14 14">
        <path
          d={props.d}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/** 끄는 동안 포인터를 따라오는 작은 판 */
function Ghost(props: {
  readonly spec: PluginSpec;
  readonly x: number;
  readonly y: number;
}): ReactNode {
  return (
    <div
      className="cva-ghost cva-panel flex h-8 items-center gap-2 px-2.5"
      style={{ transform: `translate(${props.x + 12}px, ${props.y + 10}px)` }}
      data-kind={props.spec.kind}
    >
      <span style={{ color: KIND_INK[props.spec.kind] }} className="flex">
        <KindGlyph kind={props.spec.kind} size={14} />
      </span>
      <span className="text-[13px] text-text-primary">{props.spec.name}</span>
    </div>
  );
}

/** React Flow의 시점 바꾸기는 약속을 돌려준다. 기다릴 것이 없고 실패는 다시 던진다 */
function detachFit(work: Promise<boolean>): void {
  detach(work, rethrow);
}
