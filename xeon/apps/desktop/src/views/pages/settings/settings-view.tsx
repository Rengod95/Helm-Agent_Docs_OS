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
import type { FieldVM, SettingsView } from "@fresnel/client/settings";
import type { SettingKey } from "@fresnel/contracts/settings";
import { assertNever } from "@fresnel/contracts";
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
  mcpSectionMatchesOf,
  panelOwnedOf,
  restartCountOf,
  searchGroupsOf,
  settingsKeyOf,
  tabStep,
  type PageStatus,
  type SettingsKeyIntent,
} from "./settings-model.ts";
import {
  fieldsOfSection,
  isShownSection,
  sectionLabelOf,
  sectionsShownOf,
  SECTION_ORDER,
  type SettingsSection,
  type ShownSettingsSection,
} from "./settings-sections.ts";
import { FieldRow, type DedicatedEditors, type FieldHandlers } from "./settings-field.tsx";
import { RestartButtons, type RestartChoice } from "../../restart-confirm-dialog.tsx";
import { PanelBlock } from "../shared/panel-parts.tsx";
import type { SettingsPathRow } from "./settings-file-paths.ts";
import { OverviewPanels } from "./settings-overview.tsx";
import { SettingSection } from "./settings-section.tsx";
import { HEADER_CONTROL_SIZE, ScreenHeader } from "../../shell/screen-header.tsx";

// 설정 화면(P-09)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 틀은 P-09 시안(`_settings/frame.tsx`)을 따른다. 왼쪽은 키 찾기와 구역 목록(지금 구역은 올린 흰 칸), 오른쪽은 큰 제목과 머리 아래 선,
// 그 아래 구역마다 제목과 카드 하나다. 스크롤은 오른쪽 내용 자리 하나가 한다.
// 구역 목록은 `settings-sections.ts`의 `SECTION_ORDER`를 따르고, 빈 구역은 내비에 없다. 720 이하 폭에서는 찾기 칸 아래 `Select`다.
// 찾기는 라벨·키·설명을 본다. 항목은 구역에 드는 것만 보인다(`sectionOfField`).
// 시크릿 구역은 `secretsPanel`(P-10 시크릿 화면)을 그대로 넣는다. "연결과 서비스" 구역은 `connectionPanel`이 그린다(연결 화면 본문과 서비스 항목).
// 표와 전용 편집기는 요약만 보인다(`settings-field.tsx`).

/** 개요 띠의 "엔진 재시작". 멈출 턴이 있으면 확인 창을 거치고, 보내는 동안 진행 표시, 거절되면 실패 토스트를 띄운다(`RestartButtons`) */
const RESTART_CHOICE: RestartChoice = {
  id: "settings",
  label: "desktop.settings.restart.button",
  variant: "outline",
  options: { confirmed: true },
};

