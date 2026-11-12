import { Button } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { detach, rethrow } from "@fresnel/contracts";
import { useSyncExternalStore, type ReactNode } from "react";
import { useUpdate } from "../../update-context.ts";
import {
  canCheck,
  primaryActionOf,
  retryStepOf,
  updateCellOf,
  updateLineOf,
  type UpdateStage,
  type UpdateState,
} from "../../update-model.ts";
import { FORM_CONTROL_SIZE, RowNote } from "./settings-section.tsx";

// 설정 "정보와 진단" 카드의 업데이트 부분(B-10, DP-86 [결정: 2026-11-11 사용자]). 세 조각으로 나눠 카드가 제자리에 놓는다:
//   `UpdateSummaryValue`  요약 칸의 값: 상태 점 + 짧은 상태 글(상태 표시줄 칸과 같은 글), 그 아래 현재 버전이 아닌 새 버전·진행 문장
//   `UpdateNote`          실패·오프라인일 때 요약 아래 경고 한 줄: 어느 단계에서 왜 실패했는지 + 다시 시도(상태 표시줄 "업데이트 실패"의 원인)
//   `updateButtonsOf`     동작 줄의 단추: 새 버전이면 solid "내려받기", 그 밖은 outline "업데이트 확인"
// 웹에는 업데이트 문맥이 없어 `useUpdateSlot`이 null이고 카드는 업데이트 칸을 그리지 않는다.

export interface UpdateSlot {
  readonly state: UpdateState;
  readonly currentVersion: string | null;
  readonly onCheck: () => void;
  /** 새 버전 내려받기, 또는 실패한 단계를 다시 시도 */
  readonly onDownload: () => void;
}

/** 업데이트 문맥을 구독한다. 문맥이 없으면(웹) null이다 */
export function useUpdateSlot(): UpdateSlot | null {
  const controller = useUpdate();
  const subscribe = controller?.subscribe ?? noopSubscribe;
  const read: () => UpdateState | null = controller?.getState ?? nullState;
  const state = useSyncExternalStore(subscribe, read, read);
  if (controller === null || state === null) return null;
  return {
    state,
    currentVersion: controller.currentVersion(),
    onCheck: () => {
      detach(controller.check(), rethrow);
    },
    onDownload: () => {
      detach(state.kind === "available" ? controller.download() : controller.retry(), rethrow);
    },
  };
}

function noopSubscribe(): () => void {
  return () => undefined;
}

function nullState(): null {
  return null;
}

const DOT: Readonly<Record<"success" | "warning" | "danger" | "neutral", string>> = {
  success: "bg-success-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
  neutral: "bg-neutral-graphic",
};

/** 요약 칸의 값. 상태 점과 짧은 상태 글, 진행 중·새 버전이면 그 문장을 한 줄 더 */
export function UpdateSummaryValue(props: { readonly state: UpdateState }): ReactNode {
  const { state } = props;
  const cell = updateCellOf(state);
  const line = updateLineOf(state);
  const detail =
    state.kind === "available" || state.kind === "downloading" || state.kind === "ready";
  return (
    <span role="status" className="grid min-w-0 gap-0.5" data-update-state={state.kind}>
      <span className="flex min-w-0 items-center gap-1.5 text-ui text-text-primary">
        <span aria-hidden className={`size-1.5 flex-none rounded-full ${DOT[cell.dot]}`} />
        <span className="min-w-0 truncate">
          {t(state.kind === "unconfigured" ? "desktop.settings.about.update.off" : cell.text, {
            percent: progressOf(state),
          })}
        </span>
      </span>
      {detail ? (
        <span className="text-ui-sm text-text-tertiary">{t(line.text, line.args)}</span>
      ) : null}
    </span>
  );
}

function progressOf(state: UpdateState): number {
  if (state.kind !== "downloading" || state.total === null || state.total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((state.downloaded * 100) / state.total)));
}

const STAGE_TEXT: Readonly<Record<UpdateStage, MessageId>> = {
  check: "desktop.settings.about.update.stage.check",
  download: "desktop.settings.about.update.stage.download",
  install: "desktop.settings.about.update.stage.install",
};

/** 실패·오프라인의 원인 한 줄과 다시 시도. 그 밖의 상태는 아무것도 그리지 않는다 */
export function UpdateNote(props: { readonly slot: UpdateSlot }): ReactNode {
  const { state } = props.slot;
  const stage = retryStepOf(state);
  if (stage === null) return null;
  const line = updateLineOf(state);
  return (
    <RowNote tone={state.kind === "failed" ? "danger" : "warning"} slot="settings-update-note">
      {`${t(STAGE_TEXT[stage])} ${t(line.text, line.args)}`}
    </RowNote>
  );
}

/**
 * 동작 줄에 놓을 업데이트 단추 하나. 설정이 안 됐으면 없다. 멈춘 단계가 있으면 그 단계를 다시 하는 "다시 시도"(outline),
 * 새 버전이면 내려받기(solid), 그 밖은 업데이트 확인(outline). 실패 까닭은 위 `UpdateNote`가 말하므로 단추는 한 줄에 하나뿐이다.
 */
export function UpdateButtons(props: { readonly slot: UpdateSlot }): ReactNode {
  const { state, onCheck, onDownload } = props.slot;
  if (state.kind === "unconfigured") return null;
  const stage = retryStepOf(state);
  if (stage !== null) {
    return (
      <Button
        variant="outline"
        size={FORM_CONTROL_SIZE}
        onClick={stage === "check" ? onCheck : onDownload}
      >
        {t("desktop.update.retry.button")}
      </Button>
    );
  }
  if (primaryActionOf(state) === "download") {
    return (
      <Button size={FORM_CONTROL_SIZE} onClick={onDownload}>
        {t("desktop.update.download.button")}
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size={FORM_CONTROL_SIZE}
      loading={state.kind === "checking"}
      disabled={!canCheck(state)}
      onClick={onCheck}
    >
      {t("desktop.update.check.button")}
    </Button>
  );
}
