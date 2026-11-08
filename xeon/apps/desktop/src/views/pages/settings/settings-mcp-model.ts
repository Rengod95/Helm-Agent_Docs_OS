import { assertNever, err, ok, parseJson, type Result } from "@fresnel/contracts";
import {
  MCP_SERVER_ID_PATTERN,
  type McpBlockedReason,
  type McpServerDef,
  type McpServerState,
  type McpTransport,
} from "@fresnel/contracts/capabilities";
import type { SettingKey } from "@fresnel/contracts/settings";
import type { McpDefinitionView, McpServerRow, McpToolRow } from "@fresnel/contracts/wire";

// 설정 "MCP 서버" 구역의 순수 모델(P-12). 행 하나를 보일 값으로 바꾸고, 폼 초안을 서버 정의로 바꾸며, 사용자 범위 서버 표를 다시 짠다.
// 문장은 여기서 만들지 않는다(`settings-mcp-text.ts`가 메시지 id를 고른다). 그림은 `settings-mcp-view.tsx`, 상태와 명령은 `settings-mcp-screen.tsx`.
// 서버 정의는 저장 모양(`McpServerDef`, transport가 중첩)과 읽기 모양(`McpDefinitionView`, 평탄)이 다르다. 여기서 두 모양을 잇는다.

/** 사용자 범위 서버 표의 설정 키. 일반 표로 그리지 않고 이 구역이 맡는다 */
export const MCP_SERVERS_KEY: SettingKey = "l2.mcp.servers";

/** 구역의 읽기 상태. 다시 읽는 동안에는 이전 행을 그대로 둔다 */
export type McpLoad =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly rows: readonly McpServerRow[];
      /** 읽은 차례. 같은 값으로는 다시 읽지 않는다(효과가 이 값을 보고 다시 읽는다) */
      readonly rev: number;
    };

/** 출처 칩. `origin`이 종류를 가르고, 확장은 `source`의 `ext:` 뒤가 확장 이름이다 */
export type SourceChip =
  | { readonly kind: "mcpjson" }
  | { readonly kind: "settings" }
  | { readonly kind: "extension"; readonly name: string };

const EXT_PREFIX = "ext:";

export function sourceChipOf(row: Pick<McpServerRow, "origin" | "source">): SourceChip {
  switch (row.origin) {
    case "mcpjson":
      return { kind: "mcpjson" };
    case "settings":
      return { kind: "settings" };
    case "extension":
      return {
        kind: "extension",
        name: row.source.startsWith(EXT_PREFIX) ? row.source.slice(EXT_PREFIX.length) : row.source,
      };
    default:
      return assertNever(row.origin, "McpServerOrigin");
  }
}

/** 표시 이름. 이름이 없으면 서버 id다 */
export function nameOf(row: Pick<McpServerRow, "server" | "title">): string {
  return row.title === undefined || row.title === "" ? row.server : row.title;
}

/** 숨은 도구 사유의 종류. cap-mcp가 쓰는 값만 이름을 주고, 모르는 값은 `other`다 */
export type HiddenReasonKind =
  | "name_conflict"
  | "denied"
  | "not_allowed"
  | "name_invalid"
  | "schema_invalid"
  | "other";

const KNOWN_HIDDEN_REASONS: readonly HiddenReasonKind[] = [
  "name_conflict",
  "denied",
  "not_allowed",
  "name_invalid",
  "schema_invalid",
];

/** 숨은 도구 사유 글을 종류로 바꾼다. 알 수 없는 글은 `other`다(글은 호스트가 보내므로 switch로 전부 가리지 않는다) */
export function hiddenReasonKindOf(reason: string): HiddenReasonKind {
  return KNOWN_HIDDEN_REASONS.find((kind) => kind === reason) ?? "other";
}

/** 숨은 도구 한 줄: 개수와 사유 종류(처음 나온 순서, 중복 없음) */
export interface HiddenLine {
  readonly count: number;
  readonly reasons: readonly HiddenReasonKind[];
}

type HiddenTool = NonNullable<McpServerRow["hiddenTools"]>[number];

/** 행의 숨은 도구 줄. 숨은 도구가 없으면 `null`이다 */
export function hiddenLineOf(hidden: readonly HiddenTool[] | undefined): HiddenLine | null {
  if (hidden === undefined || hidden.length === 0) return null;
  return {
    count: hidden.length,
    reasons: [...new Set(hidden.map((tool) => hiddenReasonKindOf(tool.reason)))],
  };
}

