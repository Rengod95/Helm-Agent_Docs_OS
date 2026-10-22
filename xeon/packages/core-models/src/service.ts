import {
  getSupportedThinkingLevels,
  retryAssistantCall,
  type CredentialStore,
  type MutableModels,
  type RetryPolicy,
} from "@earendil-works/pi-ai";
import { Bug, err, ok, type Clock, type Logger, type Result } from "@xeon/contracts";
import type { AssistantMessage, ModelThinkingLevel } from "@xeon/contracts/conversation";
import {
  formatModelRef,
  type AssistantMessageEventStream,
  type CachePolicy,
  type ModelBinding,
  type ModelCallContext,
  type ModelCallRequest,
  type ModelError,
  type ModelInfo,
  type ModelListFilter,
  type ModelRefString,
  type ModelRole,
  type ModelService,
  type ResolvedModel,
  type RoleOverrides,
  type SecretService,
  type StreamFn,
} from "@xeon/contracts/services";
import { classifyMessage } from "./classify.ts";
import { createFailureLog } from "./failure-log.ts";
import { createPipeline, type CallSpec, type ProviderDispatcher } from "./pipeline.ts";
import { basicCachePolicy, resolveRole } from "./role-table.ts";
import {
  secretBackedCredentialStore,
  type ProviderCredentialRefs,
  type SecretTarget,
} from "./secrets-bridge.ts";
import { DEFAULT_RETRY_SETTINGS, type ProviderSetting, type RetrySettings } from "./settings.ts";
import { createTokenEstimator } from "./tokens.ts";
import { createUsageMeter } from "./usage.ts";

// L1.models.spec §3.3, plan M-1. pi-ai Models 위의 ModelService 구현이다. pi-agent-core와 Cordis는 import하지 않는다.

/** 서비스가 읽는 설정 값 중 M1 키 셋. 값은 설정 서비스가 스키마로 검증해 넘긴다 */
export interface ModelsSettings {
  /** l1.models.default */
  readonly default: ModelRefString | null;
  /** l1.models.providers */
  readonly providers: readonly ProviderSetting[];
  /** l1.models.retry */
  readonly retry: RetrySettings;
}

export const DEFAULT_MODELS_SETTINGS: ModelsSettings = {
  default: null,
  providers: [],
  retry: DEFAULT_RETRY_SETTINGS,
};

/** 호출 시점의 유효 설정을 읽는 함수. 읽는 경로는 spec §8.2 마지막 행이 미결이라 조립 루트가 넘긴다 */
export type ModelsSettingsSource = () => ModelsSettings;

/** l1.models.thinkingLevel(M2 키)의 M1 고정 값. L1.models.spec §6의 기본값이다 */
const M1_THINKING_LEVEL: ModelThinkingLevel = "medium";
/** l1.models.cacheRetention(M2 키)의 M1 고정 값. L1.models.spec §6의 기본값이다 */
const M1_CACHE_RETENTION: CachePolicy["retention"] = "short";

export interface ModelServiceDeps {
  /**
   * pi-ai 모델 모음을 만든다. 서비스가 만든 CredentialStore(비밀 참조 다리)를 받아야 하므로 팩토리로 받는다.
   * 운영은 builtinModels({ credentials }), 테스트는 createModels({ credentials })에 테이프 provider를 더한 것이다
   */
  readonly buildModels: (credentials: CredentialStore) => MutableModels;
  readonly secrets: SecretService;
  readonly clock: Clock;
  readonly settings: ModelsSettingsSource;
  /** 없으면 before_provider_request를 발화하지 않는다 */
  readonly dispatcher?: ProviderDispatcher;
  readonly logger?: Logger;
}

function modelError(kind: ModelError["kind"], message: string, ref?: string): ModelError {
  return { kind, message, ...(ref === undefined ? {} : { ref }) };
}

function targetOfUrl(baseUrl: string): SecretTarget | null {
  try {
    const url = new URL(baseUrl);
    return { host: url.hostname, port: url.port === "" ? null : Number(url.port) };
  } catch {
    return null;
  }
}

function callOf(request: ModelCallRequest, providerRetries: boolean): CallSpec {
  const { binding, cachePolicy } = request.resolved;
  return {
    ctx: request,
    provider: binding.provider,
    modelId: binding.modelId,
    thinkingLevel: binding.thinkingLevel,
    cachePolicy,
    context: request.context,
    ...(request.options === undefined ? {} : { options: request.options }),
    providerRetries,
  };
}

