// 도구 호출 인자의 화면용 요약과 연속 호출 묶음 세기. 순수 함수이고 던지지 않는다. 모양이 맞지 않으면 generic이다.
// 도구 이름과 인자 모양의 출처: packages/contracts/src/capabilities/defs/workspace.ts(read, write, edit, grep, ls, bash),
// work.ts(task_write), knowledge.ts(memory_manage, knowledge_search, skill_*, session_*), web.ts(web_*), mcp.ts(mcp_*),
// packages/core-agents/src/tool.ts(agent). 인자는 모델이 보낸 값이라 모양만 본다.
// MCP 도구의 기계 이름은 `mcp__서버__도구`가 아니라 서버가 광고한 이름 그대로다(cap-mcp/src/client/dynamic-tools.ts `mcpToolName`).
// 그래서 서버는 이름에서 나오지 않고 호출자가 `mcpServer`로 넘긴다(결과의 `details.server`).

import type { WorkTaskStatus } from "@fresnel/contracts/capabilities";

/** 줄에 쓰는 글의 한도(글자 수). generic의 인자 JSON과 MCP 인자 요약이 쓴다 */
const TEXT_MAX = 400;

// ── 요약 타입 ───────────────────────────────────────────────────────────

interface CommandSummary {
  readonly kind: "command";
  /** bash 명령 원문. 긴 값도 그대로 두고 화면이 `previewOf`로 자른다 */
  readonly command: string;
  /** 제한 시간(초). bash 도구의 `timeout`은 초 단위다. 없으면 null */
  readonly timeoutSec: number | null;
}

interface ReadSummary {
  readonly kind: "read";
  readonly path: string;
  /** offset(1부터)이나 limit 가운데 하나라도 있으면 채운다. 둘 다 없으면 null */
  readonly range: { readonly offset: number | null; readonly limit: number | null } | null;
}

interface WriteSummary {
  readonly kind: "write";
  readonly path: string;
}

interface EditSummary {
  readonly kind: "edit";
  readonly path: string;
}

interface SearchSummary {
  readonly kind: "search";
  /** content: grep(파일 내용 정규식), knowledge: knowledge_search(지식·세션 검색) */
  readonly target: "content" | "knowledge";
  readonly pattern: string;
  readonly path: string | null;
  /** grep의 파일 필터 glob. knowledge에는 없다 */
  readonly glob: string | null;
}

interface TaskItemSummary {
  readonly op: "create" | "update" | "link" | "unlink";
  /** create는 같은 호출의 참조(`@a`)나 null이고, update·link·unlink는 작업 id 또는 참조다 */
  readonly ref: string | null;
  /** create는 항상 채운다. update는 바꿀 내용이 있을 때만 채운다. link·unlink는 null */
  readonly content: string | null;
  readonly status: WorkTaskStatus | null;
}

interface TasksSummary {
  readonly kind: "tasks";
  /** task_write의 ops를 순서대로. 하나라도 모양이 맞지 않으면 generic이다 */
  readonly items: readonly TaskItemSummary[];
}

interface MemoryOpSummary {
  readonly action: "add" | "replace" | "remove";
  readonly entryId: string | null;
  readonly text: string | null;
}

interface MemorySummary {
  readonly kind: "memory";
  readonly op: "add" | "replace" | "remove" | "batch";
  readonly store: "user" | "env";
  /** batch에서는 null이다. 항목은 `ops`에 있다 */
  readonly entryId: string | null;
  readonly text: string | null;
  /** batch일 때만 채운다. 그 밖의 op는 빈 배열이다 */
  readonly ops: readonly MemoryOpSummary[];
}

interface McpSummary {
  readonly kind: "mcp";
  readonly server: string;
  readonly tool: string;
  /** 인자 JSON을 400글자 이내로 줄인 글 */
  readonly args: string;
}

