import { posix } from "node:path";
import type {
  AutoAllowBlock,
  AutoAllowDecision,
  SandboxPolicy,
  SandboxStatus,
} from "@xeon/contracts/services";
import { isInside } from "./paths.ts";

// L0.sandbox.spec §4.3. 자동 허용 판정만 한다. 승인 UI와 적용은 L1 tools다. command는 판정에 쓰지 않는다.

export interface AutoAllowRequest {
  readonly cwd: string;
  readonly workspaceRoots: readonly string[];
  readonly tempDir: string;
}

function inside(parents: readonly string[], child: string): boolean {
  if (!posix.isAbsolute(child)) return false;
  const target = posix.normalize(child);
  return parents.some(
    (parent) => posix.isAbsolute(parent) && isInside(posix.normalize(parent), target),
  );
}

/**
 * 다섯 조건을 모두 만족하면 허용이다. 어긴 조건은 모두 blocks에 담는다.
 * defaultAllowedDomains는 기본 네트워크 정책이다. 1차는 빈 목록이다.
 */
export function decideAutoAllow(
  policy: SandboxPolicy,
  request: AutoAllowRequest,
  status: Pick<SandboxStatus, "available">,
  defaultAllowedDomains: readonly string[],
): AutoAllowDecision {
  const blocks: AutoAllowBlock[] = [];
  if (!status.available) blocks.push("sandbox_unavailable");
  if (policy.allowEscape) blocks.push("escape_requested");
  const allowedRoots = [...request.workspaceRoots, request.tempDir];
  if (!policy.writeRoots.every((root) => inside(allowedRoots, root))) {
    blocks.push("write_root_outside");
  }
  if (!inside([...policy.writeRoots, ...request.workspaceRoots], request.cwd)) {
    blocks.push("cwd_outside_write_roots");
  }
  const defaults = new Set(defaultAllowedDomains);
  if (!policy.network.allowedDomains.every((domain) => defaults.has(domain))) {
    blocks.push("network_outside_default");
  }
  return blocks.length === 0 ? { allow: true } : { allow: false, blocks };
}
