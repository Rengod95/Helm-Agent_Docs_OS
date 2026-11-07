import { join, parse } from "node:path";
import { attemptAsync, parseJson } from "@fresnel/contracts";
import type { LoaderFs } from "@fresnel/contracts/extensions";
import { TRUST_DETAILS_LIMITS, type TrustDetails } from "@fresnel/contracts/wire";

// X.loading-trust.spec §4.7.4. 신뢰 카드의 자원 이름 미리 보기. 결정이 필요한 판정에만 쓴다. 조립 루트가 쓰므로 ext-host 공개 이름이 아니다.
// 프로젝트 설정 디렉터리와 MCP 파일 이름은 ext-host의 `resources.ts`(`TRUST_REQUIRING_PROJECT_RESOURCES`)와 같은 값이다.
// 이름만 읽는다. 디렉터리는 항목 이름만 보고, 두 MCP 정의 파일만 내용을 JSON으로 읽어 서버 이름과 `command`·`args`만 뽑는다.
// `env`·`url`·`headers` 값은 읽은 뒤 버린다. 실행, import, 등록은 하지 않는다. 손상이거나 읽지 못한 파일은 목록을 비우고
// `issues`로 알린다(던지지 않는다). 조립 루트(`apps/host`)가 `issues`를 진단 로그로 남긴다.

/** MCP 서버 하나(wire `TrustDetails`의 원소와 같다) */
type McpServer = TrustDetails["mcpServers"][number];

/** 미리 보기가 읽지 못했거나 정의 파일이 손상된 자리. `path`는 프로젝트 루트 기준 상대 경로다 */
interface TrustPreviewIssue {
  readonly path: string;
  readonly reason: "unreadable" | "malformed";
}

interface TrustPreview {
  readonly details: TrustDetails;
  readonly issues: readonly TrustPreviewIssue[];
}

/** 프로젝트 설정 디렉터리 이름(`.fresnel`)과 Claude Code 형식 MCP 정의 파일 이름. `resources.ts`와 같다 */
const FRESNEL_DIR = ".fresnel";
const PROJECT_MCP_JSON = ".mcp.json";
const MCP_FILES: readonly string[] = [PROJECT_MCP_JSON, `${FRESNEL_DIR}/mcp.json`];

const BOM = "\uFEFF";

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `args`는 없거나 문자열 목록이어야 한다. 아니면 서버를 목록에 싣지 않는다(실행 인자를 빠뜨린 채 보이지 않게 한다) */
function argsOf(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > TRUST_DETAILS_LIMITS.args) return null;
  const args: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length > TRUST_DETAILS_LIMITS.arg) return null;
    args.push(item);
  }
  return args;
}

/** 서버 정의 하나. `command`가 빈 값이 아닌 문자열이 아니면(원격 `url` 서버 등) 목록에 싣지 않는다 */
function serverOf(name: string, entry: unknown): McpServer | null {
  if (!isRecord(entry)) return null;
  const command = entry.command;
  if (typeof command !== "string" || command.length === 0) return null;
  if (command.length > TRUST_DETAILS_LIMITS.command) return null;
  if (name.length === 0 || name.length > TRUST_DETAILS_LIMITS.serverName) return null;
  const args = argsOf(entry.args);
  if (args === null) return null;
  return { name, command, args };
}

/** `{ "mcpServers": { <이름>: { command, args, ... } } }`에서 서버 목록을 뽑는다. 다른 모양이면 빈 목록이다 */
function serversOf(root: unknown): McpServer[] {
  const table = isRecord(root) ? root.mcpServers : undefined;
  if (!isRecord(table)) return [];
  const servers: McpServer[] = [];
  for (const [name, entry] of Object.entries(table)) {
    const server = serverOf(name, entry);
    if (server !== null) servers.push(server);
  }
  return servers;
}

/** 정의 파일 하나를 읽는다. 없는 파일은 서버가 없고 문제도 없다. 읽지 못했거나 JSON이 아니면 문제 하나를 남긴다 */
async function serversIn(
  fs: LoaderFs,
  projectRoot: string,
  relative: string,
): Promise<{ readonly servers: readonly McpServer[]; readonly issue: TrustPreviewIssue | null }> {
  const read = await attemptAsync(() => fs.readText(join(projectRoot, relative)));
  if (!read.ok) return { servers: [], issue: { path: relative, reason: "unreadable" } };
  const text = read.value;
  if (text === null) return { servers: [], issue: null };
  const json = parseJson(text.startsWith(BOM) ? text.slice(1) : text);
  if (!json.ok) return { servers: [], issue: { path: relative, reason: "malformed" } };
  return { servers: serversOf(json.value), issue: null };
}

/** 디렉터리 항목 이름. 없는 디렉터리는 빈 목록이고, 읽지 못하면 문제 하나를 남긴다 */
async function namesIn(
  fs: LoaderFs,
  projectRoot: string,
  relative: string,
  nameOf: (entryName: string) => string,
): Promise<{ readonly names: readonly string[]; readonly issue: TrustPreviewIssue | null }> {
  const listed = await attemptAsync(() => fs.listDir(join(projectRoot, relative)));
  if (!listed.ok) return { names: [], issue: { path: relative, reason: "unreadable" } };
  const entries = listed.value;
  if (entries === null) return { names: [], issue: null };
  const names = entries
    .map((entry) => nameOf(entry.name))
    .filter((name) => name.length > 0 && name.length <= TRUST_DETAILS_LIMITS.name)
    .toSorted()
    .slice(0, TRUST_DETAILS_LIMITS.names);
  return { names, issue: null };
}

/**
 * 결정이 필요한 프로젝트의 자원 이름을 미리 본다. 목록은 상한까지만 싣는다(`TRUST_DETAILS_LIMITS`).
 * 스킬은 `.md` 확장자를 뺀 이름이고, 명령은 확장자를 뺀 파일 이름이다. 나머지는 항목 이름 그대로다.
 */
export async function previewTrustResources(
  fs: LoaderFs,
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
  const mcpServers = mcp.flatMap((file) => [...file.servers]);
  const issues = [
    ...mcp.flatMap((file) => (file.issue === null ? [] : [file.issue])),
    ...[hooks, skills, commands, extensions].flatMap((list) =>
      list.issue === null ? [] : [list.issue],
    ),
  ];
  return {
    details: {
      mcpServers: mcpServers.slice(0, TRUST_DETAILS_LIMITS.servers),
      hooks: [...hooks.names],
      skills: [...skills.names],
      commands: [...commands.names],
      extensions: [...extensions.names],
    },
    issues,
  };
}
