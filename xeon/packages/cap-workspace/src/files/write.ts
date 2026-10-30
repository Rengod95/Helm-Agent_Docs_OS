import type { CancelScope } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure } from "../errors.ts";
import { relativeToRoots, resolveWorkspacePath } from "../roots.ts";
import { getOrThrow } from "../upstream/get-or-throw.ts";
import { atomicWrite } from "./atomic.ts";
import { buildFileChange } from "./diff.ts";
import { mutationKey, queueInCallOrder } from "./queue.ts";
import type { FilesApi } from "./api.ts";

// L2.workspace.spec §3.2 write, §4.3 쓰기 root 검사, §4.4 원자적 쓰기와 경로별 줄 세우기.

type WriteMethod = FilesApi["write"];

const encoder = new TextEncoder();

export function createWrite(deps: WorkspaceDeps): WriteMethod {
  return async (input, options) => {
    const context: CancelScope = { abortSignal: options?.signal };
    return queueInCallOrder(
      deps.env.id,
      async () => ({
        resolved: await resolveWorkspacePath(deps.roots, input.path, "write", context),
        roots: await deps.roots.roots(context),
      }),
      ({ resolved }) => mutationKey(deps.env.id, resolved.canonical),
      async ({ resolved, roots }) => {
        let before = "";
        if (resolved.exists) {
          const info = getOrThrow(await deps.env.fileInfo(resolved.canonical, context));
          if (info.kind === "directory") {
            throw new WorkspaceFailure("invalid_input", `${input.path} is a directory.`, {
              detail: { reason: "is_directory" },
            });
          }
          // 변경 기록용 이전 내용. 바이너리 파일이면 문자 치환이 섞이지만 기록(diff)에만 쓰인다
          before = getOrThrow(await deps.env.readTextFile(resolved.canonical, context));
        }
        await atomicWrite(deps.env, resolved.canonical, input.content, context);
        return {
          bytes: encoder.encode(input.content).length,
          change: buildFileChange({
            path: resolved.canonical,
            relativePath: relativeToRoots(roots.write, resolved.canonical),
            existed: resolved.exists,
            before,
            after: input.content,
          }),
        };
      },
    );
  };
}
