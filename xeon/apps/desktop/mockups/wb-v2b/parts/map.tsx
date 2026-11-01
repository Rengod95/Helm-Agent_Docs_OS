// 런타임 지도(세계 좌표 장면). 세 열이 층 lane: 능력 공급(L1·L2) → 의도 그룹(L3)·외부 plugin → X 확장 지점.
// 선 규칙: 기본은 숨김(포트 알약의 짧은 꼬리만). 고르거나 올린 블록의 경로만 그린다. on 선은 블록에서 한 줄기로 나와
// 지점 열 앞 경유점에서 갈라지고(묶음), 능력 선은 받는 블록 앞 경유점에서 모여 한 줄기로 들어간다.
import type { ReactNode } from "react";
import { ArrowRight, ChevronRight, Play, RotateCcw } from "../../_shell";
import {
  COL,
  EXTS,
  FAMILIES,
  LEASE,
  POST_Q,
  SOCKETS,
  SOCKET_H,
  blockBox,
  extById,
  inAnchor,
  lease,
  leaseAnchor,
  outAnchor,
  portDy,
  postAnchor,
  providerOf,
  socketAnchor,
  THREAD_MEMBERS,
  THREAD_PENDING,
  type Ext,
  type PortType,
} from "../data";
import {
  cardStyle,
  ExtIcon,
  Face,
  FoldGlyph,
  hPath,
  Pill,
  PortGlyph,
  Reroute,
  Spark,
  Wire,
  type PillState,
  type Pt,
  type WireLook,
} from "./kit";

export interface MapProps {
  selected: string | null;
  hover: string | null;
  mode: "normal" | "failure" | "thread";
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  onOpenGroup: (id: string) => void;
  /** 빈 상태: 보일 확장만(내장). */
  visible?: Set<string>;
  children?: ReactNode;
}

const THREAD_Y: Record<string, number> = {
  helm: 40,
  "plan-first": 136,
  learning: 232,
  "acme-notes": 328,
  review: 446,
  "provider-oauth": 540,
};
export const THREAD_SHIFT = 30;

function posOf(e: Ext, mode: MapProps["mode"]): Ext {
  if (mode === "thread" && THREAD_Y[e.id] !== undefined) return { ...e, y: THREAD_Y[e.id]! };
  return e;
}

interface Conn {
  ext: string;
  other: string; // 제공 확장 또는 지점 id 또는 "post"·"lease"
  type: PortType;
  d: string;
  dashed?: boolean;
}

function connsFor(eRaw: Ext, mode: MapProps["mode"]) {
  const e = posOf(eRaw, mode);
  const out: {
    trunks: { d: string; type: PortType; dot: Pt; n: number }[];
    wires: Conn[];
    missing: string[];
  } = {
    trunks: [],
    wires: [],
    missing: [],
  };
  // 능력: 제공자 → 경유점 → 받는 알약
  const caps = e.consumes ?? [];
  if (caps.length > 0 && e.col === "B") {
    const pin = inAnchor(e);
    const dot = { x: pin.x - 16, y: pin.y };
    let n = 0;
    caps.forEach((c) => {
      const p = providerOf(c.id);
      if (p === undefined) {
        out.missing.push(c.id);
        return;
      }
      n++;
      out.wires.push({
        ext: e.id,
        other: p.id,
        type: "cap",
        d: hPath(outAnchor(posOf(p, mode), "cap"), dot),
        dashed: c.need === "optional",
      });
    });
    if (n > 0)
      out.trunks.push({
        d: `M${dot.x} ${dot.y} L${pin.x} ${pin.y}`,
        type: "cap",
        dot,
        n: n > 1 ? n : 0,
      });
  }
  // on: 블록 → 묶음 경유점 → 지점
  const pts = e.points ?? [];
  if (pts.length > 0) {
    const a = outAnchor(e, "on");
    const ys = pts.map((p) => socketAnchor(p).y);
    const dot = { x: COL.C.x - 22, y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2) };
    if (pts.length > 1) {
      out.trunks.push({ d: hPath(a, dot), type: "on", dot, n: pts.length });
      pts.forEach((p) => {
        const s = socketAnchor(p);
        out.wires.push({
          ext: e.id,
          other: p,
          type: "on",
          d: `M${dot.x} ${dot.y} C ${dot.x + 12} ${dot.y}, ${s.x - 12} ${s.y}, ${s.x} ${s.y}`,
        });
      });
    } else {
      out.wires.push({ ext: e.id, other: pts[0]!, type: "on", d: hPath(a, socketAnchor(pts[0]!)) });
    }
  }
  if (e.usesPost)
    out.wires.push({
      ext: e.id,
      other: "post",
      type: "post",
      d: hPath(outAnchor(e, "post"), postAnchor),
    });
  if (e.usesDrive)
    out.wires.push({
      ext: e.id,
      other: "lease",
      type: "drive",
      d: hPath(outAnchor(e, "drive"), leaseAnchor),
    });
  return out;
}

