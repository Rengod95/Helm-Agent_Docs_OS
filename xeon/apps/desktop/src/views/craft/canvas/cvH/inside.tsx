// cvH 플러그인 내부: 캔버스와 같은 선로 문법으로 한 플러그인의 몸을 그린다(배치는 `inside-model.ts`).
// 머리 왼쪽 경로(프로필 / 플러그인)나 Escape로 돌아간다. 오른쪽 "자세히"는 캔버스와 같은 플로팅 패널을 연다.
// 단계·갈래·카드는 React Flow 노드이고 선은 한 장의 SVG다. 쉬는 동안 도는 것은 없다.
import { t } from "@fresnel/client/i18n";
import {
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useCraftTheme } from "../../orbit.tsx";
import { whereText } from "./facts.ts";
import { Glyph, KIND_COLOR, KindBadge, RiskGauge } from "./glyphs.tsx";
import {
  insideScene,
  type InsideCard,
  type InsideChip,
  type InsideLine,
  type InsideScene,
  type InsideStop,
} from "./inside-model.ts";
import {
  addPlugin,
  movePlugin,
  pluginOf,
  removeGroup,
  removePlugin,
  setStartDrive,
  SLOTS,
  type Rect,
} from "./model.ts";
import { PluginPanel, type PanelActions } from "./panel.tsx";
import { extOf, foldOf } from "./sample-ext.ts";
import {
  currentProfile,
  INSTALLED_GROUPS,
  setProfile,
  toggleFold,
  useCanvasStore,
} from "./store.ts";
import {
  DECISION_WORD,
  FOLD_WORD,
  LANE_WORD,
  PROFILE_WORD,
  RISK_WORD,
  SLOT_WORD,
  STEP_WORD,
} from "./words.ts";

type SceneNode = Node<
  {
    readonly lines: readonly InsideLine[];
    readonly chips: readonly InsideChip[];
    readonly bounds: Rect;
  },
  "iscene"
>;
type StopNode = Node<{ readonly stop: InsideStop }, "istop">;
type CardNode = Node<{ readonly card: InsideCard; readonly plugin: string }, "icard">;

function lineStroke(l: InsideLine): string {
  return l.kind === null ? "var(--cvh-rail)" : KIND_COLOR[l.kind];
}

const LINE_STYLE: Readonly<
  Record<
    InsideLine["role"],
    { readonly width: number; readonly dash?: string; readonly opacity?: number }
  >
> = {
  core: { width: 7 },
  own: { width: 3.5 },
  lane: { width: 2.5 },
  return: { width: 2.5, dash: "8 6" },
  exit: { width: 2.5 },
  handoff: { width: 2, dash: "7 5" },
  branch: { width: 2 },
  onDemand: { width: 3, dash: "2 6" },
  muted: { width: 2, dash: "3 5", opacity: 0.35 },
};

function SceneView(props: NodeProps<SceneNode>): ReactElement {
  const { lines, chips, bounds } = props.data;
  return (
    <svg
      width={bounds.w}
      height={bounds.h}
      viewBox={`${String(bounds.x)} ${String(bounds.y)} ${String(bounds.w)} ${String(bounds.h)}`}
      className="block overflow-visible"
      aria-hidden="true"
    >
      {lines.map((l) => {
        const st = LINE_STYLE[l.role];
        return (
          <path
            key={l.key}
            d={l.d}
            fill="none"
            stroke={lineStroke(l)}
            strokeWidth={st.width}
            strokeDasharray={st.dash}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={st.opacity}
          />
        );
      })}
      {chips
        .filter((c) => c.text !== "")
        .map((c) => {
          const w = c.text.length * 7 + 16;
          return (
            <g key={c.key} transform={`translate(${String(c.x)} ${String(c.y)})`}>
              <rect
                x={-w / 2}
                y={-11}
                width={w}
                height={22}
                rx={11}
                fill="var(--cvh-ground)"
                stroke="var(--cvh-hair)"
              />
              <text
                x={0}
                y={4}
                textAnchor="middle"
                fontSize={12}
                fill="var(--cvh-ink-2)"
                fontFamily={c.mono ? "var(--cvh-mono)" : undefined}
              >
                {c.text}
              </text>
            </g>
          );
        })}
    </svg>
  );
}

