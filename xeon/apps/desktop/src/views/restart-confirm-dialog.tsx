// 다시 시작 확인(U-02)과 다시 시작 단추(U-02, U-06). 진행 중인 턴이나 대기 승인이 있으면 멈추는 것을 경고로 보이게 적고, 기본 초점은 "나중에"다.
// 단추는 상태 표시줄, 설치 결과, 안전 모드 카드와 칩이 같이 쓴다. 설명은 호출하는 쪽이 정보 아이콘에 둔다(DP-58).
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { Button, Dialog, DialogAction, DialogClose, toast } from "@caustic/react";
import { useState, type ReactNode } from "react";
import { useApprovalCount, useEngineState, useRunningCount } from "../state/engine/index.ts";
import type { RestartOptions } from "../transport/ipc.ts";
import { useCommands } from "./commands.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { canRestartNowOf, restartConfirmOf } from "./restart-model.ts";
import { useShellRestart } from "./shell-restart-context.ts";

function RestartConfirmDialog(props: {
  readonly open: boolean;
  readonly turns: number;
  readonly approvals: number;
  /** 확인 단추의 글. 누른 단추와 같은 글을 쓴다 */
  readonly confirmLabel: MessageId;
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
            {t(props.confirmLabel)}
          </DialogAction>
        </>
      }
    />
  );
}

/** 다시 시작 단추 하나: 글, 모양, 셸에 보낼 옵션. `id`는 같은 묶음에서 보내는 중인 단추를 가리는 데 쓴다 */
export interface RestartChoice {
  readonly id: string;
  readonly label: MessageId;
  readonly variant: "solid" | "outline";
  readonly options: RestartOptions;
}

/**
 * 다시 시작 단추 묶음. 멈출 턴이나 승인이 없으면 바로 다시 시작하고, 있으면 확인 대화 상자를 먼저 묻는다(기본 초점 "나중에").
 * 보내는 동안 누른 단추에 로딩을 주고 나머지는 누를 수 없다. 셸이 거절하면 실패 토스트를 띄운다.
 * `allowed`가 거짓이면 단추는 보이지만 누를 수 없다(엔진이 다시 띄울 상태가 아닐 때).
 */
export function RestartButtons(props: {
  readonly choices: readonly RestartChoice[];
  readonly size: "xs" | "sm";
  readonly allowed: boolean;
}): ReactNode {
  const commands = useCommands();
  const turns = useRunningCount();
  const approvals = useApprovalCount();
  const [sending, setSending] = useState<string | null>(null);
  const [asking, setAsking] = useState<RestartChoice | null>(null);
  const run = async (choice: RestartChoice): Promise<void> => {
    setSending(choice.id);
    const restarted = await commands.restartEngine(choice.options);
    setSending(null);
    if (!restarted) toast({ tone: "danger", title: t("desktop.restart.failed") });
  };
  const start = (choice: RestartChoice): void => {
    if (restartConfirmOf(turns, approvals).needed) setAsking(choice);
    else detach(run(choice), rethrow);
  };
  return (
    <>
      {props.choices.map((choice) => (
        <Button
          key={choice.id}
          size={props.size}
          variant={choice.variant}
          loading={sending === choice.id}
          disabled={!props.allowed || sending !== null}
          onClick={() => {
            start(choice);
          }}
        >
          {t(choice.label)}
        </Button>
      ))}
      <RestartConfirmDialog
        open={asking !== null}
        turns={turns}
        approvals={approvals}
        confirmLabel={asking?.label ?? "desktop.restart.now"}
        onCancel={() => {
          setAsking(null);
        }}
        onConfirm={() => {
          const choice = asking;
          setAsking(null);
          if (choice !== null) detach(run(choice), rethrow);
        }}
      />
    </>
  );
}

const NOW: RestartChoice = {
  id: "now",
  label: "desktop.restart.now",
  variant: "outline",
  options: { confirmed: true },
};

/**
 * "지금 다시 시작" 단추. 셸이 없거나 엔진이 running이 아니면 아무것도 그리지 않는다.
 * `info`를 주면 단추 옆에 정보 아이콘을 두고 그 글을 넣는다(단추가 보일 때만).
 */
export function RestartNowButton(props: {
  readonly size: "xs" | "sm";
  readonly info?: string | undefined;
}): ReactNode {
  const engine = useEngineState();
  const shellRestart = useShellRestart();
  if (!canRestartNowOf(engine?.kind ?? null, shellRestart)) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <RestartButtons choices={[NOW]} size={props.size} allowed />
      {props.info === undefined ? null : <InfoTip text={props.info} />}
    </span>
  );
}
