import { Button, Message, ToolCall } from "@caustic/react";
import { ChevronRight, Globe } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import { normalizeExternalLink } from "@fresnel/client/views/app";
import type { ItemId, ItemRecord, JsonObject, JsonValue } from "@fresnel/contracts/conversation";
import {
  Fragment,
  memo,
  useEffect,
  useState,
  type NamedExoticComponent,
  type ReactNode,
} from "react";
import { cardOf, provenanceOf } from "../plugin-ui/placements.ts";
import {
  useHasToolCall,
  useItem,
  useOpenThreadId,
  useOpenThread,
  useOpenThreadRunning,
  usePartText,
  useStreamingItem,
  useToolCallAwaitingApproval,
  useToolResult,
} from "../state/engine/index.ts";
import { bubbleOf } from "./attachment-bubble-model.ts";
import { MessageAttachments } from "./message-attachments.tsx";
import { EntrySurface } from "./plugin/plugin-view.tsx";
import { usePluginUi, usePluginUiState } from "./plugin/plugin-context.tsx";
import { useGoToThread } from "./thread-link.ts";
import { toolOutputOf } from "./tool-output-model.ts";
import {
  AGENT_TOOL,
  WEB_TOOLS,
  agentHeadOf,
  agentResultOf,
  citedLinksOf,
  reportFoldOf,
  webSourcesOf,
  type WebSource,
} from "./tool-extras-model.ts";

// 확정 item과 진행 중 item의 한 행(시안 _chat-rt/items.tsx ItemView). 행 부품은 자기 id만 구독한다(FS-19).
// 사용자 글은 말풍선, 어시스턴트 글은 말풍선 없는 글이고 역할 이름은 적지 않는다. 도구 호출과 결과는 ToolCall 한 줄이다.
// 마크다운과 코드 하이라이트는 넣지 않았다(FS-21 [제안]): 평문 줄바꿈 보존으로 그린다.

