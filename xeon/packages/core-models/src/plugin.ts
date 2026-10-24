import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { Clock } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@xeon/contracts/extensions";
import {
  ModelServiceName,
  OsServiceName,
  SecretServiceName,
  type ModelService,
  type OsService,
  type SecretService,
} from "@xeon/contracts/services";
import {
  ExtHostPortKey,
  hostOf,
  type BuiltinExtensionModule,
  type ExtHost,
  type PortKey,
} from "@xeon/ext-host";
import type { PointInput, ProviderDispatcher } from "./request-points.ts";
import { createModelService, type ModelServiceDeps, type ModelsSettingsSource } from "./service.ts";
import { DEFAULT_MODELS_SETTINGS } from "./settings.ts";

// L1.models.plan §2 plugin.ts. 내장 확장(builtin)으로 xeon.models를 제공한다. 쓰는 서비스는 xeon.secrets, xeon.ext,
// xeon.os(시계)다. Cordis는 import하지 않고 ext-host의 hostOf 포트 API만 쓴다(DR-11, DR-14 예외 4).

const ModelServicePortKey: PortKey<ModelService> = { name: ModelServiceName };
const SecretServicePortKey: PortKey<SecretService> = { name: SecretServiceName };
const OsServicePortKey: PortKey<OsService> = { name: OsServiceName };

export const manifest: ExtensionManifest = defineManifest({
  schemaVersion: 1,
  name: "core-models",
  version: "0.1.0",
  displayName: "Model gateway",
  description: "xeon.models: pi-ai provider calls, role resolution, usage metering.",
  defaultEnabled: true,
  layer: "L1",
  kind: "plugin",
  entry: "./src/index.ts",
  points: [],
  usesDrive: false,
  trust: { level: "builtin" },
});

export interface ModelsExtensionOptions {
  /** 유효 설정 읽기. 경로가 미결이라(L1.models.spec §8.2) 조립 루트가 넘긴다. 없으면 기본값이다 */
  readonly settings?: ModelsSettingsSource;
  /** 없으면 xeon.os의 시계를 쓴다 */
  readonly clock?: Clock;
  /** 없으면 pi-ai 내장 provider 전체를 등록한 모음을 쓴다 */
  readonly buildModels?: ModelServiceDeps["buildModels"];
}

function dispatcherOf(ext: ExtHost): ProviderDispatcher {
  return {
    async beforeProviderRequest(input) {
      const outcome = await ext.dispatch(
        "before_provider_request",
        {
          provider: input.provider,
          modelId: input.modelId,
          role: input.role,
          payload: input.payload,
        },
        {
          threadId: input.threadId,
          dispatchKey: input.dispatchKey,
          initial: { payload: input.payload },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      );
      return outcome.value.payload;
    },
    async beforeProviderHeaders(input) {
      const outcome = await ext.dispatch(
        "before_provider_headers",
        {
          provider: input.provider,
          modelId: input.modelId,
          role: input.role,
          headers: input.headers,
        },
        {
          threadId: input.threadId,
          dispatchKey: input.dispatchKey,
          initial: { headers: input.headers },
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        },
      );
      // 삭제 표시(null)는 chain 규칙이 이미 뺐다. 남은 값만 문자열로 좁힌다
      const final: Record<string, string> = {};
      for (const [name, value] of Object.entries(outcome.value.headers)) {
        if (value !== null) final[name] = value;
      }
      return final;
    },
    async afterProviderResponse(input) {
      await ext.dispatch(
        "after_provider_response",
        {
          provider: input.provider,
          modelId: input.modelId,
          role: input.role,
          status: input.status,
          headers: input.headers,
        },
        tapOptions(input),
      );
    },
    async providerStreamEvent(input) {
      await ext.dispatch(
        "provider_stream_event",
        { provider: input.provider, api: input.api, model: input.model, data: input.data },
        tapOptions(input),
      );
    },
    async modelSelect(input) {
      await ext.dispatch(
        "model_select",
        { binding: input.binding, previous: input.previous, source: input.source },
        tapOptions(input),
      );
    },
    async thinkingLevelSelect(input) {
      // 지점 선언이 detached라 디스패치는 핸들러를 기다리지 않고 돌아온다
      await ext.dispatch(
        "thinking_level_select",
        { role: input.role, level: input.level, previousLevel: input.previousLevel },
        tapOptions(input),
      );
    },
  };
}

function tapOptions(input: PointInput): {
  readonly threadId: ThreadId;
  readonly dispatchKey: string;
  readonly signal?: AbortSignal;
} {
  return {
    threadId: input.threadId,
    dispatchKey: input.dispatchKey,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  };
}

export function createModelsExtension(
  options: ModelsExtensionOptions = {},
): BuiltinExtensionModule {
  const entry: ExtensionEntry = ({ manifest: own, scope }) => {
    scope(own.name, {}, (g) => {
      const host = hostOf(g);
      const secrets = host.port(SecretServicePortKey);
      const ext = host.port(ExtHostPortKey);
      const clock = options.clock ?? host.port(OsServicePortKey).time.clock;
      host.providePort(
        ModelServicePortKey,
        createModelService({
          buildModels: options.buildModels ?? ((credentials) => builtinModels({ credentials })),
          secrets,
          clock,
          settings: options.settings ?? (() => DEFAULT_MODELS_SETTINGS),
          dispatcher: dispatcherOf(ext),
          // 꺼진 그룹의 groupRouting 값은 쓰지 않는다(L1.models.spec §5)
          scopeEnabled: (scopeId) =>
            ext.scopes().some((info) => info.id === scopeId && info.status === "enabled"),
        }),
      );
    });
  };
  return { manifest, extension: entry };
}

/** 기본 설정으로 만든 내장 확장 엔트리. 조립 루트가 설정 경로를 넘기려면 createModelsExtension을 쓴다 */
export const extension: ExtensionEntry = createModelsExtension().extension;
