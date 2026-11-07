import { assertNever } from "@fresnel/contracts";
import type { WireHandler, WireHandlers } from "@fresnel/contracts/wire";
import {
  canonicalWorkspace,
  wireErrorOfWorkspace,
  workspaceFilterOf,
} from "../assembly/workspace.ts";

// F wire §3.3.1 workspace.status. 대화의 작업 폴더가 지금 있는 폴더인지 클라이언트가 묻는다(데스크톱의 띠).
// 아무것도 바꾸지 않는다. 존재 판정은 `thread.create`가 쓰는 규칙(`canonicalWorkspace`)과 같다.
// 없거나 폴더가 아니면 `exists`가 거짓이고, 상대 경로나 읽을 수 없는 경로는 `jsonrpc.invalidParams`다.

function createWorkspaceStatusHandler(): WireHandler<"workspace.status"> {
  return async (params) => {
    const found = await canonicalWorkspace(params.workspace);
    if (found.ok) return { exists: true, path: found.value };
    switch (found.error.kind) {
      case "not_found":
      case "not_directory": {
        // 없는 경로는 정규화할 수 없어 `.`·`..`만 정리한 절대 경로를 싣는다(`thread.list`의 필터와 같다)
        const filter = await workspaceFilterOf(params.workspace);
        if (!filter.ok) throw wireErrorOfWorkspace(filter.error);
        return { exists: false, path: filter.value };
      }
      case "not_absolute":
      case "unreadable":
        throw wireErrorOfWorkspace(found.error);
      default:
        return assertNever(found.error, "WorkspaceFailure");
    }
  };
}

export function createWorkspaceHandlers(): Pick<WireHandlers, "workspace.status"> {
  return { "workspace.status": createWorkspaceStatusHandler() };
}
