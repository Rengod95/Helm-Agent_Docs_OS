import { expect, test } from "bun:test";
import { read, relative, sourceFiles } from "./source-scan.ts";

// 색은 토큰으로만 쓴다(M4 종료 조건 Y13, AGE-37, 결정 2026-11-20 사용자, L4 desktop-ux spec §13.0).
// 화면 소스(src)에 날 색 값(`#fff`, `rgb(…)`, `rgba(…)`, `hsl(…)`)이 새로 들어오면 실패한다. 주석은 보지 않는다.
// 토큰 층(chroma.css, color-sets.css)은 값을 정하는 곳이라 보지 않는다. 새 빛깔이 필요하면 color-sets.css에 셋으로 더하고 `var(--fr-color-…)`로 부른다.
// 허용하는 것은 아래 둘뿐이다.
// 1. CSS 마스크 검정: `mask`, `mask-image`와 마스크 변수(`--…-mask`, 그 값은 mask가 부른다)의 `#000`, `rgb(0 0 0 / …)`.
//    마스크는 알파만 읽어 색이 아니다(결정 2026-11-20). 마스크 밖의 검정은 아래 시험이 막는다.
// 2. `ALLOWED`에 까닭과 함께 적은 줄.

/** 날 색 값. 조건 문장의 grep(`#[0-9a-fA-F]{3,6}|rgb\(`)에 rgba, hsl을 더했다 */
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/u;

const TOKEN_LAYER = new Set(["chroma.css", "color-sets.css"]);

/** 마스크 검정 */
const MASK_BLACK = /#000\b|rgb\(0 0 0(?: \/ [\d.]+)?\)/gu;

/** 의도한 예외: [화면 소스 기준 상대 경로, 걸린 줄의 글(앞뒤 공백 뺌), 까닭] */
const ALLOWED: readonly (readonly [string, string, string])[] = [
  [
    "views/pages/shared/qr-code.tsx",
    '<rect width={side} height={side} fill="#fff" />',
    "QR 칸의 흰색이다. 읽는 기기가 테마와 상관없이 흑백 대비를 읽어야 해서 고정한다(결정 2026-11-22 사용자, AGE-37)",
  ],
  [
    "views/pages/shared/qr-code.tsx",
    '<path fill="#000" d={darkRunsPath(modules)} />',
    "QR 칸의 검정이다. 위와 같은 까닭이다(결정 2026-11-22 사용자, AGE-37)",
  ],
  [
    "views/effects/crystal-mark.tsx",
    'const SWEEP_DARK = ["rgba(236,232,255,", "rgba(226,240,255,", "rgba(228,255,250,"] as const;',
    "canvas 2D가 그리는 빛줄기의 빛깔이다. canvas는 CSS 변수를 받지 않고, 알파를 그림마다 붙여 쓴다",
  ],
  [
    "views/effects/crystal-mark.tsx",
    'const SWEEP_LIGHT = ["rgba(150,138,255,", "rgba(120,170,255,", "rgba(90,205,210,"] as const;',
    "위와 같다(라이트 빛깔)",
  ],
  [
    "views/effects/crystal-mark.tsx",
    '(dark ? SWEEP_DARK : SWEEP_LIGHT)[Math.min(2, Math.floor(s * 3))] ?? "rgba(255,255,255,";',
    "위 빛깔 표의 대체값이다",
  ],
  [
    "views/effects/dot-orb.tsx",
    "return `rgba(${String(g)},${String(g)},${String(g)},${String(alpha)})`;",
    "canvas 2D가 점마다 깊이로 섞어 만드는 색이다. 값은 계산에서 나오고 날 색 값이 아니다",
  ],
  [
    "views/effects/dot-orb.tsx",
    "return `rgba(${String(ramp(base[0]))},${String(ramp(base[1]))},${String(ramp(base[2]))},${String(alpha)})`;",
    "위와 같다(빛깔 있는 점)",
  ],
];

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/** 주석을 같은 길이의 공백으로 지운다(줄 번호를 지킨다). 문자열 안의 `//`는 그대로 둔다 */
const LEXEME =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/gu;

function withoutComments(file: string, text: string): string {
  if (file.endsWith(".css")) {
    return text.replace(/\/\*[\s\S]*?\*\//gu, (c) => c.replace(/[^\n]/gu, " "));
  }
  return text.replace(LEXEME, (lexeme) =>
    lexeme.startsWith("/") ? lexeme.replace(/[^\n]/gu, " ") : lexeme,
  );
}

function rawColorHits(): Hit[] {
  const hits: Hit[] = [];
  for (const file of sourceFiles([".css", ".ts", ".tsx"])) {
    const name = relative(file);
    if (TOKEN_LAYER.has(name)) continue;
    const lines = withoutComments(name, read(file)).split("\n");
    lines.forEach((line, index) => {
      const seen = name.endsWith(".css") ? line.replace(MASK_BLACK, "") : line;
      if (!RAW_COLOR.test(seen)) return;
      hits.push({ file: name, line: index + 1, text: line.trim() });
    });
  }
  return hits;
}

const isAllowed = (hit: Hit): boolean =>
  ALLOWED.some(([file, text]) => file === hit.file && text === hit.text);

test("screen sources use no raw colour value outside the token layer (Y13)", () => {
  const bad = rawColorHits()
    .filter((hit) => !isAllowed(hit))
    .map((hit) => `${hit.file}:${String(hit.line)} ${hit.text}`);
  expect(bad).toEqual([]);
});

test("mask black in CSS stays inside mask declarations", () => {
  const outside: string[] = [];
  for (const file of sourceFiles([".css"])) {
    const name = relative(file);
    if (TOKEN_LAYER.has(name)) continue;
    const text = withoutComments(name, read(file));
    for (const match of text.matchAll(/(?<=[{;])\s*([\w-]+)\s*:\s*([^;{}]+)/gu)) {
      const prop = match[1] ?? "";
      const value = match[2] ?? "";
      if (!/#000\b|rgb\(0 0 0/u.test(value)) continue;
      if (/^(?:-webkit-)?mask(?:-image)?$|^--[\w-]+-mask$/u.test(prop)) continue;
      outside.push(`${name} ${prop}`);
    }
  }
  expect(outside).toEqual([]);
});

test("every allowed raw colour is still in the source", () => {
  const hits = rawColorHits();
  const stale = ALLOWED.filter(
    ([file, text]) => !hits.some((hit) => hit.file === file && hit.text === text),
  ).map(([file, text]) => `${file} ${text}`);
  expect(stale).toEqual([]);
});

/** CSS 한 줄이 걸리는지(마스크 검정을 뺀 뒤) */
const probe = (line: string): boolean => RAW_COLOR.test(line.replace(MASK_BLACK, ""));

test("the scan catches a raw colour and lets mask black through", () => {
  expect(probe("color: #fafafa;")).toBe(true);
  expect(probe("--x: rgb(30 185 170);")).toBe(true);
  expect(probe('fill: "rgba(1,2,3,0.5)"')).toBe(true);
  expect(probe("mask-image: linear-gradient(#000 0 0);")).toBe(false);
  expect(probe("mask-image: linear-gradient(rgb(0 0 0 / 0.55), #000);")).toBe(false);
  expect(probe("color: var(--fr-color-glow-teal);")).toBe(false);
});
