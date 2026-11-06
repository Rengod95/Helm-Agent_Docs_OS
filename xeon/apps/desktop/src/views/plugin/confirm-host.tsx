import { Badge, Button, Dialog } from "@caustic/react";
import { Shield } from "@caustic/react/icons";
import {
  CONFIRM_CLICK_GUARD_MS,
  confirmBadges,
  confirmButtons,
  confirmLineText,
  type ConfirmAnswer,
  type ConfirmRequest,
} from "@fresnel/client/views/app";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

// 프레임 `call`·`command` 확인 줄의 셸 쪽 그림(ADR-0021 §3.4). 줄은 셸이 그리고 프레임 위에 뜨므로 프레임이 흉내 낼 수 없다.
// 요청은 한 번에 하나만 화면에 올라가고 나머지는 줄에서 기다린다. 줄이 뜬 뒤 `CONFIRM_CLICK_GUARD_MS` 안의 누름은 버린다.
// 거부는 Escape나 닫기로도 된다(누름 무시 시간과 무관하다). 글은 `ConfirmRequest` 필드만 쓴다. 그 필드는 매니페스트에서 온 값이다.

/** 화면에 뜬 요청 하나. `sequence`는 같은 요청을 다시 그리지 않도록 화면이 key로 쓴다 */
export interface ConfirmQueueItem {
  readonly request: ConfirmRequest;
  readonly sequence: number;
  /** 이 요청에 답한다. 이미 답했거나 줄에서 빠졌으면 아무 일도 없다 */
  readonly answer: (answer: ConfirmAnswer) => void;
}

export interface ConfirmQueue {
  /** 요청을 줄 끝에 넣고 답을 기다린다. 앞 요청이 끝나야 화면에 뜬다 */
  readonly request: (req: ConfirmRequest) => Promise<ConfirmAnswer>;
  /** 답하지 않은 요청을 거부로 끝내고 줄에서 뺀다. 다리가 내려갈 때 쓴다 */
  readonly cancel: (req: ConfirmRequest) => void;
  /** 지금 화면에 떠야 할 요청. 바뀔 때만 새 객체다 */
  readonly current: () => ConfirmQueueItem | undefined;
  /** 화면에 뜬 요청이 바뀌면 부른다. 해제 함수를 돌려준다 */
  readonly subscribe: (listener: () => void) => () => void;
}

interface Pending {
  readonly request: ConfirmRequest;
  readonly sequence: number;
  readonly resolve: (answer: ConfirmAnswer) => void;
  settled: boolean;
}