/** 도구 하나가 숨었으면 사유 종류, 보이면 `null`이다 */
export function toolHiddenKindOf(tool: McpToolRow): HiddenReasonKind | null {
  if (tool.exposed || tool.hiddenReason === undefined) return null;
  return hiddenReasonKindOf(tool.hiddenReason);
}

/** 행 아래의 안내 종류. 승인 대기는 정보 아이콘 뒤에, 고치는 곳은 행 이름 옆 정보 아이콘 뒤에 둔다 */
export type LocationNote = "mcpjson" | "extension" | "readonly" | null;

export interface McpRowModel {
  readonly server: string;
  readonly name: string;
  /** 표시 이름이 따로 있으면 서버 id를 함께 보인다 */
  readonly idText: string | null;
  readonly source: SourceChip;
  readonly state: McpServerState;
  readonly blocked: McpBlockedReason | null;
  readonly toolCount: number;
  readonly hidden: HiddenLine | null;
  /** 마지막 오류. `message`는 한국어 첫 줄이고, `original`은 서버나 SDK가 준 원문(둘째 줄부터)이다. 원문은 정보 아이콘 뒤에 둔다 */
  readonly error: {
    readonly message: string;
    readonly original: string | null;
    readonly time: string;
  } | null;
  readonly alwaysBlocked: boolean;
  readonly editable: boolean;
  readonly approvalNote: boolean;
  readonly locationNote: LocationNote;
  readonly tools: readonly McpToolRow[];
  readonly stderr: readonly string[];
}

/** 행 하나를 그릴 모델. `locale`은 마지막 오류 시각을 적는 말이다 */
export function rowModelOf(row: McpServerRow, locale: string): McpRowModel {
  const name = nameOf(row);
  const approvalNote = row.blockedReason === "approval_required";
  return {
    server: row.server,
    name,
    idText: name === row.server ? null : row.server,
    source: sourceChipOf(row),
    state: row.state,
    blocked: row.blockedReason ?? null,
    toolCount: row.toolCount,
    hidden: hiddenLineOf(row.hiddenTools),
    error:
      row.lastError === undefined
        ? null
        : {
            message: firstLineOf(row.lastError.message),
            original: originalOf(row.lastError.message),
            time: timeTextOf(row.lastError.at, locale),
          },
    alwaysBlocked: row.alwaysBlocked,
    editable: row.editable,
    approvalNote,
    locationNote: locationNoteOf(row),
    tools: row.tools,
    stderr: row.stderrTail ?? [],
  };
}

function locationNoteOf(row: McpServerRow): LocationNote {
  if (row.editable) return null;
  switch (row.origin) {
    case "mcpjson":
      return "mcpjson";
    case "extension":
      return "extension";
    case "settings":
      return "readonly";
    default:
      return assertNever(row.origin, "McpServerOrigin");
  }
}

/** 행의 "항상 끄기"가 보낼 행동. 이미 차단되어 있으면 풀기다 */
export function blockActionOf(row: Pick<McpRowModel, "alwaysBlocked">): "blockAlways" | "unblock" {
  return row.alwaysBlocked ? "unblock" : "blockAlways";
}

/** 시작 실패를 한 번 알릴 거리. 키는 서버 id와 오류 시각이다 */
export interface FailureNotice {
  readonly key: string;
  readonly server: string;
  readonly name: string;
  readonly reason: string;
}

export function failureKeyOf(server: string, at: number): string {
  return `${server}\n${String(at)}`;
}

/** 실패한 서버 가운데 `seen`에 없는 것만 돌려준다. 같은 서버의 같은 오류 시각은 한 번만 알린다 */
export function newFailuresOf(
  rows: readonly McpServerRow[],
  seen: ReadonlySet<string>,
): readonly FailureNotice[] {
  return rows.flatMap((row) => {
    if (row.state !== "failed" || row.lastError === undefined) return [];
    const key = failureKeyOf(row.server, row.lastError.at);
    if (seen.has(key)) return [];
    return [
      {
        key,
        server: row.server,
        name: nameOf(row),
        reason: causeOf(row.server, firstLineOf(row.lastError.message)),
      },
    ];
  });
}

/** 오류 글의 첫 줄(여러 줄이면 첫 줄만 알린다) */
export function firstLineOf(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}

