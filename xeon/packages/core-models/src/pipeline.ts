import { parseSecretRef } from "@xeon/contracts/capabilities";
import {
  ModelsError,
  type Context,
  type Models,
  type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { AssistantMessageEventStream as PiAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { Clock, Logger } from "@xeon/contracts";
import type { AssistantMessage, ModelThinkingLevel, ThreadId } from "@xeon/contracts/conversation";
import type {
  AssistantMessageEventStream,
  CacheMarks,
  CachePolicy,
  ModelCallContext,
  ModelCallOptions,
  ModelErrorKind,
  ModelRole,
} from "@xeon/contracts/services";
import { applyCacheMarks } from "./cache-policy.ts";
import type { FailureLog } from "./failure-log.ts";
import type { ProviderOverlay } from "./provider-registry.ts";
import { passableBudgets } from "./role-table.ts";
import {
  isOauthTokenOnDefaultProvider,
  oauthGuardFailure,
  type SecretResolver,
} from "./secrets-bridge.ts";
import type { ProviderSetting, RetrySettings, ThinkingBudgetSettings } from "./settings.ts";
import { observeStream } from "./stream-observer.ts";
import type { UsageRecorder } from "./usage.ts";

// L1.models.spec §4.3 호출 파이프라인, plan M-1(1~4·7·10단계와 5단계의 before_provider_request), M-5(캐시 표식 적용).
// 6번(before_provider_headers), 8·9번(after_provider_response, provider_stream_event)은 M-11이다.
// 7번 자격 증명 해석은 pi-ai Models가 요청 직전에 CredentialStore.read를 불러 하므로 이 파일에 코드가 없다.

/** before_provider_request 발화 입력. X의 ExtHost.dispatch를 plugin.ts가 이 모양으로 감싼다 */
export interface BeforeProviderRequestInput {
  readonly threadId: ThreadId;
  /** 결정적 키. pi-ai 재시도로 같은 요청에 다시 불려도 같은 값이다 */
  readonly dispatchKey: string;
  readonly provider: string;
  readonly modelId: string;
  readonly role: ModelRole;
  readonly payload: unknown;
  readonly signal?: AbortSignal;
}

export interface ProviderDispatcher {
  /** chain 지점. 핸들러 패치를 적용한 최종 페이로드를 돌려준다 */
  beforeProviderRequest(input: BeforeProviderRequestInput): Promise<unknown>;
}

export interface PipelineDeps {
  readonly models: Models;
  readonly clock: Clock;
  readonly retry: () => RetrySettings;
  readonly providerSetting: (providerId: string) => ProviderSetting | undefined;
  readonly usage: UsageRecorder;
  /** 비밀 값 마스킹. 오류 문자열에 적용한다 */
  readonly mask: (text: string) => string;
  readonly dispatcher: ProviderDispatcher | null;
  readonly failures: FailureLog;
  /** provider 등록부가 덧붙인 기본 주소·헤더 */
  readonly overlay: (providerId: string) => ProviderOverlay | undefined;
  /** 헤더 값의 비밀 참조 해석 */
  readonly resolver: SecretResolver;
  readonly logger?: Logger;
}

/** 호출 하나의 입력. stream, streamFn이 같은 모양으로 만들어 넘긴다 */
export interface CallSpec {
  readonly ctx: ModelCallContext;
  readonly provider: string;
  readonly modelId: string;
  readonly thinkingLevel: ModelThinkingLevel;
  readonly cachePolicy: CachePolicy;
  readonly context: Context;
  readonly options?: ModelCallOptions;
  /** 호출 시점의 레벨별 토큰 예산 설정. pi-ai에는 minimal~high만 넘어간다 */
  readonly budgets: ThinkingBudgetSettings;
  /** agent-core가 넘긴 키. 없으면 CredentialStore가 푼다 */
  readonly apiKey?: string;
  /** 참이면 pi-ai provider 요청 단계의 재시도(maxRetries)를 켠다. complete는 거짓이다(이중 재시도 방지) */
  readonly providerRetries: boolean;
}

export interface Pipeline {
  start(spec: CallSpec): AssistantMessageEventStream;
}

const ZERO_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function createPipeline(deps: PipelineDeps): Pipeline {
  const dispatchSeq = new Map<string, number>();

  function nextDispatchKey(ctx: ModelCallContext): string {
    const anchor = ctx.stepId ?? ctx.turnId ?? ctx.threadId;
    const seq = (dispatchSeq.get(anchor) ?? 0) + 1;
    dispatchSeq.set(anchor, seq);
    return `${anchor}:before_provider_request:${seq}`;
  }

  /** 요청을 보내지 못하는 경우의 오류 종결 스트림. 메시지는 `<kind>: …` 접두로 classify가 읽는다 */
  function failedSource(
    spec: CallSpec,
    api: string,
    kind: ModelErrorKind,
    text: string,
  ): AssistantMessageEventStream {
    deps.logger?.warn("model.request_not_sent", {
      kind,
      provider: spec.provider,
      modelId: spec.modelId,
      role: spec.ctx.role,
    });
    const message: AssistantMessage = {
      role: "assistant",
      content: [],
      api,
      provider: spec.provider,
      model: spec.modelId,
      usage: ZERO_USAGE,
      stopReason: "error",
      errorMessage: `${kind}: ${text}`,
      timestamp: deps.clock.now(),
    };
    const stream = new PiAssistantMessageEventStream();
    stream.push({ type: "error", reason: "error", error: message });
    stream.end(message);
    return stream;
  }

  function record(spec: CallSpec, message: AssistantMessage): void {
    const { ctx } = spec;
    deps.usage.record({
      threadId: ctx.threadId,
      turnId: ctx.turnId,
      stepId: ctx.stepId,
      role: ctx.role,
      scopeId: ctx.scopeId ?? null,
      provider: spec.provider,
      modelId: spec.modelId,
      usage: message.usage,
      stopReason: message.stopReason,
      aborted: message.stopReason === "aborted" || ctx.signal?.aborted === true,
      recordedAt: deps.clock.now(),
    });
  }

  /** provider 등록부 헤더. `secret://` 참조 값은 요청 직전에 해석한다. 값은 요청 헤더로만 나간다 */
  async function overlayHeaders(spec: CallSpec): Promise<Record<string, string>> {
    const declared = Object.entries(deps.overlay(spec.provider)?.headers ?? {});
    const values = await Promise.all(
      declared.map(async ([name, value]): Promise<readonly [string, string]> => {
        if (!parseSecretRef(value).ok) return [name, value];
        const resolved = await deps.resolver.resolve(
          value,
          spec.provider,
          `model.provider:${spec.provider}`,
        );
        if (!resolved.ok) {
          deps.failures.record(resolved.error);
          throw new ModelsError("auth", `${resolved.error.kind}: ${resolved.error.reason}`);
        }
        return [name, resolved.value];
      }),
    );
    return Object.fromEntries(values);
  }

  function requestOptions(spec: CallSpec, api: string): ModelsSimpleStreamOptions {
    const { ctx } = spec;
    const retry = deps.retry();
    const retention = spec.options?.cacheRetention ?? spec.cachePolicy.retention;
    const useSession = retention !== "none" && spec.cachePolicy.sessionKey === "thread";
    const dispatcher = deps.dispatcher;
    const dispatchKey = dispatcher === null ? "" : nextDispatchKey(ctx);
    const marks: CacheMarks | undefined =
      api === "anthropic-messages" && retention !== "none" ? spec.options?.cacheMarks : undefined;
    const hasOverlayHeaders = Object.keys(deps.overlay(spec.provider)?.headers ?? {}).length > 0;
    return {
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
      // 2: 캐시 정책. 보존 기간과 세션 키(threadId)
      cacheRetention: retention,
      ...(useSession ? { sessionId: ctx.threadId } : {}),
      // 3: 추론. off면 생략한다. 토큰 예산은 minimal~high 네 키만 pi-ai로 넘긴다
      ...(spec.thinkingLevel === "off"
        ? {}
        : { reasoning: spec.thinkingLevel, thinkingBudgets: passableBudgets(spec.budgets) }),
      // 4: 재시도 수치
      ...(spec.providerRetries
        ? { maxRetries: retry.maxRetries, maxRetryDelayMs: retry.maxDelayMs }
        : { maxRetries: 0 }),
      ...(spec.options?.maxTokens === undefined ? {} : { maxTokens: spec.options.maxTokens }),
      ...(spec.options?.temperature === undefined ? {} : { temperature: spec.options.temperature }),
      ...(spec.options?.toolChoice === undefined ? {} : { toolChoice: spec.options.toolChoice }),
      ...(spec.apiKey === undefined ? {} : { apiKey: spec.apiKey }),
      ...(hasOverlayHeaders
        ? {
            transformHeaders: async (
              headers: Record<string, string | null>,
            ): Promise<Record<string, string | null>> => ({
              ...headers,
              ...(await overlayHeaders(spec)),
            }),
          }
        : {}),
      // 5: 페이로드 확정 뒤 캐시 표식 적용 → before_provider_request. 재시도 때 다시 불려도 같은 입력이면 같은 결과다
      ...(dispatcher === null && marks === undefined
        ? {}
        : {
            onPayload: async (payload: unknown): Promise<unknown> => {
              const marked =
                marks === undefined ? payload : applyCacheMarks(payload, marks, spec.context);
              if (dispatcher === null) return marked;
              return await dispatcher.beforeProviderRequest({
                threadId: ctx.threadId,
                dispatchKey,
                provider: spec.provider,
                modelId: spec.modelId,
                role: ctx.role,
                payload: marked,
                ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
              });
            },
          }),
    };
  }

  function start(spec: CallSpec): AssistantMessageEventStream {
    const failureMark = deps.failures.mark();
    const model = deps.models.getModel(spec.provider, spec.modelId);
    const setting = deps.providerSetting(spec.provider);

    let source: AssistantMessageEventStream;
    // 1: provider가 등록되어 있고 사용할 수 있는지
    if (deps.models.getProvider(spec.provider) === undefined || setting?.enabled === false) {
      source = failedSource(
        spec,
        model?.api ?? "unknown",
        "provider_unavailable",
        `provider ${spec.provider} is not available`,
      );
    } else if (model === undefined) {
      source = failedSource(
        spec,
        "unknown",
        "model_not_found",
        `model ${spec.provider}/${spec.modelId} is not in the catalog`,
      );
    } else if (
      spec.apiKey !== undefined &&
      isOauthTokenOnDefaultProvider(spec.provider, spec.apiKey)
    ) {
      const guard = oauthGuardFailure(spec.provider);
      deps.failures.record(guard);
      source = failedSource(spec, model.api, guard.kind, guard.reason);
    } else {
      // 기본 주소: 설정 baseUrl → provider 등록부 덮어쓰기 → 카탈로그 값
      const baseUrl = setting?.baseUrl ?? deps.overlay(spec.provider)?.baseUrl ?? null;
      const requestModel = baseUrl === null ? model : { ...model, baseUrl };
      try {
        source = deps.models.streamSimple(
          requestModel,
          spec.context,
          requestOptions(spec, model.api),
        );
      } catch (error) {
        // pi-ai는 던지지 않는 계약이지만 컨텍스트 정규화 같은 동기 단계가 던질 수 있다
        source = failedSource(
          spec,
          model.api,
          "provider_error",
          error instanceof Error ? error.message : "request setup failed",
        );
      }
    }

    return observeStream(source, {
      finalize(message) {
        // 요청이 나가기 전에 사용자가 중단하면 pi-ai는 설정 오류로 끝낸다. 중단은 중단으로 보고한다
        if (message.stopReason === "error" && spec.ctx.signal?.aborted === true) {
          return { ...message, stopReason: "aborted" };
        }
        if (message.stopReason !== "error") return message;
        const failure = deps.failures.since(failureMark, spec.provider);
        if (failure !== null) {
          // 참조 이름만 남긴다. 값은 이 모듈이 로그에 쓸 수 있는 곳으로 가져온 적이 없다
          deps.logger?.warn("model.secret_unresolved", {
            provider: spec.provider,
            secretName: failure.secretName,
          });
        }
        const text =
          failure === null ? (message.errorMessage ?? "") : `${failure.kind}: ${failure.reason}`;
        return { ...message, errorMessage: deps.mask(text) };
      },
      onSettled: (message) => {
        record(spec, message);
      },
      onAbandoned: () => {
        record(spec, {
          role: "assistant",
          content: [],
          api: model?.api ?? "unknown",
          provider: spec.provider,
          model: spec.modelId,
          usage: ZERO_USAGE,
          stopReason: "aborted",
          timestamp: deps.clock.now(),
        });
      },
    });
  }

  return { start };
}
