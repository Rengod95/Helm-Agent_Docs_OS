// 플러그인 상세(구성과 흐름): 구역 둘. "무엇으로 되어 있나" = 가져다 쓰는 것(왼쪽) → 플러그인 판 안 블록 → 끼어드는 훅·내놓는 것(오른쪽),
// "어떻게 움직이나" = 단계 흐름. 흐름의 단계를 고르면 그 단계에서 움직이는 블록과 선만 진하고 나머지는 흐려진다.
// 색은 중립, 고른 것만 accent 고리. 그림은 고정 폭(900)이고 좁으면 가로로 스크롤한다. 두 구역 사이에는 1px 얇은 선을 긋는다.
import { Button, IconButton } from "@caustic/react";
import { useState } from "react";
import { ChevronLeft, WorkbenchHead } from "../../_shell";
import { PageSection } from "../../_shell/page";
import { T } from "../../_shell/terms";
import { layerName, pluginById, type LayerId } from "../data";
import { HELM_DETAIL, ROUTER_DETAIL, type Comp, type DetailSpec } from "../detail-data";
import { CARD, RING, STAGE, TILE, hCurve } from "../parts/kit";
import { useMock } from "../store";

const W = 900;
const TOP = 12;
const CW = 192;
const CH = 56;
const IN_W = 200;
const PLATE_X = 224;
const PLATE_W = 452;
const OUT_X = 700;
const ROW = 26;
const HEAD = 26;

const LINE = "var(--cs-color-border-default)";
const LINE_LIT = "var(--cs-color-text-secondary)";

interface Row {
  layer: LayerId;
  title?: string;
  id?: string;
  label?: string;
  sub?: string;
  to?: string[];
  from?: string[];
  missing?: boolean;
  y: number;
}

function rowsOf(groups: { layer: LayerId; title: string; rows: Omit<Row, "layer" | "y">[] }[]) {
  const rows: Row[] = [];
  let y = TOP;
  for (const g of groups) {
    rows.push({ layer: g.layer, title: g.title, y });
    y += HEAD;
    for (const r of g.rows) {
      rows.push({ layer: g.layer, ...r, y });
      y += ROW;
    }
    y += 12;
  }
  return { rows, bottom: y };
}
const ch = (c: Comp) => c.h ?? CH;

function CompCard({ c, lit }: { c: Comp; lit: boolean }) {
  return (
    <div
      className={`absolute grid content-center gap-0.5 px-3 transition-[opacity,box-shadow] duration-200 ${lit ? `rounded-xl bg-surface-raised ${RING}` : TILE}`}
      style={{
        left: c.x,
        top: TOP + c.y,
        width: CW,
        height: ch(c),
        opacity: lit ? 1 : 0.5,
      }}
    >
      <span className="truncate text-title-3 text-text-primary">{c.name}</span>
    </div>
  );
}

function SideRow({ r, x, w }: { r: Row; x: number; w: number }) {
  if (r.title !== undefined)
    return (
      <span
        className="absolute truncate text-ui-lg text-text-secondary"
        style={{ left: x, top: r.y, width: w }}
      >
        {r.title}
      </span>
    );
  return (
    <div
      className="absolute flex h-[22px] items-center gap-2"
      style={{ left: x, top: r.y, width: w }}
    >
      <span
        aria-hidden
        className="size-1.5 flex-none rounded-full"
        style={
          r.missing === true
            ? { boxShadow: "inset 0 0 0 1px var(--cs-color-text-tertiary)" }
            : { background: "var(--cs-color-text-tertiary)" }
        }
      />
      <span
        className={`min-w-0 truncate text-body ${r.missing === true ? "text-text-tertiary" : "text-text-primary"}`}
      >
        {r.label}
      </span>
      {r.sub !== undefined && (
        <span className="ms-auto flex-none truncate text-footnote text-text-tertiary">{r.sub}</span>
      )}
    </div>
  );
}