export interface SettingsPageHandlers {
  readonly select: (section: SettingsSection) => void;
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
  /** 고른 구역 */
  readonly tab: SettingsSection;
  readonly query: string;
  readonly narrow: boolean;
  readonly readOnly: boolean;
  readonly saved: ReadonlySet<SettingKey>;
  readonly restartError: string | null;
  /** 구역을 옮기려는데 저장하지 않은 초안이 있을 때. `count`는 초안 개수다 */
  readonly prompt: { readonly to: SettingsSection; readonly count: number } | null;
  readonly secretsPanel: ReactNode;
  /** 설정 파일 편집기(P-09 "파일로 보기"). 닫혀 있으면 `null`이다. 항목 목록 위에 보인다 */
  readonly fileEditor: ReactNode;
  /** 편집기가 열려 있는가. 열려 있으면 "파일로 보기" 단추가 잠긴다 */
  readonly fileOpen: boolean;
  /** 종류마다 전용 편집기 그림(P-11). 빠진 종류는 요약이다 */
  readonly editors: DedicatedEditors;
  /** 도구와 MCP 구역의 패널(P-12). 구역이 `tools`일 때 항목 위에 보인다 */
  readonly toolsPanel: ReactNode;
  /** 도구와 MCP 구역의 "MCP 서버" 표(W-15). 검색 순서 아래, 나머지 항목 위에 보인다. 찾기에서는 찾는 글이 표에 맞을 때 도구 자리에 보인다 */
  readonly mcpPanel?: ReactNode | undefined;
  /** 백업과 고급 구역: 백업 만들기, 데이터 복원, 저장 공간을 이 순서로 담는다. 이 구역을 고르면 항목 위에 보인다 */
  readonly restorePanel: ReactNode;
  /** 계정 회전 행(P-11). 모델과 계정 구역에서 사용량 아래, 항목 위에 보인다. 값이 없으면 `null`이다 */
  readonly rotationPanel: ReactNode;
  /** 사용량 (이 대화) 패널(P-11). 모델과 계정 구역 맨 위에 보인다 */
  readonly usagePanel: ReactNode;
  /** 앱 업데이트 줄(B-10). 개요 맨 위에 보인다. 웹이나 문맥이 없으면 `null`이다 */
  readonly updatePanel?: ReactNode | undefined;
  /** 개요의 설정 파일 경로 목록(사용자·프로젝트·관리 정책) */
  readonly filePaths: readonly SettingsPathRow[];
  /** 개요의 "신뢰한 폴더" 구역(읽기 전용). 설정 파일 경로 아래에 보인다. 메서드가 없는 host에서는 `null`이다 */
  readonly trustPanel?: ReactNode | undefined;
  /** 연결과 서비스 구역 전부: 연결 화면 본문과 서비스 항목. 오프라인에서도 보인다(연결을 여는 곳이다) */
  readonly connectionPanel?: ReactNode | undefined;
  /** 알림 묶음(B-10). 화면과 알림 구역 맨 위에 보인다. 웹이나 문맥이 없으면 `null`이다 */
  readonly notifyPanel?: ReactNode | undefined;
  /** 플러그인 구역 맨 위의 실행 화면(그룹·플러그인 목록) */
  readonly pluginsPanel?: ReactNode | undefined;
  /** 대화와 기억 구역의 기억 패널(W-19) */
  readonly memoryPanel?: ReactNode | undefined;
  /** 설정 찾기 글에 기억 구역이 맞는가. 맞으면 찾기 결과에 "기억" 묶음을 `memoryFindPanel`로 보인다 */
  readonly memoryMatches?: ((query: string) => boolean) | undefined;
  /** 설정 찾기 결과의 기억 묶음(찾는 글이 든 글만). `memoryMatches`가 맞을 때만 보인다 */
  readonly memoryFindPanel?: ReactNode | undefined;
  /** 화면과 알림 구역의 접근성 묶음 */
  readonly appearancePanel?: ReactNode | undefined;
  readonly handlers: SettingsPageHandlers;
}

/** 구역 열을 두는 화면 폭의 하한(요소 좌표 px). 구역 열 208 + 본문 카드가 읽히는 폭 */
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

/** 노드가 그릴 것이 있는가. `null`, `undefined`, `false`는 없다 */
function presentOf(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
}

/**
 * 구역에 패널이 있는가. 내비는 패널이나 항목이 있는 구역만 남긴다. 개요, 시크릿, 연결, 백업과 고급은 항상 패널이 있다.
 */
function hasPanelOf(props: SettingsPageProps, section: ShownSettingsSection): boolean {
  switch (section) {
    case "overview":
    case "secrets":
    case "connection":
    case "advanced":
      return true;
    case "providers":
      return presentOf(props.usagePanel) || presentOf(props.rotationPanel);
    case "tools":
      return presentOf(props.toolsPanel) || presentOf(props.mcpPanel);
    case "plugins":
      return presentOf(props.pluginsPanel);
    case "sessions":
      return presentOf(props.memoryPanel);
    case "appearance":
      return presentOf(props.appearancePanel) || presentOf(props.notifyPanel);
    case "permissions":
    case "execution":
      return false;
    default:
      return assertNever(section, "ShownSettingsSection");
  }
}

