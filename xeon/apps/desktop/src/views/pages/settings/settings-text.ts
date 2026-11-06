import type { MessageId } from "@fresnel/client/i18n";
import type { ViewDiagnostic } from "@fresnel/client/settings";

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

/** 화면 진단 한 줄의 표식 종류. 아이콘과 글 색이 함께 간다(§4.8.1) */
export type DiagnosticTone = "danger" | "warning" | "info";

// 값 모양이 맞지 않아 읽기 전용인 것은 위험(목업 `overview-tab.tsx`의 danger 줄), 값이 없거나 겹친 것은 경고, 위젯·탭을 모르는 것은 안내다
const DIAGNOSTIC_TONE: Readonly<Record<ViewDiagnostic["code"], DiagnosticTone>> = {
  widgetMismatch: "danger",
  unknownWidget: "info",
  unknownTab: "info",
  missingValue: "warning",
  duplicateKey: "warning",
};

/** 화면 진단 한 줄의 표식 종류. 종류마다 하나다 */
export function diagnosticToneOf(code: ViewDiagnostic["code"]): DiagnosticTone {
  return DIAGNOSTIC_TONE[code];
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
