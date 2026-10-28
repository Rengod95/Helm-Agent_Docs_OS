import { attemptAsync, err, ok } from "@xeon/contracts";
import {
  WorkPlans,
  WorkPlansKey,
  WorkTasks,
  WorkTasksKey,
  type CommandActionRegistry,
} from "@xeon/contracts/capabilities";
import type { IdFactory } from "@xeon/contracts/conversation";
import { ScopedStorePortKey, type ExtensionEntry, type PortKey } from "@xeon/contracts/extensions";
import {
  ApprovalServicePortKey,
  OsPortKey,
  SessionPortKey,
  ToolServicePortKey,
  type ToolRegistration,
  type ApprovalService,
  type ToolService,
} from "@xeon/contracts/services";
import { hostOf, PrimitiveError, type ExtensionUnit, type ScopeHostApi } from "@xeon/ext-host";
import { registerWorkCommands } from "./commands.ts";
import type { WorkPlansDeps } from "./deps.ts";
import { workManifest } from "./manifest.ts";
import { createWorkProjector } from "./projection/projector.ts";
import { readMeta, readTasks } from "./projection/read.ts";
import { startPlanModeListener } from "./plans/listener.ts";
import { createPlans } from "./plans/service.ts";
import { planApprovalsOver, type PlanApprovalsFactory } from "./ports/approvals.ts";
import type { PlanArtifactsPort } from "./ports/artifacts.ts";
import { toolsPermissionMode, type PermissionModePort } from "./ports/permission-mode.ts";
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
  /**
   * 계획 승인(F `L2ApprovalsPort`)을 출처별로 만드는 공장. 생략하면 `xeon.approvals` 포트를 `planApprovalsOver`로 감싼 기본 구현을 쓴다.
   * 둘 다 없으면 계획 제출과 결정 메서드는 `unavailable`로 거부한다
   */
  readonly approvals?: PlanApprovalsFactory;
  /** 권한 모드 포트. 생략하면 `xeon.tools`의 `mode`·`setMode`를 감싼 기본 구현을 쓴다 */
  readonly mode?: PermissionModePort;
  /** 계획 본문을 산출물로 등록하는 선택 의존(`artifacts.registry`). 없으면 `artifact: null`이다 */
  readonly artifacts?: PlanArtifactsPort;
  /**
   * `dialog.commands`의 동작 명령 등록부(선택 의존, spec §6.2·W-10). 있으면 `/plan`, `/tasks`를 등록한다.
   * 능력 선택 의존이 확정되면(W-10) 매니페스트 `optional`로 받는다
   */
  readonly commands?: CommandActionRegistry;
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
    {
      kind: "capability",
      def: WorkPlans,
      key: WorkPlansKey,
      // 계획 도구는 작업 영역을 바꾸지 않는다. 계획 모드(쓰기 거부) 안에서 불러야 하므로 read다.
      // 질문과 같이 사용자 응답을 기다리므로 user_interaction 부류를 달아 서브에이전트에서 막을 수 있게 한다(L1.agents.spec §4.6)
      policy: {
        enter_plan_mode: { risk: "read" },
        exit_plan_mode: { risk: "read" },
        submit_plan: { risk: "read", classes: ["user_interaction"] },
      },
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
      const approvalService = optionalPort<ApprovalService>(host, ApprovalServicePortKey);

      const projector = session.projectors.register(createWorkProjector());
      if (!projector.ok) return err({ reason: projector.error.kind, cause: projector.error });
      g.onDispose(() => {
        projector.value.dispose();
      });

      const mode = options.mode ?? (tools === undefined ? undefined : toolsPermissionMode(tools));
      const approvals =
        options.approvals ??
        (approvalService === undefined ? undefined : planApprovalsOver(approvalService));
      const deps: WorkPlansDeps = {
        session,
        reader,
        producer: session.producer(WORK_PRODUCER),
        ids: options.ids,
        logger,
        settings: (threadId) => readWorkSettings(options.settings.layers(threadId)),
        mode,
        approvals,
        artifacts: options.artifacts,
      };
      const plans = createPlans(deps);
      host.provide(WorkPlansKey, plans.api);
      if (mode === undefined)
        logger.warn("work.mode_missing", { effect: "plan mode is unavailable" });
      if (approvals === undefined) {
        logger.warn("work.approvals_missing", { effect: "submit_plan is unavailable" });
      }
      const tasksApi = createTasksApi(deps);
      host.provide(WorkTasksKey, tasksApi);
      if (options.commands !== undefined) {
        const unregister = registerWorkCommands(options.commands, {
          plans: plans.api,
          tasks: tasksApi,
          runtime: plans,
        });
        g.onDispose(unregister);
      }
      const listener = startPlanModeListener(session, plans, logger);
      g.onDispose(() => {
        listener?.stop();
      });
      // 스레드를 다시 열 때 승인 요청이 빠진 판을 다시 요청하고 모드 복원을 마무리한다(spec §4.5)
      g.on("session.start", async (payload) => {
        const resumed = await attemptAsync(() => plans.resume(payload.threadId));
        if (!resumed.ok) logger.error("work.plans.resume_failed", { thread: payload.threadId });
      });

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
