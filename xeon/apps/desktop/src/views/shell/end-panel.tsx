// 오른쪽 세로 가운데에 떠 있는 막대 + 그 왼쪽에 펼친 well(S-01 끝 영역, DP-10, DP-135, DP-192~194).
// 막대는 두 자리다: 하네스 공통 탭(`registry.endTabs`, 막대 칸)과, 구분선 뒤 "플러그인" 단추 하나(`registry.pluginEndTabs`, 누르면 2차 메뉴).
// 고정 칸은 수가 정해져 있어 넘침 메뉴가 없다. 플러그인 패널이 없으면 구분선과 단추를 그리지 않는다.
// 영역마다 마지막 탭(플러그인 패널 포함)을 기억한다(`AreaPlace.endTab`). well 머리는 제목 + 그 탭의 요약 한 줄 + 접기다.
import { Presence } from "../../lib/motion-presets.tsx";
import { t } from "@fresnel/client/i18n";
import {
  Card,
  CardPanel,
  FloatingBar,
  FloatingBarItem,
  FloatingBarSeparator,
  IconButton,
  Kbd,
  Popover,
  ScrollArea,
  Tooltip,
} from "@caustic/react";
import { Plug, X } from "@caustic/react/icons";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { EndTabDef, PluginEndTabDef, ShellRegistry, TabBadge } from "./registry.ts";
import type { ActionId } from "./keybindings.ts";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import { WELL_DEFAULT_WIDTH } from "./toaster-slot.ts";

const WELL_MIN_WIDTH = 320;
const WELL_MAX_WIDTH = 480;

/** 2차 메뉴 안(포털)을 누른 것은 well 바깥 누름으로 보지 않는다 */
const PLUGIN_MENU_ATTR = "data-end-plugin-menu";

const NO_BADGE: TabBadge = { read: () => undefined, subscribe: () => () => undefined };

/** 칸의 숫자를 읽는다. 배지 값이 바뀌면 그리는 쪽이 다시 그린다. 서버 그리기에서도 같은 값을 준다 */
function useBadge(badge: TabBadge | undefined): number | undefined {
  const source = badge ?? NO_BADGE;
  return useSyncExternalStore(source.subscribe, source.read, source.read);
}

/** 탭의 숫자(스토어 배지 또는 `Count` 부품)를 읽어 `children`에 넘긴다. `Count`가 있으면 그것이 우선이다 */
function TabCount(props: {
  readonly tab: EndTabDef;
  readonly children: (count: number | undefined) => ReactNode;
}): ReactNode {
  const stored = useBadge(props.tab.badge);
  const Count = props.tab.Count;
  if (Count === undefined) return props.children(stored);
  return <Count render={(count) => props.children(count ?? stored)} />;
}

/** 칸과 well 영역 이름: 알림 수가 있으면 이름 뒤에 숫자를 붙인다("받은 요청 2") */
export function tabTitleOf(label: string, badge: number | undefined): string {
  return badge === undefined || badge <= 0 ? label : `${label} ${badge}`;
}

/** 지금 탭의 well 폭(px). 선언 폭을 320~480으로 자른다 */
export function wellWidthOf(tab: EndTabDef | undefined): number {
  const w = tab?.width ?? WELL_DEFAULT_WIDTH;
  return Math.min(WELL_MAX_WIDTH, Math.max(WELL_MIN_WIDTH, w));
}

/** 막대 탭과 플러그인 패널 가운데 지금 탭. 기억한 id가 없으면 막대 첫 탭이다 */
export function currentEndTabOf(
  tabs: readonly EndTabDef[],
  pluginTabs: readonly PluginEndTabDef[],
  id: string,
): EndTabDef | undefined {
  return tabs.find((x) => x.id === id) ?? pluginTabs.find((x) => x.id === id) ?? tabs[0];
}

type KeyLabel = (id: ActionId) => string;

