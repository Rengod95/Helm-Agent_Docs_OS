import { expect, test } from "bun:test";
import { PrimitiveError } from "@fresnel/ext-host";
import { commitFresh, type LearningApi } from "../src/handlers.ts";
import { INITIAL_LEARNING_STATE, type LearningState } from "../src/state.ts";
import { partial } from "./support/unsafe.ts";

/** 처음 `conflicts`번은 다른 커밋이 먼저 들어간 것처럼 판 충돌을 내는 상태 대역 */
function conflictingApi(conflicts: number): {
  readonly g: Pick<LearningApi, "state" | "commit">;
  readonly committed: LearningState[];
} {
  let current = INITIAL_LEARNING_STATE;
  let left = conflicts;
  const committed: LearningState[] = [];
  const g = partial<Pick<LearningApi, "state" | "commit">>({
    state: () => current,
    commit: (next) => {
      if (left > 0) {
        left -= 1;
        current = { ...current, settledReviewId: "rev_other" };
        return Promise.reject(
          new PrimitiveError("state_conflict", "state of x changed; read it again"),
        );
      }
      current = next;
      committed.push(next);
      return Promise.resolve(next);
    },
  });
  return { g, committed };
}

test("commit-conflict.retries-with-the-latest-state: a state_conflict rebuilds the value from the fresh state and commits it", async () => {
  const { g, committed } = conflictingApi(1);
  const first: LearningState = { ...INITIAL_LEARNING_STATE, epoch: 1, inFlightReviewId: "rev_a" };
  await commitFresh(g, first, (latest) => ({ ...first, settledReviewId: latest.settledReviewId }));
  expect(committed).toEqual([{ ...first, settledReviewId: "rev_other" }]);
});

test("commit-conflict.stops-when-rebuild-gives-up", async () => {
  const { g, committed } = conflictingApi(1);
  await commitFresh(g, { ...INITIAL_LEARNING_STATE, epoch: 1 }, () => null);
  expect(committed).toEqual([]);
});

test("commit-conflict.gives-up-after-three-attempts-and-rethrows", async () => {
  const { g } = conflictingApi(5);
  const first: LearningState = { ...INITIAL_LEARNING_STATE, epoch: 2 };
  const result = await commitFresh(g, first, () => first).then(
    () => "committed",
    (cause: unknown) => (cause instanceof PrimitiveError ? cause.code : "other"),
  );
  expect(result).toBe("state_conflict");
});
