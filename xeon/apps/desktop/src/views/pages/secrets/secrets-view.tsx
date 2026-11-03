import { t, type Locale, type MessageId } from "@fresnel/client/i18n";
import type { KeyField } from "@fresnel/client/settings";
import type { SecretName } from "@fresnel/contracts/capabilities";
import type { SecretListEntry } from "@fresnel/contracts/wire";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  SelectOption,
  Skeleton,
  Table,
  type TableColumn,
  type TableRow,
} from "@caustic/react";
import { Plus } from "@caustic/react/icons";
import { useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { MetaDraft } from "./secret-draft.ts";
import { EntryDialog, MetaDialog, RemoveDialog } from "./secret-dialogs.tsx";
import { SecretDetail, TONE_CLASS, type SecretDetailHandlers } from "./secret-detail.tsx";
import {
  keyIntentOf,
  secretsViewOf,
  SORT_KEYS,
  type KeyIntent,
  type SecretSort,
  type SecretsState,
} from "./secret-model.ts";
import { commandErrorText, lastUsedTextOf, statusViewOf } from "./secret-text.ts";

// 시크릿 화면(P-10)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 바로 가기 키의 뜻은 `keyIntentOf`가, 실제 동작은 `secrets-screen.tsx`가 맡는다. 상세로 초점을 옮기는 일만 여기서 한다.

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
  readonly entrySubmit: (field: KeyField) => void;
  readonly entryClose: () => void;
  readonly metaDraft: (draft: MetaDraft) => void;
  readonly metaSubmit: () => void;
  readonly metaClose: () => void;
  readonly removeConfirm: () => void;
  readonly removeClose: () => void;
}

export interface SecretsScreenViewProps {
  readonly state: SecretsState;
  /** 값이 지금 보일 때만 그 글자. 상태에는 없다 */
  readonly shownText: string | null;
  readonly locale: Locale;
  readonly nowMs: number;
  readonly handlers: SecretsScreenHandlers;
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
  const detailRef = useRef<HTMLDivElement | null>(null);
  const view = secretsViewOf(state);
  const selected = view.selected;
  const failure = view.failed === null ? null : commandErrorText(view.failed);

