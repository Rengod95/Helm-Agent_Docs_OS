import { describe, expect, test } from "bun:test";
import {
  focusAfterApprovalChange,
  focusAfterTurnEnd,
  focusIsLost,
  nextApprovalId,
} from "../../src/views/approval-focus-model.ts";

describe("nextApprovalId (approval.next)", () => {
  test("nothing pending gives no card, focused or not", () => {
    expect(nextApprovalId<string>([], null)).toBeNull();
    expect(nextApprovalId<string>([], "alpha")).toBeNull();
  });

  test("without a focused card the first pending card is next", () => {
    expect(nextApprovalId(["alpha", "bravo", "charlie"], null)).toBe("alpha");
  });

  test("a focused card that is not pending starts again from the first", () => {
    expect(nextApprovalId(["alpha", "bravo", "charlie"], "delta")).toBe("alpha");
  });

  test("moves forward in mirror order and wraps after the last card", () => {
    const pending = ["alpha", "bravo", "charlie"];
    expect(nextApprovalId(pending, "alpha")).toBe("bravo");
    expect(nextApprovalId(pending, "bravo")).toBe("charlie");
    expect(nextApprovalId(pending, "charlie")).toBe("alpha");
  });

  test("a single pending card is its own next", () => {
    expect(nextApprovalId(["alpha"], "alpha")).toBe("alpha");
    expect(nextApprovalId(["alpha"], null)).toBe("alpha");
  });
});

describe("focus return (scD 1-1)", () => {
  test("answering the only card sends focus to the composer", () => {
    expect(focusAfterApprovalChange(["alpha"], [], true)).toEqual({ kind: "composer" });
  });

  test("the next card after the removed one gets focus, else the first remaining", () => {
    expect(focusAfterApprovalChange(["a", "b", "c"], ["a", "c"], true)).toEqual({
      kind: "card",
      id: "c",
    });
    expect(focusAfterApprovalChange(["a", "b", "c"], ["a", "b"], true)).toEqual({
      kind: "card",
      id: "a",
    });
  });

  test("nothing happens when focus is elsewhere or no card went away", () => {
    expect(focusAfterApprovalChange(["a", "b"], ["b"], false)).toBeNull();
    expect(focusAfterApprovalChange(["a"], ["a", "b"], true)).toBeNull();
  });

  test("focus is lost only on BODY or nothing", () => {
    expect(focusIsLost(null)).toBe(true);
    expect(focusIsLost({ tagName: "BODY" })).toBe(true);
    expect(focusIsLost({ tagName: "TEXTAREA" })).toBe(false);
  });

  test("the composer is focused when a turn ends with lost focus", () => {
    expect(focusAfterTurnEnd(true, false, true)).toBe(true);
    expect(focusAfterTurnEnd(true, false, false)).toBe(false);
    expect(focusAfterTurnEnd(false, false, true)).toBe(false);
    expect(focusAfterTurnEnd(true, true, true)).toBe(false);
  });
});
