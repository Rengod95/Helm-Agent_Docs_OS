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
import { Search, TriangleAlert } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { FieldVM, SettingsView } from "@fresnel/client/settings";
import type { SettingKey } from "@fresnel/contracts/settings";
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
  restartCountOf,
  settingsKeyOf,
  type PageStatus,
  type SettingsKeyIntent,
} from "./settings-model.ts";
import {
  partFieldsOf,
  searchSectionsOf,
  sectionStep,
  shownFieldsOf,
  SECTION_ORDER,
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  type SettingsPanelId,
  type SettingsSectionId,
} from "./settings-sections.ts";
import { FieldRow, type DedicatedEditors, type FieldHandlers } from "./settings-field.tsx";
import { RestartButtons, type RestartChoice } from "../../restart-confirm-dialog.tsx";
import { FORM_CONTROL_SIZE, SettingSection, formColumnOf } from "./settings-section.tsx";
import { HEADER_CONTROL_SIZE, ScreenHeader } from "../../shell/screen-header.tsx";

// 설정 화면(P-09, L4.settings-ui §4.1 [결정: 2026-11-11 사용자])의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 왼쪽은 찾기 칸과 구역 내비(묶음 셋: 앱, 에이전트, 엔진), 오른쪽은 구역 이름 머리와 720px 가운데 열 하나다. 열 안에 구역의 부분이
// 차례로 놓인다: 제목 붙은 항목 카드(`SettingSection` + `FieldRow`)이거나 자기 머리와 카드를 그리는 패널(`panels`).
// 화면에 보이는 키와 자리는 `settings-sections.ts` 표 하나가 정한다. 범위 고르기와 대화 범위 표시는 없다.

/** 머리 아래 띠의 "엔진 재시작". 멈출 턴이 있으면 확인 창을 거친다(`RestartButtons`) */
const RESTART_CHOICE: RestartChoice = {
  id: "settings",
  label: "desktop.settings.restart.button",
  variant: "outline",
  options: { confirmed: true },
};

export interface SettingsPageHandlers {
  readonly select: (section: SettingsSectionId) => void;
  readonly query: (text: string) => void;
  /** ⌘S, Esc 같은 화면 바로 가기. ⌘F는 이 그림이 찾기 칸에 초점을 준다 */
  readonly keyIntent: (intent: SettingsKeyIntent) => void;
  readonly retry: () => void;
  readonly fields: FieldHandlers;
  readonly promptSave: () => void;
  readonly promptDiscard: () => void;
  readonly promptStay: () => void;
  /** 머리 끝의 "파일로 보기"를 누르면 사용자 설정 파일 편집기를 연다 */
  readonly openFile: () => void;
}

export interface SettingsPageProps {
  readonly status: PageStatus;
  /** 읽지 못한 까닭의 문장. `failed`일 때 보인다 */
  readonly loadError: string;
  /** `ready`일 때의 view-model. 오프라인이어도 마지막으로 읽은 값이 있으면 있다 */
  readonly view: SettingsView | null;
  readonly section: SettingsSectionId;
  readonly query: string;
  readonly narrow: boolean;
  readonly readOnly: boolean;
  readonly saved: ReadonlySet<SettingKey>;
  readonly restartError: string | null;
  /** 구역을 옮기려는데 저장하지 않은 초안이 있을 때. `count`는 초안 개수다 */
  readonly prompt: { readonly to: SettingsSectionId; readonly count: number } | null;
  /** 설정 파일 편집기("파일로 보기"). 닫혀 있으면 `null`이다. 열 맨 위에 보인다 */
  readonly fileEditor: ReactNode;
  /** 편집기가 열려 있는가. 열려 있으면 "파일로 보기" 단추가 잠긴다 */
  readonly fileOpen: boolean;
  /** 종류마다 전용 편집기 그림(P-11). 빠진 종류는 요약이다 */
  readonly editors: DedicatedEditors;
  /** 구역의 패널 그림. 빠진 패널은 그리지 않는다(웹처럼 문맥이 없는 곳) */
  readonly panels: Readonly<Partial<Record<SettingsPanelId, ReactNode>>>;
  /** 모든 구역 맨 위의 알림 띠(설정 파일 문제, 저장소 교체). 없으면 `null`이다 */
  readonly banners?: ReactNode | undefined;
  /** 설정 찾기 글에 기억 구역이 맞는가. 맞으면 찾기 결과에 "기억" 묶음을 `memoryFindPanel`로 보인다 */
  readonly memoryMatches?: ((query: string) => boolean) | undefined;
  /** 설정 찾기 결과의 기억 묶음(찾는 글이 든 글만). `memoryMatches`가 맞을 때만 보인다 */
  readonly memoryFindPanel?: ReactNode | undefined;
  readonly handlers: SettingsPageHandlers;
}

