import { commandListView, slashLineOf, slashStepOf, type SlashLine } from "@xeon/client/settings";
import { assertNever, attemptAsync, err, ok, type Result } from "@xeon/contracts";
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

  /** 쓰기 소유를 다른 프로세스가 쥐었다면 대화 상자가 대안을 묻는다. 호출한 입력창에도 오류는 그대로 돌려준다 */
  const showLockedIfLocked = (threadId: ThreadId, error: CommandError): void => {
    if (error.kind === "locked") {
      ui.actions.showLocked({ threadId, ownerKind: error.ownerKind, options: error.options });
    }
  };

  const startTurn = async (
    threadId: ThreadId,
    text: string,
    requestId: string,
  ): Promise<Result<null, CommandError>> => {
    const started = await withConnection((c) =>
      c.request("turn.start", { threadId, input: text, requestId }),
    );
    if (!started.ok) {
      showLockedIfLocked(threadId, started.error);
      return started;
    }
    ui.actions.setObserving(threadId, false);
    return ok(null);
  };

  /**
   * 슬래시 명령 줄을 `command.run`으로 보내고 결과를 한 걸음으로 옮긴다(`slashStepOf`). 명령이 아니거나(`not_command`) 호스트에 `command.run`이
   * 없으면(오래된 엔진) 줄을 대화 입력으로 보낸다.
   */
  const runSlash = async (
    threadId: ThreadId,
    line: SlashLine,
    requestId: string,
    confirmed: boolean,
  ): Promise<Result<null, CommandError>> => {
    const ran = await withConnection((c) =>
      c.request("command.run", {
        threadId,
        text: line.text,
        ...(confirmed ? { confirmShell: true } : {}),
      }),
    );
    if (!ran.ok) {
      if (ran.error.kind === "unsupported") return startTurn(threadId, line.text, requestId);
      showLockedIfLocked(threadId, ran.error);
      return ran;
    }
    const step = slashStepOf(ran.value);
    switch (step.kind) {
      case "chat":
        return startTurn(threadId, line.text, requestId);
      case "send":
        return startTurn(threadId, step.text, requestId);
      case "confirm":
        ui.actions.askShellConfirm({
          threadId,
          name: step.name,
          commands: step.commands,
          text: line.text,
          requestId,
        });
        return ok(null);
      case "show":
        ui.actions.showCommandOutput({
          threadId,
          name: step.name,
          message: step.message,
          result: step.result,
        });
        return ok(null);
      default:
        return assertNever(step, "SlashStep");
    }
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
      // `/`로 시작하는 줄은 엔진에 등록한 슬래시 명령일 수 있다(`/helm`, `/learning`): 대화 입력이 아니라 `command.run`으로 먼저 보낸다
      const line = slashLineOf(text);
      if (line === null) return startTurn(threadId, text, requestId);
      return runSlash(threadId, line, requestId, false);
    },
    async confirmShell() {
      const pending = ui.read.getState().shellConfirm;
      if (pending === null) return ok(null);
      ui.actions.clearShellConfirm();
      const line = slashLineOf(pending.text);
      if (line === null) return ok(null);
      return runSlash(pending.threadId, line, pending.requestId, true);
    },
    cancelShell: () => ui.actions.clearShellConfirm(),
    dismissCommandOutput: () => ui.actions.dismissCommandOutput(),
    async commandList(threadId) {
      const listed = await withConnection((c) =>
        c.request("command.list", threadId === null ? {} : { threadId }),
      );
      return listed.ok ? ok(commandListView(listed.value)) : listed;
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
