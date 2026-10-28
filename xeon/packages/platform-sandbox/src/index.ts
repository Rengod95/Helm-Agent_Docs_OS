// @xeon/platform-sandbox (L0, xeon.sandbox). 공개 진입점은 조립 루트가 쓰는 이름만 내보낸다(BP-09).
// describeSandboxStatus는 F(@xeon/contracts/services)에 있다. 이 패키지는 srt 래핑 구현이다.
export {
  createSandboxService,
  type SandboxServiceDeps,
  type SandboxServiceHandle,
  type SelfTestRunError,
  type SelfTestSchedule,
} from "./service.ts";
export {
  DEFAULT_SANDBOX_SETTINGS,
  SANDBOX_SETTING_DEFS,
  readSandboxSettings,
  type SandboxSettings,
} from "./settings.ts";
export type { SrtPort } from "./srt.ts";
export {
  decideMcpStdioSandbox,
  shellForMcpStdio,
  type McpStdioSandboxDecision,
} from "./mcp-stdio.ts";
