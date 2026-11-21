import { expect, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CallChip } from "../../src/views/call-chip.tsx";
import { ToneGlyph, type ToneName } from "../../src/views/craft/review/review-glyphs.tsx";
import { read, SRC } from "../styles/source-scan.ts";

// 알림 그림의 바탕 선(m6R7, AGE-34): 직접 그린 알림 그림은 한 벌(`line-glyph`)에서 선을 받고, 굵기는 CSS 변수 하나(화면 1.15px)다.

/** 그림 뿌리 svg의 [class, fill, stroke, 선 끝, 이음, stroke-width 속성 수] */
function rootOf(html: string): readonly (string | number | null)[] {
  const svg = /<svg\b[^>]*>/.exec(html)?.[0] ?? "";
  const attr = (name: string): string | null =>
    new RegExp(`\\s${name}="([^"]*)"`).exec(svg)?.[1] ?? null;
  return [
    attr("class"),
    attr("fill"),
    attr("stroke"),
    attr("stroke-linecap"),
    attr("stroke-linejoin"),
    (html.match(/stroke-width=/g) ?? []).length,
  ];
}

/** 칩 안의 첫 그림 */
function glyph(html: string): string {
  return /<svg\b[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
}

test("every review notice glyph takes the shared line style and carries no own stroke width", () => {
  const tones: readonly ToneName[] = ["info", "warning", "danger", "success", "neutral"];
  expect(tones.map((tone) => rootOf(renderToStaticMarkup(<ToneGlyph tone={tone} />)))).toEqual(
    tones.map(() => ["line-glyph", "none", "currentColor", "round", "round", 0]),
  );
});

test("the call chip failure glyphs take the same line style as the review glyphs", () => {
  const failed = renderToStaticMarkup(<CallChip status="failed" label="Failed" />);
  const denied = renderToStaticMarkup(<CallChip status="failed" tone="warning" label="Denied" />);
  expect([rootOf(glyph(failed)), rootOf(glyph(denied))]).toEqual([
    ["line-glyph call-chip-icon", "none", "currentColor", "round", "round", 0],
    ["line-glyph call-chip-icon", "none", "currentColor", "round", "round", 0],
  ]);
});

test("the line width is one screen-pixel value next to the empty-state art, kept on every glyph size", () => {
  const css = read(join(SRC, "views/illustrations/illustrations.css"));
  expect([
    /--line-glyph-width:\s*([\d.]+px)/.exec(css)?.[1],
    /\.line-glyph\s*\{\s*stroke-width:\s*var\(--line-glyph-width\);\s*\}/.test(css),
    /\.line-glyph :is\(path, rect, circle\)\s*\{\s*vector-effect:\s*non-scaling-stroke;\s*\}/.test(
      css,
    ),
  ]).toEqual(["1.15px", true, true]);
});