/** 구역 내비를 두는 화면 폭의 하한(요소 좌표 px). 내비 208 + 본문 열이 읽히는 폭 */
const NAV_MIN_PANE = 640;

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
  const { handlers, section, query, readOnly, fileOpen } = props;
  const headingId = useId();
  const [pane, paneRef] = usePaneWidth();
  const narrow = props.narrow || (pane !== null && pane < NAV_MIN_PANE);
  const searching = query.trim() !== "";
  const titleOf = searching
    ? t("desktop.settings.search.resultsTitle", { query: query.trim() })
    : t(SETTINGS_SECTIONS[section].label);
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
  // "파일로 보기"는 머리 끝 하나다. 찾는 중이나 파일과 상관없는 구역(시크릿, 연결)에는 없다
  const fileAction =
    !searching && section !== "secrets" && section !== "connection" ? (
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
      {narrow ? null : <SectionNav {...props} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ScreenHeader title={titleOf} titleId={headingId} pageTitle action={fileAction} />
        {narrow ? <NarrowNav {...props} /> : null}
        <ScrollArea label={t("desktop.settings.title")} className="min-h-0 flex-1">
          <div className="px-8 pt-2 pb-16">
            <div
              data-slot="settings-column"
              className={`mx-auto w-full ${formColumnOf(searching ? null : section)}`}
            >
              <Body {...props} />
            </div>
          </div>
        </ScrollArea>
        <RestartBar {...props} />
      </div>
      <PromptDialog prompt={props.prompt} handlers={handlers} />
    </section>
  );
}

