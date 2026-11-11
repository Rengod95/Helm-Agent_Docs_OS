import { Button, Dialog, DialogAction, DialogClose } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import type { RestoreReport } from "../../../transport/ipc.ts";
import { FORM_CONTROL_SIZE, RowNote } from "./settings-section.tsx";
import { DataColumn, DoneLine, FolderField, RunningLine } from "./settings-data-card.tsx";
import { BACKUP_NOTE_IDS } from "./settings-backup-model.ts";
import { restoreBlockOf, type RestorePhase, type RestoreState } from "./settings-restore-model.ts";

// 데이터 복원 구역(P-09 고급 탭)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// "백업과 복원" 카드의 오른쪽 열이다(DP-88): 제목(정보 아이콘 뒤에 설명), 한 문장 설명, 경로 칸과 고르기 단추,
// "방금 만든 백업" 칩(이번 실행에서 만든 백업이 있을 때), 복원 단추, 진행과 결과.
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
  /** 폴더 선택 창을 여는 동작. 없으면(웹 등) 고르기 단추를 보이지 않는다 */
  readonly onPick?: (() => void) | undefined;
  /** 폴더 선택 창을 열지 못했을 때의 문장. 없으면 보이지 않는다 */
  readonly pickError?: string | null | undefined;
  /** 이번 실행에서 만든 백업 폴더. 있으면 "방금 만든 백업" 칩이 칸을 채운다 */
  readonly recent?: string | null | undefined;
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
  const { state, handlers, onPick } = props;
  const block = restoreBlockOf(state);
  const running = state.phase.kind === "running";
  return (
    <DataColumn
      slot="settings-restore"
      title={t("desktop.settings.restore.title")}
      info={[
        t("desktop.settings.restore.intro"),
        t("desktop.settings.restore.path.hint"),
        ...BACKUP_NOTE_IDS.map((id) => t(id)),
      ]}
      infoLabel={t("desktop.settings.field.help.label", {
        label: t("desktop.settings.restore.title"),
      })}
      description={t("desktop.settings.restore.lead")}
    >
      <FolderField
        label={t("desktop.settings.restore.path.label")}
        placeholder={t("desktop.settings.restore.path.placeholder")}
        value={state.path}
        disabled={running}
        invalid={block === "relative"}
        onChange={handlers.edit}
        onPick={onPick}
        suggestions={
          props.recent === null || props.recent === undefined
            ? undefined
            : [{ label: t("desktop.settings.restore.recent"), path: props.recent }]
        }
      />
      {block === "relative" ? (
        <p className="m-0 text-ui text-text-tertiary">
          {t("desktop.settings.restore.blocked.relative")}
        </p>
      ) : null}
      {props.pickError === null || props.pickError === undefined ? null : (
        <p role="alert" className="m-0 text-ui text-text-secondary">
          {props.pickError}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          variant="outline"
          size={FORM_CONTROL_SIZE}
          disabled={block !== null}
          loading={running}
          onClick={handlers.ask}
        >
          {t("desktop.settings.restore.button")}
        </Button>
        {block === "remote" ? (
          <p className="m-0 min-w-0 text-ui text-text-tertiary">
            {t("desktop.settings.restore.blocked.remote")}
          </p>
        ) : null}
      </div>
      {running ? <RunningLine text={t("desktop.settings.restore.running")} /> : null}
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
    </DataColumn>
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
        <RowNote tone="danger">
          <span className="block">{phase.refusal.message}</span>
          {phase.refusal.fix === null ? null : <span className="block">{phase.refusal.fix}</span>}
        </RowNote>
      );
    default:
      return assertNever(phase, "RestorePhase");
  }
}

function RestoredView(props: { readonly report: RestoreReport }): ReactNode {
  const { report } = props;
  return (
    <DoneLine
      text={t("desktop.settings.restore.done.blobs", { count: report.blobsAdded })}
      notes={[
        ...(report.missingBlobs.length === 0
          ? []
          : [t("desktop.settings.restore.done.missing", { count: report.missingBlobs.length })]),
        ...(report.previousDir === null
          ? []
          : [t("desktop.settings.restore.done.previous", { path: report.previousDir })]),
        ...(report.recovered === null ? [] : [t(recoveredIdOf(report.recovered))]),
        t("desktop.settings.restore.done.keyNotice"),
      ]}
    />
  );
}
