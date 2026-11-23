import { describe, expect, test } from "bun:test";
import {
  OUTPUT_VIEW_MAX_LINES,
  stripAnsi,
  toolOutputOf,
} from "../../src/views/tool-output-model.ts";

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

  test("the new one-line notice is dropped the same way", () => {
    const view = toolOutputOf(
      [
        { type: "text", text: seq(50) },
        {
          type: "text",
          text: "[Showing lines 1-50 of 9,000. Full output: /state/spill/tool-output/t/h.txt]",
        },
      ],
      { truncation: { totalLines: 9000, outputLines: 50 } },
      "[img]",
    );
    expect(view).toEqual({ text: seq(50), shownLines: 50, totalLines: 9000 });
  });
});

// chatQa: 터미널 색·커서 순서는 빼고 글만 보인다. 빼지 않으면 ESC는 안 보이고 `[31m` 꼬리가 출력에 남았다
describe("stripAnsi", () => {
  const E = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  test("color and cursor sequences are removed, text stays", () => {
    expect(stripAnsi(`${E}[31mERROR${E}[0m ${E}[1;33mwarn${E}[0m\n${E}[2K${E}[1Gok`)).toBe(
      "ERROR warn\nok",
    );
  });
  test("OSC hyperlinks and titles are removed with either terminator", () => {
    expect(
      stripAnsi(`${E}]8;;https://example.com${BEL}link${E}]8;;${BEL} ${E}]0;title${E}\\done`),
    ).toBe("link done");
  });
  test("charset escapes and a dangling ESC at the end are removed, a lone ESC goes by itself", () => {
    expect(stripAnsi(`a${E}(Bb${E}`)).toBe("ab");
    expect(stripAnsi(`d${E}e`)).toBe("de");
  });
  test("plain text is returned as is", () => {
    expect(stripAnsi("plain [31m text")).toBe("plain [31m text");
  });
  test("tool output passes through the same cleaning", () => {
    expect(toolOutputOf(`${E}[32mok${E}[0m`, undefined, "[img]").text).toBe("ok");
  });
});
