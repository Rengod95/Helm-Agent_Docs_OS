import { err, ok } from "@fresnel/contracts";
import {
  AgentsJudgeKey,
  WorkGoalsKey,
  WorkReportsKey,
  WorkTasks,
  WorkTasksKey,
  type CommandActionRegistry,
} from "@fresnel/contracts/capabilities";
import type { IdFactory } from "@fresnel/contracts/conversation";
import {
  ScopedStorePortKey,
  type ExtensionEntry,
  type PortKey,
} from "@fresnel/contracts/extensions";
import {
  OsPortKey,
  SessionPortKey,
  ToolServicePortKey,
  type ToolRegistration,
  type ToolService,
} from "@fresnel/contracts/services";
import {
  hostOf,
  PrimitiveError,
  type ExtensionUnit,
  type RegistrationHostApi,
} from "@fresnel/ext-host";
import { registerWorkCommands } from "./commands.ts";
import type { WorkTasksDeps } from "./deps.ts";
import { createSettleGate } from "./goals/gate.ts";
import { createGoals } from "./goals/service.ts";
import { workManifest } from "./manifest.ts";
import { createWorkProjector } from "./projection/projector.ts";
import { readMeta, readTasks } from "./projection/read.ts";
import { readJudgeMaxRuns, readWorkSettings, type WorkSettingsSource } from "./settings.ts";
import { reminderMessage } from "./tasks/reminder.ts";
import { createTasksApi } from "./tasks/service.ts";

// L2.work.plan 패키지 구조. 구현 패키지(core-persistence, core-tools, platform-store)를 import하지 않고 F 서비스 인터페이스를
// 포트(fresnel.session, fresnel.store, fresnel.tools, fresnel.os)로만 받는다. Cordis는 import하지 않는다(DR-11).
// 계획 모드와 계획 승인은 없앴다 [결정: 2026-11-13 사용자]. 계획 기능(work.plans)은 2026-11-15 정리로 지웠다.

export const WORK_PRODUCER = "cap.work";

export interface WorkPluginOptions {
  /** IdFactory 구현은 L0 platform-os에 있고 조립 루트가 넘긴다 */
  readonly ids: IdFactory;
  /** 설정 층. 파일 범위와 세션 범위를 합친 스택을 호출마다 돌려준다 */
  readonly settings: WorkSettingsSource;
  /**
   * `dialog.commands`의 동작 명령 등록부(선택 의존, spec §6.2·W-10). 있으면 `/tasks`, `/goal`을 등록한다.
   * 기능 선택 의존이 확정되면(W-10) 매니페스트 `optional`로 받는다
   */
  readonly commands?: CommandActionRegistry;
  readonly loadIndex?: number;
}

/** 아직 제공되지 않은 포트는 undefined. 그 밖의 오류는 그대로 던진다 */
function optionalPort<Api>(host: RegistrationHostApi, key: PortKey<Api>): Api | undefined {
  try {
    return host.port(key);
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "port_unavailable") return undefined;
    throw caught;
  }
}

/** 아직 공급되지 않은 공개 기능은 undefined. 그 밖의 오류는 그대로 던진다(선언되지 않은 기능 포함) */
function optionalCapability<Api>(get: () => Api): Api | undefined {
  try {
    return get();
  } catch (caught) {
    if (caught instanceof PrimitiveError && caught.code === "capability_unavailable")
      return undefined;
    throw caught;
  }
}

/** 모델에 광고하는 도구 등록. 남는 도구는 task_write뿐이다 */
function toolRegistrations(): readonly ToolRegistration[] {
  return [
    {
      kind: "capability",
      def: WorkTasks,
      key: WorkTasksKey,
      // 작업 목록은 작업 영역 파일을 바꾸지 않으므로 read다
      policy: { task_write: { risk: "read" } },
    },
  ];
}

/** 내장 확장 단위. 조립 루트가 ExtHost.install로 올린다 */
export function workPlugin(options: WorkPluginOptions): ExtensionUnit {
  const manifest = workManifest();
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const session = host.port(SessionPortKey);
      const reader = host.port(ScopedStorePortKey).scoped(WORK_PRODUCER);
      const os = host.port(OsPortKey);
      const logger = os.logger("work");
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
      const tasksApi = createTasksApi(deps);
      host.provide(WorkTasksKey, tasksApi);
      // 목표 지속(M3-REQ-90): 판정과 완료 보고. 완료 게이트는 `boundary.settle.before` chain 핸들러 하나다
      const goals = createGoals({
        ...deps,
        clock: os.time.clock,
        maxRuns: (threadId) => readJudgeMaxRuns(options.settings.layers(threadId)),
      });
      host.provide(WorkGoalsKey, goals.goalsApi);
      host.provide(WorkReportsKey, goals.reportsApi);
      if (options.commands !== undefined) {
        const unregister = registerWorkCommands(options.commands, {
          tasks: tasksApi,
          goals: goals.goalsApi,
        });
        g.onDispose(unregister);
      }
      const gate = createSettleGate({
        goals,
        reader,
        // 판정은 공개 기능 `agents.judge`로 한다(hooks-core-boundary §6.2, D-30). 공급자는 core-agents다
        judge: () => optionalCapability(() => g.capability(AgentsJudgeKey)),
        ids: options.ids,
        clock: os.time.clock,
        logger,
      });
      g.on("boundary.step.after", (payload, _current, ctx) => {
        gate.rememberStep(payload.stepId, ctx.threadId);
        return undefined;
      });
      g.on("boundary.settle.before", (payload, current, ctx) => gate.settle(payload, current, ctx));

      // L2.work.spec §4.1.6. 질의만 하고 이벤트를 쓰지 않는다
      g.on("input.agent.before", (_payload, ctx) => {
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
