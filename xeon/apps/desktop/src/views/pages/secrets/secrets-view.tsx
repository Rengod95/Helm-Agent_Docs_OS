import { t, type Locale, type MessageId } from "@fresnel/client/i18n";
import type { EdgeChoice, KeyField } from "@fresnel/client/settings";
import type { SecretName } from "@fresnel/contracts/capabilities";
import type { SecretListEntry } from "@fresnel/contracts/wire";
import { Alert, Button, Input, Select, SelectOption, Sheet, Skeleton } from "@caustic/react";
import { Plus } from "@caustic/react/icons";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { FIELD_WIDTH, FORM_CONTROL_SIZE, SettingSection } from "../settings/settings-section.tsx";
import { UsageLogDialog } from "./secret-audit.tsx";
import { InfoTip } from "../../craft/info-tip.tsx";
import { PanelExpandButton } from "../../shell/screen-header.tsx";
import type { MetaDraft } from "./secret-draft.ts";
import { EntryDialog, MetaDialog, RemoveDialog } from "./secret-dialogs.tsx";
import { SecretDetail, type SecretDetailHandlers } from "./secret-detail.tsx";
import type { KeyStoreView, KeyWhere } from "./key-store-model.ts";
import { KeyStoreRow } from "./key-store-row.tsx";
import {
  keyIntentOf,
  secretsViewOf,
  SORT_KEYS,
  type KeyIntent,
  type SecretSort,
  type SecretsState,
} from "./secret-model.ts";
import {
  commandErrorText,
  lastUsedTextOf,
  statusViewOf,
  usedByOf,
  type StatusTone,
} from "./secret-text.ts";

// 시크릿 화면(P-10, DP-85 [결정: 2026-11-11 사용자])의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 머리 줄(한 줄 안내 + 정보 아이콘 + "시크릿 추가") → 표 카드(이름 · 쓰는 곳 · 허용 호스트 · 마지막 사용 · 상태) → 오른쪽 시트(상세).
// 바로 가기 키의 뜻은 `keyIntentOf`가, 실제 동작은 `secrets-screen.tsx`가 맡는다. 시트를 여닫는 일만 여기서 한다.

/** 입력 칸(편집 가능)을 고른다. 여기에 초점이 있으면 화면 바로 가기 키는 아무것도 하지 않는다 */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

export interface SecretsScreenHandlers {
  readonly add: () => void;
  readonly retry: () => void;
  readonly query: (query: string) => void;
  readonly sort: (sort: SecretSort) => void;
  readonly select: (name: SecretName) => void;
  /** 화면 바로 가기 키 중 상세 초점 이동을 뺀 나머지(↑↓, ⌘C, Esc) */
  readonly intent: (intent: KeyIntent) => void;
  readonly dismissNotice: () => void;
  readonly detail: SecretDetailHandlers;
  readonly entryName: (name: string) => void;
  readonly entryNext: () => void;
  readonly entrySubmit: (field: KeyField, edge: EdgeChoice) => void;
  readonly entryClose: () => void;
  readonly metaDraft: (draft: MetaDraft) => void;
  readonly metaSubmit: () => void;
  readonly metaClose: () => void;
  readonly removeConfirm: () => void;
  readonly removeClose: () => void;
  /** "열쇠 보관" 줄에서 방식을 고른 것(옮기기) */
  readonly keyStore: (to: KeyWhere) => void;
}

export interface SecretsScreenViewProps {
  readonly state: SecretsState;
  /** 값이 지금 보일 때만 그 글자. 상태에는 없다 */
  readonly shownText: string | null;
  readonly locale: Locale;
  readonly nowMs: number;
  readonly handlers: SecretsScreenHandlers;
  /** "열쇠 보관" 줄의 그림 상태(`keyStoreViewOf`) */
  readonly keyStore: KeyStoreView;
  /** 설정 화면 안: 바깥 스크롤과 머리 제목을 쓴다 */
  readonly embedded?: boolean;
}

function sortOf(value: string): SecretSort | null {
  return SORT_KEYS.find((sort) => sort === value) ?? null;
}

const SORT_ID: Readonly<Record<SecretSort, MessageId>> = {
  name: "desktop.secrets.sort.name",
  lastUsed: "desktop.secrets.sort.lastUsed",
  expiry: "desktop.secrets.sort.expiry",
  status: "desktop.secrets.sort.status",
};