function Parts({ spec, phase }: { spec: DetailSpec; phase: string }) {
  const lit = new Set(spec.phases.find((p) => p.id === phase)?.comps ?? []);
  const ins = rowsOf(spec.inputs);
  const outs = rowsOf(spec.outputs);
  const comp = (id: string) => spec.comps.find((c) => c.id === id);
  const plateBottom = Math.max(...spec.comps.map((c) => c.y + ch(c))) + TOP + 20;
  const H = Math.max(plateBottom, ins.bottom, outs.bottom) + 8;
  const paths: { key: string; d: string; on: boolean; dash?: boolean }[] = [];
  for (const r of ins.rows)
    for (const t of r.to ?? []) {
      const c = comp(t);
      if (c === undefined) continue;
      paths.push({
        key: `${r.id}-${t}`,
        d: hCurve(IN_W, r.y + 11, c.x, TOP + c.y + ch(c) / 2),
        on: lit.has(t),
        dash: r.missing === true,
      });
    }
  for (const r of outs.rows)
    for (const f of r.from ?? []) {
      const c = comp(f);
      if (c === undefined) continue;
      // 주도 블록의 출력은 오른쪽 블록 열을 가로지르지 않게 판 위 차선으로 돈다.
      const sx = c.x + CW - 24;
      const lane = TOP - 6;
      const d =
        c.hero === true
          ? `M${sx},${TOP + c.y} L${sx},${lane + 6} Q${sx},${lane} ${sx + 6},${lane} L${OUT_X - 60},${lane} ${hCurve(OUT_X - 60, lane, OUT_X, r.y + 11).replace(/^M[^C]+/, "")}`
          : hCurve(c.x + CW, TOP + c.y + ch(c) / 2, OUT_X, r.y + 11);
      paths.push({ key: `${f}-${r.id}`, d, on: lit.has(f) });
    }
  return (
    <div className="relative flex-none" style={{ width: W, height: H }}>
      <div
        className={`absolute ${CARD}`}
        style={{ left: PLATE_X, top: TOP - 12, width: PLATE_W, height: plateBottom }}
      />
      <svg
        className="pointer-events-none absolute inset-0 overflow-visible"
        width={W}
        height={H}
        aria-hidden
      >
        {paths.map((p) => (
          <path
            key={p.key}
            d={p.d}
            fill="none"
            stroke={p.on ? LINE_LIT : LINE}
            strokeWidth={p.on ? 1.5 : 1}
            strokeDasharray={p.dash === true ? "3 3" : undefined}
          />
        ))}
        {spec.internal.map(([a, b]) => {
          const A = comp(a);
          const B = comp(b);
          if (A === undefined || B === undefined) return null;
          const same = A.x === B.x;
          const ax = same ? A.x + 18 : A.x < B.x ? A.x + CW : A.x;
          const bx = same ? B.x + 18 : A.x < B.x ? B.x : B.x + CW;
          const ay = same ? (A.y < B.y ? TOP + A.y + ch(A) : TOP + A.y) : TOP + A.y + ch(A) / 2;
          const by = same ? (A.y < B.y ? TOP + B.y : TOP + B.y + ch(B)) : TOP + B.y + ch(B) / 2;
          const on = lit.has(a) && lit.has(b);
          return (
            <path
              key={`${a}-${b}`}
              d={same ? `M${ax},${ay} L${bx},${by}` : hCurve(ax, ay, bx, by)}
              fill="none"
              stroke={on ? LINE_LIT : LINE}
              strokeWidth={on ? 1.25 : 1}
              strokeDasharray="2 3"
            />
          );
        })}
      </svg>
      {ins.rows.map((r, i) => (
        <SideRow key={`i${i}`} r={r} x={0} w={IN_W} />
      ))}
      {spec.comps.map((c) => (
        <CompCard key={c.id} c={c} lit={lit.has(c.id)} />
      ))}
      {outs.rows.map((r, i) => (
        <SideRow key={`o${i}`} r={r} x={OUT_X} w={W - OUT_X} />
      ))}
    </div>
  );
}

