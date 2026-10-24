import {
  getSupportedThinkingLevels,
  retryAssistantCall,
  type CredentialStore,
  type MutableModels,
  type RetryPolicy,
} from "@earendil-works/pi-ai";
import { attempt, err, ok, type Clock, type Logger, type Result } from "@xeon/contracts";
import type { AssistantMessage } from "@xeon/contracts/conversation";
import {
  formatModelRef,
  type AssistantMessageEventStream,
  type ModelBinding,
  type ModelCallContext,
  type ModelCallRequest,
  type ModelError,
  type ModelInfo,
  type ModelListFilter,
  type ModelRole,
  type ModelService,
  type ResolvedModel,
  type RoleOverrides,
  type SecretService,
  type StreamFn,
} from "@xeon/contracts/services";
import { buildCachePolicy, withRetention } from "./cache-policy.ts";
import { classifyMessage } from "./classify.ts";
import { createHostedSearch } from "./hosted-search.ts";
import { createFailureLog } from "./failure-log.ts";
import { createPipeline, type CallSpec } from "./pipeline.ts";
import type { ProviderDispatcher } from "./request-points.ts";
import {
  createProviderRegistry,
  defaultApiStreams,
  type ApiStreamsLookup,
} from "./provider-registry.ts";
import { budgetOf, isModelAllowed, resolveRole, type RoutingTable } from "./role-table.ts";
import {
  createSecretResolver,
  secretBackedCredentialStore,
  type ProviderCredentialRefs,
  type SecretTarget,
} from "./secrets-bridge.ts";
import type { ModelsSettings, ProviderSetting } from "./settings.ts";
import { createTokenEstimator } from "./tokens.ts";
import { createUsageMeter } from "./usage.ts";

// L1.models.spec §3.3, plan M-1. pi-ai Models 위의 ModelService 구현이다. Cordis는 import하지 않는다.

/** 호출 시점의 유효 설정을 읽는 함수. 읽는 경로는 spec §8.2 마지막 행이 미결이라 조립 루트가 넘긴다 */
export type ModelsSettingsSource = () => ModelsSettings;

export interface ModelServiceDeps {
  /**
   * pi-ai 모델 모음을 만든다. 서비스가 만든 CredentialStore(비밀 참조 다리)를 받아야 하므로 팩토리로 받는다.
   * 운영은 builtinModels({ credentials }), 테스트는 createModels({ credentials })에 테이프 provider를 더한 것이다
   */
  readonly buildModels: (credentials: CredentialStore) => MutableModels;
  readonly secrets: SecretService;
  readonly clock: Clock;
  readonly settings: ModelsSettingsSource;
  /** config provider가 쓸 API 스트림 구현 조회. 기본은 pi-ai 내장 API */
  readonly apiStreams?: ApiStreamsLookup;
  /** 그룹 덮어쓰기를 쓸 수 있는 scope인지. 꺼진 scope의 값은 무시한다. 없으면 모두 켜짐 */
  readonly scopeEnabled?: (scopeId: string) => boolean;
  /** 없으면 before_provider_request를 발화하지 않는다 */
  readonly dispatcher?: ProviderDispatcher;
  readonly logger?: Logger;
}

function modelError(kind: ModelError["kind"], message: string, ref?: string): ModelError {
  return { kind, message, ...(ref === undefined ? {} : { ref }) };
}

function targetOfUrl(baseUrl: string): SecretTarget | null {
  const parsed = attempt(() => new URL(baseUrl));
  // 해석할 수 없는 주소는 비밀 사용 대상을 정할 수 없다. 호출자가 null을 받아 비밀 없는 호출로 처리한다
  if (!parsed.ok) return null;
  const url = parsed.value;
  return { host: url.hostname, port: url.port === "" ? null : Number(url.port) };
}

function callOf(
  request: ModelCallRequest,
  budgets: ModelsSettings["thinkingBudgets"],
  providerRetries: boolean,
): CallSpec {
  const { binding, cachePolicy } = request.resolved;
  return {
    ctx: request,
    provider: binding.provider,
    modelId: binding.modelId,
    thinkingLevel: binding.thinkingLevel,
    cachePolicy,
    context: request.context,
    ...(request.options === undefined ? {} : { options: request.options }),
    selectSource: request.resolved.source === "checkpoint" ? "restore" : "route",
    budgets,
    providerRetries,
  };
}

