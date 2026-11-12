import { Alert, Button } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { detach, rethrow } from "@fresnel/contracts";
import { useState, type ReactNode } from "react";
import { useLastUserText } from "../state/engine/index.ts";
import { useCommands } from "./commands.ts";
import { InfoTip } from "./craft/info-tip.tsx";
import { useDefaultModel, useThreadModel } from "./model-usage.ts";
import { providerOfModelRef, turnFailureOf, type TurnFailureAction } from "./turn-failure-model.ts";

// 실패한 턴의 오류 줄(SC-06). 한국어 한 문장 + 다음 행동 단추 하나, 서버 사유는 정보 아이콘 뒤다(DP-58).
// 줄은 읽기 열(item-view ROW_CLASS)과 같은 폭 안에 서고 긴 사유는 줄바꿈하며 길면 잘라 보인다.

const ACTION_TEXT = {
  "add-key": "desktop.turnFailure.action.addKey",
  "change-key": "desktop.turnFailure.action.changeKey",
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

/** 끊긴 응답의 표시. 부분 답 바로 뒤, 오류 줄 위에 흐린 글 한 줄로 둔다(L4 desktop-ux 턴 실패 안내) */
export function CutMarker(): ReactNode {
  return (
    <div className="mx-auto w-full min-w-0 max-w-184 px-3">
      <p data-cut-marker className="m-0 text-ui text-text-tertiary">
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
  // 실패한 턴의 모델(대화의 모델, 없으면 기본 모델)의 제공자. 키 단추는 그 제공자의 키 대화 상자를 연다
  const fallbackModel = useDefaultModel();
  const model = useThreadModel(props.threadId, fallbackModel);
  const providerId = providerOfModelRef(model.ref);
  const view = turnFailureOf(props.error, providerId);
  const action = view.action;
  const run = (kind: TurnFailureAction): void => {
    if (kind === "add-key" || kind === "change-key") {
      commands.requestSettingsJump(
        providerId === null
          ? { tab: "providers", key: null }
          : { tab: "providers", key: null, providerId },
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
            <InfoTip text={view.detail} label={t("desktop.turnFailure.detail.label")} />
            {action === null || blocked ? null : (
              <Button
                size="xs"
                variant="soft"
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