type WebOp =
  | "search"
  | "fetch"
  | "research"
  | "browse_open"
  | "browse_act"
  | "browse_read"
  | "browse_close";

interface WebSummary {
  readonly kind: "web";
  readonly op: WebOp;
  /** search의 질의, research의 질문, browse_read의 찾기 질의. 없으면 null */
  readonly query: string | null;
  /** fetch의 url과 urls, research의 seedUrls, browse_open의 url. 없으면 빈 배열 */
  readonly urls: readonly string[];
}

interface AgentSummary {
  readonly kind: "agent";
  readonly agent: string;
  /** 하위 에이전트에 맡긴 일(`task`). 긴 값은 화면이 `previewOf`로 자른다 */
  readonly task: string;
  readonly background: boolean;
}

/** 모양이 맞지 않거나 표에 없는 도구의 인자 JSON을 400글자 이내로 줄인 글 */
interface GenericSummary {
  readonly kind: "generic";
  readonly text: string;
}

/** 화면이 `kind`로 고른다. 실제 도구 인자에서 나온 값만 담는다 */
export type ToolArgsSummary =
  | CommandSummary
  | ReadSummary
  | WriteSummary
  | EditSummary
  | SearchSummary
  | TasksSummary
  | MemorySummary
  | McpSummary
  | WebSummary
  | AgentSummary
  | GenericSummary;

// ── 범주와 묶음 ─────────────────────────────────────────────────────────

export type ToolCategory =
  | "read"
  | "search"
  | "command"
  | "edit"
  | "write"
  | "web"
  | "agent"
  | "tasks"
  | "memory"
  | "mcp"
  | "other";

/**
 * 도구 이름 → 범주. grep, knowledge_search는 찾기라 search다. skill_view와 session_*은 읽기라 read다.
 * skill_manage와 memory_manage는 지식 저장소를 바꾸므로 memory다. 표에 없는 이름은 other다.
 */
const CATEGORY_OF_TOOL: Readonly<Record<string, ToolCategory>> = {
  read: "read",
  ls: "read",
  skill_view: "read",
  session_read: "read",
  session_scroll: "read",
  grep: "search",
  knowledge_search: "search",
  bash: "command",
  edit: "edit",
  write: "write",
  web_search: "web",
  web_fetch: "web",
  web_research: "web",
  web_browse_open: "web",
  web_browse_act: "web",
  web_browse_read: "web",
  web_browse_close: "web",
  agent: "agent",
  task_write: "tasks",
  memory_manage: "memory",
  skill_manage: "memory",
  mcp_servers: "mcp",
  mcp_list_resources: "mcp",
  mcp_read_resource: "mcp",
};

/** 도구 이름의 범주. MCP 서버 도구는 이름만으로 알 수 없어 other다. 호출자가 서버를 알면 `groupToolCalls`에 `mcpServer`를 넘긴다 */
export function toolCategoryOf(toolName: string): ToolCategory {
  return ownValue(CATEGORY_OF_TOOL, toolName) ?? "other";
}

export interface ToolCallInput {
  readonly toolName: string;
  readonly args: unknown;
  /** MCP 도구면 서버 이름(결과의 `details.server`). 빈 문자열과 null은 MCP가 아니다 */
  readonly mcpServer?: string | null;
}

interface ToolCategoryCount {
  readonly category: ToolCategory;
  readonly count: number;
  /** read·edit·write는 path가 있는 호출의 고유 path 개수다(0일 수 있다). 그 밖의 범주는 null이다 */
  readonly distinct: number | null;
}

export interface ToolGroupSummary {
  /** 처음 나온 순서대로 범주별 개수 */
  readonly counts: readonly ToolCategoryCount[];
  readonly total: number;
}

