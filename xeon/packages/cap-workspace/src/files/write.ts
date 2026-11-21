import type { CancelScope } from "@fresnel/contracts/services";
import { WorkspaceFailure } from "@fresnel/contracts/capabilities";
import type { WorkspaceDeps } from "../deps.ts";
import { buildFileChange } from "./diff.ts";
import { decodeStrictText } from "./text-bytes.ts";
import type { FilesApi } from "./api.ts";

// L2.workspace.spec §3.2 write, §4.3 쓰기 root 검사, §4.4 원자적 쓰기와 경로별 줄 세우기.
// 경로·파일 기능(`deps.core`)은 코어 구현 묶음이 준다.

type WriteMethod = FilesApi["write"];

const encoder = new TextEncoder();

export function createWrite(deps: WorkspaceDeps): WriteMethod {
  const { core } = deps;
  return async (input, options) => {
    const context: CancelScope = { abortSignal: options?.signal };
    return core.queueInCallOrder(
      deps.env.id,
      async () => ({
        resolved: await core.resolveWorkspacePath(deps.roots, input.path, "write", context),
        roots: await deps.roots.roots(context),
      }),
      ({ resolved }) => core.mutationKey(deps.env.id, resolved.canonical),
      async ({ resolved, roots }) => {
        let before = "";
        let previous: Uint8Array | null = null;
        if (resolved.exists) {
          const info = core.getOrThrow(await deps.env.fileInfo(resolved.canonical, context));
          if (info.kind === "directory") {
            throw new WorkspaceFailure("invalid_input", `${input.path} is a directory.`, {
              detail: { reason: "is_directory" },
            });
          }
          // 변경 기록용 이전 내용. write는 전체 교체라 텍스트가 아닌 파일도 덮어쓰되(E18), 문자 치환이 섞인
          // 가짜 diff를 만들지 않도록 이전 내용을 비운다
          const bytes = core.getOrThrow(await deps.env.readBinaryFile(resolved.canonical, context));
          previous = bytes;
          before = decodeStrictText(bytes) ?? "";
        }
        // 원본 저장은 쓰기 전에 끝난다. 실패해도 쓰기는 그대로 간다(L1.persistence.spec §4.13.2)
        const after = encoder.encode(input.content);
        deps.rewind?.capture(options?.context, options?.requestId, {
          path: resolved.canonical,
          before: previous,
          after,
        });
        await core.atomicWrite(deps.env, resolved.canonical, input.content, context);
        return {
          bytes: after.length,
          change: buildFileChange({
            path: resolved.canonical,
            relativePath: core.relativeToRoots(roots.write, resolved.canonical),
            existed: resolved.exists,
            before,
            after: input.content,
          }),
        };
      },
    );
  };
}
