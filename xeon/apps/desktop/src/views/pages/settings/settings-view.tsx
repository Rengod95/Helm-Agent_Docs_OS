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
import {
  Fragment,
  useCallback,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefCallback,
} from "react";
import {
  advancedGroupsOf,
  budgetsGroupsOf,
  modelsGroupsOf,
  panelOwnedOf,
  restartCountOf,
  searchGroupsOf,
  settingsKeyOf,
  tabStep,
  type PageStatus,
  type SettingsKeyIntent,
} from "./settings-model.ts";
import { FieldRow, type DedicatedEditors, type FieldHandlers } from "./settings-field.tsx";
import { RestartButtons, type RestartChoice } from "../../restart-confirm-dialog.tsx";
import { PanelBlock } from "../shared/panel-parts.tsx";
import type { SettingsPathRow } from "./settings-file-paths.ts";
import { OverviewPanels } from "./settings-overview.tsx";
import { SettingSection } from "./settings-section.tsx";

// 설정 화면(P-09)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 틀은 P-09 시안(`_settings/frame.tsx`)을 따른다. 왼쪽은 키 찾기와 탭 목록(지금 탭은 올린 흰 칸), 오른쪽은 큰 제목과 머리 아래 선,
// 그 아래 구역마다 제목과 카드 하나다. 스크롤은 오른쪽 내용 자리 하나가 한다.
// 탭 목록은 세로 `ListNavigation`이고 720 이하 폭에서는 찾기 칸 아래 `Select`다. 찾기는 라벨·키·설명을 본다.
// 시크릿 탭은 `secretsPanel`(P-10 시크릿 화면)을 그대로 넣는다. 표와 전용 편집기는 요약만 보인다(`settings-field.tsx`).

/** 개요 띠의 "엔진 재시작". 멈출 턴이 있으면 확인 창을 거치고, 보내는 동안 진행 표시, 거절되면 실패 토스트를 띄운다(`RestartButtons`) */
const RESTART_CHOICE: RestartChoice = {
  id: "settings",
  label: "desktop.settings.restart.button",
  variant: "outline",
  options: { confirmed: true },
};

export interface SettingsPageHandlers {
  readonly select: (tab: SettingsTab) => void;
  readonly query: (text: string) => void;
  /** ⌘S, Esc 같은 화면 바로 가기. ⌘F는 이 그림이 찾기 칸에 초점을 준다 */
  readonly keyIntent: (intent: SettingsKeyIntent) => void;
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
  /** 데이터 구역(고급 탭): 백업 만들기, 데이터 복원, 저장 공간을 이 순서로 담는다. 고급 탭을 고르고 찾기가 비었을 때 항목 위에 보인다 */
  readonly restorePanel: ReactNode;
  /** 계정 회전 행(P-11). 탭이 `providers`일 때 게이지 아래, 항목 위에 보인다. 값이 없으면 `null`이다 */
  readonly rotationPanel: ReactNode;
  /** 사용량 (이 대화) 패널(P-11). 게이지 자리가 있는 탭(예산과 한도, 계정과 제공자) 맨 위에 보인다 */
  readonly usagePanel: ReactNode;
  /** 앱 업데이트 줄(B-10). 개요 탭 맨 위에 보인다. 웹이나 문맥이 없으면 `null`이다 */
  readonly updatePanel?: ReactNode | undefined;
  /** 개요의 설정 파일 경로 목록(사용자·프로젝트·관리 정책) */
  readonly filePaths: readonly SettingsPathRow[];
  /** 개요의 "신뢰한 폴더" 구역(읽기 전용). 설정 파일 경로 아래에 보인다. 메서드가 없는 host에서는 `null`이다 */
  readonly trustPanel?: ReactNode | undefined;
  /** OS 알림 묶음(B-10). "실행과 서비스" 탭 맨 위에 보인다. 웹이나 문맥이 없으면 `null`이다 */
  readonly notifyPanel?: ReactNode | undefined;
  /** "플러그인과 그룹" 탭 맨 위의 실행 화면(그룹·플러그인 목록) */
  readonly pluginsPanel?: ReactNode | undefined;
  /** "대화와 컨텍스트" 탭의 기억 구역(W-19) */
  readonly memoryPanel?: ReactNode | undefined;
  /** 설정 찾기 글에 기억 구역이 맞는가. 맞으면 찾기 결과에 "기억" 묶음을 `memoryFindPanel`로 보인다 */
  readonly memoryMatches?: ((query: string) => boolean) | undefined;
  /** 설정 찾기 결과의 기억 묶음(찾는 글이 든 글만). `memoryMatches`가 맞을 때만 보인다 */
  readonly memoryFindPanel?: ReactNode | undefined;
  /** 외관 탭의 접근성 묶음 */
  readonly appearancePanel?: ReactNode | undefined;
  readonly handlers: SettingsPageHandlers;
}

