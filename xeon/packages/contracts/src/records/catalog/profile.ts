import { Type, type TUnsafe } from "typebox";
import type { SchemaProof } from "../../base/index.ts";

// M5c-1 `profile.applied`(review.m5-profile-project-loader §3.2). 대화의 켜짐 집합이 바뀌어 적용된 경계마다 하나다.
// 상태 사건이다(덧씌우기 복원, 켜짐 집합 감사, 재생 결정성). 관찰값을 로그에 더하지 않는다는 E §3.1의 방안 A 거부와 겹치지 않는다.

/** 적용 사유. 저장된 문자열이라 더하기만 한다 */
export const PROFILE_APPLIED_REASONS = [
  "open",
  "profile_edited",
  "common_edited",
  "switched",
  "overlay_on",
  "overlay_off",
  "plugin_updated",
  "plugin_stopped",
  "profile_missing",
] as const;
export type ProfileAppliedReason = (typeof PROFILE_APPLIED_REASONS)[number];

export interface ProfileAppliedPayload {
  readonly reason: ProfileAppliedReason;
  /** 이 경계에서 적용한 프로필 id와 그 개정. 감사와 재생이 어느 설정으로 돌았는지 복원한다 */
  readonly profileId: string;
  readonly profileRev: number;
  readonly commonRev: number;
  /** 집합 차이(플러그인 이름). 덧씌우기 항목은 `overlay`에 따로 있다 */
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** 이 경계에서 살아 있는 덧씌우기. `draftId`가 있으면 초안 표지의 원천이다(호스트가 `scope_kind = overlay_draft`를 쓴다) */
  readonly overlay: readonly {
    readonly plugin: string;
    readonly contentHash: string;
    readonly draftId?: string;
    readonly until: "turn" | "release";
  }[];
  /** 권한 모드가 바뀐 경우의 이전·이후 값 */
  readonly permission?: { readonly from: string; readonly to: string };
  readonly toolsChanged?: {
    readonly added: readonly string[];
    readonly removed: readonly string[];
  };
  /** 이 경계에서 검토본 해시가 바뀐 플러그인 */
  readonly updated?: readonly {
    readonly plugin: string;
    readonly fromHash: string;
    readonly toHash: string;
  }[];
}

const NameShape = Type.String({ minLength: 1, maxLength: 128 });
const HashShape = Type.String({ minLength: 1, maxLength: 128 });
const CountShape = Type.Integer({ minimum: 0 });
const ProfileAppliedShape = Type.Object(
  {
    reason: Type.Union(PROFILE_APPLIED_REASONS.map((reason) => Type.Literal(reason))),
    profileId: Type.String({ minLength: 1, maxLength: 128 }),
    profileRev: CountShape,
    commonRev: CountShape,
    added: Type.Array(NameShape, { maxItems: 256 }),
    removed: Type.Array(NameShape, { maxItems: 256 }),
    overlay: Type.Array(
      Type.Object(
        {
          plugin: NameShape,
          contentHash: HashShape,
          draftId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
          until: Type.Union([Type.Literal("turn"), Type.Literal("release")]),
        },
        { additionalProperties: false },
      ),
      { maxItems: 4 },
    ),
    permission: Type.Optional(
      Type.Object({ from: NameShape, to: NameShape }, { additionalProperties: false }),
    ),
    toolsChanged: Type.Optional(
      Type.Object(
        {
          added: Type.Array(NameShape, { maxItems: 512 }),
          removed: Type.Array(NameShape, { maxItems: 512 }),
        },
        { additionalProperties: false },
      ),
    ),
    updated: Type.Optional(
      Type.Array(
        Type.Object(
          { plugin: NameShape, fromHash: HashShape, toHash: HashShape },
          { additionalProperties: false },
        ),
        { maxItems: 256 },
      ),
    ),
  },
  { additionalProperties: false },
);
export const ProfileAppliedPayloadSchema: TUnsafe<ProfileAppliedPayload> =
  Type.Unsafe<ProfileAppliedPayload>(
    ProfileAppliedShape satisfies SchemaProof<ProfileAppliedPayload, typeof ProfileAppliedShape>,
  );
