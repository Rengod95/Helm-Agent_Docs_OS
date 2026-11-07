import { Alert, Button, Dialog, DialogAction, DialogClose, Skeleton } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { formatBytes } from "../../attachment-model.ts";
import { InfoTip } from "./settings-field.tsx";
import {
  previousLabelOf,
  storageRowsOf,
  type StorageRowKey,
  type StorageState,
} from "./settings-storage-model.ts";

// 저장 공간 구역(P-09 고급 탭)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 고급 탭 카드 안의 줄 하나다: 제목(정보 아이콘 뒤에 줄마다 뜻), 데이터 폴더 줄과 열기 단추, 크기 줄들, 복원 전 사본 목록.
// 지우기 확인 대화 상자는 위험 톤이고 취소가 기본 초점이다. 되돌릴 수 없다는 말을 대화 상자에 둔다.

const ROW_ID: Readonly<Record<StorageRowKey, MessageId>> = {
  conversations: "desktop.settings.storage.row.conversations",
  attachments: "desktop.settings.storage.row.attachments",
  measurements: "desktop.settings.storage.row.measurements",
  logs: "desktop.settings.storage.row.logs",
  restorePrevious: "desktop.settings.storage.row.restorePrevious",
};

const INFO_IDS: readonly MessageId[] = [
  "desktop.settings.storage.info.conversations",
  "desktop.settings.storage.info.attachments",
  "desktop.settings.storage.info.measurements",
  "desktop.settings.storage.info.logs",
  "desktop.settings.storage.info.restorePrevious",
  "desktop.settings.storage.info.auto",
];

export interface StorageHandlers {
  readonly refresh: () => void;
  readonly openDataDir: () => void;
  readonly ask: (name: string) => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
}

export interface StorageViewProps {
  readonly state: StorageState;
  readonly handlers: StorageHandlers;
  /** 날짜와 시각을 적을 로케일 */
  readonly locale: string;
}

