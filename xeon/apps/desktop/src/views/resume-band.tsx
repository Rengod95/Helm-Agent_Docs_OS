import { Alert, Button, toast } from "@caustic/react";
import { RotateCcw } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { useOpenThread } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { resumeBandOf } from "./resume-band-model.ts";

// 트랜스크립트 끝의 "이어서 실행" 띠(시안 d01-chat-gaps ResumeBand, 스펙 SC-12).
// 강제 종료 뒤에는 이어서 실행 / 그대로 두기, 중단 뒤 대기 입력이 남았으면 보내기를 준다.

async function settle(
  action: Promise<{ readonly ok: boolean }>,
  setBusy: (busy: boolean) => void,
): Promise<void> {
  const done = await action;
  setBusy(false);
  if (!done.ok) toast({ tone: "danger", title: t("desktop.palette.action.failed") });
}

export function ResumeBand(): ReactNode {
  const thread = useOpenThread();
  const commands = useCommands();
  const [busy, setBusy] = useState(false);
  const view = resumeBandOf(thread);
  if (thread === undefined || view === null) return null;
  const { threadId } = thread;
  const run = (action: Promise<{ readonly ok: boolean }>): void => {
    setBusy(true);
    detach(settle(action, setBusy), rethrow);
  };
  if (view.kind === "held") {
    return (
      <Alert
        tone="info"
        emphasis="lead"
        icon={<RotateCcw />}
        action={
          <Button
            size="xs"
            variant="solid"
            loading={busy}
            onClick={() => {
              run(commands.resumeTurn(threadId));
            }}
          >
            {t("desktop.resumeBand.send.button")}
          </Button>
        }
      >
        <b>{t("desktop.resumeBand.held.title", { count: view.queued })}</b>{" "}
        {t("desktop.resumeBand.held.body")}
      </Alert>
    );
  }
  return (
    <Alert
      tone="warning"
      emphasis="lead"
      icon={<RotateCcw />}
      action={
        <span className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              run(commands.interrupt(threadId));
            }}
          >
            {t("desktop.resumeBand.leave.button")}
          </Button>
          <Button
            size="xs"
            variant="solid"
            loading={busy}
            onClick={() => {
              run(commands.resumeTurn(threadId));
            }}
          >
            {t("desktop.resumeBand.resume.button")}
          </Button>
        </span>
      }
    >
      <b>{t("desktop.resumeBand.crashed.title")}</b> {t("desktop.resumeBand.crashed.body")}
    </Alert>
  );
}