const PREVIEW_CHARS = 400;
/** 한 행의 읽기 열(시안 READ_WIDTH)과 행 사이 간격(시안 로그의 gap-4). 행 사이 간격은 아래쪽 pb-4가 맡는다 */
// 한 열 격자는 열 폭을 minmax(0,1fr)로 고정한다. 그렇지 않으면 긴 도구 인자 한 줄이 열을 대화 칸 밖으로 민다
const ROW_CLASS = "mx-auto grid w-full min-w-0 max-w-184 grid-cols-[minmax(0,1fr)] gap-2 px-3 pb-4";
/** 글. 줄바꿈을 살리고 붙은 긴 토큰도 열 안에서 줄을 넘긴다 */
const TEXT_CLASS = "m-0 whitespace-pre-wrap [overflow-wrap:anywhere]";
/** 보조 글(생각, 확장 종류, 출처). 본문보다 작고 흐리다 */
const QUIET_CLASS = "m-0 text-ui-sm text-text-tertiary";
/** 실패·중단 줄. 행 맨 아래에 한 줄로 둔다 */
const NOTE_CLASS = "m-0 text-ui-xs text-text-tertiary";
/** 도구 결과 본문 */
/** 펼친 출력의 높이 상한과 안쪽 스크롤 */
const OUTPUT_BOX_CLASS = "max-h-80 overflow-auto";
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
  readonly status: "done" | "failed" | "running";
  /** 실패 알약의 글. 기본은 "실패"다(거부, 중단은 따로 쓴다) */
  readonly failedLabel?: string;
  readonly output?: string;
  /** 엔진 또는 화면이 잘랐을 때 전체 줄 수와 보인 줄 수 */
  readonly cut?: { readonly shown: number; readonly total: number };
  /** 실행 중 글. 없으면 "실행 중"(경과 시간 포함) */
  readonly runningLabel?: (seconds: number) => string;
  /** 승인을 기다리는 호출. 경과 시간을 세지 않고 "승인 기다리는 중"을 보인다 */
  readonly awaitingApproval?: boolean;
  /** 출력 아래에 덧붙이는 것(접은 나머지, 자식 대화 링크) */
  readonly foot?: ReactNode;
  /** 끝난 뒤에도 펼쳐 둔다(하위 에이전트의 보고는 결과 블록이다) */
  readonly openWhenDone?: boolean;
}): ReactNode {
  const { output } = props;
  const awaiting = props.awaitingApproval === true && props.status === "running";
  const elapsed = useElapsedSeconds(props.status === "running" && !awaiting);
  // 실행 중에 그려진 행이 나중에 끝나도 초기 값만 읽으면 접힌 채로 남는다. 상태가 바뀔 때 펼칠지 다시 정한다
  const wantOpen = props.status === "failed" || props.openWhenDone === true;
  const [open, setOpen] = useState(wantOpen);
  const [seenStatus, setSeenStatus] = useState(props.status);
  if (seenStatus !== props.status) {
    setSeenStatus(props.status);
    setOpen(wantOpen);
  }
  return (
    <ToolCall
      name={props.name}
      detail={props.detail}
      status={props.status}
      activity={
        awaiting
          ? t("desktop.item.toolAwaitingApproval")
          : props.runningLabel !== undefined
            ? props.runningLabel(elapsed)
            : elapsed > 0
              ? t("desktop.item.toolRunningFor", { seconds: elapsed })
              : t("desktop.item.toolRunning")
      }
      failedLabel={props.failedLabel ?? t("desktop.item.status.failed")}
      collapsible={output !== undefined || props.foot !== undefined}
      open={open}
      onOpenChange={setOpen}
    >
      {output === undefined && props.foot === undefined ? null : (
        <>
          {output === undefined || output === "" ? null : (
            <pre className={`${MONO_CLASS} ${OUTPUT_BOX_CLASS}`} tabIndex={0}>
              {output}
            </pre>
          )}
          {props.foot}
          {props.cut === undefined ? null : (
            <p className={NOTE_CLASS}>
              {t("desktop.item.output.partial", {
                total: props.cut.total,
                shown: props.cut.shown,
              })}
            </p>
          )}
        </>
      )}
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

const DENIED_CODE = "fresnel:denied_by_user";
const CODE_PREFIX = /^\[([^\]]+)\]\s*/;

/** 결과 글머리의 `[코드] ` 꼬리표를 읽는다. 없으면 코드는 null이다 */
function splitCode(text: string): { readonly code: string | null; readonly body: string } {
  const found = CODE_PREFIX.exec(text);
  if (found === null) return { code: null, body: text };
  return { code: found[1] ?? null, body: text.slice(found[0].length) };
}

type ResultView = {
  readonly status: "done" | "failed";
  readonly failedLabel?: string;
  readonly output: string;
  readonly cut?: { readonly shown: number; readonly total: number };
};

/** 실행 중인 동안 1초마다 늘어나는 경과 초. 실행 중이 아니면 0 */
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return active ? seconds : 0;
}

/** 도구 결과 item을 행 상태로 옮긴다. 거부와 중단은 알약이 "거부함", "중단됨"이고 내부 오류 코드는 본문에 드러내지 않는다 */
function resultViewOf(item: ItemRecord): ResultView | null {
  if (item.kind !== "toolResult") return null;
  const shown = toolOutputOf(
    item.message.content,
    item.message.details,
    t("desktop.item.imagePlaceholder"),
  );
  const cut =
    shown.totalLines === null ? {} : { cut: { shown: shown.shownLines, total: shown.totalLines } };
  if (!item.message.isError && item.status === "completed") {
    return { status: "done", output: shown.text, ...cut };
  }
  const { code, body } = splitCode(shown.text);
  // 하위 에이전트를 멈추면 엔진은 오류 결과에 details.status "aborted"를 싣는다. 실패가 아니라 중단이다
  const agentAborted =
    item.message.toolName === AGENT_TOOL &&
    agentResultOf(shown.text, item.message.details, true).outcome === "aborted";
  if (code === DENIED_CODE) {
    return {
      status: "failed",
      failedLabel: t("desktop.item.status.denied"),
      output: t("desktop.item.denied.body"),
    };
  }
  if (
    item.status === "interrupted" ||
    code === "fresnel:aborted" ||
    code === "aborted" ||
    agentAborted
  ) {
    return {
      status: "failed",
      failedLabel: t("desktop.item.status.interrupted"),
      output: body,
      ...cut,
    };
  }
  return { status: "failed", output: body, ...cut };
}

