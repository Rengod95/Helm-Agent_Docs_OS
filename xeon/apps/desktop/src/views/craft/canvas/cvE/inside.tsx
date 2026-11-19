// cvE 플러그인 내부. 프로필 판에서 노드를 열면(두 번 누르기·Enter) 그 플러그인의 구성 요소 판으로 들어온다.
// 위 경로(프로필 › 플러그인)나 Esc로 돌아간다. 핸드오프 대상의 빈 고리를 누르면 그 플러그인 안으로 옮겨 간다.
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { cn, IconButton } from "@caustic/react";
import { ChevronLeft, Maximize, ZoomIn, ZoomOut } from "@caustic/react/icons";
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { HEADER_CONTROL_SIZE, ScreenHeader } from "../../../shell/screen-header.tsx";
import { Backdrop } from "./backdrop.tsx";
import { cveVars, useDark } from "./canvas.tsx";
import { DecisionGlyph, KindGlyph, PartGlyph } from "./glyphs.tsx";
import {
  insideLayout,
  MINI_RING,
  OWN_CORE,
  OWN_RING,
  ENTRY_DEG,
  PART_SIZE,
  type InsideBoard,
  type PlacedPart,
  type PlacedStage,
} from "./inside-layout.ts";
import { POINT_ANGLE, STATION_ANGLE, polar, type Pt } from "./layout.ts";
import {
  STATIONS,
  type Defs,
  type Part,
  type PluginDef,
  type ProfileModel,
  type Slot,
  type StationId,
} from "./model.ts";
import { KIND_COLOR } from "./nodes.tsx";
import { defsWithReal, modelOfReal, useRealProfiles } from "./real.ts";
import { SAMPLE_DEFS } from "./sample.ts";
import { useCanvasState } from "./state.ts";
import {
  DECISION_TEXT,
  KIND_TEXT,
  nameText,
  PART_KIND_TEXT,
  partName,
  pointText,
  slotText,
  STATION_TEXT,
} from "./text.ts";
import { useViewport, type View } from "./viewport.ts";

export interface PluginInsideProps {
  readonly picker: ReactNode;
  readonly pluginId: string;
  readonly onBack: () => void;
}

const f = (v: number): string => v.toFixed(1);

function useInsideSource(): { readonly profile: ProfileModel | null; readonly defs: Defs } {
  const state = useCanvasState();
  const real = useRealProfiles();
  return useMemo(() => {
    const sample = state.samples[state.profileId];
    if (sample !== undefined) return { profile: sample, defs: SAMPLE_DEFS };
    const found = real.find((p) => `real:${p.id}` === state.profileId);
    if (found === undefined) return { profile: null, defs: SAMPLE_DEFS };
    const profile = modelOfReal(found);
    return { profile, defs: defsWithReal(SAMPLE_DEFS, profile) };
  }, [state.samples, state.profileId, real]);
}

export function PluginInside(props: PluginInsideProps): ReactNode {
  const [trail, setTrail] = useState<readonly string[]>([props.pluginId]);
  const id = trail[trail.length - 1] ?? props.pluginId;
  const { profile, defs } = useInsideSource();
  const def = defs[id];
  const dark = useDark();
  const back = (): void => {
    if (trail.length > 1) setTrail(trail.slice(0, -1));
    else props.onBack();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (
        e.target instanceof HTMLElement &&
        e.target.closest("[role=listbox],[role=dialog]") !== null
      )
        return;
      e.preventDefault();
      if (trail.length > 1) setTrail(trail.slice(0, -1));
      else props.onBack();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [trail, props]);
  const profileName =
    profile === null ? "" : profile.sample ? nameText(profile.title) : profile.title;
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      style={cveVars(dark)}
      data-cve-root=""
      data-cve-inside={id}
    >
      <ScreenHeader
        flush
        lead={
          <IconButton
            size={HEADER_CONTROL_SIZE}
            variant="ghost"
            label={t("desktop.craft.canvas.cvE.back")}
            onClick={back}
          >
            <ChevronLeft />
          </IconButton>
        }
        title={
          <nav
            aria-label={t("desktop.craft.canvas.cvE.trail")}
            className="flex min-w-0 items-center gap-1.5"
          >
            <button
              type="button"
              onClick={props.onBack}
              className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-medium text-text-tertiary outline-none hover:text-text-secondary focus-visible:focus-ring"
            >
              {profileName === "" ? t("desktop.craft.canvas.cvE.title") : profileName}
            </button>
            {trail.map((step, i) => (
              <span key={`${step}-${String(i)}`} className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden className="text-text-tertiary">
                  ›
                </span>
                {i === trail.length - 1 ? (
                  <h1
                    aria-current="page"
                    className="m-0 truncate font-mono text-mono-md font-normal text-text-primary"
                  >
                    {step}
                  </h1>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setTrail(trail.slice(0, i + 1));
                    }}
                    className="cursor-pointer rounded-sm border-0 bg-transparent p-0 font-mono text-mono-md text-text-tertiary outline-none hover:text-text-secondary focus-visible:focus-ring"
                  >
                    {step}
                  </button>
                )}
              </span>
            ))}
            {def === undefined ? null : (
              <span className="ms-1 flex items-center gap-1 text-caption text-text-tertiary">
                <span style={{ color: KIND_COLOR[def.kind] }}>
                  <KindGlyph kind={def.kind} size={12} />
                </span>
                {t(KIND_TEXT[def.kind])}
              </span>
            )}
          </nav>
        }
        controls={props.picker}
      />
      {def === undefined ? null : (
        <InsideStage
          key={id}
          def={def}
          profile={profile}
          defs={defs}
          dark={dark}
          onOpen={(next) => {
            setTrail([...trail, next]);
          }}
        />
      )}
    </div>
  );
}

