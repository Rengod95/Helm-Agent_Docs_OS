import { createHash } from "node:crypto";
import { Bug, attemptAsync, detach, err, ok, parse, type Result } from "@xeon/contracts";
import type {
  JsonValue,
  ThreadId,
  ToolResultRecord,
  XeonCustomMessage,
} from "@xeon/contracts/conversation";
import { commitKeyPart } from "@xeon/contracts/records";
import type { UserBashResult } from "@xeon/contracts/extensions";
import type {
  ToolRunContext,
  UserBashOutcome,
  UserBashRequest,
  LoopError,
} from "@xeon/contracts/services";
import { Type } from "typebox";
import { commitWithRetry, describeCommitFailure } from "./commit.ts";
import type { LoopContext } from "./types.ts";

// L1.loop.spec §3.1 `runUserBash`, LP12 `input.bash.before`. 사용자가 `!명령`으로 친 셸 명령을 처리한다.
// 1. `input.bash.before`(first) 지점을 발화한다. 거부면 실행하지 않고, 결과 대체면 명령을 실행하지 않고 그 결과를 쓴다.
// 2. 거부가 아니면 `xeon.tools.runUserShell`로 실행한다(정책 deny와 `tool.call.before` 거부는 도구 쪽이 막는다).
// 3. `!!`가 아니면 명령과 출력을 custom item 하나로 기록해 다음 요청의 컨텍스트에 들어가게 한다. `!!`는 효과 3단만 남는다.
//
// turn을 열지 않는다. 도구 쪽 효과 기록은 turn과 단계 id를 요구하므로 이 호출 전용 id를 새로 만들어 쓴다.
// 그 id는 어떤 turn 이벤트와도 이어지지 않으므로 열린 turn의 재개 판정(reduceOpenTurn)에 끼지 않는다.

/** 컨텍스트에 넣는 custom item의 종류. 코어(core.loop)가 만든다 */
const USER_BASH_CUSTOM_TYPE = "core.loop.user_bash";

/** 같은 requestId 재호출을 위해 프로세스 안에서 기억하는 완료 요청 수(대화 하나당) */
const REMEMBERED_REQUESTS = 64;

/** 명령은 돌았는데 컨텍스트 기록이 실패한 요청을 기억하는 수(대화 하나당). 같은 requestId 재호출이 기록만 다시 한다 */
const RAN_WITHOUT_RECORD = 16;

/** `runUserShell`이 실행 전에 닫은 경우 레코드 `details.code`. 이 값이면 명령은 돌지 않았다 */
const NOT_RUN_CODES: ReadonlySet<string> = new Set(["not_executed", "tool_unavailable"]);

