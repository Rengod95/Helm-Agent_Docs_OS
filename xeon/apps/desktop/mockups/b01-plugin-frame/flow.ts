// 시나리오 상태 기계(목업 전용, B 묶음 세 폴더가 같이 쓴다). 시나리오 하나 = 이름 붙은 순간(phase)의 줄.
// - 화면은 지금 phase 하나로 그린다. 누름과 타이머가 다음 phase로 옮긴다(go).
// - ?scenario=<id>&step=<n>이면 n번째 순간에서 시작한다(스크린숏과 검토용). step이 없으면 0.
// 네트워크는 쓰지 않는다. 타이머는 _shell useTimeline.
import { useCallback, useState } from "react";

export interface FlowDef<P extends string> {
  id: string;
  label: string;
  phases: readonly P[];
}

function readStep(): number {
  const v = Number(new URLSearchParams(window.location.search).get("step") ?? "0");
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/** 시나리오 phase 하나를 들고, step 매개변수로 첫 순간을 고른다. */
export function useFlow<P extends string>(
  def: FlowDef<P> | null,
): { phase: P | null; go: (p: P) => void; index: number } {
  const [phase, setPhase] = useState<P | null>(() => {
    if (def === null) return null;
    const i = Math.min(readStep(), def.phases.length - 1);
    return def.phases[i] ?? null;
  });
  const go = useCallback((p: P) => setPhase(p), []);
  const index = def === null || phase === null ? -1 : def.phases.indexOf(phase);
  return { phase, go, index };
}
