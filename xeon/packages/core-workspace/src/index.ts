// @fresnel/core-workspace 공개 진입점(L1.workspace). 파일·셸 서비스가 샌드박스와 경로 검사를 거치게 하는 부분을 코어에 둔다.
// 모델 도구(read, write, edit, grep, bash)와 설정, 플러그인 등록은 @fresnel/cap-workspace가 쓴다. 기능 id(`workspace.files`, `workspace.shell`)도 cap-workspace가 낸다.

export { WorkspaceFailure, guarded } from "./errors.ts";
export type { RgResolver, WorkspaceDeps, WorkspaceShellSettings } from "./deps.ts";
export { envAtCwd } from "./env.ts";
export type { WorkspaceEnv } from "./env.ts";
export type { BlobSink } from "./ports/blobs.ts";
export type { ThreadWorkspaces } from "./ports/threads.ts";
export type {
  WriteAccessError,
  WriteAccessPort,
  WriteAccessRequest,
  WriteAccessVia,
} from "./ports/write-access.ts";
export { defaultRoots, relativeToRoots, resolveWorkspacePath } from "./roots.ts";
export type { AllowedRoots, PathAccess, ResolvedPath, RootsDeps } from "./roots.ts";
export { scopedDeps } from "./scope.ts";
export { askOutsideWrite } from "./write-access.ts";
export { createWriteAccessAdapter, writeAccessTitle } from "./write-access-adapter.ts";
export { atomicWrite } from "./files/atomic.ts";
export type { AtomicEnv, AtomicWriteOptions } from "./files/atomic.ts";
export { mutationKey, queueInCallOrder } from "./files/queue.ts";
export { createShellApi } from "./shell/run.ts";
export { getOrThrow } from "./upstream/get-or-throw.ts";
export { characterEnd, utf8ByteLength } from "./upstream/output.ts";
