import {
  isCapabilityError,
  type CapabilityApi,
  type CommandActionContext,
  type CommandActionRegistry,
  type CommandActionResult,
  type GoalStatus,
  type WorkGoals,
  type WorkTasks,
  renderTaskList,
} from "@fresnel/contracts/capabilities";
import type { ThreadId } from "@fresnel/contracts/conversation";

// L2.work.spec §6.2. 작업 목록과 목표(/goal)의 슬래시 명령. 계획 명령(/plan)은 계획 모드와 함께 없앴다 [결정: 2026-11-13 사용자].
// 등록은 dialog.commands의 동작 명령 등록부(CommandActionRegistry)로 한다. 그 기능은 선택 의존이라(W-10) 조립 루트가 등록부를 넘길 때만 등록한다.

export const WORK_COMMAND_ORIGIN = "cap-work";

export interface WorkCommandDeps {
  readonly tasks: CapabilityApi<typeof WorkTasks>;
  readonly goals: CapabilityApi<typeof WorkGoals>;
}

function optionsOf(ctx: CommandActionContext) {
  return {
    requestId: ctx.requestId,
    signal: ctx.signal,
    context: { threadId: ctx.threadId, caller: { kind: "host" as const } },
  };
}

/** 서비스 거부를 한 줄로 바꾼다. 그 밖의 예외는 그대로 둔다 */
async function reported(work: () => Promise<CommandActionResult>): Promise<CommandActionResult> {
  try {
    return await work();
  } catch (caught) {
    if (isCapabilityError(caught)) {
      return { message: `[${caught.data.code}] ${caught.data.message}` };
    }
    throw caught;
  }
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

const GOAL_USAGE = "사용법: /goal <조건> | /goal status | /goal clear";

/** 목표 상태의 화면 낱말. 엔진 코드(`active` 등)를 그대로 보이지 않는다(DP-144) */
const GOAL_STATUS_TEXT: Readonly<Record<GoalStatus, string>> = {
  active: "진행 중",
  met: "충족",
  limit_reached: "판정 한도 도달",
  cleared: "해제됨",
  judge_failed: "판정 실패",
};

function goalLine(goal: {
  readonly condition: string;
  readonly status: GoalStatus;
  readonly judgments: number;
  readonly maxRuns: number;
}): string {
  return `목표: ${goal.condition} (${GOAL_STATUS_TEXT[goal.status]} · 판정 ${String(goal.judgments)}/${String(goal.maxRuns)})`;
}

async function goalCommand(
  deps: WorkCommandDeps,
  args: readonly string[],
  ctx: CommandActionContext,
): Promise<CommandActionResult> {
  const options = optionsOf(ctx);
  const text = args.join(" ").trim();
  if (text === "") return { message: GOAL_USAGE };
  if (text === "status") {
    const out = await deps.goals.status({}, options);
    if (out.goal === null) return { message: "걸린 목표가 없습니다." };
    const last = out.goal.lastVerdict;
    return {
      message:
        last === null ? goalLine(out.goal) : `${goalLine(out.goal)}\n마지막 판정: ${last.reason}`,
    };
  }
  if (text === "clear") {
    const out = await deps.goals.status({}, options);
    if (out.goal === null || out.goal.status !== "active")
      return { message: "해제할 활성 목표가 없습니다." };
    await deps.goals.clear({ goalId: out.goal.goalId }, options);
    return { message: `목표를 해제했습니다: ${out.goal.condition}` };
  }
  try {
    const out = await deps.goals.set({ condition: text }, options);
    return { message: `목표를 걸었습니다. ${goalLine(out.goal)}` };
  } catch (caught) {
    if (isCapabilityError(caught) && caught.data.code === "goal_active")
      return { message: "활성 목표가 이미 있습니다. 먼저 /goal clear로 해제하세요." };
    throw caught;
  }
}

/** `/tasks`, `/goal`을 등록하고 해제 함수를 돌려준다. 이름이 이미 쓰이면 등록부가 CapabilityError(command_name_taken)로 거부한다 */
export function registerWorkCommands(
  registry: CommandActionRegistry,
  deps: WorkCommandDeps,
): () => void {
  const tasks = registry.registerAction(
    {
      name: "tasks",
      description: "작업 목록을 보여 준다",
      origin: WORK_COMMAND_ORIGIN,
    },
    (_args, ctx) => reported(() => tasksCommand(deps, ctx.threadId, ctx)),
  );
  const goal = registry.registerAction(
    {
      name: "goal",
      description: "완료 조건을 걸고 턴마다 판정한다. status로 보고 clear로 해제한다",
      argumentHint: "<조건> | status | clear",
      origin: WORK_COMMAND_ORIGIN,
    },
    (args, ctx) => reported(() => goalCommand(deps, args, ctx)),
  );
  return () => {
    tasks();
    goal();
  };
}
