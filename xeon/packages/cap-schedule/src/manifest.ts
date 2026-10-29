import { ScheduleEntries } from "@xeon/contracts/capabilities";
import { defineManifest, type ExtensionManifest } from "@xeon/contracts/extensions";

export const SCHEDULE_EXTENSION_NAME = "cap-schedule";

/** 내장 L2 플러그인 매니페스트(L2.schedule.spec §4.4.9). M3b는 `schedule.entries` 하나를 제공한다 */
export function scheduleManifest(): ExtensionManifest {
  return defineManifest({
    schemaVersion: 1,
    name: SCHEDULE_EXTENSION_NAME,
    version: "0.1.0",
    displayName: "Schedules",
    description: "Run a prompt later in an unattended new session (L2).",
    defaultEnabled: true,
    layer: "L2",
    kind: "plugin",
    entry: "./src/index.ts",
    provides: [{ id: ScheduleEntries.id, version: ScheduleEntries.version }],
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
}
