import type { CancelScope } from "@xeon/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import { WorkspaceFailure } from "../errors.ts";
import { relativeToRoots, resolveWorkspacePath } from "../roots.ts";
import { getOrThrow } from "../upstream/get-or-throw.ts";
import { atomicWrite } from "./atomic.ts";
import { buildFileChange } from "./diff.ts";
import { mutationKey, queueInCallOrder } from "./queue.ts";
import {
  applyEdits,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
  type EditFailure,
} from "./upstream/edit-diff.ts";
import type { FilesApi } from "./api.ts";

// L2.workspace.spec §3.2 edit, §4.4 편집 규칙 E1~E17, 동시 변경 감지, §5 11·12번.

type EditMethod = FilesApi["edit"];

const FAILURE_CODES: Readonly<Record<EditFailure["kind"], string>> = {
  empty_old_text: "edit_empty_old_text",
  not_found: "edit_not_found",
  ambiguous: "edit_ambiguous",
  overlap: "edit_overlap",
  no_change: "edit_no_change",
};

function failureOf(failure: EditFailure): WorkspaceFailure {
  return new WorkspaceFailure(FAILURE_CODES[failure.kind], failure.message, {
    detail: {
      editIndex: failure.editIndex,
      totalEdits: failure.totalEdits,
      ...(failure.occurrences === undefined ? {} : { occurrences: failure.occurrences }),
      ...(failure.fuzzyDisabled === true ? { fuzzyDisabled: true } : {}),
    },
  });
}

export function createEdit(deps: WorkspaceDeps): EditMethod {
  return async (input, options) => {
    const context: CancelScope = { abortSignal: options?.signal };
    const settings = deps.settings(options?.context?.threadId);
    return queueInCallOrder(
      deps.env.id,
      async () => {
        const target = await resolveWorkspacePath(deps.roots, input.path, "write", context);
        if (!target.exists) {
          throw new WorkspaceFailure("not_found", `File not found: ${input.path}`);
        }
        return { resolved: target, roots: await deps.roots.roots(context) };
      },
      ({ resolved }) => mutationKey(deps.env.id, resolved.canonical),
      async ({ resolved, roots }) => {
        const info = getOrThrow(await deps.env.fileInfo(resolved.canonical, context));
        if (info.kind === "directory") {
          throw new WorkspaceFailure("invalid_input", `${input.path} is a directory.`, {
            detail: { reason: "is_directory" },
          });
        }
        // 이 내용이 편집의 원본이다. 이름을 바꾸기 직전에 파일이 이 내용 그대로인지 다시 본다(동시 변경 감지)
        const original = getOrThrow(await deps.env.readTextFile(resolved.canonical, context));
        const { bom, text } = stripBom(original);
        const ending = detectLineEnding(text);
        const applied = applyEdits(normalizeToLF(text), input.edits, {
          fuzzy: settings.edit.fuzzy,
        });
        if (!applied.ok) throw failureOf(applied.error);
        await atomicWrite(
          deps.env,
          resolved.canonical,
          bom + restoreLineEndings(applied.value.newContent, ending),
          context,
          { expectedBefore: original },
        );
        return {
          applied: input.edits.length,
          matchMode: applied.value.matchMode,
          change: buildFileChange({
            path: resolved.canonical,
            relativePath: relativeToRoots(roots.write, resolved.canonical),
            existed: true,
            before: applied.value.baseContent,
            after: applied.value.newContent,
          }),
        };
      },
    );
  };
}
