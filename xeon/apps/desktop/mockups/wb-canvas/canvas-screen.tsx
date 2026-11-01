// 작업대 개요를 캔버스로(P-16 대체 제안): 층 띠 위에 확장 블록, 블록 사이 연결(능력·on·post·drive), X 띠의 지점 레일과 임대.
// 맥락(왼쪽 패널)이 캔버스를 다시 그리고, 대화·시험 맥락은 실시간 덧그림(임대 흐름, 단계 경계 교대)을 얹는다.
// 재생 막대는 한 턴의 지점 발화를 되짚어 그때 돈 핸들러와 예산 대비 시간을 블록 옆에 보인다.
import {
  Alert,
  Button,
  CanvasSelection,
  Select,
  SelectOption,
  SegmentedControl,
  SegmentedControlItem,
} from "@caustic/react";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleX, History, Play, Plus, TriangleAlert, WorkbenchHead, useShell } from "../_shell";
import {
  ADD_SLOT,
  BANDS,
  CONTEXTS,
  DENSE,
  DENSE_WORLD,
  EDGES,
  NODES,
  REPLAY,
  VIEWS,
  WORLD,
  ctxOf,
  nodeById,
  type CNode,
  type CtxNodeState,
  type Edge,
} from "./data";
import { EdgeLayer, Pulse, type EdgeLook } from "./parts/edges";
import { LayerList } from "./parts/layer-list";
import { MinimapBar, type MiniNode } from "./parts/minimap";
import { ExtNode, HostNode, Mark } from "./parts/node";
import { BandFills, BandLabels, FoldGlyph, GroupKitRail, PointRail } from "./parts/rail";
import { Latency, Scrubber } from "./parts/scrubber";
import { Viewport } from "./parts/viewport";
import { FIT_VIEW, useMock, type View } from "./store";

const SAFE_ABSENT = new Set([
  "helm",
  "plan-first",
  "learning",
  "review",
  "web-exa",
  "acme-notes",
  "provider-oauth",
  "pre-commit-lint",
]);
const EMPTY_GONE = new Set([
  "helm",
  "plan-first",
  "review",
  "web-exa",
  "acme-notes",
  "provider-oauth",
  "pre-commit-lint",
]);
const EXT_KINDS = new Set(["group", "plugin", "core", "platform", "hook"]);
const LABEL_GUTTER = 84;

const fitView = (box: { w: number; h: number }): View => {
  const k = Math.min(
    1,
    Math.max(0.6, Math.min((box.w - LABEL_GUTTER - 16) / (WORLD.w - 96), (box.h - 16) / WORLD.h)),
  );
  return { k, x: LABEL_GUTTER - 96 * k, y: 8 };
};

