import { describe, expect, test } from "bun:test";
import { CHILD_ROW } from "../../src/views/thread-list.tsx";

describe("하위 대화 행 배치", () => {
  test("the indent is taken out of the row width so the trailing badge is not clipped", () => {
    expect(CHILD_ROW.split(" ")).toEqual(["ms-4", "w-auto", "max-w-[calc(100%-1rem)]"]);
  });
});