/** 연속된 도구 호출을 범주별로 센다. 문장은 화면이 i18n으로 만든다. path는 글자 그대로 비교한다(정규화하지 않는다) */
export function groupToolCalls(calls: readonly ToolCallInput[]): ToolGroupSummary {
  const groups = new Map<ToolCategory, { count: number; paths: Set<string> }>();
  for (const call of calls) {
    const category = mcpOriginOf(call.mcpServer) === null ? toolCategoryOf(call.toolName) : "mcp";
    const group = groups.get(category) ?? { count: 0, paths: new Set<string>() };
    group.count += 1;
    const path = pathOf(summarizeToolArgs(call.toolName, call.args, call.mcpServer));
    if (path !== null) group.paths.add(path);
    groups.set(category, group);
  }
  const counts = [...groups].map(([category, group]): ToolCategoryCount => ({
    category,
    count: group.count,
    distinct:
      category === "read" || category === "edit" || category === "write" ? group.paths.size : null,
  }));
  return { counts, total: calls.length };
}

// ── 인자 요약 ───────────────────────────────────────────────────────────

/**
 * 도구 호출 인자를 요약한다. `mcpServer`가 있으면 MCP 도구로 보고 `mcp` 요약을 준다.
 * 표에 없는 도구, 객체가 아닌 인자, 필수 필드가 없거나 타입이 틀린 인자는 `generic`이다.
 */
export function summarizeToolArgs(
  toolName: string,
  args: unknown,
  mcpServer?: string | null,
): ToolArgsSummary {
  const server = mcpOriginOf(mcpServer);
  if (server !== null) return { kind: "mcp", server, tool: toolName, args: genericOf(args).text };
  const summarize = ownValue(SUMMARIZERS, toolName);
  if (summarize === undefined || !isRecord(args)) return genericOf(args);
  return summarize(args) ?? genericOf(args);
}

/**
 * 긴 글을 max글자 이내로 자른다(글자는 코드 포인트 단위, 이모지가 둘로 갈리지 않는다). 잘렸으면 끝에 `…`을 붙이고,
 * 그때 결과 길이는 max를 넘지 않는다. max가 1보다 작으면 빈 글이다.
 */
export function previewOf(text: string, max: number): string {
  if (text.length <= max) return text;
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max < 1) return "";
  return `${chars.slice(0, max - 1).join("")}…`;
}

type Summarizer = (args: Record<string, unknown>) => ToolArgsSummary | null;

/** 도구 이름 → 요약기. 요약기는 필수 필드가 없거나 타입이 틀리면 null을 주고 호출자가 generic으로 바꾼다 */
const SUMMARIZERS: Readonly<Record<string, Summarizer>> = {
  bash: commandOf,
  read: readOf,
  ls: lsOf,
  skill_view: skillViewOf,
  write: writeOf,
  edit: editOf,
  grep: grepOf,
  knowledge_search: knowledgeSearchOf,
  task_write: tasksOf,
  memory_manage: memoryOf,
  web_search: webSearchOf,
  web_fetch: webFetchOf,
  web_research: webResearchOf,
  web_browse_open: browseOpenOf,
  web_browse_act: browseSessionOf("browse_act"),
  web_browse_read: browseReadOf,
  web_browse_close: browseSessionOf("browse_close"),
  agent: agentOf,
};

function commandOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const command = args["command"];
  const timeout = optionalOf(args["timeout"], isFiniteNumber);
  if (!isString(command) || !timeout.ok) return null;
  return { kind: "command", command, timeoutSec: timeout.value };
}

/** skill_view: 스킬 이름(지원 파일이면 `이름/파일`)을 읽는 경로로 본다 */
function skillViewOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const name = args["name"];
  const file = optionalOf(args["file"], isString);
  if (!isString(name) || !file.ok) return null;
  return {
    kind: "read",
    path: file.value === null ? name : `${name}/${file.value}`,
    range: null,
  };
}

function readOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const path = args["path"];
  const offset = optionalOf(args["offset"], isInteger);
  const limit = optionalOf(args["limit"], isInteger);
  if (!isString(path) || !offset.ok || !limit.ok) return null;
  const range =
    offset.value === null && limit.value === null
      ? null
      : { offset: offset.value, limit: limit.value };
  return { kind: "read", path, range };
}

