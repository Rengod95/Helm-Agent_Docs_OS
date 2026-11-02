// 그룹 하위 캔버스: 그룹 블록을 열면 그 부품(composition, 결정 7)이 자기 캔버스에 펼쳐진다.
// 왼쪽 "그룹 입력"(기능) → 부품(signal·lens·guard·restore | drive·knowledge·record) → 오른쪽 "그룹 출력"(훅·post·drive·기록).
// 런타임에서 열면 읽기 전용, 구성(결정 2·6)에서 열면 편집: 놓기 미리보기(S5), 잘못된 연결(S6).
import { Button, SegmentedControl, SegmentedControlItem } from "@caustic/react";
import type { ReactNode } from "react";
import {
  Compass,
  GitBranch,
  LayoutGrid,
  MousePointer2,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  FileText,
  RotateCcw,
  Layers,
  CircleX,
  ArrowUpRight,
  useShell,
} from "../../_shell";
import { hPath, PortGlyph, Reroute, Wire, type WireLook } from "../parts/kit";
import { Node, nodeH, rowAnchor, Budget, type NodeSpec } from "../parts/node";
import { Viewport, type MiniRect } from "../parts/viewport";
import { useMock } from "../store";
import { Library } from "./library";

let OX = 90;

export function groupNodes(composer: boolean, edit: string | null): NodeSpec[] {
  OX = edit === "drop" ? 190 : 90;
  const ksState = edit === "drop" ? ("target" as const) : ("off" as const);
  return [
    {
      id: "in",
      x: OX + 0,
      y: 40,
      w: 156,
      title: "그룹 입력",
      tag: "기능",
      icon: <Layers />,
      rows: [
        {
          id: "ws",
          side: "out",
          type: "cap",
          label: "web.search",
          hollow: true,
          state: edit === "invalid" ? "lit" : undefined,
        },
        { id: "wf", side: "out", type: "cap", label: "web.fetch", hollow: true },
        {
          id: "ks",
          side: "out",
          type: "cap",
          label: "knowledge.search",
          hollow: true,
          state: ksState,
        },
        { id: "sk", side: "out", type: "cap", label: "knowledge.skills", hollow: true },
        { id: "mem", side: "out", type: "cap", label: "knowledge.memory", hollow: true },
        { id: "wt", side: "out", type: "cap", label: "work.tasks", hollow: true },
      ],
      body: <span>모두 optional</span>,
    },
    {
      id: "signal",
      x: OX + 216,
      y: 20,
      w: 186,
      title: "신호 감지",
      tag: "signal",
      icon: <Sparkles />,
      rows: [
        { id: "tea", side: "out", type: "on", label: "tool.execution.after", fold: "tap" },
        { id: "bsa", side: "out", type: "on", label: "boundary.settle.after", fold: "tap" },
        { id: "post", side: "out", type: "post", label: "제안" },
        { id: "rec", side: "out", type: "record", label: "signal.detected" },
        { id: "pend", side: "out", type: "record", label: "pending" },
      ],
      body: <span>stuck 3 · repeat 3 · newDomain 2</span>,
    },
    {
      id: "lens",
      x: OX + 216,
      y: 206,
      w: 186,
      title: "렌즈 주입",
      tag: "lens",
      icon: <Search />,
      rows: [{ id: "iab", side: "out", type: "on", label: "input.agent.before", fold: "collect" }],
      body: <span>6개 중 신호 순서로 3 · maxLenses</span>,
    },
    {
      id: "guard",
      x: OX + 216,
      y: 296,
      w: 186,
      title: "쓰기 거부",
      tag: "guard",
      icon: <ShieldCheck />,
      rows: [
        { id: "phase", side: "in", type: "record", label: "단계" },
        { id: "tcb", side: "out", type: "on", label: "tool.call.before", fold: "first" },
      ],
      body: <span>diverge·explore · main, explorer</span>,
    },
    {
      id: "restore",
      x: OX + 216,
      y: 406,
      w: 186,
      title: "상태 복원",
      tag: "restore",
      icon: <RotateCcw />,
      rows: [{ id: "ss", side: "out", type: "on", label: "thread.start", fold: "tap" }],
    },
    {
      id: "drive",
      x: OX + 452,
      y: 20,
      w: 192,
      title: "단계 머신",
      tag: "drive",
      icon: <GitBranch />,
      rows: [
        { id: "pend", side: "in", type: "record", label: "pending" },
        { id: "drv", side: "out", type: "drive", label: "drive" },
        { id: "llr", side: "out", type: "on", label: "lease.rejected", fold: "tap" },
        { id: "phase", side: "out", type: "record", label: "단계" },
        { id: "conv", side: "out", type: "record", label: "수렴" },
      ],
      body: <Budget>턴 4 · spawn 8 · 토큰 400k</Budget>,
      bodyH: 28,
    },
    {
      id: "knowledge",
      x: OX + 452,
      y: 190,
      w: 192,
      title: "지식 소비",
      tag: "knowledge",
      icon: <FileText />,
      health: edit === "drop" ? "ok" : "warn",
      rows: [
        { id: "conv", side: "in", type: "record", label: "수렴" },
        {
          id: "ws",
          side: "in",
          type: "cap",
          label: "web.search",
          hollow: true,
          state: edit === "invalid" ? "target" : undefined,
        },
        { id: "wf", side: "in", type: "cap", label: "web.fetch", hollow: true },
        {
          id: "ks",
          side: "in",
          type: "cap",
          label: "knowledge.search",
          hollow: true,
          state: edit === "drop" ? "target" : "off",
          meta: edit === "drop" ? undefined : "없음",
        },
        { id: "sk", side: "in", type: "cap", label: "knowledge.skills", hollow: true },
        { id: "mem", side: "in", type: "cap", label: "knowledge.memory", hollow: true },
        { id: "found", side: "out", type: "record", label: "발견" },
      ],
      body: <span>converge에서 읽기만 · 출처별 저하</span>,
    },
    {
      id: "record",
      x: OX + 452,
      y: 396,
      w: 192,
      title: "발견 기록",
      tag: "record",
      icon: <FileText />,
      rows: [
        { id: "found", side: "in", type: "record", label: "발견" },
        { id: "wt", side: "in", type: "cap", label: "work.tasks", hollow: true },
        { id: "dr", side: "out", type: "record", label: "discovery.recorded" },
        { id: "if", side: "out", type: "record", label: "inquiry.finished" },
      ],
    },
    {
      id: "out",
      x: OX + 700,
      y: 40,
      w: 172,
      title: "그룹 출력",
      tag: "X",
      icon: <Compass />,
      rows: [
        { id: "tea", side: "in", type: "on", label: "tool.execution.after", fold: "tap" },
        { id: "bsa", side: "in", type: "on", label: "boundary.settle.after", fold: "tap" },
        { id: "post", side: "in", type: "post", label: "post 큐" },
        { id: "drv", side: "in", type: "drive", label: "주도" },
        { id: "llr", side: "in", type: "on", label: "lifecycle.lease.rejected", fold: "tap" },
        { id: "iab", side: "in", type: "on", label: "input.agent.before", fold: "collect" },
        { id: "tcb", side: "in", type: "on", label: "tool.call.before", fold: "first" },
        { id: "ss", side: "in", type: "on", label: "thread.start", fold: "tap" },
        { id: "rec", side: "in", type: "record", label: "grp.helm.* 기록 3" },
      ],
      body: <span>매니페스트 points 6</span>,
    },
  ];
}

