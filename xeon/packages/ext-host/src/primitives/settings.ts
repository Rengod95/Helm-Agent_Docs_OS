import {
  REGISTRATION_ID_PATTERN,
  type DriveLimits,
  type ExtensionName,
  type RegistrationId,
} from "@fresnel/contracts/extensions";
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
/** 임대 대기 상한 기본값: 임대를 받지 못한 후보가 넘기는 `turn_settled`·`idle` 경계 수 [제안] */
export const DEFAULT_LEASE_WAIT_LIMIT = 8;

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
 * activeDriver의 위젯은 문서가 select로 적었지만 F의 D8 규칙이 select에 range.enum을 요구한다.
 * 후보 목록은 ExtHost.scopes()에서 오므로 정적 enum을 둘 수 없어 text로 둔다.
 */
export const primitivesSettings: SettingGroup<
  "x.primitives",
  {
    readonly driveDefaultLimits: SettingDefInput;
    readonly driveLimits: SettingDefInput;
    readonly activeDriver: SettingDefInput;
    readonly driveRequiresGroup: SettingDefInput;
    readonly capabilityProviders: SettingDefInput;
    readonly leaseWaitLimit: SettingDefInput;
  }
> = defineSettings("x.primitives", {
  driveDefaultLimits: {
    type: DriveLimitsSchema,
    default: DEFAULT_DRIVE_LIMITS,
    runtimeChange: "nextTurn",
    allowedScopes: ["managed", "user", "project", "launch"],
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
  activeDriver: {
    type: Type.Union([
      Type.String({ pattern: REGISTRATION_ID_PATTERN, maxLength: 65 }),
      Type.Null(),
    ]),
    default: null,
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "launch"],
    ui: {
      tab: "plugins",
      widget: "text",
      order: 110,
      label: "Driving plugin",
      help: "Registration id that receives the drive lock when two or more Registrations use drive.",
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
  leaseWaitLimit: {
    type: Type.Integer({ minimum: 1 }),
    default: DEFAULT_LEASE_WAIT_LIMIT,
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "launch"],
    ui: {
      tab: "plugins",
      widget: "number",
      order: 111,
      label: "Lease wait limit",
      help: "Number of turn-settled or idle boundaries a group waits after failing to get a drive lease. When exceeded, the request is rejected and lease.rejected is recorded.",
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
  readonly activeDriver?: RegistrationId | null;
  readonly driveRequiresGroup?: boolean;
  readonly capabilityProviders?: Readonly<Record<string, ExtensionName>>;
  readonly leaseWaitLimit?: number;
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
    activeDriver: (_threadId: ThreadId) => values.activeDriver ?? null,
    driveRequiresGroup: () => values.driveRequiresGroup ?? true,
    capabilityProviders: () => values.capabilityProviders ?? {},
    leaseWaitLimit: (_threadId: ThreadId) => values.leaseWaitLimit ?? DEFAULT_LEASE_WAIT_LIMIT,
  };
}