/** 찾기 칸. 구역 내비와 좁은 폭의 내비 칸이 같이 쓴다 */
function SearchField(props: SettingsPageProps): ReactNode {
  return (
    <Input
      type="search"
      size="sm"
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

/** 왼쪽 구역 내비. 찾기 칸은 머리 높이에 맞추고, 묶음 이름 아래에 구역이 놓인다 */
function SectionNav(props: SettingsPageProps): ReactNode {
  const { handlers, section, query } = props;
  const searching = query.trim() !== "";
  return (
    <div className="flex min-h-0 w-52 flex-none flex-col border-e border-border-subtle ps-2 pe-1.5">
      <div className="flex h-12 flex-none items-center">
        <SearchField {...props} />
      </div>
      <ListNavigation
        kind="pages"
        size="sm"
        aria-label={t("desktop.settings.tabs.label")}
        className="min-h-0 flex-1 content-start overflow-y-auto pb-2 [&>[data-slot=list-navigation-heading]:not(:first-child)]:mt-4"
        onKeyDown={(event) => {
          // ↑↓은 내비에서 옆 구역으로 옮긴다(§6.13). 끝에서 멈춘다
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          handlers.select(sectionStep(section, event.key === "ArrowDown" ? 1 : -1));
        }}
      >
        {SETTINGS_GROUPS.map((group) => (
          <ListNavigationGroup key={group.id} heading={t(group.label)}>
            {SECTION_ORDER.filter((id) => SETTINGS_SECTIONS[id].group === group.id).map((id) => (
              <ListNavigationItem
                key={id}
                current={!searching && id === section}
                onSelect={() => {
                  handlers.select(id);
                }}
              >
                {t(SETTINGS_SECTIONS[id].label)}
              </ListNavigationItem>
            ))}
          </ListNavigationGroup>
        ))}
      </ListNavigation>
    </div>
  );
}

/** 좁은 폭의 찾기 칸과 구역 고르기. 내비 대신 머리 아래에 둔다 */
function NarrowNav(props: SettingsPageProps): ReactNode {
  const { handlers, section } = props;
  return (
    <div className="grid gap-2 border-b border-border-subtle px-8 py-3">
      <SearchField {...props} />
      <Select
        size="sm"
        aria-label={t("desktop.settings.tabs.select")}
        value={section}
        className="w-[min(20rem,100%)]"
        onValueChange={(next) => {
          const found = SECTION_ORDER.find((candidate) => candidate === next);
          if (found !== undefined) handlers.select(found);
        }}
      >
        {SECTION_ORDER.map((id) => (
          <SelectOption key={id} value={id}>
            {t(SETTINGS_SECTIONS[id].label)}
          </SelectOption>
        ))}
      </Select>
    </div>
  );
}

/** 본문. 연결 구역은 엔진 설정을 읽지 않아도 그린다. 그 밖은 오프라인, 실패, 읽는 중, 값 가운데 하나다 */
function Body(props: SettingsPageProps): ReactNode {
  const { status, view, handlers, section, query } = props;
  if (section === "connection" && query.trim() === "") {
    return (
      <>
        {props.banners}
        {props.panels.connection}
      </>
    );
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
  // 알림 띠는 알림이 있을 때만 그린다(빈 띠 칸이 첫 구역 위에 남지 않게). 재시작 대기는 화면 아래 띠(`RestartBar`)가 알린다
  const notices = props.readOnly || props.restartError !== null;
  return (
    <>
      {props.banners}
      {notices ? (
        <div className="grid gap-2 pb-6">
          {props.readOnly ? <Alert tone="info">{t("desktop.settings.offline")}</Alert> : null}
          {props.restartError === null ? null : <Alert tone="danger">{props.restartError}</Alert>}
        </div>
      ) : null}
      {props.fileEditor}
      {query.trim() === "" ? (
        <SectionParts {...props} view={view} />
      ) : (
        <SearchResults {...props} view={view} />
      )}
    </>
  );
}

/**
 * 재시작 띠(DP-79): 재시작해야 적용되는 값이 실제로 바뀌어 기다릴 때만, 설정 본문 아래(스크롤 밖)에 한 줄로 둔다.
 * 왼쪽은 경고 아이콘과 "재시작해야 적용되는 변경이 N개 있어요", 오른쪽은 엔진 재시작 단추(멈출 턴이 있으면 확인 창).
 * 줄마다 붙던 "재시작 필요" 배지는 없다. 재시작이 필요한 항목이라는 사실은 그 항목의 정보 아이콘 글 끝에 있다.
 */
function RestartBar(props: SettingsPageProps): ReactNode {
  const { view } = props;
  if (props.status !== "ready" || view === null || restartCountOf(view) === 0) return null;
  return (
    <div
      data-slot="settings-restart-bar"
      role="status"
      className="flex-none border-t border-border-subtle bg-surface-base px-8"
    >
      <div
        className={`mx-auto flex min-h-11 w-full items-center gap-3 py-2 ${formColumnOf(props.query.trim() === "" ? props.section : null)}`}
      >
        <TriangleAlert aria-hidden className="size-icon-sm flex-none text-warning-text" />
        <span className="min-w-0 flex-1 text-ui text-text-primary">
          {view.restartBanner?.text ?? ""}
        </span>
        <RestartButtons
          choices={[RESTART_CHOICE]}
          size={FORM_CONTROL_SIZE}
          allowed={!props.readOnly}
        />
      </div>
    </div>
  );
}

/** 항목 행 하나. 오프라인이면 엔진 항목은 읽기 전용이다(로컬 항목은 바꿀 수 있다) */
function rowOf(props: SettingsPageProps, field: FieldVM, showKey: boolean): ReactNode {
  return (
    <FieldRow
      key={field.key}
      field={field}
      editable={field.editable && (!props.readOnly || field.origin === "desktop")}
      saved={props.saved.has(field.key)}
      editors={props.editors}
      handlers={props.handlers.fields}
      showKey={showKey}
    />
  );
}

/** 고른 구역의 부분을 차례로 그린다. 항목이 하나도 없는 카드는 그리지 않는다 */
function SectionParts(props: SettingsPageProps & { readonly view: SettingsView }): ReactNode {
  const spec = SETTINGS_SECTIONS[props.section];
  const shown = shownFieldsOf(props.view.tabs);
  return (
    <>
      {spec.parts.map((part, index) => {
        if (part.kind === "panel") {
          return <Fragment key={part.panel}>{props.panels[part.panel]}</Fragment>;
        }
        const fields = partFieldsOf(part, shown);
        if (fields.length === 0) return null;
        return (
          <SettingSection
            key={part.title ?? `fields-${String(index)}`}
            title={part.title === null ? undefined : t(part.title)}
            label={t(spec.label)}
          >
            {fields.map((field) => rowOf(props, field, false))}
          </SettingSection>
        );
      })}
    </>
  );
}

/** 찾기 결과: 맞은 항목을 구역마다 카드 하나로. 기억 글과 MCP 서버 표가 맞으면 그 구역 자리에 함께 든다 */
function SearchResults(props: SettingsPageProps & { readonly view: SettingsView }): ReactNode {
  const { view, query } = props;
  const matches = searchSectionsOf(shownFieldsOf(view.tabs), query);
  const memoryFound = props.memoryMatches?.(query) ?? false;
  const mcpFound = mcpSectionMatchesOf(view.tabs, query);
  if (matches.length === 0 && !memoryFound && !mcpFound) {
    return <p className="m-0 text-ui text-text-tertiary">{t("desktop.settings.search.noMatch")}</p>;
  }
  return (
    <>
      {SECTION_ORDER.map((id) => {
        const match = matches.find((candidate) => candidate.section === id);
        return (
          <Fragment key={id}>
            {id === "sessions" && memoryFound ? props.memoryFindPanel : null}
            {id === "tools" && mcpFound ? props.panels.mcp : null}
            {match === undefined ? null : (
              <SettingSection title={t(SETTINGS_SECTIONS[id].label)}>
                {match.fields.map((field) => rowOf(props, field, true))}
              </SettingSection>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

/** 구역을 옮기기 전에 묻는 대화 상자. 저장하고 옮기기, 버리고 옮기기, 이 구역에 머물기 */
function PromptDialog(props: {
  readonly prompt: { readonly to: SettingsSectionId; readonly count: number } | null;
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
