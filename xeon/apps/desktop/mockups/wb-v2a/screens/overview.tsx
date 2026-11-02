// 지도 1단계 "개요": 큰 개념 다섯과 수. 가운데 에이전트 루프(고리) 위에 소켓 7종, 맨 위에 drive 자리. 위에서 꽂는 묶음(플러그인 그룹,
// 외부 plugin), 옆에서 대 주는 서비스, 무엇을 켤지 정하는 맥락, 아래 기반. 굵고 연한 띠(리본)가 관계 하나와 그 수를 말한다.
import type { ReactNode } from "react";
import { Diamond, Layers, LayoutGrid, Package, Play, Plug } from "../../_shell";
import type { Hue } from "../data";
import { useMock } from "../store";
import { HueTile, hueVar } from "../parts/kit";

export const OW = { w: 900, h: 636 };
export const RING = { cx: 450, cy: 334, r: 114 };

const SOCKS: { kind: string; count: number; deg: number; used: number }[] = [
  { kind: "input", count: 3, deg: 180, used: 1 },
  { kind: "request", count: 9, deg: 214, used: 0 },
  { kind: "guard", count: 3, deg: 236, used: 0 },
  { kind: "tool", count: 5, deg: 304, used: 2 },
  { kind: "boundary", count: 9, deg: 332, used: 2 },
  { kind: "session", count: 15, deg: 40, used: 1 },
  { kind: "lifecycle", count: 2, deg: 140, used: 1 },
];
const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [RING.cx + Math.cos(a) * r, RING.cy + Math.sin(a) * r] as const;
};

export interface TileProps {
  x: number;
  y: number;
  w: number;
  h: number;
  hue: Hue;
  icon: ReactNode;
  layer: string;
  title: string;
  count: ReactNode;
  desc: string;
  children?: ReactNode;
  onOpen?: () => void;
  dim?: boolean;
}
export function Tile({
  x,
  y,
  w,
  h,
  hue,
  icon,
  layer,
  title,
  count,
  desc,
  children,
  onOpen,
  dim,
}: TileProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`absolute flex flex-col gap-2 rounded-2xl bg-surface-raised p-3.5 text-left shadow-2 outline-none transition-[box-shadow,opacity] hover:shadow-3 focus-visible:focus-ring ${dim ? "opacity-35" : ""}`}
      style={{ left: x, top: y, width: w, height: h }}
    >
      <span className="flex items-center gap-2.5">
        <HueTile hue={hue} size={32}>
          {icon}
        </HueTile>
        <span className="grid flex-1 leading-tight">
          <span className="font-mono text-mono-micro" style={{ color: hueVar(hue, "ink") }}>
            {layer}
          </span>
          <span className="text-ui-lg text-text-primary" style={{ fontWeight: 600 }}>
            {title}
          </span>
        </span>
        <span className="text-stat text-text-primary tabular-nums">{count}</span>
      </span>
      <span className="text-ui-sm text-text-secondary">{desc}</span>
      <span className="mt-auto flex flex-wrap gap-1.5">{children}</span>
    </button>
  );
}

export function MiniChip({
  hue,
  children,
  dot,
}: {
  hue: Hue;
  children: ReactNode;
  dot?: "danger" | "warning" | "off";
}) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-md bg-neutral-well px-2 text-ui-xs text-text-secondary">
      <span
        className="size-1.5 rounded-full"
        style={{
          background:
            dot === "danger"
              ? "var(--cs-color-danger-solid)"
              : dot === "warning"
                ? "var(--cs-color-warning-solid)"
                : dot === "off"
                  ? "var(--cs-color-neutral-track)"
                  : hueVar(hue, "ink"),
        }}
      />
      {children}
    </span>
  );
}

function Ribbon({
  d,
  hue,
  label,
  lx,
  ly,
  dashed,
}: {
  d: string;
  hue: Hue | "accent";
  label?: string;
  lx?: number;
  ly?: number;
  dashed?: boolean;
}) {
  const c = hue === "accent" ? "var(--cs-color-accent-solid)" : hueVar(hue, "ink");
  return (
    <>
      <path d={d} fill="none" stroke={c} strokeWidth={10} strokeLinecap="round" opacity={0.14} />
      <path
        d={d}
        fill="none"
        stroke={c}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeDasharray={dashed ? "4 5" : undefined}
      />
      {label !== undefined && (
        <foreignObject x={(lx ?? 0) - 70} y={(ly ?? 0) - 11} width={140} height={22}>
          <div className="flex justify-center">
            <span className="inline-flex h-[22px] items-center rounded-full bg-surface-raised px-2.5 text-ui-xs whitespace-nowrap text-text-secondary shadow-1 tabular-nums">
              {label}
            </span>
          </div>
        </foreignObject>
      )}
    </>
  );
}

