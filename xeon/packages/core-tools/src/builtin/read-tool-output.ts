import { parse } from "@xeon/contracts";
import { Type } from "typebox";
import type { ToolsDeps } from "../deps.ts";
import { errorOutcome } from "../entries.ts";
import type { RawCall, RawOutcome, ToolEntry } from "../types.ts";
import { toolOutputBlob } from "./activation.ts";

// L1.tools.spec §4.8 6번 내장 도구 `read_tool_output`(순서 키 `core.tools`). 한도를 넘어 blob으로 옮긴 도구 출력 원문을 줄 단위로 다시 읽는다.
// 이 대화의 `effect.result.blobRef`로 기록된 해시만 읽는다. 다른 blob(인자, 다른 대화의 출력)은 읽지 않는다.

const READ_TOOL_OUTPUT_NAME = "read_tool_output";

const ParamsSchema = Type.Object(
  {
    sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
    offset: Type.Optional(Type.Integer({ minimum: 1 })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100_000 })),
  },
  { additionalProperties: false },
);

const DESCRIPTION =
  "Read a stored full tool output again. Pass the blob sha256 from the truncation notice, " +
  "an optional 1-based start line (offset) and a line count (limit).";

type ReadDeps = Pick<ToolsDeps, "session" | "store" | "config">;

function linesOf(text: string): string[] {
  const lines = text.split("\n");
  // 끝 개행이 만드는 빈 줄은 센다고 보지 않는다
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

async function read(deps: ReadDeps, call: RawCall): Promise<RawOutcome> {
  const params = parse(ParamsSchema, call.params);
  if (!params.ok) {
    return errorOutcome("[invalid_input] read_tool_output needs a 64-character sha256.", {
      code: "invalid_input",
    });
  }
  const { sha256, offset = 1 } = params.value;
  const found = await toolOutputBlob(deps.session, call.run.threadId, sha256);
  if (!found.ok) {
    return errorOutcome(`[xeon:tools.read_failed] ${found.error.kind}`, {
      code: "tools.read_failed",
    });
  }
  if (found.value === undefined) {
    return errorOutcome(`[xeon:output_not_found] No stored tool output has sha256 ${sha256}.`, {
      code: "output_not_found",
    });
  }
  const blob = deps.store.readBlob(found.value);
  if (!blob.ok) {
    return errorOutcome(
      `[xeon:output_unreadable] The stored output cannot be read (${blob.error.kind}).`,
      {
        code: "output_unreadable",
      },
    );
  }
  const lines = linesOf(new TextDecoder().decode(blob.value));
  const limit = params.value.limit ?? deps.config(call.run.threadId).output.maxLines;
  if (offset > lines.length) {
    return errorOutcome(
      `[invalid_input] offset ${offset} is past the last line (${lines.length}).`,
      {
        code: "invalid_input",
      },
    );
  }
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const last = offset - 1 + slice.length;
  const more = last < lines.length ? ` Use offset ${last + 1} to continue.` : "";
  const header = `[xeon:output_page] Lines ${offset}-${last} of ${lines.length} of blob sha256:${sha256}.${more}`;
  return {
    result: {
      content: [{ type: "text", text: `${header}\n${slice.join("\n")}` }],
      details: { sha256, offset, lines: slice.length, totalLines: lines.length },
      isError: false,
    },
    interrupted: false,
  };
}

/** 내장 `read_tool_output` 항목 */
export function readToolOutputEntry(deps: ReadDeps): ToolEntry {
  return {
    name: READ_TOOL_OUTPUT_NAME,
    label: "Read tool output",
    description: DESCRIPTION,
    parameters: ParamsSchema,
    outputSchema: undefined,
    executionMode: undefined,
    ref: { capability: "core.tools", name: READ_TOOL_OUTPUT_NAME },
    capability: undefined,
    mcpServer: undefined,
    risk: "read",
    classes: [],
    hints: { readOnly: true, destructive: false, idempotent: true, openWorld: false },
    replay: "safe",
    exposure: "always",
    outputLimits: {},
    raw: (call) => read(deps, call),
    locks: undefined,
  };
}
