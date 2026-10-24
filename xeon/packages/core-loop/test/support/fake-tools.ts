import { Bug, canonicalJson, ok, type Clock, type Result } from "@xeon/contracts";
import type {
  AgentToolCall,
  AgentToolResult,
  EffectId,
  IdFactory,
  ToolResultMessage,
} from "@xeon/contracts/conversation";
import type { EffectIntent, ReadFailure, SessionService } from "@xeon/contracts/records";
import type {
  AdvertisedToolset,
  CallPreparation,
  RejectReason,
  ToolCallOutcome,
  ToolCallState,
  ToolMeta,
  ToolRunContext,
  ToolService,
} from "@xeon/contracts/services";
import { Type } from "typebox";

// 테스트 대역: core-tools의 파이프라인 중 루프와 접하는 부분만 흉내 낸다.
// prepare → effect.intent, execute → effect.exec + effect.result + toolResult item(한 커밋), 효과 없이 닫는 호출 → toolResult item 하나.

export interface FakeToolDef {
  readonly name: string;
  /** 실행. 기본은 "ok"를 돌려준다 */
  readonly run?: (
    args: Readonly<Record<string, unknown>>,
    signal: AbortSignal | undefined,
  ) => Promise<{ readonly text: string; readonly terminate?: boolean }>;
  readonly replay?: "safe" | "never";
  /** "sequential"이면 한 배치가 순서대로 준비·실행된다 */
  readonly executionMode?: "sequential" | "parallel";
  /** 있으면 prepare가 이 사유로 막는다(의도 커밋 없음, 결과 item만 기록) */
  readonly blockReason?: string;
}

export interface FakeTools {
  readonly service: ToolService;
  /** `prepare`가 받은 실행 맥락 */
  readonly runs: readonly ToolRunContext[];
  readonly executed: readonly string[];
  /** `settleRejected`가 닫은 호출 id */
  readonly closed: readonly string[];
  readonly reran: readonly string[];
  /** 한 호출이 실행되면 불린다(시작 직후, 결과 커밋 전). 크래시 시험에서 쓴다 */
  onExecute: ((toolCallId: string) => void) | null;
}

function notImplemented(name: string): never {
  throw new Bug(`fake-tools: ${name} is not implemented`);
}

function outcomeOf(
  call: AgentToolCall,
  state: ToolCallState,
  message: ToolResultMessage,
  itemId: ToolCallOutcome["itemId"],
  terminate: boolean,
): ToolCallOutcome {
  const result: AgentToolResult = {
    content: [...message.content],
    details: {},
    isError: message.isError,
    ...(terminate ? { terminate: true } : {}),
  };
  return { toolCall: call, state, result, isError: message.isError, message, itemId };
}

