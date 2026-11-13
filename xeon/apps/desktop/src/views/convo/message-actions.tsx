import {
  Button,
  IconButton,
  Popover,
  PopoverDescription,
  PopoverTitle,
  Tooltip,
} from "@caustic/react";
import { GitBranch, Pencil, RotateCcw, Undo2 } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow, type Result } from "@fresnel/contracts";
import type { ItemId, ThreadId } from "@fresnel/contracts/conversation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { cssPxOf, cssZoomOf } from "../../lib/zoom.ts";
import { messageCopyText, useItem, useOpenThreadRunning } from "../../state/engine/index.ts";
import type { CommandError } from "../commands.ts";
import { CopyButton } from "./markdown-body.tsx";

// 메시지 동작 줄(dzT2a 시안 9절, L4 desktop-ux §15.5). 복사, 다시 만들기, 여기서 갈라내기, 여기로 되감기, 고쳐서 다시 보내기.
// 평소에는 투명하고 그 메시지에 올리거나 초점이 들어오면 보인다(`.convo-actions`). 단추는 xs(24) 아이콘 단추이고 툴팁은 위.

/** 화면이 부르는 메시지 명령(`app/message-commands.ts`의 `MessageCommands`와 같은 모양). 시작할 때 main.tsx가 넣는다 */
export type MessageActionsPort = {
  forkAt(threadId: ThreadId, itemId: ItemId): Promise<Result<null, CommandError>>;
  rewindTo(threadId: ThreadId, itemId: ItemId): Promise<Result<null, CommandError>>;
  regenerate(threadId: ThreadId, itemId: ItemId): Promise<Result<null, CommandError>>;
};

export const MessageActionsContext: React.Context<MessageActionsPort | null> =
  createContext<MessageActionsPort | null>(null);

function useRun(): readonly [boolean, (work: () => Promise<unknown>) => void] {
  const [busy, setBusy] = useState(false);
  return [
    busy,
    (work) => {
      setBusy(true);
      detach(
        work().then(() => {
          setBusy(false);
          return undefined;
        }),
        rethrow,
      );
    },
  ] as const;
}

/**
 * 되감기 단추와 확인 팝오버. 파일 변경은 되돌리지 않는다는 말을 붙인다.
 * 팝오버는 단추 위로 열고 끝을 단추에 맞춘다(폭 280, caustic Popover md). 아래로 열면 바로 다음 말풍선을 덮는다(DP-147).
 * 위에 자리가 없으면(머리 줄 바로 아래의 첫 말) 아래로 뒤집지 않고 단추 왼쪽에 위 끝을 맞춰 연다(`rewindSideOf`)
 */
/** 되감기 확인 팝오버의 높이(제목, 두 줄 설명, 단추 줄, 안쪽 여백)와 단추 사이 간격을 합한 값. 단추 위에 이만큼 자리가 있어야 위로 연다 */
export const REWIND_POPOVER_ROOM_PX = 160;

/** 되감기 확인을 여는 쪽. `roomAbovePx`는 창 위 끝에서 단추 위 끝까지(CSS px, 화면 px이면 앱 확대로 나눠 넘긴다)다. 위에 자리가 없으면 왼쪽에 연다(다음 말풍선을 덮지 않게) */
export function rewindSideOf(roomAbovePx: number): "top" | "left" {
  return roomAbovePx >= REWIND_POPOVER_ROOM_PX ? "top" : "left";
}

