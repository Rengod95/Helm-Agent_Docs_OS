import { assertNever } from "@xeon/contracts";
import type { ItemId, ItemRecord } from "@xeon/contracts/conversation";
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
    else if (block.type === "image") parts.push("[이미지]");
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
                  <Collapsible key={key} summary="생각">
                    <div className="text dim">{block.thinking}</div>
                  </Collapsible>
                );
              case "toolCall":
                return (
                  <Collapsible key={key} summary={`도구 호출: ${block.name}`}>
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
          summary={`도구 결과: ${item.message.toolName}${item.message.isError ? " (오류)" : ""}`}
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

const ROLE_LABEL: Readonly<Record<ItemRecord["kind"], string>> = {
  user: "나",
  assistant: "어시스턴트",
  system: "시스템",
  toolResult: "도구",
  custom: "확장",
};

export const RecordedItem: NamedExoticComponent<{ readonly id: ItemId }> = memo(
  function RecordedItem(props: { readonly id: ItemId }): ReactNode {
    const item = useItem(props.id);
    if (item === undefined) return null;
    return (
      <article className={`item item-${item.kind}`} data-status={item.status}>
        <header className="role">{ROLE_LABEL[item.kind]}</header>
        <RecordBody item={item} />
        {item.status === "failed" || item.status === "interrupted" ? (
          <footer className="dim">{item.status === "failed" ? "실패" : "중단됨"}</footer>
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
    const label = item.kind === "toolCall" ? `도구 호출: ${item.toolName ?? ""}` : "어시스턴트";
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
