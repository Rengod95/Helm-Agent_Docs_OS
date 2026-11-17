import { assertNever, type Result } from "@fresnel/contracts";
import {
  wireError,
  type ExtTestListResult,
  type ExtTestRunParams,
  type ExtTestRunResult,
  type ExtValidateCompositionParams,
  type ExtValidateResult,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import type { PluginSubmitRequest, PluginSubmitResult } from "@fresnel/contracts/extensions";
import type {
  DevkitError,
  KindEntry,
  PackInput,
  PackResult,
  ScaffoldInput,
  ScaffoldResult,
  ValidationReport,
} from "@fresnel/contracts/services";

// 제작 wire(서비스 `fresnel.devkit`, L3.authoring.spec §3.3). 처리기는 T-AUTH가 채운다. 시험 실행 두 개를 포함한 제작 메서드를 포트로 채운다(W-29).
// 설치와 지우기(`ext.install*`, `ext.remove*`)는 검토 흐름으로 대체되어 처리기에 없다(M5c §7.7). 등록하지 않은 메서드는 -32601이다.
// 이 파일과 `assembly/m4/devkit-port.ts`만 고친다. `handlers/index.ts`, `types.ts`, `assemble.ts`, `assembly/m4/index.ts`는 고치지 않는다.

/** 처리기가 쓰는 포트. 실패는 던지지 않고 `DevkitError` 값으로 알린다(TY-11) */
export interface DevkitPort {
  kinds(): Promise<readonly KindEntry[]>;
  scaffold(input: ScaffoldInput): Promise<Result<ScaffoldResult, DevkitError>>;
  validate(dir: string): Promise<Result<ValidationReport, DevkitError>>;
  validateComposition(params: ExtValidateCompositionParams): ExtValidateResult;
  pack(input: PackInput): Promise<Result<PackResult, DevkitError>>;
  /**
   * 담당 AI의 제출(`PluginSubmitPort.submit`, M5c §3.5). wire 메서드가 아니라 제작 서비스(`fresnel.devkit`의 `submit`)가 부른다.
   * 포트가 아직 없으면 `io`다. 설치하지 않는다(검토함에서 승인해야 쓸 수 있다)
   */
  submit(input: PluginSubmitRequest): Promise<Result<PluginSubmitResult, DevkitError>>;
  /**
   * `ext.test.run`. `replay`는 개발 모드에서만 돌고 끝까지 기다린 뒤 결과를 돌려준다(통과든 실패든 값이다). 재생이 실행되지 못하면 `io`다.
   * `testRun`은 Test run 대화를 열고 그 대화를 돌려준다. 끝내는 것은 사용자가 한다.
   */
  testRun(params: ExtTestRunParams): Promise<Result<ExtTestRunResult, DevkitError>>;
  /** `ext.test.list`. 저장된 시험 기록을 시작 순서대로 돌려준다 */
  testList(): Promise<Result<ExtTestListResult, DevkitError>>;
}

export type DevkitMethods =
  | "ext.kinds"
  | "ext.scaffold"
  | "ext.validate"
  | "ext.package"
  | "ext.test.run"
  | "ext.test.list"
  | "ext.validateComposition";

export function createDevkitHandlers(port: DevkitPort): Pick<WireHandlers, DevkitMethods> {
  return {
    "ext.kinds": async () => ({ kinds: await port.kinds() }),
    "ext.scaffold": async (params) => unwrap(await port.scaffold(params), "/dir"),
    "ext.validate": async (params) => unwrap(await port.validate(params.dir), "/dir"),
    "ext.package": async (params) => unwrap(await port.pack(params), "/dir"),
    "ext.test.run": async (params) => unwrap(await port.testRun(params), "/target"),
    "ext.test.list": async () => unwrap(await port.testList(), "/"),
    "ext.validateComposition": (params) => Promise.resolve(port.validateComposition(params)),
  };
}

function unwrap<T>(result: Result<T, DevkitError>, path: string): T {
  if (result.ok) return result.value;
  throw wireErrorOf(result.error, path);
}

/**
 * 실패 대응표 [제안]. 입력 문제는 `jsonrpc.invalidParams`의 `issues`(`path`와 `<종류>: <내용>`)로 알린다.
 * 확장 이름이 없으면 `extension.notFound`, 입출력은 `store.io`다.
 */
function wireErrorOf(error: DevkitError, path: string): WireError {
  // 설치 입력이 검사에서 걸린 사유 목록은 같은 `details`에 `reasons`로 싣는다(화면이 사유마다 문장을 고른다)
  const reasons = error.reasons === undefined ? {} : { reasons: error.reasons };
  const issue = (message: string): WireError =>
    wireError("jsonrpc.invalidParams", { details: { issues: [{ path, message }], ...reasons } });
  switch (error.kind) {
    case "safe_mode_active":
      return wireError("extension.safeModeActive", { message: error.message });
    case "invalid_input":
    case "exists":
    case "blocked_kind":
    case "denied":
    case "dev_mode_required":
    case "source_changed":
    case "managed_locked":
    case "not_absolute":
    case "no_manifest":
      return issue(`${error.kind}: ${error.message}`);
    case "not_found":
      return path === "/name"
        ? wireError("extension.notFound", { message: error.message })
        : issue(`not_found: ${error.message}`);
    case "io":
      return wireError("store.io", { message: error.message, details: { code: "io" } });
    default:
      return assertNever(error.kind, "DevkitErrorKind");
  }
}
