import { WorkspaceFiles, type WorkspaceService } from "@xeon/contracts/capabilities";
import type { WorkspaceDeps } from "./deps.ts";
import { guarded } from "./errors.ts";
import type { FilesApi } from "./files/api.ts";
import { createList } from "./files/list.ts";
import { createRead } from "./files/read.ts";
import { unsupportedFilesMethods } from "./files/unsupported.ts";
import { createImagesApi } from "./images/service.ts";
import { scopedDeps } from "./scope.ts";
import { createShellApi } from "./shell/run.ts";

// 능력별 API 객체를 조립한다. 묶음(WorkspaceService)은 Cordis에 등록하지 않는다. 등록은 plugin.ts가 능력마다 한다
// (L2.readme §5.6, F defs/workspace.ts WorkspaceService).

// 호출마다 호출한 대화의 작업 폴더로 의존을 맞춘다(scopedDeps, open-issues M-06).
export function createFilesApi(deps: WorkspaceDeps): FilesApi {
  return {
    read: (input, options) =>
      guarded(WorkspaceFiles.id, "read", () =>
        createRead(scopedDeps(deps, options?.context?.threadId))(input, options),
      ),
    list: (input, options) =>
      guarded(WorkspaceFiles.id, "list", () =>
        createList(scopedDeps(deps, options?.context?.threadId))(input, options),
      ),
    ...unsupportedFilesMethods(),
  };
}

export function createWorkspaceService(deps: WorkspaceDeps): WorkspaceService {
  return {
    files: createFilesApi(deps),
    shell: createShellApi(deps),
    images: createImagesApi(deps),
  };
}
