import { AssistantMessageEventStream as PiAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { Clock, Scheduler } from "@xeon/contracts";
import type { AssistantMessage, AssistantMessageEvent } from "@xeon/contracts/conversation";
import type { AssistantMessageEventStream } from "@xeon/contracts/services";
import type { AccountDef, AccountPool, RateLimitPolicy } from "./accounts.ts";
import { classifyMessage } from "./classify.ts";
import type { CredentialFailure, SecretResolver } from "./secrets-bridge.ts";

// L1.models.spec §4.8 (M3). 호출 하나를 계정 풀 위에서 돌린다. 요청마다 계정을 고르고, 해석한 키를 `apiKey`로 넣어 보내며,
// 콘텐츠를 내기 전에 rate_limited로 끝나면 그 계정을 쉬게 하고 정책(onLimit)대로 다른 계정으로 바꾸거나 기다리거나 실패한다.
// quota_exhausted는 그 계정을 빼고 다음 계정으로 간다. 이미 콘텐츠가 나간 호출은 다시 보내지 않는다.

/** 회전이 호출 설명에서 읽는 부분. 파이프라인의 CallSpec이 만족한다(순환 import를 피해 모양만 적는다) */
export interface RotationCall {
  readonly provider: string;
  readonly modelId: string;
  readonly ctx: { readonly signal?: AbortSignal | undefined };
  readonly apiKey?: string | undefined;
  readonly providerRetries: boolean;
}

export interface RotationDeps<S extends RotationCall = RotationCall> {
  readonly pool: AccountPool;
  readonly clock: Clock;
  /** 없으면 기다리지 못하고 기다림이 필요한 자리에서 실패한다 */
  readonly scheduler: Scheduler | null;
  readonly resolver: SecretResolver;
  /** 호출 시점의 계정과 정책. 설정을 바꾸면 다음 호출부터 적용된다 */
  readonly accounts: (provider: string) => readonly AccountDef[];
  readonly policy: (provider: string) => RateLimitPolicy;
  /** 계정 하나로 보내는 한 번의 요청 */
  readonly startOnce: (spec: S) => AssistantMessageEventStream;
  /** 요청을 보내지 못할 때의 오류 종결 스트림 */
  readonly failed: (
    spec: S,
    kind: "secret_unresolved",
    text: string,
  ) => AssistantMessageEventStream;
  readonly onCredentialFailure: (failure: CredentialFailure) => void;
}

export interface Rotation<S extends RotationCall = RotationCall> {
  /** 이 provider를 회전으로 돌리는가(켜져 있고 계정이 있다) */
  active(provider: string): boolean;
  run(spec: S): AssistantMessageEventStream;
}

const RETRY_AFTER = /retry[- ]after\D{0,6}(\d+(?:\.\d+)?)\s*(ms|s)?/i;

/** 오류 문구에 재시도 시각이 있으면 ms로 읽는다. 없으면 null */
export function retryAfterMsOf(text: string): number | null {
  const match = RETRY_AFTER.exec(text);
  const amount = match?.[1];
  if (amount === undefined) return null;
  const value = Number(amount);
  return match?.[2]?.toLowerCase() === "ms" ? Math.round(value) : Math.round(value * 1000);
}

/** ms를 기다린다. 기다림을 마쳤으면 true, signal로 끊겼으면 false */
function sleep(
  scheduler: Scheduler,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted === true) {
      resolve(false);
      return;
    }
    const onAbort = (): void => {
      scheduler.clearTimeout(handle);
      resolve(false);
    };
    const handle = scheduler.setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function emptyUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

export function createRotation<S extends RotationCall>(deps: RotationDeps<S>): Rotation<S> {
  function terminalMessage(
    spec: S,
    stopReason: "error" | "aborted",
    text: string,
  ): AssistantMessage {
    return {
      role: "assistant",
      content: [],
      api: "unknown",
      provider: spec.provider,
      model: spec.modelId,
      usage: emptyUsage(),
      stopReason,
      ...(stopReason === "error" ? { errorMessage: text } : {}),
      timestamp: deps.clock.now(),
    };
  }

  /** 한 번의 요청을 읽는다. 콘텐츠 전에 한도 오류로 끝나면 held에 사건을 모아 두고 종결 메시지를 돌려준다 */
  async function attemptOnce(
    spec: S,
    account: AccountDef,
    apiKey: string,
    out: PiAssistantMessageEventStream,
  ): Promise<{
    readonly settled: AssistantMessage;
    readonly held: readonly AssistantMessageEvent[] | null;
  }> {
    deps.pool.markRequest(account, deps.clock.now());
    const stream = deps.startOnce({ ...spec, apiKey, providerRetries: false });
    const held: AssistantMessageEvent[] = [];
    let forwarding = false;
    for await (const event of stream) {
      if (event.type === "error" && !forwarding) {
        const kind = classifyMessage(event.error);
        if (kind === "rate_limited" || kind === "quota_exhausted") {
          return { settled: event.error, held: [...held, event] };
        }
      }
      if (!forwarding && event.type === "start") {
        held.push(event);
        continue;
      }
      if (!forwarding) {
        forwarding = true;
        for (const early of held) out.push(early);
        held.length = 0;
      }
      out.push(event);
      if (event.type === "done") return { settled: event.message, held: null };
      if (event.type === "error") return { settled: event.error, held: null };
    }
    return { settled: await stream.result(), held: null };
  }

  async function drive(spec: S, out: PiAssistantMessageEventStream): Promise<void> {
    const provider = spec.provider;
    const signal = spec.ctx.signal;
    const accounts = deps.accounts(provider);
    const policy = deps.policy(provider);
    const exclude = new Set<string>();
    let lastLimited: readonly AssistantMessageEvent[] | null = null;

    const giveUp = (text: string): void => {
      if (lastLimited !== null) {
        for (const event of lastLimited) out.push(event);
        const last = lastLimited.at(-1);
        if (last?.type === "error") out.end(last.error);
        return;
      }
      const message = terminalMessage(spec, "error", text);
      out.push({ type: "error", reason: "error", error: message });
      out.end(message);
    };

    // 계정 수와 기다림 횟수가 합쳐도 이 값을 넘지 않는다: 계정마다 한도 오류 한 번과 기다림 한 번까지
    const maxRounds = accounts.length * 2 + 1;

    async function step(round: number): Promise<void> {
      if (round >= maxRounds)
        return giveUp(`429 rate limit: accounts for ${provider} are exhausted`);
      if (signal?.aborted === true) {
        const aborted = terminalMessage(spec, "aborted", "");
        out.push({ type: "error", reason: "aborted", error: aborted });
        out.end(aborted);
        return;
      }
      const picked = deps.pool.pick(accounts, provider, deps.clock.now(), exclude);
      if (picked.kind === "none")
        return giveUp(`429 rate limit: no usable account for ${provider}`);
      if (picked.kind === "wait") {
        // 간격 대기는 늘 허용하고, 한도 대기는 onLimit이 wait일 때만 허용한다. 상한을 넘으면 기다리지 않는다
        const allowed = picked.cause === "interval" || policy.onLimit === "wait";
        if (!allowed || picked.waitMs > policy.maxWaitMs || deps.scheduler === null) {
          return giveUp(`429 rate limit: accounts for ${provider} are cooling down`);
        }
        // 끊겼으면 다음 단계 첫머리가 중단으로 끝낸다
        await sleep(deps.scheduler, picked.waitMs, signal);
        return step(round + 1);
      }
      const { account } = picked;
      const key = await deps.resolver.resolve(
        account.credential,
        provider,
        `model.provider:${provider}`,
      );
      if (!key.ok) {
        deps.onCredentialFailure(key.error);
        const failure = deps.failed(
          spec,
          "secret_unresolved",
          `${key.error.kind}: ${key.error.reason}`,
        );
        for await (const event of failure) out.push(event);
        out.end(await failure.result());
        return;
      }
      const result = await attemptOnce(spec, account, key.value, out);
      if (result.held === null) {
        out.end(result.settled);
        return;
      }
      lastLimited = result.held;
      if (classifyMessage(result.settled) === "quota_exhausted") {
        deps.pool.markExhausted(account, deps.clock.now(), null);
        exclude.add(account.accountId);
        return step(round + 1);
      }
      deps.pool.markRateLimited(
        account,
        deps.clock.now(),
        retryAfterMsOf(result.settled.errorMessage ?? ""),
      );
      if (policy.onLimit === "fail") return giveUp("");
      return step(round + 1);
    }

    await step(0);
  }

  return {
    active(provider) {
      return deps.accounts(provider).length > 0;
    },
    run(spec) {
      const out = new PiAssistantMessageEventStream();
      let started = false;
      const start = (): void => {
        if (started) return;
        started = true;
        drive(spec, out).catch((caught: unknown) => {
          const message = terminalMessage(
            spec,
            "error",
            caught instanceof Error ? caught.message : "rotation failed",
          );
          out.push({ type: "error", reason: "error", error: message });
          out.end(message);
        });
      };
      return {
        [Symbol.asyncIterator]() {
          start();
          return out[Symbol.asyncIterator]();
        },
        result() {
          start();
          return out.result();
        },
      };
    },
  };
}
