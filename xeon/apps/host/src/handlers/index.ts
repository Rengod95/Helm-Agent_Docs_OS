import type { WireHandlers } from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine } from "../types.ts";
import { createApprovalListHandler, createApprovalRespondHandler } from "./approval.ts";
import { createCommandHandlers } from "./command.ts";
import { createEventsSubscribeHandler, createEventsUnsubscribeHandler } from "./events.ts";
import {
  createHostHelloHandler,
  createHostShutdownHandler,
  createHostStatusHandler,
  type HostInfo,
  type HostLifecycle,
} from "./host.ts";
import { notImplemented } from "./not-implemented.ts";
import { createSecretHandlers } from "./secret.ts";
import {
  createSettingsGetHandler,
  createSettingsListHandler,
  createSettingsResetHandler,
  createSettingsSetHandler,
} from "./settings.ts";
import {
  createThreadCloseHandler,
  createThreadCompactHandler,
  createThreadCreateHandler,
  createThreadDeleteHandler,
  createThreadForkHandler,
  createThreadListHandler,
  createThreadOpenHandler,
  createThreadReadHandler,
  createThreadRenameHandler,
  createThreadRevertHandler,
} from "./thread.ts";
import { createTrustHandlers } from "./trust.ts";
import {
  createTurnInterruptHandler,
  createTurnResumeHandler,
  createTurnStartHandler,
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
    "host.status": createHostStatusHandler(engine, hub, info),
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
    "thread.compact": createThreadCompactHandler(engine, hub),
    "turn.start": createTurnStartHandler(engine, hub),
    "turn.interrupt": createTurnInterruptHandler(engine),
    "turn.resume": createTurnResumeHandler(engine, hub),
    "events.subscribe": createEventsSubscribeHandler(engine, hub),
    "events.unsubscribe": createEventsUnsubscribeHandler(hub),
    "approval.respond": createApprovalRespondHandler(engine),
    "approval.list": createApprovalListHandler(engine),
    "settings.get": createSettingsGetHandler(engine),
    "settings.set": createSettingsSetHandler(engine),
    "settings.reset": createSettingsResetHandler(engine),
    "settings.list": createSettingsListHandler(engine),
    ...createSecretHandlers(engine),
    ...createTrustHandlers(engine),
    ...createCommandHandlers(engine, hub),
  };
  return table;
}
