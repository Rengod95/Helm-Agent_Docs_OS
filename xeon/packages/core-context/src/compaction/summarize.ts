import { err, ok, type Result } from "@xeon/contracts";
import type { EventId, JsonObject, JsonValue, Message, Usage } from "@xeon/contracts/conversation";
import type { ContextError } from "@xeon/contracts/services";
import { isJsonObject } from "../json.ts";
import {
  SUMMARIZATION_PROMPT,
  TURN_PREFIX_SUMMARIZATION_PROMPT,
  UPDATE_SUMMARIZATION_PROMPT,
} from "./prompts.ts";

// L1.context.spec §3.2, §4.6 4·8번, plan C-5. pi compaction.ts의 generateSummary, generateTurnPrefixSummary, compact와
// utils.ts의 serializeConversation·파일 추적을 모델 호출 주입(SummarizeDeps)으로 포크했다. pi의 위치 인자 12~14개 대신
// 호출 하나를 SummarizeDeps.summarize로 표현한다. 추정·모델 선택은 이 파일 밖(xeon.models)이 맡는다.

/** 요약 호출 하나의 결과. 어댑터가 xeon.models의 종결 메시지에서 옮겨 담는다 */
export interface SummaryReply {
  readonly text: string;
  readonly usage: Usage;
  /** pi-ai StopReason */
  readonly stopReason: string;
  readonly errorMessage: string | null;
  readonly hasToolCall: boolean;
}

export interface SummarizeDeps {
  summarize(req: {
    readonly system: string;
    readonly prompt: string;
    readonly maxTokens: number;
    readonly signal?: AbortSignal;
  }): Promise<SummaryReply>;
}

export interface FileOps {
  readonly read: readonly string[];
  readonly modified: readonly string[];
}

export interface CompactionPreparation {
  readonly firstKeptEventId: EventId;
  readonly messagesToSummarize: readonly Message[];
  readonly turnPrefixMessages: readonly Message[];
  readonly isSplitTurn: boolean;
  readonly tokensBefore: number;
  readonly previousSummary: string | null;
  readonly fileOps: FileOps;
}

// ── 파일 추적 ───────────────────────────────────────────────────────────

const READ_TOOLS: ReadonlySet<string> = new Set(["read"]);
const WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

/** assistant 메시지의 도구 호출에서 읽은 파일과 고친 파일 경로를 모은다 */
export function extractFileOps(messages: readonly Message[], previous: FileOps): FileOps {
  const read = new Set(previous.read);
  const modified = new Set(previous.modified);
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const path: unknown = block.arguments["path"];
      if (typeof path !== "string" || path.length === 0) continue;
      if (READ_TOOLS.has(block.name)) read.add(path);
      else if (WRITE_TOOLS.has(block.name)) modified.add(path);
    }
  }
  return { read: [...read], modified: [...modified] };
}

/** 고친 파일은 읽기 목록에서 뺀다. 둘 다 정렬한다 */
export function computeFileLists(ops: FileOps): {
  readonly readFiles: string[];
  readonly modifiedFiles: string[];
} {
  const modified = new Set(ops.modified);
  return {
    readFiles: ops.read.filter((path) => !modified.has(path)).toSorted(),
    modifiedFiles: [...modified].toSorted(),
  };
}

export function formatFileOperations(
  readFiles: readonly string[],
  modifiedFiles: readonly string[],
): string {
  const sections: string[] = [];
  if (readFiles.length > 0) sections.push(`<read-files>\n${readFiles.join("\n")}\n</read-files>`);
  if (modifiedFiles.length > 0) {
    sections.push(`<modified-files>\n${modifiedFiles.join("\n")}\n</modified-files>`);
  }
  return sections.length === 0 ? "" : `\n\n${sections.join("\n\n")}`;
}

