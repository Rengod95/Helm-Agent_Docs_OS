import { join, parse, sep } from "node:path";
import { attemptAsync, parseJson } from "@fresnel/contracts";
import type { LoaderFs } from "@fresnel/contracts/extensions";
import { TRUST_DETAILS_LIMITS, type TrustDetails } from "@fresnel/contracts/wire";

// X.loading-trust.spec §4.7.4. 신뢰 카드의 자원 이름 미리 보기. 결정이 필요한 판정에만 쓴다. 조립 루트가 쓰므로 ext-host 공개 이름이 아니다.
// 프로젝트 설정 디렉터리와 MCP 파일 이름은 ext-host의 `resources.ts`(`TRUST_REQUIRING_PROJECT_RESOURCES`)와 같은 값이다.
// 이름만 읽는다. 디렉터리는 항목 이름만 보고, 두 MCP 정의 파일만 내용을 JSON으로 읽어 서버 이름과 `command`·`args`만 뽑는다.
// `env`·`url`·`headers` 값은 읽은 뒤 버린다. 실행, import, 등록은 하지 않는다. 폴더는 신뢰 전이라 믿지 않는다: 정의 파일은 상한
// (`MAX_DEFINITION_BYTES`)까지만 읽고, 프로젝트 밖을 가리키는 심볼릭 링크는 따라가지 않는다. 손상이거나 읽지 못한 파일은 목록을 비우고
// `issues`로 알린다(던지지 않는다). 조립 루트(`apps/host`)가 `issues`를 진단 로그로 남기고, 상한으로 잘렸거나 빠진 자리가 있으면
// `details.truncated`로 알린다.

// [결정: 오케스트레이터 기본값, fxPT] 신뢰 전에 읽는 양의 상한. 넘는 것은 싣지 않고 `truncated`로 알린다.
/** 정의 파일 하나를 읽는 상한(바이트). 넘으면 내용을 파싱하지 않는다(`too_large`) */
const MAX_DEFINITION_BYTES = 256 * 1024;
/** 정의 파일 하나에서 싣는 MCP 서버 수. 파일이 두 개라 목록은 합쳐서 최대 100개다 */
const MAX_SERVERS_PER_FILE = 50;
/** 디렉터리 하나에서 싣는 항목 이름 수 */
const MAX_NAMES_PER_DIRECTORY = 100;
/** `command`와 인자 문자열 하나의 글자 수. 말줄임표(`…`)를 포함해 이 수까지 자른다 */
const MAX_STRING_CHARS = 512;
/** 서버 하나의 `args` 항목 수. 넘는 인자는 싣지 않는다 */
const MAX_ARGS = 64;

/** MCP 서버 하나(wire `TrustDetails`의 원소와 같다) */
type McpServer = TrustDetails["mcpServers"][number];

/** 미리 보기가 읽지 못했거나, 손상되었거나, 상한을 넘은 자리. `path`는 프로젝트 루트 기준 상대 경로다 */
interface TrustPreviewIssue {
  readonly path: string;
  readonly reason: "unreadable" | "malformed" | "too_large";
}

interface TrustPreview {
  readonly details: TrustDetails;
  readonly issues: readonly TrustPreviewIssue[];
}

/**
 * 상한까지만 읽은 결과. `missing`은 없는 파일이고, `too_large`는 상한을 넘은 파일(내용은 읽지 않았다),
 * `unreadable`은 일반 파일이 아니거나 읽지 못한 파일이다.
 */
export type BoundedText =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "missing" }
  | { readonly kind: "too_large" }
  | { readonly kind: "unreadable" };

/** `LoaderFs`에 없는 읽기: 크기를 재고 상한까지만 읽는다. 조립 루트가 `node:fs`로 구현한다(`trust.ts`의 `createLoaderFs`) */
export interface TrustPreviewReader {
  readBoundedText(path: string, maxBytes: number): Promise<BoundedText>;
}

/** 미리 보기가 쓰는 파일 접근. 존재 확인, 실제 경로, 목록은 `LoaderFs`에서 오고, 정의 파일 읽기만 상한이 있다 */
export type TrustPreviewFs = Pick<LoaderFs, "exists" | "realpath" | "listDir"> & TrustPreviewReader;

/** 프로젝트 설정 디렉터리 이름(`.fresnel`)과 Claude Code 형식 MCP 정의 파일 이름. `resources.ts`와 같다 */
const FRESNEL_DIR = ".fresnel";
const PROJECT_MCP_JSON = ".mcp.json";
const MCP_FILES: readonly string[] = [PROJECT_MCP_JSON, `${FRESNEL_DIR}/mcp.json`];

