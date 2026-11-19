// 대화 줄 전시 화면의 긴 줄 대화(시험 전용, `?set=long`). 줄에 들어가는 모든 블록에 공백 없는 아주 긴 한 줄(주소, base64, minified JSON,
// 긴 경로)과 넓은 표·긴 코드 줄·긴 diff 줄·긴 명령을 넣는다. 대화 열이 가로로 넘치지 않는지 재는 데 쓴다(DP-180).
import type { ItemId, ItemRecord, JsonObject, ThreadId } from "@fresnel/contracts/conversation";
import type { DurableFact } from "../../../src/state/engine/input.ts";
import {
  EMPTY_THREAD_CONVO,
  type ThreadConvo,
  type TurnRecord,
} from "../../../src/state/engine/convo.ts";
import { itm, recorded, thr, trn } from "../../state/helpers.ts";

const LONG_THREAD: ThreadId = thr(1);
const T0 = Date.parse("2026-11-13T05:00:00.000Z");
const stamp = (n: number): number => T0 + n * 4000;
const iso = (ms: number): string => new Date(ms).toISOString();
const MODEL = "claude-sonnet-5-5";

/** 공백 없는 긴 조각들 */
const URL_LONG =
  "https://storage.example.com/buckets/fresnel-artifacts/builds/2026-11-13/linux-x64/release-candidate/very/deep/path/artifact.tar.gz?X-Signature=" +
  "a1b2c3d4e5f6".repeat(24);
const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk".repeat(14);
const MINIFIED = JSON.stringify({
  data: Array.from({ length: 30 }, (_, i) => ({
    id: `node_${String(i)}`,
    weight: i * 7,
    tags: ["alpha", "beta"],
  })),
});
const PATH_LONG =
  "packages/platform-store/src/migrations/very-long-directory-name-for-testing/another-really-long-segment/2026_11_13_add_projection_indexes_and_backfill.sql";
const CMD_LONG =
  "docker run --rm -e FRESNEL_HOME=/data -e FRESNEL_TOKEN=$TOKEN -v $(pwd)/workspace/projects/fresnel:/workspace -w /workspace node:22-bookworm bash -lc 'pnpm install --frozen-lockfile && pnpm -r build && pnpm -r test -- --reporter=verbose --coverage --coverage.reporter=lcov'";
const CODE_LINE = `const result = await client.request({ method: "POST", url: "${URL_LONG.slice(0, 160)}", headers: { authorization: "Bearer ${"x".repeat(80)}" } });`;

type Usage = Extract<ItemRecord, { kind: "assistant" }>["message"]["usage"];
const usage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
type AssistantBlock = Extract<ItemRecord, { kind: "assistant" }>["message"]["content"][number];
const text = (value: string): AssistantBlock => ({ type: "text", text: value });
const thinking = (value: string): AssistantBlock => ({ type: "thinking", thinking: value });
const call = (id: string, name: string, args: JsonObject): AssistantBlock => ({
  type: "toolCall",
  id,
  name,
  arguments: args,
});

function user(n: number, content: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "user",
    message: { role: "user", content, timestamp: stamp(n) },
    requestId: null,
  };
}

function assistant(n: number, content: readonly AssistantBlock[]): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "assistant",
    partIds: [],
    message: {
      role: "assistant",
      content: [...content],
      api: "anthropic-messages",
      provider: "anthropic",
      model: MODEL,
      usage,
      stopReason: "stop",
      timestamp: stamp(n),
    },
  };
}

function result(
  n: number,
  callId: string,
  toolName: string,
  body: string,
  options: { readonly error?: boolean; readonly details?: JsonObject } = {},
): ItemRecord {
  const isError = options.error === true;
  return {
    itemId: itm(n),
    status: isError ? "failed" : "completed",
    kind: "toolResult",
    effectId: null,
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName,
      content: [{ type: "text", text: body }],
      isError,
      ...(options.details === undefined ? {} : { details: options.details }),
      timestamp: stamp(n),
    },
  };
}

function custom(n: number, content: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "custom",
    message: {
      role: "custom",
      customType: "x.notes.context",
      content,
      display: true,
      details: {},
      timestamp: stamp(n),
    },
  };
}

const REPLY = `## 결과_${"아주긴제목".repeat(14)}

주소: ${URL_LONG}

인라인 코드 \`${MINIFIED.slice(0, 400)}\` 뒤의 글.

**${"굵은긴글".repeat(40)}**

> 인용 ${BASE64.slice(0, 300)}

- 목록 ${PATH_LONG}
  - 안쪽 ${URL_LONG.slice(0, 220)}

| 열1 | 열2 | 열3 | 열4 | 열5 | 열6 | 열7 | 열8 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ${PATH_LONG} | ${URL_LONG.slice(0, 120)} | 값 | 값 | 값 | 값 | 값 | 값 |
| \`${MINIFIED.slice(0, 120)}\` | b | c | d | e | f | g | h |

\`\`\`ts
${CODE_LINE}
\`\`\`

\`\`\`json
${MINIFIED}
\`\`\`

[링크 ${URL_LONG.slice(0, 90)}](${URL_LONG})

${BASE64}`;

