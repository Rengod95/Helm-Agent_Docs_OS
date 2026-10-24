import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import { WireError } from "@xeon/contracts/wire";
import {
  buildDiagnostics,
  type AppVersions,
  type ApplyNote,
  type EngineStore,
} from "../state/engine/index.ts";
import type { Journal } from "../state/shared/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { ApprovalDecision, CommandError, Commands } from "../views/commands.ts";
import type { Session } from "./session.ts";

export type CommandDeps = {
  readonly session: Session;
  readonly engine: EngineStore;
  readonly ui: UiStore;
  readonly journal: Journal<ApplyNote>;
  readonly versions: () => AppVersions;
  readonly clipboard: { writeText(text: string): Promise<void> };
};

function errorOf(cause: unknown): CommandError {
  return cause instanceof WireError ? { kind: "rejected", code: cause.code } : { kind: "failed" };
}

export function createCommands(deps: CommandDeps): Commands {
  const { session, engine, ui } = deps;

  const withConnection = async <T>(
    run: (connection: NonNullable<ReturnType<Session["connection"]>>) => Promise<T>,
  ): Promise<Result<T, CommandError>> => {
    const connection = session.connection();
    if (connection === null) return err({ kind: "offline" });
    const result = await attemptAsync(() => run(connection));
    return result.ok ? ok(result.value) : err(errorOf(result.error.cause));
  };

  return {
    selectThread(threadId) {
      // 이전 thread의 진행 조각이 새 thread 화면의 첫 커밋과 섞이지 않게 큐를 먼저 비운다(design 8절)
      engine.flush();
      ui.actions.selectThread(threadId);
      session.link()?.openThread(threadId);
    },
    async createThread() {
      const created = await withConnection((c) => c.request("thread.create", {}));
      if (!created.ok) return created;
      // 목록에는 thread.started 이벤트가 들어온다. 선택은 화면 상태라 바로 한다
      engine.flush();
      ui.actions.selectThread(created.value.threadId);
      session.link()?.openThread(created.value.threadId);
      return ok(null);
    },
    async sendTurn(threadId, text, requestId) {
      const started = await withConnection((c) =>
        c.request("turn.start", { threadId, input: text, requestId }),
      );
      return started.ok ? ok(null) : started;
    },
    async interrupt(threadId) {
      const done = await withConnection((c) => c.request("turn.interrupt", { threadId }));
      return done.ok ? ok(null) : done;
    },
    async respondApproval(approvalId: EventId, response: ApprovalDecision) {
      ui.actions.approvalSending(approvalId);
      const sent = await withConnection((c) =>
        c.request(
          "approval.respond",
          response.decision === "answer"
            ? { approvalId, decision: "answer", answer: response.answer }
            : {
                approvalId,
                decision: response.decision,
                ...(response.remember === undefined ? {} : { remember: response.remember }),
              },
        ),
      );
      // 대기열에서 빠지는 일은 approval.resolved 이벤트가 한다. 여기서는 보낸 결과 표시만 고친다
      if (!sent.ok || !sent.value.applied) ui.actions.approvalFailed(approvalId);
    },
    reloadThreads: () => session.link()?.reloadThreads(),
    retryTranscript() {
      const id: ThreadId | null = ui.read.getState().selectedThreadId;
      if (id !== null) session.link()?.openThread(id);
    },
    reconnect: () => session.reconnect(),
    async restartEngine() {
      const restarted = await session.restartEngine();
      if (!restarted) session.reconnect();
    },
    async copyDiagnostics() {
      engine.flush();
      const bundle = buildDiagnostics(
        engine.read.getState(),
        deps.journal.entries(),
        deps.versions(),
      );
      const written = await attemptAsync(() => deps.clipboard.writeText(JSON.stringify(bundle)));
      return written.ok;
    },
  };
}
