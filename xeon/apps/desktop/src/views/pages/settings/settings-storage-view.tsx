import { Button, Dialog, DialogAction, DialogClose, Skeleton } from "@caustic/react";
import { t, type MessageId } from "@fresnel/client/i18n";
import type { ReactNode } from "react";
import { formatBytes } from "../../attachment-model.ts";
import { InfoTip } from "../../craft/info-tip.tsx";
import { StackedBar } from "../shared/stacked-bar.tsx";
import { shortenHome } from "./settings-file-paths.ts";
import { FORM_CONTROL_SIZE, RowNote, SettingSection } from "./settings-section.tsx";
import {
  previousLabelOf,
  storageRowsOf,
  type StorageRowKey,
  type StorageState,
} from "./settings-storage-model.ts";

// 저장 공간 구역(P-09 고급 탭)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 데이터 구역의 "저장 공간" 카드(DP-88): 머리 끝 새로 고침, 합계 한 줄, 누적 막대와 범례(`StackedBar`), 복원 전 사본 목록,
// 맨 아래 데이터 폴더 줄과 열기 단추. 셸이 이 명령을 모르는 접속(웹 미리보기)은 오류가 아니라 "이 접속에서는 볼 수 없어요" 한 줄이다.
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
  const unavailable = load.kind === "failed" && load.failure.kind === "unavailable";
  return (
    <SettingSection
      title={
        <span className="inline-flex items-center gap-1">
          {t("desktop.settings.storage.title")}
          <InfoTip
            text={INFO_IDS.map((id) => t(id))}
            label={t("desktop.settings.field.help.label", {
              label: t("desktop.settings.storage.title"),
            })}
          />
        </span>
      }
      end={
        load.kind === "remote" || unavailable ? undefined : (
          <Button
            variant="ghost"
            size={FORM_CONTROL_SIZE}
            disabled={load.kind === "loading" || busy}
            onClick={handlers.refresh}
          >
            {t("desktop.settings.storage.refresh")}
          </Button>
        )
      }
      body="plain"
    >
      <div
        data-slot="settings-storage"
        data-storage-state={unavailable ? "unavailable" : load.kind}
        className="grid min-w-0 gap-3"
      >
        {load.kind === "remote" ? (
          <p className="m-0 text-ui text-text-tertiary">{t("desktop.settings.storage.remote")}</p>
        ) : null}
        {load.kind === "loading" ? (
          <div
            role="status"
            aria-label={t("desktop.settings.storage.loading")}
            className="grid gap-3"
          >
            <Skeleton height={8} />
            <Skeleton height={14} width="60%" />
            <Skeleton height={14} width="45%" />
          </div>
        ) : null}
        {unavailable ? (
          <p className="m-0 text-ui text-text-tertiary">{load.failure.message}</p>
        ) : null}
        {load.kind === "failed" && !unavailable ? (
          <RowNote
            tone="danger"
            actions={
              <Button variant="outline" size="xs" onClick={handlers.refresh}>
                {t("desktop.update.retry.button")}
              </Button>
            }
          >
            <span className="block">{load.failure.message}</span>
            {load.failure.fix === null ? null : <span className="block">{load.failure.fix}</span>}
          </RowNote>
        ) : null}
        {load.kind === "ready" ? (
          <>
            <p className="m-0 text-ui font-medium text-text-primary tabular-nums">
              {t("desktop.settings.storage.total", {
                size: formatBytes(
                  storageRowsOf(load.usage).reduce((sum, row) => sum + row.bytes, 0),
                ),
              })}
            </p>
            <StackedBar
              label={t("desktop.settings.storage.title")}
              parts={storageRowsOf(load.usage).map((row) => ({
                key: row.key,
                label: t(ROW_ID[row.key]),
                value: row.bytes,
                valueText: formatBytes(row.bytes),
                detail:
                  row.key === "restorePrevious" && load.usage.previous.length > 0 ? (
                    <PreviousList
                      copies={load.usage.previous}
                      locale={locale}
                      busy={busy}
                      onAsk={handlers.ask}
                    />
                  ) : undefined,
              }))}
            />
            <div className="-mx-4 -mb-4 flex min-w-0 items-center gap-3 border-t border-border-subtle px-4 py-2">
              <span className="flex-none text-ui-sm text-text-tertiary">
                {t("desktop.settings.storage.folder.label")}
              </span>
              <span
                className="min-w-0 flex-1 truncate font-mono text-mono-sm text-text-secondary"
                title={load.usage.dataDir}
              >
                {shortenHome(load.usage.dataDir)}
              </span>
              <Button variant="outline" size={FORM_CONTROL_SIZE} onClick={handlers.openDataDir}>
                {t("desktop.settings.storage.folder.open")}
              </Button>
            </div>
          </>
        ) : null}
        {state.removeFailure === null ? null : (
          <RowNote tone="danger">
            <span className="block">{state.removeFailure.message}</span>
            {state.removeFailure.fix === null ? null : (
              <span className="block">{state.removeFailure.fix}</span>
            )}
          </RowNote>
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
    </SettingSection>
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

/** 복원 전 사본 목록(범례 "복원 전 데이터베이스" 줄 아래). 사본마다 시각(읽지 못하면 이름), 크기, 지우기 단추(xs)다 */
function PreviousList(props: {
  readonly copies: readonly { readonly name: string; readonly bytes: number }[];
  readonly locale: string;
  readonly busy: boolean;
  readonly onAsk: (name: string) => void;
}): ReactNode {
  const { copies, locale, busy, onAsk } = props;
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {copies.map((copy) => {
        const label = previousLabelOf(copy.name, locale);
        return (
          <li key={copy.name} className="flex min-h-7 min-w-0 items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-ui-sm text-text-tertiary">{label}</span>
            <span className="flex-none text-ui-sm text-text-tertiary tabular-nums">
              {formatBytes(copy.bytes)}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              aria-label={t("desktop.settings.storage.previous.remove.aria", { time: label })}
              onClick={() => {
                onAsk(copy.name);
              }}
            >
              {t("desktop.settings.storage.previous.remove")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
