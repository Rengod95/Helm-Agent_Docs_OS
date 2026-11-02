import { assertNever, type Result } from "@fresnel/contracts";
import {
  wireError,
  type ExtRollbackParams,
  type ExtRollbackResult,
  type ExtUiListParams,
  type ExtUiListResult,
  type ExtVersionsResult,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import { notImplemented } from "../not-implemented.ts";

// 확장 메서드·Plugin UI·버전 기록 wire(L4.host-service.spec §3.3.3, HS-108). 처리기는 T-XV가 채운다.
// `ext.versions`, `ext.rollback`, `ext.ui.list`는 포트로 채운다. `ext.ui.post`와 `ext.ui.requestApproval`은 대화(threadId)를 정할
// 필드가 없어 입력 큐와 승인 카드를 고를 수 없으므로 `notImplemented`로 남긴다(HS-108 [미결]).
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
    "ext.ui.post": notImplemented("ext.ui.post"),
    "ext.ui.requestApproval": notImplemented("ext.ui.requestApproval"),
  };
}

/** 실패 값을 와이어 오류로 옮긴다. 처리기가 던지면 JSON-RPC 오류가 된다 */
function unwrap<T>(result: Result<T, ExtUiVersionFailure>): T {
  if (result.ok) return result.value;
  throw wireErrorOfFailure(result.error);
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
