import type { TargetEntry } from "@fresnel/client";
import { t, type Locale, type MessageId } from "@fresnel/client/i18n";
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  DialogAction,
  DialogClose,
  Field,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Skeleton,
} from "@caustic/react";
import { Ellipsis } from "@caustic/react/icons";
import type { ReactNode } from "react";
import type { EngineState } from "../../../state/engine/index.ts";
import { HostAddressField } from "./host-address-field.tsx";
import { ConnectionSection } from "./connection-status.tsx";
import { CurrentHostCard, hostStatusOf, type HostStatus } from "./connection-current-host.tsx";
import { StatusBadge } from "./connection-badge.tsx";
import {
  canConnect,
  LOCAL_CHOICE,
  searchShown,
  sameChoice,
  visibleTargets,
  type ConnectionState,
  type RenameState,
  type TargetChoice,
} from "./connection-model.ts";
import { hostBadgeOf } from "./connection-text.ts";
import type { ConnectionScreenHandlers } from "./connection-view.tsx";

// "호스트" 섹션. 맨 위는 현재 호스트 카드, 그 아래는 호스트 목록(이 컴퓨터와 원격 호스트 행), 목록 아래에 추가 카드가 펼쳐진다.
// 섹션 머리 오른쪽에 호스트 추가 단추가 있고, 섹션 맨 위에는 저장 결과 알림이 온다. 행의 "연결"은 그 행의 호스트로 바꾼다.
// 원격 행의 더보기 메뉴는 이름 바꾸기와 삭제(확인 뒤)다. 이름 바꾸기와 삭제 확인은 대화 상자다.

/** 이름 바꾸기 칸에 쓰는 칸 글자. 칸 오류와 힌트는 13px다(caustic 기본은 11.5px) */
const FIELD_TEXT =
  "[&_[data-slot=field-error]]:text-ui [&_[data-slot=field-hint]]:text-ui [&_[data-slot=field-optional-mark]]:text-ui [&_[data-slot=field-required-mark]]:text-ui";

/** 목록의 한 줄. 이름과 종류 배지, 상태 배지를 한 줄에, 주소를 그 아래 고정폭으로 둔다. 오른쪽 끝은 동작이다 */
function HostRow(props: {
  readonly label: string;
  /** 원격 호스트의 주소. 이 기기는 주소가 없다 */
  readonly address: string | null;
  readonly kindBadge: MessageId | null;
  readonly status: HostStatus | null;
  /** 오른쪽 끝의 연결 단추 또는 "연결됨" 글 */
  readonly connect: ReactNode;
  /** 원격 행의 더보기 메뉴. 이 기기 행은 없다 */
  readonly menu: ReactNode;
}): ReactNode {
  const { label, address, kindBadge, status, connect, menu } = props;
  return (
    <div className="flex min-w-0 items-center gap-2 py-1">
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-ui-strong text-text-primary">{label}</span>
          {kindBadge === null ? null : (
            <Badge size="xs" className="bg-neutral-track text-text-secondary">
              {t(kindBadge)}
            </Badge>
          )}
          {status === null ? null : <StatusBadge tone={status.tone}>{t(status.label)}</StatusBadge>}
        </span>
        {address === null ? null : (
          <span
            className="min-w-0 truncate font-mono text-ui-sm font-normal text-text-tertiary"
            title={address}
          >
            {address}
          </span>
        )}
      </div>
      <div className="flex flex-none items-center gap-1">
        {connect}
        {menu}
      </div>
    </div>
  );
}

/**
 * 행의 "연결" 자리. 엔진이 이 호스트에 붙어 실행 중이면 "연결됨" 글이고, 그 밖의 현재 호스트(연결 중·실패·끊김)에는
 * 아무것도 두지 않는다(같은 대상은 다시 잇지 않는다). 다른 호스트는 연결 단추이고, 진행 중이면 잠근다.
 */
