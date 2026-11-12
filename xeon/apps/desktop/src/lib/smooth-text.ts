// 흐르는 답의 글을 일정한 박자로 드러내는 완충(dzE 시안 §5, DP-129 [결정: 2026-11-12 사용자]).
// 받은 글(target)을 그대로 그리면 빠른 모델의 조각이 덩어리로 튀어나와 버벅여 보인다. 그린 길이(shown)와 받은 길이의 차이로 속도를 정한다:
// 기본 BASE_CPS, 밀린 양이 많으면 더 빠르게, 받은 조각은 받은 뒤 MAX_LAG_S 안에 다 드러낸다(화면이 실제보다 그만큼 넘게 뒤처지지 않게). 다 따라잡으면 멈춘다.
// 끝나면(확정) 남은 글을 DRAIN_S 안에 마저 흘린다. 드러난 끝이 마크다운 블록 표식(울타리, 표 행, 목록·제목 표식) 안이면 그 표식을 한 번에 드러내
// 흐르는 동안 블록 모양이 바뀌며 튀지 않게 한다. 그림 갱신은 RENDER_MS마다 한 번(매 프레임 마크다운을 다시 파싱하지 않게).
// 움직임 줄이기에서는 완충 없이 바로 그린다. 순수 함수(`paceStep`, `revealEndOf`)는 화면 밖에서 시험한다.

import { useEffect, useRef, useState } from "react";
import { isMotionReduced } from "./motion-presets.tsx";

/** 밀린 것이 적을 때의 속도(글자/초) */
export const BASE_CPS = 90;
/** 화면이 받은 글보다 뒤처지는 시간의 상한(초) */
export const MAX_LAG_S = 0.35;
/** 끝난 뒤 남은 글을 마저 흘리는 시간(초) */
const DRAIN_S = 0.25;
/** 그림 갱신 간격(ms). 약 30Hz */
const RENDER_MS = 32;
/** 흐르는 중에 처음 그려질 때 이보다 긴 글은 다시 흘리지 않고 바로 보인다(첫 조각만 흘린다) */
const REPLAY_LIMIT = 160;

export type PaceState = {
  /** 드러낸 길이(소수 포함: 프레임 사이 남은 몫을 쌓는다) */
  readonly shown: number;
};

/** 받은 조각 하나: 받은 시각(ms)과 그때까지 받은 길이 */
export type Arrival = { readonly at: number; readonly len: number };

/**
 * 한 프레임(dtMs) 동안 드러낼 길이. target 길이를 넘지 않고 줄지 않는다.
 * 속도는 기본 BASE_CPS, 밀린 양 / MAX_LAG_S, 그리고 아직 다 드러내지 못한 조각마다 "받은 뒤 MAX_LAG_S 안에" 드러낼 속도 중 가장 큰 것이다
 * (밀린 양만 보면 따라잡기가 지수로 느려져 끝에서 상한을 넘는다). 끝나면 남은 것을 DRAIN_S 안에
 */
export function paceStep(
  state: PaceState,
  input: {
    readonly target: number;
    readonly dtMs: number;
    readonly done: boolean;
    readonly now?: number;
    readonly arrivals?: readonly Arrival[];
  },
): PaceState {
  const backlog = Math.max(0, input.target - state.shown);
  if (backlog === 0) return { shown: Math.min(state.shown, input.target) };
  const dt = Math.max(0, Math.min(input.dtMs, 100)) / 1000;
  let rate = Math.max(BASE_CPS, backlog / MAX_LAG_S);
  const now = input.now ?? 0;
  for (const arrival of input.arrivals ?? []) {
    if (arrival.len <= state.shown) continue;
    const left = Math.max(dt, (arrival.at - now) / 1000 + MAX_LAG_S);
    rate = Math.max(rate, (Math.min(arrival.len, input.target) - state.shown) / left);
  }
  if (input.done) rate = Math.max(rate, backlog / DRAIN_S);
  return { shown: Math.min(input.target, state.shown + rate * dt) };
}

