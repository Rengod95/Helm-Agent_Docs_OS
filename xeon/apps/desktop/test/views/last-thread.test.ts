import { describe, expect, test } from "bun:test";
import { mayPersistSelection, restoreStepOf } from "../../src/views/last-thread.ts";

const base = {
  decided: false,
  threadsReady: true,
  selected: null,
  saved: "thr_b",
  threadIds: ["thr_a", "thr_b"],
};

describe("restoreStepOf", () => {
  test("opens the saved conversation once the list is ready", () => {
    expect(restoreStepOf(base)).toEqual({ kind: "open", threadId: "thr_b" });
  });
  test("waits for the list and never decides twice", () => {
    expect(restoreStepOf({ ...base, threadsReady: false })).toEqual({ kind: "wait" });
    expect(restoreStepOf({ ...base, decided: true })).toEqual({ kind: "wait" });
  });
  test("leaves an empty stage when the saved conversation is gone or nothing was saved", () => {
    expect(restoreStepOf({ ...base, saved: "thr_gone" })).toEqual({ kind: "none" });
    expect(restoreStepOf({ ...base, saved: null })).toEqual({ kind: "none" });
  });
  test("keeps a selection the user already made", () => {
    expect(restoreStepOf({ ...base, selected: "thr_a" })).toEqual({ kind: "none" });
  });
});

describe("mayPersistSelection", () => {
  test("does not write before the decision", () => {
    expect(mayPersistSelection({ decided: false, opening: null, selected: null })).toBe(false);
  });
  test("does not overwrite the saved id with the empty selection while restoring", () => {
    expect(mayPersistSelection({ decided: true, opening: "thr_b", selected: null })).toBe(false);
    expect(mayPersistSelection({ decided: true, opening: "thr_b", selected: "thr_b" })).toBe(true);
  });
  test("writes later changes, including closing the conversation", () => {
    expect(mayPersistSelection({ decided: true, opening: null, selected: "thr_a" })).toBe(true);
    expect(mayPersistSelection({ decided: true, opening: null, selected: null })).toBe(true);
  });
});