const AGENT_LONG = `## 보고\n\n- ${URL_LONG}\n- \`${MINIFIED.slice(0, 300)}\`\n\n\`\`\`\n${CODE_LINE}\n\`\`\``;

const ITEMS: readonly ItemRecord[] = [
  user(
    1,
    `이 주소를 봐 줘 ${URL_LONG}\n${BASE64.slice(0, 500)}\n<attachment name="${"very-long-attachment-name-".repeat(6)}.log" path="${PATH_LONG}">x</attachment>`,
  ),
  assistant(2, [
    thinking(`생각 ${URL_LONG} ${MINIFIED.slice(0, 600)}`),
    text(`먼저 ${PATH_LONG}을 읽어 볼게요. ${BASE64.slice(0, 200)}`),
    call("l-read", "read", { path: PATH_LONG }),
    call("l-bash", "bash", { command: CMD_LONG }),
    call("l-bash-fail", "bash", { command: `curl -sSf ${URL_LONG}` }),
    call("l-grep", "grep", { pattern: MINIFIED.slice(0, 120), path: PATH_LONG }),
  ]),
  result(3, "l-read", "read", `${MINIFIED}\n${BASE64}`),
  result(4, "l-bash", "bash", `${MINIFIED}\n${CODE_LINE}\n${BASE64}`, {
    details: { exitCode: 0, durationMs: 1200 },
  }),
  result(5, "l-bash-fail", "bash", `curl: (22) The requested URL returned error: 403 ${URL_LONG}`, {
    error: true,
    details: { exitCode: 22, durationMs: 300 },
  }),
  result(6, "l-grep", "grep", `${PATH_LONG}:12:${MINIFIED.slice(0, 500)}`),
  assistant(7, [call("l-cmd1", "bash", { command: CMD_LONG })]),
  result(8, "l-cmd1", "bash", `${BASE64}\n${URL_LONG}`, {
    details: { exitCode: 0, durationMs: 4000 },
  }),
  assistant(9, [
    call("l-edit", "edit", {
      path: PATH_LONG,
      edits: [
        {
          oldText: `const a = "${BASE64.slice(0, 200)}";`,
          newText: `${CODE_LINE}\n${MINIFIED.slice(0, 400)}`,
        },
      ],
    }),
  ]),
  result(10, "l-edit", "edit", `Edited ${PATH_LONG}`),
  assistant(11, [
    call("l-write", "write", { path: PATH_LONG, content: `${CODE_LINE}\n${MINIFIED}\n` }),
  ]),
  result(12, "l-write", "write", `Wrote ${PATH_LONG}`),
  assistant(13, [call("l-fetch", "web_fetch", { url: URL_LONG })]),
  result(14, "l-fetch", "web_fetch", `# 제목\n\n${URL_LONG}\n${BASE64}`),
  assistant(15, [
    call("l-mcp", "mcp__docs__search_pages", { query: MINIFIED.slice(0, 300), limit: 5 }),
  ]),
  result(16, "l-mcp", "mcp__docs__search_pages", MINIFIED, {
    details: { server: "docs", tool: "search_pages" },
  }),
  assistant(19, [call("l-agent", "agent", { agent: "reviewer", task: `점검 ${URL_LONG}` })]),
  result(20, "l-agent", "agent", AGENT_LONG, { details: { status: "completed" } }),
  assistant(21, [
    call("l-tasks", "task_write", {
      ops: [{ op: "create", content: `할 일 ${URL_LONG}`, status: "pending" }],
    }),
  ]),
  result(22, "l-tasks", "task_write", "Tasks updated"),
  assistant(23, [call("l-ext", "render_chart", { data: MINIFIED.slice(0, 400) })]),
  result(24, "l-ext", "render_chart", MINIFIED, { error: true }),
  result(25, "l-orphan", "lint_report", `${PATH_LONG}:1:1 ${BASE64.slice(0, 400)}`),
  custom(26, `참고 ${URL_LONG}`),
  assistant(27, [text(REPLY)]),
];

export function longItemFacts(): readonly DurableFact[] {
  return ITEMS.map((item) => {
    const n = Number(item.itemId.slice(-4));
    return recorded(100 + n, item, LONG_THREAD);
  });
}

function turn(input: ItemId): TurnRecord {
  return {
    lastComposition: null,
    turnId: trn(1),
    startedSeq: 101,
    startedAt: iso(T0),
    origin: "user",
    scopeId: null,
    requestId: null,
    inputItemIds: [input],
    invoked: [],
    model: MODEL,
    steps: 12,
    lastStepIndex: 11,
    lastStopReason: "stop",
    warnings: [],
    lastContextTokens: null,
    notices: [],
    abort: null,
    completion: {
      at: iso(T0 + 60000),
      status: "completed",
      stepCount: 12,
      usage,
      error: null,
      durationMs: 60000,
      end: { kind: "completed" },
    },
  };
}

export const LONG_CONVO: ThreadConvo = { ...EMPTY_THREAD_CONVO, turns: [turn(itm(1))] };
