import { isAbsolute, relative, resolve } from "node:path";

// L3.authoring.spec §3.2 `authoring_start`의 `dir` 풀이. 대상 폴더는 항상 절대 경로로 정한다.
// 절대 경로는 그대로 쓰고, 상대 경로는 대화의 작업 폴더 안으로만 푼다. 작업 폴더가 없으면 상대 경로로 세션을 열지 않는다(숨은 기본 위치는 없다).

export type TargetDirResult =
  | { readonly ok: true; readonly dir: string }
  /** 상대 경로인데 대화에 작업 폴더가 없다: 사용자가 폴더를 골라야 한다 */
  | { readonly ok: false; readonly kind: "needs_folder" }
  /** 상대 경로가 작업 폴더 밖으로 나간다 */
  | { readonly ok: false; readonly kind: "outside_workspace" };

export function resolveTargetDir(dir: string, workspace: string | undefined): TargetDirResult {
  if (isAbsolute(dir)) return { ok: true, dir: resolve(dir) };
  if (workspace === undefined || workspace === "") return { ok: false, kind: "needs_folder" };
  const target = resolve(workspace, dir);
  const from = relative(workspace, target);
  if (from.startsWith("..") || isAbsolute(from)) return { ok: false, kind: "outside_workspace" };
  return { ok: true, dir: target };
}
