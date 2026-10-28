import { WorkPlans, WorkTasks } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const WORK_EXTENSION_NAME = "cap-work";

/**
 * 내장 L2 플러그인 매니페스트(L2.work.spec §7.1). 이 마일스톤(M2)이 제공하는 능력은 `work.tasks`와 `work.plans`다.
 * `work.goals`·`work.reports`(M3)는 구현이 들어올 때 `provides`에 더한다.
 * 선택 의존(`artifacts.registry`, `dialog.commands`)과 `usesPost`도 그때 더한다. 지금은 조립 루트가 포트 객체로 넘긴다
 * (`WorkPluginOptions.artifacts`, `commands`).
 */
export function workManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: WORK_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Work management",
    description: "Task list, plans and goals that survive across turns (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [
      { id: WorkTasks.id, version: WorkTasks.version },
      { id: WorkPlans.id, version: WorkPlans.version },
    ],
    points: ["input.agent.before", "session.start"],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
