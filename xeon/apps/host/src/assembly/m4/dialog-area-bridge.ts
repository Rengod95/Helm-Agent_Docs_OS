import { ok } from "@fresnel/contracts";
import {
  KnowledgeMemory,
  KnowledgeMemoryKey,
  KnowledgeSkills,
  KnowledgeSkillsKey,
  WorkGoals,
  WorkGoalsKey,
  WorkTasks,
  WorkTasksKey,
  type CapabilityApi,
  type ServiceKey,
} from "@fresnel/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import { OsPortKey } from "@fresnel/contracts/services";
import type { ReviewTextReader } from "@fresnel/cap-artifacts";
import { hostOf, type ExtensionUnit } from "@fresnel/ext-host";

// 대화 영역 wire(W-02, W-05, W-06, W-14, W-19)가 읽는 L2 기능의 서비스 API를 나중에 채우는 자리와 그 조립 확장 넷(Goal, Task, Skill, Memory Service Bridge).
// `assembly/l2-units.ts`의 Ask Service Bridge와 같은 방식이다: 확장이 기능을 얻어 `holder`에 채우고, 포트(`dialog-area-port.ts`)가 호출 시점에 읽는다. 조립 루트 코드(DR-14 예외 2).
// 리뷰 본문 읽기(`reviews`)는 cap-artifacts 확장이 `onReviews`로 채우고 내려갈 때 비운다(`extensions.ts`). 기능 API가 아니라 읽기 면이다.

/** `work.goals` 기능의 서비스 API. `goal.status`가 쓴다 */
export type GoalsApi = CapabilityApi<typeof WorkGoals>;
/** `work.tasks` 기능의 서비스 API. `work.tasks.list`가 쓴다 */
export type TasksApi = CapabilityApi<typeof WorkTasks>;
/** `knowledge.skills` 기능의 서비스 API. `knowledge.skills.view`가 쓴다 */
export type SkillsApi = CapabilityApi<typeof KnowledgeSkills>;
/** `knowledge.memory` 기능의 서비스 API. `knowledge.memory.*` wire가 쓴다 */
export type MemoryApi = CapabilityApi<typeof KnowledgeMemory>;

export interface DialogAreaHolder {
  goals: GoalsApi | undefined;
  tasks: TasksApi | undefined;
  skills: SkillsApi | undefined;
  memory: MemoryApi | undefined;
  /** 리뷰 본문 읽기(`review.get`). 산출물 확장이 올라와 있을 때만 있다 */
  reviews: ReviewTextReader | undefined;
}

export function createDialogAreaHolder(): DialogAreaHolder {
  return {
    goals: undefined,
    tasks: undefined,
    skills: undefined,
    memory: undefined,
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

/** 서비스 브리지 하나의 모양: 내부 부품 이름, 표시 이름, 하는 일, 선택 의존하는 기능, 얻은 API를 자리에 채우고 비우는 방법 */
interface ServiceBridgeSpec<Api> {
  readonly name: string;
  readonly displayName: string;
  readonly purpose: string;
  readonly description: string;
  readonly capability: { readonly id: string; readonly version: string };
  readonly key: ServiceKey<Api>;
  readonly isApi: (value: unknown) => value is Api;
  readonly fill: (api: Api) => void;
  readonly clear: () => void;
  readonly missingEvent: string;
  readonly missingEffect: string;
}

/**
 * 서비스 하나를 앱에 넘기는 조립 확장. 기능이 없거나 꺼지면 자리가 비고 포트는 빈 결과(목표, 작업)나 `unavailable`(스킬, 기억)을 낸다.
 * 기능은 선택 의존이다(없어도 올라온다). 스킬과 메모리 브리지는 cap-knowledge 뒤에 올라와야 그 API를 볼 수 있다(`extensions.ts`의 순서)
 */
function serviceBridgePlugin<Api>(spec: ServiceBridgeSpec<Api>, loadIndex: number): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: spec.name,
    version: "0.1.0",
    displayName: spec.displayName,
    purpose: spec.purpose,
    description: spec.description,
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [
      {
        layer: "L2",
        hooks: [],
        requires: [],
        optional: [{ id: spec.capability.id, range: `^${spec.capability.version}` }],
      },
    ],
    trust: { level: "builtin" },
  });
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
      const logger = hostOf(g).port(OsPortKey).logger("dialog-area");
      const api: unknown = g.capability(spec.key);
      if (spec.isApi(api)) spec.fill(api);
      else logger.warn(spec.missingEvent, { effect: spec.missingEffect });
      g.onDispose(spec.clear);
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex, builtin: true };
}

