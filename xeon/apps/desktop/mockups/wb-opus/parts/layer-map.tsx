// 층 × 확장 지도(P-16, caustic 빈틈 C-16 "층 지도 배치"). 층 행마다 role="list" 하나, 칸은 listitem 안 Chip 버튼.
// 칸 = 상태 점 + 이름. DP-29에 따라 tone은 점(아이콘 자리)에만 주고 칩 면·글자는 중립으로 둔다(§6.22의 "칸 tone danger"보다 DP-29가 나중 원칙).
// drive 보유는 점 대신 selected(Solar bold) 아이콘. 꺼짐·안전 모드 제외는 연한 글자. 화살표 키로 칸 사이를 옮긴다.
import { Chip } from "@caustic/react";
import { useRef, type KeyboardEvent } from "react";
import { layerMap, LAYERS, Play, type Layer } from "../../_shell";
import { extInfo } from "../data";
import { useMock } from "../store";
import { LayerCell, StatusDot, statusOf } from "./ext-bits";

/** 안전 모드에서 빠지는 층(S2). */
export const SAFE_MODE_OUT: Layer[] = ["L3", "plugin"];

export function LayerMap() {
  const m = useMock();
  const root = useRef<HTMLDivElement>(null);

  // 왼쪽·오른쪽: 이전·다음 칸, 위·아래: 이전·다음 층의 첫 칸.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(e.key) || root.current === null) return;
    const all = [...root.current.querySelectorAll<HTMLButtonElement>("[data-map-chip]")];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    e.preventDefault();
    const cur = all[i];
    if (cur === undefined) return;
    const row = cur.dataset["row"];
    let next: HTMLButtonElement | undefined;
    if (e.key === "ArrowRight") next = all[i + 1];
    else if (e.key === "ArrowLeft") next = all[i - 1];
    else {
      const rows = [...new Set(all.map((b) => b.dataset["row"]))];
      const r = rows.indexOf(row);
      const target = rows[e.key === "ArrowDown" ? r + 1 : r - 1];
      next = all.find((b) => b.dataset["row"] === target);
    }
    next?.focus();
  };

  return (
    <div ref={root} onKeyDown={onKeyDown} className="grid gap-1.5">
      {LAYERS.map((layer) => {
        const out = m.safeMode && SAFE_MODE_OUT.includes(layer);
        const items = layerMap[layer].map((n) => extInfo(n, m.exts));
        const bad = items.filter((e) => e.status === "auto_disabled" || e.failures > 0).length;
        return (
          <div key={layer} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-start gap-2">
            <span className="flex h-control-xs items-center">
              <LayerCell>{layer}</LayerCell>
            </span>
            <ul aria-label={`${layer} 층`} className="m-0 flex list-none flex-wrap gap-1 p-0">
              {items.map((e) => {
                const s = statusOf(e);
                const holder = e.drive === "holder" && e.status === "enabled" && !out;
                const faint = out || e.status === "disabled";
                const state = out ? "안전 모드라 빠짐" : holder ? `drive 보유, ${s.text}` : s.text;
                return (
                  <li key={e.name}>
                    <Chip
                      data-map-chip
                      data-row={layer}
                      size="md"
                      variant="outline"
                      aria-label={`${e.name}, ${state}`}
                      onClick={() =>
                        m.openDetail(e.name, e.status === "auto_disabled" ? "log" : "overview")
                      }
                      icon={
                        holder ? (
                          <Play emphasis="selected" />
                        ) : (
                          <span className="inline-grid size-full place-items-center">
                            <StatusDot tone={out ? "neutral" : s.tone} />
                          </span>
                        )
                      }
                      count={!out && e.failures > 0 ? e.failures : undefined}
                      className={faint ? "text-text-tertiary" : undefined}
                    >
                      {e.name}
                    </Chip>
                  </li>
                );
              })}
            </ul>
            <span className="flex h-control-xs items-center text-ui-xs tabular-nums text-text-tertiary">
              {out ? "빠짐" : bad > 0 ? `${items.length} · 주의 ${bad}` : items.length}
            </span>
          </div>
        );
      })}
    </div>
  );
}
