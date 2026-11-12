import type { TargetEntry } from "@fresnel/client";
import { t } from "@fresnel/client/i18n";
import {
  Badge,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  IconButton,
  Input,
  Menu,
  MenuItem,
  MenuSeparator,
  Skeleton,
} from "@caustic/react";
import { Check, Ellipsis, Plus, X } from "@caustic/react/icons";
import { useId, useState, type ReactNode } from "react";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, RowNote } from "../settings/settings-section.tsx";
import { AddComputerDialog, ProbeView } from "./add-computer-dialog.tsx";
import {
  addressSummaryOf,
  cardStatusOf,
  kindBadgeOf,
  type AddMethod,
  type CardStatus,
} from "./add-computer-model.ts";
import type { ConnectionScreenHandlers } from "./connection-handlers.ts";
import {
  canConnect,
  sameChoice,
  searchShown,
  visibleTargets,
  type ConnectionState,
  type RenameState,
  type TargetChoice,
} from "./connection-model.ts";
import type { ProbeState } from "./connection-probe-model.ts";
import type { ComputersExtras, SectionContext } from "./connection-sections.ts";

// "다른 컴퓨터에 연결" 구역(시안 §5.1, DP-115). 머리 오른쪽 [컴퓨터 추가](outline sm), 그 아래 저장한 컴퓨터 카드 격자다.
// 격자는 구역 폭 36rem부터 2열(사이 8). 카드 = surface.base, 1px border.subtle(inset), 반경 lg, 안쪽 위아래 12 · 좌우 14.
//   1줄 이름 13/500 + 방식 배지 sm   2줄 주소 요약 mono 12 tertiary(말줄임)   3줄 상태 점 8 + 12 secondary ……… 동작
// 지금 쓰는 카드는 1px border.strong이고 [연결] 대신 [연결 시험]이 온다. 다른 카드는 [연결](outline sm)이고 연결 시험은 메뉴에 있다.
// 연결 시험 결과는 카드 안 아래쪽(카드 폭 그대로)에 점검 줄로 펼친다. 이름 바꾸기·지우기 확인은 대화 상자다.
// 설정 카드(`SettingSection`)는 카드 하나를 그리므로 이 구역은 같은 머리 모양을 직접 그리고 본문을 격자로 둔다.

/** 카드 안 상태 점 색. 글은 secondary다(색만으로 뜻을 주지 않는다) */
const DOT: Readonly<Record<CardStatus["tone"], string>> = {
  success: "bg-success-graphic",
  neutral: "bg-neutral-graphic",
  warning: "bg-warning-graphic",
  danger: "bg-danger-graphic",
};

const CARD_SUBTLE =
  "rounded-lg bg-surface-base shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]";
const CARD_STRONG =
  "rounded-lg bg-surface-base shadow-[inset_0_0_0_1px_var(--cs-color-border-strong)]";

function StatusLine(props: { readonly status: CardStatus | null }): ReactNode {
  const { status } = props;
  if (status === null) return <span className="min-w-0 flex-1" />;
  return (
    <span
      data-slot="computer-status"
      data-tone={status.tone}
      className="flex min-w-0 flex-1 items-center gap-2 text-ui-sm text-text-secondary"
    >
      <span aria-hidden className={`size-2 flex-none rounded-full ${DOT[status.tone]}`} />
      <span className="min-w-0 truncate">{t(status.key)}</span>
    </span>
  );
}

