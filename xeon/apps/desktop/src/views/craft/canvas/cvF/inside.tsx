// cvF 플러그인 안(cvA·cvC의 방식을 바탕으로): 같은 도면 위에서 한 플러그인의 구성 요소를 흐름으로 편다.
//   Drive: 들어오는 곳(입력 받기 또는 핸드오프 받음) → 단계(병렬 갈래는 세로로 나란히) → 핸드오프 출구, 되돌이(다시 돌기)는 아래 점선. 지침은 위, 설정·권한은 아래.
//   Inject: 지침·스킬·기억이 "늘 싣는다"와 "필요할 때"의 두 갈래로 컨텍스트 조립에 들어간다.
//   Hook: 붙는 자리 → 처리기 → 결정 갈래(지나감·막기·대체·묻기).
//   도구: MCP 서버 → 도구들(쓰기·실행은 표시) → 도구 실행.
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { Button } from "@caustic/react";
import { ChevronLeft } from "@caustic/react/icons";
import {
  BaseEdge,
  ConnectionMode,
  Handle,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import { useEffect, useMemo, type ReactElement, type ReactNode } from "react";
import { useCraftTheme } from "../../orbit.tsx";
import { DecisionGlyph, KIND_COLOR, KindTile, RelationMarkers, kindVars } from "./glyphs.tsx";
import { CATALOG, type Kind, type Plugin } from "./model.ts";
import {
  DECISION_WORD,
  ENFORCEMENT_WORD,
  KIND_WORD,
  LANE_WORD,
  RISK_WORD,
  SPOT_WORD,
  STAGE_WORD,
  STOP_WORD,
} from "./words.ts";

type Tone = "kind" | "plain" | "ghost" | "stop" | "warn";

interface BoxData extends Record<string, unknown> {
  readonly title: string;
  readonly sub: string | null;
  readonly tone: Tone;
  readonly kind: Kind;
  readonly n: string | null;
  readonly mono: boolean;
}

interface FrameData extends Record<string, unknown> {
  readonly title: string;
}

interface TableData extends Record<string, unknown> {
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
  readonly risk: Plugin["risk"] | null;
}

type BoxNode = Node<BoxData, "box">;
type FrameNode = Node<FrameData, "frame">;
type TableNode = Node<TableData, "table">;
type InsideNode = BoxNode | FrameNode | TableNode;

interface LineData extends Record<string, unknown> {
  readonly label: string | null;
  readonly style: "solid" | "dashed" | "handoff" | "loop";
  /** loop: 두 끝 아래로 얼마나 내려가 돌아오나(흐름 px) */
  readonly drop: number;
}
type LineEdge = Edge<LineData, "line">;

function Handles(): ReactElement {
  return (
    <>
      <Handle
        type="source"
        id="l"
        position={Position.Left}
        isConnectable={false}
        className="cvf-handle"
      />
      <Handle
        type="source"
        id="r"
        position={Position.Right}
        isConnectable={false}
        className="cvf-handle"
      />
      <Handle
        type="source"
        id="t"
        position={Position.Top}
        isConnectable={false}
        className="cvf-handle"
      />
      <Handle
        type="source"
        id="b"
        position={Position.Bottom}
        isConnectable={false}
        className="cvf-handle"
      />
    </>
  );
}

function BoxView(props: NodeProps<BoxNode>): ReactNode {
  const d = props.data;
  return (
    <div className="cvf-box" data-tone={d.tone} style={{ color: KIND_COLOR[d.kind] }}>
      {d.n !== null ? <span className="cvf-box-n">{d.n}</span> : null}
      <span className={`cvf-box-title ${d.mono ? "font-mono" : ""}`}>{d.title}</span>
      {d.sub !== null ? <span className="cvf-box-sub">{d.sub}</span> : null}
      <Handles />
    </div>
  );
}

function FrameView(props: NodeProps<FrameNode>): ReactNode {
  return (
    <div className="cvf-inside-frame">
      <span className="cvf-inside-frame-title">{props.data.title}</span>
    </div>
  );
}

const RISK_STEPS = ["none", "read", "write", "exec"] as const;

function TableView(props: NodeProps<TableNode>): ReactNode {
  const d = props.data;
  const at = d.risk === null ? -1 : RISK_STEPS.indexOf(d.risk);
  return (
    <div className="cvf-table">
      <span className="cvf-table-title">{d.title}</span>
      {d.risk !== null ? (
        <div className="cvf-risk" data-level={d.risk}>
          {RISK_STEPS.map((r, i) => (
            <span key={r} className="cvf-risk-step" data-on={i <= at} data-top={i === at}>
              <span className="cvf-risk-bar" />
              <span className="cvf-risk-word">{t(RISK_WORD[r])}</span>
            </span>
          ))}
        </div>
      ) : null}
      <dl className="cvf-kvs">
        {d.rows.map(([k, v]) => (
          <div key={k} className="cvf-kv">
            <dt className="font-mono">{k}</dt>
            <dd className="font-mono">{v}</dd>
          </div>
        ))}
      </dl>
      <Handles />
    </div>
  );
}

/** 되돌아 도는 선: 마지막 단계 아래로 내려가 모든 갈래 밑을 지나 첫 단계로 올라간다 */
function loopPath(sx: number, sy: number, tx: number, ty: number, drop: number) {
  const y = Math.max(sy, ty) + drop;
  const r = 10;
  const d = `M${String(sx)} ${String(sy)}V${String(y - r)}Q${String(sx)} ${String(y)} ${String(sx - r)} ${String(y)}H${String(tx + r)}Q${String(tx)} ${String(y)} ${String(tx)} ${String(y - r)}V${String(ty)}`;
  return { d, lx: (sx + tx) / 2, ly: y };
}

function LineView(props: EdgeProps<LineEdge>): ReactNode {
  const data = props.data;
  if (data?.style === "loop") {
    const { d, lx, ly } = loopPath(
      props.sourceX,
      props.sourceY,
      props.targetX,
      props.targetY,
      data.drop,
    );
    return (
      <>
        <BaseEdge
          id={props.id}
          path={d}
          className="cvf-in-line cvf-in-loop"
          markerEnd="url(#cvf-i-arrow)"
          interactionWidth={0}
        />
        {data.label !== null ? (
          <foreignObject
            x={lx - 120}
            y={ly - 12}
            width={240}
            height={24}
            className="overflow-visible"
          >
            <span className="cvf-in-label cvf-in-label-loop">{data.label}</span>
          </foreignObject>
        ) : null}
      </>
    );
  }
  const [path, lx, ly] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    borderRadius: 10,
    offset: 22,
  });
  return (
    <>
      <BaseEdge
        id={props.id}
        path={path}
        className={`cvf-in-line cvf-in-${data?.style ?? "solid"}`}
        markerEnd="url(#cvf-i-arrow)"
        interactionWidth={0}
      />
      {data?.label !== null && data?.label !== undefined ? (
        <foreignObject x={lx - 70} y={ly - 11} width={140} height={22} className="overflow-visible">
          <span className="cvf-in-label">{data.label}</span>
        </foreignObject>
      ) : null}
    </>
  );
}

