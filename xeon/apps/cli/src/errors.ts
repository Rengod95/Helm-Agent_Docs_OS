import { assertNever } from "@xeon/contracts";
import { WireError } from "@xeon/contracts/wire";
import { t, type MessageId } from "@xeon/client/i18n";
import type { ExportError } from "@xeon/platform-store";
import { HostClientError } from "./host-client.ts";
import type { UsageError } from "./cli/command.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import type { EngineStartError, EngineStartErrorKind } from "./engine.ts";

// L4.cli.spec §4.10. 모든 오류 출력은 두 줄이다: `xeon: <무엇이 잘못됐다>`와 `  해결: <한 줄>`.
// wire message(영어 개발자용)를 그대로 쓰지 않고 kind와 details로 만든다(F wire §3.5.1). 값은 싣지 않는다.
// 문장은 카탈로그 id를 호출할 때 `t()`로 만든다(ADR-0016). 로케일이 바뀐 뒤에도 현재 로케일로 나온다.

export interface Failure {
  readonly message: string;
  readonly fix: string;
  readonly code: ExitCode;
}

export function renderFailure(failure: Pick<Failure, "message" | "fix">): string {
  return `xeon: ${failure.message}\n  ${t("cli.errors.fixLabel")} ${failure.fix}\n`;
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
    case "storeUnavailable":
    case "serviceUnreachable":
    case "protocolUnsupported":
      return EXIT.environment;
    default:
      return assertNever(kind, "EngineStartErrorKind");
  }
}

export function failureOfStart(error: EngineStartError): Failure {
  return { message: error.message, fix: error.fix, code: exitCodeOfStartError(error.kind) };
}

function detailText(error: WireError, key: string): string | undefined {
  const value = error.data.details?.[key];
  return typeof value === "string" ? value : undefined;
}

/** 확장이 막을 수 있는 지점(`thread.cancelledByExtension`의 point)을 사람이 읽는 말로 바꾼다. 모르는 값은 그대로 보인다 */
const POINT_LABEL_ID: ReadonlyMap<string, MessageId> = new Map<string, MessageId>([
  ["session.compact.before", "cli.errors.point.compact"],
  ["session.fork.before", "cli.errors.point.fork"],
  ["session.tree.before", "cli.errors.point.tree"],
  ["session.switch.before", "cli.errors.point.switch"],
]);

function pointText(point: string | undefined): string {
  if (point === undefined) return t("cli.errors.point.none");
  const id = POINT_LABEL_ID.get(point);
  return id === undefined ? t("cli.errors.point.other", { name: point }) : t(id);
}

function firstIssueText(error: WireError): string | undefined {
  const issues = error.data.details?.["issues"];
  if (!Array.isArray(issues)) return undefined;
  const first: unknown = issues[0];
  if (typeof first !== "object" || first === null || !("message" in first)) return undefined;
  const text: unknown = first.message;
  return typeof text === "string" ? text : undefined;
}

function allowedScopesText(error: WireError): string {
  const scopes = error.data.details?.["allowedScopes"];
  if (!Array.isArray(scopes)) return t("cli.errors.allowedScopesUnknown");
  return scopes.filter((scope): scope is string => typeof scope === "string").join(", ");
}

/** F 오류 표의 비밀 kind(`secret.*`, 3201~3212)를 아래 문구 표의 이름으로 옮긴다 */
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
 * 비밀 관리 오류. 전용 kind(`secret.*`)로 오고, 전용 kind가 생기기 전의 호스트는 `internal`의 details.secret에 실었다(HOST.3).
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

