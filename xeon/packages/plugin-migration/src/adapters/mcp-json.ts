// Claude Code의 MCP 설정을 읽기 전용으로 훑는 어댑터. 프로젝트 `.mcp.json`과 `~/.claude.json`의 최상위 `mcpServers`만 읽는다.
// 쓰기, 프로세스 실행, 네트워크는 없다. `headersHelper` 같은 명령은 적어 두기만 하고 실행하지 않는다.
// 시크릿 값은 판정 직후 버리고 IR, 경고, 진단 어디에도 싣지 않는다(migration.md §6.6).
// 변환 규칙은 cap-mcp의 `servers/loader.ts`(convertEntry, normalizeServerName)와 `servers/values.ts`를 옮겨 쓴 것이다.
// 이 패키지는 L3라 cap-mcp를 import할 수 없다. 설계는 migration.md §3.2.2, §4.3.6, §10 수용 기준 7·8.

import {
  assertNever,
  attemptAsync,
  err,
  ok,
  parse,
  parseJson,
  type Result,
} from "@fresnel/contracts";
import { MCP_SERVER_ID_PATTERN, McpServerDefSchema } from "@fresnel/contracts/capabilities";
import { itemIdOf, sha256Hex } from "../hash.ts";
import { displayPath, isInside, joinPath, normalizePath } from "../paths.ts";
import { envRefsIn, looksLikeSecretName, looksLikeSecretValue } from "../secrets.ts";
import type {
  HarnessId,
  IrField,
  IrMcp,
  IrNode,
  ItemScope,
  McpDefDraft,
  ScanContext,
  ScanDiagnostic,
  ScanFs,
  ScanLimits,
  ScanRoot,
  SourceAdapter,
  SourceItem,
} from "../types.ts";

const HARNESS: HarnessId = "claude-code";
const RULES_VERSION = "2026-11-17";
const PROJECT_FILE = ".mcp.json";
const USER_FILE = ".claude.json";
const PROJECT_DIR = "CLAUDE_PROJECT_DIR";
/** Claude가 제공하는 프로젝트 경로 변수. 이 두 형태만 프로젝트 루트의 절대 경로로 바꾼다 */
const PROJECT_DIR_REF = /\$\{CLAUDE_PROJECT_DIR(?::-\.)?\}/g;
/** `${VAR}`, `${VAR:-기본}`. 기본값으로 치환할 때 쓴다(모양은 secrets.ts의 envRefsIn과 같다) */
const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const SECRET_REF = /^secret:\/\/[a-z][a-z0-9-]{1,63}$/;
const SECRET_NAME = /^[a-z][a-z0-9-]{1,63}$/;
const SERVER_ID = new RegExp(MCP_SERVER_ID_PATTERN);
const KNOWN_KEYS: ReadonlySet<string> = new Set([
  "type",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "headersHelper",
  "timeout",
  "oauth",
]);
const STDIO_KEYS: readonly string[] = ["command", "args", "env", "cwd"];
const REMOTE_KEYS: readonly string[] = ["url", "headers"];

const NOT_OBJECT = "항목이 객체가 아니라 옮기지 않는다";
const UNKNOWN_TRANSPORT = "알 수 없는 전송 형식이라 옮기지 않는다";
const WS_NOT_PORTED = "ws 전송은 McpServerDef에 없어 옮기지 않는다";
const NO_ID = "이름을 서버 id로 바꿀 수 없어 정의를 옮기지 않는다";
const NO_COMMAND = "stdio 항목에 command가 없어 정의를 옮기지 않는다";
const NO_URL = "원격 항목에 url이 없어 정의를 옮기지 않는다";
const BAD_SHAPE = "값의 형식이 맞지 않아 정의를 옮기지 않는다";
const SECRET_IN_ARGS =
  "command나 args에 시크릿처럼 보이는 값이 있어 정의를 옮기지 않는다(값은 싣지 않는다)";
