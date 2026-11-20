// Hook 명령의 환경 모드 해석(migration.md §4.3.5, AGE-58 원칙 가). 명령 문자열을 원문 그대로 싣고, 그 명령이 읽을 파일(참조),
// 이 기기에 없는 실행 파일, 버전의 근거 글을 정적으로 찾는다. 명령을 실행하지 않는다. 셸 문법을 완전히 풀지 않는다(느슨한 단어 나누기).
// 순수 함수다: 파일 정보는 `fileInfo`로, PATH 조회는 `onPath`로 받는다. 이 파일은 파일 시스템과 프로세스를 직접 만지지 않는다.
// 참조를 하나도 찾지 못하면 `refsKnown`이 거짓이다. 어떤 파일을 읽는지 추측으로 채우지 않는다.
import { dirnameOf, displayPath, joinPath, normalizePath } from "../paths.ts";
import type { IrHookEnv } from "../types.ts";

/** 명령 문자열 상한(글자). 매니페스트 `env.command`의 상한과 같다 */
export const HOOK_COMMAND_MAX_CHARS = 4096;
/** 참조 파일 상한(개수). 매니페스트 `env.refs`의 상한과 같다 */
const REF_MAX = 16;
/** 참조 경로 길이 상한. 매니페스트 `env.refs[].path`의 상한과 같다 */
const REF_PATH_MAX = 1024;
const SHEBANG_MAX_CHARS = 200;
const VERSION_VALUE_MAX_CHARS = 40;
const VERSION_FILE_NAMES: readonly string[] = [
  ".python-version",
  ".node-version",
  ".tool-versions",
];
/** 참조 후보가 되는 스크립트 확장자. 실행기를 고르는 표와는 따로 본다(여기서는 찾기만 한다) */
const SCRIPT_EXTENSION = /\.(?:sh|py|js|mjs|ts|rb|pl)$/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const PROJECT_VAR = /^\$(?:\{CLAUDE_PROJECT_DIR\}|CLAUDE_PROJECT_DIR)(\/.*)?$/;
const HOME_VAR = /^\$(?:\{HOME\}|HOME)(\/.*)?$/;
/** 이름에 든 버전(`python3.11`, `node20`, `ruby3.2`). 버전을 실행으로 알아내지 않고 이름의 글만 적는다 */
const VERSIONED_NAME = /^[A-Za-z][A-Za-z-]*\d+(?:\.\d+)*$/;
/** 도구가 사는 폴더(`.venv/bin`, `node_modules/.bin`). 첫 단어가 여기 있으면 참조가 아니라 도구다 */
const TOOL_DIR = /\/\.?bin\//;
/** 셸 내장과 예약어. PATH에서 찾지 않는다(`exec`도 내장으로 본다) */
const BUILTINS: ReadonlySet<string> = new Set([
  "cd",
  "echo",
  "printf",
  "test",
  "[",
  "[[",
  "export",
  "unset",
  "set",
  "read",
  "true",
  "false",
  "exit",
  "return",
  "source",
  ".",
  "eval",
  "shift",
  "local",
  "declare",
  "alias",
  "unalias",
  "type",
  "command",
  "builtin",
  "wait",
  "umask",
  "ulimit",
  "pwd",
  "time",
  "trap",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "while",
  "until",
  "do",
  "done",
  "case",
  "esac",
  "in",
  "function",
  "select",
  "{",
  "}",
  "!",
]);
/** 명령을 나누는 셸 구분 문자. 따옴표 밖에서만 구분이다. `<`와 `>`는 따로 다룬다 */
const SEPARATORS: ReadonlySet<string> = new Set(["&", "|", ";", "(", ")", "`", "\n", "\r"]);

/**
 * 참조 파일이 읽는 입력 필드 이름의 목록. 본문에 이 글자가 있으면 그 파일은 그 입력을 읽는다고 본다(추측이 아니라 글자 찾기다).
 * 규칙표의 `scriptInputs`가 같은 이름들에 차이 문장을 단다(claude-code.json, 시험이 두 목록이 같은지 본다).
 */
