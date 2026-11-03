import { describe, expect, test } from "bun:test";
import { stepThreadId } from "../../src/views/thread-step-model.ts";

describe("stepThreadId (thread.next / thread.prev)", () => {
  test("an empty list gives no thread", () => {
    expect(stepThreadId<string>([], null, 1)).toBeNull();
    expect(stepThreadId<string>([], "alpha", -1)).toBeNull();
  });

  test("with nothing selected, next is the first thread and prev is the last", () => {
    const ids = ["alpha", "bravo", "charlie"];
    expect(stepThreadId(ids, null, 1)).toBe("alpha");
    expect(stepThreadId(ids, null, -1)).toBe("charlie");
  });

  test("moves through the sidebar order and wraps at both ends", () => {
    const ids = ["alpha", "bravo", "charlie"];
    expect(stepThreadId(ids, "alpha", 1)).toBe("bravo");
    expect(stepThreadId(ids, "bravo", 1)).toBe("charlie");
    expect(stepThreadId(ids, "charlie", 1)).toBe("alpha");
    expect(stepThreadId(ids, "alpha", -1)).toBe("charlie");
    expect(stepThreadId(ids, "charlie", -1)).toBe("bravo");
  });

  test("a selected thread that is not listed starts from the ends", () => {
    const ids = ["alpha", "bravo"];
    expect(stepThreadId(ids, "delta", 1)).toBe("alpha");
    expect(stepThreadId(ids, "delta", -1)).toBe("bravo");
  });

  test("a single thread is its own neighbour", () => {
    expect(stepThreadId(["alpha"], "alpha", 1)).toBe("alpha");
    expect(stepThreadId(["alpha"], "alpha", -1)).toBe("alpha");
  });
});
