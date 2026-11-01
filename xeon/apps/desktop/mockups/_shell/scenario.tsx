// 목업 전용: 눌러 볼 수 있는 시나리오(?scenario=<id>)를 돌리는 작은 도구.
// - useScenarioParam(): URL의 scenario 값(없으면 null). 페이지는 값이 있으면 시나리오 상태 기계로 그린다.
// - useTimeline(): 시간 순서 단계(지연 뒤 실행)를 돌리고, 다시 시작·건너뛰기를 준다. 가짜 스트리밍 글자는 useTypewriter().
// - ScenarioDock: ?dev=1일 때만 왼쪽 아래에 시나리오 고르기·다시 시작을 띄운다. 실제 앱에는 없다.
// 네트워크는 쓰지 않는다. 모든 변화는 페이지 안 상태 기계가 만든다.
import { Button, Select, SelectOption } from "@caustic/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export interface ScenarioDef {
  id: string;
  label: string;
}

function readParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

export function useScenarioParam(): string | null {
  return readParam("scenario");
}

export function isDev(): boolean {
  return readParam("dev") === "1";
}

/** 시나리오를 바꾸거나 처음부터 다시: URL을 고치고 새로 읽는다(상태 기계를 깨끗이 다시 만든다). */
export function goScenario(id: string | null): void {
  const url = new URL(window.location.href);
  if (id === null) url.searchParams.delete("scenario");
  else {
    url.searchParams.set("scenario", id);
    url.searchParams.delete("state");
  }
  window.location.assign(url.toString());
}

export interface TimelineStep {
  /** 앞 단계 뒤 기다릴 ms */
  after: number;
  run: () => void;
}

/** 단계를 차례로 실행한다. start(steps)로 새 줄을 걸고, 앞 줄은 취소한다. */
export function useTimeline(): {
  start: (steps: readonly TimelineStep[]) => void;
  cancel: () => void;
} {
  const timers = useRef<number[]>([]);
  const cancel = useCallback(() => {
    for (const t of timers.current) window.clearTimeout(t);
    timers.current = [];
  }, []);
  const start = useCallback(
    (steps: readonly TimelineStep[]) => {
      cancel();
      let at = 0;
      for (const s of steps) {
        at += s.after;
        timers.current.push(window.setTimeout(s.run, at));
      }
    },
    [cancel],
  );
  useEffect(() => cancel, [cancel]);
  return { start, cancel };
}

/** 글자를 조금씩 드러내는 가짜 스트리밍. active가 false면 전체를 바로 보인다. */
export function useTypewriter(
  text: string,
  active: boolean,
  cps = 60,
): { shown: string; done: boolean } {
  const [n, setN] = useState(active ? 0 : text.length);
  useEffect(() => {
    if (!active) {
      setN(text.length);
      return;
    }
    setN(0);
    const id = window.setInterval(
      () => {
        setN((v) => {
          if (v >= text.length) {
            window.clearInterval(id);
            return v;
          }
          return v + 2;
        });
      },
      Math.max(8, Math.round(2000 / cps)),
    );
    return () => window.clearInterval(id);
  }, [text, active, cps]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

/** ?dev=1일 때만 보이는 시나리오 막대(왼쪽 아래, 작게). hint는 시나리오 중 "다음에 누를 것" 한 줄(목업 전용 안내). */
export function ScenarioDock({
  scenarios,
  hint,
}: {
  scenarios: readonly ScenarioDef[];
  hint?: ReactNode;
}) {
  const current = useScenarioParam();
  if (!isDev() || scenarios.length === 0) return null;
  return (
    <div
      role="region"
      aria-label="목업 전용 시나리오"
      className="fixed bottom-2 left-2 z-50 flex items-center gap-1 rounded-md bg-bg-raised p-1 text-ui-xs text-text-tertiary shadow-md"
    >
      <Select
        size="xs"
        aria-label="시나리오"
        value={current ?? ""}
        onValueChange={(v) => goScenario(v === "" ? null : v)}
        className="w-48"
      >
        <SelectOption value="">정적 상태 보기</SelectOption>
        {scenarios.map((s) => (
          <SelectOption key={s.id} value={s.id}>
            {s.label}
          </SelectOption>
        ))}
      </Select>
      {current !== null && (
        <Button size="xs" variant="ghost" onClick={() => goScenario(current)}>
          다시 시작
        </Button>
      )}
      {current !== null && hint !== undefined && hint !== null && (
        <span className="max-w-80 truncate px-1 text-text-secondary">{hint}</span>
      )}
    </div>
  );
}
