import { createModels } from "@earendil-works/pi-ai";
import { Bug, type Logger, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  Context,
  ModelCallContext,
  ModelCallRequest,
  ModelRole,
  ModelService,
  ResolvedModel,
} from "@xeon/contracts/services";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import {
  createModelService,
  DEFAULT_MODELS_SETTINGS,
  type ModelsSettings,
  type ProviderDispatcher,
} from "../../src/index.ts";
import {
  memorySecrets,
  tapePlayer,
  tapeProvider,
  type MemorySecrets,
  type ModelTape,
  type TapePlayer,
  type TapeProviderHandle,
  type TapeProviderOptions,
} from "../../src/testing/index.ts";
import { manualClock, type ManualClock } from "./clock.ts";

/** 시험이 "이 값이 어디에도 새지 않는다"를 찾는 가짜 키 */
export const FAKE_KEY = "sk-fake-not-a-real-key-0123456789abcdef";

export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Bug(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

export interface HarnessOptions {
  readonly tape: ModelTape;
  readonly settings?: Partial<ModelsSettings>;
  readonly dispatcher?: ProviderDispatcher;
  readonly logger?: Logger;
  readonly provider?: TapeProviderOptions;
  readonly scopeEnabled?: (scopeId: string) => boolean;
  /** 비밀 저장소에 넣을 값. 기본은 tape-key 하나 */
  readonly secretValues?: Readonly<Record<string, string>>;
}

export interface Harness {
  readonly clock: ManualClock;
  readonly secrets: MemorySecrets;
  readonly player: TapePlayer;
  readonly fake: TapeProviderHandle;
  readonly service: ModelService;
  readonly threadId: ThreadId;
  /** 설정 스냅샷을 바꾼다. 서비스는 호출 시점마다 새로 읽는다 */
  setSettings(patch: Partial<ModelsSettings>): void;
  ctx(role?: ModelRole, extra?: Partial<ModelCallContext>): ModelCallContext;
  resolve(role?: ModelRole): ResolvedModel;
  request(text: string, role?: ModelRole, extra?: Partial<ModelCallContext>): ModelCallRequest;
  context(text: string): Context;
}

export function createHarness(options: HarnessOptions): Harness {
  const clock = manualClock();
  const secrets = memorySecrets(options.secretValues ?? { "tape-key": FAKE_KEY });
  const player = tapePlayer(options.tape, { clock });
  const fake = tapeProvider(player, options.provider);
  const threadId = fixedIdFactory().next("thr");
  let settings: ModelsSettings = {
    ...DEFAULT_MODELS_SETTINGS,
    default: `${fake.provider.id}/${fake.model.id}`,
    providers: [
      { id: fake.provider.id, enabled: true, apiKeyRef: "secret://tape-key", baseUrl: null },
    ],
    retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100 },
    ...options.settings,
  };
  const service = createModelService({
    buildModels: (credentials) => {
      const models = createModels({ credentials });
      models.setProvider(fake.provider);
      return models;
    },
    secrets: secrets.service,
    clock,
    settings: () => settings,
    ...(options.dispatcher === undefined ? {} : { dispatcher: options.dispatcher }),
    ...(options.scopeEnabled === undefined ? {} : { scopeEnabled: options.scopeEnabled }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });

  function ctx(role: ModelRole = "main", extra: Partial<ModelCallContext> = {}): ModelCallContext {
    return { threadId, turnId: null, stepId: null, role, ...extra };
  }
  function resolve(role: ModelRole = "main"): ResolvedModel {
    return unwrap(service.resolve(role));
  }
  function context(text: string): Context {
    return { messages: [{ role: "user", content: text, timestamp: clock.now() }] };
  }

  return {
    clock,
    secrets,
    player,
    fake,
    service,
    threadId,
    setSettings(patch) {
      settings = { ...settings, ...patch };
    },
    ctx,
    resolve,
    context,
    request(text, role = "main", extra = {}) {
      return { ...ctx(role, extra), resolved: resolve(role), context: context(text) };
    },
  };
}
