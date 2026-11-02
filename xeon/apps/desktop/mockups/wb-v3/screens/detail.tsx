// 플러그인 상세(가장 힘준 화면): 위 "무엇으로 되어 있나"(가져다 쓰는 것 → 블록 → 끼어드는 훅·내놓는 것),
// 아래 "어떻게 움직이나"(단계 흐름). 흐름의 단계를 고르면 그 단계에서 움직이는 블록와 선이 위에서 밝아진다.
// B의 그룹 하위 캔버스를 이어받고, 층 색(입력·출력 줄)과 흐름 띠를 한 화면에 묶었다(SPEC §4.4).
import { Button, IconButton } from "@caustic/react";
import { useState } from "react";
import { ArrowUpRight, ChevronLeft } from "../../_shell";
import { WorkbenchHead } from "../../_shell";
import { pluginById, type LayerId } from "../data";
import { HELM_DETAIL, ROUTER_DETAIL, type Comp, type DetailSpec } from "../detail-data";
import { Face, Fit, ICON, LayerCode, Mine, ROLE_ICON, hCurve, ink, plate } from "../parts/kit";
import { useMock } from "../store";

const W = 1000;
const TOP = 34; // 위 구역 제목 높이
const CW = 196;
const CH = 56;
const IN_W = 214;
const OUT_X = 786;
const ROW = 24;
const FLOW_Y = 392;
const H = 610;

function inputRows(spec: DetailSpec) {
  const rows: {
    layer: LayerId;
    title?: string;
    id?: string;
    sub?: string;
    to?: string[];
    missing?: boolean;
    user?: boolean;
    y: number;
  }[] = [];
  let y = TOP + 6;
  for (const g of spec.inputs) {
    rows.push({ layer: g.layer, title: g.title, y });
    y += 22;
    for (const r of g.rows) {
      rows.push({ layer: g.layer, ...r, y });
      y += ROW;
    }
    y += 10;
  }
  return rows;
}
function outputRows(spec: DetailSpec) {
  const rows: {
    layer: LayerId;
    title?: string;
    id?: string;
    sub?: string;
    from?: string[];
    stage?: string;
    y: number;
  }[] = [];
  let y = TOP + 6;
  for (const g of spec.outputs) {
    rows.push({ layer: g.layer, title: g.title, y });
    y += 22;
    for (const r of g.rows) {
      rows.push({ layer: g.layer, ...r, y });
      y += ROW;
    }
    y += 10;
  }
  return rows;
}
const ch = (c: Comp) => c.h ?? CH;

