import { Bug, err, ok, type Result } from "@xeon/contracts";
import type { AssistantMessage, LifecycleEvent } from "@xeon/contracts/conversation";
import { responseRequest } from "../commits.ts";
import { guardFinalOutput } from "./guard-output.ts";
import {
  commitStep,
  currentStep,
  dispatchKey,
  emitNotifications,
  messageIdentity,
  type TurnRun,
} from "./turn-run.ts";
import type { LoopFailure } from "./types.ts";

// L1.loop.spec §3.2 단계 4 `commitResponse`. `boundary.message.after` chain으로 응답을 확정하고, 앞서 쌓은 system·custom item과 함께
// C3(T3)로 커밋한다. 도구 호출이 있으면 `next:"tools"` 체크포인트는 core-persistence의 커밋 규칙을 따른다(L1.loop.spec §3.5).

type ItemCompletedNote = Extract<LifecycleEvent, { readonly type: "item.completed" }>;

function itemCompletedOf(notes: readonly LifecycleEvent[]): ItemCompletedNote | undefined {
  for (const note of notes) if (note.type === "item.completed") return note;
  return undefined;
}

export async function commitResponse(
  run: TurnRun,
  original: AssistantMessage,
): Promise<Result<AssistantMessage, LoopFailure>> {
  const { ctx, state, mapper, running, threadId, scope } = run;
  const step = currentStep(run);
  const patched = await ctx.ext.dispatch(
    "boundary.message.after",
    { message: structuredClone(original) },
    {
      threadId,
      dispatchKey: dispatchKey(run, step.stepId, `message_end:${messageIdentity(run, original)}`),
      initial: { message: structuredClone(original) },
      signal: scope.signal,
    },
  );
  const patchedMessage = patched.value.message;
  const chained = patchedMessage.role === "assistant" ? patchedMessage : original;
  // 표시와 기록 전에 출력 가드를 거친다. 차단된 답은 사유 한 줄로 바뀌어 대화 기록에 남는다
  const finalMessage = await guardFinalOutput(run, chained);
  const notes = mapper.map({ type: "message_end", message: finalMessage });
  const completed = itemCompletedOf(notes);
  if (completed === undefined || completed.item.kind !== "assistant") {
    throw new Bug("loop.mapper_gave_no_assistant_item");
  }
  state.assistant = finalMessage;
  state.assistantItemId = completed.item.itemId;
  state.assistantParts = mapper.partsOf(completed.item.itemId);
  state.newMessages.push(finalMessage);
  emitNotifications(run, notes);
  const prelude = state.prelude;
  state.prelude = [];
  const committed = commitStep(
    run,
    responseRequest(ctx.drafter, {
      step,
      prelude,
      assistant: completed.item,
      parts: state.assistantParts,
    }),
  );
  if (!committed.ok) return err(committed.error);
  running.phase = finalMessage.content.some((block) => block.type === "toolCall")
    ? "tools"
    : "requesting";
  return ok(finalMessage);
}
