// src/state/shared/pipeline.ts
import { Bug, type Clock } from "@xeon/contracts";
import type { Journal, JournalLabel } from "./journal.ts";

export type Reduced<S, N extends string> = { readonly state: S; readonly note: N };
export type Reducer<S, I, N extends string> = (state: S, input: I) => Reduced<S, N>;
/** 미들웨어 단계. 다음 reducer를 받아 같은 모양의 reducer를 돌려준다 */
export type Stage<S, I, N extends string> = (next: Reducer<S, I, N>) => Reducer<S, I, N>;

/** stages는 바깥 단계부터 적는다. [a, b, c]는 a(b(c(base)))다 */
export function pipeline<S, I, N extends string>(
  base: Reducer<S, I, N>,
  stages: readonly Stage<S, I, N>[],
): Reducer<S, I, N> {
  return stages.reduceRight<Reducer<S, I, N>>((next, stage) => stage(next), base);
}

/** 입력과 결과를 메타데이터만 기록한다. 내용은 describe가 고른 필드만 들어가고, null이면 기록하지 않는다 */
export function journalStage<S, I, N extends string>(
  journal: Journal<N>,
  clock: Clock,
  describe: (input: I, note: N) => JournalLabel | null,
): Stage<S, I, N> {
  return (next) => (state, input) => {
    const reduced = next(state, input);
    const label = describe(input, reduced.note);
    if (label !== null)
      journal.record({ kind: "input", at: clock.now(), ...label, note: reduced.note });
    return reduced;
  };
}

/** reducer가 던지면 이전 상태를 recover로 바꿔 돌려주고 실패를 알린다. 화면 구독은 계속 산다 */
export function guardStage<S, I, N extends string>(
  recover: (state: S) => Reduced<S, N>,
  onFailure: (cause: unknown, input: I) => void,
): Stage<S, I, N> {
  return (next) => (state, input) => {
    try {
      return next(state, input);
    } catch (cause) {
      onFailure(cause, input);
      return recover(state);
    }
  };
}

/** 개발·시험 빌드에서만 넣는다. 결과 상태가 불변식을 어기면 Bug를 던져 guard가 받게 한다 */
export function invariantStage<S, I, N extends string>(
  check: (state: S) => readonly string[],
): Stage<S, I, N> {
  return (next) => (state, input) => {
    const reduced = next(state, input);
    const problems = check(reduced.state);
    if (problems.length > 0) {
      throw new Bug(`state invariant violated: ${problems.join("; ")}`);
    }
    return reduced;
  };
}
