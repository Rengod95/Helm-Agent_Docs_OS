import { err, ok, parseJson, type Result } from "@fresnel/contracts";
import { EMPTY_DRAFT, type McpDraft, type PairRow } from "./settings-mcp-model.ts";

// MCP 서버 추가의 "붙여 넣기"(DP-111 [결정: 2026-11-11 사용자]). 사용자가 문서에서 복사한 한 덩어리를 폼 초안으로 바꾼다.
// 받는 모양:
//   1. JSON 조각: `{"mcpServers": {...}}`(Claude·Cursor), `{"servers": {...}}`(VS Code), `{"<이름>": {command|url…}}`,
//      서버 정의 하나 `{"command": …}`·`{"url": …}`. 서버가 여럿이면 모두 돌려주고 화면이 고르게 한다.
//   2. 명령 한 줄: `npx -y @modelcontextprotocol/server-github`, `uvx mcp-server-fetch`, `FOO=1 node server.js`,
//      `claude mcp add [--transport http] [-e K=V]… <이름> -- <명령…>`, `claude mcp add --transport http <이름> <주소>`.
//   3. 주소 하나: `https://mcp.example.com/mcp` → http.
// 이름은 주어진 것이 없으면 패키지·주소에서 짓는다(`@x/server-github` → `github`). 이름 규칙(`^[a-z][a-z0-9-]{0,31}$`)에 맞춘다.

export type PasteIssue = "empty" | "json" | "noServer" | "unknown";

/** 붙여 넣은 글에서 읽은 서버들. 하나 이상이다 */
export type PasteResult = Result<readonly McpDraft[], PasteIssue>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringsOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function pairsOf(value: unknown): readonly PairRow[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([name, item], uid) =>
    typeof item === "string" ? [{ uid, name, value: item }] : [],
  );
}

/** 이름을 서버 id 규칙에 맞춘다: 소문자, 글자·숫자·`-`, 글자로 시작, 32자. 남는 것이 없으면 빈 글 */
export function serverIdOf(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return slug;
}

/** 패키지 이름이나 경로에서 짧은 이름: `@scope/server-github@1.2` → `github`, `mcp-server-fetch` → `fetch` */
function nameOfPackage(text: string): string {
  const last = text.split("/").at(-1) ?? text;
  const bare = last.replace(/@[^@]*$/, "").replace(/\.(js|ts|py|mjs)$/, "");
  const trimmed = bare
    .replace(/^(mcp-server-|server-|mcp-)/, "")
    .replace(/(-mcp-server|-server|-mcp)$/, "");
  return serverIdOf(trimmed === "" ? bare : trimmed);
}

function nameOfUrl(url: string): string {
  const host = /^https?:\/\/([^/:?#]+)/.exec(url)?.[1] ?? "";
  const parts = host
    .split(".")
    .filter((part) => part !== "www" && part !== "mcp" && part !== "api");
  return serverIdOf(parts.length >= 2 ? (parts.at(-2) ?? "") : (parts[0] ?? ""));
}

/** 실행기(npx, uvx, node, docker…) 뒤에서 이름을 지을 인자. docker는 마지막 낱말(이미지), 나머지는 첫 낱말이다 */
const RUNNERS: ReadonlySet<string> = new Set([
  "npx",
  "bun",
  "bunx",
  "pnpx",
  "uvx",
  "pipx",
  "deno",
  "docker",
  "node",
  "python",
  "python3",
  "uv",
]);

function packageArgOf(command: string, args: readonly string[]): string {
  const base = command.split("/").at(-1) ?? command;
  if (!RUNNERS.has(base)) return base;
  const words = args.filter((arg) => !arg.startsWith("-") && arg !== "run" && arg !== "dlx");
  const pick = base === "docker" ? words.at(-1) : words[0];
  return pick ?? base;
}

function draftOfDefinitionJson(
  name: string,
  value: Readonly<Record<string, unknown>>,
): McpDraft | null {
  const title = typeof value["title"] === "string" ? value["title"] : "";
  const url =
    typeof value["url"] === "string"
      ? value["url"]
      : typeof value["serverUrl"] === "string"
        ? value["serverUrl"]
        : "";
  const type = value["type"] ?? value["transport"];
  if (url !== "") {
    return {
      ...EMPTY_DRAFT,
      id: serverIdOf(name) || nameOfUrl(url),
      title,
      transport: type === "sse" ? "sse" : "http",
      url,
      headers: pairsOf(value["headers"]),
    };
  }
  const command = typeof value["command"] === "string" ? value["command"] : "";
  if (command === "") return null;
  const args = stringsOf(value["args"]);
  return {
    ...EMPTY_DRAFT,
    id: serverIdOf(name) || nameOfPackage(packageArgOf(command, args)),
    title,
    transport: "stdio",
    command,
    args: args.join("\n"),
    env: pairsOf(value["env"]),
  };
}

function draftsOfJson(value: unknown): readonly McpDraft[] {
  if (!isRecord(value)) return [];
  const table = isRecord(value["mcpServers"])
    ? value["mcpServers"]
    : isRecord(value["servers"])
      ? value["servers"]
      : isRecord(value["mcp"]) && isRecord(value["mcp"]["servers"])
        ? value["mcp"]["servers"]
        : null;
  if (table !== null) {
    return Object.entries(table).flatMap(([name, def]) => {
      const draft = isRecord(def) ? draftOfDefinitionJson(name, def) : null;
      return draft === null ? [] : [draft];
    });
  }
  // 정의 하나(`{"command": …}`)이거나 이름 → 정의 맵
  const single = draftOfDefinitionJson("", value);
  if (single !== null) return [single];
  return Object.entries(value).flatMap(([name, def]) => {
    const draft = isRecord(def) ? draftOfDefinitionJson(name, def) : null;
    return draft === null ? [] : [draft];
  });
}

/** 셸처럼 낱말로 나눈다: 공백으로 나누고, 작은따옴표·큰따옴표 안은 한 낱말, `\`는 다음 글자를 그대로 */
export function shellWordsOf(text: string): readonly string[] {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text.charAt(index);
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < text.length) {
        index += 1;
        word += text.charAt(index);
      } else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === "\\" && index + 1 < text.length) {
      index += 1;
      const next = text.charAt(index);
      if (next !== "\n") {
        word += next;
        started = true;
      }
    } else if (/\s/.test(char)) {
      if (started) words.push(word);
      word = "";
      started = false;
    } else {
      word += char;
      started = true;
    }
  }
  if (started) words.push(word);
  return words;
}