function InsideStage(props: {
  readonly def: PluginDef;
  readonly profile: ProfileModel | null;
  readonly defs: Defs;
  readonly dark: boolean;
  readonly onOpen: (id: string) => void;
}): ReactNode {
  const { def, profile, defs } = props;
  const board = useMemo(() => insideLayout(def), [def]);
  const el = useRef<HTMLDivElement>(null);
  const vp = useViewport(el, board.bounds, 1.1, def.id);
  const pan = useRef<{ x: number; y: number; view: View } | null>(null);
  useEffect(() => {
    const node = el.current;
    if (node === null) return undefined;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const r = node.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        vp.zoomBy(Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
        return;
      }
      vp.touch();
      vp.setView({ ...vp.view, x: vp.view.x - e.deltaX, y: vp.view.y - e.deltaY });
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onWheel);
    };
  }, [vp]);
  const start = profile?.startDrive === def.id;
  const fromDrives = Object.values(defs).filter(
    (d) =>
      d.handoff?.includes(def.id) === true &&
      (profile === null || profile.entries.some((e) => e.id === d.id)),
  );
  const color = KIND_COLOR[def.kind];
  return (
    <div
      ref={el}
      role="group"
      aria-label={t("desktop.craft.canvas.cvE.insideAria", { name: def.id })}
      className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden select-none"
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0 || e.target !== e.currentTarget) return;
        pan.current = { x: e.clientX, y: e.clientY, view: vp.view };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const p = pan.current;
        if (p === null) return;
        vp.touch();
        vp.setView({ ...p.view, x: p.view.x + e.clientX - p.x, y: p.view.y + e.clientY - p.y });
      }}
      onPointerUp={() => {
        pan.current = null;
      }}
    >
      <Backdrop view={vp.view} dark={props.dark} />
      <div
        className="pointer-events-none absolute top-0 left-0 origin-top-left [&_button]:pointer-events-auto"
        style={{
          transform: `translate(${String(vp.view.x)}px, ${String(vp.view.y)}px) scale(${String(vp.view.k)})`,
        }}
      >
        <svg
          aria-hidden
          className="pointer-events-none absolute overflow-visible"
          width={1}
          height={1}
        >
          {board.mode === "drive" ? (
            <OwnLoop
              board={board}
              color={color}
              entry={start ? "start" : fromDrives.length > 0 ? "handoff" : null}
            />
          ) : (
            <MiniCore slot={board.slot} color={color} r={MINI_RING} dim={false} />
          )}
          {board.parts.map((p) =>
            p.to === undefined ? null : (
              <g key={p.key}>
                <path
                  d={`M${f(p.c.x)} ${f(p.c.y)} L${f(p.to.x)} ${f(p.to.y)}`}
                  stroke="var(--cve-wire)"
                  strokeWidth={1.15}
                />
                <circle cx={p.to.x} cy={p.to.y} r={2.4} fill="var(--cve-wire)" />
              </g>
            ),
          )}
          {board.exits.map((x) => {
            const ctrl = { x: (x.from.x + x.c.x) / 2 + 60, y: (x.from.y + x.c.y) / 2 - 10 };
            const len = Math.hypot(x.c.x - ctrl.x, x.c.y - ctrl.y) || 1;
            const tip = {
              x: x.c.x - ((x.c.x - ctrl.x) / len) * 44,
              y: x.c.y - ((x.c.y - ctrl.y) / len) * 44,
            };
            const deg = (Math.atan2(tip.y - ctrl.y, tip.x - ctrl.x) * 180) / Math.PI;
            return (
              <g key={x.to}>
                <path
                  d={`M${f(x.from.x)} ${f(x.from.y)} Q${f(ctrl.x)} ${f(ctrl.y)} ${f(tip.x)} ${f(tip.y)}`}
                  fill="none"
                  stroke="var(--cve-handoff)"
                  strokeWidth={1.4}
                  strokeDasharray="6 5"
                  strokeLinecap="round"
                />
                <path
                  d="M-9 -5 L1 0 L-9 5 Z"
                  fill="var(--cve-handoff)"
                  transform={`translate(${f(tip.x)} ${f(tip.y)}) rotate(${f(deg)})`}
                />
              </g>
            );
          })}
        </svg>
        {board.mode === "attach" ? <AttachLabel slot={board.slot} anchor={board.anchor} /> : null}
        {board.stages.map((s) => (
          <StageCard key={s.key} stage={s} />
        ))}
        {board.parts.map((p) => (
          <PartTile key={p.key} placed={p} color={color} />
        ))}
        {board.exits.map((x) => (
          <GhostDrive
            key={x.to}
            id={x.to}
            c={x.c}
            label={t("desktop.craft.canvas.cvE.handoff")}
            onOpen={props.onOpen}
            known={defs[x.to] !== undefined}
          />
        ))}
        {board.mode === "drive" && start ? (
          <Entry text={t("desktop.craft.canvas.cvE.firstMessage")} />
        ) : null}
        {board.mode === "drive" && !start && fromDrives[0] !== undefined ? (
          <>
            <Entry text={t("desktop.craft.canvas.cvE.handoff")} />
            <GhostDrive
              id={fromDrives[0].id}
              c={polar(OWN_RING + 290, ENTRY_DEG)}
              label=""
              onOpen={props.onOpen}
              known
            />
          </>
        ) : null}
        {board.mode === "drive" ? (
          <span
            aria-hidden
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-caption text-text-tertiary"
            style={{ left: 0, top: OWN_CORE + 16 }}
          >
            {t("desktop.craft.canvas.cvE.coreLoop")}
          </span>
        ) : null}
      </div>
      <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-toolbar border border-[var(--cve-line)] bg-surface-raised p-1 shadow-2">
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvE.zoomOut")}
          onClick={() => {
            vp.zoomBy(1 / 1.2);
          }}
        >
          <ZoomOut />
        </IconButton>
        <span className="w-11 text-center font-mono text-mono-sm text-text-tertiary">
          {Math.round(vp.view.k * 100)}%
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvE.zoomIn")}
          onClick={() => {
            vp.zoomBy(1.2);
          }}
        >
          <ZoomIn />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label={t("desktop.craft.canvas.cvE.fit")}
          onClick={vp.fit}
        >
          <Maximize />
        </IconButton>
      </div>
      {def.draft === true ? (
        <p className="absolute top-3 left-1/2 z-10 m-0 -translate-x-1/2 rounded-lg border border-[var(--cs-color-warning-border)] bg-surface-raised px-3 py-1.5 text-footnote text-text-primary shadow-2">
          {t("desktop.craft.canvas.cvE.draftNotice")}
        </p>
      ) : null}
    </div>
  );
}