/** 오류 글의 둘째 줄부터(서버나 SDK의 원문). 없으면 `null`이다 */
export function originalOf(text: string): string | null {
  const rest = text.split("\n").slice(1).join("\n").trim();
  return rest === "" ? null : rest;
}

/** 시작 실패 첫 줄에서 앞의 틀("서버 <id>에 연결하지 못했어요: ")을 뺀 원인. 틀이 없으면 첫 줄 그대로다 */
export function causeOf(server: string, line: string): string {
  const frame = `서버 ${server}에 연결하지 못했어요: `;
  return line.startsWith(frame) ? line.slice(frame.length) : line;
}

function timeTextOf(at: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(at),
  );
}

/** 행 하나를 같은 id의 새 행으로 바꾼다. 없는 id면 그대로다 */
export function withRowReplaced(
  rows: readonly McpServerRow[],
  row: McpServerRow,
): readonly McpServerRow[] {
  return rows.map((candidate) => (candidate.server === row.server ? row : candidate));
}

// ── 폼 초안 ─────────────────────────────────────────────────────────────

/** 이름=값 한 줄. `uid`는 React 키다(같은 목록 안에서 유일하다) */
export interface PairRow {
  readonly uid: number;
  readonly name: string;
  readonly value: string;
}

export interface McpDraft {
  readonly id: string;
  readonly title: string;
  readonly transport: McpTransport["type"];
  readonly command: string;
  /** 인자는 줄마다 하나다(빈 줄은 뺀다) */
  readonly args: string;
  readonly env: readonly PairRow[];
  readonly url: string;
  readonly headers: readonly PairRow[];
}

/** 새 서버의 빈 초안. 전송 방식은 명령 실행(stdio)이다 */
export const EMPTY_DRAFT: McpDraft = {
  id: "",
  title: "",
  transport: "stdio",
  command: "",
  args: "",
  env: [],
  url: "",
  headers: [],
};

/** 폼이 짚는 입력 문제. 한 번에 하나만 보인다 */
export type DraftIssue =
  | "id"
  | "idTaken"
  | "title"
  | "command"
  | "url"
  | "envName"
  | "envDuplicate"
  | "headerName"
  | "headerDuplicate";

const ID_RE = new RegExp(MCP_SERVER_ID_PATTERN);
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,128}$/;
const URL_RE = /^https?:\/\//;
const TITLE_MAX = 80;
const SECRET_NAME_RE = /KEY|TOKEN|SECRET|PASSWORD/i;

function pairsOf(record: Readonly<Record<string, string>> | undefined): readonly PairRow[] {
  return Object.entries(record ?? {}).map(([name, value], uid) => ({ uid, name, value }));
}

/** 읽기 모양(평탄한 정의)을 폼 초안으로 바꾼다. 폼이 다루지 않는 필드는 `mcpDefOfView`의 결과가 싣는다 */
export function draftOfDefinition(id: string, view: McpDefinitionView): McpDraft {
  return {
    id,
    title: view.title ?? "",
    transport: view.transport,
    command: view.command ?? "",
    args: (view.args ?? []).join("\n"),
    env: pairsOf(view.env),
    url: view.url ?? "",
    headers: pairsOf(view.headers),
  };
}

/** 인자 글을 인자 목록으로. 줄마다 하나이고 빈 줄은 뺀다 */
export function argsOfText(text: string): readonly string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");
}

/** 이름=값 행들을 기록으로 바꾼다. 이름과 값이 모두 빈 행은 건너뛴다. 이름이 틀리거나 두 번 있으면 그 문제를 돌려준다 */
function recordOfPairs(
  rows: readonly PairRow[],
  shape: RegExp,
  issues: { readonly name: DraftIssue; readonly duplicate: DraftIssue },
): Result<Readonly<Record<string, string>>, DraftIssue> {
  const record: Record<string, string> = {};
  for (const row of rows) {
    const name = row.name.trim();
    if (name === "" && row.value === "") continue;
    if (!shape.test(name)) return err(issues.name);
    if (Object.hasOwn(record, name)) return err(issues.duplicate);
    record[name] = row.value;
  }
  return ok(record);
}

/** 시크릿처럼 보이는 이름(KEY, TOKEN, SECRET, PASSWORD)에 `secret://` 참조가 아닌 값이 있는가. 그러면 경고를 보인다 */
export function plaintextSecretOf(draft: McpDraft): boolean {
  return draft.env.some(
    (row) =>
      SECRET_NAME_RE.test(row.name) &&
      row.value.trim() !== "" &&
      !row.value.trim().startsWith("secret://"),
  );
}

