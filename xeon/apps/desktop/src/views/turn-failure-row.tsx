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

// 실패한 턴의 오류 줄(SC-06). 한국어 한 문장 + 다음 행동 단추, 서버 사유는 정보 아이콘 뒤다(DP-58).
// 줄은 읽기 열(item-view ROW_CLASS)과 같은 폭 안에 서고 긴 사유는 줄바꿈하며 길면 잘라 보인다.
// 원인과 동작은 이 띠 하나가 든다(DP-146). 위 말풍선은 "보내지 못함" 글만 보이고 다시 보내기를 따로 두지 않는다.
// 대화 열 안의 띠라 Alert는 outline이다(DP-59): 바탕은 대화 바탕 그대로, 테두리와 아이콘만 위험 색이다.
// 단추 글 대비(대화 바탕 bg.app 위 danger.text): 라이트 5.41:1, 다크 6.91:1. 본문은 text.primary다(emphasis lead).

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

/**
 * 띠의 단추. 첫 단추는 원인을 고치는 동작(outline)이고, 그 동작이 키·모델·제공자를 고치는 것이면 고친 뒤 바로 다시 보낼 수 있게
 * "다시 보내기"(ghost)를 곁에 둔다. 다시 보내도 같은 결과인 실패(결제, 잘못된 요청: 동작 없음)는 다시 보내기를 두지 않는다
 */
export function failureButtonsOf(
  action: TurnFailureAction | null,
  canResend: boolean,
): { readonly primary: TurnFailureAction | null; readonly resend: boolean } {
  if (action === null) return { primary: null, resend: false };
  if (action === "resend") return { primary: canResend ? "resend" : null, resend: false };
  return { primary: action, resend: canResend };
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
  const buttons = failureButtonsOf(action, lastText !== null);
  return (
    <div className="mx-auto w-full min-w-0 max-w-184 px-3 pb-4">
      <Alert
        tone="danger"
        variant="outline"
        emphasis="lead"
        role="alert"
        action={
          <span className="flex items-center gap-1.5">
            <InfoTip text={view.detail} label={t("desktop.turnFailure.detail.label")} />
            {buttons.resend ? (
              <Button
                size="xs"
                variant="ghost"
                loading={busy}
                onClick={() => {
                  run("resend");
                }}
              >
                {t(ACTION_TEXT.resend)}
              </Button>
            ) : null}
            {buttons.primary === null ? null : (
              <Button
                size="xs"
                variant="outline"
                loading={buttons.primary === "resend" && busy}
                onClick={() => {
                  if (buttons.primary !== null) run(buttons.primary);
                }}
              >
                {t(ACTION_TEXT[buttons.primary])}
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
