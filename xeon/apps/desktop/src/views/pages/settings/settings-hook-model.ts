// 외부 훅 정의(`x.operations.hookDefs`) 편집기의 순수 모델(X.operations §4.7.1, L4.settings-ui §4.2.1).
// 값은 호스트가 한 번 더 검사한다. 여기서는 화면에서 바로 알 수 있는 모양만 본다.

const ID_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;
const TOOL_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const ENV_PATTERN = /^[A-Z_][A-Z0-9_]{0,63}$/;

type HookCwd = "project" | "home";

/** 설정 값의 훅 하나 */
export interface HookRow {
  readonly id: string;
  readonly point: string;
  readonly tools?: readonly string[];
  readonly command: readonly string[];
  readonly cwd?: HookCwd;
  readonly timeoutMs?: number;
  readonly env?: readonly string[];
}

/** 화면 입력 글. 목록은 쉼표, 명령은 한 줄에 인자 하나다 */
export interface HookDraft {
  readonly id: string;
  readonly point: string;
  readonly tools: string;
  readonly command: string;
  readonly cwd: HookCwd;
  readonly timeoutMs: string;
  readonly env: string;
}

export const EMPTY_HOOK_DRAFT: HookDraft = {
  id: "",
  point: "",
  tools: "",
  command: "",
  cwd: "project",
  timeoutMs: "",
  env: "",
};

export type HookDraftIssue =
  | "id"
  | "idDuplicate"
  | "point"
  | "command"
  | "tools"
  | "timeout"
  | "env";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringsOf(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

/** 설정 값에서 훅 목록을 읽는다. 모양이 틀린 원소가 하나라도 있으면 null(파일로 고친다) */
export function hooksOf(value: unknown): readonly HookRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: HookRow[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const { id, point, command, tools, cwd, timeoutMs, env } = item;
    const commandList = stringsOf(command);
    if (typeof id !== "string" || typeof point !== "string" || commandList === null) return null;
    const toolList = tools === undefined ? undefined : stringsOf(tools);
    const envList = env === undefined ? undefined : stringsOf(env);
    if (toolList === null || envList === null) return null;
    rows.push({
      id,
      point,
      command: commandList,
      ...(toolList === undefined ? {} : { tools: toolList }),
      ...(cwd === "project" || cwd === "home" ? { cwd } : {}),
      ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
      ...(envList === undefined ? {} : { env: envList }),
    });
  }
  return rows;
}

function listText(items: readonly string[] | undefined): string {
  return (items ?? []).join(", ");
}

export function draftOfHook(row: HookRow): HookDraft {
  return {
    id: row.id,
    point: row.point,
    tools: listText(row.tools),
    command: row.command.join("\n"),
    cwd: row.cwd ?? "project",
    timeoutMs: row.timeoutMs === undefined ? "" : String(row.timeoutMs),
    env: listText(row.env),
  };
}

function splitList(text: string): readonly string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

export type HookDraftResult =
  | { readonly ok: true; readonly row: HookRow }
  | { readonly ok: false; readonly issue: HookDraftIssue };

/** 입력 글을 훅으로 바꾼다. `others`는 같은 목록의 다른 훅 id다 */
export function hookOfDraft(
  draft: HookDraft,
  points: readonly string[],
  others: readonly string[],
): HookDraftResult {
  const id = draft.id.trim();
  if (!ID_PATTERN.test(id)) return { ok: false, issue: "id" };
  if (others.includes(id)) return { ok: false, issue: "idDuplicate" };
  if (!points.includes(draft.point)) return { ok: false, issue: "point" };
  const command = draft.command
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (command.length === 0 || command.length > 64) return { ok: false, issue: "command" };
  const tools = splitList(draft.tools);
  if (tools.length > 64 || tools.some((tool) => !TOOL_PATTERN.test(tool))) {
    return { ok: false, issue: "tools" };
  }
  const env = splitList(draft.env);
  if (env.length > 32 || env.some((name) => !ENV_PATTERN.test(name))) {
    return { ok: false, issue: "env" };
  }
  let timeoutMs: number | undefined;
  if (draft.timeoutMs.trim() !== "") {
    const parsed = Number(draft.timeoutMs);
    if (!Number.isInteger(parsed) || parsed < 100 || parsed > 600_000) {
      return { ok: false, issue: "timeout" };
    }
    timeoutMs = parsed;
  }
  return {
    ok: true,
    row: {
      id,
      point: draft.point,
      command,
      ...(tools.length === 0 ? {} : { tools }),
      ...(draft.cwd === "home" ? { cwd: "home" as const } : {}),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(env.length === 0 ? {} : { env }),
    },
  };
}

/** 목록의 `index` 자리를 바꾸거나(`null`이면 끝에 더한다) */
export function withHook(
  rows: readonly HookRow[],
  index: number | null,
  row: HookRow,
): readonly HookRow[] {
  if (index === null) return [...rows, row];
  return rows.map((item, at) => (at === index ? row : item));
}

export function withoutHook(rows: readonly HookRow[], index: number): readonly HookRow[] {
  return rows.filter((_, at) => at !== index);
}

/** 확인 글에 보일 한 줄 명령. 인자에 공백이 있으면 따옴표로 감싼다 */
export function commandLineOf(command: readonly string[]): string {
  return command.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
}