function ConnectSlot(props: {
  readonly state: ConnectionState;
  readonly choice: TargetChoice;
  readonly status: HostStatus | null;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, choice, status, handlers } = props;
  if (sameChoice(state.engineTarget, choice)) {
    return status?.tone === "success" ? (
      <span className="px-2 text-ui text-text-secondary">
        {t("desktop.connection.badge.connected")}
      </span>
    ) : null;
  }
  return (
    <Button
      size="sm"
      variant="soft"
      disabled={!canConnect(state, choice)}
      onClick={() => {
        handlers.connect(choice);
      }}
    >
      {t("desktop.connection.targets.connect")}
    </Button>
  );
}

/** 원격 행의 더보기 메뉴: 이름 바꾸기, 구분선, 삭제(확인 뒤). 진행 중에는 단추를 잠근다 */
function HostMenu(props: {
  readonly entry: TargetEntry;
  readonly disabled: boolean;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { entry, disabled, handlers } = props;
  const more = t("desktop.connection.targets.more", { name: entry.label });
  return (
    <Menu
      align="end"
      aria-label={more}
      trigger={
        <Button size="sm" variant="ghost" disabled={disabled} aria-label={more}>
          <Ellipsis />
        </Button>
      }
    >
      <MenuItem
        onSelect={() => {
          handlers.renameOpen(entry);
        }}
      >
        {t("desktop.connection.targets.rename")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        tone="danger"
        onSelect={() => {
          handlers.removeAsk(entry);
        }}
      >
        {t("desktop.connection.targets.remove")}
      </MenuItem>
    </Menu>
  );
}

/** 목록을 읽는 동안의 자리 */
function ListSkeleton(): ReactNode {
  return (
    <div role="status" className="grid content-start gap-2">
      <span className="sr-only">{t("desktop.connection.targets.loading")}</span>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} width={`${60 + ((i * 11) % 30)}%`} height={14} />
      ))}
    </div>
  );
}

/** 이름 바꾸기 칸의 오류 문장. 이름이 비었거나 저장에 실패했을 때만 있다 */
function renameErrorOf(rename: RenameState): string | undefined {
  if (rename.error === "empty") return t("desktop.connection.form.labelEmpty");
  if (rename.error === "failed") return t("desktop.connection.targets.saveFailed");
  return undefined;
}