const ENV_WORD = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s;

function pairRows(entries: readonly (readonly [string, string])[]): readonly PairRow[] {
  return entries.map(([name, value], uid) => ({ uid, name, value }));
}

/** `claude mcp add …` 한 줄 */
function draftOfClaudeAdd(words: readonly string[]): McpDraft | null {
  let transport: McpDraft["transport"] = "stdio";
  const env: [string, string][] = [];
  const headers: [string, string][] = [];
  let index = 3;
  const positional: string[] = [];
  while (index < words.length) {
    const word = words[index] ?? "";
    if (word === "--") {
      positional.push(...words.slice(index + 1));
      break;
    }
    if (word === "--transport" || word === "-t") {
      const next = words[index + 1];
      transport = next === "http" || next === "sse" ? next : "stdio";
      index += 2;
      continue;
    }
    if (word === "-e" || word === "--env") {
      const match = ENV_WORD.exec(words[index + 1] ?? "");
      if (match !== null) env.push([match[1] ?? "", match[2] ?? ""]);
      index += 2;
      continue;
    }
    if (word === "-H" || word === "--header") {
      const header = /^([^:]+):\s*(.*)$/.exec(words[index + 1] ?? "");
      if (header !== null) headers.push([(header[1] ?? "").trim(), header[2] ?? ""]);
      index += 2;
      continue;
    }
    if (word === "-s" || word === "--scope") {
      index += 2;
      continue;
    }
    positional.push(word);
    index += 1;
  }
  const [name, first, ...rest] = positional;
  if (name === undefined || first === undefined) return null;
  if (transport !== "stdio" || /^https?:\/\//.test(first)) {
    return {
      ...EMPTY_DRAFT,
      id: serverIdOf(name),
      transport: transport === "stdio" ? "http" : transport,
      url: first,
      headers: pairRows(headers),
    };
  }
  return {
    ...EMPTY_DRAFT,
    id: serverIdOf(name),
    command: first,
    args: rest.join("\n"),
    env: pairRows(env),
  };
}

function draftOfCommandLine(text: string): McpDraft | null {
  const words = shellWordsOf(text.replace(/^\s*\$\s*/, ""));
  if (words.length === 0) return null;
  if (words[0] === "claude" && words[1] === "mcp" && words[2] === "add")
    return draftOfClaudeAdd(words);
  const env: [string, string][] = [];
  let index = 0;
  for (; index < words.length; index += 1) {
    const match = ENV_WORD.exec(words[index] ?? "");
    if (match === null) break;
    env.push([match[1] ?? "", match[2] ?? ""]);
  }
  const command = words[index];
  if (command === undefined) return null;
  if (/^https?:\/\//.test(command) && words.length === index + 1) {
    return { ...EMPTY_DRAFT, id: nameOfUrl(command), transport: "http", url: command };
  }
  const args = words.slice(index + 1);
  return {
    ...EMPTY_DRAFT,
    id: nameOfPackage(packageArgOf(command, args)),
    command,
    args: args.join("\n"),
    env: pairRows(env),
  };
}

/** 붙여 넣은 글을 서버 초안으로. JSON처럼 보이면 JSON으로만 읽는다(틀리면 `json`) */
export function draftsOfPaste(text: string): PasteResult {
  const trimmed = text.trim();
  if (trimmed === "") return err("empty");
  if (trimmed.startsWith("{")) {
    const parsed = parseJson(trimmed);
    if (!parsed.ok) {
      // `"name": {…}` 조각만 복사한 경우: 바깥 괄호를 씌워 한 번 더 본다
      const wrapped = parseJson(`{${trimmed.replace(/,\s*$/, "")}}`);
      if (!wrapped.ok) return err("json");
      const drafts = draftsOfJson(wrapped.value);
      return drafts.length === 0 ? err("noServer") : ok(drafts);
    }
    const drafts = draftsOfJson(parsed.value);
    return drafts.length === 0 ? err("noServer") : ok(drafts);
  }
  if (trimmed.startsWith('"')) {
    const wrapped = parseJson(`{${trimmed.replace(/,\s*$/, "")}}`);
    if (!wrapped.ok) return err("json");
    const drafts = draftsOfJson(wrapped.value);
    return drafts.length === 0 ? err("noServer") : ok(drafts);
  }
  const line = trimmed.replace(/\\\n/g, " ").split("\n")[0] ?? "";
  const draft = draftOfCommandLine(line);
  return draft === null ? err("unknown") : ok([draft]);
}

/** 이미 쓰는 이름이면 `-2`, `-3`…을 붙인다 */
export function freeIdOf(id: string, taken: readonly string[]): string {
  if (id === "" || !taken.includes(id)) return id;
  for (let n = 2; ; n += 1) {
    const suffix = `-${String(n)}`;
    const next = `${id.slice(0, 32 - suffix.length)}${suffix}`;
    if (!taken.includes(next)) return next;
  }
}
