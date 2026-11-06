import { ok } from "@fresnel/contracts";
import {
  KnowledgeMemory,
  KnowledgeMemoryKey,
  KnowledgeSkills,
  KnowledgeSkillsKey,
  WorkGoals,
  WorkGoalsKey,
  WorkPlans,
  WorkPlansKey,
  WorkTasks,
  WorkTasksKey,
  type CapabilityApi,
} from "@fresnel/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import { OsPortKey } from "@fresnel/contracts/services";
import type { ReviewTextReader } from "@fresnel/cap-artifacts";
import { hostOf, type ExtensionUnit } from "@fresnel/ext-host";

// 대화 영역 wire(W-02, W-05, W-06, W-14, W-18)가 읽는 L2 기능의 서비스 API를 나중에 채우는 자리와 그 조립 확장. `assembly/l2-units.ts`의 대화 브리지와
// 같은 방식이다: 확장이 기능을 얻어 `holder`에 채우고, 포트(`dialog-area-port.ts`)가 호출 시점에 읽는다. 조립 루트 코드(DR-14 예외 2).
// 리뷰 본문 읽기(`reviews`)는 cap-artifacts 확장이 `onReviews`로 채우고 내려갈 때 비운다(`extensions.ts`). 기능 API가 아니라 읽기 면이다.

/** `work.goals` 기능의 서비스 API. `goal.status`가 쓴다 */
export type GoalsApi = CapabilityApi<typeof WorkGoals>;
/** `work.tasks` 기능의 서비스 API. `work.tasks.list`가 쓴다 */
export type TasksApi = CapabilityApi<typeof WorkTasks>;
/** `knowledge.skills` 기능의 서비스 API. `knowledge.skills.view`가 쓴다 */
export type SkillsApi = CapabilityApi<typeof KnowledgeSkills>;
/** `knowledge.memory` 기능의 서비스 API. `knowledge.memory.*` wire가 쓴다 */
export type MemoryApi = CapabilityApi<typeof KnowledgeMemory>;
/** `work.plans` 기능의 서비스 API. `work.plans.versions`가 쓴다 */
export type PlansApi = CapabilityApi<typeof WorkPlans>;

export interface DialogAreaHolder {
  goals: GoalsApi | undefined;
  tasks: TasksApi | undefined;
  skills: SkillsApi | undefined;
  memory: MemoryApi | undefined;
  plans: PlansApi | undefined;
  /** 리뷰 본문 읽기(`review.get`). 산출물 확장이 올라와 있을 때만 있다 */
  reviews: ReviewTextReader | undefined;
}

export function createDialogAreaHolder(): DialogAreaHolder {
  return {
    goals: undefined,
    tasks: undefined,
    skills: undefined,
    memory: undefined,
    plans: undefined,
    reviews: undefined,
  };
}

function isGoalsApi(value: unknown): value is GoalsApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof value.status === "function"
  );
}

function isTasksApi(value: unknown): value is TasksApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "list" in value &&
    typeof value.list === "function"
  );
}

function isSkillsApi(value: unknown): value is SkillsApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "view" in value &&
    typeof value.view === "function"
  );
}

function isMemoryApi(value: unknown): value is MemoryApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "read" in value &&
    typeof value.read === "function" &&
    "replace" in value &&
    typeof value.replace === "function"
  );
}

function isPlansApi(value: unknown): value is PlansApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "versions" in value &&
    typeof value.versions === "function"
  );
}

const BRIDGE_NAME = "host-dialog-area-bridge";

/**
 * 대화 영역의 기능 API를 `holder`에 채우는 조립 확장. 목표와 작업과 계획은 cap-work, 스킬은 cap-knowledge가 준다. 기능이 없거나 꺼지면
 * 자리가 비고 포트는 빈 결과(목표, 작업, 계획)나 `unavailable`(스킬)을 낸다. 네 기능은 선택 의존이다(없어도 올라온다).
 * 이 확장은 cap-knowledge 뒤에 올라와야 스킬 API를 볼 수 있다(`extensions.ts`의 순서)
 */
export function dialogAreaBridgePlugin(holder: DialogAreaHolder, loadIndex: number): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: BRIDGE_NAME,
    version: "0.1.0",
    displayName: "Dialog area bridge",
    description:
      "Hands the work goal, task and plan services and the knowledge skill service to the host's dialog-area wire methods.",
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [
      {
        layer: "L2",
        hooks: [],
        requires: [],
        optional: [
          { id: WorkGoals.id, range: `^${WorkGoals.version}` },
          { id: WorkTasks.id, range: `^${WorkTasks.version}` },
          { id: WorkPlans.id, range: `^${WorkPlans.version}` },
          { id: KnowledgeSkills.id, range: `^${KnowledgeSkills.version}` },
          { id: KnowledgeMemory.id, range: `^${KnowledgeMemory.version}` },
        ],
      },
    ],
    trust: { level: "builtin" },
  });
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
      const logger = hostOf(g).port(OsPortKey).logger("dialog-area");
      const goals: unknown = g.capability(WorkGoalsKey);
      if (isGoalsApi(goals)) holder.goals = goals;
      else logger.warn("dialog_area.goals_missing", { effect: "goal.status reports no goal" });
      const tasks: unknown = g.capability(WorkTasksKey);
      if (isTasksApi(tasks)) holder.tasks = tasks;
      else logger.warn("dialog_area.tasks_missing", { effect: "work.tasks.list reports no tasks" });
      const plans: unknown = g.capability(WorkPlansKey);
      if (isPlansApi(plans)) holder.plans = plans;
      else
        logger.warn("dialog_area.plans_missing", {
          effect: "work.plans.versions reports no versions",
        });
      const skills: unknown = g.capability(KnowledgeSkillsKey);
      if (isSkillsApi(skills)) holder.skills = skills;
      else
        logger.warn("dialog_area.skills_missing", {
          effect: "knowledge.skills.view is not available",
        });
      const memory: unknown = g.capability(KnowledgeMemoryKey);
      if (isMemoryApi(memory)) holder.memory = memory;
      else
        logger.warn("dialog_area.memory_missing", {
          effect: "knowledge.memory.* is not available",
        });
      g.onDispose(() => {
        holder.goals = undefined;
        holder.tasks = undefined;
        holder.plans = undefined;
        holder.skills = undefined;
        holder.memory = undefined;
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex, builtin: true };
}
