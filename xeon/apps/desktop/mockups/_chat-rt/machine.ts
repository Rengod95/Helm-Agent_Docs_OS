// 목업 전용: 페이지 상태 기계 하나로 ?state=, ?scenario=, &step=을 함께 돌린다(batch A 공용).
// - 페이지는 reduce(상태, 동작)와 시나리오 대본(동작 목록)을 준다. 버튼은 dispatch(동작)를 부르고,
//   effect가 지연 뒤 다음 동작(경계 도착, 스트리밍 끝 등)을 건다(가짜 타이머, 네트워크 없음).
// - ?state=<id>는 "대본 X의 앞 n개 동작을 바로 적용한 모습"이고, ?scenario=<id>&step=<n>도 같은 방식이다.
//   바로 적용할 때는 effect를 돌리지 않아 그 순간에 멈춘 화면이 나온다(스크린숏용).
import { useCallback, useEffect, useRef, useState } from "react";
import { useScenarioParam } from "../_shell";

export type After<A> = (ms: number, action: A) => void;

export interface MachineOptions<S, A> {
  init: S;
  reduce: (s: S, a: A) => S;
  /** 처음에 바로 적용할 동작(정적 상태·&step=). */
  prefill?: readonly A[];
  /** 동작 뒤 걸 타이머. after(ms, 동작)으로 다음 동작을 예약한다. */
  effect?: (a: A, next: S, after: After<A>) => void;
}

export function useMachine<S, A>({ init, reduce, prefill = [], effect }: MachineOptions<S, A>) {
  const [state, setState] = useState<S>(() => prefill.reduce(reduce, init));
  const ref = useRef(state);
  ref.current = state;
  const timers = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const t of timers.current) window.clearTimeout(t);
    },
    [],
  );
  const dispatch = useCallback(
    (a: A) => {
      const next = reduce(ref.current, a);
      ref.current = next;
      setState(next);
      effect?.(a, next, (ms, b) => {
        timers.current.push(window.setTimeout(() => dispatch(b), ms));
      });
    },
    // reduce·effect는 모듈 함수라 바뀌지 않는다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return [state, dispatch] as const;
}

/** ?step=<n> 값(없으면 null). */
export function useStepParam(): number | null {
  const v = new URLSearchParams(window.location.search).get("step");
  return v === null || Number.isNaN(Number(v)) ? null : Number(v);
}

/** 시나리오 대본 고르기: ?scenario=<id>가 있으면 그 대본과 &step=n(없으면 0), 없으면 정적 상태가 가리키는 대본과 n. */
export function usePrefill<A>(
  scenarios: Record<string, readonly A[]>,
  stateAt: { script: string; n: number },
): { script: string; prefill: readonly A[]; live: boolean } {
  const sc = useScenarioParam();
  const step = useStepParam();
  if (sc !== null && scenarios[sc] !== undefined) {
    const all = scenarios[sc] ?? [];
    return { script: sc, prefill: all.slice(0, step ?? 0), live: true };
  }
  const all = scenarios[stateAt.script] ?? [];
  return { script: stateAt.script, prefill: all.slice(0, stateAt.n), live: false };
}