export function SecretsScreenView(props: SecretsScreenViewProps): ReactNode {
  const { state, shownText, locale, nowMs, handlers } = props;
  const headingId = useId();
  const detailRef = useRef<HTMLElement | null>(null);
  // 시트는 줄을 누르거나 Enter로 연다. 고른 줄(↑↓)은 시트가 닫혀 있어도 남는다
  const [sheetOpen, setSheetOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const view = secretsViewOf(state);
  const selected = view.selected;
  const failure = view.failed === null ? null : commandErrorText(view.failed);
  const embedded = props.embedded === true;

  const onKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const intent = keyIntentOf({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      editable: target !== null && target.closest(EDITABLE) !== null,
      onRow: target !== null && target.getAttribute("role") === "row",
      revealed: view.reveal.status === "revealed",
    });
    if (intent === null) return;
    event.preventDefault();
    if (intent.type === "detail") {
      setSheetOpen(true);
      return;
    }
    handlers.intent(intent);
  };

  const add = (
    <Button size={FORM_CONTROL_SIZE} variant="solid" disabled={!view.acting} onClick={handlers.add}>
      <Plus aria-hidden />
      {t("desktop.secrets.add")}
    </Button>
  );

  return (
    <section
      aria-labelledby={headingId}
      className={embedded ? "grid gap-4" : "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"}
      onKeyDown={onKey}
    >
      <div data-slot="secrets-head" className="flex min-h-7 flex-wrap items-center gap-3">
        {embedded ? null : <PanelExpandButton />}
        <h1 id={headingId} className={embedded ? "sr-only" : "m-0 text-title-2 text-text-primary"}>
          {t("desktop.secrets.title")}
        </h1>
        <p className="m-0 flex min-w-0 flex-1 items-center gap-1 text-ui text-text-secondary">
          <span className="min-w-0">{t("desktop.secrets.lead")}</span>
          {/* 키 안내와 백업에서 빠지는 것도 같은 정보 아이콘 뒤에 둔다(백업 구역과 같은 글) */}
          <InfoTip
            text={[
              t("desktop.secrets.intro"),
              t("desktop.settings.backup.note.ageKey"),
              t("desktop.settings.backup.note.excluded"),
            ]}
          />
        </p>
        {state.rows.length === 0 ? null : add}
      </div>
      {view.offline ? (
        <Alert tone="info" variant="outline" size="sm">
          {t("desktop.secrets.offline")}
        </Alert>
      ) : null}
      {failure === null ? null : (
        <Alert
          tone="danger"
          variant="outline"
          size="sm"
          action={
            <Button
              size={FORM_CONTROL_SIZE}
              variant="outline"
              disabled={!view.acting}
              onClick={handlers.retry}
            >
              {t("desktop.secrets.retry")}
            </Button>
          }
        >
          {t(failure.id, failure.args)}
        </Alert>
      )}
      {state.notice === null ? null : (
        <Alert
          tone={state.notice.tone}
          variant="outline"
          size="sm"
          dismissible
          dismissLabel={t("desktop.secrets.dismiss")}
          onDismiss={handlers.dismissNotice}
        >
          {state.notice.text}
        </Alert>
      )}
      <SettingSection label={t("desktop.secrets.title")} body="rows">
        {/* 열쇠 보관 줄은 목록이 비어 있어도 있어야 한다: 첫 키를 만들 방식을 여기서 고른다 */}
        <KeyStoreRow view={props.keyStore} onChoose={handlers.keyStore} />
        {view.loading ? <LoadingRows /> : null}
        {!view.loading && state.rows.length === 0 && state.list.kind === "ready" ? (
          <div data-slot="secrets-empty" className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-ui text-text-secondary">
              {t("desktop.secrets.empty")}
            </span>
            <Button
              size={FORM_CONTROL_SIZE}
              variant="outline"
              disabled={!view.acting}
              onClick={handlers.add}
            >
              {t("desktop.secrets.add")}
            </Button>
          </div>
        ) : null}
        {view.showSearch ? (
          <div data-layout="toolbar" className="flex flex-wrap items-center gap-2 px-4 py-2">
            <Input
              size={FORM_CONTROL_SIZE}
              type="search"
              containerClassName={FIELD_WIDTH.medium}
              aria-label={t("desktop.secrets.search.label")}
              value={state.query}
              placeholder={t("desktop.secrets.search.placeholder")}
              spellCheck={false}
              onValueChange={handlers.query}
            />
            <span className="flex-1" />
            <Select
              size={FORM_CONTROL_SIZE}
              className={FIELD_WIDTH.medium}
              aria-label={t("desktop.secrets.sort.label")}
              value={state.sort}
              onValueChange={(value) => {
                const sort = sortOf(value);
                if (sort !== null) handlers.sort(sort);
              }}
            >
              {SORT_KEYS.map((sort) => (
                <SelectOption key={sort} value={sort}>
                  {t(SORT_ID[sort])}
                </SelectOption>
              ))}
            </Select>
          </div>
        ) : null}
        {state.rows.length === 0 ? null : view.rows.length === 0 ? (
          <p role="status" data-layout="note" className="m-0 px-4 py-3 text-ui text-text-tertiary">
            {t("desktop.secrets.noMatch")}
          </p>
        ) : (
          <SecretTable
            rows={view.rows}
            selectedName={selected?.name ?? null}
            open={sheetOpen}
            nowMs={nowMs}
            locale={locale}
            onSelect={(name) => {
              handlers.select(name);
              setSheetOpen(true);
            }}
          />
        )}
      </SettingSection>
      <Sheet
        side="right"
        size="md"
        open={sheetOpen && selected !== null}
        onOpenChange={(open) => {
          setSheetOpen(open);
        }}
        title={<span className="font-mono">{selected?.name ?? ""}</span>}
        description={selected === null ? undefined : <StatusText status={selected.status} />}
        closeLabel={t("desktop.secrets.detail.close")}
      >
        {selected !== null && view.detail !== null ? (
          <SecretDetail
            key={selected.name}
            entry={selected}
            detail={view.detail}
            reveal={view.reveal}
            shownText={shownText}
            revealAvailable={view.revealAvailable}
            acting={view.acting}
            nowMs={nowMs}
            locale={locale}
            sectionRef={detailRef}
            handlers={handlers.detail}
            onShowAllUsage={() => {
              setUsageOpen(true);
            }}
          />
        ) : null}
      </Sheet>
      <UsageLogDialog
        open={usageOpen && view.detail !== null}
        name={selected?.name ?? ""}
        audit={view.detail?.audit ?? { kind: "idle" }}
        nowMs={nowMs}
        locale={locale}
        onClose={() => {
          setUsageOpen(false);
        }}
      />
      <EntryDialog
        entry={state.entry}
        onName={handlers.entryName}
        onNext={handlers.entryNext}
        onSubmitValue={handlers.entrySubmit}
        onClose={handlers.entryClose}
      />
      <MetaDialog
        meta={state.meta}
        onDraft={handlers.metaDraft}
        onSubmit={handlers.metaSubmit}
        onClose={handlers.metaClose}
      />
      <RemoveDialog
        open={state.confirmRemove}
        name={selected?.name ?? null}
        refs={view.detail?.refs ?? { kind: "idle" }}
        busy={state.busy}
        onConfirm={handlers.removeConfirm}
        onClose={handlers.removeClose}
      />
    </section>
  );
}

