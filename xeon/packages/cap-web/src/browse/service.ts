import { attemptAsync, eachAsync, err, ok, type Result } from "@xeon/contracts";
import {
  WebBrowse,
  type BrowseActInput,
  type BrowseActOutput,
  type BrowseCloseInput,
  type BrowseCloseOutput,
  type BrowseOpenInput,
  type BrowseOpenOutput,
  type BrowsePage,
  type BrowseReadInput,
  type BrowseReadOutput,
  type BrowseSnapshot,
  type BrowserSessionHandle,
  type BrowserStep,
  type CallOptions,
  type CapabilityApi,
  type Cost,
  type WebProviderFallback,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import { buildMeta, NO_COST } from "../contract/meta.ts";
import { computeCost } from "../cost/meter.ts";
import type { WebDeps } from "../deps.ts";
import { deniedFailure, guarded, invalidInput, type WebFailure } from "../errors.ts";
import type { AccessContext } from "../policy/access.ts";
import type { BrowseConfirmPort, BrowseConfirmReason } from "../ports/confirm.ts";
import type { BrowseCandidate } from "../ports/providers.ts";
import { failureOfThrown } from "../provider-errors.ts";
import { planSelection } from "../select/order.ts";
import { isSensitiveTarget } from "./confirm.ts";

// L2.web.spec §3.4, §4.10. 브라우저 세션 수명, 이동 정책, 기본 비활성 동작, 사람 확인, 세션 상한을 앞단에서 처리하고
// provider(`WebBrowseProvider`)는 좁은 세션 핸들만 구현한다. 세션은 프로세스 메모리에만 있다(상주 수준 1).

/** auto 선택에서 다음 후보로 내려가는 open 오류 코드 */
const FALLBACK_CODES: ReadonlySet<string> = new Set([
  "unavailable",
  "rate_limited",
  "upstream_error",
  "timeout",
]);

/** 세션 상한을 넘으면 세션을 닫고 이 코드로 거부한다 */
const BUDGET_CODE = "session_budget";

interface Session {
  readonly id: string;
  readonly threadId: ThreadId | undefined;
  readonly candidate: BrowseCandidate;
  readonly handle: BrowserSessionHandle;
  readonly openedAt: number;
  readonly selectedBy: "call" | "setting" | "auto";
  readonly fallbacks: readonly WebProviderFallback[];
  actions: number;
  usd: number;
  currentUrl: string;
  closed: boolean;
}

export interface BrowseServiceOptions {
  /** 없으면 사람 확인이 필요한 동작은 `confirmation_denied`로 거부한다 */
  readonly confirm?: BrowseConfirmPort;
}

function neverAbortedSignal(): AbortSignal {
  return new AbortController().signal;
}

function threadKey(threadId: ThreadId | undefined): string {
  return threadId ?? "";
}

function notFound(): WebFailure {
  return {
    code: "not_found",
    message: "The browser session does not exist or is closed. Open a new one.",
    retryable: false,
  };
}

function accessContext(callOptions: CallOptions | undefined, askKey: string): AccessContext {
  const context = callOptions?.context;
  return {
    threadId: context?.threadId,
    caller: context?.caller ?? { kind: "host" },
    capability: "web.browse",
    askKey: context?.toolCallId ?? askKey,
    signal: callOptions?.signal ?? neverAbortedSignal(),
  };
}

function blankPage(): BrowsePage {
  return { url: "about:blank", title: "", tabId: "t1" };
}

function pageOf(step: BrowserStep): BrowsePage {
  return step.page;
}

function snapshotOf(
  step: BrowserStep,
  wanted: boolean | undefined,
): { readonly snapshot?: BrowseSnapshot } {
  return wanted === false || step.snapshot === undefined ? {} : { snapshot: step.snapshot };
}

export interface BrowseController {
  readonly api: CapabilityApi<typeof WebBrowse>;
  /** 대화 세션이 끝날 때(`session.shutdown`) 그 세션이 연 브라우저 세션을 닫는다(§4.10.1) */
  closeThread(threadId: ThreadId | undefined): Promise<void>;
  /** 프로세스가 끝날 때 모든 브라우저 세션을 닫는다 */
  closeAll(): Promise<void>;
  /** 지금 열려 있는 세션 수(시험과 진단용) */
  openCount(): number;
}

export function createBrowseApi(
  deps: WebDeps,
  options: BrowseServiceOptions = {},
): BrowseController {
  const sessions = new Map<string, Session>();

  function metaOf(
    session: Session,
    startedAt: number,
    cost: Cost,
    warnings: readonly string[],
  ): ReturnType<typeof buildMeta> {
    return buildMeta({
      ids: deps.ids,
      clock: deps.clock,
      startedAt,
      provider: session.candidate.provider.id,
      selectedBy: session.selectedBy,
      fallbacks: session.fallbacks,
      cache: "bypass",
      cost,
      warnings,
    });
  }

  /** 도구 호출 한 번의 비용. 가격표에 `browse_action` 단가가 없으면 무료다 */
  function priceOf(session: Session, units: number): Cost {
    if (units === 0) return NO_COST;
    const manifest = session.candidate.provider.manifest;
    const priced = computeCost(
      {
        provider: session.candidate.provider.id,
        pricing: manifest.pricing,
        units: [{ name: "browse_action", count: units }],
        contextChars: 0,
      },
      deps.clock.now(),
    );
    if (deps.meter !== undefined) {
      const recorded = deps.meter.record(
        session.candidate.provider.id,
        priced.cost,
        manifest.pricing,
      );
      if (!recorded.ok) deps.logger.warn("web.usage_record_failed", { kind: recorded.error.kind });
    }
    return priced.cost;
  }

  async function confirmed(
    session: Pick<Session, "id" | "threadId">,
    reason: BrowseConfirmReason,
    url: string,
    target: { readonly role?: string; readonly name?: string },
    requestKey: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (options.confirm === undefined) return false;
    const answer = await options.confirm.confirm(
      {
        threadId: session.threadId,
        sessionId: session.id,
        reason,
        url,
        ...(target.role === undefined ? {} : { role: target.role }),
        ...(target.name === undefined ? {} : { name: target.name }),
        requestKey,
      },
      signal,
    );
    return answer.ok && answer.value === "allow";
  }

  async function closeSession(session: Session): Promise<BrowseCloseOutput> {
    const was = !session.closed;
    session.closed = true;
    sessions.delete(session.id);
    if (was) {
      const closed = await attemptAsync(() => session.handle.close());
      if (!closed.ok) {
        deps.logger.warn("web.browse_close_failed", { provider: session.candidate.provider.id });
      }
    }
    const seconds = Math.max(0, Math.round((deps.clock.now() - session.openedAt) / 1000));
    return {
      closed: was,
      stats: { actions: session.actions, seconds, usd: session.usd },
    };
  }

  /** 세션 상한(시간, 동작 수, 비용)을 본다. 넘으면 세션을 닫고 실패를 돌려준다 */
  async function checkBudget(
    session: Session,
    threadId: ThreadId | undefined,
  ): Promise<WebFailure | undefined> {
    const limits = deps.settings(threadId).browse;
    const minutes = (deps.clock.now() - session.openedAt) / 60_000;
    let reason: string | undefined;
    if (minutes >= limits.maxMinutes) reason = "time";
    else if (session.actions >= limits.maxActions) reason = "actions";
    else if (session.usd >= limits.maxUsd) reason = "cost";
    if (reason === undefined) return undefined;
    await closeSession(session);
    return {
      code: BUDGET_CODE,
      message: `The browser session exceeded its ${reason} limit and was closed.`,
      retryable: false,
      detail: { reason },
    };
  }

  /**
   * 동작이 만든 최상위 문서 이동을 다시 검사한다(§4.10.2). 금지 주소가 있으면 페이지를 `about:blank`로 바꾸고 `denied`를 돌려준다
   */
  async function recheckNavigations(
    session: Session,
    step: BrowserStep,
    ctx: AccessContext,
  ): Promise<WebFailure | undefined> {
    const hit = await eachAsync(step.navigations, async (url) => {
      if (url === "about:blank") return undefined;
      const verdict = await deps.access.authorizeHop(url, ctx, { resolveDns: true });
      if (verdict.ok) return undefined;
      const reset = await attemptAsync(() => session.handle.navigate("about:blank", ctx.signal));
      if (!reset.ok) deps.logger.warn("web.browse_reset_failed", { id: session.id });
      session.currentUrl = "about:blank";
      return {
        value: deniedFailure(
          "navigation_denied",
          "A page moved to an address that is not allowed.",
          { cause: verdict.error.detail ?? null },
        ),
      };
    });
    return hit?.value;
  }

  async function open(
    input: BrowseOpenInput,
    callOptions: CallOptions | undefined,
  ): Promise<Result<BrowseOpenOutput, WebFailure>> {
    const startedAt = deps.clock.now();
    const threadId = callOptions?.context?.threadId;
    const signal = callOptions?.signal ?? neverAbortedSignal();
    const settings = deps.settings(threadId);
    const profile = input.profile ?? "ephemeral";
    if (profile !== "ephemeral") {
      if (!settings.browse.allowNamedProfiles) {
        return err({
          code: "action_disabled",
          message: "Named browser profiles are disabled (l2.web.browse.allowNamedProfiles).",
          retryable: false,
        });
      }
      const allowed = await confirmed(
        { id: "wbr_pending", threadId },
        "named_profile",
        input.url ?? "about:blank",
        { name: profile },
        `profile:${profile}`,
        signal,
      );
      if (!allowed) {
        return err({
          code: "confirmation_denied",
          message: "Opening a named profile needs the user's approval.",
          retryable: false,
        });
      }
    }
    const live = [...sessions.values()].filter(
      (session) => threadKey(session.threadId) === threadKey(threadId),
    );
    if (live.length >= settings.browse.maxSessions) {
      return err({
        code: BUDGET_CODE,
        message: `At most ${settings.browse.maxSessions} browser sessions can be open at once.`,
        retryable: false,
        detail: { reason: "sessions" },
      });
    }
    const ctx = accessContext(callOptions, "browse.open");
    if (input.url !== undefined) {
      const approved = await deps.access.authorize(input.url, ctx);
      if (!approved.ok) return approved;
    }
    const candidates = deps.catalog.browseCandidates();
    const plan = planSelection({
      candidates: candidates.map((candidate) => ({
        id: candidate.provider.id,
        origin: candidate.origin,
      })),
      ...(input.provider === undefined ? {} : { callProvider: input.provider }),
      settingProvider: settings.browse.provider,
      order: settings.browse.order,
    });
    const explicit = plan.selectedBy !== "auto";
    if (plan.order.length === 0) {
      return err({
        code: "unavailable",
        message: explicit
          ? "The requested browser provider is not registered."
          : "No browser provider is registered.",
        retryable: false,
        detail: { reason: explicit ? "unknown_provider" : "no_provider", fallbacks: [] },
      });
    }
    const byId = new Map(candidates.map((candidate) => [candidate.provider.id, candidate]));
    const fallbacks: WebProviderFallback[] = [];
    const profileForProvider =
      profile === "ephemeral" ? "ephemeral" : (`named:${profile.slice(6)}` as const);
    const done = await eachAsync<string, Result<BrowseOpenOutput, WebFailure>>(
      plan.order,
      async (id) => {
        const candidate = byId.get(id);
        if (candidate === undefined) return undefined;
        const available = await deps.probes.probe(candidate.provider, signal);
        if (!available.ok) {
          fallbacks.push({
            provider: id,
            stage: "probe",
            reason: available.reason,
            ...(available.detail === undefined ? {} : { detail: available.detail.slice(0, 512) }),
          });
          if (!explicit) return undefined;
          return {
            value: err({
              code: "unavailable",
              message: `${id} is unavailable: ${available.reason}`,
              retryable: true,
              provider: id,
              detail: { reason: available.reason },
            }),
          };
        }
        const opened = await attemptAsync(() =>
          candidate.provider.open(
            {
              profile: profileForProvider,
              headless: settings.browse.headless,
              allowedOrigins: input.allowedOrigins ?? [],
            },
            signal,
          ),
        );
        if (!opened.ok) {
          const thrown = failureOfThrown(opened.error.cause, id);
          deps.logger.warn("web.browse_open_failed", { provider: id, reason: thrown.code });
          if (explicit || !FALLBACK_CODES.has(thrown.code)) {
            return { value: err({ ...thrown, provider: id }) };
          }
          fallbacks.push({ provider: id, stage: "call", reason: thrown.code.slice(0, 64) });
          return undefined;
        }
        const session: Session = {
          id: deps.ids.next("wbr"),
          threadId,
          candidate,
          handle: opened.value,
          openedAt: deps.clock.now(),
          selectedBy: plan.selectedBy,
          fallbacks,
          actions: 0,
          usd: 0,
          currentUrl: "about:blank",
          closed: false,
        };
        sessions.set(session.id, session);
        let step: BrowserStep | undefined;
        const firstUrl = input.url;
        if (firstUrl !== undefined) {
          const navigated = await attemptAsync(() => session.handle.navigate(firstUrl, signal));
          if (!navigated.ok) {
            await closeSession(session);
            return {
              value: err({ ...failureOfThrown(navigated.error.cause, id), provider: id }),
            };
          }
          step = navigated.value;
          const denied = await recheckNavigations(session, step, ctx);
          if (denied !== undefined) {
            await closeSession(session);
            return { value: err({ ...denied, provider: id }) };
          }
          session.currentUrl = step.page.url;
          session.actions = 1;
        }
        const cost = priceOf(session, session.actions);
        session.usd += cost.usd;
        return {
          value: ok({
            sessionId: session.id,
            page: step === undefined ? blankPage() : pageOf(step),
            ...(step === undefined ? {} : snapshotOf(step, true)),
            meta: metaOf(session, startedAt, cost, []),
          }),
        };
      },
    );
    if (done !== undefined) return done.value;
    return err({
      code: "unavailable",
      message: `Every browser provider failed: ${fallbacks.map((item) => `${item.provider} ${item.stage}:${item.reason}`).join(", ")}`,
      retryable: true,
      detail: {
        reason: "all_failed",
        fallbacks: fallbacks.map((item) => ({
          provider: item.provider,
          stage: item.stage,
          reason: item.reason,
        })),
      },
    });
  }

  /** 세션을 찾는다. 다른 대화의 세션은 없는 것으로 본다 */
  function sessionFor(sessionId: string, threadId: ThreadId | undefined): Session | undefined {
    const found = sessions.get(sessionId);
    if (found === undefined || found.closed) return undefined;
    return threadKey(found.threadId) === threadKey(threadId) ? found : undefined;
  }

  async function act(
    input: BrowseActInput,
    callOptions: CallOptions | undefined,
  ): Promise<Result<BrowseActOutput, WebFailure>> {
    const startedAt = deps.clock.now();
    const context = callOptions?.context;
    const threadId = context?.threadId;
    const signal = callOptions?.signal ?? neverAbortedSignal();
    const session = sessionFor(input.sessionId, threadId);
    if (session === undefined) return err(notFound());
    const settings = deps.settings(threadId);
    if (input.action === "upload" && !settings.browse.allowFileUpload) {
      return err({
        code: "action_disabled",
        message: "File upload is disabled (l2.web.browse.allowFileUpload).",
        retryable: false,
      });
    }
    if (input.action === "evaluate" && !settings.browse.allowJavascriptExec) {
      return err({
        code: "action_disabled",
        message: "Page script execution is disabled (l2.web.browse.allowJavascriptExec).",
        retryable: false,
      });
    }
    const exhausted = await checkBudget(session, threadId);
    if (exhausted !== undefined) return err(exhausted);
    const ctx = accessContext(callOptions, `browse.act:${session.id}`);
    if (input.action === "navigate") {
      if (input.url === undefined) return err(invalidInput("navigate needs a url."));
      const approved = await deps.access.authorize(input.url, ctx);
      if (!approved.ok) return approved;
    }
    const sensitive = await needsConfirmation(
      session,
      input,
      context?.caller.afterUntrusted,
      signal,
    );
    if (!sensitive.ok) return sensitive;
    if (sensitive.value !== undefined) {
      const allowed = await confirmed(
        session,
        sensitive.value.reason,
        session.currentUrl,
        sensitive.value.target,
        `act:${session.id}:${session.actions}`,
        signal,
      );
      if (!allowed) {
        return err({
          code: "confirmation_denied",
          message: "The user did not approve this browser action.",
          retryable: false,
          detail: { reason: sensitive.value.reason },
        });
      }
    }
    const stepped = await attemptAsync(() => session.handle.act(input, signal));
    if (!stepped.ok) {
      return err({
        ...failureOfThrown(stepped.error.cause, session.candidate.provider.id),
        provider: session.candidate.provider.id,
      });
    }
    session.actions += 1;
    const step = stepped.value;
    const denied = await recheckNavigations(session, step, ctx);
    if (denied !== undefined) return err({ ...denied, provider: session.candidate.provider.id });
    session.currentUrl = step.page.url;
    const cost = priceOf(session, 1);
    session.usd += cost.usd;
    return ok({
      page: pageOf(step),
      ...(step.code === undefined ? {} : { code: step.code }),
      ...snapshotOf(step, input.snapshot),
      meta: metaOf(session, startedAt, cost, []),
    });
  }

  /** 사람 확인이 필요한 동작인지 판정한다(§4.10.3). 필요 없으면 undefined */
  async function needsConfirmation(
    session: Session,
    input: BrowseActInput,
    afterUntrusted: boolean | undefined,
    signal: AbortSignal,
  ): Promise<
    Result<
      | {
          readonly reason: BrowseConfirmReason;
          readonly target: { readonly role?: string; readonly name?: string };
        }
      | undefined,
      WebFailure
    >
  > {
    const ref = input.target !== undefined && "ref" in input.target ? input.target.ref : undefined;
    let described:
      | { readonly role: string; readonly name?: string; readonly formAction?: string }
      | undefined;
    if (ref !== undefined && (input.action === "click" || input.action === "key")) {
      const looked = await attemptAsync(() => session.handle.describe({ ref }, signal));
      if (!looked.ok) {
        return err({
          ...failureOfThrown(looked.error.cause, session.candidate.provider.id),
          provider: session.candidate.provider.id,
        });
      }
      described = looked.value;
    }
    if (described !== undefined) {
      if (input.action === "click" && isSensitiveTarget(described)) {
        return ok({
          reason: "sensitive_click",
          target: {
            role: described.role,
            ...(described.name === undefined ? {} : { name: described.name }),
          },
        });
      }
      if (
        described.formAction !== undefined &&
        originOf(described.formAction) !== originOf(session.currentUrl)
      ) {
        return ok({
          reason: "cross_origin_form",
          target: {
            role: described.role,
            ...(described.name === undefined ? {} : { name: described.name }),
          },
        });
      }
    }
    if (afterUntrusted === true && (input.action === "fill" || input.action === "type")) {
      return ok({ reason: "after_untrusted_input", target: {} });
    }
    return ok(undefined);
  }

  async function readPage(
    input: BrowseReadInput,
    callOptions: CallOptions | undefined,
  ): Promise<Result<BrowseReadOutput, WebFailure>> {
    const startedAt = deps.clock.now();
    const threadId = callOptions?.context?.threadId;
    const signal = callOptions?.signal ?? neverAbortedSignal();
    const session = sessionFor(input.sessionId, threadId);
    if (session === undefined) return err(notFound());
    const exhausted = await checkBudget(session, threadId);
    if (exhausted !== undefined) return err(exhausted);
    const read = await attemptAsync(() => session.handle.read(input, signal));
    if (!read.ok) {
      return err({
        ...failureOfThrown(read.error.cause, session.candidate.provider.id),
        provider: session.candidate.provider.id,
      });
    }
    return ok({ ...read.value, meta: metaOf(session, startedAt, NO_COST, []) });
  }

  async function close(
    input: BrowseCloseInput,
    callOptions: CallOptions | undefined,
  ): Promise<Result<BrowseCloseOutput, WebFailure>> {
    const threadId = callOptions?.context?.threadId;
    const session = sessionFor(input.sessionId, threadId);
    if (session === undefined) {
      return ok({ closed: false, stats: { actions: 0, seconds: 0, usd: 0 } });
    }
    return ok(await closeSession(session));
  }

  return {
    api: {
      open: (input, callOptions) => guarded(WebBrowse.id, "open", () => open(input, callOptions)),
      act: (input, callOptions) => guarded(WebBrowse.id, "act", () => act(input, callOptions)),
      read: (input, callOptions) =>
        guarded(WebBrowse.id, "read", () => readPage(input, callOptions)),
      close: (input, callOptions) =>
        guarded(WebBrowse.id, "close", () => close(input, callOptions)),
    },
    async closeThread(threadId) {
      const mine = [...sessions.values()].filter(
        (session) => threadKey(session.threadId) === threadKey(threadId),
      );
      await Promise.all(mine.map((session) => closeSession(session)));
    },
    async closeAll() {
      await Promise.all([...sessions.values()].map((session) => closeSession(session)));
    },
    openCount: () => sessions.size,
  };
}

function originOf(url: string): string {
  const parsed = URL.canParse(url) ? new URL(url) : undefined;
  return parsed === undefined ? url : parsed.origin;
}