export function CanvasScreen() {
  const m = useMock();
  const shell = useShell();
  const compact = shell.layout === "compact";
  const view = VIEWS[m.ctx] ?? VIEWS.all!;
  const cmp = m.compare !== null ? VIEWS[m.compare] : undefined;
  const offline = m.mode === "offline";
  const live = view.live && !offline && m.replay === null && m.compare === null;
  const ev = m.replay !== null ? REPLAY[m.replay] : undefined;

  // 캔버스 크기와 처음 맞춤(상태가 줌을 정하지 않았으면 폭에 맞춘다).
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 900, h: 600 });
  const fitted = useRef(false);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el === null) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setBox((o) => (o.w === r.width && o.h === r.height ? o : { w: r.width, h: r.height }));
      if (!fitted.current && r.width > 0) {
        fitted.current = true;
        if (m.zoom === FIT_VIEW) m.set({ zoom: fitView({ w: r.width, h: r.height }) });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 한 번만 재고 이후는 ResizeObserver가 맡는다
  }, [m.view, compact]);

  const stOf = (
    n: CNode,
  ): CtxNodeState & { absent?: boolean; gone?: boolean; markTone?: "add" | "remove" } => {
    if (m.mode === "empty" && EMPTY_GONE.has(n.id)) return { on: false, gone: true };
    const base = view.nodes[n.id] ?? { on: true };
    if (m.mode === "safe" && SAFE_ABSENT.has(n.id)) return { on: false, absent: true };
    if (cmp !== undefined) {
      const b = cmp.nodes[n.id] ?? { on: true };
      if (base.on && !b.on) return { ...base, on: true, mark: "−", markTone: "remove" };
      if (!base.on && b.on) return { ...b, on: true, mark: "+", markTone: "add" };
      return { ...base, mark: undefined };
    }
    return base;
  };

  const handlerOf = (id: string) => ev?.handlers.find((h) => h.ext === id);
  const neighbours = useMemo(() => {
    if (m.selected === null) return null;
    const s = new Set<string>([m.selected]);
    for (const e of EDGES)
      if (e.from === m.selected || e.to === m.selected) [e.from, e.to].forEach((x) => s.add(x));
    return s;
  }, [m.selected]);

  const nodeVisible = (id: string) => {
    const n = nodeById(id);
    if (n === undefined) return true;
    const st = stOf(n);
    return st.gone !== true && st.absent !== true;
  };
  const lookOf = (e: Edge): EdgeLook => {
    if (m.mode === "dense") return "hidden";
    if (!nodeVisible(e.from) || !nodeVisible(e.to)) return "hidden";
    if (ev !== undefined) {
      if (e.kind === "on" && e.point === ev.point && handlerOf(e.from) !== undefined)
        return "traced";
      if (e.kind === "drive" && e.from === view.lease?.holder) return "base";
      return "dimmed";
    }
    if (m.selected !== null)
      return e.from === m.selected || e.to === m.selected ? "traced" : "dimmed";
    const from = nodeById(e.from);
    if (from !== undefined && !stOf(from).on) return "dimmed";
    if (m.compare !== null && from !== undefined && stOf(from).mark === undefined) return "dimmed";
    return "base";
  };
  const holderEdge = EDGES.find((e) => e.kind === "drive" && e.from === view.lease?.holder);
  const flowing = (e: Edge) =>
    (live || ev !== undefined) && e === holderEdge && m.mode === "normal";

  const nodeDimmed = (n: CNode) => {
    if (ev !== undefined)
      return (
        n.band !== "X" &&
        handlerOf(n.id) === undefined &&
        !(n.id === view.lease?.holder && ev.boundary !== undefined)
      );
    if (neighbours !== null) return !neighbours.has(n.id) && n.band !== "X";
    if (m.compare !== null)
      return (n.band === "L3" || n.band === "L2") && stOf(n).mark === undefined;
    return false;
  };

  const tagOf = (n: CNode): ReactNode => {
    const h = handlerOf(n.id);
    if (h !== undefined) return <Latency h={h} />;
    const st = stOf(n);
    const ov = view.overrides.filter(
      (o) => o.key.startsWith(`ext.${n.id}.`) && !o.key.endsWith(".enabled"),
    );
    if (m.compare === null && st.mark === "~" && ov.length > 0)
      return (
        <span className="rounded-xs bg-surface-base px-1 py-0.5 text-ui-xs text-text-secondary shadow-[0_0_0_1px_var(--cs-color-border-subtle)]">
          {ov.map((o) => (
            <span key={o.key}>
              <span className="font-mono text-mono-sm text-text-tertiary">{o.key}</span> = {o.value}
            </span>
          ))}
        </span>
      );
    if (m.compare !== null && st.mark !== undefined)
      return (
        <span className="text-ui-xs text-text-tertiary">
          {st.mark === "−"
            ? `${ctxOf(m.compare).label}에서 꺼짐`
            : `${ctxOf(m.compare).label}에서 켜짐`}
        </span>
      );
    return undefined;
  };

  // ── X 노드 내용
  const lease = cmp !== undefined ? cmp.lease : view.lease;
  const hostBody = (id: string): ReactNode => {
    const line = (children: ReactNode) => (
      <span className="truncate text-ui-xs text-text-secondary">{children}</span>
    );
    const quiet = (children: ReactNode) => (
      <span className="truncate text-ui-xs text-text-tertiary">{children}</span>
    );
    if (id === "x-lease") {
      if (m.mode === "safe") return quiet("보유 없음 · drive 그룹이 빠졌어요");
      if (m.mode === "empty") return quiet("drive를 쓰는 그룹이 없어요");
      if (view.lease === null) return quiet("대화마다 하나 · 보유 중 2개 대화");
      const l = view.lease;
      if (cmp !== undefined)
        return (
          <>
            {line(
              <>
                {l.holder ?? "없음"} <span className="text-text-tertiary">→</span>{" "}
                {lease?.holder ?? "없음"}
              </>,
            )}
            {quiet(
              `${ctxOf(m.compare!).label}에서는 ${lease?.holder === null ? "아무도 보유하지 않아요" : `${lease?.holder} 보유`}`,
            )}
          </>
        );
      return (
        <>
          {line(
            l.holder === null ? (
              "보유 없음"
            ) : (
              <>
                <span className="font-medium text-text-primary">{l.holder}</span>
                {l.epoch !== undefined && (
                  <span className="text-text-tertiary"> · 차수 {l.epoch}</span>
                )}
                {l.turns !== undefined && (
                  <span className="tabular-nums">
                    {" "}
                    · 턴 {l.turns[0]}/{l.turns[1]} · spawn {l.spawns?.[0]}/{l.spawns?.[1]} ·{" "}
                    {Math.round((l.tokens?.[0] ?? 0) / 1000)}k/
                    {Math.round((l.tokens?.[1] ?? 0) / 1000)}k
                  </span>
                )}
              </>
            ),
          )}
          {quiet(
            l.queue.length === 0
              ? "대기 없음"
              : `대기 ${l.queue.map((q) => `${q.id} · ${q.note}`).join(", ")}`,
          )}
        </>
      );
    }
    if (id === "x-post")
      return view.live ? line("followUp 1 · steer 0 · next 0") : quiet("steer · followUp · next");
    if (id === "x-scope")
      return m.ctx === "t1"
        ? line("다음 단계 경계 적용 1 · dialog 켜는 중")
        : quiet(
            m.mode === "empty"
              ? `켜짐 ${onCount}`
              : `켜짐 ${onCount} · 꺼짐 1 · 자동 꺼짐 ${autoCount}`,
          );
    if (id === "x-ops")
      return m.mode === "safe" ? line("안전 모드 켜짐") : quiet("안전 모드 꺼짐 · 자동 끄기 5번");
    return undefined;
  };

  // ── 숫자
  const exts = NODES.filter((n) => EXT_KINDS.has(n.kind) && stOf(n).gone !== true);
  const onCount = exts.filter((n) => stOf(n).on && n.health !== "auto_disabled").length;
  const autoCount = exts.filter((n) => n.health === "auto_disabled").length;
  const counts = Object.fromEntries(
    BANDS.filter((b) => b.id !== "X" && b.id !== "F").map((b) => {
      const all =
        m.mode === "dense"
          ? DENSE.filter((d) => d.band === b.id)
          : NODES.filter((n) => n.band === b.id && stOf(n).gone !== true);
      if (m.mode === "dense") {
        const d = all as typeof DENSE;
        const warn = d.filter((x) => x.health === "auto_disabled" || x.health === "failing").length;
        return [
          b.id,
          `${d.filter((x) => x.health !== "disabled").length}/${d.length}${warn > 0 ? ` · 주의 ${warn}` : ""}`,
        ];
      }
      const on = (all as CNode[]).filter((n) => stOf(n).on).length;
      return [b.id, `${on}/${all.length}`];
    }),
  );

  const failureAlert =
    m.mode === "normal" && (m.ctx === "all" || m.ctx === "t1") && m.compare === null;
  const alert: ReactNode =
    m.mode === "safe" ? (
      <Alert
        tone="warning"
        variant="soft"
        size="sm"
        emphasis="lead"
        actions={[
          { label: "안전 모드 끄고 다시 시작", onClick: () => m.notify("엔진을 다시 시작해요") },
        ]}
      >
        <b>안전 모드예요.</b> L3 그룹과 user·project 확장을 싣지 않았어요
      </Alert>
    ) : offline ? (
      <Alert
        tone="neutral"
        variant="soft"
        size="sm"
        emphasis="lead"
        actions={[{ label: "다시 연결", onClick: () => m.notify("다시 연결하는 중이에요") }]}
      >
        <b>엔진과 연결이 끊겼어요.</b> 14:03 기준 지도예요. 켜기·끄기는 잠겨요
      </Alert>
    ) : failureAlert ? (
      <Alert
        tone="danger"
        variant="soft"
        size="sm"
        emphasis="lead"
        actions={[
          {
            label: "다시 켜기",
            primary: true,
            onClick: () => m.notify("리뷰를 다시 켰어요 · 다음 단계 경계에 적용돼요"),
          },
          { label: "보기", onClick: () => m.select("review") },
        ]}
      >
        <b>리뷰가 자동으로 꺼졌어요.</b> boundary.settle.after 연속 5번 실패
      </Alert>
    ) : null;

  const c = ctxOf(m.ctx);
  const canReplay = c.kind === "thread" || c.kind === "trial";

  const head = (
    <WorkbenchHead
      className="w-full px-3"
      title="개요"
      meta={
        m.mode === "dense"
          ? `확장 ${DENSE.length + 6} · 켜짐 ${DENSE.filter((d) => d.health === "ok" || d.health === "failing").length + 6} · 자동 꺼짐 2`
          : `확장 ${exts.length} · 켜짐 ${onCount}${autoCount > 0 ? ` · 자동 꺼짐 ${autoCount}` : ""}`
      }
      sub={
        <>
          {live && (
            <span
              aria-hidden
              className="size-1.5 animate-pulse self-center rounded-full bg-success-graphic"
            />
          )}
          {!shell.startOpen && (
            <span className="text-text-secondary">
              {c.kind === "all" ? "맥락 전체" : c.label} ·
            </span>
          )}
          <span>
            {ev !== undefined
              ? `턴 7 재생 · ${m.replay! + 1}/${REPLAY.length}`
              : offline
                ? "연결 끊김 · 마지막 턴 7"
                : view.line}
          </span>
          <span>· 14:03 기준 · seq 9120</span>
        </>
      }
      actions={
        <>
          {m.view === "canvas" && !compact && m.mode !== "dense" && m.mode !== "empty" && (
            <Select
              size="xs"
              variant={m.compare !== null ? "soft" : "ghost"}
              aria-label="비교할 맥락"
              value={m.compare ?? "none"}
              onValueChange={(v) => m.set({ compare: v === "none" ? null : v, replay: null })}
            >
              <SelectOption value="none">비교 안 함</SelectOption>
              {CONTEXTS.filter((x) => x.value !== m.ctx && x.value !== "all").map((x) => (
                <SelectOption key={x.value} value={x.value}>
                  비교 · {x.label}
                </SelectOption>
              ))}
            </Select>
          )}
          {canReplay && !compact && m.view === "canvas" && (
            <Button
              size="xs"
              variant={m.replay !== null ? "soft" : "ghost"}
              aria-pressed={m.replay !== null}
              onClick={() => m.set({ replay: m.replay === null ? 0 : null, selected: null })}
            >
              <History />
              턴 재생
            </Button>
          )}
          {!compact && (
            <SegmentedControl
              size="xs"
              value={m.view}
              onValueChange={(v) => m.set({ view: v as "canvas" | "list" })}
              aria-label="보기"
            >
              <SegmentedControlItem value="canvas">캔버스</SegmentedControlItem>
              <SegmentedControlItem value="list">목록</SegmentedControlItem>
            </SegmentedControl>
          )}
        </>
      }
    />
  );

  if (compact || m.view === "list")
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {head}
        {alert !== null && <div className="px-3 pb-2">{alert}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <LayerList ctx={m.ctx} selected={m.selected} onSelect={(id) => m.select(id)} />
        </div>
      </div>
    );

  const mini: MiniNode[] =
    m.mode === "dense"
      ? DENSE.map((d) => ({
          id: d.id,
          band: d.band,
          x: d.x,
          y: d.y,
          w: 64,
          h: 22,
          on: d.health !== "disabled",
          tone:
            d.health === "auto_disabled"
              ? "danger"
              : d.health === "failing"
                ? "warning"
                : undefined,
        }))
      : NODES.filter((n) => stOf(n).gone !== true).map((n) => ({
          id: n.id,
          band: n.band,
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          on: stOf(n).on,
          tone:
            n.health === "auto_disabled"
              ? "danger"
              : n.health === "failing"
                ? "warning"
                : undefined,
        }));

  const sel = m.selected !== null ? nodeById(m.selected) : undefined;
  const worldSize = m.mode === "dense" ? DENSE_WORLD : WORLD;

  const world = (
    <div className="relative" style={{ width: worldSize.w, height: worldSize.h }}>
      <BandFills w={worldSize.w} safe={m.mode === "safe"} />
      <EdgeLayer
        edges={EDGES}
        lookOf={lookOf}
        flowing={flowing}
        ghost={(e) => {
          const f = nodeById(e.from);
          const t = nodeById(e.to);
          return (
            (f !== undefined && !stOf(f).on) || (t !== undefined && t.band === "L3" && !stOf(t).on)
          );
        }}
        w={WORLD.w}
        h={WORLD.h}
      />
      <GroupKitRail absent={m.mode === "safe"} />
      {m.mode === "empty" ? (
        <div
          className="absolute grid content-center justify-items-start gap-1.5 rounded-md border border-dashed border-border-strong px-3"
          style={{ left: 96, top: ADD_SLOT.y, width: 312, height: ADD_SLOT.h }}
        >
          <span className="text-ui-sm font-medium text-text-primary">그룹 블록을 쌓아 보세요</span>
          <span className="flex gap-1">
            <Button size="xs" variant="solid" onClick={() => m.notify("만들기로 가요")}>
              만들기
            </Button>
            <Button size="xs" variant="ghost" onClick={() => m.notify("가져오기")}>
              가져오기
            </Button>
          </span>
        </div>
      ) : (
        m.mode !== "dense" && (
          <button
            type="button"
            data-node="add"
            onClick={() => m.notify("만들기(P-22)로 가요 · 템플릿 drive·정책·관찰")}
            className="absolute grid place-items-center rounded-md border border-dashed border-border-default text-ui-xs text-text-tertiary outline-none hover:border-border-strong hover:text-text-secondary focus-visible:shadow-focus"
            style={{ left: ADD_SLOT.x, top: ADD_SLOT.y, width: ADD_SLOT.w, height: ADD_SLOT.h }}
          >
            <span className="flex items-center gap-1">
              <Plus />
              그룹 쌓기
            </span>
          </button>
        )
      )}
      <PointRail
        activePoint={ev?.point ?? null}
        dimOthers={ev !== undefined}
        usedBy={Object.fromEntries(
          [
            "input.agent.before",
            "tool.call.before",
            "tool.execution.after",
            "boundary.step.after",
            "boundary.settle.after",
            "session.start",
            "lifecycle.lease.rejected",
          ].map((p) => [
            p,
            NODES.filter((n) => (n.points ?? []).includes(p) && stOf(n).on && nodeVisible(n.id))
              .length,
          ]),
        )}
      />
      {m.mode === "dense"
        ? DENSE.map((d) => (
            <DensePill
              key={d.id}
              d={d}
              k={m.zoom.k}
              holder={d.id === "helm"}
              onSelect={() => m.select(nodeById(d.id) !== undefined ? d.id : null)}
            />
          ))
        : NODES.filter((n) => n.band !== "X" && n.band !== "F").map((n) => {
            const st = stOf(n);
            if (st.gone === true) return null;
            return (
              <ExtNode
                key={n.id}
                n={n}
                st={st}
                selected={m.selected === n.id}
                dimmed={nodeDimmed(n)}
                onSelect={(id) => m.select(id)}
                tag={tagOf(n)}
                markTone={st.markTone}
                absent={st.absent}
                live={live}
                holderLine={
                  view.lease?.turns !== undefined
                    ? `drive 보유 · 턴 ${view.lease.turns[0]}/${view.lease.turns[1]}`
                    : undefined
                }
              />
            );
          })}
      {NODES.filter((n) => n.band === "X" || n.band === "F").map((n) => {
        if (stOf(n).gone === true) return null;
        if (n.kind === "hook")
          return (
            <ExtNode
              key={n.id}
              n={n}
              st={stOf(n)}
              selected={m.selected === n.id}
              onSelect={(id) => m.select(id)}
              absent={stOf(n).absent}
              dimmed={nodeDimmed(n)}
            />
          );
        return (
          <HostNode
            key={n.id}
            n={n}
            selected={m.selected === n.id}
            onSelect={(id) => m.select(id)}
            quiet={n.band === "F"}
          >
            {hostBody(n.id)}
          </HostNode>
        );
      })}
      {sel !== undefined && (
        <CanvasSelection
          mode="select"
          handles="none"
          objectRadius={8}
          rect={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h }}
        />
      )}
      {live && holderEdge !== undefined && m.mode === "normal" && m.selected === null && (
        <>
          <Pulse edge={holderEdge} reverse />
          <span
            className="glass absolute flex h-5 items-center gap-1.5 rounded-sm px-1.5 text-ui-xs whitespace-nowrap text-text-secondary glass-shadow-2"
            style={{
              left: nodeById("x-lease")!.x,
              top: nodeById("x-lease")!.y + nodeById("x-lease")!.h + 4,
            }}
          >
            <span aria-hidden className="size-2 rotate-45 rounded-[1px] bg-text-secondary" />
            {m.ctx === "x:lens5"
              ? "턴 2 · 단계 경계 · helm 임대 이어 받음"
              : "턴 7 · 단계 경계 14:02:41 · helm 임대 받음"}
          </span>
        </>
      )}
      {ev?.boundary !== undefined && holderEdge !== undefined && (
        <Pulse edge={holderEdge} reverse />
      )}
    </div>
  );

  const overlay = (
    <>
      <BandLabels view={m.zoom} counts={counts} />
      {m.compare !== null && (
        <div className="glass absolute top-2 right-2 z-10 flex items-center gap-1.5 rounded-toolbar px-2.5 py-1.5 text-ui-xs text-text-secondary glass-shadow-2">
          <span className="grid size-4 place-items-center rounded-full bg-diff-remove-bg text-micro font-semibold text-diff-remove-text">
            −
          </span>
          {c.label}에만
          <span className="grid size-4 place-items-center rounded-full bg-diff-add-bg text-micro font-semibold text-diff-add-text">
            +
          </span>
          {ctxOf(m.compare).label}에만
        </div>
      )}
      {ev === undefined && m.mode !== "dense" && box.w >= 860 && <Legend />}
      <MinimapBar
        view={m.zoom}
        onView={(z) => m.set({ zoom: z })}
        nodes={mini}
        world={worldSize}
        box={box}
        onFit={() => m.set({ zoom: fitView(box) })}
        showMap={box.w > 640 && (ev === undefined || m.mode === "dense")}
      />
      {ev !== undefined && m.replay !== null && (
        <Scrubber
          index={m.replay}
          onIndex={(i) => m.set({ replay: i })}
          onClose={() => m.set({ replay: null })}
          left={LABEL_GUTTER}
          right={172}
        />
      )}
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {head}
      {alert !== null && <div className="px-3 pb-1.5">{alert}</div>}
      <div ref={boxRef} className="relative flex min-h-0 flex-1 flex-col">
        <Viewport
          label="런타임 캔버스"
          view={m.zoom}
          onView={(z) => m.set({ zoom: z })}
          world={world}
          overlay={overlay}
          dim={offline}
          onBackground={() => m.select(null)}
        />
      </div>
    </div>
  );
}

