import { Button } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ItemId, ItemRecord, JsonObject, JsonValue } from "@fresnel/contracts/conversation";
import { memo, useState, type NamedExoticComponent, type ReactNode } from "react";
import { cardOf, provenanceOf } from "../plugin-ui/placements.ts";
import { useItem, useOpenThreadId, usePartText, useStreamingItem } from "../state/engine/index.ts";
import { usePluginUiState } from "./plugin/plugin-context.tsx";
import { EntrySurface } from "./plugin/plugin-view.tsx";

// 확정 item과 진행 중 item의 한 행. 행 부품은 자기 id만 구독한다(FS-19).
// 마크다운과 코드 하이라이트는 넣지 않았다(FS-21 [제안]): 평문 줄바꿈 보존으로 그린다.

const PREVIEW_CHARS = 400;
/** 트랜스크립트 카드의 높이 상한(px). 넘는 글은 잘린다. "더 보기"는 아직 없다([미결], spec 2478) */
const CARD_MAX_HEIGHT = 320;

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
      <Button
        size="xs"
        variant="ghost"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {open ? "▾" : "▸"} {props.summary}
      </Button>
      {open ? props.children : null}
    </div>
  );
}

/** JSON 객체인가. `Array.isArray`는 읽기 전용 배열을 걸러내지 못해 직접 가린다 */
function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 기록의 details를 카드의 데이터 문서로 쓴다. 객체가 아니면 빈 문서다 */
function dataDocOf(details: JsonValue): Readonly<Record<string, unknown>> {
  return isJsonObject(details) ? details : {};
}

/**
 * 확장 기록의 본문. 이 종류(`customType`)의 `card` 기여가 있으면 그 화면을 기록의 details로 그리고 출처 줄을 덧붙인다.
 * 카드가 없거나 확장이 꺼졌으면 종류 이름만 보인다. 출처는 와이어 항목과 `forKind`로만 정한다
 */
function CustomBody(props: {
  readonly customType: string;
  readonly details: JsonValue;
}): ReactNode {
  const plugin = usePluginUiState();
  const card = cardOf(plugin.groups.card, plugin.inactive, props.customType);
  if (card === undefined) return <div className="text dim">{props.customType}</div>;
  return (
    <>
      <div style={{ maxHeight: CARD_MAX_HEIGHT, overflow: "hidden" }}>
        <EntrySurface entry={card} doc={dataDocOf(props.details)} dense />
      </div>
      <div className="text-ui-sm text-text-tertiary">{provenanceOf(card)}</div>
    </>
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
      return <CustomBody customType={item.message.customType} details={item.message.details} />;
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
