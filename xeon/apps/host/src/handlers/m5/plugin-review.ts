import type { Result } from "@fresnel/contracts";
import type {
  PluginReviewFileResult,
  ProfilePlan,
  ReviewDecision,
  ReviewFileSide,
  ReviewItem,
  ReviewState,
  WireHandlers,
} from "@fresnel/contracts/wire";
import { wireErrorOfPluginFailure, type PluginPortFailure } from "./plugins.ts";

// 검토함 wire(M5c §3.4, §4.7). `pluginReview.list`, `get`, `file`, `submitDraft`, `decide`다.
// 처리기는 검토 서비스(`assembly/plugins/review.ts`)가 돌려준 값을 그대로 옮기고 오류만 wire 오류로 바꾼다.
// 알림 `pluginReview.changed`와 `plugin.changed`는 `onChanged`를 연결 허브가 듣고 보낸다.

/** 검토 서비스가 알리는 변화. 항목 상태가 바뀌었거나 검토본이 바뀌었다 */
export type PluginChange =
  | { readonly kind: "review"; readonly itemId: string; readonly state: ReviewState }
  | { readonly kind: "plugin"; readonly name: string };

/** 처리기가 쓰는 검토함 포트 */
export interface PluginReviewPort {
  list(filter: {
    readonly state?: ReviewState;
    readonly name?: string;
  }): Promise<Result<{ readonly items: readonly ReviewItem[] }, PluginPortFailure>>;
  get(itemId: string): Promise<Result<{ readonly item: ReviewItem }, PluginPortFailure>>;
  file(
    itemId: string,
    path: string,
    side?: ReviewFileSide,
  ): Promise<Result<PluginReviewFileResult, PluginPortFailure>>;
  /** 제출이 함께 주는 값(선택). 준 것만 대기 항목에 싣는다(AGE-72) */
  submitDraft(
    draftId: string,
    extra?: { readonly originProfileId?: string; readonly profilePlan?: ProfilePlan },
  ): Promise<Result<{ readonly itemId: string }, PluginPortFailure>>;
  decide(
    itemId: string,
    decision: ReviewDecision,
  ): Promise<
    Result<
      {
        readonly item: ReviewItem;
        readonly appliedTo: readonly string[];
        readonly missingPlugins: readonly string[];
      },
      PluginPortFailure
    >
  >;
  onChanged(listener: (change: PluginChange) => void): () => void;
}

export type PluginReviewMethods =
  | "pluginReview.list"
  | "pluginReview.get"
  | "pluginReview.file"
  | "pluginReview.submitDraft"
  | "pluginReview.decide";

async function unwrap<T>(call: Promise<Result<T, PluginPortFailure>>): Promise<T> {
  const result = await call;
  if (!result.ok) throw wireErrorOfPluginFailure(result.error);
  return result.value;
}

/** 검토함 처리기. 메서드 하나가 포트 메서드 하나다 */
export function createPluginReviewHandlers(
  port: PluginReviewPort,
): Pick<WireHandlers, PluginReviewMethods> {
  return {
    "pluginReview.list": (params) => unwrap(port.list(params)),
    "pluginReview.get": (params) => unwrap(port.get(params.itemId)),
    "pluginReview.file": (params) => unwrap(port.file(params.itemId, params.path, params.side)),
    "pluginReview.submitDraft": (params) =>
      // 없는 칸은 싣지 않는다(정확한 선택 속성 규칙)
      unwrap(
        port.submitDraft(params.draftId, {
          ...(params.originProfileId === undefined
            ? {}
            : { originProfileId: params.originProfileId }),
          ...(params.profilePlan === undefined ? {} : { profilePlan: params.profilePlan }),
        }),
      ),
    "pluginReview.decide": async (params) => {
      const { item, appliedTo, missingPlugins } = await unwrap(
        port.decide(params.itemId, params.decision),
      );
      // 없는 플러그인은 있을 때만 싣는다(화면이 "이 기기에 없어요"를 보인다)
      return { item, appliedTo, ...(missingPlugins.length === 0 ? {} : { missingPlugins }) };
    },
  };
}
