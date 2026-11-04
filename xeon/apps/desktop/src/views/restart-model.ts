// 다시 시작 줄과 확인 대화 상자의 모양(U-02). 그림은 `status-bar.tsx`와 `restart-confirm-dialog.tsx`가 그린다.
import { t } from "@fresnel/client/i18n";
import type { RestartReason } from "../state/ui/index.ts";
import type { EngineState } from "../transport/ipc.ts";

/** 상태 표시줄의 다시 시작 줄: 없음, 웹(글 한 줄만), 필요함(제목, 개수, 이유, 단추) */
export type RestartLine = "hidden" | "web" | "needed";

/** 다시 시작이 필요한 일이 없으면 줄이 없다. 셸이 없는 웹이면 단추 없이 한 줄만 둔다 */
export function restartLineOf(reasons: number, shellRestart: boolean): RestartLine {
  if (reasons === 0) return "hidden";
  return shellRestart ? "needed" : "web";
}

/** 단추를 보일지. 셸이 다시 띄울 수 있고 엔진이 running일 때만 보인다. 시작 중이나 다시 시작 중에는 숨긴다 */
export function canRestartNowOf(
  engine: EngineState["kind"] | null,
  shellRestart: boolean,
): boolean {
  return shellRestart && engine === "running";
}

type ConfirmLineId = "desktop.restart.confirm.turns" | "desktop.restart.confirm.approvals";
export type ConfirmLine = { readonly id: ConfirmLineId; readonly count: number };

/**
 * 다시 시작하면 멈추는 것의 목록. 0개인 줄은 뺀다. 목록이 비면 확인 없이 바로 다시 시작한다.
 * 승인 줄을 턴 줄보다 먼저 둔다. 턴 줄 끝의 "그래도 다시 시작할까요?"가 목록의 마지막 문장이 되도록 한다.
 */
export function restartConfirmOf(
  turns: number,
  approvals: number,
): { readonly needed: boolean; readonly lines: readonly ConfirmLine[] } {
  const lines: ConfirmLine[] = [];
  if (approvals > 0) lines.push({ id: "desktop.restart.confirm.approvals", count: approvals });
  if (turns > 0) lines.push({ id: "desktop.restart.confirm.turns", count: turns });
  return { needed: lines.length > 0, lines };
}

/** 이유 한 줄. 설치는 "{이름} 설치", 되돌리기는 "{이름} 되돌리기" */
export function restartReasonTextOf(reason: RestartReason): string {
  return reason.kind === "install"
    ? t("desktop.restart.reason.install", { name: reason.name })
    : t("desktop.restart.reason.rollback", { name: reason.name });
}

/** 정보 아이콘 글: 이유를 쉼표로 모으고 뒤에 설명을 붙인다. 이유가 없으면 설명만 남는다 */
export function restartInfoTextOf(reasons: readonly RestartReason[]): string {
  const info = t("desktop.restart.info");
  if (reasons.length === 0) return info;
  return `${reasons.map(restartReasonTextOf).join(", ")}. ${info}`;
}
