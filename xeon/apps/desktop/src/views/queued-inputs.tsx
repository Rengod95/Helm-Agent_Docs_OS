import { Badge, Button, Tooltip, toast } from "@caustic/react";
import { Clock, CornerUpRight, MessageCircle, Pause, Plus } from "@caustic/react/icons";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useState, type ReactNode } from "react";
import { useOpenThread, useQueuedInputs, type QueuedInput } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { Presence, PresenceItem, PresenceList } from "../lib/motion-presets.tsx";
import {
  chipInputs,
  heldCountOf,
  queuedModeText,
  startableQueuedMode,
  queuedPreviewText,
  steerableQueuedMode,
  withdrawStateOf,
  type WithdrawState,
} from "./composer-model.ts";
import { InfoTip } from "./craft/info-tip.tsx";

// 입력창 위의 대기 입력 칩. 실행 중에 보낸 입력이 아직 모델에 전달되기 전이면 칩으로 보이고, 철회 단추가 `turn.withdraw`를 부른다.
// 칩은 거울의 `input.queued` 사실로 생기고 `input.placed`·`input.withdrawn`으로 사라진다. 철회 상태는 칩마다 따로 든다.

/**
 * 대기 행의 꼬리표(DP-101, DP-156): 끼워 넣기(steer, 다음 도구 라운드 뒤)는 강조 꼬리표, 끝나면(followUp)·다음에 함께(next)·곁 요청(aside)은
 * 테두리 꼬리표. next는 스스로 턴을 열지 않고 다음 메시지에 붙으므로 "끝나면"이라 하지 않는다. 멈춘 뒤 보내기를 기다리는
 * 시작 가능 입력(`held`)은 더는 "끝나면"이 아니라 "멈춤"이다. 자세한 뜻은 꼬리표 툴팁(`queuedModeText`)에 있다
 */
function queuedTagOf(
  mode: QueuedInput["mode"],
  held: boolean,
): {
  readonly kind: "steer" | "followUp" | "next" | "aside" | "held";
  readonly label: MessageId;
  readonly icon: ReactNode;
} {
  if (held && startableQueuedMode(mode)) {
    return {
      kind: "held",
      label: "desktop.composer.queue.tag.held",
      icon: <Pause aria-hidden className="size-3" />,
    };
  }
  switch (mode) {
    case "steer":
      return {
        kind: "steer",
        label: "desktop.composer.queue.tag.steer",
        icon: <CornerUpRight aria-hidden className="size-3" />,
      };
    case "followUp":
      return {
        kind: "followUp",
        label: "desktop.composer.queue.tag.followUp",
        icon: <Clock aria-hidden className="size-3" />,
      };
    case "next":
      return {
        kind: "next",
        label: "desktop.composer.queue.tag.next",
        icon: <Plus aria-hidden className="size-3" />,
      };
    case "aside":
      return {
        kind: "aside",
        label: "desktop.composer.queue.tag.aside",
        icon: <MessageCircle aria-hidden className="size-3" />,
      };
    default:
      return assertNever(mode, "QueuedInput.mode");
  }
}

/** 칩 하나의 철회 상태에서 단추와 상태 글을 정한다 */
function chipControls(state: WithdrawState): {
  readonly busy: boolean;
  readonly locked: boolean;
  readonly retry: boolean;
} {
  switch (state.status) {
    case "idle":
      return { busy: false, locked: false, retry: false };
    case "withdrawing":
      return { busy: true, locked: true, retry: false };
    case "withdrawn":
    case "placed":
      return { busy: false, locked: true, retry: false };
    case "failed":
      return { busy: false, locked: false, retry: true };
    default:
      return assertNever(state, "WithdrawState");
  }
}

