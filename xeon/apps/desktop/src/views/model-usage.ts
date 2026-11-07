import { detach, rethrow, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { PermissionMode } from "@fresnel/contracts/services";
import type { ModelEntry, UsageContext, UsageGauge } from "@fresnel/contracts/wire";
import type { SetupSnapshot } from "@fresnel/client/settings";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLinkPhase, useThread } from "../state/engine/index.ts";
import { useCommands, type CommandError, type SwitchMode } from "./commands.ts";
import { permissionModeOf } from "./permission-mode-model.ts";
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

/** 사용량의 한도를 바꾼 모델의 문맥 창으로 갈아 끼운다. 쓴 토큰은 그대로이고 비율만 다시 구한다 */
export function withLimit(usage: SessionUsage, limit: number): SessionUsage {
  return { tokens: usage.tokens, limit, percent: Math.min(100, (usage.tokens / limit) * 100) };
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

/**
 * 지금 문맥(`contextTokens`)을 이 가격으로 새로 보낼 때의 입력 비용 한 줄. 모델을 바꾸면 캐시가 비워지므로 캐시 읽기 할인 없이 입력 단가로 센다.
 * 0이거나 1센트 이상이면 소수 둘, 그 밑이면 소수 넷이다. 문맥을 모르거나 비어 있으면 null이다
 */
export function contextCostText(
  contextTokens: number | null,
  inputPerMillion: number,
): string | null {
  if (contextTokens === null || contextTokens <= 0) return null;
  const usd = (contextTokens / 1_000_000) * inputPerMillion;
  if (usd > 0 && usd < 0.0001) return "< $0.0001";
  return `$${usd.toFixed(usd === 0 || usd >= 0.01 ? 2 : 4)}`;
}

/** 토큰 수를 짧게: 999 이하는 그대로, 천 단위는 `41k`, 백만 단위는 `1.2M` */
export function tokenCountText(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** 설정 스냅숏(기본 모델과 제공자 목록). 연결이 살아 있을 때 읽고 설정이 바뀌면(`settings.invalidated`) 다시 읽는다. 읽지 못하면 null이다 */
export function useSetupSnapshot(): SetupSnapshot | null {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    const read = (): void => {
      detach(
        commands.setup.load({ binaries: false }).then((result) => {
          if (!stale) setSnapshot(result.ok ? result.value : null);
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
  return snapshot;
}

/** 기본 모델 참조. 정해지지 않았거나 읽지 못하면 null이다 */
export function useDefaultModel(): string | null {
  return useSetupSnapshot()?.defaultModel ?? null;
}

// "대화 요약"이 끝난 직후 사용량을 다시 읽게 하는 신호. 요약은 턴이 아니라 `running`이 바뀌지 않아 따로 알린다.
let usageEpoch = 0;
const epochListeners = new Set<() => void>();

/** 요약이 문맥 크기를 바꿨으니 열린 사용량 읽기를 다시 하라고 알린다 */
function bumpUsageEpoch(): void {
  usageEpoch += 1;
  for (const listener of epochListeners) listener();
}

// 요약 결과(`thread.compact`의 `tokensAfter`)가 곧 이 대화의 문맥 크기다. 다음 턴이 시작하기 전까지는 다시 읽지 않고 이 값을 보인다.
// 요약 직후 다시 읽은 값이 0으로 보이던 것을 피한다. 턴이 시작되면 지운다(그 뒤에는 `usage.get`이 마지막 호출의 값을 준다).
let compactedContext: { readonly threadId: ThreadId; readonly tokens: number } | null = null;

/** 요약이 끝났다. 이 대화의 문맥 크기는 `tokens`(요약 뒤 추정)이고 사용량을 다시 보인다 */
export function setCompactedContext(threadId: ThreadId, tokens: number): void {
  compactedContext = { threadId, tokens };
  bumpUsageEpoch();
}

/** 이 대화의 요약 뒤 문맥 크기. 요약이 없었거나 턴이 시작해 지워졌으면 null */
export function compactedContextOf(threadId: ThreadId): number | null {
  return compactedContext?.threadId === threadId ? compactedContext.tokens : null;
}

/** 턴이 시작해 요약 뒤 값을 지운다. 이 뒤의 문맥은 `usage.get`이 준다 */
export function clearCompactedContext(threadId: ThreadId): void {
  if (compactedContext?.threadId === threadId) compactedContext = null;
}

function subscribeEpoch(listener: () => void): () => void {
  epochListeners.add(listener);
  return () => {
    epochListeners.delete(listener);
  };
}

/**
 * 이 대화의 사용량(`usage.get { threadId }`). 대화가 바뀌거나 턴이 끝나거나(`running`이 거짓이 됨) 요약이 끝나면 다시 읽는다.
 * 읽지 못하면 null이다(옛 값을 남기지 않는다). 대화가 모델을 골랐으면 한도(문맥 창)는 읽은 마지막 호출의 모델이 아니라
 * 고른 모델의 창이다(모델을 바꾼 직후 다음 호출 전에도 맞는다).
 */
export function useSessionUsage(threadId: ThreadId, running: boolean): SessionUsage | null {
  const commands = useCommands();
  const phase = useLinkPhase();
  const epoch = useSyncExternalStore(
    subscribeEpoch,
    () => usageEpoch,
    () => 0,
  );
  const chosen = useThread(threadId)?.model;
  const choices = useModelChoices();
  const [slot, setSlot] = useState<{
    readonly thread: ThreadId;
    readonly usage: SessionUsage | null;
  } | null>(null);
  useEffect(() => {
    if (phase !== "live") return undefined;
    if (running) {
      clearCompactedContext(threadId);
      return undefined;
    }
    const compacted = compactedContextOf(threadId);
    if (compacted !== null) {
      setSlot({ thread: threadId, usage: { tokens: compacted, percent: null, limit: null } });
      return undefined;
    }
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
  }, [commands, phase, threadId, running, epoch]);
  const usage = slot !== null && slot.thread === threadId ? slot.usage : null;
  const window =
    chosen === undefined ? undefined : choices.find((entry) => entry.ref === chosen)?.contextWindow;
  return usage === null || window === undefined ? usage : withLimit(usage, window);
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

/**
 * 이 대화의 승인 모드(입력창 칩이 보이는 값)와 고르기. 값은 대화 범위 `settings.get`이고, 설정이 바뀌면 다시 읽고, 고르기가 이기면 다시 읽는다.
 * 읽지 못했거나 네 모드가 아니면 `mode`가 null이고 칩은 그리지 않는다(모르는 값을 지어내지 않는다).
 */
export function useThreadPermissionMode(threadId: ThreadId): {
  readonly mode: PermissionMode | null;
  readonly choose: (next: SwitchMode) => Promise<Result<null, CommandError>>;
} {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [mode, setMode] = useState<PermissionMode | null>(null);
  // 고르기가 이기면 올려 다시 읽게 한다. 호스트가 준 값(관리 설정이 덮을 수 있다)을 그대로 보인다
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    const read = (): void => {
      detach(
        commands.readThreadMode(threadId).then((result) => {
          if (!stale) setMode(result.ok ? permissionModeOf(result.value) : null);
          return undefined;
        }),
        rethrow,
      );
    };
    read();
    const stop = commands.onThreadModeChanged(threadId, read);
    return () => {
      stale = true;
      stop();
    };
  }, [commands, phase, threadId, reads]);
  const choose = (next: SwitchMode): Promise<Result<null, CommandError>> =>
    commands.setThreadMode(threadId, next).then((result) => {
      if (result.ok) setReads((count) => count + 1);
      return result;
    });
  return { mode, choose };
}
