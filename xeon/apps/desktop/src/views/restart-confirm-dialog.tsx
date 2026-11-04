// 다시 시작 확인(U-02). 진행 중인 턴이나 대기 승인이 있으면 멈추는 것을 경고로 보이게 적고, 기본 초점은 "나중에"다.
// "지금 다시 시작" 단추는 상태 표시줄과 설치 결과가 같이 쓴다. 설명은 호출하는 쪽이 정보 아이콘에 둔다(DP-58).
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Button, Dialog, DialogAction, DialogClose, toast } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useApprovalCount, useEngineState, useRunningCount } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { canRestartNowOf, restartConfirmOf } from "./restart-model.ts";
import { useShellRestart } from "./shell-restart-context.ts";

function RestartConfirmDialog(props: {
  readonly open: boolean;
  readonly turns: number;
  readonly approvals: number;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}): ReactNode {
  const confirm = restartConfirmOf(props.turns, props.approvals);
  return (
    <Dialog
      kind="alert"
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={t("desktop.restart.confirm.title")}
      description={confirm.lines.map((line) => (
        <span key={line.id} className="block">
          {t(line.id, { count: line.count })}
        </span>
      ))}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.restart.later")}
            </Button>
          </DialogClose>
          <DialogAction
            onClick={() => {
              props.onConfirm();
            }}
          >
            {t("desktop.restart.now")}
          </DialogAction>
        </>
      }
    />
  );
}

/**
 * "지금 다시 시작" 단추와 확인 대화 상자. 셸이 없거나 엔진이 running이 아니면 아무것도 그리지 않는다.
 * 멈출 턴이나 승인이 없으면 바로 다시 시작하고, 있으면 확인을 먼저 묻는다. 둘 다 `confirmed: true`로 부른다.
 * `info`를 주면 단추 옆에 정보 아이콘을 두고 그 글을 넣는다(단추가 보일 때만).
 */
export function RestartNowButton(props: {
  readonly size: "xs" | "sm";
  readonly info?: string | undefined;
}): ReactNode {
  const commands = useCommands();
  const engine = useEngineState();
  const shellRestart = useShellRestart();
  const turns = useRunningCount();
  const approvals = useApprovalCount();
  const [confirming, setConfirming] = useState(false);
  if (!canRestartNowOf(engine?.kind ?? null, shellRestart)) return null;
  const restart = async (): Promise<void> => {
    const restarted = await commands.restartEngine({ confirmed: true });
    if (!restarted) toast({ tone: "danger", title: t("desktop.restart.failed") });
  };
  return (
    <>
      <span className="inline-flex items-center gap-1">
        <Button
          size={props.size}
          variant="outline"
          onClick={() => {
            if (restartConfirmOf(turns, approvals).needed) setConfirming(true);
            else detach(restart(), rethrow);
          }}
        >
          {t("desktop.restart.now")}
        </Button>
        {props.info === undefined ? null : <InfoTip text={props.info} />}
      </span>
      <RestartConfirmDialog
        open={confirming}
        turns={turns}
        approvals={approvals}
        onCancel={() => {
          setConfirming(false);
        }}
        onConfirm={() => {
          setConfirming(false);
          detach(restart(), rethrow);
        }}
      />
    </>
  );
}