export function createConfirmQueue(): ConfirmQueue {
  const waiting: Pending[] = [];
  let head: Pending | undefined;
  let headItem: ConfirmQueueItem | undefined;
  let nextSequence = 0;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  /** 화면이 비었으면 줄 맨 앞을 올린다 */
  function promote(): void {
    if (head !== undefined) return;
    const next = waiting.shift();
    if (next === undefined) return;
    head = next;
    headItem = {
      request: next.request,
      sequence: next.sequence,
      answer: (answer) => {
        settle(next, answer);
      },
    };
  }

  /** 한 요청을 끝낸다. 같은 요청을 두 번 끝내지 않는다 */
  function settle(entry: Pending, answer: ConfirmAnswer): void {
    if (entry.settled) return;
    entry.settled = true;
    if (head === entry) {
      head = undefined;
      headItem = undefined;
    }
    entry.resolve(answer);
    promote();
    notify();
  }

  return {
    request(req) {
      return new Promise<ConfirmAnswer>((resolve) => {
        waiting.push({ request: req, sequence: nextSequence, resolve, settled: false });
        nextSequence += 1;
        if (head === undefined) {
          promote();
          notify();
        }
      });
    },
    cancel(req) {
      const queued = waiting.find((entry) => entry.request === req);
      if (queued !== undefined) {
        waiting.splice(waiting.indexOf(queued), 1);
        settle(queued, "deny");
        return;
      }
      if (head !== undefined && head.request === req) settle(head, "deny");
    },
    current() {
      return headItem;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 누름 하나의 판정. 줄이 뜬 뒤 `CONFIRM_CLICK_GUARD_MS`가 지나기 전의 누름은 허용이든 거부든 버린다.
 * 차이가 숫자가 아니면(NaN) 가드를 지난 것으로 보지 않는다. 실패할 때 허용되지 않게 한다.
 */
export function confirmActivation(
  shownAt: number,
  now: number,
  answer: ConfirmAnswer,
): "ignored" | ConfirmAnswer {
  return now - shownAt >= CONFIRM_CLICK_GUARD_MS ? answer : "ignored";
}

export interface ConfirmHostProps {
  readonly queue: ConfirmQueue;
  /** 누름 무시 시간을 재는 시계(밀리초). 시험은 고정 값을 넣는다. 기본은 `performance.now` */
  readonly now?: () => number;
}

const monotonicNow = (): number => performance.now();

/** 줄의 셸 쪽 자리. 요청이 없으면 아무것도 그리지 않는다. 줄은 셸 포털에 뜬다 */
export function ConfirmHost(props: ConfirmHostProps): ReactNode {
  const { queue } = props;
  const current = useSyncExternalStore(queue.subscribe, queue.current, queue.current);
  if (current === undefined) return null;
  return <ConfirmDialog key={current.sequence} item={current} now={props.now ?? monotonicNow} />;
}

function ConfirmDialog(props: {
  readonly item: ConfirmQueueItem;
  readonly now: () => number;
}): ReactNode {
  const { item, now } = props;
  // 줄이 뜬 시각. 요청마다 새로 잡히도록 화면이 요청 순번을 key로 준다
  const [shownAt] = useState(() => now());
  return (
    <ConfirmDialogView
      request={item.request}
      onAnswer={(answer) => {
        const outcome = confirmActivation(shownAt, now(), answer);
        if (outcome !== "ignored") item.answer(outcome);
      }}
      onDismiss={() => {
        item.answer("deny");
      }}
    />
  );
}

/**
 * 줄 그림. 글, 배지, 값 요약, 단추 두 개다. 처음 초점은 `defaultFocus`인 단추(거부)에 둔다.
 * `inline`은 포털 없이 제자리에 그린다. 시험과 미리보기에만 쓰고 셸은 포털을 쓴다.
 */
export function ConfirmDialogView(props: {
  readonly request: ConfirmRequest;
  readonly inline?: boolean;
  /** 단추를 눌렀을 때. 누름 무시 시간은 부르는 쪽이 본다 */
  readonly onAnswer: (answer: ConfirmAnswer) => void;
  /** Escape나 닫기. 거부와 같다 */
  readonly onDismiss: () => void;
}): ReactNode {
  const { request } = props;
  const focusRef = useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={props.inline ?? false}
      open
      icon={<Shield />}
      title={confirmLineText(request)}
      description={
        <span className="flex flex-wrap gap-1.5">
          {confirmBadges(request).map((badge) => (
            <Badge key={badge} size="sm">
              {badge}
            </Badge>
          ))}
        </span>
      }
      footer={confirmButtons().map((button) => (
        <Button
          key={button.answer}
          ref={button.defaultFocus ? focusRef : undefined}
          variant={button.defaultFocus ? "solid" : "outline"}
          size="sm"
          data-default-focus={button.defaultFocus ? "true" : undefined}
          onClick={() => {
            props.onAnswer(button.answer);
          }}
        >
          {button.label}
        </Button>
      ))}
      onOpenChange={(open) => {
        if (!open) props.onDismiss();
      }}
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        focusRef.current?.focus();
      }}
    >
      {request.paramsSummary === "" ? null : (
        <p className="m-0 break-all rounded-lg bg-neutral-track px-3 py-2 font-mono text-mono-sm text-text-primary">
          {request.paramsSummary}
        </p>
      )}
    </Dialog>
  );
}
