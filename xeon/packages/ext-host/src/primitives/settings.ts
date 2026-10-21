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

/**
 * x.primitives.* 설정 키(X.primitives.spec §6).
 * activeDriveGroup의 위젯은 문서가 select로 적었지만 F의 D8 규칙이 select에 range.enum을 요구한다.
 * 후보 목록은 ExtHost.scopes()에서 오므로 정적 enum을 둘 수 없어 text로 둔다.
 */
export const primitivesSettings: SettingGroup<
  "x.primitives",
  {
    readonly driveLimits: SettingDefInput;
    readonly activeDriveGroup: SettingDefInput;
    readonly capabilityProviders: SettingDefInput;
  }
> = defineSettings("x.primitives", {
  driveLimits: {
    type: Type.Object(
      {
        maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
        maxSpawns: Type.Optional(Type.Integer({ minimum: 0 })),
        maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
      },
      { additionalProperties: false },
    ),
    default: {},
    runtimeChange: "nextTurn",
    allowedScopes: ["user", "project", "session"],
    ui: {
      tab: "plugins",
      widget: "table",
      order: 100,
      label: "drive 임대 상한",
      help: "비어 있으면 상한이 없다(pi 방식). 값이 있으면 그룹이 요청한 상한과 비교해 작은 쪽을 쓴다.",
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
  readonly driveLimits?: DriveLimits;
  readonly activeDriveGroup?: ScopeId | null;
  readonly capabilityProviders?: Readonly<Record<string, ExtensionName>>;
}

/** 값이 정해진 설정 읽기. 값이 없으면 상한 없음, 구동 그룹 없음, 공급자 지정 없음이다 */
export function createStaticPrimitivesSettings(
  values: StaticPrimitivesSettings = {},
): PrimitivesSettingsSource {
  return {
    driveLimits: () => values.driveLimits ?? {},
    activeDriveGroup: (_threadId: ThreadId) => values.activeDriveGroup ?? null,
    capabilityProviders: () => values.capabilityProviders ?? {},
  };
}
