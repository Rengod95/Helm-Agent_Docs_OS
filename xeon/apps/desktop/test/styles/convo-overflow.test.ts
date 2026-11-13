import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// DP-180 대화 열은 가로로 넘치지 않는다. 화면 폭 측정은 jsdom으로 할 수 없어(배치가 없다) 넘침을 막는 규칙이 convo.css에 그대로
// 있는지를 값으로 본다. 실제 폭 측정은 대화 줄 전시 화면 `?set=long`(test/showcase/transcript)을 브라우저로 열어 한다.

const CSS = readFileSync(
  join(import.meta.dir, "..", "..", "src", "views", "convo", "convo.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** 선택자 목록에 `selector`가 든 규칙들의 선언을 모아 속성 → 값으로 돌려준다(뒤의 규칙이 이긴다) */
function declarationsOf(selector: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const match of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (match[1] ?? "").split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const line of (match[2] ?? "").split(";")) {
      const at = line.indexOf(":");
      if (at < 0) continue;
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return out;
}

test("one-column grids inside a transcript row clamp their column to the row width", () => {
  for (const selector of [
    '.convo-row [data-slot="message"][data-author="agent"]',
    ".convo-card",
    ".convo-detail",
    ".convo-group-body",
  ]) {
    const d = declarationsOf(selector);
    expect({ selector, columns: d["grid-template-columns"], minWidth: d["min-width"] }).toEqual({
      selector,
      columns: "minmax(0, 1fr)",
      minWidth: "0",
    });
  }
});

test("prose breaks long unspaced runs anywhere, while code blocks keep one line and scroll", () => {
  expect(declarationsOf(".convo-prose")["overflow-wrap"]).toBe("anywhere");
  expect(declarationsOf(".convo-thinking-body")["overflow-wrap"]).toBe("anywhere");
  expect(declarationsOf(".convo-code-body")).toMatchObject({
    "white-space": "pre",
    overflow: "auto",
    "overflow-wrap": "normal",
  });
  expect(declarationsOf(".convo-table")["overflow-x"]).toBe("auto");
  expect(declarationsOf(".convo-output")).toMatchObject({
    overflow: "auto",
    "overflow-wrap": "anywhere",
  });
});

test("diff boxes, attachment chips and group meta shrink to the column", () => {
  expect(declarationsOf(".convo-diff")).toMatchObject({ "min-width": "0", "max-width": "100%" });
  expect(declarationsOf('.convo-attachments [data-slot="chip"]')).toMatchObject({
    "min-width": "0",
    "max-width": "100%",
  });
  expect(declarationsOf('[data-slot="convo-group-meta"]')).toMatchObject({
    "min-width": "0",
    "text-overflow": "ellipsis",
  });
});
