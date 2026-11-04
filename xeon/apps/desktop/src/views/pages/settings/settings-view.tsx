import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  FormLayoutSection,
  Input,
  ListNavigation,
  ListNavigationItem,
  Select,
  SelectOption,
  Skeleton,
} from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { TAB_ORDER, TAB_SPECS, type FieldVM, type SettingsView } from "@fresnel/client/settings";
import type { SettingKey, SettingsTab } from "@fresnel/contracts/settings";
import { useId, type KeyboardEvent, type ReactNode } from "react";
import {
  panelOwnedOf,
  restartCountOf,
  searchGroupsOf,
  settingsKeyOf,
  tabStep,
  type PageStatus,
  type SettingsKeyIntent,
} from "./settings-model.ts";
import { FieldRow, type DedicatedEditors, type FieldHandlers } from "./settings-field.tsx";
import { diagnosticIdOf } from "./settings-text.ts";

// 설정 화면(P-09)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 탭 목록은 세로 `ListNavigation`이고 720 이하 폭에서는 `Select`다. 찾기는 라벨·키·설명을 본다.
// 시크릿 탭은 `secretsPanel`(P-10 시크릿 화면)을 그대로 넣는다. 표와 전용 편집기는 요약만 보인다(`settings-field.tsx`).

export interface SettingsPageHandlers {
  readonly select: (tab: SettingsTab) => void;
  readonly query: (text: string) => void;
  /** ⌘S, Esc 같은 화면 바로 가기. ⌘F는 이 그림이 찾기 칸에 초점을 준다 */
  readonly keyIntent: (intent: SettingsKeyIntent) => void;
  readonly restart: () => void;
  readonly retry: () => void;
  readonly back: () => void;
  readonly fields: FieldHandlers;
  readonly promptSave: () => void;
  readonly promptDiscard: () => void;
  readonly promptStay: () => void;
  /** 탭의 "파일로 보기"를 누르면 편집기를 연다(범위는 사용자) */
  readonly openFile: () => void;
}

export interface SettingsPageProps {
  readonly status: PageStatus;
  /** 읽지 못한 까닭의 문장. `failed`일 때 보인다 */
  readonly loadError: string;
  /** `ready`일 때의 view-model. 오프라인이어도 마지막으로 읽은 값이 있으면 있다 */
  readonly view: SettingsView | null;
  readonly tab: SettingsTab;
  readonly query: string;
  readonly narrow: boolean;
  readonly readOnly: boolean;
  readonly hasThread: boolean;
  readonly saved: ReadonlySet<SettingKey>;
  readonly restartError: string | null;
  /** 탭을 옮기려는데 저장하지 않은 초안이 있을 때. `count`는 초안 개수다 */
  readonly prompt: { readonly to: SettingsTab; readonly count: number } | null;
  readonly secretsPanel: ReactNode;
  /** 설정 파일 편집기(P-09 "파일로 보기"). 닫혀 있으면 `null`이다. 항목 목록 위에 보인다 */
  readonly fileEditor: ReactNode;
  /** 편집기가 열려 있는가. 열려 있으면 "파일로 보기" 단추가 잠긴다 */
  readonly fileOpen: boolean;
  /** 종류마다 전용 편집기 그림(P-11). 빠진 종류는 요약이다 */
  readonly editors: DedicatedEditors;
  /** 도구와 웹 탭의 패널(P-12). 탭이 `tools`일 때 항목 위에 보인다 */
  readonly toolsPanel: ReactNode;
  /** 계정 회전 행(P-11). 탭이 `providers`일 때 게이지 아래, 항목 위에 보인다. 값이 없으면 `null`이다 */
  readonly rotationPanel: ReactNode;
  /** 사용량 (이 대화) 패널(P-11). 게이지 자리가 있는 탭(예산과 한도, 계정과 제공자) 맨 위에 보인다 */
  readonly usagePanel: ReactNode;
  readonly handlers: SettingsPageHandlers;
}

