import { assertNever } from "@fresnel/contracts";
import { WireError } from "@fresnel/contracts/wire";
import { FAILURE_CODE_PREFIX, type FailureKind } from "@fresnel/contracts/services";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { BackupInvalidReason, ExportError, RestoreError } from "@fresnel/platform-store";
import { HostClientError } from "./host-client.ts";
import type { UsageError } from "./cli/command.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import type { EngineStartError, EngineStartErrorKind } from "./engine.ts";

// L4.cli.spec §4.10. 모든 오류 출력은 두 줄이다: `fresnel: <무엇이 잘못됐다>`와 `  해결: <한 줄>`.
// wire message(영어 개발자용)를 그대로 쓰지 않고 kind와 details로 만든다(F wire §3.5.1). 값은 싣지 않는다.
// 문장은 카탈로그 id를 호출할 때 `t()`로 만든다(ADR-0016). 로케일이 바뀐 뒤에도 현재 로케일로 나온다.

export interface Failure {
  readonly message: string;
  readonly fix: string;
  readonly code: ExitCode;
  /** 엔진 실패의 종류 코드. 시크릿 명령만 싣는다(`FailureScope`). 있으면 출력 끝에 `fresnel-code: <코드>` 줄을 더한다 */
  readonly kind?: FailureKind;
}

/** 실패에 종류 코드를 싣는 범위. 시크릿 명령만 `secret`이다. 다른 명령의 실패는 종류가 없어 출력이 그대로다 */
export type FailureScope = "secret" | "plain";

/** 엔진 실패를 범위에 맞춘다. 시크릿 범위에서 종류가 없는 엔진 실패는 `unknown`이다 */
function inScope(scope: FailureScope, failure: Failure): Failure {
  if (scope === "plain") return { message: failure.message, fix: failure.fix, code: failure.code };
  return { ...failure, kind: failure.kind ?? "unknown" };
}

export function renderFailure(failure: Pick<Failure, "message" | "fix" | "kind">): string {
  const text = `fresnel: ${failure.message}\n  ${t("cli.errors.fixLabel")} ${failure.fix}\n`;
  // 종류가 있으면 기계가 읽는 줄을 마지막에 한 줄 더한다. 값과 경로는 싣지 않는다(L4.cli.spec §4.7)
  return failure.kind === undefined ? text : `${text}${FAILURE_CODE_PREFIX}${failure.kind}\n`;
}

export function failureOfUsage(error: UsageError): Failure {
  return { message: error.message, fix: error.fix, code: EXIT.usage };
}

/** catalogConflict, missingService, pluginFailed는 설치본·확장 결함이라 환경을 고쳐도 풀리지 않는다(종료 코드 1) */
export function exitCodeOfStartError(kind: EngineStartErrorKind): ExitCode {
  switch (kind) {
    case "catalogConflict":
    case "missingService":
    case "pluginFailed":
      return EXIT.error;
    // 원격 주소 문법 오류는 사용 오류다. 명령줄 값을 고치면 풀린다(HS-87)
    case "invalidRemote":
      return EXIT.usage;
    case "fts5Missing":
    case "sopsMissing":
    case "dataDirPermission":
    case "dataDirUnwritable":
    case "storeBusy":
    case "storeUnavailable":
    case "storeFutureVersion":
    case "storeCorrupt":
    case "storeMigrationFailed":
    case "serviceUnreachable":
    case "protocolUnsupported":
      return EXIT.environment;
    default:
      return assertNever(kind, "EngineStartErrorKind");
  }
}

/** 엔진 시작 실패의 종류 코드(시크릿 범위에서만 싣는다). 어휘에 없는 원인은 `unknown`이다 */
function kindOfStart(kind: EngineStartErrorKind): FailureKind {
  switch (kind) {
    case "sopsMissing":
      return "sops_missing";
    case "storeBusy":
      return "store_busy";
    case "serviceUnreachable":
      return "service_unreachable";
    case "fts5Missing":
    case "dataDirPermission":
    case "dataDirUnwritable":
    case "storeUnavailable":
    case "storeFutureVersion":
    case "storeCorrupt":
    case "storeMigrationFailed":
    case "catalogConflict":
    case "missingService":
    case "pluginFailed":
    case "protocolUnsupported":
    case "invalidRemote":
      return "unknown";
    default:
      return assertNever(kind, "EngineStartErrorKind");
  }
}

export function failureOfStart(error: EngineStartError, scope: FailureScope = "plain"): Failure {
  return inScope(scope, {
    message: error.message,
    fix: error.fix,
    code: exitCodeOfStartError(error.kind),
    kind: kindOfStart(error.kind),
  });
}

