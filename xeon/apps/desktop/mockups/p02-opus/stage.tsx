// 무대: 머리(제목, 더보기 메뉴) + 트랜스크립트(스크롤) + 입력창(아래 고정).
import {
  Alert,
  Button,
  Composer,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  MenuSeparator,
  Message,
  ScrollArea,
  Suggestions,
  SuggestionsItem,
  Thinking,
} from "@caustic/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { approvals, transcript, type TranscriptItem } from "./fixtures";
import { Ellipsis, PanelLeft, T } from "../_shell";
import { ObserveBand } from "./parts/observe-band";
import { RichText } from "./parts/rich-text";
import { StreamingText } from "./parts/streaming-text";
import { ToolRow } from "./parts/tool-row";
import { QuestionCard, ToolApprovalCard } from "../_shell";
import { useMock } from "./store";

// 읽기 열: 가운데 46rem. 좌우 여백은 좁은 폭에서 가장자리에 닿지 않을 만큼만(3) 한 번 준다.
const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-3";

function StageHead() {
  const m = useMock();
  return (
    // 한 줄 머리: (사이드바가 닫혔을 때만) 열기, 제목. 선이나 띠 없이 간격으로만 나눈다.
    // 탐구·작업은 오른쪽 막대가 맡고, 찾기는 왼쪽 패널 머리가 맡는다(DP-05). 작업 폴더와 목표는 머리에 없다.
    <header className={`${READ_WIDTH} flex h-10 flex-none items-center gap-1`}>
      {!m.startOpen && (
        <IconButton
          size="sm"
          variant="ghost"
          label="사이드바 열기"
          aria-expanded={false}
          onClick={() => m.setStartOpen(true)}
          className="-ms-1.5"
        >
          <PanelLeft />
        </IconButton>
      )}
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5">
        <h1 className="m-0 truncate font-ui text-ui-strong text-text-primary">{m.currentTitle}</h1>
      </div>
      <Menu
        align="end"
        aria-label="대화 메뉴"
        trigger={
          <IconButton size="sm" variant="ghost" label="대화 메뉴">
            <Ellipsis />
          </IconButton>
        }
      >
        <MenuItem>이름 바꾸기</MenuItem>
        <MenuItem>분기</MenuItem>
        <MenuItem>대화 컴팩션</MenuItem>
        <MenuItem>체크포인트로 되돌리기</MenuItem>
        <MenuSeparator />
        <MenuItem>닫기</MenuItem>
        <MenuItem tone="danger">삭제</MenuItem>
      </Menu>
    </header>
  );
}

function Item({ item }: { item: TranscriptItem }) {
  const m = useMock();
  switch (item.kind) {
    case "user":
      return <Message author="user">{item.text}</Message>;
    case "agent":
      return (
        <Message>
          <p>
            <RichText text={item.text} />
          </p>
        </Message>
      );
    case "tool":
      return (
        <ToolRow name={item.name} detail={item.detail} status={item.status} output={item.output} />
      );
    case "thinking":
      return (
        <Thinking label="생각" status="done">
          {item.text}
        </Thinking>
      );
    case "approval": {
      if (m.state === "S6") {
        return (
          <div id="approval-inline">
            <QuestionCard
              approval={approvals.a2}
              status={
                m.decisions.a2 === "answered"
                  ? "answered"
                  : m.decisions.a2 === "denied"
                    ? "denied"
                    : "pending"
              }
              subtitle={`${approvals.a2.thread} · ${approvals.a2.at}`}
              answer={m.answer}
              onAnswerChange={m.setAnswer}
              onAnswer={() => m.decide("a2", "answered")}
              onDeny={() => m.decide("a2", "denied")}
              locked={m.reconnecting}
            />
          </div>
        );
      }
      return (
        <div id="approval-inline">
          <ToolApprovalCard
            approval={approvals.a1}
            decision={m.decisions.a1}
            subtitle={`${approvals.a1.thread} · ${approvals.a1.at}`}
            onDecide={(d) => m.decide("a1", d)}
            locked={m.reconnecting}
          />
        </div>
      );
    }
    case "streaming": {
      const live = m.running && !m.reconnecting;
      return (
        <Message
          streaming={live}
          meta={live ? undefined : m.reconnecting ? "연결이 돌아오면 이어서 써요" : "중단했어요"}
        >
          <p>
            <StreamingText text={item.text} live={live} />
          </p>
        </Message>
      );
    }
  }
}

