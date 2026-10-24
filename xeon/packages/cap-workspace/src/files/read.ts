import { assertNever } from "@xeon/contracts";
import type { CancelScope } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure } from "../errors.ts";
import { resolveWorkspacePath } from "../roots.ts";
import { pageRead } from "../truncate/paging.ts";
import { readFileText } from "./upstream/read.ts";
import type { FilesApi } from "./api.ts";

// L2.workspace.spec §3.2 read, §4.3, §4.5, §5. 이미지 분기(workspace.images)는 M2(plan W7)다.

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
