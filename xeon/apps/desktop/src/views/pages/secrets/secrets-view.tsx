import { t, type Locale, type MessageId } from "@fresnel/client/i18n";
import type { KeyField } from "@fresnel/client/settings";
import type { SecretName } from "@fresnel/contracts/capabilities";
import type { SecretListEntry } from "@fresnel/contracts/wire";
import {
  Alert,
  Button,
  EmptyState,
  Field,
  Input,
  Select,
  SelectOption,
  Skeleton,
} from "@caustic/react";
import { useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import type { MetaDraft } from "./secret-draft.ts";
import { EntryDialog, MetaDialog, RemoveDialog } from "./secret-dialogs.tsx";
import { SecretDetail, type SecretDetailHandlers } from "./secret-detail.tsx";
import {
  keyIntentOf,
  secretsViewOf,
  SORT_KEYS,
  type KeyIntent,
  type SecretSort,
  type SecretsState,
} from "./secret-model.ts";
import { commandErrorText, statusViewOf, type StatusTone } from "./secret-text.ts";

// 시크릿 화면(P-10)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 목록은 이름, 설명, 조치가 필요한 상태만 보인다(mockup `list.tsx`). 바로 가기 키의 뜻은 `keyIntentOf`가, 실제 동작은 `secrets-screen.tsx`가 맡는다.
// 상세로 초점을 옮기는 일만 여기서 한다.

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
  const detailRef = useRef<HTMLElement | null>(null);
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
      onRow: target !== null && target.getAttribute("role") === "option",
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
        <div className="flex min-w-0 items-center gap-1">
          <h1 id={headingId} className="m-0 text-ui-strong text-text-primary">
            {t("desktop.secrets.title")}
          </h1>
          <InfoTip text={t("desktop.secrets.intro")} />
        </div>
        {state.rows.length === 0 ? null : (
          <Button
            size="xs"

            variant="outline"
            disabled={!view.acting}
            onClick={handlers.add}
          >
            {t("desktop.secrets.add")}
          </Button>
        )}
      </div>
      {view.offline ? (
        <Alert tone="info" size="sm">
          {t("desktop.secrets.offline")}
        </Alert>
      ) : null}
      {failure === null ? null : (
        <Alert
          tone="danger"
          size="sm"
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
          size="sm"
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
          size="sm"
          surface="none"
          title={t("desktop.secrets.empty")}
          actions={
            <Button
              size="sm"

              variant="solid"
              disabled={!view.acting}
              onClick={handlers.add}
            >
              {t("desktop.secrets.add")}
            </Button>
          }
        />
      ) : null}
      {state.rows.length === 0 ? null : (
        <>
          {view.showSearch ? (
            <div className="grid gap-3 compact:grid-cols-[minmax(0,1fr)_auto]">
              <Field label={t("desktop.secrets.search.label")} size="sm">
                <Input
                  size="sm"
                  type="search"
                  value={state.query}
                  placeholder={t("desktop.secrets.search.placeholder")}
                  spellCheck={false}
                  onValueChange={handlers.query}
                />
              </Field>
              <Field label={t("desktop.secrets.sort.label")} size="sm">
                <Select
                  size="sm"
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
            <p role="status" className="m-0 text-ui-sm text-text-tertiary">
              {t("desktop.secrets.noMatch")}
            </p>
          ) : (
            <SecretList
              rows={view.rows}
              selectedName={selected?.name ?? null}
              onSelect={handlers.select}
            />
          )}
        </>
      )}
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

/** 읽는 동안의 자리. 목록 줄 모양의 뼈대 여섯 줄이다(mockup `D-loading`) */
function LoadingRows(): ReactNode {
  return (
    <div role="status" aria-busy="true" className="grid gap-3 pt-1">
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

/** 상태 글자의 색. 색만으로 뜻을 주지 않는다(글자가 따로 있다) */
const STATUS_TEXT: Readonly<Record<StatusTone, string>> = {
  success: "text-success-text",
  warning: "text-warning-text",
  danger: "text-danger-text",
  neutral: "text-text-tertiary",
};

/** 목록 칸의 상태 글자. 정상이면 칸을 비운다. 조치가 필요한 상태만 적는다 */
function listStatusOf(
  status: SecretListEntry["status"],
): { readonly text: string; readonly cls: string } | null {
  if (status === "valid") return null;
  const view = statusViewOf(status);
  return { text: t(view.label.id, view.label.args), cls: STATUS_TEXT[view.tone] };
}

/** 목록 줄 칸 폭. 좁은 폭에서는 설명 칸을 접는다 */
const COLS =
  "grid-cols-[minmax(9rem,1.1fr)_minmax(0,1fr)_5.5rem] @max-[34rem]:grid-cols-[minmax(0,1fr)_5.5rem]";

/**
 * 시크릿 목록. caustic `Table`은 고른 행을 검게 뒤집고 행이 커서, 지금 행을 올린 바탕 하나로 보이는 밀도 높은 목록을
 * caustic 토큰으로 만든다(mockup `list.tsx`). 값 열은 없고, 줄마다 이름과 설명과 조치 상태만 있다.
 */
function SecretList(props: {
  readonly rows: readonly SecretListEntry[];
  readonly selectedName: SecretName | null;
  readonly onSelect: (name: SecretName) => void;
}): ReactNode {
  const { rows, selectedName, onSelect } = props;
  return (
    <div role="listbox" aria-label={t("desktop.secrets.title")} className="@container grid">
      {rows.map((row) => {
        const current = row.name === selectedName;
        const status = listStatusOf(row.status);
        return (
          <div
            key={row.name}
            role="option"
            aria-selected={current}
            tabIndex={current ? 0 : -1}
            onClick={() => {
              onSelect(row.name);
            }}
            className={`grid h-8 ${COLS} cursor-default items-center gap-3 rounded-md px-2 text-ui outline-none focus-visible:focus-ring ${
              current
                ? "bg-control-raised shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]"
                : "hover:bg-neutral-hover"
            }`}
          >
            <span className="truncate font-mono text-mono text-text-primary">{row.name}</span>
            <span className="truncate text-text-secondary @max-[34rem]:hidden">
              {row.meta?.desc ?? ""}
            </span>
            {status === null ? null : (
              <span className={`truncate text-ui-sm ${status.cls}`}>{status.text}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
