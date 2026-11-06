import {
  Alert,
  Button,
  Dialog,
  DialogAction,
  DialogClose,
  Input,
  ListNavigation,
  ListNavigationGroup,
  ListNavigationItem,
  ScrollArea,
  Select,
  SelectOption,
  Skeleton,
} from "@caustic/react";
import { Search } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import { TAB_ORDER, TAB_SPECS, type FieldVM, type SettingsView } from "@fresnel/client/settings";
import type { SettingKey, SettingsTab } from "@fresnel/contracts/settings";
import { useId, type KeyboardEvent, type ReactNode } from "react";
import {
  advancedGroupsOf,
  panelOwnedOf,
  restartCountOf,
  searchGroupsOf,
  settingsKeyOf,
  tabStep,
  type PageStatus,
  type SettingsKeyIntent,
} from "./settings-model.ts";
import { FieldRow, type DedicatedEditors, type FieldHandlers } from "./settings-field.tsx";
import { PanelBlock } from "../shared/panel-parts.tsx";
import type { SettingsPathRow } from "./settings-file-paths.ts";
import { OverviewPanels } from "./settings-overview.tsx";
import { SettingSection } from "./settings-section.tsx";

// 설정 화면(P-09)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 틀은 P-09 시안(`_settings/frame.tsx`)을 따른다. 왼쪽은 키 찾기와 탭 목록(지금 탭은 올린 흰 칸), 오른쪽은 큰 제목과 머리 아래 선,
// 그 아래 구역마다 제목과 카드 하나다. 스크롤은 오른쪽 내용 자리 하나가 한다.
// 탭 목록은 세로 `ListNavigation`이고 720 이하 폭에서는 찾기 칸 아래 `Select`다. 찾기는 라벨·키·설명을 본다.
// 시크릿 탭은 `secretsPanel`(P-10 시크릿 화면)을 그대로 넣는다. 표와 전용 편집기는 요약만 보인다(`settings-field.tsx`).

export interface SettingsPageHandlers {
  readonly select: (tab: SettingsTab) => void;
  readonly query: (text: string) => void;
  /** ⌘S, Esc 같은 화면 바로 가기. ⌘F는 이 그림이 찾기 칸에 초점을 준다 */
  readonly keyIntent: (intent: SettingsKeyIntent) => void;
  readonly restart: () => void;
  readonly retry: () => void;
  readonly fields: FieldHandlers;
  readonly promptSave: () => void;
  readonly promptDiscard: () => void;
  readonly promptStay: () => void;
  /** 머리 끝의 "파일로 보기"를 누르면 편집기를 연다(범위는 사용자) */
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
  /** 데이터 복원 구역(고급 탭). 고급 탭을 고르고 찾기가 비었을 때 항목 위에 보인다 */
  readonly restorePanel: ReactNode;
  /** 계정 회전 행(P-11). 탭이 `providers`일 때 게이지 아래, 항목 위에 보인다. 값이 없으면 `null`이다 */
  readonly rotationPanel: ReactNode;
  /** 사용량 (이 대화) 패널(P-11). 게이지 자리가 있는 탭(예산과 한도, 계정과 제공자) 맨 위에 보인다 */
  readonly usagePanel: ReactNode;
  /** 앱 업데이트 줄(B-10). 개요 탭 맨 위에 보인다. 웹이나 문맥이 없으면 `null`이다 */
  readonly updatePanel?: ReactNode | undefined;
  /** 개요의 설정 파일 경로 목록(사용자·프로젝트·관리 정책) */
  readonly filePaths: readonly SettingsPathRow[];
  /** OS 알림 묶음(B-10). "실행과 서비스" 탭 맨 위에 보인다. 웹이나 문맥이 없으면 `null`이다 */
  readonly notifyPanel?: ReactNode | undefined;
  readonly handlers: SettingsPageHandlers;
}

