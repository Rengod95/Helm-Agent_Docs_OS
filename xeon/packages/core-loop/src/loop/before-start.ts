import { err, ok, type Result } from "@xeon/contracts";
import type { BeforeAgentStartPayload } from "@xeon/contracts/extensions";
import { commitWithRetry } from "../commit.ts";
import { customItemOf } from "../commits.ts";
import { prestartRequest } from "../turn-start.ts";
import { commitFailure, type TurnRun } from "./turn-run.ts";
import type { LoopFailure, TurnEntry } from "./types.ts";

// L1.loop.spec §4.2 규칙 1. T1 뒤에 `before_agent_start`를 발화하고, 추가된 메시지를 custom item으로 기록한다(prestart 커밋).

export async function beforeAgentStart(
  run: TurnRun,
  entry: Extract<TurnEntry, { kind: "fresh" }>,
): Promise<Result<void, LoopFailure>> {
  const { ctx, threadId, turnId, scope, state } = run;
  const payload: BeforeAgentStartPayload = {
    prompt: entry.prompt,
    ...(entry.images.length === 0 ? {} : { images: [...entry.images] }),
    systemPrompt: ctx.basePrompt,
    systemPromptOptions: {},
  };
  const outcome = await ctx.ext.dispatch("before_agent_start", payload, {
    threadId,
    dispatchKey: `${turnId}:before_agent_start`,
    initial: { messages: [], systemPrompt: ctx.basePrompt },
    signal: scope.signal,
  });
  state.basePrompt = outcome.value.systemPrompt;
  const records = outcome.value.messages.map((draft) =>
    customItemOf(ctx.ids.next("itm"), draft, ctx.clock.now()),
  );
  if (records.length === 0) return ok(undefined);
  const committed = commitWithRetry(
    ctx.session,
    prestartRequest(ctx.drafter, { threadId, turnId }, records),
  );
  return committed.ok ? ok(undefined) : err(commitFailure(committed));
}