function CardMenu(props: {
  readonly entry: TargetEntry;
  readonly disabled: boolean;
  /** 메뉴 첫 항목의 연결 시험(다른 카드만). 지금 쓰는 카드는 단추로 나와 있어 null이다 */
  readonly onTest: (() => void) | null;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { entry, disabled, handlers, onTest } = props;
  const label = t("desktop.connection.computers.more", { name: entry.label });
  return (
    <Menu
      align="end"
      aria-label={label}
      trigger={
        <IconButton size={FORM_CONTROL_SIZE} variant="ghost" label={label} disabled={disabled}>
          <Ellipsis />
        </IconButton>
      }
    >
      {onTest === null ? null : (
        <MenuItem onSelect={onTest}>{t("desktop.connection.computers.test")}</MenuItem>
      )}
      <MenuItem
        onSelect={() => {
          handlers.renameOpen(entry);
        }}
      >
        {t("desktop.connection.computers.rename")}
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        tone="danger"
        onSelect={() => {
          handlers.removeAsk(entry);
        }}
      >
        {t("desktop.connection.computers.remove")}
      </MenuItem>
    </Menu>
  );
}

/** 저장한 컴퓨터 카드 하나 */
function ComputerCard(props: {
  readonly entry: TargetEntry;
  readonly state: ConnectionState;
  readonly status: CardStatus | null;
  /** 엔진이 이 컴퓨터를 가리킨다 */
  readonly current: boolean;
  /** 이 카드의 연결 시험 상태(한 번에 한 장). 없으면 null */
  readonly probe: ProbeState | null;
  /** 다른 카드가 시험 중이다(시험 단추를 잠근다) */
  readonly otherTesting: boolean;
  readonly web: boolean;
  readonly handlers: ConnectionScreenHandlers;
  readonly copy: (text: string) => void;
}): ReactNode {
  const { entry, state, status, current, probe, handlers, web } = props;
  const idle = state.busy || state.pending !== null;
  const choice: TargetChoice = { kind: "remote", entry };
  const badge = kindBadgeOf(entry.address);
  const summary = addressSummaryOf(entry.address);
  const testLocked = idle || props.otherTesting || probe?.busy === true;
  const test = (): void => {
    handlers.testRow(entry);
  };
  // 지금 쓰는 카드와 웹 셸(연결 단추가 없다)은 연결 시험을 단추로 둔다
  const testAsButton = current || web;
  return (
    <li
      data-slot="computer-card"
      data-current={current ? "" : undefined}
      className={`grid min-w-0 content-start gap-2 px-3.5 py-3 ${current ? CARD_STRONG : CARD_SUBTLE}`}
    >
      <div className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-ui font-medium text-text-primary">
            {entry.label}
          </span>
          {badge === null ? null : (
            <Badge size="sm" variant="soft" className="flex-none">
              {t(badge)}
            </Badge>
          )}
        </span>
        <span
          className="min-w-0 truncate font-mono text-mono-sm text-text-tertiary"
          title={entry.address}
        >
          {summary}
        </span>
      </div>
      <div className="flex min-h-7 min-w-0 items-center gap-1">
        <StatusLine status={status} />
        {testAsButton ? (
          <Button
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            disabled={testLocked}
            loading={probe?.busy === true}
            onClick={test}
          >
            {t("desktop.connection.computers.test")}
          </Button>
        ) : (
          <Button
            size={FORM_CONTROL_SIZE}
            variant="outline"
            disabled={!canConnect(state, choice)}
            onClick={() => {
              handlers.connect(choice);
            }}
          >
            {t("desktop.connection.computers.connect")}
          </Button>
        )}
        <CardMenu
          entry={entry}
          disabled={idle}
          onTest={testAsButton || testLocked ? null : test}
          handlers={handlers}
        />
      </div>
      {probe === null ? null : (
        <div className="min-w-0 border-t border-border-subtle pt-3">
          <ProbeView
            probe={probe}
            label={t("desktop.connection.computers.testLabel", { name: entry.label })}
            disabled={idle}
            onRun={(args) => {
              handlers.testRow(entry, args);
            }}
            onCopy={props.copy}
          />
        </div>
      )}
    </li>
  );
}

function renameErrorOf(rename: RenameState): string | null {
  if (rename.error === "empty") return t("desktop.connection.computers.renameEmpty");
  if (rename.error === "failed") return t("desktop.connection.computers.renameFailed");
  return null;
}

/** 이름 바꾸기 대화 상자. 이름이 비었거나 저장이 실패하면 칸 아래에 그 문장을 보인다 */
function RenameDialog(props: {
  readonly rename: RenameState | null;
  readonly busy: boolean;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const { rename, busy, handlers } = props;
  const id = useId();
  const error = rename === null ? null : renameErrorOf(rename);
  return (
    <Dialog
      kind="dialog"
      size="sm"
      open={rename !== null}
      onOpenChange={(open) => {
        if (!open) handlers.renameCancel();
      }}
      title={t("desktop.connection.computers.renameTitle")}
      footer={
        <>
          <Button
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            disabled={busy}
            onClick={handlers.renameCancel}
          >
            {t("desktop.connection.computers.cancel")}
          </Button>
          <Button
            size={FORM_CONTROL_SIZE}
            variant="solid"
            loading={busy}
            onClick={handlers.renameSubmit}
          >
            {t("desktop.connection.computers.save")}
          </Button>
        </>
      }
    >
      {rename === null ? null : (
        <form
          noValidate
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            handlers.renameSubmit();
          }}
        >
          <label htmlFor={id} className="text-ui font-medium text-text-primary">
            {t("desktop.connection.computers.name")}
          </label>
          <Input
            id={id}
            size={FORM_CONTROL_SIZE}
            containerClassName={FIELD_WIDTH.full}
            value={rename.label}
            invalid={error !== null}
            disabled={busy}
            onValueChange={handlers.renameField}
          />
          {error === null ? null : (
            <span role="alert" className="text-ui text-danger-text">
              {error}
            </span>
          )}
        </form>
      )}
    </Dialog>
  );
}