/** 첫 등록이 기본 SOPS 파일이나 age 키를 준비하다 실패했다. 원인(code)별로 고칠 곳을 말한다. 경로와 값은 wire에 없다 */
function writeFailure(target: string | undefined, code: string | undefined): Failure {
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
      };
    case "already_exists":
      return {
        message: t("cli.errors.secret.alreadyExists.message"),
        fix: t("cli.errors.secret.alreadyExists.fix"),
        code: EXIT.error,
      };
    case "in_use":
      return {
        message: t("cli.errors.secret.inUse.message", { leases: field("activeLeases") ?? "?" }),
        fix: t("cli.errors.secret.inUse.fix"),
        code: EXIT.error,
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
        };
      }
      if (reason === "version_too_old") {
        return {
          message,
          fix: t("cli.errors.secret.providerUnavailable.versionTooOld.fix"),
          code: EXIT.environment,
        };
      }
      return {
        message,
        fix: t("cli.errors.secret.providerUnavailable.fix"),
        code: EXIT.environment,
      };
    }
    case "key_unavailable": {
      if (field("key") === "file" && field("reason") === "access_denied") {
        // 자동 선택이 파일 키로 떨어졌고 사람이 아직 확인하지 않았다(L0.secrets.spec §4.7 5번)
        return {
          message: t("cli.errors.secret.keyUnavailable.fileAccessDenied.message"),
          fix: t("cli.errors.secret.keyUnavailable.fileAccessDenied.fix"),
          code: EXIT.environment,
        };
      }
      if (field("reason") === "item_missing") {
        return {
          message: t("cli.errors.secret.keyUnavailable.itemMissing.message"),
          fix: t("cli.errors.secret.keyUnavailable.itemMissing.fix"),
          code: EXIT.environment,
        };
      }
      return {
        message: t("cli.errors.secret.keyUnavailable.message"),
        fix: t("cli.errors.secret.keyUnavailable.fix"),
        code: EXIT.environment,
      };
    }
    case "decrypt_failed":
      return {
        message: t("cli.errors.secret.decryptFailed.message"),
        fix: t("cli.errors.secret.decryptFailed.fix"),
        code: EXIT.error,
      };
    case "read_only_provider":
      return {
        message: t("cli.errors.secret.readOnlyProvider.message"),
        fix: t("cli.errors.secret.readOnlyProvider.fix"),
        code: EXIT.error,
      };
    case "cancelled":
      return {
        message: t("cli.errors.secret.cancelled.message"),
        fix: t("cli.errors.common.runAgainIfNeeded.fix"),
        code: EXIT.error,
      };
    case "denied":
    case "reauth_required":
      return {
        message: t("cli.errors.secret.deniedConfirmation.message"),
        fix: t("cli.errors.secret.deniedConfirmation.fix"),
        code: EXIT.error,
      };
    case "write_failed":
      return writeFailure(field("target"), field("code"));
    case "audit_unwritable":
      return {
        message: t("cli.errors.secret.writeFailed.message"),
        fix: t("cli.errors.common.checkDataDirAndDisk.fix"),
        code: EXIT.environment,
      };
    // xeon-disable-next-line xeon/switch-default-never -- 비밀 오류 kind는 서버가 더 새로우면 늘어난다. 일반 문구로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return undefined;
  }
}

/** 슬래시 명령 실패. 능력 오류 구간(코드 4000)의 kind `cap.dialog.commands.<code>`다(F wire §3.3.1 command.run) */
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
    // xeon-disable-next-line xeon/switch-default-never -- 명령 오류 code는 능력이 더하면 늘어난다. 일반 문구로 돌려준다 (eng.typescript.guide TY-14)
    default:
      return {
        message: t("cli.errors.command.commandFailed.message", { kind: error.data.kind }),
        fix: t("cli.errors.command.commandFailed.fix"),
        code: EXIT.error,
      };
  }
}

/** wire 오류를 §4.10 표의 문구와 종료 코드로 바꾼다 */
export function failureOfWire(error: WireError): Failure {
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
    case "settings.scopeNotAllowed":
      return {
        message: t("cli.errors.wire.settingsScopeNotAllowed.message", {
          key: detailText(error, "key") ?? t("cli.errors.common.thisKey"),
        }),
        fix: t("cli.errors.wire.settingsScopeNotAllowed.fix", {
          scopes: allowedScopesText(error),
        }),
        code: EXIT.usage,
      };
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
      };
    case "store.diskFull":
      return {
        message: t("cli.errors.common.storageFull.message"),
        fix: t("cli.errors.common.storageFull.fix"),
        code: EXIT.environment,
      };
    case "store.readOnly":
      return {
        message: t("cli.errors.wire.storeReadOnly.message"),
        fix: t("cli.errors.wire.storeReadOnly.fix"),
        code: EXIT.error,
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
    // xeon-disable-next-line xeon/switch-default-never -- 서버가 더 새로우면 모르는 와이어 오류 kind가 온다. 일반 문구로 돌려준다 (eng.typescript.guide TY-14)
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

/** 명령 실행 중 잡은 값을 오류 문구로 바꾼다. 버그(그 밖의 예외)는 호출자가 다시 던진다: undefined를 돌려준다 */
export function failureOfCaught(caught: unknown): Failure | undefined {
  if (caught instanceof WireError) return failureOfWire(caught);
  if (caught instanceof HostClientError) {
    return {
      message:
        caught.kind === "closed"
          ? t("cli.errors.connection.closed.message")
          : t("cli.errors.connection.request.message", { kind: caught.kind }),
      fix: t("cli.errors.connection.fix"),
      code: EXIT.error,
    };
  }
  return undefined;
}
