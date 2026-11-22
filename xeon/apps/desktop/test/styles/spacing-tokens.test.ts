import { expect, test } from "bun:test";
import { read, relative, sourceFiles } from "./source-scan.ts";

// 간격은 caustic 간격 단계만 쓴다(AGE-32, 사용자 2026-11-22 "의도적인 디자인이 아닌 이상 패딩값이나 spacing, gap 다 규칙을 지키라고 해",
// L4 desktop-ux spec §13.0 DP-228). 화면 소스의 padding, margin, gap, inset, 위치(top, right, bottom, left)에
// 간격 토큰이 아닌 길이 숫자(px, rem, em)가 새로 들어오면 실패한다. 세 자리를 본다:
// 1. CSS 파일의 선언. 간격 속성이 부르는 앱 변수(`--rv-pad` 같은)의 선언도 따라가 본다.
// 2. TS, TSX 문자열의 Tailwind 클래스. 단계 밖 숫자(`pl-11`)와 길이 숫자가 든 임의 값(`p-[13px]`)이 걸린다.
//    간격 변수를 정하는 임의 속성(`[--band-bleed-end:6px]`)도 그 변수가 간격 속성이나 간격 클래스에 쓰이면 걸린다.
// 3. JSX `style={…}` 안의 숫자 간격(`bottom: 8`).
// 간격 단계 위의 값은 `var(--cs-space-…)`나 Tailwind 단계(`p-3`)로 적는다. 의도한 예외는 아래 `ALLOWED`에 까닭과 함께 둔다.

/** DP-228의 Tailwind 단계(단위 4px). `--cs-space-*`와 같은 값이다 */
const STEPS = new Set([
  "0",
  "px",
  "0.25",
  "0.5",
  "0.75",
  "1",
  "1.25",
  "1.5",
  "1.75",
  "2",
  "2.25",
  "2.5",
  "3",
  "3.5",
  "4",
  "4.5",
  "5",
  "6",
  "6.5",
  "7",
  "8",
  "10",
  "12",
  "16",
  "18",
]);

const SPACE_PROP =
  /^(padding|margin|scroll-padding|scroll-margin)(-[a-z-]+)?$|^(gap|row-gap|column-gap)$|^inset(-[a-z-]+)?$|^(top|right|bottom|left)$/u;

/** 0이 아닌 길이 숫자 */
const LENGTH = /(?<![\w.-])-?(\d*\.?\d+)(px|rem|em)\b/gu;

/** 간격 토큰의 대체값(`var(--cs-space-3, 12px)`)은 토큰과 같은 값이라 세지 않는다 */
const TOKEN_FALLBACK = /var\(--(cs-space|spacing)[\w-]*\s*,[^()]*\)/gu;

/** 앱 변수가 아닌 토큰 변수 */
const TOKEN_VAR = /^--(cs-|spacing)/u;

/** 의도한 예외: [화면 소스 기준 상대 경로, 걸린 글, 까닭]. 간격이 아니라 선 굵기, 기하 가운데, 다른 부품의 폭에서 나온 값이다 */
const ALLOWED: readonly (readonly [string, string, string])[] = [
  [
    "styles.css",
    "inset-inline: 0 -1px",
    "막대 머리 덮개가 막대 오른쪽 선(1px) 위까지 덮는다. 선 굵기다",
  ],
  [
    "styles.css",
    "padding-inline-start: max(var(--cs-space-3), calc(var(--chrome-start) - var(--cs-space-12) - 1px))",
    "막대 폭 49 = 단추 칸 48 + 오른쪽 선 1px. 선 굵기다",
  ],
  [
    "views/convo/convo.css",
    "padding-left: calc(var(--cs-space-5) - var(--cs-space-1_5) - 1px)",
    "들임 6 + 왼쪽 선 1px + 13 = 글 칸 20. 선 굵기를 뺀다(DP-228 남은 예외)",
  ],
  [
    "views/convo/convo.css",
    "margin-top: -0.5px",
    "1px 선의 가운데를 50%에 둔다. 선 굵기의 반, 기하 보정이다(DP-228 남은 예외)",
  ],
  [
    "views/effects/beam.css",
    "inset: -1px",
    "빛 판이 칩과 띠 면의 1px 테두리 위에 겹친다. 선 굵기다",
  ],
  [
    "views/effects/beam.css",
    "--fx-beam-radius: 12px",
    "모서리 반경이다. 곧은 구간의 시작 위치로도 쓰지만 간격 단계가 아니다",
  ],
  [
    "views/transcript-caret.css",
    "inset-block: 0.1em",
    "커서 막대를 글자 높이에 맞춰 위아래로 글자 크기의 0.1만큼 줄인다. 간격이 아니라 글꼴에 비례하는 값이다",
  ],
  [
    "views/notices.css",
    "inset-inline-start: 9.5px",
    "레일 칸 20의 가운데 10에서 1px 선 굵기의 반을 뺀 기하 가운데다",
  ],
  [
    "views/pages/review/review-view.tsx",
    "ms-12.5",
    "diff의 줄 번호 열 34 + 기호 열 16만큼 들여 의견이 그 줄에 붙는다. 열 폭에서 나온 들임이다",
  ],
  [
    "views/pages/tools-web/tools-web-view.tsx",
    "ms-[6.25rem]",
    "표의 첫 열 폭 5.5rem + 열 간격 12만큼 들여 둘째 열에 선다. 열 폭에서 나온 들임이다",
  ],
];

