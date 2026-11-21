import { Bug } from "@fresnel/contracts";
import { createExecService, detectExecPlatform } from "@fresnel/platform-exec";
import { defaultRoots, workspaceCore, type WorkspaceEnv } from "@fresnel/core-workspace";
import type { WorkspaceDeps } from "../../src/deps.ts";
import { DEFAULT_WORKSPACE_SETTINGS } from "../../src/settings.ts";

// 실제 파일 시스템 위의 fresnel.exec로 서비스 의존을 만든다(int 시험용). `override`는 일부 메서드를 바꾼 env를 만든다.

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

/** `narrowRoots`가 참이면 쓰기 root에서 `/`(제한 없음)를 뺀 좁은 대화다. 작업 폴더 밖 쓰기가 막히는 길을 시험할 때 쓴다 */
export function realDeps(env: WorkspaceEnv, narrowRoots = false): WorkspaceDeps {
  return {
    env,
    core: workspaceCore,
    roots: {
      env,
      roots: async (context) => {
        const roots = await defaultRoots(env, context);
        return narrowRoots
          ? { ...roots, write: roots.write.filter((root) => root !== "/") }
          : roots;
      },
      protectedPaths: () => [],
    },
    sandbox: undefined,
    tempDir: env.cwd,
    clock: { now: () => Date.now() },
    settings: () => DEFAULT_WORKSPACE_SETTINGS,
  };
}