const CHECK_FAILED = "정의 검사에 걸려 옮기지 않는다";
const HEADERS_HELPER = "headersHelper는 실행해야 하는 명령이라 옮기지 않는다";
const OAUTH_DETAIL = "oauth 세부 설정은 옮기지 않고 oauth 사용 여부만 옮긴다";
const OAUTH_NOT_PORTED = "이 전송에서 oauth는 옮기지 않는다";
const RELATIVE_NO_PROJECT = "상대 cwd는 프로젝트 기준을 알 수 없어 글자 그대로 남는다";
const RELATIVE_OUTSIDE = "cwd가 프로젝트 밖을 가리켜 글자 그대로 남는다";

type Transport = IrMcp["transport"];
type DraftTransport = McpDefDraft["transport"];
type SecretRef = IrMcp["secretRefs"][number];
type Shape<T> = Result<T, "invalid">;

export interface McpEntryContext {
  /** 프로젝트 범위의 루트 절대 경로. 사용자 범위면 undefined */
  readonly projectRoot: string | undefined;
}

export interface ConvertedMcpEntry {
  readonly item: IrMcp;
  /** 알려진 키 밖의 키, `timeout`, `headersHelper`, `oauth` 세부. 서버 항목과 따로 `field` 항목이 된다 */
  readonly fields: readonly IrField[];
  readonly warnings: readonly string[];
}

/** 한 항목을 변환하는 동안 쓰는 상태. 값은 여기에 담지 않고 판정 결과(자리와 이름)만 담는다 */
interface ConvertState {
  readonly projectRoot: string | undefined;
  /** 시크릿 참조 이름의 앞머리. 서버 id, id가 없으면 `mcp` */
  readonly prefix: string;
  readonly taken: Set<string>;
  readonly secretRefs: SecretRef[];
  readonly warnings: string[];
  projectBound: boolean;
}

/**
 * 서버 하나를 IR로 바꾼다. 순수 함수이고 명령을 실행하지 않는다.
 * 원본 값은 판정 직후 버린다. 결과(IR, 경고, 필드)에는 시크릿 값이 없다.
 */
export function convertMcpEntry(
  serverName: string,
  raw: unknown,
  ctx: McpEntryContext,
): ConvertedMcpEntry {
  const id = serverIdOf(serverName);
  const state: ConvertState = {
    projectRoot: ctx.projectRoot,
    prefix: id ?? "mcp",
    taken: new Set<string>(),
    secretRefs: [],
    warnings: [],
    projectBound: false,
  };
  const fields: IrField[] = [];
  if (!isRecord(raw)) {
    state.warnings.push(NOT_OBJECT);
    return finish(serverName, id, "unknown", undefined, state, fields);
  }

  const transport = transportOf(raw.type);
  if (transport === "unknown") state.warnings.push(UNKNOWN_TRANSPORT);
  if (transport === "ws") state.warnings.push(WS_NOT_PORTED);
  for (const key of ignoredKeysOf(transport)) {
    if (Object.hasOwn(raw, key)) {
      state.warnings.push(`${key}는 ${transport} 전송에서 쓰이지 않아 옮기지 않는다`);
    }
  }

  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (key === "timeout") {
      // 대상(연결, 호출)이 원본 문서에 없어 옮기지 않는다. 값만 보여 준다.
      fields.push(fieldOf(key, summaryOf(key, value)));
    } else if (key === "headersHelper") {
      fields.push(fieldOf(key, undefined));
      state.warnings.push(HEADERS_HELPER);
    } else if (key === "oauth") {
      oauthFields(transport, value, fields, state);
    } else if (!KNOWN_KEYS.has(key)) {
      fields.push(fieldOf(key, undefined));
    }
  }

  let draft: DraftTransport | undefined;
  if (transport === "stdio") {
    draft = stdioDraft(raw, state);
  } else if (transport === "http" || transport === "sse") {
    draft = remoteDraft(transport, raw, state);
  }
  if (id === undefined) state.warnings.push(NO_ID);
  const def = id === undefined || draft === undefined ? undefined : checkedDef(draft, state);
  return finish(serverName, id, transport, def, state, fields);
}

