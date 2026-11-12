import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { assertNever, attempt, err, ok, type Result } from "@fresnel/contracts";

// 사용자의 ssh config(`~/.ssh/config`)에서 호스트 별칭을 읽는다. 원격 연결 화면이 별칭을 고르게 할 때 쓴다. 읽기만 하고 고치지 않는다.
// 값의 뜻은 ssh_config(5)를 따르되, 항목이 되는 것은 와일드카드가 없는 Host 이름뿐이다.
//   - `*` `?` `!`가 든 Host 이름, 첫 Host 줄 앞의 전역 옵션, Match 블록의 옵션은 항목에 반영하지 않는다(와일드카드 기본값도 적용하지 않는다).
//   - 같은 이름이 여러 Host 블록에 나오면 키워드마다 처음 나온 값을 쓴다(ssh 규칙).
//   - Include는 읽은 파일의 지시문을 그 자리에 끼운다. 블록 문맥도 이어진다(ssh와 같다). 상대 경로는 ~/.ssh 기준, `~/`는 홈으로 펼친다.
//     글롭(`*`, `?`)은 경로 조각마다 된다. 최대 깊이 5. 조상 파일을 다시 가리키는 Include(순환)와 없는 파일은 건너뛴다(ssh도 없는 파일을 무시한다).
//     파일이 있는데 읽지 못하면 전체를 `unreadable`로 본다.

export interface SshConfigEntry {
  readonly name: string;
  readonly hostName: string | null;
  readonly user: string | null;
  readonly port: number | null;
  readonly proxyJump: boolean;
}

export type SshConfigReadError = "missing" | "unreadable";

export interface SshConfigRead {
  readonly hosts: readonly SshConfigEntry[];
  readonly unreadable: null | SshConfigReadError;
}

export interface SshConfigDeps {
  /** 홈 디렉터리. 설정 파일은 `<home>/.ssh/config` */
  readonly home: string;
  /** 기본은 node:fs. 없으면 "missing", 그 밖의 읽기 실패는 "unreadable" */
  readonly readFile?: (path: string) => Result<string, SshConfigReadError>;
  /** 글롭 전개용 디렉터리 목록. 기본은 node:fs. 디렉터리가 없으면 "missing" */
  readonly listDir?: (path: string) => Result<readonly string[], SshConfigReadError>;
}

type Directive =
  | { readonly kind: "host"; readonly names: readonly string[] }
  | { readonly kind: "match" }
  | { readonly kind: "option"; readonly key: string; readonly args: readonly string[] }
  | { readonly kind: "include"; readonly patterns: readonly string[] };

const MAX_INCLUDE_DEPTH = 5;
const KEYWORD_LINE = /^([A-Za-z][A-Za-z0-9]*)(?:\s*=\s*|\s+)(.*)$/;
const PORT_TEXT = /^[0-9]{1,5}$/;

/** 값을 공백으로 나누되 큰따옴표 안의 공백은 살린다. 닫히지 않은 따옴표는 null이다 */
function splitArgs(text: string): readonly string[] | null {
  const args: string[] = [];
  let current = "";
  let quoted = false;
  let started = false;
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (!quoted && /\s/.test(char)) {
      if (started) args.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quoted) return null;
  if (started) args.push(current);
  return args;
}

/** 한 줄을 지시문 목록으로 바꾼다. 빈 줄, `#` 주석 줄, 모르는 모양의 줄은 버린다 */
function scanSshConfig(text: string): readonly Directive[] {
  const directives: Directive[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = KEYWORD_LINE.exec(line);
    if (match === null) continue;
    const [, keyword = "", value = ""] = match;
    const key = keyword.toLowerCase();
    if (key === "match") {
      directives.push({ kind: "match" });
      continue;
    }
    const args = splitArgs(value);
    if (args === null || args.length === 0) continue;
    if (key === "host") directives.push({ kind: "host", names: args });
    else if (key === "include") directives.push({ kind: "include", patterns: args });
    else directives.push({ kind: "option", key, args });
  }
  return directives;
}

