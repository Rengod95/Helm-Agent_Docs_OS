import { detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { ModelEntry, UsageContext, UsageGauge } from "@fresnel/contracts/wire";
import { useEffect, useState } from "react";
import { useLinkPhase, useThread } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { usageFractionOf } from "./pages/providers/providers-model.ts";

// 입력창의 모델 단추·사용량 링과 상태 막대의 모델·토큰 칸이 같이 쓰는 읽기. 모두 요청 결과라 거울에 넣지 않는다(FS-03).
// 대화의 모델은 거울의 대화 요약(`ThreadSummary.model`, `thread.setModel`)이고 정하지 않았으면 기본 모델(`l1.models.default`)이다.
// 사용량은 `usage.get`의 `context`(마지막 호출의 문맥 토큰과 그 모델의 문맥 창)가 원천이다.

/** `provider/model` 참조에서 모델 이름만. 시안의 `sonnet-5-5` 자리다. 빗금이 없으면 그대로다 */
export function modelLabelOf(ref: string): string {
  const slash = ref.indexOf("/");
  return slash < 0 ? ref : ref.slice(slash + 1);
}

/** 이 대화의 사용량. `tokens`는 쓴 토큰이고 `percent`는 한도(문맥 창)를 알 때만 값이 있다(0~100) */
export interface SessionUsage {
  readonly tokens: number;
  readonly percent: number | null;
  /** 한도(문맥 창 토큰 수). `usage.get`의 `context`가 있을 때만 안다 */
  readonly limit: number | null;
}

/**
 * `usage.get { threadId }` 결과에서 이 대화의 사용량을 읽는다. 호스트가 `context`(가장 나중에 끝난 호출이 문맥 창에 찬 토큰과 그 모델의 문맥 창)를
 * 주면 그것이 원천이다. 없으면(끝난 호출이 없거나 문맥 창을 모름) `session` 창의 토큰 게이지 합으로 돌아가고 한도는 게이지에 있을 때만 안다.
 * 둘 다 없으면 null이다. 한도를 모르면 비율을 지어내지 않는다.
 */
export function sessionUsageOf(result: {
  readonly gauges: readonly UsageGauge[];
  readonly context?: UsageContext;
}): SessionUsage | null {
  const { context } = result;
  if (context !== undefined) {
    return {
      tokens: context.used,
      percent: Math.min(100, (context.used / context.limit) * 100),
      limit: context.limit,
    };
  }
  const own = result.gauges.filter((g) => g.window === "session" && g.unit === "tokens");
  if (own.length === 0) return null;
  const tokens = own.reduce((sum, g) => sum + g.used, 0);
  const fractions = own.flatMap((g) => {
    const f = usageFractionOf(g);
    return f === null ? [] : [f];
  });
  return { tokens, percent: fractions.length === 0 ? null : Math.max(...fractions), limit: null };
}

/** 입력창 모델 select의 값. 대화가 정한 모델을 거두고 기본 모델로 돌아가는 줄이다 */
export const DEFAULT_MODEL_CHOICE = "default";

/** 100만 토큰당 USD 가격. 카탈로그가 가격을 모르면 `"unknown"`, 카탈로그 밖의 줄이면 null이다 */
type ModelPrice = { readonly input: number; readonly output: number } | "unknown" | null;

/** select의 한 줄. `value`는 모델 참조다 */
export interface ModelOption {
  readonly value: string;
  readonly label: string;
  /** 문맥 창 크기. 모르면 null */
  readonly contextWindow: number | null;
  readonly price: ModelPrice;
}

const DATED_REF = /-\d{8}$/;
const LATEST_SUFFIX = / \(latest\)$/;

/** 같은 모델의 날짜 붙은 사본(`…-20251001`)은 날짜 없는 별칭이 있으면 감춘다. 지금 쓰는 모델이면 남긴다 */
function isHiddenDuplicate(
  ref: string,
  refs: ReadonlySet<string>,
  current: string | null,
): boolean {
  return ref !== current && DATED_REF.test(ref) && refs.has(ref.replace(DATED_REF, ""));
}

/** 제공자 이름순, 같은 제공자에서는 새 버전이 앞에 오게 */
function compareEntries(a: ModelEntry, b: ModelEntry): number {
  const [pa = "", ...ra] = a.ref.split("/");
  const [pb = "", ...rb] = b.ref.split("/");
  if (pa !== pb) return pa < pb ? -1 : 1;
  return rb.join("/").localeCompare(ra.join("/"), "en", { numeric: true });
}

function priceOf(entry: ModelEntry): ModelPrice {
  return entry.inputPrice === null || entry.outputPrice === null
    ? "unknown"
    : { input: entry.inputPrice, output: entry.outputPrice };
}

/**
 * 모델 select의 줄. 호스트 카탈로그(`models.list`)의 모델에, 지금 쓰는 모델이 카탈로그에 없으면 그것을 더한다(자격 증명이 빠진 provider 등).
 * 날짜 붙은 중복은 감추고 제공자순·새 버전순으로 줄 세운다. 이름은 카탈로그 이름(`(latest)` 뗌)이고 없으면 `provider/`를 뗀 모델 이름이다.
 * `returnTo`가 있으면(대화가 모델을 정했고 기본 모델을 안다) 끝에 기본 모델로 돌아가는 줄(`DEFAULT_MODEL_CHOICE`)을 둔다
 */
export function modelOptionsOf(
  choices: readonly ModelEntry[],
  current: string | null,
  returnTo: string | null,
): readonly ModelOption[] {
  const refs = new Set(choices.map((entry) => entry.ref));
  const options: ModelOption[] = choices
    .filter((entry) => !isHiddenDuplicate(entry.ref, refs, current))
    .toSorted(compareEntries)
    .map((entry) => ({
      value: entry.ref,
      label: entry.name === "" ? modelLabelOf(entry.ref) : entry.name.replace(LATEST_SUFFIX, ""),
      contextWindow: entry.contextWindow,
      price: priceOf(entry),
    }));
  if (current !== null && !refs.has(current)) {
    options.unshift({
      value: current,
      label: modelLabelOf(current),
      contextWindow: null,
      price: null,
    });
  }
  if (returnTo !== null) {
    options.push({
      value: DEFAULT_MODEL_CHOICE,
      label: modelLabelOf(returnTo),
      contextWindow: null,
      price: null,
    });
  }
  return options;
}

/** 가격 한 칸의 짧은 글자: 1 미만은 소수 셋째 자리까지 의미 있게, 그 이상은 둘째 자리까지 */
export function priceNumberText(usd: number): string {
  return usd < 1 ? String(Number(usd.toFixed(3))) : String(Number(usd.toFixed(2)));
}

/** 토큰 수를 짧게: 999 이하는 그대로, 천 단위는 `41k`, 백만 단위는 `1.2M` */
export function tokenCountText(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** 기본 모델 참조. 연결이 살아 있을 때 읽고 설정이 바뀌면(`settings.invalidated`) 다시 읽는다. 정해지지 않았거나 읽지 못하면 null이다 */
export function useDefaultModel(): string | null {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [model, setModel] = useState<string | null>(null);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    const read = (): void => {
      detach(
        commands.setup.load({ binaries: false }).then((result) => {
          if (!stale) setModel(result.ok ? result.value.defaultModel : null);
          return undefined;
        }),
        rethrow,
      );
    };
    read();
    const stop = commands.setup.onInvalidated(read);
    return () => {
      stale = true;
      stop();
    };
  }, [commands, phase]);
  return model;
}