function CompCard({ c, lit, dim }: { c: Comp; lit: boolean; dim: boolean }) {
  return (
    <div
      className="absolute flex flex-col justify-between rounded-xl px-2.5 py-2 transition-[opacity,box-shadow] duration-200"
      style={{
        left: c.x,
        top: TOP + c.y,
        width: CW,
        height: ch(c),
        background: "var(--cs-color-surface-raised)",
        boxShadow: lit
          ? "0 0 0 1.75px var(--cs-color-accent-solid), var(--lift)"
          : "inset 0 0 0 1px var(--edge), var(--lift)",
        opacity: dim ? 0.45 : 1,
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="grid size-6 flex-none place-items-center rounded-md [&_svg]:size-3.5"
          style={{
            background: c.hero ? "var(--cs-color-accent-solid)" : "var(--cs-color-surface-base)",
            color: c.hero ? "var(--cs-color-accent-on)" : "var(--cs-color-text-secondary)",
          }}
        >
          {ROLE_ICON[c.role]}
        </span>
        <span className="min-w-0 flex-1 truncate text-ui-sm text-text-primary">{c.name}</span>
        <span className="font-mono text-mono-sm text-text-tertiary">{c.role}</span>
      </div>
      <span className="truncate text-ui-xs text-text-secondary">{c.line}</span>
      {c.hero && <span className="text-ui-xs text-text-tertiary">역할 · {c.roleLabel}</span>}
    </div>
  );
}

function Parts({ spec, phase }: { spec: DetailSpec; phase: string }) {
  const ph = spec.phases.find((p) => p.id === phase)!;
  const litSet = new Set(ph.comps);
  const ins = inputRows(spec);
  const outs = outputRows(spec);
  const comp = (id: string) => spec.comps.find((c) => c.id === id)!;
  return (
    <>
      {/* 열 제목 */}
      <div className="absolute flex items-baseline gap-2" style={{ left: 0, top: 0 }}>
        <span className="text-ui-strong text-text-primary">무엇으로 되어 있나</span>
        <span className="text-ui-xs text-text-tertiary">
          가져다 쓰는 것 → 블록 {spec.comps.length} → 끼어드는 곳 · 내놓는 것
        </span>
      </div>
      {/* 플러그인 경계: 안쪽 = 이 플러그인의 블록, 바깥 왼쪽 = 가져다 쓰는 것, 바깥 오른쪽 = 끼어드는 곳·내놓는 것 */}
      {(() => {
        const p = pluginById(spec.id);
        const bottom = Math.max(...spec.comps.map((c) => c.y + ch(c)));
        return (
          <div
            className="absolute rounded-2xl"
            style={{
              left: 252,
              top: TOP - 4,
              width: 486,
              height: bottom + 40,
              background: plate(p.layer),
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${ink(p.layer)} 22%, transparent)`,
            }}
          >
            <span className="absolute bottom-2 left-3 flex items-center gap-1.5 text-ui-xs text-text-secondary">
              <LayerCode l={p.layer} />
              {p.name} 안 · 블록 {spec.comps.length}
              <span className="text-text-tertiary">
                · 작성자가 선언(<span className="font-mono text-mono-sm">composition</span>)
              </span>
            </span>
          </div>
        );
      })()}
      {/* 선(카드 아래) */}
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={W}
        height={FLOW_Y}
        aria-hidden
      >
        {ins.flatMap((r) =>
          (r.to ?? []).map((t) => {
            const c = comp(t);
            const lit = litSet.has(t);
            const d = hCurve(IN_W, r.y + 11, c.x, TOP + c.y + ch(c) / 2);
            return (
              <path
                key={`${r.id}-${t}`}
                d={d}
                fill="none"
                stroke={ink(r.layer)}
                strokeWidth={lit ? 1.6 : 1.1}
                strokeDasharray={r.missing ? "3 3" : undefined}
                opacity={lit ? 0.95 : 0.16}
              />
            );
          }),
        )}
        {outs.flatMap((r) =>
          (r.from ?? []).map((f) => {
            const c = comp(f);
            const lit = litSet.has(f);
            // 주도 블록의 출력은 오른쪽 블록 열을 가로지르지 않게 경계 위 차선으로 돈다.
            const sx = c.x + CW - 24;
            const lane = TOP + 4;
            const d = c.hero
              ? `M${sx},${TOP + c.y} L${sx},${lane + 6} Q${sx},${lane} ${sx + 6},${lane} L${OUT_X - 60},${lane} ${hCurve(OUT_X - 60, lane, OUT_X, r.y + 11).replace(/^M[^C]+/, "")}`
              : hCurve(c.x + CW, TOP + c.y + ch(c) / 2, OUT_X, r.y + 11);
            return (
              <path
                key={`${f}-${r.id}`}
                d={d}
                fill="none"
                stroke={ink(r.layer)}
                strokeWidth={lit ? 1.6 : 1.1}
                opacity={lit ? 0.95 : 0.16}
              />
            );
          }),
        )}
        {spec.internal.map(([a, b]) => {
          const A = comp(a);
          const B = comp(b);
          const sameCol = A.x === B.x;
          const ax = sameCol ? A.x + 18 : A.x < B.x ? A.x + CW : A.x;
          const bx = sameCol ? B.x + 18 : A.x < B.x ? B.x : B.x + CW;
          const ay = sameCol ? (A.y < B.y ? TOP + A.y + ch(A) : TOP + A.y) : TOP + A.y + ch(A) / 2;
          const by = sameCol ? (A.y < B.y ? TOP + B.y : TOP + B.y + ch(B)) : TOP + B.y + ch(B) / 2;
          const d = sameCol ? `M${ax},${ay} L${bx},${by}` : hCurve(ax, ay, bx, by);
          const lit = litSet.has(a) && litSet.has(b);
          return (
            <g key={`${a}-${b}`}>
              <path
                d={d}
                fill="none"
                stroke="var(--cs-color-text-tertiary)"
                strokeWidth={lit ? 1.4 : 1}
                strokeDasharray="2 3"
                opacity={lit ? 1 : 0.35}
              />
              <circle cx={bx} cy={by} r={2} fill="var(--cs-color-text-tertiary)" />
            </g>
          );
        })}
      </svg>
      {spec.internal.map(([a, b, label]) => {
        const A = comp(a);
        const B = comp(b);
        if (A.x === B.x || !(litSet.has(a) && litSet.has(b))) return null;
        const mx = (A.x < B.x ? A.x + CW + B.x : A.x + B.x + CW) / 2;
        const my = TOP + (A.y + ch(A) / 2 + B.y + ch(B) / 2) / 2;
        return (
          <span
            key={`l-${a}-${b}`}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-bg-app px-1 text-ui-xs text-text-tertiary"
            style={{ left: mx, top: my }}
          >
            {label}
          </span>
        );
      })}
      {/* 입력 열 */}
      {ins.map((r, i) =>
        r.title !== undefined ? (
          <div
            key={`ih${i}`}
            className="absolute flex items-baseline gap-1.5"
            style={{ left: 0, top: r.y }}
          >
            <LayerCode l={r.layer} />
            <span className="text-ui-xs text-text-secondary">{r.title}</span>
          </div>
        ) : (
          <div
            key={r.id}
            className="absolute flex h-[22px] items-center gap-1.5 rounded-md px-2"
            style={{
              left: 0,
              top: r.y,
              width: IN_W,
              background: r.missing ? "transparent" : plate(r.layer),
              boxShadow: r.missing ? "inset 0 0 0 1px var(--edge-strong)" : "none",
            }}
          >
            <span
              className="size-1.5 flex-none rounded-full"
              style={{
                background: r.missing ? "transparent" : ink(r.layer),
                boxShadow: r.missing ? `inset 0 0 0 1px ${ink(r.layer)}` : undefined,
              }}
            />
            <span
              className={`min-w-0 truncate font-mono text-mono-sm ${r.missing ? "text-text-tertiary" : "text-text-primary"}`}
            >
              {r.id}
            </span>
            <span className="flex-1" />
            <span className="flex-none truncate text-ui-xs text-text-tertiary">{r.sub}</span>
            {r.user && <Mine origin="user" compact />}
          </div>
        ),
      )}
      {/* 블록 */}
      {spec.comps.map((c) => (
        <CompCard key={c.id} c={c} lit={litSet.has(c.id)} dim={!litSet.has(c.id)} />
      ))}
      {/* 출력 열 */}
      {outs.map((r, i) =>
        r.title !== undefined ? (
          <div
            key={`oh${i}`}
            className="absolute flex items-baseline gap-1.5"
            style={{ left: OUT_X, top: r.y }}
          >
            <LayerCode l={r.layer} />
            <span className="text-ui-xs text-text-secondary">{r.title}</span>
          </div>
        ) : (
          <div
            key={r.id}
            className="absolute flex h-[22px] items-center gap-1.5 rounded-md px-2"
            style={{ left: OUT_X, top: r.y, width: W - OUT_X, background: plate(r.layer) }}
          >
            <span className="size-1.5 flex-none rounded-sm" style={{ background: ink(r.layer) }} />
            <span
              className={`min-w-0 truncate text-ui-xs text-text-primary ${r.id?.includes(" ") ? "" : "font-mono text-mono-sm"}`}
            >
              {r.id}
            </span>
            <span className="flex-1" />
            {r.sub && (
              <span className="flex-none truncate text-ui-xs text-text-tertiary">{r.sub}</span>
            )}
          </div>
        ),
      )}
    </>
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
  const x0 = 8;
  const span = W - 16;
  const step = span / n;
  const NW = Math.min(112, step - 34);
  const NY = FLOW_Y + 64;
  const NH = 50;
  const cx = (i: number) => x0 + step * i + step / 2;
  const comp = (id: string) => spec.comps.find((c) => c.id === id)!;
  return (
    <>
      <div className="absolute flex items-baseline gap-2" style={{ left: 0, top: FLOW_Y }}>
        <span className="text-ui-strong text-text-primary">{spec.flowTitle}</span>
        <span className="text-ui-xs text-text-tertiary">{spec.flowMeta}</span>
      </div>
      <svg
        className="pointer-events-none absolute left-0 top-0 overflow-visible"
        width={W}
        height={H}
        aria-hidden
      >
        {spec.phases.slice(0, -1).map((p, i) => {
          const a = cx(i) + NW / 2;
          const b = cx(i + 1) - NW / 2;
          return (
            <g key={p.id}>
              <path
                d={`M${a},${NY + NH / 2} L${b - 4},${NY + NH / 2}`}
                stroke="var(--cs-color-text-secondary)"
                strokeWidth={1.25}
                fill="none"
              />
              <path
                d={`M${b - 8},${NY + NH / 2 - 4} L${b - 3},${NY + NH / 2} L${b - 8},${NY + NH / 2 + 4}`}
                stroke="var(--cs-color-text-secondary)"
                strokeWidth={1.25}
                fill="none"
                strokeLinecap="round"
              />
            </g>
          );
        })}
        {spec.cyclic && (
          <path
            d={`M${cx(n - 1)},${NY + NH} C${cx(n - 1)},${NY + NH + 46} ${cx(n - 1) - 30},${NY + NH + 50} ${cx(n - 1) - 60},${NY + NH + 50} L${cx(0) + 60},${NY + NH + 50} C${cx(0) + 30},${NY + NH + 50} ${cx(0)},${NY + NH + 46} ${cx(0)},${NY + NH + 6}`}
            stroke="var(--track)"
            strokeWidth={1.5}
            strokeDasharray="3 4"
            fill="none"
          />
        )}
      </svg>
      {spec.cyclic && (
        <span
          className="absolute -translate-x-1/2 bg-bg-app px-1.5 text-ui-xs text-text-tertiary"
          style={{ left: W / 2, top: NY + NH + 42 }}
        >
          끝나면 쉼으로 · 다음 막힘을 기다려요
        </span>
      )}
      {spec.phases.map((p, i) => {
        if (p.cond === undefined) return null;
        const gx = i === 0 ? cx(0) : (cx(i - 1) + cx(i)) / 2;
        return (
          <span
            key={`c-${p.id}`}
            className="absolute flex -translate-x-1/2 items-center gap-1 whitespace-nowrap text-ui-xs text-text-tertiary"
            style={{ left: gx, top: NY - 24 }}
          >
            <span className="font-mono text-mono-sm">◇</span>
            {p.cond}
          </span>
        );
      })}
      {spec.phases.map((p, i) => {
        const sel = p.id === phase;
        return (
          <div key={p.id} className="absolute" style={{ left: cx(i) - NW / 2, top: NY, width: NW }}>
            <button
              type="button"
              aria-pressed={sel}
              onClick={() => onPhase(p.id)}
              className={`flex w-full flex-col justify-center rounded-xl px-2.5 text-start outline-none focus-visible:shadow-focus ${sel ? "v3-breathe" : ""}`}
              style={{
                height: NH,
                background: "var(--cs-color-surface-raised)",
                boxShadow: sel ? undefined : "inset 0 0 0 1px var(--edge), var(--lift)",
              }}
            >
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-ui-sm text-text-primary">
                  {p.label}
                </span>
                {p.budget && (
                  <span className="flex-none rounded-full bg-surface-base px-1.5 font-mono text-mono-sm text-text-secondary">
                    {p.budget}
                  </span>
                )}
              </span>
              {p.note && <span className="truncate text-ui-xs text-text-tertiary">{p.note}</span>}
            </button>
            {/* 이 단계에서 움직이는 블록 */}
            <div className="mt-1.5 flex flex-wrap gap-1">
              {p.comps.map((cid) => (
                <span
                  key={cid}
                  title={comp(cid).name}
                  className="grid size-5 place-items-center rounded-md [&_svg]:size-3"
                  style={{
                    background: sel
                      ? "var(--cs-color-accent-soft)"
                      : "var(--cs-color-surface-base)",
                    color: sel ? "var(--cs-color-accent-text)" : "var(--cs-color-text-tertiary)",
                  }}
                >
                  {ROLE_ICON[comp(cid).role]}
                </span>
              ))}
            </div>
            {p.fan && (
              <div className="mt-1.5 grid gap-1">
                {p.fan.map((f, k) => (
                  <span
                    key={f}
                    className="flex h-5 items-center gap-1 rounded-md px-1.5 text-ui-xs text-text-secondary"
                    style={{
                      background: plate(spec.id === "helm" ? "L1" : "L1"),
                      marginLeft: k * 6,
                    }}
                  >
                    <span className="size-1 rounded-full" style={{ background: ink("L1") }} />
                    <span className={spec.id === "helm" ? "" : "font-mono text-mono-sm"}>{f}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {spec.gateAfter !== undefined &&
        (() => {
          const i = spec.phases.findIndex((p) => p.id === spec.gateAfter);
          const gx = (cx(i) + cx(i + 1)) / 2;
          return (
            <div
              className="absolute grid -translate-x-1/2 justify-items-center"
              style={{ left: gx, top: NY + NH / 2 - 9 }}
            >
              <span
                className="size-[18px] rotate-45 rounded-[3px] bg-bg-app"
                style={{ border: "1.25px dashed var(--edge-strong)" }}
              />
              <span className="mt-[76px] w-[150px] text-center text-ui-xs text-text-tertiary">
                사람 확인 자리 · 기다리는 동안 주도를 놓고 답이 오면 다시 받아요
              </span>
            </div>
          );
        })()}
    </>
  );
}

export function DetailScreen() {
  const m = useMock();
  const spec = m.detail === "cost-router" ? ROUTER_DETAIL : HELM_DETAIL;
  const p = pluginById(spec.id);
  const [phase, setPhase] = useState(spec.activePhase);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkbenchHead
        className="w-full px-3"
        title={
          <span className="flex items-center gap-2">
            <IconButton
              size="sm"
              variant="ghost"
              label="구조로"
              onClick={() => m.set({ screen: "layers" })}
              className="-ms-1.5"
            >
              <ChevronLeft />
            </IconButton>
            <Face l={p.layer} icon={ICON[p.icon]} size={22} />
            {p.name}
            <span className="font-mono text-mono-sm text-text-tertiary">{p.id}</span>
          </span>
        }
        meta={
          <span className="inline-flex items-center gap-1.5">
            <LayerCode l={p.layer} />
            {spec.id === "helm" ? "그룹 · 내장 0.4.0 · 블록 7" : "에이전트 핵심 · 0.3.0 · 블록 6"}
            {p.origin !== "builtin" && <Mine origin="user" />}
            {p.proposal && <span className="text-text-tertiary">[제안]</span>}
          </span>
        }
        sub={
          <>
            <span>{p.blurb}</span>
            <span>읽기 전용 · 여기서는 켜기·끄기와 설정 덮어쓰기만 해요</span>
          </>
        }
        actions={
          <Button size="xs" variant="soft" onClick={() => m.notify("구성기에서 열어요")}>
            구성기에서 열기
            <ArrowUpRight />
          </Button>
        }
      />
      <div className="flex min-h-0 flex-1 px-3 pb-3">
        <Fit w={W} h={H} min={0.7} max={1.08}>
          <Parts spec={spec} phase={phase} />
          <Flow spec={spec} phase={phase} onPhase={setPhase} />
        </Fit>
      </div>
    </div>
  );
}
