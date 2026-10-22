import type { DriveLimits } from "@xeon/contracts/extensions";
import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";
import { Type } from "typebox";

/** Helm drive 임대의 기본 상한(L3.helm.spec §6, review.decisions-2 U-12) */
export const DEFAULT_HELM_DRIVE_LIMITS: Required<DriveLimits> = {
  maxTurns: 4,
  maxSpawns: 8,
  maxTokens: 400_000,
};

/**
 * l3.helm.* 설정 키(L3.helm.spec §6). 지금은 drive 상한 하나만 선언한다.
 * 이 값은 `DriveOptions.limits`로 넘어가 X 일반 기본값 `x.primitives.driveDefaultLimits`를 Helm에 한해 덮어쓰고,
 * 천장 `x.primitives.driveLimits`로 다시 잘린다. 일반 대화 턴에는 상한이 없다.
 */
export const helmSettings: SettingGroup<"l3.helm", { readonly driveLimits: SettingDefInput }> =
  defineSettings("l3.helm", {
    driveLimits: {
      type: Type.Object(
        {
          maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
          maxSpawns: Type.Optional(Type.Integer({ minimum: 1 })),
          maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
        },
        { additionalProperties: false },
      ),
      default: DEFAULT_HELM_DRIVE_LIMITS,
      runtimeChange: "nextTurn",
      allowedScopes: ["managed", "user", "project", "local", "session"],
      ui: {
        tab: "plugins",
        widget: "table",
        order: 210,
        label: "Helm drive 상한",
        help: "Helm 탐구가 쓰는 턴, 하위 에이전트, 토큰 상한. x.primitives.driveDefaultLimits를 Helm에 한해 덮어쓰고 천장 x.primitives.driveLimits를 넘지 못한다.",
      },
      since: "0.1.0",
    },
  });
