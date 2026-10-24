import type { ExecService, ExecutionEnv } from "@xeon/contracts/services";

/**
 * 이 패키지가 `xeon.exec`에서 쓰는 메서드. `ExecService`가 그대로 대입된다. 출력 절단(`truncateHeadOf`)은 사본 없이
 * `xeon.exec`로 부른다(review.decisions-2 D-08, B-04). 쓰는 메서드를 좁혀 두면 시험용 대역이 이 목록만 구현하면 된다.
 */
export type WorkspaceEnv = Pick<ExecService, "truncateHeadOf"> &
  Pick<
    ExecutionEnv,
    | "id"
    | "cwd"
    | "absolutePath"
    | "canonicalPath"
    | "exists"
    | "fileInfo"
    | "listDir"
    | "openBinaryReader"
    | "exec"
    | "cleanup"
  >;

/**
 * 같은 `xeon.exec`에서 cwd만 다른 env. 대화의 작업 폴더(`thread.started.workspace`)마다 하나 만든다(L2.workspace.spec §4.3).
 * `withCwd`가 돌려주는 env에는 `truncateHeadOf`가 없어(순수 계산이라 cwd와 무관하다) 원본 서비스의 것을 이어 붙인다.
 */
export function envAtCwd(
  exec: Pick<ExecService, "withCwd" | "truncateHeadOf">,
  cwd: string,
): WorkspaceEnv {
  const derived = exec.withCwd(cwd);
  return {
    id: derived.id,
    cwd: derived.cwd,
    absolutePath: (...args) => derived.absolutePath(...args),
    canonicalPath: (...args) => derived.canonicalPath(...args),
    exists: (...args) => derived.exists(...args),
    fileInfo: (...args) => derived.fileInfo(...args),
    listDir: (...args) => derived.listDir(...args),
    openBinaryReader: (...args) => derived.openBinaryReader(...args),
    exec: (...args) => derived.exec(...args),
    cleanup: (...args) => derived.cleanup(...args),
    truncateHeadOf: (...args) => exec.truncateHeadOf(...args),
  };
}
