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
