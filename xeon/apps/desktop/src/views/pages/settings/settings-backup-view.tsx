import { Button, Dialog, DialogClose } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import { assertNever } from "@fresnel/contracts";
import type { ReactNode } from "react";
import type { BackupReport } from "../../../transport/ipc.ts";
import { FORM_CONTROL_SIZE, RowNote } from "./settings-section.tsx";
import { DataColumn, DoneLine, FolderField, RunningLine } from "./settings-data-card.tsx";
import {
  BACKUP_NOTE_IDS,
  backupBlockOf,
  type BackupBlock,
  type BackupPhase,
  type BackupState,
} from "./settings-backup-model.ts";

// 백업 만들기 구역(P-09 고급 탭)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// "백업과 복원" 카드의 왼쪽 열이다(DP-88): 제목(정보 아이콘 뒤에 포함과 제외, age 키 안내), 한 문장 설명, 경고(늘 보임),
// 상위 폴더 칸과 고르기 단추, 추천 폴더 칩, 만들기 단추(solid), 진행과 결과.
// 확인 대화 상자는 취소가 기본 초점이다. 백업은 되돌릴 일이 없어 실행 단추는 보통 톤이다. 경고는 대화 상자 안에도 보이게 둔다.

const BLOCK_ID: Readonly<Record<BackupBlock, MessageId>> = {
  running: "desktop.settings.backup.running",
  remote: "desktop.settings.backup.blocked.remote",
  blank: "desktop.settings.backup.blocked.blank",
  relative: "desktop.settings.backup.blocked.relative",
};

export interface BackupHandlers {
  readonly edit: (parent: string) => void;
  readonly ask: () => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

export interface BackupViewProps {
  readonly state: BackupState;
  readonly handlers: BackupHandlers;
  /** 폴더 선택 창을 여는 동작. 없으면(웹 등) 고르기 단추를 보이지 않는다 */
  readonly onPick?: (() => void) | undefined;
  /** 폴더 선택 창을 열지 못했을 때의 문장. 없으면 보이지 않는다 */
  readonly pickError?: string | null | undefined;
  /** 누르면 칸을 채우는 추천 폴더 */
  readonly suggestions?: readonly { readonly label: string; readonly path: string }[] | undefined;
}

export function BackupView(props: BackupViewProps): ReactNode {
  const { state, handlers, onPick } = props;
  const block = backupBlockOf(state);
  const running = state.phase.kind === "running";
  return (
    <DataColumn
      slot="settings-backup"
      title={t("desktop.settings.backup.title")}
      info={BACKUP_NOTE_IDS.map((id) => t(id))}
      infoLabel={t("desktop.settings.field.help.label", {
        label: t("desktop.settings.backup.title"),
      })}
      description={t("desktop.settings.backup.lead")}
    >
      <RowNote>{t("desktop.settings.backup.warn.secrets")}</RowNote>
      <FolderField
        label={t("desktop.settings.backup.path.label")}
        placeholder={t("desktop.settings.backup.path.placeholder")}
        value={state.parent}
        disabled={running}
        invalid={block === "relative"}
        onChange={handlers.edit}
        onPick={onPick}
        suggestions={props.suggestions}
      />
      {props.pickError === null || props.pickError === undefined ? null : (
        <p role="alert" className="m-0 text-ui text-text-secondary">
          {props.pickError}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <Button
          size={FORM_CONTROL_SIZE}
          disabled={block !== null}
          loading={running}
          onClick={handlers.ask}
        >
          {t("desktop.settings.backup.button")}
        </Button>
        {block === null || block === "running" ? null : (
          <p className="m-0 min-w-0 text-ui text-text-tertiary">{t(BLOCK_ID[block])}</p>
        )}
      </div>
      {running ? <RunningLine text={t("desktop.settings.backup.running")} /> : null}
      <PhaseView phase={state.phase} />
      <Dialog
        kind="alert"
        open={state.asking}
        onOpenChange={(open) => {
          if (!open) handlers.cancel();
        }}
        onKeyDown={(event) => {
          // Esc는 이 대화 상자를 닫는 데만 쓴다. 설정 화면의 Esc(초안 버리기)까지 올라가지 않게 여기서 막는다
          if (event.key === "Escape") event.stopPropagation();
        }}
        title={t("desktop.settings.backup.confirm.title")}
        description={<BackupConfirmText path={state.parent.trim()} />}
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" size="sm" autoFocus>
                {t("desktop.settings.cancel.button")}
              </Button>
            </DialogClose>
            {/* 확인은 컨트롤러가 대화 상자를 닫는다(asking을 내린다). 파괴적이지 않아 기본 톤이다 */}
            <Button size="sm" onClick={handlers.confirm}>
              {t("desktop.settings.backup.confirm.action")}
            </Button>
          </>
        }
      />
    </DataColumn>
  );
}

/**
 * 확인 대화 상자의 글: 만들 폴더, 시크릿 값 경고(보이게 둔다), 빼는 것. 대화 상자는 열렸을 때만 그리므로 글을 따로 그려 시험한다.
 */
export function BackupConfirmText(props: { readonly path: string }): ReactNode {
  return (
    <>
      <span className="block">
        {t("desktop.settings.backup.confirm.folder", { path: props.path })}
      </span>
      <span className="block font-medium text-text-primary">
        {t("desktop.settings.backup.warn.secrets")}
      </span>
      <span className="block">{t("desktop.settings.backup.note.excluded")}</span>
    </>
  );
}

/** 끝난 백업의 결과. 진행 중과 처음에는 아무것도 보이지 않는다(진행은 위의 줄이 보인다) */
function PhaseView(props: { readonly phase: BackupPhase }): ReactNode {
  const { phase } = props;
  switch (phase.kind) {
    case "idle":
    case "running":
      return null;
    case "done":
      return <DoneView report={phase.report} />;
    case "refused":
      return (
        <RowNote tone="danger">
          <span className="block">{phase.failure.message}</span>
          {phase.failure.fix === null ? null : <span className="block">{phase.failure.fix}</span>}
        </RowNote>
      );
    default:
      return assertNever(phase, "BackupPhase");
  }
}

function DoneView(props: { readonly report: BackupReport }): ReactNode {
  const { report } = props;
  return (
    <DoneLine
      text={t("desktop.settings.backup.done.blobs", { count: report.blobCount })}
      path={report.destDir}
      notes={[
        ...(report.missingBlobs.length === 0
          ? []
          : [t("desktop.settings.backup.done.missing", { count: report.missingBlobs.length })]),
        t("desktop.settings.backup.note.ageKey"),
      ]}
    />
  );
}
