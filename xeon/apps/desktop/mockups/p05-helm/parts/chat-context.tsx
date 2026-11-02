// 탐구(P-05)와 목표·작업(P-14)은 대화 화면(P-02)의 오른쪽 well 탭이다(스펙 §4.2·4.3). 그 둘의 시안은 가운데에 대화를 그대로 둔다.
// 여기 대화는 맥락용 정적 판이다: P-02와 같은 머리·읽기 열·입력창 치수를 따르되 상태 기계는 없다.
// 트랜스크립트 항목은 페이지가 준다(Helm 알림, 거부된 쓰기 도구, 판정 행 등). P-14도 이 파일을 쓴다(p14-work/mockup.css의 @source).
import { Button, Composer, IconButton, Message, ScrollArea, ToolCall } from "@caustic/react";
import { useEffect, useRef, type ReactNode } from "react";
import { ChevronRight, Ellipsis, PanelLeft, T, useShell } from "../../_shell";

// P-02와 같은 읽기 열: 가운데 46rem, 좌우 여백 3을 한 번.
export const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-3";

export type ContextItem =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: ReactNode }
  | {
      kind: "tool";
      name: string;
      detail: string;
      status: "done" | "failed";
      duration: string;
      failedLabel?: string;
      output?: string;
    }
  /** 대화 안 시스템 행: Helm 신호·단계, 목표 판정 등. 아이콘 하나, 한 줄 문장, 끝에 동작 하나. */
  | {
      kind: "event";
      icon: "helm" | "goal";
      text: ReactNode;
      detail?: ReactNode;
      action?: { label: string; onClick: () => void };
    };

function EventRow({ item }: { item: Extract<ContextItem, { kind: "event" }> }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 text-ui-sm">
      <div className="grid min-w-0 flex-1 gap-0.5">
        <span className="text-text-secondary">{item.text}</span>
        {item.detail !== undefined && <span className="text-text-tertiary">{item.detail}</span>}
      </div>
      {item.action !== undefined && (
        <Button
          size="xs"
          tone="neutral"
          variant="ghost"
          onClick={item.action.onClick}
          className="-my-0.5"
        >
          {item.action.label}
        </Button>
      )}
    </div>
  );
}

function Item({ item }: { item: ContextItem }) {
  switch (item.kind) {
    case "user":
      return <Message author="user">{item.text}</Message>;
    case "agent":
      return (
        <Message>
          <p>{item.text}</p>
        </Message>
      );
    case "tool":
      return (
        <ToolCall
          name={item.name}
          detail={item.detail}
          status={item.status}
          failedLabel={item.failedLabel ?? "실패"}
          icon={item.output !== undefined ? <ChevronRight className="rotate-90" /> : undefined}
        >
          {item.output !== undefined ? (
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-mono-sm">
              {item.output}
            </pre>
          ) : null}
        </ToolCall>
      );
    case "event":
      return <EventRow item={item} />;
  }
}

export function ChatContext({
  items,
  running = true,
}: {
  items: ContextItem[];
  /** @deprecated 머리의 목표 칩은 내지 않는다. 받기만 한다(d03·p14가 넘긴다). */
  goal?: string | undefined;
  running?: boolean;
}) {
  const shell = useShell();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);
  return (
    <>
      <header className={`${READ_WIDTH} flex h-10 flex-none items-center gap-1`}>
        {!shell.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 열기"
            aria-expanded={false}
            onClick={() => shell.setStartOpen(true)}
            className="-ms-1.5"
          >
            <PanelLeft />
          </IconButton>
        )}
        <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
          <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">
            캐시 무효화 조사
          </h1>
        </div>
        <IconButton size="sm" variant="ghost" label="대화 메뉴">
          <Ellipsis />
        </IconButton>
      </header>
      <ScrollArea label="대화 내용" className="min-h-0 flex-1" viewportRef={viewport}>
        <div role="log" aria-label="대화 기록" className={`${READ_WIDTH} grid gap-4 pt-1 pb-3`}>
          {items.map((item, i) => (
            <Item key={i} item={item} />
          ))}
        </div>
      </ScrollArea>
      <div className={`${READ_WIDTH} flex-none pb-1.5`}>
        <Composer
          rows={2}
          inputLabel="메시지"
          sendLabel="보내기"
          stopLabel="중단"
          attachLabel="맥락 더하기"
          modeLabel="실행 중 보낸 입력"
          modes={[T.modeSteer, T.modeFollowUp]}
          defaultMode={T.modeSteer}
          modelLabel="sonnet-5-5"
          usage={41}
          usageLabel={(p) => `문맥 ${p}%`}
          placeholder="메시지를 입력하세요"
          running={running}
          onAttach={() => {}}
          onStop={() => {}}
          onSubmit={() => {}}
        />
      </div>
    </>
  );
}
