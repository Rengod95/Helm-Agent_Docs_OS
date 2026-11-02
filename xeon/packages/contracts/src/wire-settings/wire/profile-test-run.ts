import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";
import {
  TestRunControlResultSchema,
  TestRunPhaseResultSchema,
  TraceTurnResultSchema,
  type TestRunControlResult,
  type TestRunPhaseResult,
  type TraceTurnResult,
} from "../../extensions/index.ts";
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

// F.wire-settings.spec §3.3.6(M4 프로필·Test run·계측). L4.desktop-ux.spec §10.1 W-34, W-43~W-46, W-48, W-50.
// 프로필은 런타임 호스트의 사용자 설정 폴더 `profiles.json`에 저장한다(U-5). 같은 호스트에 붙은 모든 클라이언트가 같은 목록을 본다.

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Name = Type.String({ minLength: 1, maxLength: 96 });
const Iso = Type.String({ minLength: 1, maxLength: 40 });
const Count = Type.Integer({ minimum: 0 });
const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
const SettingKey = Type.String({ minLength: 1, maxLength: 160 });

/** 프로필 id. 소문자 영숫자와 `-` */
export const PROFILE_ID_PATTERN: string = "^[a-z][a-z0-9-]{0,47}$";
export const PROFILE_LIMITS = { enable: 64, disable: 64, settings: 128, profiles: 200 } as const;

export interface ProfileSetting {
  readonly key: string;
  readonly value: unknown;
}
/**
 * 프로필 하나. 적용하면 고른 층(`layer`)에 한 번에 쓴다(`profile.apply`).
 * `enable`·`disable`은 확장 이름 목록이다(Registration id가 아니다) [제안: 플러그인 단위는 아직 아니다].
 * `settings`의 키는 고른 층의 범위에서 쓸 수 있어야 한다(검사는 호스트가 F 설정 카탈로그로 한다).
 */
export interface Profile {
  readonly id: string;
  readonly title: string;
  readonly enable: readonly string[];
  readonly disable: readonly string[];
  readonly settings: readonly ProfileSetting[];
  /** drive를 가질 Registration id(설정 `x.primitives.activeDriver`에 쓴다). 없으면 null */
  readonly driver: string | null;
  /** 저장이 정한 값. 쓰는 쪽은 보내도 무시된다 */
  readonly updatedAt: string;
  /** 저장이 정한 값. `profile.put`의 `baseRev` 비교에 쓴다 */
  readonly rev: number;
}
const ProfileShape = closed({
  id: Type.String({ pattern: PROFILE_ID_PATTERN }),
  title: Type.String({ minLength: 1, maxLength: 128 }),
  enable: Type.Array(Name, { maxItems: PROFILE_LIMITS.enable }),
  disable: Type.Array(Name, { maxItems: PROFILE_LIMITS.disable }),
  settings: Type.Array(closed({ key: SettingKey, value: Type.Unknown() }), {
    maxItems: PROFILE_LIMITS.settings,
  }),
  driver: Type.Union([Name, Type.Null()]),
  updatedAt: Iso,
  rev: Count,
});
export const ProfileSchema: TUnsafe<Profile> = Type.Unsafe<Profile>(
  ProfileShape satisfies SchemaProof<Profile, typeof ProfileShape>,
);

/** `profiles.json`의 모양 */
export interface ProfilesFile {
  readonly schemaVersion: 1;
  readonly profiles: readonly Profile[];
}
const ProfilesFileShape = closed({
  schemaVersion: Type.Literal(1),
  profiles: Type.Array(ProfileShape, { maxItems: PROFILE_LIMITS.profiles }),
});
export const ProfilesFileSchema: TUnsafe<ProfilesFile> = Type.Unsafe<ProfilesFile>(
  ProfilesFileShape satisfies SchemaProof<ProfilesFile, typeof ProfilesFileShape>,
);

/** `profile.put`이 받는 프로필. 저장이 정하는 `updatedAt`, `rev`는 없다 */
export interface ProfileInput {
  readonly id: string;
  readonly title: string;
  readonly enable: readonly string[];
  readonly disable: readonly string[];
  readonly settings: readonly ProfileSetting[];
  readonly driver: string | null;
}
const ProfileInputShape = closed({
  id: ProfileShape.properties.id,
  title: ProfileShape.properties.title,
  enable: ProfileShape.properties.enable,
  disable: ProfileShape.properties.disable,
  settings: ProfileShape.properties.settings,
  driver: ProfileShape.properties.driver,
});
export const ProfileInputSchema: TUnsafe<ProfileInput> = Type.Unsafe<ProfileInput>(
  ProfileInputShape satisfies SchemaProof<ProfileInput, typeof ProfileInputShape>,
);

