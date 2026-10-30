import { Type } from "typebox";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  defineSettings,
  resolveSetting,
  type ScopeStack,
  type SettingDef,
} from "@xeon/contracts/settings";

// L2.artifacts.spec §6. M3b가 읽는 키는 다섯 개다. autoTitle.*, retentionDays, reviews.autoRequest,
// reviews.fuzzLines, export.*, handoff.*는 읽는 코드가 없어 선언하지 않는다 [미결 §6].

const LOCAL_SCOPES = ["managed", "user", "project", "local"] as const;
const ALL_SCOPES = ["managed", "user", "project", "local", "session"] as const;

const artifactsSettings = defineSettings("l2.artifacts", {
  maxPerSession: {
    type: Type.Integer(),
    default: 500,
    range: { min: 1, max: 10000 },
    runtimeChange: "live",
    allowedScopes: LOCAL_SCOPES,
    ui: {
      tab: "sessions",
      widget: "number",
      order: 400,
      label: "세션당 산출물 최대 개수",
      unit: "개",
    },
    since: "0.1.0",
  },
  maxContentBytes: {
    type: Type.Integer(),
    default: 26214400,
    range: { min: 1024, max: 268435456 },
    runtimeChange: "live",
    allowedScopes: LOCAL_SCOPES,
    ui: {
      tab: "sessions",
      widget: "number",
      order: 410,
      label: "산출물 본문 최대 크기",
      unit: "B",
    },
    since: "0.1.0",
  },
  "reviews.deliverAs": {
    type: Type.String(),
    default: "followUp",
    range: { enum: ["steer", "followUp", "next"] },
    runtimeChange: "live",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "select", order: 320, label: "리뷰 결과 전달 방식" },
    since: "0.1.0",
  },
  "tools.reviewRequest": {
    type: Type.Boolean(),
    default: true,
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: {
      tab: "tools",
      widget: "toggle",
      order: 330,
      label: "리뷰 요청 도구 노출",
      help: "끄면 모델이 리뷰를 요청하는 도구를 쓸 수 없습니다",
    },
    since: "0.1.0",
  },
  "tools.sessionRename": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "nextTurn",
    allowedScopes: ALL_SCOPES,
    ui: { tab: "tools", widget: "toggle", order: 340, label: "세션 이름 바꾸기 도구 노출" },
    since: "0.1.0",
  },
});

/** 이 패키지가 선언하는 설정 정의. 조립 루트가 카탈로그에 넣는다 */
export const ARTIFACTS_SETTING_DEFS: readonly SettingDef[] = Object.values(artifactsSettings.defs);

type ArtifactsDeliverAs = "steer" | "followUp" | "next";

/** 호출 한 번이 읽는 유효 설정 */
export interface ArtifactsSettings {
  readonly maxPerSession: number;
  readonly maxContentBytes: number;
  readonly reviews: { readonly deliverAs: ArtifactsDeliverAs };
  readonly tools: { readonly reviewRequest: boolean; readonly sessionRename: boolean };
}

export const DEFAULT_ARTIFACTS_SETTINGS: ArtifactsSettings = {
  maxPerSession: 500,
  maxContentBytes: 26214400,
  reviews: { deliverAs: "followUp" },
  tools: { reviewRequest: true, sessionRename: false },
};

/** 설정 층을 돌려준다. 파일 범위와 세션 범위를 합친 스택이다. 호출마다 읽으므로 변경이 다음 호출부터 적용된다 */
export interface ArtifactsSettingsSource {
  layers(threadId?: ThreadId): ScopeStack;
}

function integerValue(def: SettingDef, layers: ScopeStack, fallback: number): number {
  const { value } = resolveSetting(def, layers).setting;
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function booleanValue(def: SettingDef, layers: ScopeStack, fallback: boolean): boolean {
  const { value } = resolveSetting(def, layers).setting;
  return typeof value === "boolean" ? value : fallback;
}

function deliverAsValue(def: SettingDef, layers: ScopeStack): ArtifactsDeliverAs {
  const { value } = resolveSetting(def, layers).setting;
  if (value === "steer" || value === "followUp" || value === "next") return value;
  return DEFAULT_ARTIFACTS_SETTINGS.reviews.deliverAs;
}

/** 유효 값을 읽는다. 형식이나 범위가 틀린 층은 `resolveSetting`이 건너뛰고, 값이 없으면 기본값이다 */
export function readArtifactsSettings(layers: ScopeStack): ArtifactsSettings {
  const defs = artifactsSettings.defs;
  const fallback = DEFAULT_ARTIFACTS_SETTINGS;
  return {
    maxPerSession: integerValue(defs.maxPerSession, layers, fallback.maxPerSession),
    maxContentBytes: integerValue(defs.maxContentBytes, layers, fallback.maxContentBytes),
    reviews: { deliverAs: deliverAsValue(defs["reviews.deliverAs"], layers) },
    tools: {
      reviewRequest: booleanValue(
        defs["tools.reviewRequest"],
        layers,
        fallback.tools.reviewRequest,
      ),
      sessionRename: booleanValue(
        defs["tools.sessionRename"],
        layers,
        fallback.tools.sessionRename,
      ),
    },
  };
}
