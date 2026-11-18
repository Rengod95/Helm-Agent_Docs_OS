// cvC 캔버스의 선. 세 문법이 서로 다르게 읽힌다.
// 1) 루프 흐름(지점 → 지점): 가늘고 흐린 실선, 마디마다 작은 꺾쇠. 턴은 두 줄 경주로로 돌고, 끝에서 입력 받기로 돌아온다. 대화 시작 → 입력 받기는 한 번뿐이라 점선.
// 2) 붙음(코어 루프 ↔ 플러그인): 직선과 둥근 마디. 지점 틀 안의 세로 레일에 마디가 있고 카드로 짧은 가지가 난다. Drive는 턴 틀에 수직 손잡이로 붙는다(루프를 쥔다).
// 3) 핸드오프(플러그인 → 플러그인): 곡선, 끊긴 선, 화살촉, 가운데 이름표. 선택한 카드와 이어진 선은 강조색이 된다.
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import {
  cardKey,
  GEO,
  handoffsOf,
  type CardBox,
  type Layout,
  type PointId,
  type Rect,
  type StationBox,
} from "./model.ts";

const R = 14;

function stationOf(layout: Layout, point: PointId): StationBox | undefined {
  return layout.stations.find((s) => s.point === point);
}

/** 머리말 가운데 높이 */
function midY(r: Rect): number {
  return r.y + GEO.header / 2;
}

/** 꺾쇠(흐름 방향 표시). dir 1이면 오른쪽, -1이면 왼쪽 */
function chevron(x: number, y: number, dir: 1 | -1): string {
  return `M${x - 3 * dir} ${y - 4} L${x + 2 * dir} ${y} L${x - 3 * dir} ${y + 4}`;
}

interface Seg {
  readonly d: string;
  readonly marks: readonly string[];
  readonly dashed?: boolean;
}

/** 루프 흐름 선 */
function spine(layout: Layout): readonly Seg[] {
  const out: Seg[] = [];
  const link = (a: PointId, b: PointId, dashed = false): void => {
    const s = stationOf(layout, a);
    const e = stationOf(layout, b);
    if (s === undefined || e === undefined) return;
    const y1 = midY(s.rect);
    const y2 = midY(e.rect);
    if (Math.abs(y1 - y2) < 1) {
      // 같은 줄: 오른쪽으로 가거나(위 줄) 왼쪽으로 간다(아래 줄)
      const right = e.rect.x > s.rect.x;
      const x1 = right ? s.rect.x + s.rect.w : s.rect.x;
      const x2 = right ? e.rect.x : e.rect.x + e.rect.w;
      out.push({
        d: `M${x1} ${y1} H${x2}`,
        marks: [chevron((x1 + x2) / 2, y1, right ? 1 : -1)],
        dashed,
      });
      return;
    }
    // 위 줄 끝 → 아래 줄 첫 지점: 오른쪽으로 돌아 내려간다
    const x1 = s.rect.x + s.rect.w;
    const x2 = e.rect.x + e.rect.w;
    const xr = Math.max(x1, x2) + 26;
    out.push({
      d: `M${x1} ${y1} H${xr - R} Q${xr} ${y1} ${xr} ${y1 + R} V${y2 - R} Q${xr} ${y2} ${xr - R} ${y2} H${x2}`,
      marks: [
        `M${xr - 4} ${(y1 + y2) / 2 - 3} L${xr} ${(y1 + y2) / 2 + 2} L${xr + 4} ${(y1 + y2) / 2 - 3}`,
      ],
    });
  };
  // 대화 시작(턴 바깥, 위) → 입력 받기: 한 번뿐이라 점선으로 내려온다
  const start = stationOf(layout, "conversation-start");
  const input0 = stationOf(layout, "input-received");
  if (start !== undefined && input0 !== undefined) {
    const x = start.rect.x + 28;
    const y1 = start.rect.y + start.rect.h;
    const y2 = input0.rect.y;
    const ym = (y1 + y2) / 2;
    out.push({
      d: `M${x} ${y1} V${y2}`,
      marks: [`M${x - 4} ${ym - 3} L${x} ${ym + 2} L${x + 4} ${ym - 3}`],
      dashed: true,
    });
  }
  link("input-received", "context");
  link("context", "model");
  link("model", "tools");
  link("tools", "ask");
  link("ask", "agents");
  link("agents", "before-turn-end");
  // 돌아오기: 턴 종료 직전 → 입력 받기(왼쪽으로 가서 위로)
  const end = stationOf(layout, "before-turn-end");
  const input = stationOf(layout, "input-received");
  if (end !== undefined && input !== undefined) {
    const y1 = midY(end.rect);
    const x1 = end.rect.x;
    const xc = input.rect.x + input.rect.w / 2;
    const y2 = input.rect.y + input.rect.h;
    out.push({
      d: `M${x1} ${y1} H${xc + R} Q${xc} ${y1} ${xc} ${y1 - R} V${y2}`,
      marks: [
        `M${xc - 4} ${(y1 + y2) / 2 + 2} L${xc} ${(y1 + y2) / 2 - 3} L${xc + 4} ${(y1 + y2) / 2 + 2}`,
      ],
    });
  }
  return out;
}

