import { MAX_TOOLS_PER_REQUEST } from "@xeon/contracts/capabilities";
import { parse } from "@xeon/contracts";
import { TOOL_SEARCH_NAME } from "@xeon/contracts/services";
import { Type } from "typebox";
import type { ToolsDeps } from "../deps.ts";
import { errorOutcome } from "../entries.ts";
import { planExposure } from "../expose.ts";
import type { RawCall, RawOutcome, ToolEntry } from "../types.ts";
import { activatedTools } from "./activation.ts";

// L1.tools.spec §4.1 규칙 4·5 내장 도구 `tool_search`(순서 키 `core.tools`). 지연 도구를 이름·설명으로 찾고, 찾은 도구를 활성화한다.
// 활성화는 이 도구의 효과 결과(`structuredContent.activated`)로 기록되고 다음 `advertise`가 이벤트에서 다시 읽는다.

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const DESCRIPTION_PREVIEW = 200;

const ParamsSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 200 }),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_LIMIT })),
  },
  { additionalProperties: false },
);

const SEARCH_DESCRIPTION =
  "Search the tools that are not loaded yet by name or description. " +
  "The tools you find become available from the next step. Use short keywords.";

function tokensOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((token) => token.length > 0);
}

/** 이름이 맞으면 크게, 설명이 맞으면 작게 점수를 준다. 0이면 후보가 아니다 */
function scoreOf(entry: ToolEntry, tokens: readonly string[]): number {
  const name = entry.name.toLowerCase();
  const description = entry.description.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (name === token) score += 10;
    else if (name.includes(token)) score += 5;
    else if (description.includes(token)) score += 2;
  }
  return score;
}

function preview(description: string): string {
  const line = description.split("\n")[0] ?? "";
  return line.length > DESCRIPTION_PREVIEW ? `${line.slice(0, DESCRIPTION_PREVIEW)}...` : line;
}

type SearchDeps = Pick<ToolsDeps, "session" | "config"> & {
  /** 등록 표의 현재 항목 */
  readonly entries: () => readonly ToolEntry[];
};

async function search(deps: SearchDeps, call: RawCall): Promise<RawOutcome> {
  const params = parse(ParamsSchema, call.params);
  if (!params.ok) {
    return errorOutcome("[invalid_input] tool_search needs a non-empty query.", {
      code: "invalid_input",
    });
  }
  const { query, limit = DEFAULT_LIMIT } = params.value;
  const threadId = call.run.threadId;
  const activated = await activatedTools(deps.session, threadId);
  if (!activated.ok) {
    return errorOutcome(`[xeon:tools.read_failed] ${activated.error.kind}`, {
      code: "tools.read_failed",
    });
  }
  const config = deps.config(threadId);
  const plan = planExposure(
    deps.entries(),
    {
      run: { threadId, caller: call.run.caller, depth: call.run.depth },
      activated: activated.value,
    },
    {
      rules: config.rules,
      bypassAllowed: config.bypassAllowed,
      deferThreshold: config.deferThreshold,
    },
  );
  const tokens = tokensOf(query);
  const found = plan.deferred
    .map((entry) => ({ entry, score: scoreOf(entry, tokens) }))
    .filter((candidate) => candidate.score > 0)
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate) => candidate.entry);
  const room = Math.max(0, MAX_TOOLS_PER_REQUEST - plan.advertised.length);
  const chosen = found.slice(0, room);
  const skipped = found.length - chosen.length;

  const lines: string[] = [];
  if (found.length === 0) {
    lines.push(`No unloaded tool matches "${query}".`);
  } else {
    lines.push(
      `Found ${found.length} tool(s). ${chosen.length > 0 ? "They are available from the next step:" : ""}`.trimEnd(),
    );
    for (const entry of found) lines.push(`- ${entry.name}: ${preview(entry.description)}`);
    if (skipped > 0) {
      lines.push(
        `${skipped} of them were not activated: a request can list at most ${MAX_TOOLS_PER_REQUEST} tools.`,
      );
    }
  }
  const names = chosen.map((entry) => entry.name);
  return {
    result: {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { query, matches: found.map((entry) => entry.name), skipped },
      structuredContent: { activated: names },
      isError: false,
    },
    interrupted: false,
  };
}

/** 내장 `tool_search` 항목. 지연 도구가 없는 요청에는 광고되지 않는다(`planExposure`가 거른다) */
export function toolSearchEntry(deps: SearchDeps): ToolEntry {
  return {
    name: TOOL_SEARCH_NAME,
    label: "Tool search",
    description: SEARCH_DESCRIPTION,
    parameters: ParamsSchema,
    outputSchema: undefined,
    executionMode: undefined,
    ref: { capability: "core.tools", name: TOOL_SEARCH_NAME },
    capability: undefined,
    mcpServer: undefined,
    risk: "read",
    classes: [],
    hints: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    replay: "safe",
    exposure: "always",
    outputLimits: {},
    raw: (call) => search(deps, call),
    locks: undefined,
  };
}
