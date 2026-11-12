import type { Result } from "@fresnel/contracts";
import { wireError, type WireHandlers } from "@fresnel/contracts/wire";
import type { SelfTestReport } from "@fresnel/contracts/services";

// 샌드박스 자가 시험 wire(M4, `sandbox.lastSelfTest`·`sandbox.selfTest`, L0.sandbox.spec §4.4). 읽기는 마지막 보고서를 돌려주고,
// 실행은 같은 시험을 지금 한 번 돌린다. 둘 다 샌드박스 정책을 바꾸지 않고 이 기기에서 샌드박스를 찔러 볼 뿐이다.
// 이 파일과 `assembly/m4/sandbox-self-test-port.ts`만 고친다.

/** 처리기가 쓰는 포트. 서비스가 올라와 있지 않으면 실행이 `not_running`이다 */
export interface SandboxSelfTestPort {
  /** 마지막으로 기록된 보고서. 없으면 undefined */
  last(): SelfTestReport | undefined;
  /** 자가 시험을 지금 한 번 돌린다. 끝나면 보고서를 돌려주고, 서비스가 없으면 `not_running`이다 */
  run(signal: AbortSignal): Promise<Result<SelfTestReport, { readonly kind: "not_running" }>>;
}

export type SandboxSelfTestMethods = "sandbox.lastSelfTest" | "sandbox.selfTest";

export function createSandboxSelfTestHandlers(
  port: SandboxSelfTestPort,
): Pick<WireHandlers, SandboxSelfTestMethods> {
  return {
    "sandbox.lastSelfTest": () => Promise.resolve({ report: port.last() ?? null }),
    "sandbox.selfTest": async (_params, context) => {
      const ran = await port.run(context.signal);
      // 자가 시험 서비스는 조립 때 항상 올라오므로 없는 것은 조립이 깨진 것이다. 사용자가 고칠 것이 없어 내부 오류로 알린다
      if (!ran.ok) {
        throw wireError("internal", { message: "sandbox: the sandbox service is not running" });
      }
      return ran.value;
    },
  };
}
