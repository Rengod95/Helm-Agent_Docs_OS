import type { WireHandlers } from "@fresnel/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine } from "../types.ts";
import { createApprovalListHandler, createApprovalRespondHandler } from "./approval.ts";
import { createCommandHandlers } from "./command.ts";
import { createDialogHandlers } from "./dialog.ts";
import { createDevkitHandlers } from "./m4/devkit.ts";
import { createDialogAreaHandlers } from "./m4/dialog-area.ts";
import { createExtReadHandlers } from "./m4/ext-read.ts";
import { createExtUiVersionHandlers } from "./m4/ext-ui-version.ts";
import { createProfileTestRunHandlers } from "./m4/profile-test-run.ts";
import { createRemoteHandlers, remotePortOf } from "./remote.ts";
import { createEventsSubscribeHandler, createEventsUnsubscribeHandler } from "./events.ts";
import {
  createHostClientsHandler,
  createHostHelloHandler,
  createHostShutdownHandler,
  createHostStatusHandler,
  type HostInfo,
  type HostLifecycle,
} from "./host.ts";
import { notImplemented } from "./not-implemented.ts";
import { createProposalHandlers } from "./proposal.ts";
import { createMeasureHandlers } from "./measure.ts";
import { createModelsListHandler } from "./models.ts";
import { createUsageGetHandler } from "./usage.ts";
import { createSecretHandlers } from "./secret.ts";
import {
  createSettingsGetHandler,
  createSettingsListHandler,
  createSettingsReadFileHandler,
  createSettingsResetHandler,
  createSettingsSetHandler,
  createSettingsWriteFileHandler,
} from "./settings.ts";
import {
  createThreadCloseHandler,
  createThreadCompactHandler,
  createThreadCreateHandler,
  createThreadDeleteHandler,
  createThreadExportHandler,
  createThreadForkHandler,
  createThreadListHandler,
  createThreadOpenHandler,
  createThreadReadHandler,
  createThreadRenameHandler,
  createThreadSetModelHandler,
  createThreadRevertHandler,
} from "./thread.ts";
import { createTrustHandlers } from "./trust.ts";
import { createWorkspaceHandlers } from "./workspace.ts";
import { createScheduleHandlers } from "./schedule.ts";
import { createWebHandlers } from "./web.ts";
import {
  createTurnInterruptHandler,
  createTurnResumeHandler,
  createTurnStartHandler,
  createTurnWithdrawHandler,
} from "./turn.ts";

export type { HostInfo, HostLifecycle } from "./host.ts";

/**
 * 전송과 무관한 처리기 표 하나. in-process, stdio, socket이 같은 표를 쓴다.
 * M1 처리기 5개(host.hello, thread.create, turn.start, events.subscribe, settings.get)에 M2 처리기를 더했다. 아직 없는 메서드(`host.shutdown`을 열지 않는 in-process 호스트)는 notImplemented로 채운다.
 */
export function createWireHandlers(
  engine: Engine,
  hub: () => ConnectionHub,
  info: HostInfo,
  lifecycle?: HostLifecycle,
): WireHandlers {
  const table: WireHandlers = {
    "host.hello": createHostHelloHandler(engine, hub, info, () => table),
    "host.status": createHostStatusHandler(engine, hub, info, lifecycle),
    "host.clients": createHostClientsHandler(hub),
    // in-process 호스트는 CLI 프로세스 안에 있어 클라이언트가 호스트 종료를 요청하지 않는다: 수명 신호가 없으면 열지 않는다
    "host.shutdown":
      lifecycle === undefined
        ? notImplemented("host.shutdown")
        : createHostShutdownHandler(engine, hub, lifecycle),
    "thread.list": createThreadListHandler(engine),
    "thread.create": createThreadCreateHandler(engine, hub),
    "thread.open": createThreadOpenHandler(engine, hub),
    "thread.read": createThreadReadHandler(engine),
    "thread.close": createThreadCloseHandler(engine, hub),
    "thread.delete": createThreadDeleteHandler(engine, hub),
    "thread.fork": createThreadForkHandler(engine, hub),
    "thread.revert": createThreadRevertHandler(engine),
    "thread.rename": createThreadRenameHandler(engine, hub),
    "thread.setModel": createThreadSetModelHandler(engine, hub),
    "thread.compact": createThreadCompactHandler(engine, hub),
    "thread.export": createThreadExportHandler(engine),
    "turn.start": createTurnStartHandler(engine, hub),
    "turn.interrupt": createTurnInterruptHandler(engine, hub),
    "turn.withdraw": createTurnWithdrawHandler(engine),
    "turn.resume": createTurnResumeHandler(engine, hub),
    "events.subscribe": createEventsSubscribeHandler(engine, hub),
    "events.unsubscribe": createEventsUnsubscribeHandler(hub),
    "approval.respond": createApprovalRespondHandler(engine, hub),
    "approval.list": createApprovalListHandler(engine),
    "settings.get": createSettingsGetHandler(engine),
    "settings.set": createSettingsSetHandler(engine, hub),
    "settings.reset": createSettingsResetHandler(engine, hub),
    "settings.list": createSettingsListHandler(engine),
    "settings.readFile": createSettingsReadFileHandler(engine),
    "settings.writeFile": createSettingsWriteFileHandler(engine),
    "usage.get": createUsageGetHandler(engine),
    "models.list": createModelsListHandler(engine),
    ...createMeasureHandlers(engine),
    ...createProposalHandlers(engine),
    ...createSecretHandlers(engine),
    ...createTrustHandlers(engine),
    ...createWorkspaceHandlers(),
    ...createCommandHandlers(engine, hub),
    ...createWebHandlers(engine),
    ...createScheduleHandlers(engine),
    ...createDialogHandlers(engine),
    ...createExtReadHandlers(engine.ports.m4.extRead),
    ...createExtUiVersionHandlers(engine.ports.m4.extUi),
    ...createProfileTestRunHandlers(engine.ports.m4.profileTestRun),
    ...createDialogAreaHandlers(engine.ports.m4.dialogArea),
    ...createDevkitHandlers(engine.ports.m4.devkit),
    ...createRemoteHandlers(remotePortOf(lifecycle?.remote)),
  };
  return table;
}