/** 작은 코어 고리: 정거장 여섯과 흐름. 플러그인이 붙는 자리 하나만 밝다 */
function MiniCore(props: {
  readonly slot: Slot | null;
  readonly color: string;
  readonly r: number;
  readonly dim: boolean;
}): ReactNode {
  const { r } = props;
  const lit = props.slot === null || props.slot === "drive" ? null : slotPointDeg(props.slot);
  return (
    <g opacity={props.dim ? 0.5 : 1}>
      <circle r={r + 2} fill="none" stroke="var(--cve-ring)" strokeWidth={1} />
      <circle r={r - 2} fill="none" stroke="var(--cve-ring)" strokeOpacity={0.5} strokeWidth={1} />
      <circle r={r - 4} fill="var(--cve-core-fill)" />
      {STATIONS.map((s) => {
        const p = polar(r, STATION_ANGLE[s]);
        return (
          <g key={s}>
            <circle
              cx={p.x}
              cy={p.y}
              r={props.dim ? 2.5 : 5}
              fill="var(--cs-color-bg-canvas)"
              stroke="var(--cs-color-text-secondary)"
              strokeWidth={1.3}
            />
            {props.dim ? null : (
              <circle cx={p.x} cy={p.y} r={1.6} fill="var(--cs-color-text-primary)" />
            )}
          </g>
        );
      })}
      {lit === null ? null : (
        <g>
          <circle {...pt(polar(r, lit))} r={11} fill={props.color} opacity={0.18} />
          <circle {...pt(polar(r, lit))} r={4.5} fill={props.color} />
        </g>
      )}
    </g>
  );
}