export function relatedOf(id: string | null): Set<string> {
  const s = new Set<string>();
  if (id === null) return s;
  s.add(id);
  const e = extById(id);
  e.consumes?.forEach((c) => {
    const p = providerOf(c.id);
    if (p !== undefined) s.add(p.id);
  });
  e.points?.forEach((p) => s.add(p));
  if (e.usesPost) s.add("post");
  if (e.usesDrive) s.add("lease");
  // 제공자를 고르면 그 능력을 쓰는 블록
  EXTS.forEach((o) => {
    if (o.consumes?.some((c) => e.provides?.includes(c.id))) s.add(o.id);
  });
  if (e.id === "web") s.add("web-exa");
  if (e.dockTo !== undefined) s.add(e.dockTo);
  return s;
}

export function RuntimeMap({
  selected,
  hover,
  mode,
  onSelect,
  onHover,
  onOpenGroup,
  visible,
  children,
}: MapProps) {
  const focus = selected ?? hover;
  const rel = relatedOf(focus);
  const thread = mode === "thread";
  const failure = mode === "failure";
  const shift = thread ? THREAD_SHIFT : 0;

  // ── 그릴 선 고르기
  const layers: ReactNode[] = [];
  const drawFor = (id: string, look: WireLook) => {
    const e = extById(id);
    const c = connsFor(e, mode);
    c.wires.forEach((w, i) => {
      let lk = look;
      if (failure && id === "review") lk = w.other === "boundary.settle.after" ? "fail" : "dim";
      if (failure && id === "acme-notes") lk = "fail";
      if (thread && w.type === "drive") lk = id === lease.holder ? "live" : "ghost";
      layers.push(<Wire key={`${id}-w${i}`} d={w.d} type={w.type} look={lk} dashed={w.dashed} />);
    });
    c.trunks.forEach((t, i) => {
      const lk = failure && id === "review" ? "fail" : look;
      layers.push(
        <Wire
          key={`${id}-t${i}`}
          d={t.d}
          type={t.type}
          look={lk}
          width={t.type === "on" && t.n > 1 ? 2.75 : undefined}
        />,
      );
      layers.push(
        <Reroute
          key={`${id}-d${i}`}
          x={t.dot.x}
          y={t.dot.y}
          type={t.type}
          n={t.n > 1 ? t.n : undefined}
        />,
      );
    });
  };
  if (focus !== null && extById(focus).col === "B")
    drawFor(focus, selected !== null ? "lit" : "hover");
  if (focus !== null && extById(focus).col === "A") {
    // 제공자: 그 능력을 받는 블록의 능력 선만
    const e = extById(focus);
    EXTS.filter((o) => o.consumes?.some((c) => e.provides?.includes(c.id))).forEach((o) => {
      const oo = posOf(o, mode);
      o.consumes!.filter((c) => e.provides?.includes(c.id)).forEach((c, i) => {
        const pin = inAnchor(oo);
        const dot = { x: pin.x - 16, y: pin.y };
        layers.push(
          <Wire
            key={`${o.id}-${c.id}-${i}`}
            d={hPath(outAnchor(posOf(e, mode), "cap"), dot) + ` L${pin.x} ${pin.y}`}
            type="cap"
            look={selected !== null ? "lit" : "hover"}
            dashed={c.need === "optional"}
          />,
        );
        layers.push(<Reroute key={`${o.id}-${c.id}-r${i}`} x={dot.x} y={dot.y} type="cap" />);
      });
    });
  }
  if (failure) {
    if (focus !== "acme-notes") drawFor("acme-notes", "fail");
  }
  if (thread) {
    // 실시간 임대: 보유 drive 선(흐름) + 대기 그룹의 drive 선(점선)
    if (focus !== lease.holder) {
      const h = posOf(extById(lease.holder), mode);
      layers.push(
        <Wire key="hold" d={hPath(outAnchor(h, "drive"), leaseAnchor)} type="drive" look="live" />,
      );
    }
    const q = posOf(extById("plan-first"), mode);
    layers.push(
      <Wire
        key="queue"
        d={hPath(outAnchor(q, "drive"), leaseAnchor)}
        type="drive"
        look="ghost"
        width={1.5}
      />,
    );
  }

  const pillState = (e: Ext, t: PortType): PillState => {
    if (thread && !THREAD_MEMBERS.has(e.id) && !THREAD_PENDING.has(e.id)) return "muted";
    if (e.health === "off") return "off";
    if (focus === null) return "idle";
    if (focus === e.id) return "lit";
    if (rel.has(e.id) && extById(focus).col === "B" && t === "cap") return "lit";
    if (rel.has(e.id) && extById(focus).col === "A" && t === "cap") return "lit";
    return "idle";
  };

  const dimmed = (id: string) => {
    if (thread) return !THREAD_MEMBERS.has(id) && !THREAD_PENDING.has(id);
    if (focus === null) return false;
    return !rel.has(id);
  };

  return (
    <div className="relative" style={{ transform: `translateY(${shift}px)` }}>
      {/* lane 바탕: 면 단계만, 선 없음 */}
      {(["A", "B", "C"] as const).map((k) => {
        const c = COL[k];
        const n =
          k === "C"
            ? SOCKETS.length
            : EXTS.filter(
                (e) =>
                  e.col === k &&
                  e.layer !== "plugin" &&
                  e.dockTo === undefined &&
                  (visible === undefined || visible.has(e.id)),
              ).length;
        return (
          <div
            key={k}
            className="absolute rounded-2xl"
            style={{
              left: c.x - 12,
              top: 0,
              width: c.w + 24,
              height: 600,
              background: "var(--lane-fill)",
            }}
          >
            {
              <div className="flex h-8 items-center gap-1.5 px-3">
                <span className="font-mono text-[10.5px] font-medium text-text-tertiary">
                  {c.tag}
                </span>
                <span className="text-ui-sm text-text-secondary">{c.title}</span>
                <span className="ms-auto font-mono text-[10.5px] text-text-tertiary tabular-nums">
                  {k === "C" ? `${n}/46` : n}
                </span>
              </div>
            }
          </div>
        );
      })}
      {/* 외부 plugin 하위 lane 이름 */}
      {visible === undefined && (
        <div
          className="absolute flex items-center gap-1.5"
          style={{ left: COL.B.x, top: thread ? 420 : 430, width: COL.B.w }}
        >
          <span className="font-mono text-[10.5px] font-medium text-text-tertiary">
            {thread ? "" : "plugin"}
          </span>
          <span className="text-ui-xs text-text-tertiary">
            {thread ? "이 대화 밖 · 2" : "외부 확장 · 2"}
          </span>
          <span className="h-px flex-1 bg-[var(--block-edge)]" />
        </div>
      )}

      {thread && <ThreadFrame />}

      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={734}
        height={600}
        aria-hidden
      >
        {layers}
      </svg>

      {EXTS.filter((x) => visible === undefined || visible.has(x.id)).map((raw) => {
        const e = posOf(raw, mode);
        return (
          <Block
            key={e.id}
            e={e}
            selected={selected === e.id}
            dim={dimmed(e.id)}
            failure={failure}
            thread={thread}
            pill={(t) => pillState(e, t)}
            onSelect={() => onSelect(selected === e.id ? null : e.id)}
            onHover={(h) => onHover(h ? e.id : null)}
            onOpen={() => onOpenGroup(e.id)}
          />
        );
      })}

      <SocketColumn
        rel={focus !== null ? rel : null}
        failure={failure}
        focus={focus}
        thread={thread}
        visible={visible}
      />
      {children}
    </div>
  );
}

