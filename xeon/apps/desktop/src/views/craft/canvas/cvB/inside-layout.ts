// 플러그인 내부의 순수 배치. 플러그인은 큰 유리 테두리(frame)이고, 안에 구성 요소 조각이 든다.
// - Drive: 자기 단계가 고리(ring)를 이룬다. 병렬 단계는 겹친 판 한 장(×n), 핸드오프는 고리 위의 문(port)이고 빛줄기로 테두리 밖의 상대 결정에 닿는다.
// - 지침·스킬·메모리·MCP·Hook 핸들러: 테두리 안 가운데. 스킬은 벌집처럼 셋씩 줄을 짓는다.
// - 설정·권한: 테두리 아래 띠.
// - 붙는 곳: 테두리 오른쪽 밖에 블록 틀(흐린 사본)을 두고 기둥으로 잇는다(캔버스와 같은 문법).
import { beamBetween, type Box, type Line, type Point } from "./layout.ts";
import {
  hasPlugin,
  type Anchor,
  type Catalog,
  type CvbPlugin,
  type Part,
  type ProfileState,
} from "./model.ts";

type StepPart = Extract<Part, { readonly kind: "step" }>;

export type InsideNode =
  | { readonly type: "frame"; readonly id: string; readonly box: Box; readonly plugin: CvbPlugin }
  | { readonly type: "part"; readonly id: string; readonly box: Box; readonly part: Part }
  | {
      readonly type: "step";
      readonly id: string;
      readonly box: Box;
      readonly part: StepPart;
      readonly index: number;
    }
  | {
      readonly type: "port";
      readonly id: string;
      readonly box: Box;
      readonly dir: "out" | "in";
      readonly other: string;
      readonly back: boolean;
    }
  | {
      readonly type: "ghostStation";
      readonly id: string;
      readonly box: Box;
      readonly anchor: Anchor;
    }
  | {
      readonly type: "ghostPlugin";
      readonly id: string;
      readonly box: Box;
      readonly plugin: CvbPlugin;
      readonly inProfile: boolean;
    };

type InsideLine =
  | Line
  | { readonly kind: "ring"; readonly id: string; readonly d: string }
  | { readonly kind: "arrow"; readonly id: string; readonly at: Point; readonly angle: number }
  | { readonly kind: "fan"; readonly id: string; readonly d: string };

export interface InsideLayout {
  readonly nodes: readonly InsideNode[];
  readonly lines: readonly InsideLine[];
  readonly bounds: Box;
}

const PART = { w: 196, h: 52 } as const;
const SKILL = { w: 150, h: 38 } as const;
const STEP = { w: 136, h: 46 } as const;
const PORT = { w: 30, h: 30 } as const;
const GHOST = { w: 176, h: 54 } as const;
const GHOST_DRIVE = { w: 196, h: 62 } as const;
const PAD = 28;
const HEAD = 64;
const GAP = 14;
const RING_R = 118;

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** MCP 조각의 높이(도구 칩 줄 수에 따라) */
function mcpSize(part: Extract<Part, { readonly kind: "mcp" }>): {
  readonly w: number;
  readonly h: number;
} {
  const rows = Math.ceil(part.tools.length / 3);
  return { w: 420, h: 58 + rows * 26 };
}

function partSize(part: Part): { readonly w: number; readonly h: number } {
  if (part.kind === "mcp") return mcpSize(part);
  if (part.kind === "handler") return { w: 260, h: 64 };
  if (part.kind === "skill") return SKILL;
  return PART;
}

/** 고리에 서는 것: 받음 문 → 단계들 → 넘김 문 → (돌려받는 받음이면) 돌려줌 문 */
type RingItem =
  | { readonly kind: "step"; readonly part: StepPart; readonly index: number }
  | {
      readonly kind: "port";
      readonly dir: "out" | "in";
      readonly other: string;
      readonly back: boolean;
    };

