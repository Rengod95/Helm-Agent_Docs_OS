import { err, ok, type Result } from "@fresnel/contracts";
import type { BeforeAgentStartPayload, DriveFrameView } from "@fresnel/contracts/extensions";
import { commitWithRetry } from "../commit.ts";
import { customItemOf } from "../commits.ts";
import { prestartRequest } from "../turn-start.ts";
import { promptAddition } from "./environment.ts";
import { commitFailure, type TurnRun } from "./turn-run.ts";
import type { LoopFailure, TurnEntry } from "./types.ts";

// L1.loop.spec §4.2 규칙 1. T1 뒤에 `input.agent.before`를 발화하고, 추가된 메시지를 custom item으로 기록한다(prestart 커밋).

/**
 * 주도권 스택(아래에서 위 순서)에서 플러그인 이름만 모은다. 맨 아래 코어 루프 프레임(plugin null)은 뺀다.
 * `driver`는 맨 위 플러그인 프레임이고 주도 중이 아니면 null, `stack`은 주도 중이 아니면 빈 배열이다(drive-isolation.md 2.5)
 */
function driveFieldsOf(
  frames: readonly DriveFrameView[],
): Pick<BeforeAgentStartPayload, "driver" | "stack"> {
  const stack = frames.flatMap((frame): string[] => (frame.plugin === null ? [] : [frame.plugin]));
  return { driver: stack.at(-1) ?? null, stack };
}

export async function beforeAgentStart(
  run: TurnRun,
  entry: Extract<TurnEntry, { kind: "fresh" }>,
): Promise<Result<void, LoopFailure>> {
  const { ctx, threadId, turnId, scope, state } = run;
  const payload: BeforeAgentStartPayload = {
    prompt: entry.prompt,
    ...(entry.images.length === 0 ? {} : { images: [...entry.images] }),
    systemPrompt: state.basePrompt,
    systemPromptOptions: {},
    ...driveFieldsOf(ctx.ext.driveFrames(threadId)),
  };
  const outcome = await ctx.ext.dispatch("input.agent.before", payload, {
    threadId,
    dispatchKey: `${turnId}:input.agent.before`,
    initial: { messages: [], systemPrompt: state.basePrompt },
    signal: scope.signal,
  });
  // 접두는 기본 프롬프트로 고정이므로 핸들러가 바꾼 부분은 단계마다 붙이는 안내로 따로 들고 간다(`environment.ts`)
  state.promptAddition = promptAddition(state.basePrompt, outcome.value.systemPrompt);
  // 기여한 핸들러가 하나뿐이면 안내의 출처를 안다(§4.5 규칙 27). 둘 이상이면 어느 쪽인지 정하지 않는다
  const [onlyContributor, ...otherContributors] = outcome.contributed;
  state.promptAdditionOwner =
    onlyContributor !== undefined && otherContributors.length === 0
      ? onlyContributor.extension
      : null;
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
