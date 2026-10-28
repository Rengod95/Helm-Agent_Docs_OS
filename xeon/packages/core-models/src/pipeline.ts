import { parseSecretRef } from "@xeon/contracts/capabilities";
import {
  lazyStream,
  ModelsError,
  type Context,
  type Models,
  type ModelsSimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { AssistantMessageEventStream as PiAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { attemptAsync, type Clock, type Logger } from "@xeon/contracts";
import type { AssistantMessage, ModelThinkingLevel } from "@xeon/contracts/conversation";
import type {
  AssistantMessageEventStream,
  CacheMarks,
  CachePolicy,
  ModelBinding,
  ModelCallContext,
  ModelCallOptions,
  ModelErrorKind,
} from "@xeon/contracts/services";
import { applyCacheMarks } from "./cache-policy.ts";
import type { FailureLog } from "./failure-log.ts";
import type { ProviderOverlay } from "./provider-registry.ts";
import { passableBudgets } from "./role-table.ts";
import {
  planHeaders,
  publicResponseHeaders,
  type ModelSelectSource,
  type ProviderDispatcher,
} from "./request-points.ts";
import {
  isOauthTokenOnDefaultProvider,
  oauthGuardFailure,
  type SecretResolver,
} from "./secrets-bridge.ts";
import type { ProviderSetting, RetrySettings, ThinkingBudgetSettings } from "./settings.ts";
import { observeStream } from "./stream-observer.ts";
import type { UsageRecorder } from "./usage.ts";

// L1.models.spec §4.3 호출 파이프라인, plan M-1(1~4·7·10단계와 5단계의 before_provider_request), M-5(캐시 표식 적용).
// 6번(before_provider_headers), 8·9번(after_provider_response, provider_stream_event)과 단계 시작 지점
// (model_select, thinking_level_select)은 M-11이다.
// 7번 자격 증명 해석은 pi-ai Models가 요청 직전에 CredentialStore.read를 불러 하므로 이 파일에 코드가 없다.

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
  /** core-models 안에서만 쓰는 호출 변형. hosted 검색이 쓴다 */
  readonly internal?: CallInternals;
  /** model_select 지점의 source. 체크포인트로 다시 묶은 호출이면 restore, 아니면 route */
  readonly selectSource: ModelSelectSource;
  /** 호출 시점의 레벨별 토큰 예산 설정. pi-ai에는 minimal~high만 넘어간다 */
  readonly budgets: ThinkingBudgetSettings;
  /** agent-core가 넘긴 키. 없으면 CredentialStore가 푼다 */
  readonly apiKey?: string;
  /** 참이면 pi-ai provider 요청 단계의 재시도(maxRetries)를 켠다. complete는 거짓이다(이중 재시도 방지) */
  readonly providerRetries: boolean;
}

/** 호출 하나에 덧붙이는 내부 훅. 대화 호출은 쓰지 않는다 */
interface CallInternals {
  /** 캐시 표식 적용 뒤, before_provider_request 앞에서 페이로드를 바꾼다. 같은 입력에 같은 결과여야 한다 */
  readonly payloadHook?: (payload: unknown) => unknown;
  /** 어댑터가 낸 원시 스트림 이벤트를 받는다 */
  readonly rawEventSink?: (data: unknown) => void;
  /** 참이면 요청 지점(before_provider_request 등)을 발화하지 않는다. thread에 속하지 않는 호출이다 */
  readonly skipPoints?: boolean;
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
  /** 역할(과 scope)마다 직전 호출의 바인딩. model_select, thinking_level_select 판정에 쓴다 */
  const lastBinding = new Map<string, ModelBinding>();

  /** 호출 하나의 키 접두. 같은 호출 안의 모든 지점이 `<접두>:<지점>:<순번>` 꼴로 같은 순번을 쓴다 */
  function nextCallKey(ctx: ModelCallContext): (point: string) => string {
    const anchor = ctx.stepId ?? ctx.turnId ?? ctx.threadId;
    const seq = (dispatchSeq.get(anchor) ?? 0) + 1;
    dispatchSeq.set(anchor, seq);
    return (point) => `${anchor}:${point}:${seq}`;
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

  /** 이 호출이 쓰는 지점 발화기. thread에 속하지 않는 내부 호출은 지점을 발화하지 않는다 */
  function dispatcherOf(spec: CallSpec): ProviderDispatcher | null {
    return spec.internal?.skipPoints === true ? null : deps.dispatcher;
  }

  /** 비밀 참조에서 푼 헤더 이름(소문자). before_provider_headers에서 값을 가린다 */
  function secretHeaderNames(provider: string): ReadonlySet<string> {
    const declared = deps.overlay(provider)?.headers ?? {};
    return new Set(
      Object.entries(declared).flatMap(([name, value]) =>
        parseSecretRef(value).ok ? [name.toLowerCase()] : [],
      ),
    );
  }

  function requestOptions(
    spec: CallSpec,
    api: string,
    keyOf: (point: string) => string,
  ): ModelsSimpleStreamOptions {
    const { ctx } = spec;
    const retry = deps.retry();
    const retention = spec.options?.cacheRetention ?? spec.cachePolicy.retention;
    const useSession = retention !== "none" && spec.cachePolicy.sessionKey === "thread";
    const dispatcher = dispatcherOf(spec);
    const hook = spec.internal?.payloadHook;
    const rawSink = spec.internal?.rawEventSink;
    const marks: CacheMarks | undefined =
      api === "anthropic-messages" && retention !== "none" ? spec.options?.cacheMarks : undefined;
    const hasOverlayHeaders = Object.keys(deps.overlay(spec.provider)?.headers ?? {}).length > 0;
    const hasHeadersPoint = dispatcher?.beforeProviderHeaders !== undefined;
    const hasResponsePoint = dispatcher?.afterProviderResponse !== undefined;
    const hasStreamPoint = dispatcher?.providerStreamEvent !== undefined;
    const base = {
      threadId: ctx.threadId,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    };
    const target = { provider: spec.provider, modelId: spec.modelId, role: ctx.role };
    let streamEvents = 0;
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
      // 6: 헤더 확정 뒤. 등록부의 비밀 참조 헤더를 풀고, before_provider_headers에는 인증 값을 가린 사본을 보낸다
      ...(hasOverlayHeaders || hasHeadersPoint
        ? {
            transformHeaders: async (
              headers: Record<string, string | null>,
            ): Promise<Record<string, string | null>> => {
              const merged: Record<string, string | null> = hasOverlayHeaders
                ? { ...headers, ...(await overlayHeaders(spec)) }
                : headers;
              if (dispatcher === null || !hasHeadersPoint) return merged;
              const plan = planHeaders(merged, secretHeaderNames(spec.provider));
              const final = await dispatcher.beforeProviderHeaders?.({
                ...base,
                ...target,
                dispatchKey: keyOf("request.headers.before"),
                headers: plan.visible,
              });
              const result = plan.finalize(final ?? plan.visible);
              if (result.ignored.length > 0) {
                deps.logger?.warn("model.auth_header_patch_ignored", {
                  ...target,
                  headers: result.ignored.join(","),
                });
              }
              return result.headers;
            },
          }
        : {}),
      // 5: 페이로드 확정 뒤 캐시 표식 적용 → before_provider_request. 재시도 때 다시 불려도 같은 입력이면 같은 결과다
      ...(dispatcher === null && marks === undefined && hook === undefined
        ? {}
        : {
            onPayload: async (payload: unknown): Promise<unknown> => {
              const marked =
                marks === undefined ? payload : applyCacheMarks(payload, marks, spec.context);
              const hooked = hook === undefined ? marked : hook(marked);
              if (dispatcher === null) return hooked;
              return await dispatcher.beforeProviderRequest({
                ...base,
                ...target,
                dispatchKey: keyOf("request.provider.before"),
                payload: hooked,
              });
            },
          }),
      // 8: 응답 수신. 인증·쿠키 헤더는 뺀다
      ...(dispatcher === null || !hasResponsePoint
        ? {}
        : {
            onResponse: async (response: { status: number; headers: Record<string, string> }) => {
              await dispatcher.afterProviderResponse?.({
                ...base,
                ...target,
                dispatchKey: keyOf("request.provider.after"),
                status: response.status,
                headers: publicResponseHeaders(response.headers),
              });
            },
          }),
      // 9: 원시 스트림 이벤트. 지원하는 어댑터만 부른다
      ...((dispatcher === null || !hasStreamPoint) && rawSink === undefined
        ? {}
        : {
            onProviderStreamEvent: async (data: unknown) => {
              rawSink?.(data);
              if (dispatcher === null || !hasStreamPoint) return;
              streamEvents += 1;
              await dispatcher.providerStreamEvent?.({
                ...base,
                provider: spec.provider,
                api,
                model: spec.modelId,
                dispatchKey: `${keyOf("request.stream")}:${streamEvents}`,
                data,
              });
            },
          }),
    };
  }

  /**
   * 요청 직전에 바인딩이 바뀌었는지 보고 지점을 발화한다(spec §4.2 6번). provider·모델이 다르면 model_select,
   * 레벨만 다르면 thinking_level_select(detached)다. 같은 thread·역할·scope의 직전 호출과 비교하고, 직전 호출이 없으면
   * (처음이거나 프로세스를 다시 띄운 뒤) previous가 null인 model_select를 한 번 낸다
   */
  async function fireSelectPoints(spec: CallSpec, keyOf: (point: string) => string): Promise<void> {
    if (spec.internal?.skipPoints === true) return;
    const dispatcher = deps.dispatcher;
    const { ctx } = spec;
    const key = `${ctx.threadId}|${ctx.role}|${ctx.scopeId ?? ""}`;
    const binding: ModelBinding = {
      role: ctx.role,
      provider: spec.provider,
      modelId: spec.modelId,
      thinkingLevel: spec.thinkingLevel,
    };
    const previous = lastBinding.get(key) ?? null;
    lastBinding.set(key, binding);
    if (dispatcher === null) return;
    const base = {
      threadId: ctx.threadId,
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal }),
    };
    const modelChanged =
      previous === null ||
      previous.provider !== binding.provider ||
      previous.modelId !== binding.modelId;
    if (modelChanged) {
      const fired = await attemptAsync(
        async () =>
          await dispatcher.modelSelect?.({
            ...base,
            dispatchKey: keyOf("request.model.after"),
            binding,
            previous,
            source: spec.selectSource,
          }),
      );
      if (!fired.ok)
        deps.logger?.warn("model.select_point_failed", { point: "request.model.after" });
      return;
    }
    if (previous.thinkingLevel !== binding.thinkingLevel) {
      const fired = await attemptAsync(
        async () =>
          await dispatcher.thinkingLevelSelect?.({
            ...base,
            dispatchKey: keyOf("request.thinking.after"),
            role: ctx.role,
            level: binding.thinkingLevel,
            previousLevel: previous.thinkingLevel,
          }),
      );
      if (!fired.ok) {
        deps.logger?.warn("model.select_point_failed", { point: "request.thinking.after" });
      }
    }
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
        const keyOf = nextCallKey(spec.ctx);
        const options = requestOptions(spec, model.api, keyOf);
        // 요청을 보내기 직전에만 바인딩 변경 지점을 발화한다. 지점 핸들러를 기다리는 동안에도 스트림은 먼저 돌려준다
        source = lazyStream(requestModel, async () => {
          await fireSelectPoints(spec, keyOf);
          return deps.models.streamSimple(requestModel, spec.context, options);
        });
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
