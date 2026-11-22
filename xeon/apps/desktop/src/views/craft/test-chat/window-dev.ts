// 개발 빌드에서만 쓰는 드래프트 줄 표본. 창 머리의 개발 메뉴(꼴 전환기 옆)가 고른다. 릴리스 빌드에서는 늘 실제 엔진 값이다.
// 빌더가 실제로 드래프트를 만드는 데는 진짜 모델이 필요해서, 스크린샷과 배치 확인을 위한 장면을 둔다.
import type { MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { DraftInfo } from "@fresnel/contracts/wire";
import { BUILD_CHECKS } from "../../../app/build.ts";
import type { DraftRow } from "./window-model.ts";

export type DevDraftScene = "live" | "draft" | "inReview";

export const DEV_DRAFT_SCENES: readonly {
  readonly id: DevDraftScene;
  readonly label: MessageId;
}[] = [
  { id: "live", label: "desktop.craft.testChat.dev.draft.live" },
  { id: "draft", label: "desktop.craft.testChat.dev.draft.draft" },
  { id: "inReview", label: "desktop.craft.testChat.dev.draft.inReview" },
];

function sampleDraft(threadId: string, submittedItemId: string | null): DraftInfo {
  return {
    draftId: "drf_sample",
    name: "repo-guard",
    contentHash: "sha256:3f2a91c4d0e8b7a65c1f2e3d4b5a69788091a2b3c4d5e6f708192a3b4c5d6e7f",
    parent: null,
    createdAt: "2026-11-22T09:00:00.000Z",
    originThreadId: threadId,
    label: null,
    submittedItemId,
  };
}

/** 고른 장면의 드래프트 줄. 실제 값을 쓸 때(장면 "실제", 릴리스 빌드)는 null이다 */
export function devDraftRowOf(scene: DevDraftScene, threadId: string): DraftRow | null {
  if (!BUILD_CHECKS) return null;
  switch (scene) {
    case "live":
      return null;
    case "draft":
      return { kind: "draft", draft: sampleDraft(threadId, null) };
    case "inReview":
      return { kind: "inReview", draft: sampleDraft(threadId, "rvw_sample"), itemId: "rvw_sample" };
    default:
      return assertNever(scene, "DevDraftScene");
  }
}