const BOM = "﻿";
const ELLIPSIS = "…";

/** 정의 파일 하나의 미리 보기. `truncated`는 이 파일의 서버가 빠졌거나 잘렸다는 뜻이다 */
interface FileServers {
  readonly servers: readonly McpServer[];
  readonly truncated: boolean;
  readonly issue: TrustPreviewIssue | null;
}

/** 디렉터리 하나의 미리 보기 */
interface ListedNames {
  readonly names: readonly string[];
  readonly truncated: boolean;
  readonly issue: TrustPreviewIssue | null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 글자 수가 `max` 이내면 그대로, 넘으면 말줄임표를 붙여 `max`글자로 자른다. 글자는 코드 포인트 단위다 */
function capText(text: string, max: number): { readonly text: string; readonly cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const chars = Array.from(text);
  if (chars.length <= max) return { text, cut: false };
  return { text: `${chars.slice(0, max - 1).join("")}${ELLIPSIS}`, cut: true };
}

/**
 * `args`는 없거나 문자열 목록이어야 한다. 문자열이 아닌 항목이 있으면 `null`이다(실행 인자를 빠뜨린 채 보이지 않게 한다).
 * 항목이 상한을 넘으면 앞쪽만 싣고 잘랐다고 알린다.
 */
function argsOf(value: unknown): { readonly args: string[]; readonly cut: boolean } | null {
  if (value === undefined) return { args: [], cut: false };
  if (!Array.isArray(value)) return null;
  const items: readonly unknown[] = value;
  const args: string[] = [];
  let cut = items.length > MAX_ARGS;
  for (const item of items.slice(0, MAX_ARGS)) {
    if (typeof item !== "string") return null;
    const shown = capText(item, MAX_STRING_CHARS);
    if (shown.cut) cut = true;
    args.push(shown.text);
  }
  return { args, cut };
}

/**
 * 서버 정의 하나. `command`가 빈 값이 아닌 문자열이 아니면(원격 `url` 서버 등) 목록에 싣지 않는다.
 * 이름과 `command`가 상한을 넘으면 말줄임표로 자르고 `cut`을 참으로 한다.
 */
function serverOf(
  name: string,
  entry: unknown,
): { readonly server: McpServer; readonly cut: boolean } | null {
  if (!isRecord(entry)) return null;
  const command = entry.command;
  if (typeof command !== "string" || command.length === 0) return null;
  if (name.length === 0) return null;
  const args = argsOf(entry.args);
  if (args === null) return null;
  const shownName = capText(name, TRUST_DETAILS_LIMITS.serverName);
  const shownCommand = capText(command, MAX_STRING_CHARS);
  return {
    server: { name: shownName.text, command: shownCommand.text, args: args.args },
    cut: shownName.cut || shownCommand.cut || args.cut,
  };
}

/**
 * `{ "mcpServers": { <이름>: { command, args, ... } } }`에서 서버 목록을 뽑는다. 다른 모양이면 빈 목록이다.
 * 파일 하나는 `MAX_SERVERS_PER_FILE`개까지만 싣는다.
 */
function serversOf(root: unknown): { readonly servers: McpServer[]; readonly truncated: boolean } {
  const table = isRecord(root) ? root.mcpServers : undefined;
  if (!isRecord(table)) return { servers: [], truncated: false };
  const servers: McpServer[] = [];
  let truncated = false;
  for (const [name, entry] of Object.entries(table)) {
    const listed = serverOf(name, entry);
    if (listed === null) continue;
    if (servers.length >= MAX_SERVERS_PER_FILE) {
      truncated = true;
      break;
    }
    servers.push(listed.server);
    if (listed.cut) truncated = true;
  }
  return { servers, truncated };
}

function unreadableFile(relative: string): FileServers {
  // 파일은 있는데 내용을 볼 수 없어 그 파일의 서버가 목록에 없다
  return { servers: [], truncated: true, issue: { path: relative, reason: "unreadable" } };
}

/**
 * 프로젝트 루트 안에 있는 정의 파일의 실제 경로. 심볼릭 링크를 푼 뒤 비교하므로 루트 밖을 가리키는 링크는 `null`이다.
 */
async function realPathInside(
  fs: TrustPreviewFs,
  projectRoot: string,
  path: string,
): Promise<string | null> {
  const root = await fs.realpath(projectRoot);
  const real = await fs.realpath(path);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return real === root || real.startsWith(prefix) ? real : null;
}

/** 정의 파일 하나를 읽는다. 없는 파일은 서버가 없고 문제도 없다. 읽지 못했거나 상한을 넘었거나 JSON이 아니면 문제 하나를 남긴다 */
async function serversIn(
  fs: TrustPreviewFs,
  projectRoot: string,
  relative: string,
): Promise<FileServers> {
  const path = join(projectRoot, relative);
  const present = await attemptAsync(() => fs.exists(path));
  if (!present.ok) return unreadableFile(relative);
  if (!present.value) return { servers: [], truncated: false, issue: null };
  const real = await attemptAsync(() => realPathInside(fs, projectRoot, path));
  if (!real.ok || real.value === null) return unreadableFile(relative);
  const target = real.value;
  const read = await attemptAsync(() => fs.readBoundedText(target, MAX_DEFINITION_BYTES));
  if (!read.ok) return unreadableFile(relative);
  const file = read.value;
  if (file.kind === "missing") return { servers: [], truncated: false, issue: null };
  if (file.kind === "unreadable") return unreadableFile(relative);
  if (file.kind === "too_large") {
    return { servers: [], truncated: true, issue: { path: relative, reason: "too_large" } };
  }
  const text = file.text;
  const json = parseJson(text.startsWith(BOM) ? text.slice(1) : text);
  if (!json.ok) {
    return { servers: [], truncated: false, issue: { path: relative, reason: "malformed" } };
  }
  return { ...serversOf(json.value), issue: null };
}

/** 디렉터리 항목 이름. 없는 디렉터리는 빈 목록이고, 읽지 못하면 문제 하나를 남긴다. 이름은 `MAX_NAMES_PER_DIRECTORY`개까지 싣는다 */
async function namesIn(
  fs: TrustPreviewFs,
  projectRoot: string,
  relative: string,
  nameOf: (entryName: string) => string,
): Promise<ListedNames> {
  const listed = await attemptAsync(() => fs.listDir(join(projectRoot, relative)));
  if (!listed.ok) {
    return { names: [], truncated: true, issue: { path: relative, reason: "unreadable" } };
  }
  const entries = listed.value;
  if (entries === null) return { names: [], truncated: false, issue: null };
  const names = entries
    .map((entry) => nameOf(entry.name))
    .filter((name) => name.length > 0 && name.length <= TRUST_DETAILS_LIMITS.name)
    .toSorted();
  return {
    names: names.slice(0, MAX_NAMES_PER_DIRECTORY),
    truncated: names.length > MAX_NAMES_PER_DIRECTORY,
    issue: null,
  };
}

/**
 * 결정이 필요한 프로젝트의 자원 이름을 미리 본다. 목록은 상한까지만 싣고, 빠지거나 잘린 자리가 있으면 `truncated`를 참으로 한다.
 * 스킬은 `.md` 확장자를 뺀 이름이고, 명령은 확장자를 뺀 파일 이름이다. 나머지는 항목 이름 그대로다.
 */
export async function previewTrustResources(
  fs: TrustPreviewFs,
  projectRoot: string,
): Promise<TrustPreview> {
  const [mcp, hooks, skills, commands, extensions] = await Promise.all([
    Promise.all(MCP_FILES.map((relative) => serversIn(fs, projectRoot, relative))),
    namesIn(fs, projectRoot, `${FRESNEL_DIR}/hooks`, (name) => name),
    namesIn(fs, projectRoot, `${FRESNEL_DIR}/skills`, (name) =>
      name.endsWith(".md") ? name.slice(0, -".md".length) : name,
    ),
    namesIn(fs, projectRoot, `${FRESNEL_DIR}/commands`, (name) => parse(name).name),
    namesIn(fs, projectRoot, `${FRESNEL_DIR}/extensions`, (name) => name),
  ]);
  const lists = [hooks, skills, commands, extensions];
  const issues = [
    ...mcp.flatMap((file) => (file.issue === null ? [] : [file.issue])),
    ...lists.flatMap((list) => (list.issue === null ? [] : [list.issue])),
  ];
  const truncated = mcp.some((file) => file.truncated) || lists.some((list) => list.truncated);
  return {
    details: {
      mcpServers: mcp.flatMap((file) => file.servers),
      hooks: [...hooks.names],
      skills: [...skills.names],
      commands: [...commands.names],
      extensions: [...extensions.names],
      ...(truncated ? { truncated: true } : {}),
    },
    issues,
  };
}
