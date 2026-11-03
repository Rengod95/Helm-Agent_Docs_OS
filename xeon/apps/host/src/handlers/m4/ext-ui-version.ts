import { assertNever, type Result } from "@fresnel/contracts";
import {
  wireError,
  type ExtRollbackParams,
  type ExtRollbackResult,
  type ExtUiApprovalParams,
  type ExtUiApprovalResult,
  type ExtUiListParams,
  type ExtUiListResult,
  type ExtUiPostParams,
  type ExtUiPostResult,
  type ExtVersionsResult,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import type { ExtUiRefusal } from "@fresnel/ext-host";
import { extensionError } from "./ext-method.ts";

// 확장 메서드·Plugin UI·버전 기록 wire(L4.host-service.spec §3.3.3, HS-108). 처리기는 T-XV가 채운다.
// 다섯 메서드를 모두 포트로 채운다. `ext.ui.post`와 `ext.ui.requestApproval`은 params의 `threadId`(필수)가 가리키는 대화의
// 입력 큐와 승인 카드로 간다(HS-108, §10 52 닫음).
// 이 파일과 `assembly/m4/ext-ui-version-port.ts`를 T-XV가 고친다. `handlers/index.ts`, `types.ts`, `assemble.ts`, `assembly/m4/index.ts`는 고치지 않는다.

/**
 * 포트가 돌려주는 예상 가능한 실패. 던지지 않고 값으로 알린다(TY-11). 처리기가 와이어 오류로 옮긴다(HS-108 [제안] 대응표).
 */
export type ExtUiVersionFailure =
  | { readonly kind: "unknown_extension"; readonly name: string }
  | { readonly kind: "unknown_version"; readonly version: string }
  /** 대상 버전의 상태 스키마가 지금보다 낮다. 되돌리기는 상태를 비워야 한다(`clearState`) */
  | {
      readonly kind: "state_schema_mismatch";
      readonly targetSchemaVersion: number;
      readonly currentSchemaVersion: number;
    }
  /** 되돌리기가 중간에 멈췄다. `reason`은 멈춘 단계와 복구 결과다 */
  | { readonly kind: "rollback_failed"; readonly reason: string }
  /** 이 확장은 버전 기록을 두지 않는다(번들·프로젝트 위치) */
  | { readonly kind: "history_unavailable"; readonly reason: string }
  /** 저장 매체 입출력 실패. `code`는 OS가 준 값이다 */
  | { readonly kind: "io"; readonly code: string };

/** 처리기가 쓰는 포트. 확장 버전 기록·되돌리기와 화면 목록을 조립 루트가 구현한다 */
export interface ExtUiVersionPort {
  versions(name: string): Promise<Result<ExtVersionsResult, ExtUiVersionFailure>>;
  rollback(params: ExtRollbackParams): Promise<Result<ExtRollbackResult, ExtUiVersionFailure>>;
  uiList(params: ExtUiListParams): ExtUiListResult;
  /** 화면이 대화 입력 큐에 넣는다. 거절은 값이다(`ExtUiRefusal`) */
  uiPost(params: ExtUiPostParams): Promise<Result<ExtUiPostResult, ExtUiRefusal>>;
  /** 화면이 승인 카드를 청한다. 기다리지 않고 승인 id를 돌려준다 */
  uiRequestApproval(
    params: ExtUiApprovalParams,
  ): Promise<Result<ExtUiApprovalResult, ExtUiRefusal>>;
}

export type ExtUiVersionMethods =
  | "ext.versions"
  | "ext.rollback"
  | "ext.ui.list"
  | "ext.ui.post"
  | "ext.ui.requestApproval";

export function createExtUiVersionHandlers(
  port: ExtUiVersionPort,
): Pick<WireHandlers, ExtUiVersionMethods> {
  return {
    "ext.versions": async (params) => unwrap(await port.versions(params.name)),
    "ext.rollback": async (params) => unwrap(await port.rollback(params)),
    "ext.ui.list": (params) => Promise.resolve(port.uiList(params)),
    "ext.ui.post": async (params) => unwrapUi(await port.uiPost(params)),
    "ext.ui.requestApproval": async (params) => unwrapUi(await port.uiRequestApproval(params)),
  };
}

/** 실패 값을 와이어 오류로 옮긴다. 처리기가 던지면 JSON-RPC 오류가 된다 */
function unwrap<T>(result: Result<T, ExtUiVersionFailure>): T {
  if (result.ok) return result.value;
  throw wireErrorOfFailure(result.error);
}

function unwrapUi<T>(result: Result<T, ExtUiRefusal>): T {
  if (result.ok) return result.value;
  throw wireErrorOfRefusal(result.error);
}

/**
 * 화면 post·승인 거절의 대응표(HS-108). 대화는 `thread.notFound`, 확장은 `extension.notFound`, 꺼진 확장은 `ext.<확장>.off`다.
 * 매니페스트가 허용하지 않는 호출과 잘못된 값은 `jsonrpc.invalidParams`의 `issues`(경로와 `<종류>: <내용>`)로 알린다.
 */
function wireErrorOfRefusal(refusal: ExtUiRefusal): WireError {
  switch (refusal.kind) {
    case "unknown_thread":
    case "thread_closed":
      return wireError("thread.notFound", { details: { threadId: refusal.threadId } });
    case "unknown_extension":
      return wireError("extension.notFound", { details: { name: refusal.extension } });
    case "extension_off":
      return extensionError(refusal.extension, "off", "extension is off in this thread", {});
    case "ui_not_declared":
      return invalidParams("/ui", `ui_not_declared: ${refusal.ui}`);
    case "method_not_declared":
      return invalidParams("/method", `method_not_declared: ${refusal.method}`);
    case "post_not_allowed":
      return invalidParams(
        "/extension",
        `post_not_allowed: ${refusal.extension} declares no plugin with usesPost`,
      );
    case "name_invalid":
      return invalidParams("/name", `name_invalid: ${refusal.name}`);
    case "payload_invalid":
      return invalidParams("/payload", "payload_invalid: not a JSON value");
    case "key_reused":
      return invalidParams("/requestId", `key_reused: ${refusal.requestId}`);
    case "port_unavailable":
      return wireError("internal", { message: `port_unavailable: ${refusal.port}` });
    case "storage":
      return wireError("internal", { message: `storage: ${refusal.reason}` });
    default:
      return assertNever(refusal, "ExtUiRefusal");
  }
}

/**
 * 실패 대응표(HS-108 [제안]). 와이어 오류 종류에 확장 전용 이름이 없어 입력 문제는 `jsonrpc.invalidParams`의 `issues`에
 * 안정된 접두(실패 종류)를 붙여 싣고, 저장 매체 문제는 `store.io`로 보낸다. 확장 전용 종류는 T-F의 계약 요청이다.
 */
function wireErrorOfFailure(failure: ExtUiVersionFailure): WireError {
  switch (failure.kind) {
    case "unknown_extension":
      return invalidParams("/name", `unknown_extension: ${failure.name}`);
    case "unknown_version":
      return invalidParams("/version", `unknown_version: ${failure.version}`);
    case "state_schema_mismatch":
      return invalidParams(
        "/clearState",
        `state_schema_mismatch: target ${failure.targetSchemaVersion}, current ${failure.currentSchemaVersion}`,
      );
    case "history_unavailable":
      return invalidParams("/name", `history_unavailable: ${failure.reason}`);
    case "rollback_failed":
      return wireError("internal", { message: `rollback_failed: ${failure.reason}` });
    case "io":
      return wireError("store.io", {
        message: `io: ${failure.code}`,
        details: { code: failure.code },
      });
    default:
      return assertNever(failure, "ExtUiVersionFailure");
  }
}

function invalidParams(path: string, message: string): WireError {
  return wireError("jsonrpc.invalidParams", { details: { issues: [{ path, message }] } });
}