function Flow({
  spec,
  phase,
  onPhase,
}: {
  spec: DetailSpec;
  phase: string;
  onPhase: (p: string) => void;
}) {
  const n = spec.phases.length;
  const step = (W - 16) / n;
  const NW = Math.min(116, step - 30);
  const NY = 28;
  const NH = 52;
  const H = NY + NH + 96;
  const cx = (i: number) => 8 + step * i + step / 2;
  const gate =
    spec.gateAfter === undefined ? -1 : spec.phases.findIndex((p) => p.id === spec.gateAfter);
  return (
    <div className="relative flex-none" style={{ width: W, height: H }}>
      <svg
        className="pointer-events-none absolute inset-0 overflow-visible"
        width={W}
        height={H}
        aria-hidden
      >
        {spec.phases.slice(0, -1).map((p, i) => {
          const a = cx(i) + NW / 2;
          const b = cx(i + 1) - NW / 2;
          const y = NY + NH / 2;
          return (
            <g key={p.id} stroke="var(--cs-color-text-tertiary)" strokeWidth={1} fill="none">
              <path d={`M${a},${y} L${b - 3},${y}`} />
              <path
                d={`M${b - 7},${y - 3.5} L${b - 3},${y} L${b - 7},${y + 3.5}`}
                strokeLinecap="round"
              />
            </g>
          );
        })}
        {spec.cyclic && (
          <path
            d={`M${cx(n - 1)},${NY + NH} C${cx(n - 1)},${NY + NH + 40} ${cx(n - 1) - 30},${NY + NH + 44} ${cx(n - 1) - 60},${NY + NH + 44} L${cx(0) + 60},${NY + NH + 44} C${cx(0) + 30},${NY + NH + 44} ${cx(0)},${NY + NH + 40} ${cx(0)},${NY + NH + 6}`}
            stroke={LINE}
            strokeWidth={1}
            strokeDasharray="3 4"
            fill="none"
          />
        )}
      </svg>
      {spec.phases.map((p, i) => {
        const sel = p.id === phase;
        return (
          <div key={p.id} className="absolute" style={{ left: cx(i) - NW / 2, top: NY, width: NW }}>
            <button
              type="button"
              aria-pressed={sel}
              onClick={() => onPhase(p.id)}
              className={`grid w-full content-center gap-0.5 rounded-xl px-3 text-start outline-none focus-visible:focus-ring ${sel ? `bg-neutral-soft ${RING}` : TILE}`}
              style={{ height: NH }}
            >
              <span className="min-w-0 truncate text-title-3 text-text-primary">{p.label}</span>
            </button>
            {p.fan !== undefined && (
              <ul className="m-0 mt-2 grid list-none gap-0.5 p-0">
                {p.fan.map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-1.5 truncate text-footnote text-text-tertiary"
                  >
                    <span aria-hidden className="size-1 flex-none rounded-full bg-text-tertiary" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {gate >= 0 && (
        <div
          className="absolute grid -translate-x-1/2 justify-items-center gap-1"
          style={{ left: (cx(gate) + cx(gate + 1)) / 2, top: NY + NH / 2 - 8 }}
        >
          <span
            aria-hidden
            className="size-4 rotate-45 rounded-xs bg-bg-app"
            style={{ boxShadow: "inset 0 0 0 1px var(--cs-color-text-tertiary)" }}
          />
          <span className="mt-6 whitespace-nowrap text-footnote text-text-tertiary">
            {T.humanGate}
          </span>
        </div>
      )}
    </div>
  );
}

export function DetailScreen() {
  const m = useMock();
  const spec = m.detail === "cost-router" ? ROUTER_DETAIL : HELM_DETAIL;
  const p = pluginById(spec.id);
  const [phase, setPhase] = useState(spec.activePhase);
  return (
    <div className={STAGE}>
      <WorkbenchHead
        className="w-full px-3 pb-4"
        title={
          <span className="inline-flex items-center gap-2">
            <IconButton
              size="sm"
              variant="ghost"
              label={`${T.structure}로`}
              onClick={() => m.set({ screen: "structure" })}
              className="-ms-2"
            >
              <ChevronLeft />
            </IconButton>
            {p.name}
          </span>
        }
        meta={layerName(p.layer)}
        sub={p.blurb}
        actions={
          <Button size="sm" variant="outline" onClick={() => m.notify("구성기에서 열어요")}>
            구성기에서 열기
          </Button>
        }
      />
      <PageSection title="무엇으로 되어 있나" className="px-3 pb-4">
        <div className="overflow-x-auto">
          <Parts spec={spec} phase={phase} />
        </div>
      </PageSection>
      <div aria-hidden className="border-t border-border-subtle" />
      <PageSection title="어떻게 움직이나" className="px-3 pt-4 pb-6">
        <div className="overflow-x-auto">
          <Flow spec={spec} phase={phase} onPhase={setPhase} />
        </div>
      </PageSection>
    </div>
  );
}
