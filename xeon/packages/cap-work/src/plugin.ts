import { err, ok } from "@xeon/contracts";
import { WorkTasks, WorkTasksKey } from "@xeon/contracts/capabilities";
import type { IdFactory } from "@xeon/contracts/conversation";
import { ScopedStorePortKey, type ExtensionEntry, type PortKey } from "@xeon/contracts/extensions";
import {
  OsPortKey,
  SessionPortKey,
  ToolServicePortKey,
  type ToolRegistration,
  type ToolService,
} from "@xeon/contracts/services";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import type { WorkTasksDeps } from "./deps.ts";
import { workManifest } from "./manifest.ts";
import { createWorkProjector } from "./projection/projector.ts";
import { readMeta, readTasks } from "./projection/read.ts";
import { readWorkSettings, type WorkSettingsSource } from "./settings.ts";
import { reminderMessage } from "./tasks/reminder.ts";
import { createTasksApi } from "./tasks/service.ts";

// L2.work.plan 패키지 구조. 구현 패키지(core-persistence, core-tools, platform-store)를 import하지 않고 F 서비스 인터페이스를
// 포트(xeon.session, xeon.store, xeon.tools, xeon.os)로만 받는다. Cordis는 import하지 않는다(DR-11).

export const WORK_PRODUCER = "cap.work";

export interface WorkPluginOptions {
  /** IdFactory 구현은 L0 platform-os에 있고 조립 루트가 넘긴다 */
  readonly ids: IdFactory;
  /** 설정 층. 파일 범위와 세션 범위를 합친 스택을 호출마다 돌려준다 */
  readonly settings: WorkSettingsSource;
  readonly loadIndex?: number;
}

/** 아직 제공되지 않은 포트는 undefined. 그 밖의 오류는 그대로 던진다 */
function optionalPort<Api>(host: ScopeHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

/** 모델에 광고하는 도구 등록. 계획 도구는 WK.2·WK.3에서 같은 능력 묶음에 더한다 */
function toolRegistrations(): readonly ToolRegistration[] {
  return [
    {
      kind: "capability",
      def: WorkTasks,
      key: WorkTasksKey,
      // 작업 목록은 작업 영역 파일을 바꾸지 않는다. 계획 모드(쓰기 거부)에서도 목록을 쓸 수 있도록 read로 둔다
      policy: { task_write: { risk: "read" } },
    },
  ];
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function workPlugin(options: WorkPluginOptions): ExtensionUnit {
  const manifest = workManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const session = host.port(SessionPortKey);
      const reader = host.port(ScopedStorePortKey).scoped(WORK_PRODUCER);
      const logger = host.port(OsPortKey).logger("work");
      const tools = optionalPort<ToolService>(host, ToolServicePortKey);

      const projector = session.projectors.register(createWorkProjector());
      if (!projector.ok) return err({ reason: projector.error.kind, cause: projector.error });
      g.onDispose(() => {
        projector.value.dispose();
      });

      const deps: WorkTasksDeps = {
        session,
        reader,
        producer: session.producer(WORK_PRODUCER),
        ids: options.ids,
        logger,
        settings: (threadId) => readWorkSettings(options.settings.layers(threadId)),
      };
      host.provide(WorkTasksKey, createTasksApi(deps));

      // L2.work.spec §4.1.6. 질의만 하고 이벤트를 쓰지 않는다
      g.on("before_agent_start", (_payload, _current, ctx) => {
        const reminderTurns = deps.settings(ctx.threadId).tasks.reminderTurns;
        if (reminderTurns <= 0) return undefined;
        const tasks = readTasks(reader, ctx.threadId);
        const meta = readMeta(reader, ctx.threadId);
        if (!tasks.ok || !meta.ok) {
          logger.warn("work.reminder_unreadable", { thread: ctx.threadId });
          return undefined;
        }
        const message = reminderMessage(tasks.value, meta.value, reminderTurns);
        return message === undefined ? undefined : { message };
      });

      if (tools === undefined) {
        logger.warn("work.tools_missing", { effect: "task_write is not advertised" });
        return ok(undefined);
      }
      const unregisters: (() => void)[] = [];
      for (const registration of toolRegistrations()) {
        const registered = tools.register(registration);
        if (!registered.ok) {
          for (const unregister of unregisters.toReversed()) unregister();
          return err({ reason: registered.error.kind, cause: registered.error });
        }
        unregisters.push(registered.value);
      }
      g.onDispose(() => {
        for (const unregister of unregisters) unregister();
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex ?? 0, builtin: true };
}
