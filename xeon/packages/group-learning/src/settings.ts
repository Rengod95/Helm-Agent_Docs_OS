import { attempt, err, ok, parse, type Result } from "@xeon/contracts";
import { defineSettings, type SettingDefInput, type SettingGroup } from "@xeon/contracts/settings";
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
      allowedScopes: ["user", "project", "session"],
      ui: {
        tab: "plugins",
        widget: "number",
        order: 300,
        label: "학습 검토: 사용자 turn 임계",
        help: "사용자 turn이 이 수만큼 쌓이면 백그라운드 학습 검토를 시작한다. 0이면 이 사유로는 검토하지 않는다.",
      },
      since: "0.1.0",
    },
    "trigger.toolIterations": {
      type: Type.Integer({ minimum: 0, maximum: 1000 }),
      default: 10,
      runtimeChange: "nextTurn",
      allowedScopes: ["user", "project", "session"],
      ui: {
        tab: "plugins",
        widget: "number",
        order: 301,
        label: "학습 검토: 도구 반복 임계",
        help: "스킬 쓰기 없이 도구 반복이 이 수만큼 쌓이면 학습 검토를 시작한다. 0이면 이 사유로는 검토하지 않는다.",
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
        label: "학습 검토 최대 step",
        help: "검토 포크가 쓸 수 있는 step 수 상한.",
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
        label: "학습 검토 모델",
        help: "비우면 부모 대화의 모델을 쓴다. 부모와 다르면 프롬프트 캐시 공유를 기대하지 않는다.",
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
        label: "학습 후보 승인 필수",
        help: "끄면 파괴적이지 않은 후보(create, add_file, add)는 스캔을 통과한 뒤 바로 적용된다. 파괴적 연산(patch, archive, replace, remove)은 이 값과 무관하게 승인이 필요하다.",
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
        label: "학습 후보 사전 스캔",
        help: "후보를 대기열에 올리기 전에 지식 저장소의 위협 패턴 검사를 돌린다. 적용 때의 저장소 검사는 이 값과 무관하다.",
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
        label: "학습 후보 만료 일수",
        help: "승인 대기 후보가 이 일수 뒤에 만료된다.",
        unit: "일",
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
