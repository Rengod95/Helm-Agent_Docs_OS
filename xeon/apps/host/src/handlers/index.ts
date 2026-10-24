import type { WireHandlers } from "@xeon/contracts/wire";
import type { ConnectionHub } from "../connection-types.ts";
import type { Engine } from "../types.ts";
import { createEventsSubscribeHandler } from "./events.ts";
import { createHostHelloHandler, type HostInfo } from "./host.ts";
import { notImplemented } from "./not-implemented.ts";
import { createSettingsGetHandler } from "./settings.ts";
import { createThreadCreateHandler } from "./thread.ts";
import { createTurnStartHandler } from "./turn.ts";

export type { HostInfo } from "./host.ts";

/**
 * 전송과 무관한 처리기 표 하나. in-process, stdio, socket이 같은 표를 쓴다.
 * M1은 처리기 5개(host.hello, thread.create, turn.start, events.subscribe, settings.get)이고 나머지는 notImplemented다.
 */
export function createWireHandlers(
  engine: Engine,
  hub: () => ConnectionHub,
  info: HostInfo,
): WireHandlers {
  const table: WireHandlers = {
    "host.hello": createHostHelloHandler(engine, hub, info, () => table),
    "host.status": notImplemented("host.status"),
    "host.shutdown": notImplemented("host.shutdown"),
    "thread.list": notImplemented("thread.list"),
    "thread.create": createThreadCreateHandler(engine, hub),
    "thread.open": notImplemented("thread.open"),
    "thread.read": notImplemented("thread.read"),
    "thread.close": notImplemented("thread.close"),
    "thread.delete": notImplemented("thread.delete"),
    "thread.fork": notImplemented("thread.fork"),
    "thread.revert": notImplemented("thread.revert"),
    "turn.start": createTurnStartHandler(engine, hub),
    "turn.interrupt": notImplemented("turn.interrupt"),
    "events.subscribe": createEventsSubscribeHandler(engine, hub),
    "events.unsubscribe": notImplemented("events.unsubscribe"),
    "approval.respond": notImplemented("approval.respond"),
    "approval.list": notImplemented("approval.list"),
    "settings.get": createSettingsGetHandler(engine),
    "settings.set": notImplemented("settings.set"),
    "settings.reset": notImplemented("settings.reset"),
    "settings.list": notImplemented("settings.list"),
    "secret.list": notImplemented("secret.list"),
    "secret.meta": notImplemented("secret.meta"),
    "secret.remove": notImplemented("secret.remove"),
    "secret.test": notImplemented("secret.test"),
    "secret.beginEntry": notImplemented("secret.beginEntry"),
    "secret.beginReveal": notImplemented("secret.beginReveal"),
  };
  return table;
}
