import { ok } from "@fresnel/contracts";
import {
  SCRIPT_ENV_SANDBOXED_USES,
  SCRIPT_ENV_USES,
  SCRIPT_USES,
  type InjectInventory,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import type { Profile, ReviewFileSide, ReviewItem } from "@fresnel/contracts/wire";
import type { ReviewData } from "../review-source.ts";

// 개발 빌드 전용 표본(스크린샷과 판 비교용). 실제 엔진이 돌려주는 `ReviewItem`과 같은 모양이다. 이름, 해시, 날짜, 명령은 꾸민 값이다.
// 이 파일은 `review-dev.tsx`만 부르고 그 파일은 개발 빌드(`BUILD_CHECKS`)에서만 읽힌다.

// 상대 시각(n분 전)이 그럴듯하게 보이도록 읽은 때를 기준으로 한다
const NOW = Date.now();
const ago = (minutes: number): string => new Date(NOW - minutes * 60_000).toISOString();
/** 표본 해시: 씨앗 글자를 16진으로 바꿔 64자리까지 되풀이한다(실제 해시처럼 보이게) */
const hex = (seed: string): string =>
  Array.from({ length: seed.length }, (_, i) => seed.charCodeAt(i).toString(16))
    .join("")
    .repeat(64)
    .slice(0, 64);
const hash = (seed: string): string => `sha256:${hex(seed)}`;

function inventory(part: Partial<InjectInventory>): InjectInventory {
  return {
    instructions: { always: [], skills: [] },
    tools: [],
    mcpServers: [],
    agents: [],
    providers: [],
    commands: [],
    ui: [],
    replaces: [],
    ...part,
  };
}

function card(part: Partial<PluginCard> & Pick<PluginCard, "name" | "displayName">): PluginCard {
  return {
    purpose: null,
    does: { inject: null, hook: null, drive: null },
    enforcement: "advisory",
    runs: { code: false, isolated: null },
    cost: { always: 0, drive: null, onDemand: null, toolCount: null, basis: "declared" },
    health: { state: "idle", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "pending", currentHash: null, pendingItemId: null, approvedAt: null },
    usedBy: [],
    ...part,
  };
}

const EMPTY_DIFF: ReviewItem["diff"] = {
  added: [],
  removed: [],
  changed: [],
  enforcementChange: null,
  costDelta: { always: null, onDemand: null },
};

function item(
  part: Partial<ReviewItem> & Pick<ReviewItem, "itemId" | "name" | "card" | "createdAt">,
): ReviewItem {
  return {
    kind: "new",
    state: "pending",
    candidateHash: hash(part.itemId.slice(-5)),
    baseHash: null,
    provenance: "assistant",
    originThreadId: null,
    originProfileId: null,
    diff: EMPTY_DIFF,
    evidence: [],
    files: [],
    decidedAt: null,
    reason: null,
    removal: null,
    ...part,
  };
}

const FILES: Readonly<Record<string, string>> = {
  "hooks/format.sh":
    '#!/bin/bash\n# 다른 하네스에서 가져온 훅: 고친 파일을 prettier로 맞춘다\nnpx prettier --write "$CLAUDE_FILE_PATHS"\n',
  "hooks/ruff.sh":
    "#!/bin/sh\n# 다른 하네스에서 가져온 훅: 바뀐 파이썬 파일을 ruff로 검사한다\nruff check --quiet $(git diff --name-only -- '*.py')\n",
  "hooks/log.sh":
    '#!/bin/bash\n# 다른 하네스에서 가져온 훅: 도구 호출 기록을 한 줄씩 남긴다\njq -c . >> "$HOME/.claude/tool-log.jsonl"\n',
  "plugin.json": `{
  "name": "lint-guard",
  "version": "0.3.0",
  "hooks": [{ "on": "tool.call.before", "run": "check" }],
  "scripts": { "check": { "run": "bash hooks/check.sh", "uses": ["system_tools"] } }
}
`,
  "hooks/message-check.sh": `#!/bin/sh
# 커밋 메시지의 첫 줄이 "영역: 내용" 꼴인지 본다. 아니면 막는다
input=$(cat)
message=$(printf '%s' "$input" | jq -r '.args.message // empty')
[ -z "$message" ] && exit 0
printf '%s' "$message" | head -n 1 | grep -qE '^[a-z]+(\\([a-z-]+\\))?: ' || { echo "첫 줄을 '영역: 내용'으로 써 주세요" >&2; exit 2; }
`,
  "hooks/check.sh": `#!/bin/bash
# 쓰기 도구가 고치려는 파일을 린트하고, 실패하면 막는다
set -euo pipefail
input=$(cat)
path=$(printf '%s' "$input" | jq -r '.args.path // empty')
[ -z "$path" ] && exit 0
case "$path" in
  *.ts|*.tsx) grep -nE 'console\\.log' "$path" && { echo "console.log를 지워 주세요" >&2; exit 2; } ;;
esac
exit 0
`,
  "README.md": "# lint-guard\n\n도구가 파일을 고치기 전에 린트를 돌린다.\n",
  "server.js": `import { serve } from "./mcp.js";
const key = process.env.FETCH_API_KEY;
serve({
  tools: {
    fetch_page: async ({ url }) => {
      const res = await fetch(url, { headers: { authorization: \`Bearer \${key}\` } });
      return { text: await res.text() };
    },
    fetch_many: async ({ urls }) => Promise.all(urls.map((url) => fetch(url).then((r) => r.text()))),
  },
});
`,
  "SKILL.md":
    "---\nname: release-notes\ndescription: 바뀐 커밋을 읽어 릴리스 노트 초안을 쓴다\n---\n\n1. 지난 태그 이후 커밋을 읽는다.\n2. 사용자에게 보이는 변화만 고른다.\n3. 한국어와 영어로 쓴다.\n",
  "drive.ts": `export default drive({
  name: "review-helper",
  async *steps(ctx) {
    yield ctx.ask("어느 PR을 정리할까요?");
    const diff = await ctx.run("git", ["diff", "--stat", "origin/main"]);
    yield ctx.say(summarize(diff));
  },
});
`,
  "rvw_sample_fetch:plugin.json": `{
  "name": "web-fetch-plus",
  "version": "1.5.0",
  "mcpServers": { "fetch": { "command": "node", "args": ["server.js", "--port", "0"], "env": ["FETCH_API_KEY"] } },
  "scripts": { "warm": { "run": "bun scripts/warm.ts", "uses": ["network"] } }
}
`,
  "rvw_sample_fetch:scripts/warm.ts": `// 자주 쓰는 페이지를 미리 받아 둔다
const urls = ["https://example.com/docs", "https://example.com/changelog"];
await Promise.all(urls.map((url) => fetch(url)));
`,
  "instructions.md": "모든 답은 한국어로 쓴다. 코드와 명령은 원문을 그대로 둔다.\n",
  "rvw_sample_fetch:mcp.js": `// 아주 작은 MCP stdio 서버: 한 줄에 JSON-RPC 메시지 하나
import { createInterface } from "node:readline";

const PROTOCOL = "2025-06-18";
const lines = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(\`\${JSON.stringify(message)}\\n\`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function describe(tools) {
  return Object.keys(tools).map((name) => ({
    name,
    description: tools[name].description ?? name,
    inputSchema: tools[name].schema ?? { type: "object" },
  }));
}

export function serve({ tools }) {
  lines.on("line", async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, "parse error");
      return;
    }
    const { id, method, params } = message;
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "web-fetch-plus", version: "1.5.0" },
        });
        return;
      case "tools/list":
        reply(id, { tools: describe(tools) });
        return;
      case "tools/call": {
        const tool = tools[params.name];
        if (tool === undefined) {
          fail(id, -32602, \`unknown tool \${params.name}\`);
          return;
        }
        const started = Date.now();
        try {
          const out = await tool(params.arguments ?? {});
          reply(id, { content: [{ type: "text", text: out.text }], meta: { ms: Date.now() - started } });
        } catch (error) {
          reply(id, { content: [{ type: "text", text: String(error) }], isError: true });
        }
        return;
      }
      case "ping":
        reply(id, {});
        return;
      default:
        fail(id, -32601, \`no method \${method}\`);
    }
  });
}
`,
};

/** 지난 승인 버전의 본문(`pluginReview.file`의 `side: "base"`). 여기 없는 경로는 보관소에서 지워진 것으로 본다(`missing`) */
const BASE_FILES: Readonly<Record<string, string>> = {
  "rvw_sample_fetch:plugin.json": `{
  "name": "web-fetch-plus",
  "version": "1.4.0",
  "mcpServers": { "fetch": { "command": "node", "args": ["server.js"], "env": ["FETCH_API_KEY"] } }
}
`,
  "rvw_sample_fetch:server.js": `import { serve } from "./mcp.js";
import { cached } from "./old-cache.js";
const key = process.env.FETCH_API_KEY;
serve({
  tools: {
    fetch_page: async ({ url }) =>
      cached(url, async () => {
        const res = await fetch(url, { headers: { authorization: \`Bearer \${key}\` } });
        return { text: await res.text() };
      }),
  },
});
`,
  "rvw_sample_fetch:mcp.js": `// 아주 작은 MCP stdio 서버: 한 줄에 JSON-RPC 메시지 하나
import { createInterface } from "node:readline";

const PROTOCOL = "2025-03-26";
const lines = createInterface({ input: process.stdin });

function send(message) {
  process.stdout.write(\`\${JSON.stringify(message)}\\n\`);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function describe(tools) {
  return Object.keys(tools).map((name) => ({
    name,
    description: tools[name].description ?? name,
    inputSchema: tools[name].schema ?? { type: "object" },
  }));
}

export function serve({ tools }) {
  lines.on("line", async (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail(null, -32700, "parse error");
      return;
    }
    const { id, method, params } = message;
    switch (method) {
      case "initialize":
        reply(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: "web-fetch-plus", version: "1.4.0" },
        });
        return;
      case "tools/list":
        reply(id, { tools: describe(tools) });
        return;
      case "tools/call": {
        const tool = tools[params.name];
        if (tool === undefined) {
          fail(id, -32602, \`unknown tool \${params.name}\`);
          return;
        }
        const out = await tool(params.arguments ?? {});
        reply(id, { content: [{ type: "text", text: out.text }] });
        return;
      }
      default:
        fail(id, -32601, \`no method \${method}\`);
    }
  });
}
`,
  "rvw_sample_fetch:old-cache.js": `// 같은 주소를 두 번 받지 않는다(프로세스가 사는 동안)
const store = new Map();
export async function cached(key, load) {
  if (store.has(key)) return store.get(key);
  const value = await load();
  store.set(key, value);
  return value;
}
`,
};

const bytesOf = (text: string | undefined): number => new TextEncoder().encode(text ?? "").length;

function filesOf(paths: readonly string[], seed: string): ReviewItem["files"] {
  return paths.map((path) => ({
    path,
    bytes: new TextEncoder().encode(FILES[path] ?? "").length,
    sha256: hex(`${seed}${path.length.toString(16)}`),
  }));
}

export const SAMPLE_PROFILES: readonly Profile[] = [
  {
    id: "default",
    title: "기본",
    builtin: true,
    // 이 기기에 없는 플러그인을 가리킨다(`SAMPLE_INSTALLED`에 없다): 넣을 곳 고르기와 승인 결과의 경고를 보이려고
    plugins: [{ name: "helm" }, { name: "web-fetch-plus" }],
    settings: [],
    startDrive: null,
    updatedAt: ago(4000),
    rev: 3,
  },
  {
    id: "writing",
    title: "글쓰기",
    builtin: false,
    plugins: [],
    settings: [],
    startDrive: null,
    updatedAt: ago(900),
    rev: 1,
  },
];

/** 표본 기기에 설치된 플러그인 이름(`ext.list`의 자리). "기본" 프로필의 helm은 여기 없다 */
export const SAMPLE_INSTALLED: ReadonlySet<string> = new Set(["web-fetch-plus", "old-timer"]);

const FETCH_BASE_FILES: ReviewItem["files"] = [
  {
    path: "plugin.json",
    bytes: bytesOf(BASE_FILES["rvw_sample_fetch:plugin.json"]),
    sha256: hex("a1"),
  },
  {
    path: "server.js",
    bytes: bytesOf(BASE_FILES["rvw_sample_fetch:server.js"]),
    sha256: hex("a2"),
  },
  { path: "mcp.js", bytes: bytesOf(BASE_FILES["rvw_sample_fetch:mcp.js"]), sha256: hex("a3") },
  {
    path: "old-cache.js",
    bytes: bytesOf(BASE_FILES["rvw_sample_fetch:old-cache.js"]),
    sha256: hex("a4"),
  },
  { path: "README.md", bytes: 96, sha256: hex("a5") },
];

const FETCH_BASE = item({
  itemId: "rvw_sample_fetch_base",
  name: "web-fetch-plus",
  kind: "new",
  state: "approved",
  candidateHash: hash("4"),
  createdAt: ago(60 * 24 * 9),
  decidedAt: ago(60 * 24 * 9),
  card: card({ name: "web-fetch-plus", displayName: "Web Fetch Plus", version: "1.4.0" }),
  files: FETCH_BASE_FILES,
});

/** 기본 표본: 할 일 종류 넷이 다 있고, 실행될 스크립트·서버, 파일 차이, 목적 없음, 프로젝트 코드가 있다 */
export function sampleItems(): readonly ReviewItem[] {
  return [
    item({
      itemId: "rvw_sample_lint",
      name: "lint-guard",
      createdAt: ago(42),
      provenance: "project",
      card: card({
        name: "lint-guard",
        displayName: "Lint Guard",
        version: "0.3.0",
        purpose: "도구가 TypeScript 파일을 고치기 전에 린트를 돌리고, 걸리면 막는다.",
        enforcement: "enforced",
        runs: { code: true, isolated: true },
        origin: { kind: "project", projectId: "prj_helm" },
        does: {
          inject: inventory({
            scripts: [
              {
                name: "check",
                launch: { command: "bash", args: ["hooks/check.sh"], envNames: [], cwd: null },
                timeoutMs: 10_000,
                // 승인된 플러그인의 스크립트: 열린 정책(AGE-63)
                uses: SCRIPT_USES,
              },
            ],
          }),
          hook: {
            hooks: [
              {
                name: "tool.call.before",
                fold: "first",
                position: "tools.before",
                powers: ["decide"],
              },
            ],
          },
          drive: null,
        },
      }),
      files: filesOf(["plugin.json", "hooks/check.sh", "README.md"], "b"),
    }),
    item({
      itemId: "rvw_sample_fetch",
      name: "web-fetch-plus",
      kind: "update",
      createdAt: ago(130),
      baseHash: hash("4"),
      baseFiles: FETCH_BASE_FILES,
      card: card({
        name: "web-fetch-plus",
        displayName: "Web Fetch Plus",
        version: "1.5.0",
        purpose: "웹 페이지를 읽어 본문만 돌려주는 도구 둘을 준다.",
        runs: { code: true, isolated: true },
        // 지난 판(1.4.0)은 매 턴 0, 쓸 때만 230이었다: 차이(+120, +180)와 맞춘다
        cost: { always: 120, drive: null, onDemand: 410, toolCount: 2, basis: "declared" },
        does: {
          inject: inventory({
            tools: [
              { name: "fetch_page", description: "페이지 하나를 읽는다" },
              { name: "fetch_many", description: "여러 페이지를 한 번에 읽는다" },
            ],
            mcpServers: [
              {
                name: "fetch",
                transport: "stdio",
                launch: {
                  command: "node",
                  args: ["server.js", "--port", "0"],
                  envNames: ["FETCH_API_KEY"],
                  cwd: null,
                },
              },
            ],
            scripts: [
              {
                name: "warm-cache",
                launch: { command: "bun", args: ["scripts/warm.ts"], envNames: [], cwd: null },
                timeoutMs: 30_000,
                uses: SCRIPT_USES,
                // 선언했지만 키 이름이라 넘어가지 않는다(AGE-63, enPp6-b). 서버는 설정의 env로 받지만 스크립트는 받지 못한다
                envNotPassed: ["FETCH_API_KEY"],
              },
            ],
          }),
          hook: null,
          drive: null,
        },
      }),
      diff: {
        added: [{ row: "inject", what: "tool:fetch_many", detail: "여러 페이지를 한 번에 읽는다" }],
        removed: [],
        changed: [{ row: "inject", what: "mcp:fetch", detail: "node server.js --port 0" }],
        enforcementChange: null,
        costDelta: { always: 120, onDemand: 180 },
      },
      files: [
        {
          path: "plugin.json",
          bytes: bytesOf(FILES["rvw_sample_fetch:plugin.json"]),
          sha256: hex("c1"),
        },
        { path: "server.js", bytes: bytesOf(FILES["server.js"]), sha256: hex("c2") },
        { path: "mcp.js", bytes: bytesOf(FILES["rvw_sample_fetch:mcp.js"]), sha256: hex("c3") },
        {
          path: "scripts/warm.ts",
          bytes: bytesOf(FILES["rvw_sample_fetch:scripts/warm.ts"]),
          sha256: hex("c4"),
        },
        { path: "README.md", bytes: 96, sha256: hex("a5") },
      ],
    }),
    item({
      itemId: "rvw_sample_drive",
      name: "review-helper",
      createdAt: ago(8),
      originThreadId: "thr_sample_pr",
      originProfileId: "default",
      card: card({
        name: "review-helper",
        displayName: "Review Helper",
        version: "0.1.0",
        purpose: null,
        enforcement: "enforced",
        // 설정 `l0.sandbox.narrowDrafts`를 켠 승인 전 드래프트: 플러그인 프로세스와 스크립트가 승인 전에는 좁게 돈다(AGE-63, enPp6)
        runs: { code: true, isolated: true, narrowBeforeApproval: true },
        does: {
          inject: inventory({
            scripts: [
              {
                name: "diff-stat",
                launch: {
                  command: "sh",
                  args: ["-c", "git diff --stat origin/main"],
                  envNames: [],
                  cwd: null,
                },
                timeoutMs: 15_000,
                // 검토 카드는 승인 뒤의 값을 싣는다. 승인 전의 좁은 길은 `runs.narrowBeforeApproval`이 알린다
                uses: SCRIPT_USES,
              },
            ],
          }),
          hook: null,
          drive: { start: false, commands: ["review"] },
        },
      }),
      files: filesOf(["plugin.json", "drive.ts"], "d"),
    }),
    // 스크립트만 있는 승인 전 드래프트(플러그인 코드 없음, AGE-63 enPp6-b): `narrowDrafts`를 켜면 이 경우에도 `runs.narrowBeforeApproval`이 참이다.
    // 선언한 이름 가운데 허용 목록의 `LANG`만 넘어가고 `GITHUB_TOKEN`은 받지 못한다
    item({
      itemId: "rvw_sample_script_draft",
      name: "commit-guard",
      createdAt: ago(5),
      originThreadId: "thr_sample_pr",
      originProfileId: "default",
      card: card({
        name: "commit-guard",
        displayName: "Commit Guard",
        version: "0.1.0",
        purpose: "커밋 전에 메시지 형식을 보고, 맞지 않으면 막는다.",
        enforcement: "enforced",
        runs: { code: false, isolated: null, narrowBeforeApproval: true },
        does: {
          inject: inventory({
            scripts: [
              {
                name: "message-check",
                launch: {
                  command: "sh",
                  args: ["hooks/message-check.sh"],
                  envNames: ["LANG"],
                  cwd: null,
                },
                timeoutMs: 10_000,
                uses: SCRIPT_USES,
                envNotPassed: ["GITHUB_TOKEN"],
              },
            ],
          }),
          hook: {
            hooks: [
              {
                name: "tool.call.before",
                fold: "first",
                position: "tools.before",
                powers: ["decide"],
              },
            ],
          },
          drive: null,
        },
      }),
      files: filesOf(["plugin.json", "hooks/message-check.sh"], "h"),
    }),
    item({
      itemId: "rvw_sample_notes",
      name: "release-notes",
      createdAt: ago(60 * 5),
      card: card({
        name: "release-notes",
        displayName: "Release Notes",
        version: "2.0.1",
        purpose: "지난 태그 이후 커밋을 읽어 릴리스 노트 초안을 쓴다.",
        cost: { always: 64, drive: null, onDemand: 900, toolCount: null, basis: "declared" },
        does: {
          inject: inventory({
            instructions: {
              always: [],
              skills: [{ name: "release-notes", path: "SKILL.md", descriptionChars: 28 }],
            },
          }),
          hook: null,
          drive: null,
        },
      }),
      diff: { ...EMPTY_DIFF, costDelta: { always: 64, onDemand: 900 } },
      files: filesOf(["SKILL.md"], "e"),
    }),
    item({
      itemId: "rvw_sample_rule",
      name: "answer-in-korean",
      createdAt: ago(3),
      provenance: "user_instruction",
      originProfileId: "writing",
      card: card({
        name: "answer-in-korean",
        displayName: "한국어로 답하기",
        purpose: "모든 답을 한국어로 쓴다.",
        does: {
          inject: inventory({
            instructions: { always: [{ path: "instructions.md", bytes: 74 }], skills: [] },
          }),
          hook: null,
          drive: null,
        },
      }),
      files: filesOf(["instructions.md"], "f"),
    }),
    // 가져온 훅(환경 모드, m6R4): 다른 하네스에서 가져온 셸 명령. 기본은 사용자 권한 그대로 돈다(`SCRIPT_ENV_USES`)
    item({
      itemId: "rvw_sample_imported",
      name: "format-on-edit",
      createdAt: ago(20),
      provenance: "migration",
      card: card({
        name: "format-on-edit",
        displayName: "Format On Edit",
        version: "1.0.0",
        purpose: null,
        does: {
          inject: inventory({
            scripts: [
              {
                name: "format",
                launch: { command: "bash", args: ["hooks/format.sh"], envNames: [], cwd: null },
                timeoutMs: 30_000,
                uses: SCRIPT_ENV_USES,
                env: {
                  command: 'npx prettier --write "$CLAUDE_FILE_PATHS"',
                  shell: "bash",
                  interpreter: "/opt/homebrew/bin/npx",
                  refs: [
                    { path: ".prettierrc", hash: hash("p1") },
                    { path: "package.json", hash: null },
                  ],
                  refsKnown: true,
                  missingTools: [],
                  versionHints: [],
                  origin: "user",
                  originLabel: null,
                  fromProject: false,
                },
              },
            ],
          }),
          hook: {
            hooks: [
              {
                name: "tool.call.after",
                fold: "tap",
                position: "tools.after",
                powers: ["observe"],
              },
            ],
          },
          drive: null,
        },
      }),
      files: filesOf(["plugin.json", "hooks/format.sh"], "g"),
    }),
    // 같은 가져온 훅을 샌드박스 설정(`l0.sandbox.sandboxImportedHooks`)을 켜고 만든 카드. 실행 파일을 못 찾았고 읽는 파일을 알 수 없다.
    // 프로젝트 폴더의 설정(`~/code/helm/.claude/settings.json`)에서 가져왔다(enFp `origin: "project"`, m6R6)
    item({
      itemId: "rvw_sample_imported_box",
      name: "ruff-check",
      createdAt: ago(25),
      provenance: "migration",
      card: card({
        name: "ruff-check",
        displayName: "Ruff Check",
        version: "0.2.0",
        purpose: "파이썬 파일을 고치기 전에 ruff로 검사하고, 걸리면 막는다.",
        enforcement: "enforced",
        does: {
          inject: inventory({
            scripts: [
              {
                name: "ruff",
                launch: { command: "sh", args: ["hooks/ruff.sh"], envNames: [], cwd: null },
                timeoutMs: 20_000,
                uses: SCRIPT_ENV_SANDBOXED_USES,
                env: {
                  command: "ruff check --quiet $(git diff --name-only -- '*.py')",
                  shell: "sh",
                  interpreter: null,
                  refs: [],
                  refsKnown: false,
                  missingTools: ["ruff"],
                  versionHints: [],
                  origin: "project",
                  originLabel: "~/code/helm",
                  fromProject: true,
                },
              },
            ],
          }),
          hook: {
            hooks: [
              {
                name: "tool.call.before",
                fold: "first",
                position: "tools.before",
                powers: ["decide"],
              },
            ],
          },
          drive: null,
        },
      }),
      files: filesOf(["plugin.json", "hooks/ruff.sh"], "h"),
    }),
    // 엔진이 출처를 기록하지 못한 가져온 훅(관리 설정에서 왔거나 가져온 뒤 폴더에서 바뀐 것: enFp `origin: "unknown"`, m6R6)
    item({
      itemId: "rvw_sample_imported_unknown",
      name: "tool-log",
      createdAt: ago(32),
      provenance: "migration",
      card: card({
        name: "tool-log",
        displayName: "Tool Log",
        version: "1.0.0",
        purpose: "도구를 부를 때마다 그 기록을 한 줄씩 파일에 남긴다.",
        does: {
          inject: inventory({
            scripts: [
              {
                name: "log",
                launch: { command: "bash", args: ["hooks/log.sh"], envNames: [], cwd: null },
                timeoutMs: 10_000,
                uses: SCRIPT_ENV_USES,
                env: {
                  command: 'jq -c . >> "$HOME/.claude/tool-log.jsonl"',
                  shell: "bash",
                  interpreter: "/opt/homebrew/bin/jq",
                  refs: [],
                  refsKnown: true,
                  missingTools: [],
                  versionHints: [],
                  origin: "unknown",
                  originLabel: null,
                  fromProject: false,
                },
              },
            ],
          }),
          hook: {
            hooks: [
              {
                name: "tool.call.after",
                fold: "tap",
                position: "tools.after",
                powers: ["observe"],
              },
            ],
          },
          drive: null,
        },
      }),
      files: filesOf(["plugin.json", "hooks/log.sh"], "k"),
    }),
    item({
      itemId: "rvw_sample_remove",
      name: "old-timer",
      kind: "remove",
      candidateHash: null,
      baseHash: hash("9"),
      provenance: "unknown",
      createdAt: ago(60 * 26),
      card: card({
        name: "old-timer",
        displayName: "Old Timer",
        purpose: "턴마다 걸린 시간을 기록한다.",
        runs: { code: true, isolated: true },
        does: {
          inject: null,
          hook: {
            hooks: [
              { name: "boundary.turn.after", fold: "tap", position: "event", powers: ["observe"] },
            ],
          },
          drive: null,
        },
      }),
      removal: {
        affectedProfiles: [{ profileId: "default", title: "기본" }],
        removes: { state: true, records: 42 },
        baseCard: card({ name: "old-timer", displayName: "Old Timer" }),
      },
    }),
    FETCH_BASE,
  ];
}

/** 많은 항목(대기 30개). 기본 표본을 이름만 바꿔 되풀이한다 */
export function manyItems(): readonly ReviewItem[] {
  const base = sampleItems().filter((i) => i.state === "pending");
  const words = [
    "atlas",
    "beacon",
    "cinder",
    "delta",
    "ember",
    "fjord",
    "glint",
    "harbor",
    "isle",
    "jade",
  ];
  const out: ReviewItem[] = [];
  for (let n = 0; n < 30; n += 1) {
    const from = base[n % base.length];
    if (from === undefined) continue;
    const word = `${words[n % words.length] ?? "item"}-${String(Math.floor(n / words.length) + 1)}`;
    out.push({
      ...from,
      itemId: `rvw_many_${String(n).padStart(2, "0")}`,
      name: word,
      createdAt: ago(5 + n * 37),
      card: { ...from.card, name: word, displayName: word.replace(/^./, (c) => c.toUpperCase()) },
    });
  }
  return [...out, FETCH_BASE];
}

/** 표본 파일 본문(`pluginReview.file`과 같은 모양). `base`는 지난 승인 버전이고, 표에 없으면 보관소에 없는 것(`missing`)이다 */
export function sampleFile(
  itemId: string,
  path: string,
  side?: ReviewFileSide,
): ReturnType<ReviewData["file"]> {
  if (side === "base") {
    const text = BASE_FILES[`${itemId}:${path}`];
    return Promise.resolve(
      ok(
        text === undefined
          ? { path, text: null, truncated: false, missing: true }
          : { path, text, truncated: false },
      ),
    );
  }
  const base = path.split("/").pop() ?? path;
  const text = FILES[`${itemId}:${path}`] ?? FILES[path] ?? FILES[base] ?? `// ${path}\n`;
  return Promise.resolve(ok({ path, text, truncated: false }));
}