/** 지점 안의 레일: 머리말 아래부터 마지막 카드까지 세로선, 카드마다 마디와 짧은 가지 */
function rails(layout: Layout): readonly {
  readonly key: string;
  readonly d: string;
  readonly dots: readonly { x: number; y: number; card: string }[];
}[] {
  return layout.stations.flatMap((s) => {
    const cards = layout.cards.filter((c) => c.place.lane === "point" && c.place.point === s.point);
    if (cards.length === 0) return [];
    const x = s.rect.x + GEO.railX;
    const ys = cards.map((c) => c.rect.y + c.rect.h / 2);
    const top = s.rect.y + GEO.header;
    const bottom = Math.max(...ys);
    const ticks = cards.map((c) => `M${x} ${c.rect.y + c.rect.h / 2} H${c.rect.x}`).join(" ");
    return [
      {
        key: s.point,
        d: `M${x} ${top} V${bottom} ${ticks}`,
        dots: cards.map((c) => ({ x, y: c.rect.y + c.rect.h / 2, card: cardKey(c.card) })),
      },
    ];
  });
}

function boxOf(layout: Layout, key: string): CardBox | undefined {
  return layout.cards.find((c) => cardKey(c.card) === key);
}

/** 핸드오프 곡선: Drive 줄 안이면 위로 둥글게 넘는 호, 루프 안의 카드로 가면 아래로 내려가는 곡선 */
function handoffPath(
  a: Rect,
  b: Rect,
): { readonly d: string; readonly mid: { x: number; y: number }; readonly tip: string } {
  if (Math.abs(a.y - b.y) < 1) {
    const x1 = a.x + a.w;
    const x2 = b.x;
    const y = a.y + a.h / 2;
    const lift = 34;
    const d = `M${x1} ${y} C${x1 + 30} ${y - lift} ${x2 - 30} ${y - lift} ${x2 - 6} ${y}`;
    return {
      d,
      mid: { x: (x1 + x2) / 2, y: y - lift * 0.75 },
      tip: `M${x2 - 12} ${y - 5} L${x2 - 4} ${y} L${x2 - 12} ${y + 3}`,
    };
  }
  // 루프 안의 카드로: 위 Drive 줄에서 오른쪽으로 나가 지점들 바깥을 돌아 내려와, 카드 오른쪽으로 들어간다(카드를 가로지르지 않는다)
  const x1 = a.x + a.w;
  const y1 = a.y + a.h / 2;
  const x2 = b.x + b.w + 6;
  const y2 = b.y + b.h / 2;
  const xr = Math.max(x1, b.x + b.w) + 48;
  const r = 18;
  const d = `M${x1} ${y1} H${xr - r} Q${xr} ${y1} ${xr} ${y1 + r} V${y2 - r} Q${xr} ${y2} ${xr - r} ${y2} H${x2}`;
  return {
    d,
    mid: { x: xr, y: y1 + (y2 - y1) * 0.36 },
    tip: `M${x2 + 8} ${y2 - 4} L${x2} ${y2} L${x2 + 8} ${y2 + 4}`,
  };
}

export interface EdgesProps {
  readonly layout: Layout;
  /** 강조할 카드 키(선택과 이어진 것). 비면 강조가 없다 */
  readonly hot: ReadonlySet<string>;
  readonly startDrive: string | null;
  readonly dimmed: boolean;
}

