import { WorkspaceFiles, type WorkspaceService } from "@fresnel/contracts/capabilities";
import type { WorkspaceDeps } from "./deps.ts";
import { createShellApi, guarded, scopedDeps } from "@fresnel/core-workspace";
import type { FilesApi } from "./files/api.ts";
import { createEdit } from "./files/edit.ts";
import { createGrep } from "./files/grep.ts";
import { createRead } from "./files/read.ts";
import { createWrite } from "./files/write.ts";
import { createImagesApi } from "./images/service.ts";

// 기능별 API 객체를 조립한다. 묶음(WorkspaceService)은 Cordis에 등록하지 않는다. 등록은 plugin.ts가 기능마다 한다
// (L2.readme §5.6, F defs/workspace.ts WorkspaceService).

// 호출마다 호출한 대화의 작업 폴더로 의존을 맞춘다(scopedDeps, open-issues M-06).
export function createFilesApi(deps: WorkspaceDeps): FilesApi {
  return {
    read: (input, options) =>
      guarded(WorkspaceFiles.id, "read", () =>
        createRead(scopedDeps(deps, options?.context?.threadId))(input, options),
      ),
    write: (input, options) =>
      guarded(WorkspaceFiles.id, "write", () =>
        createWrite(scopedDeps(deps, options?.context?.threadId))(input, options),
      ),
    edit: (input, options) =>
      guarded(WorkspaceFiles.id, "edit", () =>
        createEdit(scopedDeps(deps, options?.context?.threadId))(input, options),
      ),
    grep: (input, options) =>
      guarded(WorkspaceFiles.id, "grep", () =>
        createGrep(scopedDeps(deps, options?.context?.threadId))(input, options),
      ),
  };
}

export function createWorkspaceService(deps: WorkspaceDeps): WorkspaceService {
  return {
    files: createFilesApi(deps),
    shell: createShellApi(deps),
    images: createImagesApi(deps),
  };
}