/** 저장 때 쓰는 값: 서버 id와 정의. 정의의 `transport`는 저장 모양이다 */
export interface DraftEntry {
  readonly id: string;
  readonly def: McpServerDef;
}

/**
 * 폼 초안을 저장 모양으로 바꾼다. `base`는 고칠 때의 원래 정의(없으면 `null`)라서 폼이 다루지 않는 필드(`enabled`, `tools`,
 * `timeouts`, `trustAnnotations`, `sandbox`, 그리고 같은 전송의 `cwd`, `oauth`)는 그대로 남는다. `taken`은 다른 행이 쓰는 id다.
 */
export function defOfDraft(
  draft: McpDraft,
  options: { readonly base: McpServerDef | null; readonly taken: readonly string[] },
): Result<DraftEntry, DraftIssue> {
  const id = draft.id.trim();
  if (!ID_RE.test(id)) return err("id");
  if (options.taken.includes(id)) return err("idTaken");
  const title = draft.title.trim();
  if (title.length > TITLE_MAX) return err("title");
  const transport = transportOfDraft(draft, options.base);
  if (!transport.ok) return err(transport.error);
  const def: McpServerDef = {
    ...(title === "" ? {} : { title }),
    transport: transport.value,
    ...keptOf(options.base),
  };
  return ok({ id, def });
}

function transportOfDraft(
  draft: McpDraft,
  base: McpServerDef | null,
): Result<McpTransport, DraftIssue> {
  switch (draft.transport) {
    case "stdio": {
      const command = draft.command.trim();
      if (command === "") return err("command");
      const env = recordOfPairs(draft.env, ENV_NAME_RE, {
        name: "envName",
        duplicate: "envDuplicate",
      });
      if (!env.ok) return err(env.error);
      const args = argsOfText(draft.args);
      const cwd = base !== null && base.transport.type === "stdio" ? base.transport.cwd : undefined;
      const transport: McpTransport = {
        type: "stdio",
        command,
        ...(args.length === 0 ? {} : { args: [...args] }),
        ...(cwd === undefined ? {} : { cwd }),
        ...(Object.keys(env.value).length === 0 ? {} : { env: env.value }),
      };
      return ok(transport);
    }
    case "http":
    case "sse": {
      const url = draft.url.trim();
      if (!URL_RE.test(url)) return err("url");
      const headers = recordOfPairs(draft.headers, HEADER_NAME_RE, {
        name: "headerName",
        duplicate: "headerDuplicate",
      });
      if (!headers.ok) return err(headers.error);
      const hasHeaders = Object.keys(headers.value).length > 0;
      if (draft.transport === "sse") {
        const transport: McpTransport = {
          type: "sse",
          url,
          ...(hasHeaders ? { headers: headers.value } : {}),
        };
        return ok(transport);
      }
      const oauth =
        base !== null && base.transport.type === "http" ? base.transport.oauth : undefined;
      const transport: McpTransport = {
        type: "http",
        url,
        ...(hasHeaders ? { headers: headers.value } : {}),
        ...(oauth === undefined ? {} : { oauth }),
      };
      return ok(transport);
    }
    default:
      return assertNever(draft.transport, "McpTransport type");
  }
}

/** 폼이 다루지 않는 최상위 필드를 원래 정의에서 옮긴다 */
function keptOf(base: McpServerDef | null): Omit<McpServerDef, "title" | "transport"> {
  if (base === null) return {};
  return {
    ...(base.enabled === undefined ? {} : { enabled: base.enabled }),
    ...(base.tools === undefined ? {} : { tools: base.tools }),
    ...(base.timeouts === undefined ? {} : { timeouts: base.timeouts }),
    ...(base.trustAnnotations === undefined ? {} : { trustAnnotations: base.trustAnnotations }),
    ...(base.sandbox === undefined ? {} : { sandbox: base.sandbox }),
  };
}

/** 읽기 모양(평탄한 `definition`)을 저장 모양(`McpServerDef`)으로 되돌린다. 전송의 필드는 그 전송에만 둔다 */
export function mcpDefOfView(view: McpDefinitionView): McpServerDef {
  return {
    ...(view.title === undefined ? {} : { title: view.title }),
    transport: transportOfView(view),
    ...(view.enabled === undefined ? {} : { enabled: view.enabled }),
    ...(view.tools === undefined ? {} : { tools: view.tools }),
    ...(view.timeouts === undefined ? {} : { timeouts: view.timeouts }),
    ...(view.trustAnnotations === undefined ? {} : { trustAnnotations: view.trustAnnotations }),
    ...(view.sandbox === undefined ? {} : { sandbox: view.sandbox }),
  };
}

