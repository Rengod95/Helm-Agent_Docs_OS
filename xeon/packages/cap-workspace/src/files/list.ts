import type { CancelScope } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure } from "../errors.ts";
import { resolveWorkspacePath } from "../roots.ts";
import { pageEntries } from "../truncate/paging.ts";
import { listDirectory } from "./upstream/ls.ts";
import type { FilesApi } from "./api.ts";

// L2.workspace.spec §3.2 list(도구 이름 ls), §4.5.

type ListMethod = FilesApi["list"];

export function createList(deps: WorkspaceDeps): ListMethod {
  return async (input, options) => {
    const context: CancelScope = { abortSignal: options?.signal };
    const settings = deps.settings(options?.context?.threadId);
    const requested = input.path ?? ".";
    const resolved = await resolveWorkspacePath(deps.roots, requested, "read", context);
    if (!resolved.exists) {
      throw new WorkspaceFailure("not_found", `Path not found: ${requested}`);
    }
    const info = await deps.env.fileInfo(resolved.canonical, context);
    if (!info.ok) throw info.error;
    if (info.value.kind !== "directory") {
      throw new WorkspaceFailure("invalid_input", `Not a directory: ${requested}`);
    }
    // 설정은 기본값이다. 호출자가 `limit`을 주면 그 값이 앞선다(spec §4.5 "limit 또는 설정 기본값")
    const limit = input.limit ?? settings.list.maxEntries;
    const listed = await listDirectory(deps.env, resolved.canonical, limit, context);
    return {
      path: resolved.canonical,
      entries: listed.entries.map((entry) => ({ name: entry.name, kind: entry.kind })),
      ...(listed.cutBy === undefined
        ? {}
        : { truncated: pageEntries(listed.cutBy, listed.entries.length, listed.total) }),
    };
  };
}
