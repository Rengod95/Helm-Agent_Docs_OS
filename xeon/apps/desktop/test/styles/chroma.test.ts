import { expect, test } from "bun:test";
import { join } from "node:path";
import { read, SRC } from "./source-scan.ts";

// 라이트에서도 다크의 유채색을 쓰는 앱 토큰 층(`src/chroma.css`, AGE-31). caustic 토큰 파일은 고치지 않고 앱이 라이트에서 덮는다.
// 면, 테두리, 그림, 채움은 다크 값 그대로, 바탕 위 글만 다크의 색상과 세기를 두고 명암비 4.5 이상으로 내린다(spec 예외 표).

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");
const CSS = strip(read(join(SRC, "chroma.css")));
const CAUSTIC = strip(
  read(
    join(
      SRC,
      "..",
      "..",
      "..",
      "external",
      "caustic",
      "packages",
      "tokens",
      "dist",
      "caustic.tokens.css",
    ),
  ),
);
const COBALT = strip(read(join(SRC, "color-sets.css")));

/** 선택자 블록 하나의 변수 선언(이름 → 값). 선택자가 여러 번 나오면 첫 블록 */
function declarationsOf(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    out[part.slice(0, at).trim()] = part
      .slice(at + 1)
      .trim()
      .replace(/\s+/g, " ");
  }
  return out;
}

interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

function oklchOf(value: string): Oklch | null {
  const m = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ [\d.]+)?\)$/.exec(value);
  if (m === null) return null;
  return { l: Number(m[1]), c: Number(m[2]), h: Number(m[3]) };
}

/** OKLCH → 선형 sRGB(잘라내지 않음) */
function linear(color: Oklch): readonly [number, number, number] {
  const r = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(r);
  const b = color.c * Math.sin(r);
  const l = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function luminance(color: Oklch): number {
  const [r, g, b] = linear(color).map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: Oklch, b: Oklch): number {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const inGamut = (color: Oklch): boolean => linear(color).every((v) => v >= -1e-4 && v <= 1 + 1e-4);

const LIGHT_ATTR = declarationsOf(CSS, ':root[data-theme="light"]');
const LIGHT_MEDIA = declarationsOf(CSS, ':root:not([data-theme="dark"])');
const ROOT = declarationsOf(CSS, ":root");
const CAUSTIC_DARK = declarationsOf(CAUSTIC, ':root[data-theme="dark"]');
const COBALT_DARK = declarationsOf(COBALT, ':root[data-theme="dark"]');

/** 바탕 위 글: 다크 값이 아니라 명암비를 맞춘 값을 쓰는 이름 */
const ON_PAGE = (name: string): boolean =>
  /^--cs-color-((success|warning|danger|info|agent)-text|syntax-[\w-]+|ansi-[\w-]+|diff-(add|remove)-text|category-component)$/.test(
    name,
  ) || name === "--fr-color-cobalt-text";

/** 다크 값을 찾는다: caustic 다크 블록이나 앱 cobalt 셋 */
const darkOf = (name: string): string | undefined => CAUSTIC_DARK[name] ?? COBALT_DARK[name];

test("system light and app light carry the same overrides", () => {
  expect(Object.keys(LIGHT_ATTR).length).toBeGreaterThan(100);
  expect(LIGHT_MEDIA).toEqual(LIGHT_ATTR);
});

test("faces, borders, graphics and fills take the dark value exactly", () => {
  const same = Object.entries(LIGHT_ATTR).filter(
    ([name]) => name !== "--fr-chroma-face-base" && !ON_PAGE(name),
  );
  expect(same.filter(([name, value]) => darkOf(name) !== value)).toEqual([]);
});

test("every chromatic dark token is overridden in light, except the diff line backgrounds", () => {
  const chromatic = Object.entries(CAUSTIC_DARK)
    .filter(([, value]) => (oklchOf(value)?.c ?? 0) > 0.02)
    .map(([name]) => name);
  expect(chromatic.filter((name) => LIGHT_ATTR[name] === undefined)).toEqual([
    "--cs-color-diff-add-bg",
    "--cs-color-diff-remove-bg",
  ]);
  expect(Object.keys(COBALT_DARK).filter((name) => LIGHT_ATTR[name] === undefined)).toEqual([]);
});

test("text placed on the page keeps the dark hue, never gains chroma, and reaches 4.5 against oklch(0.93 0 0)", () => {
  const page = { l: 0.93, c: 0, h: 0 };
  const rows = Object.entries(LIGHT_ATTR)
    .filter(([name]) => ON_PAGE(name))
    .map(([name, value]) => {
      const now = oklchOf(value);
      const dark = oklchOf(darkOf(name) ?? "");
      return {
        name,
        sameHue: now !== null && dark !== null && now.h === dark.h,
        chromaKept: now !== null && dark !== null && now.c <= dark.c && inGamut(now),
        readable: now !== null && contrast(now, page) >= 4.5,
      };
    });
  expect(rows.length).toBe(34);
  expect(rows.filter((row) => !row.sameHue || !row.chromaKept || !row.readable)).toEqual([]);
});

test("the theme-free dark pairs equal the dark tokens", () => {
  expect(
    ["success", "warning", "danger", "info", "agent"].map((f) => [
      ROOT[`--fr-chroma-${f}-text`],
      CAUSTIC_DARK[`--cs-color-${f}-text`],
    ]),
  ).toEqual(
    ["success", "warning", "danger", "info", "agent"].map((f) => [
      CAUSTIC_DARK[`--cs-color-${f}-text`],
      CAUSTIC_DARK[`--cs-color-${f}-text`],
    ]),
  );
  expect([ROOT["--fr-chroma-cobalt-text"], ROOT["--fr-chroma-face-base"]]).toEqual([
    COBALT_DARK["--fr-color-cobalt-text"],
    "transparent",
  ]);
  expect(LIGHT_ATTR["--fr-chroma-face-base"]).toBe("oklch(0.18 0 0)");
});

test("on a chromatic face the text goes back to the dark pair, for every family and face class", () => {
  const start = CSS.indexOf(":is(");
  const selectors = new Set(
    [...CSS.slice(start, CSS.indexOf("{", start)).matchAll(/\[class~="([^"]+)"\]/g)].map(
      (m) => m[1] ?? "",
    ),
  );
  const body = declarationsOf(
    CSS.slice(start).replace(/^:is\([\s\S]*?\)\s*\{/, "ISLAND {"),
    "ISLAND",
  );
  const families = ["success", "warning", "danger", "info", "agent"];
  expect(
    families.map(
      (f) =>
        ["bg", "hover:bg", "active:bg"].every((p) => selectors.has(`${p}-${f}-soft`)) &&
        selectors.has(`bg-${f}-tint`),
    ),
  ).toEqual(families.map(() => true));
  expect(families.map((f) => [body[`--cs-color-${f}-text`], body[`--color-${f}-text`]])).toEqual(
    families.map((f) => [`var(--fr-chroma-${f}-text)`, `var(--fr-chroma-${f}-text)`]),
  );
  expect(body["--color-text-primary"]).toBe("var(--fr-chroma-ink-primary)");
});

test("styles.css imports the layer right after the cobalt set", () => {
  expect(
    read(join(SRC, "styles.css")).includes('@import "./color-sets.css";\n@import "./chroma.css";'),
  ).toBe(true);
});