/**
 * 이 대화의 사용량(`usage.get { threadId }`). 대화가 바뀌거나 턴이 끝나면(`running`이 거짓이 되면) 다시 읽는다.
 * 읽지 못하면 null이다(옛 값을 남기지 않는다).
 */
export function useSessionUsage(threadId: ThreadId | null, running: boolean): SessionUsage | null {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [slot, setSlot] = useState<{
    readonly thread: ThreadId;
    readonly usage: SessionUsage | null;
  } | null>(null);
  useEffect(() => {
    if (phase !== "live" || threadId === null || running) return undefined;
    let stale = false;
    detach(
      commands.usage.get({ threadId }).then((result) => {
        if (!stale) {
          setSlot({
            thread: threadId,
            usage: result.ok ? sessionUsageOf(result.value) : null,
          });
        }
        return undefined;
      }),
      rethrow,
    );
    return () => {
      stale = true;
    };
  }, [commands, phase, threadId, running]);
  return slot !== null && slot.thread === threadId ? slot.usage : null;
}

/**
 * 이 대화가 다음 turn에 쓸 모델. 대화가 정한 모델(거울의 `ThreadSummary.model`)이 있으면 그것(`chosen`)이고, 없으면 기본 모델이다.
 * 둘 다 모르면 `ref`가 null이다
 */
export function useThreadModel(
  threadId: ThreadId,
  fallback: string | null,
): { readonly ref: string | null; readonly chosen: boolean } {
  const model = useThread(threadId)?.model;
  return model === undefined ? { ref: fallback, chosen: false } : { ref: model, chosen: true };
}

/** 대화가 고를 수 있는 모델(`models.list`). 연결이 살아 있을 때 읽고 설정이 바뀌면 다시 읽는다. 읽지 못하면 빈 목록이다 */
export function useModelChoices(): readonly ModelEntry[] {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [models, setModels] = useState<readonly ModelEntry[]>([]);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    const read = (): void => {
      detach(
        commands.listModels().then((result) => {
          if (!stale) setModels(result.ok ? result.value.models : []);
          return undefined;
        }),
        rethrow,
      );
    };
    read();
    const stop = commands.setup.onInvalidated(read);
    return () => {
      stale = true;
      stop();
    };
  }, [commands, phase]);
  return models;
}
