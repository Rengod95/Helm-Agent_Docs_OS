import type { GroupApi } from "@xeon/group-kit";
import {
  HELM_USAGE,
  commandErrorText,
  parseHelmCommand,
  runHelmCommand,
  statusText,
} from "./commands.ts";
import { statusNotice } from "./prompts.ts";
import type { TallyStore } from "./signals.ts";
import type { HelmState } from "./state.ts";

/** 명령 처리기가 남긴 요청. 처리기는 상태 문서에 닿을 수 없어 on 핸들러가 이어받는다 */
interface QueuedCommand {
  readonly args: string;
  readonly nonce: string;
}

export interface CommandMailbox {
  push(threadId: string | null, args: string): void;
  /** 그 thread의 요청과 thread를 모르는 요청을 꺼낸다 */
  take(threadId: string): readonly QueuedCommand[];
}

const ANY_THREAD = "*";

export function createMailbox(nonce: () => string): CommandMailbox {
  const queues = new Map<string, QueuedCommand[]>();
  return {
    push(threadId, args) {
      const key = threadId ?? ANY_THREAD;
      const queue = queues.get(key) ?? [];
      queue.push({ args, nonce: nonce() });
      queues.set(key, queue);
    },
    take(threadId) {
      const own = queues.get(threadId) ?? [];
      const any = queues.get(ANY_THREAD) ?? [];
      queues.delete(threadId);
      queues.delete(ANY_THREAD);
      return [...own, ...any];
    },
  };
}

type DrainApi = Pick<GroupApi<HelmState>, "state" | "commit" | "post">;

/**
 * 쌓인 명령을 순서대로 실행하고 결과를 알림으로 남긴다. on 핸들러 안에서 부른다.
 * 알림 requestId는 요청마다 다른 nonce라 한 번만 나간다
 */
export async function drainCommands(
  g: DrainApi,
  mailbox: CommandMailbox,
  threadId: string,
  tallies: TallyStore,
  missingMeta: ReadonlySet<string>,
): Promise<void> {
  const queue = mailbox.take(threadId);
  const run = async (index: number): Promise<void> => {
    const queued = queue[index];
    if (queued === undefined) return;
    const terms = tallies.get(threadId)?.promptTerms ?? [];
    const text = await textOf(g, parseHelmCommand(queued.args), queued.nonce, terms, [
      ...missingMeta,
    ]);
    await g.post(statusNotice(text), { when: "next", requestId: `helm:cmd:${queued.nonce}` });
    await run(index + 1);
  };
  await run(0);
}

async function textOf(
  g: DrainApi,
  parsed: ReturnType<typeof parseHelmCommand>,
  nonce: string,
  terms: readonly string[],
  missing: readonly string[],
): Promise<string> {
  if (!parsed.ok) return commandErrorText(parsed.error);
  const result = await runHelmCommand(g, parsed.value, { nonce, terms });
  return result.ok ? statusText(result.value, missing) : commandErrorText(result.error);
}

/** g.registerCommand에 넘기는 정의. 처리기는 요청을 쌓기만 하고 다음 on 핸들러가 실행한다 */
export function helmCommand(
  mailbox: CommandMailbox,
): Parameters<GroupApi<HelmState>["registerCommand"]>[1] {
  return {
    description: HELM_USAGE,
    handler(args, ctx) {
      mailbox.push(ctx.threadId, args);
      return Promise.resolve();
    },
  };
}
