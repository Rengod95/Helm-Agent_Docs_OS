import type { DriveLimits, ExtensionName } from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";
import { Type } from "typebox";
import type { PrimitivesSettingsSource } from "./core.ts";

export type { PrimitivesSettingsSource } from "./core.ts";

/** 상한을 명시하지 않은 drive 임대의 일반 기본 상한(X.primitives.spec §4.4.2, review.decisions-2 U-12) */
export const DEFAULT_DRIVE_LIMITS: Required<DriveLimits> = {
  maxTurns: 4,
  maxSpawns: 8,
  maxTokens: 400_000,
};

/** 주도권 스택의 깊이 상한 기본값(코어 위 프레임 수). drive-isolation.md 2.3 [결정: 2026-11-17 사용자] */
const DEFAULT_DRIVE_MAX_DEPTH = 8;

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
 * activeDriver와 leaseWaitLimit은 중재를 걷어 내면서 없앴다(drive-isolation.md 2.2).
 */
export const primitivesSettings: SettingGroup<
  "x.primitives",
  {
    readonly driveDefaultLimits: SettingDefInput;
    readonly driveLimits: SettingDefInput;
    readonly driveMaxDepth: SettingDefInput;
    readonly driveRequiresGroup: SettingDefInput;
    readonly capabilityProviders: SettingDefInput;
  }
> = defineSettings("x.primitives", {
  driveDefaultLimits: {
    type: DriveLimitsSchema,
    default: DEFAULT_DRIVE_LIMITS,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "launch", "profile"],
    ui: {
      tab: "plugins",
      widget: "table",
      order: 100,
      label: "Default drive limits",
      help: "Applies to drive leases that set no limits of their own. If a group sets its own limit, that value takes precedence. Empty fields use the default limits (4/8/400000). Regular conversation turns have no limits.",
    },
    since: "0.1.0",
  },
  driveLimits: {
    type: DriveLimitsSchema,
    default: {},
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "launch"],
    ui: {
      tab: "plugins",
      widget: "table",
      order: 101,
      label: "Drive limit ceiling",
      help: "No drive lease may exceed this value. If empty, there is no ceiling.",
    },
    since: "0.1.0",
  },
  driveMaxDepth: {
    type: Type.Integer({ minimum: 1 }),
    default: DEFAULT_DRIVE_MAX_DEPTH,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "launch"],
    ui: {
      tab: "plugins",
      widget: "number",
      order: 102,
      label: "Drive stack depth limit",
      help: "How many plugins may lead one conversation at once, one on top of another. A handoff past this depth is refused.",
    },
    since: "0.1.0",
  },
  driveRequiresGroup: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 112,
      label: "Drive only from plugin groups",
      help: "When on, only members of a plugin group can register a drive. When off, plugins outside a group can also lead conversations. Applies when a Registration is re-enabled or an extension is reloaded.",
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
      label: "Capability providers",
      help: "Extension name to use for each capability that has multiple providers.",
    },
    since: "0.1.0",
  },
});

export interface StaticPrimitivesSettings {
  readonly driveDefaultLimits?: DriveLimits;
  readonly driveLimits?: DriveLimits;
  readonly driveMaxDepth?: number;
  readonly driveRequiresGroup?: boolean;
  readonly capabilityProviders?: Readonly<Record<string, ExtensionName>>;
}

/**
 * 사용자가 적은 일반 기본 상한에 내장 기본값을 필드마다 채운다. 일부 필드만 적은 값(`{ maxTurns: 6 }`)도
 * 나머지 필드는 내장 기본 상한을 그대로 쓴다(X.primitives.spec §4.4.2, review.decisions-2 U-12)
 */
export function withDriveDefaults(value: DriveLimits): DriveLimits {
  return { ...DEFAULT_DRIVE_LIMITS, ...value };
}

/** 값이 정해진 설정 읽기. 값이 없으면 기본 상한은 DEFAULT_DRIVE_LIMITS, 천장 없음, 깊이 상한 기본값, 구동 그룹 제한 기본값, 공급자 지정 없음이다 */
export function createStaticPrimitivesSettings(
  values: StaticPrimitivesSettings = {},
): PrimitivesSettingsSource {
  return {
    driveDefaultLimits: (_threadId: ThreadId) => withDriveDefaults(values.driveDefaultLimits ?? {}),
    driveLimits: (_threadId: ThreadId) => values.driveLimits ?? {},
    driveMaxDepth: (_threadId: ThreadId) => values.driveMaxDepth ?? DEFAULT_DRIVE_MAX_DEPTH,
    driveRequiresGroup: () => values.driveRequiresGroup ?? true,
    capabilityProviders: () => values.capabilityProviders ?? {},
  };
}
