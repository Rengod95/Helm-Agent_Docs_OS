import { t } from "@fresnel/client/i18n";
import { Alert, Button, Dialog, Skeleton } from "@caustic/react";
import { useSyncExternalStore, type ReactNode } from "react";
import { InfoTip } from "./craft/info-tip.tsx";
import type {
  OriginFolderFailure,
  OriginFolderPicker,
  OriginFolderState,
} from "./origin-folder-picker.ts";

// 서버 폴더 고르기 대화 상자(L4.remote.spec §6.1). 상태와 동작은 `origin-folder-picker.ts`가 들고, 여기는 그리기만 한다.
// 경고와 실패는 늘 보이는 글이고, 긴 설명은 정보 아이콘 뒤에 둔다.

/** 대화 상자가 내는 동작. 속성 형태로 둬서 시험이 기록용 함수를 넣을 수 있다 */
export interface OriginFolderActions {
  readonly navigate: (path: string | null) => void;
  readonly choose: () => void;
  readonly cancel: () => void;
  readonly retry: () => void;
}

export interface OriginFolderDialogProps {
  readonly state: OriginFolderState;
  readonly actions: OriginFolderActions;
  /** 시험이 대화 상자를 문서 안에 그리게 한다 */
  readonly inline?: boolean;
}

function failureText(reason: OriginFolderFailure): string {
  return reason === "read_failed"
    ? t("desktop.originFolder.failedRead")
    : t("desktop.originFolder.failedOther");
}

function Body(props: {
  readonly state: OriginFolderState;
  readonly actions: OriginFolderActions;
}): ReactNode {
  const { state, actions } = props;
  if (!state.open) return null;
  const listing = state.listing;
  const parent = listing.kind === "ready" ? listing.parent : null;
  const path = listing.path;
  return (
    <div className="grid gap-3">
      <p className="m-0 flex items-center gap-1 text-ui-sm text-text-secondary">
        {t("desktop.originFolder.subtitle")}
        <InfoTip text={t("desktop.originFolder.info")} />
      </p>
      <div className="flex items-center gap-2">
        <Button
          size="xs"
          variant="outline"
          disabled={parent === null}
          onClick={() => {
            actions.navigate(parent);
          }}
        >
          {t("desktop.originFolder.up")}
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => {
            actions.navigate(null);
          }}
        >
          {t("desktop.originFolder.home")}
        </Button>
        <span className="sr-only">{t("desktop.originFolder.path")}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-ui-sm text-text-primary">
          {path ?? ""}
        </span>
      </div>
      {listing.kind === "loading" ? (
        <div role="status" className="grid gap-1.5">
          <Skeleton width="100%" height={16} />
          <Skeleton width="80%" height={16} />
          <Skeleton width="60%" height={16} />
          <span className="sr-only">{t("desktop.originFolder.loading")}</span>
        </div>
      ) : null}
      {listing.kind === "failed" ? (
        <Alert tone="danger" size="sm">
          <span role="alert" className="inline-flex flex-wrap items-center gap-2">
            {failureText(listing.reason)}
            <Button size="xs" variant="outline" onClick={actions.retry}>
              {t("desktop.originFolder.retry")}
            </Button>
          </span>
        </Alert>
      ) : null}
      {listing.kind === "ready" && listing.truncated ? (
        <Alert tone="warning" size="sm">
          {t("desktop.originFolder.truncated")}
        </Alert>
      ) : null}
      {listing.kind === "ready" && listing.entries.length === 0 ? (
        <p className="m-0 text-ui-sm text-text-secondary">{t("desktop.originFolder.empty")}</p>
      ) : null}
      {listing.kind === "ready" && listing.entries.length > 0 ? (
        <ul
          aria-label={t("desktop.originFolder.list")}
          className="m-0 grid max-h-64 list-none gap-0.5 overflow-y-auto p-0"
        >
          {listing.entries.map((entry) => (
            <li key={entry.path}>
              <Button
                size="sm"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => {
                  actions.navigate(entry.path);
                }}
              >
                {entry.name}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function OriginFolderDialog(props: OriginFolderDialogProps): ReactNode {
  const { state, actions, inline = false } = props;
  const ready = state.open && state.listing.kind === "ready";
  return (
    <Dialog
      kind="alert"
      size="sm"
      inline={inline}
      open={state.open}
      onOpenChange={(next) => {
        if (!next) actions.cancel();
      }}
      title={t("desktop.originFolder.title")}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={actions.cancel}>
            {t("desktop.originFolder.cancel")}
          </Button>
          <Button variant="solid" size="sm" disabled={!ready} onClick={actions.choose}>
            {t("desktop.originFolder.choose")}
          </Button>
        </>
      }
    >
      <Body state={state} actions={actions} />
    </Dialog>
  );
}

/** 선택기의 상태를 구독해 대화 상자를 그린다. 앱 트리에 한 번 둔다 */
export function OriginFolderDialogHost(props: { readonly picker: OriginFolderPicker }): ReactNode {
  const { picker } = props;
  const state = useSyncExternalStore(picker.subscribe, picker.getState);
  return (
    <OriginFolderDialog
      state={state}
      actions={{
        navigate: picker.navigate,
        choose: picker.choose,
        cancel: picker.cancel,
        retry: picker.retry,
      }}
    />
  );
}