export function SettingsPageView(props: SettingsPageProps): ReactNode {
  const { handlers } = props;
  const headingId = useId();
  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    // 묻는 대화 상자가 열려 있으면 그 키는 대화 상자의 것이다. 포털의 키 입력도 이 자리까지 올라오므로 여기서 막는다
    if (props.prompt !== null) return;
    const intent = settingsKeyOf({
      key: event.key,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
    });
    if (intent === null) return;
    if (intent === "search") {
      event.preventDefault();
      event.currentTarget.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
      return;
    }
    if (intent === "save") event.preventDefault();
    handlers.keyIntent(intent);
  };
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
      onKeyDown={onKey}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id={headingId} className="text-ui-strong text-text-primary">
          {t("desktop.settings.title")}
        </h1>
        <Button variant="outline" size="sm" onClick={handlers.back}>
          {t("desktop.settings.backToChat.button")}
        </Button>
      </div>
      <div className={props.narrow ? "flex flex-col gap-4" : "flex min-h-0 flex-1 gap-4"}>
        <TabColumn {...props} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          <Body {...props} />
        </div>
      </div>
      <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.keys.hint")}</p>
      <PromptDialog prompt={props.prompt} handlers={handlers} />
    </section>
  );
}

/** 탭 목록과 찾기 칸. 720 이하 폭에서는 탭 목록이 선택 상자다 */
function TabColumn(props: SettingsPageProps): ReactNode {
  const { handlers, tab, narrow } = props;
  const searchLabel = t("desktop.settings.search.label");
  return (
    <div className={narrow ? "flex flex-col gap-2" : "flex w-56 shrink-0 flex-col gap-2"}>
      <Input
        type="search"
        aria-label={searchLabel}
        placeholder={t("desktop.settings.search.placeholder")}
        value={props.query}
        spellCheck={false}
        onValueChange={handlers.query}
      />
      {narrow ? (
        <Select
          aria-label={t("desktop.settings.tabs.select")}
          value={tab}
          onValueChange={(next) => {
            const found = TAB_ORDER.find((candidate) => candidate === next);
            if (found !== undefined) handlers.select(found);
          }}
        >
          {TAB_ORDER.map((id) => (
            <SelectOption key={id} value={id}>
              {TAB_SPECS[id].label}
            </SelectOption>
          ))}
        </Select>
      ) : (
        <ListNavigation
          kind="pages"
          aria-label={t("desktop.settings.tabs.label")}
          onKeyDown={(event) => {
            // ↑↓은 탭 목록에서 옆 탭으로 옮긴다(§6.13). 옮긴 뒤의 초점은 그대로 둔다
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            handlers.select(tabStep(tab, TAB_ORDER, event.key === "ArrowDown" ? 1 : -1));
          }}
        >
          {TAB_ORDER.map((id) => (
            <ListNavigationItem
              key={id}
              current={id === tab}
              onSelect={() => {
                handlers.select(id);
              }}
            >
              {TAB_SPECS[id].label}
            </ListNavigationItem>
          ))}
        </ListNavigation>
      )}
    </div>
  );
}

/** 본문. 오프라인, 실패, 읽는 중, 값 가운데 하나를 그린다 */
function Body(props: SettingsPageProps): ReactNode {
  const { status, view, handlers } = props;
  if (status === "offline") {
    return <Alert tone="info">{t("desktop.settings.offline")}</Alert>;
  }
  if (status === "failed") {
    return (
      <Alert
        tone="danger"
        action={
          <Button size="xs" variant="outline" onClick={handlers.retry}>
            {t("desktop.settings.retry.button")}
          </Button>
        }
      >
        {props.loadError}
      </Alert>
    );
  }
  if (view === null) {
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.settings.loading.status")}
        </p>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }
  const restart = restartCountOf(view);
  return (
    <>
      {props.readOnly ? <Alert tone="info">{t("desktop.settings.offline")}</Alert> : null}
      {restart === 0 ? null : (
        <Alert
          tone="warning"
          action={
            <Button
              size="xs"
              variant="outline"
              disabled={props.readOnly}
              onClick={handlers.restart}
            >
              {t("desktop.settings.restart.button")}
            </Button>
          }
        >
          {view.restartBanner?.text ?? ""}
        </Alert>
      )}
      {props.restartError === null ? null : <Alert tone="danger">{props.restartError}</Alert>}
      <FieldList {...props} view={view} />
    </>
  );
}

/**
 * 항목 목록 위의 자리. 탭을 고른 자리에는 "파일로 보기" 줄을 두고, 찾기 자리와 시크릿 탭에는 두지 않는다.
 * 편집기는 탭과 찾기 어디서나 열린 채로 보인다(초안을 가리지 않으려고).
 */
function FieldList(props: SettingsPageProps & { readonly view: SettingsView }): ReactNode {
  const { query, tab, readOnly, fileOpen, fileEditor, handlers } = props;
  const tabMode = query.trim() === "" && tab !== "secrets";
  return (
    <>
      {tabMode ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            disabled={readOnly || fileOpen}
            onClick={handlers.openFile}
          >
            {t("desktop.settings.file.open.button")}
          </Button>
        </div>
      ) : null}
      {fileEditor}
      <FieldItems {...props} />
    </>
  );
}

