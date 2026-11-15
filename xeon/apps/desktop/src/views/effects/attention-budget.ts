// 살아 움직이는 표시의 수 상한(DP-190). 화면 전체에서 움직이는 주의 구슬은 3개, 진행 구슬은 8개, 흐르는 카드 오로라는 1개까지다.
// 먼저 붙은 것이 자리를 받고, 자리를 가진 것이 떨어지면 다음 것이 받는다. 나머지는 같은 모양으로 멈춰 있다.
// 상태는 모듈 하나가 가진다(부품마다 따로 세면 상한이 안 된다). 움직임 줄이기면 아무도 움직이지 않는다.

import { useEffect, useId, useSyncExternalStore } from "react";
import { useMotionReduced } from "../../lib/motion-presets.tsx";

/**
 * mark 주의 구슬(AttentionMark), progress 진행 구슬(ProgressOrb), card 카드 오로라(AttendGlow),
 * thinking 생각 구슬(ThinkingIndicator, DP-208). 생각 구슬은 전에도 상한 밖이었다(라이브러리 부품): 화면에 하나둘뿐이고 지금 일하는 중임을 말하므로 멈추지 않는다
 */
export type AttentionLiveKind = "mark" | "progress" | "card" | "thinking";

/** 종류마다 동시에 움직일 수 있는 수 */
export const ATTENTION_LIVE_LIMIT: Readonly<Record<AttentionLiveKind, number>> = {
  mark: 3,
  progress: 8,
  card: 1,
  thinking: Number.POSITIVE_INFINITY,
};

const queues: Record<AttentionLiveKind, string[]> = {
  mark: [],
  progress: [],
  card: [],
  thinking: [],
};
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 자리를 줄 세운다. 이미 서 있으면 그대로 */
export function joinAttentionLive(kind: AttentionLiveKind, token: string): void {
  const queue = queues[kind];
  if (queue.includes(token)) return;
  queue.push(token);
  notify();
}

/** 줄에서 뺀다. 뒤에 선 것이 앞으로 온다 */
export function leaveAttentionLive(kind: AttentionLiveKind, token: string): void {
  const queue = queues[kind];
  const at = queue.indexOf(token);
  if (at < 0) return;
  queue.splice(at, 1);
  notify();
}

/** 이 자리가 움직여도 되는지(줄에서 상한 안에 섰는지) */
export function isAttentionLive(kind: AttentionLiveKind, token: string): boolean {
  const at = queues[kind].indexOf(token);
  return at >= 0 && at < ATTENTION_LIVE_LIMIT[kind];
}

/** 부품 하나가 움직일 자리를 청한다. `wanted`가 false면 줄에 서지 않는다 */
export function useAttentionLive(kind: AttentionLiveKind, wanted: boolean): boolean {
  const token = useId();
  const reduced = useMotionReduced();
  const want = wanted && !reduced;
  useEffect(() => {
    if (!want) return undefined;
    joinAttentionLive(kind, token);
    return () => {
      leaveAttentionLive(kind, token);
    };
  }, [kind, token, want]);
  const live = useSyncExternalStore(
    subscribe,
    () => isAttentionLive(kind, token),
    () => false,
  );
  return want && live;
}
