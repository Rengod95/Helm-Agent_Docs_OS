// cv6 플러그인 내부(cv3와 같다): 캔버스와 같은 층 문법을 한 단계 안에서 다시 쓴다. 가운데 밝은 띠가 그 플러그인의 흐름(바닥 층)이고,
// 단계·구성 요소는 그 위에 뜬 판이다. Drive는 자기 루프(단계 흐름, 나란한 갈래, 되돌이, 핸드오프 출구)를 A·C처럼 왼쪽에서 오른쪽으로 읽힌다.
// Inject는 컨텍스트 조립으로 들어가는 재료(늘 실림 / 필요할 때), Hook은 블록 앞뒤의 문과 결정 갈래, 도구는 MCP 서버와 도구(읽기 / 쓰기)다.
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Button } from "@caustic/react";
import { ReactFlow, useReactFlow, type Node, type NodeProps, type NodeTypes } from "@xyflow/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMotionReduced } from "../../../../lib/motion-presets.tsx";
import { useCraftTheme } from "../../orbit.tsx";
import { Icon, KIND_COLOR, KindTile, PartGlyph, type PartIcon } from "./glyphs.tsx";
import { pluginOf, type Kind, type Plugin } from "./model.ts";
import { currentProfile, useCanvasStore } from "./store.ts";
import {
  anchorWord,
  BLOCK_WORD,
  DECISION_WORD,
  KIND_WORD,
  LANE_WORD,
  RISK_WORD,
  STEP_WORD,
  tokens,
} from "./words.ts";

interface Card {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly icon: PartIcon | null;
  readonly kind: Kind | null;
  readonly title: string;
  readonly sub: string;
  readonly lines: readonly string[];
  /** 흐름 위의 단계(종류 색 테두리), 프로필 밖·이 플러그인 밖(윤곽만), 보통 */
  readonly tone: "step" | "ghost" | "plain";
  readonly num: string | null;
}

interface Path {
  readonly d: string;
  readonly style: "flow" | "return" | "handoff" | "feed" | "lazy" | "branch";
  readonly label?: { readonly x: number; readonly y: number; readonly text: string };
}

