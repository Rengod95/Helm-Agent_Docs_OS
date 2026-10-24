import { WorkTasks } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const WORK_EXTENSION_NAME = "cap-work";

/**
 * 내장 L2 플러그인 매니페스트(L2.work.spec §7.1). 이 마일스톤(WK.1)이 제공하는 능력은 `work.tasks` 하나다.
 * `work.plans`(WK.2·WK.3), `work.goals`·`work.reports`(M3)는 구현이 들어올 때 `provides`에 더한다.
 * 선택 의존(`artifacts.registry`, `dialog.commands`)과 `usesPost`도 그때 더한다.
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
    provides: [{ id: WorkTasks.id, version: WorkTasks.version }],
    points: ["before_agent_start"],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