function strings(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/** 이전 컴팩션 details에서 파일 목록을 읽는다. 모양이 다르면 빈 목록이다 */
export function fileOpsFromDetails(details: JsonValue): FileOps {
  if (!isJsonObject(details)) return { read: [], modified: [] };
  const object: JsonObject = details;
  return { read: strings(object["readFiles"]), modified: strings(object["modifiedFiles"]) };
}

// ── 직렬화 ──────────────────────────────────────────────────────────────

/** 요약 입력에서 도구 결과 하나의 최대 글자 수 */
const TOOL_RESULT_MAX_CHARS = 2000;

function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[... ${text.length - maxChars} more characters truncated]`;
}

function textOf(
  content: string | readonly { readonly type: string; readonly text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("");
}

/**
 * 메시지를 요약 모델에 줄 텍스트로 직렬화한다. 대화로 읽혀 이어 쓰지 않게 하려는 것이다.
 * 도구 결과는 2000자로 자르고 system 메시지는 뺀다
 */
export function serializeConversation(messages: readonly Message[]): string {
  const parts: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const content = textOf(message.content);
      if (content.length > 0) parts.push(`[User]: ${content}`);
    } else if (message.role === "assistant") {
      const thinking: string[] = [];
      const calls: string[] = [];
      const texts: string[] = [];
      for (const block of message.content) {
        if (block.type === "thinking") {
          thinking.push(block.thinking);
        } else if (block.type === "text") {
          texts.push(block.text);
        } else {
          const args = Object.entries(block.arguments)
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join(", ");
          calls.push(`${block.name}(${args})`);
        }
      }
      if (thinking.length > 0) parts.push(`[Assistant thinking]: ${thinking.join("\n")}`);
      if (texts.length > 0) parts.push(`[Assistant]: ${texts.join("")}`);
      if (calls.length > 0) parts.push(`[Assistant tool calls]: ${calls.join("; ")}`);
    } else if (message.role === "toolResult") {
      const content = textOf(message.content);
      if (content.length > 0) {
        parts.push(`[Tool result]: ${truncateForSummary(content, TOOL_RESULT_MAX_CHARS)}`);
      }
    }
  }
  return parts.join("\n\n");
}

// ── 호출 ────────────────────────────────────────────────────────────────

function combineUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    ...(a.reasoning === undefined && b.reasoning === undefined
      ? {}
      : { reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0) }),
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: a.cost.input + b.cost.input,
      output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead,
      cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total,
    },
  };
}

/** 응답 검사(§4.6 8번): error·length·중단·도구 호출이 든 응답은 저장하지 않는다 */
export function checkReply(reply: SummaryReply, label: string): ContextError | undefined {
  if (reply.stopReason === "aborted") return { kind: "aborted", message: `${label} aborted` };
  if (reply.stopReason === "error") {
    return {
      kind: "summary_failed",
      message: `${label} failed: ${reply.errorMessage ?? "Unknown error"}`,
    };
  }
  if (reply.stopReason === "length") {
    return {
      kind: "summary_truncated",
      message: `${label} failed: generation hit the token cap and the summary is incomplete`,
    };
  }
  if (reply.hasToolCall) {
    return { kind: "summary_has_tool_call", message: `${label} attempted to call a tool` };
  }
  return undefined;
}

export interface SummaryOptions {
  readonly reserveTokens: number;
  readonly instructions?: string;
  readonly signal?: AbortSignal;
  /** 요약 모델 응답 상한(모델 maxTokens). 없으면 제한 없음 */
  readonly modelMaxTokens?: number;
}

function capped(tokens: number, modelMaxTokens: number | undefined): number {
  return modelMaxTokens === undefined || modelMaxTokens <= 0
    ? tokens
    : Math.min(tokens, modelMaxTokens);
}

async function summarizeHistory(
  messages: readonly Message[],
  previousSummary: string | null,
  deps: SummarizeDeps,
  options: SummaryOptions,
  system: string,
): Promise<Result<{ readonly text: string; readonly usage: Usage }, ContextError>> {
  let base = previousSummary === null ? SUMMARIZATION_PROMPT : UPDATE_SUMMARIZATION_PROMPT;
  if (options.instructions !== undefined && options.instructions.length > 0) {
    base = `${base}\n\nAdditional focus: ${options.instructions}`;
  }
  let prompt = `<conversation>\n${serializeConversation(messages)}\n</conversation>\n\n`;
  if (previousSummary !== null) {
    prompt += `<previous-summary>\n${previousSummary}\n</previous-summary>\n\n`;
  }
  prompt += base;
  const reply = await deps.summarize({
    system,
    prompt,
    maxTokens: capped(Math.floor(0.8 * options.reserveTokens), options.modelMaxTokens),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const failure = checkReply(reply, "Summarization");
  return failure === undefined ? ok({ text: reply.text, usage: reply.usage }) : err(failure);
}

async function summarizeTurnPrefix(
  messages: readonly Message[],
  deps: SummarizeDeps,
  options: SummaryOptions,
  system: string,
): Promise<Result<{ readonly text: string; readonly usage: Usage }, ContextError>> {
  const prompt = `# Conversation\n${serializeConversation(messages)}\n\n# Instructions\n${TURN_PREFIX_SUMMARIZATION_PROMPT}`;
  const reply = await deps.summarize({
    system,
    prompt,
    // 턴 앞부분은 작은 예산을 쓴다
    maxTokens: capped(Math.floor(0.5 * options.reserveTokens), options.modelMaxTokens),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const failure = checkReply(reply, "Turn prefix summarization");
  return failure === undefined ? ok({ text: reply.text, usage: reply.usage }) : err(failure);
}

export interface CompactionResult {
  readonly summary: string;
  readonly usage: Usage;
  readonly readFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
}

/**
 * 준비된 입력으로 요약을 만든다. 이전 요약이 있으면 갱신 프롬프트를, 분할 턴이면 턴 앞부분 요약을 따로 만들어
 * `요약 + "---" + 턴 맥락`으로 합친다(§4.6 4번). 끝에 읽은·고친 파일 목록을 붙인다
 */
export async function runCompaction(
  prep: CompactionPreparation,
  deps: SummarizeDeps,
  system: string,
  options: SummaryOptions,
): Promise<Result<CompactionResult, ContextError>> {
  let summary: string;
  let usage: Usage;
  if (prep.isSplitTurn && prep.turnPrefixMessages.length > 0) {
    let historyText = prep.previousSummary ?? "No prior history.";
    let historyUsage: Usage | undefined;
    if (prep.messagesToSummarize.length > 0) {
      const history = await summarizeHistory(
        prep.messagesToSummarize,
        prep.previousSummary,
        deps,
        options,
        system,
      );
      if (!history.ok) return history;
      historyText = history.value.text;
      historyUsage = history.value.usage;
    }
    const turn = await summarizeTurnPrefix(prep.turnPrefixMessages, deps, options, system);
    if (!turn.ok) return turn;
    summary = `${historyText}\n\n---\n\n**Turn Context (split turn):**\n\n${turn.value.text}`;
    usage =
      historyUsage === undefined ? turn.value.usage : combineUsage(historyUsage, turn.value.usage);
  } else {
    const history = await summarizeHistory(
      prep.messagesToSummarize,
      prep.previousSummary,
      deps,
      options,
      system,
    );
    if (!history.ok) return history;
    summary = history.value.text;
    usage = history.value.usage;
  }
  const { readFiles, modifiedFiles } = computeFileLists(prep.fileOps);
  summary += formatFileOperations(readFiles, modifiedFiles);
  return ok({ summary, usage, readFiles, modifiedFiles });
}
