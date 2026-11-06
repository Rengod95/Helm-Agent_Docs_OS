// N-42·N-44 대화 무대의 빈칸: 읽는 중·읽기 실패, turn 실패 Alert, "새 메시지 N", 도구 결과 400자 미리보기, "이어서 실행" 띠와 결과.
// 모두 caustic 부품(Alert, Button, EmptyState, Skeleton, Progress, ToolCall)으로 짜고 색은 토큰만 쓴다.
import { Alert, Button, EmptyState, Progress, Skeleton, ToolCall } from "@caustic/react";
import { useId, useState } from "react";
import { josa, ArrowDown, ChevronRight, CircleAlert, RotateCcw, T } from "../../_shell";

/** 대화 여는 중: 머리 아래 얇은 진행 막대 + Skeleton 3행(§6.6 G). */
export function TranscriptLoading() {
  return (
    <div role="status" aria-label="대화를 읽는 중" className="grid gap-4 pt-2">
      <Progress decorative size="xs" />
      {[
        ["justify-self-end", "w-[55%]"],
        ["", "w-[85%]"],
        ["", "w-[70%]"],
      ].map(([self, w], i) => (
        <div key={i} className={`grid gap-1.5 ${self} ${w}`}>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-[70%]" />
        </div>
      ))}
    </div>
  );
}

/** 읽기 실패(§6.6 G): 무대 가운데 문장 하나와 "다시 읽기". 이유는 host가 준 그대로 tertiary. */
export function ReadFail({ onRetry, busy }: { onRetry: () => void; busy: boolean }) {
  return (
    <EmptyState
      size="sm"
      surface="none"
      icon={<CircleAlert />}
      title="대화를 읽지 못했어요"
      description="thread.open 시간 초과 · 10초"
      actions={
        <Button size="sm" variant="outline" loading={busy} onClick={onRetry}>
          다시 읽기
        </Button>
      }
    />
  );
}

/** turn 실패(§6.6 F): 트랜스크립트 아래 Alert danger(role=alert), 이유는 host 문장 그대로, 다음 턴 시작 때 지운다. */
export function TurnFail({
  reason,
  onRetry,
  onDismiss,
}: {
  reason: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <Alert
      tone="danger"
      emphasis="lead"
      actions={[{ label: "다시 시도", onClick: onRetry, primary: true }]}
      dismissible
      dismissLabel="실패 알림 닫기"
      onDismiss={onDismiss}
    >
      <b>{josa(T.turn, "이", "가")} 실패했어요.</b> {reason}
    </Alert>
  );
}

/** 위로 올려 읽는 중 새 항목이 오면: 입력창 위 가운데 "새 메시지 N", 누르면 맨 아래로(§6.6 H). */
export function NewMessages({ count, onJump }: { count: number; onJump: () => void }) {
  if (count === 0) return null;
  return (
    <div className="pointer-events-none flex justify-center">
      <Button
        size="xs"
        variant="outline"
        radius="full"
        iconStart={<ArrowDown />}
        className="pointer-events-auto shadow-2"
        aria-label={`새 메시지 ${count}개, 맨 아래로`}
        onClick={onJump}
      >
        새 메시지 {count}
      </Button>
    </div>
  );
}

/** 긴 도구 결과(§6.6 H): 접힌 머리 + 펼치면 400자 미리보기, "전체 보기"로 나머지. 실패 결과는 처음부터 펼침. */
export function LongToolRow({
  name,
  detail,
  duration,
  output,
  defaultOpen = false,
}: {
  name: string;
  detail: string;
  duration: string;
  output: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [all, setAll] = useState(false);
  const id = useId();
  const cut = output.length > 400;
  const shown = all || !cut ? output : `${output.slice(0, 400)}…`;
  return (
    <div className="relative">
      <ToolCall
        name={name}
        detail={detail}
        status="done"
        duration={duration}
        icon={
          <ChevronRight
            className={
              open
                ? "rotate-90 transition-transform duration-quick"
                : "transition-transform duration-quick"
            }
          />
        }
      >
        {open ? (
          <div id={id} className="grid gap-1">
            <pre className="m-0 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-mono-sm">
              {shown}
            </pre>
            {cut && (
              <Button
                size="xs"
                variant="ghost"
                className="relative z-10 -ms-2 justify-self-start"
                onClick={() => setAll(!all)}
              >
                {all
                  ? "400자만 보기"
                  : `전체 보기 · ${(output.length - 400).toLocaleString("ko-KR")}자 더`}
              </Button>
            )}
          </div>
        ) : null}
      </ToolCall>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`도구 ${name} ${detail}, 완료. 결과 ${open ? "접기" : "펼치기"}`}
        onClick={() => setOpen(!open)}
        className="absolute inset-x-0 top-0 h-10 cursor-pointer rounded-xl outline-none hover:bg-fill-hover focus-visible:focus-ring"
      />
    </div>
  );
}

/** "이어서 실행" 띠(N-44, §6.6 F, L4.desktop §4.7). 앱·엔진이 다시 시작된 뒤 비정상 종료 표식이 남은 턴. 자동 재개는 기본 꺼짐. */
export function ResumeBand({
  at,
  busy,
  onResume,
  onLeave,
}: {
  at: string;
  busy: boolean;
  onResume: () => void;
  onLeave: () => void;
}) {
  return (
    <Alert
      tone="warning"
      emphasis="lead"
      icon={<RotateCcw />}
      action={
        <span className="flex items-center gap-1.5">
          <Button size="xs" variant="ghost" disabled={busy} onClick={onLeave}>
            그대로 두기
          </Button>
          <Button size="xs" tone="warning" variant="solid" loading={busy} onClick={onResume}>
            {T.resume}
          </Button>
        </span>
      }
    >
      <b>중단된 {josa(T.turn, "이", "가")} 있어요.</b> {at}에 시작했고 앱이 다시 시작되며 멈췄어요.
    </Alert>
  );
}
