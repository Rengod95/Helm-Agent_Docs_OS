import { ok } from "@fresnel/contracts";
import {
  WorkGoals,
  WorkGoalsKey,
  WorkTasks,
  WorkTasksKey,
  type CapabilityApi,
} from "@fresnel/contracts/capabilities";
import { defineManifest, type ExtensionEntry } from "@fresnel/contracts/extensions";
import { OsPortKey } from "@fresnel/contracts/services";
import type { ReviewTextReader } from "@fresnel/cap-artifacts";
import { hostOf, type ExtensionUnit } from "@fresnel/ext-host";

// 대화 영역 wire(W-02, W-05, W-06)가 읽는 L2 기능의 서비스 API를 나중에 채우는 자리와 그 조립 확장. `assembly/l2-units.ts`의 대화 브리지와
// 같은 방식이다: 확장이 기능을 얻어 `holder`에 채우고, 포트(`dialog-area-port.ts`)가 호출 시점에 읽는다. 조립 루트 코드(DR-14 예외 2).
// 리뷰 본문 읽기(`reviews`)는 cap-artifacts 확장이 `onReviews`로 채우고 내려갈 때 비운다(`extensions.ts`). 기능 API가 아니라 읽기 면이다.

/** `work.goals` 기능의 서비스 API. `goal.status`가 쓴다 */
export type GoalsApi = CapabilityApi<typeof WorkGoals>;
/** `work.tasks` 기능의 서비스 API. `work.tasks.list`가 쓴다 */
export type TasksApi = CapabilityApi<typeof WorkTasks>;

export interface DialogAreaHolder {
  goals: GoalsApi | undefined;
  tasks: TasksApi | undefined;
  /** 리뷰 본문 읽기(`review.get`). 산출물 확장이 올라와 있을 때만 있다 */
  reviews: ReviewTextReader | undefined;
}

export function createDialogAreaHolder(): DialogAreaHolder {
  return { goals: undefined, tasks: undefined, reviews: undefined };
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

const BRIDGE_NAME = "host-dialog-area-bridge";

/**
 * cap-work 곁에 싣는 조립 확장. 목표와 작업 기능의 API를 `holder`에 채운다. cap-work가 없거나 꺼지면 자리가 비고 포트는 빈 결과를 낸다.
 * 두 기능은 선택 의존이다(없어도 올라온다)
 */
export function dialogAreaBridgePlugin(holder: DialogAreaHolder, loadIndex: number): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: BRIDGE_NAME,
    version: "0.1.0",
    displayName: "Dialog area bridge",
    description: "Hands the work goal and task services to the host's dialog-area wire methods.",
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
      g.onDispose(() => {
        holder.goals = undefined;
        holder.tasks = undefined;
      });
      return ok(undefined);
    });
  };
  return { manifest, entry, loadIndex, builtin: true };
}
