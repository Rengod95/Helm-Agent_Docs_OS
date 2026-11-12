import { Button, Message, Textarea } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import type { ItemId, JsonObject, JsonValue, ThreadId } from "@fresnel/contracts/conversation";
import {
  Fragment,
  memo,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cardOf, provenanceOf } from "../../plugin-ui/placements.ts";
import {
  useHasToolCall,
  useItem,
  useOpenThreadId,
  usePartText,
  useStreamingItem,
} from "../../state/engine/index.ts";
import type { ShapeBlock } from "../../state/engine/index.ts";
import { bubbleOf } from "../attachment-bubble-model.ts";
import { useCommands } from "../commands.ts";
import { MessageAttachments } from "../message-attachments.tsx";
import { EntrySurface } from "../plugin/plugin-view.tsx";
import { usePluginUiState } from "../plugin/plugin-context.tsx";
import { citedLinksOf } from "../tool-extras-model.ts";
import { MarkdownBody } from "./markdown-body.tsx";
import { MessageActionsContext, UserActions } from "./message-actions.tsx";
import { SourceChips } from "./source-chips.tsx";
import { ThinkingBlock } from "./thinking-block.tsx";
import { ToolLine } from "./tool-line.tsx";
import { toolHeadOf } from "./tool-view-model.ts";

// 메시지 줄(dzT2a 시안 3.1, 3.2, 9, 11절): 사용자 말, 답(글·생각), 진행 중 글, 확장 카드.
// 답 줄은 확정 전과 뒤가 같은 부품(`ReplyRow`)이다. 줄 키도 같아(item id) 확정될 때 다시 마운트되지 않는다.

/**
 * 사용자 말풍선: 채움 없는 outlined(`border-subtle` 1px), 글은 답과 같은 15/23. 오른쪽 정렬, 최대 폭 열의 85%.
 * 아래에 동작 줄(올리거나 초점이 들어오면 보임)이 붙는다. "고쳐서 다시 보내기"는 말풍선 자리에서 바로 고친다.
 */
const BUBBLE_CLASS =
  "max-w-[85%] whitespace-pre-wrap [overflow-wrap:anywhere] text-voice-sm bg-transparent px-2.5 py-1.5 shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]";

function EditBox(props: {
  readonly text: string;
  readonly onCancel: () => void;
  readonly onSend: (text: string) => Promise<void>;
}): ReactNode {
  const [value, setValue] = useState(props.text);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
  }, []);
  const send = (): void => {
    if (value.trim() === "" || busy) return;
    setBusy(true);
    detach(
      props.onSend(value).then(() => {
        setBusy(false);
        return undefined;
      }),
      rethrow,
    );
  };
  return (
    <div className="grid w-full justify-items-end gap-2">
      <Textarea
        ref={ref}
        size="sm"
        aria-label={t("desktop.convo.actions.edit")}
        value={value}
        className="w-full"
        onChange={(event) => {
          setValue(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            props.onCancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
        }}
      />
      <div className="flex gap-1.5">
        <Button size="sm" variant="ghost" onClick={props.onCancel}>
          {t("desktop.convo.cancel")}
        </Button>
        <Button
          size="sm"
          variant="solid"
          loading={busy}
          disabled={value.trim() === ""}
          onClick={send}
        >
          {t("desktop.convo.actions.editSend")}
        </Button>
      </div>
    </div>
  );
}

