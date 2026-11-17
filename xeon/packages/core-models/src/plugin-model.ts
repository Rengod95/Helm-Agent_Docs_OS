import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type {
  AssistantMessage,
  Api,
  Context,
  Message,
  Usage,
} from "@fresnel/contracts/conversation";
import type {
  PluginModelError,
  PluginModelMessage,
  PluginModelRequest,
  PluginModelResult,
  PluginModelValue,
} from "@fresnel/contracts/capabilities";
import type {
  ModelCallRequest,
  ModelError,
  ModelRole,
  ResolvedModel,
  RoleOverrides,
} from "@fresnel/contracts/services";
import { classifyMessage } from "./classify.ts";

// 플러그인의 `model` 명령(drive-isolation.md §1.2)이 쓰는 모델 호출 한 번. 역할은 판정 호출과 같은 `judge`다
// (core-agents `completeStructured`가 `judge`로 해석한다). 호출은 `complete`를 거치므로 `request.provider.before`와
// `guard.model.before`가 지나고 사용량은 기존 경로로 귀속된다. 조립 훅(`request.context.before`, `request.system.before`)은 부르지 않는다.

/** 플러그인 모델 호출이 쓰는 역할 */
const PLUGIN_MODEL_ROLE: ModelRole = "judge";

/** 가드 차단 종결 메시지의 접두(pipeline.ts가 붙인다) */
const GUARD_PREFIX = "[fresnel:denied_by_guard] ";

/** 이 프로세스가 기억하는 성공한 호출 수. 넘으면 가장 오래된 것부터 버린다 */
const MEMO_LIMIT = 256;

/** 대화 기록에 넣는 과거 어시스턴트 글의 사용량은 0이다(제공자가 준 값이 아니다) */
const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export interface PluginModelDeps {
  readonly resolve: (
    role: ModelRole,
    overrides: RoleOverrides,
  ) => Result<ResolvedModel, ModelError>;
  readonly complete: (request: ModelCallRequest) => Promise<AssistantMessage>;
  readonly now: () => number;
}

export type PluginModelCall = (
  request: PluginModelRequest,
) => Promise<Result<PluginModelResult, PluginModelError>>;

/** 시스템 메시지는 합쳐 지침이 되고, 사용자와 어시스턴트 메시지는 순서대로 대화가 된다 */
function contextOf(
  messages: readonly PluginModelMessage[],
  target: { readonly api: Api; readonly provider: string; readonly modelId: string },
  now: number,
): Context {
  const system = messages.flatMap((message) =>
    message.role === "system" ? [message.content] : [],
  );
  const transcript = messages.flatMap((message): Message[] => {
    if (message.role === "system") return [];
    if (message.role === "user")
      return [{ role: "user", content: message.content, timestamp: now }];
    return [
      {
        role: "assistant",
        content: [{ type: "text", text: message.content }],
        api: target.api,
        provider: target.provider,
        model: target.modelId,
        usage: ZERO_USAGE,
        stopReason: "stop",
        timestamp: now,
      },
    ];
  });
  return {
    ...(system.length === 0 ? {} : { systemPrompt: system.join("\n\n") }),
    messages: transcript,
  };
}

function textOf(message: AssistantMessage): string {
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
}

/** 오류로 끝난 종결 메시지를 호출 오류 값으로 옮긴다. 가드 차단은 따로 가려낸다 */
function failureOf(message: AssistantMessage): PluginModelError {
  const text = message.errorMessage ?? "";
  if (text.startsWith(GUARD_PREFIX)) return { kind: "denied_by_guard", message: text };
  const kind = classifyMessage(message) ?? "provider_error";
  return {
    kind,
    message: text.length === 0 ? `the model stopped with ${message.stopReason}` : text,
  };
}

/**
 * 플러그인 모델 호출을 만든다. 같은 대화(threadId)의 같은 (scopeId, requestId)의 성공은 이 프로세스 안에서 저장된 결과를 돌려주고 제공자를 다시 부르지 않는다.
 * 실패는 저장하지 않는다(다시 부르면 같은 결과가 나올 수 있다). 재시작 뒤에는 기억이 없어 다시 부른다.
 */
export function createPluginModelCall(deps: PluginModelDeps): PluginModelCall {
  const memo = new Map<string, Promise<Result<PluginModelValue, PluginModelError>>>();

  async function once(
    request: PluginModelRequest,
  ): Promise<Result<PluginModelValue, PluginModelError>> {
    const resolved = deps.resolve(PLUGIN_MODEL_ROLE, { scopeId: request.plugin.scopeId });
    if (!resolved.ok) {
      return err({ kind: resolved.error.kind, message: resolved.error.message });
    }
    const { binding, model } = resolved.value;
    const context = contextOf(
      request.messages,
      { api: model.api, provider: binding.provider, modelId: binding.modelId },
      deps.now(),
    );
    const reply = await attemptAsync(() =>
      deps.complete({
        threadId: request.threadId,
        turnId: null,
        stepId: null,
        role: PLUGIN_MODEL_ROLE,
        scopeId: request.plugin.scopeId,
        requestId: request.requestId,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        resolved: resolved.value,
        context,
      }),
    );
    if (!reply.ok) {
      const cause = reply.error.cause;
      return err({
        kind: "provider_error",
        message: `the model call threw: ${cause instanceof Error ? cause.message : "non-error thrown"}`,
      });
    }
    const message = reply.value;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return err(failureOf(message));
    }
    return ok({
      text: textOf(message),
      usage: {
        input: message.usage.input,
        output: message.usage.output,
        total: message.usage.totalTokens,
      },
      stopReason: message.stopReason,
    });
  }

  return async (request) => {
    const key = `${request.threadId}\u0000${request.plugin.scopeId}\u0000${request.requestId}`;
    const known = memo.get(key);
    if (known !== undefined) {
      const stored = await known;
      return stored.ok ? ok({ ...stored.value, replayed: true }) : stored;
    }
    const work = once(request);
    memo.set(key, work);
    const result = await work;
    if (!result.ok) {
      if (memo.get(key) === work) memo.delete(key);
      return result;
    }
    if (memo.size > MEMO_LIMIT) {
      const oldest = memo.keys().next();
      if (oldest.done !== true) memo.delete(oldest.value);
    }
    return ok({ ...result.value, replayed: false });
  };
}