export function Overview({ spot }: { spot?: "loop" | null }) {
  const m = useMock();
  const open = () => m.set({ zoom: "layer" });
  const dimOthers = spot === "loop";
  return (
    <div className="wbv2 relative" style={{ width: OW.w, height: OW.h }}>
      <svg aria-hidden className="absolute inset-0" width={OW.w} height={OW.h}>
        <Ribbon
          d="M250 134 C 250 220, 330 240, 372 262"
          hue="l3"
          label="꽂힘 on 12 · drive 3"
          lx={232}
          ly={170}
        />
        <Ribbon
          d="M650 134 C 650 220, 570 240, 528 262"
          hue="pl"
          label="꽂힘 on 1"
          lx={668}
          ly={170}
        />
        <Ribbon d="M142 282 L142 134" hue="l2" label="기능 9" lx={142} ly={212} />
        <Ribbon d="M634 356 C 610 356, 590 342, 566 340" hue="accent" dashed />
        <Ribbon d={`M450 ${RING.cy + RING.r + 12} L450 492`} hue="base" />
        {/* 고리 */}
        <circle
          cx={RING.cx}
          cy={RING.cy}
          r={RING.r}
          fill="none"
          stroke="var(--track)"
          strokeWidth={18}
        />
        <circle
          cx={RING.cx}
          cy={RING.cy}
          r={RING.r + 13}
          fill="none"
          stroke="var(--track-edge)"
          strokeWidth={1}
          opacity={0.6}
        />
        <circle
          cx={RING.cx}
          cy={RING.cy}
          r={RING.r - 13}
          fill="var(--cs-color-surface-raised)"
          opacity={0.55}
        />
        {/* 시계 방향 화살표 */}
        {[197, 224, 270, 318, 0, 90].map((deg) => {
          const [x, y] = pt(deg, RING.r);
          return (
            <path
              key={deg}
              d="M-3 -4 L2 0 L-3 4"
              transform={`translate(${x} ${y}) rotate(${deg + 90})`}
              fill="none"
              stroke="var(--cs-color-text-tertiary)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
      {/* 소켓 */}
      {SOCKS.map((s) => {
        const [x, y] = pt(s.deg, RING.r);
        const [lx, ly] = pt(s.deg, RING.r + 40);
        const used = s.used > 0;
        return (
          <div key={s.kind}>
            <span
              className="absolute grid size-[30px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-ui-sm tabular-nums shadow-2"
              style={{
                left: x,
                top: y,
                background: used ? "var(--tint-x)" : "var(--cs-color-surface-raised)",
                boxShadow: `0 0 0 2px ${used ? "var(--ink-x)" : "var(--track-edge)"}, var(--cs-elevation-2)`,
                color: used ? "var(--cs-color-text-primary)" : "var(--cs-color-text-tertiary)",
                fontWeight: 600,
              }}
            >
              {s.count}
            </span>
            <span
              className="absolute -translate-x-1/2 -translate-y-1/2 text-center leading-tight whitespace-nowrap"
              style={{ left: lx, top: ly }}
            >
              <span
                className={`block text-ui-xs ${used ? "text-text-primary" : "text-text-tertiary"}`}
              >
                {s.kind}
              </span>
              <span className="block text-micro text-text-tertiary">
                {used ? `${s.used}곳 씀` : "비어 있음"}
              </span>
            </span>
          </div>
        );
      })}
      {/* drive 자리 */}
      <span
        className="absolute flex h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-surface-raised px-3 text-ui-xs text-text-secondary shadow-2 [&_svg]:size-3"
        style={{ left: RING.cx, top: RING.cy - RING.r - 30 }}
      >
        <Play /> drive 자리 · 대화마다 1
      </span>
      {/* 고리 가운데 */}
      <div
        className={`absolute grid -translate-x-1/2 -translate-y-1/2 justify-items-center gap-0.5 text-center ${spot === "loop" ? "" : ""}`}
        style={{ left: RING.cx, top: RING.cy }}
      >
        <span className="font-mono text-mono-micro text-text-tertiary">L1 loop</span>
        <span className="text-title-4 text-text-primary" style={{ fontWeight: 700 }}>
          에이전트 루프
        </span>
        <span className="max-w-[9.5rem] text-ui-xs text-text-secondary">
          한 턴이 훅 46개를 차례로 지나요
        </span>
        <span className="mt-1 inline-flex items-center gap-1 text-micro text-text-tertiary [&_svg]:size-2.5">
          <Diamond /> 단계 경계에서 바뀐 게 적용돼요
        </span>
      </div>

      <Tile
        x={40}
        y={0}
        w={300}
        h={132}
        hue="l3"
        icon={<Layers />}
        layer="L3"
        title="플러그인 그룹"
        count={4}
        desc="루프에 꽂혀 대화의 방향을 정하는 부품 묶음"
        onOpen={open}
        dim={dimOthers}
      >
        <MiniChip hue="l3">Helm</MiniChip>
        <MiniChip hue="l3">계획 먼저</MiniChip>
        <MiniChip hue="l3">학습</MiniChip>
        <MiniChip hue="l3" dot="danger">
          리뷰 꺼짐
        </MiniChip>
      </Tile>
      <Tile
        x={560}
        y={0}
        w={300}
        h={132}
        hue="pl"
        icon={<Plug />}
        layer="plugin"
        title="외부 plugin"
        count={2}
        desc="따로 설치한 확장 · 그룹처럼 소켓에 훅을 걸어요"
        onOpen={open}
        dim={dimOthers}
      >
        <MiniChip hue="pl" dot="warning">
          acme 노트 · 실패 2
        </MiniChip>
        <MiniChip hue="pl" dot="off">
          OAuth 모델 · 꺼짐
        </MiniChip>
      </Tile>
      <Tile
        x={16}
        y={282}
        w={250}
        h={146}
        hue="l2"
        icon={<Package />}
        layer="L2"
        title="서비스"
        count={5}
        desc="그룹이 불러 쓰는 기능을 내줘요"
        onOpen={open}
        dim={dimOthers}
      >
        <MiniChip hue="l2">web.search</MiniChip>
        <MiniChip hue="l2">knowledge</MiniChip>
        <MiniChip hue="l2">work.tasks</MiniChip>
      </Tile>
      <Tile
        x={634}
        y={282}
        w={250}
        h={146}
        hue="base"
        icon={<LayoutGrid />}
        layer="맥락"
        title="맥락"
        count={5}
        desc="어느 블록을 켤지는 대화·프로필·테스트마다 달라요"
        onOpen={open}
        dim={dimOthers}
      >
        <span className="inline-flex h-6 items-center gap-1 rounded-md border-[1.5px] border-[var(--hull-thread)] px-2 text-ui-xs text-text-secondary">
          대화 2
        </span>
        <span className="inline-flex h-6 items-center gap-1 rounded-md border-[1.5px] border-[var(--hull-profile)] px-2 text-ui-xs text-text-secondary">
          프로필 2
        </span>
        <span className="inline-flex h-6 items-center gap-1 rounded-md border-[1.5px] border-dashed border-[var(--hull-trial)] px-2 text-ui-xs text-text-secondary">
          테스트 1
        </span>
      </Tile>
      <Tile
        x={290}
        y={492}
        w={320}
        h={92}
        hue="base"
        icon={<LayoutGrid />}
        layer="L1 · L0"
        title="기반"
        count={9}
        desc="루프가 올라선 바닥 · 코어 5 · 플랫폼 4"
        onOpen={open}
        dim={dimOthers}
      />
      <div
        className={`absolute flex h-7 items-center gap-2 rounded-xl px-4 text-ui-xs text-text-tertiary ${dimOthers ? "opacity-35" : ""}`}
        style={{ left: 20, top: 604, width: 860, background: "var(--plate-base)" }}
      >
        <span className="font-mono text-mono-micro">F</span>
        <span className="text-text-secondary">계약</span>
        모든 층이 지키는 약속 · 매니페스트 · 훅 표 · 연산 4
      </div>
    </div>
  );
}