const RunSummarySchema = Type.Object({
  exitCode: Type.Integer(),
  output: Type.String(),
  truncated: Type.Boolean(),
  fullOutputPath: Type.Optional(Type.String()),
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(record: ToolResultRecord): string {
  return record.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
}

type Interpreted =
  | { readonly kind: "not_run"; readonly reason: string }
  | { readonly kind: "ran"; readonly result: UserBashResult };

/** 도구 결과 레코드를 `UserBashResult`로 옮긴다. 성공은 structuredContent, 0이 아닌 종료는 오류 상세(`detail`)에 실행 요약이 있다 */
function interpretShellRecord(record: ToolResultRecord): Interpreted {
  const details = record.details;
  const code = isRecord(details) ? details["code"] : undefined;
  if (record.isError && typeof code === "string" && NOT_RUN_CODES.has(code)) {
    return { kind: "not_run", reason: textOf(record) };
  }
  const direct = parse(RunSummarySchema, record.structuredContent);
  const nested = parse(RunSummarySchema, isRecord(details) ? details["detail"] : undefined);
  const summary = direct.ok ? direct.value : nested.ok ? nested.value : undefined;
  if (summary !== undefined) {
    return {
      kind: "ran",
      result: {
        output: summary.output,
        exitCode: summary.exitCode,
        cancelled: false,
        truncated: summary.truncated,
        ...(summary.fullOutputPath === undefined ? {} : { fullOutputPath: summary.fullOutputPath }),
      },
    };
  }
  // 요약이 없는 오류: 중단, 시간 초과, 실행기 오류. 본문을 출력으로 보이고 종료 코드는 모른다
  return {
    kind: "ran",
    result: {
      output: textOf(record),
      cancelled: record.isError && code === "aborted",
      truncated: false,
    },
  };
}

/** 모델 컨텍스트에 들어가는 문장. pi의 bashExecution 문장 모양을 따른다 */
function userBashText(command: string, result: UserBashResult): string {
  const lines = [`Ran \`${command}\``];
  lines.push(result.output.length > 0 ? result.output : "(no output)");
  if (result.cancelled) lines.push("(command cancelled)");
  else if (result.exitCode !== undefined && result.exitCode !== 0) {
    lines.push(`Command exited with code ${result.exitCode}`);
  }
  if (result.truncated) {
    lines.push(
      result.fullOutputPath === undefined
        ? "[Output truncated]"
        : `[Output truncated. Full output: ${result.fullOutputPath}]`,
    );
  }
  return lines.join("\n");
}

function hashPart(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface UserBashRunner {
  run(request: UserBashRequest): Promise<Result<UserBashOutcome, LoopError>>;
}

export function createUserBash(ctx: LoopContext): UserBashRunner {
  /** 대화별 요청 id → 진행 중이거나 끝난 결과. 재시작 뒤에는 사라진다 */
  const remembered = new Map<ThreadId, Map<string, Promise<Result<UserBashOutcome, LoopError>>>>();

  function rememberedFor(
    threadId: ThreadId,
  ): Map<string, Promise<Result<UserBashOutcome, LoopError>>> {
    const known = remembered.get(threadId);
    if (known !== undefined) return known;
    const created = new Map<string, Promise<Result<UserBashOutcome, LoopError>>>();
    remembered.set(threadId, created);
    return created;
  }

  /**
   * 대화별 요청 id → 명령은 끝났지만 컨텍스트 기록(`item.recorded`)이 아직 안 된 결과.
   * 기록 실패는 오류로 돌려주고 요청을 잊는다(같은 키로 다시 부르면 처음부터 한다). 그러나 명령은 이미 돌았으니 다시 돌리면 효과가 두 번이다.
   * 그래서 돈 결과를 여기에 두고, 같은 requestId 재호출은 실행·`input.bash.before` 발화를 건너뛰고 기록만 다시 한다
   */
  const ranOnly = new Map<ThreadId, Map<string, { result: UserBashResult; replaced: boolean }>>();

  function ranOnlyFor(
    threadId: ThreadId,
  ): Map<string, { result: UserBashResult; replaced: boolean }> {
    const known = ranOnly.get(threadId);
    if (known !== undefined) return known;
    const created = new Map<string, { result: UserBashResult; replaced: boolean }>();
    ranOnly.set(threadId, created);
    return created;
  }

  /** 돈 결과를 기록한다. 실패하면 결과를 `ranOnly`에 남겨 재호출이 기록만 다시 하게 하고, 성공하면 지운다 */
  function recordRan(
    request: UserBashRequest,
    requestId: string,
    result: UserBashResult,
    replaced: boolean,
  ): Result<UserBashOutcome, LoopError> {
    const pending = ranOnlyFor(request.threadId);
    if (!request.excludeFromContext) {
      const recorded = recordInContext(request, requestId, result, replaced);
      if (!recorded.ok) {
        pending.set(requestId, { result, replaced });
        if (pending.size > RAN_WITHOUT_RECORD) {
          const oldest = pending.keys().next();
          if (!oldest.done) pending.delete(oldest.value);
        }
        return recorded;
      }
    }
    pending.delete(requestId);
    return ok({ status: "completed", result, replaced });
  }

  function runContext(request: UserBashRequest): ToolRunContext {
    const signal = request.signal ?? new AbortController().signal;
    return {
      threadId: request.threadId,
      turnId: ctx.ids.next("trn"),
      stepId: ctx.ids.next("stp"),
      caller: "main",
      depth: 0,
      interactive: true,
      surfaceThreadId: request.threadId,
      signal,
      drafts: {
        // 사용자 셸은 toolResult item도 승인 대기도 만들지 않는다(L1.tools.spec §3.3 runUserShell)
        toolResultItem: () => {
          throw new Bug("loop.user_bash_has_no_tool_result_item");
        },
        waitingCheckpoint: () => {
          throw new Bug("loop.user_bash_cannot_wait_for_approval");
        },
      },
    };
  }

  /** 컨텍스트에 넣을 결과를 custom item으로 기록한다. 같은 요청 id는 한 번만 기록된다 */
  function recordInContext(
    request: UserBashRequest,
    requestId: string,
    result: UserBashResult,
    replaced: boolean,
  ): Result<void, LoopError> {
    const itemId = ctx.ids.next("itm");
    const details: JsonValue = {
      command: request.command,
      cancelled: result.cancelled,
      truncated: result.truncated,
      replaced,
      ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    };
    const message: XeonCustomMessage = {
      role: "custom",
      customType: USER_BASH_CUSTOM_TYPE,
      content: userBashText(request.command, result),
      display: true,
      details,
      timestamp: ctx.clock.now(),
    };
    const draft = ctx.drafter.make(
      "item.recorded",
      { item: { itemId, status: "completed", kind: "custom", message } },
      { threadId: request.threadId, turnId: null, stepId: null },
    );
    const key = `ubash:${commitKeyPart(requestId, hashPart)}`;
    const committed = commitWithRetry(ctx.session, {
      threadId: request.threadId,
      requestId: key,
      fingerprintSource: { kind: "user_bash", threadId: request.threadId, requestId },
      build: (view) =>
        view.threadStatus === "absent"
          ? { kind: "reject", code: "thread_not_found", detail: null }
          : { kind: "append", drafts: [draft], checkpoint: null },
    });
    if (committed.ok) return ok(undefined);
    const failure = committed.error;
    if (failure.kind === "store") return err(failure.error);
    if (failure.kind === "rejected" && failure.code === "thread_not_found") {
      return err({ kind: "thread_not_found", threadId: request.threadId });
    }
    return err({ kind: "input_invalid", message: describeCommitFailure(failure) });
  }

  async function execute(
    request: UserBashRequest,
    requestId: string,
  ): Promise<Result<UserBashOutcome, LoopError>> {
    const summary = ctx.session.query.thread(request.threadId);
    if (!summary.ok) return err(summary.error);
    if (summary.value === undefined) {
      return err({ kind: "thread_not_found", threadId: request.threadId });
    }
    if (summary.value.status === "closed") {
      return err({ kind: "input_invalid", message: "thread is closed" });
    }
    const ran = ranOnly.get(request.threadId)?.get(requestId);
    if (ran !== undefined) return recordRan(request, requestId, ran.result, ran.replaced);

    // input.bash.before(first): 실패는 거부로 본다(fail-closed, 도구 호출의 tool.call.before 지점과 같다)
    const fired = await attemptAsync(() =>
      ctx.ext.dispatch(
        "input.bash.before",
        {
          command: request.command,
          excludeFromContext: request.excludeFromContext,
          cwd: ctx.workingDirectory?.(request.threadId) ?? "",
        },
        {
          threadId: request.threadId,
          dispatchKey: `user_bash:${requestId}`,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        },
      ),
    );
    if (!fired.ok) {
      ctx.logger.warn("loop.user_bash_dispatch_failed", {
        threadId: request.threadId,
        requestId,
        cause: fired.error.cause instanceof Error ? fired.error.cause.message : "unknown",
      });
      return ok({
        status: "denied",
        reason: "A input.bash.before handler failed, so the command was not run.",
      });
    }
    const decision = fired.value.decision;
    if (decision?.type === "deny") return ok({ status: "denied", reason: decision.reason });
    if (decision?.type === "result") {
      return recordRan(request, requestId, decision.result, true);
    }

    const record = await ctx.tools.runUserShell(
      { command: request.command, includeInContext: !request.excludeFromContext },
      runContext(request),
    );
    const interpreted = interpretShellRecord(record);
    if (interpreted.kind === "not_run") return ok({ status: "denied", reason: interpreted.reason });
    return recordRan(request, requestId, interpreted.result, false);
  }

  return {
    run(request) {
      const requestId = request.requestId ?? ctx.ids.next("evt");
      if (requestId.length < 1 || requestId.length > 64) {
        return Promise.resolve(
          err({ kind: "input_invalid", message: "requestId must be 1-64 characters" }),
        );
      }
      if (request.command.trim().length === 0) {
        return Promise.resolve(err({ kind: "input_invalid", message: "command is empty" }));
      }
      const byRequest = rememberedFor(request.threadId);
      const known = byRequest.get(requestId);
      if (known !== undefined) return known;
      const started = execute(request, requestId);
      byRequest.set(requestId, started);
      // 실패(저장소, 없는 대화)는 기억하지 않는다. 같은 키로 다시 부르면 처음부터 한다
      detach(
        started.then((result) => {
          if (!result.ok) byRequest.delete(requestId);
          return undefined;
        }),
        (cause) => {
          ctx.logger.warn("loop.user_bash_forget_failed", {
            cause: cause instanceof Error ? cause.message : "unknown",
          });
        },
      );
      if (byRequest.size > REMEMBERED_REQUESTS) {
        const oldest = byRequest.keys().next();
        if (!oldest.done) byRequest.delete(oldest.value);
      }
      return started;
    },
  };
}
