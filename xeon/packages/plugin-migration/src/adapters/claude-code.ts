// Claude Code 설정을 읽기 전용으로 훑는 어댑터. 사용자 범위(`<root>/.claude/…`)와 프로젝트 범위(`<root>/CLAUDE.md`,
// `<root>/AGENTS.md`, `<root>/.claude/…`)를 본다. 쓰기, 프로세스 실행, 네트워크는 없다.
// 본문의 `` !`cmd` ``와 치환, Hook 명령, 설정 값은 실행하지 않는다. 세기만 하거나 키 이름만 싣는다.
// 설정 파일의 값은 파일 하나를 읽는 동안만 메모리에 있고, 항목에는 최상위 키 이름만 남는다(migration.md §6.6).
// 설계: docs/xeon/review/m5/migration.md §3.2, §4.3.1~4.3.4, §6.2, §10 수용 기준 1·3·10·11·20.
import { assertNever, attempt, attemptAsync, eachAsync, parseJson } from "@fresnel/contracts";
import { parseDocument, type FrontmatterValue } from "../frontmatter.ts";
import { itemIdOf, sha256Hex } from "../hash.ts";
import { dirnameOf, displayPath, isInside, joinPath, normalizePath } from "../paths.ts";
import {
  assignsSecretLiteral,
  containsSecretValue,
  looksLikeSecretName,
  looksLikeSecretValue,
} from "../secrets.ts";
import type {
  HarnessId,
  IrAgent,
  IrHook,
  IrHookEnv,
  IrNode,
  ItemScope,
  ScanContext,
  ScanDiagnostic,
  ScanFs,
  ScanLimits,
  ScanRoot,
  ScanStat,
  SourceAdapter,
  SourceItem,
} from "../types.ts";
import { scanSkillsDir } from "./agent-skills.ts";
import { parseHookCommand } from "./hook-command.ts";
import {
  describeHookCommand,
  HOOK_COMMAND_MAX_CHARS,
  HOOK_INPUT_NAMES,
  type HookFileInfo,
} from "./hook-env.ts";

