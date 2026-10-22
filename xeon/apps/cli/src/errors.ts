import { assertNever } from "@xeon/contracts";
import { WireError } from "@xeon/contracts/wire";
import { HostClientError } from "./host-client.ts";
import type { UsageError } from "./cli/command.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import type { EngineStartError, EngineStartErrorKind } from "./engine.ts";

// L4.cli.spec §4.10. 모든 오류 출력은 두 줄이다: `xeon: <무엇이 잘못됐다>`와 `  해결: <한 줄>`.
// wire message(영어 개발자용)를 그대로 쓰지 않고 kind와 details로 만든다(F wire §3.5.1). 값은 싣지 않는다.

export interface Failure {
  readonly message: string;
  readonly fix: string;
  readonly code: ExitCode;
}

export function renderFailure(failure: Pick<Failure, "message" | "fix">): string {
  return `xeon: ${failure.message}\n  해결: ${failure.fix}\n`;
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
  if (!Array.isArray(scopes)) return "문서의 허용 범위";
  return scopes.filter((scope): scope is string => typeof scope === "string").join(", ");
}

/** wire 오류를 §4.10 표의 문구와 종료 코드로 바꾼다 */
export function failureOfWire(error: WireError): Failure {
  const kind = error.data.kind;
  switch (kind) {
    case "thread.notFound":
      return {
        message: `세션 ${detailText(error, "threadId") ?? ""}이(가) 없다`,
        fix: "xeon sessions ls로 id를 확인한다",
        code: EXIT.error,
      };
    case "thread.locked":
      return {
        message: `다른 프로세스(${detailText(error, "ownerKind") ?? "알 수 없음"})가 이 세션을 쓰고 있다`,
        fix: "끝날 때까지 두거나 새 세션을 연다",
        code: EXIT.lockDenied,
      };
    case "turn.busy":
      return { message: "진행 중인 turn이 있다", fix: "끝난 뒤 다시 보낸다", code: EXIT.error };
    case "settings.unknownKey":
      return {
        message: `등록되지 않은 설정 키: ${detailText(error, "key") ?? ""}`,
        fix: "xeon config list로 키를 확인한다",
        code: EXIT.usage,
      };
    case "settings.invalidValue":
      return {
        message: `값이 형식이나 범위에 맞지 않다${firstIssueText(error) === undefined ? "" : `: ${firstIssueText(error) ?? ""}`}`,
        fix: "허용 범위를 확인한다",
        code: EXIT.usage,
      };
    case "settings.scopeNotAllowed":
      return {
        message: `그 범위에는 ${detailText(error, "key") ?? "이 키"}를 쓸 수 없다`,
        fix: `허용 범위: ${allowedScopesText(error)}`,
        code: EXIT.usage,
      };
    case "settings.locked":
      return {
        message: `관리 설정이 잠근 키다: ${detailText(error, "key") ?? ""}`,
        fix: "관리자에게 요청한다",
        code: EXIT.error,
      };
    case "settings.secretValue":
      return {
        message: "비밀 키에는 참조만 쓸 수 있다",
        fix: "xeon secret add <name> 뒤 secret://<name>을 쓴다",
        code: EXIT.usage,
      };
    case "protocol.unsupported":
      return {
        message: "CLI와 엔진의 계약 버전이 다르다",
        fix: "같은 버전의 바이너리를 쓰거나 서비스를 다시 띄운다",
        code: EXIT.environment,
      };
    case "host.shuttingDown":
      return { message: "엔진이 종료 중이다", fix: "잠시 뒤 다시 실행한다", code: EXIT.error };
    case "store.busy":
      return {
        message: "저장소가 다른 쓰기로 바쁘다",
        fix: "잠시 뒤 다시 실행한다",
        code: EXIT.error,
      };
    case "store.diskFull":
      return {
        message: "저장 공간이 가득 찼다",
        fix: "디스크 공간을 비우고 다시 실행한다",
        code: EXIT.environment,
      };
    case "store.readOnly":
      return {
        message: "저장소가 읽기 전용이라 쓸 수 없다",
        fix: "다른 엔진이 쓰는 중인지 xeon service status로 확인한다",
        code: EXIT.error,
      };
    case "store.io":
      return {
        message: "저장소 입출력에 실패했다",
        fix: "데이터 디렉터리의 권한과 디스크 상태를 확인한다",
        code: EXIT.environment,
      };
    case "internal": {
      const traceId = error.data.traceId;
      return {
        message: `내부 오류${traceId === undefined ? "" : `(traceId ${traceId})`}`,
        fix: "xeon doctor를 실행하고 traceId를 보고한다",
        code: EXIT.error,
      };
    }
    default:
      return {
        message: `엔진이 요청을 처리하지 못했다 (${kind})`,
        fix: "이 kind를 보고한다",
        code: EXIT.error,
      };
  }
}

/** 명령 실행 중 잡은 값을 오류 문구로 바꾼다. 버그(그 밖의 예외)는 호출자가 다시 던진다: undefined를 돌려준다 */
export function failureOfCaught(caught: unknown): Failure | undefined {
  if (caught instanceof WireError) return failureOfWire(caught);
  if (caught instanceof HostClientError) {
    return {
      message:
        caught.kind === "closed" ? "엔진 연결이 끊겼다" : `엔진에 요청하지 못했다 (${caught.kind})`,
      fix: "xeon service status로 엔진 상태를 확인한다",
      code: EXIT.error,
    };
  }
  return undefined;
}
