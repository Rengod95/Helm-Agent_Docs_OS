import { assertNever, type Result } from "@fresnel/contracts";
import {
  wireError,
  type ExtRemoveResult,
  type ExtValidateCompositionParams,
  type ExtValidateResult,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import type {
  DevkitError,
  KindEntry,
  LinkInput,
  LinkResult,
  PackInput,
  PackResult,
  ScaffoldInput,
  ScaffoldResult,
  ValidationReport,
} from "@fresnel/contracts/services";
import { notImplemented } from "../not-implemented.ts";

// 제작 wire(서비스 `fresnel.devkit`, L3.authoring.spec §3.3). 처리기는 T-AUTH가 채운다. 일곱 메서드를 포트로 채운다.
// `ext.test.run`, `ext.test.list`는 측정 계획이 바꿀 자리라 `notImplemented`로 남긴다.
// 이 파일과 `assembly/m4/devkit-port.ts`만 고친다. `handlers/index.ts`, `types.ts`, `assemble.ts`, `assembly/m4/index.ts`는 고치지 않는다.

/** 처리기가 쓰는 포트. 실패는 던지지 않고 `DevkitError` 값으로 알린다(TY-11) */
export interface DevkitPort {
  kinds(): Promise<readonly KindEntry[]>;
  scaffold(input: ScaffoldInput): Promise<Result<ScaffoldResult, DevkitError>>;
  validate(dir: string): Promise<Result<ValidationReport, DevkitError>>;
  validateComposition(params: ExtValidateCompositionParams): ExtValidateResult;
  pack(input: PackInput): Promise<Result<PackResult, DevkitError>>;
  install(input: LinkInput): Promise<Result<LinkResult, DevkitError>>;
  remove(name: string): Promise<Result<ExtRemoveResult, DevkitError>>;
}

export type DevkitMethods =
  | "ext.kinds"
  | "ext.scaffold"
  | "ext.validate"
  | "ext.package"
  | "ext.install"
  | "ext.remove"
  | "ext.test.run"
  | "ext.test.list"
  | "ext.validateComposition";

export function createDevkitHandlers(port: DevkitPort): Pick<WireHandlers, DevkitMethods> {
  return {
    "ext.kinds": async () => ({ kinds: await port.kinds() }),
    "ext.scaffold": async (params) => unwrap(await port.scaffold(params), "/dir"),
    "ext.validate": async (params) => unwrap(await port.validate(params.dir), "/dir"),
    "ext.package": async (params) => unwrap(await port.pack(params), "/dir"),
    "ext.install": async (params) => unwrap(await port.install(params), "/source"),
    "ext.remove": async (params) => unwrap(await port.remove(params.name), "/name"),
    "ext.test.run": notImplemented("ext.test.run"),
    "ext.test.list": notImplemented("ext.test.list"),
    "ext.validateComposition": (params) => Promise.resolve(port.validateComposition(params)),
  };
}

function unwrap<T>(result: Result<T, DevkitError>, path: string): T {
  if (result.ok) return result.value;
  throw wireErrorOf(result.error, path);
}

/**
 * 실패 대응표 [제안]. 입력 문제는 `jsonrpc.invalidParams`의 `issues`(`path`와 `<종류>: <내용>`)로 알린다.
 * 확장 이름이 없으면(`ext.remove`) `extension.notFound`, 입출력은 `store.io`다.
 */
function wireErrorOf(error: DevkitError, path: string): WireError {
  const issue = (message: string): WireError =>
    wireError("jsonrpc.invalidParams", { details: { issues: [{ path, message }] } });
  switch (error.kind) {
    case "invalid_input":
    case "exists":
    case "blocked_kind":
    case "denied":
    case "dev_mode_required":
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
