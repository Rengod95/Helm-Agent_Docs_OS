// 트레이스 화면(C8)이 펼칠 턴. 트레이스는 내비 항목이 아니라 목적 화면이라, 여는 쪽(메트릭의 근거 줄, 대화의 "이 턴 기록")이
// 여기에 턴을 두고 화면을 옮긴다. 화면 위치 값(`AreaPlace`)에는 화면 id만 있어서 턴은 이 작은 저장소가 든다.
// 대화 화면의 "이 턴 기록"은 `openTrace({ threadId, turnId, from: "chat" })`를 부르고 Craft의 `trace` 화면으로 옮기면 된다.
import { useSyncExternalStore } from "react";

export interface TraceTarget {
  readonly threadId: string;
  readonly turnId: string;
  /** 어디서 왔나. "돌아가기" 단추가 이 자리로 간다 */
  readonly from: "metrics" | "chat" | "test" | "trace";
}

let current: TraceTarget | null = null;
const listeners = new Set<() => void>();

export function openTrace(target: TraceTarget): void {
  current = target;
  for (const listener of listeners) listener();
}

function traceTarget(): TraceTarget | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTraceTarget(): TraceTarget | null {
  return useSyncExternalStore(subscribe, traceTarget, traceTarget);
}