const NODES: NodeTypes = { box: BoxView, frame: FrameView, table: TableView };
const EDGES: EdgeTypes = { line: LineView };

const BOX_W = 176;
const BOX_H = 52;

function box(
  id: string,
  x: number,
  y: number,
  data: {
    readonly title: string;
    readonly tone: Tone;
    readonly kind: Kind;
    readonly sub?: string | null;
    readonly n?: string | null;
    readonly mono?: boolean;
  },
  w = BOX_W,
): BoxNode {
  return {
    id,
    type: "box",
    position: { x, y },
    data: { n: null, mono: false, sub: null, ...data },
    draggable: false,
    selectable: false,
    style: { width: w, height: BOX_H },
  };
}

function line(
  id: string,
  source: string,
  target: string,
  sh: string,
  th: string,
  style: LineData["style"] = "solid",
  label: string | null = null,
  drop = 0,
): LineEdge {
  return {
    id,
    type: "line",
    source,
    target,
    sourceHandle: sh,
    targetHandle: th,
    data: { style, label, drop },
    focusable: false,
    selectable: false,
  };
}

interface Scene {
  readonly nodes: readonly InsideNode[];
  readonly edges: readonly LineEdge[];
}

function riskTable(p: Plugin, x: number, y: number): TableNode {
  return {
    id: "risk",
    type: "table",
    position: { x, y },
    data: {
      title: t("desktop.craft.canvas.cvF.sec.risk"),
      risk: p.risk,
      rows: [
        [
          t("desktop.craft.canvas.cvF.k.runs"),
          t(p.code ? "desktop.craft.canvas.cvF.runs.code" : "desktop.craft.canvas.cvF.runs.none"),
        ],
        [t("desktop.craft.canvas.cvF.k.enforcement"), t(ENFORCEMENT_WORD[p.ext.enforcement])],
      ],
    },
    draggable: false,
    selectable: false,
    style: { width: 260 },
  };
}