function ThreadFrame() {
  const L = -14;
  const R = COL.C.x + COL.C.w + 14;
  const T = -20;
  const B = 604;
  const nl = COL.B.x - 12;
  const nr = COL.B.x + COL.B.w + 12;
  const nt = 410;
  const r = 14;
  const d = [
    `M${L + r} ${T}`,
    `H${R - r} Q${R} ${T} ${R} ${T + r}`,
    `V${B - r} Q${R} ${B} ${R - r} ${B}`,
    `H${nr + r} Q${nr} ${B} ${nr} ${B - r}`,
    `V${nt + r} Q${nr} ${nt} ${nr - r} ${nt}`,
    `H${nl + r} Q${nl} ${nt} ${nl} ${nt + r}`,
    `V${B - r} Q${nl} ${B} ${nl - r} ${B}`,
    `H${L + r} Q${L} ${B} ${L} ${B - r}`,
    `V${T + r} Q${L} ${T} ${L + r} ${T}`,
    "Z",
  ].join(" ");
  return (
    <>
      <svg
        className="pointer-events-none absolute top-0 left-0 overflow-visible"
        width={734}
        height={600}
        aria-hidden
      >
        <path
          d={d}
          fill="color-mix(in oklab, var(--port-on) 5%, transparent)"
          stroke="var(--port-on)"
          strokeOpacity={0.55}
          strokeWidth={1.25}
        />
      </svg>
      <div
        className="absolute flex h-6 items-center gap-2 rounded-md bg-surface-base px-2 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--port-on)_45%,transparent)]"
        style={{ left: L + 12, top: T - 12 }}
      >
        <span className="text-ui-xs text-text-tertiary">대화</span>
        <span className="text-ui-sm text-text-primary">캐시 무효화 조사</span>
        <span className="text-ui-xs text-text-tertiary tabular-nums">
          멤버 8 · 다음 경계 +1 · 턴 7
        </span>
        <span className="flex items-center gap-1 text-ui-xs text-text-secondary">
          <span
            className="size-1.5 rounded-full bg-success-solid v2b-pulse"
            style={{ ["--ring" as string]: "var(--cs-color-success-solid)" }}
          />
          실시간
        </span>
      </div>
    </>
  );
}

