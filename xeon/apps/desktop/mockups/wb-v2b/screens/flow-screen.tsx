// drive 부품의 단계 머신(Helm §3.3)을 상태 그래프로. 위 줄은 오른쪽으로(확산 → 탐색 → 렌즈 펼침 → 모으기),
// 아래 줄은 왼쪽으로 돌아온다(수렴 → 적용 → 끝 → idle). 고리 모양이 "단계마다 커밋하고 다시 불린다"를 보인다.
// 쓰기 거부 구간, 단계별 임대 예산, ◇ 단계 경계 전이. 시험 실행(S11)은 같은 그래프 위에서 움직이고,
// 구성(S14)은 사람 확인(gate, 결정 8)을 잇는 중이다. 시험 "멈춤"은 다음 단계 경계에서 실제로 멈춘다(결정 9).
import { Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import type { ReactNode } from "react";
import {
  Compass,
  GitBranch,
  LayoutGrid,
  MousePointer2,
  Pause,
  Play,
  Search,
  Sparkles,
  User,
  CircleCheck,
  CircleX,
  ArrowRight,
  RotateCw,
  ChevronRight,
  useShell,
} from "../../_shell";
import { hPath, PortGlyph, Wire, type WireLook } from "../parts/kit";
import { Budget, Node, nodeH, type NodeSpec } from "../parts/node";
import { Viewport } from "../parts/viewport";
import { useMock } from "../store";

type St = "idle" | "active" | "done" | "failed" | "invalid" | "target";

interface Phase {
  n: NodeSpec;
  dir: "r" | "l";
}

function phases(gate: boolean): Phase[] {
  const lens = (id: string, title: string, y: number, body: ReactNode): Phase => ({
    dir: "r",
    n: {
      id,
      x: 548,
      y,
      w: 176,
      title,
      icon: <Search />,
      faceTone: "agent",
      rows: [],
      body,
      bodyH: 26,
    },
  });
  return [
    {
      dir: "r",
      n: {
        id: "diverge",
        x: 92,
        y: 96,
        w: 160,
        title: "확산",
        icon: <Sparkles />,
        rows: [],
        badge: <Budget>턴 1</Budget>,
        body: <span>렌즈 고르기 · 신호 순서 3/6</span>,
        bodyH: 30,
      },
    },
    {
      dir: "r",
      n: {
        id: "explore",
        x: 318,
        y: 96,
        w: 166,
        title: "탐색",
        icon: <GitBranch />,
        rows: [],
        badge: <Budget>spawn 3</Budget>,
        body: <span>loop.spawn(explorer) ×3</span>,
        bodyH: 30,
      },
    },
    lens(
      "l1",
      "실패 사례",
      0,
      <span className="truncate font-mono text-[10px]">failure-cases</span>,
    ),
    lens(
      "l2",
      "기본 원리",
      98,
      <span className="truncate font-mono text-[10px]">first-principles</span>,
    ),
    lens(
      "l3",
      "다른 분야 유사",
      196,
      <span className="truncate font-mono text-[10px]">other-domain</span>,
    ),
    {
      dir: "r",
      n: {
        id: "join",
        x: 772,
        y: 102,
        w: 128,
        title: "모으기",
        icon: <CircleCheck />,
        rows: [],
        body: <span>모두 끝나면 · 부분 허용</span>,
        bodyH: 30,
      },
    },
    {
      dir: "l",
      n: {
        id: "converge",
        x: 740,
        y: 336,
        w: 160,
        title: "수렴",
        icon: <Search />,
        rows: [],
        badge: <Budget>턴 0</Budget>,
        body: <span>능력 읽기만 · 발견 정리</span>,
        bodyH: 30,
      },
    },
    ...(gate
      ? [
          {
            dir: "l" as const,
            n: {
              id: "gate",
              x: 500,
              y: 336,
              w: 186,
              title: "사람 확인",
              icon: <User />,
              rows: [],
              badge: <Budget>임대 반납</Budget>,
              body: <span>승인 요청 · 답하면 다시 받음</span>,
              bodyH: 30,
            },
          },
        ]
      : []),
    {
      dir: "l",
      n: {
        id: "apply",
        x: gate ? 290 : 500,
        y: 336,
        w: 160,
        title: "적용",
        icon: <CircleCheck />,
        rows: [],
        badge: <Budget>턴 1</Budget>,
        body: <span>작업 만들기 · 기록</span>,
        bodyH: 30,
      },
    },
    {
      dir: "l",
      n: {
        id: "end",
        x: gate ? 76 : 256,
        y: 336,
        w: 168,
        title: "끝",
        icon: <CircleX />,
        rows: [],
        body: (
          <span className="font-mono text-[10px]">applied · stopped · limit · failed · empty</span>
        ),
        bodyH: 30,
      },
    },
  ];
}

const mid = (n: NodeSpec) => n.y + nodeH(n) / 2;
const right = (n: NodeSpec) => ({ x: n.x + n.w, y: mid(n) });
const left = (n: NodeSpec) => ({ x: n.x, y: mid(n) });
const IDLE = { x: 0, y: 228, d: 58 };

function lPath(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = Math.max(28, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x} ${a.y} C ${a.x - dx} ${a.y}, ${b.x + dx} ${b.y}, ${b.x} ${b.y}`;
}

export function FlowScreen() {
  const m = useMock();
  const shell = useShell();
  const trial = m.trial;
  const editing = m.composer && m.edit === "connect";
  const ps = phases(editing);
  const N = (id: string) => ps.find((p) => p.n.id === id)!.n;
  const has = (id: string) => ps.some((p) => p.n.id === id);

  const st = (id: string): St => {
    if (!trial) return editing && id === "gate" ? "target" : "idle";
    if (id === "diverge") return "done";
    if (id === "explore" || id === "l1") return "active";
    if (id === "l2") return "done";
    if (id === "l3") return "failed";
    return "idle";
  };
  const later = (id: string) => trial && ["join", "converge", "apply", "end"].includes(id);

  // ── 전이
  type T = {
    d: string;
    type: "drive" | "record";
    label?: ReactNode;
    at?: { x: number; y: number };
    look?: WireLook;
    id?: string;
  };
  const T: T[] = [];
  const diamond = (s: string) => (
    <span className="flex items-center gap-1">
      <span
        aria-hidden
        className="inline-block size-[7px] rotate-45 rounded-[1px] border border-text-tertiary"
      />
      {s}
    </span>
  );
  const idleR = { x: IDLE.x + IDLE.d, y: IDLE.y + IDLE.d / 2 };
  const push = (
    a: { x: number; y: number },
    b: { x: number; y: number },
    label: ReactNode,
    opts: Partial<T> = {},
    back = false,
  ) => {
    const d = back ? lPath(a, b) : hPath(a, b);
    T.push({ d, type: "drive", label, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...opts });
  };
  push(idleR, left(N("diverge")), diamond("임대 · pending"), {
    look: trial ? "dim" : "base",
    at: { x: 40, y: 196 },
  });
  push(right(N("diverge")), left(N("explore")), diamond("diverged"), {
    look: trial ? "dim" : "base",
    at: { x: 289, y: mid(N("diverge")) - 18 },
  });
  ["l1", "l2", "l3"].forEach((l) =>
    T.push({
      d: hPath(right(N("explore")), left(N(l))),
      type: "drive",
      look: trial ? (l === "l1" ? "live" : l === "l3" ? "fail" : "dim") : "base",
      id: `w-${l}`,
    }),
  );
  ["l1", "l2", "l3"].forEach((l) =>
    T.push({
      d: hPath(right(N(l)), left(N("join"))),
      type: "drive",
      look: trial ? (l === "l2" ? "base" : "dim") : "base",
    }),
  );
  push(
    { x: N("join").x + N("join").w / 2, y: N("join").y + nodeH(N("join")) },
    { x: N("converge").x + N("converge").w, y: mid(N("converge")) },
    diamond("done ≥ 1"),
    { look: later("join") ? "dim" : "base", at: { x: 872, y: 300 } },
  );
  if (has("gate")) {
    T.push({ d: lPath(left(N("converge")), right(N("apply"))), type: "drive", look: "dim" });
  } else
    push(
      left(N("converge")),
      right(N("apply")),
      diamond("발견 ≥ 1"),
      {
        look: later("converge") ? "dim" : "base",
        at: { x: (N("converge").x + N("apply").x + N("apply").w) / 2, y: mid(N("converge")) - 16 },
      },
      true,
    );
  push(
    left(N("apply")),
    right(N("end")),
    diamond("applied"),
    {
      look: later("apply") ? "dim" : "base",
      at: { x: (N("apply").x + N("end").x + N("end").w) / 2, y: mid(N("apply")) - 16 },
    },
    true,
  );
  T.push({
    d: `M${N("end").x} ${mid(N("end"))} C ${N("end").x - 50} ${mid(N("end"))}, ${IDLE.x + IDLE.d / 2} ${IDLE.y + IDLE.d + 50}, ${IDLE.x + IDLE.d / 2} ${IDLE.y + IDLE.d}`,
    type: "drive",
    look: trial ? "dim" : "base",
  });

  // 실패 출구: 노드 아래 짧은 점선 꼬리표
  const exits: [string, string][] = [
    ["diverge", "aborted"],
    ["explore", "spawn 0"],
    ["join", "모두 실패"],
    ["converge", "발견 0"],
  ];

  const W = 910;
  const H = 470;
  const wellOpen = shell.endOpen && shell.layout === "wide";
  const draftFrom = left(N("converge"));
  const gateIn = has("gate") ? right(N("gate")) : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Viewport
        label="Helm 단계 머신"
        world={{ w: W, h: H }}
        pad={[trial ? 124 : 104, 24 + (wellOpen ? 360 : 0), trial ? 92 : 24, 32]}
        minK={0.8}
        anchor="center"
        crumbs={
          editing
            ? [
                {
                  label: "구성",
                  icon: <LayoutGrid className="size-3.5 text-text-tertiary" emphasis="muted" />,
                  onClick: () => m.notify("구성 목록으로 가요"),
                },
                { label: "lens-review", onClick: () => m.set({ screen: "group" }) },
                { label: "단계 머신" },
              ]
            : [
                {
                  label: trial ? "시험 실행" : "런타임 지도",
                  icon: <Compass className="size-3.5 text-text-tertiary" emphasis="muted" />,
                  onClick: () => m.set({ screen: "map", trial: false }),
                },
                {
                  label: "Helm",
                  onClick: () => m.set({ screen: "group", selected: "helm", trial: false }),
                },
                { label: "단계 머신" },
              ]
        }
        crumbMeta={
          trial ? "시험 대화 · helm 시험 1" : editing ? "편집 중" : "drive 부품 · 단계 4 · 렌즈 3"
        }
        topRight={
          <SegmentedControl
            aria-label="보기"
            size="sm"
            value="flow"
            onValueChange={(v) => v === "parts" && m.set({ screen: "group", trial: false })}
            className="glass glass-shadow-2"
          >
            <SegmentedControlItem value="parts">부품</SegmentedControlItem>
            <SegmentedControlItem value="flow">흐름</SegmentedControlItem>
          </SegmentedControl>
        }
        overlay={
          <>
            {/* 임대 상한 줄 */}
            {!trial && (
              <div className="absolute top-14 left-3 z-10 flex h-7 items-center gap-3 rounded-lg px-2.5 text-ui-xs text-text-secondary glass glass-shadow-2">
                <span className="flex items-center gap-1.5">
                  <PortGlyph type="drive" size={8} />
                  임대 상한
                </span>
                <span className="font-mono text-text-primary tabular-nums">
                  턴 4 · spawn 8 · 토큰 400k
                </span>
                <span className="flex items-center gap-1 text-text-tertiary">
                  <span
                    aria-hidden
                    className="inline-block size-[7px] rotate-45 rounded-[1px] border border-text-tertiary"
                  />
                  단계 경계에서 커밋하고 다시 불려요
                </span>
              </div>
            )}
            {trial && <RunStrip />}
            {trial && <EventTail />}
          </>
        }
      >
        {/* 쓰기 거부 구간 */}
        <div
          className="v2b-hatch absolute rounded-2xl"
          style={{
            left: 80,
            top: -14,
            width: 830,
            height: 300,
            boxShadow:
              "inset 0 0 0 1px color-mix(in oklab, var(--cs-color-danger-solid) 30%, transparent)",
          }}
        >
          <span className="absolute -top-3 left-3 flex h-6 items-center gap-1.5 rounded-md bg-surface-base px-2 text-[11px] text-text-secondary shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--cs-color-danger-solid)_35%,transparent)]">
            <span className="text-danger-text">쓰기 거부</span>
            tool.call.before · first · main, subagent:explorer
            {trial && (
              <span className="ms-1 rounded-full bg-danger-soft px-1.5 text-danger-text">
                거부 1 · bash
              </span>
            )}
          </span>
        </div>

        <svg
          className="pointer-events-none absolute top-0 left-0 overflow-visible"
          width={W}
          height={H}
          aria-hidden
        >
          <defs>
            <marker
              id="v2b-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L8 4 L0 8 Z" fill="var(--port-drive)" />
            </marker>
          </defs>
          {T.map((t, i) => (
            <g key={i}>
              <Wire d={t.d} type={t.type} look={t.look ?? "base"} width={1.5} id={t.id} />
            </g>
          ))}
          {T.filter((t) => t.look !== "dim").map((t, i) => (
            <path key={`a${i}`} d={t.d} fill="none" stroke="none" markerEnd="url(#v2b-arrow)" />
          ))}
          {trial && (
            <circle
              r={4.5}
              fill="var(--port-on)"
              stroke="var(--cs-color-surface-base)"
              strokeWidth={2}
            >
              <animateMotion
                dur="2.2s"
                repeatCount="indefinite"
                path={hPath(right(N("explore")), left(N("l1")))}
              />
            </circle>
          )}
          {editing && gateIn !== null && (
            <path
              d={lPath(draftFrom, { x: gateIn.x + 6, y: gateIn.y })}
              fill="none"
              stroke="var(--port-drive)"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinecap="round"
            />
          )}
        </svg>

        {/* idle */}
        <div
          className="absolute grid place-items-center rounded-full text-[11.5px] font-semibold text-text-secondary"
          style={{
            left: IDLE.x,
            top: IDLE.y,
            width: IDLE.d,
            height: IDLE.d,
            ...{
              background: "var(--cs-color-surface-base)",
              boxShadow: "inset 0 0 0 1.5px var(--cs-color-border-strong), var(--block-shadow)",
            },
          }}
        >
          idle
        </div>

        {T.filter((t) => t.label !== undefined).map((t, i) => (
          <span
            key={`l${i}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-md bg-surface-base px-1.5 py-0.5 text-[10.5px] whitespace-nowrap text-text-secondary shadow-[inset_0_0_0_1px_var(--block-edge)]"
            style={{ left: t.at!.x, top: t.at!.y, opacity: t.look === "dim" ? 0.5 : 1 }}
          >
            {t.label}
          </span>
        ))}

        {ps.map((p) => {
          const s = st(p.n.id);
          const isLens = p.n.id.startsWith("l");
          const n: NodeSpec =
            trial && isLens
              ? {
                  ...p.n,
                  health: s === "failed" ? "danger" : "ok",
                  body:
                    p.n.id === "l1" ? (
                      <span className="flex min-w-0 items-center gap-1 truncate">
                        <RotateCw
                          className="size-3 flex-none animate-spin text-text-tertiary"
                          emphasis="muted"
                        />
                        web_search · ttl cache boundary
                      </span>
                    ) : p.n.id === "l2" ? (
                      <span>발견 2 · read src/cache.ts</span>
                    ) : (
                      <span className="text-danger-text">실패 · 모델 오류</span>
                    ),
                }
              : trial && p.n.id === "join"
                ? { ...p.n, body: <span>2/3 끝남 · 1 도는 중</span> }
                : p.n;
          return (
            <div key={p.n.id} className="contents">
              <Node n={n} state={s} dim={later(p.n.id)} selected={false} />
              {/* 입출력 점: 위 줄은 왼쪽 입력·오른쪽 출력, 아래 줄은 반대(돌아오는 길) */}
              {[p.dir === "r" ? left(p.n) : right(p.n), p.dir === "r" ? right(p.n) : left(p.n)].map(
                (a, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={`absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-surface-base ${editing && p.n.id === "gate" && i === 0 ? "v2b-pulse" : ""}`}
                    style={{
                      left: a.x,
                      top: a.y,
                      ["--ring" as string]: "var(--port-drive)",
                      boxShadow:
                        editing && p.n.id === "gate" && i === 0
                          ? "0 0 0 1.5px var(--port-drive), 0 0 0 5px color-mix(in oklab, var(--port-drive) 15%, transparent)"
                          : "inset 0 0 0 1.5px var(--port-drive)",
                    }}
                  />
                ),
              )}
            </div>
          );
        })}

        {exits.map(([id, label]) => {
          const n = N(id);
          return (
            <span
              key={id}
              className="absolute flex items-center gap-1 text-[10px] text-text-tertiary"
              style={{ left: n.x + 10, top: n.y + nodeH(n) + 4, opacity: later(id) ? 0.5 : 1 }}
            >
              <span className="h-px w-3 border-t border-dashed border-text-tertiary" />
              {label} → 끝
            </span>
          );
        })}

        {editing && gateIn !== null && (
          <>
            <MousePointer2
              className="absolute size-4 text-text-primary"
              emphasis="selected"
              style={{ left: gateIn.x + 2, top: gateIn.y + 2 }}
            />
            <div
              className="absolute flex w-[230px] flex-col gap-1 rounded-xl bg-surface-raised p-3 shadow-3"
              style={{ left: N("gate").x - 20, top: N("gate").y + nodeH(N("gate")) + 24 }}
            >
              <span className="text-ui-sm text-text-primary">수렴 → 사람 확인</span>
              <span className="text-[11.5px] text-text-secondary">
                기다리는 동안 drive 임대를 내려놓고, 답이 오면 다음 단계 경계에서 다시 받아요.
              </span>
              <span className="font-mono text-[10px] text-text-tertiary">
                loop.ask · ADR-0018 승인 요청
              </span>
            </div>
          </>
        )}
      </Viewport>
    </div>
  );
}