function settingsTable(p: Plugin, x: number, y: number): TableNode | null {
  if (p.settings.length === 0) return null;
  return {
    id: "settings",
    type: "table",
    position: { x, y },
    data: {
      title: t("desktop.craft.canvas.cvF.part.settings"),
      risk: null,
      rows: p.settings.map((s) => [s.key, s.value] as const),
    },
    draggable: false,
    selectable: false,
    style: { width: 240 },
  };
}

function driveScene(p: Plugin, startDrive: boolean, from: string | null): Scene {
  const nodes: InsideNode[] = [];
  const edges: LineEdge[] = [];
  const steps = p.steps ?? [];
  const COL = 236;
  const LANE = 66;
  const maxLanes = Math.max(1, ...steps.map((s) => s.parallel));
  const midY = ((maxLanes - 1) * LANE) / 2;
  const entry =
    from !== null
      ? t("desktop.craft.canvas.cvF.inside.fromHandoff", { name: from })
      : startDrive
        ? t(STOP_WORD["input-received"])
        : t("desktop.craft.canvas.cvF.inside.command");
  nodes.push(
    box("entry", 0, midY, {
      title: entry,
      sub: t(
        startDrive
          ? "desktop.craft.canvas.cvF.startDrive"
          : "desktop.craft.canvas.cvF.inside.entry",
      ),
      tone: "stop",
      kind: p.kind,
    }),
  );
  const frameX = COL - 30;
  const frameW = steps.length * COL + 20;
  nodes.push({
    id: "frame",
    type: "frame",
    position: { x: frameX, y: -48 },
    data: { title: t("desktop.craft.canvas.cvF.inside.loop", { name: p.name }) },
    draggable: false,
    selectable: false,
    zIndex: -1,
    style: { width: frameW, height: maxLanes * LANE + 96 },
  });
  let prevIds = ["entry"];
  steps.forEach((s, i) => {
    const x = COL * (i + 1);
    const ids: string[] = [];
    const y0 = midY - ((s.parallel - 1) * LANE) / 2;
    for (let k = 0; k < s.parallel; k++) {
      const id = `s${String(i)}-${String(k)}`;
      const lane = s.lanes?.[k];
      nodes.push(
        box(id, x, y0 + k * LANE, {
          title: t(STAGE_WORD[s.id]),
          sub:
            lane !== undefined
              ? t(LANE_WORD[lane])
              : s.parallel > 1
                ? `${String(k + 1)} / ${String(s.parallel)}`
                : null,
          tone: "kind",
          kind: p.kind,
          n: String(i + 1),
        }),
      );
      ids.push(id);
    }
    for (const a of prevIds) for (const b of ids) edges.push(line(`${a}>${b}`, a, b, "r", "l"));
    prevIds = ids;
  });
  const lastX = COL * (steps.length + 1);
  const rounds = p.settings.find((s) => s.key === "maxRounds" || s.key === "retries");
  if (steps.length > 1) {
    const first = "s0-0";
    const last = prevIds[0] ?? first;
    edges.push(
      line(
        "again",
        last,
        first,
        "b",
        "b",
        "loop",
        rounds !== undefined
          ? t("desktop.craft.canvas.cvF.inside.againN", { key: rounds.key, n: rounds.value })
          : t("desktop.craft.canvas.cvF.inside.again"),
        ((maxLanes - 1) * LANE) / 2 + 36,
      ),
    );
  }
  const outs = p.handoffTo ?? [];
  if (outs.length > 0) {
    outs.forEach((to, i) => {
      const target = CATALOG.get(to);
      const id = `out-${to}`;
      nodes.push(
        box(id, lastX + 40, midY + i * LANE, {
          title: to,
          sub: target === undefined ? null : t(KIND_WORD[target.kind]),
          tone: "ghost",
          kind: target?.kind ?? "drive",
          mono: true,
        }),
      );
      for (const a of prevIds)
        edges.push(
          line(`${a}>${id}`, a, id, "r", "l", "handoff", t("desktop.craft.canvas.cvF.rel.handoff")),
        );
    });
  } else {
    nodes.push(
      box("done", lastX + 40, midY, {
        title: t("desktop.craft.canvas.cvF.inside.release"),
        sub: t("desktop.craft.canvas.cvF.inside.releaseSub"),
        tone: "stop",
        kind: p.kind,
      }),
    );
    for (const a of prevIds) edges.push(line(`${a}>done`, a, "done", "r", "l"));
  }
  // 위: 지침 / 아래: 설정·권한
  p.instructions.forEach((f, i) => {
    const id = `ins-${f}`;
    nodes.push(
      box(id, frameX + 20 + i * 200, -170, {
        title: f,
        sub: t("desktop.craft.canvas.cvF.part.instructions"),
        tone: "plain",
        kind: p.kind,
        mono: true,
      }),
    );
    edges.push(line(`${id}>frame`, id, "s0-0", "b", "t", "dashed"));
  });
  const below = maxLanes * LANE + 90;
  const st = settingsTable(p, frameX, below);
  if (st !== null) nodes.push(st);
  nodes.push(riskTable(p, frameX + (st === null ? 0 : 268), below));
  return { nodes, edges: edges.filter((e) => e.source !== e.target) };
}

