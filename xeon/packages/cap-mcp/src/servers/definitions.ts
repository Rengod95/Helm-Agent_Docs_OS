import { eachAsync, type Logger } from "@xeon/contracts";
import type { ScopeStack } from "@xeon/contracts/settings";
import type { McpFileReader } from "../ports/files.ts";
import type { McpProjectTrust } from "../ports/trust.ts";
import { readMcpSettings, readSettingsServers, type McpSettings } from "../settings.ts";
import type { LoaderDiagnostic, ServerDefinition } from "../types.ts";
import { parseMcpJson, type McpJsonOrigin } from "./loader.ts";

// L2.mcp.spec §4.2. 설정과 `.mcp.json`을 합쳐 서버 정의 목록을 만든다(확장 등록 서버는 service가 더한다).
// `.mcp.json`(루트)과 `.xeon/mcp.json`은 프로젝트가 신뢰된 뒤에만 읽는다(결정 D6).

export interface DefinitionsDeps {
  readonly layers: ScopeStack;
  readonly projectRoot: string | undefined;
  readonly files: McpFileReader;
  readonly trust: McpProjectTrust;
  readonly logger: Logger;
}

export interface LoadedDefinitions {
  readonly settings: McpSettings;
  /** 설정과 `.mcp.json`에서 온 정의. 같은 id는 설정이 이긴다 */
  readonly servers: readonly ServerDefinition[];
  readonly diagnostics: readonly LoaderDiagnostic[];
  /** 프로젝트 신뢰 여부. 프로젝트가 없으면 거짓이다 */
  readonly trusted: boolean;
}

const MCP_JSON_FILES: readonly { readonly relative: string; readonly origin: McpJsonOrigin }[] = [
  { relative: ".xeon/mcp.json", origin: "xeon" },
  { relative: ".mcp.json", origin: "root" },
];

function join(root: string, relative: string): string {
  return root.endsWith("/") ? `${root}${relative}` : `${root}/${relative}`;
}

export async function loadDefinitions(
  deps: DefinitionsDeps,
  signal: AbortSignal,
): Promise<LoadedDefinitions> {
  const settings = readMcpSettings(deps.layers);
  const fromSettings = readSettingsServers(deps.layers);
  const diagnostics: LoaderDiagnostic[] = [...fromSettings.diagnostics];
  const servers: ServerDefinition[] = [...fromSettings.servers];
  const root = deps.projectRoot;
  const wantsFiles = settings.importMcpJson && root !== undefined;
  const needsTrust = servers.some((server) => server.requiresTrust) || wantsFiles;
  const trusted =
    root !== undefined && needsTrust ? await deps.trust.isTrusted(root, signal) : false;

  if (wantsFiles) {
    const taken = new Set(servers.map((server) => server.id));
    await eachAsync(MCP_JSON_FILES, async (file) => {
      const path = join(root, file.relative);
      const source = file.origin === "root" ? "mcpjson:project" : "mcpjson:xeon";
      if (!trusted) {
        if (await deps.files.exists(path)) {
          diagnostics.push({
            code: "untrusted_project",
            source,
            message: `${file.relative} is not read until the project is trusted`,
          });
        }
        return undefined;
      }
      const text = await deps.files.readText(path);
      if (text === null) return undefined;
      const parsed = parseMcpJson(text, file.origin, taken);
      if (!parsed.ok) {
        diagnostics.push({
          code: "invalid_mcp_json",
          source,
          message: `${file.relative} is not a valid MCP definition file`,
        });
        return undefined;
      }
      diagnostics.push(...parsed.value.diagnostics);
      for (const server of parsed.value.servers) {
        taken.add(server.id);
        servers.push(server);
      }
      return undefined;
    });
  }
  for (const diagnostic of diagnostics) {
    deps.logger.debug("mcp.definition_diagnostic", {
      code: diagnostic.code,
      source: diagnostic.source,
      server: diagnostic.server ?? null,
    });
  }
  return { settings, servers, diagnostics, trusted };
}
