import { Bug } from "@xeon/contracts";
import { createExecService, detectExecPlatform } from "@xeon/platform-exec";
import type { WorkspaceDeps } from "../../src/deps.ts";
import type { WorkspaceEnv } from "../../src/env.ts";
import { defaultRoots } from "../../src/roots.ts";
import { DEFAULT_WORKSPACE_SETTINGS } from "../../src/settings.ts";

// 실제 파일 시스템 위의 xeon.exec로 서비스 의존을 만든다(int 시험용). `override`는 일부 메서드를 바꾼 env를 만든다.

export function realEnv(root: string): WorkspaceEnv {
  const platform = detectExecPlatform();
  if (!platform.ok) throw new Bug(`unsupported test host: ${platform.error.platform}`);
  return createExecService(
    {
      cwd: root,
      shellPath: "/bin/bash",
      defaultTimeoutMs: 0,
      outputSpillBytes: 0,
      envExtra: [],
    },
    {
      platform: platform.value,
      secrets: undefined,
      parentEnv: { PATH: process.env.PATH, HOME: process.env.HOME },
    },
  );
}

/** `base`를 그대로 쓰되 `overrides`의 메서드만 바꾼 env */
export function override(base: WorkspaceEnv, overrides: Partial<WorkspaceEnv>): WorkspaceEnv {
  const derived: WorkspaceEnv = Object.create(base);
  return Object.assign(derived, overrides);
}

export function realDeps(env: WorkspaceEnv): WorkspaceDeps {
  return {
    env,
    roots: {
      env,
      roots: (context) => defaultRoots(env, context),
      protectedPaths: () => [],
    },
    sandbox: undefined,
    tempDir: env.cwd,
    clock: { now: () => Date.now() },
    settings: () => DEFAULT_WORKSPACE_SETTINGS,
  };
}
