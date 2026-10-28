import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import type { EventId, ThreadId } from "@xeon/contracts/conversation";
import {
  buildDiagnostics,
  type AppVersions,
  type ApplyNote,
  type EngineStore,
} from "../state/engine/index.ts";
import type { Journal } from "../state/shared/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type { ApprovalDecision, CommandError, Commands } from "../views/commands.ts";
import { approvalFailureOf } from "./approval-outcome.ts";
import { errorOf } from "./command-error.ts";
import { createSetupCommands } from "./setup.ts";
import type { Session } from "./session.ts";
import type { DesktopIpc } from "../transport/ipc.ts";

export type CommandDeps = {
  readonly session: Session;
  /** 키 등록(`registerSecret`)만 쓴다. 나머지 셸 명령은 세션이 맡는다 */
  readonly ipc: Pick<DesktopIpc, "registerSecret">;
  readonly engine: EngineStore;
  readonly ui: UiStore;
  readonly journal: Journal<ApplyNote>;
  readonly versions: () => AppVersions;
  readonly clipboard: { writeText(text: string): Promise<void> };
};

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
    async createThread(workspace) {
      const created = await withConnection((c) =>
        c.request("thread.create", workspace === undefined ? {} : { workspace }),
      );
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
      if (!started.ok) {
        // 다른 프로세스가 쓰기 소유를 쥐었다면 대화 상자가 대안을 묻는다. 호출한 입력창에도 오류는 그대로 돌려준다
        if (started.error.kind === "locked") {
          ui.actions.showLocked({
            threadId,
            ownerKind: started.error.ownerKind,
            options: started.error.options,
          });
        }
        return started;
      }
      ui.actions.setObserving(threadId, false);
      return ok(null);
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
      const failure = approvalFailureOf(sent, response.decision);
      if (failure !== null) ui.actions.approvalFailed(approvalId, failure.kind, failure.detail);
    },
    trust: {
      status: (workspace) => withConnection((c) => c.request("trust.get", { workspace })),
      decide: (workspace, choice) =>
        withConnection((c) => c.request("trust.decide", { workspace, choice })),
    },
    setup: createSetupCommands(
      withConnection,
      (listener) => {
        const connection = session.connection();
        return connection === null
          ? () => {}
          : connection.onNotification("settings.invalidated", (params) => {
              // 모델 키와 기본 모델 키만 화면에 영향이 있다. 키 목록이 비면 전체 무효화로 본다
              const keys = params.keys;
              if (keys.length === 0 || keys.some((key) => key.startsWith("l1.models."))) listener();
            });
      },
      deps.ipc,
    ),
    async observeThread(threadId) {
      const opened = await withConnection((c) =>
        c.request("thread.open", { threadId, mode: "observe" }),
      );
      if (!opened.ok) return opened;
      ui.actions.setObserving(threadId, true);
      ui.actions.dismissLocked();
      return ok(null);
    },
    async forkThread(threadId) {
      const forked = await withConnection((c) => c.request("thread.fork", { threadId }));
      if (!forked.ok) return forked;
      ui.actions.dismissLocked();
      // 목록에는 thread.started 이벤트가 들어온다. 선택은 화면 상태라 바로 한다
      engine.flush();
      ui.actions.selectThread(forked.value.threadId);
      session.link()?.openThread(forked.value.threadId);
      return ok(null);
    },
    dismissLocked: () => ui.actions.dismissLocked(),
    retryWrite: (threadId) => ui.actions.setObserving(threadId, false),
    showScreen: (screen) => ui.actions.showScreen(screen),
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
