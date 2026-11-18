import { ok, err, type Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { FixedDraftMark } from "../m4/plugin-set.ts";
import type { DraftLoad } from "./draft-load.ts";
import {
  planOverlay,
  type DraftLookup,
  type OverlayRefusal,
  type OverlayTarget,
} from "./overlay.ts";
import type { PluginPortFailure } from "../../handlers/m5/plugins.ts";

// 테스트 실행의 초안 구성(M5c §4.8.1). 대화를 만들기 전에 초안을 검사하고 싣고(`prepare`), 만든 대화에 묶는다(`bind`).
// 검사와 싣기는 덧씌우기와 같다(`planOverlay`, `createDraftLoader`). 실을 때 그 내리기를 붙잡아, 대화를 묶기 전에 다른 대화가
// 같은 초안을 내려 버리지 않게 한다(`PluginSetHandle.hold`). 묶은 뒤에는 대화의 참조가 초안을 쥔다.

/** 초안 하나의 참조. 플러그인 이름과 초안 id다 */
interface TestRunDraftRef {
  readonly plugin: string;
  readonly draftId: string;
}

/** 싣고 붙잡은 초안 묶음. `bind`가 대화에 묶고, 묶지 않으면 `unhold`로 푼다(참조가 없으면 내린다) */
export interface PreparedTestRunDrafts {
  /** 대화에 묶을 고정 초안들. `replaces`가 검토본의 실제 이름이다 */
  readonly marks: readonly FixedDraftMark[];
  /** 붙잡음을 푼다. 대화에 묶였으면 `bind`가 부르고, 못 만들었으면 호출자가 부른다 */
  readonly unhold: () => void;
}

export interface TestRunDraftsPort {
  /**
   * 초안을 검사하고 싣는다. 실패하면 아무것도 싣지 않는다(§4.8.1 1). 같은 플러그인의 다른 초안이 섞이거나 프로젝트 동반 플러그인이면
   * `draft_unavailable`이다(덧씌우기와 같다). 싣지 못하면 `draft_unavailable`로 돌려준다
   */
  prepare(refs: readonly TestRunDraftRef[]): Promise<Result<PreparedTestRunDrafts, OverlayRefusal>>;
  /** 싣은 초안을 대화에 묶고 붙잡음을 푼다(§4.8.1 2). 묶은 뒤 대화가 참조로 쥔다 */
  bind(threadId: ThreadId, prepared: readonly PreparedTestRunDrafts[]): Promise<void>;
}

export interface TestRunDraftsDeps {
  readonly targetOf: (
    name: string,
  ) => Promise<Result<OverlayTarget | undefined, PluginPortFailure>>;
  readonly draftOf: DraftLookup;
  /** 초안 싣기. 덧씌우기와 같은 로더를 쓴다 */
  readonly loadDrafts: DraftLoad;
  readonly pluginSet: {
    hold(names: readonly string[]): Promise<() => void>;
    setTestRunDrafts(threadId: ThreadId, marks: readonly FixedDraftMark[]): Promise<void>;
  };
}

export function createTestRunDrafts(deps: TestRunDraftsDeps): TestRunDraftsPort {
  return {
    async prepare(refs) {
      const planned = await planOverlay(
        refs.map((ref) => ({ plugin: ref.plugin, draftId: ref.draftId })),
        deps.targetOf,
        new Set(),
        deps.draftOf,
      );
      if (!planned.ok) return err(planned.error);
      const items = planned.value.flatMap((item) =>
        item.draft === undefined ? [] : [{ item, draft: item.draft }],
      );
      // 싣는 동안과 대화에 묶는 동안 내리기를 붙잡는다(같은 초안을 다른 대화가 내리는 경쟁을 막는다)
      const unhold = await deps.pluginSet.hold(items.map(({ draft }) => draft.internalName));
      const loaded = await deps.loadDrafts(
        items.map(({ item, draft }) => ({
          name: item.plugin,
          draftId: draft.draftId,
          contentHash: item.contentHash,
          tree: draft.tree,
        })),
      );
      if (!loaded.ok) {
        unhold();
        return err({ kind: "draft_unavailable", name: loaded.error.name });
      }
      return ok({
        marks: items.map(({ item, draft }) => ({
          plugin: draft.internalName,
          draftId: draft.draftId,
          contentHash: item.contentHash,
          replaces: item.plugin,
        })),
        unhold,
      });
    },
    async bind(threadId, prepared) {
      await deps.pluginSet.setTestRunDrafts(
        threadId,
        prepared.flatMap((part) => part.marks),
      );
      for (const part of prepared) part.unhold();
    },
  };
}
