// 개요(내비 "구조", 보기 "그림"): 턴 흐름 히어로 그림 + 그 위 누를 수 있는 단계 핀 + 고른 단계의 훅 카드, 오른쪽 "층 여섯" 카드.
// A의 손으로 그린 고리를 일러스트(x-lifecycle)로 바꾸고, 상호작용(단계 핀·훅 수·층 점)은 그림 위에 겹친다(SPEC §4.1).
import { Button } from "@caustic/react";
import { ArrowRight, Plus } from "../../_shell";
import {
  HOOKS,
  LAYERS,
  STAGES,
  hooksAt,
  pluginById,
  pluginsOf,
  stageOf,
  type LayerId,
  type StageId,
} from "../data";
import { Art, anchors } from "../parts/art";
import { FOLD_LABEL, Face, Fit, FoldGlyph, ICON, LayerCode, Mine, ink } from "../parts/kit";
import { useMock } from "../store";

const W = 660;
const H = 474;
const AX = 10;
const AY = 64;
const AW = 640;
const AH = 400;
/** 단계 핀 자리: 그림의 기준점(anchors, viewBox 비율). 그림에는 다섯 단계만 있어 검문은 요청과 도구 사이 고리 위,
 *  수명은 "세션·수명" 블록 옆에 둔다(SPEC §4.1). */
const A = anchors["hero-lifecycle"];
const POS: Record<StageId, { x: number; y: number }> = {
  input: A.input,
  request: A.request,
  guard: { x: 0.69, y: 0.135 },
  tool: A.tool,
  boundary: A.boundary,
  session: A.session,
  lifecycle: { x: 0.16, y: 0.585 },
};
export function stagePos(s: StageId) {
  return { x: AX + POS[s].x * AW, y: AY + POS[s].y * AH };
}

function StagePin({ id }: { id: StageId }) {
  const m = useMock();
  const s = STAGES.find((x) => x.id === id)!;
  const p = stagePos(id);
  const hooks = hooksAt(id);
  const layers = [...new Set(hooks.map((h) => pluginById(h.plugin).layer))];
  const sel = m.stage === id;
  const used = hooks.length > 0;
  const fail = hooks.some((h) => (h.fails ?? 0) > 0);
  return (
    <button
      type="button"
      onClick={() => m.set({ stage: sel ? null : id })}
      aria-pressed={sel}
      aria-label={`${s.label} 단계 · 훅 ${hooks.length}`}
      className={`group absolute flex h-7 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 ps-0.5 pe-2.5 outline-none focus-visible:shadow-focus ${sel ? "v3-breathe bg-surface-raised" : used ? "bg-surface-raised" : "bg-surface-raised/70"}`}
      style={{
        left: p.x,
        top: p.y,
        boxShadow: sel ? undefined : "var(--lift), inset 0 0 0 1px var(--edge)",
      }}
    >
      <span
        className={`relative grid size-6 place-items-center rounded-full font-mono text-mono-strong ${sel ? "bg-accent-solid text-accent-on" : used ? "bg-surface-base text-text-primary" : "text-text-tertiary"}`}
        style={{ boxShadow: used || sel ? undefined : "inset 0 0 0 1px var(--edge-strong)" }}
      >
        {hooks.length}
        {fail && (
          <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-danger-solid" />
        )}
      </span>
      <span className={`text-ui-sm ${used ? "text-text-primary" : "text-text-tertiary"}`}>
        {s.label}
      </span>
      <span className="font-mono text-mono-sm text-text-tertiary">{s.id}</span>
      {layers.length > 0 && (
        <span className="flex items-center gap-0.5">
          {layers.map((l) => (
            <span key={l} className="size-1.5 rounded-full" style={{ background: ink(l) }} />
          ))}
        </span>
      )}
    </button>
  );
}

