import { WorkGoals, WorkReports, WorkTasks } from "@fresnel/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@fresnel/contracts/extensions";

export const WORK_EXTENSION_NAME = "cap-work";

/**
 * 내장 L2 플러그인 매니페스트(L2.work.spec §7.1). 제공하는 기능은 `work.tasks`, `work.goals`, `work.reports`다.
 * 계획 기능(`work.plans`)은 2026-11-15 정리로 지웠다 [결정: 2026-11-15 사용자].
 * 선택 의존(`dialog.commands`)과 `usesPost`는 그때 더한다. 지금은 조립 루트가 포트 객체로 넘긴다(`WorkPluginOptions.commands`).
 */
export function workManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 2,
    name: WORK_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Work management",
    description: "Task list and goals that survive across turns (L2).",
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [
      {
        layer: "L2",
        hooks: ["input.agent.before", "boundary.step.after", "boundary.settle.before"],
        provides: [
          { id: WorkTasks.id, version: WorkTasks.version },
          { id: WorkGoals.id, version: WorkGoals.version },
          { id: WorkReports.id, version: WorkReports.version },
        ],
      },
    ],
    trust: { level: "builtin" },
  });
}
