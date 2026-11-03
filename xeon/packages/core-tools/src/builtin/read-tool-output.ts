import { parse } from "@fresnel/contracts";
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
    byteOffset: Type.Optional(Type.Integer({ minimum: 0 })),
    byteLimit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10_000_000 })),
  },
  { additionalProperties: false },
);

const DESCRIPTION =
  "Read a stored full tool output again. Pass the blob sha256 from the truncation notice, " +
  "an optional 1-based start line (offset) and a line count (limit). " +
  "For a single line longer than the output limit, pass byteOffset (and byteLimit) to read that line (offset) in UTF-8 byte ranges.";

type ReadDeps = Pick<ToolsDeps, "session" | "store" | "config">;

function linesOf(text: string): string[] {
  const lines = text.split("\n");
  // 끝 개행이 만드는 빈 줄은 센다고 보지 않는다
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines;
}

/** 헤더 줄이 같은 한도를 나눠 쓰므로 본문 바이트는 한도에서 여유를 뺀 값 안에 둔다. 아니면 읽은 결과가 다시 빈 미리보기가 된다 */
function pageBytes(requested: number | undefined, maxBytes: number): number {
  const room = Math.max(1, maxBytes - 512);
  return Math.min(requested ?? room, room);
}

function isContinuation(bytes: Uint8Array, index: number): boolean {
  return ((bytes[index] ?? 0) & 0xc0) === 0x80;
}

/** 줄 하나를 UTF-8 바이트 범위로 읽는다. 양 끝은 글자 경계로 맞춘다(시작은 앞으로, 끝은 뒤로 물린다) */
function readLineBytes(
  sha256: string,
  line: number,
  text: string,
  byteOffset: number,
  byteLimit: number,
): RawOutcome {
  const bytes = new TextEncoder().encode(text);
  if (byteOffset > bytes.length) {
    return errorOutcome(
      `[invalid_input] byteOffset ${byteOffset} is past the end of line ${line} (${bytes.length} bytes).`,
      { code: "invalid_input" },
    );
  }
  let start = byteOffset;
  while (start < bytes.length && isContinuation(bytes, start)) start += 1;
  let end = Math.min(bytes.length, byteOffset + byteLimit);
  while (end > start && end < bytes.length && isContinuation(bytes, end)) end -= 1;
  const chunk = new TextDecoder().decode(bytes.subarray(start, end));
  const more = end < bytes.length ? ` Use byteOffset ${end} to continue.` : "";
  const header = `[fresnel:output_page] Line ${line} bytes ${start}-${end} of ${bytes.length} of blob sha256:${sha256}.${more}`;
  return {
    result: {
      content: [{ type: "text", text: `${header}\n${chunk}` }],
      details: { sha256, offset: line, byteStart: start, byteEnd: end, totalBytes: bytes.length },
      isError: false,
    },
    interrupted: false,
  };
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
    return errorOutcome(`[fresnel:tools.read_failed] ${found.error.kind}`, {
      code: "tools.read_failed",
    });
  }
  if (found.value === undefined) {
    return errorOutcome(`[fresnel:output_not_found] No stored tool output has sha256 ${sha256}.`, {
      code: "output_not_found",
    });
  }
  const blob = deps.store.readBlob(found.value);
  if (!blob.ok) {
    return errorOutcome(
      `[fresnel:output_unreadable] The stored output cannot be read (${blob.error.kind}).`,
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
  if (params.value.byteOffset !== undefined) {
    return readLineBytes(
      sha256,
      offset,
      lines[offset - 1] ?? "",
      params.value.byteOffset,
      pageBytes(params.value.byteLimit, deps.config(call.run.threadId).output.maxBytes),
    );
  }
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const last = offset - 1 + slice.length;
  const more = last < lines.length ? ` Use offset ${last + 1} to continue.` : "";
  const header = `[fresnel:output_page] Lines ${offset}-${last} of ${lines.length} of blob sha256:${sha256}.${more}`;
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