function detailText(error: WireError, key: string): string | undefined {
  const value = error.data.details?.[key];
  return typeof value === "string" ? value : undefined;
}

function detailNumber(error: WireError, key: string): number | undefined {
  const value = error.data.details?.[key];
  return typeof value === "number" ? value : undefined;
}

/** 확장이 막을 수 있는 지점(`thread.cancelledByExtension`의 point)을 사람이 읽는 말로 바꾼다. 모르는 값은 그대로 보인다 */
const HOOK_LABEL_ID: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["thread.compact.before", "cli.errors.hook.compact"],
  ["thread.fork.before", "cli.errors.hook.fork"],
  ["thread.tree.before", "cli.errors.hook.tree"],
  ["thread.switch.before", "cli.errors.hook.switch"],
]);

function pointText(point: string | undefined): string {
  if (point === undefined) return t("cli.errors.hook.none");
  const id = HOOK_LABEL_ID.get(point);
  return id === undefined ? t("cli.errors.hook.other", { name: point }) : t(id);
}

function firstIssueText(error: WireError): string | undefined {
  const issues = error.data.details?.["issues"];
  if (!Array.isArray(issues)) return undefined;
  const first: unknown = issues[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return undefined;
  const text: unknown = first.message;
  return typeof text === "string" ? text : undefined;
}

function firstIssuePath(error: WireError): string | undefined {
  const issues = error.data.details?.["issues"];
  if (!Array.isArray(issues)) return undefined;
  const first: unknown = issues[0];
  if (typeof first !== "object" || first === null || !("path" in first)) return undefined;
  const path: unknown = first.path;
  return typeof path === "string" ? path : undefined;
}

function allowedScopesText(error: WireError): string {
  const scopes = error.data.details?.["allowedScopes"];
  if (!Array.isArray(scopes)) return t("cli.errors.allowedScopesUnknown");
  return scopes.filter((scope): scope is string => typeof scope === "string").join(", ");
}

/** F 오류 표의 시크릿 kind(`secret.*`, 3201~3212)를 아래 문구 표의 이름으로 옮긴다 */
const SECRET_WIRE_KINDS: Readonly<Record<string, string>> = {
  "secret.notFound": "secret_missing",
  "secret.denied": "denied",
  "secret.providerUnavailable": "provider_unavailable",
  "secret.keyUnavailable": "key_unavailable",
  "secret.decryptFailed": "decrypt_failed",
  "secret.inUse": "in_use",
  "secret.alreadyExists": "already_exists",
  "secret.readOnlyProvider": "read_only_provider",
  "secret.reauthRequired": "reauth_required",
  "secret.cancelled": "cancelled",
  "secret.auditUnwritable": "audit_unwritable",
  "secret.writeFailed": "write_failed",
};

/**
 * 시크릿 관리 오류. 전용 kind(`secret.*`)로 오고, 전용 kind가 생기기 전의 호스트는 `internal`의 details.secret에 실었다(HOST.3).
 * 두 길을 같은 문구 표로 모은다. 값은 없다
 */
function secretFailure(error: WireError): Failure | undefined {
  const wireKind = SECRET_WIRE_KINDS[error.data.kind];
  if (wireKind !== undefined) {
    const detail = (name: string): string | undefined => {
      const value = error.data.details?.[name];
      return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
    };
    return secretFailureOf(wireKind, detail);
  }
  const raw = error.data.details?.["secret"];
  if (typeof raw !== "object" || raw === null || !("kind" in raw)) return undefined;
  const kind: unknown = raw.kind;
  const field = (name: string): string | undefined => {
    const value: unknown = Reflect.get(raw, name);
    return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  };
  return typeof kind === "string" ? secretFailureOf(kind, field) : undefined;
}

/** sops 파일 준비 실패의 원인(code)별 해결 id. 모르는 원인은 기본 해결을 쓴다 */
const SOPS_FILE_FIX_ID: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["sops_encrypt_failed", "cli.errors.secret.sopsEncryptFailed.fix"],
  ["recipient_unknown", "cli.errors.secret.recipientUnknown.fix"],
  ["unsupported_format", "cli.errors.secret.unsupportedFormat.fix"],
  ["lock_timeout", "cli.errors.secret.lockTimeout.fix"],
]);

/** 쓰기 실패의 종류. sops 파일 잠금 경합만 `store_busy`이고, 나머지 sops 파일 문제는 제공자 문제다 */
function writeKindOf(target: string | undefined, code: string | undefined): FailureKind {
  if (target === "sops_file")
    return code === "lock_timeout" ? "store_busy" : "provider_unavailable";
  if (target === "key_store") return "key_store";
  if (target === "key_file") return "key_file";
  return "write_failed";
}