function RunStrip() {
  const m = useMock();
  return (
    <div className="absolute top-14 left-3 z-10 flex h-9 items-center gap-3 rounded-lg ps-3 pe-1.5 glass glass-shadow-2">
      <span className="flex items-center gap-1.5 text-ui-sm text-text-primary">
        <span
          className="size-1.5 rounded-full bg-success-solid v2b-pulse"
          style={{ ["--ring" as string]: "var(--cs-color-success-solid)" }}
        />
        탐색 · 턴 2
      </span>
      <span className="font-mono text-ui-xs text-text-tertiary tabular-nums">1:12</span>
      {[
        ["턴", 2, 4],
        ["spawn", 3, 8],
        ["토큰", 120, 400],
      ].map(([l, v, mx]) => (
        <span
          key={l as string}
          className="flex items-center gap-1.5 text-[10.5px] text-text-tertiary tabular-nums"
        >
          {l}
          <span className="relative h-1 w-10 overflow-hidden rounded-full bg-neutral-track">
            <span
              className="absolute inset-y-0 left-0 rounded-full bg-text-primary"
              style={{ width: `${((v as number) / (mx as number)) * 100}%` }}
            />
          </span>
          <span className="font-mono">
            {v as number}
            {l === "토큰" ? "k" : ""}/{mx as number}
            {l === "토큰" ? "k" : ""}
          </span>
        </span>
      ))}
      <Button
        size="xs"
        tone="neutral"
        variant="solid"
        iconStart={<Pause />}
        onClick={() => m.notify("다음 단계 경계에서 멈춰요 · 임대는 쥔 채")}
      >
        경계에서 멈춤
      </Button>
      <Button
        size="xs"
        tone="neutral"
        variant="soft"
        iconStart={<ChevronRight />}
        onClick={() => m.notify("다음 단계 경계까지 가고 멈춰요")}
      >
        한 경계씩
      </Button>
    </div>
  );
}

function EventTail() {
  const rows: [string, string, string][] = [
    ["212", "lease.granted", "helm · 차수 3"],
    ["219", "grp.helm.state.committed", "diverge → explore"],
    ["224", "agent.spawned", "explorer ×3"],
    ["231", "tool.call 거부", "bash · exec · explorer"],
    ["236", "agent.failed", "other-domain · 모델 오류"],
  ];
  return (
    <div className="absolute bottom-3 left-3 z-10 flex w-[340px] flex-col gap-0.5 rounded-lg p-2.5 glass glass-shadow-2">
      <span className="flex items-center gap-1.5 pb-1 text-ui-xs text-text-tertiary">
        <ArrowRight className="size-3" emphasis="muted" />
        경계 기록
      </span>
      {rows.map(([seq, k, d]) => (
        <span key={seq} className="flex h-5 items-center gap-2 text-[11px]">
          <span className="w-7 font-mono text-text-tertiary tabular-nums">{seq}</span>
          <span className="min-w-0 truncate font-mono text-[10.5px] text-text-primary">{k}</span>
          <span className="ms-auto truncate text-text-tertiary">{d}</span>
        </span>
      ))}
    </div>
  );
}
