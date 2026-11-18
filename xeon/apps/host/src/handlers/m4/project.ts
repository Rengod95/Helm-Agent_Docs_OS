import { assertNever, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  wireError,
  type Project,
  type ProjectCreateParams,
  type ProjectInstructionsResult,
  type ProjectListResult,
  type ProjectRenameParams,
  type ThreadProjectRef,
  type Unsubscribe,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import type { ProjectStoreFailure, ProjectsChange } from "../../assembly/m4/project-store.ts";
import type { RecentThread, ScopeRoot } from "../../assembly/m4/project-scope.ts";
import { wireErrorOfWorkspace, type WorkspaceFailure } from "../../assembly/workspace.ts";

// 프로젝트 wire(review m5 §3.4, §4.4). 처리기는 값 검사와 오류 옮기기만 하고, 저장과 소속 계산은 포트
// (`assembly/m4/project-port.ts`)가 한다. 알림 `project.changed`는 포트의 `onChange`를 연결 허브(`handlers/events.ts`)가 듣고 전체 연결에 보낸다.

/** 프로젝트 규칙 위반. 저장소 실패와 함께 포트의 실패 합집합을 이룬다 */
export type ProjectRuleFailure =
  | { readonly kind: "not_found"; readonly projectId: string }
  /** 같은 정규 루트의 프로젝트가 이미 있다 */
  | { readonly kind: "exists" }
  /** 루트가 없거나 절대 경로가 아니다. 기본 폴더 설정이 절대 경로가 아닌 때도 같다 */
  | { readonly kind: "root_invalid" }
  | { readonly kind: "limit"; readonly max: number }
  /** 기본 폴더 아래 대화 폴더를 만들지 못했다. `code`는 OS 오류 코드다 */
  | { readonly kind: "folder_io"; readonly code: string };

export type ProjectPortFailure =
  | ProjectRuleFailure
  | { readonly kind: "store"; readonly failure: ProjectStoreFailure }
  /** 작업 폴더 문자열이 절대 경로가 아니다. 대화 생성이 쓰는 작업 폴더 오류와 같은 와이어 오류로 옮긴다 */
  | { readonly kind: "workspace"; readonly failure: WorkspaceFailure };

/** 처리기가 쓰는 포트. 구현은 `assembly/m4/project-port.ts`다 */
export interface ProjectPort {
  list(): Promise<Result<ProjectListResult, ProjectPortFailure>>;
  get(projectId: string): Promise<Result<Project, ProjectPortFailure>>;
  create(params: ProjectCreateParams): Promise<Result<Project, ProjectPortFailure>>;
  rename(params: ProjectRenameParams): Promise<Result<Project, ProjectPortFailure>>;
  remove(projectId: string): Promise<Result<void, ProjectPortFailure>>;
  instructions(workspace: string): Promise<Result<ProjectInstructionsResult, ProjectPortFailure>>;
  /** 현재 루트 목록: 명시 프로젝트와 암묵 기본 폴더 루트(`prj_default`). 소속 계산이 쓴다 */
  roots(): Promise<Result<readonly ScopeRoot[], ProjectPortFailure>>;
  /**
   * 작업 폴더가 속한 가장 깊은 루트의 경로(기본 폴더 대화는 기본 폴더). 턴 시작 지침 절의 루트다(§4.4.7).
   * 동기 호출이다. 값은 마지막으로 읽은 루트 목록이고, 호출마다 다시 읽기를 시작한다
   */
  rootOfWorkspace(workspace: string): string | undefined;
  /**
   * 작업 폴더가 속한 가장 깊은 루트의 프로젝트 id(기본 폴더 대화는 `prj_default`). 동기 호출이다. 프로젝트 출처 검토본을 고를 때 쓴다(AGE-41).
   * 값은 마지막으로 읽은 루트 목록이다
   */
  projectIdOfWorkspace(workspace: string): string | undefined;
  /**
   * 대화 폴더가 속한 프로젝트(§4.4.2). 어느 루트에도 없는 폴더면 그 폴더를 루트로 프로젝트를 만든다(§4.4.3).
   * 기본 폴더 대화는 null이다(암묵 프로젝트는 wire에 싣지 않는다)
   */
  attach(workspace: string): Promise<Result<ThreadProjectRef | null, ProjectPortFailure>>;
  /** 기본 폴더 아래 `<threadId>` 폴더를 만들고 정규 경로를 돌려준다(§4.4.5). 대화 생성 때만 부른다 */
  defaultWorkspace(threadId: ThreadId): Promise<Result<string, ProjectPortFailure>>;
  /** 프로필 기본값의 원천 대화(§4.4.8). 같은 폴더가 없으면 같은 프로젝트의 가장 최근 대화다. 없으면 undefined */
  recentThread(
    workspace: string | undefined,
  ): Promise<Result<RecentThread | undefined, ProjectPortFailure>>;
  /** 이 호스트가 `projects.json`을 바꿀 때마다 부른다(연결 허브가 `project.changed`로 전한다) */
  onChange(listener: (change: ProjectsChange) => void): Unsubscribe;
}

export type ProjectMethods =
  | "project.list"
  | "project.get"
  | "project.create"
  | "project.rename"
  | "project.delete"
  | "project.instructions";

// ── 오류 ────────────────────────────────────────────────────────────────

/** 프로젝트 실패를 와이어 오류로 옮긴다. 폴더 경로는 싣지 않는다(HS-56) */
export function wireErrorOfProject(failure: ProjectPortFailure): WireError {
  switch (failure.kind) {
    case "workspace":
      return wireErrorOfWorkspace(failure.failure);
    case "not_found":
      return wireError("project.notFound", { details: { id: failure.projectId } });
    case "exists":
      return wireError("project.exists");
    case "root_invalid":
      return wireError("project.rootInvalid");
    case "limit":
      return wireError("jsonrpc.invalidParams", {
        details: {
          issues: [{ path: "projects", message: `project limit ${failure.max} reached` }],
        },
      });
    case "folder_io":
      return wireError("store.io", {
        message: "the default folder cannot be created",
        details: { code: failure.code.slice(0, 64) },
      });
    case "store":
      return failure.failure.kind === "io"
        ? wireError("store.io", {
            message: "projects.json cannot be read or written",
            details: { code: failure.failure.code.slice(0, 64) },
          })
        : wireError("store.io", { message: "projects.json cannot be read" });
    default:
      return assertNever(failure, "ProjectPortFailure");
  }
}

function okOrThrow<T>(result: Result<T, ProjectPortFailure>): T {
  if (!result.ok) throw wireErrorOfProject(result.error);
  return result.value;
}

// ── 처리기 ──────────────────────────────────────────────────────────────

export function createProjectHandlers(port: ProjectPort): Pick<WireHandlers, ProjectMethods> {
  return {
    "project.list": async () => okOrThrow(await port.list()),
    "project.get": async (params) => ({
      project: okOrThrow(await port.get(params.projectId)),
      // 검토 대기 수는 검토함 트랙(enC3)이 채운다. 그 전에는 0이다
      pendingReview: 0,
    }),
    "project.create": async (params) => ({ project: okOrThrow(await port.create(params)) }),
    "project.rename": async (params) => ({
      project: okOrThrow(await port.rename(params)),
    }),
    "project.delete": async (params) => {
      okOrThrow(await port.remove(params.projectId));
      return {};
    },
    "project.instructions": async (params) => okOrThrow(await port.instructions(params.workspace)),
  };
}