export function SettingsPageView(props: SettingsPageProps): ReactNode {
  const { handlers, tab, query, readOnly, fileOpen, narrow } = props;
  const headingId = useId();
  // 머리 제목은 고른 탭 이름이다(P-09 시안 `_settings/frame.tsx`). 찾는 중에는 화면 이름이다
  const titleOf =
    query.trim() === ""
      ? (props.view?.tabs.find((candidate) => candidate.id === tab)?.label ??
        t("desktop.settings.title"))
      : t("desktop.settings.title");
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
  // "파일로 보기"는 P-09 시안처럼 머리 끝에 둔다. 찾는 중이나 시크릿 탭에는 없다
  const fileAction =
    query.trim() === "" && tab !== "secrets" ? (
      <Button variant="ghost" size="xs" disabled={readOnly || fileOpen} onClick={handlers.openFile}>
        {t("desktop.settings.file.open.button")}
      </Button>
    ) : null;
  return (
    <section
      aria-labelledby={headingId}
      className="-m-1.5 mb-0 flex min-h-0 min-w-0 flex-1"
      onKeyDown={onKey}
    >
      {narrow ? null : <TabColumn {...props} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-16 flex-none items-center gap-2 border-b border-border-subtle ps-6 pe-11">
          <h1
            id={headingId}
            data-page-title=""
            className="m-0 min-w-0 flex-1 truncate text-text-primary"
          >
            {titleOf}
          </h1>
          {fileAction === null ? null : (
            <div className="flex flex-none items-center">{fileAction}</div>
          )}
        </header>
        {narrow ? <NarrowTabs {...props} /> : null}
        <ScrollArea label={t("desktop.settings.title")} className="min-h-0 flex-1">
          <div className="max-w-[64rem] px-6 py-12">
            <Body {...props} />
          </div>
        </ScrollArea>
      </div>
      <PromptDialog prompt={props.prompt} handlers={handlers} />
    </section>
  );
}

/** 찾기 칸. 탭 열과 좁은 폭의 탭 칸이 같이 쓴다 */
function SearchField(props: SettingsPageProps): ReactNode {
  return (
    <Input
      type="search"
      size="xs"
      variant="soft"
      prefix={<Search />}
      aria-label={t("desktop.settings.search.label")}
      placeholder={t("desktop.settings.search.placeholder")}
      value={props.query}
      spellCheck={false}
      containerClassName="min-w-0 flex-1"
      onValueChange={props.handlers.query}
    />
  );
}

/** 왼쪽 탭 열. 찾기 칸은 머리 높이에 맞추고, 지금 탭은 올린 흰 칸으로 보인다 */
function TabColumn(props: SettingsPageProps): ReactNode {
  const { handlers, tab } = props;
  return (
    <div className="flex w-52 flex-none flex-col border-e border-border-subtle ps-3 pe-2">
      <div className="flex h-16 flex-none items-center">
        <SearchField {...props} />
      </div>
      <ListNavigation
        kind="pages"
        size="sm"
        aria-label={t("desktop.settings.tabs.label")}
        className="pb-2"
        onKeyDown={(event) => {
          // ↑↓은 탭 목록에서 옆 탭으로 옮긴다(§6.13). 옮긴 뒤의 초점은 그대로 둔다
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          handlers.select(tabStep(tab, TAB_ORDER, event.key === "ArrowDown" ? 1 : -1));
        }}
      >
        <ListNavigationGroup>
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
        </ListNavigationGroup>
      </ListNavigation>
    </div>
  );
}

/** 720 이하 폭의 찾기 칸과 탭 고르기. 탭 열 대신 머리 아래에 둔다 */
function NarrowTabs(props: SettingsPageProps): ReactNode {
  const { handlers, tab } = props;
  return (
    <div className="grid gap-2 border-b border-border-subtle px-6 py-3">
      <SearchField {...props} />
      <Select
        size="xs"
        aria-label={t("desktop.settings.tabs.select")}
        value={tab}
        className="w-[min(20rem,100%)]"
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
  // 알림 띠는 알림이 있을 때만 그린다. 빈 띠 칸이 첫 구역 앞에 남으면 구역이 첫 자식이 아니어서 `first:pt-0`이 안 걸리고 위가 24px 떤다(시안도 띠가 없으면 없다)
  const notices = props.readOnly || restart !== 0 || props.restartError !== null;
  return (
    <>
      {notices ? (
        <div className="grid gap-2 pb-3">
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
        </div>
      ) : null}
      <FieldList {...props} view={view} />
    </>
  );
}

/** 파일 편집기(열려 있을 때)와 항목 목록. 편집기는 탭과 찾기 어디서나 열린 채로 보인다(초안을 가리지 않으려고) */
function FieldList(props: SettingsPageProps & { readonly view: SettingsView }): ReactNode {
  return (
    <>
      {props.fileEditor}
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
          <SettingSection key={group.tab} title={group.label}>
            {group.fields.map(rowOf)}
          </SettingSection>
        ))}
      </>
    );
  }
  if (tab === "secrets") return props.secretsPanel;
  const tabView = view.tabs.find((candidate) => candidate.id === tab);
  if (tabView === undefined) return null;
  // 검색 순서는 도구와 웹 패널이 그린다. 패널이 있는 탭은 빈 항목 문장 대신 패널을 보인다
  const fields = tabView.fields.filter((field) => !panelOwnedOf(field));
  const panels = (
    <>
      {tab === "execution" ? props.notifyPanel : null}
      {tab === "tools" ? props.toolsPanel : null}
      {tabView.gauge === null ? null : props.usagePanel}
      {tab === "providers" && props.rotationPanel !== null ? (
        <PanelBlock title={t("desktop.providers.rotation.title")}>{props.rotationPanel}</PanelBlock>
      ) : null}
    </>
  );
  const emptyText =
    fields.length === 0 && tabView.emptyText !== null && tab !== "tools" ? tabView.emptyText : null;
  const hasCard = tab === "advanced" || fields.length > 0 || emptyText !== null;
  if (tab === "overview")
    return (
      <OverviewPanels view={view} updatePanel={props.updatePanel} filePaths={props.filePaths} />
    );
  // 고급 탭은 운영자용 항목을 따로 묶어 제목으로 가른다(시안 `_settings`의 구역 모양)
  const groups = tab === "advanced" ? advancedGroupsOf(fields) : { general: fields, operator: [] };
  return (
    <>
      {panels}
      {hasCard ? (
        <SettingSection label={tabView.label}>
          {tab === "advanced" ? props.restorePanel : null}
          {emptyText === null ? null : <p className="text-ui-sm text-text-tertiary">{emptyText}</p>}
          {groups.general.map(rowOf)}
        </SettingSection>
      ) : null}
      {groups.operator.length === 0 ? null : (
        <SettingSection title={t("desktop.settings.advanced.operator.title")}>
          {groups.operator.map(rowOf)}
        </SettingSection>
      )}
    </>
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