/** 첫 등록이 기본 SOPS 파일이나 age 키를 준비하다 실패했다. 문구와 종류를 함께 돌려준다. 경로와 값은 wire에 없다 */
function writeFailure(target: string | undefined, code: string | undefined): Failure {
  return { ...writeFailureText(target, code), kind: writeKindOf(target, code) };
}

/** 쓰기 실패의 문구. 원인(code)별로 고칠 곳을 말한다 */
function writeFailureText(target: string | undefined, code: string | undefined): Failure {
  if (target === "sops_file") {
    const fixId = code === undefined ? undefined : SOPS_FILE_FIX_ID.get(code);
    return {
      message:
        code === undefined
          ? t("cli.errors.secret.sopsFile.message")
          : t("cli.errors.secret.sopsFile.messageWithCode", { code }),
      fix: fixId === undefined ? t("cli.errors.secret.sopsFile.fix") : t(fixId),
      code: EXIT.environment,
    };
  }
  if (target === "key_store") {
    return {
      message:
        code === undefined
          ? t("cli.errors.secret.keyStore.message")
          : t("cli.errors.secret.keyStore.messageWithCode", { code }),
      fix: t("cli.errors.secret.keyStore.fix"),
      code: EXIT.environment,
    };
  }
  if (target === "key_file") {
    return {
      message:
        code === undefined
          ? t("cli.errors.secret.keyFile.message")
          : t("cli.errors.secret.keyFile.messageWithCode", { code }),
      fix: t("cli.errors.secret.keyFile.fix"),
      code: EXIT.environment,
    };
  }
  return {
    message: t("cli.errors.secret.writeFailed.message"),
    fix: t("cli.errors.common.checkDataDirAndDisk.fix"),
    code: EXIT.environment,
  };
}

/** 제공자를 쓸 수 없는 원인의 종류. 바이너리 없음과 버전 낮음은 따로 두고, 나머지(등록 없음 포함)는 제공자 문제다 */
function providerKindOf(reason: string | undefined): FailureKind {
  if (reason === "binary_missing") return "sops_missing";
  if (reason === "version_too_old") return "sops_version";
  return "provider_unavailable";
}

/**
 * 키 문제의 원인별 종류. 잠금·접근 거부·Secret Service 없음은 키 저장소 문제다. 항목이나 파일이 없으면 `key_missing`,
 * 파일 권한이면 `key_file`이다. 앱 파일 폴백의 사람 확인 없음(`fallback_unconfirmed`)은 호출하는 쪽이 따로 본다
 */
function keyKindOf(reason: string | undefined): FailureKind {
  if (reason === "item_missing") return "key_missing";
  if (reason === "file_mode") return "key_file";
  if (reason === "locked" || reason === "no_secret_service" || reason === "access_denied") {
    return "key_store";
  }
  return "unknown";
}

/**
 * OS 키 저장소를 쓸 수 없어 앱 파일로 떨어졌고 사람이 아직 확인하지 않았다. 아무것도 저장되지 않았다(L0.secrets.spec §4.7 (c)).
 * 시크릿 추가·설정·회전이 쓴다. 비대화 실행이나 확인을 거절한 경우 같은 문구다
 */
export function fallbackUnconfirmedFailure(code: ExitCode): Failure {
  return {
    message: t("cli.errors.secret.keyUnavailable.fallbackUnconfirmed.message"),
    fix: t("cli.errors.secret.keyUnavailable.fallbackUnconfirmed.fix"),
    code,
    kind: "key_fallback_unconfirmed",
  };
}

/** 쓰기 명령의 오류가 앱 파일 폴백의 사람 확인 없음인가(`secret.keyUnavailable`, `details.reason` `fallback_unconfirmed`) */
export function isFallbackUnconfirmed(caught: unknown): boolean {
  return (
    caught instanceof WireError &&
    caught.data.kind === "secret.keyUnavailable" &&
    detailText(caught, "reason") === "fallback_unconfirmed"
  );
}