/** 밀집 블록. 줌이 0.65보다 작으면 이름을 숨긴 막대가 되고, 주의할 블록(자동 꺼짐, 실패, 임대 보유)만 화면 크기 이름표를 단다(의미 줌). */
function DensePill({
  d,
  k,
  holder,
  onSelect,
}: {
  d: (typeof DENSE)[number];
  k: number;
  holder: boolean;
  onSelect: () => void;
}) {
  const semantic = k < 0.65;
  const flag = d.health === "auto_disabled" || d.health === "failing" || holder;
  const dot =
    d.health === "auto_disabled"
      ? "bg-danger-graphic"
      : d.health === "failing"
        ? "bg-warning-graphic"
        : d.health === "disabled"
          ? "bg-transparent"
          : "bg-neutral-graphic";
  return (
    <>
      <button
        type="button"
        data-node={d.id}
        aria-label={`${d.id} · ${d.band}${d.health === "auto_disabled" ? " · 자동 꺼짐" : d.health === "failing" ? " · 실패" : d.health === "disabled" ? " · 꺼짐" : ""}`}
        onClick={onSelect}
        className={`absolute flex items-center gap-1 rounded-sm px-1.5 text-ui-xs outline-none focus-visible:shadow-focus ${d.health === "disabled" ? "border border-dashed border-border-strong text-text-tertiary" : "bg-surface-base text-text-primary shadow-[0_0_0_1px_var(--cs-color-border-subtle)]"}`}
        style={{
          left: d.x,
          top: d.y,
          width: d.band === "L3" ? 70 : 92,
          height: semantic ? 14 : 24,
        }}
      >
        <span aria-hidden className={`size-1.5 flex-none rounded-full ${dot}`} />
        {!semantic && <span className="truncate">{d.id}</span>}
      </button>
      {semantic && flag && (
        <span
          aria-hidden
          className="glass pointer-events-none absolute flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-ui-xs whitespace-nowrap text-text-primary glass-shadow-2"
          style={{
            left: d.x,
            top: d.y - 4,
            transform: `translateY(-100%) scale(${1 / k})`,
            transformOrigin: "bottom left",
          }}
        >
          {holder ? (
            <Mark tone="neutral">
              <Play emphasis="selected" />
            </Mark>
          ) : (
            <Mark tone={d.health === "auto_disabled" ? "danger" : "warning"}>
              {d.health === "auto_disabled" ? <CircleX /> : <TriangleAlert />}
            </Mark>
          )}
          {d.id}
        </span>
      )}
    </>
  );
}