function QueuedChip(props: {
  readonly input: QueuedInput;
  readonly threadId: ThreadId;
  readonly disabled: boolean;
  /** 대화가 멈춘 뒤 보내기를 기다린다(DP-156) */
  readonly held: boolean;
  /** 이 입력을 지금 반영할 수 있는가(이 입력창이 보낸 끝난 뒤 입력) */
  readonly steerable: boolean;
  readonly onSteerNow: (requestId: string) => Promise<WithdrawState>;
}): ReactNode {
  const commands = useCommands();
  const [state, setState] = useState<WithdrawState>({ status: "idle" });
  const text = queuedPreviewText(props.input.preview);
  const controls = chipControls(state);

  const withdraw = async (): Promise<void> => {
    setState({ status: "withdrawing" });
    const result = await commands.withdrawInput(props.threadId, props.input.requestId);
    setState(withdrawStateOf(result));
  };

  const steerNow = async (): Promise<void> => {
    setState({ status: "withdrawing" });
    setState(await props.onSteerNow(props.input.requestId));
  };
  // 멈춘 뒤에는 도는 턴이 없어 "지금 반영"이 뜻이 없다: 머리의 보내기가 맡는다
  const canSteer = props.steerable && !props.held && steerableQueuedMode(props.input.mode);

  const tag = queuedTagOf(props.input.mode, props.held);
  const modeText = queuedModeText(props.input.mode, props.held);
  return (
    <div
      data-status={state.status}
      data-queued-mode={tag.kind}
      className="flex h-8 min-w-0 items-center gap-2 rounded-lg bg-neutral-well ps-2 pe-1"
    >
      <Tooltip content={modeText} side="top" align="start" delayDuration={400}>
        <Badge
          size="sm"
          variant={tag.kind === "steer" ? "soft" : "outline"}
          className={`shrink-0 gap-1 ${tag.kind === "steer" ? "bg-accent-soft text-accent-text" : ""}`}
        >
          {tag.icon}
          {t(tag.label)}
        </Badge>
      </Tooltip>
      <span className="sr-only">{modeText}</span>
      <span className="min-w-0 flex-1 truncate text-ui text-text-primary" title={text}>
        {text}
      </span>
      {state.status === "placed" ? (
        <span role="status" className="shrink-0 text-ui-sm text-text-tertiary">
          {t("desktop.composer.queue.withdraw.placed")}
        </span>
      ) : null}
      {state.status === "withdrawn" ? (
        <span role="status" className="shrink-0 text-ui-sm text-text-tertiary">
          {t("desktop.composer.queue.withdraw.done")}
        </span>
      ) : null}
      {state.status === "failed" ? (
        <span role="alert" className="shrink-0 text-ui-sm text-danger-text">
          {state.message}
        </span>
      ) : null}
      {canSteer ? (
        <Button
          size="xs"
          variant="ghost"
          data-queued-steer-now
          disabled={props.disabled || controls.locked}
          aria-label={t("desktop.composer.queue.steerNow.ariaLabel", { text })}
          onClick={() => {
            detach(steerNow(), rethrow);
          }}
        >
          {t("desktop.composer.queue.steerNow.button")}
        </Button>
      ) : null}
      <Button
        size="xs"
        variant="ghost"
        loading={controls.busy}
        disabled={props.disabled || controls.locked}
        aria-label={t("desktop.composer.queue.withdraw.ariaLabel", { text })}
        onClick={() => {
          detach(withdraw(), rethrow);
        }}
      >
        {controls.retry
          ? t("desktop.composer.queue.withdraw.retry")
          : t("desktop.composer.queue.withdraw.button")}
      </Button>
    </div>
  );
}

/** 이 대화의 대기 입력 칩 목록. 칩이 없으면 아무것도 그리지 않는다 */
export function QueuedInputs(props: {
  readonly threadId: ThreadId;
  readonly disabledReason: string | null;
  /** 이 요청 id의 입력을 지금 반영할 수 있는가. 입력창이 보낸 내용을 기억하는 입력만이다 */
  readonly steerable: (requestId: string) => boolean;
  /** "지금 반영" 단추. 철회하고 바로 반영으로 다시 보낸 뒤의 칩 상태를 돌려준다 */
  readonly onSteerNow: (requestId: string) => Promise<WithdrawState>;
}): ReactNode {
  const chips = chipInputs(useQueuedInputs(props.threadId));
  const held = useHeldCount(props.threadId, chips);
  // 마지막 칩이 빠지면 머리와 함께 띠가 내려가며 사라진다(옛 내용은 Presence가 든다)
  return (
    <Presence show={chips.length > 0} variant="band" initial={false}>
      {chips.length === 0 ? null : <QueuedList {...props} chips={chips} held={held} />}
    </Presence>
  );
}