export function UserRow(props: {
  readonly threadId: ThreadId;
  readonly id: ItemId;
  /** 바로 앞 item. 고쳐 보낼 때 여기까지 되감는다. 없으면 고쳐 보내기를 두지 않는다 */
  readonly prevId: ItemId | null;
  /** 응답 없이 끝난 말이면 "보내지 못함"과 다시 보내기 */
  readonly unsent: boolean;
}): ReactNode {
  const item = useItem(props.id);
  const port = useContext(MessageActionsContext);
  const commands = useCommands();
  const [editing, setEditing] = useState(false);
  if (item?.kind !== "user") return null;
  const bubble = bubbleOf(item.message.content);
  const prevId = props.prevId;
  return (
    <div className="grid justify-items-end gap-1">
      {editing ? (
        <EditBox
          text={bubble.text}
          onCancel={() => {
            setEditing(false);
          }}
          onSend={async (text) => {
            if (port === null || prevId === null) return;
            const rewound = await port.rewindTo(props.threadId, prevId);
            if (!rewound.ok) return;
            await commands.sendTurn(props.threadId, text, crypto.randomUUID());
            setEditing(false);
          }}
        />
      ) : (
        <>
          {bubble.text === "" ? null : (
            <Message author="user" className={BUBBLE_CLASS}>
              {bubble.text}
            </Message>
          )}
          <MessageAttachments attachments={bubble.attachments} />
          {props.unsent ? <UnsentNote threadId={props.threadId} text={bubble.text} /> : null}
          <UserActions
            threadId={props.threadId}
            itemId={props.id}
            text={bubble.text}
            onEdit={
              prevId === null
                ? null
                : () => {
                    setEditing(true);
                  }
            }
          />
        </>
      )}
    </div>
  );
}

/** 응답 없이 끝난 말 아래의 표식과 다시 보내기 */
function UnsentNote(props: { readonly threadId: ThreadId; readonly text: string }): ReactNode {
  const commands = useCommands();
  const [busy, setBusy] = useState(false);
  return (
    <footer
      className="flex items-center justify-end gap-2 text-ui text-text-tertiary"
      data-unsent="true"
    >
      <span>{t("desktop.item.unsent")}</span>
      {props.text === "" ? null : (
        <Button
          size="xs"
          variant="outline"
          loading={busy}
          onClick={() => {
            setBusy(true);
            detach(
              commands.sendTurn(props.threadId, props.text, crypto.randomUUID()).then(() => {
                setBusy(false);
                return undefined;
              }),
              rethrow,
            );
          }}
        >
          {t("desktop.turnFailure.action.resend")}
        </Button>
      )}
    </footer>
  );
}

/** 진행 중 파트 글 하나. 델타는 이 부품만 다시 그린다 */
const LivePart = memo(function LivePart(props: {
  readonly id: ItemId;
  readonly index: number;
  readonly kind: string;
  readonly live: boolean;
}): ReactNode {
  const text = usePartText(props.id, props.index);
  if (props.kind === "thinking") return <ThinkingBlock text={text} live={props.live} />;
  return (
    <Message size="sm" streaming={props.live}>
      <MarkdownBody text={text} streaming={props.live} />
      {props.live ? <span aria-hidden className="transcript-caret" /> : null}
    </Message>
  );
});

