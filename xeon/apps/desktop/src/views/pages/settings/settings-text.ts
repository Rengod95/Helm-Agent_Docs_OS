import type { MessageId } from "@fresnel/client/i18n";
import type { BadgeScope, ViewDiagnostic } from "@fresnel/client/settings";
import type { RuntimeChange } from "@fresnel/contracts/settings";

// 설정 화면(P-09)의 문장 고르기. 문장은 메시지 키로 들고 있다가 그릴 때 `t()`로 만든다(모듈을 읽을 때의 로케일에 묶이지 않도록).
// 범위와 적용 시점의 글자는 client가 `FieldVM`에 이미 담아 준다. 여기서는 화면이 더하는 문장과 배지 색만 고른다.

const DIAGNOSTIC_ID: Readonly<Record<ViewDiagnostic["code"], MessageId>> = {
  widgetMismatch: "desktop.settings.diagnostic.widgetMismatch",
  unknownWidget: "desktop.settings.diagnostic.unknownWidget",
  unknownTab: "desktop.settings.diagnostic.unknownTab",
  missingValue: "desktop.settings.diagnostic.missingValue",
  duplicateKey: "desktop.settings.diagnostic.duplicateKey",
};

/** 화면 진단 한 줄의 문장 키. 종류마다 하나다 */
export function diagnosticIdOf(code: ViewDiagnostic["code"]): MessageId {
  return DIAGNOSTIC_ID[code];
}

/** 배지 색 한 쌍(바탕, 글자)의 caustic 토큰. 색은 글자와 함께 쓴다(§4.8.1). `Badge`의 `tone` prop은 쓰지 않는다(폐기 표시) */
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "info" | "agent";

export const TONE_CLASS: Readonly<Record<BadgeTone, string>> = {
  neutral: "bg-neutral-soft text-neutral-text",
  accent: "bg-accent-soft text-accent-text",
  success: "bg-success-soft text-success-text",
  warning: "bg-warning-soft text-warning-text",
  info: "bg-info-soft text-info-text",
  agent: "bg-agent-soft text-agent-text",
};

/** 범위 배지의 색 계열 */
export const SCOPE_TONE: Readonly<Record<BadgeScope, BadgeTone>> = {
  managed: "warning",
  user: "accent",
  project: "info",
  local: "neutral",
  launch: "agent",
  default: "neutral",
};

/** 적용 시점 배지의 색 계열. 즉시는 성공, 다음 턴은 정보, 재시작은 경고다 */
export const RUNTIME_TONE: Readonly<Record<RuntimeChange, BadgeTone>> = {
  live: "success",
  nextTurn: "info",
  restart: "warning",
};
