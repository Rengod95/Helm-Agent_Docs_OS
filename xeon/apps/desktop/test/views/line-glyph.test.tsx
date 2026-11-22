import { expect, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CallChip, CallMark } from "../../src/views/call-chip.tsx";
import { KIND_PATHS } from "../../src/views/craft/kind-paths.ts";
import { KindGlyph as MetricsKindGlyph } from "../../src/views/craft/metrics/glyphs.tsx";
import {
  KindGlyph as ReviewKindGlyph,
  ToneGlyph,
  type ToneName,
} from "../../src/views/craft/review/review-glyphs.tsx";
import { octagonPath } from "../../src/views/illustrations/line-glyph.ts";
import { read, SRC } from "../styles/source-scan.ts";

// 직접 그린 아이콘의 바탕 선(m6R7, AGE-34): 알림 그림·도구 줄 실패 그림·종류 그림은 한 벌(`line-glyph`)에서 선을 받고,
// 굵기는 CSS 변수 하나(화면 1px [결정: 2026-11-22 사용자 "다 1px기준으로"])다.

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

/** 그림 안 path의 획들 */
function paths(html: string): readonly string[] {
  return [...html.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** 그림 뿌리 svg의 속성 하나 */
function rootAttr(html: string, name: string): string | null {
  const svg = /<svg\b[^>]*>/.exec(html)?.[0] ?? "";
  return new RegExp(`\\s${name}="([^"]*)"`).exec(svg)?.[1] ?? null;
}

test("the call failure glyphs are stop octagons in the shared line style: a bar for a failure, a slash for a policy denial, no ring or exclamation", () => {
  const shots = [
    renderToStaticMarkup(<CallChip status="failed" label="Failed" />),
    renderToStaticMarkup(<CallChip status="failed" tone="warning" label="Denied" />),
    renderToStaticMarkup(<CallMark status="failed" label="Failed" />),
    renderToStaticMarkup(<CallMark status="failed" tone="warning" label="Denied" />),
  ].map(glyph);
  expect(
    shots.map((html) => [
      ...rootOf(html),
      rootAttr(html, "data-call-glyph"),
      rootAttr(html, "viewBox"),
      /<circle\b/.test(html),
      /h\.01/.test(html),
    ]),
  ).toEqual([
    [
      "line-glyph call-chip-icon",
      "none",
      "currentColor",
      "round",
      "round",
      0,
      "failed",
      "0 0 12 12",
      false,
      false,
    ],
    [
      "line-glyph call-chip-icon",
      "none",
      "currentColor",
      "round",
      "round",
      0,
      "denied",
      "0 0 12 12",
      false,
      false,
    ],
    [
      "line-glyph call-chip-icon",
      "none",
      "currentColor",
      "round",
      "round",
      0,
      "failed",
      "0 0 14 14",
      false,
      false,
    ],
    [
      "line-glyph call-chip-icon",
      "none",
      "currentColor",
      "round",
      "round",
      0,
      "denied",
      "0 0 14 14",
      false,
      false,
    ],
  ]);
  expect(shots[0]).toContain(`d="${octagonPath(1.5, 10.5, 2.65, 0.45)}"`);
  expect(shots[2]).toContain(`d="${octagonPath(1.5, 12.5, 3.25, 0.5)}"`);
});

test("the stop octagon rounds each of its eight corners and keeps its straight edges on the given lines", () => {
  expect(octagonPath(2, 14, 3.5, 0.6)).toBe(
    "M6.1 2 L9.9 2 Q10.5 2 10.92 2.42 L13.58 5.08 Q14 5.5 14 6.1 L14 9.9 Q14 10.5 13.58 10.92 L10.92 13.58 Q10.5 14 9.9 14 L6.1 14 Q5.5 14 5.08 13.58 L2.42 10.92 Q2 10.5 2 9.9 L2 6.1 Q2 5.5 2.42 5.08 L5.08 2.42 Q5.5 2 6.1 2Z",
  );
});

test("the review and metrics kind glyphs draw the same strokes from one table in the shared line style", () => {
  const kinds = ["inject", "hook", "drive", "tool"] as const;
  const review = kinds.map((kind) => renderToStaticMarkup(<ReviewKindGlyph kind={kind} />));
  const metrics = [...kinds, "block" as const].map((kind) =>
    renderToStaticMarkup(<MetricsKindGlyph kind={kind} />),
  );
  expect(
    review.map((html) => ({ root: rootOf(html), kind: rootAttr(html, "data-kind-glyph") })),
  ).toEqual(
    kinds.map((kind) => ({
      root: ["line-glyph", "none", "currentColor", "round", "round", 0],
      kind,
    })),
  );
  expect(review.map(paths)).toEqual(kinds.map((kind) => KIND_PATHS[kind]));
  expect(metrics.map(paths)).toEqual([...kinds, "block" as const].map((kind) => KIND_PATHS[kind]));
  expect(metrics.map((html) => rootOf(html)[0])).toEqual(
    Array.from({ length: 5 }, () => "line-glyph"),
  );
});

test("the line width is one screen pixel, kept on every glyph size", () => {
  const css = read(join(SRC, "views/illustrations/illustrations.css"));
  expect([
    /--line-glyph-width:\s*([\d.]+px)/.exec(css)?.[1],
    /\.line-glyph\s*\{\s*stroke-width:\s*var\(--line-glyph-width\);\s*\}/.test(css),
    /\.line-glyph :is\(path, rect, circle\)\s*\{\s*vector-effect:\s*non-scaling-stroke;\s*\}/.test(
      css,
    ),
  ]).toEqual(["1px", true, true]);
});
