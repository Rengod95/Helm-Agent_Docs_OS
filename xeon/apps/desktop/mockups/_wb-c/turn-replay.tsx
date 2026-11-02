// 턴 다시 보기 막대(§6.22.5): 재생·멈춤, 앞·다음 발화, 눈금 줄(눈금 하나 = 훅 하나의 발화, 높이 = 돈 핸들러 수,
// 실패 표지, 단계 사이 표지), seq·훅, 아래 줄은 핸들러마다 확장 이름 + 시간/예산 + 결과.
// caustic 빈틈: 눈금 줄 슬라이더(Slider는 값 하나, 눈금마다 높이·표지가 없다) [gap:C-17 Timeline·Sparkline 계열].
// 눈금 줄은 role="slider"이고 화살표로 옮긴다. 재생은 1.1초마다 다음 발화(제안).
// 잠김: 계측(x.operations.trace.enabled)이 꺼져 있으면 막대 대신 한 줄 + "설정에서 켜기"(결정 캔버스 5).
import { Badge, Button, IconButton } from "@caustic/react";
import { useEffect, useState, type KeyboardEvent } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Pause,
  Play,
  T,
  ToneIcon,
  CircleX,
  CircleCheck,
  josa,
} from "../_shell";
import type { Tick } from "./data";
import { ExtName } from "./parts";

export function TurnReplayLocked({
  onSettings,
  evicted = false,
}: {
  onSettings?: () => void;
  evicted?: boolean;
}) {
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-neutral-well shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] px-2.5 py-1.5">
      <Lock aria-hidden emphasis="muted" className="size-icon-sm text-text-tertiary" />
      <span className="text-ui-dense text-text-secondary">
        {evicted
          ? `이 ${T.turn}의 기록은 남아 있지 않아요`
          : `${josa(T.instrumentation, "이", "가")} 꺼져 있어 ${josa(T.turnReplay, "을", "를")} 쓸 수 없어요`}
      </span>
      {!evicted && (
        <span className="text-ui-xs text-text-tertiary">x.operations.trace.enabled</span>
      )}
      {!evicted && onSettings !== undefined && (
        <Button size="xs" tone="neutral" variant="ghost" className="ms-auto" onClick={onSettings}>
          설정에서 켜기
        </Button>
      )}
    </div>
  );
}

export function TurnReplayBar({
  ticks,
  turn,
  autoPlay = false,
  start = 1,
}: {
  ticks: Tick[];
  turn: number;
  autoPlay?: boolean;
  start?: number;
}) {
  const [i, setI] = useState(Math.min(start, ticks.length - 1));
  const [playing, setPlaying] = useState(autoPlay);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setI((v) => {
        if (v >= ticks.length - 1) {
          setPlaying(false);
          return v;
        }
        return v + 1;
      });
    }, 1100);
    return () => window.clearInterval(id);
  }, [playing, ticks.length]);
  const t = ticks[i];
  if (t === undefined) return null;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") setI((v) => Math.min(ticks.length - 1, v + 1));
    else if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    else return;
    e.preventDefault();
  };
  return (
    <section
      aria-label={T.turnReplay}
      className="grid gap-1.5 rounded-lg bg-neutral-well shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] px-2 py-1.5"
    >
      <div className="flex min-w-0 items-center gap-1">
        <IconButton
          size="sm"
          variant="ghost"
          label={playing ? "멈춤" : "재생"}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label="앞 발화"
          onClick={() => setI(Math.max(0, i - 1))}
        >
          <ChevronLeft />
        </IconButton>
        <IconButton
          size="sm"
          variant="ghost"
          label="다음 발화"
          onClick={() => setI(Math.min(ticks.length - 1, i + 1))}
        >
          <ChevronRight />
        </IconButton>
        <div
          role="slider"
          tabIndex={0}
          aria-label="발화 눈금"
          aria-valuemin={1}
          aria-valuemax={ticks.length}
          aria-valuenow={i + 1}
          aria-valuetext={`seq ${t.seq} ${t.point}`}
          onKeyDown={onKey}
          className="mx-1 flex h-7 min-w-0 flex-1 items-end gap-1 rounded-sm outline-none focus-visible:focus-ring"
        >
          {ticks.map((k, n) => (
            <button
              key={k.seq}
              type="button"
              tabIndex={-1}
              aria-hidden
              onClick={() => setI(n)}
              className="relative flex h-full flex-1 items-end justify-center"
            >
              {k.boundary === true && (
                <span className="absolute inset-y-0 start-1/2 w-px bg-border-strong" />
              )}
              <span
                className={[
                  "relative w-1.5 rounded-[2px]",
                  k.failed === true
                    ? "bg-danger-graphic"
                    : n === i
                      ? "bg-text-primary"
                      : "bg-neutral-graphic",
                  n === i ? "outline outline-2 outline-offset-1 outline-focus-ring" : "",
                ].join(" ")}
                style={{ height: `${8 + k.handlers.length * 7}px` }}
              />
            </button>
          ))}
        </div>
        <span className="flex-none font-mono text-mono-sm tabular-nums text-text-tertiary">
          {T.turn} {turn} · seq {t.seq}
        </span>
      </div>
      <div className="grid gap-0.5 ps-1">
        <div className="flex min-w-0 items-baseline gap-2 text-ui-dense">
          <span className="text-text-primary">{t.point}</span>
          <span className="font-mono text-mono-sm text-text-tertiary">{t.fold}</span>
          {t.boundary === true && (
            <Badge size="xs" tone="neutral" variant="soft">
              {T.stepBoundary}
            </Badge>
          )}
          {t.failed === true && t.fold === "first" && (
            <span className="text-ui-xs text-text-tertiary">닫힌 훅의 예외는 거부로 처리해요</span>
          )}
        </div>
        {t.handlers.map((h) => (
          <div key={h.ext} className="flex min-w-0 items-center gap-2 text-ui-dense">
            <ToneIcon tone={h.result === "ok" ? "neutral" : "danger"}>
              {h.result === "ok" ? <CircleCheck /> : <CircleX />}
            </ToneIcon>
            <ExtName id={h.ext} />
            <span className="ms-auto font-mono text-mono-sm tabular-nums text-text-secondary">
              {h.ms} / {h.budget}
            </span>
            <span className="w-10 text-end text-ui-xs text-text-tertiary">
              {h.result === "ok" ? "허용" : h.result === "deny" ? "거부" : "예외"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