const HARNESS: HarnessId = "claude-code";
const AGENTS_HARNESS: HarnessId = "agents-md";
const RULES_VERSION = "2026-11-20";
const CLAUDE_DIR = ".claude";
/** 가져오기를 푸는 깊이의 상한. 최상위 지침에서 가져온 파일이 1단계다(migration.md §4.3.1) */
const MAX_IMPORT_DEPTH = 4;
const SUMMARY_MAX_CHARS = 80;
const FENCE = "```";
const ENCODER = new TextEncoder();
/** 치환이 있는가를 세는 모양. `$` 바로 뒤에 영문자·밑줄·숫자가 오거나 `` !`cmd` ``가 있다. 세기만 하고 펼치지 않는다 */
const SUBSTITUTION = /\$[A-Za-z0-9_]|!`[^`\n]+`/;
const STANDARD_PERMISSION_MODES: ReadonlySet<string> = new Set([
  "default",
  "acceptEdits",
  "bypassPermissions",
]);
/** 서브에이전트 머리말 가운데 IR이 이미 싣는 키. 그 밖의 키는 field 항목이 된다 */
const AGENT_KNOWN_KEYS: ReadonlySet<string> = new Set([
  "name",
  "description",
  "tools",
  "disallowedTools",
  "model",
  "permissionMode",
]);
/** Hook 핸들러에서 `command` 종류가 받는 키. 그 밖의 키는 옮기지 못하는 키다 */
const COMMAND_HANDLER_KEYS: ReadonlySet<string> = new Set(["type", "command", "timeout", "shell"]);
/** 알려진 핸들러 종류. 이 밖은 `hook_handler_unknown`이다 */
const KNOWN_HANDLER_TYPES: ReadonlySet<string> = new Set([
  "command",
  "http",
  "prompt",
  "agent",
  "mcp_tool",
]);
const SPACE_SPLIT = /\s+/;
/** 시간 제한을 볼 때 쓰는 매처 문법: 글자, 숫자, `_`, `-`, 공백, `,`, `|`만 있으면 정확 일치 목록이다 */
const EXACT_MATCHER = /^[A-Za-z0-9_\-\s,|]+$/;
/** 설정 최상위 키가 옮기지 못하는 이유. 목록에 없는 키는 모르는 키라 `settings_key`다(규칙이 없어 `no_rule`로 보고된다) */
const SETTINGS_CODES: ReadonlyMap<string, string> = new Map([
  ["permissions", "permissions"],
  ["outputStyle", "output_style"],
  ["enabledPlugins", "plugin_bundle"],
  ["extraKnownMarketplaces", "plugin_bundle"],
  ["env", "settings_known"],
  ["apiKeyHelper", "settings_known"],
  ["statusLine", "settings_known"],
  ["awsAuthRefresh", "settings_known"],
  ["model", "settings_known"],
  ["enabledMcpjsonServers", "settings_known"],
  ["disabledMcpjsonServers", "settings_known"],
  ["enableAllProjectMcpServers", "settings_known"],
]);
const PLUGIN_TEXT = "설치된 Claude Code 플러그인";
const MSG_YAML_BROKEN =
  "머리말을 읽지 못했다. 이 도구가 다루지 않는 YAML 모양이다(내용은 적지 않는다)";
const MSG_NO_HEAD_AGENT = "머리말이 없다. 서브에이전트 파일은 머리말이 필요하다";

type ImportCode = "import_outside_root" | "import_missing" | "import_too_deep";

interface Scan {
  readonly root: ScanRoot;
  readonly fs: ScanFs;
  readonly limits: ScanLimits;
  readonly ctx: ScanContext;
  readonly items: SourceItem[];
  readonly diagnostics: ScanDiagnostic[];
  readonly scanned: string[];
  /** 이미 낸 가져오기 차단 항목의 키 경로. 같은 토큰은 파일마다 한 번만 낸다 */
  readonly blockedImports: Set<string>;
}

/** 읽은 텍스트 파일. 항목의 해시와 길이는 이 원문에서 나온다 */
interface TextFile {
  readonly abs: string;
  readonly shown: string;
  readonly text: string;
  readonly bytes: number;
  readonly sha256: string;
}

interface MdFile {
  readonly abs: string;
  /** 규칙·명령·서브에이전트 폴더 기준 상대 경로(`/` 구분) */
  readonly rel: string;
}

interface WalkAt {
  readonly absDir: string;
  readonly relDir: string;
  readonly depth: number;
  readonly recursive: boolean;
}

interface Segment {
  readonly source: string;
  readonly text: string;
}

interface ImportToken {
  readonly start: number;
  readonly end: number;
  /** 본문에 적힌 그대로의 토큰(`@`를 포함한다) */
  readonly literal: string;
  readonly path: string;
}

type Resolution =
  | { readonly kind: "ok"; readonly segments: readonly Segment[] }
  | { readonly kind: "blocked"; readonly code: ImportCode };

interface ItemInput {
  readonly harness: HarnessId;
  readonly scope: ItemScope;
  readonly path: string;
  readonly keyPath?: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly ir: IrNode;
  readonly warnings: readonly string[];
}

interface InstructionInput {
  readonly role: "user_global" | "rule";
  readonly name: string;
  readonly activation: "always" | "globs";
  readonly globs: readonly string[];
  readonly body: string;
  readonly warnings: readonly string[];
}

interface ClaudeCodeScanResult {
  readonly items: readonly SourceItem[];
  readonly diagnostics: readonly ScanDiagnostic[];
  readonly scanned: readonly string[];
}

// ── 작은 도우미 ───────────────────────────────────────────────────────────

function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function shownOf(scan: Scan, abs: string): string {
  return displayPath(abs, scan.ctx.homeDir);
}

function diagnose(scan: Scan, code: ScanDiagnostic["code"], abs: string, message: string): void {
  scan.diagnostics.push({ code, path: shownOf(scan, abs), message });
}

function baseName(abs: string): string {
  return abs.slice(abs.lastIndexOf("/") + 1);
}

function stripMd(name: string): string {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

/** 규칙·명령·서브에이전트의 이름. 상대 경로에서 확장자를 빼고 `/`를 `-`로 바꾼다 */
function nameOf(rel: string): string {
  return stripMd(rel).replaceAll("/", "-");
}

/** 항목 하나를 만든다. 식별자는 (하네스, 종류, 범위, 표시 경로, 키 경로)에서 나오고 내용이 바뀌어도 같다 */
function itemOf(scan: Scan, input: ItemInput): SourceItem {
  const base = {
    itemId: itemIdOf([input.harness, input.ir.kind, input.scope, input.path, input.keyPath ?? ""]),
    harness: input.harness,
    kind: input.ir.kind,
    scope: input.scope,
    rootLabel: scan.root.label,
    path: input.path,
    sha256: input.sha256,
    bytes: input.bytes,
    ir: input.ir,
    secrets: [],
    warnings: input.warnings,
  };
  return input.keyPath === undefined ? base : { ...base, keyPath: input.keyPath };
}

/** 훑는 루트 기준 상대 경로. 루트 밖이면 표시 경로를 쓴다(가져오기는 루트 안만 읽으므로 실제로는 드물다) */
function relativeOf(scan: Scan, abs: string): string {
  const base = scan.root.path.endsWith("/") ? scan.root.path : `${scan.root.path}/`;
  return abs.startsWith(base) ? abs.slice(base.length) : shownOf(scan, abs);
}

function textFileOf(scan: Scan, abs: string, text: string): TextFile {
  return {
    abs,
    shown: shownOf(scan, abs),
    text,
    bytes: ENCODER.encode(text).byteLength,
    sha256: sha256Hex(text),
  };
}

// ── 읽기 ──────────────────────────────────────────────────────────────────

/** 없으면 null. 정보를 얻지 못하면 진단을 남기고 null을 돌려준다(읽지 않은 것으로 센다) */
async function statOf(scan: Scan, abs: string): Promise<ScanStat | null> {
  const stat = await attemptAsync(() => scan.fs.lstat(abs));
  if (stat.ok) return stat.value;
  diagnose(scan, "unreadable", abs, "파일 정보를 얻지 못해 읽지 않았다");
  return null;
}

async function namesOf(scan: Scan, dir: string): Promise<readonly string[]> {
  const listed = await attemptAsync(() => scan.fs.listDir(dir));
  if (!listed.ok) {
    diagnose(scan, "unreadable", dir, "폴더 목록을 얻지 못해 읽지 않았다");
    return [];
  }
  return listed.value.toSorted(byCodeUnit);
}

/** 텍스트 파일 하나를 읽는다. 상한을 넘거나 텍스트가 아니거나 읽기가 거절되면 진단을 남기고 undefined다 */
async function readFileText(scan: Scan, abs: string): Promise<TextFile | undefined> {
  const read = await attemptAsync(() => scan.fs.readBounded(abs, scan.limits.maxFileBytes));
  if (!read.ok) {
    diagnose(scan, "unreadable", abs, "읽지 못해 건너뛰었다");
    return undefined;
  }
  const content = read.value;
  switch (content.kind) {
    case "text":
      return textFileOf(scan, abs, content.text);
    case "binary":
      diagnose(scan, "unreadable", abs, "UTF-8 텍스트가 아니라 읽지 않았다");
      return undefined;
    case "too_large":
      diagnose(
        scan,
        "too_large",
        abs,
        `파일이 파일당 상한(${scan.limits.maxFileBytes} 바이트)을 넘어 읽지 않았다`,
      );
      return undefined;
    case "unreadable":
      diagnose(scan, "unreadable", abs, "읽지 못해 건너뛰었다");
      return undefined;
    default:
      return assertNever(content, "readFileText");
  }
}

/**
 * 훑는 위치 하나인 파일. 없으면 undefined이고 `scanned`에 넣지 않는다. 있으면 `scanned`에 넣고, 심볼릭 링크와
 * 파일이 아닌 것은 따라가지 않고 진단만 남긴다.
 */
async function readTopFile(scan: Scan, abs: string): Promise<TextFile | undefined> {
  const stat = await statOf(scan, abs);
  if (stat === null) return undefined;
  scan.scanned.push(shownOf(scan, abs));
  if (stat.kind === "symlink") {
    diagnose(scan, "unreadable", abs, "심볼릭 링크라 따라가지 않았다");
    return undefined;
  }
  if (stat.kind !== "file") {
    diagnose(scan, "unreadable", abs, "일반 파일이 아니라 읽지 않았다");
    return undefined;
  }
  return readFileText(scan, abs);
}

/** 폴더 하나 아래의 `.md` 파일을 경로 순으로 모은다. 폴더가 없으면 빈 목록이고 `scanned`에도 넣지 않는다 */
async function markdownUnder(
  scan: Scan,
  dir: string,
  recursive: boolean,
): Promise<readonly MdFile[]> {
  const stat = await statOf(scan, dir);
  if (stat === null) return [];
  scan.scanned.push(shownOf(scan, dir));
  if (stat.kind === "symlink") {
    diagnose(scan, "unreadable", dir, "심볼릭 링크라 따라가지 않았다");
    return [];
  }
  if (stat.kind !== "dir") {
    diagnose(scan, "unreadable", dir, "폴더가 아니라 읽지 않았다");
    return [];
  }
  const found: MdFile[] = [];
  await walkDir(scan, { absDir: dir, relDir: "", depth: 0, recursive }, found);
  return found.toSorted((a, b) => byCodeUnit(a.rel, b.rel));
}

async function walkDir(scan: Scan, at: WalkAt, found: MdFile[]): Promise<void> {
  const names = await namesOf(scan, at.absDir);
  await eachAsync(names, async (name) => {
    await walkEntry(scan, at, name, found);
    return undefined;
  });
}

/** 항목 하나. 심볼릭 링크는 따라가지 않고 진단만 남긴다. 깊이 상한을 넘는 폴더는 건너뛰고 진단을 남긴다 */
async function walkEntry(scan: Scan, at: WalkAt, name: string, found: MdFile[]): Promise<void> {
  const abs = joinPath(at.absDir, name);
  const rel = at.relDir === "" ? name : `${at.relDir}/${name}`;
  const stat = await statOf(scan, abs);
  if (stat === null) return;
  if (stat.kind === "file") {
    if (name.endsWith(".md")) found.push({ abs, rel });
    return;
  }
  if (stat.kind === "dir") {
    if (!at.recursive) return;
    if (at.depth + 1 > scan.limits.maxDepth) {
      diagnose(scan, "limit", abs, `폴더 깊이 상한(${scan.limits.maxDepth})을 넘어 건너뛰었다`);
      return;
    }
    await walkDir(
      scan,
      { absDir: abs, relDir: rel, depth: at.depth + 1, recursive: at.recursive },
      found,
    );
    return;
  }
  if (stat.kind === "symlink") {
    diagnose(scan, "unreadable", abs, "심볼릭 링크라 따라가지 않았다");
    return;
  }
  if (name.endsWith(".md")) {
    diagnose(scan, "unreadable", abs, "일반 파일이나 폴더가 아니라 읽지 않았다");
  }
}

// ── 머리말 도우미 ─────────────────────────────────────────────────────────

/** 글자 값만 받는다. 그 밖의 형식은 undefined다 */
function textOf(value: FrontmatterValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * 쉼표로 나눈 글자 목록. 괄호와 중괄호 안의 쉼표는 나누지 않는다(`src/{a,b}/*.ts`). 배열은 원소가 모두 글자일 때만 읽는다.
 */