function isExactName(name: string): boolean {
  return !/[*?!]/.test(name);
}

function parsePort(text: string): number | null {
  if (!PORT_TEXT.test(text)) return null;
  const port = Number(text);
  return port >= 1 && port <= 65_535 ? port : null;
}

function usesProxy(value: string | undefined): boolean {
  return value !== undefined && value.toLowerCase() !== "none";
}

interface Accumulated {
  hostName?: string;
  user?: string;
  port?: number;
  proxyJump?: string;
  proxyCommand?: string;
}

/** 지시문을 항목으로 모은다. 첫 Host 줄 전과 Match 블록은 항목에 반영하지 않는다 */
function entriesFromDirectives(directives: readonly Directive[]): SshConfigEntry[] {
  const order: string[] = [];
  const byName = new Map<string, Accumulated>();
  let current: readonly string[] = [];
  for (const directive of directives) {
    switch (directive.kind) {
      case "host": {
        current = directive.names.filter(isExactName);
        for (const name of current) {
          if (byName.has(name)) continue;
          byName.set(name, {});
          order.push(name);
        }
        break;
      }
      case "match":
        current = [];
        break;
      case "option": {
        const first = directive.args[0];
        if (first === undefined) break;
        for (const name of current) {
          const slot = byName.get(name);
          if (slot === undefined) continue;
          applyOption(slot, directive.key, first);
        }
        break;
      }
      case "include":
        break;
      default:
        return assertNever(directive, "ssh-config.entriesFromDirectives");
    }
  }
  return order.map((name) => {
    const slot: Accumulated = byName.get(name) ?? {};
    return {
      name,
      hostName: slot.hostName ?? null,
      user: slot.user ?? null,
      port: slot.port ?? null,
      proxyJump: usesProxy(slot.proxyJump) || usesProxy(slot.proxyCommand),
    };
  });
}

/** 키워드마다 처음 얻은 값만 남긴다. 잘못된 Port는 값이 없는 것과 같다 */
function applyOption(slot: Accumulated, key: string, value: string): void {
  if (key === "hostname") slot.hostName ??= value;
  else if (key === "user") slot.user ??= value;
  else if (key === "proxyjump") slot.proxyJump ??= value;
  else if (key === "proxycommand") slot.proxyCommand ??= value;
  else if (key === "port" && slot.port === undefined) {
    const port = parsePort(value);
    if (port !== null) slot.port = port;
  }
}

/** 설정 텍스트 한 개를 항목으로 바꾼다. Include는 파일을 읽지 않으므로 무시한다. 파일까지 따르려면 `readSshConfig`를 쓴다 */
export function parseSshConfig(text: string): SshConfigEntry[] {
  return entriesFromDirectives(scanSshConfig(text));
}

function errnoCode(caught: unknown): string {
  if (typeof caught === "object" && caught !== null && "code" in caught) {
    const code: unknown = caught.code;
    if (typeof code === "string") return code;
  }
  return "UNKNOWN";
}

function missingOrUnreadable(code: string): SshConfigReadError {
  return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
}

function defaultReadFile(path: string): Result<string, SshConfigReadError> {
  const read = attempt(() => readFileSync(path, "utf8"));
  if (read.ok) return ok(read.value);
  return err(missingOrUnreadable(errnoCode(read.error.cause)));
}

function defaultListDir(path: string): Result<readonly string[], SshConfigReadError> {
  const listed = attempt(() => readdirSync(path));
  if (listed.ok) return ok(listed.value);
  return err(missingOrUnreadable(errnoCode(listed.error.cause)));
}

interface Context {
  readonly home: string;
  readonly sshDir: string;
  readonly readFile: (path: string) => Result<string, SshConfigReadError>;
  readonly listDir: (path: string) => Result<readonly string[], SshConfigReadError>;
}

