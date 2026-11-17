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
import { closed, m4, request, type Io, type M4Spec, type Req } from "./schema-kit.ts";

// F.wire-settings.spec §3.3.6(M4 Test run·계측·설정 설명). L4.desktop-ux.spec §10.1 W-34, W-43, W-45, W-48, W-50.
// 프로필 저장·메서드(`profile.*`, `thread.setProfile`)는 `profile.ts`로 옮겼다(M5c-1). 이 파일에는 Test run, 계측, 설정 설명만 남는다.

const Id = Type.String({ minLength: 1, maxLength: 128 });
const Name = Type.String({ minLength: 1, maxLength: 96 });
const Count = Type.Integer({ minimum: 0 });
const ThreadRef = Type.String({ minLength: 1, maxLength: 64 });
const SettingKey = Type.String({ minLength: 1, maxLength: 160 });

/** 알림 `profile.changed`. 목록 개정이 바뀌었으니 `profile.list`를 다시 읽는다. `commonChanged`가 참이면 공통 묶음도 바뀌었다 */
export interface ProfileChangedParams {
  readonly rev: number;
  readonly ids: readonly string[];
  readonly commonChanged: boolean;
}
const ProfileChangedParamsShape = closed({
  rev: Count,
  ids: Type.Array(Id, { maxItems: 200 }),
  commonChanged: Type.Boolean(),
});
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
  /** 이긴 범위(managed, launch, profile, local, project, user, session) 또는 기본값이면 null */
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
  "settings.explain": m4(SettingsExplainParamsSchema, SettingsExplainResultSchema),
  "trace.turn": m4(TraceTurnParamsSchema, TraceTurnResultSchema),
  "testRun.pause": m4(TestRunThreadParamsSchema, TestRunControlResultSchema),
  "testRun.resume": m4(TestRunThreadParamsSchema, TestRunControlResultSchema),
  "testRun.step": m4(TestRunThreadParamsSchema, TestRunControlResultSchema),
  "testRun.phase": m4(TestRunThreadParamsSchema, TestRunPhaseResultSchema),
};