function finish(
  serverName: string,
  id: string | undefined,
  transport: Transport,
  def: McpDefDraft | undefined,
  state: ConvertState,
  fields: readonly IrField[],
): ConvertedMcpEntry {
  const item: IrMcp = {
    kind: "mcp",
    serverName,
    id,
    transport,
    def,
    secretRefs: state.secretRefs,
    projectBound: state.projectBound,
  };
  return { item, fields, warnings: state.warnings };
}

// ── 이름과 전송 ───────────────────────────────────────────────────────────

/** cap-mcp의 normalizeServerName과 같다: 소문자, [a-z0-9-] 밖은 `-`, 32자. 패턴에 안 맞으면 undefined */
function serverIdOf(serverName: string): string | undefined {
  const id = serverName
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 32);
  return SERVER_ID.test(id) ? id : undefined;
}

function transportOf(kind: unknown): Transport {
  if (kind === undefined) return "stdio";
  if (typeof kind !== "string") return "unknown";
  const lowered = kind.toLowerCase();
  if (lowered === "stdio") return "stdio";
  if (lowered === "http" || lowered === "streamable-http") return "http";
  if (lowered === "sse") return "sse";
  if (lowered === "ws") return "ws";
  return "unknown";
}

function ignoredKeysOf(transport: Transport): readonly string[] {
  if (transport === "stdio") return REMOTE_KEYS;
  if (transport === "http" || transport === "sse") return STDIO_KEYS;
  return [];
}

// ── 정의 ──────────────────────────────────────────────────────────────────

function stdioDraft(
  raw: Readonly<Record<string, unknown>>,
  state: ConvertState,
): DraftTransport | undefined {
  const command = raw.command;
  if (typeof command !== "string" || command === "") {
    state.warnings.push(NO_COMMAND);
    return undefined;
  }
  const args = optionalStringArray(raw.args);
  const cwd = optionalString(raw.cwd);
  const env = optionalStringTable(raw.env);
  if (!args.ok || !cwd.ok || !env.ok) {
    state.warnings.push(BAD_SHAPE);
    return undefined;
  }
  const commandText = plainField("command", command, state);
  const argsText = args.value?.map((arg, index) => plainField(`args[${index}]`, arg, state));
  if (
    looksLikeSecretValue(commandText) ||
    (argsText ?? []).some((arg) => looksLikeSecretValue(arg))
  ) {
    state.warnings.push(SECRET_IN_ARGS);
    return undefined;
  }
  const cwdText = cwd.value === undefined ? undefined : cwdField(cwd.value, state);
  const envOut = env.value === undefined ? undefined : classifyTable("env", env.value, state);
  return {
    type: "stdio",
    command: commandText,
    ...(argsText === undefined ? {} : { args: argsText }),
    ...(cwdText === undefined ? {} : { cwd: cwdText }),
    ...(envOut === undefined ? {} : { env: envOut }),
  };
}

function remoteDraft(
  kind: "http" | "sse",
  raw: Readonly<Record<string, unknown>>,
  state: ConvertState,
): DraftTransport | undefined {
  const url = optionalString(raw.url);
  const headers = optionalStringTable(raw.headers);
  if (!url.ok || !headers.ok) {
    state.warnings.push(BAD_SHAPE);
    return undefined;
  }
  if (url.value === undefined) {
    state.warnings.push(NO_URL);
    return undefined;
  }
  const urlText = plainField("url", url.value, state);
  const headersOut =
    headers.value === undefined ? undefined : classifyTable("headers", headers.value, state);
  const oauth = raw.oauth;
  const oauthOn = oauth === true || isRecord(oauth);
  return {
    type: kind,
    url: urlText,
    ...(headersOut === undefined ? {} : { headers: headersOut }),
    ...(oauthOn ? { oauth: true } : {}),
  };
}

