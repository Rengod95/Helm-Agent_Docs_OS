// cvE의 선 층(SVG, 세계 좌표). 두 가지 연결이 모양부터 다르다:
//  - 루프 ↔ 플러그인(붙음): 곧은 실선. 고리 위 점에서 노드로 똑바로 나간다. Drive는 두 줄 커플링(루프를 쥔다).
//  - 플러그인 ↔ 플러그인(핸드오프): 휜 점선 화살. 고리 밖으로 돌아 넘어간다.
// 코어 고리는 겹선 관(크리스탈)과 옅은 프레넬 번짐이고, 정거장 사이에 흐름 표식(시계 방향)이 있다.
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { anchorOf, flowMarks, polar, RING, type Board, type PlacedNode } from "./layout.ts";
import type { Defs, Slot, Stage } from "./model.ts";

/** Drive 고리의 단계 구슬 자리(위에서 시계 방향). 나란히 도는 단계는 구슬이 여럿 붙는다 */
function stageBeads(
  stages: readonly Stage[],
): readonly { readonly key: string; readonly deg: number; readonly lane: number }[] {
  const out: { key: string; deg: number; lane: number }[] = [];
  const step = 360 / Math.max(1, stages.length);
  stages.forEach((s, i) => {
    const n = s.parallel ?? 1;
    const center = -90 + i * step;
    for (let j = 0; j < n; j += 1)
      out.push({ key: s.key, deg: center + (j - (n - 1) / 2) * 11, lane: j });
  });
  return out;
}

function line(a: { x: number; y: number }, b: { x: number; y: number }): string {
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} L${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}

function DriveRing(props: {
  readonly node: PlacedNode;
  readonly stages: readonly Stage[];
  readonly dim: boolean;
}): ReactNode {
  const { node } = props;
  const r = node.r ?? 60;
  const beads = stageBeads(props.stages);
  const arrow = polar(r, -90 + 360 / Math.max(1, props.stages.length) / 2);
  return (
    <g
      opacity={props.dim ? 0.4 : 1}
      transform={`translate(${String(node.c.x)} ${String(node.c.y)})`}
    >
      <circle r={r + 7} fill="none" stroke="var(--cve-drive-glow)" strokeWidth={14} />
      <circle
        r={r}
        fill="var(--cve-drive-tint)"
        stroke="var(--cs-color-identity-mint)"
        strokeWidth={1.5}
      />
      <circle
        r={r - 5}
        fill="none"
        stroke="var(--cs-color-identity-mint)"
        strokeOpacity={0.3}
        strokeWidth={1}
      />
      {/* 자기 루프의 방향: 첫 두 단계 사이의 작은 화살 머리 */}
      <path
        d="M-3.5 -3 L2.5 0 L-3.5 3"
        fill="none"
        stroke="var(--cs-color-identity-mint)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`translate(${arrow.x.toFixed(1)} ${arrow.y.toFixed(1)}) rotate(${String(-90 + 360 / Math.max(1, props.stages.length) / 2 + 90)})`}
      />
      {beads.map((b) => {
        const p = polar(r, b.deg);
        return (
          <circle
            key={`${b.key}-${String(b.lane)}`}
            cx={p.x}
            cy={p.y}
            r={3.6}
            fill="var(--cs-color-bg-canvas)"
            stroke="var(--cs-color-identity-mint)"
            strokeWidth={1.5}
          />
        );
      })}
    </g>
  );
}

export interface WireFocus {
  /** 밝힐 노드 id들(고른 것과 이웃). 비면 모두 보통 */
  readonly lit: ReadonlySet<string>;
  readonly any: boolean;
  /** 밝힐 지점 */
  readonly slots: ReadonlySet<Slot>;
}

