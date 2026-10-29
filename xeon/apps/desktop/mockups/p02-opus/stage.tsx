// 무대: 머리(제목, 작업 폴더, 목표 칩, 탐구·작업, 더보기 메뉴) + 트랜스크립트(스크롤) + 입력창(아래 고정).
import {
  Alert,
  Button,
  Chip,
  Composer,
  EmptyState,
  IconButton,
  Kbd,
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
import {
  Archive,
  Compass,
  Ellipsis,
  FlaskConical,
  FolderOpen,
  FolderTree,
  GitBranch,
  History,
  ListChecks,
  Minimize2,
  Pencil,
  SquarePen,
  Target,
  Trash2,
} from "./icons";
import { ObserveBand } from "./parts/observe-band";
import { QuestionCard } from "./parts/question-card";
import { RichText } from "./parts/rich-text";
import { StreamingText } from "./parts/streaming-text";
import { ToolRow } from "./parts/tool-row";
import { useMock } from "./store";
import { ToolApprovalCard } from "./tool-approval";

const READ_WIDTH = "mx-auto w-full max-w-[46rem] px-5";

function StageHead() {
  const m = useMock();
  return (
    <header className="flex min-w-0 flex-none items-center gap-2 border-b border-border-subtle py-2.5 pr-3 pl-5">
      <div className="min-w-0 flex-1">
        <h1 className="m-0 truncate font-ui text-title-4 text-text-primary">{m.currentTitle}</h1>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-ui-xs text-text-tertiary">
          <span className="inline-flex min-w-0 items-center gap-1">
            <FolderOpen aria-hidden className="size-icon-xs shrink-0" />
            <span className="truncate font-mono text-mono-sm">~/code/xeon</span>
          </span>
          {m.view === "thread" && (
            <Chip
              size="xs"
              variant="soft"
              icon={<Target />}
              onClick={() => m.openEnd("work")}
              aria-label="목표 3개 중 2개 이룸, 작업 탭 열기"
            >
              목표 2/3
            </Chip>
          )}
        </div>
      </div>
      {m.view === "thread" && (
        <>
          <Button
            size="sm"
            tone="neutral"
            variant="ghost"
            iconStart={<Compass />}
            onClick={() => m.openEnd("helm")}
            className="max-[520px]:hidden"
          >
            탐구
          </Button>
          <Button
            size="sm"
            tone="neutral"
            variant="ghost"
            iconStart={<ListChecks />}
            onClick={() => m.openEnd("work")}
            className="max-[520px]:hidden"
          >
            작업
          </Button>
        </>
      )}
      <Menu
        align="end"
        aria-label="대화 메뉴"
        trigger={
          <IconButton size="sm" variant="ghost" label="대화 메뉴">
            <Ellipsis />
          </IconButton>
        }
      >
        <MenuItem icon={<Pencil />}>이름 바꾸기</MenuItem>
        <MenuItem icon={<GitBranch />}>분기</MenuItem>
        <MenuItem icon={<Minimize2 />} end="/compact">
          대화 컴팩션
        </MenuItem>
        <MenuItem icon={<History />}>체크포인트로 되돌리기</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Archive />}>닫기</MenuItem>
        <MenuItem icon={<Trash2 />} tone="danger">
          삭제
        </MenuItem>
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
        <ToolRow
          name={item.name}
          detail={item.detail}
          status={item.status}
          duration={item.duration}
          output={item.output}
        />
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
        className={`${READ_WIDTH} grid gap-5 py-6`}
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
              <span className="text-ui-xs text-text-tertiary">
                다음 도구 라운드 뒤 들어가요 (steer)
              </span>
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
      <div className={`${READ_WIDTH} grid gap-6 py-6`}>
        <EmptyState
          variant="agent"
          surface="none"
          size="sm"
          title="무엇부터 할까요?"
          description="~/code/xeon에서 새 대화를 시작해요. 아래에서 고르거나 바로 적어 주세요."
        />
        <Suggestions aria-label="추천 시작 문장">
          <SuggestionsItem
            icon={<FolderTree />}
            hint="폴더와 패키지 구성"
            onClick={() => m.send("이 저장소 구조 설명")}
          >
            이 저장소 구조 설명
          </SuggestionsItem>
          <SuggestionsItem
            icon={<FlaskConical />}
            hint="bun test로 확인"
            onClick={() => m.send("실패하는 시험 찾기")}
          >
            실패하는 시험 찾기
          </SuggestionsItem>
          <SuggestionsItem
            icon={<History />}
            hint="최근 커밋 기준"
            onClick={() => m.send("최근 변경 요약")}
          >
            최근 변경 요약
          </SuggestionsItem>
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
      <div className={`${READ_WIDTH} flex-none pt-2 pb-4`}>
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
      className={`${READ_WIDTH} grid flex-none gap-1.5 pt-2 pb-4`}
      onKeyDownCapture={onKeyDownCapture}
    >
      <Composer
        inputRef={m.composerFocusRef}
        value={value}
        onValueChange={setValue}
        rows={2}
        inputLabel="메시지"
        sendLabel="보내기"
        stopLabel="중단 (⌘.)"
        attachLabel="맥락 더하기"
        modeLabel="실행 중 보낸 입력"
        modes={["steer", "followUp"]}
        defaultMode="steer"
        modelLabel="sonnet-5-5"
        usage={m.currentId === null ? 0 : 41}
        usageLabel={(p) => `문맥 ${p}% 사용`}
        placeholder={
          locked
            ? "연결이 돌아오면 보낼 수 있어요"
            : "메시지를 입력하세요. Enter 보내기, ⇧Enter 줄바꿈"
        }
        running={m.running && !locked}
        disabled={locked}
        onAttach={() => {}}
        onStop={m.stop}
        onSubmit={(text) => {
          m.send(text);
          setValue("");
        }}
      />
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 px-2 text-ui-xs text-text-tertiary">
        {locked ? (
          <span role="note">
            연결이 끊겨 입력창을 잠갔어요. 다시 연결되면 쓴 글을 보낼 수 있어요.
          </span>
        ) : (
          <>
            <span>
              <Kbd size="xs">Enter</Kbd> 보내기
            </span>
            <span>
              <Kbd size="xs">⇧Enter</Kbd> 줄바꿈
            </span>
            {m.running && (
              <span>
                <Kbd size="xs">⌘.</Kbd> 중단
              </span>
            )}
          </>
        )}
      </p>
    </div>
  );
}

export function StageContent() {
  const m = useMock();
  if (m.view === "none") {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6">
        <EmptyState
          icon={<SquarePen />}
          title="왼쪽에서 대화를 고르거나 새로 만드세요"
          description="대화는 작업 폴더별로 묶여 있어요."
          actions={
            <Button
              size="sm"
              tone="neutral"
              variant="solid"
              onClick={m.newThread}
              iconEnd={<Kbd size="xs">⌘N</Kbd>}
            >
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
        <div className={`${READ_WIDTH} flex-none pt-3`}>
          <Alert
            tone="warning"
            action={
              <Button size="xs" tone="warning" variant="soft" onClick={m.reconnect}>
                다시 연결
              </Button>
            }
          >
            연결을 다시 맞추는 중이에요 (2/3)
          </Alert>
        </div>
      )}
      {m.view === "empty" ? <EmptyThread /> : <Transcript />}
      <ComposerArea />
    </>
  );
}
