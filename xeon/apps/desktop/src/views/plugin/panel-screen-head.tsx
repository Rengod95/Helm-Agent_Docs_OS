import { t } from "@fresnel/client/i18n";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { Badge, Button, IconButton, Menu, MenuItem, Tooltip } from "@caustic/react";
import { ChevronDown, MessageSquare } from "@caustic/react/icons";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  duplicateTitlesOf,
  hiddenTabsOf,
  screenTitleOf,
  visibleTabsOf,
} from "./panel-screen-tabs.ts";
import { screenKeyOf } from "./plugin-view.tsx";

// 좁은 옆 패널(플러그인 앱과 알림, Helm 패널)의 화면 머리 한 줄(AGE-73 railFix).
// [화면 탭 줄(남는 폭을 다 씀, 넘치면 "다른 화면" 메뉴)] [시험 중] [버전(폭이 될 때만)] [대화로]
// 창 머리의 고정 탭 줄(DP-90)은 창 머리에만 서고 이 줄에는 없다. 버전은 패널이 26rem 이상일 때만 보이고(정보는 플러그인 상세에 있다),
// "대화로"는 그보다 좁으면 아이콘 단추(툴팁과 접근 이름 "대화로")다. 겹침과 반쯤 잘린 글자가 없게, 탭 글은 탭 최대 폭에서 말줄임이다.

/** 탭 하나의 겉모습. 지금 탭은 창 머리 고정 탭의 지금 표시와 같은 면이다(`playground-tab-strip.tsx`의 TAB) */
const TAB =
  "inline-flex h-control-sm max-w-40 items-center gap-1.5 rounded-lg px-2 text-ui font-medium text-text-secondary outline-none transition-control hover:bg-neutral-hover hover:text-text-primary focus-visible:shadow-focus aria-pressed:bg-control-raised aria-pressed:text-text-primary aria-pressed:shadow-[inset_0_0_0_1px_var(--cs-color-control-edge)]";

/** 탭 사이 간격(px): `gap-0.5` */
const TAB_GAP = 2;
/** "다른 화면" 단추 자리(px): IconButton sm 28 + 앞 간격 `gap-0.5` */
const MORE_WIDTH = 30;

function TabLabel(props: { readonly entry: ExtUiEntry; readonly duplicated: boolean }): ReactNode {
  return (
    <>
      <span className="min-w-0 truncate">{screenTitleOf(props.entry)}</span>
      {props.duplicated ? (
        <span className="min-w-0 truncate font-normal text-text-tertiary">
          {props.entry.extension}
        </span>
      ) : null}
    </>
  );
}

