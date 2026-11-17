import { assertNever, type Result } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import {
  wireError,
  type DraftInfo,
  type PluginGetResult,
  type PluginListFilter,
  type PluginListResult,
  type PluginScanResult,
  type ProfileIssue,
  type WireError,
  type WireHandlers,
} from "@fresnel/contracts/wire";
import { wireErrorOfProfile, type ProfilePortFailure } from "../m4/profile-test-run.ts";

// 플러그인 wire(M5c §3.4). `plugin.list`, `plugin.get`, `plugin.scan`(읽기)과 `plugin.requestRemove`, `plugin.revert`,
// `plugin.draft.create`, `plugin.draft.list`, `plugin.draft.discard`(검토 흐름)다. 처리기는 포트가 돌려준 값을 그대로 옮기고 오류만 wire 오류로 바꾼다.
// 계산은 `assembly/plugins/`가 한다. `plugin.invocables`와 `plugin.draft.fromInstruction`은 아직 `notImplemented`다.
// 검토함(`pluginReview.*`)은 `handlers/m5/plugin-review.ts`가 맡는다. 두 파일이 쓰는 실패 종류는 이 파일에 함께 둔다.

/** 초안 검사 이슈 하나. 와이어에는 `code`와 `severity`만 간다 */
interface DraftIssue {
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly path: string;
  readonly message: string;
}

/** 포트가 돌려주는 거절. 처리기가 wire 오류로 옮긴다 */
export type PluginPortFailure =
  /** 그 이름의 플러그인이 없다(`extension.notFound`, 기존 오류를 쓴다 §3.4) */
  | { readonly kind: "unknown_plugin"; readonly name: string }
  /** 되돌릴 현재 검토본이 없다(`plugin.noReviewedCopy`) */
  | { readonly kind: "no_reviewed_copy"; readonly name: string }
  /** 프로필 목록을 읽지 못해 사용처를 계산할 수 없다. 프로필 오류를 그대로 옮긴다 */
  | { readonly kind: "profiles"; readonly failure: ProfilePortFailure }
  /** 검토본 저장소를 읽지 못했다. `code`는 저장소 오류의 종류다(`store.io`로 옮긴다) */
  | { readonly kind: "store"; readonly code: string }
  | { readonly kind: "draft_not_found"; readonly draftId: string }
  /** 폴더 검사가 실패했다. 이슈가 `plugin.invalid`의 `details.issues`다 */
  | { readonly kind: "draft_invalid"; readonly issues: readonly DraftIssue[] }
  | { readonly kind: "too_large" }
  | { readonly kind: "symlink_refused" }
  | { readonly kind: "review_not_found"; readonly itemId: string }
  | { readonly kind: "not_pending"; readonly itemId: string }
  /** 후보 스냅샷 밖의 경로다 */
  | { readonly kind: "path_invalid" }
  /** 손으로 고친 변경은 승인할 수 없다 */
  | { readonly kind: "hand_edit"; readonly itemId: string }
  | { readonly kind: "purpose_required"; readonly itemId: string }
  /** 대상 프로필 검증에 실패해 아무것도 바뀌지 않았다. 이슈는 프로필 검증 결과다 */
  | { readonly kind: "profile_invalid"; readonly issues: readonly ProfileIssue[] };

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
}

export type PluginMethods =
  | "plugin.list"
  | "plugin.get"
  | "plugin.scan"
  | "plugin.requestRemove"
  | "plugin.revert"
  | "plugin.draft.create"
  | "plugin.draft.list"
  | "plugin.draft.discard";

/** 플러그인 실패를 wire 오류로 옮긴다. 검토함 처리기도 같은 표를 쓴다 */
export function wireErrorOfPluginFailure(failure: PluginPortFailure): WireError {
  switch (failure.kind) {
    case "unknown_plugin":
      return wireError("extension.notFound", { details: { name: failure.name } });
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
    "plugin.scan": () => unwrap(port.scan()),
    "plugin.requestRemove": (params) => unwrap(port.requestRemove(params.name)),
    "plugin.revert": (params) => unwrap(port.revert(params.name)),
    "plugin.draft.create": (params) => unwrap(port.draftCreate(params.dir, params.originThreadId)),
    "plugin.draft.list": (params) => unwrap(port.draftList(params.name)),
    "plugin.draft.discard": async (params) => {
      await unwrapVoid(port.draftDiscard(params.draftId));
      return {};
    },
  };
}