function secretFailureOf(
  kind: string,
  field: (name: string) => string | undefined,
): Failure | undefined {
  switch (kind) {
    case "secret_missing":
      return {
        message: t("cli.errors.secret.missing.message"),
        fix: t("cli.errors.secret.missing.fix"),
        code: EXIT.error,
        kind: "not_found",
      };
    case "already_exists":
      return {
        message: t("cli.errors.secret.alreadyExists.message"),
        fix: t("cli.errors.secret.alreadyExists.fix"),
        code: EXIT.error,
        kind: "already_exists",
      };
    case "in_use":
      return {
        message: t("cli.errors.secret.inUse.message", { leases: field("activeLeases") ?? "?" }),
        fix: t("cli.errors.secret.inUse.fix"),
        code: EXIT.error,
        kind: "unknown",
      };
    case "provider_unavailable": {
      const reason = field("reason");
      const provider = field("provider") ?? "sops";
      const message =
        reason === undefined
          ? t("cli.errors.secret.providerUnavailable.message", { provider })
          : t("cli.errors.secret.providerUnavailable.messageWithReason", { provider, reason });
      if (reason === "not_registered") {
        // 값을 놓을 제공자가 정해지지 않았다. SOPS 파일이 없는 것은 원인이 아니다: 기본 파일은 첫 등록이 만든다
        return {
          message,
          fix: t("cli.errors.secret.providerUnavailable.notRegistered.fix"),
          code: EXIT.environment,
          kind: providerKindOf(reason),
        };
      }
      if (reason === "version_too_old") {
        return {
          message,
          fix: t("cli.errors.secret.providerUnavailable.versionTooOld.fix"),
          code: EXIT.environment,
          kind: providerKindOf(reason),
        };
      }
      return {
        message,
        fix: t("cli.errors.secret.providerUnavailable.fix"),
        code: EXIT.environment,
        kind: providerKindOf(reason),
      };
    }
    case "key_unavailable": {
      if (field("reason") === "fallback_unconfirmed") {
        // `auto`가 OS 키 저장소를 쓸 수 없어 앱 파일로 떨어졌고 사람이 아직 확인하지 않았다(L0.secrets.spec §4.7 (c))
        return fallbackUnconfirmedFailure(EXIT.environment);
      }
      if (field("reason") === "item_missing") {
        return {
          message: t("cli.errors.secret.keyUnavailable.itemMissing.message"),
          fix: t("cli.errors.secret.keyUnavailable.itemMissing.fix"),
          code: EXIT.environment,
          kind: keyKindOf(field("reason")),
        };
      }
      return {
        message: t("cli.errors.secret.keyUnavailable.message"),
        fix: t("cli.errors.secret.keyUnavailable.fix"),
        code: EXIT.environment,
        kind: keyKindOf(field("reason")),
      };
    }
    case "decrypt_failed":
      return {
        message: t("cli.errors.secret.decryptFailed.message"),
        fix: t("cli.errors.secret.decryptFailed.fix"),
        code: EXIT.error,
        kind: "decrypt_failed",
      };
    case "read_only_provider":
      return {
        message: t("cli.errors.secret.readOnlyProvider.message"),
        fix: t("cli.errors.secret.readOnlyProvider.fix"),
        code: EXIT.error,
        kind: "read_only_provider",
      };
    case "cancelled":
      return {
        message: t("cli.errors.secret.cancelled.message"),
        fix: t("cli.errors.common.runAgainIfNeeded.fix"),
        code: EXIT.error,
        kind: "cancelled",
      };
    case "denied":
    case "reauth_required":
      return {
        message: t("cli.errors.secret.deniedConfirmation.message"),
        fix: t("cli.errors.secret.deniedConfirmation.fix"),
        code: EXIT.error,
        kind: "unknown",
      };
    case "write_failed":
      return writeFailure(field("target"), field("code"));
    case "audit_unwritable":
      return {
        message: t("cli.errors.secret.writeFailed.message"),
        fix: t("cli.errors.common.checkDataDirAndDisk.fix"),
        code: EXIT.environment,
        kind: "write_failed",
      };
    // fresnel-disable-next-line fresnel/switch-default-never -- 시크릿 오류 kind는 서버가 더 새로우면 늘어난다. 일반 문구로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return undefined;
  }
}

/** 슬래시 명령 실패. 기능 오류 구간(코드 4000)의 kind `cap.dialog.commands.<code>`다(F wire §3.3.1 command.run) */
function commandFailure(error: WireError): Failure | undefined {
  const prefix = "cap.dialog.commands.";
  if (!error.data.kind.startsWith(prefix)) return undefined;
  switch (error.data.kind.slice(prefix.length)) {
    case "command_args_invalid": {
      const reason = detailText(error, "message");
      return {
        message:
          reason === undefined
            ? t("cli.errors.command.argsInvalid.message")
            : t("cli.errors.command.argsInvalid.messageWithReason", { reason }),
        fix: t("cli.errors.command.argsInvalid.fix"),
        code: EXIT.usage,
      };
    }
    case "command_shell_disabled":
      return {
        message: t("cli.errors.command.shellDisabled.message"),
        fix: t("cli.errors.command.shellDisabled.fix"),
        code: EXIT.error,
      };
    // fresnel-disable-next-line fresnel/switch-default-never -- 명령 오류 code는 기능이 더하면 늘어난다. 일반 문구로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return {
        message: t("cli.errors.command.commandFailed.message", { kind: error.data.kind }),
        fix: t("cli.errors.command.commandFailed.fix"),
        code: EXIT.error,
      };
  }
}

