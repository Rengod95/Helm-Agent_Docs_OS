import { Type, type TUnsafe } from "typebox";
import type { SchemaProof, SchemaSound } from "../../base/index.ts";
import { EmptyParamsSchema, type EmptyParams } from "./notifications.ts";
import {
  closed,
  m4,
  NoParamsSchema,
  request,
  type Io,
  type M4Spec,
  type NoParams,
  type Req,
} from "./schema-kit.ts";

// M5c-1 프로젝트 wire(review.m5-profile-project-loader §3.1·§3.2·§3.4·§3.6). 프로젝트는 `projects.json`의 레코드다.
// 레지스트리 등록(methods.ts의 WireSchemas·WIRE_METHODS·알림 표)은 통합 담당이 한다. 이 파일은 등록하지 않는다.

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const Count = Type.Integer({ minimum: 0 });
const Path = Type.String({ minLength: 1, maxLength: 4096 });

/** 프로젝트 id. 새 프로젝트는 `prj_` 접두를 쓴다. 기본 폴더 대화의 암묵 프로젝트는 `prj_default`다(`projects.json`에 없다) */
export const PROJECT_ID_PATTERN: string = "^prj_[A-Za-z0-9_-]{1,64}$";
/** 프로젝트 목록 상한 [제안] */
export const PROJECT_LIMITS = { projects: 200, instructionEntries: 256 } as const;

