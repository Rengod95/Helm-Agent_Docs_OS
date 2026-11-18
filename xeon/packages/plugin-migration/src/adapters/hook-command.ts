// Hook 명령 문자열을 "원본 폴더 안의 스크립트 하나 + 인자"로 푼다(migration.md §4.3.5 [제안]). 순수 함수다(파일을 읽지 않는다).
// 규칙: 셸 연산자(파이프, 연결, 리다이렉션, 명령 치환, 줄바꿈)와 `\`는 인라인 명령이다. 첫 토큰(또는 실행기 단어 뒤 토큰)이
// 스크립트를 가리켜야 한다. 가리킨 위치가 원본 폴더 밖이면 `script_outside_root`, 확장자가 실행기에 없으면 `unknown_runner`다.
// `$CLAUDE_PROJECT_DIR`, `${CLAUDE_PROJECT_DIR}`, `$HOME`, `~/`, `./`, 폴더 기준 상대 경로, 절대 경로만 안다.
import type { HookRunner } from "../types.ts";
import { isInside, normalizePath } from "../paths.ts";

/** 풀이의 기준. `folder`는 스크립트가 들어 있어야 하는 원본 폴더(절대 경로)다 */
export interface HookCommandContext {
  readonly folder: string;
  /** 프로젝트 루트(절대). 프로젝트 범위에서만 있다. 상대 경로와 `$CLAUDE_PROJECT_DIR`의 기준이다 */
  readonly projectDir: string | undefined;
  readonly homeDir: string;
}

export type HookCommandCode = "inline_command" | "script_outside_root" | "unknown_runner";

export type HookCommandParse =
  | {
      readonly kind: "script";
      /** 홈과 프로젝트 기준을 푼 절대 경로 */
      readonly path: string;
      readonly runner: HookRunner;
      readonly fileName: string;
      readonly args: readonly string[];
    }
  | { readonly kind: "blocked"; readonly code: HookCommandCode };