/** 지우기 확인. 목록에서만 지우고 그 컴퓨터의 서비스는 그대로 둔다 */
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
      title={t("desktop.connection.computers.removeTitle", { name: entry?.label ?? "" })}
      description={t("desktop.connection.computers.removeBody")}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size={FORM_CONTROL_SIZE} autoFocus>
              {t("desktop.connection.computers.keep")}
            </Button>
          </DialogClose>
          <DialogAction onClick={handlers.removeConfirm}>
            {t("desktop.connection.computers.removeConfirm")}
          </DialogAction>
        </>
      }
    />
  );
}

/** 목록 저장 알림 한 줄. 성공은 확인 아이콘, 실패는 경고 줄(RowNote)이다. 닫기 단추가 있다 */
function NoticeLine(props: {
  readonly state: ConnectionState;
  readonly handlers: ConnectionScreenHandlers;
}): ReactNode {
  const notice = props.state.notice;
  if (notice === null) return null;
  const dismiss = (
    <IconButton
      size="xs"
      variant="ghost"
      label={t("desktop.connection.computers.dismiss")}
      onClick={props.handlers.dismissNotice}
    >
      <X />
    </IconButton>
  );
  if (notice.tone === "danger") {
    return (
      <div data-slot="computers-notice" data-tone="danger" className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <RowNote tone="danger">{t(notice.id)}</RowNote>
        </div>
        {dismiss}
      </div>
    );
  }
  return (
    <p
      role="status"
      data-slot="computers-notice"
      data-tone="success"
      className="m-0 flex min-w-0 items-center gap-1.5 text-ui text-text-secondary"
    >
      <Check aria-hidden className="size-icon-sm flex-none text-success-text" />
      <span className="min-w-0 flex-1">{t(notice.id)}</span>
      {dismiss}
    </p>
  );
}

/** 빈 상태: 카드 안 가운데 위아래 24. 웹 셸은 시작 단추가 없다 */
function EmptyCard(props: {
  readonly web: boolean;
  readonly onAdd: (method: AddMethod) => void;
}): ReactNode {
  return (
    <div
      data-slot="computers-empty"
      className="grid justify-items-center gap-1 rounded-xl bg-surface-base px-4 py-6 text-center shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]"
    >
      <p className="m-0 text-ui text-text-secondary">
        {t("desktop.connection.computers.emptyTitle")}
      </p>
      <p className="m-0 text-ui text-text-tertiary">
        {t("desktop.connection.computers.emptyBody")}
      </p>
      {props.web ? null : (
        <div className="flex flex-wrap justify-center gap-2 pt-3">
          <Button
            size={FORM_CONTROL_SIZE}
            variant="outline"
            onClick={() => {
              props.onAdd("ssh");
            }}
          >
            {t("desktop.connection.computers.addSsh")}
          </Button>
          <Button
            size={FORM_CONTROL_SIZE}
            variant="ghost"
            onClick={() => {
              props.onAdd("web");
            }}
          >
            {t("desktop.connection.computers.addWeb")}
          </Button>
        </div>
      )}
    </div>
  );
}

function LoadingGrid(): ReactNode {
  return (
    <div
      role="status"
      data-slot="computers-loading"
      className="grid grid-cols-1 gap-2 @[36rem]:grid-cols-2"
    >
      <span className="sr-only">{t("desktop.connection.computers.loading")}</span>
      {[0, 1].map((i) => (
        <div key={i} className={`grid gap-2 px-3.5 py-3 ${CARD_SUBTLE}`}>
          <Skeleton width="45%" height={14} />
          <Skeleton width="65%" height={12} />
          <Skeleton width="30%" height={12} />
        </div>
      ))}
    </div>
  );
}

