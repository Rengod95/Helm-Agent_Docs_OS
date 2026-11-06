import {
  commandListView,
  slashLineOf,
  slashStepOf,
  type SlashLine,
} from "@fresnel/client/settings";
import {
  assertNever,
  attemptAsync,
  detach,
  err,
  ok,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import type { EventId, ThreadId } from "@fresnel/contracts/conversation";
import {
  buildDiagnostics,
  type AppVersions,
  type ApplyNote,
  type EngineStore,
} from "../state/engine/index.ts";
import type { Journal } from "../state/shared/index.ts";
import type { UiStore } from "../state/ui/index.ts";
import type {
  ApprovalDecision,
  AttachmentParts,
  BusyInputMode,
  CommandError,
  Commands,
} from "../views/commands.ts";
import { turnInputOf } from "../views/attachment-model.ts";
import { collectExport } from "../views/export-model.ts";
import {
  PERMISSION_MODE_KEY,
  modeChangeConcerns,
  modeEventConcerns,
} from "../views/permission-mode-model.ts";
import { approvalFailureOf } from "./approval-outcome.ts";
import { errorOf } from "./command-error.ts";
import { createConnectionCommands } from "./connection.ts";
import { createScheduleCommands } from "./schedule.ts";
import { createRestoreCommands } from "./restore.ts";
import { createSecretCommands } from "./secrets.ts";
import { createSettingsCommands } from "./settings.ts";
import { createWebCommands } from "./web.ts";
import { createProposalCommands } from "./proposals.ts";
import { createWorkCommands } from "./work.ts";
import { createReviewCommands } from "./review.ts";
import { createMemoryCommands } from "./memory.ts";
import { createSkillCommands } from "./skills.ts";
import { createSetupCommands } from "./setup.ts";
import { createMeasureCommands } from "./measure-commands.ts";
import { createUsageCommands } from "./usage.ts";
import { createTestCommands } from "./tests-commands.ts";
import { createWorkbenchCommands, subscribeExtChanges } from "./workbench-commands.ts";
import type { Session } from "./session.ts";
import type { DesktopIpc } from "../transport/ipc.ts";
import { LOCAL, type LocalSettings } from "../settings-store/index.ts";
import type { EngineSwitch } from "./engine-switch.ts";

export type CommandDeps = {
  readonly session: Session;
  /** 키 등록(`registerSecret`), 엔진 대상 바꾸기(`retarget`), 데이터 복원(`dbRestore`)만 쓴다. 나머지 셸 명령은 세션이 맡는다 */
  readonly ipc: Pick<DesktopIpc, "registerSecret" | "retarget" | "dbRestore">;
  /** 데스크톱 로컬 설정. 원격 대상 목록을 읽고 쓴다(연결 화면) */
  readonly local: Pick<LocalSettings, "load" | "get" | "set">;
  readonly engine: EngineStore;
  readonly ui: UiStore;
  readonly journal: Journal<ApplyNote>;
  readonly versions: () => AppVersions;
  readonly clipboard: { writeText(text: string): Promise<void> };
  /** 엔진 대상을 바꾸는 동안 쓰기를 보류한다(W-08) */
  readonly engineSwitch: EngineSwitch;
  /** 안전 모드 상태 읽기가 실패하면 원인을 남긴다(`setup.loadSafeMode`) */
  readonly logger: Pick<Logger, "warn">;
};

/** 첨부 크기 상한 설정 키(L2.dialog, 호스트 값) */
const ATTACHMENT_LIMIT_KEY = "l2.dialog.attachments.maxBytes";

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

  /** 쓰기 명령 전용. 엔진 대상을 바꾸는 중이면 연결을 건드리지 않고 `switching`으로 거절한다 */
  const withWriteConnection = async <T>(
    run: (connection: NonNullable<ReturnType<Session["connection"]>>) => Promise<T>,
  ): Promise<Result<T, CommandError>> =>
    deps.engineSwitch.held() ? err({ kind: "switching" }) : withConnection(run);

  /** 쓰기 소유를 다른 프로세스가 쥐었다면 대화 상자가 대안을 묻는다. 호출한 입력창에도 오류는 그대로 돌려준다 */
  const showLockedIfLocked = (threadId: ThreadId, error: CommandError): void => {
    if (error.kind === "locked") {
      ui.actions.showLocked({ threadId, ownerKind: error.ownerKind, options: error.options });
    }
  };

  /**
   * 보던 대화를 떠난다(HS-27). 호스트에 `thread.close`를 보내 이 연결의 쓰기 소유 기록을 지우면, turn이 돌지 않을 때 호스트가 쓰기 소유를
   * 놓아 CLI가 이어 쓸 수 있다. 실패해도 화면 전환은 막지 않는다
   */
  const leaveSelected = (next: ThreadId | null): void => {
    const previous = ui.read.getState().selectedThreadId;
    if (previous === null || previous === next) return;
    detach(
      withConnection((c) => c.request("thread.close", { threadId: previous })),
      () => {},
    );
  };

  const startTurn = async (
    threadId: ThreadId,
    text: string,
    requestId: string,
    attachments: AttachmentParts = [],
    whenBusy: BusyInputMode = "followUp",
  ): Promise<Result<null, CommandError>> => {
    const input = attachments.length === 0 ? text : turnInputOf(text, attachments);
    const started = await withWriteConnection((c) =>
      // 실행 중이면 입력은 whenBusy 자리의 큐에 들어가 칩이 된다(F.wire-settings §3.3.1 0a). 기본은 followUp(끝난 뒤)이다. 이미 도는 turn이 없으면 whenBusy는 무시된다
      c.request("turn.start", { threadId, input, requestId, whenBusy }),
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
    whenBusy: BusyInputMode,
  ): Promise<Result<null, CommandError>> => {
    const ran = await withWriteConnection((c) =>
      c.request("command.run", {
        threadId,
        text: line.text,
        ...(confirmed ? { confirmShell: true } : {}),
      }),
    );
    if (!ran.ok) {
      if (ran.error.kind === "unsupported")
        return startTurn(threadId, line.text, requestId, [], whenBusy);
      showLockedIfLocked(threadId, ran.error);
      return ran;
    }
    const step = slashStepOf(ran.value);
    switch (step.kind) {
      case "chat":
        return startTurn(threadId, line.text, requestId, [], whenBusy);
      case "send":
        return startTurn(threadId, step.text, requestId, [], whenBusy);
      case "confirm":
        ui.actions.askShellConfirm({
          threadId,
          name: step.name,
          commands: step.commands,
          text: line.text,
          requestId,
          whenBusy,
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
      leaveSelected(threadId);
      // 이전 thread의 진행 조각이 새 thread 화면의 첫 커밋과 섞이지 않게 큐를 먼저 비운다(design 8절)
      engine.flush();
      ui.actions.selectThread(threadId);
      session.link()?.openThread(threadId);
    },
    async createThread(workspace) {
      const created = await withWriteConnection((c) =>
        c.request("thread.create", workspace === undefined ? {} : { workspace }),
      );
      if (!created.ok) return created;
      // 목록에는 thread.started 이벤트가 들어온다. 선택은 화면 상태라 바로 한다
      leaveSelected(created.value.threadId);
      engine.flush();
      ui.actions.selectThread(created.value.threadId);
      session.link()?.openThread(created.value.threadId);
      return ok(null);
    },
    async sendTurn(threadId, text, requestId, attachments, whenBusy = "followUp") {
      // 첨부가 있으면 슬래시 명령으로 풀지 않는다(첨부 파트가 명령 인자로 흘러가지 않게)
      if (attachments !== undefined && attachments.length > 0)
        return startTurn(threadId, text, requestId, attachments, whenBusy);
      // `/`로 시작하는 줄은 엔진에 등록한 슬래시 명령일 수 있다(`/helm`, `/learning`): 대화 입력이 아니라 `command.run`으로 먼저 보낸다
      const line = slashLineOf(text);
      if (line === null) return startTurn(threadId, text, requestId, [], whenBusy);
      return runSlash(threadId, line, requestId, false, whenBusy);
    },
    async confirmShell() {
      const pending = ui.read.getState().shellConfirm;
      if (pending === null) return ok(null);
      ui.actions.clearShellConfirm();
      const line = slashLineOf(pending.text);
      if (line === null) return ok(null);
      return runSlash(pending.threadId, line, pending.requestId, true, pending.whenBusy);
    },
    cancelShell: () => ui.actions.clearShellConfirm(),
    dismissCommandOutput: () => ui.actions.dismissCommandOutput(),
    async copyText(text) {
      const written = await attemptAsync(() => deps.clipboard.writeText(text));
      return written.ok;
    },
    async commandList(threadId) {
      const listed = await withConnection((c) =>
        c.request("command.list", threadId === null ? {} : { threadId }),
      );
      return listed.ok ? ok(commandListView(listed.value)) : listed;
    },
    addAttachment: (threadId, source) =>
      withWriteConnection((c) => c.request("attachments.add", { threadId, source })),
    async attachmentLimit() {
      const got = await withConnection((c) =>
        c.request("settings.get", { keys: [ATTACHMENT_LIMIT_KEY] }),
      );
      if (!got.ok) return null;
      const value = got.value.settings.find((s) => s.key === ATTACHMENT_LIMIT_KEY)?.value;
      return typeof value === "number" && value > 0 ? value : null;
    },
    async interrupt(threadId) {
      const done = await withWriteConnection((c) => c.request("turn.interrupt", { threadId }));
      return done.ok ? ok(null) : done;
    },
    async withdrawInput(threadId, requestId) {
      const done = await withWriteConnection((c) =>
        c.request("turn.withdraw", { threadId, requestId }),
      );
      if (!done.ok) showLockedIfLocked(threadId, done.error);
      return done.ok ? ok(done.value.withdrawn) : done;
    },
    compactThread: (threadId, instructions) =>
      withWriteConnection((c) =>
        c.request(
          "thread.compact",
          instructions === undefined ? { threadId } : { threadId, instructions },
        ),
      ),
    async renameThread(threadId, title) {
      const done = await withWriteConnection((c) =>
        c.request("thread.rename", { threadId, title }),
      );
      return done.ok ? ok(null) : done;
    },
    async setThreadModel(threadId, model) {
      const done = await withWriteConnection((c) =>
        c.request("thread.setModel", { threadId, model }),
      );
      if (!done.ok) showLockedIfLocked(threadId, done.error);
      return done.ok ? ok(null) : done;
    },
    async setThreadMode(threadId, mode) {
      const done = await withWriteConnection((c) =>
        c.request("settings.set", {
          key: PERMISSION_MODE_KEY,
          value: mode,
          scope: "launch",
          threadId,
        }),
      );
      if (!done.ok) showLockedIfLocked(threadId, done.error);
      return done.ok ? ok(null) : done;
    },
    async readThreadMode(threadId) {
      const got = await withConnection((c) =>
        c.request("settings.get", { keys: [PERMISSION_MODE_KEY], threadId }),
      );
      if (!got.ok) return got;
      return ok(got.value.settings.find((setting) => setting.key === PERMISSION_MODE_KEY)?.value);
    },
    onThreadModeChanged(threadId, listener) {
      const connection = session.connection();
      if (connection === null) return () => {};
      // 설정 쓰기는 `settings.invalidated`로, 계획 승인 같은 호스트 안의 세션 쓰기는 `events.batch`의 `settings.changed` 기록으로 온다
      const offSettings = connection.onNotification("settings.invalidated", (params) => {
        if (modeChangeConcerns(params, threadId)) listener();
      });
      const offEvents = connection.onNotification("events.batch", (params) => {
        if (modeEventConcerns(params, threadId)) listener();
      });
      return () => {
        offSettings();
        offEvents();
      };
    },
    listModels: () => withConnection((c) => c.request("models.list", {})),
    async closeThread(threadId) {
      const done = await withWriteConnection((c) => c.request("thread.close", { threadId }));
      return done.ok ? ok(null) : done;
    },
    async deleteThread(threadId) {
      const done = await withWriteConnection((c) => c.request("thread.delete", { threadId }));
      if (!done.ok) return done;
      // 지운 thread에는 이벤트가 오지 않는다. 열려 있었다면 선택을 풀고 목록을 다시 읽는다
      if (ui.read.getState().selectedThreadId === threadId) {
        ui.actions.selectThread(null);
        session.link()?.closeThread();
      }
      session.link()?.reloadThreads();
      return ok(null);
    },
    // 읽기라 쓰기 소유를 얻지 않는다. 첫 쪽은 `after`가 없고 그다음 쪽은 앞 `next`를 `after`로 받는다
    exportThread: (threadId, format) =>
      collectExport((after) =>
        withConnection((c) =>
          c.request(
            "thread.export",
            after === undefined ? { threadId, format } : { threadId, format, after },
          ),
        ),
      ),
    resumeTurn: (threadId) => withWriteConnection((c) => c.request("turn.resume", { threadId })),
    runCommandLine: (threadId, text) =>
      withWriteConnection((c) => c.request("command.run", { threadId, text })),
    paletteUses: () => deps.local.get(LOCAL.paletteUses) ?? {},
    async savePaletteUses(uses) {
      const written = await deps.local.set(LOCAL.paletteUses, uses);
      return written.ok;
    },
    lastThreadId() {
      const id = deps.local.get(LOCAL.lastThread);
      return id === undefined || id === "" ? null : id;
    },
    async saveLastThread(threadId) {
      const written = await deps.local.set(LOCAL.lastThread, threadId ?? "");
      return written.ok;
    },
    async respondApproval(approvalId: EventId, response: ApprovalDecision) {
      if (deps.engineSwitch.held()) {
        ui.actions.approvalFailed(approvalId, "switching");
        return;
      }
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
                ...(response.answer === undefined ? {} : { answer: response.answer }),
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
        withWriteConnection((c) => c.request("trust.decide", { workspace, choice })),
    },
    workbench: createWorkbenchCommands(withConnection, (listener) => {
      const connection = session.connection();
      return connection === null ? () => {} : subscribeExtChanges(connection, listener);
    }),
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
      deps.local,
      deps.logger,
    ),
    tests: createTestCommands(withConnection, withWriteConnection),
    measure: createMeasureCommands(withConnection),
    schedule: createScheduleCommands(withConnection),
    pluginUi: { withConnection, current: () => session.connection() },
    connection: createConnectionCommands({
      engineSwitch: deps.engineSwitch,
      local: deps.local,
      session,
      ui,
      run: withConnection,
    }),
    secrets: createSecretCommands({ session, ipc: deps.ipc, clipboard: deps.clipboard }),
    restore: createRestoreCommands({ ipc: deps.ipc, engineSwitch: deps.engineSwitch }),
    settings: createSettingsCommands({ session, ui, local: deps.local }),
    web: createWebCommands(withConnection),
    proposals: createProposalCommands(withConnection, withWriteConnection),
    work: createWorkCommands(withConnection, withWriteConnection),
    review: createReviewCommands(withConnection),
    skills: createSkillCommands(withConnection),
    memory: createMemoryCommands(withConnection, withWriteConnection),
    usage: createUsageCommands(withConnection),
    notices: {
      list: () => withConnection((c) => c.request("notify.list", { afterSeq: 0 })),
      onDelivered(listener) {
        const connection = session.connection();
        return connection === null
          ? () => {}
          : connection.onNotification("notify.delivered", listener);
      },
    },
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
      const forked = await withWriteConnection((c) => c.request("thread.fork", { threadId }));
      if (!forked.ok) return forked;
      ui.actions.dismissLocked();
      // 목록에는 thread.started 이벤트가 들어온다. 선택은 화면 상태라 바로 한다
      leaveSelected(forked.value.threadId);
      engine.flush();
      ui.actions.selectThread(forked.value.threadId);
      session.link()?.openThread(forked.value.threadId);
      return ok(null);
    },
    dismissLocked: () => ui.actions.dismissLocked(),
    retryWrite: (threadId) => ui.actions.setObserving(threadId, false),
    showScreen: (screen) => ui.actions.showScreen(screen),
    requestComposer: (insert) => ui.actions.requestComposer(insert),
    settleComposerRequest: () => ui.actions.settleComposerRequest(),
    requestSettingsJump: (jump) => ui.actions.requestSettingsJump(jump),
    settleSettingsJump: () => ui.actions.settleSettingsJump(),
    openReview: (target) => ui.actions.openReview(target),
    reloadThreads: () => session.link()?.reloadThreads(),
    retryTranscript() {
      const id: ThreadId | null = ui.read.getState().selectedThreadId;
      if (id !== null) session.link()?.openThread(id);
    },
    reconnect: () => session.reconnect(),
    retargetEngine: (target, graceMs) => deps.engineSwitch.retarget(target, graceMs),
    async restartEngine(options) {
      const restarted = await session.restartEngine(options);
      // 옵션 없는 재기동(실패 상태의 "엔진 다시 시작")이 거절되면 연결 루프를 깨운다(이전 동작). 확인을 받은 재기동이 거절되면
      // 연결은 그대로 두고 호출한 화면이 실패 토스트를 띄운다(`restart-confirm-dialog.tsx`)
      if (!restarted && options?.confirmed !== true) session.reconnect();
      return restarted;
    },
    noteRestartNeeded: (reason) => ui.actions.noteRestartNeeded(reason),
    versions: () => deps.versions(),
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
