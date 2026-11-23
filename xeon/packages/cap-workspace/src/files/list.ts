import {
  LIST_DEFAULT_DEPTH,
  LIST_DEFAULT_LIMIT,
  LIST_MAX_DEPTH,
  LIST_MAX_LIMIT,
  WorkspaceFailure,
} from "@fresnel/contracts/capabilities";
import type { CancelScope } from "@fresnel/contracts/services";
import type { WorkspaceDeps } from "../deps.ts";
import type { FilesApi } from "./api.ts";
import { unprotected } from "./rg.ts";

// `ls`: 폴더 내용을 읽기 전용으로 둘러본다 [결정: 2026-11-23 사용자, AGE-77 질문 3]. 명령 실행 없이 목록을 얻는 길이다.
// 기준 폴더는 `read`와 같은 읽기 root 검사(`resolveWorkspacePath`)를 거친다. 읽기 보호 경로(시크릿 등)는 목록에서 뺀다.
// 깊이(최대 LIST_MAX_DEPTH)와 항목 수(최대 LIST_MAX_LIMIT)에 상한이 있다. 심볼릭 링크는 따라가지 않는다.
// 이름순으로 한 폴더씩 차례로 낸다(폴더 안의 항목이 먼저, 그 하위는 그 뒤). `.git`과 `node_modules`는 이름만 보이고 안으로 들어가지 않는다.

type ListMethod = FilesApi["ls"];
type ListEntry = Awaited<ReturnType<ListMethod>>["entries"][number];

interface Folder {
  readonly abs: string;
  readonly rel: string;
}

const NOT_EXPANDED = new Set([".git", "node_modules"]);

function byName(left: { readonly name: string }, right: { readonly name: string }): number {
  if (left.name < right.name) return -1;
  return left.name > right.name ? 1 : 0;
}

export function createList(deps: WorkspaceDeps): ListMethod {
  return async (input, options) => {
    const context: CancelScope = { abortSignal: options?.signal };
    const requested = input.path ?? ".";
    const depth = Math.min(input.depth ?? LIST_DEFAULT_DEPTH, LIST_MAX_DEPTH);
    const limit = Math.min(input.limit ?? LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT);
    const resolved = await deps.core.resolveWorkspacePath(deps.roots, requested, "read", context);
    if (!resolved.exists) {
      throw new WorkspaceFailure("not_found", `Path not found: ${requested}`);
    }
    const info = await deps.env.fileInfo(resolved.canonical, context);
    if (!info.ok) throw info.error;
    if (info.value.kind !== "directory") {
      throw new WorkspaceFailure(
        "invalid_input",
        `Not a directory: ${requested}. Use the read tool for a file.`,
      );
    }
    const visible = unprotected(deps, resolved.canonical);
    const entries: ListEntry[] = [];
    const state = { truncated: false };
    // 너비 우선: 한 층의 폴더를 함께 읽고, 결과는 이름순으로 차례로 쓴다
    const walk = async (level: readonly Folder[], current: number): Promise<void> => {
      if (current > depth || level.length === 0 || state.truncated) return;
      const listings = await Promise.all(
        level.map((folder) => deps.env.listDir(folder.abs, context)),
      );
      const next: Folder[] = [];
      for (const [index, folder] of level.entries()) {
        const listed = listings[index];
        if (listed === undefined) continue;
        if (!listed.ok) {
          // 읽지 못하는 하위 폴더는 건너뛴다. 기준 폴더를 못 읽으면 오류다
          if (folder.rel === "") throw listed.error;
          continue;
        }
        for (const child of listed.value.toSorted(byName)) {
          const rel = folder.rel === "" ? child.name : `${folder.rel}/${child.name}`;
          if (!visible(rel)) continue;
          if (entries.length === limit) {
            state.truncated = true;
            break;
          }
          entries.push({ path: rel, kind: child.kind });
          if (child.kind === "directory" && !NOT_EXPANDED.has(child.name)) {
            next.push({ abs: child.path, rel });
          }
        }
        if (state.truncated) break;
      }
      await walk(next, current + 1);
    };
    await walk([{ abs: resolved.canonical, rel: "" }], 1);
    return {
      root: resolved.canonical,
      entries,
      ...(state.truncated ? { truncated: { by: "entries" as const, shown: entries.length } } : {}),
    };
  };
}