const hasLength = (value: string): boolean =>
  [...value.replace(TOKEN_FALLBACK, "var(--token)").matchAll(LENGTH)].some(
    (match) => Number(match[1]) !== 0,
  );

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

interface Declaration {
  readonly file: string;
  readonly line: number;
  readonly prop: string;
  readonly value: string;
}

function cssDeclarations(): Declaration[] {
  return sourceFiles([".css"]).flatMap((file) => {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//gu, (comment) =>
      comment.replace(/[^\n]/gu, " "),
    );
    return [...text.matchAll(/(?<=[{;])\s*([\w-]+)\s*:\s*([^;{}]+)/gu)].map((match) => ({
      file: relative(file),
      line: lineOf(text, match.index + match[0].indexOf(match[1] ?? "")),
      prop: match[1] ?? "",
      value: (match[2] ?? "")
        .trim()
        .replace(/\s+/gu, " ")
        .replace(/\(\s+/gu, "(")
        .replace(/\s+\)/gu, ")"),
    }));
  });
}

/**
 * 간격 자리에 쓰이는 앱 변수: CSS의 간격 속성과 화면 소스의 간격 클래스(`pe-[calc(var(--shell-rail)+…)]`)가 부르는 변수.
 * 그 변수가 다른 앱 변수를 부르면 그것도 따라간다
 */
function spacingVars(
  declarations: readonly Declaration[],
  utilityValues: readonly string[],
): Set<string> {
  const vars = new Set<string>();
  const addVarsOf = (value: string): boolean => {
    let added = false;
    for (const match of value.matchAll(/var\((--[\w-]+)/gu)) {
      const name = match[1] ?? "";
      if (TOKEN_VAR.test(name) || vars.has(name)) continue;
      vars.add(name);
      added = true;
    }
    return added;
  };
  for (const d of declarations) if (SPACE_PROP.test(d.prop)) addVarsOf(d.value);
  for (const value of utilityValues) addVarsOf(value);
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of declarations) if (vars.has(d.prop) && addVarsOf(d.value)) grew = true;
  }
  return vars;
}

function cssHits(vars: ReadonlySet<string>): Hit[] {
  return cssDeclarations()
    .filter((d) => (SPACE_PROP.test(d.prop) || vars.has(d.prop)) && hasLength(d.value))
    .map((d) => ({ file: d.file, line: d.line, text: `${d.prop}: ${d.value}` }));
}

// 주석과 문자열을 왼쪽부터 한 번에 읽는다(source-scan.ts와 같은 문법)
const LEXEME =
  /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/gu;

/** 앞의 변형(`hover:`, `data-[state=open]:`, `group-hover/x:`) */
const VARIANT = /^(?:(?:[\w-]*\[[^\]]*\][\w-]*|[\w-]+)(?:\/[\w-]+)?:)*/u;

const UTILITY =
  /^-?(p|px|py|pt|pr|pb|pl|ps|pe|m|mx|my|mt|mr|mb|ml|ms|me|gap|gap-x|gap-y|space-x|space-y|inset|inset-x|inset-y|top|right|bottom|left|start|end|scroll-m[xytrblse]?|scroll-p[xytrblse]?)-(.+)$/u;

function badUtilityValue(value: string): boolean {
  if (value.startsWith("[")) return hasLength(value);
  if (/^\d+(\.\d+)?$/u.test(value)) return !STEPS.has(value);
  return false;
}

