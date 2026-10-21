// 다른 패키지의 시험이 쓰는 메모리 TaskService 대역(@xeon/core-tasks/testing). 테스트 파일에서만 import한다(DR-08).
import type { Logger } from "@xeon/contracts";
import type { IdFactory } from "@xeon/contracts/conversation";
import type { FaultInjector } from "@xeon/contracts/records";
import type { TaskService } from "@xeon/contracts/services";
import { createTaskService } from "../service.ts";
import { createStaticTasksSettings, type TasksSettingsSource } from "../settings-source.ts";
import { recordingLogger } from "./log.ts";
import { memorySession, type MemorySession } from "./memory-session.ts";

export { memorySession, type MemorySession, type MemorySessionOptions } from "./memory-session.ts";
export { recordingLogger, type LogRecord, type RecordingLogger } from "./log.ts";

export interface MemoryTasksOptions {
  readonly ids: IdFactory;
  /** 같은 세션 위에 서비스를 다시 만들 때(프로세스 재시작 흉내) 넘긴다 */
  readonly session?: MemorySession;
  readonly settings?: TasksSettingsSource;
  readonly log?: Logger;
  readonly faults?: FaultInjector;
}

export interface MemoryTasks {
  readonly tasks: TaskService;
  readonly session: MemorySession;
}

/** 메모리 세션 위에 실제 TaskService를 올린 묶음 */
export function memoryTasks(options: MemoryTasksOptions): MemoryTasks {
  const session =
    options.session ??
    memorySession({
      ids: options.ids,
      ...(options.faults === undefined ? {} : { faults: options.faults }),
    });
  const tasks = createTaskService({
    session,
    producer: session.producer("core.tasks"),
    ids: options.ids,
    settings: options.settings ?? createStaticTasksSettings(),
    log: options.log ?? recordingLogger().logger,
  });
  return { tasks, session };
}
