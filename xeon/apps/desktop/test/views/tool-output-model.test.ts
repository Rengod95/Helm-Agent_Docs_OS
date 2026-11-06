import { describe, expect, test } from "bun:test";
import { OUTPUT_VIEW_MAX_LINES, toolOutputOf } from "../../src/views/tool-output-model.ts";

const seq = (n: number): string => Array.from({ length: n }, (_, i) => String(i + 1)).join("\n");

describe("toolOutputOf", () => {
  test("short output is shown whole with no cut notice", () => {
    expect(toolOutputOf(seq(3), undefined, "[img]")).toEqual({
      text: "1\n2\n3",
      shownLines: 3,
      totalLines: null,
    });
  });

  test("a long output keeps the first lines and reports the total", () => {
    const view = toolOutputOf(seq(400), undefined, "[img]");
    expect(view.shownLines).toBe(OUTPUT_VIEW_MAX_LINES);
    expect(view.totalLines).toBe(400);
    expect(view.text.endsWith(`\n${String(OUTPUT_VIEW_MAX_LINES)}`)).toBe(true);
  });

  test("an engine-truncated result drops the English notice and reports the engine total", () => {
    const view = toolOutputOf(
      [
        { type: "text", text: seq(50) },
        { type: "text", text: "[fresnel:output_truncated] Showing the first 50 of 9000 lines" },
      ],
      { truncation: { totalLines: 9000, outputLines: 50 } },
      "[img]",
    );
    expect(view).toEqual({ text: seq(50), shownLines: 50, totalLines: 9000 });
  });
});
