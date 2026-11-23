import { t, type MessageId } from "@fresnel/client/i18n";
import { stripUnsafeText } from "@fresnel/client/views/app";
import { Button, Popover, PopoverTitle } from "@caustic/react";
import { ChevronRight, ListChecks } from "@caustic/react/icons";
import { useMemo, useState, type ReactNode } from "react";
import { InfoTip } from "../craft/info-tip.tsx";
import { HEADER_CONTROL_SIZE } from "../shell/screen-header.tsx";
import { useAddonData } from "./addon-data.ts";
import { additionsOf, type AdditionGroup, type AdditionPlace } from "./app-additions-model.ts";
import { useAppMoves } from "./app-moves.ts";
import { usePlaygroundTabs } from "./playground-tab-strip.tsx";

// 플레이그라운드 홈 머리의 "플러그인이 더한 것" 단추(AGE-78, AGE-73 제안 1). 누르면 플러그인이 앱 곳곳에 더한 것을 자리별로 읽기 전용으로 보인다.
// 줄을 누르면 팝오버를 닫고 그 플러그인의 관리(크래프트 상세)로 간다. 끄기나 순서 바꾸기는 여기에 없다.

/** 자리 이름의 글 키. 키를 문자 그대로 적어 카탈로그 검사가 찾게 한다 */
const PLACE_LABEL = {
  tab: "desktop.apps.additions.place.tab",
  panel: "desktop.apps.additions.place.panel",
  status: "desktop.apps.additions.place.status",
  card: "desktop.apps.additions.place.card",
  command: "desktop.apps.additions.place.command",
} as const satisfies Record<AdditionPlace, MessageId>;

function PlaceGroup(props: {
  readonly group: AdditionGroup;
  readonly onManage: (plugin: string) => void;
}): ReactNode {
  const label = t(PLACE_LABEL[props.group.place]);
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1">
      <h3 className="m-0 px-2 text-ui-sm font-normal text-text-tertiary">{label}</h3>
      {props.group.rows.map((row) => (
        <button
          key={row.plugin}
          type="button"
          aria-label={t("desktop.apps.additions.manage", { name: row.title })}
          className="flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-start hover:bg-neutral-hover focus-visible:focus-ring"
          onClick={() => {
            props.onManage(row.plugin);
          }}
        >
          <span className="min-w-0 truncate text-ui text-text-primary">{row.title}</span>
          <span className="min-w-0 flex-1 truncate text-ui text-text-tertiary">
            {row.items.join(", ")}
          </span>
          <ChevronRight aria-hidden className="size-icon-sm flex-none text-text-tertiary" />
        </button>
      ))}
    </div>
  );
}

/** 플러그인이 더한 것을 보이는 단추와 팝오버. 플레이그라운드 홈 머리에 끼운다 */
export function AppAdditionsButton(): ReactNode {
  const [open, setOpen] = useState(false);
  const data = useAddonData(false);
  const { tabs } = usePlaygroundTabs();
  const moves = useAppMoves();
  const pinned = useMemo(() => tabs.map((row) => row.name), [tabs]);
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const [name, info] of data.meta) {
      map.set(name, stripUnsafeText(info.displayName ?? "", false));
    }
    return map;
  }, [data.meta]);
  const groups = useMemo(
    () => additionsOf({ entries: data.source.entries, pinned, titles, locale: data.locale }),
    [data.source.entries, data.locale, pinned, titles],
  );
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      size="lg"
      anchor={
        <Button size={HEADER_CONTROL_SIZE} variant="ghost" iconStart={<ListChecks />}>
          {t("desktop.apps.additions.open")}
        </Button>
      }
    >
      <div className="flex max-h-[calc(var(--app-vh)*0.6)] min-h-0 flex-col gap-2 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="m-0 text-ui text-text-tertiary">{t("desktop.apps.additions.empty")}</p>
        ) : (
          groups.map((group) => (
            <PlaceGroup
              key={group.place}
              group={group}
              onManage={(plugin) => {
                setOpen(false);
                moves.manage(plugin);
              }}
            />
          ))
        )}
        {/* 머리는 목록 뒤에 두고 위로 올려 보인다. 열 때 초점이 정보 아이콘이 아니라 첫 줄에 가서 도움말이 목록을 덮지 않는다 */}
        <div className="order-first flex min-w-0 items-center gap-1">
          <PopoverTitle className="font-medium">{t("desktop.apps.additions.open")}</PopoverTitle>
          <InfoTip text={t("desktop.apps.additions.info")} />
        </div>
      </div>
    </Popover>
  );
}