function stopLabel(s: InsideStop): string {
  if (s.role === "step") return t(STEP_WORD[stepId(s.ref)]);
  if (s.role === "lane")
    return s.ref === "code" || s.ref === "docs" || s.ref === "tests" ? t(LANE_WORD[s.ref]) : s.ref;
  if (s.role === "server") return s.ref;
  return t(SLOT_WORD[slotId(s.ref)]);
}

function isStepId(k: string): k is keyof typeof STEP_WORD {
  return Object.hasOwn(STEP_WORD, k);
}

function stepId(k: string): keyof typeof STEP_WORD {
  return isStepId(k) ? k : "apply";
}

function slotId(ref: string): keyof typeof SLOT_WORD {
  return SLOTS.find((s) => s === ref) ?? "model";
}

const STOP_SIZE: Readonly<Record<InsideStop["role"], { readonly w: number; readonly h: number }>> =
  {
    core: { w: 150, h: 36 },
    step: { w: 150, h: 40 },
    lane: { w: 120, h: 32 },
    server: { w: 170, h: 40 },
    crossing: { w: 160, h: 70 },
  };

function StopView(props: NodeProps<StopNode>): ReactElement {
  const s = props.data.stop;
  const size = STOP_SIZE[s.role];
  if (s.role === "crossing")
    return (
      <div className="relative" style={{ width: size.w, height: size.h }}>
        <span
          className="absolute left-1/2 -translate-x-1/2 text-[12px] text-[var(--cvh-ink-2)]"
          style={{ top: 0 }}
        >
          {stopLabel(s)}
        </span>
        <span
          className="absolute rotate-45 border-[2.5px]"
          style={{
            left: size.w / 2 - 9,
            top: size.h / 2 - 9,
            width: 18,
            height: 18,
            borderColor: "var(--cvh-hook)",
            background: "var(--cvh-ground)",
          }}
        />
      </div>
    );
  const color =
    s.role === "core"
      ? "var(--cvh-rail)"
      : s.role === "server"
        ? "var(--cvh-tool)"
        : "var(--cvh-drive)";
  return (
    <div
      className="flex items-center justify-center gap-2 rounded-full px-3"
      style={{
        width: size.w,
        height: size.h,
        border: `${s.role === "lane" ? 2 : 3}px solid ${color}`,
        background: "var(--cvh-ground)",
      }}
    >
      {s.order !== null && s.role === "step" && (
        <span className="cvh-mono text-[11px] text-[var(--cvh-ink-3)]">{s.order}</span>
      )}
      {s.role === "server" && <Glyph name="server" size={13} />}
      <span
        className={`truncate ${s.role === "lane" ? "text-[12px] text-[var(--cvh-ink-2)]" : "text-[14px] font-medium text-[var(--cvh-ink)]"} ${s.role === "server" ? "cvh-mono" : ""}`}
      >
        {stopLabel(s)}
      </span>
    </div>
  );
}

