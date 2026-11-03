import { attempt, err, ok, parse, type Result } from "@fresnel/contracts";
import {
  defineSettings,
  type SettingDefInput,
  type SettingGroup,
} from "@fresnel/contracts/settings";
import { Type } from "typebox";

// L3.learning.spec §6.1. 키 접두는 내장 그룹 규칙 `l3.learning.`이다. 켜기·끄기는 X 예약 키 `ext.learning.enabled`라 여기에 없다.

const USER_PROJECT: readonly ["user", "project"] = ["user", "project"];

export type LearningSettingDefs = {
  readonly "trigger.userTurns": SettingDefInput;
  readonly "trigger.toolIterations": SettingDefInput;
  readonly "review.maxIterations": SettingDefInput;
  readonly "review.tokenBudget": SettingDefInput;
  readonly "review.model": SettingDefInput;
  readonly "approval.required": SettingDefInput;
  readonly "scan.enabled": SettingDefInput;
  readonly "queue.expiryDays": SettingDefInput;
  readonly "curator.enabled": SettingDefInput;
  readonly "curator.intervalHours": SettingDefInput;
  readonly "curator.minIdleHours": SettingDefInput;
  readonly "curator.llmConsolidate": SettingDefInput;
};

export const learningSettings: SettingGroup<"l3.learning", LearningSettingDefs> = defineSettings(
  "l3.learning",
  {
    "trigger.userTurns": {
      type: Type.Integer({ minimum: 0, maximum: 1000 }),
      default: 10,
      runtimeChange: "nextTurn",
      allowedScopes: ["user", "project", "launch"],
      ui: {
        tab: "plugins",
        widget: "number",
        order: 300,
        label: "Learning review: user turn threshold",
        help: "Starts a background learning review once this many user turns accumulate. 0 means this reason never triggers a review.",
      },
      since: "0.1.0",
    },
    "trigger.toolIterations": {
      type: Type.Integer({ minimum: 0, maximum: 1000 }),
      default: 10,
      runtimeChange: "nextTurn",
      allowedScopes: ["user", "project", "launch"],
      ui: {
        tab: "plugins",
        widget: "number",
        order: 301,
        label: "Learning review: tool iteration threshold",
        help: "Starts a learning review once this many tool iterations accumulate without a skill write. 0 means this reason never triggers a review.",
      },
      since: "0.1.0",
    },
    "review.maxIterations": {
      type: Type.Integer({ minimum: 1, maximum: 64 }),
      default: 16,
      runtimeChange: "nextTurn",
      allowedScopes: USER_PROJECT,
      ui: {
        tab: "plugins",
        widget: "number",
        order: 302,
        label: "Learning review max steps",
        help: "Upper limit on steps the review fork can use.",
      },
      since: "0.1.0",
    },
    "review.tokenBudget": {
      type: Type.Union([Type.Integer({ minimum: 1000, maximum: 2_000_000 }), Type.Null()]),
      default: null,
      runtimeChange: "nextTurn",
      allowedScopes: USER_PROJECT,
      since: "0.1.0",
    },
    "review.model": {
      type: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
      default: null,
      runtimeChange: "nextTurn",
      allowedScopes: USER_PROJECT,
      ui: {
        tab: "plugins",
        widget: "text",
        order: 304,
        label: "Learning review model",
        help: "Leave empty to use the parent conversation's model. If it differs from the parent, do not expect prompt cache sharing.",
      },
      since: "0.1.0",
    },
    "approval.required": {
      type: Type.Boolean(),
      default: true,
      runtimeChange: "live",
      allowedScopes: USER_PROJECT,
      ui: {
        tab: "plugins",
        widget: "toggle",
        order: 305,
        label: "Require approval for learning candidates",
        help: "When off, non-destructive candidates (create, add_file, add) are applied right after passing the scan. Destructive operations (patch, archive, replace, remove) always require approval regardless of this value.",
      },
      since: "0.1.0",
    },
    "scan.enabled": {
      type: Type.Boolean(),
      default: true,
      runtimeChange: "live",
      allowedScopes: USER_PROJECT,
      ui: {
        tab: "plugins",
        widget: "toggle",
        order: 306,
        label: "Pre-scan learning candidates",
        help: "Runs a threat-pattern check on the knowledge store before a candidate is queued. The store check at apply time does not depend on this value.",
      },
      since: "0.1.0",
    },
    "queue.expiryDays": {
      type: Type.Integer({ minimum: 1, maximum: 365 }),
      default: 30,
      runtimeChange: "live",
      allowedScopes: ["user"],
      ui: {
        tab: "plugins",
        widget: "number",
        order: 307,
        label: "Learning candidate expiry period",
        help: "Candidates awaiting approval expire after this many days.",
        unit: "days",
      },
      since: "0.1.0",
    },
    "curator.enabled": {
      type: Type.Boolean(),
      default: false,
      runtimeChange: "restart",
      allowedScopes: ["user"],
      since: "0.1.0",
      stage: "reserved",
    },
    "curator.intervalHours": {
      type: Type.Integer({ minimum: 1, maximum: 8760 }),
      default: 168,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
      stage: "reserved",
    },
    "curator.minIdleHours": {
      type: Type.Integer({ minimum: 0, maximum: 720 }),
      default: 2,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
      stage: "reserved",
    },
    "curator.llmConsolidate": {
      type: Type.Boolean(),
      default: false,
      runtimeChange: "live",
      allowedScopes: ["user"],
      since: "0.1.0",
      stage: "reserved",
    },
  },
);