function pt(p: Pt): { cx: number; cy: number } {
  return { cx: p.x, cy: p.y };
}

function slotPointDeg(slot: Slot): number {
  if (slot === "inside") return STATION_ANGLE.context;
  if (slot === "socket") return STATION_ANGLE.tools;
  if (slot === "drive") return 0;
  return POINT_ANGLE[slot];
}

function stationOfSlot(slot: Slot): StationId | null {
  switch (slot) {
    case "inside":
    case "input":
      return "context";
    case "model.before":
      return "model";
    case "tools.before":
    case "socket":
    case "tools.after":
      return "tools";
    case "ask.before":
      return "ask";
    case "agents.before":
      return "agents";
    case "turnEnd":
      return "record";
    case "drive":
      return null;
    default:
      return assertNever(slot, "cvE stationOfSlot");
  }
}

/** 밝힌 자리의 이름(정거장 안쪽): 블록 이름과 지점 */
function AttachLabel(props: { readonly slot: Slot; readonly anchor: Pt }): ReactNode {
  const station = stationOfSlot(props.slot);
  const len = Math.hypot(props.anchor.x, props.anchor.y) || 1;
  const inner = {
    x: (props.anchor.x / len) * (MINI_RING - 64),
    y: (props.anchor.y / len) * (MINI_RING - 64),
  };
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center whitespace-nowrap text-center"
      style={{ left: inner.x, top: inner.y }}
    >
      {station === null ? null : (
        <span className="text-caption text-text-tertiary">{t(STATION_TEXT[station])}</span>
      )}
      <span className="text-footnote text-text-primary">{slotText(props.slot)}</span>
    </span>
  );
}

/** Drive의 자기 루프: 단계가 정거장이고, 나란히 도는 단계에서 고리가 갈래로 나뉜다. 가운데에 쥐고 있는 코어 고리 */
function OwnLoop(props: {
  readonly board: InsideBoard;
  readonly color: string;
  readonly entry: "start" | "handoff" | null;
}): ReactNode {
  const { board, color } = props;
  const R = OWN_RING;
  const n = Math.max(1, board.stages.length);
  const step = 360 / n;
  const arrowDeg = -90 + step / 2;
  const arrow = polar(R, arrowDeg);
  // 첫 메시지는 곧은 실선, 받는 핸드오프는 대상 빈 고리에서 오는 점선
  const entryFrom = polar(props.entry === "handoff" ? R + 244 : R + 150, ENTRY_DEG);
  const entryTo = polar(R + 8, ENTRY_DEG);
  return (
    <g>
      <circle r={R + 10} fill="none" stroke="var(--cve-drive-glow)" strokeWidth={22} />
      <circle r={R} fill="var(--cve-drive-tint)" stroke={color} strokeWidth={1.6} />
      <path
        d="M-4 -3.5 L3 0 L-4 3.5"
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`translate(${f(arrow.x)} ${f(arrow.y)}) rotate(${f(arrowDeg + 90)})`}
      />
      {/* 쥐고 있는 코어 루프(작고 흐리게): 단계마다 이 루프가 돈다 */}
      <MiniCore slot={null} color={color} r={OWN_CORE} dim />
      {[0, 90, 180, 270].map((d) => {
        const a = polar(OWN_CORE + 6, d);
        const b = polar(R - 8, d);
        return (
          <path
            key={d}
            d={`M${f(a.x)} ${f(a.y)} L${f(b.x)} ${f(b.y)}`}
            stroke={color}
            strokeOpacity={0.22}
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        );
      })}
      {board.stages.map((s) => (
        <StageBead key={s.key} stage={s} step={step} color={color} />
      ))}
      {props.entry !== null ? (
        <g>
          <path
            d={`M${f(entryFrom.x)} ${f(entryFrom.y)} L${f(entryTo.x)} ${f(entryTo.y)}`}
            stroke="var(--cve-wire-lit)"
            strokeWidth={1.4}
            strokeDasharray={props.entry === "handoff" ? "6 5" : undefined}
          />
          <path
            d="M-9 -5 L1 0 L-9 5 Z"
            fill="var(--cve-wire-lit)"
            transform={`translate(${f(entryTo.x)} ${f(entryTo.y)}) rotate(${f(ENTRY_DEG + 180)})`}
          />
        </g>
      ) : null}
    </g>
  );
}

