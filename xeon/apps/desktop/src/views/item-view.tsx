import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ItemId, ItemRecord } from "@fresnel/contracts/conversation";
import { memo, useState, type NamedExoticComponent, type ReactNode } from "react";
import { useItem, useOpenThreadId, usePartText, useStreamingItem } from "../state/engine/index.ts";

// 확정 item과 진행 중 item의 한 행. 행 부품은 자기 id만 구독한다(FS-19).
// 마크다운과 코드 하이라이트는 넣지 않았다(FS-21 [제안]): 평문 줄바꿈 보존으로 그린다.

const PREVIEW_CHARS = 400;

type Block = { readonly type: string };

function textOf(content: string | readonly Block[]): string {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const block of content) {
    if ("text" in block && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "image") parts.push(t("desktop.item.imagePlaceholder"));
  }
  return parts.join("\n");
}

function clip(text: string): string {
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

function Collapsible(props: { readonly summary: string; readonly children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="collapsible">
      <button
        type="button"
        className="link"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? "▾" : "▸"} {props.summary}
      </button>
      {open ? props.children : null}
    </div>
  );
}

function RecordBody(props: { readonly item: ItemRecord }): ReactNode {
  const item = props.item;
  switch (item.kind) {
    case "user":
      return <div className="text">{textOf(item.message.content)}</div>;
    case "assistant":
      return (
        <>
          {item.message.content.map((block, index) => {
            // 파트 id가 있으면 그것을 키로 쓴다. partIds[i]는 content[i]다
            const key = item.partIds[index] ?? `${item.itemId}:${index}`;
            switch (block.type) {
              case "text":
                return (
                  <div className="text" key={key}>
                    {block.text}
                  </div>
                );
              case "thinking":
                return (
                  <Collapsible key={key} summary={t("desktop.item.thinking")}>
                    <div className="text dim">{block.thinking}</div>
                  </Collapsible>
                );
              case "toolCall":
                return (
                  <Collapsible key={key} summary={t("desktop.item.toolCall", { name: block.name })}>
                    <pre className="code">{clip(JSON.stringify(block.arguments))}</pre>
                  </Collapsible>
                );
              default:
                return assertNever(block, "assistant block");
            }
          })}
        </>
      );
    case "toolResult":
      return (
        <Collapsible
          summary={
            item.message.isError
              ? t("desktop.item.toolResultError", { name: item.message.toolName })
              : t("desktop.item.toolResult", { name: item.message.toolName })
          }
        >
          <pre className="code">{clip(textOf(item.message.content))}</pre>
        </Collapsible>
      );
    case "system":
      return <div className="text dim">{textOf(item.message.content)}</div>;
    case "custom":
      return <div className="text dim">{item.message.customType}</div>;
    default:
      return assertNever(item, "item kind");
  }
}

/** 역할 이름의 키. 문장은 그릴 때 `t()`로 푼다(모듈을 읽을 때 풀면 로케일이 바뀌어도 옛 말이 남는다) */
const ROLE_KEY: Readonly<Record<ItemRecord["kind"], MessageId>> = {
  user: "desktop.item.role.user",
  assistant: "desktop.item.role.assistant",
  system: "desktop.item.role.system",
  toolResult: "desktop.item.role.toolResult",
  custom: "desktop.item.role.custom",
};

export const RecordedItem: NamedExoticComponent<{ readonly id: ItemId }> = memo(
  function RecordedItem(props: { readonly id: ItemId }): ReactNode {
    const item = useItem(props.id);
    if (item === undefined) return null;
    // display가 거짓인 확장 item은 모델 문맥 전용이라 화면에 그리지 않는다(F.conversation.spec 3.5.2)
    if (item.kind === "custom" && !item.message.display) return null;
    // system item은 요청 앞에 붙는 시스템 프롬프트다. 모델 문맥 전용이라 그리지 않는다(L4.desktop.spec §4.13)
    if (item.kind === "system") return null;
    // 내용 없이 실패한 어시스턴트 item은 보일 것이 없다. 실패 원인은 트랜스크립트 아래 경고 한 곳에만 보인다
    if (
      item.kind === "assistant" &&
      item.status === "failed" &&
      item.message.content.length === 0
    ) {
      return null;
    }
    return (
      <article className={`item item-${item.kind}`} data-status={item.status}>
        <header className="role">{t(ROLE_KEY[item.kind])}</header>
        <RecordBody item={item} />
        {item.status === "failed" || item.status === "interrupted" ? (
          <footer className="dim">
            {item.status === "failed"
              ? t("desktop.item.status.failed")
              : t("desktop.item.status.interrupted")}
          </footer>
        ) : null}
      </article>
    );
  },
);

/** 파트 텍스트 하나만 구독한다. 델타는 이 부품 하나만 다시 그린다 */
const StreamingPartText = memo(function StreamingPartText(props: {
  readonly id: ItemId;
  readonly index: number;
}): ReactNode {
  return <div className="text streaming">{usePartText(props.id, props.index)}</div>;
});

export const StreamingRow: NamedExoticComponent<{ readonly id: ItemId }> = memo(
  function StreamingRow(props: { readonly id: ItemId }): ReactNode {
    const item = useStreamingItem(props.id);
    const openThreadId = useOpenThreadId();
    // 진행 목록은 모든 thread의 것을 담는다(design 6절). 열린 thread의 것만 그린다
    if (item === undefined || item.threadId !== openThreadId) return null;
    const label =
      item.kind === "toolCall"
        ? t("desktop.item.toolCall", { name: item.toolName ?? "" })
        : t("desktop.item.role.assistant");
    return (
      <article className={`item item-${item.kind} live`}>
        <header className="role">{label}</header>
        {item.parts.map((part) => (
          <StreamingPartText key={part.partId} id={props.id} index={part.contentIndex} />
        ))}
      </article>
    );
  },
);
