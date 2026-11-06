import { Button, Message, ToolCall } from "@caustic/react";
import { ChevronRight } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ItemId, ItemRecord, JsonObject, JsonValue } from "@fresnel/contracts/conversation";
import { memo, useState, type NamedExoticComponent, type ReactNode } from "react";
import { cardOf, provenanceOf } from "../plugin-ui/placements.ts";
import { useItem, useOpenThreadId, usePartText, useStreamingItem } from "../state/engine/index.ts";
import { usePluginUiState } from "./plugin/plugin-context.tsx";
import { EntrySurface } from "./plugin/plugin-view.tsx";

// 확정 item과 진행 중 item의 한 행(시안 _chat-rt/items.tsx ItemView). 행 부품은 자기 id만 구독한다(FS-19).
// 사용자 글은 말풍선, 어시스턴트 글은 말풍선 없는 글이고 역할 이름은 적지 않는다. 도구 호출과 결과는 ToolCall 한 줄이다.
// 마크다운과 코드 하이라이트는 넣지 않았다(FS-21 [제안]): 평문 줄바꿈 보존으로 그린다.

const PREVIEW_CHARS = 400;
/** 한 행의 읽기 열(시안 READ_WIDTH)과 행 사이 간격(시안 로그의 gap-4). 행 사이 간격은 아래쪽 pb-4가 맡는다 */
const ROW_CLASS = "mx-auto grid w-full min-w-0 max-w-184 gap-2 px-3 pb-4";
/** 글. 줄바꿈을 살리고 붙은 긴 토큰도 열 안에서 줄을 넘긴다 */
const TEXT_CLASS = "m-0 whitespace-pre-wrap [overflow-wrap:anywhere]";
/** 보조 글(생각, 확장 종류, 출처). 본문보다 작고 흐리다 */
const QUIET_CLASS = "m-0 text-ui-sm text-text-tertiary";
/** 실패·중단 줄. 행 맨 아래에 한 줄로 둔다 */
const NOTE_CLASS = "m-0 text-ui-xs text-text-tertiary";
/** 도구 결과 본문 */
const MONO_CLASS = "m-0 whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-mono-sm";

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

/** 접는 블록(생각). 시안의 조용한 단추 한 줄이고 펼치면 본문이 아래에 붙는다 */
function Collapsible(props: { readonly summary: string; readonly children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid justify-items-start gap-1">
      <Button
        size="xs"
        variant="ghost"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        <ChevronRight
          aria-hidden
          className={
            open
              ? "rotate-90 transition-transform duration-quick"
              : "transition-transform duration-quick"
          }
        />
        {props.summary}
      </Button>
      {open ? props.children : null}
    </div>
  );
}

/**
 * 도구 호출·결과 한 줄(시안 p02-opus ToolRow). 이름, 짧은 요약, 상태 알약을 보인다.
 * 결과(output)가 있으면 접는 머리가 되고 기본은 접힘이다. 실패한 결과만 펼쳐 둔다. 결과가 없는 호출은 접을 것이 없다.
 * 시안은 머리 위에 투명 단추를 겹쳤지만, caustic ToolCall이 접기를 직접 주므로 그것을 쓴다.
 */
