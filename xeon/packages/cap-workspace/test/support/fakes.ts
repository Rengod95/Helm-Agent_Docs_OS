import { err, type Clock } from "@xeon/contracts";
import {
  ExecutionError,
  type ProtectedPathEntry,
  type SandboxPolicy,
  type SandboxService,
  type Shell,
} from "@xeon/contracts/services";
import type { ScopeStack } from "@xeon/contracts/settings";
import type { WorkspaceDeps } from "../../src/deps.ts";
import type { BlobSink } from "../../src/ports/blobs.ts";
import type { ThreadWorkspaces } from "../../src/ports/threads.ts";
import { defaultRoots } from "../../src/roots.ts";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  readWorkspaceSettings,
  type WorkspaceSettings,
} from "../../src/settings.ts";
import type { MemoryEnv } from "./memory-env.ts";

export interface FakeSandbox extends Pick<
  SandboxService,
  "defaultPolicy" | "wrapShell" | "protectedPaths"
> {
  /** 받은 정책 */
  readonly policies: SandboxPolicy[];
  /** 참이면 wrapShell이 감싼 Shell이 실행 전에 sandbox_unavailable로 거부한다 */
  deny: boolean;
}

/** wrapShell은 기록만 하는 통과 데코레이터다. 거부 모드에서는 아래 Shell을 부르지 않는다 */
export function fakeSandbox(protectedPaths: readonly ProtectedPathEntry[] = []): FakeSandbox {
  const policies: SandboxPolicy[] = [];
  const sandbox: FakeSandbox = {
    policies,
    deny: false,
    defaultPolicy: (input) => ({
      writeRoots: [...input.workspaceRoots, input.tempDir],
      readDeny: [],
      writeDeny: [],
      network: { allowedDomains: [], deniedDomains: [] },
      allowEscape: false,
    }),
    protectedPaths: () => protectedPaths,
    wrapShell: (shell: Shell, policy: SandboxPolicy): Shell => {
      policies.push(policy);
      return {
        exec: async (command, options, context) => {
          if (sandbox.deny)
            return err(new ExecutionError("sandbox_unavailable", "sandbox is unavailable"));
          const result = await shell.exec(command, options, context);
          if (!result.ok) return result;
          return {
            ok: true,
            value: {
              ...result.value,
              sandbox: {
                sandboxed: true,
                level: "srt",
                violations: [],
                violationsTruncated: false,
              },
            },
          };
        },
        cleanup: (context) => shell.cleanup(context),
      };
    },
  };
  return sandbox;
}

function steppingClock(step = 5): Clock {
  let now = 1_000;
  return {
    now: () => {
      now += step;
      return now;
    },
  };
}

export interface DepsOptions {
  readonly sandbox?: FakeSandbox | null;
  readonly protectedPaths?: readonly ProtectedPathEntry[];
  readonly settings?: (threadId: string | undefined) => WorkspaceSettings;
  readonly layers?: ScopeStack;
  readonly blobs?: BlobSink;
  readonly threads?: ThreadWorkspaces;
}

/** 대역 환경으로 서비스 의존을 만든다. sandbox가 null이면 서비스가 없는 상태다 */
export function depsFor(env: MemoryEnv, options: DepsOptions = {}): WorkspaceDeps {
  const sandbox = options.sandbox === undefined ? fakeSandbox() : (options.sandbox ?? undefined);
  const protectedPaths = options.protectedPaths ?? [];
  return {
    env,
    roots: {
      env,
      roots: (context) => defaultRoots(env, context),
      protectedPaths: () => protectedPaths,
    },
    sandbox,
    tempDir: "/tmp/xeon",
    clock: steppingClock(),
    settings:
      options.settings ??
      (options.layers === undefined
        ? () => DEFAULT_WORKSPACE_SETTINGS
        : () => readWorkspaceSettings(options.layers ?? [])),
    ...(options.blobs === undefined ? {} : { blobs: options.blobs }),
    ...(options.threads === undefined ? {} : { threads: options.threads }),
  };
}
