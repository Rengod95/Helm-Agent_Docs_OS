// 재생 막대(캔버스 아래, glass 한 덩어리): 한 턴의 지점 발화를 차례로 되짚는다. 눈금 하나 = 지점 하나의 발화(seq),
// 마름모 = 단계 경계(켜기·끄기, 임대 교대 적용). 지금 눈금의 지점과 그때 돈 핸들러가 캔버스에서 켜진다.
// caustic 빈틈 [gap:C-38 제안]: 이산 이벤트 눈금을 가진 재생 막대(`EventScrubber`)가 없다. Slider는 연속 값,
// MotionTimeline은 키프레임 편집용이라 "seq 눈금 + 경계 표지 + 재생"을 그리지 못한다.
import { IconButton } from "@caustic/react";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, TriangleAlert, X } from "../../_shell";
import { REPLAY, type Handler } from "../data";
import { Mark } from "./node";

const fmt = (ms: number) => (ms >= 1000 ? `${+(ms / 1000).toFixed(1)}s` : `${ms}ms`);

export function Latency({ h }: { h: Handler }) {
  const r = Math.min(1, h.ms / h.budgetMs);
  const failed = h.result === "threw-deny";
  return (
    <span className="inline-flex items-center gap-1 rounded-xs bg-surface-base px-1 py-0.5 text-ui-xs text-text-secondary shadow-[0_0_0_1px_var(--cs-color-border-subtle)] tabular-nums">
      {failed && (
        <Mark tone="warning">
          <TriangleAlert />
        </Mark>
      )}
      <span>
        {fmt(h.ms)} / {fmt(h.budgetMs)}
      </span>
      <span aria-hidden className="relative h-1 w-8 overflow-hidden rounded-full bg-neutral-track">
        <span
          className={`absolute inset-y-0 left-0 rounded-full ${r >= 1 ? "bg-danger-graphic" : r >= 0.5 ? "bg-warning-graphic" : "bg-text-tertiary"}`}
          style={{ width: `${Math.max(4, r * 100)}%` }}
        />
      </span>
      {h.note !== undefined && <span className="text-text-tertiary">{h.note}</span>}
    </span>
  );
}

export function Scrubber({
  index,
  onIndex,
  onClose,
  left,
  right,
}: {
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
  left: number;
  right: number;
}) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => onIndex(index + 1 >= REPLAY.length ? 0 : index + 1), 1100);
    return () => window.clearInterval(t);
  }, [playing, index, onIndex]);
  const ev = REPLAY[index]!;
  const last = REPLAY.length - 1;
  return (
    <div
      className="glass absolute bottom-2 z-10 grid gap-1.5 rounded-toolbar px-2 py-1.5 glass-shadow-3"
      style={{ left, right }}
    >
      <div className="flex items-center gap-1">
        <IconButton
          size="sm"
          variant="ghost"
          label={playing ? "멈춤" : "재생"}
          onClick={() => setPlaying((p) => !p)}
        >
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label="앞 발화"
          onClick={() => onIndex(Math.max(0, index - 1))}
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label="다음 발화"
          onClick={() => onIndex(Math.min(last, index + 1))}
        >
          <ChevronRight />
        </IconButton>
        <span className="ps-1 text-ui-sm font-medium whitespace-nowrap text-text-primary">
          턴 7
        </span>
        <div
          role="slider"
          tabIndex={0}
          aria-label="재생 위치"
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={index}
          aria-valuetext={`seq ${ev.seq} ${ev.point}`}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") onIndex(Math.min(last, index + 1));
            if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
          }}
          className="relative mx-2 h-7 min-w-0 flex-1 cursor-pointer rounded-sm outline-none focus-visible:shadow-focus"
        >
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px bg-border-default" />
          {REPLAY.map((r, i) => {
            const at = (i / last) * 100;
            const fail = r.handlers.some((h) => h.result === "threw-deny");
            const cur = i === index;
            return (
              <button
                key={r.seq}
                type="button"
                tabIndex={-1}
                aria-label={`seq ${r.seq} ${r.point}`}
                onClick={() => onIndex(i)}
                className="absolute top-0 grid h-full w-3 -translate-x-1/2 place-items-center"
                style={{ left: `${at}%` }}
              >
                {r.boundary !== undefined ? (
                  <span
                    className={`size-2.5 rotate-45 rounded-[1px] ${cur ? "bg-text-primary" : "bg-text-secondary"}`}
                  />
                ) : (
                  <span
                    className={`w-0.5 rounded-full ${cur ? "bg-text-primary" : r.handlers.length > 0 ? "bg-text-secondary" : "bg-border-strong"}`}
                    style={{ height: cur ? 20 : 6 + r.handlers.length * 4 }}
                  />
                )}
                {fail && (
                  <span className="absolute top-0 size-1.5 rounded-full bg-warning-graphic" />
                )}
              </button>
            );
          })}
        </div>
        <span className="text-ui-xs whitespace-nowrap text-text-tertiary tabular-nums">
          {ev.at} · seq {ev.seq} · step {ev.step}
        </span>
        <IconButton size="sm" variant="ghost" label="재생 닫기" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ps-2 text-ui-sm"
        aria-live="polite"
      >
        <span className="font-medium text-text-primary">{ev.point}</span>
        {ev.boundary !== undefined && (
          <span className="text-text-secondary">{ev.boundary.text}</span>
        )}
        {ev.handlers.length === 0 && (
          <span className="text-ui-xs text-text-tertiary">건 핸들러 없음</span>
        )}
        {ev.handlers.map((h) => (
          <span key={h.ext} className="inline-flex items-center gap-1">
            <span className="text-ui-xs text-text-secondary">{h.ext}</span>
            <Latency h={h} />
          </span>
        ))}
      </div>
    </div>
  );
}