/** 세계 좌표 SVG 한 장. 이름표(핸드오프)는 글자가 또렷하도록 HTML로 따로 놓는다(`HandoffTags`) */
export function Edges(props: EdgesProps): ReactNode {
  const { layout } = props;
  const b = layout.bounds;
  const f = layout.frame;
  const start = props.startDrive === null ? undefined : boxOf(layout, props.startDrive);
  const any = props.hot.size > 0;
  const ink = (key: string): string =>
    props.hot.has(key) ? "var(--cs-color-accent-solid)" : "var(--cs-color-text-tertiary)";
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
      width={b.w}
      height={b.h}
      viewBox={`${b.x} ${b.y} ${b.w} ${b.h}`}
      style={{ translate: `${b.x}px ${b.y}px` }}
    >
      {/* 턴 틀 */}
      <rect
        x={f.x}
        y={f.y}
        width={f.w}
        height={f.h}
        rx={28}
        fill="none"
        stroke="var(--cs-color-border-default)"
        strokeDasharray="1 5"
        strokeLinecap="round"
        strokeWidth={1.25}
      />
      {/* 루프 흐름 */}
      <g
        stroke="var(--cs-color-text-tertiary)"
        strokeWidth={1.25}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={props.dimmed ? 0.35 : 0.75}
      >
        {spine(layout).map((s) => (
          <g key={s.d}>
            <path d={s.d} strokeDasharray={s.dashed === true ? "3 4" : undefined} />
            {s.marks.map((m) => (
              <path key={m} d={m} />
            ))}
          </g>
        ))}
      </g>
      {/* 붙음: 레일과 마디 */}
      {rails(layout).map((r) => (
        <g key={r.key} fill="none" strokeLinecap="round">
          <path
            d={r.d}
            stroke="var(--cs-color-text-tertiary)"
            strokeOpacity={0.55}
            strokeWidth={1.25}
          />
          {r.dots.map((dot) => (
            <circle
              key={dot.card}
              cx={dot.x}
              cy={dot.y}
              r={3.5}
              fill="var(--cs-color-bg-canvas)"
              stroke={ink(dot.card)}
              strokeWidth={1.5}
            />
          ))}
        </g>
      ))}
      {/* 붙음(Drive): 스타트 Drive가 턴 틀을 쥔다 */}
      {start !== undefined && (
        <g fill="none" strokeLinecap="round">
          <path
            d={`M${start.rect.x + 40} ${start.rect.y + start.rect.h} V${f.y}`}
            stroke={ink(cardKey(start.card))}
            strokeWidth={1.5}
          />
          <circle
            cx={start.rect.x + 40}
            cy={f.y}
            r={4.5}
            fill="var(--cs-color-surface-base)"
            stroke={ink(cardKey(start.card))}
            strokeWidth={1.5}
          />
        </g>
      )}
      {/* 핸드오프 */}
      {handoffsOf(layout).map((h) => {
        const a = boxOf(layout, h.from);
        const z = boxOf(layout, h.to);
        if (a === undefined || z === undefined) return null;
        const p = handoffPath(a.rect, z.rect);
        const on = any && props.hot.has(h.from) && props.hot.has(h.to);
        const color = on ? "var(--cs-color-accent-solid)" : "var(--cs-color-text-secondary)";
        return (
          <g key={`${h.from}>${h.to}`} fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d={p.d} stroke={color} strokeWidth={1.5} strokeDasharray="5 4" />
            <path d={p.tip} stroke={color} strokeWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
}

/** 핸드오프 이름표와 턴 이름표(HTML, 세계 좌표) */
export function EdgeTags(props: { readonly layout: Layout; readonly dimmed: boolean }): ReactNode {
  const { layout } = props;
  const f = layout.frame;
  return (
    <>
      <span
        className={`pointer-events-none absolute top-0 left-0 flex items-center gap-1 whitespace-nowrap rounded-full bg-bg-canvas px-2 text-ui-xs text-text-tertiary ${
          props.dimmed ? "opacity-45" : ""
        }`}
        style={{ translate: `${f.x + f.w - 74}px ${f.y - 9}px` }}
      >
        <svg
          aria-hidden
          width={11}
          height={11}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
          strokeLinecap="round"
        >
          <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" />
          <path d="M12.2 1.8v2.8H9.4" />
        </svg>
        {t("desktop.craft.canvas.cvC.turn")}
      </span>
      {handoffsOf(layout).map((h) => {
        const a = boxOf(layout, h.from);
        const z = boxOf(layout, h.to);
        if (a === undefined || z === undefined) return null;
        const p = handoffPath(a.rect, z.rect);
        return (
          <span
            key={`${h.from}>${h.to}`}
            className="pointer-events-none absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-border-subtle bg-surface-base px-2 py-px text-ui-xs text-text-secondary"
            style={{ left: p.mid.x, top: p.mid.y }}
          >
            {t("desktop.craft.canvas.cvC.handoff")}
          </span>
        );
      })}
    </>
  );
}