function injectScene(p: Plugin): Scene {
  const nodes: InsideNode[] = [];
  const edges: LineEdge[] = [];
  const always = [
    ...p.instructions.map((f) => ({ f, part: "instructions" as const })),
    ...p.memory.map((f) => ({ f, part: "memory" as const })),
  ];
  const onDemand = p.skills;
  nodes.push(
    box("plugin", 0, 0, {
      title: p.name,
      sub: t(KIND_WORD[p.kind]),
      tone: "kind",
      kind: p.kind,
      mono: true,
    }),
  );
  const rows = Math.max(always.length, Math.ceil(onDemand.length / 2), 1);
  const H = 64;
  nodes.push(
    box("ctx", 760, ((rows - 1) * H) / 2, {
      title: t(STOP_WORD.context),
      sub: t("desktop.craft.canvas.cvF.inside.block", { n: "01" }),
      tone: "stop",
      kind: p.kind,
    }),
  );
  always.forEach((a, i) => {
    const id = `a-${a.f}`;
    nodes.push(
      box(id, 260, i * H - H, {
        title: a.f,
        sub: t(`desktop.craft.canvas.cvF.part.${a.part}`),
        tone: "plain",
        kind: p.kind,
        mono: true,
      }),
    );
    edges.push(line(`p>${id}`, "plugin", id, "r", "l"));
    edges.push(
      line(
        `${id}>ctx`,
        id,
        "ctx",
        "r",
        "l",
        "solid",
        i === 0 ? t("desktop.craft.canvas.cvF.inside.always") : null,
      ),
    );
  });
  const top = always.length * H;
  onDemand.forEach((s, i) => {
    const id = `k-${s}`;
    nodes.push(
      box(id, 260 + (i % 2) * 196, top + Math.floor(i / 2) * H, {
        title: s,
        sub: t("desktop.craft.canvas.cvF.part.skill"),
        tone: "plain",
        kind: p.kind,
        mono: true,
      }),
    );
    if (i % 2 === 0) edges.push(line(`p>${id}`, "plugin", id, "r", "l"));
    edges.push(
      line(
        `${id}>ctx`,
        id,
        "ctx",
        "r",
        "l",
        "dashed",
        i === 0 ? t("desktop.craft.canvas.cvF.inside.onDemand") : null,
      ),
    );
  });
  const below = top + Math.ceil(onDemand.length / 2) * H + 40;
  nodes.push(riskTable(p, 260, below));
  const st = settingsTable(p, 540, below);
  if (st !== null) nodes.push(st);
  return { nodes, edges };
}

