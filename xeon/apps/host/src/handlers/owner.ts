import { assertNever } from "@xeon/contracts";
import { wireError, type WireError } from "@xeon/contracts/wire";
import type { HostMode, OwnerKind } from "../types.ts";

// L4.host-service.spec HS-24 3단계, HS-25. 쓰기 소유를 얻지 못했을 때의 오류와 호스트 모드별 소유 표시 종류.

/** 호스트 모드 → sys_leases.kind. in-process → cli, stdio → app, service → service */
export function ownerKindOf(mode: HostMode): OwnerKind {
  switch (mode) {
    case "in-process":
      return "cli";
    case "stdio":
      return "app";
    case "service":
      return "service";
    default:
      return assertNever(mode, "HostMode");
  }
}

/**
 * thread.locked(3002)의 대안(HS-25). "observe"와 "fork"는 항상 넣는다. "delegate"는 서비스에 접속할 수 있고 이 호스트가
 * 서비스가 아닐 때만 넣는데 서비스 모드(M3)가 없는 M1에서는 넣지 않는다.
 */
function lockedOptions(): readonly ("observe" | "fork" | "delegate")[] {
  return ["observe", "fork"];
}

export function threadLocked(ownerKind: OwnerKind | null): WireError {
  return wireError("thread.locked", {
    details: { ownerKind: ownerKind ?? "unknown", options: [...lockedOptions()] },
  });
}
