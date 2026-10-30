import {
  assertNever,
  attemptAsync,
  detach,
  err,
  ok,
  parse,
  type Clock,
  type Logger,
  type Result,
} from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { ItemRecordedPayloadSchema } from "@xeon/contracts/records";
import { formatModelRef, type ModelRole, type ModelService } from "@xeon/contracts/services";
import { autoTitleThread, type AutoTitleDeps, type TitleModelPort } from "@xeon/core-persistence";
import type { CommitBatch, EventFeedPort, SessionLockPort } from "../types.ts";
import { titleFromInput } from "../title.ts";

// 대화의 자동 제목을 모델로 만든다(M3-REQ-83, L4.host-service.spec HS-73). 턴이 끝난 뒤 제목이 아직 임시일 때만 쓴다.
// 제목을 쓰는 규칙(임시 판정, 입력 정리, 쓰기)은 core-persistence의 `autoTitleThread`가 한다. 이 파일은 언제 부를지,
// 어느 모델을 쓸지, 쓰기 소유를 어떻게 확인할지를 정한다. 실패는 로그로만 남기고 턴을 멈추지 않는다.

/** 제목 모델의 역할. 요약 역할이 설정되지 않았으면 `main`으로 대체된다(`ROLE_FALLBACK`). 짧은 보조 텍스트라 요약 역할을 쓴다 [결정: 오케스트레이터 기본값] */
const TITLE_ROLE: ModelRole = "summary";
/** 제목 응답의 출력 상한(토큰). 제목은 한 줄이라 짧아도 된다 [결정: 오케스트레이터 기본값] */
const TITLE_MAX_TOKENS = 256;

/** 제목 모델을 쓸 수 없는 이유. 같은 이유는 프로세스당 한 번만 기록한다 */
export interface TitleModelSkip {
  readonly kind: "no_model" | "no_credentials";
  /** 모델 참조(`provider/modelId`)나 해석 오류 종류. 비밀 값이 아니다 */
  readonly detail: string;
}

export interface AutoTitleHostDeps {
  readonly feed: Pick<EventFeedPort, "onCommit">;
  readonly locks: Pick<SessionLockPort, "holds">;
  readonly session: AutoTitleDeps["session"];
  /** thread의 제목 모델. 해석하지 못하거나 자격 증명이 없으면 이유를 돌려준다 */
  readonly modelFor: (threadId: ThreadId) => Result<TitleModelPort, TitleModelSkip>;
  readonly logger: Logger;
  /** 모델 호출을 멈추는 신호(조립 수명). 닫을 때 중단한다 */
  readonly signal: AbortSignal;
}

export interface AutoTitle {
  /** 커밋 구독을 거둔다. 진행 중인 제목 작업은 `signal`로 멈춘다 */
  close(): void;
}

/** 사용자 메시지 내용에서 텍스트 블록만 이어 붙인다. 턴 입력을 `titleFromInput`에 넘길 때와 같은 방식이다 */
function userTextOf(
  content: string | readonly { readonly type: string; readonly text?: string }[],
): string {
  if (typeof content === "string") return content;
  return content
    .flatMap((block) =>
      block.type === "text" && typeof block.text === "string" ? [block.text] : [],
    )
    .join(" ");
}

/** 제목 모델 포트. 같은 thread에 대해 해석한 모델로 완성 호출을 한다. 입력 정리와 제목 정리는 `autoTitleThread`가 한다 */
export function titleModelFor(
  models: Pick<ModelService, "resolve" | "list" | "complete">,
  clock: Clock,
  threadId: ThreadId,
): Result<TitleModelPort, TitleModelSkip> {
  const resolved = models.resolve(TITLE_ROLE, {});
  if (!resolved.ok) return err({ kind: "no_model", detail: resolved.error.kind });
  const model = resolved.value;
  const ref = formatModelRef({
    provider: model.binding.provider,
    modelId: model.binding.modelId,
    thinkingLevel: null,
  });
  const usable = models
    .list({ provider: model.binding.provider, available: true })
    .some((info) => info.ref === ref);
  if (!usable) return err({ kind: "no_credentials", detail: ref });
  return ok({
    async complete(input, signal) {
      const reply = await attemptAsync(() =>
        models.complete({
          threadId,
          turnId: null,
          stepId: null,
          role: TITLE_ROLE,
          ...(signal === undefined ? {} : { signal }),
          resolved: model,
          context: {
            systemPrompt: input.system,
            messages: [
              {
                role: "user",
                content: [{ type: "text", text: input.user }],
                timestamp: clock.now(),
              },
            ],
          },
          options: { maxTokens: TITLE_MAX_TOKENS, cacheRetention: "none" },
        }),
      );
      if (!reply.ok) return err({ kind: "threw" });
      const message = reply.value;
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        return err({ kind: message.stopReason });
      }
      return ok(
        message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""),
      );
    },
  });
}