/** 프로젝트 하나. `root`는 존재하는 절대 폴더를 심볼릭 링크를 푼 정규 경로로 저장한다 */
export interface Project {
  readonly projectId: string;
  readonly name: string;
  readonly root: string;
  readonly createdAt: string;
  readonly rev: number;
}
const ProjectShape = closed({
  projectId: Type.String({ pattern: PROJECT_ID_PATTERN }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
  root: Path,
  createdAt: Iso,
  rev: Count,
});
export const ProjectSchema: TUnsafe<Project> = Type.Unsafe<Project>(
  ProjectShape satisfies SchemaProof<Project, typeof ProjectShape>,
);

/** `project.list`의 한 항목. 대화 수와 실행 중 수를 더한다(M5c §3.6) */
export interface ProjectListItem extends Project {
  readonly threadCount: number;
  readonly runningCount: number;
}
const ProjectListItemShape = closed({
  ...ProjectShape.properties,
  threadCount: Count,
  runningCount: Count,
});
export const ProjectListItemSchema: TUnsafe<ProjectListItem> = Type.Unsafe<ProjectListItem>(
  ProjectListItemShape satisfies SchemaProof<ProjectListItem, typeof ProjectListItemShape>,
);

export interface ProjectListResult {
  readonly projects: readonly ProjectListItem[];
}
const ProjectListResultShape = closed({
  projects: Type.Array(ProjectListItemShape, { maxItems: PROJECT_LIMITS.projects }),
});
export const ProjectListResultSchema: TUnsafe<ProjectListResult> = Type.Unsafe<ProjectListResult>(
  ProjectListResultShape satisfies SchemaProof<ProjectListResult, typeof ProjectListResultShape>,
);

export interface ProjectGetParams {
  readonly projectId: string;
}
const ProjectGetParamsShape = request({ projectId: Id });
export const ProjectGetParamsSchema: TUnsafe<Req<ProjectGetParams>> = Type.Unsafe<
  Req<ProjectGetParams>
>(ProjectGetParamsShape satisfies SchemaProof<Req<ProjectGetParams>, typeof ProjectGetParamsShape>);

export interface ProjectGetResult {
  readonly project: Project;
  /** 이 프로젝트 안에서 검토 대기 중인 항목 수 */
  readonly pendingReview: number;
}
const ProjectGetResultShape = closed({ project: ProjectShape, pendingReview: Count });
export const ProjectGetResultSchema: TUnsafe<ProjectGetResult> = Type.Unsafe<ProjectGetResult>(
  ProjectGetResultShape satisfies SchemaProof<ProjectGetResult, typeof ProjectGetResultShape>,
);

export interface ProjectCreateParams {
  /** 존재하는 절대 폴더. 아니면 `project.rootInvalid`, 같은 정규 경로가 있으면 `project.exists` */
  readonly root: string;
  readonly name?: string;
}
const ProjectCreateParamsShape = request({
  root: Path,
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export const ProjectCreateParamsSchema: TUnsafe<Req<ProjectCreateParams>> = Type.Unsafe<
  Req<ProjectCreateParams>
>(
  ProjectCreateParamsShape satisfies SchemaProof<
    Req<ProjectCreateParams>,
    typeof ProjectCreateParamsShape
  >,
);

export interface ProjectRenameParams {
  readonly projectId: string;
  readonly name: string;
}
const ProjectRenameParamsShape = request({
  projectId: Id,
  name: Type.String({ minLength: 1, maxLength: 128 }),
});
export const ProjectRenameParamsSchema: TUnsafe<Req<ProjectRenameParams>> = Type.Unsafe<
  Req<ProjectRenameParams>
>(
  ProjectRenameParamsShape satisfies SchemaProof<
    Req<ProjectRenameParams>,
    typeof ProjectRenameParamsShape
  >,
);

export interface ProjectRefResult {
  readonly project: Project;
}
const ProjectRefResultShape = closed({ project: ProjectShape });
export const ProjectRefResultSchema: TUnsafe<ProjectRefResult> = Type.Unsafe<ProjectRefResult>(
  ProjectRefResultShape satisfies SchemaProof<ProjectRefResult, typeof ProjectRefResultShape>,
);

export interface ProjectDeleteParams {
  readonly projectId: string;
}
const ProjectDeleteParamsShape = request({ projectId: Id });
export const ProjectDeleteParamsSchema: TUnsafe<Req<ProjectDeleteParams>> = Type.Unsafe<
  Req<ProjectDeleteParams>
>(
  ProjectDeleteParamsShape satisfies SchemaProof<
    Req<ProjectDeleteParams>,
    typeof ProjectDeleteParamsShape
  >,
);

/** `project.delete`의 결과는 빈 객체다(repo의 빈 결과 `EmptyParamsSchema`를 쓴다). 대화는 지우지 않는다 */
export type ProjectDeleteResult = EmptyParams;
export const ProjectDeleteResultSchema: TUnsafe<ProjectDeleteResult> =
  Type.Unsafe<ProjectDeleteResult>(
    EmptyParamsSchema satisfies SchemaSound<ProjectDeleteResult, typeof EmptyParamsSchema>,
  );

export interface ProjectInstructionsParams {
  readonly workspace: string;
}
const ProjectInstructionsParamsShape = request({ workspace: Path });
export const ProjectInstructionsParamsSchema: TUnsafe<Req<ProjectInstructionsParams>> = Type.Unsafe<
  Req<ProjectInstructionsParams>
>(
  ProjectInstructionsParamsShape satisfies SchemaProof<
    Req<ProjectInstructionsParams>,
    typeof ProjectInstructionsParamsShape
  >,
);

/** 대화 폴더에서 루트까지 모은 지침 파일(`AGENTS.md`)과 그 포함 여부 */
export interface ProjectInstructionsResult {
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly included: boolean;
  }[];
}
const ProjectInstructionsResultShape = closed({
  files: Type.Array(closed({ path: Path, bytes: Count, included: Type.Boolean() }), {
    maxItems: PROJECT_LIMITS.instructionEntries,
  }),
});
export const ProjectInstructionsResultSchema: TUnsafe<ProjectInstructionsResult> =
  Type.Unsafe<ProjectInstructionsResult>(
    ProjectInstructionsResultShape satisfies SchemaProof<
      ProjectInstructionsResult,
      typeof ProjectInstructionsResultShape
    >,
  );

/** 알림 `project.changed`. 프로젝트 목록이 바뀌었다. `project.list`를 다시 읽는다 */
export interface ProjectChangedParams {
  readonly rev: number;
  readonly ids: readonly string[];
}
const ProjectChangedParamsShape = closed({ rev: Count, ids: Type.Array(Id, { maxItems: 200 }) });
export const ProjectChangedParamsSchema: TUnsafe<ProjectChangedParams> =
  Type.Unsafe<ProjectChangedParams>(
    ProjectChangedParamsShape satisfies SchemaProof<
      ProjectChangedParams,
      typeof ProjectChangedParamsShape
    >,
  );

// ── 레지스트리 항목 ───────────────────────────────────────────────────────

type U<T> = TUnsafe<T>;
/** 프로젝트 wire 메서드의 params·result 쌍. `WireSchemas`에 더하는 모양이다(통합 담당이 methods.ts에 등록한다) */
export interface ProjectWireSchemas {
  "project.list": Io<U<NoParams>, U<ProjectListResult>>;
  "project.get": Io<U<Req<ProjectGetParams>>, U<ProjectGetResult>>;
  "project.create": Io<U<Req<ProjectCreateParams>>, U<ProjectRefResult>>;
  "project.rename": Io<U<Req<ProjectRenameParams>>, U<ProjectRefResult>>;
  "project.delete": Io<U<Req<ProjectDeleteParams>>, U<ProjectDeleteResult>>;
  "project.instructions": Io<U<Req<ProjectInstructionsParams>>, U<ProjectInstructionsResult>>;
}
type ProjectWireTable = {
  readonly [M in keyof ProjectWireSchemas]: M4Spec<
    ProjectWireSchemas[M]["params"],
    ProjectWireSchemas[M]["result"]
  >;
};
export const PROJECT_WIRE_METHODS: ProjectWireTable = {
  "project.list": m4(NoParamsSchema, ProjectListResultSchema),
  "project.get": m4(ProjectGetParamsSchema, ProjectGetResultSchema),
  "project.create": m4(ProjectCreateParamsSchema, ProjectRefResultSchema),
  "project.rename": m4(ProjectRenameParamsSchema, ProjectRefResultSchema),
  "project.delete": m4(ProjectDeleteParamsSchema, ProjectDeleteResultSchema),
  "project.instructions": m4(ProjectInstructionsParamsSchema, ProjectInstructionsResultSchema),
};
