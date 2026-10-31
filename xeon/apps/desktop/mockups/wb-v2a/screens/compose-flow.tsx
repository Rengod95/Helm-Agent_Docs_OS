// 구성기 "흐름": Helm 단계 머신(L3.helm §4.2)을 위 줄(오른쪽으로) · 아래 줄(왼쪽으로) 뱀 모양 흐름으로. 노드 = 커밋된 단계,
// 선 위 ◇ = 단계 경계(drive가 단계 하나를 커밋하고 돌아가면 X가 마지막 상태로 다시 부름). explore는 렌즈 자식으로 부채꼴로 펼친다.
// 쓰기 거부 구간은 회색 테두리 하나. 사람 확인(gate)은 drive 원시(사용자 결정 8)라 넣을 수 있는 자리로 보인다.
// 시험(trial): 지난 단계 체크, 지금 단계 숨쉬는 고리, 렌즈 상태, 선 위 움직이는 점, 아래 경계 기록 띠.
import type { ReactNode } from "react";
import {
  Check,
  CircleX,
  Diamond,
  GitBranch as Split,
  Hand,
  LoaderCircle,
  Play,
  RotateCw,
  Sparkles,
  Target,
} from "../../_shell";
import { LENSES, TRIAL_LOG } from "../data";
import { Hull, HueTile, Mark, orthH, orthV } from "../parts/kit";

export const FW = { w: 1040, h: 560 };

type Phase = "done" | "now" | "next" | "idle";
interface NodeDef {
  id: string;
  name: string;
  ko: string;
  icon: ReactNode;
  x: number;
  y: number;
  w: number;
  h: number;
  cost?: string;
  extra?: ReactNode;
}
const N: Record<string, NodeDef> = {
  diverge: {
    id: "diverge",
    name: "diverge",
    ko: "관점 펼치기",
    icon: <Split />,
    x: 132,
    y: 104,
    w: 168,
    h: 88,
    cost: "턴 1",
  },
  explore: {
    id: "explore",
    name: "explore",
    ko: "렌즈 보내기",
    icon: <Sparkles />,
    x: 344,
    y: 104,
    w: 184,
    h: 88,
    cost: "spawn 3",
  },
  converge: {
    id: "converge",
    name: "converge",
    ko: "모아 판단",
    icon: <Target />,
    x: 772,
    y: 360,
    w: 212,
    h: 96,
    cost: "턴 0",
  },
  apply: {
    id: "apply",
    name: "apply",
    ko: "결과 남기기",
    icon: <Check />,
    x: 340,
    y: 360,
    w: 168,
    h: 88,
    cost: "턴 1",
  },
};
const LENS_Y = [52, 122, 192];

function PhaseNode({ n, phase }: { n: NodeDef; phase: Phase }) {
  return (
    <div
      className={`absolute flex flex-col rounded-xl bg-surface-raised p-2.5 shadow-2 transition-opacity ${phase === "next" ? "opacity-55" : ""} ${phase === "now" ? "wbv2-breathe" : ""}`}
      style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
    >
      <div className="flex items-start gap-2">
        <HueTile hue="l3">{n.icon}</HueTile>
        <span className="grid min-w-0 flex-1 leading-tight">
          <span
            className={`text-ui-strong ${phase === "done" ? "text-text-secondary" : "text-text-primary"}`}
          >
            {n.ko}
          </span>
          <span className="font-mono text-mono-micro text-text-tertiary">{n.name}</span>
        </span>
        {phase === "done" && (
          <Mark tone="success" icon={<Check />}>
            끝
          </Mark>
        )}
        {phase === "now" && (
          <Mark tone="accent" icon={<Play />}>
            지금
          </Mark>
        )}
      </div>
      <div className="mt-auto flex items-center gap-1.5">
        {n.cost !== undefined && (
          <span className="flex-none whitespace-nowrap rounded-md bg-neutral-well px-1.5 py-0.5 text-micro text-text-secondary tabular-nums">
            임대 {n.cost}
          </span>
        )}
        {n.extra}
      </div>
    </div>
  );
}

function Boundary({
  x,
  y,
  label,
  active,
  above,
}: {
  x: number;
  y: number;
  label: string;
  active?: boolean;
  above?: boolean;
}) {
  return (
    <span
      className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
      style={{ left: x, top: y }}
    >
      <span
        className={`grid size-4 place-items-center rounded-[3px] rotate-45 shadow-1 ${active ? "bg-accent-solid" : "bg-surface-raised"}`}
        style={{ boxShadow: active ? undefined : "0 0 0 1.5px var(--cs-color-text-tertiary)" }}
      />
      <span
        className={`absolute rounded-full bg-bg-app/80 px-1 text-micro whitespace-nowrap text-text-tertiary ${above ? "bottom-4" : "top-4"}`}
      >
        {label}
      </span>
    </span>
  );
}

