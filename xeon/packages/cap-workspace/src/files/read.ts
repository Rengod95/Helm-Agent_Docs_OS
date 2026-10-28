import { assertNever } from "@xeon/contracts";
import type { CancelScope } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure } from "../errors.ts";
import { loadImageAt, probeImageType } from "../images/service.ts";
import { resolveWorkspacePath } from "../roots.ts";
import { pageRead } from "../truncate/paging.ts";
import { readFileText } from "./upstream/read.ts";
import type { FilesApi } from "./api.ts";

// L2.workspace.spec §3.2 read, §4.3, §4.5, §5, §4.6. 이미지 파일은 workspace.images 최소형(plan W7)으로 준비해 blob 참조로 돌려준다.

type ReadMethod = FilesApi["read"];

export function createRead(deps: WorkspaceDeps): ReadMethod {
  return async (input, options) => {
    const context: CancelScope = { abortSignal: options?.signal };
    const settings = deps.settings(options?.context?.threadId);
    const resolved = await resolveWorkspacePath(deps.roots, input.path, "read", context, {
      variants: true,
    });
    if (!resolved.exists) {
      throw new WorkspaceFailure("not_found", `File not found: ${input.path}`);
    }
    const info = await deps.env.fileInfo(resolved.canonical, context);
    if (!info.ok) throw info.error;
    if (info.value.kind === "directory") {
      throw new WorkspaceFailure(
        "invalid_input",
        `${input.path} is a directory. Use ls to list it.`,
        { detail: { reason: "is_directory" } },
      );
    }
    // blob 저장소가 있을 때만 이미지로 다룬다. 없으면 이미지도 바이너리 파일로 거부한다(spec §5 2번)
    if (deps.blobs !== undefined) {
      const imageType = await probeImageType(deps, resolved.canonical, context);
      if (imageType !== undefined) {
        const image = await loadImageAt(
          deps,
          resolved.canonical,
          input.path,
          settings.images,
          undefined,
          context,
        );
        return { kind: "image", path: resolved.canonical, image };
      }
    }
    const outcome = await readFileText(
      deps.env,
      resolved.canonical,
      input.offset,
      input.limit,
      settings.read,
      context,
    );
    switch (outcome.kind) {
      case "binary":
        throw new WorkspaceFailure(
          "read_binary",
          `${input.path} is a binary file. Use bash to inspect it.`,
        );
      case "beyond_end":
        throw new WorkspaceFailure(
          "offset_beyond_end",
          `Offset ${input.offset ?? 1} is beyond end of file (${outcome.fileLines} lines total)`,
          { detail: { totalLines: outcome.fileLines } },
        );
      case "text":
        return { kind: "text", path: resolved.canonical, ...pageRead(outcome.slice) };
      default:
        return assertNever(outcome, "ReadFileOutcome");
    }
  };
}
