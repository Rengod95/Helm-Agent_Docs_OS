import { parse, parseJson, type Result, err, ok } from "@xeon/contracts";
import {
  McpServerDefSchema,
  MCP_SERVER_ID_PATTERN,
  type McpServerDef,
} from "@xeon/contracts/capabilities";
import { Type } from "typebox";
import { asJsonObject } from "../json.ts";
import { checkDefinitionValues } from "./values.ts";
import type { LoaderDiagnostic, ServerDefinition } from "../types.ts";

// L2.mcp.spec §4.2. 설정 `l2.mcp.servers`와 프로젝트 `.mcp.json`(루트)·`.xeon/mcp.json`을 합친다.
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

export type McpJsonOrigin = "root" | "xeon";

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
 * `.mcp.json` 텍스트를 서버 정의로 바꾼다. 이름 형식이 어긋나거나 먼저 있는 id와 겹치거나 평문 비밀이 든 항목은
 * 그 서버만 건너뛰고 진단을 남긴다. `taken`은 이미 정해진 id다(설정 정의가 이긴다).
 */
export function parseMcpJson(
  text: string,
  origin: McpJsonOrigin,
  taken: ReadonlySet<string>,
): Result<McpJsonResult, McpJsonParseError> {
  const source = origin === "root" ? "mcpjson:project" : "mcpjson:xeon";
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
