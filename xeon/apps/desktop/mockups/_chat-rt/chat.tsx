// batch A 공용 대화 무대 부품(목업 전용). p02-opus의 머리·트랜스크립트·입력창을 런타임 표시와 함께 다시 짠 것이다.
// - ChatHead: 한 줄 머리(제목, 작업 폴더, 표지) + 둘째 줄 런타임 줄(DP-19, §6.30). 런타임 줄을 누르면 런타임 탭.
// - RuntimeRow: 트랜스크립트 한 줄 런타임 행(muted 아이콘, secondary 글자, 동작 0~1개, 출처 tertiary, DP-19·DP-33).
// - PluginCard: card slot 셸 틀(테두리 하나 + 확장 이름 연한 mono + "더 보기", ADR-0021 §3.2, §6.25).
// - Streamed: useTypewriter로 글을 흘리는 에이전트 메시지(작성 중 커서는 p02-opus StreamingText).
// - ChatStage: 머리 + 스크롤 트랜스크립트(바닥 따라감) + 띠 + 입력창. 가운데는 투명(DP-01), 읽기 폭 46rem.
import { Button, Card, Composer, IconButton, Message, ScrollArea } from "@caustic/react";
import { useEffect, useRef, type ReactNode } from "react";
import { L, Layers, PanelLeft, T, ToneIcon, useShell, useTypewriter } from "../_shell";
import { StreamingText } from "../p02-opus/parts/streaming-text";

export const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-3";

export function ChatHead({
  title,
  folder = "~/code/xeon",
  marks,
  runtime,
  runtimeLabel,
  end,
}: {
  title: ReactNode;
  folder?: string;
  /** 제목 옆 표지(시험 Badge, 프로필, 대상 등). 좁은 폭에서는 첫 표지만 남긴다(페이지가 정한다). */
  marks?: ReactNode;
  /** 런타임 줄 글(요약). 없으면 줄을 그리지 않는다. */
  runtime?: ReactNode;
  runtimeLabel?: string;
  /** 머리 오른쪽(메뉴 등). */
  end?: ReactNode;
}) {
  const m = useShell();
  return (
    <header className={`${READ_WIDTH} grid flex-none pb-1`}>
      <div className="flex h-10 min-w-0 items-center gap-1">
        {!m.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label={L("사이드바 열기")}
            aria-expanded={false}
            onClick={() => m.setStartOpen(true)}
            className="-ms-1.5"
          >
            <PanelLeft />
          </IconButton>
        )}
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <h1 className="m-0 min-w-0 truncate font-ui text-ui-strong text-text-primary">{title}</h1>
          {marks}
          <span className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary max-compact:hidden">
            {folder}
          </span>
        </div>
        {end}
      </div>
      {runtime !== undefined && (
        <button
          type="button"
          data-tour="runtime-line"
          onClick={() => m.openEnd("runtime")}
          aria-label={runtimeLabel ?? L("런타임 탭 열기")}
          className="-mt-1.5 flex min-w-0 max-w-full items-center gap-1.5 justify-self-start rounded-sm text-ui-dense text-text-secondary outline-none hover:text-text-primary focus-visible:focus-ring"
        >
          <Layers
            emphasis="muted"
            aria-hidden
            className="size-icon-xs flex-none text-text-tertiary"
          />
          <span className="min-w-0 truncate">{runtime}</span>
        </button>
      )}
    </header>
  );
}

