// @fresnel/core-workspace 공개 진입점(L1.workspace). 파일·셸 서비스가 샌드박스와 경로 검사를 거치게 하는 부분을 코어에 둔다.
// 모델 도구(read, write, edit, grep, bash)와 설정, 플러그인 등록은 @fresnel/cap-workspace가 쓴다. 기능 id(`workspace.files`, `workspace.shell`)도 cap-workspace가 낸다.
// 기능 패키지는 이 패키지를 import하지 않고 `workspaceCore`를 의존 객체로 받는다(조립 루트가 넘긴다). 타입과 실패 클래스는 F가 정의한다.

import type { WorkspaceCore } from "@fresnel/contracts/services";
import { guarded } from "./errors.ts";
import { envAtCwd } from "./env.ts";
import { atomicWrite } from "./files/atomic.ts";
import { mutationKey, queueInCallOrder } from "./files/queue.ts";
import { defaultRoots, relativeToRoots, resolveWorkspacePath } from "./roots.ts";
import { scopedDeps } from "./scope.ts";
import { createShellApi } from "./shell/run.ts";
import { getOrThrow } from "./upstream/get-or-throw.ts";
import { characterEnd, utf8ByteLength } from "./upstream/output.ts";
import { askOutsideWrite } from "./write-access.ts";
import { createWriteAccessAdapter } from "./write-access-adapter.ts";

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
export { craftRoots, defaultRoots, relativeToRoots, resolveWorkspacePath } from "./roots.ts";
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

/**
 * 코어 구현 묶음. 조립 루트가 기능 패키지의 `core` 옵션으로 넘긴다. 각 멤버는 같은 이름의 코어 함수다.
 */
export const workspaceCore: WorkspaceCore = {
  createWriteAccessAdapter,
  defaultRoots,
  envAtCwd,
  scopedDeps,
  createShellApi,
  askOutsideWrite,
  atomicWrite,
  mutationKey,
  queueInCallOrder,
  relativeToRoots,
  resolveWorkspacePath,
  getOrThrow,
  characterEnd,
  utf8ByteLength,
  guarded,
};