function globToRegExp(glob: string): RegExp {
  const body = Array.from(glob, (char) => {
    if (char === "*") return ".*";
    if (char === "?") return ".";
    return char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return new RegExp(`^${body}$`);
}

/** Include 패턴 하나를 파일 경로 목록으로 펼친다. 글롭이 없으면 이름 그대로 한 개다 */
function expandPattern(pattern: string, context: Context): Result<readonly string[], "unreadable"> {
  const withoutHome = pattern === "~" || pattern.startsWith("~/");
  const base = withoutHome ? context.home : isAbsolute(pattern) ? "/" : context.sshDir;
  const rest = withoutHome ? pattern.slice(2) : isAbsolute(pattern) ? pattern.slice(1) : pattern;
  const segments = rest.split("/").filter((segment) => segment !== "");
  return expandSegments(base, segments, context);
}

function expandSegments(
  base: string,
  segments: readonly string[],
  context: Context,
): Result<readonly string[], "unreadable"> {
  const [head, ...tail] = segments;
  if (head === undefined) return ok([base]);
  if (!/[*?]/.test(head)) return expandSegments(join(base, head), tail, context);
  const listed = context.listDir(base);
  if (!listed.ok) return listed.error === "missing" ? ok([]) : err("unreadable");
  const matcher = globToRegExp(head);
  const names = listed.value
    .filter((name) => matcher.test(name) && (!name.startsWith(".") || head.startsWith(".")))
    .toSorted();
  const found: string[] = [];
  for (const name of names) {
    const deeper = expandSegments(join(base, name), tail, context);
    if (!deeper.ok) return deeper;
    found.push(...deeper.value);
  }
  return ok(found);
}

/**
 * 텍스트의 지시문을 펼친다. Include 자리에 읽은 파일의 지시문이 끼고, 파일은 `stack`(조상 경로)에 없을 때만 읽는다.
 * 깊이가 MAX_INCLUDE_DEPTH를 넘으면 건너뛴다.
 */
function expandDirectives(
  text: string,
  depth: number,
  stack: readonly string[],
  context: Context,
): Result<readonly Directive[], "unreadable"> {
  const out: Directive[] = [];
  for (const directive of scanSshConfig(text)) {
    if (directive.kind !== "include") {
      out.push(directive);
      continue;
    }
    for (const pattern of directive.patterns) {
      const paths = expandPattern(pattern, context);
      if (!paths.ok) return paths;
      for (const path of paths.value) {
        if (stack.includes(path) || depth + 1 > MAX_INCLUDE_DEPTH) continue;
        const read = context.readFile(path);
        if (!read.ok) {
          if (read.error === "missing") continue;
          return err("unreadable");
        }
        const nested = expandDirectives(read.value, depth + 1, [...stack, path], context);
        if (!nested.ok) return nested;
        out.push(...nested.value);
      }
    }
  }
  return ok(out);
}

/** `~/.ssh/config`과 그 Include를 읽어 항목 목록을 돌려준다. 읽을 수 없으면 목록은 비고 사유가 붙는다 */
export function readSshConfig(deps: SshConfigDeps): Promise<SshConfigRead> {
  const sshDir = join(deps.home, ".ssh");
  const configPath = join(sshDir, "config");
  const context: Context = {
    home: deps.home,
    sshDir,
    readFile: deps.readFile ?? defaultReadFile,
    listDir: deps.listDir ?? defaultListDir,
  };
  const root = context.readFile(configPath);
  if (!root.ok) return Promise.resolve({ hosts: [], unreadable: root.error });
  const expanded = expandDirectives(root.value, 0, [configPath], context);
  if (!expanded.ok) return Promise.resolve({ hosts: [], unreadable: "unreadable" });
  return Promise.resolve({ hosts: entriesFromDirectives(expanded.value), unreadable: null });
}