/** 확정된 답의 글·생각 블록 */
function RecordedReply(props: {
  readonly id: ItemId;
  readonly blocks: readonly ShapeBlock[];
}): ReactNode {
  const item = useItem(props.id);
  if (item?.kind !== "assistant") return null;
  // 끊기거나 실패한 답이면 그 item의 마지막 글 블록이 든 줄 아래에 조용한 상태 줄을 한 번 단다
  const stopped = item.status === "failed" || item.status === "interrupted";
  const lastIndex = item.message.content.findLastIndex(
    (block) => block.type === "text" || block.type === "thinking",
  );
  const showStatus = stopped && props.blocks.some((shape) => shape.index === lastIndex);
  return (
    <>
      {showStatus ? (
        <p className="convo-note order-last" data-status={item.status}>
          {item.status === "failed"
            ? t("desktop.item.status.failed")
            : t("desktop.item.status.interrupted")}
        </p>
      ) : null}
      {props.blocks.map((shape) => {
        const block = item.message.content[shape.index];
        const key = item.partIds[shape.index] ?? `${props.id}:${shape.index}`;
        if (block?.type === "thinking") return <ThinkingBlock key={key} text={block.thinking} />;
        if (block?.type !== "text") return null;
        return (
          <Fragment key={key}>
            <Message size="sm">
              <MarkdownBody text={block.text} />
            </Message>
            <SourceChips sources={citedLinksOf(block.text, 6)} indent={false} />
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * 답 줄. 확정 기록이 있으면 그것을, 없으면 진행 중 item을 그린다. 같은 키·같은 부품이라 확정될 때 다시 마운트되지 않는다.
 * 진행 중 도구 호출 item(호출 줄이 아직 없을 때)은 실행 중 도구 줄 하나다.
 */
export function ReplyRow(props: {
  readonly id: ItemId;
  readonly blocks: readonly ShapeBlock[] | null;
}): ReactNode {
  const recorded = useItem(props.id);
  const streaming = useStreamingItem(props.id);
  const openThreadId = useOpenThreadId();
  const hasCallRow = useHasToolCall(streaming?.toolCallId ?? "");
  if (recorded !== undefined && props.blocks !== null)
    return <RecordedReply id={props.id} blocks={props.blocks} />;
  // 진행 목록은 모든 대화의 것을 담는다. 열린 대화의 것만 그린다
  if (streaming === undefined || streaming.threadId !== openThreadId) return null;
  if (streaming.kind === "toolCall") {
    if (hasCallRow) return null;
    const name = streaming.toolName ?? "";
    const head = toolHeadOf(name, {}, null);
    return (
      <ToolLine
        icon={head.icon}
        verb={head.verbRunning}
        rawName={head.rawName}
        target={{ kind: "none" }}
        status={{ kind: "running", label: t("desktop.item.toolRunning"), awaiting: false }}
      />
    );
  }
  const last = streaming.parts.length - 1;
  if (streaming.parts.length === 0) {
    return (
      <Message size="sm" streaming>
        <span aria-hidden className="transcript-caret" />
      </Message>
    );
  }
  return (
    <>
      {streaming.parts.map((part, i) => (
        <LivePart
          key={part.partId}
          id={props.id}
          index={part.contentIndex}
          kind={part.kind}
          live={i === last && !part.done}
        />
      ))}
    </>
  );
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 확장 카드가 이 높이(`convo.css`의 `.convo-clip[data-size="card"]`)를 넘으면 접고 "더 보기"를 둔다 */
const CARD_CLIP_PX = 320;

/** 확장 기록 줄. 이 종류의 카드 기여가 있으면 그 화면을, 없으면 본문 글이나 종류 이름을 보인다 */
export function CustomRow(props: { readonly id: ItemId }): ReactNode {
  const item = useItem(props.id);
  const plugin = usePluginUiState();
  const [open, setOpen] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const measure = (): void => {
      setOverflow(el.scrollHeight > CARD_CLIP_PX + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  });
  if (item?.kind !== "custom") return null;
  const text = item.message.content;
  const body =
    typeof text === "string"
      ? text
      : text.map((b) => ("text" in b && typeof b.text === "string" ? b.text : "")).join("\n");
  const card = cardOf(plugin.groups.card, plugin.inactive, item.message.customType);
  if (card === undefined) {
    return (
      <p className="m-0 whitespace-pre-wrap text-ui text-text-tertiary">
        {body === "" ? item.message.customType : body}
      </p>
    );
  }
  return (
    <div className="grid min-w-0 gap-1">
      <div
        ref={box}
        className="convo-clip"
        data-size="card"
        data-open={open || !overflow ? "true" : "false"}
      >
        <EntrySurface
          entry={card}
          doc={isJsonObject(item.message.details) ? item.message.details : {}}
          dense
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-footnote text-text-tertiary">{provenanceOf(card)}</span>
        {overflow ? (
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={open}
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            {open ? t("desktop.convo.collapse") : t("desktop.convo.more")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