/** 찾기 결과나 고른 탭의 항목. 시크릿 탭은 시크릿 화면이 자리를 차지한다 */
function FieldItems(props: SettingsPageProps & { readonly view: SettingsView }): ReactNode {
  const { view, query, tab, hasThread, readOnly, saved, handlers } = props;
  const rowHandlers = handlers.fields;
  const rowOf = (field: FieldVM): ReactNode => (
    <FieldRow
      key={field.key}
      field={field}
      editable={field.editable && (!readOnly || field.origin === "desktop")}
      hasThread={hasThread}
      saved={saved.has(field.key)}
      editors={props.editors}
      handlers={rowHandlers}
    />
  );
  if (query.trim() !== "") {
    const groups = searchGroupsOf(view.tabs, query);
    if (groups.length === 0) {
      return (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.search.noMatch")}</p>
      );
    }
    return (
      <>
        {groups.map((group) => (
          <FormLayoutSection key={group.tab} title={group.label}>
            {group.fields.map(rowOf)}
          </FormLayoutSection>
        ))}
      </>
    );
  }
  if (tab === "secrets") return props.secretsPanel;
  const tabView = view.tabs.find((candidate) => candidate.id === tab);
  if (tabView === undefined) return null;
  // 검색 순서는 도구와 웹 패널이 그린다. 패널이 있는 탭은 빈 항목 문장 대신 패널을 보인다
  const fields = tabView.fields.filter((field) => !panelOwnedOf(field));
  return (
    <FormLayoutSection title={tabView.label}>
      {tab === "overview" ? <OverviewSummary view={view} /> : null}
      {tab === "tools" ? props.toolsPanel : null}
      {tabView.gauge === null ? null : props.usagePanel}
      {tab === "providers" ? props.rotationPanel : null}
      {fields.length === 0 && tabView.emptyText !== null && tab !== "tools" ? (
        <p className="text-ui-sm text-text-tertiary">{tabView.emptyText}</p>
      ) : null}
      {fields.map(rowOf)}
    </FormLayoutSection>
  );
}

/** 개요 탭의 요약과 화면 진단. 잠긴 항목과 재시작 대기는 개요에서 셀 수 있다 */
function OverviewSummary(props: { readonly view: SettingsView }): ReactNode {
  const { overview, diagnostics } = props.view;
  const lines = [
    t("desktop.settings.overview.locked", { count: overview.locked.length }),
    t("desktop.settings.overview.pendingRestart", { count: overview.pendingRestart.length }),
    t("desktop.settings.overview.pendingNextTurn", { count: overview.pendingNextTurn.length }),
    t("desktop.settings.overview.deprecated", { count: overview.deprecatedInUse.length }),
  ];
  return (
    <div className="flex flex-col gap-2">
      <ul className="text-ui-sm text-text-secondary">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {diagnostics.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <span className="text-ui-strong text-text-primary">
            {t("desktop.settings.diagnostics.title")}
          </span>
          <ul className="text-ui-sm text-text-secondary">
            {diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}:${diagnostic.key}`}>
                {t("desktop.settings.diagnostics.line", {
                  key: diagnostic.key,
                  problem: t(diagnosticIdOf(diagnostic.code)),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 탭을 옮기기 전에 묻는 대화 상자. 저장하고 옮기기, 버리고 옮기기, 이 탭에 머물기 */
function PromptDialog(props: {
  readonly prompt: { readonly to: SettingsTab; readonly count: number } | null;
  readonly handlers: SettingsPageHandlers;
}): ReactNode {
  const { prompt, handlers } = props;
  return (
    <Dialog
      kind="dialog"
      open={prompt !== null}
      onOpenChange={(open) => {
        if (!open) handlers.promptStay();
      }}
      title={t("desktop.settings.draft.title")}
      description={prompt === null ? "" : t("desktop.settings.draft.body", { count: prompt.count })}
      footer={
        <>
          <DialogClose asChild>
            <Button variant="outline" size="sm" autoFocus>
              {t("desktop.settings.draft.stay")}
            </Button>
          </DialogClose>
          <Button variant="outline" size="sm" onClick={handlers.promptDiscard}>
            {t("desktop.settings.draft.discard")}
          </Button>
          <DialogAction onClick={handlers.promptSave}>
            {t("desktop.settings.draft.save")}
          </DialogAction>
        </>
      }
    />
  );
}
