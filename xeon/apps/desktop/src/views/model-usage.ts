import { assertNever, detach, err, ok, rethrow, type Result } from "@fresnel/contracts";
import { activeLocale } from "@fresnel/client/i18n";
import type { ModelThinkingLevel, ThreadId } from "@fresnel/contracts/conversation";
import type { PermissionMode } from "@fresnel/contracts/services";
import type { ModelEntry, UsageContext, UsageGauge } from "@fresnel/contracts/wire";
import type { SetupSnapshot } from "@fresnel/client/settings";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAppliedProfile, useLinkPhase, useThread } from "../state/engine/index.ts";
import { useCommands, type CommandError } from "./commands.ts";
import {
  bypassAllowedOf,
  modeStepOf,
  modeOriginOf,
  permissionModeOf,
  permissionModeReadOf,
  type ModeOrigin,
  type ModeStep,
  type PermissionModeRead,
} from "./permission-mode-model.ts";
import { thinkingLevelOf } from "./thinking-level-model.ts";
import { usageFractionOf } from "./pages/providers/providers-model.ts";

// 입력창의 모델 단추·사용량 링과 상태 막대의 모델·토큰 칸이 같이 쓰는 읽기. 모두 요청 결과라 거울에 넣지 않는다(FS-03).
// 대화의 모델은 거울의 대화 요약(`ThreadSummary.model`, `thread.setModel`)이고 정하지 않았으면 기본 모델(`l1.models.default`)이다.
// 사용량은 `usage.get`의 `context`(마지막 호출의 문맥 토큰과 그 모델의 문맥 창)가 원천이다.

/** `provider/model` 참조에서 모델 이름만. 시안의 `sonnet-5-5` 자리다. 빗금이 없으면 그대로다 */
export function modelLabelOf(ref: string): string {
  const slash = ref.indexOf("/");
  return slash < 0 ? ref : ref.slice(slash + 1);
}

const DATED_REF = /-\d{8}$/;
const LATEST_SUFFIX = / \(latest\)$/;

/** 대문자로 적는 줄임말 낱말 */
const UPPER_WORDS: ReadonlySet<string> = new Set(["gpt", "ai"]);

/**
 * 카탈로그 이름을 모를 때의 모델 이름. `provider/`와 끝의 날짜(`-20251001`)를 떼고, 낱말은 첫 글자를 대문자로, 이어진 숫자 조각은 점으로 잇는다.
 * `anthropic/claude-sonnet-5-5` → `Claude Sonnet 5.5`. 글자가 하나도 없으면 원래 이름을 그대로 둔다
 */
export function prettyModelId(ref: string): string {
  const parts = modelLabelOf(ref)
    .replace(DATED_REF, "")
    .split("-")
    .filter((part) => part !== "");
  const words: string[] = [];
  let digits: string[] = [];
  const flush = (): void => {
    if (digits.length > 0) words.push(digits.join("."));
    digits = [];
  };
  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      digits.push(part);
      continue;
    }
    flush();
    words.push(
      UPPER_WORDS.has(part) ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1),
    );
  }
  flush();
  return words.length === 0 ? modelLabelOf(ref) : words.join(" ");
}

/**
 * 화면에 보일 모델 이름(DP-144). 카탈로그(`models.list`)에 그 참조가 있고 이름이 있으면 그 이름(` (latest)` 뗌), 없으면 `prettyModelId`다.
 * 참조(`anthropic/claude-sonnet-5-5`)는 `title`(hover)이나 상세에만 둔다
 */