/** 마지막 관문. McpServerDefSchema와 checkDefinitionValues(env·headers 값 규칙)를 같은 규칙으로 본다 */
function checkedDef(draft: DraftTransport, state: ConvertState): McpDefDraft | undefined {
  const parsed = parse(McpServerDefSchema, { transport: draft });
  if (!parsed.ok || !valuesAllowed(draft)) {
    state.warnings.push(CHECK_FAILED);
    return undefined;
  }
  return { transport: draft };
}

function valuesAllowed(draft: DraftTransport): boolean {
  const table = draft.type === "stdio" ? draft.env : draft.headers;
  if (table === undefined) return true;
  return Object.entries(table).every(([name, value]) =>
    value.startsWith("secret://") ? SECRET_REF.test(value) : !looksLikeSecretName(name),
  );
}

/** 알려진 키 밖과 `timeout`, `headersHelper`, `oauth` 세부를 필드로 낸다. oauth가 불리언이면 정의에 실린다 */
function oauthFields(
  transport: Transport,
  value: unknown,
  fields: IrField[],
  state: ConvertState,
): void {
  const remote = transport === "http" || transport === "sse";
  if (remote && isRecord(value)) {
    const subKeys = Object.keys(value);
    for (const sub of subKeys) {
      fields.push(fieldOf(`oauth.${sub}`, summaryOf(sub, value[sub])));
    }
    if (subKeys.length > 0) state.warnings.push(OAUTH_DETAIL);
    return;
  }
  if (remote && typeof value === "boolean") return;
  fields.push(fieldOf("oauth", undefined));
  state.warnings.push(OAUTH_NOT_PORTED);
}

function fieldOf(key: string, summary: string | undefined): IrField {
  return { kind: "field", container: "mcp", key, summary };
}

/** 값 요약. 명령일 수 있는 `headersHelper`는 호출하지 않고, 이름이나 값이 시크릿처럼 보이면 싣지 않는다 */
function summaryOf(name: string, value: unknown): string | undefined {
  if (looksLikeSecretName(name)) return undefined;
  let text: string | undefined;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    text = String(value);
  } else if (isStringArray(value)) {
    text = value.join(" ");
  }
  if (text === undefined || looksLikeSecretValue(text)) return undefined;
  return text;
}

// ── 변수와 경로 ───────────────────────────────────────────────────────────

/** `${CLAUDE_PROJECT_DIR}`를 프로젝트 루트로 바꾼다. 루트가 없으면 그대로 둔다 */
function bindProjectDir(text: string, state: ConvertState): string {
  const root = state.projectRoot;
  if (root === undefined || !text.includes("${CLAUDE_PROJECT_DIR")) return text;
  const bound = text.replace(PROJECT_DIR_REF, () => root);
  if (bound !== text) state.projectBound = true;
  return bound;
}

function unexpandedWarning(label: string, name: string): string {
  return `${label}의 ${name}: 변수 확장이 없어 글자 그대로 남는다`;
}

/** command, args, url처럼 시크릿 참조가 될 수 없는 자리. 프로젝트 경로만 바꾸고 나머지 변수는 글자 그대로 둔다 */
function plainField(label: string, value: string, state: ConvertState): string {
  const text = bindProjectDir(value, state);
  for (const ref of envRefsIn(text)) {
    state.warnings.push(unexpandedWarning(label, ref.name));
  }
  return text;
}

function cwdField(value: string, state: ConvertState): string {
  const text = bindProjectDir(value, state);
  if (isRelativePath(text)) {
    if (state.projectRoot === undefined) {
      state.warnings.push(RELATIVE_NO_PROJECT);
    } else {
      const resolved = normalizePath(joinPath(state.projectRoot, text));
      if (resolved === undefined) {
        state.warnings.push(RELATIVE_OUTSIDE);
      } else {
        state.projectBound = true;
        return resolved;
      }
    }
  }
  for (const ref of envRefsIn(text)) {
    state.warnings.push(unexpandedWarning("cwd", ref.name));
  }
  return text;
}

function isRelativePath(text: string): boolean {
  return text !== "" && !text.startsWith("/") && !text.startsWith("~") && !text.includes("$");
}

// ── 시크릿 판정 (migration.md §6.6, 수용 기준 7) ─────────────────────────

