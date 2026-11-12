import { describe, expect, test } from "bun:test";
import {
  BASE_CPS,
  MAX_LAG_S,
  paceStep,
  revealEndOf,
  type Arrival,
} from "../../src/lib/smooth-text.ts";

// 흐르는 답의 완충(dzE 시안 §5, DP-129)

/** 조각이 `chunk`자씩 `everyMs`마다 오는 흐름을 16.7ms 프레임으로 돌려 프레임마다 드러난 길이와 가장 큰 지연(ms)을 낸다 */
function simulate(
  chunk: number,
  everyMs: number,
  totalChars: number,
): { readonly shown: number[]; readonly worstLagMs: number } {
  const frame = 1000 / 60;
  let target = 0;
  let state = { shown: 0 };
  const arrivals: Arrival[] = [];
  const shown: number[] = [];
  let worstLagMs = 0;
  for (let t = 0; t < 8000; t += frame) {
    const next = Math.min(totalChars, Math.floor(t / everyMs + 1) * chunk);
    if (next > target) arrivals.push({ at: t, len: next });
    target = next;
    state = paceStep(state, { target, dtMs: frame, done: false, now: t, arrivals });
    shown.push(Math.floor(state.shown));
    for (const a of arrivals)
      if (a.len > state.shown + 1e-9) worstLagMs = Math.max(worstLagMs, t - a.at);
    if (target >= totalChars && state.shown >= totalChars) break;
  }
  return { shown, worstLagMs };
}

describe("paceStep", () => {
  test("밀린 것이 적으면 기본 속도로, 받은 길이를 넘지 않는다", () => {
    expect(paceStep({ shown: 0 }, { target: 10, dtMs: 100, done: false }).shown).toBe(9);
    expect(paceStep({ shown: 9 }, { target: 10, dtMs: 100, done: false }).shown).toBe(10);
    expect(paceStep({ shown: 10 }, { target: 10, dtMs: 16, done: false }).shown).toBe(10);
  });

  test("밀린 양이 많으면 지연 상한(0.35s)에 맞춰 빨라진다", () => {
    const next = paceStep({ shown: 0 }, { target: 700, dtMs: 100, done: false });
    expect(next.shown).toBe((700 / MAX_LAG_S) * 0.1);
  });

  test("끝나면 남은 글을 0.25초 안에 마저 흘린다", () => {
    const next = paceStep({ shown: 0 }, { target: 50, dtMs: 50, done: true });
    expect(next.shown).toBe(10);
    expect(BASE_CPS).toBe(90);
  });

  test("한 프레임 간격은 100ms로 자른다(가려졌다 돌아온 창이 한 번에 쏟지 않게)", () => {
    expect(paceStep({ shown: 0 }, { target: 10_000, dtMs: 5000, done: false }).shown).toBeCloseTo(
      (10_000 / MAX_LAG_S) * 0.1,
    );
  });

  test("덩어리로 오는 흐름(250ms마다 60자)을 고르게 편다: 프레임당 추가 글자의 표준편차가 원래의 1/4 밑", () => {
    const { shown } = simulate(60, 250, 1200);
    const steps = shown.slice(1).map((v, i) => v - (shown[i] ?? 0));
    const active = steps.slice(5, steps.length - 15);
    const mean = active.reduce((a, b) => a + b, 0) / active.length;
    const sd = Math.sqrt(active.reduce((a, b) => a + (b - mean) ** 2, 0) / active.length);
    // 완충 없이 그리면 15프레임 중 한 프레임에 60자, 나머지는 0이다
    const rawSd = Math.sqrt((60 - 4) ** 2 / 15 + (14 * 4 ** 2) / 15);
    expect(sd).toBeLessThan(rawSd / 4);
  });

  test("받은 조각은 받은 뒤 0.35초(+한 프레임) 안에 다 보인다: 덩어리 흐름, 아주 빠른 흐름, 느린 흐름", () => {
    for (const [chunk, every] of [
      [60, 250],
      [400, 100],
      [5, 120],
    ] as const) {
      expect(simulate(chunk, every, 1200).worstLagMs).toBeLessThanOrEqual(
        MAX_LAG_S * 1000 + 1000 / 60,
      );
    }
  });
});

describe("revealEndOf", () => {
  test("보통 글은 그 자리에서 끊는다", () => {
    expect(revealEndOf("안녕하세요 반가워요", 3)).toBe(3);
  });

  test("서로게이트 쌍 가운데를 자르지 않는다", () => {
    const text = "a😀b";
    expect(revealEndOf(text, 2)).toBe(3);
  });

  test("울타리 줄은 받은 줄 끝까지 한 번에 드러낸다(인라인 코드로 깜빡이지 않게)", () => {
    const text = "앞 문단\n```ts\nconst a = 1;\n";
    expect(revealEndOf(text, 6)).toBe(11);
    // 줄 끝이 아직 안 왔으면 그대로
    expect(revealEndOf("앞\n``", 3)).toBe(3);
  });

  test("표 행은 줄 끝까지, 목록·제목 표식은 뒤 빈칸까지 넓힌다", () => {
    expect(revealEndOf("| a | b |\n|---|---|\n", 3)).toBe(10);
    expect(revealEndOf("문단\n- 항목", 4)).toBe(5);
    expect(revealEndOf("## 제목", 1)).toBe(3);
  });
});
