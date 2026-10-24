import {
  calculateCost,
  createModels,
  createProvider,
  lazyStream,
  type AssistantMessageEvent,
  type CredentialStore,
  type Model,
  type MutableModels,
  type Provider,
  type SimpleStreamOptions,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { ModelRole } from "@xeon/contracts/services";
import { TapeMismatchError, type TapePlayer } from "./tape.ts";

// 테이프 재생기를 pi-ai Provider로 감싼다. core-models의 ModelService, 다른 L1·L2 패키지 테스트가 실제 모델 대신
// 이 provider를 `createModels({ credentials }).setProvider(...)`에 더해 쓴다(eng.testing.guide TS-04, plan §2).
// pi-ai provider와 같은 길(auth 해석 → onPayload → 스트림)을 지나므로 키 해석과 지점 발화도 함께 시험된다.

export interface TapeModelDef {
  readonly id: string;
  /** 모델 단가(100만 토큰당). 기본은 입력 1, 출력 2, 캐시 읽기 0.1, 캐시 쓰기 1 */
  readonly cost?: Model<string>["cost"];
  readonly reasoning?: boolean;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

export interface TapeProviderOptions {
  /** provider id. 기본 "tape" */
  readonly id?: string;
  readonly api?: string;
  readonly baseUrl?: string;
  readonly models?: readonly TapeModelDef[];
  /**
   * 요청의 역할. pi-ai provider는 역할을 받지 못하므로 모델 id로 정한다. 기본은 모든 모델이 "main"이다
   * (역할별 대기열이 필요하면 역할마다 모델을 두고 이 함수로 고른다)
   */
  readonly roleOf?: (model: Model<string>) => ModelRole;
  /**
   * 요청 하나에서 onPayload를 부르는 횟수. 기본 1. pi-ai가 재시도하면 같은 요청에 onPayload가 다시 불리는 것을
   * 흉내 낼 때 2 이상으로 둔다(L1.models.spec §4.3 5번)
   */
  readonly payloadAttempts?: number;
  /** 참이면 키가 없는 요청을 "Provider is not configured"로 거부한다. 기본 거짓(키 없는 로컬 서버처럼) */
  readonly requireKey?: boolean;
}

/** provider가 받은 요청 하나의 기록. apiKey는 시험이 "해석된 키가 요청까지 갔는가"를 보는 용도다 */
export interface TapeProviderCall {
  readonly modelId: string;
  readonly role: ModelRole;
  readonly apiKey: string | undefined;
  readonly sessionId: string | undefined;
  readonly reasoning: SimpleStreamOptions["reasoning"];
  /** pi-ai가 받은 레벨별 토큰 예산 */
  readonly thinkingBudgets: SimpleStreamOptions["thinkingBudgets"];
  /** 요청 헤더 옵션(secret 참조를 푼 뒤의 값이 아니라 pi-ai로 넘어온 옵션 그대로) */
  readonly headers: SimpleStreamOptions["headers"];
  /** onPayload가 돌려준 최종 페이로드 */
  readonly payload: unknown;
}

export interface TapeProviderHandle {
  readonly provider: Provider;
  /** 첫 모델 */
  readonly model: Model<string>;
  readonly models: readonly Model<string>[];
  calls(): readonly TapeProviderCall[];
  /** 재생기가 던진 TapeMismatchError. pi-ai가 오류 이벤트로 바꾸므로 따로 모은다 */
  mismatches(): readonly TapeMismatchError[];
}

/** onPayload를 attempts번 순서대로 부르고 마지막 결과를 돌려준다. 결과가 undefined면 페이로드를 바꾸지 않은 것이다 */
async function firePayload(
  streamOptions: SimpleStreamOptions | undefined,
  model: Model<string>,
  draft: unknown,
  attempts: number,
): Promise<unknown> {
  const result = await streamOptions?.onPayload?.(draft, model);
  return attempts <= 1 ? result : firePayload(streamOptions, model, draft, attempts - 1);
}

function withCost(model: Model<string>, event: AssistantMessageEvent): AssistantMessageEvent {
  if (event.type === "done") {
    const message = { ...event.message, usage: { ...event.message.usage } };
    message.usage.cost = calculateCost(model, message.usage);
    return { ...event, message };
  }
  if (event.type === "error") {
    const message = { ...event.error, usage: { ...event.error.usage } };
    message.usage.cost = calculateCost(model, message.usage);
    return { ...event, error: message };
  }
  return event;
}

const DEFAULT_COST: Model<string>["cost"] = { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 };

export function tapeProvider(
  player: TapePlayer,
  options: TapeProviderOptions = {},
): TapeProviderHandle {
  const id = options.id ?? "tape";
  const api = options.api ?? "tape-messages";
  const baseUrl = options.baseUrl ?? "http://127.0.0.1:9/tape";
  const defs: readonly TapeModelDef[] = options.models ?? [{ id: "tape-1" }];
  const models: Model<string>[] = defs.map((def) => ({
    id: def.id,
    name: def.id,
    api,
    provider: id,
    baseUrl,
    input: ["text"],
    cost: def.cost ?? DEFAULT_COST,
    reasoning: def.reasoning ?? false,
    contextWindow: def.contextWindow ?? 200_000,
    maxTokens: def.maxTokens ?? 8192,
  }));
  const first = models[0];
  if (first === undefined) throw new TapeMismatchError("tapeProvider needs at least one model");

  const calls: TapeProviderCall[] = [];
  const mismatches: TapeMismatchError[] = [];
  const roleOf = options.roleOf ?? (() => "main");

  async function* run(
    model: Model<string>,
    context: TranscriptContext,
    streamOptions: SimpleStreamOptions | undefined,
  ): AsyncGenerator<AssistantMessageEvent> {
    const role = roleOf(model);
    // 실제 어댑터가 보낼 요청 본문을 흉내 낸다. before_provider_request 핸들러가 이 값을 본다
    const draft: unknown = { model: model.id, messages: structuredClone(context.messages) };
    const replaced = await firePayload(streamOptions, model, draft, options.payloadAttempts ?? 1);
    calls.push({
      modelId: model.id,
      role,
      apiKey: streamOptions?.apiKey,
      sessionId: streamOptions?.sessionId,
      reasoning: streamOptions?.reasoning,
      thinkingBudgets: streamOptions?.thinkingBudgets,
      headers: streamOptions?.headers,
      payload: replaced ?? draft,
    });
    let events: AsyncIterable<AssistantMessageEvent>;
    try {
      events = player.stream({
        role,
        context: { messages: context.messages },
        ...(streamOptions?.signal === undefined ? {} : { signal: streamOptions.signal }),
        target: { api: model.api, provider: model.provider, modelId: model.id },
      });
    } catch (error) {
      if (error instanceof TapeMismatchError) mismatches.push(error);
      throw error;
    }
    for await (const event of events) yield withCost(model, event);
  }

  const streams = {
    stream: (
      model: Model<string>,
      context: TranscriptContext,
      streamOptions?: SimpleStreamOptions,
    ) => lazyStream(model, () => Promise.resolve(run(model, context, streamOptions))),
    streamSimple: (
      model: Model<string>,
      context: TranscriptContext,
      streamOptions?: SimpleStreamOptions,
    ) => lazyStream(model, () => Promise.resolve(run(model, context, streamOptions))),
  };

  const provider = createProvider({
    id,
    name: id,
    baseUrl,
    auth: {
      apiKey: {
        name: "tape",
        resolve: ({ credential }) =>
          Promise.resolve(
            credential?.key === undefined && options.requireKey === true
              ? undefined
              : { auth: credential?.key === undefined ? {} : { apiKey: credential.key } },
          ),
      },
    },
    models,
    api: streams,
  });

  return {
    provider,
    model: first,
    models,
    calls: () => [...calls],
    mismatches: () => [...mismatches],
  };
}

/**
 * 조립 루트에 넘기는 `buildModels`. 서비스가 만든 CredentialStore로 pi-ai 모델 모음을 만들고 테이프 provider를 더한다.
 * 운영의 `builtinModels({ credentials })` 자리에 들어가며, 내장 provider는 싣지 않는다
 */
export function tapeBuildModels(
  handle: TapeProviderHandle,
): (credentials: CredentialStore) => MutableModels {
  return (credentials) => {
    const models = createModels({ credentials });
    models.setProvider(handle.provider);
    return models;
  };
}