/** env 또는 headers 표 하나를 가린다. 키 이름은 그대로 두고 값만 판정한다 */
function classifyTable(
  label: "env" | "headers",
  table: Readonly<Record<string, string>>,
  state: ConvertState,
): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(table)) {
    entries.push([name, classifyEntryValue(`${label}.${name}`, name, value, state)]);
  }
  return Object.fromEntries(entries);
}

/**
 * 값 하나의 판정. 평문으로 둘 수 있으면 그 문자열을, 아니면 `secret://` 참조를 돌려준다.
 * 원본 값은 이 함수 안에서만 쓰이고 결과에 남지 않는다.
 */
function classifyEntryValue(
  place: string,
  name: string,
  value: string,
  state: ConvertState,
): string {
  const text = bindProjectDir(value, state);
  if (SECRET_REF.test(text)) return text;
  for (const ref of envRefsIn(text)) {
    if (ref.name === PROJECT_DIR) state.warnings.push(unexpandedWarning(place, ref.name));
  }

  const refs = envRefsIn(text).filter((ref) => ref.name !== PROJECT_DIR);
  if (refs.length > 0) {
    // 기본값이 있고, 기본값과 변수 이름과 키 이름이 모두 시크릿처럼 보이지 않을 때만 평문으로 푼다.
    // 변수 이름을 함께 보는 것은 `${DB_PASSWORD:-…}`를 `DSN` 키 아래 평문으로 두지 않기 위해서다.
    const plainAllowed =
      !looksLikeSecretName(name) &&
      refs.every(
        (ref) =>
          ref.fallback !== undefined &&
          !looksLikeSecretName(ref.name) &&
          !looksLikeSecretValue(ref.fallback),
      );
    if (plainAllowed) {
      const substituted = text.replace(
        ENV_REF,
        (whole: string, refName: string, fallback: string | undefined) =>
          refName === PROJECT_DIR ? whole : (fallback ?? ""),
      );
      if (!looksLikeSecretValue(substituted)) return substituted;
    }
    const chosen = refs.find((ref) => looksLikeSecretName(ref.name))?.name ?? refs[0]?.name ?? name;
    state.warnings.push(
      `${place}: 환경 변수 ${chosen} 참조를 시크릿 참조로 바꿨다(값은 옮기지 않는다)`,
    );
    return addSecretRef(place, chosen, "env_ref", state);
  }

  if (looksLikeSecretName(name) || looksLikeSecretValue(text)) {
    state.warnings.push(`${place}: 평문 시크릿처럼 보여 시크릿 참조로 바꿨다(값은 옮기지 않는다)`);
    return addSecretRef(place, name, "literal", state);
  }
  return text;
}

function addSecretRef(
  place: string,
  varName: string,
  origin: SecretRef["origin"],
  state: ConvertState,
): string {
  const secretName = secretNameOf(state.prefix, varName, state.taken);
  state.secretRefs.push({ place, varName, secretName, origin });
  return `secret://${secretName}`;
}

/**
 * `<prefix>-<변수 이름>`을 시크릿 이름 패턴에 맞춘다(소문자, `_`는 `-`, 나머지 문자는 뺀다, 64자).
 * 패턴에 못 맞으면 `<prefix>-secret`로 보정하고, 같은 서버 안에서 겹치면 `-2`, `-3`을 붙인다.
 */
function secretNameOf(prefix: string, varName: string, taken: Set<string>): string {
  const cleaned = varName
    .toLowerCase()
    .replaceAll("_", "-")
    .replace(/[^a-z0-9-]/g, "");
  const candidate = `${prefix}-${cleaned}`.slice(0, 64).replace(/-+$/, "");
  const base = cleaned !== "" && SECRET_NAME.test(candidate) ? candidate : `${prefix}-secret`;
  let unique = base;
  let suffix = 1;
  while (taken.has(unique)) {
    suffix += 1;
    const tail = `-${suffix}`;
    unique = `${base.slice(0, 64 - tail.length).replace(/-+$/, "")}${tail}`;
  }
  taken.add(unique);
  return unique;
}

