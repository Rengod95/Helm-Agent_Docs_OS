import type { SandboxProvider } from "../provider.ts";
import { createNoneProvider } from "./none.ts";

/** Windows 네이티브는 1차 범위 밖이다. status는 none, unsupported_os이고 onUnavailable 정책을 따른다 */
export function createWin32Provider(): SandboxProvider {
  return createNoneProvider("win32");
}