/**
 * 설정 파일이 JSON 객체가 아니어서 쓰지 않았다(`store.io`, details.code `settings_file_invalid`). 경로를 말하고, JSON 문법 오류면
 * 줄과 칸도 말한다. 파일을 고치기 전에는 쓰기가 막히므로 해결은 파일을 고치라는 것이다
 */
function settingsFileInvalidFailure(error: WireError): Failure {
  const path = detailText(error, "path") ?? t("cli.errors.common.unknownLocation");
  const line = detailNumber(error, "line");
  const column = detailNumber(error, "column");
  return {
    message:
      line === undefined || column === undefined
        ? t("cli.errors.wire.settingsFileInvalid.message", { path })
        : t("cli.errors.wire.settingsFileInvalid.messageWithLine", { path, line, column }),
    fix: t("cli.errors.wire.settingsFileInvalid.fix"),
    code: EXIT.environment,
  };
}

/** wire 오류를 §4.10 표의 문구와 종료 코드로 바꾼다. 종류 코드는 `scope`가 시크릿 명령일 때만 싣는다 */
export function failureOfWire(error: WireError, scope: FailureScope = "plain"): Failure {
  return inScope(scope, wireFailureOf(error));
}

function wireFailureOf(error: WireError): Failure {
  const kind = error.data.kind;
  switch (kind) {
    case "thread.notFound":
      return {
        message: t("cli.errors.wire.threadNotFound.message", {
          threadId: detailText(error, "threadId") ?? "",
        }),
        fix: t("cli.errors.wire.threadNotFound.fix"),
        code: EXIT.error,
      };
    case "thread.locked":
      return {
        message: t("cli.errors.wire.threadLocked.message", {
          ownerKind: detailText(error, "ownerKind") ?? t("cli.errors.common.unknown"),
        }),
        fix: t("cli.errors.wire.threadLocked.fix"),
        code: EXIT.lockDenied,
      };
    case "thread.hasForks":
      return {
        message: t("cli.errors.wire.threadHasForks.message"),
        fix: t("cli.errors.wire.threadHasForks.fix"),
        code: EXIT.error,
      };
    case "thread.invalidTarget": {
      const reason = detailText(error, "reason");
      return {
        message:
          reason === undefined
            ? t("cli.errors.wire.invalidTarget.message")
            : t("cli.errors.wire.invalidTarget.messageWithReason", { reason }),
        fix: t("cli.errors.wire.invalidTarget.fix"),
        code: EXIT.error,
      };
    }
    case "thread.closed":
      return {
        message: t("cli.errors.wire.threadClosed.message", {
          threadId: detailText(error, "threadId") ?? "",
        }),
        fix: t("cli.errors.wire.threadClosed.fix"),
        code: EXIT.error,
      };
    case "turn.busy":
      return {
        message: t("cli.errors.wire.turnBusy.message"),
        fix: t("cli.errors.wire.turnBusy.fix"),
        code: EXIT.error,
      };
    case "thread.cancelledByExtension": {
      const reason = detailText(error, "reason");
      const point = pointText(detailText(error, "point"));
      return {
        message:
          reason === undefined
            ? t("cli.errors.wire.cancelledByExtension.message", { point })
            : t("cli.errors.wire.cancelledByExtension.messageWithReason", { point, reason }),
        fix: t("cli.errors.wire.cancelledByExtension.fix"),
        code: EXIT.error,
      };
    }
    case "thread.compactFailed":
      return {
        message: t("cli.errors.wire.compactFailed.message", {
          reason: detailText(error, "reason") ?? t("cli.errors.common.unknownCause"),
        }),
        fix: t("cli.errors.wire.compactFailed.fix"),
        code: EXIT.error,
      };
    case "profile.notFound":
      return {
        message: t("cli.errors.wire.profileNotFound.message", {
          id: detailText(error, "id") ?? "",
        }),
        fix: t("cli.errors.wire.profileNotFound.fix"),
        code: EXIT.error,
      };
    case "profile.conflict":
      return {
        message: t("cli.errors.wire.profileConflict.message"),
        fix: t("cli.errors.wire.profileConflict.fix"),
        code: EXIT.error,
      };
    case "profile.pluginNotInProfile":
      return {
        message: t("cli.errors.wire.profilePluginNotInProfile.message", {
          plugin: detailText(error, "name") ?? "",
        }),
        fix: t("cli.errors.wire.profilePluginNotInProfile.fix"),
        code: EXIT.error,
      };
    case "profile.commonPlugin":
      return {
        message: t("cli.errors.wire.profileCommonPlugin.message", {
          plugin: detailText(error, "name") ?? "",
        }),
        fix: t("cli.errors.wire.profileCommonPlugin.fix"),
        code: EXIT.error,
      };
    case "overlay.notReviewed":
      return {
        message: t("cli.errors.wire.overlayNotReviewed.message", {
          plugin: detailText(error, "name") ?? "",
        }),
        fix: t("cli.errors.wire.overlayNotReviewed.fix"),
        code: EXIT.error,
      };
    case "overlay.notFound":
      return {
        message: t("cli.errors.wire.overlayNotFound.message", {
          plugin: detailText(error, "name") ?? "",
        }),
        fix: t("cli.errors.wire.overlayNotFound.fix"),
        code: EXIT.error,
      };
    case "overlay.noEntry":
      return {
        message: t("cli.errors.wire.overlayNoEntry.message", {
          name: detailText(error, "name") ?? "",
        }),
        fix: t("cli.errors.wire.overlayNoEntry.fix"),
        code: EXIT.error,
      };
    case "overlay.limit":
      return {
        message: t("cli.errors.wire.overlayLimit.message"),
        fix: t("cli.errors.wire.overlayLimit.fix"),
        code: EXIT.error,
      };
    case "request.cancelled":
      return {
        message: t("cli.errors.wire.requestCancelled.message"),
        fix: t("cli.errors.common.runAgainIfNeeded.fix"),
        code: EXIT.error,
      };
    case "settings.unknownKey":
      return {
        message: t("cli.errors.wire.settingsUnknownKey.message", {
          key: detailText(error, "key") ?? "",
        }),
        fix: t("cli.errors.wire.settingsUnknownKey.fix"),
        code: EXIT.usage,
      };
    case "settings.invalidValue": {
      const issue = firstIssueText(error);
      return {
        message:
          issue === undefined
            ? t("cli.errors.wire.settingsInvalidValue.message")
            : t("cli.errors.wire.settingsInvalidValue.messageWithIssue", { issue }),
        fix: t("cli.errors.wire.settingsInvalidValue.fix"),
        code: EXIT.usage,
      };
    }
    case "settings.scopeNotAllowed": {
      const reason = detailText(error, "reason");
      const key = detailText(error, "key") ?? t("cli.errors.common.thisKey");
      // 범위 자체는 허용인데 지금 쓸 수 없는 이유가 있으면 그 이유를 말한다("허용 범위: …"가 방금 쓴 범위를 포함해 모순이 되지 않게)
      if (
        reason === "workspaceRequired" ||
        reason === "untrustedProject" ||
        reason === "managedReadOnly"
      ) {
        return {
          message: t(`cli.errors.wire.settingsScopeNotAllowed.${reason}.message`, { key }),
          fix: t(`cli.errors.wire.settingsScopeNotAllowed.${reason}.fix`),
          code: EXIT.usage,
        };
      }
      return {
        message: t("cli.errors.wire.settingsScopeNotAllowed.message", {
          key: detailText(error, "key") ?? t("cli.errors.common.thisKey"),
        }),
        fix: t("cli.errors.wire.settingsScopeNotAllowed.fix", {
          scopes: allowedScopesText(error),
        }),
        code: EXIT.usage,
      };
    }
    case "settings.locked":
      return {
        message: t("cli.errors.wire.settingsLocked.message", {
          key: detailText(error, "key") ?? "",
        }),
        fix: t("cli.errors.wire.settingsLocked.fix"),
        code: EXIT.error,
      };
    case "settings.reserved":
      return {
        message: t("cli.errors.wire.settingsReserved.message", {
          key: detailText(error, "key") ?? "",
        }),
        fix: t("cli.errors.wire.settingsReserved.fix"),
        code: EXIT.usage,
      };
    case "settings.secretValue":
      return {
        message: t("cli.errors.wire.settingsSecretValue.message"),
        fix: t("cli.errors.wire.settingsSecretValue.fix"),
        code: EXIT.usage,
      };
    case "protocol.unsupported":
      return {
        message: t("cli.errors.protocolMismatch.message"),
        fix: t("cli.errors.protocolMismatch.fix"),
        code: EXIT.environment,
      };
    case "host.shuttingDown":
      return {
        message: t("cli.errors.wire.hostShuttingDown.message"),
        fix: t("cli.errors.common.runAgainShortly.fix"),
        code: EXIT.error,
      };
    case "store.busy":
      return {
        message: t("cli.errors.wire.storeBusy.message"),
        fix: t("cli.errors.common.runAgainShortly.fix"),
        code: EXIT.error,
        kind: "store_busy",
      };
    case "store.diskFull":
      return {
        message: t("cli.errors.common.storageFull.message"),
        fix: t("cli.errors.common.storageFull.fix"),
        code: EXIT.environment,
        kind: "write_failed",
      };
    case "store.readOnly":
      return {
        message: t("cli.errors.wire.storeReadOnly.message"),
        fix: t("cli.errors.wire.storeReadOnly.fix"),
        code: EXIT.error,
        kind: "write_failed",
      };
    case "store.corrupt":
      return {
        message: t("cli.errors.wire.storeCorrupt.message", {
          where: detailText(error, "where") ?? t("cli.errors.common.unknownLocation"),
        }),
        fix: t("cli.errors.wire.storeCorrupt.fix"),
        code: EXIT.error,
      };
    case "store.io":
      if (detailText(error, "code") === "trust_store") {
        return {
          message: t("cli.errors.wire.trustStoreFailed.message"),
          fix: t("cli.errors.wire.trustStoreFailed.fix"),
          code: EXIT.environment,
        };
      }
      if (detailText(error, "code") === "settings_file_invalid") {
        return settingsFileInvalidFailure(error);
      }
      return {
        message: t("cli.errors.wire.storeIoFailed.message"),
        fix: t("cli.errors.common.checkDataDirAndDisk.fix"),
        code: EXIT.environment,
      };
    case "jsonrpc.methodNotFound": {
      const method = detailText(error, "method");
      return {
        message:
          method === undefined
            ? t("cli.errors.wire.jsonrpcMethodNotFound.message")
            : t("cli.errors.wire.jsonrpcMethodNotFound.messageWithMethod", { method }),
        fix: t("cli.errors.wire.jsonrpcMethodNotFound.fix"),
        code: EXIT.error,
      };
    }
    case "jsonrpc.invalidParams": {
      const issue = firstIssueText(error);
      return {
        message:
          issue === undefined
            ? t("cli.errors.wire.invalidParams.message")
            : t("cli.errors.wire.invalidParams.messageWithIssue", { issue }),
        fix: t("cli.errors.wire.invalidParams.fix"),
        code: EXIT.usage,
        // 호스트는 짧은 값을 `value` 자리의 -32602로 거절한다(apps/host secrets/wire.ts). 시크릿 명령에서만 이 자리가 나온다
        kind: firstIssuePath(error) === "value" ? "value_too_short" : "unknown",
      };
    }
    case "internal": {
      const secret = secretFailure(error);
      if (secret !== undefined) return secret;
      const traceId = error.data.traceId;
      return {
        message:
          traceId === undefined
            ? t("cli.errors.internal.message")
            : t("cli.errors.internal.messageWithTrace", { traceId }),
        fix: t("cli.errors.internal.fix"),
        code: EXIT.error,
      };
    }
    // fresnel-disable-next-line fresnel/switch-default-never -- 서버가 더 새로우면 모르는 와이어 오류 kind가 온다. 일반 문구로 돌려준다 (eng.typescript.guide TY-14)
    default: {
      const secret = secretFailure(error);
      if (secret !== undefined) return secret;
      const command = commandFailure(error);
      if (command !== undefined) return command;
      return {
        message: t("cli.errors.wire.unknownKind.message", { kind }),
        fix: t("cli.errors.wire.unknownKind.fix"),
        code: EXIT.error,
      };
    }
  }
}