/** 읽는 동안의 자리. 표 줄 모양의 뼈대 여섯 줄이다 */
function LoadingRows(): ReactNode {
  return (
    <div role="status" aria-busy="true" data-layout="note" className="grid gap-3 px-4 py-3">
      <span className="sr-only">{t("desktop.secrets.loading")}</span>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex gap-6">
          <Skeleton width="28%" height={12} />
          <Skeleton width="16%" height={12} />
          <Skeleton width="20%" height={12} />
        </div>
      ))}
    </div>
  );
}

/** 상태 점의 색. 색만으로 뜻을 주지 않는다(글자가 따로 있다) */
const STATUS_DOT: Readonly<Record<StatusTone, string>> = {
  success: "bg-success-text",
  warning: "bg-warning-text",
  danger: "bg-danger-text",
  neutral: "bg-text-tertiary",
};

/** 상태 = 점 6 + 글 13 secondary */
function StatusText(props: { readonly status: SecretListEntry["status"] }): ReactNode {
  const view = statusViewOf(props.status);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-ui text-text-secondary">
      <span aria-hidden className={`size-1.5 flex-none rounded-full ${STATUS_DOT[view.tone]}`} />
      <span className="truncate">{t(view.label.id, view.label.args)}</span>
    </span>
  );
}