export function SettingsPageView(props: SettingsPageProps): ReactNode {
  const { handlers, tab, query, readOnly, fileOpen } = props;
  const headingId = useId();
  // 구역 열(208px)과 본문이 같이 들어갈 폭이 아니면 셸이 compact가 아니어도 구역 열을 접어 찾기 칸 아래 선택 상자로 쓴다.
  // 폭은 이 화면 자신의 폭이다(사이드바가 열려 있으면 창보다 좁다). 앱 확대 아래에서도 요소 자기 좌표라 맞다
  const [pane, paneRef] = usePaneWidth();
  const narrow = props.narrow || (pane !== null && pane < TAB_COLUMN_MIN_PANE);
  const sections = sectionsShownOf(props.view, (section) => hasPanelOf(props, section));
  // 머리 제목은 고른 구역의 이름이다(P-09 시안 `_settings/frame.tsx`). 찾는 중에는 `'찾는 글' 찾은 항목`이다(시안 `search.tsx`)
  const titleOf =
    query.trim() === ""
      ? isShownSection(tab)
        ? sectionLabelOf(tab)
        : t("desktop.settings.title")
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
  // "파일로 보기"는 P-09 시안처럼 머리 끝에 둔다. 찾는 중이나 시크릿과 연결 구역에는 없다
  const fileAction =
    query.trim() === "" && tab !== "secrets" && tab !== "connection" ? (
      <Button
        variant="ghost"
        size={HEADER_CONTROL_SIZE}
        disabled={readOnly || fileOpen}
        onClick={handlers.openFile}
      >
        {t("desktop.settings.file.open.button")}
      </Button>
    ) : null;
  return (
    <section
      ref={paneRef}
      aria-labelledby={headingId}
      className="flex min-h-0 min-w-0 flex-1"
      onKeyDown={onKey}
    >
      {narrow ? null : <TabColumn {...props} sections={sections} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScreenHeader title={titleOf} titleId={headingId} pageTitle action={fileAction} />
        {narrow ? <NarrowTabs {...props} sections={sections} /> : null}
        <ScrollArea label={t("desktop.settings.title")} className="min-h-0 flex-1">
          <div className="max-w-[64rem] px-6 pb-12">
            <Body {...props} />
          </div>
        </ScrollArea>
      </div>
      <PromptDialog prompt={props.prompt} handlers={handlers} />
    </section>
  );
}

/** 찾기 칸. 구역 열과 좁은 폭의 구역 칸이 같이 쓴다 */
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

/** 왼쪽 구역 열. 찾기 칸은 머리 높이에 맞추고, 지금 구역은 올린 흰 칸으로 보인다 */
function TabColumn(
  props: SettingsPageProps & { readonly sections: readonly ShownSettingsSection[] },
): ReactNode {
  const { handlers, tab, sections } = props;
  return (
    <div className="flex min-h-0 w-52 flex-none flex-col border-e border-border-subtle ps-2 pe-1.5">
      <div className="flex h-12 flex-none items-center">
        <SearchField {...props} />
      </div>
      <ListNavigation
        kind="pages"
        size="sm"
        aria-label={t("desktop.settings.tabs.label")}
        className="min-h-0 flex-1 content-start overflow-y-auto pb-2"
        onKeyDown={(event) => {
          // ↑↓은 구역 목록에서 옆 구역으로 옮긴다(§6.13). 옮긴 뒤의 초점은 그대로 둔다
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          handlers.select(tabStep(tab, sections, event.key === "ArrowDown" ? 1 : -1));
        }}
      >
        <ListNavigationGroup>
          {sections.map((id) => (
            <ListNavigationItem
              key={id}
              current={id === tab}
              onSelect={() => {
                handlers.select(id);
              }}
            >
              {sectionLabelOf(id)}
            </ListNavigationItem>
          ))}
        </ListNavigationGroup>
      </ListNavigation>
    </div>
  );
}

/** 720 이하 폭의 찾기 칸과 구역 고르기. 구역 열 대신 머리 아래에 둔다 */
function NarrowTabs(
  props: SettingsPageProps & { readonly sections: readonly ShownSettingsSection[] },
): ReactNode {
  const { handlers, tab, sections } = props;
  return (
    <div className="grid gap-2 border-b border-border-subtle px-6 py-3">
      <SearchField {...props} />
      <Select
        size="xs"
        aria-label={t("desktop.settings.tabs.select")}
        value={tab}
        className="w-[min(20rem,100%)]"
        onValueChange={(next) => {
          const found = sections.find((candidate) => candidate === next);
          if (found !== undefined) handlers.select(found);
        }}
      >
        {sections.map((id) => (
          <SelectOption key={id} value={id}>
            {sectionLabelOf(id)}
          </SelectOption>
        ))}
      </Select>
    </div>
  );
}

/** 본문. 연결과 서비스 구역은 오프라인에서도 그리고, 나머지는 오프라인, 실패, 읽는 중, 값 가운데 하나를 그린다 */
function Body(props: SettingsPageProps): ReactNode {
  const { status, view, handlers } = props;
  if (props.query.trim() === "" && props.tab === "connection") {
    return props.connectionPanel ?? null;
  }
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
        <p role="status" className="text-ui text-text-tertiary">
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

/** 파일 편집기(열려 있을 때)와 항목 목록. 편집기는 구역과 찾기 어디서나 열린 채로 보인다(초안을 가리지 않으려고) */
function FieldList(props: SettingsPageProps & { readonly view: SettingsView }): ReactNode {
  return (
    <>
      {props.fileEditor}
      <FieldItems {...props} />
    </>
  );
}

/** 찾기 결과나 고른 구역의 항목. 시크릿 구역은 시크릿 화면이 자리를 차지한다 */
function FieldItems(props: SettingsPageProps & { readonly view: SettingsView }): ReactNode {
  const { view, query, tab, readOnly, saved, handlers } = props;
  const rowHandlers = handlers.fields;
  // 설정 키는 찾기 결과에서만 라벨 옆에 보인다(시안 `_settings/row.tsx` showKey)
  const rowOf = (field: FieldVM, showKey: boolean): ReactNode => (
    <FieldRow
      key={field.key}
      field={field}
      editable={field.editable && (!readOnly || field.origin === "desktop")}
      saved={saved.has(field.key)}
      editors={props.editors}
      handlers={rowHandlers}
      showKey={showKey}
    />
  );
  if (query.trim() !== "") {
    const groups = searchGroupsOf(view, query);
    // 기억 구역은 찾는 글이 구역 이름이나 기억 글에 맞을 때 "대화와 기억" 자리에 든다. 값을 못 읽었으면 맞지 않는다
    const memoryFound = props.memoryMatches?.(query) ?? false;
    // "MCP 서버" 표는 찾는 글이 그 표의 글에 맞을 때 "도구와 MCP" 자리에 든다(표 항목은 찾기 묶음에 넣지 않는다)
    const mcpFound = mcpSectionMatchesOf(view.tabs, query);
    if (groups.length === 0 && !memoryFound && !mcpFound) {
      return <p className="text-ui text-text-tertiary">{t("desktop.settings.search.noMatch")}</p>;
    }
    return (
      <>
        {SECTION_ORDER.map((id) => {
          const group = groups.find((candidate) => candidate.section === id);
          return (
            <Fragment key={id}>
              {id === "sessions" && memoryFound ? props.memoryFindPanel : null}
              {id === "tools" && mcpFound ? props.mcpPanel : null}
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
  if (tab === "overview") {
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
  }
  if (!isShownSection(tab)) return null;
  // 검색 순서와 MCP 서버 표와 확장 켜짐 스위치는 패널이 그린다. 그래서 구역 항목 목록에서는 뺀다
  const fields = fieldsOfSection(view, tab).filter((field) => !panelOwnedOf(field));
  const label = sectionLabelOf(tab);
  // 패널은 항목 목록 위에 보인다. 모델과 계정은 사용량, 회전 순서다(시안 p11)
  const top = (
    <>
      {tab === "providers" ? props.usagePanel : null}
      {tab === "providers" && props.rotationPanel !== null ? (
        <PanelBlock title={t("desktop.providers.rotation.title")}>{props.rotationPanel}</PanelBlock>
      ) : null}
      {tab === "tools" ? props.toolsPanel : null}
      {tab === "tools" ? props.mcpPanel : null}
      {tab === "plugins" ? props.pluginsPanel : null}
      {tab === "sessions" ? props.memoryPanel : null}
      {tab === "appearance" ? props.notifyPanel : null}
    </>
  );
  // 백업과 고급은 항목이 없어도 복원 구역을 보인다
  const card = fields.length > 0 || tab === "advanced";
  return (
    <>
      {top}
      {card ? (
        <SettingSection
          label={label}
          title={tab === "plugins" ? t("desktop.settings.plugins.settings") : undefined}
        >
          {tab === "advanced" ? props.restorePanel : null}
          {fields.map((field) => rowOf(field, false))}
        </SettingSection>
      ) : null}
      {tab === "appearance" ? props.appearancePanel : null}
    </>
  );
}

/** 구역을 옮기기 전에 묻는 대화 상자. 저장하고 옮기기, 버리고 옮기기, 이 구역에 머물기 */
function PromptDialog(props: {
  readonly prompt: { readonly to: SettingsSection; readonly count: number } | null;
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