/** `style={…}` 한 덩어리(중괄호 짝을 맞춘다) */
function styleBlocks(code: string): { readonly at: number; readonly body: string }[] {
  const out: { at: number; body: string }[] = [];
  for (const match of code.matchAll(/\bstyle=\{/gu)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let end = start;
    while (end < code.length && depth > 0) {
      const ch = code[end];
      if (ch === "{") depth += 1;
      if (ch === "}") depth -= 1;
      end += 1;
    }
    out.push({ at: start, body: code.slice(start, end - 1) });
  }
  return out;
}

const STYLE_SPACING =
  /\b(padding|margin|gap|rowGap|columnGap|inset|top|left|right|bottom|(?:padding|margin)(?:Top|Right|Bottom|Left|Inline|Block|InlineStart|InlineEnd|BlockStart|BlockEnd))\s*:\s*(-?\d+(?:\.\d+)?\b(?!\s*[*/+%-])|["'`][^"'`]*?\d(?:px|rem|em)[^"'`]*["'`])/gu;

interface ClassToken {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  /** 변형과 `!`를 뗀 클래스 */
  readonly bare: string;
}

function classTokens(): ClassToken[] {
  const out: ClassToken[] = [];
  for (const file of sourceFiles([".ts", ".tsx"])) {
    const text = read(file);
    for (const match of text.matchAll(LEXEME)) {
      const lexeme = match[0];
      if (lexeme.startsWith("/")) continue;
      // 템플릿 문자열 안의 문자열(`${on ? "[--x:3rem]" : ""}`)도 클래스로 읽도록 따옴표에서도 끊는다
      for (const token of lexeme.slice(1, -1).split(/[\s"'`]+/u)) {
        if (token === "") continue;
        const bare = token.replace(VARIANT, "").replace(/^!|!$/gu, "");
        out.push({ file: relative(file), line: lineOf(text, match.index), token, bare });
      }
    }
  }
  return out;
}

/** 임의 속성 `[--이름:값]` */
const ARBITRARY_PROPERTY = /^\[(--[\w-]+):(.+)\]$/u;

function sourceHits(tokens: readonly ClassToken[], vars: ReadonlySet<string>): Hit[] {
  const hits: Hit[] = [];
  for (const t of tokens) {
    const utility = UTILITY.exec(t.bare);
    if (utility !== null && badUtilityValue(utility[2] ?? "")) {
      hits.push({ file: t.file, line: t.line, text: t.token });
    }
    const property = ARBITRARY_PROPERTY.exec(t.bare);
    if (property !== null && vars.has(property[1] ?? "") && hasLength(property[2] ?? "")) {
      hits.push({ file: t.file, line: t.line, text: t.token });
    }
  }
  for (const file of sourceFiles([".ts", ".tsx"])) {
    const code = read(file).replace(LEXEME, (lexeme) =>
      lexeme.startsWith("/") ? lexeme.replace(/[^\n]/gu, " ") : lexeme,
    );
    for (const block of styleBlocks(code)) {
      for (const match of block.body.matchAll(STYLE_SPACING)) {
        if (/^-?0(\.0+)?$/u.test(match[2] ?? "")) continue;
        const line = lineOf(code, block.at + match.index);
        hits.push({ file: relative(file), line, text: match[0] });
      }
    }
  }
  return hits;
}

function allHits(): Hit[] {
  const tokens = classTokens();
  const utilityValues = tokens.flatMap((t) => {
    const utility = UTILITY.exec(t.bare);
    return utility === null ? [] : [utility[2] ?? ""];
  });
  const vars = spacingVars(cssDeclarations(), utilityValues);
  return [...cssHits(vars), ...sourceHits(tokens, vars)];
}

const allowed = (hit: Hit): boolean =>
  ALLOWED.some(([file, text]) => file === hit.file && text === hit.text);

test("spacing in the screen sources uses the caustic spacing steps", () => {
  const hits = allHits();
  expect(
    hits.filter((hit) => !allowed(hit)).map((hit) => `${hit.file}:${hit.line} ${hit.text}`),
  ).toEqual([]);
});

test("every allowed exception still exists and names its reason", () => {
  const hits = allHits();
  expect(
    ALLOWED.filter(
      ([file, text, reason]) =>
        reason.trim().length < 8 || !hits.some((hit) => hit.file === file && hit.text === text),
    ),
  ).toEqual([]);
});

test("the scanner catches each kind of non-token spacing", () => {
  expect([
    hasLength("calc(var(--cs-space-5) - 1px)"),
    hasLength("var(--cs-space-3, 12px)"),
    hasLength("0 var(--cs-space-2)"),
    badUtilityValue("11"),
    badUtilityValue("3"),
    badUtilityValue("[13px]"),
    badUtilityValue("[calc((var(--cs-control-xs)-var(--cs-icon-sm))/2)]"),
    badUtilityValue("inset-regular-x"),
    ARBITRARY_PROPERTY.exec("[--band-bleed-end:6px]")?.[1],
    [...spacingVars([], ["[calc(var(--shell-rail,0px)+var(--cs-space-6))]"])],
    [
      ...spacingVars(
        [
          { file: "a.css", line: 1, prop: "padding", value: "var(--a)" },
          { file: "a.css", line: 2, prop: "--a", value: "var(--b)" },
        ],
        [],
      ),
    ],
  ]).toEqual([
    true,
    false,
    false,
    true,
    false,
    true,
    false,
    false,
    "--band-bleed-end",
    ["--shell-rail"],
    ["--a", "--b"],
  ]);
});