/** ls: 폴더를 읽는 호출이라 read로 요약한다. 경로를 생략하면 작업 폴더(`.`)다 */
function lsOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const path = optionalOf(args["path"], isString);
  if (!path.ok) return null;
  return { kind: "read", path: path.value ?? ".", range: null };
}

function writeOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const path = args["path"];
  return isString(path) ? { kind: "write", path } : null;
}

function editOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const path = args["path"];
  return isString(path) ? { kind: "edit", path } : null;
}

function grepOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const pattern = args["pattern"];
  const path = optionalOf(args["path"], isString);
  const glob = optionalOf(args["glob"], isString);
  if (!isString(pattern) || !path.ok || !glob.ok) return null;
  return { kind: "search", target: "content", pattern, path: path.value, glob: glob.value };
}

function knowledgeSearchOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const query = args["query"];
  if (!isString(query)) return null;
  return { kind: "search", target: "knowledge", pattern: query, path: null, glob: null };
}

function tasksOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const items = arrayOf(args["ops"], taskItemOf);
  return items === null ? null : { kind: "tasks", items };
}

function taskItemOf(value: unknown): TaskItemSummary | null {
  if (!isRecord(value)) return null;
  const op = oneOf(value["op"], ["create", "update", "link", "unlink"]);
  if (op === "create") {
    const ref = optionalOf(value["ref"], isString);
    const content = value["content"];
    const status = optionalOf(value["status"], isTaskStatus);
    if (!isString(content) || !ref.ok || !status.ok) return null;
    return { op, ref: ref.value, content, status: status.value };
  }
  if (op === "update") {
    const id = value["id"];
    const content = optionalOf(value["content"], isString);
    const status = optionalOf(value["status"], isTaskStatus);
    if (!isString(id) || !content.ok || !status.ok) return null;
    return { op, ref: id, content: content.value, status: status.value };
  }
  if (op === "link" || op === "unlink") {
    const id = value["id"];
    if (!isString(id) || !isStringArray(value["blockedBy"])) return null;
    return { op, ref: id, content: null, status: null };
  }
  return null;
}

function memoryOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const store = oneOf(args["store"], ["user", "env"]);
  const op = oneOf(args["action"], ["add", "replace", "remove", "batch"]);
  if (store === null || op === null) return null;
  if (op === "batch") {
    const ops = arrayOf(args["ops"], memoryOpOf);
    return ops === null ? null : { kind: "memory", op, store, entryId: null, text: null, ops };
  }
  const entryId = optionalOf(args["entryId"], isString);
  const text = optionalOf(args["text"], isString);
  if (!entryId.ok || !text.ok) return null;
  return { kind: "memory", op, store, entryId: entryId.value, text: text.value, ops: [] };
}

function memoryOpOf(value: unknown): MemoryOpSummary | null {
  if (!isRecord(value)) return null;
  const action = oneOf(value["action"], ["add", "replace", "remove"]);
  const entryId = optionalOf(value["entryId"], isString);
  const text = optionalOf(value["text"], isString);
  if (action === null || !entryId.ok || !text.ok) return null;
  return { action, entryId: entryId.value, text: text.value };
}

function webSearchOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const query = args["query"];
  return isString(query) ? webOf("search", query, []) : null;
}

function webFetchOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const url = optionalOf(args["url"], isString);
  const urls = optionalOf(args["urls"], isStringArray);
  if (!url.ok || !urls.ok) return null;
  const list = [...(url.value === null ? [] : [url.value]), ...(urls.value ?? [])];
  return list.length === 0 ? null : webOf("fetch", null, list);
}

function webResearchOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const question = args["question"];
  const seeds = optionalOf(args["seedUrls"], isStringArray);
  if (!isString(question) || !seeds.ok) return null;
  return webOf("research", question, seeds.value ?? []);
}

function browseOpenOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const url = optionalOf(args["url"], isString);
  if (!url.ok) return null;
  return webOf("browse_open", null, url.value === null ? [] : [url.value]);
}

/** act와 close는 세션 id만 본다. 세션 id가 없으면 모양이 틀린 것이다 */
function browseSessionOf(op: "browse_act" | "browse_close"): Summarizer {
  return (args) => (isString(args["sessionId"]) ? webOf(op, null, []) : null);
}

function browseReadOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const query = optionalOf(args["query"], isString);
  if (!isString(args["sessionId"]) || !query.ok) return null;
  return webOf("browse_read", query.value, []);
}

function agentOf(args: Record<string, unknown>): ToolArgsSummary | null {
  const agent = args["agent"];
  const task = args["task"];
  const background = optionalOf(args["background"], isBoolean);
  if (!isString(agent) || !isString(task) || !background.ok) return null;
  return { kind: "agent", agent, task, background: background.value === true };
}

function webOf(op: WebOp, query: string | null, urls: readonly string[]): ToolArgsSummary {
  return { kind: "web", op, query, urls };
}

function pathOf(summary: ToolArgsSummary): string | null {
  return summary.kind === "read" || summary.kind === "write" || summary.kind === "edit"
    ? summary.path
    : null;
}

// ── 공통 도우미 ─────────────────────────────────────────────────────────

/** 인자 JSON을 400글자 이내로 줄인 generic 요약. 인자는 모델이 보낸 JSON이라 직렬화가 던지지 않는다 */
function genericOf(args: unknown): GenericSummary {
  return { kind: "generic", text: previewOf(jsonTextOf(args) ?? "", TEXT_MAX) };
}

/** `JSON.stringify`는 `undefined`(인자가 없을 때)를 줄 수 있다. 반환 타입을 그대로 둬서 호출부가 그 경우를 보게 한다 */
function jsonTextOf(args: unknown): string | undefined {
  return JSON.stringify(args);
}

function mcpOriginOf(mcpServer: string | null | undefined): string | null {
  return typeof mcpServer === "string" && mcpServer !== "" ? mcpServer : null;
}

/** 키가 객체 자신의 것일 때만 값을 준다. `constructor` 같은 상속 이름이 표에 걸리지 않게 한다 */
function ownValue<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** 있으면 타입을 확인하고, 없으면(undefined) 값 null로 통과한다. 타입이 틀리면 ok가 false다 */
type Optional<T> = { readonly ok: true; readonly value: T | null } | { readonly ok: false };

function optionalOf<T>(
  value: unknown,
  isType: (candidate: unknown) => candidate is T,
): Optional<T> {
  if (value === undefined) return { ok: true, value: null };
  return isType(value) ? { ok: true, value } : { ok: false };
}

/** 값이 선택지 가운데 하나면 그 값을, 아니면 null을 준다 */
function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
  return options.find((option) => option === value) ?? null;
}

/** 배열의 각 원소를 바꾼다. 원소 하나라도 바뀌지 않으면(null) 배열 전체가 null이다. 배열이 아니면 null이다 */
function arrayOf<T>(value: unknown, itemOf: (item: unknown) => T | null): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const out: T[] = [];
  for (const item of value) {
    const mapped = itemOf(item);
    if (mapped === null) return null;
    out.push(mapped);
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(isString);
}

/** 작업 상태 표. 키가 `WorkTaskStatus` 전부여야 한다(빠지면 컴파일이 깨진다) */
const TASK_STATUSES: Readonly<Record<WorkTaskStatus, true>> = {
  pending: true,
  in_progress: true,
  completed: true,
  failed: true,
  cancelled: true,
};

function isTaskStatus(value: unknown): value is WorkTaskStatus {
  return typeof value === "string" && Object.hasOwn(TASK_STATUSES, value);
}
