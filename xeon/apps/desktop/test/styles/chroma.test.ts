import { expect, test } from "bun:test";
import { join } from "node:path";
import { read, SRC } from "./source-scan.ts";

// 선명한 유채색 층(`src/chroma.css`, AGE-31 다시). 색상마다 표지, 채움과 그 위 글, 면과 그 위 먹, 바탕 위 글을 두고 두 테마가 같은 값을 쓴다.
// 다른 곳은 바탕 위 글뿐이다(라이트는 읽히는 진하기, 다크는 표지 값). 큰 면(tint, soft, border)은 덮지 않는다(spec L4.desktop-ux §13.0.1 DP-229).

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
const DARK_ATTR = declarationsOf(CSS, ':root[data-theme="dark"]');
const DARK_MEDIA = declarationsOf(CSS, ':root:not([data-theme="light"])');
const ROOT = declarationsOf(CSS, ":root");
const CAUSTIC_DARK = declarationsOf(CAUSTIC, ':root[data-theme="dark"]');
const COBALT_DARK = declarationsOf(COBALT, ':root[data-theme="dark"]');

const HUES = ["green", "yellow", "coral", "blue", "purple", "cobalt", "teal", "orange", "pink"];

/** 한 벌의 값. 없으면 시험이 실패하게 검정으로 둔다 */
const vivid = (hue: string, part: string): Oklch =>
  oklchOf(ROOT[`--fr-vivid-${hue}${part}`] ?? "") ?? { l: 0, c: 0, h: 0 };

const LIGHT_PAGE = { l: 0.93, c: 0, h: 0 };
const DARK_CARD = { l: 0.18, c: 0, h: 0 };

/** 바탕 위 글: 라이트에서 명암비를 맞춘 값을 쓰는 이름 */
const ON_PAGE = (name: string): boolean =>
  /^--cs-color-((success|warning|danger|info|agent)-text|syntax-[\w-]+|ansi-[\w-]+|diff-(add|remove)-text|category-component)$/.test(
    name,
  ) || name === "--fr-color-cobalt-text";

const darkOf = (name: string): string | undefined => CAUSTIC_DARK[name] ?? COBALT_DARK[name];

test("every hue has a vivid mark, fill, face, ink and page text inside sRGB", () => {
  const parts = ["", "-solid", "-solid-hover", "-on", "-face", "-ink", "-text"];
  const missing = HUES.flatMap((hue) =>
    parts
      .filter((part) => oklchOf(ROOT[`--fr-vivid-${hue}${part}`] ?? "") === null)
      .map((part) => `${hue}${part}`),
  );
  expect(missing).toEqual([]);
  const outside = HUES.flatMap((hue) =>
    parts.filter((part) => !inGamut(vivid(hue, part))).map((part) => `${hue}${part}`),
  );
  expect(outside).toEqual([]);
});

test("the mark is vivid and moderately bright: L 0.64 to 0.76 and chroma at least 0.12", () => {
  const dull = HUES.filter((hue) => {
    const mark = vivid(hue, "");
    return mark.l < 0.64 || mark.l > 0.76 || mark.c < 0.12;
  });
  expect(dull).toEqual([]);
});

test("ink reads on the face and the fill's text reads on the fill (4.5 or more)", () => {
  const rows = HUES.map((hue) => [
    hue,
    contrast(vivid(hue, "-ink"), vivid(hue, "-face")) >= 4.5,
    contrast(vivid(hue, "-on"), vivid(hue, "-solid")) >= 4.5,
  ]);
  expect(rows).toEqual(HUES.map((hue) => [hue, true, true]));
});

test("page text reads in light against oklch(0.93 0 0) and in dark against the dark card", () => {
  const rows = HUES.map((hue) => [
    hue,
    contrast(vivid(hue, "-text"), LIGHT_PAGE) >= 4.5,
    contrast(vivid(hue, ""), DARK_CARD) >= 4.5,
  ]);
  expect(rows).toEqual(HUES.map((hue) => [hue, true, true]));
});

test("dark page text is the mark, the same in system dark and app dark", () => {
  expect(DARK_MEDIA).toEqual(DARK_ATTR);
  expect(Object.entries(DARK_ATTR)).toEqual(
    HUES.map((hue) => [`--fr-vivid-${hue}-text`, `var(--fr-vivid-${hue})`]),
  );
});

test("status, identity, chart and gradient colours point at the vivid set in both themes", () => {
  const families = {
    success: "green",
    warning: "yellow",
    danger: "coral",
    info: "blue",
    agent: "purple",
  };
  for (const [family, hue] of Object.entries(families)) {
    expect([
      ROOT[`--cs-color-${family}-graphic`],
      ROOT[`--cs-color-${family}-solid`],
      ROOT[`--cs-color-${family}-on`],
    ]).toEqual([
      `var(--fr-vivid-${hue})`,
      `var(--fr-vivid-${hue}-solid)`,
      `var(--fr-vivid-${hue}-on)`,
    ]);
  }
  expect([
    ROOT["--cs-color-identity-coral"],
    ROOT["--cs-color-identity-mint"],
    ROOT["--cs-color-chart-4"],
    ROOT["--cs-color-agent-stop-2"],
    ROOT["--fr-color-cobalt-face"],
  ]).toEqual([
    "var(--fr-vivid-coral)",
    "var(--fr-vivid-green)",
    "var(--fr-vivid-yellow)",
    "var(--fr-vivid-cobalt)",
    "var(--fr-vivid-cobalt-face)",
  ]);
});

test("large faces stay each theme's own: no tint, soft or border is overridden", () => {
  const overridden = [ROOT, LIGHT_ATTR, LIGHT_MEDIA, DARK_ATTR]
    .flatMap((block) => Object.keys(block))
    .filter((name) => /-(tint|soft|soft-hover|soft-pressed|border|border-strong)$/.test(name));
  expect(overridden).toEqual([]);
});

test("system light and app light carry the same page text", () => {
  expect(LIGHT_MEDIA).toEqual(LIGHT_ATTR);
  expect(Object.keys(LIGHT_ATTR).every(ON_PAGE)).toBe(true);
});

test("light page text keeps the dark hue, never gains chroma, and reaches 4.5 against oklch(0.93 0 0)", () => {
  const rows = Object.entries(LIGHT_ATTR).map(([name, value]) => {
    const now = oklchOf(value);
    const dark = oklchOf(darkOf(name) ?? "");
    return {
      name,
      sameHue: now !== null && dark !== null && now.h === dark.h,
      chromaKept: now !== null && dark !== null && now.c <= dark.c && inGamut(now),
      readable: now !== null && contrast(now, LIGHT_PAGE) >= 4.5,
    };
  });
  expect(rows.length).toBe(34);
  expect(rows.filter((row) => !row.sameHue || !row.chromaKept || !row.readable)).toEqual([]);
});
