import { expect, test } from "bun:test";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { MeasureRow } from "@fresnel/contracts/wire";
import { CallChip, CallMark } from "../../src/views/call-chip.tsx";
import { ProfileGlyph } from "../../src/views/convo/profile-glyph.tsx";
import { KIND_PATHS } from "../../src/views/craft/kind-paths.ts";
import { MiniLine } from "../../src/views/craft/metrics/charts.tsx";
import { KindGlyph as MetricsKindGlyph } from "../../src/views/craft/metrics/glyphs.tsx";
import {
  KindGlyph as ReviewKindGlyph,
  ToneGlyph,
  type ToneName,
} from "../../src/views/craft/review/review-glyphs.tsx";
import { DrawnCheck } from "../../src/views/effects/drawn-check.tsx";
import { InboxArt } from "../../src/views/illustrations/index.tsx";
import { LensArt } from "../../src/views/illustrations/lens-art.tsx";
import { octagonPath } from "../../src/views/illustrations/line-glyph.ts";
import { RequestArt } from "../../src/views/illustrations/request-art.tsx";
import { PerfView } from "../../src/views/measure/perf-view.tsx";
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
    /\.line-glyph :is\(path, rect, circle, ellipse, line, polyline, polygon\)\s*\{\s*vector-effect:\s*non-scaling-stroke;\s*\}/.test(
      css,
    ),
  ]).toEqual(["1px", true, true]);
});

// 셋째 판(AGE-34 [결정: 2026-11-22 사용자 "싹다 1px ㄱㄱ"]): 그려지는 체크, 실행 중 고리, 자료 선(메트릭 추이, 성능 측정 곡선, 플러그인 작은 추이),
// 프로필 그림도 같은 한 벌에서 화면 1px를 받는다. 크기가 고정된 그림(빈 상태, 렌즈, 요청 그림)은 자기 좌표에서 화면 1px가 되는 값을 쓴다.

/** 첫 svg 뿌리의 class */
function rootClass(html: string): string | null {
  return rootAttr(html, "class");
}

test("the drawn check, the running ring and the profile glyph take the shared 1px line and carry no own stroke width", () => {
  const shots = [
    renderToStaticMarkup(<DrawnCheck draw />),
    renderToStaticMarkup(<CallMark status="running" />),
    renderToStaticMarkup(<ProfileGlyph look="ready" size={16} />),
    renderToStaticMarkup(<ProfileGlyph look="ready" size={20} />),
  ];
  expect(
    shots.map((html) => [
      rootClass(html)?.split(" ").includes("line-glyph"),
      (html.match(/stroke-width=/g) ?? []).length,
      /pathLength/i.test(html),
    ]),
  ).toEqual(shots.map(() => [true, 0, false]));
});

test("the metrics trend line is 1px in the shared line, one color step up, with a smaller end dot", () => {
  const html = renderToStaticMarkup(
    <MiniLine values={[4, 7, 5]} height={40} label="턴" hot={null} onHot={() => {}} />,
  );
  const line = /<path d="M[^"]*" fill="none"[^>]*>/.exec(html)?.[0] ?? "";
  expect([
    /stroke="var\(--viz-ink-3\)"/.test(line),
    /class="line-glyph"/.test(line),
    /stroke-width=/.test(line),
    /<circle[^>]* r="3"[^>]* fill="var\(--viz-ink-3\)"/.test(html),
  ]).toEqual([true, true, false, true]);
});

const turnRows = (tokens: number, ms: number): readonly MeasureRow[] => [
  { at: 1, kind: "turn", metrics: { steps: 1, totalTokens: tokens, usd: 0 }, tags: {} },
  {
    at: 1,
    kind: "call",
    metrics: { durationMs: ms, totalTokens: tokens, startedAt: 0 },
    tags: { role: "main" },
  },
];

test("the measure curve is 1px in the shared line; the visible point shrinks to 2 and the press target stays 6", () => {
  const turns = [100, 300, 200].map((tokens, i) => ({
    turnId: `t${String(i)}`,
    result: { enabled: true, rows: turnRows(tokens, tokens * 10) },
  }));
  const html = renderToStaticMarkup(
    <PerfView
      read={{
        kind: "ready",
        value: { series: [], turns, capped: false, failing: [] },
        stale: false,
      }}
      onOpenTurn={() => {}}
    />,
  );
  const curve = /<svg[^>]*role="img"[^>]*>[\s\S]*?<\/svg>/.exec(html)?.[0] ?? "";
  expect([
    rootClass(curve)?.split(" ").includes("line-glyph"),
    (curve.match(/stroke-width=/g) ?? []).length,
    (curve.match(/ r="2"/g) ?? []).length,
    (curve.match(/ r="6"/g) ?? []).length,
  ]).toEqual([true, 0, 3, 3]);
});

/** 그림 뿌리 svg의 stroke-width 속성 */
function width(html: string): string | null {
  return rootAttr(html, "stroke-width");
}

test("fixed-size art draws its lines at one screen pixel in its own grid; only the travelling light is thicker", () => {
  expect([
    width(renderToStaticMarkup(<InboxArt />)),
    width(renderToStaticMarkup(<LensArt />)),
    width(renderToStaticMarkup(<LensArt size={192} />)),
    width(renderToStaticMarkup(<RequestArt kind="approval" size={16} live={false} />)),
    width(renderToStaticMarkup(<RequestArt kind="approval" size={20} live={false} />)),
  ]).toEqual(["1.25", "1", "0.5", "1.25", "1"]);
  // 빈 상태 그림의 가닥은 모두 같은 굵기(뿌리 값)이고, 굵기를 따로 가진 것은 흐르는 빛뿐이다
  expect(
    [...renderToStaticMarkup(<InboxArt />).matchAll(/<path[^>]*stroke-width="([^"]+)"[^>]*>/g)].map(
      (m) => [m[1], /empty-art-light/.test(m[0])],
    ),
  ).toEqual([["2", true]]);
});

test("the metrics empty figure and the plugin sparkline take the shared line and set no own stroke width", () => {
  const metrics = read(join(SRC, "views/craft/metrics/metrics-view.tsx"));
  const figure = metrics.slice(
    metrics.indexOf("function EmptyFigure"),
    metrics.indexOf("function EmptyPage"),
  );
  const tree = read(join(SRC, "views/plugin/native-tree.tsx"));
  const spark = tree.slice(
    tree.indexOf("function SparklineNode"),
    tree.indexOf("function sparkPoints"),
  );
  expect([
    /\$\{LINE_GLYPH\.className\} block w-full max-w-130/.test(figure),
    /strokeWidth/.test(figure),
    /\$\{LINE_GLYPH\.className\} h-6 w-24/.test(spark),
    /strokeWidth/.test(spark),
  ]).toEqual([true, false, true, false]);
});
