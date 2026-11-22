import { assertNever, type Result } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import {
  wireError,
  type DependencyProblemKind,
  type DependencyRefusalReason,
  type DraftInfo,
  type InvocableEntry,
  type PluginDraftFilesResult,
  type PluginDraftFromInstructionParams,
  type PluginDraftFromInstructionResult,
  type PluginGetResult,
  type PluginListFilter,
  type PluginListResult,
  type PluginReviewFileResult,
  type PluginScanResult,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import { wireErrorOfProfile, type ProfilePortFailure } from "../m4/profile-test-run.ts";
import type { PluginEditIssue } from "../../assembly/m4/plugin-edit.ts";

// 플러그인 wire(M5c §3.4). `plugin.list`, `plugin.get`, `plugin.scan`(읽기)과 `plugin.requestRemove`, `plugin.revert`,
// `plugin.draft.create`, `plugin.draft.list`, `plugin.draft.discard`(검토 흐름)과 `plugin.draft.fromInstruction`(한 줄 지침, §4.10)이다.
// 처리기는 포트가 돌려준 값을 그대로 옮기고 오류만 wire 오류로 바꾼다. 계산은 `assembly/plugins/`가 한다.
// 검토함(`pluginReview.*`)은 `handlers/m5/plugin-review.ts`가 맡는다. 두 파일이 쓰는 실패 종류는 이 파일에 함께 둔다.

/** 초안 검사 이슈 하나. 와이어에는 `code`와 `severity`만 간다 */
interface DraftIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

/** 거절을 낳은 의존 한 줄(AGE-33). wire `plugin.dependency`의 `items`와 같은 모양이다 */
export interface DependencyItem {
  readonly from: string;
  readonly target: string;
  readonly kind: "hard" | "soft";
  readonly range: string | null;
  readonly problem: DependencyProblemKind;
  readonly found: string | null;
}

/** 포트가 돌려주는 거절. 처리기가 wire 오류로 옮긴다 */
export type PluginPortFailure =
  /** 그 이름의 플러그인이 없다(`extension.notFound`, 기존 오류를 쓴다 §3.4) */
  | { readonly kind: "unknown_plugin"; readonly name: string }
  /** 그 대화가 없다(`thread.notFound`, `plugin.invocables`) */
  | { readonly kind: "thread_not_found"; readonly threadId: string }
  /** 되돌릴 현재 검토본이 없다(`plugin.noReviewedCopy`) */
  | { readonly kind: "no_reviewed_copy"; readonly name: string }
  /** 프로필 목록을 읽지 못해 사용처를 계산할 수 없다. 프로필 오류를 그대로 옮긴다 */
  | { readonly kind: "profiles"; readonly failure: ProfilePortFailure }
  /** 검토본 저장소를 읽지 못했다. `code`는 저장소 오류의 종류다(`store.io`로 옮긴다) */
  | { readonly kind: "store"; readonly code: string }
  | { readonly kind: "draft_not_found"; readonly draftId: string }
  /** 폴더 검사가 실패했다. 이슈가 `plugin.invalid`의 `details.issues`다 */
  | { readonly kind: "draft_invalid"; readonly issues: readonly DraftIssue[] }
  /** 같은 이름의 원본 폴더가 이미 있고, 한 줄 지침이 새 버전으로 덮어쓸 수 없다(`plugin.exists`, §4.10.1) */
  | { readonly kind: "exists"; readonly name: string }
  | { readonly kind: "too_large" }
  | { readonly kind: "symlink_refused" }
  | { readonly kind: "review_not_found"; readonly itemId: string }
  | { readonly kind: "not_pending"; readonly itemId: string }
  /** 후보 스냅샷 밖의 경로다 */
  | { readonly kind: "path_invalid" }
  /** 손으로 고친 변경은 승인할 수 없다 */
  | { readonly kind: "hand_edit"; readonly itemId: string }
  | { readonly kind: "purpose_required"; readonly itemId: string }
  /** 대상 프로필 검증에 실패해 아무것도 바뀌지 않았다. 이슈는 프로필마다의 검증 결과다(§4.7.3, §5) */
  | { readonly kind: "profile_invalid"; readonly issues: readonly PluginEditIssue[] }
  /** 의존 거절(AGE-33). `unmet`은 설치·승인, `required_by`는 끄기·삭제, `breaks_range`는 업데이트다 */
  | {
      readonly kind: "dependency";
      readonly reason: DependencyRefusalReason;
      readonly plugin: string;
      readonly items: readonly DependencyItem[];
    };

/** 처리기가 쓰는 포트. 메서드 하나가 wire 메서드 하나다 */
export interface PluginPort {
  list(filter: PluginListFilter): Promise<Result<PluginListResult, PluginPortFailure>>;
  get(name: string): Promise<Result<PluginGetResult, PluginPortFailure>>;
  /** 원본 폴더를 다시 훑는다. 바뀐 원본마다 검토 항목을 만든다 */
  scan(): Promise<Result<PluginScanResult, PluginPortFailure>>;
  /** 제거 요청: 제거 항목을 만든다(`plugin.requestRemove`) */
  requestRemove(name: string): Promise<Result<{ readonly itemId: string }, PluginPortFailure>>;
  /** 원본 폴더를 현재 검토본 내용으로 되돌린다(`plugin.revert`) */
  revert(name: string): Promise<Result<{ readonly restored: true }, PluginPortFailure>>;
  /** 대화가 부를 수 있는 항목(`plugin.invocables`). 대화가 없으면 `thread_not_found`다 */
  invocables(
    threadId: string,
  ): Promise<Result<{ readonly entries: readonly InvocableEntry[] }, PluginPortFailure>>;
  draftCreate(
    dir: string,
    originThreadId: string | undefined,
  ): Promise<
    Result<
      {
        readonly draftId: string;
        readonly contentHash: string;
        readonly card: PluginCard;
        readonly info: DraftInfo;
      },
      PluginPortFailure
    >
  >;
  draftList(
    name: string,
  ): Promise<Result<{ readonly drafts: readonly DraftInfo[] }, PluginPortFailure>>;
  draftDiscard(draftId: string): Promise<Result<void, PluginPortFailure>>;
  /** 초안 한 버전의 파일 목록(`plugin.draft.files`, 읽기만) */
  draftFiles(draftId: string): Promise<Result<PluginDraftFilesResult, PluginPortFailure>>;
  /** 초안 한 버전의 파일 하나(`plugin.draft.file`, 읽기만) */
  draftFile(
    draftId: string,
    path: string,
  ): Promise<Result<PluginReviewFileResult, PluginPortFailure>>;
  /**
   * 한 줄 지침(§4.10): 지침만 든 원본 폴더를 쓰고 초안과 `user_instruction` 검토 항목을 만든다. 입력은 wire 매개변수 그대로다.
   * 같은 이름을 새 버전으로 덮어쓰는 규칙과 기본 프로필은 포트가 정한다
   */
  draftFromInstruction(
    params: PluginDraftFromInstructionParams,
  ): Promise<Result<PluginDraftFromInstructionResult, PluginPortFailure>>;
}

export type PluginMethods =
  | "plugin.list"
  | "plugin.get"
  | "plugin.invocables"
  | "plugin.scan"
  | "plugin.requestRemove"
  | "plugin.revert"
  | "plugin.draft.create"
  | "plugin.draft.list"
  | "plugin.draft.files"
  | "plugin.draft.file"
  | "plugin.draft.discard"
  | "plugin.draft.fromInstruction";

/** 플러그인 실패를 wire 오류로 옮긴다. 검토함 처리기도 같은 표를 쓴다 */
export function wireErrorOfPluginFailure(failure: PluginPortFailure): WireError {
  switch (failure.kind) {
    case "unknown_plugin":
      return wireError("extension.notFound", { details: { name: failure.name } });
    case "thread_not_found":
      return wireError("thread.notFound", { details: { threadId: failure.threadId } });
    case "no_reviewed_copy":
      return wireError("plugin.noReviewedCopy", { details: { name: failure.name } });
    case "profiles":
      return wireErrorOfProfile(failure.failure);
    case "store":
      return wireError("store.io", {
        message: "the plugin store cannot be read",
        details: { code: failure.code.slice(0, 64) },
      });
    case "draft_not_found":
      return wireError("draft.notFound", { details: { id: failure.draftId } });
    case "draft_invalid":
      return wireError("plugin.invalid", {
        details: {
          issues: failure.issues.map((issue) => ({ code: issue.code, severity: issue.severity })),
        },
      });
    case "exists":
      return wireError("plugin.exists", { details: { name: failure.name } });
    case "too_large":
      return wireError("plugin.tooLarge");
    case "symlink_refused":
      return wireError("plugin.symlinkRefused");
    case "review_not_found":
      return wireError("pluginReview.notFound", { details: { id: failure.itemId } });
    case "not_pending":
      return wireError("pluginReview.notPending", { details: { id: failure.itemId } });
    case "path_invalid":
      return wireError("pluginReview.pathInvalid");
    case "hand_edit":
      return wireError("pluginReview.handEditNotAllowed", { details: { id: failure.itemId } });
    case "purpose_required":
      return wireError("pluginReview.purposeRequired", { details: { id: failure.itemId } });
    case "profile_invalid":
      return wireError("pluginReview.profileInvalid", {
        details: { issues: [...failure.issues] },
      });
    case "dependency":
      return wireError("plugin.dependency", {
        details: {
          reason: failure.reason,
          plugin: failure.plugin,
          items: failure.items.map((item) => ({
            from: item.from,
            target: item.target,
            kind: item.kind,
            range: item.range,
            problem: item.problem,
            found: item.found,
          })),
        },
      });
    default:
      return assertNever(failure, "PluginPortFailure");
  }
}

async function unwrap<T>(call: Promise<Result<T, PluginPortFailure>>): Promise<T> {
  const result = await call;
  if (!result.ok) throw wireErrorOfPluginFailure(result.error);
  return result.value;
}

async function unwrapVoid(call: Promise<Result<void, PluginPortFailure>>): Promise<void> {
  const result = await call;
  if (!result.ok) throw wireErrorOfPluginFailure(result.error);
}

export function createPluginHandlers(port: PluginPort): Pick<WireHandlers, PluginMethods> {
  return {
    "plugin.list": (params) => unwrap(port.list(params.filter ?? {})),
    "plugin.get": (params) => unwrap(port.get(params.name)),
    "plugin.invocables": (params) => unwrap(port.invocables(params.threadId)),
    "plugin.scan": () => unwrap(port.scan()),
    "plugin.requestRemove": (params) => unwrap(port.requestRemove(params.name)),
    "plugin.revert": (params) => unwrap(port.revert(params.name)),
    "plugin.draft.create": (params) => unwrap(port.draftCreate(params.dir, params.originThreadId)),
    "plugin.draft.list": (params) => unwrap(port.draftList(params.name)),
    "plugin.draft.files": (params) => unwrap(port.draftFiles(params.draftId)),
    "plugin.draft.file": (params) => unwrap(port.draftFile(params.draftId, params.path)),
    "plugin.draft.discard": async (params) => {
      await unwrapVoid(port.draftDiscard(params.draftId));
      return {};
    },
    "plugin.draft.fromInstruction": (params) => unwrap(port.draftFromInstruction(params)),
  };
}
