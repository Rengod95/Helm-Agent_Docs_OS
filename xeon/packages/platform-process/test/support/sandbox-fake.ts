import { ok, type Result } from "@xeon/contracts";
import type {
  SandboxArgvRequest,
  SandboxedArgv,
  SandboxPolicy,
  SandboxWrapError,
} from "@xeon/contracts/services";
import type { McpSandboxSource } from "../../src/index.ts";

// 샌드박스 서비스 대역. platform-process는 platform-sandbox를 import하지 않으므로(DR-02) F 인터페이스 모양만 흉내 낸다.
// defaultPolicy는 입력을 기록하고 쓰기 루트에 작업 디렉터리와 임시 디렉터리를 넣은 정책을 돌려준다.
// wrapArgv는 시험이 정한 결과를 돌려주고, 돌려준 명령줄의 cleanup 호출 수를 센다.

/** wrapArgv가 성공할 때 돌려줄 명령줄. cleanup 호출 수는 대역이 센다 */
interface WrapPlan {
  readonly argv: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly sandboxed?: boolean;
  readonly unsandboxedBy?: NonNullable<SandboxedArgv["unsandboxedBy"]>;
}

interface FakeSandbox {
  /** McpProcessDeps.sandbox에 넘기는 값 */
  readonly source: McpSandboxSource;
  /** defaultPolicy에 들어온 입력 순서대로 */
  readonly policyInputs: readonly {
    readonly workspaceRoots: readonly string[];
    readonly tempDir: string;
  }[];
  /** wrapArgv에 들어온 정책과 요청 순서대로 */
  readonly wrapCalls: readonly {
    readonly policy: SandboxPolicy;
    readonly request: SandboxArgvRequest;
  }[];
  /** 돌려준 명령줄의 cleanup을 부른 횟수 */
  cleanups(): number;
}

export function fakeSandbox(outcome: Result<WrapPlan, SandboxWrapError>): FakeSandbox {
  const policyInputs: { workspaceRoots: string[]; tempDir: string }[] = [];
  const wrapCalls: { policy: SandboxPolicy; request: SandboxArgvRequest }[] = [];
  let cleanupCount = 0;

  const source: McpSandboxSource = {
    defaultPolicy(input): SandboxPolicy {
      policyInputs.push({ workspaceRoots: [...input.workspaceRoots], tempDir: input.tempDir });
      return {
        writeRoots: [...input.workspaceRoots, input.tempDir],
        readDeny: [],
        writeDeny: [],
        network: { allowedDomains: [], deniedDomains: [] },
        allowEscape: false,
      };
    },
    async wrapArgv(policy, request): Promise<Result<SandboxedArgv, SandboxWrapError>> {
      wrapCalls.push({ policy, request });
      if (!outcome.ok) return outcome;
      const plan = outcome.value;
      return ok({
        argv: [...plan.argv],
        env: { ...plan.env },
        sandboxed: plan.sandboxed ?? true,
        ...(plan.unsandboxedBy === undefined ? {} : { unsandboxedBy: plan.unsandboxedBy }),
        cleanup() {
          cleanupCount += 1;
        },
      });
    },
  };

  return {
    source,
    policyInputs,
    wrapCalls,
    cleanups: () => cleanupCount,
  };
}
