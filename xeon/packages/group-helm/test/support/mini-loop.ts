import type { Clock, Scheduler, TimerHandle } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { ToolRisk } from "@xeon/contracts/capabilities";
import type { TapePlayer } from "@xeon/core-models/testing";
import {
  fakeUsage,
  fixedIdFactory,
  type MemoryLoopOptions,
  type TestHost,
} from "@xeon/ext-host/testing";
import { ABORTED, ERROR, type LensAnswers } from "./rig.ts";

/** 도구 이름 → 위험 등급. L1.tools가 도구마다 채우는 `risk`를 흉내 낸다 */
const TOOL_RISK: Readonly<Record<string, ToolRisk>> = {
  read: "read",
  write: "write",
  bash: "exec",
};

interface ToolLog {
  /** 거부 사유와 함께 막힌 호출 */
  readonly denied: { readonly tool: string; readonly reason: string }[];
  /** 실제로 실행된 도구 이름 */
  readonly executed: string[];
  /** 모델 요청마다 지점이 만든 시스템 프롬프트 */
  readonly systemPrompts: string[];
  /** 모델이 받은 도구 결과 텍스트 */
  readonly results: string[];
}

export interface MiniLoop {
  readonly log: ToolLog;
  readonly options: MemoryLoopOptions;
  /** Helm 밖의 사용자 turn 하나. 테이프의 다음 응답들을 끝까지 소비한다 */
  userTurn(host: TestHost, thread: ThreadId): Promise<void>;
  bind(host: TestHost): void;
}

/** 실제 시간으로 도는 테이프 시계 */
export function realTapeClock(): Clock & Scheduler {
  const timers = new Map<TimerHandle, ReturnType<typeof setTimeout>>();
  const state = { next: 1 };
  return {
    now: () => Date.now(),
    setTimeout(fn, ms) {
      const handle = state.next;
      state.next += 1;
      timers.set(handle, setTimeout(fn, ms));
      return handle;
    },
    clearTimeout(handle) {
      const timer = timers.get(handle);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(handle);
    },
  };
}

function lensOf(requestId: string): string {
  return requestId.split(":")[4] ?? "";
}

const MAX_STEPS = 6;

/**
 * 모델 테이프로 turn을 돌리는 작은 루프. L1.loop가 지점에 하는 일(`input.agent.before` → 모델 → 도구 호출마다
 * `tool.call.before`·`tool.execution.after`)만 흉내 낸다. 모델 응답은 테이프가 정하고, explorer 답은 렌즈별 답표다
 */
export function miniLoop(player: TapePlayer, answers: LensAnswers): MiniLoop {
  const ids = fixedIdFactory(7000);
  const log: ToolLog = { denied: [], executed: [], systemPrompts: [], results: [] };
  const bound: { host?: TestHost } = {};
  let calls = 0;

  async function nextMessage(): Promise<{
    readonly toolCalls: readonly {
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, never>;
    }[];
  }> {
    const stream = player.stream({ role: "main", context: { messages: [] } });
    const toolCalls: { id: string; name: string; input: Record<string, never> }[] = [];
    for await (const event of stream) {
      if (event.type !== "done") continue;
      for (const block of event.message.content) {
        if (block.type === "toolCall")
          toolCalls.push({ id: block.id, name: block.name, input: {} });
      }
    }
    return { toolCalls };
  }

  async function callTool(
    host: TestHost,
    thread: ThreadId,
    call: { readonly id: string; readonly name: string },
    turnKey: string,
  ): Promise<void> {
    const outcome = await host.host.dispatch(
      "tool.call.before",
      {
        toolCallId: call.id,
        toolName: call.name,
        input: {},
        ...(TOOL_RISK[call.name] === undefined ? {} : { risk: TOOL_RISK[call.name] }),
        caller: "main",
      },
      { threadId: thread, dispatchKey: `${turnKey}:call:${call.id}` },
    );
    const decision = outcome.decision;
    const text =
      decision === undefined ? `${call.name} ok` : `[xeon:denied_by_extension] ${decision.reason}`;
    if (decision === undefined) log.executed.push(call.name);
    else log.denied.push({ tool: call.name, reason: decision.reason });
    log.results.push(text);
    await host.host.dispatch(
      "tool.execution.after",
      {
        toolCallId: call.id,
        toolName: call.name,
        input: {},
        result: { content: [{ type: "text", text }] },
        isError: decision !== undefined,
      },
      { threadId: thread, dispatchKey: `${turnKey}:after:${call.id}` },
    );
  }

  async function step(
    host: TestHost,
    thread: ThreadId,
    turnKey: string,
    left: number,
  ): Promise<void> {
    if (left <= 0) return;
    const injected = await host.host.dispatch(
      "input.agent.before",
      { prompt: "작업", systemPrompt: "base", systemPromptOptions: {} },
      {
        threadId: thread,
        dispatchKey: `${turnKey}:before:${String(left)}`,
        initial: { messages: [], systemPrompt: "base" },
      },
    );
    log.systemPrompts.push(injected.value.systemPrompt);
    const message = await nextMessage();
    if (message.toolCalls.length === 0) return;
    await eachCall(host, thread, message.toolCalls, 0, turnKey);
    await step(host, thread, turnKey, left - 1);
  }

  async function eachCall(
    host: TestHost,
    thread: ThreadId,
    list: readonly { readonly id: string; readonly name: string }[],
    index: number,
    turnKey: string,
  ): Promise<void> {
    const call = list[index];
    if (call === undefined) return;
    await callTool(host, thread, call, turnKey);
    await eachCall(host, thread, list, index + 1, turnKey);
  }

  function host(): TestHost {
    if (bound.host === undefined) throw new Error("the mini loop is not bound to a host");
    return bound.host;
  }

  return {
    log,
    bind(value) {
      bound.host = value;
    },
    async userTurn(target, thread) {
      calls += 1;
      await step(target, thread, `user${String(calls)}`, MAX_STEPS);
    },
    options: {
      async runTurn(request) {
        calls += 1;
        await step(host(), request.threadId, `turn${String(calls)}`, MAX_STEPS);
        return { outcome: { turnId: ids.next("trn"), status: "completed" }, usage: fakeUsage(10) };
      },
      runSpawn(request) {
        const answer = answers[lensOf(request.requestId)];
        const childThreadId = ids.next("thr");
        const outcome =
          answer === undefined || answer === ERROR
            ? { childThreadId, status: "error" as const }
            : answer === ABORTED
              ? { childThreadId, status: "aborted" as const }
              : { childThreadId, status: "completed" as const, answer };
        return Promise.resolve({ outcome, usage: fakeUsage(5) });
      },
    },
  };
}