/** 범례: 선 모양과 포트 모양. 색이 아니라 모양으로만 구분한다. */
function Legend() {
  const line = (dash: string | undefined, w = 1.25, cls = "stroke-text-tertiary") => (
    <svg aria-hidden width="22" height="8" className="flex-none">
      <path
        d="M1 4 H21"
        strokeWidth={w}
        strokeDasharray={dash}
        strokeLinecap="round"
        className={cls}
      />
    </svg>
  );
  const item = (g: ReactNode, t: string) => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {g}
      {t}
    </span>
  );
  return (
    <div
      className="glass absolute bottom-2 z-10 flex max-w-[calc(100%-280px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-toolbar px-2.5 py-1.5 text-ui-xs text-text-secondary glass-shadow-2"
      style={{ left: LABEL_GUTTER }}
      aria-label="범례"
    >
      {item(line(undefined), "능력")}
      {item(line("5 3"), "optional")}
      {item(line("2 3"), "제공자 없음")}
      {item(line(undefined, 1.25, "stroke-text-secondary"), "on")}
      {item(line("0.5 4", 1.75, "stroke-text-secondary"), "post")}
      {item(line(undefined, 2.25, "stroke-text-primary"), "drive")}
      <span className="w-1" aria-hidden />
      {item(<FoldGlyph fold="collect" size={8} />, "collect")}
      {item(<FoldGlyph fold="first" size={8} />, "first")}
      {item(<FoldGlyph fold="chain" size={8} />, "chain")}
      {item(<FoldGlyph fold="tap" size={8} />, "tap")}
    </div>
  );
}
