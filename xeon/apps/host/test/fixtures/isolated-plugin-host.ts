import { ok, type Result } from "@fresnel/contracts";
import type { IsolationSandboxSource } from "@fresnel/platform-process";
import type { AssembleOptions } from "../../src/types.ts";

// L4.host-service.spec §4.9. 격리 확장을 실제 자식(`bun apps/host/src/main.ts plugin-host --stdio`)으로 띄우는 시험 설정의 공용 도우미다.
// 샌드박스만 대역이다: 명령줄을 그대로 돌려주고 격리되지 않았다고 알린다(사용자가 샌드박스를 끈 것과 같은 표지).
// 실제 정책은 이 시험의 대상이 아니다(L0.sandbox.spec 시험이 본다). 시험은 이 함수로 설정을 받고 베껴 두지 않는다.
// 환경 변수 FRESNEL_TEST_REAL_SANDBOX=1이면 대역 대신 실제 샌드박스를 쓴다(손으로 돌리는 확인용).

const MAIN_ENTRY = new URL("../../src/main.ts", import.meta.url).pathname;

interface PassthroughArgv {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cleanup: () => void;
  readonly sandboxed: boolean;
  readonly unsandboxedBy: "disabled";
}

const passthroughSandbox: IsolationSandboxSource = {
  defaultPolicy: () => ({
    writeRoots: [],
    readDeny: [],
    writeDeny: [],
    network: { allowedDomains: [], deniedDomains: [] },
    allowEscape: false,
  }),
  wrapArgv: (_policy, plan): Promise<Result<PassthroughArgv, never>> =>
    Promise.resolve(
      ok({
        argv: [plan.command, ...plan.args],
        env: {},
        cleanup: (): void => {},
        sandboxed: false,
        unsandboxedBy: "disabled",
      }),
    ),
};

/**
 * 격리 자식을 실제로 띄우는 `pluginHost` 설정. 자기 실행 명령은 이 소스 트리의 `main.ts`이고 샌드박스는 대역이다.
 * 보고나 감독자를 받으려면 호출자가 `onLoadReport`·`onSupervisor`를 더한다(설정을 펼쳐 쓴다)
 */
export function isolatedPluginHost(): NonNullable<AssembleOptions["pluginHost"]> {
  // FRESNEL_TEST_REAL_SANDBOX=1이면 대역을 빼고 엔진의 실제 `fresnel.sandbox`로 띄운다(실제 읽기 허용 목록과 쓰기 없음 프로필 아래의 격리 시험)
  const real = Bun.env.FRESNEL_TEST_REAL_SANDBOX === "1";
  return {
    self: { execPath: process.execPath, entry: MAIN_ENTRY },
    ...(real ? {} : { sandbox: () => passthroughSandbox }),
  };
}
