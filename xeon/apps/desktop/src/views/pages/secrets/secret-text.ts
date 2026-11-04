import type { Locale, MessageArgs, MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { SecretApproval } from "@fresnel/contracts/capabilities";
import type { SecretAuditEntry, SecretListEntry } from "@fresnel/contracts/wire";
import type { RevealFailure } from "@fresnel/client/settings";
import type { SecretCommandError } from "../../commands.ts";
import type { MetaProblem } from "./secret-draft.ts";

// 시크릿 화면의 문장 조립. 값은 메시지 키와 인자로 바꾸고, 문장은 화면이 `t()`로 만든다.
// 시크릿 값과 값의 일부는 이 파일의 어느 함수에도 들어오지 않는다(입력은 목록, 오류, 상태 종류뿐이다).

/** 메시지 키와 인자. `t(id, args)`로 푼다 */
export interface MessageRef {
  readonly id: MessageId;
  readonly args: MessageArgs;
}

function message(id: MessageId, args: MessageArgs = {}): MessageRef {
  return { id, args };
}

/** 배지 색 계열. 문자와 함께 쓴다(색만으로 뜻을 주지 않는다) */
export type StatusTone = "success" | "warning" | "danger" | "neutral";

const STATUS_VIEW: Readonly<
  Record<SecretListEntry["status"], { readonly label: MessageRef; readonly tone: StatusTone }>
> = {
  valid: { label: message("desktop.secrets.status.valid"), tone: "success" },
  expiring: { label: message("desktop.secrets.status.expiring"), tone: "warning" },
  expired: { label: message("desktop.secrets.status.expired"), tone: "danger" },
  missing: { label: message("desktop.secrets.status.missing"), tone: "danger" },
  orphaned: { label: message("desktop.secrets.status.orphaned"), tone: "neutral" },
};

export function statusViewOf(status: SecretListEntry["status"]): {
  readonly label: MessageRef;
  readonly tone: StatusTone;
} {
  return STATUS_VIEW[status];
}

/** 연결이나 명령의 실패 문장 */
export function commandErrorText(error: SecretCommandError): MessageRef {
  switch (error.kind) {
    case "offline":
      return message("desktop.secrets.offline");
    case "unsupported":
      return message("desktop.secrets.unsupported");
    case "reauthRequired":
      return message("desktop.secrets.error.reauthRequired");
    case "notFound":
      return message("desktop.secrets.error.notFound");
    case "inUse":
      return message("desktop.secrets.error.inUse");
    case "failed":
      return message("desktop.secrets.error.failed");
    default:
      return assertNever(error, "SecretCommandError");
  }
}

/** 값 보기가 끝나지 않은 이유의 문장. 값은 들어 있지 않다 */
export function revealFailureText(failure: RevealFailure): MessageRef {
  switch (failure.kind) {
    case "reauth_denied":
      return message("desktop.secrets.reveal.reauthDenied");
    case "reauth_expired":
      return message("desktop.secrets.reveal.reauthExpired");
    case "unavailable":
      return message("desktop.secrets.reveal.unavailable");
    case "not_started":
      return message("desktop.secrets.reveal.notStarted");
    case "not_found":
      return message("desktop.secrets.error.notFound");
    case "failed":
      return message("desktop.secrets.error.failed");
    default:
      return assertNever(failure, "RevealFailure");
  }
}

const APPROVAL_ID: Readonly<Record<SecretApproval, MessageId>> = {
  none: "desktop.secrets.approval.none",
  "per-session": "desktop.secrets.approval.perSession",
  "per-use": "desktop.secrets.approval.perUse",
};

export function approvalIdOf(approval: SecretApproval): MessageId {
  return APPROVAL_ID[approval];
}

const PROBLEM_ID: Readonly<Record<MetaProblem, MessageId>> = {
  desc: "desktop.secrets.metaProblem.desc",
  hosts: "desktop.secrets.metaProblem.hosts",
  expiresAt: "desktop.secrets.metaProblem.expiresAt",
  ttlSeconds: "desktop.secrets.metaProblem.ttlSeconds",
  maxUses: "desktop.secrets.metaProblem.maxUses",
};

export function metaProblemIdOf(problem: MetaProblem): MessageId {
  return PROBLEM_ID[problem];
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 마지막 사용 시각을 "2분 전", "어제"처럼 쓴다. 지금 시각은 호출자가 준다(시험이 고정한다) */
function relativeTextOf(epochMs: number, nowMs: number, locale: Locale): string {
  const diff = epochMs - nowMs;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < MINUTE_MS) return format.format(Math.round(diff / SECOND_MS), "second");
  if (abs < HOUR_MS) return format.format(Math.round(diff / MINUTE_MS), "minute");
  if (abs < DAY_MS) return format.format(Math.round(diff / HOUR_MS), "hour");
  return format.format(Math.round(diff / DAY_MS), "day");
}

/** 마지막 사용 문장. 기록이 없거나 시각을 읽지 못하면 `null`이다(화면이 "없음"으로 그린다) */
export function lastUsedTextOf(
  iso: string | undefined,
  nowMs: number,
  locale: Locale,
): string | null {
  if (iso === undefined) return null;
  const epoch = Date.parse(iso);
  return Number.isNaN(epoch) ? null : relativeTextOf(epoch, nowMs, locale);
}

const AUDIT_MODE_ID: Readonly<Record<SecretAuditEntry["mode"], MessageId>> = {
  env: "desktop.secrets.audit.mode.env",
  sentinel: "desktop.secrets.audit.mode.sentinel",
  "runtime-http": "desktop.secrets.audit.mode.runtimeHttp",
  "browser-input": "desktop.secrets.audit.mode.browserInput",
};

/** 사용 기록의 "어떤 모습으로 썼나" 문장 키 */
export function auditModeIdOf(mode: SecretAuditEntry["mode"]): MessageId {
  return AUDIT_MODE_ID[mode];
}

const AUDIT_REASON_ID: Readonly<Record<NonNullable<SecretAuditEntry["reason"]>, MessageId>> = {
  host_mismatch: "desktop.secrets.audit.reason.hostMismatch",
  origin_mismatch: "desktop.secrets.audit.reason.originMismatch",
  command_mismatch: "desktop.secrets.audit.reason.commandMismatch",
  approval_missing: "desktop.secrets.audit.reason.approvalMissing",
  expired: "desktop.secrets.audit.reason.expired",
  lease_expired: "desktop.secrets.audit.reason.leaseExpired",
  lease_exhausted: "desktop.secrets.audit.reason.leaseExhausted",
  mode_not_allowed: "desktop.secrets.audit.reason.modeNotAllowed",
  tool_not_allowed: "desktop.secrets.audit.reason.toolNotAllowed",
  scope_mismatch: "desktop.secrets.audit.reason.scopeMismatch",
};

/** 거절 사유 문장 키 */
export function auditReasonIdOf(reason: NonNullable<SecretAuditEntry["reason"]>): MessageId {
  return AUDIT_REASON_ID[reason];
}
