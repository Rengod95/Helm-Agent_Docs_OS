// 크래프트 "새로 만들기"의 입구. 스토어의 `builder` 요청이 있으면 상자를 열어, 플러그인 빌더 상태에 맞는 문장 하나와 다음 동작 하나를 보인다.
// 빌더는 크래프트에서 늘 켜 둔 기본 기능이라 켜기 단추는 없다. 만들 수 있으면 새 대화를 열고, 관리자가 껐거나 목록에 없거나 연결이 없으면 까닭을 문장으로 보인다.
// 아무 일도 없이 지나가는 길은 두지 않는다.
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { Button, Dialog, DialogClose, toast } from "@caustic/react";
import type { ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { AUTHORING_EXT, forwardStateOf, type ForwardState } from "./builder-state.ts";
import { useFolderPick } from "../folder-pick-context.ts";
import { useStartNewThread } from "../new-thread-flow.ts";
import { tabLinkOf } from "./tab-read.ts";

export function builderSentenceOf(state: ForwardState): string {
  switch (state.kind) {
    case "make":
      return t("desktop.craft.builder.ready");
    case "missing":
      return t("desktop.craft.builder.missing");
    case "locked":
      return t("desktop.craft.builder.locked");
    case "offline":
      return t("desktop.craft.builder.offline");
    default:
      return assertNever(state, "BuilderEntry");
  }
}

export function BuilderEntry(): ReactNode {
  const actions = useWorkbenchActions();
  const startThread = useStartNewThread(useFolderPick() ?? undefined);
  const request = useWorkbench((s) => s.builder);
  const entries = useWorkbench((s) => s.entries);
  const link = tabLinkOf(useLinkPhase());
  const state = forwardStateOf(
    link,
    entries.find((item) => item.name === AUTHORING_EXT),
  );

  // 새 대화를 여는 길은 하나다(R5). 보던 대화에 작업 폴더가 있으면 그 폴더에서, 없으면 폴더 고르기 창을 먼저 연다.
  // 제작 대화가 폴더 없이 열려 상대 경로로 막히지 않게 한다(취소하면 아무것도 만들지 않고 상자는 그대로 둔다)
  const open = (): void => {
    detach(
      startThread().then((made) => {
        if (made.kind === "failed" || made.kind === "pickFailed") {
          toast({ tone: "danger", title: t("desktop.craft.builder.openFailed") });
          return undefined;
        }
        if (made.kind === "cancelled" || made.kind === "busy") return undefined;
        actions.closeBuilder();
        toast({ tone: "success", title: t("desktop.craft.builder.opened") });
        return undefined;
      }),
      rethrow,
    );
  };

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(next) => {
        if (!next) actions.closeBuilder();
      }}
      title={t("desktop.craft.builder.title")}
      description={builderSentenceOf(state)}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              {t("desktop.craft.builder.close")}
            </Button>
          </DialogClose>
          {state.kind === "make" ? (
            <Button size="sm" onClick={open}>
              {t("desktop.craft.builder.start")}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