/**
 * 자동 제목 연결을 시작한다. `turn.completed`가 커밋되면 그 thread의 제목을 한 번 정하려 한다(정해지거나 모델이 실패하면 그 뒤로는
 * 다시 하지 않는다). 쓰기 소유가 없으면 조용히 건너뛴다. 사람이 정한 제목은 덮지 않는다: 임시 제목은 이 프로세스가 본 첫 사용자 입력에서
 * 만든 제목뿐이다. 이 프로세스가 시작하기 전의 입력은 기억이 없어서 임시로 보지 않는다(안전한 쪽으로 기운다).
 */
export function startAutoTitle(deps: AutoTitleHostDeps): AutoTitle {
  const { feed, locks, session, logger, signal } = deps;
  /** 이 프로세스가 본 첫 사용자 입력에서 만든 임시 제목(`titleFromInput`) */
  const firstInputTitle = new Map<ThreadId, string>();
  /** 첫 사용자 입력을 이미 본 thread. 그 뒤의 항목은 다시 읽지 않는다 */
  const checkedFirstInput = new Set<ThreadId>();
  const settled = new Set<ThreadId>();
  const running = new Set<ThreadId>();
  const skipsLogged = new Set<string>();
  const state = { closed: false };

  const gatedSession: AutoTitleDeps["session"] = {
    ...session,
    threads: {
      ...session.threads,
      // 쓰기 직전에 다시 확인한다: 모델을 기다리는 동안 소유를 잃었을 수 있다
      setTitle: (threadId, title, requestKey) =>
        locks.holds(threadId)
          ? session.threads.setTitle(threadId, title, requestKey)
          : err({ kind: "not_owner", threadId }),
    },
  };

  function captureFirstInput(batch: CommitBatch): void {
    for (const event of batch.events) {
      if (event.kind !== "item.recorded" || checkedFirstInput.has(event.threadId)) continue;
      const parsed = parse(ItemRecordedPayloadSchema, event.payload);
      if (!parsed.ok || parsed.value.item.kind !== "user") continue;
      checkedFirstInput.add(event.threadId);
      const title = titleFromInput(userTextOf(parsed.value.item.message.content));
      if (title !== undefined) firstInputTitle.set(event.threadId, title);
    }
  }

  function logSkipOnce(skip: TitleModelSkip): void {
    if (skipsLogged.has(skip.kind)) return;
    skipsLogged.add(skip.kind);
    logger.info("thread.auto_title_skipped", { reason: skip.kind, detail: skip.detail });
  }

  async function retitle(threadId: ThreadId): Promise<void> {
    if (!locks.holds(threadId)) {
      logger.debug("thread.auto_title_skipped", { threadId, reason: "not_owner" });
      return;
    }
    const model = deps.modelFor(threadId);
    if (!model.ok) {
      logSkipOnce(model.error);
      return;
    }
    const captured = firstInputTitle.get(threadId);
    const result = await autoTitleThread(
      {
        session: gatedSession,
        model: model.value,
        isProvisional: (title) => title === null || (captured !== undefined && title === captured),
        logger,
      },
      threadId,
      signal,
    );
    if (!result.ok) {
      const error = result.error;
      switch (error.kind) {
        case "thread_not_found":
          logger.debug("thread.auto_title_skipped", { threadId, reason: "thread_not_found" });
          return;
        case "read_failed":
          logger.error("thread.auto_title_failed", {
            threadId,
            step: "read",
            kind: error.readKind,
          });
          return;
        case "model_failed":
          // 실패한 thread는 이 프로세스에서 다시 부르지 않는다. 임시 제목은 그대로 남는다
          settled.add(threadId);
          logger.error("thread.auto_title_failed", {
            threadId,
            step: "model",
            kind: error.modelKind,
          });
          return;
        case "store_failed":
          if (error.lifecycleKind === "not_owner") {
            logger.debug("thread.auto_title_skipped", { threadId, reason: "not_owner" });
            return;
          }
          logger.error("thread.auto_title_failed", {
            threadId,
            step: "rename",
            kind: error.lifecycleKind,
          });
          return;
        default:
          return assertNever(error, "AutoTitleError");
      }
    }
    if (result.value.status === "titled") {
      settled.add(threadId);
      logger.debug("thread.auto_titled", { threadId });
    } else if (result.value.reason === "has_human_title") {
      settled.add(threadId);
    }
  }

  function onTurnCompleted(threadId: ThreadId): void {
    if (state.closed || settled.has(threadId) || running.has(threadId)) return;
    running.add(threadId);
    detach(
      retitle(threadId).finally(() => {
        running.delete(threadId);
      }),
      (cause) => {
        logger.error("thread.auto_title_failed", {
          threadId,
          step: "model",
          kind: cause instanceof Error ? cause.name : "threw",
        });
      },
    );
  }

  const unsubscribe = feed.onCommit((batch) => {
    if (state.closed) return;
    captureFirstInput(batch);
    for (const event of batch.events) {
      if (event.kind === "turn.completed") onTurnCompleted(event.threadId);
    }
  });

  return {
    close: () => {
      state.closed = true;
      unsubscribe();
    },
  };
}
