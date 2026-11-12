import { err, ok } from "@fresnel/contracts";
import type { PortKey } from "@fresnel/contracts/extensions";
import { ExecPortKey, SandboxServiceName, type SandboxService } from "@fresnel/contracts/services";
import type { ExtHost } from "@fresnel/ext-host";
import type { SandboxSelfTestPort } from "../../handlers/m4/sandbox-self-test.ts";

// 샌드박스 자가 시험 포트(`sandbox.lastSelfTest`·`sandbox.selfTest`). `fresnel.sandbox`와 `fresnel.exec`는 확장 호스트에 올라온 뒤 찾는다
// (`mcp-process.ts`와 같다). 시험에 쓰는 Shell은 `fresnel.exec`의 것이고(L0.sandbox.spec §4.4), 정책은 서비스가 정한다.

const SANDBOX_SERVICE_KEY: PortKey<SandboxService> = { name: SandboxServiceName };

export function createSandboxSelfTestPort(host: ExtHost): SandboxSelfTestPort {
  return {
    last: () => host.ports.get(SANDBOX_SERVICE_KEY)?.lastSelfTestReport(),
    async run(signal) {
      const sandbox = host.ports.get(SANDBOX_SERVICE_KEY);
      const shell = host.ports.get(ExecPortKey);
      if (sandbox === undefined || shell === undefined) return err({ kind: "not_running" });
      return ok(await sandbox.selfTest(shell, { abortSignal: signal }));
    },
  };
}
