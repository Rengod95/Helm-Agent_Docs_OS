import { expect, test } from "bun:test";
import { join } from "node:path";
import { read, SRC } from "./source-scan.ts";

// 앱이 더한 색 토큰 셋(`src/color-sets.css`, AGE-31). caustic 토큰을 덮지 않고 새 이름으로만 더하며,
// 라이트와 다크(시스템 설정과 앱 테마 둘 다)가 같은 자리를 갖는다. 리뷰, 메트릭, 트레이스의 Inject가 이 셋을 쓴다.

const CSS = read(join(SRC, "color-sets.css")).replace(/\/\*[\s\S]*?\*\//g, "");

/** 선택자 하나의 변수 선언(이름 → 값). 선택자가 여러 번 나오면 첫 블록 */
function declarationsOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

const LIGHT: Record<string, string> = {
  "--fr-color-cobalt-tint": "oklch(0.965 0.016 260)",
  "--fr-color-cobalt-soft": "oklch(0.935 0.03 260)",
  "--fr-color-cobalt-soft-hover": "oklch(0.905 0.045 260)",
  "--fr-color-cobalt-soft-pressed": "oklch(0.87 0.062 260)",
  "--fr-color-cobalt-border": "oklch(0.8 0.1 260)",
  "--fr-color-cobalt-border-strong": "oklch(0.712 0.135 260)",
  "--fr-color-cobalt-graphic": "oklch(0.62 0.165 260)",
  "--fr-color-cobalt-solid": "oklch(0.55 0.18 260)",
  "--fr-color-cobalt-solid-hover": "oklch(0.5 0.17 260)",
  "--fr-color-cobalt-text": "oklch(0.43 0.16 260)",
  "--fr-color-cobalt-on": "oklch(0.99 0 0)",
  "--fr-color-cobalt-face": "oklch(0.82 0.088 260)",
};

const DARK: Record<string, string> = {
  "--fr-color-cobalt-tint": "oklch(0.255 0.07 260)",
  "--fr-color-cobalt-soft": "oklch(0.29 0.095 260)",
  "--fr-color-cobalt-soft-hover": "oklch(0.32 0.105 260)",
  "--fr-color-cobalt-soft-pressed": "oklch(0.355 0.115 260)",
  "--fr-color-cobalt-border": "oklch(0.42 0.135 260)",
  "--fr-color-cobalt-border-strong": "oklch(0.544 0.16 260)",
  "--fr-color-cobalt-graphic": "oklch(0.637 0.165 260)",
  "--fr-color-cobalt-solid": "oklch(0.7 0.155 260)",
  "--fr-color-cobalt-solid-hover": "oklch(0.75 0.125 260)",
  "--fr-color-cobalt-text": "oklch(0.74 0.11 260)",
  "--fr-color-cobalt-on": "oklch(0.12 0 0)",
  "--fr-color-cobalt-face": "oklch(0.263 0.105 260)",
};

test("the cobalt set has every member in light, system dark and app dark, with the agreed values", () => {
  expect(declarationsOf(CSS, ":root")).toEqual(LIGHT);
  expect(declarationsOf(CSS, ':root:not([data-theme="light"])')).toEqual(DARK);
  expect(declarationsOf(CSS, ':root[data-theme="dark"]')).toEqual(DARK);
});

test("the set only adds new names and never redefines a caustic token", () => {
  const names = [...CSS.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] ?? "");
  expect(names.filter((name) => !name.startsWith("--fr-color-"))).toEqual([]);
});

test("styles.css imports the set", () => {
  expect(read(join(SRC, "styles.css")).includes('@import "./color-sets.css";')).toBe(true);
});

/** CSS 파일 하나에서 이름이 `prefix`로 시작하는 변수 선언(이름, 값)을 나온 차례로 */
function variablesOf(path: string, prefix: string): readonly (readonly [string, string])[] {
  const css = read(join(SRC, path)).replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map((m) => [m[1] ?? "", (m[2] ?? "").replace(/\s+/g, " ").trim()] as const)
    .filter(([name]) => name.startsWith(prefix));
}

test("review takes Inject's kind colour from the cobalt set, once for both themes", () => {
  expect(variablesOf("views/craft/review/review.css", "--rv-inject")).toEqual([
    ["--rv-inject", "var(--fr-color-cobalt-graphic)"],
  ]);
});

test("metrics and trace take Inject's mark, tile face and tile glyph from the cobalt set, once for both themes", () => {
  expect(variablesOf("views/craft/metrics/viz.css", "--viz-inject")).toEqual([
    ["--viz-inject", "var(--fr-color-cobalt-graphic)"],
    ["--viz-inject-tab", "var(--fr-color-cobalt-face)"],
    ["--viz-inject-tab-text", "var(--fr-color-cobalt-text)"],
  ]);
});