function CardView(props: NodeProps<CardNode>): ReactElement | null {
  const { card, plugin } = props.data;
  const p = pluginOf(plugin);
  if (p === undefined) return null;
  const ext = extOf(plugin);
  const box = { width: card.rect.w, height: card.rect.h };
  const shell = "cvh-card flex flex-col justify-center gap-1 px-3.5";
  if (card.type === "instruction" || card.type === "skill" || card.type === "memory") {
    const word =
      card.type === "instruction"
        ? "desktop.craft.canvas.cvH.inside.always"
        : card.type === "memory"
          ? "desktop.craft.canvas.cvH.comp.memory"
          : "desktop.craft.canvas.cvH.inside.onDemand";
    return (
      <div className={shell} style={box}>
        <span className="flex items-center gap-1.5 text-[var(--cvh-ink)]">
          <span style={{ color: "var(--cvh-inject)" }}>
            <Glyph name={card.type === "skill" ? "skill" : "doc"} size={13} />
          </span>
          <span className="cvh-mono truncate text-[13px]">{card.ref}</span>
        </span>
        <span className="text-[11.5px] text-[var(--cvh-ink-3)]">{t(word)}</span>
      </div>
    );
  }
  if (card.type === "tool") {
    return (
      <div className={`${shell} flex-row items-center justify-start`} style={box}>
        <span
          className="inline-block size-[9px] shrink-0 rounded-[2px]"
          style={
            card.writes === true
              ? { background: "var(--cs-color-warning-text)" }
              : { border: "1.5px solid var(--cvh-ink-3)" }
          }
        />
        <span className="cvh-mono truncate text-[13px] text-[var(--cvh-ink)]">{card.ref}</span>
        {card.writes === true && (
          <span className="ml-auto text-[11px] text-[var(--cs-color-warning-text)]">
            {t("desktop.craft.canvas.cvH.risk.write")}
          </span>
        )}
      </div>
    );
  }
  if (card.type === "handler") {
    return (
      <div className={shell} style={box}>
        <span className="flex items-center gap-2">
          <KindBadge kind="hook" size={20} />
          <span className="cvh-mono text-[14px] font-semibold text-[var(--cvh-ink)]">
            {ext?.hook ?? plugin}
          </span>
        </span>
        <span className="text-[12.5px] text-[var(--cvh-ink-2)]">
          {ext?.hook === undefined ? "" : t(FOLD_WORD[foldOf(ext.hook)])}
        </span>
        <span className="text-[11.5px] text-[var(--cvh-ink-3)]">
          {t("desktop.craft.canvas.cvH.inside.handler")}
        </span>
      </div>
    );
  }
  if (card.type === "outcome") {
    const d =
      card.ref === "block" || card.ref === "replace" || card.ref === "ask" ? card.ref : "block";
    return (
      <div
        className={shell}
        style={{
          ...box,
          opacity: card.active ? 1 : 0.42,
          borderStyle: card.active ? "solid" : "dashed",
        }}
      >
        <span className="flex items-center gap-1.5 text-[14px] font-medium text-[var(--cvh-ink)]">
          <span style={{ color: card.active ? "var(--cvh-hook)" : "var(--cvh-ink-3)" }}>
            <Glyph name={d} size={13} />
          </span>
          {t(DECISION_WORD[d])}
        </span>
        <span className="text-[12px] text-[var(--cvh-ink-2)]">{t(OUTCOME_WORD[d])}</span>
      </div>
    );
  }
  if (card.type === "terminus") {
    const to = pluginOf(card.ref);
    return (
      <div
        className="cvh-card flex items-center gap-2.5 px-3.5"
        style={{ ...box, borderStyle: "dashed", borderColor: "var(--cvh-drive)" }}
      >
        {to !== undefined && <KindBadge kind={to.kind} size={24} />}
        <span className="flex min-w-0 flex-col">
          <span className="cvh-mono truncate text-[14px] font-semibold text-[var(--cvh-ink)]">
            {card.ref}
          </span>
          <span className="text-[11.5px] text-[var(--cvh-ink-3)]">
            {t("desktop.craft.canvas.cvH.inside.handoffTo")}
          </span>
        </span>
      </div>
    );
  }
  if (card.type === "settings") {
    return (
      <div className="cvh-card flex flex-col gap-1 px-3.5 py-2.5" style={box}>
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--cvh-ink-3)]">
          <Glyph name="setting" size={12} />
          {t("desktop.craft.canvas.cvH.comp.settings")}
        </span>
        {p.settings.map((s) => (
          <span key={s.key} className="cvh-mono flex justify-between text-[13px]">
            <span className="text-[var(--cvh-ink-2)]">{s.key}</span>
            <span className="text-[var(--cvh-ink)]">{s.value}</span>
          </span>
        ))}
      </div>
    );
  }
  if (card.type === "launch") {
    return (
      <div className="cvh-card flex flex-col gap-1.5 px-3.5 py-2.5" style={box}>
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--cvh-ink-3)]">
          <Glyph name="shield" size={12} />
          {t("desktop.craft.canvas.cvH.comp.launch")}
        </span>
        <code className="cvh-mono rounded-[6px] bg-[var(--cs-color-fill-hover)] px-2 py-1 text-[12.5px] break-all text-[var(--cvh-ink)]">
          {ext?.launch === undefined ? "" : [ext.launch.command, ...ext.launch.args].join(" ")}
        </code>
        <span className="text-[11.5px] text-[var(--cvh-ink-3)]">
          {t("desktop.craft.canvas.cvH.comp.env")}{" "}
          <span className="cvh-mono">{ext?.launch?.envNames.join(", ") ?? ""}</span>
        </span>
      </div>
    );
  }
  return (
    <div className="cvh-card flex flex-col gap-1.5 px-3.5 py-2.5" style={box}>
      <span className="flex items-center gap-1.5 text-[12px] text-[var(--cvh-ink-3)]">
        <Glyph name="shield" size={12} />
        {t("desktop.craft.canvas.cvH.panel.risk")}
      </span>
      <span className="flex items-center gap-2 text-[13px]">
        <RiskGauge risk={p.risk} wide />
        <span
          style={
            p.risk === "exec" || p.risk === "write"
              ? { color: "var(--cs-color-warning-text)" }
              : { color: "var(--cvh-ink)" }
          }
        >
          {t(RISK_WORD[p.risk])}
        </span>
      </span>
      <span className="text-[12.5px] text-[var(--cvh-ink-2)]">
        {p.code
          ? t("desktop.craft.canvas.cvH.panel.code")
          : t("desktop.craft.canvas.cvH.panel.noCode")}
        {ext?.isolated === true && ` · ${t("desktop.craft.canvas.cvH.panel.isolated")}`}
      </span>
    </div>
  );
}

