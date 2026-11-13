import { expect, test } from "bun:test";
import { read, relative, sourceFiles } from "../styles/source-scan.ts";

// 앱 확대(`<html>`의 `zoom`) 아래의 뷰포트 단위(DP-173). Chromium에서 `vw`·`vh`·`dvh`는 확대 안에서 한 번 더 곱해져
// 125%에서 `100vw`가 창보다 25% 넓다. 창에 맞춘 상한은 `--app-vw`·`--app-vh`·`--app-dvh`(styles.css, 확대로 나눈 값)를 쓴다.
// 뷰포트 단위를 그대로 쓰는 곳은 그 정의, 확대로 나누는 Radix select 남은 높이의 대체 값, 차를 확대로 나누는 Windows·Linux 창 단추 폭뿐이다.

const ALLOWED: readonly string[] = [
  ...["0.9", "1.25", "1.5", "2"].map(
    (z) =>
      `styles.css max-height: calc(var(--radix-select-content-available-height, 100vh) / ${z}) !important`,
  ),
  "styles.css --app-vw: calc(100vw / var(--app-zoom))",
  "styles.css --app-vh: calc(100vh / var(--app-zoom))",
  "styles.css --app-dvh: calc(100dvh / var(--app-zoom))",
  "styles.css (100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw)) / var(--app-zoom)",
];

const UNIT = /-?[\d.]+(?:vw|vh|dvh|svh|lvh|vmin|vmax)\b/;

function viewportLines(file: string): string[] {
  const code = read(file)
    .replaceAll(/\/\*[\s\S]*?\*\//g, "")
    .replaceAll(/^\s*\/\/.*$/gm, "");
  return code
    .split("\n")
    .map((line) => line.trim().replace(/;$/, ""))
    .filter((line) => UNIT.test(line))
    .map((line) => `${relative(file)} ${line}`);
}

test("화면 소스의 뷰포트 단위는 확대로 나눈 정의에만 있다", () => {
  const found = sourceFiles([".ts", ".tsx", ".css"]).flatMap(viewportLines);
  expect(found).toEqual([...ALLOWED]);
});