export interface ProfileListResult {
  readonly profiles: readonly Profile[];
  /** 목록 전체의 개정. 바뀔 때마다 오른다 */
  readonly rev: number;
}
const ProfileListResultShape = closed({
  profiles: Type.Array(ProfileShape, { maxItems: PROFILE_LIMITS.profiles }),
  rev: Count,
});
export const ProfileListResultSchema: TUnsafe<ProfileListResult> = Type.Unsafe<ProfileListResult>(
  ProfileListResultShape satisfies SchemaProof<ProfileListResult, typeof ProfileListResultShape>,
);

export interface ProfileIdParams {
  readonly id: string;
}
const ProfileIdParamsShape = request({ id: Id });
export const ProfileIdParamsSchema: TUnsafe<Req<ProfileIdParams>> = Type.Unsafe<
  Req<ProfileIdParams>
>(ProfileIdParamsShape satisfies SchemaProof<Req<ProfileIdParams>, typeof ProfileIdParamsShape>);

export interface ProfileGetResult {
  readonly profile: Profile;
}
const ProfileGetResultShape = closed({ profile: ProfileShape });
export const ProfileGetResultSchema: TUnsafe<ProfileGetResult> = Type.Unsafe<ProfileGetResult>(
  ProfileGetResultShape satisfies SchemaProof<ProfileGetResult, typeof ProfileGetResultShape>,
);

export interface ProfilePutParams {
  readonly profile: ProfileInput;
  /** 처음 만들면 null. 저장된 `rev`와 다르면 충돌(`settings.conflict`) */
  readonly baseRev: number | null;
}
const ProfilePutParamsShape = request({
  profile: ProfileInputShape,
  baseRev: Type.Union([Count, Type.Null()]),
});
export const ProfilePutParamsSchema: TUnsafe<Req<ProfilePutParams>> = Type.Unsafe<
  Req<ProfilePutParams>
>(ProfilePutParamsShape satisfies SchemaProof<Req<ProfilePutParams>, typeof ProfilePutParamsShape>);

/** 프로필을 쓰는 층(T-REG §7 4번). 생략하면 호스트는 `user`로 읽는다 [제안, 사용자 확인 대기] */
export const PROFILE_LAYERS = ["user", "project", "thread"] as const;
export type ProfileLayer = (typeof PROFILE_LAYERS)[number];
const ProfileLayerShape = Type.Union(PROFILE_LAYERS.map((name) => Type.Literal(name)));

export interface ProfileApplyParams {
  readonly id: string;
  /** `layer`가 `thread`이면 필수 */
  readonly threadId?: string;
  readonly layer?: ProfileLayer;
}
const ProfileApplyParamsShape = request({
  id: Id,
  threadId: Type.Optional(ThreadRef),
  layer: Type.Optional(ProfileLayerShape),
});
export const ProfileApplyParamsSchema: TUnsafe<Req<ProfileApplyParams>> = Type.Unsafe<
  Req<ProfileApplyParams>
>(
  ProfileApplyParamsShape satisfies SchemaProof<
    Req<ProfileApplyParams>,
    typeof ProfileApplyParamsShape
  >,
);
export interface ProfileApplyResult {
  /** 쓴 설정 키 */
  readonly written: readonly string[];
  /** 쓴 층. 요청의 `layer`를 풀어 돌려준다 */
  readonly layer: ProfileLayer;
  readonly appliesAt: "nextStepBoundary" | "now";
}
const ProfileApplyResultShape = closed({
  written: Type.Array(SettingKey, { maxItems: 256 }),
  layer: ProfileLayerShape,
  appliesAt: Type.Union([Type.Literal("nextStepBoundary"), Type.Literal("now")]),
});
export const ProfileApplyResultSchema: TUnsafe<ProfileApplyResult> =
  Type.Unsafe<ProfileApplyResult>(
    ProfileApplyResultShape satisfies SchemaProof<
      ProfileApplyResult,
      typeof ProfileApplyResultShape
    >,
  );

export interface ProfileRevResult {
  readonly rev: number;
}
const ProfileRevResultShape = closed({ rev: Count });
export const ProfileRevResultSchema: TUnsafe<ProfileRevResult> = Type.Unsafe<ProfileRevResult>(
  ProfileRevResultShape satisfies SchemaProof<ProfileRevResult, typeof ProfileRevResultShape>,
);