const OUTCOME_WORD = {
  block: "desktop.craft.canvas.cvH.inside.outBlock",
  replace: "desktop.craft.canvas.cvH.inside.outReplace",
  ask: "desktop.craft.canvas.cvH.inside.outAsk",
} as const;

const INSIDE_TYPES: NodeTypes = { iscene: SceneView, istop: StopView, icard: CardView };

function nodesOf(scene: InsideScene, plugin: string): (SceneNode | StopNode | CardNode)[] {
  const out: (SceneNode | StopNode | CardNode)[] = [
    {
      id: "scene",
      type: "iscene",
      position: { x: scene.bounds.x, y: scene.bounds.y },
      width: scene.bounds.w,
      height: scene.bounds.h,
      data: { lines: scene.lines, chips: scene.chips, bounds: scene.bounds },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 0,
    },
  ];
  for (const s of scene.stops) {
    const size = STOP_SIZE[s.role];
    out.push({
      id: s.key,
      type: "istop",
      position: { x: s.x - size.w / 2, y: s.y - size.h / 2 },
      width: size.w,
      height: size.h,
      data: { stop: s },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 2,
    });
  }
  for (const c of scene.cards) {
    out.push({
      id: c.key,
      type: "icard",
      position: { x: c.rect.x, y: c.rect.y },
      width: c.rect.w,
      height: c.rect.h,
      data: { card: c, plugin },
      draggable: false,
      selectable: false,
      zIndex: 3,
    });
  }
  return out;
}