export function createFakeTools(options: {
  readonly session: SessionService;
  readonly ids: IdFactory;
  readonly clock: Clock;
  readonly tools: readonly FakeToolDef[];
}): FakeTools {
  const { session, ids, clock } = options;
  const producer = session.producer("core.tools");
  const defs = new Map(options.tools.map((def) => [def.name, def]));
  const executed: string[] = [];
  const closed: string[] = [];
  const reran: string[] = [];
  const runs: ToolRunContext[] = [];
  const intents = new Map<string, EffectId>();
  const hooks: { onExecute: ((toolCallId: string) => void) | null } = { onExecute: null };

  function commitDrafts(
    run: ToolRunContext,
    requestId: string,
    drafts: readonly {
      kind: "effect.intent" | "effect.exec" | "effect.result" | "item.recorded";
      payload: unknown;
    }[],
  ): void {
    const stamped = drafts.map((draft) =>
      producer.draft({
        id: ids.next("evt"),
        kind: draft.kind,
        threadId: run.threadId,
        turnId: run.turnId,
        stepId: run.stepId,
        causationId: null,
        correlationId: null,
        payload: draft.payload,
      }),
    );
    const result = session.commit({
      threadId: run.threadId,
      requestId,
      fingerprintSource: { requestId },
      build: () => ({ kind: "append", drafts: stamped, checkpoint: null }),
    });
    if (!result.ok) throw new Bug(`fake-tools: commit failed ${result.error.kind}`);
  }

  function textMessage(
    toolCallId: string,
    toolName: string,
    text: string,
    isError: boolean,
  ): ToolResultMessage {
    return {
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text }],
      isError,
      timestamp: clock.now(),
    };
  }

  /** 효과 없이 닫는 호출: toolResult item 하나만 기록한다 */
  function itemOnly(
    run: ToolRunContext,
    call: AgentToolCall,
    state: ToolCallState,
    text: string,
    terminate: boolean = false,
  ): ToolCallOutcome {
    const itemId = ids.next("itm");
    const message = textMessage(call.id, call.name, text, true);
    const item = run.drafts.toolResultItem({ itemId, message, effectId: null });
    commitDrafts(run, `tool:${call.id}:result`, [
      { kind: "item.recorded", payload: item.draft.payload },
    ]);
    return outcomeOf(call, state, message, itemId, terminate);
  }

  function resultCommit(
    run: ToolRunContext,
    call: AgentToolCall,
    state: ToolCallState,
    text: string,
    isError: boolean,
    synthesized: boolean,
    terminate: boolean = false,
  ): ToolCallOutcome {
    const itemId = ids.next("itm");
    const effectId = intents.get(call.id) ?? ids.next("efx");
    const message = textMessage(call.id, call.name, text, isError);
    const item = run.drafts.toolResultItem({ itemId, message, effectId });
    commitDrafts(run, `tool:${call.id}:result`, [
      {
        kind: "effect.result",
        payload: {
          effectId,
          status: isError ? "error" : "ok",
          resultItemId: itemId,
          output: { structuredContent: null, terminate },
          blobRef: null,
          durationMs: 0,
          synthesized,
        },
      },
      { kind: "item.recorded", payload: item.draft.payload },
    ]);
    return outcomeOf(call, state, message, itemId, terminate);
  }

  const toolsetOf = (): AdvertisedToolset => ({
    tools: [...defs.values()].map((def) => ({
      capability: "core.fake",
      name: def.name,
      wire: {
        name: def.name,
        description: `fake tool ${def.name}`,
        parameters: Type.Object({}),
      },
    })),
    deferred: [],
    removed: [],
    fingerprint: "sha256:fake",
  });

  function prepare(call: AgentToolCall, run: ToolRunContext): CallPreparation {
    runs.push(run);
    const def = defs.get(call.name);
    if (def === undefined) {
      return {
        kind: "settled",
        outcome: itemOnly(run, call, "rejected", `Tool ${call.name} is not available.`),
      };
    }
    if (def.blockReason !== undefined) {
      return { kind: "settled", outcome: itemOnly(run, call, "rejected", def.blockReason) };
    }
    const effectId = ids.next("efx");
    intents.set(call.id, effectId);
    const args = call.arguments;
    const intent: EffectIntent = {
      effectId,
      toolCallId: call.id,
      toolName: call.name,
      itemId: ids.next("itm"),
      argsHash: "0".repeat(64),
      args,
      replay: def.replay === "safe" ? "safe" : "unsafe",
      idempotencyKey: null,
    };
    commitDrafts(run, `tool:${call.id}:intent`, [
      {
        kind: "effect.intent",
        payload: {
          ...intent,
          argsHash: canonicalJson(args).length.toString(16).padStart(64, "0"),
        },
      },
    ]);
    return { kind: "ready", call: { toolCall: call, args } };
  }

  async function execute(
    call: AgentToolCall,
    args: Readonly<Record<string, unknown>>,
    run: ToolRunContext,
  ): Promise<ToolCallOutcome> {
    const def = defs.get(call.name);
    executed.push(call.id);
    hooks.onExecute?.(call.id);
    const effectId = intents.get(call.id);
    if (effectId !== undefined) {
      commitDrafts(run, `tool:${call.id}:exec`, [
        { kind: "effect.exec", payload: { effectId, startedAt: clock.now() } },
      ]);
    }
    const outcome: { readonly text: string; readonly terminate?: boolean } = await (def?.run?.(
      args,
      run.signal,
    ) ?? Promise.resolve({ text: "ok" }));
    return resultCommit(
      run,
      call,
      "executed",
      outcome.text,
      false,
      false,
      outcome.terminate === true,
    );
  }

  function settleOne(
    call: AgentToolCall,
    reason: RejectReason,
    run: ToolRunContext,
  ): ToolCallOutcome {
    closed.push(call.id);
    const text =
      reason === "truncated"
        ? "The tool call was not executed: the response hit the output token limit."
        : "The tool call was not executed.";
    if (intents.has(call.id)) {
      return resultCommit(run, call, reason, text, true, true);
    }
    return itemOnly(run, call, reason, text);
  }

  const service: ToolService = {
    register: () => notImplemented("register"),
    meta(name): ToolMeta | undefined {
      const def = defs.get(name);
      if (def === undefined) return undefined;
      return {
        name,
        label: name,
        ref: { capability: "core.fake", name },
        risk: "exec",
        classes: [],
        hints: {},
        replay: def.replay === "safe" ? "safe" : "unsafe",
        ...(def.executionMode === undefined ? {} : { executionMode: def.executionMode }),
        exposure: "always",
        outputLimits: "self",
      };
    },
    advertise: () => Promise.resolve(toolsetOf()),
    prepare: (call, _assistant, run) => Promise.resolve(prepare(call, run)),
    execute: (prepared, _onUpdate, run) => execute(prepared.toolCall, prepared.args, run),
    settleRejected: (calls, reason, run) =>
      Promise.resolve(calls.map((call) => settleOne(call, reason, run))),
    rerun(intent, run): Promise<Result<ToolCallOutcome, ReadFailure>> {
      reran.push(intent.toolCallId);
      intents.set(intent.toolCallId, intent.effectId);
      const call: AgentToolCall = {
        type: "toolCall",
        id: intent.toolCallId,
        name: intent.toolName,
        arguments: {},
      };
      return Promise.resolve(ok(resultCommit(run, call, "executed", "rerun ok", false, false)));
    },
    registerRules: () => notImplemented("registerRules"),
    runUserShell: () => notImplemented("runUserShell"),
    mode: () => "default",
    setMode: () => notImplemented("setMode"),
  };

  return {
    service,
    runs,
    executed,
    closed,
    reran,
    get onExecute() {
      return hooks.onExecute;
    },
    set onExecute(value) {
      hooks.onExecute = value;
    },
  };
}
