// caustic 빈틈: 화면의 아무 요소에나 붙는 안내 말풍선(coach mark)이 없다. Popover는 anchor를 자식으로 감싸야 해서
// 셸 안쪽 요소(런타임 줄, 런타임 탭, "크래프트에서 보기")에 밖에서 붙일 수 없다. 그래서 data-tour 표지로 요소를 찾아
// 그 둘레에 초점 고리(focus-ring 토큰)를 그리고, 말풍선은 caustic 면(surface-raised, shadow-5, 2xl 모서리) + Button으로 짠다.
// 넓은 폭: 대상 옆(아래·왼쪽). 좁은 폭(720 미만): 말풍선이 입력창 위 아래쪽 시트로 내려온다(대상 고리는 그대로).
// 대상을 못 찾으면(사용자가 탭을 닫음 등) 말풍선이 그 사실과 "다시 열기"를 보인다.
import { Button } from "@caustic/react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useShell } from "../../_shell";

export interface TourStep {
  target: string;
  title: string;
  body: ReactNode;
  side: "below" | "left";
}

function useRect(selector: string, tick: unknown): DOMRect | null {
  const [r, setR] = useState<DOMRect | null>(null);
  useEffect(() => {
    let raf = 0;
    const read = () => {
      const el = document.querySelector<HTMLElement>(selector);
      setR(el === null ? null : el.getBoundingClientRect());
    };
    const id = window.setInterval(read, 250);
    raf = window.requestAnimationFrame(read);
    window.addEventListener("resize", read);
    return () => {
      window.clearInterval(id);
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", read);
    };
  }, [selector, tick]);
  return r;
}

export function Tour({
  steps,
  at,
  onNext,
  onBack,
  onSkip,
  missing,
}: {
  steps: TourStep[];
  /** 0부터. */
  at: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  /** 대상을 못 찾을 때 말풍선 내용(다시 열기 등). */
  missing: (step: TourStep) => ReactNode;
}) {
  const m = useShell();
  const step = steps[at];
  const rect = useRect(step === undefined ? "#none" : `[data-tour="${step.target}"]`, at);
  if (step === undefined) return null;
  const narrow = m.layout === "compact";
  const last = at === steps.length - 1;
  const pad = 4;

  const bubbleStyle: CSSProperties =
    narrow || rect === null
      ? { left: 12, right: 12, bottom: 132 }
      : step.side === "below"
        ? { left: Math.max(12, rect.left - 4), top: rect.bottom + 10, width: 320 }
        : {
            left: Math.max(12, rect.left - 332),
            top: Math.max(12, Math.min(rect.top - 8, window.innerHeight - 220)),
            width: 320,
          };

  return (
    <>
      {/* 좁은 폭에서 well은 시트라 그 자체가 대상이다: 고리를 그리지 않는다. */}
      {rect !== null && !(narrow && step.side === "left") && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-40 rounded-lg shadow-[0_0_0_2px_var(--cs-color-focus-ring),0_0_0_6px_color-mix(in_oklab,var(--cs-color-focus-ring)_25%,transparent)] transition-all duration-quick motion-reduce:transition-none"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
          }}
        />
      )}
      <div
        role="dialog"
        aria-modal={false}
        aria-label={`둘러보기 ${at + 1}/${steps.length}: ${step.title}`}
        className="fixed z-50 grid gap-2 rounded-2xl bg-surface-raised p-3 shadow-5 animate-rise"
        style={bubbleStyle}
      >
        {rect === null ? (
          missing(step)
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-ui-strong font-semibold text-text-primary">{step.title}</span>
              <span className="ms-auto text-ui-xs tabular-nums text-text-tertiary">
                {at + 1}/{steps.length}
              </span>
            </div>
            <p className="m-0 text-ui-sm text-text-secondary">{step.body}</p>
          </>
        )}
        <div className="mt-1 flex items-center gap-1">
          <Button size="xs" tone="neutral" variant="ghost" onClick={onSkip}>
            그만 보기
          </Button>
          <span className="flex-1" />
          {at > 0 && (
            <Button size="xs" tone="neutral" variant="ghost" onClick={onBack}>
              이전
            </Button>
          )}
          <Button size="xs" tone="neutral" variant="solid" onClick={onNext}>
            {last ? "다 봤어요" : "다음"}
          </Button>
        </div>
      </div>
    </>
  );
}