export function StorageView(props: StorageViewProps): ReactNode {
  const { state, handlers, locale } = props;
  const load = state.load;
  const busy = state.removeBusy;
  const removing = state.removing;
  const target =
    load.kind === "ready" && removing !== null
      ? load.usage.previous.find((copy) => copy.name === removing)
      : undefined;
  return (
    <div className="grid gap-2 py-3" data-slot="settings-storage">
      <div className="flex min-h-6 items-center gap-2">
        <span className="text-ui font-medium text-text-primary">
          {t("desktop.settings.storage.title")}
        </span>
        <InfoTip label={t("desktop.settings.storage.title")} lines={INFO_IDS.map((id) => t(id))} />
        <span className="flex-1" />
        <Button
          variant="outline"
          size="xs"
          disabled={load.kind === "loading" || load.kind === "remote" || busy}
          onClick={handlers.refresh}
        >
          {t("desktop.settings.storage.refresh")}
        </Button>
      </div>
      {load.kind === "remote" ? (
        <p className="text-ui-sm text-text-secondary">{t("desktop.settings.storage.remote")}</p>
      ) : null}
      {load.kind === "loading" ? (
        <div className="flex flex-col gap-1">
          <p role="status" className="text-ui-sm text-text-secondary">
            {t("desktop.settings.storage.loading")}
          </p>
          <Skeleton height={8} />
        </div>
      ) : null}
      {load.kind === "failed" ? (
        <Alert tone="danger">
          <span className="block">{load.failure.message}</span>
          {load.failure.fix === null ? null : <span className="block">{load.failure.fix}</span>}
        </Alert>
      ) : null}
      {load.kind === "ready" ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex-none text-ui-sm text-text-secondary">
              {t("desktop.settings.storage.folder.label")}
            </span>
            <span
              className="min-w-0 flex-1 truncate font-mono text-mono-sm text-text-tertiary"
              title={load.usage.dataDir}
            >
              {load.usage.dataDir}
            </span>
            <Button variant="outline" size="xs" onClick={handlers.openDataDir}>
              {t("desktop.settings.storage.folder.open")}
            </Button>
          </div>
          <ul className="grid gap-2">
            {storageRowsOf(load.usage).map((row) => (
              <li key={row.key} className="grid gap-1">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ui-sm text-text-secondary">{t(ROW_ID[row.key])}</span>
                  <span className="text-ui-sm text-text-primary">{formatBytes(row.bytes)}</span>
                </div>
                {row.key === "restorePrevious" ? (
                  <PreviousList
                    copies={load.usage.previous}
                    locale={locale}
                    busy={busy}
                    onAsk={handlers.ask}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {state.removeFailure === null ? null : (
        <Alert tone="danger">
          <span className="block">{state.removeFailure.message}</span>
          {state.removeFailure.fix === null ? null : (
            <span className="block">{state.removeFailure.fix}</span>
          )}
        </Alert>
      )}
      <Dialog
        kind="alert"
        tone="danger"
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) handlers.cancel();
        }}
        onKeyDown={(event) => {
          // Esc는 이 대화 상자를 닫는 데만 쓴다. 설정 화면의 Esc(초안 버리기)까지 올라가지 않게 여기서 막는다
          if (event.key === "Escape") event.stopPropagation();
        }}
        title={t("desktop.settings.storage.previous.confirm.title")}
        description={
          <PreviousConfirmText
            name={removing ?? ""}
            size={target === undefined ? null : formatBytes(target.bytes)}
          />
        }
        footer={
          <>
            <DialogClose asChild>
              <Button variant="outline" size="sm" autoFocus>
                {t("desktop.settings.cancel.button")}
              </Button>
            </DialogClose>
            <DialogAction onClick={handlers.confirm}>
              {t("desktop.settings.storage.previous.confirm.action")}
            </DialogAction>
          </>
        }
      />
    </div>
  );
}

/**
 * 지우기 확인 대화 상자의 글: 사본 폴더, 크기(알 때만), 되돌릴 수 없다는 말. 대화 상자는 열렸을 때만 그리므로 글을 따로 그려 시험한다.
 */
export function PreviousConfirmText(props: {
  readonly name: string;
  /** 사본 크기의 글. 목록에서 찾지 못했으면 `null`이다 */
  readonly size: string | null;
}): ReactNode {
  return (
    <>
      <span className="block">
        {t("desktop.settings.storage.previous.confirm.folder", { name: props.name })}
      </span>
      {props.size === null ? null : (
        <span className="block">
          {t("desktop.settings.storage.previous.confirm.size", { size: props.size })}
        </span>
      )}
      <span className="block">{t("desktop.settings.storage.previous.confirm.warn")}</span>
    </>
  );
}

/** 복원 전 사본 목록. 사본마다 시각(읽지 못하면 이름), 크기, 지우기 단추다. 없으면 흐린 한 줄이다 */
function PreviousList(props: {
  readonly copies: readonly { readonly name: string; readonly bytes: number }[];
  readonly locale: string;
  readonly busy: boolean;
  readonly onAsk: (name: string) => void;
}): ReactNode {
  const { copies, locale, busy, onAsk } = props;
  if (copies.length === 0) {
    return (
      <p className="text-ui-sm text-text-tertiary">
        {t("desktop.settings.storage.previous.empty")}
      </p>
    );
  }
  return (
    <ul className="grid gap-1 pl-3">
      {copies.map((copy) => {
        const label = previousLabelOf(copy.name, locale);
        return (
          <li key={copy.name} className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-ui-sm text-text-secondary">{label}</span>
            <div className="flex flex-none items-center gap-3">
              <span className="text-ui-sm text-text-secondary">{formatBytes(copy.bytes)}</span>
              <Button
                variant="outline"
                size="xs"
                disabled={busy}
                aria-label={t("desktop.settings.storage.previous.remove.aria", { time: label })}
                onClick={() => {
                  onAsk(copy.name);
                }}
              >
                {t("desktop.settings.storage.previous.remove")}
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