export function ComputersSection(props: SectionContext & ComputersExtras): ReactNode {
  const { state, engine, handlers, web, rowProbe } = props;
  const headingId = useId();
  // 대화 상자는 열 때마다 새로 그린다(`session`이 key, 닫혀 있으면 그리지 않는다). 빈 상태의 두 단추는 방식을 골라 연다
  const [adding, setAdding] = useState<{ readonly session: number; readonly method: AddMethod }>({
    session: 0,
    method: "ssh",
  });
  const [open, setOpen] = useState(false);
  const openAdd = (method: AddMethod): void => {
    setAdding((prev) => ({ session: prev.session + 1, method }));
    setOpen(true);
  };
  const idle = state.busy || state.pending !== null;
  const rows = visibleTargets(state);
  const testing = rowProbe?.probe.busy === true;
  const ready = state.list.kind === "ready";

  return (
    <section
      data-slot="computers-section"
      aria-labelledby={headingId}
      className="@container pt-10 first:pt-0"
    >
      <div className="mb-2 flex min-h-7 items-center gap-2">
        <h2 id={headingId} className="m-0 min-w-0 flex-1 text-title-2 text-text-primary">
          {t("desktop.connection.computers.title")}
        </h2>
        {web ? null : (
          <Button
            size={FORM_CONTROL_SIZE}
            variant="outline"
            disabled={idle}
            onClick={() => {
              openAdd("ssh");
            }}
          >
            <Plus aria-hidden />
            {t("desktop.connection.computers.add")}
          </Button>
        )}
      </div>
      <div className="grid gap-2">
        {web ? (
          <p data-slot="computers-web" className="m-0 text-ui text-text-tertiary">
            {t("desktop.connection.computers.webOnly")}
          </p>
        ) : null}
        <NoticeLine state={state} handlers={handlers} />
        {searchShown(state.items) ? (
          <Input
            type="search"
            size={FORM_CONTROL_SIZE}
            containerClassName={FIELD_WIDTH.medium}
            aria-label={t("desktop.connection.computers.search")}
            placeholder={t("desktop.connection.computers.search")}
            value={state.query}
            onValueChange={handlers.query}
          />
        ) : null}
        {state.list.kind === "loading" ? <LoadingGrid /> : null}
        {state.list.kind === "failed" ? (
          <RowNote tone="danger">{t("desktop.connection.computers.loadFailed")}</RowNote>
        ) : null}
        {ready && state.items.length === 0 ? <EmptyCard web={web} onAdd={openAdd} /> : null}
        {ready && state.items.length > 0 && rows.length === 0 ? (
          <p className="m-0 text-ui text-text-tertiary">
            {t("desktop.connection.computers.noMatch")}
          </p>
        ) : null}
        {ready && rows.length > 0 ? (
          <ul
            aria-labelledby={headingId}
            className="m-0 grid list-none grid-cols-1 items-start gap-2 p-0 @[36rem]:grid-cols-2"
          >
            {rows.map((entry) => {
              const choice: TargetChoice = { kind: "remote", entry };
              const probe = rowProbe?.id === entry.id ? rowProbe.probe : null;
              return (
                <ComputerCard
                  key={entry.id}
                  entry={entry}
                  state={state}
                  status={cardStatusOf(state, engine, choice)}
                  current={sameChoice(state.engineTarget, choice)}
                  probe={probe}
                  otherTesting={testing && probe === null}
                  web={web}
                  handlers={handlers}
                  copy={props.copy}
                />
              );
            })}
          </ul>
        ) : null}
      </div>
      {/* 열 때만 그린다(명령 맥락을 쓰고, 열 때마다 새 상태로 시작한다) */}
      {web || !open ? null : (
        <AddComputerDialog
          key={adding.session}
          open={open}
          method={adding.method}
          items={state.items}
          canConnectNow={state.pending === null && !state.busy}
          onClose={() => {
            setOpen(false);
          }}
          onAdd={handlers.addTarget}
          onCopy={props.copy}
        />
      )}
      <RenameDialog rename={state.rename} busy={state.busy} handlers={handlers} />
      <RemoveDialog entry={state.removing} handlers={handlers} />
    </section>
  );
}
