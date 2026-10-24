import type { Logger } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
import {
  defineManifest,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@xeon/contracts/extensions";
import { SessionPortKey, TaskServicePortKey } from "@xeon/contracts/services";
import { hostOf } from "@xeon/ext-host";
import { createTaskService } from "./service.ts";
import type { TasksSettingsSource } from "./settings-source.ts";

/** core-tasks의 확장 매니페스트. 내장 L1 패키지라 builtin 신뢰이고 지점도 drive도 쓰지 않는다 */
export const TASKS_MANIFEST: ExtensionManifest = defineManifest({
  schemaVersion: 1,
  name: "core-tasks",
  version: "0.1.0",
  displayName: "Task engine",
  description: "Scope tree, cancellation, keyed queue and the durable input queue (xeon.tasks).",
  defaultEnabled: true,
  layer: "L1",
  kind: "plugin",
  entry: "./src/index.ts",
  points: [],
  usesDrive: false,
  trust: { level: "builtin" },
});

/** 조립 루트(L4)가 넘기는 것. 세션 서비스는 ext-host 포트(xeon.session)에서 받는다 */
export interface TasksPluginDeps {
  readonly ids: IdFactory;
  readonly settings: TasksSettingsSource;
  readonly log: Logger;
}

/**
 * ext-host 플러그인 API로 xeon.tasks를 제공한다(L1.tasks.plan §2). Cordis는 import하지 않는다.
 * 범위 해제(dispose)는 close() 하나로 잇는다: 신호만 보내고 의도는 쓰지 않는다(§4.1 4번)
 */
export function createTasksEntry(deps: TasksPluginDeps): ExtensionEntry {
  return ({ manifest, scope }) => {
    scope(manifest.name, {}, (g) => {
      const host = hostOf(g);
      const session = host.port(SessionPortKey);
      const service = createTaskService({
        session,
        producer: session.producer("core.tasks"),
        ids: deps.ids,
        settings: deps.settings,
        log: deps.log,
      });
      host.providePort(TaskServicePortKey, service);
      g.onDispose(() => service.close());
    });
  };
}
