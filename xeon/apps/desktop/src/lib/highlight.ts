import {
  createCssVariablesTheme,
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
  type ThemedToken,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { attempt, attemptAsync, type Logger } from "@fresnel/contracts";

// 코드를 색 토큰 줄로 바꾼다. 정규식은 shiki의 JavaScript 엔진을 쓴다(앱 CSP에 wasm-unsafe-eval이 없어 oniguruma WASM을 못 쓴다).
// 색은 CSS 변수 테마로 낸다. 토큰 색은 `var(--cs-syntax-…)` 문자열이고, 변수의 값은 highlight-theme.css가 caustic에서 잇는다.
// 언어 문법은 처음 쓸 때 동적 import로 불러온다.

type HighlightToken = {
  readonly text: string;
  /** `var(--cs-syntax-…)` 문자열. 색이 없으면 undefined(상속 색) */
  readonly color: string | undefined;
  readonly fontStyle: {
    readonly italic: boolean;
    readonly bold: boolean;
    readonly underline: boolean;
  };
};

/** 입력 줄마다 토큰 배열 하나. 빈 줄은 빈 배열이다. */
export type HighlightedLines = readonly (readonly HighlightToken[])[];

export type HighlightOptions = {
  /** 언어를 읽지 못해 평문으로 돌아갈 때 기록할 Logger. 없으면 기록하지 않는다. */
  readonly logger?: Logger;
};

/** 테마 이름과 CSS 변수 접두. highlight-theme.css의 변수 이름과 맞춘다. */
export const HIGHLIGHT_THEME = "fresnel-syntax";

const THEME = createCssVariablesTheme({ name: HIGHLIGHT_THEME, variablePrefix: "--cs-syntax-" });

type LangId =
  | "typescript"
  | "tsx"
  | "javascript"
  | "json"
  | "shellscript"
  | "diff"
  | "python"
  | "rust"
  | "go"
  | "css"
  | "html"
  | "yaml"
  | "markdown"
  | "sql";

type LangModule = { readonly default: readonly LanguageRegistration[] };

const LANGUAGE_LOADERS: Readonly<Record<LangId, () => Promise<LangModule>>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
};

/** 코드 펜스의 언어 이름을 문법 이름으로 바꾼다. 여기 없는 이름은 평문이다. */
const ALIASES: ReadonlyMap<string, LangId> = new Map<string, LangId>([
  ["ts", "typescript"],
  ["typescript", "typescript"],
  ["tsx", "tsx"],
  ["js", "javascript"],
  ["javascript", "javascript"],
  ["json", "json"],
  ["bash", "shellscript"],
  ["sh", "shellscript"],
  ["shell", "shellscript"],
  ["shellscript", "shellscript"],
  ["diff", "diff"],
  ["py", "python"],
  ["python", "python"],
  ["rs", "rust"],
  ["rust", "rust"],
  ["go", "go"],
  ["css", "css"],
  ["html", "html"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
  ["md", "markdown"],
  ["markdown", "markdown"],
  ["sql", "sql"],
]);

// vscode-textmate의 FontStyle 비트 값. 원본이 declare const enum이라 가져오지 않고 값을 적는다.
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;
const NOT_SET = -1;
const NO_STYLE: HighlightToken["fontStyle"] = { italic: false, bold: false, underline: false };

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [THEME],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

async function loadLanguage(id: LangId): Promise<HighlighterCore> {
  const core = await getHighlighter();
  if (core.getLoadedLanguages().includes(id)) return core;
  const mod = await LANGUAGE_LOADERS[id]();
  await core.loadLanguage(...mod.default);
  return core;
}

function plainLines(code: string): HighlightedLines {
  return code
    .split("\n")
    .map((line) => (line === "" ? [] : [{ text: line, color: undefined, fontStyle: NO_STYLE }]));
}

function fontStyleOf(bits: number | undefined): HighlightToken["fontStyle"] {
  const flags = bits ?? 0;
  if (flags === NOT_SET) return NO_STYLE;
  return {
    italic: (flags & ITALIC) !== 0,
    bold: (flags & BOLD) !== 0,
    underline: (flags & UNDERLINE) !== 0,
  };
}

function toToken(token: ThemedToken): HighlightToken {
  return { text: token.content, color: token.color, fontStyle: fontStyleOf(token.fontStyle) };
}

function errorName(cause: unknown): string {
  return cause instanceof Error ? cause.name : "non_error";
}

/**
 * 코드를 줄마다 색 토큰 배열로 바꾼다. 줄 수는 입력의 `\n` 개수 + 1과 같다.
 * 모르는 언어는 평문 토큰이다. 문법을 못 읽었을 때도 평문으로 돌아가고, 그 사실은 `options.logger`에 남긴다.
 */
export async function highlightCode(
  code: string,
  lang: string,
  options?: HighlightOptions,
): Promise<HighlightedLines> {
  const id = ALIASES.get(lang.trim().toLowerCase());
  if (id === undefined) return plainLines(code);

  const loaded = await attemptAsync(() => loadLanguage(id));
  if (!loaded.ok) {
    options?.logger?.warn("desktop.highlight.fallback", {
      lang: id,
      stage: "load",
      error: errorName(loaded.error.cause),
    });
    return plainLines(code);
  }

  const tokens = attempt(() =>
    loaded.value.codeToTokens(code, { lang: id, theme: HIGHLIGHT_THEME }),
  );
  if (!tokens.ok) {
    options?.logger?.warn("desktop.highlight.fallback", {
      lang: id,
      stage: "tokenize",
      error: errorName(tokens.error.cause),
    });
    return plainLines(code);
  }
  return tokens.value.tokens.map((line) => line.map(toToken));
}
