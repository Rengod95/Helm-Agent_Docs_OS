import { Bug, canonicalJson, type Clock } from "@xeon/contracts";
import type {
  AgentEvent,
  AgentTool,
  EffectId,
  IdFactory,
  ItemId,
  JsonValue,
  ToolResultMessage,
} from "@xeon/contracts/conversation";
import type { EffectIntent, SessionService } from "@xeon/contracts/records";
import type {
  AdvertisedToolset,
  ToolMeta,
  ToolRunContext,
  ToolService,
} from "@xeon/contracts/services";
import { Type } from "typebox";

// 테스트 대역: core-tools의 파이프라인 중 루프와 맞닿는 부분만 흉내 낸다.
// beforeToolCall → effect.intent, execute → effect.exec, afterToolCall → effect.result + toolResult item(한 커밋).

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
  /** 있으면 beforeToolCall이 이 사유로 막는다(의도 커밋 없음) */
  readonly blockReason?: string;
}

export interface FakeTools {
  readonly service: ToolService;
  /** `hooks(run)`와 `toAgentTools(…, run)`이 받은 실행 맥락 */
  readonly runs: readonly ToolRunContext[];
  readonly executed: readonly string[];
  readonly observed: readonly AgentEvent[];
  readonly closed: readonly string[];
  readonly reran: readonly string[];
  /** 한 호출이 실행되면 불린다(시작 직후, 결과 커밋 전). 크래시 시험에서 쓴다 */
  onExecute: ((toolCallId: string) => void) | null;
}

function notImplemented(name: string): never {
  throw new Bug(`fake-tools: ${name} is not implemented`);
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
  const observed: AgentEvent[] = [];
  const closed: string[] = [];
  const reran: string[] = [];
  const runs: ToolRunContext[] = [];
  const settled = new Map<string, ItemId>();
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

  function resultCommit(
    run: ToolRunContext,
    toolCallId: string,
    toolName: string,
    text: string,
    isError: boolean,
    synthesized: boolean,
  ): ToolResultMessage {
    const itemId = ids.next("itm");
    const effectId = intents.get(toolCallId) ?? ids.next("efx");
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text }],
      isError,
      timestamp: clock.now(),
    };
    const item = run.drafts.toolResultItem({ itemId, message, effectId });
    commitDrafts(run, `tool:${toolCallId}:result`, [
      {
        kind: "effect.result",
        payload: {
          effectId,
          status: isError ? "error" : "ok",
          resultItemId: itemId,
          output: { structuredContent: null, terminate: false },
          blobRef: null,
          durationMs: 0,
          synthesized,
        },
      },
      { kind: "item.recorded", payload: item.draft.payload },
    ]);
    settled.set(toolCallId, itemId);
    return message;
  }

  function agentToolOf(def: FakeToolDef, run: ToolRunContext): AgentTool {
    return {
      name: def.name,
      label: def.name,
      description: `fake tool ${def.name}`,
      parameters: Type.Object({}),
      ...(def.replay === undefined ? {} : { replay: def.replay }),
      ...(def.executionMode === undefined ? {} : { executionMode: def.executionMode }),
      async execute(toolCallId, params, signal) {
        executed.push(toolCallId);
        hooks.onExecute?.(toolCallId);
        const effectId = intents.get(toolCallId);
        if (effectId !== undefined) {
          commitDrafts(run, `tool:${toolCallId}:exec`, [
            { kind: "effect.exec", payload: { effectId, startedAt: clock.now() } },
          ]);
        }
        const outcome: { readonly text: string; readonly terminate?: boolean } = await (def.run?.(
          isRecord(params) ? params : {},
          signal,
        ) ?? Promise.resolve({ text: "ok" }));
        return {
          content: [{ type: "text", text: outcome.text }],
          details: {},
          ...(outcome.terminate === true ? { terminate: true } : {}),
        };
      },
    };
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
        exposure: "always",
        outputLimits: "self",
      };
    },
    advertise: () => Promise.resolve(toolsetOf()),
    toAgentTools: (_toolset, run) => [...defs.values()].map((def) => agentToolOf(def, run)),
    hooks: (run) => {
      runs.push(run);
      return {
        beforeToolCall: (callContext) => {
          const def = defs.get(callContext.toolCall.name);
          if (def?.blockReason !== undefined) {
            return Promise.resolve({ block: true, reason: def.blockReason });
          }
          const effectId = ids.next("efx");
          intents.set(callContext.toolCall.id, effectId);
          const args = callContext.toolCall.arguments;
          const intent: EffectIntent = {
            effectId,
            toolCallId: callContext.toolCall.id,
            toolName: callContext.toolCall.name,
            itemId: ids.next("itm"),
            argsHash: "0".repeat(64),
            args,
            replay: def?.replay === "safe" ? "safe" : "unsafe",
            idempotencyKey: null,
          };
          commitDrafts(run, `tool:${callContext.toolCall.id}:intent`, [
            {
              kind: "effect.intent",
              payload: {
                ...intent,
                argsHash: canonicalJson(args).length.toString(16).padStart(64, "0"),
              },
            },
          ]);
          return Promise.resolve(undefined);
        },
        afterToolCall: (callContext) => {
          const text = callContext.result.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("");
          resultCommit(
            run,
            callContext.toolCall.id,
            callContext.toolCall.name,
            text,
            callContext.isError,
            false,
          );
          return Promise.resolve(undefined);
        },
      };
    },
    observe: (event) => {
      observed.push(event);
      return Promise.resolve();
    },
    settledItem: (toolCallId) => settled.get(toolCallId),
    rerun(
      intent,
      run,
    ): Promise<{
      content: { type: "text"; text: string }[];
      details: JsonValue;
      structuredContent: JsonValue;
      isError: boolean;
      terminate: boolean;
      usage: null;
    }> {
      reran.push(intent.toolCallId);
      intents.set(intent.toolCallId, intent.effectId);
      resultCommit(run, intent.toolCallId, intent.toolName, "rerun ok", false, false);
      return Promise.resolve({
        content: [{ type: "text", text: "rerun ok" }],
        details: null,
        structuredContent: null,
        isError: false,
        terminate: false,
        usage: null,
      });
    },
    registerRules: () => notImplemented("registerRules"),
    closeUnexecuted: (run, toolCallIds) => {
      for (const id of toolCallIds) {
        closed.push(id);
        resultCommit(run, id, "unknown", "The tool call was not executed.", true, true);
      }
      return Promise.resolve();
    },
    runUserShell: () => notImplemented("runUserShell"),
    mode: () => "default",
    setMode: () => notImplemented("setMode"),
  };

  return {
    service,
    runs,
    executed,
    observed,
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