export function createModelService(deps: ModelServiceDeps): ModelService {
  const failures = createFailureLog();
  const usage = createUsageMeter(deps.logger);
  const tokens = createTokenEstimator();

  function providerSetting(providerId: string): ProviderSetting | undefined {
    return deps.settings().providers.find((entry) => entry.id === providerId);
  }

  const refs: ProviderCredentialRefs = {
    get(providerId) {
      const setting = providerSetting(providerId);
      return setting !== undefined && setting.enabled ? setting.apiKeyRef : null;
    },
    ids: () =>
      deps
        .settings()
        .providers.flatMap((entry) =>
          entry.enabled && entry.apiKeyRef !== null ? [entry.id] : [],
        ),
  };

  // 요청 목적지(호스트 일치 정책용). baseUrl 설정 덮어쓰기 → provider → 첫 모델 순으로 찾는다
  function targetOf(providerId: string): SecretTarget | null {
    const override = providerSetting(providerId)?.baseUrl ?? null;
    const baseUrl =
      override ??
      models.getProvider(providerId)?.baseUrl ??
      models.getModels(providerId)[0]?.baseUrl ??
      null;
    return baseUrl === null ? null : targetOfUrl(baseUrl);
  }

  const credentials = secretBackedCredentialStore(refs, deps.secrets, {
    targetOf,
    onFailure: (failure) => {
      failures.record(failure);
    },
  });
  const models = deps.buildModels(credentials);

  const pipeline = createPipeline({
    models,
    clock: deps.clock,
    retry: () => deps.settings().retry,
    providerSetting,
    usage,
    mask: (text) => deps.secrets.redactor.mask(text).text,
    dispatcher: deps.dispatcher ?? null,
    failures,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  });

  function resolveWith(
    role: ModelRole,
    overrides: RoleOverrides,
  ): Result<ResolvedModel, ModelError> {
    const resolved = resolveRole({
      role,
      overrides,
      table: { default: deps.settings().default, thinkingLevel: M1_THINKING_LEVEL },
      lookup: (provider, modelId) => models.getModel(provider, modelId),
    });
    if (!resolved.ok) return resolved;
    return ok({
      binding: resolved.value.binding,
      source: resolved.value.source,
      trace: resolved.value.trace,
      model: resolved.value.model,
      thinkingBudgetTokens: null,
      cachePolicy: basicCachePolicy(role, M1_CACHE_RETENTION),
    });
  }

  function stream(request: ModelCallRequest): AssistantMessageEventStream {
    return pipeline.start(callOf(request, true));
  }

  async function complete(request: ModelCallRequest): Promise<AssistantMessage> {
    // 콘텐츠를 소비자에게 흘려보내지 않으므로 호출 단위로 재시도한다. 요청 단계 재시도는 끄고 한 겹만 둔다(spec §4.5)
    const retry = deps.settings().retry;
    const policy: RetryPolicy = {
      enabled: retry.maxRetries > 0,
      maxRetries: retry.maxRetries,
      baseDelayMs: retry.baseDelayMs,
      maxAgentDelayMs: retry.maxDelayMs,
    };
    return await retryAssistantCall(
      () => pipeline.start(callOf(request, false)).result(),
      policy,
      request.signal,
    );
  }

  function streamFn(ctx: ModelCallContext): StreamFn {
    return (model, context, options) => {
      const retention = options?.cacheRetention ?? M1_CACHE_RETENTION;
      const signal = options?.signal ?? ctx.signal;
      const callCtx: ModelCallContext = { ...ctx, ...(signal === undefined ? {} : { signal }) };
      return pipeline.start({
        ctx: callCtx,
        provider: model.provider,
        modelId: model.id,
        thinkingLevel: options?.reasoning ?? "off",
        cachePolicy: basicCachePolicy(ctx.role, retention),
        context: { messages: [...context.messages] },
        ...(options?.maxTokens === undefined && options?.temperature === undefined
          ? {}
          : {
              options: {
                ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
                ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
              },
            }),
        ...(options?.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        providerRetries: true,
      });
    };
  }

  function list(filter?: ModelListFilter): readonly ModelInfo[] {
    const infos: ModelInfo[] = [];
    for (const model of models.getModels(filter?.provider)) {
      // M1의 available은 자격 증명 참조가 설정된 provider다. 환경 변수 같은 암묵 자격은 세지 않는다
      const available = refs.get(model.provider) !== null;
      if (filter?.available === true && !available) continue;
      if (filter?.reasoning !== undefined && model.reasoning !== filter.reasoning) continue;
      infos.push({
        ref: `${model.provider}/${model.id}`,
        name: model.name,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        reasoning: model.reasoning,
        input: model.input,
        cost: {
          input: model.cost.input,
          output: model.cost.output,
          cacheRead: model.cost.cacheRead,
          cacheWrite: model.cost.cacheWrite,
        },
        supportedThinkingLevels: getSupportedThinkingLevels(model),
        available,
      });
    }
    return infos;
  }

  return {
    resolve: (role, overrides = {}) => resolveWith(role, overrides),
    rebind(binding: ModelBinding): Result<ResolvedModel, ModelError> {
      const ref = formatModelRef({
        provider: binding.provider,
        modelId: binding.modelId,
        thinkingLevel: null,
      });
      const model = models.getModel(binding.provider, binding.modelId);
      if (model === undefined) {
        return err(modelError("model_not_found", `pinned model ${ref} is not in the catalog`, ref));
      }
      // 체크포인트 값은 역할 표도 clamp도 거치지 않고 그대로 쓴다(spec §4.2 3번)
      return ok({
        binding,
        source: "checkpoint",
        trace: [{ step: "checkpoint", ref }],
        model,
        thinkingBudgetTokens: null,
        cachePolicy: basicCachePolicy(binding.role, M1_CACHE_RETENTION),
      });
    },
    stream,
    complete,
    streamFn,
    list,
    addProvider() {
      // provider 등록 API는 M2(plan M-4)다. 그 전에는 등록 경로가 없다
      return err(
        modelError("invalid_provider", "provider registration is not available before M2"),
      );
    },
    registerProvider() {
      throw new Bug(
        "ModelService.registerProvider is not available before M2 (L1.models.plan M-4)",
      );
    },
    usage,
    tokens,
    classify: (message, contextWindow) => classifyMessage(message, contextWindow),
  };
}