function transportOfView(view: McpDefinitionView): McpTransport {
  switch (view.transport) {
    case "stdio":
      return {
        type: "stdio",
        command: view.command ?? "",
        ...(view.args === undefined ? {} : { args: view.args }),
        ...(view.cwd === undefined ? {} : { cwd: view.cwd }),
        ...(view.env === undefined ? {} : { env: view.env }),
      };
    case "http":
      return {
        type: "http",
        url: view.url ?? "",
        ...(view.headers === undefined ? {} : { headers: view.headers }),
        ...(view.oauth === undefined ? {} : { oauth: view.oauth }),
      };
    case "sse":
      return {
        type: "sse",
        url: view.url ?? "",
        ...(view.headers === undefined ? {} : { headers: view.headers }),
      };
    default:
      return assertNever(view.transport, "McpDefinitionView transport");
  }
}

// ── 사용자 범위 서버 표 ───────────────────────────────────────────────────

/** 사용자 설정 파일의 서버 표 전체(`l2.mcp.servers`의 값). 항목은 저장 모양 그대로 둔다 */
export type UserTable = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 사용자 설정 파일 원문에서 서버 표를 읽는다. 빈 파일과 키가 없는 파일은 빈 표다. 파일이 JSON 객체가 아니면 `unreadable`,
 * 키의 값이 객체가 아니면 `invalid`다(그때는 저장하지 않는다. 다른 서버를 잃지 않으려고)
 */
export function userTableOf(text: string): Result<UserTable, "unreadable" | "invalid"> {
  const read: Result<unknown, unknown> =
    text.trim() === "" ? { ok: true, value: {} } : parseJson(text);
  if (!read.ok) return err("unreadable");
  const json = read.value;
  if (!isRecord(json)) return err("unreadable");
  const table = json[MCP_SERVERS_KEY];
  if (table === undefined) return ok({});
  return isRecord(table) ? ok(table) : err("invalid");
}

/**
 * 서버 표에서 한 서버를 바꾼다. `def`가 `null`이면 지운다. 고치면 제자리에 두고, 새 서버는 끝에 붙는다.
 * `previousId`가 `id`와 다르면 이름을 바꾼 것이다(옛 이름을 빼고 새 이름을 그 자리에 둔다). 다른 서버는 그대로 둔다.
 */
export function tableWithServer(
  table: UserTable,
  change: {
    readonly previousId: string | null;
    readonly id: string;
    readonly def: McpServerDef | null;
  },
): UserTable {
  const next: [string, unknown][] = [];
  let placed = false;
  for (const [key, value] of Object.entries(table)) {
    if (key !== change.id && key !== change.previousId) {
      next.push([key, value]);
    } else if (!placed && change.def !== null) {
      next.push([change.id, change.def]);
      placed = true;
    }
  }
  if (!placed && change.def !== null) next.push([change.id, change.def]);
  return Object.fromEntries(next);
}

/** 행들의 id 목록. 폼의 중복 검사가 쓴다 */
export function idsOf(rows: readonly McpServerRow[]): readonly string[] {
  return rows.map((row) => row.server);
}

// ── 이름=값 행 편집 ─────────────────────────────────────────────────────

function nextUidOf(rows: readonly PairRow[]): number {
  return rows.reduce((max, row) => Math.max(max, row.uid + 1), 0);
}

export function withPairAdded(rows: readonly PairRow[]): readonly PairRow[] {
  return [...rows, { uid: nextUidOf(rows), name: "", value: "" }];
}

export function withPairRemoved(rows: readonly PairRow[], uid: number): readonly PairRow[] {
  return rows.filter((row) => row.uid !== uid);
}

export function withPairChanged(
  rows: readonly PairRow[],
  uid: number,
  patch: { readonly name?: string; readonly value?: string },
): readonly PairRow[] {
  return rows.map((row) => (row.uid === uid ? pairWith(row, patch) : row));
}

function pairWith(
  row: PairRow,
  patch: { readonly name?: string; readonly value?: string },
): PairRow {
  return { uid: row.uid, name: patch.name ?? row.name, value: patch.value ?? row.value };
}
