// 크래프트 "새로 만들기"의 입구. 스토어의 `builder` 요청이 있으면 상자를 열어, 플러그인 빌더 상태에 맞는 문장 하나와 다음 동작 하나를 보인다.
// 켜져 있으면 새 대화를 열고(제작 대화), 꺼져 있으면 켜기 단추를, 켤 수 없으면 까닭을 문장으로 보인다. 아무 일도 없이 지나가는 길은 두지 않는다.
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import { Button, Dialog, DialogClose, toast } from "@caustic/react";
import type { ReactNode } from "react";
import { useLinkPhase } from "../../state/engine/index.ts";
import { useWorkbench, useWorkbenchActions } from "../../state/workbench/index.ts";
import { AUTHORING_EXT, builderOf, forwardStateOf } from "../compose/compose-code.tsx";
import { useCommands } from "../commands.ts";
import { useShowChat } from "../plugin/plugin-view.tsx";
import { tabLinkOf } from "./tab-read.ts";
import { lockText } from "./ext-row.tsx";
import type { WorkbenchController } from "./controller.ts";

type Forward = ReturnType<typeof forwardStateOf>;

export function builderSentenceOf(state: Forward): string {
  switch (state.kind) {
    case "make":
      return t("desktop.craft.builder.ready");
    case "enable":
      return t("desktop.craft.builder.off");
    case "missing":
      return t("desktop.craft.builder.missing");
    case "locked":
      return t("desktop.craft.builder.locked", { reason: lockText(state.lock) });
    case "offline":
      return t("desktop.craft.builder.offline");
    default:
      return assertNever(state, "BuilderEntry");
  }
}

export function BuilderEntry(props: { readonly controller: WorkbenchController }): ReactNode {
  const { controller } = props;
  const commands = useCommands();
  const actions = useWorkbenchActions();
  const showChat = useShowChat();
  const request = useWorkbench((s) => s.builder);
  const entries = useWorkbench((s) => s.entries);
  const link = tabLinkOf(useLinkPhase());
  const entry = entries.find((item) => item.name === AUTHORING_EXT);
  const enabling = entry?.status === "enabling";
  const base = forwardStateOf(link, builderOf(entry));
  // 켜기가 다음 단계 경계를 기다리는 중이면 새 대화가 그 경계를 만든다. 켜기에서 멈추지 않고 대화 열기로 간다(rtC R-3)
  const state: Forward = enabling && base.kind === "enable" ? { kind: "make" } : base;

  const open = (): void => {
    detach(
      commands.createThread().then((made) => {
        if (!made.ok) {
          toast({ tone: "danger", title: t("desktop.craft.builder.openFailed") });
          return undefined;
        }
        actions.closeBuilder();
        // 크래프트에서 열었으면 영역도 대화로 옮겨야 제작 대화가 보인다(rtC R-3)
        showChat();
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
          ) : state.kind === "enable" || state.kind === "locked" ? (
            <Button
              size="sm"
              disabled={state.kind !== "enable"}
              loading={enabling}
              onClick={() => {
                detach(controller.toggle(AUTHORING_EXT, true), rethrow);
              }}
            >
              {t("desktop.craft.builder.enable")}
            </Button>
          ) : null}
        </>
      }
    />
  );
}