function Transcript() {
  const m = useMock();
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = viewport.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [m.sent.length]);

  return (
    <ScrollArea label="대화 내용" className="min-h-0 flex-1" viewportRef={viewport}>
      <div
        role="log"
        aria-live="polite"
        aria-label="대화 기록"
        className={`${READ_WIDTH} grid gap-4 pt-1 pb-3`}
      >
        {m.currentId !== null &&
          transcript
            // 승인 카드는 그 승인을 낸 대화(t1)에만 있다. S6은 브리프대로 같은 자리에 질문 카드를 둔다.
            .filter((item) => item.kind !== "approval" || m.currentId === "t1")
            .map((item, i) => <Item key={i} item={item} />)}
        {m.sent.map((text, i) => (
          <div key={`sent-${i}`} className="grid justify-items-end gap-1">
            <Message author="user">{text}</Message>
            {m.running && (
              <span className="text-ui-xs text-text-tertiary">다음 도구 라운드 뒤 들어가요</span>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function EmptyThread() {
  const m = useMock();
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end overflow-auto">
      <div className={`${READ_WIDTH} grid gap-4 pb-3`}>
        <EmptyState variant="agent" surface="none" size="sm" title="무엇부터 할까요?" />
        <Suggestions aria-label="추천 시작 문장" variant="outline">
          <SuggestionsItem onClick={() => m.send("이 저장소 구조 설명")}>
            이 저장소 구조 설명
          </SuggestionsItem>
          <SuggestionsItem onClick={() => m.send("실패하는 테스트 찾기")}>
            실패하는 테스트 찾기
          </SuggestionsItem>
          <SuggestionsItem onClick={() => m.send("최근 변경 요약")}>최근 변경 요약</SuggestionsItem>
        </Suggestions>
      </div>
    </div>
  );
}

function ComposerArea() {
  const m = useMock();
  const [value, setValue] = useState("");
  const locked = m.reconnecting;

  if (m.observing)
    return (
      <div className={`${READ_WIDTH} flex-none pb-1.5`}>
        <ObserveBand onRetry={() => m.setLockedOpen(true)} />
      </div>
    );

  // 실행 중에는 Composer가 Enter 제출을 막는다. 실행 중 입력은 큐(steer)로 들어가므로 여기서 받아 트랜스크립트에 붙인다.
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (
      !m.running ||
      locked ||
      e.key !== "Enter" ||
      e.shiftKey ||
      e.nativeEvent.isComposing ||
      e.keyCode === 229
    )
      return;
    if (!(e.target instanceof HTMLTextAreaElement)) return;
    e.preventDefault();
    const text = value.trim();
    if (text === "") return;
    m.send(text);
    setValue("");
  };

  return (
    <div
      className={`${READ_WIDTH} grid flex-none gap-1 pb-1.5`}
      onKeyDownCapture={onKeyDownCapture}
    >
      <Composer
        inputRef={m.composerFocusRef}
        value={value}
        onValueChange={setValue}
        rows={2}
        inputLabel="메시지"
        sendLabel="보내기"
        stopLabel="중단"
        attachLabel="맥락 더하기"
        modeLabel="실행 중 보낸 입력"
        modes={[T.modeSteer, T.modeFollowUp]}
        defaultMode={T.modeSteer}
        modelLabel="sonnet-5-5"
        usage={m.currentId === null ? 0 : 41}
        usageLabel={(p) => `문맥 ${p}%`}
        placeholder={locked ? "연결이 돌아오면 보낼 수 있어요" : "메시지를 입력하세요"}
        running={m.running && !locked}
        disabled={locked}
        onAttach={() => {}}
        onStop={m.stop}
        onSubmit={(text) => {
          m.send(text);
          setValue("");
        }}
      />
    </div>
  );
}

export function StageContent() {
  const m = useMock();
  if (m.view === "none") {
    return (
      <div className="relative grid min-h-0 flex-1 place-items-center">
        {!m.startOpen && (
          <IconButton
            size="sm"
            variant="ghost"
            label="사이드바 열기"
            aria-expanded={false}
            onClick={() => m.setStartOpen(true)}
            className="absolute top-1.5 start-1.5"
          >
            <PanelLeft />
          </IconButton>
        )}
        <EmptyState
          surface="none"
          title="왼쪽에서 대화를 고르거나 새로 만드세요"
          actions={
            <Button size="sm" variant="solid" onClick={m.newThread} aria-keyshortcuts="Meta+N">
              새 대화
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <>
      <StageHead />
      {m.reconnecting && (
        <div className={`${READ_WIDTH} flex-none pb-2`}>
          <Alert
            tone="warning"
            action={
              <Button size="xs" variant="ghost" onClick={m.reconnect}>
                다시 연결
              </Button>
            }
          >
            연결을 다시 맞추는 중이에요
          </Alert>
        </div>
      )}
      {m.view === "empty" ? <EmptyThread /> : <Transcript />}
      <ComposerArea />
    </>
  );
}
