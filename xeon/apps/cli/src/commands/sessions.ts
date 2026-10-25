import { assertNever, attemptAsync, err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  EventsBatchParams,
  EventWire,
  HostConnection,
  StoreId,
  ThreadListResult,
  ThreadSummary,
} from "@xeon/contracts/wire";
import type { SessionsCommand } from "../cli/command.ts";
import type { EngineHandle } from "../engine.ts";
import { renderFailure, type Failure } from "../errors.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { applyBatch, initialTranscript } from "../render/model.ts";
import type { RenderOp } from "../render/ops.ts";
import { createTextSink } from "../render/text-sink.ts";
import { withEngine, type CommandContext } from "./context.ts";

// L4.cli.spec §3.1 sessions. ls는 thread.list, show는 events.subscribe(filter threadIds)와 events.unsubscribe,
// fork는 thread.fork, rm은 thread.delete다.

const PAGE_SIZE = 200;

function flagsOf(thread: ThreadSummary): string {
  const flags: string[] = [];
  if (thread.resumable !== null) flags.push("이어서 실행 가능");
  if (thread.pendingApprovals > 0) flags.push(`승인 대기 ${String(thread.pendingApprovals)}`);
  if (thread.queuedInputs > 0) flags.push(`대기 입력 ${String(thread.queuedInputs)}`);
  if (thread.forkedFrom !== null) flags.push(`분기: ${thread.forkedFrom.threadId}`);
  return flags.length === 0 ? "" : `  [${flags.join(", ")}]`;
}

/** 목록 한 줄: id, 마지막 이벤트 시각, 상태, 제목 */
function formatThreadLine(thread: ThreadSummary): string {
  const title = thread.title ?? "(제목 없음)";
  return `${thread.threadId}  ${thread.updatedAt}  ${thread.status}  ${title}${flagsOf(thread)}`;
}

/** thread.list를 limit개가 찰 때까지 쪽 단위로 읽는다 */
async function listThreads(
  connection: HostConnection,
  workspace: string | null,
  limit: number,
): Promise<readonly ThreadSummary[]> {
  const found: ThreadSummary[] = [];
  let cursor: string | null = null;
  while (found.length < limit) {
    const want = Math.min(PAGE_SIZE, limit - found.length);
    // oxlint-disable-next-line no-await-in-loop -- 쪽은 앞 쪽의 cursor가 있어야 읽을 수 있다 (L4.cli.spec §3.1)
    const page: ThreadListResult = await connection.request("thread.list", {
      limit: want,
      ...(workspace === null ? {} : { workspace }),
      ...(cursor === null ? {} : { cursor }),
    });
    found.push(...page.threads);
    if (page.nextCursor === null || page.threads.length === 0) break;
    cursor = page.nextCursor;
  }
  return found.slice(0, limit);
}

async function runLs(
  ctx: CommandContext,
  command: Extract<SessionsCommand, { kind: "sessions.ls" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const threads = await listThreads(
      handle.connection,
      command.all ? null : ctx.workspace,
      command.limit,
    );
    if (command.output === "json") {
      await ctx.io.stdout(`${JSON.stringify(threads, null, 2)}\n`);
    } else if (threads.length === 0) {
      await ctx.io.stderr(
        command.all ? "세션이 없다\n" : "이 작업 폴더의 세션이 없다 (--all로 전체를 본다)\n",
      );
    } else {
      await ctx.io.stdout(`${threads.map(formatThreadLine).join("\n")}\n`);
    }
    return EXIT.ok;
  });
}

interface ReadOutcome {
  readonly events: readonly EventWire[];
  readonly ops: readonly RenderOp[];
}