const EDGES: [string, string, string, string, "cap" | "on" | "post" | "drive" | "record"][] = [
  ["in", "ws", "knowledge", "ws", "cap"],
  ["in", "wf", "knowledge", "wf", "cap"],
  ["in", "sk", "knowledge", "sk", "cap"],
  ["in", "mem", "knowledge", "mem", "cap"],
  ["in", "wt", "record", "wt", "cap"],
  ["signal", "tea", "out", "tea", "on"],
  ["signal", "bsa", "out", "bsa", "on"],
  ["signal", "post", "out", "post", "post"],
  ["signal", "rec", "out", "rec", "record"],
  ["signal", "pend", "drive", "pend", "record"],
  ["lens", "iab", "out", "iab", "on"],
  ["guard", "tcb", "out", "tcb", "on"],
  ["drive", "phase", "guard", "phase", "record"],
  ["restore", "ss", "out", "ss", "on"],
  ["drive", "drv", "out", "drv", "drive"],
  ["drive", "llr", "out", "llr", "on"],
  ["drive", "conv", "knowledge", "conv", "record"],
  ["knowledge", "found", "record", "found", "record"],
  ["record", "dr", "out", "rec", "record"],
  ["record", "if", "out", "rec", "record"],
];

const PROVIDERS: { row: string; label: string; off?: boolean }[] = [
  { row: "ws", label: "웹" },
  { row: "wf", label: "웹" },
  { row: "ks", label: "없음", off: true },
  { row: "sk", label: "지식" },
  { row: "mem", label: "지식" },
  { row: "wt", label: "작업" },
];

