import {
  Alert,
  Badge,
  Button,
  Field,
  Select,
  SelectOption,
  Skeleton,
  Textarea,
} from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { scopeText } from "@fresnel/client/settings";
import type { KeyboardEvent, ReactNode } from "react";
import { errorText } from "../../settings.tsx";
import {
  fileCloseableOf,
  fileDirtyOf,
  fileDiscardableOf,
  fileEditableOf,
  fileSaveableOf,
  fileScopesOf,
  type FileEditorState,
  type FileScope,
} from "./settings-file-model.ts";
import { settingsKeyOf } from "./settings-model.ts";
import { TONE_CLASS } from "./settings-text.ts";

// 설정 파일 편집기(P-09 "파일로 보기")의 그림. 상태와 명령은 없고 `state`와 `handlers`만 받는다(서버 렌더 시험이 직접 그린다).
// 원문은 caustic `Textarea`로 편집한다(코드 편집기는 없다, L4.desktop-ux §6.13 caustic [gap:C-06]).
// ⌘S는 저장, Esc는 되돌리기다. 편집기 안에서 누른 바로 가기는 화면 바깥(설정 항목의 저장과 되돌리기)으로 넘기지 않는다.

export interface SettingsFileHandlers {
  readonly scope: (scope: FileScope) => void;
  readonly edit: (text: string) => void;
  readonly save: () => void;
  readonly discard: () => void;
  readonly close: () => void;
  /** 다시 읽기(충돌 뒤)와 다시 시도(읽기 실패). 초안은 파일 내용으로 바뀐다 */
  readonly reread: () => void;
}

export interface SettingsFileEditorProps {
  readonly state: FileEditorState;
  /** 연결이 살아 있는가. 없으면 읽은 원문만 보이고 편집과 저장이 잠긴다 */
  readonly live: boolean;
  /** 열린 대화가 있는가. 없으면 범위는 사용자 하나다 */
  readonly hasThread: boolean;
  readonly handlers: SettingsFileHandlers;
}

export function SettingsFileEditorView(props: SettingsFileEditorProps): ReactNode {
  const { state, live, hasThread, handlers } = props;
  if (state.phase === "closed") return null;
  const dirty = fileDirtyOf(state);
  const editable = fileEditableOf(state, live);
  const showsText = state.phase === "ready" || state.phase === "conflict";
  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const intent = settingsKeyOf({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    });
    if (intent === "save") {
      event.preventDefault();
      event.stopPropagation();
      handlers.save();
      return;
    }
    if (intent === "discard") {
      event.stopPropagation();
      handlers.discard();
    }
  };
  return (
    <div
      data-slot="settings-file-editor"
      className="flex flex-col gap-3 rounded-md bg-control-raised p-3"
      onKeyDown={onKey}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-ui-strong text-text-primary">{t("desktop.settings.file.title")}</span>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t("desktop.settings.field.scope.label")}
            size="sm"
            value={state.scope}
            disabled={!live || dirty || state.saving || state.phase === "loading"}
            onValueChange={(next) => {
              const scope = fileScopesOf(hasThread).find((candidate) => candidate === next);
              if (scope !== undefined) handlers.scope(scope);
            }}
          >
            {fileScopesOf(hasThread).map((scope) => (
              <SelectOption key={scope} value={scope}>
                {scopeText(scope)}
              </SelectOption>
            ))}
          </Select>
          <Button
            variant="outline"
            size="sm"
            disabled={!fileCloseableOf(state)}
            onClick={handlers.close}
          >
            {t("desktop.settings.file.close.button")}
          </Button>
        </div>
      </div>
      {state.doc === null || state.doc.path === null ? null : (
        <p className="text-ui-sm text-text-tertiary">
          {t("desktop.settings.file.path", { path: state.doc.path })}
        </p>
      )}
      {live ? null : <Alert tone="info">{t("desktop.settings.offline")}</Alert>}
      {state.phase === "loading" ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-ui-sm text-text-tertiary">
            {t("desktop.settings.loading.status")}
          </p>
          <Skeleton height={160} />
        </div>
      ) : null}
      {state.phase === "conflict" ? (
        <Alert
          tone="warning"
          action={
            <Button size="xs" variant="outline" disabled={!live} onClick={handlers.reread}>
              {t("desktop.settings.file.reread.button")}
            </Button>
          }
        >
          <span className="block text-ui-strong">{t("desktop.settings.file.conflict")}</span>
          <span className="block">{t("desktop.settings.file.conflict.body")}</span>
        </Alert>
      ) : null}
      {state.error === null ? null : (
        <Alert
          tone="danger"
          action={
            state.phase === "failed" ? (
              <Button size="xs" variant="outline" disabled={!live} onClick={handlers.reread}>
                {t("desktop.settings.retry.button")}
              </Button>
            ) : undefined
          }
        >
          {errorText(state.error)}
        </Alert>
      )}
      {showsText && state.doc !== null ? (
        <>
          {state.doc.readOnly ? (
            <p className="text-ui-sm text-text-secondary">{t("desktop.settings.file.readOnly")}</p>
          ) : null}
          {state.doc.exists ? null : (
            <p className="text-ui-sm text-text-secondary">{t("desktop.settings.file.missing")}</p>
          )}
          <Field label={t("desktop.settings.file.text.label")} disabled={!editable}>
            <Textarea
              rows={16}
              value={state.draft}
              disabled={!editable}
              invalid={state.error !== null}
              spellCheck={false}
              className="font-mono text-mono-sm"
              onValueChange={handlers.edit}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {state.saving ? (
              <span role="status" className="text-ui-sm text-text-tertiary">
                {t("desktop.settings.field.saving")}
              </span>
            ) : null}
            {state.saved ? (
              <Badge className={TONE_CLASS.success} role="status">
                {t("desktop.settings.field.saved")}
              </Badge>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={!fileDiscardableOf(state)}
              onClick={handlers.discard}
            >
              {t("desktop.settings.field.discard")}
            </Button>
            <Button
              size="sm"
              loading={state.saving}
              disabled={!fileSaveableOf(state, live)}
              onClick={handlers.save}
            >
              {t("desktop.settings.field.save")}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