export function Wires(props: {
  readonly board: Board;
  readonly defs: Defs;
  readonly focus: WireFocus;
  /** 끌기 중 놓을 수 있는 지점(고리 위 눈금이 밝아진다) */
  readonly legal: ReadonlySet<Slot>;
}): ReactNode {
  const { board, focus } = props;
  const dimOf = (id: string): boolean => focus.any && !focus.lit.has(id);
  const ticks = new Set<Slot>([...board.usedSlots, ...props.legal]);
  return (
    <svg aria-hidden className="pointer-events-none absolute overflow-visible" width={1} height={1}>
      <defs>
        <radialGradient id="cve-fresnel" cx="0" cy="0" r={RING + 70} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--cve-glow)" stopOpacity={0} />
          <stop offset="0.62" stopColor="var(--cve-glow)" stopOpacity={0.02} />
          <stop offset="0.73" stopColor="var(--cve-glow)" stopOpacity={0.16} />
          <stop offset="0.76" stopColor="var(--cve-glow)" stopOpacity={0.05} />
          <stop offset="1" stopColor="var(--cve-glow)" stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* 코어 고리: 프레넬 번짐(가장자리만 밝은 원판), 겹선 관, 안쪽의 아주 옅은 면 */}
      <circle r={RING + 70} fill="url(#cve-fresnel)" />
      <circle r={RING - 3} fill="var(--cve-core-fill)" />
      <circle r={RING + 2.5} fill="none" stroke="var(--cve-ring)" strokeWidth={1} />
      <circle
        r={RING - 2.5}
        fill="none"
        stroke="var(--cve-ring)"
        strokeOpacity={0.55}
        strokeWidth={1}
      />
      {flowMarks().map((m) => (
        <path
          key={m.deg}
          d="M-3 -3.5 L1.5 0 L-3 3.5"
          fill="none"
          stroke="var(--cve-ring)"
          strokeWidth={1.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={`translate(${m.c.x.toFixed(1)} ${m.c.y.toFixed(1)}) rotate(${m.deg.toFixed(1)})`}
        />
      ))}
      {[...ticks].map((slot) => {
        if (slot === "drive") return null;
        const a = anchorOf(slot);
        const len = Math.hypot(a.x, a.y) || 1;
        const ux = a.x / len;
        const uy = a.y / len;
        const lit = props.legal.has(slot);
        return (
          <path
            key={slot}
            d={line({ x: a.x - ux * 7, y: a.y - uy * 7 }, { x: a.x + ux * 7, y: a.y + uy * 7 })}
            stroke={lit ? "var(--cs-color-canvas-selection)" : "var(--cve-ring)"}
            strokeWidth={lit ? 3 : 1.5}
            strokeLinecap="round"
          />
        );
      })}
      {/* 묶음: 구성원 둘레를 지나는 바깥 궤도 한 토막(점선) */}
      {board.groups.map((g) => (
        <path
          key={g.id}
          d={g.d}
          fill="none"
          stroke="var(--cve-group)"
          strokeWidth={1.25}
          strokeDasharray="1 5"
          strokeLinecap="round"
          opacity={g.open ? 1 : 0}
        />
      ))}
      {board.nodes
        .filter((n) => n.shape === "drive")
        .map((n) => (
          <DriveRing
            key={n.id}
            node={n}
            stages={props.defs[n.id]?.stages ?? []}
            dim={dimOf(n.id)}
          />
        ))}
      {board.tethers.map((tw) => {
        const id = tw.id.slice(2);
        const lit = focus.any && focus.lit.has(id);
        const dim = focus.any && !lit;
        const stroke = lit ? "var(--cve-wire-lit)" : "var(--cve-wire)";
        if (tw.coupling) {
          const dx = tw.to.x - tw.from.x;
          const dy = tw.to.y - tw.from.y;
          const l = Math.hypot(dx, dy) || 1;
          const ox = (-dy / l) * 3;
          const oy = (dx / l) * 3;
          return (
            <g
              key={tw.id}
              opacity={dim ? 0.3 : 1}
              stroke="var(--cs-color-identity-mint)"
              strokeWidth={1.25}
              strokeDasharray={tw.latent ? "3 4" : undefined}
            >
              <path
                d={line(
                  { x: tw.from.x + ox, y: tw.from.y + oy },
                  { x: tw.to.x + ox, y: tw.to.y + oy },
                )}
              />
              <path
                d={line(
                  { x: tw.from.x - ox, y: tw.from.y - oy },
                  { x: tw.to.x - ox, y: tw.to.y - oy },
                )}
              />
              <circle
                cx={tw.to.x}
                cy={tw.to.y}
                r={3}
                fill="var(--cs-color-identity-mint)"
                stroke="none"
              />
            </g>
          );
        }
        return (
          <g key={tw.id} opacity={dim ? 0.3 : 1}>
            <path d={line(tw.from, tw.to)} stroke={stroke} strokeWidth={lit ? 1.5 : 1.15} />
            <circle cx={tw.to.x} cy={tw.to.y} r={2.4} fill={stroke} />
          </g>
        );
      })}
      {board.handoffs.map((h) => {
        const lit = focus.any && (focus.lit.has(h.from) || focus.lit.has(h.to));
        const dim = focus.any && !lit;
        return (
          <g key={h.id} opacity={dim ? 0.3 : 1}>
            <path
              d={h.d}
              fill="none"
              stroke={lit ? "var(--cve-wire-lit)" : "var(--cve-handoff)"}
              strokeWidth={1.4}
              strokeDasharray="6 5"
              strokeLinecap="round"
            />
            <path
              d="M-9 -5 L1 0 L-9 5 Z"
              fill={lit ? "var(--cve-wire-lit)" : "var(--cve-handoff)"}
              transform={`translate(${h.tip.x.toFixed(1)} ${h.tip.y.toFixed(1)}) rotate(${h.tipDeg.toFixed(1)})`}
            />
          </g>
        );
      })}
    </svg>
  );
}

/** 핸드오프 호 가운데의 이름표(HTML 층). 글 하나만 */
export function HandoffLabels(props: {
  readonly board: Board;
  readonly dim: (h: string) => boolean;
}): ReactNode {
  return props.board.handoffs.map((h) => (
    <span
      key={h.id}
      aria-hidden
      style={{ left: h.mid.x, top: h.mid.y }}
      className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-[var(--cve-line)] bg-bg-canvas px-2 py-px text-caption text-text-secondary ${props.dim(h.id) ? "opacity-30" : ""}`}
    >
      {t("desktop.craft.canvas.cvE.handoff")}
    </span>
  ));
}
