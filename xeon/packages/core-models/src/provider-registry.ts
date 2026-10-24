import {
  createProvider,
  type Api,
  type Model,
  type MutableModels,
  type ProviderStreams,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { googleGenerativeAIApi } from "@earendil-works/pi-ai/api/google-generative-ai.lazy";
import { mistralConversationsApi } from "@earendil-works/pi-ai/api/mistral-conversations.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { err, ok, parse, type Result } from "@xeon/contracts";
import type { ScopeId, Unsubscribe } from "@xeon/contracts/extensions";
import {
  ProviderConfigDefSchema,
  type ModelError,
  type ModelErrorKind,
  type ProviderConfigDef,
  type ProviderDef,
  type ProviderModelDef,
  type SecretRefString,
} from "@xeon/contracts/services";

// L1.models.spec §3.7, L1.models.plan M-4. provider 등록부다. addProvider(코드로 만든 runtime provider와 config)와
// 포트 경로 registerProvider(JSON config만)가 같은 등록부를 쓴다.

/** `model.api` → 스트림 구현. config provider가 쓸 수 있는 API 목록이다 */
export type ApiStreamsLookup = (api: Api) => ProviderStreams | undefined;

const BUILTIN_STREAMS: ReadonlyMap<string, () => ProviderStreams> = new Map([
  ["anthropic-messages", anthropicMessagesApi],
  ["openai-completions", openAICompletionsApi],
  ["openai-responses", openAIResponsesApi],
  ["google-generative-ai", googleGenerativeAIApi],
  ["mistral-conversations", mistralConversationsApi],
]);

/** 운영 기본. pi-ai 내장 API 중 JSON config로 지정할 수 있는 것들 */
export const defaultApiStreams: ApiStreamsLookup = (api) => BUILTIN_STREAMS.get(api)?.();

/** ModelsPort.registerProvider가 계약상 던지는 오류. ModelError 값을 그대로 담는다(spec §3.7) */
export class ModelRegistrationError extends Error implements ModelError {
  override readonly name: string = "ModelRegistrationError";
  readonly kind: ModelErrorKind;
  readonly ref?: string;

  constructor(error: ModelError) {
    super(error.message);
    this.kind = error.kind;
    if (error.ref !== undefined) this.ref = error.ref;
  }
}

/** 요청 때 provider에 덧붙는 설정. 헤더 값에는 `secret://` 참조가 올 수 있다 */
export interface ProviderOverlay {
  readonly baseUrl: string | null;
  readonly headers: Readonly<Record<string, string>>;
}

export interface ProviderRegistry {
  addProvider(owner: ScopeId, name: string, def: ProviderDef): Result<Unsubscribe, ModelError>;
  /** 포트 경로. config는 JSON이다. 실패하면 ModelRegistrationError를 던진다 */
  registerProvider(owner: ScopeId, name: string, config: unknown): Unsubscribe;
  /** 등록부가 아는 provider의 자격 증명 참조. 없으면 null */
  credentialRef(providerId: string): SecretRefString | null;
  /** 등록부로 들어온 provider id 전체 */
  ids(): readonly string[];
  has(providerId: string): boolean;
  overlay(providerId: string): ProviderOverlay | undefined;
}

export interface ProviderRegistryDeps {
  readonly models: () => MutableModels;
  readonly apiStreams: ApiStreamsLookup;
}

const PROVIDER_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;

interface Entry {
  readonly owner: ScopeId;
  readonly credential: SecretRefString | null;
  readonly overlay: ProviderOverlay | undefined;
  /** 내장 provider에 기본값만 덮어쓴 항목이면 참. 해제할 때 provider를 지우지 않는다 */
  readonly overlayOnly: boolean;
}

function registrationError(kind: ModelErrorKind, message: string, ref?: string): ModelError {
  return { kind, message, ...(ref === undefined ? {} : { ref }) };
}

function toModel(
  providerId: string,
  baseUrl: string,
  fallbackApi: Api | undefined,
  def: ProviderModelDef,
): Result<Model<Api>, ModelError> {
  const api = def.api ?? fallbackApi;
  if (api === undefined) {
    return err(
      registrationError(
        "invalid_provider",
        `model ${def.id} of provider ${providerId} has no api`,
        `${providerId}/${def.id}`,
      ),
    );
  }
  return ok({
    id: def.id,
    name: def.name ?? def.id,
    api,
    provider: providerId,
    baseUrl,
    input: [...def.input],
    cost: def.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    reasoning: def.reasoning,
    contextWindow: def.contextWindow,
    maxTokens: def.maxTokens,
  });
}

export function createProviderRegistry(deps: ProviderRegistryDeps): ProviderRegistry {
  const entries = new Map<string, Entry>();

  function conflict(name: string): ModelError {
    const owner = entries.get(name)?.owner;
    return registrationError(
      "provider_conflict",
      owner === undefined
        ? `provider ${name} is already registered`
        : `provider ${name} is already registered by ${owner}`,
    );
  }

  function release(name: string, entry: Entry): Unsubscribe {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // 같은 이름을 다른 소유자가 다시 등록했으면 건드리지 않는다
      if (entries.get(name) !== entry) return;
      entries.delete(name);
      if (!entry.overlayOnly) deps.models().deleteProvider(name);
    };
  }

  function addConfig(
    owner: ScopeId,
    name: string,
    def: ProviderConfigDef,
  ): Result<Unsubscribe, ModelError> {
    const models = deps.models();
    const exists = models.getProvider(name) !== undefined;
    const hasModels = def.models !== undefined && def.models.length > 0;
    // 내장 provider의 기본값만 바꾸는 등록(baseUrl, headers, apiKey)은 models 없이 허용한다(spec §3.7)
    if (exists && hasModels) return err(conflict(name));
    const overlay: ProviderOverlay = {
      baseUrl: def.baseUrl ?? null,
      headers: def.headers ?? {},
    };
    const credential = def.apiKey ?? null;
    if (exists) {
      const entry: Entry = { owner, credential, overlay, overlayOnly: true };
      entries.set(name, entry);
      return ok(release(name, entry));
    }

    const baseUrl = def.baseUrl;
    if (baseUrl === undefined || !hasModels) {
      return err(
        registrationError(
          "invalid_provider",
          `provider ${name} needs baseUrl and models (it is not a built-in provider)`,
        ),
      );
    }
    const built: Model<Api>[] = [];
    for (const modelDef of def.models ?? []) {
      const model = toModel(name, baseUrl, def.api, modelDef);
      if (!model.ok) return model;
      built.push(model.value);
    }
    const streams: Partial<Record<Api, ProviderStreams>> = {};
    for (const model of built) {
      if (streams[model.api] !== undefined) continue;
      const found = deps.apiStreams(model.api);
      if (found === undefined) {
        return err(
          registrationError(
            "invalid_provider",
            `provider ${name} uses api ${model.api}, which is not supported for JSON config`,
            `${name}/${model.id}`,
          ),
        );
      }
      streams[model.api] = found;
    }
    models.setProvider(
      createProvider({
        id: name,
        name: def.name ?? name,
        baseUrl,
        auth: {
          apiKey: {
            name,
            // 키 없는 로컬 서버도 설정된 provider다. 키는 CredentialStore가 참조로 풀어 넘긴다
            resolve: ({ credential: stored }) =>
              Promise.resolve({
                auth: stored?.key === undefined ? {} : { apiKey: stored.key },
              }),
          },
        },
        models: built,
        api: streams,
      }),
    );
    const entry: Entry = {
      owner,
      credential,
      overlay: { baseUrl: null, headers: overlay.headers },
      overlayOnly: false,
    };
    entries.set(name, entry);
    return ok(release(name, entry));
  }

  function addRuntime(
    owner: ScopeId,
    name: string,
    def: Extract<ProviderDef, { kind: "runtime" }>,
  ): Result<Unsubscribe, ModelError> {
    if (def.provider.id !== name) {
      return err(
        registrationError(
          "invalid_provider",
          `provider id ${def.provider.id} does not match the registered name ${name}`,
        ),
      );
    }
    if (deps.models().getProvider(name) !== undefined) return err(conflict(name));
    deps.models().setProvider(def.provider);
    const entry: Entry = {
      owner,
      credential: def.credential ?? null,
      overlay: undefined,
      overlayOnly: false,
    };
    entries.set(name, entry);
    return ok(release(name, entry));
  }

  function addProvider(
    owner: ScopeId,
    name: string,
    def: ProviderDef,
  ): Result<Unsubscribe, ModelError> {
    if (!PROVIDER_ID.test(name)) {
      return err(registrationError("invalid_provider", `provider name is malformed: ${name}`));
    }
    // 같은 이름을 두 번째로 등록하면 소유자가 같아도 먼저 해제해야 한다
    if (entries.has(name)) return err(conflict(name));
    return def.kind === "runtime" ? addRuntime(owner, name, def) : addConfig(owner, name, def);
  }

  return {
    addProvider,
    registerProvider(owner, name, config) {
      const parsed = parse(ProviderConfigDefSchema, config);
      if (!parsed.ok) {
        const issue = parsed.error.issues[0];
        const where = issue === undefined ? "" : ` (${issue.path} ${issue.message})`;
        throw new ModelRegistrationError(
          registrationError("invalid_provider", `provider config for ${name} is invalid${where}`),
        );
      }
      const added = addProvider(owner, name, parsed.value);
      if (!added.ok) throw new ModelRegistrationError(added.error);
      return added.value;
    },
    credentialRef: (providerId) => entries.get(providerId)?.credential ?? null,
    ids: () => [...entries.keys()],
    has: (providerId) => entries.has(providerId),
    overlay: (providerId) => entries.get(providerId)?.overlay,
  };
}
