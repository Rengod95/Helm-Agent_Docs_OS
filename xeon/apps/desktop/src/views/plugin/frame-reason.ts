// 프레임이 닫힌 이유를 사람 말로. 한 줄은 자리 표시에 보이고, 자세한 풀이는 정보 아이콘 뒤다(DP-58).
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { LedgerFailure } from "@fresnel/client/views/ledger";

export interface FrameReasonText {
  /** 자리 표시의 한 줄 */
  readonly line: string;
  /** 정보 아이콘 뒤 풀이. 이유를 모르면 없다 */
  readonly info: string | null;
}

const NO_REASON: FrameReasonText = { line: t("desktop.plugin.frame.disabled"), info: null };

/** 닫힌 이유(장부 실패 이름)의 문장. 이유가 없으면(처음 상태) 기본 문장이다 */
export function frameReasonText(reason: LedgerFailure | null): FrameReasonText {
  switch (reason) {
    case null:
      return NO_REASON;
    case "query_failed":
      return {
        line: t("desktop.plugin.frame.reason.queryFailed"),
        info: t("desktop.plugin.frame.reason.queryFailedInfo"),
      };
    case "result_invalid":
      return {
        line: t("desktop.plugin.frame.reason.resultInvalid"),
        info: t("desktop.plugin.frame.reason.resultInvalidInfo"),
      };
    case "render_exception":
      return {
        line: t("desktop.plugin.frame.reason.renderException"),
        info: t("desktop.plugin.frame.reason.renderExceptionInfo"),
      };
    case "ready_timeout":
      return {
        line: t("desktop.plugin.frame.reason.readyTimeout"),
        info: t("desktop.plugin.frame.reason.readyTimeoutInfo"),
      };
    case "bridge_format":
      return {
        line: t("desktop.plugin.frame.reason.bridgeFormat"),
        info: t("desktop.plugin.frame.reason.bridgeFormatInfo"),
      };
    case "limit_exceeded":
      return {
        line: t("desktop.plugin.frame.reason.limitExceeded"),
        info: t("desktop.plugin.frame.reason.limitExceededInfo"),
      };
    case "liveness_lost":
      return {
        line: t("desktop.plugin.frame.reason.livenessLost"),
        info: t("desktop.plugin.frame.reason.livenessLostInfo"),
      };
    case "frame_navigated":
      return {
        line: t("desktop.plugin.frame.reason.frameNavigated"),
        info: t("desktop.plugin.frame.reason.frameNavigatedInfo"),
      };
    case "confirm_denied":
      return {
        line: t("desktop.plugin.frame.reason.confirmDenied"),
        info: t("desktop.plugin.frame.reason.confirmDeniedInfo"),
      };
    case "confirm_timeout":
      return {
        line: t("desktop.plugin.frame.reason.confirmTimeout"),
        info: t("desktop.plugin.frame.reason.confirmTimeoutInfo"),
      };
    default:
      return assertNever(reason, "LedgerFailure");
  }
}