export function RuntimeRow({
  children,
  source,
  icon,
  tone,
  action,
  onOpen,
  live = false,
}: {
  children: ReactNode;
  /** 출처(grp:helm, ext:acme-notes, core). */
  source?: string;
  icon?: ReactNode;
  /** 거부·실패처럼 주의가 필요한 행만: tone은 아이콘 면에만(DP-29). */
  tone?: "warning" | "danger" | "info" | "success";
  action?: { label: string; onClick: () => void; disabled?: boolean };
  onOpen?: () => void;
  /** 지금 일어나는 행(aria-live 대상). */
  live?: boolean;
}) {
  const mark =
    tone !== undefined ? (
      <ToneIcon tone={tone}>{icon ?? <Layers />}</ToneIcon>
    ) : (
      <span
        aria-hidden
        className="inline-grid size-4 flex-none place-items-center text-text-tertiary [&_svg]:size-icon-xs"
      >
        {icon ?? <Layers emphasis="muted" />}
      </span>
    );
  const body = (
    <>
      {mark}
      <span className="min-w-0 truncate">{children}</span>
      {source !== undefined && (
        <span className="flex-none font-mono text-mono-sm text-text-tertiary">{source}</span>
      )}
    </>
  );
  return (
    <div
      className="flex min-h-6 min-w-0 items-center gap-1.5 text-ui-dense text-text-secondary"
      {...(live ? { role: "status" } : {})}
    >
      {onOpen !== undefined ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 items-center gap-1.5 rounded-sm text-start outline-none hover:text-text-primary focus-visible:focus-ring"
        >
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">{body}</span>
      )}
      {action !== undefined && (
        <Button
          size="xs"
          tone="neutral"
          variant="ghost"
          className="ms-auto -my-1 flex-none"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function PluginCard({
  ext,
  icon,
  onMore,
  moreLabel = "더 보기",
  children,
}: {
  ext: string;
  icon: ReactNode;
  onMore?: () => void;
  moreLabel?: string;
  children: ReactNode;
}) {
  return (
    <Card variant="outline" size="sm" className="grid max-h-80 gap-2 overflow-hidden p-3">
      <div className="flex min-h-5 items-center gap-1.5 text-ui-xs text-text-tertiary">
        <span aria-hidden className="inline-grid place-items-center [&_svg]:size-icon-xs">
          {icon}
        </span>
        <span className="font-mono text-mono-sm">{ext}</span>
        {onMore !== undefined && (
          <Button
            size="xs"
            tone="neutral"
            variant="ghost"
            className="ms-auto -me-1.5 -my-1"
            onClick={onMore}
          >
            {moreLabel}
          </Button>
        )}
      </div>
      {children}
    </Card>
  );
}

/** 에이전트 메시지. live면 글을 흘리고(가짜 스트리밍) 끝까지 쓰면 커서를 뗀다. */
export function Streamed({ text, live, meta }: { text: string; live: boolean; meta?: string }) {
  const { shown, done } = useTypewriter(text, live, 70);
  const writing = live && !done;
  return (
    <Message streaming={writing} meta={meta}>
      <p>
        <StreamingText text={shown} live={writing} />
      </p>
    </Message>
  );
}

export function ChatComposer({
  placeholder = L("메시지를 입력하세요"),
  running,
  disabled = false,
  value,
  onValueChange,
  onSubmit,
  onStop,
  note,
}: {
  placeholder?: string;
  running: boolean;
  disabled?: boolean;
  value: string;
  onValueChange: (v: string) => void;
  onSubmit: (text: string) => void;
  onStop?: () => void;
  /** 입력창 위 한 줄 안내(멈춘 동안 큐 등). */
  note?: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      {note !== undefined && <p className="m-0 px-1 text-ui-xs text-text-tertiary">{note}</p>}
      <Composer
        value={value}
        onValueChange={onValueChange}
        rows={2}
        inputLabel={L("메시지")}
        sendLabel={L("보내기")}
        stopLabel={L("중단")}
        attachLabel={L("맥락 더하기")}
        modeLabel={L("실행 중 보낸 입력")}
        modes={[T.modeSteer, T.modeFollowUp]}
        defaultMode={T.modeSteer}
        modelLabel="sonnet-5-5"
        usage={41}
        usageLabel={(p) => `${L("문맥")} ${p}%`}
        placeholder={placeholder}
        running={running}
        disabled={disabled}
        onAttach={() => {}}
        onStop={onStop ?? (() => {})}
        onSubmit={(t) => {
          onSubmit(t);
        }}
      />
    </div>
  );
}

/** 무대 틀: 머리, 트랜스크립트(바닥 따라감), 입력창 위 띠, 입력창. */
export function ChatStage({
  head,
  children,
  band,
  composer,
  follow,
}: {
  head: ReactNode;
  children: ReactNode;
  band?: ReactNode;
  composer?: ReactNode;
  /** 바뀌면 바닥으로 스크롤한다(트랜스크립트 길이 등). */
  follow: unknown;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [follow]);
  return (
    <>
      {head}
      <ScrollArea label="대화 내용" className="min-h-0 flex-1" viewportRef={viewport}>
        <div
          role="log"
          aria-live="polite"
          aria-label="대화 기록"
          className={`${READ_WIDTH} grid gap-4 pt-1 pb-3 [&>*]:min-w-0`}
        >
          {children}
        </div>
      </ScrollArea>
      {(band !== undefined || composer !== undefined) && (
        <div className={`${READ_WIDTH} grid flex-none gap-1.5 pb-1.5`}>
          {band}
          {composer}
        </div>
      )}
    </>
  );
}

/** 런타임 행 묶음(같은 턴의 행은 간격 1.5로 붙인다). */
export function RowGroup({ children }: { children: ReactNode }) {
  return <div className="grid gap-0.5">{children}</div>;
}