/** 탭 열을 두는 화면 폭의 하한(요소 좌표 px). 탭 열 208 + 본문 카드가 읽히는 폭 */
const TAB_COLUMN_MIN_PANE = 640;

/** 화면 요소 자신의 폭(`clientWidth`, 요소 좌표라 앱 확대와 무관). 재기 전에는 `null`이다 */
function usePaneWidth(): readonly [number | null, RefCallback<HTMLElement>] {
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback<RefCallback<HTMLElement>>((el) => {
    if (el === null) return undefined;
    const read = (): void => {
      setWidth(el.clientWidth);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [width, ref];
}

export function SettingsPageView(props: SettingsPageProps): ReactNode {
  const { handlers, tab, query, readOnly, fileOpen } = props;
  const headingId = useId();
  // 탭 열(208px)과 본문이 같이 들어갈 폭이 아니면 셸이 compact가 아니어도 탭 열을 접어 찾기 칸 아래 선택 상자로 쓴다.
  // 폭은 이 화면 자신의 폭이다(사이드바가 열려 있으면 창보다 좁다). 앱 확대 아래에서도 요소 자기 좌표라 맞다
  const [pane, paneRef] = usePaneWidth();
  const narrow = props.narrow || (pane !== null && pane < TAB_COLUMN_MIN_PANE);
  // 머리 제목은 고른 탭 이름이다(P-09 시안 `_settings/frame.tsx`). 찾는 중에는 `'찾는 글' 찾은 항목`이다(시안 `search.tsx`)
  const titleOf =
    query.trim() === ""
      ? (props.view?.tabs.find((candidate) => candidate.id === tab)?.label ??
        t("desktop.settings.title"))
      : t("desktop.settings.search.resultsTitle", { query: query.trim() });
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
      ref={paneRef}
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
    <div className="flex min-h-0 w-52 flex-none flex-col border-e border-border-subtle ps-3 pe-2">
      <div className="flex h-16 flex-none items-center">
        <SearchField {...props} />
      </div>
      <ListNavigation
        kind="pages"
        size="sm"
        aria-label={t("desktop.settings.tabs.label")}
        className="min-h-0 flex-1 content-start overflow-y-auto pb-2"
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
                <RestartButtons choices={[RESTART_CHOICE]} size="xs" allowed={!props.readOnly} />
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

/** 제목 카드 하나. 제목이 없는 카드는 탭 이름을 라벨로 쓰는 나머지 카드다 */
interface TitledCard {
  readonly title: string | undefined;
  readonly fields: readonly FieldVM[];
}

/** 모델과 예산 탭을 제목 카드 목록으로 나눈다(카드 순서는 시안과 같다). 다른 탭은 `null`이라 한 카드로 그린다 */
function titledCardsOf(tab: SettingsTab, fields: readonly FieldVM[]): readonly TitledCard[] | null {
  if (tab === "models") {
    const groups = modelsGroupsOf(fields);
    return [
      { title: t("desktop.settings.models.basic"), fields: groups.basic },
      { title: t("desktop.settings.models.routing"), fields: groups.routing },
      { title: undefined, fields: groups.rest },
    ];
  }
  if (tab === "budgets") {
    const groups = budgetsGroupsOf(fields);
    return [
      { title: t("desktop.settings.budgets.budget"), fields: groups.budget },
      { title: t("desktop.settings.budgets.rateLimit"), fields: groups.rateLimit },
    ];
  }
  return null;
}

/** 찾기 결과나 고른 탭의 항목. 시크릿 탭은 시크릿 화면이 자리를 차지한다 */
function FieldItems(props: SettingsPageProps & { readonly view: SettingsView }): ReactNode {
  const { view, query, tab, hasThread, readOnly, saved, handlers } = props;
  const rowHandlers = handlers.fields;
  // 설정 키는 찾기 결과에서만 라벨 옆에 보인다(시안 `_settings/row.tsx` showKey)
  const rowOf = (field: FieldVM, showKey: boolean): ReactNode => (
    <FieldRow
      key={field.key}
      field={field}
      editable={field.editable && (!readOnly || field.origin === "desktop")}
      hasThread={hasThread}
      saved={saved.has(field.key)}
      editors={props.editors}
      handlers={rowHandlers}
      showKey={showKey}
    />
  );
  if (query.trim() !== "") {
    const groups = searchGroupsOf(view.tabs, query);
    // 기억 구역은 찾는 글이 구역 이름이나 기억 글에 맞을 때 "대화와 컨텍스트" 자리에 든다. 값을 못 읽었으면 맞지 않는다
    const memoryFound = props.memoryMatches?.(query) ?? false;
    if (groups.length === 0 && !memoryFound) {
      return (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.settings.search.noMatch")}</p>
      );
    }
    return (
      <>
        {TAB_ORDER.map((id) => {
          const group = groups.find((candidate) => candidate.tab === id);
          return (
            <Fragment key={id}>
              {id === "sessions" && memoryFound ? props.memoryFindPanel : null}
              {group === undefined ? null : (
                <SettingSection title={group.label}>
                  {group.fields.map((field) => rowOf(field, true))}
                </SettingSection>
              )}
            </Fragment>
          );
        })}
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
      {tab === "sessions" ? props.memoryPanel : null}
      {tab === "tools" ? props.toolsPanel : null}
      {tab === "plugins" ? props.pluginsPanel : null}
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
      <OverviewPanels
        view={view}
        updatePanel={props.updatePanel}
        filePaths={props.filePaths}
        trustPanel={props.trustPanel}
        onOpenFile={handlers.openFile}
        openFileDisabled={props.readOnly || props.fileOpen}
      />
    );
  // 모델과 예산 탭은 제목 카드로 나눈다(시안 p09 `models-tab`, p11 `BudgetsTab`). 항목이 없으면 아래 한 카드가 빈 항목 문장을 맡는다
  const cards = fields.length === 0 ? null : titledCardsOf(tab, fields);
  // 고급 탭은 운영자용 항목을 따로 묶어 제목으로 가른다(시안 `_settings`의 구역 모양)
  const groups = tab === "advanced" ? advancedGroupsOf(fields) : { general: fields, operator: [] };
  return (
    <>
      {panels}
      {cards === null && hasCard ? (
        <SettingSection
          label={tabView.label}
          title={tab === "plugins" ? t("desktop.settings.plugins.settings") : undefined}
        >
          {tab === "advanced" ? props.restorePanel : null}
          {emptyText === null ? null : <p className="text-ui-sm text-text-tertiary">{emptyText}</p>}
          {groups.general.map((field) => rowOf(field, false))}
        </SettingSection>
      ) : null}
      {cards?.map((card) =>
        card.fields.length === 0 ? null : (
          <SettingSection
            key={card.title ?? tabView.label}
            label={tabView.label}
            title={card.title}
          >
            {card.fields.map((field) => rowOf(field, false))}
          </SettingSection>
        ),
      )}
      {tab === "appearance" ? props.appearancePanel : null}
      {groups.operator.length === 0 ? null : (
        <SettingSection title={t("desktop.settings.advanced.operator.title")}>
          {groups.operator.map((field) => rowOf(field, false))}
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