export const HOOK_INPUT_NAMES: readonly string[] = [
  "transcript_path",
  "tool_response",
  "CLAUDE_PLUGIN_DATA",
  "CLAUDE_ENV_FILE",
];

/** 파일 하나의 정보. 정규 파일이 아니면 호출자가 undefined를 돌린다 */
export interface HookFileInfo {
  readonly size: number;
  /** 바이트의 sha256 16진수. 읽지 못했으면 null(지문을 내지 못한다) */
  readonly sha256: string | null;
  /** 텍스트 파일의 첫 줄(끝의 CR을 뺀다). 이진이면 undefined */
  readonly firstLine: string | undefined;
  /** 텍스트 본문에 나타나는 `HOOK_INPUT_NAMES`의 이름들. 본문은 싣지 않는다 */
  readonly inputNames: readonly string[];
}

export interface HookEnvContext {
  /** 사용자 홈(절대). `~`와 `$HOME`의 기준이다 */
  readonly homeDir: string;
  /** 프로젝트 루트(절대). 상대 경로, `$CLAUDE_PROJECT_DIR`, 명령의 작업 폴더 기준이다. 사용자 범위에서는 없다 */
  readonly projectDir: string | undefined;
  /** 원래 훅 객체의 `shell`. 없으면 `sh`다 */
  readonly shell: "sh" | "bash" | undefined;
  /** 정규 파일의 정보를 돌린다. 없거나 정규 파일이 아니면 undefined다. 읽지 못한 파일은 `sha256: null`이다 */
  readonly fileInfo: (path: string) => Promise<HookFileInfo | undefined>;
  /** PATH에서 실행 파일을 찾는다(없으면 undefined). 이 값이 없으면 도구 존재 검사를 하지 않는다 */
  readonly onPath: ((name: string) => string | undefined) | undefined;
}

/** 따옴표를 벗긴 단어 하나 */
interface Word {
  readonly text: string;
  /** 작은따옴표 안에 `$`가 있었다. 셸은 이것을 변수로 풀지 않는다 */
  readonly literalDollar: boolean;
  /** 셸 구분 문자 사이의 명령 번호 */
  readonly segment: number;
  /** `<`, `>`의 목표(파일 이름)다. 실행 단어와 참조 후보에서 뺀다 */
  readonly target: boolean;
}

interface Candidate {
  readonly path: string;
  /** 명령의 첫 실행 단어인가(도구 폴더 안이면 참조에서 뺀다) */
  readonly head: boolean;
}

/**
 * 느슨한 단어 나누기. 따옴표와 역슬래시를 벗기고, 따옴표 밖의 구분 문자로 명령을 나눈다. 따옴표 안의 연산자는 구분이 아니다.
 * 짝이 안 맞는 따옴표도 오류로 보지 않고 끝까지 읽는다. 셸의 정확한 해석이 아니다.
 */
function wordsOf(command: string): readonly Word[] {
  const words: Word[] = [];
  let text = "";
  let active = false;
  let literalDollar = false;
  let segment = 0;
  let skipNext = false;
  let quote: "'" | '"' | undefined;
  let escaped = false;
  const finish = (): void => {
    if (!active) return;
    words.push({ text, literalDollar, segment, target: skipNext });
    skipNext = false;
    text = "";
    active = false;
    literalDollar = false;
  };
  for (const ch of command) {
    if (quote === "'") {
      if (ch === "'") quote = undefined;
      else {
        if (ch === "$") literalDollar = true;
        text += ch;
      }
      continue;
    }
    if (escaped) {
      text += ch;
      escaped = false;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = undefined;
      else if (ch === "\\") escaped = true;
      else text += ch;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      active = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      active = true;
      continue;
    }
    if (ch === " " || ch === "\t") {
      finish();
      continue;
    }
    if (ch === "<" || ch === ">") {
      finish();
      skipNext = true;
      continue;
    }
    if (SEPARATORS.has(ch)) {
      finish();
      segment += 1;
      continue;
    }
    text += ch;
    active = true;
  }
  finish();
  return words.filter((word) => word.text !== "");
}