export function GroupScreen() {
  const m = useMock();
  const shell = useShell();
  const composer = m.composer;
  const edit = m.edit;
  const nodes = groupNodes(composer, edit);
  const byId = (id: string) => nodes.find((n) => n.id === id)!;
  const focus = m.selected !== null && nodes.some((n) => n.id === m.selected) ? m.selected : null;

  const wires: ReactNode[] = [];
  EDGES.forEach(([a, ar, b, br, t], i) => {
    const p = rowAnchor(byId(a), ar);
    const q = rowAnchor(byId(b), br);
    let look: WireLook = "base";
    if (focus !== null) look = a === focus || b === focus ? "lit" : "dim";
    if (edit === "invalid" || edit === "drop") look = "dim";
    // 부품 사이 상태 흐름(record)은 고르기 전엔 옅게: 바깥으로 나가는 포트 선이 주인공이다.
    if (t === "record" && focus === null && look === "base") look = "hover";
    wires.push(
      <Wire
        key={i}
        d={hPath(p, q)}
        type={t}
        look={look}
        dashed={t === "cap"}
        width={t === "record" ? 1.25 : undefined}
      />,
    );
  });
  // 기록 셋이 한 출력 행으로 모이는 경유점
  const recIn = rowAnchor(byId("out"), "rec");
  wires.push(<Reroute key="rr" x={recIn.x - 18} y={recIn.y} type={"on"} />);

  const inIn = byId("in");
  const ksRow = rowAnchor(inIn, "ks");
  const knowledgeKs = rowAnchor(byId("knowledge"), "ks");
  const overlay: ReactNode[] = [];
  if (edit === "drop") {
    const ghost = { x: OX - 150, y: ksRow.y - 22, w: 128, h: 44 };
    wires.push(
      <Wire
        key="g1"
        d={hPath({ x: ghost.x + ghost.w, y: ksRow.y }, { x: inIn.x, y: ksRow.y })}
        type="cap"
        look="ghost"
      />,
    );
    wires.push(<Wire key="g2" d={hPath(ksRow, knowledgeKs)} type="cap" look="ghost" />);
    overlay.push(
      <div
        key="ghost"
        className="absolute flex items-center gap-2 rounded-[10px] px-2.5"
        style={{
          left: ghost.x,
          top: ghost.y,
          width: ghost.w,
          height: ghost.h,
          background: "color-mix(in oklab, var(--cs-color-surface-base) 70%, transparent)",
          boxShadow: "inset 0 0 0 1.5px var(--port-cap), var(--cs-elevation-3)",
          transform: "rotate(-1.5deg)",
        }}
      >
        <span className="inline-grid size-5 place-items-center rounded-md bg-success-soft text-success-text [&_svg]:size-3.5">
          <Search />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[12.5px] font-semibold text-text-primary">문서 검색</span>
          <span className="truncate font-mono text-[10px] text-text-tertiary">
            docs-search · L2
          </span>
        </span>
        <MousePointer2
          className="absolute -right-2 -bottom-3 size-4 text-text-primary"
          emphasis="selected"
        />
      </div>,
      <div
        key="call"
        className="absolute flex w-[226px] flex-col gap-1.5 rounded-xl bg-surface-raised p-3 shadow-3"
        style={{ left: OX - 176, top: inIn.y + nodeH(inIn) + 14 }}
      >
        <span className="text-ui-sm text-text-primary">놓으면 이렇게 꽂혀요</span>
        <ol className="flex flex-col gap-1 text-[11.5px] text-text-secondary">
          <li className="flex items-center gap-1.5">
            <PortGlyph type="cap" size={8} />
            knowledge.search를 제공해요
          </li>
          <li className="flex items-center gap-1.5">
            <PortGlyph type="cap" size={8} hollow />
            지식 소비가 쓰게 돼요 · 저하 풀림
          </li>
          <li className="flex items-center gap-1.5 text-text-tertiary">
            <PortGlyph type="drive" size={8} hollow />
            설치 승인 뒤 다음 단계 경계부터
          </li>
        </ol>
      </div>,
    );
  }
  if (edit === "invalid") {
    const from = rowAnchor(inIn, "ws");
    const sig = byId("signal");
    const tip = { x: sig.x + 40, y: sig.y + nodeH(sig) - 26 };
    wires.push(<Wire key="bad" d={hPath(from, tip)} type="cap" look="invalid" />);
    wires.push(
      <Wire key="ok" d={hPath(from, rowAnchor(byId("knowledge"), "ws"))} type="cap" look="ghost" />,
    );
    overlay.push(
      <div
        key="x"
        className="absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-danger-solid text-danger-on [&_svg]:size-3.5"
        style={{ left: tip.x, top: tip.y }}
      >
        <CircleX />
      </div>,
      <div
        key="why"
        className="absolute flex w-[250px] flex-col gap-1 rounded-xl bg-surface-raised p-3 shadow-3"
        style={{ left: inIn.x - 40, top: inIn.y + nodeH(inIn) + 18 }}
      >
        <span className="text-ui-sm text-danger-text">이을 수 없어요</span>
        <span className="text-[11.5px] text-text-primary">
          신호 감지는 on 핸들러라 기능을 부르지 않아요.
        </span>
        <span className="font-mono text-[10px] text-text-tertiary">
          on_capability_call · ADR-0015
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[11.5px] text-text-secondary">
          <PortGlyph type="cap" size={8} hollow />
          지식 소비의 web.search에 이을 수 있어요
        </span>
      </div>,
    );
  }

  const mini: MiniRect[] = nodes.map((n) => ({
    x: n.x,
    y: n.y,
    w: n.w,
    h: nodeH(n),
    tone: n.id === focus ? "accent" : n.id === "in" || n.id === "out" ? "strong" : "base",
  }));
  const wellOpen = shell.endOpen && shell.layout === "wide";

  return (
    <Viewport
      label={composer ? "구성 · lens-review 부품" : "Helm 부품"}
      world={{ w: OX + 880, h: 560 }}
      pad={[56, 24 + (wellOpen ? 360 : 0), 20, 24]}
      minK={edit === "drop" ? 0.9 : wellOpen ? 0.72 : 0.84}
      anchor="start"
      alwaysMini
      onBackground={() => m.set({ selected: null })}
      crumbs={
        composer
          ? [
              {
                label: "구성",
                icon: <LayoutGrid className="size-3.5 text-text-tertiary" emphasis="muted" />,
                onClick: () => m.notify("구성 목록으로 가요"),
              },
              { label: "lens-review" },
            ]
          : [
              {
                label: "런타임 지도",
                icon: <Compass className="size-3.5 text-text-tertiary" emphasis="muted" />,
                onClick: () => m.set({ screen: "map" }),
              },
              { label: "Helm" },
            ]
      }
      crumbMeta={composer ? "Helm에서 복제 · 작성 중" : "부품 7 · composition 선언 · 읽기 전용"}
      topRight={
        <>
          <SegmentedControl
            aria-label="보기"
            size="sm"
            value="parts"
            onValueChange={(v) => v === "flow" && m.set({ screen: "flow" })}
            className="glass glass-shadow-2"
          >
            <SegmentedControlItem value="parts">부품</SegmentedControlItem>
            <SegmentedControlItem value="flow">흐름</SegmentedControlItem>
          </SegmentedControl>
          {composer ? (
            <>
              <Button
                size="sm"
                tone="neutral"
                variant="soft"
                className="glass glass-shadow-2"
                iconStart={<Play />}
                onClick={() =>
                  m.set({ screen: "flow", trial: true, composer: false, ctx: "x-helm5" })
                }
              >
                테스트
              </Button>
              <Button
                size="sm"
                tone="neutral"
                variant="soft"
                className="glass glass-shadow-2"
                iconStart={<Plus />}
                onClick={() => m.notify("새 그룹: 템플릿 drive · 정책 · 관찰")}
              >
                새 그룹
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              tone="neutral"
              variant="soft"
              className="glass glass-shadow-2"
              iconEnd={<ArrowUpRight />}
              onClick={() => m.set({ composer: true })}
            >
              구성기에서 열기
            </Button>
          )}
        </>
      }
      mini={mini}
      bottomLeft={
        edit === "drop" ? (
          <div className="glass glass-shadow-3 flex max-h-[300px] w-[256px] flex-col gap-1 overflow-hidden rounded-xl p-2.5">
            <span className="flex h-6 items-center text-ui-sm text-text-primary">블록</span>
            <Library compact />
          </div>
        ) : undefined
      }
    >
      {edit !== "drop" &&
        PROVIDERS.map((p) => {
          const a = rowAnchor(inIn, p.row);
          return (
            <span
              key={p.row}
              className={`absolute flex h-5 -translate-y-1/2 items-center gap-1 text-[11px] ${p.off ? "text-warning-text" : "text-text-tertiary"}`}
              style={{ left: OX - 64, top: a.y, width: 56, justifyContent: "flex-end" }}
            >
              {p.label}
              <span
                className="h-px w-3"
                style={{ background: p.off ? "transparent" : "var(--port-cap)", opacity: 0.6 }}
              />
            </span>
          );
        })}
      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={OX + 880}
        height={530}
        aria-hidden
      >
        {wires}
      </svg>
      {nodes.map((n) => (
        <Node
          key={n.id}
          n={n}
          selected={focus === n.id}
          dim={
            (focus !== null &&
              focus !== n.id &&
              !EDGES.some(
                ([a, , b]) => (a === focus && b === n.id) || (b === focus && a === n.id),
              )) ||
            ((edit === "drop" || edit === "invalid") &&
              !["in", "knowledge", "signal"].includes(n.id))
          }
          state={edit === "invalid" && n.id === "signal" ? "invalid" : "idle"}
          onClick={() => m.set({ selected: m.selected === n.id ? null : n.id })}
        />
      ))}
      {overlay}
    </Viewport>
  );
}