function listOf(value: FrontmatterValue): readonly string[] | undefined {
  if (typeof value === "string") return splitTopLevel(value);
  if (!Array.isArray(value)) return undefined;
  const list: readonly FrontmatterValue[] = value;
  const texts: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") return undefined;
    texts.push(item);
  }
  return texts;
}

function splitTopLevel(text: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth += 1;
    else if (ch === ")" || ch === "]" || ch === "}") depth = Math.max(0, depth - 1);
    current += ch;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}

/**
 * 머리말 키 하나를 읽는다. 값이 없거나 null이면 undefined이고 조용하다. 값이 있는데 형식이 맞지 않으면
 * 항목 경고에 적는다(조용히 버리지 않는다).
 */
function readKey<T>(
  fm: ReadonlyMap<string, FrontmatterValue>,
  key: string,
  read: (value: FrontmatterValue) => T | undefined,
  warnings: string[],
): T | undefined {
  const value = fm.get(key);
  if (value === undefined || value === null) return undefined;
  const got = read(value);
  if (got === undefined) warnings.push(`${key}: 값의 형식이 맞지 않아 옮기지 않았다`);
  return got;
}

/** 필드 값 요약. 짧은 글자, 수, 불리언만 싣고 시크릿 이름이나 모양은 싣지 않는다 */
function summaryOf(key: string, value: FrontmatterValue): string | undefined {
  if (looksLikeSecretName(key)) return undefined;
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (typeof value !== "string" || looksLikeSecretValue(value)) return undefined;
  return value.length <= SUMMARY_MAX_CHARS ? value : undefined;
}

function listSummary(list: readonly string[]): string | undefined {
  const text = list.join(", ");
  return text.length <= SUMMARY_MAX_CHARS && !looksLikeSecretValue(text) ? text : undefined;
}

/** 코드 펜스(```) 안과 펜스 줄을 뺀 글자. 치환을 세는 자리에만 쓴다 */
function outsideFences(text: string): string {
  const kept: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith(FENCE)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) kept.push(line);
  }
  return kept.join("\n");
}

function fieldOf(
  scan: Scan,
  file: TextFile,
  keyPath: string,
  container: string,
  key: string,
  summary: string | undefined,
): SourceItem {
  return itemOf(scan, {
    harness: HARNESS,
    scope: scan.root.scope,
    path: file.shown,
    keyPath,
    sha256: file.sha256,
    bytes: file.bytes,
    ir: { kind: "field", container, key, summary },
    warnings: [],
  });
}

// ── 가져오기(`@경로`) ─────────────────────────────────────────────────────

/** 경로 모양인가. 경로에 `/`나 `.`가 있어야 가져오기로 본다(`@me`, 이메일은 아니다) */
function isImportPath(path: string): boolean {
  return path !== "" && (path.includes("/") || path.includes("."));
}

/**
 * 한 줄의 가져오기 토큰을 찾는다. 토큰은 줄 시작이나 공백 바로 뒤의 `@`로 시작하고 공백 없는 글자가 이어진다.
 * 인라인 백틱 안은 건너뛴다. 코드 펜스 줄은 호출자가 뺀다.
 */
