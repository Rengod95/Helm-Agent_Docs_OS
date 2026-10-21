import type { ExecutionEnv } from "@xeon/contracts/services";

/**
 * 이 패키지가 `xeon.exec`의 `ExecutionEnv`에서 쓰는 메서드. `ExecService`가 그대로 대입된다.
 * 쓰는 메서드를 좁혀 두면 시험용 대역이 이 목록만 구현하면 된다.
 */
export type WorkspaceEnv = Pick<
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
