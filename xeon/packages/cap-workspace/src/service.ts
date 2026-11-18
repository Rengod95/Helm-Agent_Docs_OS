import { WorkspaceFiles, type WorkspaceService } from "@fresnel/contracts/capabilities";
import { scopeDeps, type WorkspaceDeps } from "./deps.ts";
import type { FilesApi } from "./files/api.ts";
import { createEdit } from "./files/edit.ts";
import { createGrep } from "./files/grep.ts";
import { createRead } from "./files/read.ts";
import { createWrite } from "./files/write.ts";
import { createImagesApi } from "./images/service.ts";

// 기능별 API 객체를 조립한다. 묶음(WorkspaceService)은 Cordis에 등록하지 않는다. 등록은 plugin.ts가 기능마다 한다
// (L2.readme §5.6, F defs/workspace.ts WorkspaceService).
// 실패 경계(`guarded`)와 경로·셸 구현은 `deps.core`가 주는 것을 쓴다.

// 호출마다 호출한 대화의 작업 폴더로 의존을 맞춘다(scopedDeps, open-issues M-06).
export function createFilesApi(deps: WorkspaceDeps): FilesApi {
  return {
    read: (input, options) =>
      deps.core.guarded(WorkspaceFiles.id, "read", () =>
        createRead(scopeDeps(deps, options?.context?.threadId))(input, options),
      ),
    write: (input, options) =>
      deps.core.guarded(WorkspaceFiles.id, "write", () =>
        createWrite(scopeDeps(deps, options?.context?.threadId))(input, options),
      ),
    edit: (input, options) =>
      deps.core.guarded(WorkspaceFiles.id, "edit", () =>
        createEdit(scopeDeps(deps, options?.context?.threadId))(input, options),
      ),
    grep: (input, options) =>
      deps.core.guarded(WorkspaceFiles.id, "grep", () =>
        createGrep(scopeDeps(deps, options?.context?.threadId))(input, options),
      ),
  };
}

export function createWorkspaceService(deps: WorkspaceDeps): WorkspaceService {
  return {
    files: createFilesApi(deps),
    shell: deps.core.createShellApi(deps),
    images: createImagesApi(deps),
  };
}
