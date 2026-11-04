import { Alert, Button, Dialog, DialogAction, DialogClose, Input, Skeleton } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import type { RestoreReport } from "../../../transport/ipc.ts";
import { restoreBlockOf, type RestorePhase, type RestoreState } from "./settings-restore-model.ts";

// 데이터 복원 구역(P-09 고급 탭)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 확인 대화 상자는 취소가 기본 초점이고 실행 단추는 위험(danger) 톤이다. 그 안의 글이 복원이 하는 일과 하지 않는 일을 말한다.

export interface RestoreHandlers {
  readonly edit: (path: string) => void;
  readonly ask: () => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

export interface RestoreViewProps {
  readonly state: RestoreState;
  readonly handlers: RestoreHandlers;
}

/** 되돌린 방향의 문장 자리. 셸이 멈춘 이전 복원을 정리했을 때만 쓴다 */
function recoveredIdOf(direction: "rolled_back" | "rolled_forward"): MessageId {
  switch (direction) {
    case "rolled_back":
      return "desktop.settings.restore.done.recovered.rolledBack";
    case "rolled_forward":
      return "desktop.settings.restore.done.recovered.rolledForward";
    default:
      return assertNever(direction, "RestoreRecovered");
  }
}

export function RestoreView(props: RestoreViewProps): ReactNode {
  const { state, handlers } = props;
  const block = restoreBlockOf(state);
  const running = state.phase.kind === "running";
  return (
    <div className="flex flex-col gap-2" data-slot="settings-restore">
      <span className="text-ui-strong text-text-primary">
        {t("desktop.settings.restore.title")}
      </span>
      <p className="text-ui-sm text-text-secondary">{t("desktop.settings.restore.intro")}</p>
      <Input
        type="text"
        aria-label={t("desktop.settings.restore.path.label")}
        placeholder={t("desktop.settings.restore.path.placeholder")}
        value={state.path}
        disabled={running}
        spellCheck={false}
        onValueChange={handlers.edit}
      />
      <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.restore.path.hint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" disabled={block !== null} onClick={handlers.ask}>
          {t("desktop.settings.restore.button")}
        </Button>
        {block === "remote" ? (
          <p className="text-ui-sm text-text-secondary">
            {t("desktop.settings.restore.blocked.remote")}
          </p>
        ) : null}
      </div>
      {running ? (
        <div className="flex flex-col gap-1">
          <p role="status" className="text-ui-sm text-text-secondary">
            {t("desktop.settings.restore.running")}
          </p>
          <Skeleton height={8} />
        </div>
      ) : null}
      <PhaseView phase={state.phase} />
      <Dialog
        kind="alert"
        tone="danger"
        open={state.asking}
        onOpenChange={(open) => {
          if (!open) handlers.cancel();
        }}
        onKeyDown={(event) => {
          // Esc는 이 대화 상자를 닫는 데만 쓴다. 설정 화면의 Esc(초안 버리기)까지 올라가지 않게 여기서 막는다
          if (event.key === "Escape") event.stopPropagation();
        }}
        title={t("desktop.settings.restore.confirm.title")}
        description={
          <>
            <span className="block">
              {t("desktop.settings.restore.confirm.path", { path: state.path.trim() })}
            </span>
            <span className="block">{t("desktop.settings.restore.confirm.current")}</span>
            <span className="block">{t("desktop.settings.restore.confirm.engine")}</span>
            <span className="block">{t("desktop.settings.restore.confirm.secrets")}</span>
          </>
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" size="sm" autoFocus>
                {t("desktop.settings.cancel.button")}
              </Button>
            </DialogClose>
            <DialogAction onClick={handlers.confirm}>
              {t("desktop.settings.restore.confirm.action")}
            </DialogAction>
          </>
        }
      />
    </div>
  );
}

/** 끝난 복원의 결과. 진행 중과 처음에는 아무것도 보이지 않는다(진행은 위의 줄이 보인다) */
function PhaseView(props: { readonly phase: RestorePhase }): ReactNode {
  const { phase } = props;
  switch (phase.kind) {
    case "idle":
    case "running":
      return null;
    case "restored":
      return <RestoredView report={phase.report} />;
    case "refused":
      return (
        <Alert tone="danger">
          <span className="block">{phase.refusal.message}</span>
          {phase.refusal.fix === null ? null : <span className="block">{phase.refusal.fix}</span>}
        </Alert>
      );
    default:
      return assertNever(phase, "RestorePhase");
  }
}

function RestoredView(props: { readonly report: RestoreReport }): ReactNode {
  const { report } = props;
  return (
    <Alert tone="success">
      <ul className="flex flex-col gap-1">
        <li>{t("desktop.settings.restore.done.blobs", { count: report.blobsAdded })}</li>
        {report.missingBlobs.length === 0 ? null : (
          <li>
            {t("desktop.settings.restore.done.missing", { count: report.missingBlobs.length })}
          </li>
        )}
        {report.previousDir === null ? null : (
          <li>{t("desktop.settings.restore.done.previous", { path: report.previousDir })}</li>
        )}
        {report.recovered === null ? null : <li>{t(recoveredIdOf(report.recovered))}</li>}
        <li>{t("desktop.settings.restore.done.keyNotice")}</li>
      </ul>
    </Alert>
  );
}
