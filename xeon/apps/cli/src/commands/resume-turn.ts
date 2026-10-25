import { assertNever, attemptAsync } from "@xeon/contracts";
import type { ThreadResumable, TurnResumeResult } from "@xeon/contracts/wire";
import type { EngineHandle } from "../engine.ts";
import { failureOfCaught, renderFailure } from "../errors.ts";
import type { PromptIo } from "../render/approval.ts";
import { findThreadSummary } from "../threads.ts";
import type { ChatSession } from "./chat-session.ts";

// L4.cli.spec §4.4 "끊긴 turn". 열린 세션의 thread.list 요약에 resumable이 있으면 사용자에게 묻고, 확인하면 turn.resume을 부른다.
// 호스트는 자동 재개를 하지 않는다(F wire §3.3.1 [결정: m2c G1-02]).

/** 묻는 글. 시작 시각과 재시도 횟수를 보인다 */
export function describeResumable(resumable: ThreadResumable): string {
  const attempts =
    resumable.resumeAttempts === 0
      ? ""
      : `, 이어 실행을 ${String(resumable.resumeAttempts)}번 시도했다`;
  return `이 세션에 끊긴 turn이 있다 (시작 ${resumable.runningSince}${attempts})\n`;
}

/** 이어 실행 결과를 사람이 읽는 한 줄로 */
export function resumeResultText(result: TurnResumeResult): string {
  switch (result.status) {
    case "resumed":
      return `이어서 실행한다 (${result.from} 단계부터)\n`;
    case "closed":
      return result.reason === "abort_requested"
        ? "중단 요청이 있었던 turn이라 이어 실행하지 않고 닫았다\n"
        : "소유자가 취소한 turn이라 이어 실행하지 않고 닫았다\n";
    case "nothing":
      return "이어서 실행할 turn이 없다\n";
    default:
      return assertNever(result, "TurnResumeResult");
  }
}

/**
 * 열린 세션에 끊긴 turn이 있으면 묻고 이어 실행한다. 지원하지 않는 호스트나 목록을 읽지 못한 경우는 조용히 지나간다(대화를 막지 않는다).
 * 이어 실행한 turn이 끝날 때까지, 또는 종료 요청(`exitRequested`)이 올 때까지 기다린다. 종료 요청이 왔으면 true다
 */
export async function offerTurnResume(options: {
  readonly handle: EngineHandle;
  readonly workspace: string;
  readonly session: ChatSession;
  readonly io: PromptIo & { stderr(text: string): Promise<void> };
  readonly signal: AbortSignal;
  readonly exitRequested: Promise<unknown>;
}): Promise<boolean> {
  const { handle, session, io } = options;
  if (session.readOnly || !handle.supports("turn.resume")) return false;
  const listed = await attemptAsync(() =>
    findThreadSummary(handle.connection, options.workspace, session.threadId),
  );
  const resumable = listed.ok ? (listed.value?.resumable ?? null) : null;
  if (resumable === null) return false;
  await io.stdout(describeResumable(resumable));
  const answer = await io.readLine("이어서 실행할까요? [y/N] ", options.signal);
  const text = answer?.trim().toLowerCase() ?? "";
  if (text !== "y" && text !== "yes") {
    await io.stdout("이어서 실행하지 않았다\n");
    return false;
  }
  const resumed = await attemptAsync(() => session.resumeTurn());
  if (!resumed.ok) {
    const failure = failureOfCaught(resumed.error.cause);
    if (failure === undefined) throw resumed.error.cause;
    await io.stderr(renderFailure(failure));
    return false;
  }
  await io.stdout(resumeResultText(resumed.value.result));
  if (resumed.value.done === null) return false;
  const outcome = await Promise.race([
    resumed.value.done.then(() => "done" as const),
    options.exitRequested.then(() => "exit" as const),
  ]);
  return outcome === "exit";
}
