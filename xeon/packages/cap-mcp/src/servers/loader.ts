import { parse, parseJson, type Result, err, ok } from "@fresnel/contracts";
import {
  McpServerDefSchema,
  MCP_SERVER_ID_PATTERN,
  type McpServerDef,
} from "@fresnel/contracts/capabilities";
import type { JsonValue } from "@fresnel/contracts/conversation";
import { Type } from "typebox";
import { asJsonObject } from "../json.ts";
import { checkDefinitionValues } from "./values.ts";
import type { LoaderDiagnostic, ServerDefinition } from "../types.ts";

// L2.mcp.spec §4.2. 설정 `l2.mcp.servers`와 프로젝트 `.mcp.json`(루트)·`.fresnel/mcp.json`을 합친다.
// 파일은 프로젝트 신뢰가 확인된 뒤에만 읽는다(결정 D6). 이 파일은 읽기를 하지 않고 이미 읽은 텍스트를 받는다.

const ID_REGEX = new RegExp(MCP_SERVER_ID_PATTERN);

/** `.mcp.json` 이름 변환: 소문자로 바꾸고 [a-z0-9-] 밖 문자를 `-`로 바꾸고 32자로 자른다 */
export function normalizeServerName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 32);
}

const McpJsonEntrySchema = Type.Object({
  type: Type.Optional(Type.String()),
  command: Type.Optional(Type.String()),
  args: Type.Optional(Type.Array(Type.String())),
  cwd: Type.Optional(Type.String()),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
  url: Type.Optional(Type.String()),
  headers: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export type McpJsonOrigin = "root" | "fresnel";

export interface McpJsonResult {
  readonly servers: readonly ServerDefinition[];
  readonly diagnostics: readonly LoaderDiagnostic[];
}

type Conversion =
  | { readonly ok: true; readonly def: McpServerDef }
  | { readonly ok: false; readonly code: LoaderDiagnostic["code"]; readonly message: string };

function convertEntry(raw: unknown): Conversion {
  const parsed = parse(McpJsonEntrySchema, raw);
  if (!parsed.ok) {
    return { ok: false, code: "invalid_definition", message: "entry has an unexpected shape" };
  }
  const entry = parsed.value;
  const kind = entry.type?.toLowerCase();
  let transport: McpServerDef["transport"];
  if (kind === undefined || kind === "stdio") {
    if (entry.command === undefined || entry.command.length === 0) {
      return { ok: false, code: "invalid_definition", message: "stdio entry needs a command" };
    }
    transport = {
      type: "stdio",
      command: entry.command,
      ...(entry.args === undefined ? {} : { args: entry.args }),
      ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
      ...(entry.env === undefined ? {} : { env: entry.env }),
    };
  } else if (kind === "http" || kind === "streamable-http" || kind === "sse") {
    if (entry.url === undefined) {
      return { ok: false, code: "invalid_definition", message: `${kind} entry needs a url` };
    }
    transport =
      kind === "sse"
        ? {
            type: "sse",
            url: entry.url,
            ...(entry.headers === undefined ? {} : { headers: entry.headers }),
          }
        : {
            type: "http",
            url: entry.url,
            ...(entry.headers === undefined ? {} : { headers: entry.headers }),
          };
  } else {
    return { ok: false, code: "invalid_definition", message: `unknown transport type ${kind}` };
  }
  const def = parse(McpServerDefSchema, { transport });
  if (!def.ok) {
    return { ok: false, code: "invalid_definition", message: "entry failed definition checks" };
  }
  const issue = checkDefinitionValues(def.value);
  if (issue !== undefined) return { ok: false, code: issue.code, message: issue.message };
  return { ok: true, def: def.value };
}

const McpJsonFileSchema = Type.Object({ mcpServers: Type.Record(Type.String(), Type.Unknown()) });

export type McpJsonParseError = { readonly kind: "invalid_json" } | { readonly kind: "no_servers" };

/**
 * `.mcp.json` 텍스트를 서버 정의로 바꾼다. 이름 형식이 어긋나거나 먼저 있는 id와 겹치거나 평문 시크릿이 든 항목은
 * 그 서버만 건너뛰고 진단을 남긴다. `taken`은 이미 정해진 id다(설정 정의가 이긴다).
 */
export function parseMcpJson(
  text: string,
  origin: McpJsonOrigin,
  taken: ReadonlySet<string>,
): Result<McpJsonResult, McpJsonParseError> {
  const source = origin === "root" ? "mcpjson:project" : "mcpjson:fresnel";
  const json = parseJson(text);
  if (!json.ok) return err({ kind: "invalid_json" });
  const file = parse(McpJsonFileSchema, json.value);
  if (!file.ok) return err({ kind: "no_servers" });
  const servers: ServerDefinition[] = [];
  const diagnostics: LoaderDiagnostic[] = [];
  const seen = new Set(taken);
  for (const [rawName, rawEntry] of Object.entries(file.value.mcpServers)) {
    const id = normalizeServerName(rawName);
    if (!ID_REGEX.test(id)) {
      diagnostics.push({
        code: "invalid_name",
        source,
        server: rawName,
        message: "name cannot become a server id",
      });
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push({
        code: "duplicate_name",
        source,
        server: id,
        message: "id is already defined",
      });
      continue;
    }
    if (asJsonObject(rawEntry) === undefined) {
      diagnostics.push({
        code: "invalid_definition",
        source,
        server: id,
        message: "entry is not an object",
      });
      continue;
    }
    const converted = convertEntry(rawEntry);
    if (!converted.ok) {
      diagnostics.push({ code: converted.code, source, server: id, message: converted.message });
      continue;
    }
    seen.add(id);
    servers.push({ id, def: converted.def, source, managed: false, requiresTrust: true });
  }
  return ok({ servers, diagnostics });
}

/**
 * 대화의 켜짐 플러그인이 낸 MCP 서버 항목 하나(`MaterialPort.mcpServers`, M5c §4.5.10). `plugin`은 소유 플러그인 이름이고
 * `config`는 검토본 `mcp.json`의 항목 모양(`.mcp.json` 항목과 같다)이다. 정의로 바꾸는 검사는 `.mcp.json`과 같다.
 */
export interface ContributedServer {
  readonly plugin: string;
  readonly name: string;
  readonly config: JsonValue;
}

/** 플러그인이 낸 서버의 출처 표기. 확장 등록 서버와 같은 `ext:` 접두를 쓴다(`ext-read-port`가 확장 묶음으로 보인다) */
export function contributedSourceOf(plugin: string): string {
  return `ext:${plugin}`;
}

/**
 * 플러그인이 낸 서버 항목을 서버 정의로 바꾼다. 서버 id는 [제안] `<플러그인>-<서버 이름>`(소문자, `[a-z0-9-]` 밖은 `-`)이다.
 * 설정과 `.mcp.json`이 먼저 `taken`에 든다. 같은 id가 이미 있으면 그 항목만 건너뛰고 `duplicate_name` 진단을 남긴다(설정이 이긴다).
 * 형식이 맞지 않거나 정의 검사(시크릿 평문 등)를 못 넘으면 그 서버만 건너뛴다.
 * 신뢰는 요구하지 않는다(`requiresTrust: false`): 검토본은 내용 해시로 고정되어 있고 검토 승인이 신뢰 자리를 맡는다(M5c §4.6.9).
 * 정책(거부 목록, 허용 목록, 승인 모드, 샌드박스)은 설정 서버와 같이 이 패키지의 정책 함수가 판정한다.
 */
export function parseContributedServers(
  items: readonly ContributedServer[],
  taken: ReadonlySet<string>,
): {
  readonly servers: readonly ServerDefinition[];
  readonly diagnostics: readonly LoaderDiagnostic[];
} {
  const servers: ServerDefinition[] = [];
  const diagnostics: LoaderDiagnostic[] = [];
  const seen = new Set(taken);
  for (const item of items) {
    const source = contributedSourceOf(item.plugin);
    const id = `${item.plugin}-${item.name}`.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!ID_REGEX.test(id)) {
      diagnostics.push({
        code: "invalid_name",
        source,
        server: item.name,
        message: "plugin server name cannot become a server id",
      });
      continue;
    }
    if (seen.has(id)) {
      diagnostics.push({
        code: "duplicate_name",
        source,
        server: id,
        message: "id is already defined",
      });
      continue;
    }
    const converted = convertEntry(item.config);
    if (!converted.ok) {
      diagnostics.push({ code: converted.code, source, server: id, message: converted.message });
      continue;
    }
    seen.add(id);
    servers.push({ id, def: converted.def, source, managed: false, requiresTrust: false });
  }
  return { servers, diagnostics };
}