/** 1차 코드가 읽는 설정 값. 큐레이터 키(2차)는 읽지 않는다 */
export interface LearningSettings {
  readonly userTurns: number;
  readonly toolIterations: number;
  readonly maxIterations: number;
  readonly tokenBudget: number | null;
  readonly model: string | null;
  readonly approvalRequired: boolean;
  readonly scanEnabled: boolean;
  readonly expiryDays: number;
}

export type SettingsUnavailable = { readonly kind: "learning.settingsUnavailable" };

const SettingsViewSchema = Type.Object({
  "trigger.userTurns": Type.Integer({ minimum: 0, maximum: 1000 }),
  "trigger.toolIterations": Type.Integer({ minimum: 0, maximum: 1000 }),
  "review.maxIterations": Type.Integer({ minimum: 1, maximum: 64 }),
  "review.tokenBudget": Type.Union([Type.Integer({ minimum: 1000 }), Type.Null()]),
  "review.model": Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  "approval.required": Type.Boolean(),
  "scan.enabled": Type.Boolean(),
  "queue.expiryDays": Type.Integer({ minimum: 1, maximum: 365 }),
});

/**
 * 설정 값을 읽는다. 읽기가 던지거나 값이 스키마를 통과하지 못하면 fail-closed다(§4.1): 호출한 쪽은 검토도 적용도 하지 않는다.
 * `read`는 `GroupApi.settings()`다. 이 함수가 타입을 좁힌다(`GroupSettingValues`는 키별 타입을 싣지 않는다)
 */
export function readLearningSettings(
  read: () => Readonly<Record<string, unknown>>,
): Result<LearningSettings, SettingsUnavailable> {
  const raw = attempt(read);
  if (!raw.ok) return err({ kind: "learning.settingsUnavailable" });
  const parsed = parse(SettingsViewSchema, raw.value);
  if (!parsed.ok) return err({ kind: "learning.settingsUnavailable" });
  const view = parsed.value;
  return ok({
    userTurns: view["trigger.userTurns"],
    toolIterations: view["trigger.toolIterations"],
    maxIterations: view["review.maxIterations"],
    tokenBudget: view["review.tokenBudget"],
    model: view["review.model"],
    approvalRequired: view["approval.required"],
    scanEnabled: view["scan.enabled"],
    expiryDays: view["queue.expiryDays"],
  });
}