function RewindButton(props: {
  readonly port: MessageActionsPort;
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
  readonly disabled: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<"top" | "left">("top");
  const anchor = useRef<HTMLButtonElement>(null);
  const [busy, run] = useRun();
  return (
    <Popover
      size="md"
      side={side}
      align={side === "top" ? "end" : "start"}
      open={open}
      onOpenChange={(next) => {
        // 여는 순간 단추 위 자리를 재어 쪽을 고른다. 잰 값은 화면 px이라 앱 확대로 나눈다(DP-173)
        const el = anchor.current;
        if (next && el !== null) {
          setSide(rewindSideOf(cssPxOf(el.getBoundingClientRect().top, cssZoomOf(el))));
        } else if (next) setSide(rewindSideOf(0));
        setOpen(next);
      }}
      anchor={
        <IconButton
          ref={anchor}
          size="xs"
          tone="ghost"
          label={
            props.disabled ? t("desktop.convo.actions.busy") : t("desktop.convo.actions.rewind")
          }
          disabled={props.disabled}
        >
          <Undo2 aria-hidden />
        </IconButton>
      }
    >
      <div className="grid gap-2">
        <PopoverTitle>{t("desktop.convo.actions.rewind.title")}</PopoverTitle>
        <PopoverDescription>{t("desktop.convo.actions.rewind.body")}</PopoverDescription>
        <div className="flex justify-end gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            {t("desktop.convo.cancel")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            loading={busy}
            onClick={() => {
              run(async () => {
                await props.port.rewindTo(props.threadId, props.itemId);
                setOpen(false);
              });
            }}
          >
            {t("desktop.convo.actions.rewind")}
          </Button>
        </div>
      </div>
    </Popover>
  );
}

function ForkButton(props: {
  readonly port: MessageActionsPort;
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
}): ReactNode {
  const [busy, run] = useRun();
  return (
    <Tooltip content={t("desktop.convo.actions.fork")} side="top">
      <IconButton
        size="xs"
        tone="ghost"
        label={t("desktop.convo.actions.fork")}
        disabled={busy}
        onClick={() => {
          run(() => props.port.forkAt(props.threadId, props.itemId));
        }}
      >
        <GitBranch aria-hidden />
      </IconButton>
    </Tooltip>
  );
}

/** 답의 동작: 복사, 다시 만들기, 갈라내기, 되감기 */
export function ReplyActions(props: {
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
}): ReactNode {
  const port = useContext(MessageActionsContext);
  const item = useItem(props.itemId);
  const running = useOpenThreadRunning();
  const [busy, run] = useRun();
  const text = item === undefined ? null : messageCopyText(item);
  return (
    <div className="convo-actions" role="group" aria-label={t("desktop.convo.actions.label")}>
      {text === null ? null : <CopyButton text={text} label={t("desktop.convo.actions.copy")} />}
      {port === null ? null : (
        <>
          <Tooltip
            content={
              running ? t("desktop.convo.actions.busy") : t("desktop.convo.actions.regenerate")
            }
            side="top"
          >
            <IconButton
              size="xs"
              tone="ghost"
              label={t("desktop.convo.actions.regenerate")}
              disabled={running || busy}
              onClick={() => {
                run(() => port.regenerate(props.threadId, props.itemId));
              }}
            >
              <RotateCcw aria-hidden />
            </IconButton>
          </Tooltip>
          <ForkButton port={port} threadId={props.threadId} itemId={props.itemId} />
          <RewindButton
            port={port}
            threadId={props.threadId}
            itemId={props.itemId}
            disabled={running}
          />
        </>
      )}
    </div>
  );
}

/** 사용자 말의 동작: 복사, 고쳐서 다시 보내기, 갈라내기, 되감기 */
export function UserActions(props: {
  readonly threadId: ThreadId;
  readonly itemId: ItemId;
  readonly text: string;
  /** 고쳐 보내기를 시작한다. 앞 item이 없어 되감을 수 없으면 null */
  readonly onEdit: (() => void) | null;
}): ReactNode {
  const port = useContext(MessageActionsContext);
  const running = useOpenThreadRunning();
  return (
    <div
      className="convo-actions justify-end"
      role="group"
      aria-label={t("desktop.convo.actions.label")}
    >
      {props.text === "" ? null : (
        <CopyButton text={props.text} label={t("desktop.convo.actions.copy")} />
      )}
      {props.onEdit === null || port === null ? null : (
        <Tooltip
          content={running ? t("desktop.convo.actions.busy") : t("desktop.convo.actions.edit")}
          side="top"
        >
          <IconButton
            size="xs"
            tone="ghost"
            label={t("desktop.convo.actions.edit")}
            disabled={running}
            onClick={props.onEdit}
          >
            <Pencil aria-hidden />
          </IconButton>
        </Tooltip>
      )}
      {port === null ? null : (
        <>
          <ForkButton port={port} threadId={props.threadId} itemId={props.itemId} />
          <RewindButton
            port={port}
            threadId={props.threadId}
            itemId={props.itemId}
            disabled={running}
          />
        </>
      )}
    </div>
  );
}