function Block({
  e,
  selected,
  dim,
  failure,
  thread,
  pill,
  onSelect,
  onHover,
  onOpen,
}: {
  e: Ext;
  selected: boolean;
  dim: boolean;
  failure: boolean;
  thread: boolean;
  pill: (t: PortType) => PillState;
  onSelect: () => void;
  onHover: (h: boolean) => void;
  onOpen: () => void;
}) {
  const b = blockBox(e);
  const off = e.health === "off";
  const docked = e.dockTo !== undefined;
  const hasDock = e.id === "web";
  const pending = thread && THREAD_PENDING.has(e.id);
  const holder = thread && e.id === lease.holder;
  const tone = e.health === "danger" ? "var(--cs-color-danger-solid)" : undefined;
  const style = cardStyle({ selected, off: off || pending, tone });
  const radius = docked ? "0 0 10px 10px" : hasDock ? "10px 10px 0 0" : "10px";

  const sub: ReactNode =
    e.health === "danger" ? (
      <span className="text-danger-text">자동 꺼짐 · 연속 {e.failures}번</span>
    ) : e.health === "warn" ? (
      <span>실패 {e.failures} · 예외 → 거부</span>
    ) : off ? (
      <span>꺼짐 · models.oauth 없음</span>
    ) : pending ? (
      <span>다음 단계 경계에 켜져요</span>
    ) : holder ? (
      <span className="flex items-center gap-1 text-text-primary">
        <PortGlyph type="drive" size={7} />
        drive 보유 · 턴 {lease.turns[0]}/{lease.turns[1]}
      </span>
    ) : thread && e.id === "plan-first" ? (
      <span>drive 대기 1번째</span>
    ) : (
      <span>
        {e.trust} · {e.version}
      </span>
    );

  return (
    <div
      data-block
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${e.label} ${e.id} · ${e.layer} ${e.kind} · ${e.health === "danger" ? "자동 꺼짐" : e.health === "warn" ? `실패 ${e.failures}` : e.health === "off" ? "꺼짐" : "켜짐"}`}
      onClick={onSelect}
      onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && (k.preventDefault(), onSelect())}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className="absolute cursor-default outline-none transition-opacity duration-200 focus-visible:shadow-focus"
      style={{
        left: b.x,
        top: b.y,
        width: b.w,
        height: b.h,
        opacity: dim ? 0.38 : 1,
        borderRadius: radius,
        zIndex: selected ? 3 : 1,
      }}
    >
      {/* 부품을 선언한 그룹: 뒤에 쌓인 두 장(스택)으로 "열 수 있음"을 보인다 */}
      {e.kind === "group" && (e.parts ?? 0) > 0 && !off && (
        <>
          <span
            aria-hidden
            className="absolute inset-x-3 -bottom-1.5 h-3 rounded-b-[10px] bg-surface-base shadow-[inset_0_0_0_1px_var(--block-edge)]"
            style={{ opacity: 0.9 }}
          />
          <span
            aria-hidden
            className="absolute inset-x-1.5 -bottom-[3px] h-3 rounded-b-[10px] bg-surface-base shadow-[inset_0_0_0_1px_var(--block-edge)]"
          />
        </>
      )}
      <div
        className="absolute inset-0"
        style={{ ...style, borderRadius: radius, borderStyle: pending ? "dashed" : undefined }}
      >
        {pending && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-[10px] outline-1 -outline-offset-1 outline-dashed outline-border-strong"
          />
        )}
        {docked ? (
          <div className="flex h-full items-center gap-2 border-t border-dashed border-[var(--block-edge)] px-2.5">
            <span className="text-[10px] text-text-tertiary">└</span>
            <span className="truncate text-ui-xs text-text-primary">{e.label}</span>
            <span className="truncate text-[10.5px] text-text-tertiary">
              web.search 제공자 · {e.trust}
            </span>
          </div>
        ) : (
          <div className="flex h-full flex-col px-2.5 pt-2 pb-2">
            <div className="flex min-w-0 items-center gap-2">
              <Face health={e.health}>
                <ExtIcon name={e.icon} />
              </Face>
              <span
                className={`min-w-0 truncate text-[13.5px] leading-4 font-semibold ${off ? "text-text-tertiary" : "text-text-primary"}`}
              >
                {e.label}
              </span>
              <span className="ms-auto flex-none truncate font-mono text-[10px] text-text-tertiary">
                {e.col === "A" ? (e.id === "core" ? "L1·L0" : e.id) : e.layer}
              </span>
            </div>
            <div
              className={`mt-1 min-w-0 truncate ps-[30px] text-[11.5px] leading-4 ${e.col === "A" ? "pe-10" : "pe-7"} text-text-tertiary`}
            >
              {e.col === "A"
                ? e.id === "core"
                  ? "부품 9 · agents, tools"
                  : e.provides?.map((c) => c.split(".")[1]).join(" · ")
                : sub}
            </div>
            {e.col === "B" && e.h > 70 && (
              <div className="mt-auto flex items-center gap-2 ps-[30px] pe-7 text-[10.5px] text-text-tertiary tabular-nums">
                {e.spark && (
                  <Spark
                    data={e.spark}
                    w={36}
                    h={12}
                    tone={
                      e.health === "danger"
                        ? "var(--cs-color-danger-solid)"
                        : "var(--cs-color-text-tertiary)"
                    }
                  />
                )}
                {e.parts === null ? (
                  <span className="truncate">구성 정보 없음</span>
                ) : (
                  <button
                    type="button"
                    data-block
                    onClick={(ev) => {
                      ev.stopPropagation();
                      onOpen();
                    }}
                    className="-mx-1 flex items-center gap-0.5 rounded px-1 hover:bg-fill-hover hover:text-text-primary focus-visible:shadow-focus focus-visible:outline-none"
                    aria-label={`${e.label} 열기 · 부품 ${e.parts}`}
                  >
                    부품 {e.parts}
                    <ChevronRight className="size-3" />
                  </button>
                )}
                {failure && e.id === "review" ? null : (e.failures ?? 0) > 0 &&
                  e.health === "ok" ? (
                  <span>실패 {e.failures}</span>
                ) : null}
              </div>
            )}
            {e.id === "core" && <div className="hidden" />}
          </div>
        )}
      </div>
      {/* 포트: 입력(왼쪽) · 출력(오른쪽), 가장자리에 걸친 알약 */}
      {e.col === "A" && e.provides && (
        <Pill
          side="r"
          dy={portDy(e, "cap")}
          type="cap"
          label={`능력 ${e.provides.length}`}
          state={pill("cap")}
          stub
        />
      )}
      {e.col === "B" && e.consumes && (
        <Pill
          side="l"
          dy={portDy(e, "cap")}
          type="cap"
          label={`능력 ${e.consumes.length}`}
          hollow={e.consumes.every((c) => c.need === "optional")}
          state={pill("cap")}
          stub
        />
      )}
      {e.col === "B" && (e.points?.length ?? 0) > 0 && (
        <Pill
          side="r"
          dy={portDy(e, "on")}
          type="on"
          label={`on ${e.points!.length}`}
          state={pill("on")}
          stub
        />
      )}
      {e.col === "B" && e.usesPost && (
        <Pill side="r" dy={portDy(e, "post")} type="post" label="post" state={pill("post")} stub />
      )}
      {e.col === "B" && e.usesDrive && (
        <Pill
          side="r"
          dy={portDy(e, "drive")}
          type="drive"
          label="drive"
          state={holder ? "lit" : pill("drive")}
          stub
        />
      )}
    </div>
  );
}

function SocketColumn({
  rel,
  failure,
  focus,
  thread,
  visible,
}: {
  rel: Set<string> | null;
  failure: boolean;
  focus: string | null;
  thread: boolean;
  visible?: Set<string>;
}) {
  const x = COL.C.x;
  const w = COL.C.w;
  const handlers = (p: string) =>
    EXTS.filter((e) => e.points?.includes(p) && (visible === undefined || visible.has(e.id)));
  const lit = (id: string) => rel === null || rel.has(id);
  const failOf = (p: string) =>
    failure && p === "boundary.settle.after"
      ? "리뷰 5"
      : failure && p === "tool.call.before"
        ? "acme 2"
        : null;
  return (
    <>
      {/* 루프 방향: 한 턴 안에서 위 → 아래, 끝나면 다음 턴으로 */}
      <svg
        className="pointer-events-none absolute overflow-visible"
        style={{ left: x + w + 2, top: 58 }}
        width={10}
        height={300}
        aria-hidden
      >
        <path
          d="M5 0 V292"
          stroke="var(--cs-color-border-strong)"
          strokeWidth={1}
          strokeDasharray="2 3"
        />
        <path
          d="M2 286 L5 292 L8 286"
          fill="none"
          stroke="var(--cs-color-border-strong)"
          strokeWidth={1}
        />
      </svg>
      {FAMILIES.map((f) => (
        <div
          key={f.id}
          className="absolute font-mono text-[10px] text-text-tertiary"
          style={{ left: x + 4, top: f.y, height: 16, lineHeight: "16px" }}
        >
          {f.label}.
        </div>
      ))}
      {SOCKETS.map((s) => {
        const hs = handlers(s.point);
        const on = lit(s.point);
        const fl = failOf(s.point);
        return (
          <div
            key={s.point}
            className="absolute flex items-center gap-1.5 rounded-lg ps-3.5 pe-2 transition-opacity duration-200"
            style={{
              left: x,
              top: s.y,
              width: w,
              height: SOCKET_H,
              opacity: on ? 1 : 0.38,
              ...(fl !== null
                ? {
                    background: "var(--cs-color-danger-tint)",
                    boxShadow: "inset 0 0 0 1px var(--cs-color-danger-border)",
                  }
                : cardStyle({})),
            }}
            aria-label={`${s.point} · ${s.fold} · 핸들러 ${hs.length}`}
          >
            <span className="absolute top-1/2 -left-[5px] -translate-y-1/2 rounded-[3px] bg-surface-base p-[1px]">
              <PortGlyph type="on" size={9} hollow={!(rel !== null && on && focus !== null)} />
            </span>
            <FoldGlyph fold={s.fold} />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-text-primary">
              {s.short}
            </span>
            {fl !== null ? (
              <span className="text-[10.5px] text-danger-text">{fl}</span>
            ) : (
              <span
                className="flex items-center gap-[3px]"
                title={hs.map((h) => h.label).join(", ")}
              >
                {hs.map((h) => (
                  <span
                    key={h.id}
                    className="size-1.5 rounded-full"
                    style={{
                      background:
                        h.health === "danger"
                          ? "var(--cs-color-danger-solid)"
                          : h.health === "warn"
                            ? "var(--cs-color-warning-solid)"
                            : focus === h.id
                              ? "var(--port-on)"
                              : "var(--cs-color-border-strong)",
                    }}
                  />
                ))}
                <span className="ms-1 font-mono text-[10px] text-text-tertiary tabular-nums">
                  {hs.length}
                </span>
              </span>
            )}
          </div>
        );
      })}
      <div
        className="absolute flex items-center gap-1.5 rounded-lg px-3 text-[11px] text-text-tertiary outline-1 -outline-offset-1 outline-dashed outline-border-default"
        style={{ left: x, top: 366, width: w, height: 26 }}
      >
        비어 있는 지점 39
        <span className="ms-auto font-mono text-[10px]">46</span>
      </div>

      {/* post 큐 */}
      <div
        className="absolute flex flex-col justify-center gap-0.5 rounded-[10px] ps-3.5 pe-2.5"
        style={{
          left: x,
          top: POST_Q.y,
          width: w,
          height: POST_Q.h,
          opacity: lit("post") ? 1 : 0.38,
          ...cardStyle({}),
        }}
      >
        <span
          className="absolute -left-[5px] -translate-y-1/2 rounded-sm bg-surface-base p-[1px]"
          style={{ top: 29 }}
        >
          <PortGlyph type="post" size={9} />
        </span>
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-primary">
          <ArrowRight className="size-3.5 text-text-tertiary" emphasis="muted" />
          post 큐
        </span>
        <span className="text-[10.5px] text-text-tertiary">
          다음 턴 입력 · steer · followUp{thread ? " · 대기 1" : ""}
        </span>
      </div>

      {/* drive 임대 */}
      <div
        className="absolute flex flex-col gap-1 rounded-[10px] ps-3.5 pe-2.5 pt-2"
        style={{
          left: x,
          top: LEASE.y,
          width: w,
          height: LEASE.h,
          opacity: lit("lease") || thread ? 1 : 0.38,
          ...cardStyle({ selected: thread, tone: "var(--port-drive)" }),
        }}
      >
        <span
          className="absolute -left-[6px] -translate-y-1/2 rounded-sm bg-surface-base p-[1px]"
          style={{ top: 30 }}
        >
          <PortGlyph type="drive" size={10} hollow={!thread && focus === null} />
        </span>
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-text-primary">
          <Play className="size-3.5 text-text-tertiary" emphasis="muted" />
          drive 임대
          <span className="ms-auto font-mono text-[10px] font-normal text-text-tertiary">
            {thread ? `차수 ${lease.epoch}` : "대화마다 1"}
          </span>
        </span>
        {thread ? (
          <>
            <span className="text-[11px] text-text-secondary">
              보유 <b className="font-semibold text-text-primary">Helm</b> · 대기 계획 먼저
            </span>
            <Meter label="턴" v={lease.turns[0]} max={lease.turns[1]} />
            <Meter label="spawn" v={lease.spawns[0]} max={lease.spawns[1]} />
            <Meter label="토큰" v={lease.tokens[0]} max={lease.tokens[1]} unit="k" />
          </>
        ) : (
          <>
            <span className="text-[11px] text-text-secondary">
              {visible !== undefined ? "보유 없음" : "보유 중인 대화 2"}
            </span>
            <span className="text-[10.5px] text-text-tertiary">
              {visible !== undefined ? "drive 그룹이 아직 없어요" : "후보 2 · 리뷰는 자동 꺼짐"}
            </span>
            <span className="mt-auto mb-2 flex items-center gap-1 text-[10.5px] text-text-tertiary">
              <RotateCcw className="size-3" emphasis="muted" />
              단계 경계에서만 넘겨요
            </span>
          </>
        )}
      </div>
    </>
  );
}

function Meter({
  label,
  v,
  max,
  unit = "",
}: {
  label: string;
  v: number;
  max: number;
  unit?: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary tabular-nums">
      <span className="w-8">{label}</span>
      <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-neutral-track">
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-text-primary"
          style={{ width: `${(v / max) * 100}%` }}
        />
      </span>
      <span className="w-14 text-end font-mono">
        {v}
        {unit}/{max}
        {unit}
      </span>
    </span>
  );
}
