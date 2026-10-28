import { err, ok, type Result } from "@xeon/contracts";
import type { EventId, Message, ThreadId } from "@xeon/contracts/conversation";
import type { BranchSummaryDraft, ContextError, ModelService } from "@xeon/contracts/services";
import { projectBranch, readBranchEvents, type BranchReaderDeps } from "../branch.ts";
import { branchSummaryMessage, compactionSummaryMessage, itemToMessage } from "../convert.ts";
import type { ContextSettings } from "../settings.ts";
import { summarizeVia } from "./compact.ts";
import {
  BRANCH_SUMMARY_PREAMBLE,
  BRANCH_SUMMARY_PROMPT,
  SUMMARIZATION_SYSTEM_PROMPT,
} from "./prompts.ts";
import {
  checkReply,
  computeFileLists,
  extractFileOps,
  formatFileOperations,
  serializeConversation,
} from "./summarize.ts";

// L1.context.spec §4.9, plan C-7. 떠난 가지 요약 초안을 만든다. 커밋하지 않는다(A안: 호출자가 moveLeaf에 넣는다).
// pi branch-summarization.ts를 같은 치환으로 포크했다.

export interface BranchSummaryDeps extends BranchReaderDeps {
  readonly models: Pick<ModelService, "tokens" | "complete" | "resolve">;
  readonly settings: () => ContextSettings;
}

/** 요약 응답 토큰 상한(pi: 4096) */
const BRANCH_SUMMARY_MAX_TOKENS = 4096;
const NOTHING_TO_SUMMARIZE = "No content to summarize";

export async function summarizeBranchDraft(
  deps: BranchSummaryDeps,
  threadId: ThreadId,
  from: EventId,
  to: EventId,
  opts: { readonly instructions?: string; readonly signal?: AbortSignal } = {},
): Promise<Result<BranchSummaryDraft, ContextError>> {
  const fromRead = await readBranchEvents(deps, threadId, from, opts.signal);
  if (!fromRead.ok) return fromRead;
  const toRead = await readBranchEvents(deps, threadId, to, opts.signal);
  if (!toRead.ok) return toRead;

  // 두 가지의 공통 조상 뒤에서 from 쪽에만 있는 이벤트가 떠난 가지다
  let common = 0;
  while (
    common < fromRead.value.length &&
    common < toRead.value.length &&
    fromRead.value[common]?.id === toRead.value[common]?.id
  ) {
    common += 1;
  }
  const abandoned = fromRead.value.slice(common);
  const projected = projectBranch(abandoned);
  if (!projected.ok) return projected;

  const messages: Message[] = [];
  projected.value.forEach((entry, index) => {
    const event = abandoned[index];
    if (entry === undefined || event === undefined) return;
    if (entry.type === "compacted") {
      messages.push(compactionSummaryMessage(entry.payload.summary, event.recordedAt));
    } else if (entry.type === "branch_summary") {
      messages.push(branchSummaryMessage(entry.payload.summary, event.recordedAt));
    } else if (entry.item.status !== "in_progress" && entry.item.kind !== "system") {
      messages.push(itemToMessage(entry.item));
    }
  });
  if (messages.length === 0) {
    return ok({ fromEventId: from, summary: NOTHING_TO_SUMMARIZE, details: null, usage: null });
  }

  const resolved = deps.models.resolve("summary", {});
  if (!resolved.ok) {
    return err({
      kind: "summary_failed",
      message: `no model for the summary role: ${resolved.error.kind}`,
    });
  }
  // 요약 모델 창에서 응답 예약분을 뺀 만큼만 넣는다. 최근 것부터 담는다
  const budget = resolved.value.model.contextWindow - deps.settings().reserveTokens;
  const kept: Message[] = [];
  let total = 0;
  for (const message of messages.toReversed()) {
    const tokens = deps.models.tokens.estimateMessage(message);
    if (budget > 0 && total + tokens > budget) break;
    kept.unshift(message);
    total += tokens;
  }

  const instructions =
    opts.instructions === undefined || opts.instructions.length === 0
      ? BRANCH_SUMMARY_PROMPT
      : `${BRANCH_SUMMARY_PROMPT}\n\nAdditional focus: ${opts.instructions}`;
  const prompt = `<conversation>\n${serializeConversation(kept)}\n</conversation>\n\n${instructions}`;
  const leaf = abandoned.at(-1);
  const reply = await summarizeVia(deps.models, resolved.value, {
    threadId,
    stepId: null,
    timestamp: leaf === undefined ? 0 : leaf.recordedAt,
  }).summarize({
    system: SUMMARIZATION_SYSTEM_PROMPT,
    prompt,
    maxTokens: Math.min(
      BRANCH_SUMMARY_MAX_TOKENS,
      resolved.value.model.maxTokens > 0
        ? resolved.value.model.maxTokens
        : BRANCH_SUMMARY_MAX_TOKENS,
    ),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  });
  const failure = checkReply(reply, "Branch summarization");
  if (failure !== undefined) return err(failure);

  const { readFiles, modifiedFiles } = computeFileLists(
    extractFileOps(kept, { read: [], modified: [] }),
  );
  const summary = `${BRANCH_SUMMARY_PREAMBLE}${reply.text}${formatFileOperations(readFiles, modifiedFiles)}`;
  return ok({
    fromEventId: from,
    summary: summary.length > 0 ? summary : "No summary generated",
    details: { readFiles, modifiedFiles },
    usage: reply.usage,
  });
}