/** 이름 바꾸기 대화 상자. 저장하면 목록을 다시 쓰고, 이름이 비었거나 저장이 실패하면 칸 아래에 그 문장을 보인다 */
function RenameDialog(props: {
  readonly rename: RenameState | null;
  readonly busy: boolean;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { rename, busy, handlers } = props;
  return (
    <Dialog
      kind="dialog"
      size="sm"
      open={rename !== null}
      onOpenChange={(open) => {
        if (!open) handlers.renameCancel();
      }}
      title={t("desktop.connection.rename.title")}
    >
      {rename === null ? null : (
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            handlers.renameSubmit();
          }}
        >
          <Field
            label={t("desktop.connection.form.label")}
            error={renameErrorOf(rename)}
            className={FIELD_TEXT}
          >
            <Input
              size="sm"
              value={rename.label}
              invalid={rename.error !== null}
              disabled={busy}
              onValueChange={handlers.renameField}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={handlers.renameCancel}
            >
              {t("desktop.connection.form.discard")}
            </Button>
            <Button type="submit" variant="solid" size="sm" loading={busy}>
              {t("desktop.connection.form.save")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** 삭제 확인 대화 상자. 목록에서만 지우고 호스트의 서비스는 그대로 둔다 */
function RemoveDialog(props: {
  readonly entry: TargetEntry | null;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { entry, handlers } = props;
  return (
    <Dialog
      kind="alert"
      size="sm"
      tone="danger"
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open) handlers.removeCancel();
      }}
      title={t("desktop.connection.remove.title")}
      description={t("desktop.connection.remove.body")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.connection.remove.keep")}
            </Button>
          </DialogClose>
          <DialogAction onClick={handlers.removeConfirm}>
            {t("desktop.connection.remove.confirm")}
          </DialogAction>
        </>
      }
    />
  );
}

/** "호스트" 섹션 하나. 현재 호스트 카드, 호스트 목록, 추가 카드, 이름 바꾸기와 삭제 확인을 그린다 */
export function HostSection(props: {
  readonly state: ConnectionState;
  readonly engine: EngineState | null;
  readonly locale: Locale;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { state, engine, locale, handlers } = props;
  const idle = state.busy || state.pending !== null;
  const rows = visibleTargets(state);
  const localStatus = hostStatusOf(state, engine, LOCAL_CHOICE);
  return (
    <ConnectionSection
      title={t("desktop.connection.targets.heading")}
      action={
        <Button
          size="sm"
          variant="soft"
          disabled={idle || state.form !== null}
          onClick={handlers.openForm}
        >
          {t("desktop.connection.targets.add")}
        </Button>
      }
    >
      <div className="grid gap-4">
        {state.notice === null ? null : (
          <Alert
            tone={state.notice.tone === "danger" ? "danger" : "success"}
            size="sm"
            variant="outline"
            className="text-ui"
            dismissible
            dismissLabel={t("desktop.connection.dismiss")}
            onDismiss={handlers.dismissNotice}
          >
            {t(state.notice.id)}
          </Alert>
        )}
        <CurrentHostCard state={state} engine={engine} locale={locale} handlers={handlers} />
        <div className="grid content-start gap-2">
          {searchShown(state.items) ? (
            <Input
              type="search"
              size="sm"
              aria-label={t("desktop.connection.targets.search")}
              placeholder={t("desktop.connection.targets.search")}
              value={state.query}
              onValueChange={handlers.query}
            />
          ) : null}
          {state.list.kind === "loading" ? <ListSkeleton /> : null}
          {state.list.kind === "failed" ? (
            <Alert tone="danger" size="sm" variant="outline" className="text-ui">
              {t("desktop.connection.targets.loadFailed")}
            </Alert>
          ) : null}
          {state.list.kind === "ready" && state.items.length === 0 ? (
            <p className="m-0 text-ui text-text-tertiary">
              {t("desktop.connection.targets.empty")}
            </p>
          ) : null}
          {/* 지금 연결된 호스트는 위 카드가 보이므로 목록에서 뺀다. 목록은 "옮겨 갈 수 있는 다른 호스트"다 */}
          <div className="grid gap-1">
            {sameChoice(state.engineTarget, LOCAL_CHOICE) ? null : (
              <HostRow
                label={t("desktop.connection.targets.local")}
                address={null}
                kindBadge={null}
                status={localStatus}
                connect={
                  <ConnectSlot
                    state={state}
                    choice={LOCAL_CHOICE}
                    status={localStatus}
                    handlers={handlers}
                  />
                }
                menu={null}
              />
            )}
            {rows.map((entry) => {
              const choice: TargetChoice = { kind: "remote", entry };
              if (sameChoice(state.engineTarget, choice)) return null;
              const status = hostStatusOf(state, engine, choice);
              return (
                <HostRow
                  key={entry.id}
                  label={entry.label}
                  address={entry.address}
                  kindBadge={hostBadgeOf(entry.address)}
                  status={status}
                  connect={
                    <ConnectSlot
                      state={state}
                      choice={choice}
                      status={status}
                      handlers={handlers}
                    />
                  }
                  menu={<HostMenu entry={entry} disabled={idle} handlers={handlers} />}
                />
              );
            })}
          </div>
          {state.items.length > 0 && rows.length === 0 ? (
            <p className="m-0 text-ui text-text-tertiary">
              {t("desktop.connection.targets.noMatch")}
            </p>
          ) : null}
        </div>
        {state.form === null ? null : (
          <Card variant="outline" size="md">
            <HostAddressField
              value={state.form.value}
              errors={state.form.errors}
              busy={state.busy}
              onChange={handlers.formChange}
              onSubmit={handlers.submitForm}
              onCancel={handlers.closeForm}
            />
          </Card>
        )}
      </div>
      <RenameDialog rename={state.rename} busy={state.busy} handlers={handlers} />
      <RemoveDialog entry={state.removing} handlers={handlers} />
    </ConnectionSection>
  );
}