/** 2차 메뉴의 줄 단추들(문서 순서) */
function menuItemsOf(root: HTMLElement | null): HTMLButtonElement[] {
  return root === null ? [] : [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
}

/** 머리 요약의 숫자 글. 0이나 없으면 그리지 않는다 */
function countText(count: number | undefined): ReactNode {
  return count === undefined || count <= 0 ? null : String(count);
}

/** 막대의 한 칸. 숫자는 탭이 닫혀 있을 때만 칸 모서리에 보인다(열린 탭은 well 머리 요약이 같은 수를 말한다) */
function EndBarItem(props: {
  readonly tab: EndTabDef;
  readonly active: boolean;
  readonly keyLabel: KeyLabel | undefined;
  readonly onClick: () => void;
}): ReactNode {
  const { tab, keyLabel } = props;
  return (
    <TabCount tab={tab}>
      {(count) => (
        <Tooltip
          side="left"
          content={t(tab.label)}
          {...(tab.shortcut === undefined || keyLabel === undefined
            ? {}
            : { shortcut: keyLabel(tab.shortcut) })}
        >
          <FloatingBarItem
            icon={tab.icon}
            data-end-tab={tab.id}
            aria-label={tabTitleOf(t(tab.label), count)}
            aria-expanded={props.active}
            active={props.active}
            badge={count !== undefined && count > 0 && !props.active ? count : undefined}
            onClick={props.onClick}
          />
        </Tooltip>
      )}
    </TabCount>
  );
}

/** 플러그인 패널들의 알림 수 합 */
function PluginCount(props: {
  readonly tabs: readonly PluginEndTabDef[];
  readonly children: (count: number) => ReactNode;
}): ReactNode {
  const [first, ...rest] = props.tabs;
  if (first === undefined) return props.children(0);
  return (
    <TabCount tab={first}>
      {(count) => (
        <PluginCount tabs={rest}>{(sum) => props.children(sum + (count ?? 0))}</PluginCount>
      )}
    </TabCount>
  );
}

/**
 * 막대 끝 "플러그인" 단추와 2차 메뉴(DP-194). 메뉴는 막대 왼쪽에 서는 팝오버이고 묶음 둘이다:
 * 플러그인이 기여한 패널(`source: plugin`)과 이 대화의 플러그인 상태 화면(`source: host`). 줄을 고르면 그 패널이 well에 열린다.
 * 키보드: 단추에서 열면 첫 줄(또는 지금 열린 줄)에 초점, 위아래 화살표로 옮기고 Enter로 연다. Esc는 닫고 단추로 돌아간다
 */
function PluginMenu(props: {
  readonly tabs: readonly PluginEndTabDef[];
  readonly currentId: string | null;
  readonly keyLabel: KeyLabel | undefined;
  readonly onPick: (id: string) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const plugins = props.tabs.filter((tab) => tab.source === "plugin");
  const hosts = props.tabs.filter((tab) => tab.source === "host");
  const active = props.currentId !== null;
  useEffect(() => {
    // 팝오버가 그려진 다음 틀에 초점을 준다(포털이 붙은 뒤). 지금 열린 줄이 있으면 그 줄이다
    const frame = open
      ? requestAnimationFrame(() => {
          const list = menuItemsOf(listRef.current);
          (list.find((el) => el.dataset.current === "true") ?? list[0])?.focus();
        })
      : 0;
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [open]);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const list = menuItemsOf(listRef.current);
    if (list.length === 0) return;
    e.preventDefault();
    const at = list.findIndex((el) => el === document.activeElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? list.length - 1
          : e.key === "ArrowDown"
            ? (at + 1) % list.length
            : (at - 1 + list.length) % list.length;
    list[next]?.focus();
  };
  const row = (tab: PluginEndTabDef): ReactNode => (
    <PluginMenuRow
      key={tab.id}
      tab={tab}
      current={tab.id === props.currentId}
      keyLabel={props.keyLabel}
      onPick={() => {
        setOpen(false);
        props.onPick(tab.id);
      }}
    />
  );
  return (
    <PluginCount tabs={props.tabs}>
      {(count) => (
        <Popover
          open={open}
          onOpenChange={setOpen}
          side="left"
          align="end"
          arrow={false}
          size="md"
          className="w-74 px-1 py-1"
          data-end-plugin-menu=""
          anchor={
            <FloatingBarItem
              icon={<Plug />}
              data-end-plugin=""
              aria-label={tabTitleOf(t("desktop.shell.end.plugins"), count)}
              aria-haspopup="menu"
              aria-expanded={open}
              active={active || open}
              badge={count > 0 && !active ? count : undefined}
            />
          }
        >
          <div
            ref={listRef}
            role="menu"
            aria-label={t("desktop.shell.end.plugins")}
            className="grid gap-0.5"
            onKeyDown={onKeyDown}
          >
            {plugins.length === 0 ? null : (
              <>
                <MenuHead>{t("desktop.shell.end.pluginPanels")}</MenuHead>
                {plugins.map(row)}
              </>
            )}
            {hosts.length === 0 ? null : (
              <>
                {plugins.length === 0 ? null : (
                  <div role="separator" className="mx-2 my-1 h-px bg-divider-line" />
                )}
                <MenuHead>{t("desktop.shell.end.pluginState")}</MenuHead>
                {hosts.map(row)}
              </>
            )}
          </div>
        </Popover>
      )}
    </PluginCount>
  );
}

function MenuHead(props: { readonly children: ReactNode }): ReactNode {
  return (
    <div role="presentation" className="flex h-7 items-center px-2 text-ui-sm text-text-tertiary">
      {props.children}
    </div>
  );
}

/** 메뉴 줄(48): 아이콘 타일 28 · 이름 13/500 + 설명 12 tertiary · 끝 칸(수 또는 단축키) */
function PluginMenuRow(props: {
  readonly tab: PluginEndTabDef;
  readonly current: boolean;
  readonly keyLabel: KeyLabel | undefined;
  readonly onPick: () => void;
}): ReactNode {
  const { tab, keyLabel } = props;
  return (
    <TabCount tab={tab}>
      {(count) => (
        <button
          type="button"
          role="menuitem"
          data-current={props.current ? "true" : undefined}
          aria-current={props.current ? "true" : undefined}
          onClick={props.onPick}
          className={`flex h-12 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border-0 px-2 text-start outline-none transition-colors hover:bg-neutral-hover focus-visible:bg-neutral-hover ${props.current ? "bg-neutral-selected" : "bg-transparent"}`}
        >
          <span className="grid size-7 flex-none place-items-center rounded-md bg-neutral-track text-text-secondary [&_svg]:size-icon-sm">
            {tab.icon}
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-ui font-medium text-text-primary">{t(tab.label)}</span>
            <span className="truncate text-ui-sm font-normal text-text-tertiary">
              {t(tab.description)}
            </span>
          </span>
          {count !== undefined && count > 0 ? (
            <span className="flex-none rounded-full bg-neutral-track px-1.5 text-ui-sm tabular-nums text-text-secondary">
              {count}
            </span>
          ) : tab.shortcut !== undefined && keyLabel !== undefined ? (
            <Kbd size="sm" className="flex-none">
              {keyLabel(tab.shortcut)}
            </Kbd>
          ) : null}
        </button>
      )}
    </TabCount>
  );
}

/** well 머리 요약: 탭이 준 부품, 없으면 숫자가 있을 때 숫자. `stored`는 셸이 탭 내용보다 먼저 읽어 둔 스토어 배지다 */
function WellSummary(props: {
  readonly tab: EndTabDef;
  readonly stored: number | undefined;
}): ReactNode {
  const Summary = props.tab.Summary;
  if (Summary !== undefined) return <Summary />;
  const Count = props.tab.Count;
  if (Count === undefined) return countText(props.stored);
  return <Count render={(count) => countText(count ?? props.stored)} />;
}

export function EndPanel(props: {
  readonly registry: ShellRegistry;
  /** 바로 가기 키 글자(사용자가 바꾼 키 포함). 없으면 툴팁과 메뉴에 키를 보이지 않는다 */
  readonly keyLabel?: KeyLabel;
}): ReactNode {
  const area = useShell((s) => s.area);
  const open = useShell((s) => s.endOpen);
  const tabId = useShell((s) => s.places[s.area].endTab);
  const screen = useShell((s) => s.places[s.area].screen);
  const actions = useShellActions();
  const tabs = props.registry.endTabs(area, screen);
  const pluginTabs = props.registry.pluginEndTabs(area, screen);
  const current = currentEndTabOf(tabs, pluginTabs, tabId);
  const currentIsPlugin = current !== undefined && pluginTabs.some((x) => x.id === current.id);
  // 지금 탭의 스토어 배지는 탭 내용을 그리기 전에 읽는다(내용이 스토어를 다시 읽기 시작해도 머리 수가 흔들리지 않는다)
  const currentStored = useBadge(current?.badge);
  const asideRef = useRef<HTMLElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  // 바깥을 누르면 닫는다. 2차 메뉴(포털)는 바깥이 아니다
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target;
      if (!open || !(target instanceof Element)) return;
      if (asideRef.current?.contains(target) === true) return;
      if (target.closest(`[${PLUGIN_MENU_ATTR}]`) !== null) return;
      actions.setEndOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, actions]);
  useEffect(() => {
    if (open) wellRef.current?.focus({ preventScroll: true });
  }, [open]);
  if (current === undefined) return null;
  const label = t(current.label);
  return (
    // DP-135 [결정: 2026-11-12 사용자] 막대는 무대 오른쪽 세로 가운데에 선다. 위는 머리 줄 아래(`--shell-header-h`)부터라 머리 줄은 끝까지 쓰고
    // (창 단추·머리 끝 단추와 만나지 않는다) 막대는 본문 높이의 가운데에 온다. 창 오른쪽 끝에서 12px(end-3): 무대가 끝까지 차므로(DP-68)
    // 그 끝의 스크롤 막대(≤ 11px)와 겹치지 않는다
    <aside
      ref={asideRef}
      aria-label={t("desktop.shell.end.label")}
      data-end-rail=""
      className="pointer-events-none absolute end-3 top-(--shell-header-h) bottom-0 z-20 flex items-center"
    >
      {[...tabs, ...pluginTabs].map((tab) =>
        tab.alwaysMounted === undefined ? null : (
          <Fragment key={tab.id}>{tab.alwaysMounted}</Fragment>
        ),
      )}
      {/* well은 막대 바로 왼쪽(6px)에서 본문 높이(위아래 8px)를 쓴다. 막대 쪽 가운데(origin-right)를 원점으로 0.98에서 나타나고 같은 자리로 사라진다(DP-106) */}
      <Presence
        show={open}
        variant="pop"
        initial={false}
        className="pointer-events-auto absolute inset-y-2 end-[calc(100%+0.375rem)] z-30 flex origin-right"
      >
        <Card
          variant="well"
          size="sm"
          ref={wellRef}
          role="region"
          tabIndex={-1}
          aria-label={label}
          data-end-well={current.id}
          className="flex max-w-[calc(var(--app-vw)-4.5rem)] flex-col shadow-3 outline-none"
          style={{ width: wellWidthOf(current) }}
        >
          {/* DP-193 머리 40: 제목 13/600 · 8 · 요약 12 tertiary(말줄임) · 접기 24. 머리 아래에는 선을 긋지 않는다: 바로 밑 본문 판(CardPanel)이
              제 1px 가장자리와 둥근 모서리로 머리와 본문을 가른다. 머리에 border-b를 더하면 판의 둥근 위 모서리 위로 곧은 선이 하나 더 지나간다
              (lcMk6 [결정: 2026-11-19 사용자 "받은요청 카드디자인의 헤더 하단에 보더가 생겼는데 이거 의도치않은 부분이라 이거 제거해주고"]) */}
          <div data-end-head="" className="flex h-10 flex-none items-center gap-2 ps-3 pe-2">
            <h2 className="m-0 flex min-w-0 flex-1 items-baseline gap-2">
              <span className="flex-none text-ui font-semibold text-text-primary">{label}</span>
              <span
                data-end-summary=""
                className="flex min-w-0 items-center gap-1.5 truncate text-ui-sm font-normal tabular-nums text-text-tertiary"
              >
                <WellSummary tab={current} stored={currentStored} />
              </span>
            </h2>
            <IconButton
              size="xs"
              variant="ghost"
              label={t("desktop.shell.end.collapse")}
              onClick={() => {
                actions.setEndOpen(false);
              }}
            >
              <X />
            </IconButton>
          </div>
          <CardPanel className="flex min-h-0 flex-1 flex-col gap-0 p-0">
            <ScrollArea label={label} className="min-h-0 flex-1">
              <div className="px-3 pt-3 pb-4">{current.render()}</div>
            </ScrollArea>
          </CardPanel>
        </Card>
      </Presence>
      <FloatingBar
        label={t("desktop.shell.end.label")}
        orientation="vertical"
        size="sm"
        shadow="2"
        className="pointer-events-auto"
      >
        {tabs.map((tab) => {
          const active = open && current.id === tab.id;
          return (
            <EndBarItem
              key={tab.id}
              tab={tab}
              active={active}
              keyLabel={props.keyLabel}
              onClick={() => {
                if (active) actions.setEndOpen(false);
                else actions.openEndTab(tab.id);
              }}
            />
          );
        })}
        {pluginTabs.length === 0 ? null : (
          <>
            {tabs.length === 0 ? null : <FloatingBarSeparator />}
            <PluginMenu
              tabs={pluginTabs}
              currentId={open && currentIsPlugin ? current.id : null}
              keyLabel={props.keyLabel}
              onPick={(id) => {
                actions.openEndTab(id);
              }}
            />
          </>
        )}
      </FloatingBar>
    </aside>
  );
}
