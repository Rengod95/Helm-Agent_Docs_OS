import { Type } from "typebox";
import { defineSettings, type SettingDef } from "@xeon/contracts/settings";

// L0.process.spec §6. 모두 layer L0, since 0.1.0, L4 탭은 execution이다.
// 자동 재개 키(l1.persistence.autoResume 등)는 여기에 두지 않는다(review.decisions-2 S-03).
// startupGraceMs(10000)는 설정으로 열지 않는다.

/** 기본값은 이 상수 한 곳에만 둔다(BP-06). 선언의 default와 서비스 설정 기본값이 같은 값을 쓴다 */
export const PROCESS_SHUTDOWN_TIMEOUT_DEFAULT_MS = 3000;

const group = defineSettings("l0.process", {
  "service.enabled": {
    type: Type.Boolean(),
    default: false,
    runtimeChange: "restart",
    allowedScopes: ["managed", "user"],
    ui: { tab: "execution", widget: "toggle", order: 10, label: "공유 서비스 모드" },
    since: "0.1.0",
  },
  "service.idleGraceMs": {
    type: Type.Integer(),
    default: 60_000,
    range: { min: 1000, max: 86_400_000 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: {
      tab: "execution",
      widget: "number",
      order: 20,
      label: "서비스 유휴 종료 유예",
      unit: "ms",
    },
    since: "0.1.0",
  },
  "service.startTimeoutMs": {
    type: Type.Integer(),
    default: 10_000,
    range: { min: 1000, max: 120_000 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    since: "0.1.0",
  },
  "shutdown.timeoutMs": {
    type: Type.Integer(),
    default: PROCESS_SHUTDOWN_TIMEOUT_DEFAULT_MS,
    range: { min: 500, max: 60_000 },
    runtimeChange: "live",
    allowedScopes: ["managed", "user"],
    ui: { tab: "execution", widget: "number", order: 30, label: "종료 협조 시한", unit: "ms" },
    since: "0.1.0",
  },
  "lockFallback.default": {
    type: Type.String(),
    default: "ask",
    range: { enum: ["ask", "observe", "fork"] },
    runtimeChange: "live",
    allowedScopes: ["managed", "user", "project"],
    ui: { tab: "execution", widget: "select", order: 40, label: "세션 잠금 실패 때 기본 동작" },
    since: "0.1.0",
  },
});

/** `l0.process.*` 선언 전체. 카탈로그 조립(buildCatalog)이 쓴다 */
export const PROCESS_SETTING_DEFS: readonly SettingDef[] = Object.values(group.defs);

/** 서비스가 읽는 설정 값. 값은 설정 서비스가 스키마로 검증해 넘긴다 */
export interface ProcessServiceSettings {
  /** l0.process.shutdown.timeoutMs */
  readonly shutdownTimeoutMs: number;
}

export const PROCESS_SERVICE_SETTINGS_DEFAULTS: ProcessServiceSettings = {
  shutdownTimeoutMs: PROCESS_SHUTDOWN_TIMEOUT_DEFAULT_MS,
};