function StageBead(props: {
  readonly stage: PlacedStage;
  readonly step: number;
  readonly color: string;
}): ReactNode {
  const { stage, color } = props;
  const lanes = stage.stage.parallel ?? 1;
  const R = OWN_RING;
  if (lanes <= 1) {
    return (
      <g>
        <circle
          {...pt(stage.bead)}
          r={7}
          fill="var(--cs-color-bg-canvas)"
          stroke={color}
          strokeWidth={1.6}
        />
        <circle {...pt(stage.bead)} r={2.4} fill={color} />
      </g>
    );
  }
  // 갈래: 단계 앞뒤 구간에서 고리가 여러 줄로 갈라졌다 다시 모인다
  const half = props.step * 0.2;
  const a0 = stage.deg - half;
  const a1 = stage.deg + half;
  const offsets = Array.from({ length: lanes }, (_, i) => (i - (lanes - 1) / 2) * 17);
  return (
    <g>
      {offsets.map((o) => {
        if (o === 0) return null;
        const p0 = polar(R, a0);
        const c0 = polar(R + o * 0.15, a0 + 6);
        const q0 = polar(R + o, a0 + 10);
        const q1 = polar(R + o, a1 - 10);
        const c1 = polar(R + o * 0.15, a1 - 6);
        const p1 = polar(R, a1);
        return (
          <path
            key={o}
            d={`M${f(p0.x)} ${f(p0.y)} Q${f(c0.x)} ${f(c0.y)} ${f(q0.x)} ${f(q0.y)} A${f(R + o)} ${f(R + o)} 0 0 1 ${f(q1.x)} ${f(q1.y)} Q${f(c1.x)} ${f(c1.y)} ${f(p1.x)} ${f(p1.y)}`}
            fill="none"
            stroke={color}
            strokeWidth={1.3}
            strokeOpacity={0.85}
          />
        );
      })}
      {offsets.map((o) => {
        const p = polar(R + o, stage.deg);
        return (
          <g key={`b${String(o)}`}>
            <circle
              {...pt(p)}
              r={5.5}
              fill="var(--cs-color-bg-canvas)"
              stroke={color}
              strokeWidth={1.5}
            />
            <circle {...pt(p)} r={1.8} fill={color} />
          </g>
        );
      })}
    </g>
  );
}

/** 단계 이름표: 이름, 나란히 수, 단계마다 도는 코어 턴(작은 고리 표식) */
function StageCard(props: { readonly stage: PlacedStage }): ReactNode {
  const { stage } = props;
  const lanes = stage.stage.parallel ?? 1;
  return (
    <div
      role="img"
      aria-label={t("desktop.craft.canvas.cvE.stageAria", {
        name: nameText(stage.key),
        count: lanes,
      })}
      className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-[var(--cve-line)] bg-surface-raised py-1.5 ps-2 pe-3 shadow-1"
      style={{ left: stage.c.x, top: stage.c.y }}
    >
      <span className="flex items-center gap-0.5 text-text-tertiary">
        {Array.from({ length: lanes }, (_, i) => (
          <MiniTurn key={i} />
        ))}
      </span>
      <span className="text-ui text-text-primary">{nameText(stage.key)}</span>
      {lanes > 1 ? (
        <span className="font-mono text-mono-sm text-text-tertiary">×{lanes}</span>
      ) : null}
    </div>
  );
}

/** 코어 턴 하나(정거장 여섯이 있는 작은 고리) */
function MiniTurn(): ReactNode {
  return (
    <svg
      aria-hidden
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
    >
      <circle cx="7" cy="7" r="5" />
      {[0, 60, 120, 180, 240, 300].map((d) => {
        const p = polar(5, d - 90);
        return (
          <circle key={d} cx={7 + p.x} cy={7 + p.y} r={0.9} fill="currentColor" stroke="none" />
        );
      })}
    </svg>
  );
}

