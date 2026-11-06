// 오른쪽 떠 있는 막대 + 펼친 well(S-01 끝 영역, DP-10). 탭 내용은 `registry.endTabs(area)`가 준다.
// 영역마다 마지막 탭을 기억한다(`AreaPlace.endTab`). 막대 칸은 6개까지 보이고 나머지는 "더 보기" 메뉴다.
// 칸의 숫자(`badge`)는 값이 바뀌면 칸이 다시 그리고, 펼친 well 머리와 칸의 이름표에는 같은 글("플러그인 2")이 든다.
import { t } from "@fresnel/client/i18n";
import {
  Card,
  CardPanel,
  FloatingBar,
  FloatingBarItem,
  IconButton,
  Menu,
  MenuItem,
  ScrollArea,
} from "@caustic/react";
import { Ellipsis, X } from "@caustic/react/icons";
import { Fragment, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { EndTabDef, ShellRegistry, TabBadge } from "./registry.ts";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import { WELL_DEFAULT_WIDTH } from "./toaster-slot.ts";

const MAX_BAR_TABS = 6;
const WELL_MIN_WIDTH = 320;
const WELL_MAX_WIDTH = 480;

const NO_BADGE: TabBadge = { read: () => undefined, subscribe: () => () => undefined };

/** 칸의 숫자를 읽는다. 배지 값이 바뀌면 그리는 쪽이 다시 그린다. 서버 그리기에서도 같은 값을 준다 */
function useBadge(badge: TabBadge | undefined): number | undefined {
  const source = badge ?? NO_BADGE;
  return useSyncExternalStore(source.subscribe, source.read, source.read);
}

/** 칸과 well 머리의 글: 알림 수가 있으면 이름 뒤에 숫자를 붙인다("플러그인 2") */
export function tabTitleOf(label: string, badge: number | undefined): string {
  return badge === undefined || badge <= 0 ? label : `${label} ${badge}`;
}

/** 지금 탭의 well 폭(px). 선언 폭을 320~480으로 자른다 */
export function wellWidthOf(tab: EndTabDef | undefined): number {
  const w = tab?.width ?? WELL_DEFAULT_WIDTH;
  return Math.min(WELL_MAX_WIDTH, Math.max(WELL_MIN_WIDTH, w));
}

/** 막대의 한 칸. 숫자는 탭이 닫혀 있을 때만 칸 모서리에 보인다(열린 탭은 well 머리에 같은 숫자를 쓴다) */
function EndBarItem(props: {
  readonly tab: EndTabDef;
  readonly active: boolean;
  readonly onClick: () => void;
}): ReactNode {
  const badge = useBadge(props.tab.badge);
  return (
    <FloatingBarItem
      icon={props.tab.icon}
      aria-label={tabTitleOf(t(props.tab.label), badge)}
      aria-expanded={props.active}
      active={props.active}
      badge={badge !== undefined && badge > 0 && !props.active ? badge : undefined}
      onClick={props.onClick}
    />
  );
}

export function EndPanel(props: { readonly registry: ShellRegistry }): ReactNode {
  const area = useShell((s) => s.area);
  const open = useShell((s) => s.endOpen);
  const tabId = useShell((s) => s.places[s.area].endTab);
  const screen = useShell((s) => s.places[s.area].screen);
  const actions = useShellActions();
  const tabs = props.registry.endTabs(area, screen);
  const current = tabs.find((x) => x.id === tabId) ?? tabs[0];
  const barTabs = tabs.slice(0, MAX_BAR_TABS);
  const overflow = tabs.slice(MAX_BAR_TABS);
  const currentBadge = useBadge(current?.badge);
  const asideRef = useRef<HTMLElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  // 바깥을 누르면 닫는다
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target;
      if (open && target instanceof Node && asideRef.current?.contains(target) !== true) {
        actions.setEndOpen(false);
      }
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
  const label = tabTitleOf(t(current.label), currentBadge);
  return (
    <aside
      ref={asideRef}
      aria-label={t("desktop.shell.end.label")}
      className="pointer-events-none absolute end-1.5 top-1.5 bottom-0 z-20 flex items-start gap-1.5"
    >
      {tabs.map((tab) =>
        tab.alwaysMounted === undefined ? null : (
          <Fragment key={tab.id}>{tab.alwaysMounted}</Fragment>
        ),
      )}
      {open ? (
        <Card
          variant="well"
          size="sm"
          ref={wellRef}
          role="region"
          tabIndex={-1}
          aria-label={label}
          // 아이콘 쪽(위 오른쪽)에서 펼쳐지는 느낌: 그 모서리를 원점으로 커지며 나타난다(시안 right-panel)
          className="pointer-events-auto absolute inset-y-0 end-[calc(100%+0.375rem)] z-30 flex max-w-[calc(100vw-4.5rem)] origin-top-right animate-enter flex-col shadow-3 outline-none enter-scale"
          style={{ width: wellWidthOf(current) }}
        >
          <div className="flex h-8 flex-none items-center gap-1.5 ps-2.5 pe-0.5">
            <h2 className="m-0 min-w-0 flex-1 truncate text-ui-sm font-semibold text-text-primary">
              {label}
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
              <div className="p-3">{current.render()}</div>
            </ScrollArea>
          </CardPanel>
        </Card>
      ) : null}
      <FloatingBar
        label={t("desktop.shell.end.label")}
        orientation="vertical"
        size="sm"
        shadow="2"
        className="pointer-events-auto"
      >
        {barTabs.map((tab) => {
          const active = open && current.id === tab.id;
          return (
            <EndBarItem
              key={tab.id}
              tab={tab}
              active={active}
              onClick={() => {
                if (active) actions.setEndOpen(false);
                else actions.openEndTab(tab.id);
              }}
            />
          );
        })}
        {overflow.length > 0 ? (
          <Menu
            side="bottom"
            align="end"
            aria-label={t("desktop.shell.end.more")}
            trigger={
              <FloatingBarItem
                icon={<Ellipsis />}
                aria-label={t("desktop.shell.end.more")}
                active={open && overflow.some((x) => x.id === current.id)}
              />
            }
          >
            {overflow.map((tab) => (
              <MenuItem
                key={tab.id}
                icon={tab.icon}
                selected={open && current.id === tab.id}
                onSelect={() => {
                  actions.openEndTab(tab.id);
                }}
              >
                {t(tab.label)}
              </MenuItem>
            ))}
          </Menu>
        ) : null}
      </FloatingBar>
    </aside>
  );
}