function scanImportLine(line: string, lineStart: number, found: ImportToken[]): void {
  let inCode = false;
  let at = 0;
  while (at < line.length) {
    const ch = line.charAt(at);
    if (ch === "`") {
      inCode = !inCode;
      at += 1;
    } else if (ch === "@" && !inCode && (at === 0 || /\s/.test(line.charAt(at - 1)))) {
      let end = at + 1;
      while (end < line.length && !/[\s`]/.test(line.charAt(end))) {
        end += 1;
      }
      const path = line.slice(at + 1, end);
      if (isImportPath(path)) {
        found.push({
          start: lineStart + at,
          end: lineStart + end,
          literal: line.slice(at, end),
          path,
        });
      }
      at = end;
    } else {
      at += 1;
    }
  }
}

function importTokensOf(text: string): readonly ImportToken[] {
  const found: ImportToken[] = [];
  let lineStart = 0;
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith(FENCE)) {
      inFence = !inFence;
    } else if (!inFence) {
      scanImportLine(line, lineStart, found);
    }
    lineStart += line.length + 1;
  }
  return found;
}

/** 토큰이 가리키는 절대 경로(정리 전). `~/`는 홈, `/`는 절대, 그 밖은 그 토큰이 든 파일의 폴더 기준이다 */
function importTargetOf(path: string, fromAbs: string, homeDir: string): string {
  if (path.startsWith("~/")) return joinPath(homeDir, path.slice(2));
  if (path.startsWith("/")) return path;
  return joinPath(dirnameOf(fromAbs), path);
}

/** 풀지 못한 토큰을 한 번만 낸다. 항목은 토큰이 든 파일 기준이다 */
function blockImport(scan: Scan, file: TextFile, literal: string, code: ImportCode): void {
  const keyPath = `${relativeOf(scan, file.abs)}.import.${literal}`;
  if (scan.blockedImports.has(keyPath)) return;
  scan.blockedImports.add(keyPath);
  scan.items.push(
    itemOf(scan, {
      harness: HARNESS,
      scope: scan.root.scope,
      path: file.shown,
      keyPath,
      sha256: file.sha256,
      bytes: file.bytes,
      ir: { kind: "blocked", of: "instruction", code, text: literal },
      warnings: [],
    }),
  );
}

function blockedBy(code: ImportCode): Resolution {
  return { kind: "blocked", code };
}

/** 토큰 하나를 푼다. 루트 밖, 깊이 초과, 순환, 없음, 읽기 실패면 막힌 것이다 */
async function resolveImport(
  scan: Scan,
  from: TextFile,
  token: ImportToken,
  depth: number,
  chain: readonly string[],
): Promise<Resolution> {
  const target = normalizePath(importTargetOf(token.path, from.abs, scan.ctx.homeDir));
  if (target === undefined || !isInside(scan.root.path, target)) {
    return blockedBy("import_outside_root");
  }
  if (depth > MAX_IMPORT_DEPTH || chain.includes(target)) return blockedBy("import_too_deep");

  const stat = await statOf(scan, target);
  if (stat === null) return blockedBy("import_missing");
  if (stat.kind === "symlink") {
    diagnose(scan, "unreadable", target, "심볼릭 링크라 따라가지 않았다");
    return blockedBy("import_missing");
  }
  if (stat.kind !== "file") return blockedBy("import_missing");
  // 가운데 폴더가 심볼릭 링크여서 루트 밖을 가리키는 경우를 막는다(수용 기준 19)
  const real = await attemptAsync(() => scan.fs.realpath(target));
  const rootReal = await attemptAsync(() => scan.fs.realpath(scan.root.path));
  if (!real.ok || !rootReal.ok) {
    diagnose(scan, "unreadable", target, "실제 위치를 풀지 못해 읽지 않았다");
    return blockedBy("import_missing");
  }
  if (!isInside(rootReal.value, real.value)) return blockedBy("import_outside_root");

  const read = await readFileText(scan, target);
  if (read === undefined) return blockedBy("import_missing");
  const segments = await expandImports(scan, read, read.text, depth, [...chain, target]);
  return { kind: "ok", segments };
}

/**
 * `text`(파일 `file`의 본문 전체나 머리말을 뺀 본문)에서 가져오기를 푼다. 풀린 자리는 가져온 조각으로 바뀌고,
 * 풀지 못한 토큰은 글자 그대로 남는다. 반환하는 조각에는 빈 것도 섞일 수 있다(호출자가 거른다).
 */
async function expandImports(
  scan: Scan,
  file: TextFile,
  text: string,
  depth: number,
  chain: readonly string[],
): Promise<readonly Segment[]> {
  const source = relativeOf(scan, file.abs);
  const out: Segment[] = [];
  let pending = "";
  let cursor = 0;
  await eachAsync(importTokensOf(text), async (token) => {
    const resolved = await resolveImport(scan, file, token, depth + 1, chain);
    if (resolved.kind === "blocked") {
      blockImport(scan, file, token.literal, resolved.code);
      return undefined;
    }
    pending += text.slice(cursor, token.start);
    out.push({ source, text: pending }, ...resolved.segments);
    pending = "";
    cursor = token.end;
    return undefined;
  });
  pending += text.slice(cursor);
  out.push({ source, text: pending });
  return out;
}

/** 빈 조각을 거른다. 조각이 하나도 없으면 빈 조각 하나를 둔다. `text`는 조각을 이어 붙인 값이다 */
function partsOf(
  segments: readonly Segment[],
  source: string,
): { readonly parts: readonly Segment[]; readonly text: string } {
  const kept = segments.filter((segment) => segment.text !== "");
  const parts: readonly Segment[] = kept.length === 0 ? [{ source, text: "" }] : kept;
  return { parts, text: parts.map((part) => part.text).join("") };
}

// ── 항목 만들기 ───────────────────────────────────────────────────────────

/** 사용자 지침과 규칙. 가져오기를 풀어 조각으로 나눈다 */
async function instructionItem(scan: Scan, file: TextFile, input: InstructionInput): Promise<void> {
  const segments = await expandImports(scan, file, input.body, 0, [file.abs]);
  const { parts, text } = partsOf(segments, relativeOf(scan, file.abs));
  scan.items.push(
    itemOf(scan, {
      harness: HARNESS,
      scope: scan.root.scope,
      path: file.shown,
      sha256: file.sha256,
      bytes: file.bytes,
      ir: {
        kind: "instruction",
        name: input.name,
        text,
        activation: input.activation,
        globs: input.globs,
        role: input.role,
        onlyAgentsMdImport: false,
        parts,
      },
      warnings: input.warnings,
    }),
  );
}

/** 프로젝트 지침 파일과 AGENTS.md. 가져오기는 풀지 않고 원문 그대로 하나의 조각으로 싣는다 */
function projectFileItem(
  scan: Scan,
  file: TextFile,
  role: "project_file" | "agents_md",
  scope: ItemScope,
): void {
  const source = relativeOf(scan, file.abs);
  scan.items.push(
    itemOf(scan, {
      harness: role === "agents_md" ? AGENTS_HARNESS : HARNESS,
      scope,
      path: file.shown,
      sha256: file.sha256,
      bytes: file.bytes,
      ir: {
        kind: "instruction",
        name: stripMd(baseName(file.abs)),
        text: file.text,
        activation: "always",
        globs: [],
        role,
        onlyAgentsMdImport: role === "project_file" && file.text.trim() === "@AGENTS.md",
        parts: [{ source, text: file.text }],
      },
      warnings: [],
    }),
  );
}

async function ruleItem(scan: Scan, md: MdFile, file: TextFile): Promise<void> {
  const parsed = parseDocument(file.text);
  const warnings: string[] = [];
  let body = file.text;
  let globs: readonly string[] = [];
  if (!parsed.ok) {
    // 머리말을 알 수 없으므로 원문 전체를 조건 없는 규칙으로 옮긴다
    diagnose(scan, "invalid_frontmatter", md.abs, MSG_YAML_BROKEN);
  } else if (parsed.value.hasFrontmatter) {
    body = parsed.value.body;
    globs = readKey(parsed.value.frontmatter, "paths", listOf, warnings) ?? [];
  }
  await instructionItem(scan, file, {
    role: "rule",
    name: nameOf(md.rel),
    activation: globs.length > 0 ? "globs" : "always",
    globs,
    body,
    warnings,
  });
}

function commandItems(scan: Scan, md: MdFile, file: TextFile): void {
  const parsed = parseDocument(file.text);
  const warnings: string[] = [];
  let description: string | undefined;
  let body = file.text;
  if (!parsed.ok) {
    diagnose(scan, "invalid_frontmatter", md.abs, MSG_YAML_BROKEN);
  } else if (parsed.value.hasFrontmatter) {
    const fm = parsed.value.frontmatter;
    body = parsed.value.body;
    description = readKey(fm, "description", textOf, warnings);
    for (const [key, value] of fm) {
      if (key === "description") continue;
      scan.items.push(
        fieldOf(scan, file, `${md.rel}.frontmatter.${key}`, "command", key, summaryOf(key, value)),
      );
    }
  }
  scan.items.push(
    itemOf(scan, {
      harness: HARNESS,
      scope: scan.root.scope,
      path: file.shown,
      sha256: file.sha256,
      bytes: file.bytes,
      ir: {
        kind: "command",
        name: nameOf(md.rel),
        relPath: md.rel,
        text: file.text,
        description,
        hasSubstitutions: SUBSTITUTION.test(outsideFences(body)),
      },
      warnings,
    }),
  );
}

function agentIr(fileName: string, prompt: string): IrAgent {
  return {
    kind: "agent",
    fileName,
    name: undefined,
    description: undefined,
    prompt,
    tools: undefined,
    disallowedTools: undefined,
    model: undefined,
    permissionMode: undefined,
  };
}

function pushAgent(scan: Scan, file: TextFile, agent: IrAgent, warnings: readonly string[]): void {
  scan.items.push(
    itemOf(scan, {
      harness: HARNESS,
      scope: scan.root.scope,
      path: file.shown,
      sha256: file.sha256,
      bytes: file.bytes,
      ir: agent,
      warnings,
    }),
  );
}

function agentItems(scan: Scan, md: MdFile, file: TextFile): void {
  const fileName = stripMd(baseName(md.abs));
  const parsed = parseDocument(file.text);
  if (!parsed.ok) {
    diagnose(scan, "invalid_frontmatter", md.abs, MSG_YAML_BROKEN);
    pushAgent(scan, file, agentIr(fileName, file.text), []);
    return;
  }
  if (!parsed.value.hasFrontmatter) {
    diagnose(scan, "invalid_frontmatter", md.abs, MSG_NO_HEAD_AGENT);
    pushAgent(scan, file, agentIr(fileName, file.text), []);
    return;
  }
  const fm = parsed.value.frontmatter;
  const warnings: string[] = [];
  const agent: IrAgent = {
    kind: "agent",
    fileName,
    name: readKey(fm, "name", textOf, warnings),
    description: readKey(fm, "description", textOf, warnings),
    prompt: parsed.value.body,
    tools: readKey(fm, "tools", listOf, warnings),
    disallowedTools: readKey(fm, "disallowedTools", listOf, warnings),
    model: readKey(fm, "model", textOf, warnings),
    permissionMode: readKey(fm, "permissionMode", textOf, warnings),
  };
  pushAgent(scan, file, agent, warnings);

  for (const [key, value] of fm) {
    if (AGENT_KNOWN_KEYS.has(key)) continue;
    scan.items.push(
      fieldOf(scan, file, `${md.rel}.frontmatter.${key}`, "agent", key, summaryOf(key, value)),
    );
  }
  // 허용 목록으로 번역되는 키는 IR에도 값이 있고, 번역 차이를 보고서가 적도록 field 항목을 하나 더 낸다
  const disallowed = fm.get("disallowedTools");
  if (disallowed !== undefined && disallowed !== null) {
    scan.items.push(
      fieldOf(
        scan,
        file,
        `${md.rel}.frontmatter.disallowedTools`,
        "agent",
        "disallowedTools",
        agent.disallowedTools === undefined ? undefined : listSummary(agent.disallowedTools),
      ),
    );
  }
  // 권한 모드가 셋(default, acceptEdits, bypassPermissions) 밖이면 옮길 수 없으므로 field 항목을 낸다
  const mode = fm.get("permissionMode");
  if (
    mode !== undefined &&
    mode !== null &&
    !(typeof mode === "string" && STANDARD_PERMISSION_MODES.has(mode))
  ) {
    scan.items.push(
      fieldOf(
        scan,
        file,
        `${md.rel}.frontmatter.permissionMode`,
        "agent",
        "permissionMode",
        summaryOf("permissionMode", mode),
      ),
    );
  }
}

// ── Hook(설정의 hooks, migration.md §4.3.5) ───────────────────────────────

/** 배열이면 그 원소들. 아니면 undefined(JSON 값을 `any`로 받지 않는다) */
function itemsOf(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

/** 매처가 정규식 문법으로 풀리지 않으면 참이다(정확 일치 목록과 `*`, 빈 값은 문제가 없다) */
function matcherBroken(matcher: string | undefined): boolean {
  if (matcher === undefined || matcher === "" || matcher === "*") return false;
  if (EXACT_MATCHER.test(matcher)) return false;
  return !attempt(() => new RegExp(matcher)).ok;
}

/** 원본 폴더 기준. 사용자 범위는 `~/.claude`, 프로젝트 범위는 프로젝트 루트다 */
function hookFolderOf(scan: Scan): {
  readonly folder: string;
  readonly projectDir: string | undefined;
} {
  if (scan.root.scope === "user") {
    return { folder: joinPath(scan.root.path, CLAUDE_DIR), projectDir: undefined };
  }
  return { folder: scan.root.path, projectDir: scan.root.path };
}

function hookBlocked(
  scan: Scan,
  file: TextFile,
  scope: ItemScope,
  keyPath: string,
  code: string,
  text: string,
): void {
  scan.items.push(
    itemOf(scan, {
      harness: HARNESS,
      scope,
      path: file.shown,
      keyPath,
      sha256: file.sha256,
      bytes: file.bytes,
      ir: { kind: "blocked", of: "hook", code, text },
      warnings: [],
    }),
  );
}

/**
 * 명령이 원본 폴더 안의 스크립트 파일 하나로 풀렸을 때, 그 파일이 없거나 일반 파일이 아니거나 읽지 못하면 그 이유 코드다.
 * 이 경우만 옮기지 않는다(hard failure). 스크립트는 복사하지 않으므로 그 밖의 경우는 환경 모드로 옮긴다. 실행하지 않는다.
 */
async function scriptProblemOf(
  scan: Scan,
  path: string,
): Promise<"script_missing" | "script_unreadable" | undefined> {
  const stat = await attemptAsync(() => scan.fs.lstat(path));
  if (!stat.ok || stat.value === null) return "script_missing";
  if (stat.value.kind === "dir" || stat.value.kind === "other") return "script_missing";
  const info = await fileInfoOf(scan, path);
  return info !== undefined && info.sha256 === null ? "script_unreadable" : undefined;
}

/** 핸들러 하나의 IR을 만드는 바탕 필드. 옮길 수 없는 이유 `code`는 처음 걸린 것 하나다 */
interface HookBaseFields {
  readonly event: string;
  readonly matcher: string | undefined;
  readonly handler: string;
  readonly timeoutSeconds: number | undefined;
  readonly extraKeys: readonly string[];
  readonly code: string | undefined;
}

function irOf(base: HookBaseFields, env?: IrHookEnv): IrHook {
  return {
    kind: "hook",
    event: base.event,
    matcher: base.matcher,
    handler: base.handler,
    timeoutSeconds: base.timeoutSeconds,
    extraKeys: base.extraKeys,
    code: base.code,
    env,
  };
}

/** 정규 파일 하나의 정보. 심볼릭 링크는 풀어서 보되 훑기 포트가 허용한 루트 밖은 읽지 않는다. 실행하지 않는다 */
async function fileInfoOf(scan: Scan, path: string): Promise<HookFileInfo | undefined> {
  const stat = await attemptAsync(() => scan.fs.lstat(path));
  if (!stat.ok || stat.value === null) return undefined;
  if (stat.value.kind !== "symlink") return regularInfoOf(scan, path);
  const real = await attemptAsync(() => scan.fs.realpath(path));
  if (!real.ok) return undefined;
  return regularInfoOf(scan, real.value);
}

function firstLineOf(text: string): string {
  return (text.split("\n")[0] ?? "").replace(/\r$/, "");
}

async function regularInfoOf(scan: Scan, path: string): Promise<HookFileInfo | undefined> {
  const stat = await attemptAsync(() => scan.fs.lstat(path));
  if (!stat.ok || stat.value === null || stat.value.kind !== "file") return undefined;
  const read = await attemptAsync(() => scan.fs.readBounded(path, scan.limits.maxFileBytes));
  if (!read.ok) {
    return { size: stat.value.size, sha256: null, firstLine: undefined, inputNames: [] };
  }
  const content = read.value;
  switch (content.kind) {
    case "text": {
      const bytes = ENCODER.encode(content.text);
      return {
        size: bytes.byteLength,
        sha256: sha256Hex(bytes),
        firstLine: firstLineOf(content.text),
        inputNames: HOOK_INPUT_NAMES.filter((name) => content.text.includes(name)),
      };
    }
    case "binary":
      return {
        size: content.bytes.byteLength,
        sha256: sha256Hex(content.bytes),
        firstLine: undefined,
        inputNames: [],
      };
    case "too_large":
    case "unreadable":
      return { size: stat.value.size, sha256: null, firstLine: undefined, inputNames: [] };
    default:
      return assertNever(content, "regularInfoOf");
  }
}

/**
 * 핸들러 하나의 IR. `command` 핸들러는 모두 환경 모드로 옮긴다: 명령 원문을 싣고 원래 환경에서 돌린다. 스크립트는 복사하지
 * 않는다(AGE-58 사용자 결정, 2026-11-20). 옮기지 않는 것은 hard failure(스크립트가 없거나 읽지 못함)와 키, 시크릿뿐이다.
 * `fingerprint`는 항목 해시에 더할 원료다(참조 파일의 지문).
 */
async function hookHandlerIr(
  scan: Scan,
  event: string,
  matcher: string | undefined,
  handler: Readonly<Record<string, unknown>>,
): Promise<{ readonly ir: IrHook; readonly fingerprint: string | undefined }> {
  const rawType = handler["type"];
  const type = typeof rawType === "string" ? rawType : "";
  const rawTimeout = handler["timeout"];
  let timeoutSeconds: number | undefined;
  let code: string | undefined;
  if (rawTimeout !== undefined) {
    if (typeof rawTimeout === "number" && Number.isFinite(rawTimeout) && rawTimeout > 0) {
      timeoutSeconds = rawTimeout;
    } else {
      code = "hook_timeout_invalid";
    }
  }
  if (!KNOWN_HANDLER_TYPES.has(type)) code ??= "hook_handler_unknown";
  if (type !== "command") {
    const base: HookBaseFields = {
      event,
      matcher,
      handler: type,
      timeoutSeconds,
      extraKeys: [],
      code,
    };
    return { ir: irOf(base), fingerprint: undefined };
  }

  const extraKeys = Object.keys(handler)
    .filter((key) => !COMMAND_HANDLER_KEYS.has(key))
    .toSorted(byCodeUnit);
  if (extraKeys.includes("if")) code ??= "hook_if_unsupported";
  else if (extraKeys.length > 0) code ??= "hook_key_unsupported";
  const rawShell = handler["shell"];
  if (rawShell !== undefined && rawShell !== "sh" && rawShell !== "bash") {
    code ??= "hook_key_unsupported";
  }
  if (matcherBroken(matcher)) code ??= "matcher_invalid";

  const command = handler["command"];
  if (typeof command !== "string" || command.trim() === "") {
    code ??= "inline_command";
  } else if (containsSecretValue(command) || assignsSecretLiteral(command.split(SPACE_SPLIT))) {
    code ??= "secret_in_command";
  } else if (command.length > HOOK_COMMAND_MAX_CHARS) {
    code ??= "hook_command_too_long";
  }
  const base: HookBaseFields = { event, matcher, handler: type, timeoutSeconds, extraKeys, code };
  if (code !== undefined || typeof command !== "string") {
    return { ir: irOf(base), fingerprint: undefined };
  }

  const { folder, projectDir } = hookFolderOf(scan);
  const parsed = parseHookCommand(command, { folder, projectDir, homeDir: scan.ctx.homeDir });
  // 명령이 원본 폴더 안의 스크립트 파일 하나로 풀리면, 그 파일이 있어야 한다(없으면 옮기지 않는다)
  if (parsed.kind === "script") {
    const problem = await scriptProblemOf(scan, parsed.path);
    if (problem !== undefined)
      return { ir: irOf({ ...base, code: problem }), fingerprint: undefined };
  }

  // 환경 모드(모든 command 핸들러, 사용자 결정 2026-11-20): 명령 원문을 싣고 원래 환경에서 돌린다. 스크립트는 복사하지 않고
  // 참조 파일의 지문과 입력 필드 이름만 낸다
  const env = await describeHookCommand(command, {
    homeDir: scan.ctx.homeDir,
    projectDir,
    shell: rawShell === "bash" ? "bash" : "sh",
    fileInfo: (path) => fileInfoOf(scan, path),
    onPath: scan.ctx.onPath,
  });
  const fingerprint =
    env.refs.length === 0
      ? undefined
      : env.refs.map((ref) => `${ref.path}=${ref.hash ?? "unreadable"}`).join("\n");
  return { ir: irOf(base, env), fingerprint };
}

/**
 * 설정의 `hooks`를 항목으로 바꾼다. 핸들러마다 항목 하나다(`settings.hooks.<이벤트>[i].hooks[j]`). 모양이 맞지 않는 자리는
 * 차단 항목으로 남긴다(조용한 누락 없음). 항목의 해시는 설정 파일과 그 항목이 가리키는 스크립트의 바이트로 만든다.
 */
async function hookItems(
  scan: Scan,
  file: TextFile,
  value: unknown,
  scope: ItemScope,
): Promise<void> {
  if (!isRecord(value)) {
    hookBlocked(scan, file, scope, "settings.hooks", "hook_malformed", "hooks");
    return;
  }
  await eachAsync(Object.keys(value).toSorted(byCodeUnit), async (event) => {
    await hookEventItems(scan, file, scope, event, value[event]);
    return undefined;
  });
}

/** 이벤트 하나의 매처 묶음들. 묶음마다 핸들러를 차례로 낸다 */
async function hookEventItems(
  scan: Scan,
  file: TextFile,
  scope: ItemScope,
  event: string,
  value: unknown,
): Promise<void> {
  const eventKey = `settings.hooks.${event}`;
  const groups = itemsOf(value);
  if (groups === undefined) {
    hookBlocked(scan, file, scope, eventKey, "hook_malformed", event);
    return;
  }
  await eachAsync(groups.entries(), async ([groupIndex, group]) => {
    await hookGroupItems(scan, file, scope, event, `${eventKey}[${groupIndex}]`, group);
    return undefined;
  });
}

/** 매처 묶음 하나. 모르는 키와 모양이 틀린 자리는 차단 항목으로 남는다 */
async function hookGroupItems(
  scan: Scan,
  file: TextFile,
  scope: ItemScope,
  event: string,
  groupKey: string,
  group: unknown,
): Promise<void> {
  if (!isRecord(group)) {
    hookBlocked(scan, file, scope, groupKey, "hook_malformed", event);
    return;
  }
  for (const key of Object.keys(group).toSorted(byCodeUnit)) {
    if (key !== "matcher" && key !== "hooks") {
      hookBlocked(scan, file, scope, `${groupKey}.${key}`, "hook_group_key_unsupported", key);
    }
  }
  const matcher = group["matcher"];
  if (matcher !== undefined && typeof matcher !== "string") {
    hookBlocked(scan, file, scope, groupKey, "hook_malformed", event);
    return;
  }
  const handlers = itemsOf(group["hooks"]);
  if (handlers === undefined) {
    hookBlocked(scan, file, scope, `${groupKey}.hooks`, "hook_malformed", event);
    return;
  }
  const matcherText = matcher === undefined || matcher === "" ? undefined : matcher;
  await eachAsync(handlers.entries(), async ([handlerIndex, handler]) => {
    await hookHandlerItem(
      scan,
      file,
      scope,
      event,
      `${groupKey}.hooks[${handlerIndex}]`,
      matcherText,
      handler,
    );
    return undefined;
  });
}

/** 핸들러 하나를 항목으로 낸다. 항목의 해시는 설정 파일과 스크립트 바이트로 만든다 */
async function hookHandlerItem(
  scan: Scan,
  file: TextFile,
  scope: ItemScope,
  event: string,
  keyPath: string,
  matcher: string | undefined,
  handler: unknown,
): Promise<void> {
  if (!isRecord(handler)) {
    hookBlocked(scan, file, scope, keyPath, "hook_malformed", event);
    return;
  }
  const { ir, fingerprint } = await hookHandlerIr(scan, event, matcher, handler);
  const sha256 =
    fingerprint === undefined ? file.sha256 : sha256Hex(`${file.sha256}:${fingerprint}`);
  scan.items.push(
    itemOf(scan, {
      harness: HARNESS,
      scope,
      path: file.shown,
      keyPath,
      sha256,
      bytes: file.bytes,
      ir,
      warnings: [],
    }),
  );
}

/** 설정 파일 하나. 최상위 키마다 차단 항목을 낸다. 값은 읽은 뒤 버린다 */
async function settingsFile(scan: Scan, abs: string, scope: ItemScope): Promise<void> {
  const file = await readTopFile(scan, abs);
  if (file === undefined) return;
  const parsed = parseJson(file.text);
  if (!parsed.ok) {
    diagnose(scan, "invalid_json", abs, "JSON이 아니라 읽지 않았다");
    return;
  }
  const root = parsed.value;
  if (!isRecord(root)) {
    diagnose(scan, "invalid_json", abs, "최상위가 객체가 아니라 읽지 않았다");
    return;
  }
  // `hooks`는 핸들러마다 항목이라 따로 낸다(항목 순서는 훑기 끝에 정렬된다)
  if (Object.hasOwn(root, "hooks")) await hookItems(scan, file, root["hooks"], scope);
  for (const key of Object.keys(root).toSorted(byCodeUnit)) {
    if (key === "hooks") continue;
    scan.items.push(
      itemOf(scan, {
        harness: HARNESS,
        scope,
        path: file.shown,
        keyPath: `settings.${key}`,
        sha256: file.sha256,
        bytes: file.bytes,
        ir: {
          kind: "blocked",
          of: "field",
          code: SETTINGS_CODES.get(key) ?? "settings_key",
          text: key,
        },
        warnings: [],
      }),
    );
  }
}

// ── 범위별 훑기 ───────────────────────────────────────────────────────────

async function scanRules(scan: Scan, dir: string): Promise<void> {
  const files = await markdownUnder(scan, dir, true);
  await eachAsync(files, async (md) => {
    const file = await readFileText(scan, md.abs);
    if (file !== undefined) await ruleItem(scan, md, file);
    return undefined;
  });
}

async function scanCommands(scan: Scan, dir: string): Promise<void> {
  const files = await markdownUnder(scan, dir, true);
  await eachAsync(files, async (md) => {
    const file = await readFileText(scan, md.abs);
    if (file !== undefined) commandItems(scan, md, file);
    return undefined;
  });
}

async function scanAgents(scan: Scan, dir: string): Promise<void> {
  const files = await markdownUnder(scan, dir, true);
  await eachAsync(files, async (md) => {
    const file = await readFileText(scan, md.abs);
    if (file !== undefined) agentItems(scan, md, file);
    return undefined;
  });
}

/** 출력 스타일은 옮기지 못하므로 파일마다 차단 항목을 낸다. 본문은 해시를 위해서만 읽는다 */
async function scanOutputStyles(scan: Scan, dir: string): Promise<void> {
  const files = await markdownUnder(scan, dir, false);
  await eachAsync(files, async (md) => {
    const file = await readFileText(scan, md.abs);
    if (file !== undefined) {
      scan.items.push(
        itemOf(scan, {
          harness: HARNESS,
          scope: scan.root.scope,
          path: file.shown,
          sha256: file.sha256,
          bytes: file.bytes,
          ir: { kind: "blocked", of: "instruction", code: "output_style", text: baseName(md.abs) },
          warnings: [],
        }),
      );
    }
    return undefined;
  });
}

/** 플러그인 폴더는 존재만 적는다. 내용도 목록도 읽지 않으므로 해시는 자리의 이름에서 만든다 */
async function scanPlugins(scan: Scan, dir: string): Promise<void> {
  const abs = joinPath(dir, "plugins");
  const stat = await statOf(scan, abs);
  if (stat === null) return;
  const path = shownOf(scan, abs);
  scan.scanned.push(path);
  scan.items.push(
    itemOf(scan, {
      harness: HARNESS,
      scope: scan.root.scope,
      path,
      sha256: sha256Hex(path),
      bytes: 0,
      ir: { kind: "blocked", of: "field", code: "plugin_bundle", text: PLUGIN_TEXT },
      warnings: [],
    }),
  );
}

/** `<root>/.claude/` 아래의 것. 폴더 자체가 심볼릭 링크면 따라가지 않고 진단만 남긴다 */
async function scanClaudeDir(scan: Scan): Promise<void> {
  const dir = joinPath(scan.root.path, CLAUDE_DIR);
  const stat = await statOf(scan, dir);
  if (stat === null) return;
  if (stat.kind === "symlink") {
    diagnose(scan, "unreadable", dir, "심볼릭 링크라 따라가지 않았다");
    return;
  }
  if (stat.kind !== "dir") return;

  const claudeMd = await readTopFile(scan, joinPath(dir, "CLAUDE.md"));
  if (claudeMd !== undefined) {
    if (scan.root.scope === "user") {
      await instructionItem(scan, claudeMd, {
        role: "user_global",
        name: stripMd(baseName(claudeMd.abs)),
        activation: "always",
        globs: [],
        body: claudeMd.text,
        warnings: [],
      });
    } else {
      projectFileItem(scan, claudeMd, "project_file", "project");
    }
  }
  await scanRules(scan, joinPath(dir, "rules"));
  const skills = await scanSkillsDir({
    fs: scan.fs,
    dir: joinPath(dir, "skills"),
    scope: scan.root.scope,
    harness: HARNESS,
    rootLabel: scan.root.label,
    limits: scan.limits,
    ctx: scan.ctx,
  });
  scan.items.push(...skills.items);
  scan.diagnostics.push(...skills.diagnostics);
  scan.scanned.push(...skills.scanned);
  await scanCommands(scan, joinPath(dir, "commands"));
  await scanAgents(scan, joinPath(dir, "agents"));
  await settingsFile(scan, joinPath(dir, "settings.json"), scan.root.scope);
  await settingsFile(scan, joinPath(dir, "settings.local.json"), "local");
  await scanOutputStyles(scan, joinPath(dir, "output-styles"));
  if (scan.root.scope === "user") await scanPlugins(scan, dir);
}

/** 프로젝트 루트의 지침 파일. 루트의 `AGENTS.md`만 `agents-md` 하네스로 낸다 */
async function scanProjectRootFiles(scan: Scan): Promise<void> {
  const claude = await readTopFile(scan, joinPath(scan.root.path, "CLAUDE.md"));
  if (claude !== undefined) projectFileItem(scan, claude, "project_file", "project");
  const local = await readTopFile(scan, joinPath(scan.root.path, "CLAUDE.local.md"));
  if (local !== undefined) projectFileItem(scan, local, "project_file", "local");
  const agents = await readTopFile(scan, joinPath(scan.root.path, "AGENTS.md"));
  if (agents !== undefined) projectFileItem(scan, agents, "agents_md", "project");
}

async function scanClaudeCode(
  root: ScanRoot,
  fs: ScanFs,
  limits: ScanLimits,
  ctx: ScanContext,
): Promise<ClaudeCodeScanResult> {
  const scan: Scan = {
    root,
    fs,
    limits,
    ctx,
    items: [],
    diagnostics: [],
    scanned: [],
    blockedImports: new Set<string>(),
  };
  if (root.scope === "project") await scanProjectRootFiles(scan);
  await scanClaudeDir(scan);
  return {
    items: scan.items.toSorted(
      (a, b) => byCodeUnit(a.path, b.path) || byCodeUnit(a.keyPath ?? "", b.keyPath ?? ""),
    ),
    diagnostics: scan.diagnostics,
    scanned: scan.scanned.toSorted(byCodeUnit),
  };
}

export const claudeCodeAdapter: SourceAdapter = {
  harness: HARNESS,
  rulesVersion: RULES_VERSION,
  scan: scanClaudeCode,
};