/** 열린 대화가 이 대화일 때, 멈춘 뒤 보내기를 기다리는 대기 입력 수(DP-156, `heldCountOf`) */
export function useHeldCount(threadId: ThreadId, chips: readonly QueuedInput[]): number {
  const thread = useOpenThread();
  return heldCountOf(thread?.threadId === threadId ? thread : undefined, chips);
}

/**
 * 멈춘 뒤 대기 입력을 시작한다(`turn.resume`: 열린 턴이 없으면 큐로 새 턴을 연다, L1.loop.spec §4.4). 실패하면 토스트로 말한다.
 * 목록 머리의 보내기와 빈 입력창의 보내기 단추가 같이 쓴다
 */
export function useSendHeld(threadId: ThreadId): {
  readonly busy: boolean;
  readonly send: () => void;
} {
  const commands = useCommands();
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<void> => {
    const result = await commands.resumeTurn(threadId);
    setBusy(false);
    if (!result.ok) toast({ tone: "danger", title: t("desktop.palette.action.failed") });
  };
  const send = (): void => {
    if (busy) return;
    setBusy(true);
    detach(run(), rethrow);
  };
  return { busy, send };
}

function QueuedList(props: {
  readonly threadId: ThreadId;
  readonly chips: readonly QueuedInput[];
  readonly held: number;
  readonly disabledReason: string | null;
  readonly steerable: (requestId: string) => boolean;
  readonly onSteerNow: (requestId: string) => Promise<WithdrawState>;
}): ReactNode {
  const { chips } = props;
  const sendHeld = useSendHeld(props.threadId);
  const held = props.held > 0;
  // 머리 한 줄이 수를 한 번 말한다(DP-156). 멈춘 뒤면 같은 줄 오른쪽 끝에 이유와 보내기를 둔다: 대화 열 밖 띠가 같은 수를 되풀이하지 않는다.
  // 보내기의 오른쪽 끝은 칩의 철회 단추 끝(칩 안쪽 4)과 맞춘다
  return (
    <div className="grid gap-1">
      <div
        className={`flex items-center gap-1 ps-1 pe-1 text-ui-sm text-text-tertiary ${held ? "h-6" : "h-5"}`}
        data-queue-head={held ? "held" : "queued"}
      >
        <span>{t("term.inputQueue")}</span>
        <span>{chips.length}</span>
        <InfoTip text={t("desktop.composer.queue.info")} />
        {held ? (
          <>
            <span role="status" className="ms-auto min-w-0 truncate pe-1 text-text-secondary">
              {t("desktop.composer.queue.held.note")}
            </span>
            <Button
              size="xs"
              variant="soft"
              loading={sendHeld.busy}
              disabled={props.disabledReason !== null}
              aria-label={t("desktop.composer.queue.held.sendLabel", { count: props.held })}
              onClick={sendHeld.send}
            >
              {t("desktop.composer.queue.held.send")}
            </Button>
          </>
        ) : null}
      </div>
      {/* 칩이 들어올 때 높이가 열리며 떠오르고, 철회·반영되면 높이를 접으며 사라진다(dzM2 시안 §8) */}
      <ul aria-label={t("term.inputQueue")} className="m-0 grid list-none gap-1 p-0">
        <PresenceList>
          {chips.map((input) => (
            <PresenceItem key={input.inputId} as="li">
              <QueuedChip
                input={input}
                threadId={props.threadId}
                disabled={props.disabledReason !== null}
                held={held}
                steerable={props.steerable(input.requestId)}
                onSteerNow={props.onSteerNow}
              />
            </PresenceItem>
          ))}
        </PresenceList>
      </ul>
    </div>
  );
}