/** `profile.preview`(W-44). 대화 없이 "적용했다면"을 계산한다 */
export interface ProfilePreviewParams {
  readonly id: string;
  readonly threadId?: string;
  readonly layer?: ProfileLayer;
}
const ProfilePreviewParamsShape = request({
  id: Id,
  threadId: Type.Optional(ThreadRef),
  layer: Type.Optional(ProfileLayerShape),
});
export const ProfilePreviewParamsSchema: TUnsafe<Req<ProfilePreviewParams>> = Type.Unsafe<
  Req<ProfilePreviewParams>
>(
  ProfilePreviewParamsShape satisfies SchemaProof<
    Req<ProfilePreviewParams>,
    typeof ProfilePreviewParamsShape
  >,
);
export interface ProfilePreviewResult {
  /** 켜질 확장 이름 */
  readonly enabled: readonly string[];
  readonly disabled: readonly string[];
  /** drive 후보 Registration id(켜짐, drive 등록) */
  readonly candidates: readonly string[];
  /** 중재 규칙 `X.primitives.spec` §4.4.1 4번이 고를 holder(Registration id). 없으면 null */
  readonly expectedHolder: string | null;
  /** 덮어쓰는 설정 */
  readonly overrides: readonly { readonly key: string; readonly value: unknown }[];
  /** 켜지는 Hook 수 */
  readonly hookCount: number;
  /** 쓰게 될 층 */
  readonly layer: ProfileLayer;
}
const ProfilePreviewResultShape = closed({
  enabled: Type.Array(Name, { maxItems: 500 }),
  disabled: Type.Array(Name, { maxItems: 500 }),
  candidates: Type.Array(Name, { maxItems: 500 }),
  expectedHolder: Type.Union([Name, Type.Null()]),
  overrides: Type.Array(closed({ key: SettingKey, value: Type.Unknown() }), { maxItems: 256 }),
  hookCount: Count,
  layer: ProfileLayerShape,
});
export const ProfilePreviewResultSchema: TUnsafe<ProfilePreviewResult> =
  Type.Unsafe<ProfilePreviewResult>(
    ProfilePreviewResultShape satisfies SchemaProof<
      ProfilePreviewResult,
      typeof ProfilePreviewResultShape
    >,
  );

/** 알림 `profile.changed`. 목록 개정이 바뀌었으니 `profile.list`를 다시 읽는다 */
export interface ProfileChangedParams {
  readonly rev: number;
  readonly ids: readonly string[];
}
const ProfileChangedParamsShape = closed({ rev: Count, ids: Type.Array(Id, { maxItems: 200 }) });
export const ProfileChangedParamsSchema: TUnsafe<ProfileChangedParams> =
  Type.Unsafe<ProfileChangedParams>(
    ProfileChangedParamsShape satisfies SchemaProof<
      ProfileChangedParams,
      typeof ProfileChangedParamsShape
    >,
  );

/** Test run 표지(W-34). `ThreadSummary.testRun` */
export interface TestRunMarker {
  readonly profileId: string | null;
  /** 시험 대상 확장 이름. 없으면 null */
  readonly target: string | null;
  readonly paused: boolean;
}
const TestRunMarkerShape = closed({
  profileId: Type.Union([Id, Type.Null()]),
  target: Type.Union([Name, Type.Null()]),
  paused: Type.Boolean(),
});
export const TestRunMarkerSchema: TUnsafe<TestRunMarker> = Type.Unsafe<TestRunMarker>(
  TestRunMarkerShape satisfies SchemaProof<TestRunMarker, typeof TestRunMarkerShape>,
);

/** `testRun.pause`, `testRun.resume`, `testRun.step`, `testRun.phase`(W-48, W-50) 공통 params */
export interface TestRunThreadParams {
  readonly threadId: string;
}
const TestRunThreadParamsShape = request({ threadId: ThreadRef });
export const TestRunThreadParamsSchema: TUnsafe<Req<TestRunThreadParams>> = Type.Unsafe<
  Req<TestRunThreadParams>
>(
  TestRunThreadParamsShape satisfies SchemaProof<
    Req<TestRunThreadParams>,
    typeof TestRunThreadParamsShape
  >,
);

/** `trace.turn`(W-43). 원천은 핸들러 계측 링 버퍼(X-15). 결과 타입은 `trace-types.ts` */
export interface TraceTurnParams {
  readonly threadId: string;
  readonly turnId: string;
}
const TraceTurnParamsShape = request({ threadId: ThreadRef, turnId: ThreadRef });
export const TraceTurnParamsSchema: TUnsafe<Req<TraceTurnParams>> = Type.Unsafe<
  Req<TraceTurnParams>
>(TraceTurnParamsShape satisfies SchemaProof<Req<TraceTurnParams>, typeof TraceTurnParamsShape>);