  const onKey = (event: ReactKeyboardEvent<HTMLElement>): void => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const intent = keyIntentOf({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      editable: target !== null && target.closest(EDITABLE) !== null,
      onRow: target !== null && target.dataset.slot === "table-row",
      revealed: view.reveal.status === "revealed",
    });
    if (intent === null) return;
    event.preventDefault();
    if (intent.type === "detail") {
      detailRef.current?.focus();
      return;
    }
    handlers.intent(intent);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      onKeyDown={onKey}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={headingId} className="text-ui-strong text-text-primary">
          {t("desktop.secrets.title")}
        </h1>
        <Button size="sm" iconStart={<Plus />} disabled={!view.acting} onClick={handlers.add}>
          {t("desktop.secrets.add")}
        </Button>
      </div>
      <p className="text-ui-sm text-text-tertiary">{t("desktop.secrets.intro")}</p>
      {view.offline ? <Alert tone="info">{t("desktop.secrets.offline")}</Alert> : null}
      {failure === null ? null : (
        <Alert
          tone="danger"
          action={
            <Button size="xs" variant="outline" disabled={!view.acting} onClick={handlers.retry}>
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
          dismissible
          dismissLabel={t("desktop.secrets.dismiss")}
          onDismiss={handlers.dismissNotice}
        >
          {state.notice.text}
        </Alert>
      )}
      {view.loading ? <LoadingRows /> : null}
      {!view.loading && state.rows.length === 0 && state.list.kind === "ready" ? (
        <EmptyState
          size="md"
          title={t("desktop.secrets.empty")}
          description={t("desktop.secrets.emptyHint")}
          actions={[
            {
              label: t("desktop.secrets.add"),
              icon: <Plus />,
              disabled: !view.acting,
              onClick: handlers.add,
            },
          ]}
        />
      ) : null}
      {state.rows.length === 0 ? null : (
        <>
          {view.showSearch ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Field label={t("desktop.secrets.search.label")}>
                <Input
                  type="search"
                  value={state.query}
                  placeholder={t("desktop.secrets.search.placeholder")}
                  spellCheck={false}
                  onValueChange={handlers.query}
                />
              </Field>
              <Field label={t("desktop.secrets.sort.label")}>
                <Select
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
              </Field>
            </div>
          ) : null}
          {view.rows.length === 0 ? (
            <p role="status" className="text-ui-sm text-text-tertiary">
              {t("desktop.secrets.noMatch")}
            </p>
          ) : (
            <SecretTable
              rows={view.rows}
              selectedName={selected?.name ?? null}
              locale={locale}
              nowMs={nowMs}
              onSelect={handlers.select}
            />
          )}
        </>
      )}
      {selected !== null && view.detail !== null ? (
        <SecretDetail
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
        />
      ) : null}
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

function LoadingRows(): ReactNode {
  return (
    <div role="status" aria-busy="true" className="grid gap-2">
      <span className="sr-only">{t("desktop.secrets.loading")}</span>
      {[0, 1, 2].map((line) => (
        <Skeleton key={line} height={40} />
      ))}
    </div>
  );
}

function columnsOf(): TableColumn[] {
  return [
    { key: "name", header: t("desktop.secrets.columns.name") },
    { key: "provider", header: t("desktop.secrets.columns.provider") },
    { key: "description", header: t("desktop.secrets.columns.description") },
    { key: "hosts", header: t("desktop.secrets.columns.hosts") },
    { key: "lastUsed", header: t("desktop.secrets.columns.lastUsed") },
    { key: "expiry", header: t("desktop.secrets.columns.expiry") },
    { key: "status", header: t("desktop.secrets.columns.status") },
  ];
}

/** 긴 글은 칸 폭에서 자른다. 전체 글은 제목 속성으로 본다 */
function Clipped(props: { readonly text: string; readonly mono?: boolean }): ReactNode {
  return (
    <span
      title={props.text}
      className={
        props.mono === true ? "block max-w-64 truncate font-mono" : "block max-w-64 truncate"
      }
    >
      {props.text}
    </span>
  );
}

function SecretTable(props: {
  readonly rows: readonly SecretListEntry[];
  readonly selectedName: SecretName | null;
  readonly locale: Locale;
  readonly nowMs: number;
  readonly onSelect: (name: SecretName) => void;
}): ReactNode {
  const { rows, selectedName, locale, nowMs, onSelect } = props;
  const byName = new Map<string, SecretListEntry>(rows.map((row) => [row.name, row]));
  const none = t("desktop.secrets.none");

  const cells = new Map<string, (row: SecretListEntry) => ReactNode>([
    ["name", (row) => <Clipped text={row.name} mono />],
    ["provider", (row) => row.meta?.provider ?? none],
    ["description", (row) => <Clipped text={row.meta?.desc ?? none} />],
    [
      "hosts",
      (row) => {
        const hosts = row.meta?.use.hosts ?? [];
        return <Clipped text={hosts.length === 0 ? none : hosts.join(", ")} />;
      },
    ],
    ["lastUsed", (row) => lastUsedTextOf(row.lastUsedAt, nowMs, locale) ?? none],
    ["expiry", (row) => row.meta?.expiresAt ?? none],
    [
      "status",
      (row) => {
        const status = statusViewOf(row.status);
        return (
          <Badge className={TONE_CLASS[status.tone]}>{t(status.label.id, status.label.args)}</Badge>
        );
      },
    ],
  ]);

  const renderCell = (tableRow: TableRow, column: TableColumn): ReactNode => {
    const row = byName.get(tableRow.id);
    const cell = cells.get(column.key);
    return row === undefined || cell === undefined ? null : cell(row);
  };

  return (
    <Table
      aria-label={t("desktop.secrets.title")}
      columns={columnsOf()}
      rows={rows.map((row): TableRow => ({ id: row.name }))}
      renderCell={renderCell}
      selectionMode="single"
      selectedKeys={selectedName === null ? [] : [selectedName]}
      onSelectedKeysChange={(keys) => {
        const picked = rows.find((row) => row.name === keys[0]);
        if (picked !== undefined) onSelect(picked.name);
      }}
      maxHeight={320}
    />
  );
}