/** 탭 줄. 화면이 하나면 탭이 아니라 이름 한 줄이다 */
function ScreenTabs(props: {
  readonly entries: readonly ExtUiEntry[];
  readonly current: ExtUiEntry;
  readonly onSelect: (key: string) => void;
}): ReactNode {
  const { entries, current } = props;
  const regionRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  // 잰 값은 어느 화면 목록을 잰 것인지(`keys`)와 함께 둔다. 목록이 바뀐 뒤 다시 재기 전의 낡은 값은 쓰지 않는다
  const [fit, setFit] = useState<{
    readonly keys: string;
    readonly available: number;
    readonly widths: readonly number[];
  } | null>(null);
  const keys = entries.map(screenKeyOf).join("\n");
  // 칠하기 전에 잰다: 넘친 탭이 한 장면이라도 겹쳐 보이지 않게. 폭은 offsetWidth·clientWidth(CSS px)라 앱 확대와 상관없다(DP-173)
  useLayoutEffect(() => {
    const region = regionRef.current;
    const measure = measureRef.current;
    if (region === null || measure === null) return undefined;
    const read = (): void => {
      const widths = [...measure.children].map((child) =>
        child instanceof HTMLElement ? child.offsetWidth : 0,
      );
      setFit({ keys, available: region.clientWidth, widths });
    };
    read();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(region);
    observer.observe(measure);
    return () => {
      observer.disconnect();
    };
  }, [keys]);
  const duplicated = duplicateTitlesOf(entries);
  if (entries.length < 2) {
    return (
      <h2 className="m-0 min-w-0 flex-1 truncate ps-2 text-ui font-medium text-text-primary">
        {screenTitleOf(current)}
      </h2>
    );
  }
  const selected = entries.findIndex((entry) => screenKeyOf(entry) === screenKeyOf(current));
  const visible =
    fit === null || fit.keys !== keys
      ? entries.map((_, index) => index)
      : visibleTabsOf({
          widths: fit.widths,
          available: fit.available,
          gap: TAB_GAP,
          more: MORE_WIDTH,
          selected,
        });
  const hidden = hiddenTabsOf(entries.length, visible);
  const moreLabel = t("desktop.plugin.panel.more", { count: hidden.length });
  return (
    <div
      ref={regionRef}
      role="group"
      aria-label={t("desktop.plugin.panel.screens")}
      className="relative flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
    >
      {visible.map((index) => {
        const entry = entries[index];
        if (entry === undefined) return null;
        const key = screenKeyOf(entry);
        return (
          <button
            key={key}
            type="button"
            // 이름 붙은 부품이라 옛 전역 단추 면(`button:not([data-slot])`)을 받지 않는다
            data-slot="panel-screen-tab"
            className={`${TAB} min-w-0 shrink`}
            aria-pressed={index === selected}
            title={
              duplicated.has(screenTitleOf(entry))
                ? `${screenTitleOf(entry)} ${entry.extension}`
                : screenTitleOf(entry)
            }
            onClick={() => {
              props.onSelect(key);
            }}
          >
            <TabLabel entry={entry} duplicated={duplicated.has(screenTitleOf(entry))} />
          </button>
        );
      })}
      {hidden.length === 0 ? null : (
        <Menu
          size="sm"
          align="end"
          aria-label={moreLabel}
          trigger={
            <IconButton size="sm" variant="ghost" label={moreLabel} className="flex-none">
              <ChevronDown />
            </IconButton>
          }
        >
          {hidden.map((index) => {
            const entry = entries[index];
            if (entry === undefined) return null;
            const key = screenKeyOf(entry);
            return (
              <MenuItem
                key={key}
                onSelect={() => {
                  props.onSelect(key);
                }}
              >
                {duplicated.has(screenTitleOf(entry))
                  ? `${screenTitleOf(entry)} ${entry.extension}`
                  : screenTitleOf(entry)}
              </MenuItem>
            );
          })}
        </Menu>
      )}
      {/* 재기 줄: 탭마다 말줄임 없는 폭(최대 폭으로 잘린 값)을 잰다. 보이지 않고 낭독기에도 없다 */}
      <div
        ref={measureRef}
        aria-hidden
        className="pointer-events-none invisible absolute start-0 top-0 flex gap-0.5"
      >
        {entries.map((entry) => (
          <span key={screenKeyOf(entry)} className={`${TAB} flex-none`}>
            <TabLabel entry={entry} duplicated={duplicated.has(screenTitleOf(entry))} />
          </span>
        ))}
      </div>
    </div>
  );
}

export function PanelScreenHead(props: {
  readonly entries: readonly ExtUiEntry[];
  readonly current: ExtUiEntry;
  readonly onSelect: (key: string) => void;
  readonly onBackToChat: () => void;
}): ReactNode {
  const back = t("desktop.plugin.header.backToChat");
  return (
    <div className="@container flex-none border-b border-border-subtle">
      <div className="flex items-center gap-2 py-2 ps-1 pe-3">
        <ScreenTabs entries={props.entries} current={props.current} onSelect={props.onSelect} />
        {props.current.draft === true ? (
          <Badge size="sm" className="flex-none">
            {t("desktop.plugin.state.trial")}
          </Badge>
        ) : null}
        <span className="hidden flex-none text-ui text-text-tertiary tabular-nums @min-[26rem]:inline">
          {`v${props.current.version}`}
        </span>
        <Button
          size="sm"
          variant="outline"
          iconStart={<MessageSquare aria-hidden />}
          className="hidden flex-none @min-[26rem]:inline-flex"
          onClick={props.onBackToChat}
        >
          {back}
        </Button>
        <Tooltip side="bottom" align="end" content={back}>
          <IconButton
            size="sm"
            variant="outline"
            label={back}
            className="flex-none @min-[26rem]:hidden"
            onClick={props.onBackToChat}
          >
            <MessageSquare />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}