/** `settings.explain`(W-45) */
export interface SettingsExplainParams {
  readonly key: string;
  readonly threadId: string;
}
const SettingsExplainParamsShape = request({ key: SettingKey, threadId: ThreadRef });
export const SettingsExplainParamsSchema: TUnsafe<Req<SettingsExplainParams>> = Type.Unsafe<
  Req<SettingsExplainParams>
>(
  SettingsExplainParamsShape satisfies SchemaProof<
    Req<SettingsExplainParams>,
    typeof SettingsExplainParamsShape
  >,
);
export const SETTING_WRITERS = ["default", "user", "profile", "testRun", "session"] as const;
export type SettingWriter = (typeof SETTING_WRITERS)[number];
export interface SettingsExplainResult {
  readonly key: string;
  readonly value: unknown;
  /** 이긴 범위(managed, user, project, local, session) 또는 기본값이면 null */
  readonly winningScope: string | null;
  /** 그 값을 쓴 쪽. 프로필이면 `profileId` */
  readonly writer: SettingWriter;
  readonly profileId?: string;
}
const SettingsExplainResultShape = closed({
  key: SettingKey,
  value: Type.Unknown(),
  winningScope: Type.Union([Type.String({ minLength: 1, maxLength: 16 }), Type.Null()]),
  writer: Type.Union([
    Type.Literal("default"),
    Type.Literal("user"),
    Type.Literal("profile"),
    Type.Literal("testRun"),
    Type.Literal("session"),
  ]),
  profileId: Type.Optional(Id),
});
export const SettingsExplainResultSchema: TUnsafe<SettingsExplainResult> =
  Type.Unsafe<SettingsExplainResult>(
    SettingsExplainResultShape satisfies SchemaProof<
      SettingsExplainResult,
      typeof SettingsExplainResultShape
    >,
  );

type U<T> = TUnsafe<T>;
export interface ProfileTestRunSchemas {
  "profile.list": Io<U<NoParams>, U<ProfileListResult>>;
  "profile.get": Io<U<Req<ProfileIdParams>>, U<ProfileGetResult>>;
  "profile.put": Io<U<Req<ProfilePutParams>>, U<ProfileGetResult>>;
  "profile.delete": Io<U<Req<ProfileIdParams>>, U<ProfileRevResult>>;
  "profile.apply": Io<U<Req<ProfileApplyParams>>, U<ProfileApplyResult>>;
  "profile.preview": Io<U<Req<ProfilePreviewParams>>, U<ProfilePreviewResult>>;
  "settings.explain": Io<U<Req<SettingsExplainParams>>, U<SettingsExplainResult>>;
  "trace.turn": Io<U<Req<TraceTurnParams>>, U<TraceTurnResult>>;
  "testRun.pause": Io<U<Req<TestRunThreadParams>>, U<TestRunControlResult>>;
  "testRun.resume": Io<U<Req<TestRunThreadParams>>, U<TestRunControlResult>>;
  "testRun.step": Io<U<Req<TestRunThreadParams>>, U<TestRunControlResult>>;
  "testRun.phase": Io<U<Req<TestRunThreadParams>>, U<TestRunPhaseResult>>;
}
type Table = {
  readonly [M in keyof ProfileTestRunSchemas]: M4Spec<
    ProfileTestRunSchemas[M]["params"],
    ProfileTestRunSchemas[M]["result"]
  >;
};
export const PROFILE_TEST_RUN_METHODS: Table = {
  "profile.list": m4(NoParamsSchema, ProfileListResultSchema),
  "profile.get": m4(ProfileIdParamsSchema, ProfileGetResultSchema),
  "profile.put": m4(ProfilePutParamsSchema, ProfileGetResultSchema),
  "profile.delete": m4(ProfileIdParamsSchema, ProfileRevResultSchema),
  "profile.apply": m4(ProfileApplyParamsSchema, ProfileApplyResultSchema),
  "profile.preview": m4(ProfilePreviewParamsSchema, ProfilePreviewResultSchema),
  "settings.explain": m4(SettingsExplainParamsSchema, SettingsExplainResultSchema),
  "trace.turn": m4(TraceTurnParamsSchema, TraceTurnResultSchema),
  "testRun.pause": m4(TestRunThreadParamsSchema, TestRunControlResultSchema),
  "testRun.resume": m4(TestRunThreadParamsSchema, TestRunControlResultSchema),
  "testRun.step": m4(TestRunThreadParamsSchema, TestRunControlResultSchema),
  "testRun.phase": m4(TestRunThreadParamsSchema, TestRunPhaseResultSchema),
};
