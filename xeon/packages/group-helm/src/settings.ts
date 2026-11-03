import type { DriveLimits } from "@fresnel/contracts/extensions";
import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";
import {
  Type,
  type Static,
  type TBoolean,
  type TInteger,
  type TObject,
  type TString,
} from "typebox";

/** Helm drive 임대의 기본 상한(L3.helm.spec §6, review.decisions-2 U-12) */
export const DEFAULT_HELM_DRIVE_LIMITS: Required<DriveLimits> = {
  maxTurns: 4,
  maxSpawns: 8,
  maxTokens: 400_000,
};

/** 신호가 났을 때의 자동 시작 방식(L3.helm.spec §4.3 autoStart 표) */
const AUTO_START_VALUES: readonly ["off", "suggest", "auto"] = ["off", "suggest", "auto"];
export type AutoStart = (typeof AUTO_START_VALUES)[number];

function isAutoStart(value: unknown): value is AutoStart {
  return AUTO_START_VALUES.some((known) => known === value);
}

/** 한 탐구가 쓰는 렌즈 수의 설정 범위. 내장 렌즈 6개보다 크게 둔다(상태 `lenses` 상한 8개) */
const MAX_LENSES_RANGE: { readonly min: 1; readonly max: 8 } = { min: 1, max: 8 };

const ALL_SCOPES = ["managed", "user", "project", "local", "launch"] as const;

const DRIVE_LIMITS_TYPE: TObject<{
  maxTurns: ReturnType<typeof Type.Optional<TInteger>>;
  maxSpawns: ReturnType<typeof Type.Optional<TInteger>>;
  maxTokens: ReturnType<typeof Type.Optional<TInteger>>;
}> = Type.Object(
  {
    maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
    maxSpawns: Type.Optional(Type.Integer({ minimum: 1 })),
    maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

/**
 * ext.helm.* 설정 키 네 개(L3.helm.spec §6, M3-04). `driveLimits`는 `DriveOptions.limits`로 넘어가
 * X 일반 기본값 `x.primitives.driveDefaultLimits`를 Helm에 한해 덮어쓰고, 천장 `x.primitives.driveLimits`로 다시 잘린다.
 * 일반 대화 턴에는 상한이 없다.
 */
export const helmSettings: SettingGroup<
  "ext.helm",
  {
    readonly autoStart: SettingDefInput<TString>;
    readonly driveLimits: SettingDefInput<typeof DRIVE_LIMITS_TYPE>;
    readonly maxLenses: SettingDefInput<TInteger>;
    readonly writeGuard: SettingDefInput<TBoolean>;
  }
> = defineSettings("ext.helm", {
  autoStart: {
    type: Type.String({ maxLength: 16 }),
    default: "suggest",
    range: { enum: [...AUTO_START_VALUES] },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "plugins",
      widget: "select",
      order: 200,
      label: "Helm auto start",
      help: "When an inquiry signal fires: off only records it, suggest posts a proposal message, auto requests the inquiry right away",
    },
    since: "0.1.0",
  },
  driveLimits: {
    type: DRIVE_LIMITS_TYPE,
    default: DEFAULT_HELM_DRIVE_LIMITS,
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "plugins",
      widget: "table",
      order: 210,
      label: "Helm drive limits",
      help: "Turn, sub-agent, and token limits used by a Helm inquiry. Overrides x.primitives.driveDefaultLimits for Helm only, and cannot exceed the ceiling x.primitives.driveLimits.",
    },
    since: "0.1.0",
  },
  maxLenses: {
    type: Type.Integer(),
    default: 3,
    range: { ...MAX_LENSES_RANGE },
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "plugins",
      widget: "number",
      order: 220,
      label: "Helm lens count",
      help: "Number of exploration perspectives one inquiry runs in parallel. If it exceeds the remaining spawn budget, only the first lenses run",
      unit: "items",
    },
    since: "0.1.0",
  },
  writeGuard: {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "plugins",
      widget: "toggle",
      order: 230,
      label: "Helm write blocking",
      help: "Blocks write tool calls before execution in the divergent and exploration phases",
    },
    since: "0.1.0",
  },
});

export interface HelmSettings {
  readonly autoStart: AutoStart;
  readonly driveLimits: DriveLimits;
  readonly maxLenses: number;
  readonly writeGuard: boolean;
}

export const DEFAULT_HELM_SETTINGS: HelmSettings = {
  autoStart: "suggest",
  driveLimits: DEFAULT_HELM_DRIVE_LIMITS,
  maxLenses: 3,
  writeGuard: true,
};

export type HelmSettingValues = {
  readonly [K in keyof typeof helmSettings.defs]: Static<(typeof helmSettings.defs)[K]["type"]>;
};

/**
 * group-sdk `g.settings()`가 돌려준 값(또는 설정 읽기 포트가 없을 때의 빈 값)을 `HelmSettings`로 옮긴다.
 * 빠졌거나 모양이 맞지 않는 키는 기본값을 쓴다. 순수 함수
 */
export function helmSettingsOf(values: Readonly<Partial<HelmSettingValues>>): HelmSettings {
  const { autoStart, driveLimits, maxLenses, writeGuard } = values;
  const lenses = maxLenses;
  return {
    autoStart: isAutoStart(autoStart) ? autoStart : DEFAULT_HELM_SETTINGS.autoStart,
    driveLimits: driveLimits ?? DEFAULT_HELM_SETTINGS.driveLimits,
    maxLenses:
      lenses !== undefined && lenses >= MAX_LENSES_RANGE.min && lenses <= MAX_LENSES_RANGE.max
        ? lenses
        : DEFAULT_HELM_SETTINGS.maxLenses,
    writeGuard: writeGuard ?? DEFAULT_HELM_SETTINGS.writeGuard,
  };
}
