import { Type, type TUnsafe } from "typebox";
import { Nullable, type SchemaProof, type SchemaSound } from "../../base/index.ts";
import { ThreadIdSchema, type ThreadId } from "../../conversation/index.ts";
import { ExtensionNameSchema } from "../../extensions/index.ts";
import { SettingKeySchema } from "../settings/index.ts";
import { StreamPositionSchema, type StreamPosition } from "./cursor.ts";
import { PROJECT_ID_PATTERN } from "./project.ts";
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

// M5c-1 프로필 wire(F.wire-settings.spec §3.3, review.m5-profile-project-loader §3.1·§3.4·§3.6).
// 이 파일은 프로필 저장 모양과 `profile.*`·`thread.setProfile` 메서드의 params·result 스키마를 가진다.
// 레지스트리 등록(methods.ts의 WireSchemas·WIRE_METHODS)은 통합 담당이 한다. 이 파일은 등록하지 않는다.

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Name = Type.String({ minLength: 1, maxLength: 96 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const Count = Type.Integer({ minimum: 0 });
const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
const Title = Type.String({ minLength: 1, maxLength: 128 });
const ShortName = Type.String({ minLength: 1, maxLength: 32 });
const ToolName = Type.String({ minLength: 1, maxLength: 128 });

/** 프로필 id. 소문자 영숫자와 `-`. 내장 기본 프로필은 `default` */
export const PROFILE_ID_PATTERN: string = "^[a-z][a-z0-9-]{0,47}$";
/** 저장 상한. 플러그인 목록, 설정 값, 프로필 개수 */
export const PROFILE_LIMITS = { plugins: 128, settings: 128, profiles: 200 } as const;
/** 한 턴에 얹을 수 있는 덧씌우기 상한(`turn.start.overlay`). 넘으면 호스트가 `overlay.limit`으로 거절한다 */
export const OVERLAY_LIMIT: number = 4;
/** `turn.start.overlay`의 와이어 상한. 상한 초과를 스키마가 아니라 `overlay.limit`으로 답하도록 `OVERLAY_LIMIT`보다 넉넉히 둔다 */
export const OVERLAY_WIRE_MAX: number = 16;

// ── 저장 모양 ─────────────────────────────────────────────────────────────

/** 프로필이 참조하는 플러그인 하나. 버전 핀은 없다(항상 그 이름의 현재 검토본) */
export interface PluginRef {
  readonly name: string;
}
const PluginRefShape = closed({ name: ExtensionNameSchema });
export const PluginRefSchema: TUnsafe<PluginRef> = Type.Unsafe<PluginRef>(
  PluginRefShape satisfies SchemaProof<PluginRef, typeof PluginRefShape>,
);

/** 프로필이 정한 설정 값 하나. 키는 코어 키(`<층>.<도메인>.<이름>`)거나 `ext.<name>.<key>`다 */
export interface ProfileSetting {
  readonly key: string;
  readonly value: unknown;
}
const ProfileSettingShape = closed({ key: SettingKeySchema, value: Type.Unknown() });
export const ProfileSettingSchema: TUnsafe<ProfileSetting> = Type.Unsafe<ProfileSetting>(
  ProfileSettingShape satisfies SchemaProof<ProfileSetting, typeof ProfileSettingShape>,
);

/** 프로필 하나. `builtin`이 참이면 삭제할 수 없다. `hidden`이 참이면 `profile.list`에 나오지 않는다(숨은 시스템 프로필만 쓴다) */
export interface Profile {
  readonly id: string;
  readonly title: string;
  readonly builtin: boolean;
  /** 순서가 있다. 같은 자리에 여럿이 걸리면 이 순서가 호출 순서다 */
  readonly plugins: readonly PluginRef[];
  readonly settings: readonly ProfileSetting[];
  /** 시작 Drive 플러그인 이름. 값은 `plugins` 안에 있어야 한다. 없으면 null */
  readonly startDrive: string | null;
  readonly hidden?: boolean;
  /** 저장이 정한 값 */
  readonly updatedAt: string;
  /** 저장이 정한 값. `profile.put`의 `baseRev` 비교에 쓴다 */
  readonly rev: number;
}
const ProfileShape = closed({
  id: Type.String({ pattern: PROFILE_ID_PATTERN }),
  title: Title,
  builtin: Type.Boolean(),
  plugins: Type.Array(PluginRefShape, { maxItems: PROFILE_LIMITS.plugins }),
  settings: Type.Array(ProfileSettingShape, { maxItems: PROFILE_LIMITS.settings }),
  startDrive: Nullable(ExtensionNameSchema),
  hidden: Type.Optional(Type.Boolean()),
  updatedAt: Iso,
  rev: Count,
});
export const ProfileSchema: TUnsafe<Profile> = Type.Unsafe<Profile>(
  ProfileShape satisfies SchemaProof<Profile, typeof ProfileShape>,
);

/** 모든 대화에 얹히는 공통 묶음. 시작 Drive는 두지 않는다 */
export interface CommonSet {
  readonly plugins: readonly PluginRef[];
  readonly settings: readonly ProfileSetting[];
  readonly updatedAt: string;
  readonly rev: number;
}
const CommonSetShape = closed({
  plugins: Type.Array(PluginRefShape, { maxItems: PROFILE_LIMITS.plugins }),
  settings: Type.Array(ProfileSettingShape, { maxItems: PROFILE_LIMITS.settings }),
  updatedAt: Iso,
  rev: Count,
});
export const CommonSetSchema: TUnsafe<CommonSet> = Type.Unsafe<CommonSet>(
  CommonSetShape satisfies SchemaProof<CommonSet, typeof CommonSetShape>,
);

/** `common`을 쓰는 입력. 저장이 정하는 `updatedAt`, `rev`는 없다 */
export interface CommonInput {
  readonly plugins: readonly PluginRef[];
  readonly settings: readonly ProfileSetting[];
}
const CommonInputShape = closed({
  plugins: CommonSetShape.properties.plugins,
  settings: CommonSetShape.properties.settings,
});
export const CommonInputSchema: TUnsafe<CommonInput> = Type.Unsafe<CommonInput>(
  CommonInputShape satisfies SchemaProof<CommonInput, typeof CommonInputShape>,
);

/** `profiles.json`의 모양(schemaVersion 2). 내장 `default` 행은 처음 고칠 때 만든다 */
export interface ProfilesFile {
  readonly schemaVersion: 2;
  readonly common: CommonSet;
  readonly profiles: readonly Profile[];
}
const ProfilesFileShape = closed({
  schemaVersion: Type.Literal(2),
  common: CommonSetShape,
  profiles: Type.Array(ProfileShape, { maxItems: PROFILE_LIMITS.profiles }),
});
export const ProfilesFileSchema: TUnsafe<ProfilesFile> = Type.Unsafe<ProfilesFile>(
  ProfilesFileShape satisfies SchemaProof<ProfilesFile, typeof ProfilesFileShape>,
);

/** `profile.put`이 받는 프로필. 저장이 정하는 `builtin`, `updatedAt`, `rev`는 없다 */
export interface ProfileInput {
  readonly id: string;
  readonly title: string;
  readonly plugins: readonly PluginRef[];
  readonly settings: readonly ProfileSetting[];
  readonly startDrive: string | null;
}
const ProfileInputShape = closed({
  id: ProfileShape.properties.id,
  title: ProfileShape.properties.title,
  plugins: ProfileShape.properties.plugins,
  settings: ProfileShape.properties.settings,
  startDrive: ProfileShape.properties.startDrive,
});
export const ProfileInputSchema: TUnsafe<ProfileInput> = Type.Unsafe<ProfileInput>(
  ProfileInputShape satisfies SchemaProof<ProfileInput, typeof ProfileInputShape>,
);

// ── 검증 결과 ─────────────────────────────────────────────────────────────

/** 검증 문제의 종류(F의 `validateProfile`이 낸다). 오류와 경고가 섞여 나온다 */
export const PROFILE_ISSUE_CODES = [
  "plugin_unknown",
  "plugin_not_reviewed",
  "replace_conflict",
  "driver_not_in_list",
  "driver_cannot_drive",
  "driver_unavailable",
  "setting_unknown_key",
  "setting_scope_not_allowed",
  "setting_invalid_value",
  "secret_literal",
  "secret_missing",
  "required_unset",
  "requirement_unmet",
  "managed_forbidden",
  "limit",
] as const;
export type ProfileIssueCode = (typeof PROFILE_ISSUE_CODES)[number];
const ProfileIssueCodeShape = Type.Union(PROFILE_ISSUE_CODES.map((code) => Type.Literal(code)));
export const ProfileIssueCodeSchema: TUnsafe<ProfileIssueCode> = Type.Unsafe<ProfileIssueCode>(
  ProfileIssueCodeShape satisfies SchemaSound<ProfileIssueCode, typeof ProfileIssueCodeShape>,
);

export interface ProfileIssue {
  readonly code: ProfileIssueCode;
  /** `error`는 저장을 막는다. `warning`은 저장하고 알린다 */
  readonly severity: "error" | "warning";
  readonly plugin?: string;
  readonly key?: string;
  /** `replace_conflict`일 때 상대 플러그인 */
  readonly other?: string;
  readonly tool?: string;
}
const ProfileIssueShape = closed({
  code: ProfileIssueCodeSchema,
  severity: Type.Union([Type.Literal("error"), Type.Literal("warning")]),
  plugin: Type.Optional(ExtensionNameSchema),
  key: Type.Optional(SettingKeySchema),
  other: Type.Optional(ExtensionNameSchema),
  tool: Type.Optional(ToolName),
});
export const ProfileIssueSchema: TUnsafe<ProfileIssue> = Type.Unsafe<ProfileIssue>(
  ProfileIssueShape satisfies SchemaProof<ProfileIssue, typeof ProfileIssueShape>,
);

/** 비용 숫자 묶음(카드 `cost`와 같은 모양). 정적 추정은 `declared`나 `unknown`만 낸다(측정은 E의 `profileCost.get`) */
export interface ProfileCostFigures {
  readonly always: number | null;
  readonly drive: number | null;
  readonly onDemand: number | null;
  readonly toolCount: number | null;
  readonly basis: "declared" | "unknown";
}
const ProfileCostFiguresShape = closed({
  always: Nullable(Count),
  drive: Nullable(Count),
  onDemand: Nullable(Count),
  toolCount: Nullable(Count),
  basis: Type.Union([Type.Literal("declared"), Type.Literal("unknown")]),
});
export const ProfileCostFiguresSchema: TUnsafe<ProfileCostFigures> =
  Type.Unsafe<ProfileCostFigures>(
    ProfileCostFiguresShape satisfies SchemaProof<
      ProfileCostFigures,
      typeof ProfileCostFiguresShape
    >,
  );

export interface ProfilePluginCost {
  readonly plugin: string;
  readonly cost: ProfileCostFigures;
}
const ProfilePluginCostShape = closed({
  plugin: ExtensionNameSchema,
  cost: ProfileCostFiguresSchema,
});

/** 권한 모드가 바뀌는 경우의 `from`, `to`. 넓어져도 확인을 받지 않는다(M5c §4.1.8) */
export interface PermissionChange {
  readonly from: string;
  readonly to: string;
}
const PermissionChangeShape = closed({ from: ShortName, to: ShortName });

/** 도구 목록이 바뀌는 경우 */
export interface ToolsChanged {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}
const ToolsChangedShape = closed({
  added: Type.Array(ToolName, { maxItems: 512 }),
  removed: Type.Array(ToolName, { maxItems: 512 }),
});

/** 이 변경이 Drive 중인 플러그인을 빼서 프레임을 내리는 열린 대화 수. 없으면 `null` */
export interface DropsDrive {
  readonly threadCount: number;
}
const DropsDriveShape = closed({ threadCount: Count });

/** 프롬프트 캐시에 주는 영향(`profile.preview`, `thread.setProfile`, `turn.start` 결과) */
export const CACHE_IMPACTS = ["none", "tool_change_append", "readvertise"] as const;
export type CacheImpact = (typeof CACHE_IMPACTS)[number];
const CacheImpactShape = Type.Union(CACHE_IMPACTS.map((impact) => Type.Literal(impact)));
export const CacheImpactSchema: TUnsafe<CacheImpact> = Type.Unsafe<CacheImpact>(
  CacheImpactShape satisfies SchemaSound<CacheImpact, typeof CacheImpactShape>,
);

// ── 대화 쪽 표지와 덧씌우기 ───────────────────────────────────────────────

/** 대화가 속한 프로젝트 요약. 없으면 `null`(기본 폴더 대화) */
export interface ThreadProjectRef {
  readonly projectId: string;
  readonly name: string;
}
const ThreadProjectRefShape = closed({
  projectId: Type.String({ pattern: PROJECT_ID_PATTERN }),
  name: Type.String({ minLength: 1, maxLength: 128 }),
});
/** `ThreadSummary.project`와 `thread.create` 결과의 `project`(없으면 null) */
export const ThreadProjectRefSchema: TUnsafe<ThreadProjectRef> = Type.Unsafe<ThreadProjectRef>(
  ThreadProjectRefShape satisfies SchemaProof<ThreadProjectRef, typeof ThreadProjectRefShape>,
);

/** 대화에 얹힌 덧씌우기 하나의 표지(`ThreadProfileView.overlay`) */
export interface ThreadOverlayMark {
  readonly plugin: string;
  readonly draft: boolean;
  readonly until: "turn" | "release";
}
const ThreadOverlayMarkShape = closed({
  plugin: ExtensionNameSchema,
  draft: Type.Boolean(),
  until: Type.Union([Type.Literal("turn"), Type.Literal("release")]),
});
/** `ThreadSummary.overlay`의 항목 */
export const ThreadOverlayMarkSchema: TUnsafe<ThreadOverlayMark> = Type.Unsafe<ThreadOverlayMark>(
  ThreadOverlayMarkShape satisfies SchemaProof<ThreadOverlayMark, typeof ThreadOverlayMarkShape>,
);

/** 대화의 프로필 표지. `ThreadSummary`에 `profileId`, `project`, `overlay`로 나뉘어 더해진다 */
export interface ThreadProfileView {
  readonly profileId: string;
  readonly profileRev: number;
  readonly project: ThreadProjectRef | null;
  readonly overlay: readonly ThreadOverlayMark[];
}
const ThreadProfileViewShape = closed({
  profileId: Id,
  profileRev: Count,
  project: Nullable(ThreadProjectRefShape),
  overlay: Type.Array(ThreadOverlayMarkShape, { maxItems: OVERLAY_LIMIT }),
});
export const ThreadProfileViewSchema: TUnsafe<ThreadProfileView> = Type.Unsafe<ThreadProfileView>(
  ThreadProfileViewShape satisfies SchemaProof<ThreadProfileView, typeof ThreadProfileViewShape>,
);

/** 턴 하나에 얹는 덧씌우기 항목. `entry`를 생략하면 플러그인 전체를 이름으로 얹는다(`plugin.invocables`의 `kind: "plugin"`) */
export interface OverlayRef {
  readonly plugin: string;
  readonly draftId?: string;
  readonly entry?: string;
}
const OverlayRefShape = closed({
  plugin: ExtensionNameSchema,
  draftId: Type.Optional(Id),
  entry: Type.Optional(Name),
});
export const OverlayRefSchema: TUnsafe<OverlayRef> = Type.Unsafe<OverlayRef>(
  OverlayRefShape satisfies SchemaProof<OverlayRef, typeof OverlayRefShape>,
);
/** `turn.start`의 `overlay` 필드 모양. 와이어 상한은 `OVERLAY_WIRE_MAX`, 턴당 한도 `OVERLAY_LIMIT`은 처리기가 본다 */
const OverlayListShape = Type.Array(OverlayRefShape, { maxItems: OVERLAY_WIRE_MAX });
export const OverlayListSchema: TUnsafe<OverlayRef[]> = Type.Unsafe<OverlayRef[]>(
  OverlayListShape satisfies SchemaSound<OverlayRef[], typeof OverlayListShape>,
);

// ── 메서드 params·result ───────────────────────────────────────────────────

export interface ProfileIdParams {
  readonly id: string;
}
const ProfileIdParamsShape = request({ id: Id });
export const ProfileIdParamsSchema: TUnsafe<Req<ProfileIdParams>> = Type.Unsafe<
  Req<ProfileIdParams>
>(ProfileIdParamsShape satisfies SchemaProof<Req<ProfileIdParams>, typeof ProfileIdParamsShape>);

export interface ProfileListResult {
  /** 숨은 프로필(`hidden`)은 넣지 않는다 */
  readonly profiles: readonly Profile[];
  readonly common: CommonSet;
  /** 목록 전체의 개정. 바뀔 때마다 오른다 */
  readonly rev: number;
}
const ProfileListResultShape = closed({
  profiles: Type.Array(ProfileShape, { maxItems: PROFILE_LIMITS.profiles }),
  common: CommonSetShape,
  rev: Count,
});
export const ProfileListResultSchema: TUnsafe<ProfileListResult> = Type.Unsafe<ProfileListResult>(
  ProfileListResultShape satisfies SchemaProof<ProfileListResult, typeof ProfileListResultShape>,
);

/** 이 프로필(과 공통 묶음)이 가리키지만 지금 이 기기에 없는 플러그인 이름. 없으면 필드를 싣지 않는다 [결정: 2026-11-20, 사용자, AGE-34] */
const MissingPluginsShape = Type.Array(ExtensionNameSchema, { maxItems: 256 });

export interface ProfileGetResult {
  readonly profile: Profile;
  /** 프로필이 가리키지만 이 기기에 없는 플러그인. 실행 때 건너뛴다. 없으면 생략한다 */
  readonly missingPlugins?: readonly string[];
}
const ProfileGetResultShape = closed({
  profile: ProfileShape,
  missingPlugins: Type.Optional(MissingPluginsShape),
});
export const ProfileGetResultSchema: TUnsafe<ProfileGetResult> = Type.Unsafe<ProfileGetResult>(
  ProfileGetResultShape satisfies SchemaProof<ProfileGetResult, typeof ProfileGetResultShape>,
);

export interface ProfilePutParams {
  readonly profile: ProfileInput;
  /** 처음 만들면 null. 저장된 `rev`와 다르면 `profile.conflict` */
  readonly baseRev: number | null;
}
const ProfilePutParamsShape = request({
  profile: ProfileInputShape,
  baseRev: Nullable(Count),
});
export const ProfilePutParamsSchema: TUnsafe<Req<ProfilePutParams>> = Type.Unsafe<
  Req<ProfilePutParams>
>(ProfilePutParamsShape satisfies SchemaProof<Req<ProfilePutParams>, typeof ProfilePutParamsShape>);

export interface ProfilePutResult {
  readonly profile: Profile;
  /** 경고만 싣는다. 오류가 있으면 저장하지 않고 `profile.invalid`를 낸다 */
  readonly issues: readonly ProfileIssue[];
  /** 저장 전에도 이 프로필이 가리키던, 지금은 이 기기에 없는 플러그인(경고 `plugin_unknown`과 같은 이름). 없으면 생략한다 */
  readonly missingPlugins?: readonly string[];
}
const ProfilePutResultShape = closed({
  profile: ProfileShape,
  issues: Type.Array(ProfileIssueShape, { maxItems: 512 }),
  missingPlugins: Type.Optional(MissingPluginsShape),
});
export const ProfilePutResultSchema: TUnsafe<ProfilePutResult> = Type.Unsafe<ProfilePutResult>(
  ProfilePutResultShape satisfies SchemaProof<ProfilePutResult, typeof ProfilePutResultShape>,
);

export interface ProfileDeleteResult {
  readonly rev: number;
  /** 이 프로필을 참조하던 열린 대화 수(다음 읽기에서 `default`로 읽는다) */
  readonly reassignedThreads: number;
}
const ProfileDeleteResultShape = closed({ rev: Count, reassignedThreads: Count });
export const ProfileDeleteResultSchema: TUnsafe<ProfileDeleteResult> =
  Type.Unsafe<ProfileDeleteResult>(
    ProfileDeleteResultShape satisfies SchemaProof<
      ProfileDeleteResult,
      typeof ProfileDeleteResultShape
    >,
  );

export interface ProfileCloneParams {
  readonly id: string;
  readonly newId: string;
  readonly title: string;
}
const ProfileCloneParamsShape = request({
  id: Id,
  newId: Type.String({ pattern: PROFILE_ID_PATTERN }),
  title: Title,
});
export const ProfileCloneParamsSchema: TUnsafe<Req<ProfileCloneParams>> = Type.Unsafe<
  Req<ProfileCloneParams>
>(
  ProfileCloneParamsShape satisfies SchemaProof<
    Req<ProfileCloneParams>,
    typeof ProfileCloneParamsShape
  >,
);

export interface CommonGetResult {
  readonly common: CommonSet;
  readonly issues: readonly ProfileIssue[];
}
const CommonGetResultShape = closed({
  common: CommonSetShape,
  issues: Type.Array(ProfileIssueShape, { maxItems: 512 }),
});
export const CommonGetResultSchema: TUnsafe<CommonGetResult> = Type.Unsafe<CommonGetResult>(
  CommonGetResultShape satisfies SchemaProof<CommonGetResult, typeof CommonGetResultShape>,
);

export interface CommonPutParams {
  readonly common: CommonInput;
  /** 공통 묶음의 `rev`. 아직 쓴 적이 없으면 0이다 */
  readonly baseRev: number;
}
const CommonPutParamsShape = request({ common: CommonInputShape, baseRev: Count });
export const CommonPutParamsSchema: TUnsafe<Req<CommonPutParams>> = Type.Unsafe<
  Req<CommonPutParams>
>(CommonPutParamsShape satisfies SchemaProof<Req<CommonPutParams>, typeof CommonPutParamsShape>);

/**
 * `profile.preview`. 저장된 프로필(`id`)이나 아직 저장하지 않은 입력(`draft`) 가운데 하나를 받는다.
 * `threadId`가 있으면 그 대화 기준으로 바뀜을 계산한다.
 */
export type ProfilePreviewParams =
  | { readonly id: string; readonly threadId?: string }
  | { readonly draft: ProfileInput; readonly threadId?: string };
const ProfilePreviewParamsShape = Type.Union([
  request({ id: Id, threadId: Type.Optional(ThreadRef) }),
  request({ draft: ProfileInputShape, threadId: Type.Optional(ThreadRef) }),
]);
export const ProfilePreviewParamsSchema: TUnsafe<Req<ProfilePreviewParams>> = Type.Unsafe<
  Req<ProfilePreviewParams>
>(
  ProfilePreviewParamsShape satisfies SchemaSound<
    Req<ProfilePreviewParams>,
    typeof ProfilePreviewParamsShape
  >,
);

export interface ProfilePreviewResult {
  /** 해소된 플러그인 목록(공통 묶음이 먼저, 그다음 프로필) */
  readonly resolved: readonly PluginRef[];
  readonly issues: readonly ProfileIssue[];
  readonly cost: {
    readonly total: ProfileCostFigures;
    readonly byPlugin: readonly ProfilePluginCost[];
  };
  readonly missingRequired: readonly { readonly plugin: string; readonly key: string }[];
  readonly threadsUsing: number;
  readonly permission?: PermissionChange;
  readonly toolsChanged?: ToolsChanged;
  readonly cacheImpact?: CacheImpact;
  readonly dropsDrive: DropsDrive | null;
}
const ProfilePreviewResultShape = closed({
  resolved: Type.Array(PluginRefShape, { maxItems: PROFILE_LIMITS.plugins }),
  issues: Type.Array(ProfileIssueShape, { maxItems: 512 }),
  cost: closed({
    total: ProfileCostFiguresSchema,
    byPlugin: Type.Array(ProfilePluginCostShape, { maxItems: PROFILE_LIMITS.plugins }),
  }),
  missingRequired: Type.Array(closed({ plugin: ExtensionNameSchema, key: SettingKeySchema }), {
    maxItems: 512,
  }),
  threadsUsing: Count,
  permission: Type.Optional(PermissionChangeShape),
  toolsChanged: Type.Optional(ToolsChangedShape),
  cacheImpact: Type.Optional(CacheImpactSchema),
  dropsDrive: Nullable(DropsDriveShape),
});
export const ProfilePreviewResultSchema: TUnsafe<ProfilePreviewResult> =
  Type.Unsafe<ProfilePreviewResult>(
    ProfilePreviewResultShape satisfies SchemaProof<
      ProfilePreviewResult,
      typeof ProfilePreviewResultShape
    >,
  );

export interface ProfileDefaultForParams {
  /** 대화 폴더. 생략하면 프로젝트를 가리지 않는 가장 최근 대화를 본다 */
  readonly workspace?: string;
}
const ProfileDefaultForParamsShape = request({
  workspace: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
});
export const ProfileDefaultForParamsSchema: TUnsafe<Req<ProfileDefaultForParams>> = Type.Unsafe<
  Req<ProfileDefaultForParams>
>(
  ProfileDefaultForParamsShape satisfies SchemaProof<
    Req<ProfileDefaultForParams>,
    typeof ProfileDefaultForParamsShape
  >,
);

export interface ProfileDefaultForResult {
  readonly profileId: string;
}
const ProfileDefaultForResultShape = closed({ profileId: Id });
export const ProfileDefaultForResultSchema: TUnsafe<ProfileDefaultForResult> =
  Type.Unsafe<ProfileDefaultForResult>(
    ProfileDefaultForResultShape satisfies SchemaProof<
      ProfileDefaultForResult,
      typeof ProfileDefaultForResultShape
    >,
  );

export interface ProfileRemovePluginParams {
  readonly id: string;
  readonly plugin: string;
  readonly baseRev: number;
}
const ProfileRemovePluginParamsShape = request({
  id: Id,
  plugin: ExtensionNameSchema,
  baseRev: Count,
});
export const ProfileRemovePluginParamsSchema: TUnsafe<Req<ProfileRemovePluginParams>> = Type.Unsafe<
  Req<ProfileRemovePluginParams>
>(
  ProfileRemovePluginParamsShape satisfies SchemaProof<
    Req<ProfileRemovePluginParams>,
    typeof ProfileRemovePluginParamsShape
  >,
);

export interface ProfileRemovePluginPreview {
  readonly threadsUsing: number;
  readonly permission?: PermissionChange;
  readonly toolsChanged?: ToolsChanged;
  readonly dropsDrive: DropsDrive | null;
}
const ProfileRemovePluginPreviewShape = closed({
  threadsUsing: Count,
  permission: Type.Optional(PermissionChangeShape),
  toolsChanged: Type.Optional(ToolsChangedShape),
  dropsDrive: Nullable(DropsDriveShape),
});

export interface ProfileRemovePluginResult {
  readonly profile: Profile;
  readonly preview: ProfileRemovePluginPreview;
}
const ProfileRemovePluginResultShape = closed({
  profile: ProfileShape,
  preview: ProfileRemovePluginPreviewShape,
});
export const ProfileRemovePluginResultSchema: TUnsafe<ProfileRemovePluginResult> =
  Type.Unsafe<ProfileRemovePluginResult>(
    ProfileRemovePluginResultShape satisfies SchemaProof<
      ProfileRemovePluginResult,
      typeof ProfileRemovePluginResultShape
    >,
  );

export interface ProfileDefaultResetParams {
  /** 참이면 바꾸지 않고 바뀔 내용만 돌려준다 */
  readonly preview?: boolean;
}
const ProfileDefaultResetParamsShape = request({ preview: Type.Optional(Type.Boolean()) });
export const ProfileDefaultResetParamsSchema: TUnsafe<Req<ProfileDefaultResetParams>> = Type.Unsafe<
  Req<ProfileDefaultResetParams>
>(
  ProfileDefaultResetParamsShape satisfies SchemaProof<
    Req<ProfileDefaultResetParams>,
    typeof ProfileDefaultResetParamsShape
  >,
);

export interface ProfileDefaultResetResult {
  readonly profile: Profile;
  readonly changed: { readonly plugins: boolean; readonly settings: boolean };
  readonly threadsUsing: number;
}
const ProfileDefaultResetResultShape = closed({
  profile: ProfileShape,
  changed: closed({ plugins: Type.Boolean(), settings: Type.Boolean() }),
  threadsUsing: Count,
});
export const ProfileDefaultResetResultSchema: TUnsafe<ProfileDefaultResetResult> =
  Type.Unsafe<ProfileDefaultResetResult>(
    ProfileDefaultResetResultShape satisfies SchemaProof<
      ProfileDefaultResetResult,
      typeof ProfileDefaultResetResultShape
    >,
  );

export interface ThreadSetProfileParams {
  readonly threadId: ThreadId;
  readonly profileId: string;
}
const ThreadSetProfileParamsShape = request({
  threadId: ThreadIdSchema,
  profileId: Id,
});
export const ThreadSetProfileParamsSchema: TUnsafe<Req<ThreadSetProfileParams>> = Type.Unsafe<
  Req<ThreadSetProfileParams>
>(
  ThreadSetProfileParamsShape satisfies SchemaProof<
    Req<ThreadSetProfileParams>,
    typeof ThreadSetProfileParamsShape
  >,
);

export interface ThreadSetProfilePreview {
  readonly permission?: PermissionChange;
  readonly toolsChanged?: ToolsChanged;
  readonly cacheImpact?: CacheImpact;
}
const ThreadSetProfilePreviewShape = closed({
  permission: Type.Optional(PermissionChangeShape),
  toolsChanged: Type.Optional(ToolsChangedShape),
  cacheImpact: Type.Optional(CacheImpactSchema),
});

/**
 * 전환 뒤 새 프로필의 시작 Drive가 어떻게 됐는가(AGE-64, 이름은 [제안]).
 * `requested`: 시작을 걸었다. `deferred`: 도는 turn이나 일하는 Drive가 끝난 뒤 시작한다. `leading`: 새 시작 Drive가 이미 쥐고 있다.
 * `none`: 새 프로필에 시작 Drive가 없다(메시지를 받지 않은 옛 시작 Drive는 내려갔다). `rejected`: 엔진이 거절했다
 */
export const SET_PROFILE_START_DRIVES = [
  "requested",
  "deferred",
  "leading",
  "none",
  "rejected",
] as const;
export type SetProfileStartDrive = (typeof SET_PROFILE_START_DRIVES)[number];
const SetProfileStartDriveShape = Type.Union(
  SET_PROFILE_START_DRIVES.map((value) => Type.Literal(value)),
);

export interface ThreadSetProfileResult {
  readonly position: StreamPosition;
  readonly preview: ThreadSetProfilePreview;
  /** 선택. 없으면 알리지 않는 옛 호스트다 */
  readonly startDrive?: SetProfileStartDrive;
}
const ThreadSetProfileResultShape = closed({
  position: StreamPositionSchema,
  preview: ThreadSetProfilePreviewShape,
  startDrive: Type.Optional(SetProfileStartDriveShape),
});
export const ThreadSetProfileResultSchema: TUnsafe<ThreadSetProfileResult> =
  Type.Unsafe<ThreadSetProfileResult>(
    ThreadSetProfileResultShape satisfies SchemaProof<
      ThreadSetProfileResult,
      typeof ThreadSetProfileResultShape
    >,
  );

// ── 레지스트리 항목 ───────────────────────────────────────────────────────

type U<T> = TUnsafe<T>;
/** 프로필 wire 메서드의 params·result 쌍. `WireSchemas`에 더하는 모양이다(통합 담당이 methods.ts에 등록한다) */
export interface ProfileWireSchemas {
  "profile.list": Io<U<NoParams>, U<ProfileListResult>>;
  "profile.get": Io<U<Req<ProfileIdParams>>, U<ProfileGetResult>>;
  "profile.put": Io<U<Req<ProfilePutParams>>, U<ProfilePutResult>>;
  "profile.delete": Io<U<Req<ProfileIdParams>>, U<ProfileDeleteResult>>;
  "profile.clone": Io<U<Req<ProfileCloneParams>>, U<ProfileGetResult>>;
  "profile.common.get": Io<U<NoParams>, U<CommonGetResult>>;
  "profile.common.put": Io<U<Req<CommonPutParams>>, U<CommonGetResult>>;
  "profile.preview": Io<U<Req<ProfilePreviewParams>>, U<ProfilePreviewResult>>;
  "profile.defaultFor": Io<U<Req<ProfileDefaultForParams>>, U<ProfileDefaultForResult>>;
  "profile.removePlugin": Io<U<Req<ProfileRemovePluginParams>>, U<ProfileRemovePluginResult>>;
  "profile.default.reset": Io<U<Req<ProfileDefaultResetParams>>, U<ProfileDefaultResetResult>>;
  "thread.setProfile": Io<U<Req<ThreadSetProfileParams>>, U<ThreadSetProfileResult>>;
}
type ProfileWireTable = {
  readonly [M in keyof ProfileWireSchemas]: M4Spec<
    ProfileWireSchemas[M]["params"],
    ProfileWireSchemas[M]["result"]
  >;
};
export const PROFILE_WIRE_METHODS: ProfileWireTable = {
  "profile.list": m4(NoParamsSchema, ProfileListResultSchema),
  "profile.get": m4(ProfileIdParamsSchema, ProfileGetResultSchema),
  "profile.put": m4(ProfilePutParamsSchema, ProfilePutResultSchema),
  "profile.delete": m4(ProfileIdParamsSchema, ProfileDeleteResultSchema),
  "profile.clone": m4(ProfileCloneParamsSchema, ProfileGetResultSchema),
  "profile.common.get": m4(NoParamsSchema, CommonGetResultSchema),
  "profile.common.put": m4(CommonPutParamsSchema, CommonGetResultSchema),
  "profile.preview": m4(ProfilePreviewParamsSchema, ProfilePreviewResultSchema),
  "profile.defaultFor": m4(ProfileDefaultForParamsSchema, ProfileDefaultForResultSchema),
  "profile.removePlugin": m4(ProfileRemovePluginParamsSchema, ProfileRemovePluginResultSchema),
  "profile.default.reset": m4(ProfileDefaultResetParamsSchema, ProfileDefaultResetResultSchema),
  "thread.setProfile": m4(ThreadSetProfileParamsSchema, ThreadSetProfileResultSchema),
};