/**
 * `db export`의 내보내기 오류를 문구와 종료 코드로 바꾼다(L4.cli.spec §4.10, §4.13). 대상 폴더가 비어 있지 않은 것은
 * 사용자가 다른 폴더를 고르면 되므로 사용법 오류(2)다. 나머지는 저장소 파일이나 디스크의 환경 문제(3)다.
 * `error.code`(io)는 파일 시스템의 원래 코드(EACCES 등)이고 값은 싣지 않는다.
 */
export function failureOfExport(error: ExportError): Failure {
  switch (error.kind) {
    case "dest_not_empty":
      return {
        message: t("cli.errors.export.destNotEmpty.message"),
        fix: t("cli.errors.export.destNotEmpty.fix"),
        code: EXIT.usage,
      };
    case "foreign_database":
      return {
        message: t("cli.errors.export.foreignDatabase.message", {
          applicationId: error.applicationId,
        }),
        fix: t("cli.errors.export.foreignDatabase.fix"),
        code: EXIT.environment,
      };
    case "not_a_database":
      return {
        message: t("cli.errors.export.notDatabase.message"),
        fix: t("cli.errors.export.notDatabase.fix"),
        code: EXIT.environment,
      };
    case "busy":
      return {
        message: t("cli.errors.export.busy.message"),
        fix: t("cli.errors.common.runAgainShortly.fix"),
        code: EXIT.environment,
      };
    case "disk_full":
      return {
        message: t("cli.errors.common.storageFull.message"),
        fix: t("cli.errors.common.storageFull.fix"),
        code: EXIT.environment,
      };
    case "io":
      return {
        message: t("cli.errors.export.io.message", { code: error.code }),
        fix: t("cli.errors.export.io.fix"),
        code: EXIT.environment,
      };
    default:
      return assertNever(error, "ExportError");
  }
}