function RiskMeter(props: { readonly risk: number }): ReactNode {
  return (
    <span aria-hidden className="flex items-end gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            "w-1 rounded-full",
            i === 1 ? "h-1.5" : i === 2 ? "h-2.5" : "h-3.5",
            i <= props.risk
              ? props.risk >= 3
                ? "bg-[var(--cs-color-danger-graphic)]"
                : "bg-text-secondary"
              : "bg-[var(--cve-line)]",
          )}
        />
      ))}
    </span>
  );
}

/** 구성 요소 노드: 종류 표식과 종류 이름(작게), 이름. 핸들러는 지점과 결정, 권한은 위험 막대를 더한다 */
function PartTile(props: { readonly placed: PlacedPart; readonly color: string }): ReactNode {
  const { part, c } = props.placed;
  const handler = part.kind === "handler";
  const label = partAria(part);
  return (
    <div
      role="img"
      aria-label={label}
      data-cve-part={part.kind}
      className="absolute flex items-center gap-2.5 rounded-xl border border-[var(--cve-line)] bg-surface-raised ps-2.5 pe-3 shadow-1"
      style={{
        left: c.x - PART_SIZE.x / 2,
        top: c.y - PART_SIZE.y / 2,
        width: PART_SIZE.x,
        height: PART_SIZE.y,
      }}
    >
      <span
        aria-hidden
        className="flex size-8 flex-none items-center justify-center rounded-lg bg-[var(--cve-core-fill)] text-text-secondary"
        style={handler ? { color: props.color, background: "var(--cve-hook-tint)" } : undefined}
      >
        <PartGlyph kind={part.kind} size={16} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-caption text-text-tertiary">
          {handler && part.point !== undefined
            ? pointText(part.point)
            : t(PART_KIND_TEXT[part.kind])}
        </span>
        <span
          className={cn(
            "flex min-w-0 items-center gap-1.5 truncate",
            part.raw === undefined
              ? "text-ui text-text-primary"
              : "font-mono text-mono text-text-primary",
          )}
        >
          {handler && part.decision !== undefined ? (
            <DecisionGlyph
              decision={part.decision}
              size={12}
              className="flex-none text-text-secondary"
            />
          ) : null}
          <span className="truncate">
            {handler && part.decision !== undefined
              ? t(DECISION_TEXT[part.decision])
              : partName(part)}
          </span>
        </span>
      </span>
      {part.kind === "permission" ? <RiskMeter risk={part.risk ?? 0} /> : null}
      {part.count !== undefined && part.kind !== "permission" ? (
        <span className="font-mono text-mono-sm text-text-tertiary">{part.count}</span>
      ) : null}
    </div>
  );
}

function partAria(part: Part): string {
  const kind = t(PART_KIND_TEXT[part.kind]);
  if (part.kind === "handler" && part.point !== undefined && part.decision !== undefined) {
    return `${kind}, ${pointText(part.point)}, ${t(DECISION_TEXT[part.decision])}, ${partName(part)}`;
  }
  return part.count === undefined
    ? `${kind}, ${partName(part)}`
    : `${kind}, ${partName(part)}, ${String(part.count)}`;
}

/** 핸드오프 대상(빈 고리). 누르면 그 플러그인 안으로 */
function GhostDrive(props: {
  readonly id: string;
  readonly c: Pt;
  readonly label: string;
  readonly known: boolean;
  readonly onOpen: (id: string) => void;
}): ReactNode {
  const r = 42;
  return (
    <button
      type="button"
      aria-label={t("desktop.craft.canvas.cvE.openOther", { name: props.id })}
      disabled={!props.known}
      onClick={() => {
        props.onOpen(props.id);
      }}
      className="absolute flex cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full border-[1.5px] border-dashed border-[var(--cs-color-identity-mint)] bg-bg-canvas p-0 outline-none hover:bg-[var(--cve-drive-tint)] focus-visible:focus-ring"
      style={{ left: props.c.x - r, top: props.c.y - r, width: r * 2, height: r * 2 }}
    >
      <span className="max-w-[90%] truncate font-mono text-mono-sm text-text-primary">
        {props.id}
      </span>
      {props.label === "" ? null : (
        <span className="text-caption text-text-tertiary">{props.label}</span>
      )}
    </button>
  );
}

function Entry(props: { readonly text: string }): ReactNode {
  const at = polar(OWN_RING + 168, ENTRY_DEG);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-full whitespace-nowrap pb-1 text-footnote text-text-secondary"
      style={{ left: at.x, top: at.y }}
    >
      {props.text}
    </span>
  );
}
