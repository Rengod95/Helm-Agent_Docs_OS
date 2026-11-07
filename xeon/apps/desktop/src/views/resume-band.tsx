import { Alert, Button, toast } from "@caustic/react";
import { RotateCcw } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { useApprovalMirror, useOpenThread, useQueuedInputs } from "../state/engine/index.ts";
import { useEngineTarget } from "../state/ui/index.ts";
import { useCommands } from "./commands.ts";
import { chipInputs } from "./composer-model.ts";
import { crashedBodyOf, resumeBandClosed, resumeBandOf } from "./resume-band-model.ts";

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
  const target = useEngineTarget();
  const [busy, setBusy] = useState(false);
  // 이어서 실행이 시작된 turn. 실행이 시작되면 같은 복구 표식의 띠는 닫는다(표식은 turn이 끝나야 지워진다)
  const [resumedTurn, setResumedTurn] = useState<string | null>(null);
  // 숨은 내부 입력(`display: false`)은 칩처럼 띠의 수에서도 뺀다
  const queued = chipInputs(useQueuedInputs(thread?.threadId ?? null));
  const mirror = useApprovalMirror();
  const listed = mirror.ids.filter((id) => mirror.byId[id]?.threadId === thread?.threadId).length;
  const view = resumeBandOf(thread, queued.length, Math.max(listed, thread?.pendingApprovals ?? 0));
  if (thread === undefined || view === null) return null;
  const { threadId } = thread;
  if (resumeBandClosed(view, resumedTurn)) return null;
  const run = (action: Promise<{ readonly ok: boolean }>): void => {
    setBusy(true);
    detach(settle(action, setBusy), rethrow);
  };
  // 이어서 실행이 실제로 시작되면(status "resumed") 이 표식의 띠를 닫는다
  const resume = (): void => {
    run(
      commands.resumeTurn(threadId).then((result) => {
        if (result.ok && result.value.status === "resumed" && view.kind === "crashed") {
          setResumedTurn(view.turnId);
        }
        return result;
      }),
    );
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
          <Button size="xs" variant="solid" loading={busy} onClick={resume}>
            {t("desktop.resumeBand.resume.button")}
          </Button>
        </span>
      }
    >
      <b>{t("desktop.resumeBand.crashed.title")}</b> {t(crashedBodyOf(target.kind === "remote"))}
    </Alert>
  );
}