/** `db restore`의 되돌리기 오류를 문구와 종료 코드로 바꾼다. 값은 싣지 않는다 */
export function failureOfRestore(error: RestoreError): Failure {
  switch (error.kind) {
    case "backup_not_found":
      return {
        message: t("cli.errors.restore.notFound.message"),
        fix: t("cli.errors.restore.notFound.fix"),
        code: EXIT.usage,
      };
    case "backup_invalid":
      return {
        message: t(backupInvalidMessage(error.reason)),
        fix: t("cli.errors.restore.backupInvalid.fix"),
        code: EXIT.environment,
      };
    case "foreign_database":
      return {
        message: t("cli.errors.restore.foreign.message", { applicationId: error.applicationId }),
        fix: t("cli.errors.restore.foreign.fix"),
        code: EXIT.environment,
      };
    case "not_a_database":
      return {
        message: t("cli.errors.restore.notDatabase.message"),
        fix: t("cli.errors.restore.notDatabase.fix"),
        code: EXIT.environment,
      };
    case "future_version":
      return {
        message: t("cli.errors.restore.futureVersion.message", {
          backupVersion: error.backupVersion,
          codeVersion: error.codeVersion,
        }),
        fix: t("cli.errors.restore.futureVersion.fix"),
        code: EXIT.environment,
      };
    case "engine_running":
      return {
        message: t("cli.errors.restore.engineRunning.message"),
        fix: t("cli.errors.restore.engineRunning.fix"),
        code: EXIT.environment,
      };
    case "disk_full":
      return {
        message: t("cli.errors.common.storageFull.message"),
        fix: t("cli.errors.common.storageFull.fix"),
        code: EXIT.environment,
      };
    case "io":
      return {
        message: t("cli.errors.restore.io.message", { code: error.code }),
        fix: t("cli.errors.restore.io.fix"),
        code: EXIT.environment,
      };
    default:
      return assertNever(error, "RestoreError");
  }
}

