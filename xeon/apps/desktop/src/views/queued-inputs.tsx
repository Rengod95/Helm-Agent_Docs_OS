import { Badge, Button, Chip } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { assertNever, detach, rethrow } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useState, type ReactNode } from "react";
import { useQueuedInputs, type QueuedInput } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import {
  chipInputs,
  queuedModeText,
  queuedPreviewText,
  withdrawStateOf,
  type WithdrawState,
} from "./composer-model.ts";
import { InfoTip } from "./craft/info-tip.tsx";

// 입력창 위의 대기 입력 칩. 실행 중에 보낸 입력이 아직 모델에 전달되기 전이면 칩으로 보이고, 철회 단추가 `turn.withdraw`를 부른다.
// 칩은 거울의 `input.queued` 사실로 생기고 `input.placed`·`input.withdrawn`으로 사라진다. 철회 상태는 칩마다 따로 든다.

/** 칩 하나의 철회 상태에서 단추와 상태 글을 정한다 */
function chipControls(state: WithdrawState): {
  readonly busy: boolean;
  readonly locked: boolean;
  readonly retry: boolean;
} {
  switch (state.status) {
    case "idle":
      return { busy: false, locked: false, retry: false };
    case "withdrawing":
      return { busy: true, locked: true, retry: false };
    case "withdrawn":
    case "placed":
      return { busy: false, locked: true, retry: false };
    case "failed":
      return { busy: false, locked: false, retry: true };
    default:
      return assertNever(state, "WithdrawState");
  }
}

function QueuedChip(props: {
  readonly input: QueuedInput;
  readonly threadId: ThreadId;
  readonly disabled: boolean;
}): ReactNode {
  const commands = useCommands();
  const [state, setState] = useState<WithdrawState>({ status: "idle" });
  const text = queuedPreviewText(props.input.preview);
  const controls = chipControls(state);

  const withdraw = async (): Promise<void> => {
    setState({ status: "withdrawing" });
    const result = await commands.withdrawInput(props.threadId, props.input.requestId);
    setState(withdrawStateOf(result));
  };

  return (
    <li data-status={state.status} className="max-w-full">
      <Chip size="md" radius="md">
        <Badge size="xs" variant="outline">
          {queuedModeText(props.input.mode)}
        </Badge>
        <span className="min-w-0 truncate" title={text}>
          {text}
        </span>
        <Button
          size="xs"
          variant="ghost"
          loading={controls.busy}
          disabled={props.disabled || controls.locked}
          aria-label={t("desktop.composer.queue.withdraw.ariaLabel", { text })}
          onClick={() => {
            detach(withdraw(), rethrow);
          }}
        >
          {controls.retry
            ? t("desktop.composer.queue.withdraw.retry")
            : t("desktop.composer.queue.withdraw.button")}
        </Button>
        {state.status === "placed" ? (
          <span role="status" className="shrink-0 text-text-secondary">
            {t("desktop.composer.queue.withdraw.placed")}
          </span>
        ) : null}
        {state.status === "withdrawn" ? (
          <span role="status" className="shrink-0 text-text-secondary">
            {t("desktop.composer.queue.withdraw.done")}
          </span>
        ) : null}
        {state.status === "failed" ? (
          <span role="alert" className="shrink-0 text-danger-text">
            {state.message}
          </span>
        ) : null}
      </Chip>
    </li>
  );
}

/** 이 대화의 대기 입력 칩 목록. 칩이 없으면 아무것도 그리지 않는다 */
export function QueuedInputs(props: {
  readonly threadId: ThreadId;
  readonly disabledReason: string | null;
}): ReactNode {
  const chips = chipInputs(useQueuedInputs(props.threadId));
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <span className="text-ui-sm text-text-secondary">{t("term.inputQueue")}</span>
        <InfoTip text={t("desktop.composer.queue.info")} />
      </div>
      <ul aria-label={t("term.inputQueue")} className="flex flex-wrap gap-1.5">
        {chips.map((input) => (
          <QueuedChip
            key={input.inputId}
            input={input}
            threadId={props.threadId}
            disabled={props.disabledReason !== null}
          />
        ))}
      </ul>
    </div>
  );
}
