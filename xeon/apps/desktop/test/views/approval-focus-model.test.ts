import { describe, expect, test } from "bun:test";
import { nextApprovalId } from "../../src/views/approval-focus-model.ts";

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