function hookScene(p: Plugin): Scene {
  const nodes: InsideNode[] = [];
  const edges: LineEdge[] = [];
  nodes.push(
    box("point", 0, 70, {
      title: t(SPOT_WORD[p.spot]),
      sub: t("desktop.craft.canvas.cvF.inside.point"),
      tone: "stop",
      kind: p.kind,
    }),
  );
  const h = p.ext.hooks[0];
  nodes.push(
    box(
      "handler",
      250,
      70,
      {
        title: h?.name ?? p.name,
        sub: h === undefined ? null : `${h.fold} · ${p.name}`,
        tone: "kind",
        kind: p.kind,
        mono: true,
      },
      220,
    ),
  );
  edges.push(line("p>h", "point", "handler", "r", "l"));
  const outcomes: { readonly id: string; readonly title: string; readonly tone: Tone }[] = [
    { id: "pass", title: t("desktop.craft.canvas.cvF.inside.pass"), tone: "plain" },
  ];
  if (p.decision !== undefined)
    outcomes.push({
      id: p.decision,
      title: t(DECISION_WORD[p.decision]),
      tone: p.decision === "block" ? "warn" : "kind",
    });
  outcomes.forEach((o, i) => {
    const id = `o-${o.id}`;
    nodes.push(
      box(id, 560, i * 140, {
        title: o.title,
        sub:
          i === 0
            ? t("desktop.craft.canvas.cvF.inside.next")
            : t("desktop.craft.canvas.cvF.inside.decided"),
        tone: o.tone,
        kind: p.kind,
      }),
    );
    edges.push(line(`h>${id}`, "handler", id, "r", "l", i === 0 ? "solid" : "dashed"));
  });
  nodes.push(riskTable(p, 250, 230));
  const st = settingsTable(p, 530, 300);
  if (st !== null) nodes.push(st);
  return { nodes, edges };
}

