import type { WorkspaceDeps as CoreWorkspaceDeps } from "@fresnel/core-workspace";
import type { WorkspaceSettings } from "./settings.ts";

// 도구가 쓰는 의존. 서비스 의존(`@fresnel/core-workspace`의 WorkspaceDeps)에 l2.workspace 설정 전체 모양을 입힌다.
// 읽기·쓰기·검색·이미지 도구는 설정의 read, grep, images 키를 읽고, 셸 실행은 shell 키만 읽는다.
export type WorkspaceDeps = CoreWorkspaceDeps<WorkspaceSettings>;