function backupInvalidMessage(reason: BackupInvalidReason): MessageId {
  switch (reason) {
    case "manifest":
      return "cli.errors.restore.backupInvalid.manifest";
    case "format":
      return "cli.errors.restore.backupInvalid.format";
    case "integrity":
      return "cli.errors.restore.backupInvalid.integrity";
    case "schema":
      return "cli.errors.restore.backupInvalid.schema";
    case "blob_missing":
      return "cli.errors.restore.backupInvalid.blobMissing";
    case "blob_hash":
      return "cli.errors.restore.backupInvalid.blobHash";
    default:
      return assertNever(reason, "BackupInvalidReason");
  }
}

/** 명령 실행 중 잡은 값을 오류 문구로 바꾼다. 버그(그 밖의 예외)는 호출자가 다시 던진다: undefined를 돌려준다 */
export function failureOfCaught(
  caught: unknown,
  scope: FailureScope = "plain",
): Failure | undefined {
  if (caught instanceof WireError) return failureOfWire(caught, scope);
  if (caught instanceof HostClientError) {
    return inScope(scope, {
      message:
        caught.kind === "closed"
          ? t("cli.errors.connection.closed.message")
          : t("cli.errors.connection.request.message", { kind: caught.kind }),
      fix: t("cli.errors.connection.fix"),
      code: EXIT.error,
      kind: "service_unreachable",
    });
  }
  return undefined;
}
