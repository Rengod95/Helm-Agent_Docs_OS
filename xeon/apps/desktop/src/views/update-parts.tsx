// 업데이트 칸 Popover의 본문과 다시 시작 확인 대화 상자(B-10, d02 `UpdateBody`, `RestartDialog`). 상태와 명령은 받지 않고 props만 쓴다.
// 버전 줄, 바뀐 점 세 줄, 내려받기 진행, 실패 이유와 오프라인 경고, 단추 한 줄을 그린다. 정보 설명은 정보 아이콘 뒤에 둔다.
// Popover 본문은 열 때만 그려지므로 시험은 이 부품을 직접 그린다.
import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  ListDescription,
  ListDescriptionRow,
  Progress,
} from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { InfoTip } from "./craft/info-tip.tsx";
import {
  notesLinesOf,
  primaryActionOf,
  progressPercentOf,
  reasonTextOf,
  updateTargetOf,
  type UpdateState,
} from "./update-model.ts";

export interface UpdateBodyHandlers {
  readonly download: () => void;
  readonly install: () => void;
  readonly retry: () => void;
}

export function UpdateBody(props: {
  readonly state: UpdateState;
  /** 지금 실행 중인 버전. 아직 모르면 `null`이다 */
  readonly currentVersion: string | null;
  readonly handlers: UpdateBodyHandlers;
}): ReactNode {
  const { state, currentVersion, handlers } = props;
  const target = updateTargetOf(state);
  const lines = notesLinesOf(target === null ? null : target.notes);
  const percent = progressPercentOf(state);
  const action = primaryActionOf(state);
  return (
    <div className="grid gap-2">
      <ListDescription
        variant="ghost"
        size="xs"
        aria-label={t("desktop.update.cell.title")}
        className="rounded-none [--cs-size-list-term:5rem] [&_[data-slot=list-description-row]]:px-0"
      >
        <ListDescriptionRow term={t("desktop.update.popover.now")} mono>
          {currentVersion ?? "-"}
        </ListDescriptionRow>
        {target === null ? null : (
          <ListDescriptionRow term={t("desktop.update.popover.next")} mono>
            {target.version}
          </ListDescriptionRow>
        )}
      </ListDescription>
      {lines.length === 0 ? null : (
        <div className="grid gap-1">
          <span className="text-ui text-text-tertiary">{t("desktop.update.popover.notes")}</span>
          <ul className="m-0 grid gap-0.5 ps-4 text-ui text-text-secondary">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {state.kind === "downloading" ? (
        <div className="grid gap-1">
          <Progress
            value={percent === null ? undefined : percent}
            size="xs"
            label={t("desktop.update.popover.progress")}
          />
          <span className="text-ui-xs text-text-tertiary tabular-nums">
            {percent === null
              ? t("desktop.update.popover.signatureLater")
              : t("desktop.update.popover.progressPercent", { percent })}
          </span>
        </div>
      ) : null}
      {state.kind === "failed" ? (
        <Alert tone="danger" size="sm">
          {t(reasonTextOf(state.reason))}
        </Alert>
      ) : null}
      {state.kind === "offline" ? (
        <Alert tone="warning" size="sm">
          {t("desktop.update.offline")}
        </Alert>
      ) : null}
      {action === null ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {action === "download" ? (
            <>
              <Button size="sm" onClick={handlers.download}>
                {t("desktop.update.download.button")}
              </Button>
              <InfoTip text={t("desktop.update.download.info")} />
            </>
          ) : null}
          {action === "install" ? (
            <>
              <Button size="sm" onClick={handlers.install}>
                {t("desktop.update.install.button")}
              </Button>
              <InfoTip text={t("desktop.restart.info")} />
            </>
          ) : null}
          {action === "retry" ? (
            <Button size="sm" variant="outline" onClick={handlers.retry}>
              {t("desktop.update.retry.button")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** 설치 전에 진행 중인 턴을 묻는 대화 상자. 기본 초점은 "나중에"다. 턴이 끝나면 설치하는 쪽은 이 칸이 기억한다 */
export function UpdateRestartDialog(props: {
  readonly open: boolean;
  /** 진행 중인 턴 수. 설치하면 이만큼 멈춘다 */
  readonly turns: number;
  readonly onLater: () => void;
  readonly onAfterTurn: () => void;
  readonly onNow: () => void;
}): ReactNode {
  return (
    <Dialog
      kind="alert"
      open={props.open}
      size="sm"
      tone="neutral"
      onOpenChange={(open) => {
        if (!open) props.onLater();
      }}
      title={t("desktop.update.restart.title")}
      description={t("desktop.update.restart.description", { count: props.turns })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.restart.later")}
            </Button>
          </DialogClose>
          <Button variant="outline" size="sm" onClick={props.onAfterTurn}>
            {t("desktop.update.restart.afterTurn")}
          </Button>
          <DialogAction
            onClick={() => {
              props.onNow();
            }}
          >
            {t("desktop.restart.now")}
          </DialogAction>
        </>
      }
    />
  );
}