/** 고른 단계의 훅 카드: 실행 순서대로, 층 점과 "내 것" 표지. */
export function StageCard({ id }: { id: StageId }) {
  const m = useMock();
  const s = STAGES.find((x) => x.id === id)!;
  const hooks = hooksAt(id);
  const points = [...new Set(hooks.map((h) => h.point))];
  return (
    <div className="rounded-xl bg-surface-raised p-3 shadow-2">
      <div className="flex items-baseline gap-2">
        <span className="text-ui-strong text-text-primary">{s.label} 단계</span>
        <span className="text-ui-xs text-text-tertiary">
          훅 {hooks.length} · 지점 {s.total}곳
        </span>
      </div>
      <p className="m-0 text-ui-xs text-text-secondary">{s.when}</p>
      {hooks.length === 0 && (
        <p className="m-0 mt-2 text-ui-xs text-text-tertiary">아직 아무도 끼어들지 않았어요.</p>
      )}
      <div className="mt-2 grid gap-2.5">
        {points.map((pt) => {
          const hs = hooks.filter((h) => h.point === pt);
          const fold = hs[0]!.fold;
          return (
            <div key={pt} className="grid gap-1">
              <div className="flex items-center gap-1.5 text-ui-xs text-text-secondary">
                <FoldGlyph fold={fold} color="var(--ink-X)" />
                <span className="min-w-0 flex-1 truncate">{pt}</span>
                <span className="text-text-tertiary">{FOLD_LABEL[fold]}</span>
              </div>
              {hs.map((h, i) => {
                const p = pluginById(h.plugin);
                return (
                  <button
                    key={h.plugin}
                    type="button"
                    onClick={() => m.set({ screen: "layers", focus: p.id, stage: null })}
                    className="flex min-w-0 items-center gap-1.5 rounded-md py-0.5 ps-1 text-start outline-none hover:bg-surface-base focus-visible:shadow-focus"
                  >
                    <span className="w-3 text-end font-mono text-mono-sm text-text-tertiary">
                      {i + 1}
                    </span>
                    <Face l={p.layer} icon={ICON[p.icon]} size={18} />
                    <span className="min-w-0 truncate text-ui-xs text-text-primary">{p.name}</span>
                    <LayerCode l={p.layer} />
                    <span className="flex-1" />
                    {p.origin !== "builtin" && <Mine origin={p.origin as "user"} compact />}
                    {(h.fails ?? 0) > 0 && (
                      <span className="size-1.5 rounded-full bg-danger-solid" />
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {id === "tool" && (
        <p className="m-0 mt-2.5 text-ui-xs text-text-tertiary">
          막기 지점은 앞에서 막으면 뒤 훅이 불리지 않아요. 외부 훅은 늘 맨 뒤예요.
        </p>
      )}
    </div>
  );
}

export function LifecycleHero() {
  const m = useMock();
  return (
    <Fit w={W} h={H} min={0.45} max={1.15}>
      <div className="absolute" style={{ left: AX, top: AY, width: AW, height: AH }}>
        <Art
          name={m.stage === "tool" ? "hero-lifecycle-active" : "hero-lifecycle"}
          label="턴 흐름: 한 턴이 입력 · 모델 요청 · 도구 · 단계 · 세션 연결 지점을 차례로 지나는 그림"
          className="h-full w-full"
        />
      </div>
      {/* 가운데 이름 */}
      <div
        className="pointer-events-none absolute grid -translate-x-1/2 justify-items-center text-center"
        style={{ left: AX + AW * 0.5, top: AY + AH * 0.27 }}
      >
        <span className="rounded-full bg-surface-raised px-2.5 py-0.5 text-ui-sm text-text-primary shadow-1">
          턴 흐름
        </span>
      </div>
      {STAGES.map((s) => (
        <StagePin key={s.id} id={s.id} />
      ))}
      <div className="absolute grid gap-0.5" style={{ left: 8, top: 0 }}>
        <span className="text-ui-strong text-text-primary">
          한 턴은 연결 지점 46곳을 차례로 지나요
        </span>
        <span className="text-ui-xs text-text-secondary">
          플러그인은 이 지점에 끼어들어 턴을 바꿔요. 켜고 끈 것은 이번 단계가 끝나면 적용돼요.
        </span>
      </div>
      <div
        className="absolute flex items-center gap-3 text-ui-xs text-text-tertiary"
        style={{ left: 8, top: 42 }}
      >
        <span>단계를 누르면 누가 끼어드는지 보여요 · 숫자 = 훅 · 점 = 훅을 건 층</span>
        {(["L3", "L2", "L1", "X"] as LayerId[]).map((l) => (
          <span key={l} className="flex items-center gap-1">
            <span className="size-1.5 rounded-full" style={{ background: ink(l) }} />
            {LAYERS.find((x) => x.id === l)!.name}
          </span>
        ))}
      </div>
    </Fit>
  );
}

/** 층 여섯 카드: 층마다 내장 수 · 내 것 수 · 더하기. 모든 층이 바꿀 수 있다는 것을 개요에서 바로 말한다. */
export function LayerStackCard({ compact }: { compact?: boolean }) {
  const m = useMock();
  return (
    <section
      aria-label="층 여섯"
      className={`grid content-start gap-2 ${compact ? "" : "w-[300px] flex-none"}`}
    >
      <div className="flex items-center gap-3">
        <Art
          name="layer-stack"
          label="층 여섯이 쌓인 그림: 층마다 내장 블록, 내가 꽂은 블록, 빈 자리"
          className="w-[92px] flex-none"
        />
        <div className="grid gap-0.5">
          <h2 className="m-0 text-ui-strong text-text-primary">층 여섯 · 모두 바꿀 수 있어요</h2>
          <span className="text-ui-xs text-text-tertiary">
            층마다 내장 위에 내 플러그인을 더해요. 색 블록이 내 것이에요.
          </span>
        </div>
      </div>
      <ul className="m-0 grid list-none gap-0.5 p-0">
        {LAYERS.map((l) => {
          const ps = pluginsOf(l.id);
          const mine = ps.filter((p) => p.origin !== "builtin").length;
          const builtin = l.id === "X" ? 4 : l.id === "F" ? 5 : ps.length - mine;
          const declared = l.id === "F" ? 3 : 0;
          return (
            <li
              key={l.id}
              className="group flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-raised"
            >
              <span className="w-5 flex-none">
                <LayerCode l={l.id} />
              </span>
              <button
                type="button"
                onClick={() => m.set({ screen: "layers", stage: null })}
                className="grid min-w-0 flex-1 text-start outline-none focus-visible:shadow-focus"
              >
                <span className="truncate text-ui-sm text-text-primary">{l.name}</span>
                <span className="truncate text-ui-xs text-text-tertiary">{l.does}</span>
              </button>
              <span className="flex-none text-end text-ui-xs tabular-nums text-text-tertiary">
                내장 {builtin}
                {l.id === "F" ? (
                  <span className="text-text-secondary"> · 선언 {declared}</span>
                ) : (
                  <span className={mine > 0 ? "text-text-primary" : ""}> · 내 것 {mine}</span>
                )}
              </span>
              {l.id !== "F" ? (
                <button
                  type="button"
                  aria-label={`${l.name}에 ${l.addNoun} 더하기`}
                  onClick={() =>
                    l.id === "L1"
                      ? m.set({ screen: "layers", overlay: "add-l1", stage: null })
                      : m.notify(`${l.name}에 ${l.addNoun} 더하기`)
                  }
                  className="grid size-6 flex-none place-items-center rounded-md text-text-tertiary outline-none hover:bg-surface-base hover:text-text-primary focus-visible:shadow-focus [&_svg]:size-3.5"
                  style={{ boxShadow: "inset 0 0 0 1px var(--edge-strong)", borderStyle: "none" }}
                >
                  <Plus />
                </button>
              ) : (
                <span className="size-6 flex-none" />
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-1 pt-1">
        <Button size="xs" variant="ghost" onClick={() => m.set({ screen: "layers", stage: null })}>
          층으로 보기
          <ArrowRight />
        </Button>
        <span className="text-ui-xs text-text-tertiary">
          훅 {HOOKS.length} · 지점 {new Set(HOOKS.map((h) => stageOf(h.point))).size}종
        </span>
      </div>
    </section>
  );
}