export function modelDisplayNameOf(ref: string, choices: readonly ModelEntry[]): string {
  const name = choices.find((entry) => entry.ref === ref)?.name ?? "";
  return name === "" ? prettyModelId(ref) : name.replace(LATEST_SUFFIX, "");
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
const DEFAULT_MODEL_CHOICE = "default";

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
      label: modelDisplayNameOf(entry.ref, [entry]),
      contextWindow: entry.contextWindow,
      price: priceOf(entry),
    }));
  if (current !== null && !refs.has(current)) {
    options.unshift({
      value: current,
      label: prettyModelId(current),
      contextWindow: null,
      price: null,
    });
  }
  if (returnTo !== null) {
    options.push({
      value: DEFAULT_MODEL_CHOICE,
      label: modelDisplayNameOf(returnTo, choices),
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
 * 토큰 수의 한 가지 표기(DP-145). 1만 밑은 자릿수 묶음 그대로(`1,200`), 그 위는 지금 로케일의 짧은 표기다(한국어 `2.8만`, 영어 `28K`).
 * 화면의 토큰 표기(턴 요약, 구분선, 사용량 표, 상태 줄, 알림)는 모두 이것을 거친다
 */
export function tokenCountText(tokens: number): string {
  const locale = activeLocale();
  const n = Math.round(tokens);
  if (Math.abs(n) < 10_000) return new Intl.NumberFormat(locale).format(n);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** 설정 스냅숏(기본 모델과 제공자 목록). 연결이 살아 있을 때 읽고 설정이 바뀌면(`settings.invalidated`) 다시 읽는다. 읽지 못하면 null이다 */
function useSetupSnapshot(): SetupSnapshot | null {
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

// 모델 카탈로그(`models.list`)는 입력창, 상태 줄, 턴 요약, 변화 표지, 사용량 표가 같이 읽는다. 줄마다 요청하지 않게 한 벌을 나눠 쓴다.
// 처음 쓰는 부품이 읽기를 시작하고 설정이 바뀌면(`settings.invalidated`) 다시 읽으며, 마지막 부품이 사라지면 구독을 거둔다.
const catalog: {
  models: readonly ModelEntry[];
  users: number;
  generation: number;
  stop: (() => void) | null;
} = { models: [], users: 0, generation: 0, stop: null };
const catalogListeners = new Set<() => void>();

function setCatalog(models: readonly ModelEntry[]): void {
  catalog.models = models;
  for (const listener of catalogListeners) listener();
}

function subscribeCatalog(listener: () => void): () => void {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

function readCatalog(): readonly ModelEntry[] {
  return catalog.models;
}

/** 대화가 고를 수 있는 모델(`models.list`). 연결이 살아 있을 때 읽고 설정이 바뀌면 다시 읽는다. 읽지 못하면 빈 목록이다 */
export function useModelChoices(): readonly ModelEntry[] {
  const commands = useCommands();
  const phase = useLinkPhase();
  useEffect(() => {
    if (phase !== "live") return undefined;
    catalog.users += 1;
    if (catalog.users === 1) {
      const read = (): void => {
        catalog.generation += 1;
        const generation = catalog.generation;
        detach(
          commands.listModels().then((result) => {
            if (generation === catalog.generation && catalog.users > 0) {
              setCatalog(result.ok ? result.value.models : []);
            }
            return undefined;
          }),
          rethrow,
        );
      };
      read();
      catalog.stop = commands.setup.onInvalidated(read);
    }
    return () => {
      catalog.users -= 1;
      if (catalog.users === 0) {
        catalog.generation += 1;
        catalog.stop?.();
        catalog.stop = null;
      }
    };
  }, [commands, phase]);
  return useSyncExternalStore(subscribeCatalog, readCatalog, readCatalog);
}

/** 모델 참조를 화면 이름으로 바꾸는 함수(`modelDisplayNameOf` + 카탈로그) */
export function useModelNameOf(): (ref: string) => string {
  const choices = useModelChoices();
  return useCallback((ref: string) => modelDisplayNameOf(ref, choices), [choices]);
}

/** 모드 바꾸기가 실패한 까닭. 명령이 실패한 것이다 */
export type ModeChangeError = { readonly kind: "command"; readonly error: CommandError };

/**
 * 이 대화의 승인 모드(입력창 칩이 보이는 값)와 고르기(DP-101·213). 값은 대화 범위 `settings.get`이고, 설정이 바뀌면 다시 읽고, 고르기가 이기면 다시 읽는다.
 * `read`는 읽는 중·읽음·실패·모르는 값을 가른다(`PermissionModeRead`). 칩은 어느 경우에도 자리를 지키고, 모르면 기본 모드로 보이며 이유를 말한다.
 * 모를 때 고르면 지금 값과 견주지 않고 고른 모드를 쓴다. `retry`는 다시 읽는다.
 * `bypassAllowed`는 `l1.tools.bypassAllowed`이고 참일 때만 메뉴에 모두 허용이 있다.
 * `origin`은 그 값을 누가 정했는지다(DP-231, AGE-71). 대화가 따로 고른 값이 아니면(프로필이 정함) 지금 값과 같은 모드를 골라도 이 대화에
 * 쓴다(그래야 그 대화에 고정된다). `clear`는 대화에서 따로 고른 값을 지워 프로필 값으로 돌아가고, `readProfile`은 그 프로필이 정한 값을
 * 읽어 `profileMode`에 둔다(따로 고른 값이 있을 때 메뉴를 열며 부른다)
 */
export function useThreadPermissionMode(threadId: ThreadId): {
  readonly read: PermissionModeRead;
  readonly origin: ModeOrigin;
  readonly bypassAllowed: boolean;
  readonly profileMode: { readonly profileId: string; readonly mode: PermissionMode | null } | null;
  readonly choose: (next: PermissionMode) => Promise<Result<null, ModeChangeError>>;
  readonly clear: () => Promise<Result<null, ModeChangeError>>;
  readonly readProfile: (profileId: string) => void;
  readonly retry: () => void;
} {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [state, setState] = useState<{
    readonly read: PermissionModeRead;
    readonly origin: ModeOrigin;
  }>({ read: { kind: "loading" }, origin: "other" });
  const [bypassAllowed, setBypassAllowed] = useState(false);
  const [profileMode, setProfileMode] = useState<{
    readonly profileId: string;
    readonly mode: PermissionMode | null;
  } | null>(null);
  // 고르기가 이기면 올려 다시 읽게 한다. 호스트가 준 값(관리 설정이 덮을 수 있다)을 그대로 보인다
  const [reads, setReads] = useState(0);
  // 프로필이 바뀌면(대화가 가리키는 프로필, 단계 경계에서 실제로 적용된 프로필) 프로필이 정한 값도 바뀌므로 다시 읽는다(F-35)
  const assignedProfile = useThread(threadId)?.profileId ?? null;
  const appliedProfile = useAppliedProfile(threadId)?.profileId ?? null;
  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    const readAll = (): void => {
      detach(
        commands.readThreadMode(threadId).then((result) => {
          if (stale) return undefined;
          setState({
            read: permissionModeReadOf(result.ok, result.ok ? result.value.value : null),
            origin: result.ok ? modeOriginOf(result.value.scope) : "other",
          });
          return undefined;
        }),
        rethrow,
      );
      detach(
        commands.readBypassAllowed(threadId).then((result) => {
          if (!stale) setBypassAllowed(result.ok && bypassAllowedOf(result.value));
          return undefined;
        }),
        rethrow,
      );
    };
    readAll();
    const stop = commands.onThreadModeChanged(threadId, readAll);
    return () => {
      stale = true;
      stop();
    };
  }, [commands, phase, threadId, reads, assignedProfile, appliedProfile]);
  const readNow = async (): Promise<{
    readonly mode: PermissionMode | null;
    readonly origin: ModeOrigin;
  } | null> => {
    const got = await commands.readThreadMode(threadId);
    return got.ok
      ? { mode: permissionModeOf(got.value.value), origin: modeOriginOf(got.value.scope) }
      : null;
  };
  const choose = async (next: PermissionMode): Promise<Result<null, ModeChangeError>> => {
    if (state.read.kind === "loading") return ok(null);
    // 칩이 보이는 값은 늦을 수 있다(다른 창, 설정 파일). 걸음은 엔진의 지금 값으로 정한다. 모르거나 프로필이 정한 값이면 고른 모드를 그대로 쓴다
    const now = await readNow();
    const step: ModeStep =
      now === null || now.mode === null || now.origin !== "thread"
        ? { kind: "set", mode: next }
        : modeStepOf(now.mode, next);
    switch (step.kind) {
      case "none":
        // 엔진이 이미 그 모드면 칩만 늦은 것이다. 다시 읽어 맞춘다
        setReads((count) => count + 1);
        return ok(null);
      case "set": {
        const set = await commands.setThreadMode(threadId, step.mode);
        if (!set.ok) return err({ kind: "command", error: set.error });
        setReads((count) => count + 1);
        return ok(null);
      }
      default:
        return assertNever(step, "ModeStep");
    }
  };
  const clear = async (): Promise<Result<null, ModeChangeError>> => {
    const done = await commands.clearThreadMode(threadId);
    setReads((count) => count + 1);
    return done.ok ? ok(null) : err({ kind: "command", error: done.error });
  };
  const readProfile = (profileId: string): void => {
    detach(
      commands.readProfileMode(profileId).then((got) => {
        setProfileMode({ profileId, mode: got.ok ? got.value : null });
        return undefined;
      }),
      rethrow,
    );
  };
  const retry = (): void => {
    setState({ read: { kind: "loading" }, origin: "other" });
    setReads((count) => count + 1);
  };
  return {
    read: state.read,
    origin: state.origin,
    bypassAllowed,
    profileMode,
    choose,
    clear,
    readProfile,
    retry,
  };
}

/**
 * 이 대화의 추론 레벨(설정 `l1.models.thinkingLevel`의 대화 범위 값, 정하지 않았으면 호스트가 준 유효 값). 모르는 동안은 null이다.
 * 고르기가 이기면 다시 읽고, 다른 곳에서 바뀌면(`settings.invalidated`) 다시 읽는다
 */
export function useThreadThinking(threadId: ThreadId): {
  readonly level: ModelThinkingLevel | null;
  readonly choose: (next: ModelThinkingLevel) => Promise<Result<null, CommandError>>;
} {
  const commands = useCommands();
  const phase = useLinkPhase();
  const [level, setLevel] = useState<ModelThinkingLevel | null>(null);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (phase !== "live") return undefined;
    let stale = false;
    const read = (): void => {
      detach(
        commands.readThreadThinking(threadId).then((result) => {
          if (!stale) setLevel(result.ok ? thinkingLevelOf(result.value) : null);
          return undefined;
        }),
        rethrow,
      );
    };
    read();
    const stop = commands.onThreadThinkingChanged(threadId, read);
    return () => {
      stale = true;
      stop();
    };
  }, [commands, phase, threadId, reads]);
  const choose = (next: ModelThinkingLevel): Promise<Result<null, CommandError>> =>
    commands.setThreadThinking(threadId, next).then((result) => {
      if (result.ok) setReads((count) => count + 1);
      return result;
    });
  return { level, choose };
}
