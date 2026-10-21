import { assertNever, err } from "@xeon/contracts";
import type {
  AutoAllowDecision,
  ProtectedPathEntry,
  SandboxPolicy,
  SandboxService,
  SandboxStatus,
  SelfTestReport,
  Shell,
} from "@xeon/contracts/services";
import { decideAutoAllow } from "../auto-allow.ts";
import { SELF_TEST_ITEM_IDS } from "../self-test.ts";
import { decideExecution, rejectionError, unsandboxedReport, withReport } from "../wrap-shell.ts";

// L0.sandbox.plan §2 fakeSandbox. 상태와 판정을 표로 고정하고, wrapShell은 기록만 하는 통과 데코레이터다.
// onUnavailable 표(spec §4.5)는 실제 규칙(decideExecution)을 쓴다.

export interface FakeSandboxOptions {
  /** 기본: available true, level "srt", platform "linux", onUnavailable "disable_execute" */
  readonly status?: Partial<SandboxStatus>;
  /** 기본: 실제 auto-allow.ts 판정 */
  readonly autoAllow?: AutoAllowDecision;
  readonly protectedPaths?: readonly ProtectedPathEntry[];
}

export interface FakeSandbox extends SandboxService {
  /** wrapShell로 감싼 exec 호출 기록: 명령, 정책 */
  readonly wrapped: readonly {
    readonly command: string | readonly string[];
    readonly policy: SandboxPolicy;
  }[];
}

function fakeStatus(options: FakeSandboxOptions): SandboxStatus {
  const given = options.status ?? {};
  const available = given.available ?? true;
  return {
    level: available ? "srt" : "none",
    platform: "linux",
    onUnavailable: "disable_execute",
    ...given,
    available,
  };
}

export function fakeSandbox(options: FakeSandboxOptions = {}): FakeSandbox {
  const status = fakeStatus(options);
  const protectedPaths = options.protectedPaths ?? [];
  const wrapped: { command: string | readonly string[]; policy: SandboxPolicy }[] = [];

  const wrapShell = (shell: Shell, policy: SandboxPolicy): Shell => ({
    async exec(command, execOptions, context) {
      wrapped.push({ command, policy });
      const decision = decideExecution(status, policy, false);
      switch (decision.action) {
        case "reject":
          return err(rejectionError(decision, status));
        case "plain": {
          const result = await shell.exec(command, execOptions, context);
          return withReport(result, unsandboxedReport(decision.by));
        }
        case "sandboxed": {
          const result = await shell.exec(command, execOptions, context);
          return withReport(result, {
            sandboxed: true,
            level: status.level,
            violations: [],
            violationsTruncated: false,
          });
        }
        default:
          return assertNever(decision, "ExecutionDecision");
      }
    },
    cleanup: (context) => shell.cleanup(context),
  });

  return {
    wrapped,
    status: () => status,
    defaultPolicy: (input) => ({
      writeRoots: [...input.workspaceRoots, input.tempDir],
      readDeny: protectedPaths.filter((e) => e.access === "read_write").map((e) => e.path),
      writeDeny: protectedPaths.map((e) => e.path),
      network: { allowedDomains: [], deniedDomains: [] },
      allowEscape: false,
    }),
    protectedPaths: () => protectedPaths,
    wrapShell,
    autoAllow: (policy, request) =>
      options.autoAllow ?? decideAutoAllow(policy, request, status, []),
    selfTest: (): Promise<SelfTestReport> =>
      Promise.resolve({
        at: 0,
        durationMs: 0,
        passed: status.available,
        items: SELF_TEST_ITEM_IDS.map((id) => ({ id, passed: status.available })),
      }),
  };
}