const FIT = {
  padding: { top: "84px", left: "48px", right: "48px", bottom: "48px" },
  maxZoom: 1.05,
} as const;

function Inside(props: {
  readonly name: string;
  readonly onBack: () => void;
  readonly onOpen: (name: string) => void;
}): ReactElement | null {
  const p = pluginOf(props.name);
  const theme = useCraftTheme();
  const store = useCanvasStore();
  const profile = currentProfile(store);
  const [panel, setPanel] = useState(false);
  const scene = useMemo(
    () =>
      p === undefined ? null : insideScene(p, { launch: extOf(props.name)?.launch !== undefined }),
    [p, props.name],
  );
  const nodes = useMemo(
    () => (scene === null ? [] : nodesOf(scene, props.name)),
    [scene, props.name],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !panel) props.onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [panel, props]);
  if (p === undefined || scene === null) return null;

  const actions: PanelActions = {
    close: () => {
      setPanel(false);
    },
    focus: props.onOpen,
    enter: props.onOpen,
    remove: (name) => {
      const r = removePlugin(profile, name);
      if (r.ok) {
        setProfile(r.profile);
        props.onBack();
      }
    },
    removeGroup: (id) => {
      setProfile(removeGroup(profile, id));
      props.onBack();
    },
    add: (name) => {
      setProfile(addPlugin(profile, name, INSTALLED_GROUPS));
    },
    move: (name, dir) => {
      setProfile(movePlugin(profile, name, dir));
    },
    setStart: (name) => {
      setProfile(setStartDrive(profile, name));
    },
    toggleFold,
  };

  return (
    <div className="cvh-root relative min-h-0 flex-1 overflow-hidden" data-scheme={theme}>
      <ReactFlow
        className="cvh-flow"
        nodes={nodes}
        edges={[]}
        nodeTypes={INSIDE_TYPES}
        fitView
        fitViewOptions={FIT}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        disableKeyboardA11y
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        aria-label={t("desktop.craft.canvas.cvH.inside.label", { name: props.name })}
      />
      <div className="absolute top-3 right-4 left-4 z-10 flex items-center gap-2">
        <div className="cvh-float flex h-10 items-center gap-2 rounded-[10px] pe-3 ps-1 shadow-none">
          <button
            type="button"
            className="cvh-btn"
            aria-label={t("desktop.craft.canvas.cvH.inside.back")}
            onClick={props.onBack}
          >
            <Glyph name="left" size={12} />
            {t(PROFILE_WORD[store.current])}
          </button>
          <span className="text-[var(--cvh-ink-3)]">/</span>
          <KindBadge kind={p.kind} size={20} draft={extOf(p.name)?.review === "draft"} />
          <span className="cvh-mono text-[14px] font-semibold text-[var(--cvh-ink)]">{p.name}</span>
          <span className="text-[12.5px] text-[var(--cvh-ink-3)]">{whereText(p)}</span>
          {p.kind === "drive" && (
            <span className="text-[12.5px] text-[var(--cvh-ink-3)]">
              · {t("desktop.craft.canvas.cvH.inside.ownLoop")}
            </span>
          )}
        </div>
        <button
          type="button"
          className="cvh-float cvh-btn ml-auto h-10 rounded-[10px] px-3 shadow-none"
          aria-pressed={panel}
          onClick={() => {
            setPanel((v) => !v);
          }}
        >
          <Glyph name="doc" size={12} />
          {t("desktop.craft.canvas.cvH.inside.details")}
        </button>
      </div>
      {panel && (
        <PluginPanel name={p.name} profile={profile} side="right" inset={0} actions={actions} />
      )}
    </div>
  );
}

export function PluginInside(props: {
  readonly name: string;
  readonly onBack: () => void;
  readonly onOpen: (name: string) => void;
}): ReactElement {
  return (
    <ReactFlowProvider>
      <Inside {...props} />
    </ReactFlowProvider>
  );
}
