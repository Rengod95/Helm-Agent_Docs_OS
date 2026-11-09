// 시작 실패를 한 줄 문장과 종료코드로 바꾼다. 원인 객체(`cause`)는 싣지 않는다: 시스템 오류 문장과 파서 문장에는 경로 밖의 값이 섞일 수 있다.
// 종료코드: 2는 환경 문제(소켓, 상태 폴더, UI, 인증서 파일, 포트 사용 중), 1은 예상하지 못한 오류(내부 불변 조건, 키 생성 실패)다.
import { assertNever } from "@fresnel/contracts";
import type { DeviceStoreError } from "../auth/devices.ts";
import type { FileError } from "../auth/atomic-file.ts";
import type { PushStoreError } from "../auth/push.ts";
import type { VapidError } from "../auth/vapid.ts";
import type { GatewayError } from "../server/gateway.ts";
import type { TlsError } from "../tls/store.ts";
import type { PreflightError } from "./preflight.ts";

type StateStoreError = DeviceStoreError | PushStoreError | VapidError;

export type WebAppError =
  | { readonly kind: "preflight"; readonly error: PreflightError }
  | { readonly kind: "state"; readonly error: StateStoreError }
  | { readonly kind: "tls"; readonly error: TlsError }
  | { readonly kind: "gateway"; readonly error: GatewayError };

export interface Described {
  readonly exitCode: 1 | 2;
  readonly message: string;
}

/** 파일 쓰기와 읽기를 한 단어로 */
function opWord(op: FileError["op"]): string {
  return op === "read" ? "read" : "written";
}

function stateMessage(error: StateStoreError): Described {
  switch (error.kind) {
    case "io":
      return { exitCode: 2, message: `state file cannot be ${opWord(error.op)}: ${error.path}` };
    case "corrupt":
      return {
        exitCode: 2,
        message: `state file is damaged (${error.reason}); move it aside to start over: ${error.path}`,
      };
    case "generate_failed":
      return { exitCode: 1, message: "could not create the push keys" };
    default:
      return assertNever(error, "state error");
  }
}

function tlsMessage(error: TlsError): Described {
  switch (error.kind) {
    case "io":
      return { exitCode: 2, message: `TLS file cannot be ${opWord(error.op)}: ${error.path}` };
    case "invalid_host":
      return { exitCode: 2, message: `TLS host name is not valid: ${error.host}` };
    case "no_hosts":
      return { exitCode: 2, message: "TLS needs at least one host name" };
    case "invalid_key":
      // 자체 서명 키(`invalid_key`의 `cause`)와 사용자 키(`path`)가 같은 종류 이름을 쓴다
      return "path" in error
        ? { exitCode: 2, message: `private key is not a valid PEM key: ${error.path}` }
        : { exitCode: 2, message: "the stored TLS private key is not valid" };
    case "sign_failed":
      return { exitCode: 1, message: "could not sign the self-signed certificate" };
    case "invalid_certificate":
      return { exitCode: 2, message: `certificate is not a valid PEM certificate: ${error.path}` };
    case "key_mismatch":
      return {
        exitCode: 2,
        message: `certificate and key do not match: ${error.certPath}, ${error.keyPath}`,
      };
    case "expired":
      return { exitCode: 2, message: `certificate has expired: ${error.certPath}` };
    case "missing_file":
      return { exitCode: 2, message: `TLS file not found: ${error.path}` };
    default:
      return assertNever(error, "TLS error");
  }
}

function gatewayMessage(error: GatewayError): Described {
  switch (error.kind) {
    case "listen_failed":
      return {
        exitCode: 2,
        message: `cannot listen on the ${error.listener} address (${error.code})`,
      };
    case "source_unavailable":
      return { exitCode: 1, message: `the ${error.source} source could not be built` };
    case "already_started":
    case "no_listener":
      return { exitCode: 1, message: `gateway did not start (${error.kind})` };
    default:
      return assertNever(error, "gateway error");
  }
}

function preflightMessage(error: PreflightError): Described {
  switch (error.kind) {
    case "socket_missing":
      return { exitCode: 2, message: `service socket not found: ${error.path}` };
    case "socket_unreachable":
      return {
        exitCode: 2,
        message: `service socket is not reachable (${error.code}): ${error.path}`,
      };
    case "state_dir_unusable":
      return {
        exitCode: 2,
        message: `state folder is not usable (${error.code}): ${error.path}`,
      };
    case "ui_missing":
      return { exitCode: 2, message: `UI bundle not found (index.html is missing): ${error.path}` };
    default:
      return assertNever(error, "preflight error");
  }
}

/** 시작 실패 하나를 사람이 읽을 한 줄과 종료코드로 바꾼다 */
export function describeError(error: WebAppError): Described {
  switch (error.kind) {
    case "preflight":
      return preflightMessage(error.error);
    case "state":
      return stateMessage(error.error);
    case "tls":
      return tlsMessage(error.error);
    case "gateway":
      return gatewayMessage(error.error);
    default:
      return assertNever(error, "web app error");
  }
}