export function layoutInside(
  plugin: CvbPlugin,
  state: ProfileState,
  catalog: Catalog,
): InsideLayout {
  const nodes: InsideNode[] = [];
  const lines: InsideLine[] = [];
  const steps = plugin.parts.filter((p): p is StepPart => p.kind === "step");
  const outgoing = plugin.parts.flatMap((p) => (p.kind === "handoff" ? [p] : []));
  const incoming: { readonly from: string; readonly back: boolean }[] = [];
  for (const other of catalog.values()) {
    for (const p of other.parts) {
      if (p.kind === "handoff" && p.to === plugin.id)
        incoming.push({ from: other.id, back: p.back });
    }
  }
  const core = plugin.parts.filter(
    (p) =>
      p.kind === "rule" ||
      p.kind === "skill" ||
      p.kind === "memory" ||
      p.kind === "mcp" ||
      p.kind === "handler",
  );
  const strip = plugin.parts.filter((p) => p.kind === "setting" || p.kind === "permission");

  // 고리(Drive)
  const ring: RingItem[] = [
    ...incoming.map((h) => ({
      kind: "port" as const,
      dir: "in" as const,
      other: h.from,
      back: false,
    })),
    ...steps.map((part, index) => ({ kind: "step" as const, part, index })),
    ...outgoing.map((h) => ({
      kind: "port" as const,
      dir: "out" as const,
      other: h.to,
      back: h.back,
    })),
    ...incoming
      .filter((h) => h.back)
      .map((h) => ({ kind: "port" as const, dir: "out" as const, other: h.from, back: false })),
  ];
  const hasRing = steps.length > 0;
  const ringW = hasRing ? RING_R * 2 + STEP.w + 40 : 0;
  const ringH = hasRing ? RING_R * 2 + STEP.h + 70 : 0;

  // 가운데 조각들의 배치(스킬은 셋씩 줄, 나머지는 한 줄씩)
  const skills = core.filter((p) => p.kind === "skill");
  const others = core.filter((p) => p.kind !== "skill");
  const skillCols = Math.min(3, skills.length);
  const skillRows = Math.ceil(skills.length / 3);
  const skillW =
    skillCols > 0
      ? skillCols * SKILL.w + (skillCols - 1) * GAP + (skillRows > 1 ? SKILL.w / 2 : 0)
      : 0;
  const skillH = skillRows > 0 ? skillRows * SKILL.h + (skillRows - 1) * GAP : 0;
  const otherSizes = others.map(partSize);
  const othersW = Math.max(0, ...otherSizes.map((s) => s.w));
  const othersH =
    otherSizes.reduce((sum, s) => sum + s.h, 0) + Math.max(0, others.length - 1) * GAP;
  const coreW = Math.max(skillW, othersW);
  const coreH = skillH + (skillH > 0 && othersH > 0 ? GAP * 2 : 0) + othersH;

  const stripSizes = strip.map(() => PART);
  const stripW = stripSizes.reduce((sum, s) => sum + s.w, 0) + Math.max(0, strip.length - 1) * GAP;

  const bodyW = Math.max(ringW + (hasRing && coreW > 0 ? 48 : 0) + coreW, stripW, 360);
  const bodyH = Math.max(ringH, coreH) + (strip.length > 0 ? GAP * 2 + PART.h : 0);
  const frame: Box = { x: 0, y: 0, w: bodyW + PAD * 2, h: HEAD + bodyH + PAD };
  nodes.push({ type: "frame", id: "frame", box: frame, plugin });

  const top = HEAD;
  const left = PAD;
  const mainH = Math.max(ringH, coreH);

  // 고리
  const ringCenter: Point = { x: left + ringW / 2, y: top + mainH / 2 };
  const placedPorts = new Map<string, Box>();
  if (hasRing) {
    lines.push({
      kind: "ring",
      id: "ring",
      d: `M${ringCenter.x - RING_R} ${ringCenter.y} a${RING_R} ${RING_R} 0 1 0 ${RING_R * 2} 0 a${RING_R} ${RING_R} 0 1 0 ${-RING_R * 2} 0`,
    });
    const n = ring.length;
    const angleOf = (i: number): number => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    ring.forEach((item, i) => {
      const a = angleOf(i);
      const p: Point = {
        x: ringCenter.x + Math.cos(a) * RING_R,
        y: ringCenter.y + Math.sin(a) * RING_R,
      };
      if (item.kind === "step") {
        const h = item.part.parallel === undefined ? STEP.h : STEP.h + 10;
        nodes.push({
          type: "step",
          id: `step:${item.part.id}`,
          box: { x: p.x - STEP.w / 2, y: p.y - h / 2, w: STEP.w, h },
          part: item.part,
          index: item.index,
        });
      } else {
        const box: Box = { x: p.x - PORT.w / 2, y: p.y - PORT.h / 2, w: PORT.w, h: PORT.h };
        const id = `port:${item.dir}:${item.other}:${String(i)}`;
        nodes.push({ type: "port", id, box, dir: item.dir, other: item.other, back: item.back });
        placedPorts.set(id, box);
      }
      // 다음 자리로 가는 화살(호의 가운데)
      const mid = (angleOf(i) + angleOf(i + 1)) / 2;
      lines.push({
        kind: "arrow",
        id: `arrow:${String(i)}`,
        at: { x: ringCenter.x + Math.cos(mid) * RING_R, y: ringCenter.y + Math.sin(mid) * RING_R },
        angle: (mid * 180) / Math.PI + 90,
      });
    });
  }

  // 가운데 조각
  let cy = top + (mainH - coreH) / 2;
  const coreLeft = left + ringW + (hasRing && coreW > 0 ? 48 : 0);
  const anchorFrom: Point[] = [];
  skills.forEach((part, i) => {
    const row = Math.floor(i / 3);
    const col = i % 3;
    const shift = row % 2 === 1 ? SKILL.w / 2 : 0;
    const box: Box = {
      x: coreLeft + (coreW - skillW) / 2 + shift + col * (SKILL.w + GAP),
      y: cy + row * (SKILL.h + GAP),
      w: SKILL.w,
      h: SKILL.h,
    };
    nodes.push({ type: "part", id: `part:${part.id}`, box, part });
  });
  if (skills.length > 0) {
    anchorFrom.push({ x: coreLeft + (coreW + skillW) / 2, y: cy + skillH / 2 });
    cy += skillH + (othersH > 0 ? GAP * 2 : 0);
  }
  others.forEach((part, i) => {
    const size = otherSizes[i] ?? PART;
    const box: Box = { x: coreLeft + (coreW - size.w) / 2, y: cy, w: size.w, h: size.h };
    nodes.push({ type: "part", id: `part:${part.id}`, box, part });
    if (part.kind !== "rule" || plugin.kind === "inject")
      anchorFrom.push({ x: box.x + box.w, y: box.y + box.h / 2 });
    cy += size.h + GAP;
  });

  // 아래 띠(설정·권한)
  let sx = left + (bodyW - stripW) / 2;
  const sy = top + mainH + GAP * 2;
  for (const part of strip) {
    nodes.push({
      type: "part",
      id: `part:${part.id}`,
      box: { x: sx, y: sy, w: PART.w, h: PART.h },
      part,
    });
    sx += PART.w + GAP;
  }

  // 붙는 곳(테두리 오른쪽 밖)
  if (plugin.anchor.at !== "drive" && anchorFrom.length > 0) {
    const station: Box = {
      x: frame.x + frame.w + 80,
      y: top + mainH / 2 - 20,
      w: 132,
      h: 40,
    };
    nodes.push({ type: "ghostStation", id: "ghost:station", box: station, anchor: plugin.anchor });
    const socket: Point = { x: station.x, y: station.y + station.h / 2 };
    const busX = frame.x + frame.w + 36;
    anchorFrom.forEach((from, i) => {
      lines.push({
        kind: "rod",
        id: `rod:${String(i)}`,
        d: `M${r1(from.x)} ${r1(from.y)} H${r1(busX)} V${r1(socket.y)} H${r1(socket.x)}`,
        ghost: false,
        lit: false,
      });
    });
  }

  // 핸드오프 상대(테두리 왼쪽 밖) + 빛줄기
  const others2 = [...new Set([...outgoing.map((h) => h.to), ...incoming.map((h) => h.from)])];
  others2.forEach((otherId, i) => {
    const other = catalog.get(otherId);
    if (other === undefined) return;
    const size = other.kind === "drive" ? GHOST_DRIVE : GHOST;
    const box: Box = {
      x: -size.w - 120,
      y: top + mainH / 2 - size.h / 2 + i * (size.h + 40),
      w: size.w,
      h: size.h,
    };
    nodes.push({
      type: "ghostPlugin",
      id: `ghost:${otherId}`,
      box,
      plugin: other,
      inProfile: hasPlugin(state, otherId),
    });
    for (const [id, port] of placedPorts) {
      if (!id.includes(`:${otherId}:`)) continue;
      const dirOut = id.startsWith("port:out");
      const back = outgoing.some((h) => h.to === otherId && h.back);
      lines.push(
        dirOut
          ? beamBetween(`beam:${id}`, port, box, back, true)
          : beamBetween(`beam:${id}`, box, port, false, true),
      );
    }
  });

  return { nodes, lines, bounds: boundsOf(nodes) };
}

function boundsOf(nodes: readonly InsideNode[]): Box {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const node of nodes) {
    minX = Math.min(minX, node.box.x);
    minY = Math.min(minY, node.box.y);
    maxX = Math.max(maxX, node.box.x + node.box.w);
    maxY = Math.max(maxY, node.box.y + node.box.h);
  }
  return { x: minX - 40, y: minY - 40, w: maxX - minX + 80, h: maxY - minY + 80 };
}