// ── 값 형식 도우미 ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false;
  const list: readonly unknown[] = value;
  return list.every((item) => typeof item === "string");
}

function isStringTable(value: unknown): value is Readonly<Record<string, string>> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function optionalString(value: unknown): Shape<string | undefined> {
  if (value === undefined) return ok(undefined);
  return typeof value === "string" ? ok(value) : err("invalid");
}

function optionalStringArray(value: unknown): Shape<readonly string[] | undefined> {
  if (value === undefined) return ok(undefined);
  return isStringArray(value) ? ok(value) : err("invalid");
}

function optionalStringTable(value: unknown): Shape<Readonly<Record<string, string>> | undefined> {
  if (value === undefined) return ok(undefined);
  return isStringTable(value) ? ok(value) : err("invalid");
}

/** JSON 값의 정규화 문자열(키 정렬, 공백 없음). 설정 값만 받으므로 던지지 않는다(1e999 같은 값도 null이 된다) */
function canonicalText(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) {
    const list: readonly unknown[] = value;
    return `[${list.map((item) => canonicalText(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    const parts = Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalText(value[key])}`);
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 필드 하나의 원본 값. `oauth.clientId`처럼 한 단계 점 경로면 안쪽을 찾는다 */
function fieldSource(raw: unknown, key: string): unknown {
  if (!isRecord(raw)) return undefined;
  if (Object.hasOwn(raw, key)) return raw[key];
  const dot = key.indexOf(".");
  if (dot === -1) return undefined;
  return fieldSource(raw[key.slice(0, dot)], key.slice(dot + 1));
}

// ── 훑기 ──────────────────────────────────────────────────────────────────

interface AdapterScan {
  readonly items: readonly SourceItem[];
  readonly diagnostics: readonly ScanDiagnostic[];
  readonly scanned: readonly string[];
}

type FileOutcome =
  | { readonly kind: "absent" }
  | { readonly kind: "read"; readonly text: string }
  | { readonly kind: "failed"; readonly diagnostic: ScanDiagnostic };

function failed(code: ScanDiagnostic["code"], shown: string, message: string): FileOutcome {
  return { kind: "failed", diagnostic: { code, path: shown, message } };
}

/** 읽기 전용으로 파일 하나를 읽는다. 없으면 absent, 심볼릭 링크는 프로젝트 밖이면 읽지 않는다 */
async function readConfigFile(
  fs: ScanFs,
  path: string,
  rootPath: string,
  maxBytes: number,
  shown: string,
): Promise<FileOutcome> {
  const stat = await attemptAsync(() => fs.lstat(path));
  if (!stat.ok) return failed("unreadable", shown, "파일 정보를 얻지 못해 읽지 않았다");
  if (stat.value === null) return { kind: "absent" };

  let target = path;
  if (stat.value.kind === "symlink") {
    const real = await attemptAsync(() => fs.realpath(path));
    if (!real.ok) return failed("unreadable", shown, "심볼릭 링크를 풀지 못해 읽지 않았다");
    if (!isInside(rootPath, real.value)) {
      return failed("unreadable", shown, "범위 밖을 가리키는 심볼릭 링크라 읽지 않았다");
    }
    target = real.value;
  } else if (stat.value.kind !== "file") {
    return failed("unreadable", shown, "일반 파일이 아니라 읽지 않았다");
  }

  const read = await attemptAsync(() => fs.readBounded(target, maxBytes));
  if (!read.ok) return failed("unreadable", shown, "읽지 못해 건너뛰었다");
  const content = read.value;
  switch (content.kind) {
    case "text":
      return { kind: "read", text: content.text };
    case "binary":
      return failed("invalid_json", shown, "JSON 텍스트가 아니라 읽지 않았다");
    case "too_large":
      return failed("too_large", shown, `${maxBytes} 바이트를 넘어 읽지 않았다`);
    case "unreadable":
      return failed("unreadable", shown, "읽지 못해 건너뛰었다");
    default:
      return assertNever(content, "readConfigFile");
  }
}

