import { Alert, Button, IconButton, Popover } from "@caustic/react";
import { Info } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { useLastUserText } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { useDefaultModel, useSetupSnapshot, useThreadModel } from "./model-usage.ts";
import { keySecretOfModel, turnFailureOf, type TurnFailureAction } from "./turn-failure-model.ts";

// 실패한 턴의 오류 줄(SC-06). 한국어 한 문장 + 다음 행동 단추 하나, 원문은 정보 아이콘 뒤 "자세히"다(DP-58).
// 줄은 읽기 열(item-view ROW_CLASS)과 같은 폭 안에 서고 긴 원문은 줄바꿈하며 길면 잘라 보인다.

const DETAIL_MAX = 1200;

const ACTION_TEXT = {
  "reregister-key": "desktop.turnFailure.action.reregisterKey",
  "open-providers": "desktop.turnFailure.action.openProviders",
  "change-model": "desktop.turnFailure.action.changeModel",
  resend: "desktop.turnFailure.action.resend",
} as const;

/** 입력창 모델 고르기를 연다. 입력창 부품은 건드리지 않고 이름으로 찾아 누른다 */
function openModelPicker(): void {
  const picker = document.querySelector<HTMLElement>(
    `[aria-label="${t("desktop.composer.model.label")}"]`,
  );
  picker?.focus();
  picker?.click();
}

function Detail(props: { readonly text: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const clipped =
    props.text.length > DETAIL_MAX ? `${props.text.slice(0, DETAIL_MAX)}…` : props.text;
  return (
    <Popover
      trigger="click"
      size="xs"
      className="craft-glass"
      open={open}
      onOpenChange={setOpen}
      anchor={
        <IconButton label={t("desktop.turnFailure.detail.label")} size="xs" variant="ghost">
          <Info />
        </IconButton>
      }
    >
      <div className="max-w-96 whitespace-pre-wrap [overflow-wrap:anywhere]">{clipped}</div>
    </Popover>
  );
}

/** 끊긴 응답의 표시. 부분 답 바로 뒤, 오류 줄 위에 흐린 글 한 줄로 둔다(L4 desktop-ux 턴 실패 안내) */
export function CutMarker(): ReactNode {
  return (
    <div className="mx-auto w-full min-w-0 max-w-184 px-3">
      <p data-cut-marker className="m-0 text-ui-sm text-text-tertiary">
        {t("desktop.turnFailure.cutMarker")}
      </p>
    </div>
  );
}

export function TurnFailureRow(props: {
  readonly threadId: ThreadId;
  readonly error: string;
}): ReactNode {
  const commands = useCommands();
  const lastText = useLastUserText();
  const [busy, setBusy] = useState(false);
  // 실패한 턴의 모델(대화의 모델, 없으면 기본 모델)을 제공자 설정과 맞춰 그 제공자가 쓰는 키의 시크릿을 연다
  const fallbackModel = useDefaultModel();
  const model = useThreadModel(props.threadId, fallbackModel);
  const setup = useSetupSnapshot();
  const keySecret = keySecretOfModel(model.ref, setup?.providers ?? []);
  const view = turnFailureOf(props.error);
  const action = view.action;
  const run = (kind: TurnFailureAction): void => {
    if (kind === "reregister-key") {
      commands.requestSettingsJump(
        keySecret === null
          ? { tab: "secrets", key: null }
          : { tab: "secrets", key: null, secretName: keySecret },
      );
      return;
    }
    if (kind === "open-providers") {
      commands.requestSettingsJump({ tab: "providers", key: null });
      return;
    }
    if (kind === "change-model") {
      openModelPicker();
      return;
    }
    if (lastText === null) return;
    setBusy(true);
    detach(
      commands.sendTurn(props.threadId, lastText, crypto.randomUUID()).then(() => {
        setBusy(false);
        return undefined;
      }),
      rethrow,
    );
  };
  const blocked = action === "resend" && lastText === null;
  return (
    <div className="mx-auto w-full min-w-0 max-w-184 px-3 pb-4">
      <Alert
        tone="danger"
        emphasis="lead"
        role="alert"
        action={
          <span className="flex items-center gap-1.5">
            <Detail text={view.detail} />
            {action === null || blocked ? null : (
              <Button
                size="xs"
                variant="solid"
                loading={busy}
                onClick={() => {
                  run(action);
                }}
              >
                {t(ACTION_TEXT[action])}
              </Button>
            )}
          </span>
        }
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">
          {view.params === undefined ? t(view.text) : t(view.text, view.params)}
        </span>
      </Alert>
    </div>
  );
}