/** 열 때 한 번 확인을 거쳐 OS 브라우저로 보낸다. 거부하면 아무 일도 없다 */
function useOpenSource(): (url: string) => void {
  const { confirm, openExternal } = usePluginUi();
  return (url) => {
    const link = normalizeExternalLink(url);
    if (link === undefined) return;
    void confirm
      .request({
        kind: "external",
        extension: "",
        trust: "builtin",
        action: link.display,
        ...(link.punycodeHost === undefined ? {} : { punycodeHost: link.punycodeHost }),
        label: undefined,
        paramsSummary: "",
        approval: false,
      })
      .then((answer) => (answer === "allow" ? openExternal(link.href) : undefined));
  };
}

/** 출처 칩 줄. 칩은 도메인과 제목을 보이고, 누르면 확인 뒤 외부 브라우저로 연다 */
function SourceChips(props: { readonly sources: readonly WebSource[] }): ReactNode {
  return props.sources.length === 0 ? null : <SourceChipList sources={props.sources} />;
}

function SourceChipList(props: { readonly sources: readonly WebSource[] }): ReactNode {
  const open = useOpenSource();
  return (
    <ul
      className="m-0 flex list-none flex-wrap gap-1 p-0"
      aria-label={t("desktop.item.sources.label")}
    >
      {props.sources.map((source) => (
        <li key={source.url}>
          <Button
            size="xs"
            variant="outline"
            title={source.url}
            onClick={() => {
              open(source.url);
            }}
          >
            <Globe aria-hidden />
            {source.title === source.domain ? source.domain : `${source.domain} · ${source.title}`}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** 하위 에이전트 행. 머리는 정의 이름과 할 일, 끝나면 자식의 보고(길면 접기)와 자식 대화 링크 */
function AgentRow(props: {
  readonly args: JsonObject;
  readonly result: ItemRecord | undefined;
  readonly running: boolean;
}): ReactNode {
  const goTo = useGoToThread();
  const detail = agentHeadOf(props.args);
  const result = props.result;
  if (result === undefined || result.kind !== "toolResult") {
    return (
      <ToolRow
        name={AGENT_TOOL}
        detail={detail}
        status={props.running ? "running" : "failed"}
        {...(props.running
          ? {
              runningLabel: (seconds: number) =>
                seconds > 0
                  ? t("desktop.item.agent.runningFor", { seconds })
                  : t("desktop.item.agent.running"),
            }
          : { failedLabel: t("desktop.item.status.interrupted") })}
      />
    );
  }
  const view = resultViewOf(result);
  if (view === null) return null;
  const parsed = agentResultOf(view.output, result.message.details, result.message.isError);
  // 중단된 하위 에이전트의 본문은 엔진의 영어 안내 한 줄뿐이라 알약("중단됨")이 대신한다
  const fold = reportFoldOf(parsed.outcome === "aborted" ? "" : parsed.body);
  const childId = parsed.childThreadId;
  const foot = (
    <>
      {fold.rest === null ? null : (
        <Collapsible summary={t("desktop.item.agent.more")}>
          <pre className={`${MONO_CLASS} ${OUTPUT_BOX_CLASS}`} tabIndex={0}>
            {fold.rest}
          </pre>
        </Collapsible>
      )}
      {childId === null || goTo === null ? null : (
        <div className="justify-self-start">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => {
              goTo(childId);
            }}
          >
            {t("desktop.item.agent.openChild")}
          </Button>
        </div>
      )}
    </>
  );
  return (
    <ToolRow
      name={AGENT_TOOL}
      detail={detail}
      status={view.status}
      {...(view.failedLabel === undefined ? {} : { failedLabel: view.failedLabel })}
      output={fold.head}
      foot={foot}
      openWhenDone
    />
  );
}

/** 호출 하나에 행 하나. 결과가 오면 같은 행이 결과를 따른다. 결과가 없으면 실행 중이거나(대화가 실행 중) 끝내 못 받은 것이다 */
function CallRow(props: {
  readonly callId: string;
  readonly name: string;
  readonly detail: string;
  readonly args: JsonObject;
}): ReactNode {
  const result = useToolResult(props.callId);
  const running = useOpenThreadRunning();
  const awaitingApproval = useToolCallAwaitingApproval(props.callId);
  if (props.name === AGENT_TOOL) {
    return <AgentRow args={props.args} result={result} running={running} />;
  }
  const view = result === undefined ? null : resultViewOf(result);
  if (view === null) {
    return running ? (
      <ToolRow
        name={props.name}
        detail={props.detail}
        status="running"
        awaitingApproval={awaitingApproval}
      />
    ) : (
      <ToolRow
        name={props.name}
        detail={props.detail}
        status="failed"
        failedLabel={t("desktop.item.status.interrupted")}
      />
    );
  }
  const sources =
    WEB_TOOLS.includes(props.name) && view.status === "done" ? webSourcesOf(view.output) : [];
  return (
    <>
      <ToolRow
        name={props.name}
        detail={props.detail}
        status={view.status}
        {...(view.failedLabel === undefined ? {} : { failedLabel: view.failedLabel })}
        output={view.output}
        {...(view.cut === undefined ? {} : { cut: view.cut })}
      />
      <SourceChips sources={sources} />
    </>
  );
}

/** 결과 item 한 줄. 짝이 되는 호출 행이 화면에 있으면 그리지 않는다(그 행이 결과를 보인다) */
function ResultRow(props: { readonly item: ItemRecord }): ReactNode {
  const view = resultViewOf(props.item);
  if (view === null || props.item.kind !== "toolResult") return null;
  return (
    <ToolRow
      name={props.item.message.toolName}
      status={view.status}
      {...(view.failedLabel === undefined ? {} : { failedLabel: view.failedLabel })}
      output={view.output}
    />
  );
}

function RecordBody(props: { readonly item: ItemRecord }): ReactNode {
  const item = props.item;
  switch (item.kind) {
    case "user": {
      const bubble = bubbleOf(item.message.content);
      return (
        <>
          {bubble.text === "" ? null : (
            <Message author="user" className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {bubble.text}
            </Message>
          )}
          <MessageAttachments attachments={bubble.attachments} />
        </>
      );
    }
    case "assistant":
      return (
        <>
          {item.message.content.map((block, index) => {
            // 파트 id가 있으면 그것을 키로 쓴다. partIds[i]는 content[i]다
            const key = item.partIds[index] ?? `${item.itemId}:${index}`;
            switch (block.type) {
              case "text":
                return (
                  <Fragment key={key}>
                    <Message>
                      <p className={TEXT_CLASS}>{block.text}</p>
                    </Message>
                    <SourceChips sources={citedLinksOf(block.text, 6)} />
                  </Fragment>
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
                  <CallRow
                    key={key}
                    callId={block.id}
                    name={block.name}
                    detail={clip(JSON.stringify(block.arguments))}
                    args={block.arguments}
                  />
                );
              default:
                return assertNever(block, "assistant block");
            }
          })}
        </>
      );
    case "toolResult":
      return <ResultRow item={item} />;
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
    const pairedCall = useHasToolCall(item?.kind === "toolResult" ? item.message.toolCallId : "");
    const spawned = useOpenThread()?.spawnedBy !== undefined;
    if (item === undefined) return null;
    // 위임으로 만든 자식 대화의 사용자 말은 엔진이 넣은 지시문(시스템 프롬프트)이다. 사용자가 쓴 말이 아니라 그리지 않는다 [결정: 오케스트레이터 기본값, rtE R-3]
    if (spawned && item.kind === "user") return null;
    // 짝이 되는 호출 행이 결과를 따라 보이므로 결과 item은 따로 그리지 않는다(호출 하나에 행 하나)
    if (item.kind === "toolResult" && pairedCall) return null;
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
    const hasCallRow = useHasToolCall(item?.toolCallId ?? "");
    // 진행 목록은 모든 thread의 것을 담는다(design 6절). 열린 thread의 것만 그린다
    if (item === undefined || item.threadId !== openThreadId) return null;
    if (item.kind === "toolCall") {
      // 호출 행(어시스턴트 item의 toolCall)이 이미 실행 중으로 보이면 같은 호출을 한 번 더 그리지 않는다(호출 하나에 행 하나)
      if (hasCallRow) return null;
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
