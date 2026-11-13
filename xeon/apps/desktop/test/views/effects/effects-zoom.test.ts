import { expect, test } from "bun:test";
import { join } from "node:path";
import { read, SRC } from "../../styles/source-scan.ts";

// 앱 확대(`<html>`의 `zoom`) 아래의 효과 CSS(DP-171). 뷰포트 단위(vw·vh 계열)는 확대 안에서 한 번 더 곱해져 125%에서 창보다 25% 커진다.
// 효과는 담는 상자의 %나 레이아웃에 붙여 크기를 정한다.

const EFFECT_CSS = [
  "views/effects/beam.css",
  "views/effects/aurora.css",
  "views/effects/drawn-check.css",
];

function viewportUnitsIn(css: string): string[] {
  const code = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  return [...code.matchAll(/-?[\d.]+(?:vw|vh|dvh|svh|lvh|vmin|vmax)\b/g)].map((m) => m[0]);
}

test("효과 CSS에는 뷰포트 단위가 없다", () => {
  const found = EFFECT_CSS.flatMap((file) =>
    viewportUnitsIn(read(join(SRC, file))).map((unit) => `${file} ${unit}`),
  );
  expect(found).toEqual([]);
});

test("물결 캔버스는 뷰포트(담는 상자)의 100%다", () => {
  const css = read(join(SRC, "views/effects/beam.css")).replaceAll(/\/\*[\s\S]*?\*\//g, "");
  const rule = /\.fx-wave\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const decls = rule
    .split(";")
    .map((line) => line.trim())
    .filter(
      (line) => line.startsWith("width") || line.startsWith("height") || line.startsWith("inset"),
    );
  expect(decls).toEqual(["inset: 0", "width: 100%", "height: 100%"]);
});