/** 명령 번호마다 단어 목록. 리다이렉션 목표는 뺀다 */
function commandsOf(words: readonly Word[]): readonly (readonly Word[])[] {
  const groups = new Map<number, Word[]>();
  for (const word of words) {
    if (word.target) continue;
    const group = groups.get(word.segment) ?? [];
    group.push(word);
    groups.set(word.segment, group);
  }
  return [...groups.values()];
}

/** 명령 하나의 첫 실행 단어: 앞의 `NAME=값` 접두를 건너뛴 첫 단어 */
function headOf(command: readonly Word[]): Word | undefined {
  return command.find((word) => !ASSIGNMENT.test(word.text));
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/** PATH에서 찾을 수 있는 이름인가: 경로도 변수도 아닌 글만 찾는다 */
function isBareName(text: string): boolean {
  return !text.includes("/") && !text.includes("$") && !text.startsWith("~");
}

function isPathLike(text: string): boolean {
  return (
    text.startsWith("/") ||
    text.startsWith("~/") ||
    text.startsWith("./") ||
    text.startsWith("../") ||
    PROJECT_VAR.test(text) ||
    HOME_VAR.test(text)
  );
}

/** 참조 후보: 경로 모양이거나 스크립트 확장자이고, 옵션(`-`로 시작)이 아니다 */
function isCandidate(text: string): boolean {
  if (text.startsWith("-")) return false;
  return isPathLike(text) || SCRIPT_EXTENSION.test(text);
}

function under(base: string | undefined, rest: string): string | undefined {
  return base === undefined ? undefined : normalizePath(`${base}${rest}`);
}

/**
 * 단어 하나를 절대 경로로 푼다. 작은따옴표 안의 `$`, 알 수 없는 변수, 기준 폴더가 없는 상대 경로, 루트 밖은 undefined다.
 * 상대 경로의 기준은 명령의 작업 폴더인 프로젝트 루트다(사용자 범위에서는 알 수 없다).
 */
function resolveWord(word: Word, ctx: HookEnvContext): string | undefined {
  if (word.literalDollar) return undefined;
  const project = PROJECT_VAR.exec(word.text);
  if (project !== null) return under(ctx.projectDir, project[1] ?? "");
  const home = HOME_VAR.exec(word.text);
  if (home !== null) return under(ctx.homeDir, home[1] ?? "");
  if (word.text.includes("$")) return undefined;
  if (word.text === "~" || word.text.startsWith("~/"))
    return under(ctx.homeDir, word.text.slice(1));
  if (word.text.startsWith("/")) return normalizePath(word.text);
  return under(ctx.projectDir, `/${word.text}`);
}

/** 참조 파일 하나의 정보에서 셔뱅 힌트를 만든다. 첫 줄이 `#!`로 시작할 때만 */
function shebangHintOf(info: HookFileInfo): string | undefined {
  const line = info.firstLine;
  if (line === undefined || !line.startsWith("#!")) return undefined;
  return `shebang "${line.slice(0, SHEBANG_MAX_CHARS)}"`;
}

/**
 * Hook 명령 하나를 환경 모드 재료로 바꾼다. 명령 원문을 그대로 `command`에 담고, 찾은 참조와 도구와 버전 근거를 채운다.
 * 아무것도 실행하지 않는다. 이 함수는 옮기지 않는 이유를 돌려주지 않는다(호출자가 시크릿과 모양을 따로 거른다).
 */
export async function describeHookCommand(
  command: string,
  ctx: HookEnvContext,
): Promise<IrHookEnv> {
  const shell = ctx.shell ?? "sh";
  const commands = commandsOf(wordsOf(command));
  const heads = commands.flatMap((group) => {
    const head = headOf(group);
    return head === undefined ? [] : [head];
  });
  const runnable = heads.filter((head) => !BUILTINS.has(head.text));
  const firstWord = runnable[0]?.text;

  const onPath = ctx.onPath;
  const missingTools =
    onPath === undefined
      ? []
      : unique(
          runnable
            .map((head) => head.text)
            .filter((name) => isBareName(name) && onPath(name) === undefined),
        );

  const nameHints = runnable.flatMap((head) => {
    const name = head.text.slice(head.text.lastIndexOf("/") + 1);
    return VERSIONED_NAME.test(name) ? [`name "${name}"`] : [];
  });

  const notes: string[] = [];
  let unresolved = false;
  const candidates: Candidate[] = [];
  for (const group of commands) {
    const head = headOf(group);
    for (const word of group) {
      if (ASSIGNMENT.test(word.text) || !isCandidate(word.text)) continue;
      const path = resolveWord(word, ctx);
      if (path === undefined) {
        unresolved = true;
        continue;
      }
      candidates.push({ path, head: word === head });
    }
  }
  if (unresolved) {
    notes.push(
      "명령이 읽을 파일 가운데 변수나 기준 폴더로 정해지는 것은 찾지 못했다(실행할 때 정해진다)",
    );
  }
  if (heads.some((head) => head.text === "cd")) {
    notes.push(
      "명령이 cd로 작업 폴더를 바꾼다. 상대 경로는 프로젝트 폴더 기준으로 찾았으므로 cd 뒤에서는 어긋날 수 있다",
    );
  }
  const seen = new Set<string>();
  const distinct = candidates.filter((candidate) => {
    if (seen.has(candidate.path)) return false;
    if (candidate.head && TOOL_DIR.test(candidate.path)) return false;
    seen.add(candidate.path);
    return true;
  });
  const infos = await Promise.all(distinct.map((candidate) => ctx.fileInfo(candidate.path)));
  const found = distinct.flatMap((candidate, index) => {
    const info = infos[index];
    return info === undefined ? [] : [{ path: candidate.path, info }];
  });

  const withinLength = found.filter((entry) => entry.path.length <= REF_PATH_MAX);
  if (withinLength.length !== found.length) {
    notes.push(`경로가 ${REF_PATH_MAX}자를 넘는 참조 파일은 적지 않았다`);
  }
  if (withinLength.length > REF_MAX) {
    notes.push(`참조 파일이 ${REF_MAX}개를 넘어 앞의 ${REF_MAX}개만 적었다`);
  }
  const kept = withinLength.slice(0, REF_MAX);
  const refs = kept.map(({ path, info }) => ({
    path,
    hash: info.sha256 === null ? null : `sha256:${info.sha256}`,
  }));
  for (const { path, info } of kept) {
    if (info.sha256 === null) {
      notes.push(`${displayPath(path, ctx.homeDir)}의 지문을 내지 못했다(읽지 못했다)`);
    }
  }

  const shebangHints = kept.flatMap(({ info }) => {
    const hint = shebangHintOf(info);
    return hint === undefined ? [] : [hint];
  });
  const versionPaths = unique(
    kept.flatMap(({ path }) => {
      const dir = dirnameOf(path);
      const dirs = [dir, dirnameOf(dir)];
      const folders = ctx.projectDir === undefined ? dirs : [...dirs, ctx.projectDir];
      return folders.flatMap((folder) => VERSION_FILE_NAMES.map((name) => joinPath(folder, name)));
    }),
  );
  const versionInfos = await Promise.all(versionPaths.map((path) => ctx.fileInfo(path)));
  const versionHints = versionPaths.flatMap((path, index) => {
    const info = versionInfos[index];
    const value = info?.firstLine?.trim() ?? "";
    if (value === "") return [];
    const name = path.slice(path.lastIndexOf("/") + 1);
    return [`file "${name}": "${value.slice(0, VERSION_VALUE_MAX_CHARS)}"`];
  });

  const readsInputs = HOOK_INPUT_NAMES.filter((name) =>
    kept.some(({ info }) => info.inputNames.includes(name)),
  );

  return {
    command,
    shell,
    refs,
    refsKnown: refs.length > 0,
    readsInputs,
    ...(firstWord === undefined ? {} : { firstWord }),
    missingTools,
    versionHints: unique([...nameHints, ...shebangHints, ...versionHints]),
    notes,
  };
}