/** 세션의 내구 이벤트를 처음부터 머리(headSeq)까지 읽는다. 구독은 읽은 뒤 해제한다 */
async function readThread(
  handle: EngineHandle,
  threadId: ThreadId,
  width: number,
): Promise<Result<ReadOutcome, Failure>> {
  const { connection } = handle;
  const done = Promise.withResolvers<void>();
  const state: {
    transcript: ReturnType<typeof initialTranscript>;
    started: boolean;
    head: number;
    storeId: StoreId;
    sub: string | null;
    gap: string | null;
  } = {
    transcript: initialTranscript(null),
    started: false,
    head: 0,
    storeId: handle.storeId,
    sub: null,
    gap: null,
  };
  const events: EventWire[] = [];
  const ops: RenderOp[] = [];
  const buffered: EventsBatchParams[] = [];

  const apply = (batch: EventsBatchParams): void => {
    const applied = applyBatch(state.transcript, batch, state.storeId, { width });
    if (!applied.ok) {
      state.gap = `이벤트 구간이 이어지지 않는다 (${String(applied.error.expectedFrom)} 다음에 ${String(applied.error.got)})`;
      done.resolve();
      return;
    }
    state.transcript = applied.value.state;
    events.push(...batch.events);
    ops.push(...applied.value.ops);
  };
  const settle = (): void => {
    const position = state.transcript.position;
    if (state.started && position !== null && position.seq >= state.head) done.resolve();
  };
  const off = connection.onNotification("events.batch", (batch) => {
    if (!state.started) {
      buffered.push(batch);
      return;
    }
    if (batch.sub === state.sub) apply(batch);
    settle();
  });
  try {
    const subscribed = await connection.request("events.subscribe", {
      from: { storeId: handle.storeId, seq: 0 },
      filter: { threadIds: [threadId] },
    });
    state.sub = subscribed.sub;
    state.head = subscribed.headSeq;
    state.storeId = subscribed.storeId;
    state.transcript = initialTranscript({ storeId: subscribed.storeId, seq: subscribed.start });
    state.started = true;
    for (const batch of buffered.splice(0)) if (batch.sub === state.sub) apply(batch);
    settle();
    // 머리까지 받을 것이 없으면(빈 저장소) 바로 끝난다
    if (state.head <= subscribed.start) done.resolve();
    await done.promise;
  } finally {
    off();
    const sub = state.sub;
    // 구독 해제 실패는 읽은 결과를 바꾸지 않는다: 연결을 닫으면 구독도 끝난다
    if (sub !== null) await attemptAsync(() => connection.request("events.unsubscribe", { sub }));
  }
  if (state.gap !== null) {
    return err({ message: state.gap, fix: "다시 실행한다. 계속되면 보고한다", code: EXIT.error });
  }
  if (events.length === 0) {
    return err({
      message: `세션 ${threadId}이(가) 없다`,
      fix: "xeon sessions ls로 id를 확인한다",
      code: EXIT.error,
    });
  }
  return ok({ events, ops });
}

async function runShow(
  ctx: CommandContext,
  command: Extract<SessionsCommand, { kind: "sessions.show" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const read = await readThread(handle, command.threadId, ctx.io.terminal.columns ?? 80);
    if (!read.ok) {
      await ctx.io.stderr(renderFailure(read.error));
      return read.error.code;
    }
    if (command.output === "json") {
      await ctx.io.stdout(`${JSON.stringify(read.value.events, null, 2)}\n`);
      return EXIT.ok;
    }
    const sink = createTextSink({
      stdout: ctx.io.stdout,
      stderr: ctx.io.stderr,
      layout: "full",
      color: ctx.global.color && ctx.io.terminal.stdoutIsTty,
    });
    await sink.write(read.value.ops);
    return EXIT.ok;
  });
}

async function runFork(
  ctx: CommandContext,
  command: Extract<SessionsCommand, { kind: "sessions.fork" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    const forked = await handle.connection.request("thread.fork", {
      threadId: command.threadId,
      ...(command.at === null ? {} : { at: command.at }),
    });
    await ctx.io.stdout(`${forked.threadId}\n`);
    return EXIT.ok;
  });
}

async function confirmed(ctx: CommandContext, question: string): Promise<boolean> {
  const answer = await ctx.io.readLine(`${question} [y/N] `, new AbortController().signal);
  const text = answer?.trim().toLowerCase() ?? "";
  return text === "y" || text === "yes";
}

async function runRm(
  ctx: CommandContext,
  command: Extract<SessionsCommand, { kind: "sessions.rm" }>,
): Promise<ExitCode> {
  if (!command.yes) {
    if (!ctx.io.terminal.stdinIsTty) {
      await ctx.io.stderr(
        renderFailure({
          message: "터미널이 아니라서 삭제를 확인할 수 없다",
          fix: "xeon sessions rm <id> --yes",
        }),
      );
      return EXIT.usage;
    }
    if (!(await confirmed(ctx, `세션 ${command.threadId}을(를) 지울까요?`))) {
      await ctx.io.stderr("지우지 않았다\n");
      return EXIT.error;
    }
  }
  return withEngine(ctx, async (handle) => {
    await handle.connection.request("thread.delete", { threadId: command.threadId });
    await ctx.io.stdout(`지웠다: ${command.threadId}\n`);
    return EXIT.ok;
  });
}

async function runRename(
  ctx: CommandContext,
  command: Extract<SessionsCommand, { kind: "sessions.rename" }>,
): Promise<ExitCode> {
  return withEngine(ctx, async (handle) => {
    await handle.connection.request("thread.rename", {
      threadId: command.threadId,
      title: command.title,
    });
    await ctx.io.stdout(`이름을 바꿨다: ${command.threadId}  ${command.title}\n`);
    return EXIT.ok;
  });
}

export async function runSessions(
  ctx: CommandContext,
  command: SessionsCommand,
): Promise<ExitCode> {
  switch (command.kind) {
    case "sessions.ls":
      return runLs(ctx, command);
    case "sessions.show":
      return runShow(ctx, command);
    case "sessions.fork":
      return runFork(ctx, command);
    case "sessions.rm":
      return runRm(ctx, command);
    case "sessions.rename":
      return runRename(ctx, command);
    default:
      return assertNever(command, "SessionsCommand");
  }
}