/** 명령 안에 있으면 인라인 명령이다(파이프, 연결, 리다이렉션, 명령 치환, 줄바꿈) */
const SHELL_OPERATORS = /[|&;<>`\n\r]|\$\(/;
/** 실행기 단어. 있으면 그 실행기로 돌린다(확장자와 맞아야 한다) */
const RUNNER_WORDS: ReadonlyMap<string, HookRunner> = new Map<string, HookRunner>([
  ["sh", "sh"],
  ["bash", "bash"],
  ["python3", "python3"],
  ["node", "node"],
  ["bun", "bun"],
]);
/** 확장자로 정하는 실행기(migration.md §4.3.5) */
const EXTENSION_RUNNER: ReadonlyMap<string, HookRunner> = new Map<string, HookRunner>([
  [".sh", "sh"],
  [".py", "python3"],
  [".js", "node"],
  [".mjs", "node"],
  [".ts", "bun"],
]);
/** 실행기 단어가 받는 확장자 */
const RUNNER_EXTENSIONS: Readonly<Record<HookRunner, readonly string[]>> = {
  sh: [".sh"],
  bash: [".sh"],
  python3: [".py"],
  node: [".js", ".mjs"],
  bun: [".ts", ".js", ".mjs"],
};
const MAX_ARGS = 16;
const MAX_ARG_CHARS = 512;
const CLAUDE_PROJECT_DIR = "CLAUDE_PROJECT_DIR";
const HOME = "HOME";

type Resolved =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "outside" }
  | { readonly kind: "inline" };

/**
 * 셸 단어로 나눈다. 따옴표는 벗기고, 작은따옴표 안의 `$`와 따옴표 안에서 시작하는 `~`는 셸과 다르게 풀리므로 인라인으로 본다.
 * 짝이 안 맞거나 빈 명령이면 undefined다.
 */
function tokenize(command: string): readonly string[] | undefined {
  const tokens: string[] = [];
  let current = "";
  let active = false;
  let quote: "'" | '"' | undefined;
  let quotedStart = false;
  for (const ch of command) {
    if (quote !== undefined) {
      if (ch === quote) {
        quote = undefined;
        continue;
      }
      if (quote === "'" && ch === "$") return undefined;
      if (current === "" && quotedStart && ch === "~") return undefined;
      current += ch;
      continue;
    }
    if (ch === "\\") return undefined;
    if (ch === " " || ch === "\t") {
      if (active) tokens.push(current);
      current = "";
      active = false;
      quotedStart = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      if (!active) quotedStart = true;
      active = true;
      continue;
    }
    current += ch;
    active = true;
  }
  if (quote !== undefined) return undefined;
  if (active) tokens.push(current);
  return tokens.length === 0 ? undefined : tokens;
}

/** 토큰 하나를 절대 경로로 푼다. 알 수 없는 변수, 기준 없는 상대 경로는 `inline` 또는 `outside`다 */
function resolveToken(token: string, ctx: HookCommandContext): Resolved {
  const variable = /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))/.exec(token);
  if (variable !== null) {
    const name = variable[1] ?? variable[2] ?? "";
    const rest = token.slice(variable[0].length);
    if (rest !== "" && !rest.startsWith("/")) return { kind: "inline" };
    let base: string | undefined;
    if (name === CLAUDE_PROJECT_DIR) base = ctx.projectDir;
    else if (name === HOME) base = ctx.homeDir;
    else return { kind: "inline" };
    if (base === undefined) return { kind: "outside" };
    return pathOf(`${base}${rest}`, ctx);
  }
  if (token.includes("$")) return { kind: "inline" };
  if (token === "~" || token.startsWith("~/"))
    return pathOf(`${ctx.homeDir}${token.slice(1)}`, ctx);
  if (token.startsWith("/")) return pathOf(token, ctx);
  if (token.includes("/") || token.startsWith(".")) {
    if (ctx.projectDir === undefined) return { kind: "outside" };
    return pathOf(`${ctx.projectDir}/${token}`, ctx);
  }
  return { kind: "inline" };
}

/** 정리한 절대 경로가 원본 폴더 안인지 본다 */
function pathOf(raw: string, ctx: HookCommandContext): Resolved {
  const path = normalizePath(raw);
  if (path === undefined || !isInside(ctx.folder, path)) return { kind: "outside" };
  return { kind: "path", path };
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot <= 0 ? "" : fileName.slice(dot).toLowerCase();
}

/** 명령 문자열 하나를 푼다. 스크립트 파일의 존재와 내용은 호출자가 본다 */
export function parseHookCommand(command: string, ctx: HookCommandContext): HookCommandParse {
  if (SHELL_OPERATORS.test(command)) return { kind: "blocked", code: "inline_command" };
  const tokens = tokenize(command);
  if (tokens === undefined) return { kind: "blocked", code: "inline_command" };

  const [first, ...rest] = tokens;
  if (first === undefined) return { kind: "blocked", code: "inline_command" };
  const wordRunner = rest.length > 0 ? RUNNER_WORDS.get(first) : undefined;
  const scriptToken = wordRunner === undefined ? first : rest[0];
  const argTokens = wordRunner === undefined ? rest : rest.slice(1);
  if (scriptToken === undefined) return { kind: "blocked", code: "inline_command" };

  const resolved = resolveToken(scriptToken, ctx);
  if (resolved.kind === "inline") return { kind: "blocked", code: "inline_command" };
  if (resolved.kind === "outside") return { kind: "blocked", code: "script_outside_root" };

  const fileName = resolved.path.slice(resolved.path.lastIndexOf("/") + 1);
  const extension = extensionOf(fileName);
  const extensionRunner = EXTENSION_RUNNER.get(extension);
  if (extensionRunner === undefined) return { kind: "blocked", code: "unknown_runner" };
  if (wordRunner !== undefined && !RUNNER_EXTENSIONS[wordRunner].includes(extension)) {
    return { kind: "blocked", code: "inline_command" };
  }

  if (argTokens.length > MAX_ARGS) return { kind: "blocked", code: "inline_command" };
  for (const arg of argTokens) {
    if (arg.includes("$") || arg.length > MAX_ARG_CHARS) {
      return { kind: "blocked", code: "inline_command" };
    }
  }
  return {
    kind: "script",
    path: resolved.path,
    runner: wordRunner ?? extensionRunner,
    fileName,
    args: argTokens,
  };
}