/**
 * 설정 텍스트에서 `mcpServers`의 항목들만 꺼낸다. 나머지 키(사용자 범위의 `projects` 등)는
 * 이 함수가 돌려주는 값에 들지 않는다. 호출자는 파싱 결과 전체를 보관하지 않는다.
 */
function serverEntriesOf(text: string): Shape<readonly (readonly [string, unknown])[]> {
  const json = parseJson(text);
  if (!json.ok) return err("invalid");
  const root = json.value;
  if (!isRecord(root)) return ok([]);
  const servers = root.mcpServers;
  if (!isRecord(servers)) return ok([]);
  return ok(Object.entries(servers));
}

function sourceItemOf(
  place: { readonly scope: ItemScope; readonly shown: string; readonly rootLabel: string },
  kind: "mcp" | "field",
  keyPath: string,
  raw: unknown,
  ir: IrNode,
  secrets: SourceItem["secrets"],
  warnings: readonly string[],
): SourceItem {
  const canonical = canonicalText(raw);
  return {
    itemId: itemIdOf([HARNESS, kind, place.scope, place.shown, keyPath]),
    harness: HARNESS,
    kind,
    scope: place.scope,
    rootLabel: place.rootLabel,
    path: place.shown,
    keyPath,
    sha256: sha256Hex(canonical),
    bytes: new TextEncoder().encode(canonical).byteLength,
    ir,
    secrets,
    warnings,
  };
}

async function scanMcpJson(
  root: ScanRoot,
  fs: ScanFs,
  limits: ScanLimits,
  ctx: ScanContext,
): Promise<AdapterScan> {
  const isProject = root.scope === "project";
  const file = joinPath(root.path, isProject ? PROJECT_FILE : USER_FILE);
  const shown = displayPath(file, ctx.homeDir);
  // 사용자 범위(~/.claude.json)는 최상위 mcpServers만 쓴다. projects[*].mcpServers(로컬 범위)는
  // 이번 조각에서 훑지 않는다. 그 안에는 프로젝트별 서버가 있으나 범위 판정과 승인 규칙을 더 다룬 뒤에 넣는다.
  const outcome = await readConfigFile(
    fs,
    file,
    root.path,
    isProject ? limits.maxFileBytes : limits.maxClaudeJsonBytes,
    shown,
  );
  if (outcome.kind === "absent") return { items: [], diagnostics: [], scanned: [] };
  const scanned = [shown];
  if (outcome.kind === "failed") {
    return { items: [], diagnostics: [outcome.diagnostic], scanned };
  }

  const entries = serverEntriesOf(outcome.text);
  if (!entries.ok) {
    const diagnostic: ScanDiagnostic = {
      code: "invalid_json",
      path: shown,
      message: "JSON이 아니라 읽지 않았다",
    };
    return { items: [], diagnostics: [diagnostic], scanned };
  }

  const place = { scope: root.scope, shown, rootLabel: root.label };
  const projectRoot = isProject ? root.path : undefined;
  const items: SourceItem[] = [];
  for (const [name, raw] of entries.value) {
    const keyPath = `mcpServers.${name}`;
    const converted = convertMcpEntry(name, raw, { projectRoot });
    const secrets: SourceItem["secrets"] = converted.item.secretRefs.map((ref) => ({
      keyPath: `${keyPath}.${ref.place}`,
      kind: ref.origin,
      name: ref.varName,
    }));
    items.push(
      sourceItemOf(place, "mcp", keyPath, raw, converted.item, secrets, converted.warnings),
    );
    for (const field of converted.fields) {
      items.push(
        sourceItemOf(
          place,
          "field",
          `${keyPath}.${field.key}`,
          fieldSource(raw, field.key),
          field,
          [],
          [],
        ),
      );
    }
  }
  return { items, diagnostics: [], scanned };
}

export const mcpJsonAdapter: SourceAdapter = {
  harness: HARNESS,
  rulesVersion: RULES_VERSION,
  scan: scanMcpJson,
};
