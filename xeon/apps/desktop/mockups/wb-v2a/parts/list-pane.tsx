// 나눔 보기 목록(사용자 결정 1): 캔버스 옆 목록. 층별 묶음, 행 = 층 색 점 + 이름 + 상태. 고름은 캔버스와 양쪽으로 맞물린다.
// 고른 행은 raised 면 하나(DP-43). 맥락에서 꺼진 블록은 tertiary 글자. 좁은 폭(700)에서는 이 목록이 캔버스를 대신한다.
import { CircleX, Play, TriangleAlert } from "../../_shell";
import { EXTS, HUE_OF, type Ext } from "../data";
import { useMock } from "../store";
import { isOnIn } from "../screens/layer";
import { hueVar } from "./kit";

const GROUPS: { title: string; layer: string; match: (e: Ext) => boolean }[] = [
  { title: "의도 그룹", layer: "L3", match: (e) => e.layer === "L3" },
  { title: "외부", layer: "plugin", match: (e) => e.layer === "plugin" },
  { title: "서비스", layer: "L2", match: (e) => e.layer === "L2" },
];

export function ListPane({ wide = false }: { wide?: boolean }) {
  const m = useMock();
  return (
    <nav
      aria-label="블록 목록"
      className={`flex min-h-0 flex-none flex-col gap-3 overflow-y-auto pe-1 ${wide ? "w-full" : "w-[12.5rem]"}`}
    >
      {GROUPS.map((g) => {
        const items = EXTS.filter(g.match);
        return (
          <section key={g.layer} className="grid gap-px">
            {wide && g.layer === "L2" && (
              <div
                className="mb-3 flex items-center gap-2.5 rounded-xl px-3 py-2.5"
                style={{ background: "var(--plate-x)" }}
              >
                <span
                  className="grid size-7 place-items-center rounded-full bg-surface-raised text-ui-xs shadow-1"
                  style={{ boxShadow: "0 0 0 2px var(--ink-x)" }}
                >
                  46
                </span>
                <span className="grid leading-tight">
                  <span className="text-ui-sm text-text-primary">에이전트 루프</span>
                  <span className="text-ui-xs text-text-tertiary">
                    위 블록은 소켓에 꽂고, 아래 서비스는 능력을 내줘요 · 쓰는 지점 7
                  </span>
                </span>
              </div>
            )}
            <h3 className="m-0 flex items-baseline gap-1.5 px-2 pb-1 text-ui-xs text-text-tertiary">
              <span className="font-mono text-mono-micro">{g.layer}</span>
              {g.title}
              <span className="ms-auto tabular-nums">
                {items.filter((e) => isOnIn(m.ctx, e)).length}/{items.length}
              </span>
            </h3>
            {items.map((e) => {
              const on = isOnIn(m.ctx, e);
              const sel = m.selected === e.id;
              return (
                <button
                  key={e.id}
                  type="button"
                  aria-current={sel ? "true" : undefined}
                  onClick={() => m.select(sel ? null : e.id)}
                  className={`flex h-8 items-center gap-2 rounded-lg px-2 text-left outline-none focus-visible:focus-ring ${
                    sel ? "bg-surface-raised shadow-1" : "hover:bg-fill-hover"
                  }`}
                >
                  <span
                    className="size-2 flex-none rounded-full"
                    style={{
                      background: on
                        ? hueVar(HUE_OF[e.layer], "ink")
                        : "var(--cs-color-neutral-track)",
                    }}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-ui-sm ${on ? "text-text-primary" : "text-text-tertiary"} ${sel ? "font-medium" : ""}`}
                  >
                    {e.label}
                  </span>
                  {e.health === "auto_disabled" ? (
                    <span className="grid size-4 place-items-center rounded-sm bg-danger-soft text-danger-text [&_svg]:size-3">
                      <CircleX />
                    </span>
                  ) : e.health === "failing" ? (
                    <span className="grid size-4 place-items-center rounded-sm bg-warning-soft text-warning-text [&_svg]:size-3">
                      <TriangleAlert />
                    </span>
                  ) : m.ctx === "t1" && e.id === "helm" ? (
                    <span className="grid size-4 place-items-center rounded-sm bg-accent-soft text-accent-text [&_svg]:size-3">
                      <Play />
                    </span>
                  ) : (
                    <span className="text-micro text-text-tertiary tabular-nums">
                      {e.points !== undefined
                        ? `소켓 ${e.points.length}`
                        : e.provides !== undefined
                          ? `능력 ${e.provides.length}`
                          : ""}
                    </span>
                  )}
                </button>
              );
            })}
          </section>
        );
      })}
      <section className="grid gap-px">
        <h3 className="m-0 flex items-baseline gap-1.5 px-2 pb-1 text-ui-xs text-text-tertiary">
          <span className="font-mono text-mono-micro">L1·L0</span>기반
          <span className="ms-auto tabular-nums">9</span>
        </h3>
        <span className="px-2 font-mono text-mono-micro leading-relaxed text-text-tertiary">
          loop tools models agents context · sqlite exec sandbox secrets
        </span>
      </section>
    </nav>
  );
}