function tableOf(settings: ModelsSettings): RoutingTable {
  return {
    default: settings.default,
    routing: settings.routing,
    groupRouting: settings.groupRouting,
    thinkingLevel: settings.thinkingLevel,
    thinkingBudgets: settings.thinkingBudgets,
    allowed: settings.allowedModels,
    denied: settings.deniedModels,
  };
}

export function createModelService(deps: ModelServiceDeps): ModelService {
  const failures = createFailureLog();
  const usage = createUsageMeter(deps.logger);
  const tokens = createTokenEstimator();

  function providerSetting(providerId: string): ProviderSetting | undefined {
    return deps.settings().providers.find((entry) => entry.id === providerId);
  }

  const registry = createProviderRegistry({
    models: () => models,
    apiStreams: deps.apiStreams ?? defaultApiStreams,
  });

  // 설정의 참조가 먼저이고, 없으면 provider 등록부(config의 apiKey, runtime의 credential)의 참조를 쓴다
  function credentialRefOf(providerId: string): string | null {
    const setting = providerSetting(providerId);
    if (setting !== undefined) {
      if (!setting.enabled) return null;
      if (setting.apiKeyRef !== null) return setting.apiKeyRef;
    }
    return registry.credentialRef(providerId);
  }

  const refs: ProviderCredentialRefs = {
    get: credentialRefOf,
    ids: () => {
      const ids = new Set<string>();
      for (const entry of deps.settings().providers) {
        if (entry.enabled && entry.apiKeyRef !== null) ids.add(entry.id);
      }
      for (const id of registry.ids()) if (registry.credentialRef(id) !== null) ids.add(id);
      return [...ids];
    },
  };

  // 요청 목적지(호스트 일치 정책용). baseUrl 설정 덮어쓰기 → 등록부 덮어쓰기 → provider → 첫 모델 순으로 찾는다
  function targetOf(providerId: string): SecretTarget | null {
    const override = providerSetting(providerId)?.baseUrl ?? registry.overlay(providerId)?.baseUrl;
    const baseUrl =
      override ??
      models.getProvider(providerId)?.baseUrl ??
      models.getModels(providerId)[0]?.baseUrl ??
      null;
    return baseUrl === null ? null : targetOfUrl(baseUrl);
  }

  const bridgeOptions = {
    targetOf,
    onFailure: (failure: Parameters<typeof failures.record>[0]): void => {
      failures.record(failure);
    },
  };
  const credentials = secretBackedCredentialStore(refs, deps.secrets, bridgeOptions);
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
    overlay: (providerId) => registry.overlay(providerId),
    resolver: createSecretResolver(deps.secrets, { targetOf }),
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  });

  function resolveWith(
    role: ModelRole,
    overrides: RoleOverrides,
  ): Result<ResolvedModel, ModelError> {
    const settings = deps.settings();
    const resolved = resolveRole({
      role,
      overrides,
      table: tableOf(settings),
      lookup: (provider, modelId) => models.getModel(provider, modelId),
      ...(deps.scopeEnabled === undefined ? {} : { scopeEnabled: deps.scopeEnabled }),
    });
    if (!resolved.ok) return resolved;
    return ok({
      binding: resolved.value.binding,
      source: resolved.value.source,
      trace: resolved.value.trace,
      model: resolved.value.model,
      thinkingBudgetTokens: resolved.value.thinkingBudgetTokens,
      cachePolicy: buildCachePolicy(role, settings.cacheRetention, resolved.value.model),
    });
  }

  function stream(request: ModelCallRequest): AssistantMessageEventStream {
    return pipeline.start(callOf(request, deps.settings().thinkingBudgets, true));
  }

  async function complete(request: ModelCallRequest): Promise<AssistantMessage> {
    // 콘텐츠를 소비자에게 흘려보내지 않으므로 호출 단위로 재시도한다. 요청 단계 재시도는 끄고 한 겹만 둔다(spec §4.5)
    const settings = deps.settings();
    const retry = settings.retry;
    const policy: RetryPolicy = {
      enabled: retry.maxRetries > 0,
      maxRetries: retry.maxRetries,
      baseDelayMs: retry.baseDelayMs,
      maxAgentDelayMs: retry.maxDelayMs,
    };
    return await retryAssistantCall(
      () => pipeline.start(callOf(request, settings.thinkingBudgets, false)).result(),
      policy,
      request.signal,
    );
  }

  function streamFn(ctx: ModelCallContext): StreamFn {
    return (model, context, options) => {
      const settings = deps.settings();
      const retention = options?.cacheRetention ?? settings.cacheRetention;
      const signal = options?.signal ?? ctx.signal;
      const callCtx: ModelCallContext = { ...ctx, ...(signal === undefined ? {} : { signal }) };
      return pipeline.start({
        ctx: callCtx,
        provider: model.provider,
        modelId: model.id,
        thinkingLevel: options?.reasoning ?? "off",
        cachePolicy: withRetention(
          buildCachePolicy(ctx.role, settings.cacheRetention, model),
          ctx.role,
          retention,
        ),
        context: { messages: [...context.messages] },
        ...(options?.maxTokens === undefined && options?.temperature === undefined
          ? {}
          : {
              options: {
                ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
                ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
              },
            }),
        selectSource: "route",
        budgets: settings.thinkingBudgets,
        ...(options?.apiKey === undefined ? {} : { apiKey: options.apiKey }),
        providerRetries: true,
      });
    };
  }

  function list(filter?: ModelListFilter): readonly ModelInfo[] {
    const settings = deps.settings();
    const infos: ModelInfo[] = [];
    for (const model of models.getModels(filter?.provider)) {
      if (
        !isModelAllowed(
          { allowed: settings.allowedModels, denied: settings.deniedModels },
          model.provider,
          model.id,
        )
      ) {
        continue;
      }
      // available은 자격 증명 참조가 있는 provider나 등록부로 들어온 provider다. 환경 변수 같은 암묵 자격은 세지 않는다
      const available = credentialRefOf(model.provider) !== null || registry.has(model.provider);
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

  const hostedSearch = createHostedSearch({
    resolve: (model) => resolveWith("search", model === "auto" ? {} : { ref: model }),
    start: (spec) => pipeline.start(spec),
    budgets: () => deps.settings().thinkingBudgets,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  });

  return {
    resolve: (role, overrides = {}) => resolveWith(role, overrides),
    rebind(binding: ModelBinding): Result<ResolvedModel, ModelError> {
      const settings = deps.settings();
      const ref = formatModelRef({
        provider: binding.provider,
        modelId: binding.modelId,
        thinkingLevel: null,
      });
      const model = models.getModel(binding.provider, binding.modelId);
      if (model === undefined) {
        return err(modelError("model_not_found", `pinned model ${ref} is not in the catalog`, ref));
      }
      if (
        !isModelAllowed(
          { allowed: settings.allowedModels, denied: settings.deniedModels },
          binding.provider,
          binding.modelId,
        )
      ) {
        return err(modelError("model_denied", `pinned model ${ref} is not allowed`, ref));
      }
      // 체크포인트 값은 역할 표도 clamp도 거치지 않고 그대로 쓴다(spec §4.2 3번)
      return ok({
        binding,
        source: "checkpoint",
        trace: [{ step: "checkpoint", ref }],
        model,
        thinkingBudgetTokens: budgetOf(tableOf(settings), model, binding.thinkingLevel),
        cachePolicy: buildCachePolicy(binding.role, settings.cacheRetention, model),
      });
    },
    stream,
    complete,
    streamFn,
    list,
    addProvider: (owner, name, def) => registry.addProvider(owner, name, def),
    registerProvider: (owner, name, config) => registry.registerProvider(owner, name, config),
    usage,
    tokens,
    classify: (message, contextWindow) => classifyMessage(message, contextWindow),
    hostedSearch,
  };
}
