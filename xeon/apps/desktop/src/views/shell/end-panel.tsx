// 오른쪽 떠 있는 막대 + 펼친 well(S-01 끝 영역, DP-10). 탭 내용은 `registry.endTabs(area)`가 준다.
// 영역마다 마지막 탭을 기억한다(`AreaPlace.endTab`). 막대 칸은 6개까지 보이고 나머지는 "더 보기" 메뉴다.
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
import { useEffect, useRef, type ReactNode } from "react";
import type { EndTabDef, ShellRegistry } from "./registry.ts";
import { useShell, useShellActions } from "../../state/shell/index.ts";
import { WELL_DEFAULT_WIDTH } from "./toaster-slot.ts";

const MAX_BAR_TABS = 6;
const WELL_MIN_WIDTH = 320;
const WELL_MAX_WIDTH = 480;

/** 지금 탭의 well 폭(px). 선언 폭을 320~480으로 자른다 */
export function wellWidthOf(tab: EndTabDef | undefined): number {
  const w = tab?.width ?? WELL_DEFAULT_WIDTH;
  return Math.min(WELL_MAX_WIDTH, Math.max(WELL_MIN_WIDTH, w));
}

export function EndPanel(props: { readonly registry: ShellRegistry }): ReactNode {
  const area = useShell((s) => s.area);
  const open = useShell((s) => s.endOpen);
  const tabId = useShell((s) => s.places[s.area].endTab);
  const actions = useShellActions();
  const tabs = props.registry.endTabs(area);
  const current = tabs.find((x) => x.id === tabId) ?? tabs[0];
  const barTabs = tabs.slice(0, MAX_BAR_TABS);
  const overflow = tabs.slice(MAX_BAR_TABS);
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
  const label = t(current.label);
  return (
    <aside
      ref={asideRef}
      aria-label={t("desktop.shell.end.label")}
      className="pointer-events-none absolute end-1.5 top-1.5 bottom-0 z-20 flex items-start gap-1.5"
    >
      {open ? (
        <Card
          variant="well"
          size="sm"
          ref={wellRef}
          role="region"
          tabIndex={-1}
          aria-label={label}
          className="pointer-events-auto absolute inset-y-0 end-[calc(100%+0.375rem)] z-30 flex max-w-[calc(100vw-4.5rem)] flex-col shadow-3 outline-none"
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
          const badge = tab.badge?.();
          const active = open && current.id === tab.id;
          return (
            <FloatingBarItem
              key={tab.id}
              icon={tab.icon}
              aria-label={
                badge === undefined || badge <= 0 ? t(tab.label) : `${t(tab.label)} ${badge}`
              }
              aria-expanded={active}
              active={active}
              {...(badge !== undefined && badge > 0 && !active ? { badge } : {})}
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
