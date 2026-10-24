import { Bug } from "@xeon/contracts";
import type { ExecPlatformProvider } from "../../src/provider.ts";
import { detectExecPlatform } from "../../src/select.ts";

/** 시험을 실행하는 호스트의 provider. 지원 밖 OS면 시험 환경 결함이다 */
export function hostPlatform(): ExecPlatformProvider {
  const selected = detectExecPlatform();
  if (!selected.ok) throw new Bug(`unsupported test host: ${selected.error.platform}`);
  return selected.value;
}