function toolScene(p: Plugin): Scene {
  const nodes: InsideNode[] = [];
  const edges: LineEdge[] = [];
  const tools = p.mcp?.tools ?? [];
  const H = 62;
  const cols = 3;
  const rows = Math.ceil(tools.length / cols);
  nodes.push(
    box("server", 0, ((rows - 1) * H) / 2, {
      title: p.mcp?.server ?? p.name,
      sub: t("desktop.craft.canvas.cvF.inside.server"),
      tone: "kind",
      kind: p.kind,
      mono: true,
    }),
  );
  tools.forEach((tool, i) => {
    const id = `t-${tool.name}`;
    nodes.push(
      box(id, 250 + (i % cols) * 190, Math.floor(i / cols) * H, {
        title: tool.name,
        sub: tool.writes
          ? t("desktop.craft.canvas.cvF.inside.writes")
          : t("desktop.craft.canvas.cvF.inside.reads"),
        tone: tool.writes ? "warn" : "plain",
        kind: p.kind,
        mono: true,
      }),
    );
    if (i % cols === 0) edges.push(line(`s>${id}`, "server", id, "r", "l"));
  });
  nodes.push(
    box("run", 250 + cols * 190 + 40, ((rows - 1) * H) / 2, {
      title: t(STOP_WORD.tools),
      sub: t("desktop.craft.canvas.cvF.inside.block", { n: "03" }),
      tone: "stop",
      kind: p.kind,
    }),
  );
  for (let r = 0; r < rows; r++) {
    const lastInRow = tools[Math.min(tools.length - 1, r * cols + cols - 1)];
    if (lastInRow !== undefined)
      edges.push(line(`r${String(r)}>run`, `t-${lastInRow.name}`, "run", "r", "l"));
  }
  const below = rows * H + 40;
  nodes.push(riskTable(p, 250, below));
  const st = settingsTable(p, 530, below);
  if (st !== null) nodes.push(st);
  return { nodes, edges };
}

export function PluginInside(props: {
  readonly name: string;
  readonly profileName: string;
  readonly startDrive: boolean;
  readonly from: string | null;
  readonly onBack: () => void;
}): ReactNode {
  const theme = useCraftTheme();
  const rf = useReactFlow();
  const p = CATALOG.get(props.name);
  const scene = useMemo((): Scene => {
    if (p === undefined) return { nodes: [], edges: [] };
    switch (p.kind) {
      case "drive":
        return driveScene(p, props.startDrive, props.from);
      case "inject":
        return injectScene(p);
      case "hook":
        return hookScene(p);
      case "tool":
        return toolScene(p);
      default:
        return assertNever(p.kind, "cvF inside scene");
    }
  }, [p, props.startDrive, props.from]);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      detach(
        rf.fitView({
          padding: { top: "96px", left: "48px", right: "48px", bottom: "48px" },
          maxZoom: 1.15,
          duration: 0,
        }),
        rethrow,
      );
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [rf]);
  if (p === undefined) return null;
  return (
    <div
      className="cvf-root cvf-inside relative flex min-h-0 flex-1 overflow-hidden"
      data-theme={theme}
      data-lod="near"
      style={kindVars(theme)}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onBack();
      }}
    >
      <RelationMarkers prefix="cvf-i" />
      <ReactFlow<InsideNode, LineEdge>
        className="cvf-flow"
        nodes={[...scene.nodes]}
        edges={[...scene.edges]}
        nodeTypes={NODES}
        edgeTypes={EDGES}
        nodesDraggable={false}
        nodesConnectable={false}
        connectionMode={ConnectionMode.Loose}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        deleteKeyCode={null}
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        aria-label={t("desktop.craft.canvas.cvF.inside.label", { name: p.name })}
      />
      <div className="cvf-crumb">
        <Button
          size="sm"
          variant="ghost"
          iconStart={<ChevronLeft aria-hidden />}
          onClick={props.onBack}
        >
          {props.profileName}
        </Button>
        <span className="text-text-tertiary">/</span>
        <KindTile kind={p.kind} size={20} />
        <span className="font-mono text-[14px] font-semibold text-text-primary">{p.name}</span>
        <span className="text-[12.5px]" style={{ color: KIND_COLOR[p.kind] }}>
          {t(KIND_WORD[p.kind])}
        </span>
        <span className="text-[12.5px] text-text-tertiary">· {t(p.ext.purpose)}</span>
        {p.decision !== undefined ? (
          <span className="flex items-center gap-1 text-[12.5px] text-text-secondary">
            <DecisionGlyph decision={p.decision} size={11} />
            {t(DECISION_WORD[p.decision])}
          </span>
        ) : null}
      </div>
    </div>
  );
}
