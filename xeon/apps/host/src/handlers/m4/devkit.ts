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
  CraftContextView,
  DependenciesEditInput,
  DependenciesEditResult,
  DependencyInfo,
  DevkitError,
  DraftSummary,
  KindEntry,
  MemberInfo,
  MembersDetachInput,
  MembersDetachResult,
  MembersEditInput,
  MembersEditResult,
  MembersMergeInput,
  MembersMergeResult,
  PackInput,
  PackResult,
  ScaffoldInput,
  ScaffoldResult,
  SourceFacts,
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
  /**
   * 설치하지 않은 폴더의 Test run(L3.authoring.spec §4.3). 폴더를 초안으로 만들고 그 초안을 Test run 대화에 고정해 대화를 연다.
   * 설치도 승인도 하지 않는다(설치는 검토 승인 뒤에만 된다). 끝내는 것은 사용자다
   */
  trialRun(input: {
    readonly dir: string;
    readonly profileId?: string;
    readonly workspace?: string;
  }): Promise<Result<{ readonly testId: string; readonly threadId: string }, DevkitError>>;
  /** `ext.test.list`. 저장된 시험 기록을 시작 순서대로 돌려준다 */
  testList(): Promise<Result<ExtTestListResult, DevkitError>>;
  /**
   * `ext.members.edit`(L3.authoring.spec §3.3). 원본 폴더의 구성원을 고친다. 설치본과 검토본·초안 저장소 폴더는 거절한다(`denied`).
   * 설치도 승인도 초안 만들기도 하지 않는다. 고친 폴더는 호출자가 `plugin.draft.create`로 다시 초안을 만든다
   */
  editMembers(input: MembersEditInput): Promise<Result<MembersEditResult, DevkitError>>;
  /** `ext.members.read`. 쓰지 않고 구성원 요약을 돌려준다 */
  readMembers(dir: string): Promise<Result<readonly MemberInfo[], DevkitError>>;
  /**
   * `ext.members.detach`(AGE-33). 원본 폴더는 읽기만 하고 구성원 하나를 새 폴더(`outDir`)에 독립 플러그인으로 쓴다.
   * `dir`과 `outDir`이 설치본이나 저장소 폴더면 거절한다(`denied`). 설치도 승인도 초안 만들기도 하지 않는다
   */
  detachMember(input: MembersDetachInput): Promise<Result<MembersDetachResult, DevkitError>>;
  /**
   * `ext.members.merge`(AGE-33). 원본 폴더들은 읽기만 하고 독립 플러그인들을 한 플러그인의 구성원으로 묶은 새 폴더(`outDir`)에 쓴다.
   * `dirs`나 `outDir`이 설치본이나 저장소 폴더면 거절한다(`denied`). 설치도 승인도 초안 만들기도 하지 않는다
   */
  mergeMembers(input: MembersMergeInput): Promise<Result<MembersMergeResult, DevkitError>>;
  /**
   * `ext.dependencies.edit`(AGE-33). 원본 폴더 매니페스트의 `dependsOn` 줄을 고친다. `editMembers`와 같은 폴더 거절(`denied`)을 하고,
   * 설치도 승인도 초안 만들기도 하지 않는다
   */
  editDependencies(
    input: DependenciesEditInput,
  ): Promise<Result<DependenciesEditResult, DevkitError>>;
  /** `ext.dependencies.read`. 쓰지 않고 의존 줄을 돌려준다 */
  readDependencies(dir: string): Promise<Result<readonly DependencyInfo[], DevkitError>>;
  /** 기존 플러그인의 원본 폴더 사실(M5c §4.9.3). 빌더 서비스가 부른다. wire 메서드가 아니다 */
  sourceOf(name: string): Promise<Result<SourceFacts, DevkitError>>;
  /** 플러그인의 초안 목록, 최신 먼저(M5c §4.9.2). 빌더 서비스가 부른다. wire 메서드가 아니다 */
  draftList(
    name: string,
  ): Promise<Result<{ readonly drafts: readonly DraftSummary[] }, DevkitError>>;
  /** 테스트 대화의 맥락 참조와 발견의 근거 묶음(M5c §4.8.8). 빌더 서비스가 부른다. wire 메서드가 아니다 */
  craftContext(threadId: string): Promise<Result<CraftContextView, DevkitError>>;
  /** 테스트 대화인가(M5c §4.8.6). 빌더 서비스의 `isCraftChat`이 부른다. wire 메서드가 아니다 */
  isCraftChat(threadId: string): Promise<Result<boolean, DevkitError>>;
}

export type DevkitMethods =
  | "ext.kinds"
  | "ext.scaffold"
  | "ext.validate"
  | "ext.package"
  | "ext.test.run"
  | "ext.test.list"
  | "ext.members.edit"
  | "ext.members.read"
  | "ext.members.detach"
  | "ext.members.merge"
  | "ext.dependencies.edit"
  | "ext.dependencies.read"
  | "ext.validateComposition";

export function createDevkitHandlers(port: DevkitPort): Pick<WireHandlers, DevkitMethods> {
  return {
    "ext.kinds": async () => ({ kinds: await port.kinds() }),
    "ext.scaffold": async (params) => unwrap(await port.scaffold(params), "/dir"),
    "ext.validate": async (params) => unwrap(await port.validate(params.dir), "/dir"),
    "ext.package": async (params) => unwrap(await port.pack(params), "/dir"),
    "ext.test.run": async (params) => unwrap(await port.testRun(params), "/target"),
    "ext.test.list": async () => unwrap(await port.testList(), "/"),
    "ext.members.edit": async (params) => unwrap(await port.editMembers(params), "/dir"),
    "ext.members.read": async (params) => ({
      members: unwrap(await port.readMembers(params.dir), "/dir"),
    }),
    "ext.members.detach": async (params) => unwrap(await port.detachMember(params), "/dir"),
    "ext.members.merge": async (params) => unwrap(await port.mergeMembers(params), "/dirs"),
    "ext.dependencies.edit": async (params) => unwrap(await port.editDependencies(params), "/dir"),
    "ext.dependencies.read": async (params) => ({
      dependencies: unwrap(await port.readDependencies(params.dir), "/dir"),
    }),
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
    case "bundled_not_editable":
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