interface InsideLayout {
  readonly cards: readonly Card[];
  readonly paths: readonly Path[];
  readonly bandHalf: number;
  readonly stations: readonly {
    readonly x0: number;
    readonly x1: number;
    readonly label: string;
  }[];
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

const STEP_W = 196;
const STEP_H = 68;
const LANE_W = 176;
const LANE_H = 50;
const SIDE_W = 232;

function card(c: Partial<Card> & Pick<Card, "id" | "x" | "y" | "w" | "h" | "title">): Card {
  return { icon: null, kind: null, sub: "", lines: [], tone: "plain", num: null, ...c };
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
}

function vcurve(x1: number, y1: number, x2: number, y2: number): string {
  const my = (y1 + y2) / 2;
  return `M${x1} ${y1} C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
}

/** 아래 줄: 설정, 권한과 위험, 기능, 기록 */
function sideCards(p: Plugin, y: number, x0: number): Card[] {
  const out: Card[] = [];
  const s = p.shared;
  let x = x0;
  const push = (c: Omit<Card, "x" | "y" | "w">): void => {
    out.push({ ...c, x, y, w: SIDE_W });
    x += SIDE_W + 20;
  };
  if (s.settings.length > 0)
    push(
      card({
        id: "settings",
        x: 0,
        y: 0,
        w: 0,
        h: 44 + s.settings.length * 22,
        title: t("desktop.craft.canvas.cv3.part.settings"),
        icon: "setting",
        lines: s.settings.map((v) => `${v.key} = ${v.value}`),
      }),
    );
  push(
    card({
      id: "risk",
      x: 0,
      y: 0,
      w: 0,
      h: 88,
      title: t("desktop.craft.canvas.cv3.sec.risk"),
      icon: "permission",
      sub: t(RISK_WORD[s.risk]),
      lines: [
        s.code
          ? t(
              p.meta.isolated === true
                ? "desktop.craft.canvas.cv3.risk.isolated"
                : "desktop.craft.canvas.cv3.risk.inProcess",
            )
          : t("desktop.craft.canvas.cv3.risk.noCode"),
        ...(p.meta.review.state === "draft" ? [t("desktop.craft.canvas.cv3.risk.draftAsk")] : []),
      ],
    }),
  );
  const caps = [...p.meta.requires, ...p.meta.optional];
  if (caps.length > 0)
    push(
      card({
        id: "caps",
        x: 0,
        y: 0,
        w: 0,
        h: 44 + Math.min(caps.length, 6) * 22,
        title: t("desktop.craft.canvas.cv3.inside.caps"),
        icon: "capability",
        lines: caps.slice(0, 6).map((c) => c.id),
      }),
    );
  if (p.meta.recordKinds.length > 0)
    push(
      card({
        id: "records",
        x: 0,
        y: 0,
        w: 0,
        h: 44 + p.meta.recordKinds.length * 22,
        title: t("desktop.craft.canvas.cv3.part.records"),
        icon: "record",
        lines: p.meta.recordKinds,
      }),
    );
  return out;
}

function driveLayout(p: Plugin, start: boolean): InsideLayout {
  const steps = p.shared.steps ?? [];
  const cards: Card[] = [];
  const paths: Path[] = [];
  const maxLanes = Math.max(1, ...steps.map((s) => s.parallel));
  const bandHalf = Math.max(92, (maxLanes * (LANE_H + 14)) / 2 + 40);
  // 들어오는 곳
  cards.push(
    card({
      id: "in",
      x: 0,
      y: -22,
      w: 132,
      h: 44,
      title: t(
        start
          ? "desktop.craft.canvas.cv3.inside.firstMessage"
          : "desktop.craft.canvas.cv3.inside.handoffIn",
      ),
      icon: start ? "stage" : null,
      tone: "ghost",
    }),
  );
  let x = 200;
  let prevRight = { x: 132, ys: [0] };
  const firstX = x;
  steps.forEach((st, i) => {
    if (st.parallel <= 1) {
      cards.push(
        card({
          id: `s${String(i)}`,
          x,
          y: -STEP_H / 2,
          w: STEP_W,
          h: STEP_H,
          title: t(STEP_WORD[st.id]),
          num: String(i + 1),
          tone: "step",
          kind: "drive",
          sub: t("desktop.craft.canvas.cv3.inside.step"),
        }),
      );
      for (const y of prevRight.ys) paths.push({ d: curve(prevRight.x, y, x, 0), style: "flow" });
      prevRight = { x: x + STEP_W, ys: [0] };
      x += STEP_W + 72;
      return;
    }
    const n = st.parallel;
    const ys: number[] = [];
    const lanes = st.lanes ?? [];
    for (let k = 0; k < n; k++) {
      const cy = (k - (n - 1) / 2) * (LANE_H + 14);
      ys.push(cy);
      const lane = lanes[k];
      cards.push(
        card({
          id: `s${String(i)}-${String(k)}`,
          x,
          y: cy - LANE_H / 2,
          w: LANE_W,
          h: LANE_H,
          title:
            lane === undefined ? `${t(STEP_WORD[st.id])} ${String(k + 1)}` : t(LANE_WORD[lane]),
          num: k === 0 ? String(i + 1) : null,
          tone: "step",
          kind: "drive",
          sub:
            k === 0
              ? t("desktop.craft.canvas.cv3.inside.parallel", { step: t(STEP_WORD[st.id]), n })
              : "",
        }),
      );
      for (const y of prevRight.ys) paths.push({ d: curve(prevRight.x, y, x, cy), style: "flow" });
    }
    prevRight = { x: x + LANE_W, ys };
    x += LANE_W + 72;
  });
  // 모으기: 나란한 갈래 뒤에 단계가 없으면 출구에서 모인다
  const exitX = x + 20;
  const handoff = p.shared.handoffTo ?? [];
  if (handoff.length > 0) {
    handoff.forEach((to, k) => {
      const cy = (k - (handoff.length - 1) / 2) * 80;
      cards.push(
        card({
          id: `h-${to}`,
          x: exitX + 70,
          y: cy - 30,
          w: 190,
          h: 60,
          title: to,
          sub: t("desktop.craft.canvas.cv3.inside.handoffTarget"),
          kind: "drive",
          tone: "ghost",
        }),
      );
      for (const y of prevRight.ys)
        paths.push({
          d: curve(prevRight.x, y, exitX + 70, cy),
          style: "handoff",
          ...(k === 0
            ? {
                label: {
                  x: exitX + 20,
                  y: cy - 14,
                  text: t("desktop.craft.canvas.cv3.rel.handoff"),
                },
              }
            : {}),
        });
    });
  } else {
    cards.push(
      card({
        id: "out",
        x: exitX,
        y: -22,
        w: 120,
        h: 44,
        title: t("desktop.craft.canvas.cv3.inside.turnEnd"),
        tone: "ghost",
      }),
    );
    for (const y of prevRight.ys) paths.push({ d: curve(prevRight.x, y, exitX, 0), style: "flow" });
  }
  // 되돌이: 마지막 단계에서 첫 단계로(설정 maxRounds가 있으면 그 수)
  if (steps.length > 1) {
    const rounds = p.shared.settings.find((s) => s.key === "maxRounds" || s.key === "retries");
    const lastRight = prevRight.x - 40;
    const yb = bandHalf - 22;
    paths.push({
      d: `M${lastRight} ${Math.max(...prevRight.ys) + (steps[steps.length - 1]?.parallel === 1 ? STEP_H / 2 : LANE_H / 2)} V${yb} H${firstX + 40} V${STEP_H / 2}`,
      style: "return",
      label: {
        x: (lastRight + firstX) / 2,
        y: yb - 8,
        text:
          rounds === undefined
            ? t("desktop.craft.canvas.cv3.inside.again")
            : t("desktop.craft.canvas.cv3.inside.rounds", { key: rounds.key, n: rounds.value }),
      },
    });
  }
  // 위: 지침(늘 실림)
  p.shared.instructions.forEach((f, k) => {
    const cx = firstX + k * 250;
    cards.push(
      card({
        id: `i-${f}`,
        x: cx,
        y: -bandHalf - 120,
        w: 210,
        h: 64,
        title: f,
        sub: t("desktop.craft.canvas.cv3.part.instructions"),
        icon: "instruction",
      }),
    );
    paths.push({
      d: vcurve(cx + 105, -bandHalf - 56, firstX + STEP_W / 2, -STEP_H / 2),
      style: "feed",
    });
  });
  const side = sideCards(p, bandHalf + 44, 0);
  return finish(cards.concat(side), paths, bandHalf, []);
}

function finish(
  cards: readonly Card[],
  paths: readonly Path[],
  bandHalf: number,
  stations: InsideLayout["stations"],
): InsideLayout {
  const xs = cards.flatMap((c) => [c.x, c.x + c.w]).concat(stations.flatMap((s) => [s.x0, s.x1]));
  const ys = cards.flatMap((c) => [c.y, c.y + c.h]).concat([-bandHalf, bandHalf]);
  const x0 = Math.min(...xs) - 40;
  const y0 = Math.min(...ys) - 40;
  return {
    cards,
    paths,
    bandHalf,
    stations,
    bounds: { x: x0, y: y0, w: Math.max(...xs) + 40 - x0, h: Math.max(...ys) + 40 - y0 },
  };
}

function injectLayout(p: Plugin): InsideLayout {
  const s = p.shared;
  const cards: Card[] = [];
  const paths: Path[] = [];
  const bandHalf = 70;
  const st = { x0: 360, x1: 560, label: t(BLOCK_WORD.context) };
  const next = { x0: 640, x1: 800, label: t(BLOCK_WORD.model) };
  cards.push(
    card({
      id: "in",
      x: 120,
      y: -22,
      w: 132,
      h: 44,
      title: t("desktop.craft.canvas.cv3.boundary.input"),
      tone: "ghost",
    }),
  );
  paths.push({ d: `M252 0 H${st.x0}`, style: "flow" });
  paths.push({ d: `M${st.x1} 0 H${next.x0}`, style: "flow" });
  const always = [...s.instructions, ...s.memory];
  always.forEach((f, k) => {
    const x = 160 + k * 230;
    cards.push(
      card({
        id: `a-${f}`,
        x,
        y: -bandHalf - 150,
        w: 210,
        h: 70,
        title: f,
        sub: t("desktop.craft.canvas.cv3.works.always"),
        icon: s.memory.includes(f) ? "memory" : "instruction",
        lines:
          p.meta.cost.always === null
            ? []
            : [t("desktop.craft.canvas.cv3.inside.tokens", { n: tokens(p.meta.cost.always) })],
      }),
    );
    paths.push({
      d: vcurve(x + 105, -bandHalf - 80, (st.x0 + st.x1) / 2 - 30 + k * 20, -22),
      style: "feed",
    });
  });
  // 스킬: 필요할 때 실린다(점선). 설명만 늘 실린다
  const cols = 3;
  // 늘 실리는 카드가 없으면 스킬 판을 컨텍스트 조립 바로 위 가운데에, 있으면 그 오른쪽에 둔다
  const gridW = cols * 196 - 16;
  const gridX =
    always.length === 0
      ? (st.x0 + st.x1) / 2 - gridW / 2
      : Math.max(620, 160 + always.length * 230 + 40);
  s.skills.forEach((k, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gridX + col * 196;
    const y = -bandHalf - 230 + row * 76;
    cards.push(
      card({
        id: `k-${k}`,
        x,
        y,
        w: 180,
        h: 60,
        title: k,
        sub: t("desktop.craft.canvas.cv3.works.onDemand"),
        icon: "skill",
      }),
    );
    if (row === Math.floor((s.skills.length - 1) / cols))
      paths.push({ d: vcurve(x + 90, y + 60, (st.x0 + st.x1) / 2 + 40, -22), style: "lazy" });
  });
  if (s.skills.length > 0)
    paths.push({
      d: "M0 0",
      style: "lazy",
      label: {
        x: gridX + gridW / 2,
        y: -bandHalf - 250,
        text: t("desktop.craft.canvas.cv3.inside.skillsHint", { n: s.skills.length }),
      },
    });
  const side = sideCards(p, bandHalf + 44, 160);
  return finish(cards.concat(side), paths, bandHalf, [st, next]);
}

function hookLayout(p: Plugin): InsideLayout {
  const s = p.shared;
  const cards: Card[] = [];
  const paths: Path[] = [];
  const bandHalf = 76;
  const before = p.anchor.startsWith("before:") || p.anchor.startsWith("boundary:");
  const blockId = p.anchor === "before:model" ? "model" : "tools";
  const boundary = p.anchor.startsWith("boundary:");
  const st = boundary
    ? { x0: 120, x1: 300, label: t(BLOCK_WORD.record) }
    : { x0: before ? 520 : 160, x1: before ? 720 : 360, label: t(BLOCK_WORD[blockId]) };
  const gateX = boundary ? 420 : before ? 420 : 460;
  paths.push({ d: `M40 0 H${String(Math.min(st.x0, gateX))}`, style: "flow" });
  paths.push({ d: `M${String(Math.max(st.x1, gateX))} 0 H880`, style: "flow" });
  if (!boundary)
    paths.push({ d: before ? `M${gateX} 0 H${st.x0}` : `M${st.x1} 0 H${gateX}`, style: "flow" });
  cards.push(
    card({
      id: "gate",
      x: gateX - 120,
      y: bandHalf + 50,
      w: 240,
      h: 82,
      title: p.name,
      sub: t(anchorWord(p.anchor)),
      kind: "hook",
      tone: "step",
      lines: s.decision === undefined ? [] : [t(DECISION_WORD[s.decision])],
    }),
  );
  paths.push({ d: `M${gateX} 8 V${bandHalf + 50}`, style: "branch" });
  const outs: string[] = [t("desktop.craft.canvas.cv3.works.pass")];
  if (s.decision !== undefined) outs.push(t(DECISION_WORD[s.decision]));
  outs.forEach((o, k) => {
    const x = gateX + 170;
    const y = bandHalf + 50 + k * 56;
    cards.push(card({ id: `o${String(k)}`, x: x + 40, y, w: 170, h: 40, title: o, tone: "ghost" }));
    paths.push({
      d: curve(gateX + 120, bandHalf + 91, x + 40, y + 20),
      style: k === 0 ? "flow" : "branch",
    });
  });
  const side = sideCards(p, bandHalf + 220, 120);
  return finish(cards.concat(side), paths, bandHalf, [st]);
}

function toolLayout(p: Plugin): InsideLayout {
  const s = p.shared;
  const cards: Card[] = [];
  const paths: Path[] = [];
  const bandHalf = 70;
  const st = { x0: 380, x1: 600, label: t(BLOCK_WORD.tools) };
  paths.push({ d: `M120 0 H${st.x0}`, style: "flow" });
  paths.push({ d: `M${st.x1} 0 H860`, style: "flow" });
  cards.push(
    card({
      id: "server",
      x: 380,
      y: -bandHalf - 120,
      w: 220,
      h: 72,
      title: s.mcp?.server ?? p.name,
      sub: t("desktop.craft.canvas.cv3.part.mcp"),
      icon: "mcp",
      kind: "tool",
      tone: "step",
      lines: s.settings.map((v) => `${v.key} = ${v.value}`),
    }),
  );
  paths.push({ d: vcurve(490, -bandHalf - 48, 490, -22), style: "feed" });
  const tools = s.mcp?.tools ?? [];
  const groups = [tools.filter((x) => !x.writes), tools.filter((x) => x.writes)];
  groups.forEach((g, gi) => {
    const x0 = gi === 0 ? -40 : 680;
    g.forEach((tool, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      cards.push(
        card({
          id: `t-${tool.name}`,
          x: x0 + col * 170,
          y: -bandHalf - 230 + row * 50,
          w: 156,
          h: 38,
          title: tool.name,
          tone: "plain",
          icon: gi === 1 ? "lock" : "tool",
        }),
      );
    });
    if (g.length > 0)
      paths.push({
        d: "M0 0",
        style: "lazy",
        label: {
          x: x0 + 160,
          y: -bandHalf - 248,
          text: t(
            gi === 0
              ? "desktop.craft.canvas.cv3.inside.readTools"
              : "desktop.craft.canvas.cv3.inside.writeTools",
            { n: g.length },
          ),
        },
      });
  });
  const side = sideCards(p, bandHalf + 44, 160);
  return finish(cards.concat(side), paths, bandHalf, [st]);
}

// ── 노드 ─────────────────────────────────────────────────────────

interface FloorData extends Record<string, unknown> {
  readonly layout: InsideLayout;
}
interface CardData extends Record<string, unknown> {
  readonly card: Card;
}
type InsideNode = Node<FloorData, "floor"> | Node<CardData, "card">;

function InsideFloor(props: NodeProps<Node<FloorData, "floor">>): ReactNode {
  const l = props.data.layout;
  const b = l.bounds;
  return (
    <svg
      aria-hidden="true"
      className="cv6-floor"
      width={b.w + 4000}
      height={b.h}
      viewBox={`${b.x - 2000} ${b.y} ${b.w + 4000} ${b.h}`}
    >
      <rect
        x={b.x - 2000}
        y={-l.bandHalf}
        width={b.w + 4000}
        height={l.bandHalf * 2}
        className="cv6-band-fill"
      />
      {l.stations.map((s) => (
        <g key={s.label}>
          <rect x={s.x0} y={-22} width={s.x1 - s.x0} height={44} rx={9} className="cv6-station" />
          <text x={(s.x0 + s.x1) / 2} y={5} textAnchor="middle" className="cv6-station-label">
            {s.label}
          </text>
        </g>
      ))}
      {l.paths.map((p, i) => (
        <g key={`${p.d}:${String(i)}`}>
          {p.d === "M0 0" ? null : (
            <path
              d={p.d}
              className={`cv6-in-path cv6-in-${p.style}`}
              markerEnd={
                p.style === "return" || p.style === "handoff" ? "url(#cv6-in-arrow)" : undefined
              }
            />
          )}
          {p.label === undefined ? null : (
            <text
              x={p.label.x}
              y={p.label.y}
              textAnchor="middle"
              className={`cv6-in-label cv6-in-label-${p.style}`}
            >
              {p.label.text}
            </text>
          )}
        </g>
      ))}
      <defs>
        <marker
          id="cv6-in-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M1.5 1.5 8 5 1.5 8.5" className="cv6-in-arrowhead" />
        </marker>
      </defs>
    </svg>
  );
}

function InsideCard(props: NodeProps<Node<CardData, "card">>): ReactNode {
  const c = props.data.card;
  return (
    <div
      className={`cv6-icard cv6-icard-${c.tone}`}
      style={{ width: c.w, height: c.h, ...(c.kind === null ? {} : { color: KIND_COLOR[c.kind] }) }}
      data-card={c.id}
    >
      <div className="flex min-w-0 items-center gap-2">
        {c.num === null ? null : <span className="cv6-step-num">{c.num}</span>}
        {c.icon === null ? null : (
          <span className="text-text-tertiary">
            <PartGlyph name={c.icon} size={14} />
          </span>
        )}
        <span className="truncate text-[14px] font-medium text-text-primary">{c.title}</span>
        {c.sub === "" ? null : (
          <span className="ms-auto shrink-0 truncate text-[11.5px] text-text-tertiary">
            {c.sub}
          </span>
        )}
      </div>
      {c.lines.map((line) => (
        <div key={line} className="cv6-mono truncate text-[12px] text-text-secondary">
          {line}
        </div>
      ))}
    </div>
  );
}

const INSIDE_TYPES: NodeTypes = { floor: InsideFloor, card: InsideCard };

export function PluginInside(props: {
  readonly name: string;
  readonly onBack: () => void;
}): ReactNode {
  const store = useCanvasStore();
  const profile = currentProfile(store);
  const theme = useCraftTheme();
  const rf = useReactFlow();
  const reduced = useMotionReduced();
  const [say, setSay] = useState("");
  const p = pluginOf(props.name);
  const layout = useMemo((): InsideLayout | null => {
    if (p === undefined) return null;
    if (p.kind === "drive") return driveLayout(p, profile.startDrive === p.name);
    if (p.kind === "inject") return injectLayout(p);
    if (p.kind === "hook") return hookLayout(p);
    return toolLayout(p);
  }, [p, profile.startDrive]);
  useEffect(() => {
    if (layout === null) return undefined;
    const id = window.requestAnimationFrame(() => {
      detach(
        rf.fitView({
          nodes: layout.cards.map((c) => ({ id: c.id })),
          padding: { top: "84px", left: "48px", right: "64px", bottom: "72px" },
          maxZoom: 1.1,
          duration: 0,
        }),
        rethrow,
      );
    });
    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [rf, layout]);
  const nodes = useMemo((): InsideNode[] => {
    if (layout === null) return [];
    const b = layout.bounds;
    return [
      {
        id: "floor",
        type: "floor",
        position: { x: b.x - 2000, y: b.y },
        data: { layout },
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: 0,
        style: { pointerEvents: "none" },
      },
      ...layout.cards.map((c): InsideNode => ({
        id: c.id,
        type: "card",
        position: { x: c.x, y: c.y },
        data: { card: c },
        draggable: false,
        selectable: false,
        focusable: false,
      })),
    ];
  }, [layout]);
  if (p === undefined || layout === null) return null;
  return (
    <div className="cv6-root cv6-stage relative flex min-h-0 flex-1" data-scheme={theme}>
      <ReactFlow
        className="cv6-flow"
        nodes={nodes}
        edges={[]}
        nodeTypes={INSIDE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={1.8}
        proOptions={{ hideAttribution: true }}
        aria-label={t("desktop.craft.canvas.cv3.inside.label", { name: p.name })}
      />
      <div className="cv6-chrome absolute top-3 left-3 z-10 flex h-11 items-center gap-2.5 ps-1.5 pe-3.5">
        <button
          type="button"
          data-slot="cv6-button"
          className="cv6-icon-btn"
          aria-label={t("desktop.craft.canvas.cv3.inside.back")}
          onClick={props.onBack}
        >
          <Icon name="back" size={14} />
        </button>
        <span className="text-[13px] text-text-tertiary">
          {t(
            store.current === "dev"
              ? "desktop.craft.canvas.cv3.profile.dev"
              : store.current === "empty"
                ? "desktop.craft.canvas.cv3.profile.empty"
                : "desktop.craft.canvas.sample.scale",
          )}
        </span>
        <span className="text-text-tertiary">/</span>
        <KindTile kind={p.kind} size={22} />
        <span className="text-[14px] font-semibold text-text-primary">{p.name}</span>
        <span className="text-[12.5px]" style={{ color: KIND_COLOR[p.kind] }}>
          {t(KIND_WORD[p.kind])}
        </span>
        <span className="text-[12.5px] text-text-tertiary">{t(anchorWord(p.anchor))}</span>
      </div>
      <div className="absolute top-3 right-[calc(var(--canvas-switcher-room,0px)+var(--spacing)*3)] z-10 flex h-11 items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setSay(t("desktop.craft.canvas.cv3.say.testRun", { name: p.name }));
          }}
        >
          <Icon name="play" size={12} />
          {t("desktop.craft.canvas.cv3.act.test")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            detach(
              rf.fitView({
                nodes: layout.cards.map((c) => ({ id: c.id })),
                padding: { top: "84px", left: "48px", right: "64px", bottom: "72px" },
                maxZoom: 1.1,
                duration: reduced ? 0 : 240,
              }),
              rethrow,
            );
          }}
          aria-label={t("desktop.craft.canvas.cv3.tool.fit")}
        >
          <Icon name="fit" size={14} />
        </Button>
      </div>
      <p className="cv6-chrome absolute bottom-3 left-3 z-10 max-w-[560px] px-3.5 py-2 text-[12.5px] leading-[18px] text-text-secondary">
        {t(p.meta.purpose)}
      </p>
      <div aria-live="polite" className="sr-only">
        {say}
      </div>
    </div>
  );
}
