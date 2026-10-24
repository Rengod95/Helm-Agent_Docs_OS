import {
  SCOPE_ID_PATTERN,
  type DriveLimits,
  type ExtensionName,
  type ScopeId,
} from "@xeon/contracts/extensions";
import type { ThreadId } from "@xeon/contracts/conversation";
import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";
import { Type } from "typebox";
import type { PrimitivesSettingsSource } from "./core.ts";

export type { PrimitivesSettingsSource } from "./core.ts";

/** 상한을 명시하지 않은 drive 임대의 일반 기본 상한(X.primitives.spec §4.4.2, review.decisions-2 U-12) */
export const DEFAULT_DRIVE_LIMITS: Required<DriveLimits> = {
  maxTurns: 4,
  maxSpawns: 8,
  maxTokens: 400_000,
};

const DriveLimitsSchema = Type.Object(
  {
    maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
    maxSpawns: Type.Optional(Type.Integer({ minimum: 0 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/**
 * x.primitives.* 설정 키(X.primitives.spec §6).
 * activeDriveGroup의 위젯은 문서가 select로 적었지만 F의 D8 규칙이 select에 range.enum을 요구한다.
 * 후보 목록은 ExtHost.scopes()에서 오므로 정적 enum을 둘 수 없어 text로 둔다.
 */
export const primitivesSettings: SettingGroup<
  "x.primitives",
  {
    readonly driveDefaultLimits: SettingDefInput;
    readonly driveLimits: SettingDefInput;
    readonly activeDriveGroup: SettingDefInput;
    readonly capabilityProviders: SettingDefInput;
  }
> = defineSettings("x.primitives", {
  driveDefaultLimits: {
    type: DriveLimitsSchema,
    default: DEFAULT_DRIVE_LIMITS,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "session"],
    ui: {
      tab: "plugins",
      widget: "table",
      order: 100,
      label: "drive 기본 상한",
      help: "상한을 명시하지 않은 drive 임대에 쓴다. 그룹이 자기 상한을 넘기면 그 값이 우선한다. 비운 필드는 기본 상한(4/8/400000)을 쓴다. 일반 대화 턴에는 상한이 없다.",
    },
    since: "0.1.0",
  },
  driveLimits: {
    type: DriveLimitsSchema,
    default: {},
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "session"],
    ui: {
      tab: "plugins",
      widget: "table",
      order: 101,
      label: "drive 상한 천장",
      help: "어떤 drive 임대도 이 값을 넘지 못한다. 비어 있으면 천장이 없다.",
    },
    since: "0.1.0",
  },
  activeDriveGroup: {
    type: Type.Union([Type.String({ pattern: SCOPE_ID_PATTERN, maxLength: 65 }), Type.Null()]),
    default: null,
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "session"],
    ui: {
      tab: "plugins",
      widget: "text",
      order: 110,
      label: "구동 그룹",
      help: "drive를 쓰는 그룹이 둘 이상일 때 임대를 받을 그룹의 scope id.",
    },
    since: "0.1.0",
  },
  capabilityProviders: {
    type: Type.Record(Type.String(), Type.String()),
    default: {},
    runtimeChange: "restart",
    allowedScopes: ["user", "project"],
    ui: {
      tab: "plugins",
      widget: "table",
      order: 120,
      label: "능력 공급자",
      help: "공급자가 여럿인 능력마다 쓸 확장 이름.",
    },
    since: "0.1.0",
  },
});

export interface StaticPrimitivesSettings {
  readonly driveDefaultLimits?: DriveLimits;
  readonly driveLimits?: DriveLimits;
  readonly activeDriveGroup?: ScopeId | null;
  readonly capabilityProviders?: Readonly<Record<string, ExtensionName>>;
}

/**
 * 사용자가 적은 일반 기본 상한에 내장 기본값을 필드마다 채운다. 일부 필드만 적은 값(`{ maxTurns: 6 }`)도
 * 나머지 필드는 내장 기본 상한을 그대로 쓴다(X.primitives.spec §4.4.2, review.decisions-2 U-12)
 */
export function withDriveDefaults(value: DriveLimits): DriveLimits {
  return { ...DEFAULT_DRIVE_LIMITS, ...value };
}

/** 값이 정해진 설정 읽기. 값이 없으면 기본 상한은 DEFAULT_DRIVE_LIMITS, 천장 없음, 구동 그룹 없음, 공급자 지정 없음이다. 일부 필드만 주면 나머지는 DEFAULT_DRIVE_LIMITS로 채운다 */
export function createStaticPrimitivesSettings(
  values: StaticPrimitivesSettings = {},
): PrimitivesSettingsSource {
  return {
    driveDefaultLimits: (_threadId: ThreadId) => withDriveDefaults(values.driveDefaultLimits ?? {}),
    driveLimits: (_threadId: ThreadId) => values.driveLimits ?? {},
    activeDriveGroup: (_threadId: ThreadId) => values.activeDriveGroup ?? null,
    capabilityProviders: () => values.capabilityProviders ?? {},
  };
}
