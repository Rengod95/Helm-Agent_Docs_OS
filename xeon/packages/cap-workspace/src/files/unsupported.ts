import { WorkspaceFiles } from "@xeon/contracts/capabilities";
import { guarded, WorkspaceFailure } from "../errors.ts";
import type { FilesApi } from "./api.ts";

// M1은 read, list만 구현한다(L2.workspace.plan §1, §3). write·edit·grep·find는 M3(W5, W6)에서 들어온다.
// 정의(F defs/workspace.ts)에는 이미 메서드가 있어 서비스 API는 모양을 갖춰야 하므로, 아직 없는 메서드는
// unsupported로 거부한다. 이 도구들은 L1.tools에도 등록하지 않는다(plugin.ts의 IMPLEMENTED_FILES_TOOLS).

type MethodName = "write" | "edit" | "grep" | "find";

function notYet(method: MethodName, milestone: "M3"): () => Promise<never> {
  return () =>
    guarded(WorkspaceFiles.id, method, () =>
      Promise.reject(
        new WorkspaceFailure("unsupported", `workspace.files ${method} is not available yet.`, {
          detail: { milestone },
        }),
      ),
    );
}

export function unsupportedFilesMethods(): Pick<FilesApi, MethodName> {
  return {
    write: notYet("write", "M3"),
    edit: notYet("edit", "M3"),
    grep: notYet("grep", "M3"),
    find: notYet("find", "M3"),
  };
}
