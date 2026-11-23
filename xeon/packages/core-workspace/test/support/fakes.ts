import { err, type Clock } from "@fresnel/contracts";
import {
  ExecutionError,
  type ProtectedPathEntry,
  type SandboxPolicy,
  type SandboxService,
  type Shell,
  type ToolOutputFiles,
} from "@fresnel/contracts/services";
import type { WorkspaceDeps, WorkspaceShellSettings } from "../../src/deps.ts";
import type { BlobSink } from "../../src/ports/blobs.ts";
import type { ThreadWorkspaces } from "../../src/ports/threads.ts";
import { defaultRoots } from "../../src/roots.ts";
import type { MemoryEnv } from "./memory-env.ts";

// 이 패키지의 시험이 쓰는 대역. cap-workspace의 시험 대역과 같은 본문이고, 설정은 셸 키만 있다(L2 설정 키는 이 패키지가 모른다).

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
      writeRoots:
        input.profile === "read-only"
          ? []
          : input.writeEverywhere === true
            ? ["/"]
            : [...input.workspaceRoots, input.tempDir],
      readDeny: [],
      writeDeny: [],
      network: { allowedDomains: [], deniedDomains: [] },
      allowEscape: false,
      ...(input.readCarveOuts === undefined ? {} : { readCarveOuts: [...input.readCarveOuts] }),
      ...(input.profile === undefined ? {} : { profile: input.profile }),
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

/** 셸 시험의 기본 한도. cap-workspace의 기본값(l2.workspace.shell.*)과 같은 값이다 */
export const SHELL_DEFAULTS: WorkspaceShellSettings["shell"] = {
  maxLines: 2000,
  maxBytes: 51200,
  defaultTimeoutSec: 0,
};

export interface DepsOptions {
  readonly settings?: (threadId: string | undefined) => WorkspaceShellSettings;
  readonly sandbox?: FakeSandbox | null;
  readonly protectedPaths?: readonly ProtectedPathEntry[];
  readonly blobs?: BlobSink;
  readonly threads?: ThreadWorkspaces;
  readonly unattendedTimeoutMs?: () => number;
  /** 참이면 쓰기 root에서 `/`(제한 없음)를 뺀 좁은 대화(플러그인 만들기 시험)다. 작업 폴더 밖 쓰기가 막히는 길을 시험할 때 쓴다 */
  readonly narrowRoots?: boolean;
  /** 잘린 도구 출력의 파일 사본(읽기 루트와 복원) */
  readonly outputs?: ToolOutputFiles;
}

/** 대역 환경으로 서비스 의존을 만든다. sandbox가 null이면 서비스가 없는 상태다 */
export function depsFor(env: MemoryEnv, options: DepsOptions = {}): WorkspaceDeps {
  const sandbox = options.sandbox === undefined ? fakeSandbox() : (options.sandbox ?? undefined);
  const protectedPaths = options.protectedPaths ?? [];
  return {
    env,
    roots: {
      env,
      roots: async (context) => {
        const roots = await defaultRoots(env, context, options.outputs);
        return options.narrowRoots === true
          ? { ...roots, write: roots.write.filter((root) => root !== "/") }
          : roots;
      },
      protectedPaths: () => protectedPaths,
      ...(options.outputs === undefined ? {} : { outputs: options.outputs }),
    },
    sandbox,
    tempDir: "/tmp/fresnel",
    clock: steppingClock(),
    settings: options.settings ?? (() => ({ shell: SHELL_DEFAULTS })),
    ...(options.blobs === undefined ? {} : { blobs: options.blobs }),
    ...(options.threads === undefined ? {} : { threads: options.threads }),
    ...(options.unattendedTimeoutMs === undefined
      ? {}
      : { unattendedTimeoutMs: options.unattendedTimeoutMs }),
  };
}