export function ComposeFlow({ trial }: { trial: boolean }) {
  const ph = (id: string): Phase => {
    if (!trial) return "idle";
    if (id === "diverge") return "done";
    if (id === "explore") return "now";
    return "next";
  };
  const C = (n: NodeDef) => ({
    l: [n.x, n.y + n.h / 2] as [number, number],
    r: [n.x + n.w, n.y + n.h / 2] as [number, number],
  });
  const main = "var(--cs-color-text-secondary)";
  const wires: { d: string; color?: string; dashed?: boolean; run?: boolean; w?: number }[] = [
    { d: `M92 148 L${N.diverge!.x} 148` },
    {
      d: `M${C(N.diverge!).r[0]} 148 L${N.explore!.x} 148`,
      color: trial ? "var(--cs-color-accent-solid)" : undefined,
    },
    ...LENS_Y.map((y, i) => ({
      d: orthH(C(N.explore!).r, [572, y + 26], 542),
      color: trial
        ? LENSES[i]!.status === "failed"
          ? "var(--cs-color-danger-solid)"
          : "var(--cs-color-accent-solid)"
        : undefined,
      run: trial && LENSES[i]!.status === "running",
      dashed: trial && LENSES[i]!.status === "failed",
    })),
    ...LENS_Y.map((y) => ({ d: orthH([742, y + 26], [800, 148], 772) })),
    { d: orthV([846, 174], [880, N.converge!.y], 300) },
    { d: `M${N.converge!.x} 408 L728 408` },
    { d: `M564 408 L${N.apply!.x + N.apply!.w} 404` },
    { d: `M${N.apply!.x} 404 L256 404` },
    { d: orthV([186, 380], [56, 166], 300), dashed: true },
  ];
  return (
    <div className="wbv2 relative" style={{ width: FW.w, height: FW.h }}>
      <Hull
        id="guard"
        rects={[{ x: 116, y: 28, w: 640, h: 236 }]}
        color="var(--cs-color-text-secondary)"
        radius={20}
        w={FW.w}
        h={FW.h}
      />
      <span
        className="absolute flex items-center gap-1.5 rounded-full bg-surface-raised px-2.5 py-1 text-ui-xs text-text-secondary shadow-1 [&_svg]:size-3"
        style={{ left: 136, top: 16 }}
      >
        <span className="text-text-primary">쓰기 거부 구간</span>
        tool.call.before · 첫 답이 정함 · main · subagent:explorer
        {trial && (
          <Mark tone="warning" className="ms-1">
            거부 1 · bash
          </Mark>
        )}
      </span>

      <svg aria-hidden className="pointer-events-none absolute inset-0" width={FW.w} height={FW.h}>
        {wires.map((w, i) => (
          <g key={i}>
            <path
              id={`fw-${i}`}
              d={w.d}
              fill="none"
              stroke={w.color ?? main}
              strokeWidth={w.w ?? 1.75}
              strokeDasharray={w.dashed ? "5 5" : undefined}
              strokeLinecap="round"
              opacity={w.color ? 1 : 0.7}
            />
          </g>
        ))}
        <path d="M58 166 l-4 6 h8z" fill={main} opacity={0.7} />
      </svg>
      {wires.map((w, i) =>
        w.run ? (
          <span
            key={`run${i}`}
            className="wbv2-run absolute top-0 left-0 size-2 rounded-full bg-accent-solid"
            style={{ offsetPath: `path("${w.d}")` }}
          />
        ) : null,
      )}

      {/* idle */}
      <span
        className="absolute grid h-9 place-items-center rounded-full bg-neutral-well px-3 text-ui-sm text-text-secondary"
        style={{ left: 20, top: 130, width: 72 }}
      >
        idle
      </span>
      <Boundary x={112} y={148} label="임대 받음" active={trial} above />
      <PhaseNode n={N.diverge!} phase={ph("diverge")} />
      <Boundary x={322} y={148} label="diverged" active={trial} above />
      <PhaseNode n={N.explore!} phase={ph("explore")} />

      {/* 렌즈 자식 */}
      {LENSES.map((l, i) => {
        const st = trial ? l.status : "idle";
        return (
          <div
            key={l.id}
            className={`absolute flex items-center gap-2 rounded-xl px-2.5 shadow-2 ${st === "failed" ? "bg-danger-soft" : "bg-surface-raised"}`}
            style={{ left: 572, top: LENS_Y[i], width: 170, height: 52 }}
          >
            <span className="grid size-6 place-items-center rounded-md bg-agent-soft text-agent-text [&_svg]:size-3.5">
              {st === "running" ? (
                <LoaderCircle className="wbv2-spin" />
              ) : st === "done" ? (
                <Check />
              ) : st === "failed" ? (
                <CircleX />
              ) : (
                <Sparkles />
              )}
            </span>
            <span className="grid min-w-0 leading-tight">
              <span className="truncate text-ui-sm text-text-primary">{l.title}</span>
              <span className="truncate font-mono text-mono-micro text-text-tertiary">
                {trial ? l.tool : `explorer · ${l.id}`}
              </span>
            </span>
          </div>
        );
      })}
      <span className="absolute text-micro text-text-tertiary" style={{ left: 576, top: 246 }}>
        자식 에이전트 · loop.spawn × 3
      </span>

      {/* 모으기 */}
      <div
        className={`absolute grid place-items-center rounded-xl bg-surface-raised text-center shadow-2 ${trial ? "opacity-55" : ""}`}
        style={{ left: 800, top: 122, width: 92, height: 52 }}
      >
        <span className="text-ui-sm text-text-primary">모으기</span>
        <span className="text-micro text-text-tertiary">부분 결과 허용</span>
      </div>
      <Boundary x={880} y={300} label="explored · 1개 이상 끝" />
      <PhaseNode
        n={{
          ...N.converge!,
          extra: (
            <span className="truncate text-micro text-text-tertiary">
              읽기 web.search · knowledge×3
            </span>
          ),
        }}
        phase={ph("converge")}
      />
      <Boundary x={758} y={408} label="converged · 발견 ≥ 1" above />

      {/* 사람 확인 자리 */}
      <div
        className={`absolute flex flex-col gap-1 rounded-xl border border-dashed border-border-strong p-2.5 ${trial ? "opacity-55" : ""}`}
        style={{ left: 564, top: 364, width: 164, height: 88 }}
      >
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-lg bg-neutral-well text-text-secondary [&_svg]:size-4">
            <Hand />
          </span>
          <span className="grid leading-tight">
            <span className="text-ui-sm text-text-primary">사람 확인</span>
            <span className="text-micro text-text-tertiary">넣을 수 있는 자리</span>
          </span>
        </span>
        <span className="text-micro leading-snug text-text-tertiary">
          기다리는 동안 임대를 놓고, 답하면 다시 받아요
        </span>
      </div>
      <PhaseNode n={N.apply!} phase={ph("apply")} />
      <Boundary x={290} y={404} label="applied" above />

      {/* 끝 */}
      <div
        className={`absolute grid gap-1 rounded-xl bg-neutral-well p-2.5 ${trial ? "opacity-55" : ""}`}
        style={{ left: 116, top: 380, width: 140 }}
      >
        <span className="flex items-center gap-1.5 text-ui-sm text-text-primary [&_svg]:size-3.5">
          <RotateCw /> 끝 → idle
        </span>
        <span className="text-micro leading-snug text-text-tertiary">
          applied · stopped · limit · failed · empty
        </span>
      </div>
      <span className="absolute text-micro text-text-tertiary" style={{ left: 24, top: 270 }}>
        임대 반납
      </span>

      {/* 경계 기록(시험) */}
      {trial && (
        <div className="absolute flex items-start" style={{ left: 20, top: 488, width: 1000 }}>
          <span className="absolute top-[7px] right-4 left-2 h-px bg-border-default" />
          {TRIAL_LOG.map((e, i) => (
            <div key={i} className="relative grid flex-1 justify-items-start gap-0.5 pe-2">
              <span
                className={`size-3.5 rotate-45 rounded-[3px] ${e.done ? (e.guard ? "bg-warning-solid" : "bg-text-tertiary") : "wbv2-breathe bg-accent-solid"}`}
              />
              <span className="mt-1 text-ui-xs text-text-primary">{e.label}</span>
              <span className="text-micro text-text-tertiary tabular-nums">
                {e.at} · {e.note}
              </span>
            </div>
          ))}
        </div>
      )}
      {!trial && (
        <span
          className="absolute flex items-center gap-1.5 text-ui-xs text-text-tertiary [&_svg]:size-3"
          style={{ left: 24, top: 500 }}
        >
          <Diamond /> 단계 경계 · drive는 단계 하나를 커밋하고 돌아가요. 다음 경계에 마지막 상태로
          다시 불려요.
        </span>
      )}
    </div>
  );
}
