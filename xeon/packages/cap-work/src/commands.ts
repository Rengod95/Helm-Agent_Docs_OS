import {
  isCapabilityError,
  renderTaskList,
  type CapabilityApi,
  type CommandActionContext,
  type CommandActionRegistry,
  type CommandActionResult,
  type WorkPlans,
  type WorkTasks,
} from "@xeon/contracts/capabilities";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { PlansRuntime } from "./plans/service.ts";

// L2.work.spec §6.2. 계획 모드와 작업 목록의 슬래시 명령. 목표 명령(/goal)은 work.goals와 함께 M3에서 더한다.
// 등록은 dialog.commands의 동작 명령 등록부(CommandActionRegistry)로 한다. 그 능력은 선택 의존이라(W-10) 조립 루트가 등록부를 넘길 때만 등록한다.

export const WORK_COMMAND_ORIGIN = "cap-work";

export interface WorkCommandDeps {
  readonly plans: CapabilityApi<typeof WorkPlans>;
  readonly tasks: CapabilityApi<typeof WorkTasks>;
  readonly runtime: Pick<PlansRuntime, "pendingPlan">;
}

function optionsOf(ctx: CommandActionContext) {
  return {
    requestId: ctx.requestId,
    signal: ctx.signal,
    context: { threadId: ctx.threadId, caller: { kind: "host" as const } },
  };
}

/** 서비스 거부를 사용자에게 보일 한 줄로 바꾼다. 그 밖의 예외는 그대로 둔다 */
async function reported(work: () => Promise<CommandActionResult>): Promise<CommandActionResult> {
  try {
    return await work();
  } catch (caught) {
    if (isCapabilityError(caught))
      return { message: `[${caught.data.code}] ${caught.data.message}` };
    throw caught;
  }
}

async function planCommand(
  deps: WorkCommandDeps,
  args: readonly string[],
  ctx: CommandActionContext,
): Promise<CommandActionResult> {
  const [verb, ...rest] = args;
  const options = optionsOf(ctx);
  if (verb === undefined) {
    const out = await deps.plans.enterMode({}, options);
    return { message: `계획 모드를 시작했습니다. 이전 모드: ${out.previousMode ?? "없음"}` };
  }
  if (verb === "exit") {
    const out = await deps.plans.exitMode({}, options);
    return { message: `계획 모드를 끝냈습니다. 현재 모드: ${out.mode}` };
  }
  if (verb !== "approve" && verb !== "reject" && verb !== "revise") {
    return { message: "사용법: /plan [exit | approve | reject [사유] | revise <피드백>]" };
  }
  const pending = deps.runtime.pendingPlan(ctx.threadId);
  if (pending === undefined) return { message: "승인 대기 중인 계획이 없습니다." };
  const target = { planId: pending.planId, version: pending.version };
  const text = rest.join(" ");
  if (verb === "approve") {
    await deps.plans.approve({ ...target, ...(text === "" ? {} : { note: text }) }, options);
    return { message: `계획 ${pending.planId} v${pending.version}을 승인했습니다.` };
  }
  if (verb === "reject") {
    await deps.plans.reject({ ...target, ...(text === "" ? {} : { reason: text }) }, options);
    return { message: `계획 ${pending.planId} v${pending.version}을 반려했습니다.` };
  }
  if (text === "") return { message: "수정 요청에는 피드백이 필요합니다: /plan revise <피드백>" };
  await deps.plans.revise({ ...target, feedback: text }, options);
  return { message: `계획 ${pending.planId} v${pending.version}에 수정을 요청했습니다.` };
}

async function tasksCommand(
  deps: WorkCommandDeps,
  threadId: ThreadId,
  ctx: CommandActionContext,
): Promise<CommandActionResult> {
  const listed = await deps.tasks.list({}, optionsOf({ ...ctx, threadId }));
  const rendered = renderTaskList({ tasks: listed.tasks, created: [] });
  const first = rendered.content[0];
  return { message: first?.type === "text" ? first.text : "(작업 없음)" };
}

/** `/plan`, `/tasks`를 등록하고 해제 함수를 돌려준다. 이름이 이미 쓰이면 등록부가 CapabilityError(command_name_taken)로 거부한다 */
export function registerWorkCommands(
  registry: CommandActionRegistry,
  deps: WorkCommandDeps,
): () => void {
  const plan = registry.registerAction(
    {
      name: "plan",
      description: "계획 모드를 시작하거나 끝내고, 대기 중인 계획을 승인·반려·수정 요청한다",
      argumentHint: "[exit | approve | reject [사유] | revise <피드백>]",
      origin: WORK_COMMAND_ORIGIN,
    },
    (args, ctx) => reported(() => planCommand(deps, args, ctx)),
  );
  const tasks = registry.registerAction(
    {
      name: "tasks",
      description: "작업 목록을 보여 준다",
      origin: WORK_COMMAND_ORIGIN,
    },
    (_args, ctx) => reported(() => tasksCommand(deps, ctx.threadId, ctx)),
  );
  return () => {
    plan();
    tasks();
  };
}