/** Goal Service Bridge(`host-goal-bridge`): `work.goals`의 서비스 API를 `goal.status`에 넘긴다 */
export function goalBridgePlugin(holder: DialogAreaHolder, loadIndex: number): ExtensionUnit {
  return serviceBridgePlugin<GoalsApi>(
    {
      name: "host-goal-bridge",
      displayName: "Goal Service Bridge",
      purpose: "Shows goals beside the conversation.",
      description:
        "Connects the goal service to the app so goals show beside the conversation; without it, the goals panel looks empty.",
      capability: WorkGoals,
      key: WorkGoalsKey,
      isApi: isGoalsApi,
      fill: (api) => {
        holder.goals = api;
      },
      clear: () => {
        holder.goals = undefined;
      },
      missingEvent: "dialog_area.goals_missing",
      missingEffect: "goal.status reports no goal",
    },
    loadIndex,
  );
}

/** Task Service Bridge(`host-task-bridge`): `work.tasks`의 서비스 API를 `work.tasks.list`에 넘긴다 */
export function taskBridgePlugin(holder: DialogAreaHolder, loadIndex: number): ExtensionUnit {
  return serviceBridgePlugin<TasksApi>(
    {
      name: "host-task-bridge",
      displayName: "Task Service Bridge",
      purpose: "Shows tasks beside the conversation.",
      description:
        "Connects the task list service to the app so tasks show beside the conversation; without it, the task list looks empty.",
      capability: WorkTasks,
      key: WorkTasksKey,
      isApi: isTasksApi,
      fill: (api) => {
        holder.tasks = api;
      },
      clear: () => {
        holder.tasks = undefined;
      },
      missingEvent: "dialog_area.tasks_missing",
      missingEffect: "work.tasks.list reports no tasks",
    },
    loadIndex,
  );
}

/** Skill Service Bridge(`host-skill-bridge`): `knowledge.skills`의 서비스 API를 `knowledge.skills.view`에 넘긴다. cap-knowledge 뒤에 올라온다 */
export function skillBridgePlugin(holder: DialogAreaHolder, loadIndex: number): ExtensionUnit {
  return serviceBridgePlugin<SkillsApi>(
    {
      name: "host-skill-bridge",
      displayName: "Skill Service Bridge",
      purpose: "Shows skills in the Skills screen.",
      description:
        "Connects the skill service to the app so the Skills screen can list them; without it, skills cannot be used from the app.",
      capability: KnowledgeSkills,
      key: KnowledgeSkillsKey,
      isApi: isSkillsApi,
      fill: (api) => {
        holder.skills = api;
      },
      clear: () => {
        holder.skills = undefined;
      },
      missingEvent: "dialog_area.skills_missing",
      missingEffect: "knowledge.skills.view is not available",
    },
    loadIndex,
  );
}

/** Memory Service Bridge(`host-memory-bridge`): `knowledge.memory`의 서비스 API를 `knowledge.memory.*`에 넘긴다. cap-knowledge 뒤에 올라온다 */
export function memoryBridgePlugin(holder: DialogAreaHolder, loadIndex: number): ExtensionUnit {
  return serviceBridgePlugin<MemoryApi>(
    {
      name: "host-memory-bridge",
      displayName: "Memory Service Bridge",
      purpose: "Lets you read and edit memory in the app.",
      description:
        "Connects the memory service to the app so memory can be read and edited; without it, memory cannot be used from the app.",
      capability: KnowledgeMemory,
      key: KnowledgeMemoryKey,
      isApi: isMemoryApi,
      fill: (api) => {
        holder.memory = api;
      },
      clear: () => {
        holder.memory = undefined;
      },
      missingEvent: "dialog_area.memory_missing",
      missingEffect: "knowledge.memory.* is not available",
    },
    loadIndex,
  );
}