/** 표 칸 폭. 좁은 카드(34rem 밑)에서는 허용 호스트와 마지막 사용 칸을 접는다 */
const COLS =
  "grid-cols-[minmax(8rem,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_5.5rem_6.5rem] @max-[34rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6.5rem]";
const WIDE_ONLY = "@max-[34rem]:hidden";

/**
 * 시크릿 표(DP-85): 이름 · 쓰는 곳 · 허용 호스트 · 마지막 사용 · 상태. 값 열은 없다. 줄 40px, 머리 32px(12/500 tertiary).
 * 시트가 열린 동안 그 줄은 옅은 면(`neutral.selected`)이다. 누르거나 Enter를 누르면 오른쪽 시트에 상세가 열린다.
 */
function SecretTable(props: {
  readonly rows: readonly SecretListEntry[];
  readonly selectedName: SecretName | null;
  /** 상세 시트가 열려 있다. 닫혀 있으면 고른 줄은 초점 고리로만 보인다 */
  readonly open: boolean;
  readonly nowMs: number;
  readonly locale: Locale;
  readonly onSelect: (name: SecretName) => void;
}): ReactNode {
  const { rows, selectedName, onSelect } = props;
  const head = "truncate text-ui-sm font-medium text-text-tertiary";
  return (
    <div
      role="grid"
      aria-label={t("desktop.secrets.title")}
      aria-rowcount={rows.length + 1}
      data-layout="table"
      data-slot="secrets-table"
      className="@container grid"
    >
      <div role="row" className={`grid h-8 ${COLS} items-center gap-3 px-4`}>
        <span role="columnheader" className={head}>
          {t("desktop.secrets.columns.name")}
        </span>
        <span role="columnheader" className={head}>
          {t("desktop.secrets.columns.usedBy")}
        </span>
        <span role="columnheader" className={`${head} ${WIDE_ONLY}`}>
          {t("desktop.secrets.columns.hosts")}
        </span>
        <span role="columnheader" className={`${head} ${WIDE_ONLY}`}>
          {t("desktop.secrets.columns.lastUsed")}
        </span>
        <span role="columnheader" className={head}>
          {t("desktop.secrets.columns.status")}
        </span>
      </div>
      {rows.map((row) => {
        const current = row.name === selectedName;
        const hosts = row.meta?.use.hosts ?? [];
        const usedBy = usedByOf(row);
        const lastUsed = lastUsedTextOf(row.lastUsedAt, props.nowMs, props.locale);
        return (
          <div
            key={row.name}
            role="row"
            aria-selected={current}
            tabIndex={current ? 0 : -1}
            data-slot="secret-row"
            onClick={() => {
              onSelect(row.name);
            }}
            className={`grid h-10 ${COLS} cursor-default items-center gap-3 border-t border-border-subtle px-4 text-ui outline-none focus-visible:focus-ring ${
              current && props.open ? "bg-neutral-selected" : "hover:bg-neutral-hover"
            }`}
          >
            <span role="gridcell" className="truncate font-mono text-mono text-text-primary">
              {row.name}
            </span>
            <span role="gridcell" className="truncate text-text-secondary">
              {usedBy ?? <span className="text-text-tertiary">—</span>}
            </span>
            <span
              role="gridcell"
              className={`truncate font-mono text-mono-sm text-text-secondary ${WIDE_ONLY}`}
            >
              {hosts.length === 0 ? (
                <span className="text-text-tertiary">—</span>
              ) : hosts.length === 1 ? (
                hosts[0]
              ) : (
                `${hosts[0] ?? ""} +${String(hosts.length - 1)}`
              )}
            </span>
            <span
              role="gridcell"
              className={`truncate text-ui-sm text-text-tertiary tabular-nums ${WIDE_ONLY}`}
            >
              {lastUsed ?? "—"}
            </span>
            <span role="gridcell" className="min-w-0">
              <StatusText status={row.status} />
            </span>
          </div>
        );
      })}
    </div>
  );
}
