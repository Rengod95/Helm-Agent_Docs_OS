// 프리셋 ↔ 대화 차이: 층마다 같은 줄에 "이 대화 지금"과 "프리셋"의 스위치를 맞춰 두고, 가운데에 + − ~ 표지와 이유.
// 다른 줄만 진하게, 같은 줄은 접어서 수만 보인다. L1(비용 라우터)·X(끝나면 알림)도 프리셋이 켜고 끈다는 점이 보이게 했다.
import { Button } from "@caustic/react";
import { Eye, SlidersHorizontal } from "../../_shell";
import { WorkbenchHead } from "../../_shell";
import { LAYERS, PLUGINS, PRESET_DIFF, THREAD_ON, viewOf, type LayerId } from "../data";
import { Face, ICON, LayerCode, Mine } from "../parts/kit";
import { useMock } from "../store";

function Sw({ on }: { on: boolean }) {
  return (
    <span
      aria-label={on ? "켜짐" : "꺼짐"}
      className="relative inline-block h-3.5 w-6 flex-none rounded-full"
      style={{ background: on ? "var(--cs-color-accent-solid)" : "var(--track)" }}
    >
      <span
        className="absolute top-0.5 size-2.5 rounded-full"
        style={{
          left: on ? 12 : 2,
          background: on ? "var(--cs-color-accent-on)" : "var(--cs-color-surface-raised)",
        }}
      />
    </span>
  );
}

export function DiffScreen() {
  const m = useMock();
  const t = viewOf(m.view);
  const p = viewOf(m.preview ?? "p-explore");
  const layers: LayerId[] = ["L3", "L2", "L1", "L0", "X"];
  const toggleable = PLUGINS.filter(
    (x) => !(x.layer === "L1" && x.origin === "builtin") && !(x.layer === "L0"),
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <WorkbenchHead
        className="w-full px-3"
        title="차이"
        meta={`대화 ${t.label} ↔ 프리셋 ${p.label}`}
        sub={
          <>
            <span className="flex items-center gap-1 [&_svg]:size-3.5">
              <Eye />
              왼쪽은 지금 도는 대화(보기)
            </span>
            <span className="flex items-center gap-1 [&_svg]:size-3.5">
              <SlidersHorizontal />
              오른쪽은 적용하면 바뀔 값(바꾸기)
            </span>
          </>
        }
        actions={
          <>
            <Button size="xs" variant="ghost" onClick={() => m.set({ screen: "layers" })}>
              층에서 보기
            </Button>
            <Button
              size="xs"
              variant="solid"
              onClick={() => m.notify("이번 단계가 끝나면 적용돼요")}
            >
              이 대화에 적용
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3">
        <div
          className="mx-auto grid max-w-[880px] gap-1"
          style={{ gridTemplateColumns: "minmax(0,1fr) 150px minmax(0,1fr)" }}
        >
          <div className="flex items-center gap-1.5 pb-1 text-ui-xs text-text-tertiary [&_svg]:size-3.5">
            <Eye />
            대화 · {t.label} · 지금
          </div>
          <div className="pb-1 text-center text-ui-xs text-text-tertiary">바뀌는 것</div>
          <div className="flex items-center gap-1.5 rounded-md bg-accent-soft px-2 pb-1 pt-1 text-ui-xs text-accent-text [&_svg]:size-3.5">
            <SlidersHorizontal />
            프리셋 · {p.label} · 적용하면
          </div>
          {layers.map((l) => {
            const rows = toggleable.filter((x) => x.layer === l);
            const changed = rows.filter((x) => PRESET_DIFF[x.id]);
            const same = rows.length - changed.length;
            const L = LAYERS.find((x) => x.id === l)!;
            return [
              <div key={`${l}-h`} className="col-span-3 flex items-baseline gap-1.5 pt-3">
                <LayerCode l={l} />
                <span className="text-ui-sm text-text-primary">{L.name}</span>
                <span className="text-ui-xs text-text-tertiary">
                  {changed.length > 0 ? `바뀜 ${changed.length}` : "바뀜 없음"} · 같음 {same}
                  {l === "L0" ? " · 어댑터는 시작할 때 정해져 프리셋 밖이에요" : ""}
                </span>
              </div>,
              ...(l === "L0"
                ? []
                : changed.flatMap((x) => {
                    const d = PRESET_DIFF[x.id]!;
                    const now = THREAD_ON.has(x.id);
                    const after = d.mark === "add" ? true : d.mark === "remove" ? false : now;
                    const cls =
                      d.mark === "add"
                        ? "bg-diff-add-bg text-diff-add-text"
                        : d.mark === "remove"
                          ? "bg-diff-remove-bg text-diff-remove-text"
                          : "bg-agent-soft text-agent-text";
                    const cell = (on: boolean, right: boolean) => (
                      <div
                        className="flex h-10 min-w-0 items-center gap-2 rounded-lg px-2.5"
                        style={{
                          background: "var(--cs-color-surface-raised)",
                          boxShadow: right
                            ? "inset 0 0 0 1px var(--cs-color-accent-soft), var(--lift)"
                            : "inset 0 0 0 1px var(--edge)",
                        }}
                      >
                        <Face l={x.layer} icon={ICON[x.icon]} size={20} />
                        <span
                          className={`min-w-0 truncate text-ui-sm ${on ? "text-text-primary" : "text-text-tertiary line-through decoration-text-tertiary/60"}`}
                        >
                          {x.name}
                        </span>
                        <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary">
                          {x.id}
                        </span>
                        <span className="flex-1" />
                        {x.origin !== "builtin" && <Mine origin={x.origin as "user"} compact />}
                        {right && d.mark === "override" && (
                          <span className="font-mono text-mono-sm text-agent-text">4</span>
                        )}
                        <Sw on={on} />
                      </div>
                    );
                    return [
                      <div key={`${x.id}-a`}>{cell(now, false)}</div>,
                      <div
                        key={`${x.id}-m`}
                        className="flex h-10 items-center justify-center gap-1.5"
                      >
                        <span
                          className={`grid size-5 place-items-center rounded-full font-mono text-mono-strong ${cls}`}
                        >
                          {d.mark === "add" ? "+" : d.mark === "remove" ? "−" : "~"}
                        </span>
                        <span className="truncate text-ui-xs text-text-secondary">{d.note}</span>
                      </div>,
                      <div key={`${x.id}-b`}>{cell(after, true)}</div>,
                    ];
                  })),
            ];
          })}
          <div
            className="col-span-3 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2.5 text-ui-xs text-text-secondary"
            style={{ boxShadow: "inset 0 0 0 1px var(--edge)" }}
          >
            <span className="text-ui-sm text-text-primary">적용하면</span>
            <span>켜짐 3 · 꺼짐 1 · 설정 1</span>
            <span>진행권은 Helm 그대로</span>
            <span>계획 먼저는 진행 차례에서 빠져요</span>
            <span className="text-text-tertiary">
              이번 단계가 끝나면 적용 · 되돌리려면 "이 대화 지금"을 프리셋으로 저장
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