function ToolRow(props: {
  readonly name: string;
  readonly detail?: string;
  readonly status: "done" | "failed";
  readonly output?: string;
}): ReactNode {
  const { output } = props;
  return (
    <ToolCall
      name={props.name}
      detail={props.detail}
      status={props.status}
      failedLabel={t("desktop.item.status.failed")}
      collapsible={output !== undefined}
      defaultOpen={props.status === "failed"}
    >
      {output === undefined ? null : <pre className={MONO_CLASS}>{output}</pre>}
    </ToolCall>
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
  if (card === undefined) return <p className={QUIET_CLASS}>{props.customType}</p>;
  return (
    <>
      {/* 카드는 높이 상한(max-h-80, 320px)을 넘으면 잘린다. "더 보기"는 아직 없다([미결], spec 2478) */}
      <div className="max-h-80 overflow-hidden">
        <EntrySurface entry={card} doc={dataDocOf(props.details)} dense />
      </div>
      <div className={QUIET_CLASS}>{provenanceOf(card)}</div>
    </>
  );
}

function RecordBody(props: { readonly item: ItemRecord }): ReactNode {
  const item = props.item;
  switch (item.kind) {
    case "user":
      return (
        <Message author="user" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
          {textOf(item.message.content)}
        </Message>
      );
    case "assistant":
      return (
        <>
          {item.message.content.map((block, index) => {
            // 파트 id가 있으면 그것을 키로 쓴다. partIds[i]는 content[i]다
            const key = item.partIds[index] ?? `${item.itemId}:${index}`;
            switch (block.type) {
              case "text":
                return (
                  <Message key={key}>
                    <p className={TEXT_CLASS}>{block.text}</p>
                  </Message>
                );
              case "thinking":
                return (
                  <Collapsible key={key} summary={t("desktop.item.thinking")}>
                    <p className={`${TEXT_CLASS} text-ui-sm text-text-secondary`}>
                      {block.thinking}
                    </p>
                  </Collapsible>
                );
              case "toolCall":
                return (
                  <ToolRow
                    key={key}
                    name={block.name}
                    detail={clip(JSON.stringify(block.arguments))}
                    status="done"
                  />
                );
              default:
                return assertNever(block, "assistant block");
            }
          })}
        </>
      );
    case "toolResult":
      return (
        <ToolRow
          name={item.message.toolName}
          status={item.message.isError ? "failed" : "done"}
          output={clip(textOf(item.message.content))}
        />
      );
    case "system":
      return <p className={QUIET_CLASS}>{textOf(item.message.content)}</p>;
    case "custom":
      return <CustomBody customType={item.message.customType} details={item.message.details} />;
    default:
      return assertNever(item, "item kind");
  }
}

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
    const interrupted = item.status === "failed" || item.status === "interrupted";
    // 실패한 도구 결과는 도구 줄의 "실패" 알약이 이미 알리므로 아래 줄을 또 적지 않는다
    const showNote = interrupted && !(item.kind === "toolResult" && item.message.isError);
    return (
      <article className={ROW_CLASS} data-status={item.status}>
        <RecordBody item={item} />
        {showNote ? (
          <footer className={NOTE_CLASS}>
            {item.status === "failed"
              ? t("desktop.item.status.failed")
              : t("desktop.item.status.interrupted")}
          </footer>
        ) : null}
      </article>
    );
  },
);

/** 작성 중 커서(시안 p02-opus StreamingText). 글은 그대로 두고 끝에 깜빡이는 막대 하나를 붙인다 */
function StreamingText(props: { readonly text: string; readonly live: boolean }): ReactNode {
  return (
    <>
      <span>{props.text}</span>
      {props.live ? <span aria-hidden className="transcript-caret" /> : null}
    </>
  );
}

/** 파트 텍스트 하나만 구독한다. 델타는 이 부품 하나만 다시 그린다 */
const StreamingPartText = memo(function StreamingPartText(props: {
  readonly id: ItemId;
  readonly index: number;
  readonly live: boolean;
}): ReactNode {
  return <StreamingText text={usePartText(props.id, props.index)} live={props.live} />;
});

export const StreamingRow: NamedExoticComponent<{ readonly id: ItemId }> = memo(
  function StreamingRow(props: { readonly id: ItemId }): ReactNode {
    const item = useStreamingItem(props.id);
    const openThreadId = useOpenThreadId();
    // 진행 목록은 모든 thread의 것을 담는다(design 6절). 열린 thread의 것만 그린다
    if (item === undefined || item.threadId !== openThreadId) return null;
    if (item.kind === "toolCall") {
      return (
        <article className={ROW_CLASS}>
          <ToolCall
            name={item.toolName ?? ""}
            status="running"
            activity={t("desktop.item.toolRunning")}
            detail={item.parts.map((part) => (
              <StreamingPartText
                key={part.partId}
                id={props.id}
                index={part.contentIndex}
                live={false}
              />
            ))}
          />
        </article>
      );
    }
    // 쓰는 중인 글은 Message streaming으로 감싸 aria-busy를 주고, 아직 끝나지 않은 마지막 덩이 끝에 커서를 둔다
    const last = item.parts.length - 1;
    return (
      <article className={ROW_CLASS}>
        <Message streaming>
          {item.parts.length === 0 ? (
            <p className={TEXT_CLASS}>
              <StreamingText text="" live />
            </p>
          ) : (
            item.parts.map((part, i) => (
              <p key={part.partId} className={TEXT_CLASS}>
                <StreamingPartText
                  id={props.id}
                  index={part.contentIndex}
                  live={i === last && !part.done}
                />
              </p>
            ))
          )}
        </Message>
      </article>
    );
  },
);