// 백틱은 \x60으로 쓴다(check-ts-rules의 토큰 검사가 정규식 안의 백틱을 템플릿 시작으로 읽는다. markdown-stream.ts와 같다)
const MARKER_LINE = /^ {0,3}(?:[\x60~]|\|)/;
const MARKER_HEAD = /^ {0,3}(?:[-*+]|\d{1,9}[.)]?|#{1,6})$/;

/**
 * 길이 `n`까지 드러낼 때 실제로 끊을 자리. 서로게이트 쌍 가운데를 자르지 않고,
 * 마지막 줄이 울타리·표 행이면 받은 글에 그 줄 끝이 있을 때 줄 끝까지, 목록·제목 표식만 있으면 표식 뒤 빈칸까지 넓힌다
 */
export function revealEndOf(text: string, n: number): number {
  let end = Math.max(0, Math.min(text.length, Math.floor(n)));
  if (end > 0 && end < text.length) {
    const code = text.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end += 1;
  }
  if (end >= text.length) return text.length;
  const lineStart = text.lastIndexOf("\n", end - 1) + 1;
  const partial = text.slice(lineStart, end);
  if (partial === "") return end;
  if (MARKER_LINE.test(partial)) {
    const lineEnd = text.indexOf("\n", end);
    return lineEnd === -1 ? end : lineEnd + 1;
  }
  if (MARKER_HEAD.test(partial)) {
    const rest = /^[^\s]*\s/.exec(text.slice(end));
    return rest === null ? end : end + rest[0].length;
  }
  return end;
}

/**
 * 흐르는 글을 박자에 맞춰 드러낸다. `streaming`이 처음부터 거짓이면(기록을 다시 그림) 완충하지 않는다.
 * 흐르던 글이 확정되어도(streaming이 거짓이 됨) 남은 것을 마저 흘린다
 */
export function useSmoothText(text: string, streaming: boolean): string {
  // 완충할지는 처음 그릴 때 한 번 정한다(흐르는 중에 처음 그려졌는가)
  const [smooth] = useState(
    () => streaming && typeof requestAnimationFrame === "function" && !isMotionReduced(),
  );
  // 흐르는 중간에 처음 그려지면(다른 대화에서 돌아옴, 가상 목록이 다시 붙임) 이미 받은 글은 바로 보이고 그 뒤부터 흐른다
  const [start] = useState(() => (smooth && text.length > REPLAY_LIMIT ? text.length : 0));
  const shown = useRef(smooth ? start : text.length);
  const [end, setEnd] = useState(smooth ? start : text.length);
  const latest = useRef({ text, streaming });
  latest.current = { text, streaming };
  // 받은 조각의 시각. 받은 뒤 MAX_LAG_S 안에 드러내는 기준이다
  const arrivals = useRef<Arrival[]>([]);
  const lastLen = useRef(text.length);
  if (text.length > lastLen.current && smooth) {
    arrivals.current.push({ at: performance.now(), len: text.length });
  }
  lastLen.current = text.length;
  const behind = smooth && end < text.length;
  useEffect(() => {
    if (!behind) return undefined;
    let frame = 0;
    let last = performance.now();
    let rendered = last;
    const tick = (now: number): void => {
      const { text: target, streaming: live } = latest.current;
      arrivals.current = arrivals.current.filter((arrival) => arrival.len > shown.current);
      const next = paceStep(
        { shown: shown.current },
        {
          target: target.length,
          dtMs: now - last,
          done: !live || isMotionReduced(),
          now,
          arrivals: arrivals.current,
        },
      );
      last = now;
      shown.current = isMotionReduced() ? target.length : next.shown;
      const caught = shown.current >= target.length;
      if (caught || now - rendered >= RENDER_MS) {
        rendered = now;
        setEnd(revealEndOf(target, shown.current));
      }
      if (!caught) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [behind]);
  if (!smooth) return text;
  return text.slice(0, Math.min(end, text.length));
}
