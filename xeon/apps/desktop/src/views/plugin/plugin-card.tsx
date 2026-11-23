import { t, type MessageId } from "@fresnel/client/i18n";
import type { ExtTrust } from "@fresnel/contracts/wire";
import { IconButton, Menu, MenuItem, Tooltip } from "@caustic/react";
import { Ellipsis, MessageSquare, Plus, Settings } from "@caustic/react/icons";
import { useState, type ReactNode } from "react";
import { DotOrb } from "../effects/dot-orb.tsx";
import type { AddonRow } from "./addon-model.ts";
import { PinIcon, PluginGlyph } from "./plugin-glyph.tsx";

// 앱 타일(AGE-78, 플레이그라운드 홈 격자). 타일 하나가 플러그인 하나다. 타일 전체가 단추라 누르면 앱 작업 공간으로 간다.
// 글리프, 이름, 설명 두 줄만 보인다. 주의나 꺼짐이면 글리프 줄 끝에 구슬 하나가 뜨고, 고정이면 핀 표지가 그 앞에 선다.
// 오른쪽 위 "⋯" 메뉴(누르기나 타일 오른쪽 누르기)는 고정, 고치기, 관리로 간다. 만들기 타일은 격자 끝에 한 장 놓인다.

export const ORIGIN_TEXT: Readonly<Record<ExtTrust, MessageId>> = {
  builtin: "desktop.addons.trust.builtin.title",
  managed: "desktop.addons.trust.managed.title",
  user: "desktop.addons.trust.user.title",
  project: "desktop.addons.trust.project.title",
};

/** 구슬과 낭독 글: 오류 > 확인 필요 > 꺼짐. 정상이면 undefined(구슬을 그리지 않는다) */
function statusOf(row: AddonRow): MessageId | undefined {
  if (row.attention === "danger") return "desktop.playgroundTabs.attention.danger";
  if (row.attention === "warning") return "desktop.apps.status.problem";
  if (row.off) return "desktop.addons.badge.off";
  return undefined;
}

export function AppTile(props: {
  readonly row: AddonRow;
  readonly pinned: boolean;
  readonly onOpen: () => void;
  readonly onPin: (pinned: boolean) => void;
  readonly onFix: () => void;
  readonly onManage: () => void;
}): ReactNode {
  const { row } = props;
  const [menu, setMenu] = useState(false);
  const status = statusOf(row);
  const menuLabel = t("desktop.apps.tile.menu", { name: row.title });
  return (
    <li className="relative">
      <button
        type="button"
        data-slot="app-tile"
        data-plugin={row.name}
        onClick={props.onOpen}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenu(true);
        }}
        className="grid h-full min-h-33 w-full content-start gap-3 rounded-xl bg-surface-base p-4 text-start shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] outline-none transition-colors hover:bg-neutral-hover focus-visible:focus-ring"
      >
        <span className="flex min-w-0 items-center gap-3 pe-8">
          <PluginGlyph icon={row.icon} monogram={row.monogram} size="card" off={row.off} />
          {props.pinned || status !== undefined ? (
            <span className="ms-auto flex flex-none items-center gap-2">
              {props.pinned ? (
                <PinIcon
                  aria-label={t("desktop.addons.card.pinned")}
                  className="size-3.5 text-text-tertiary"
                />
              ) : null}
              {status === undefined ? null : (
                <Tooltip content={t(status)} side="top">
                  <span className="inline-flex items-center">
                    <span
                      aria-hidden
                      className="inline-flex size-icon-sm items-center justify-center"
                    >
                      <DotOrb state="listening" tone="warm" size={12} kind="mark" live={false} />
                    </span>
                    <span className="sr-only">{t(status)}</span>
                  </span>
                </Tooltip>
              )}
            </span>
          ) : null}
        </span>
        <span
          className={`truncate text-ui-md font-semibold ${row.off ? "text-text-secondary" : "text-text-primary"}`}
        >
          {row.title}
        </span>
        <span className="line-clamp-2 text-ui text-text-secondary">
          {row.summary ?? t("desktop.addons.card.noSummary")}
        </span>
      </button>
      {/* 메뉴는 단추 밖 형제다. 메뉴 항목을 눌러도 타일을 여는 누르기로 번지지 않는다 */}
      <div className="absolute top-4 end-3 flex h-9 items-center">
        <Menu
          size="sm"
          align="end"
          open={menu}
          onOpenChange={setMenu}
          aria-label={menuLabel}
          trigger={
            <IconButton size="xs" variant="ghost" label={menuLabel}>
              <Ellipsis aria-hidden />
            </IconButton>
          }
        >
          <AppTileMenuItems
            builtin={row.builtin}
            pinned={props.pinned}
            onPin={props.onPin}
            onFix={props.onFix}
            onManage={props.onManage}
          />
        </Menu>
      </div>
    </li>
  );
}

/** 타일 메뉴의 항목: 고정 토글, 고치기(내장이면 없다), 관리 */
export function AppTileMenuItems(props: {
  readonly builtin: boolean;
  readonly pinned: boolean;
  readonly onPin: (pinned: boolean) => void;
  readonly onFix: () => void;
  readonly onManage: () => void;
}): ReactNode {
  return (
    <>
      <MenuItem
        icon={<PinIcon aria-hidden />}
        onSelect={() => {
          props.onPin(!props.pinned);
        }}
      >
        {t(props.pinned ? "desktop.apps.menu.unpin" : "desktop.apps.menu.pin")}
      </MenuItem>
      {props.builtin ? null : (
        <MenuItem
          icon={<MessageSquare aria-hidden />}
          onSelect={() => {
            props.onFix();
          }}
        >
          {t("desktop.apps.menu.fix")}
        </MenuItem>
      )}
      <MenuItem
        icon={<Settings aria-hidden />}
        onSelect={() => {
          props.onManage();
        }}
      >
        {t("desktop.apps.menu.manage")}
      </MenuItem>
    </>
  );
}

/** 격자 끝의 만들기 타일: 타일과 같은 크기, 점선 테두리, 플러그인 빌더로 간다 */
export function CreateAppTile(props: { readonly onCreate: () => void }): ReactNode {
  return (
    <li>
      <button
        type="button"
        data-slot="app-create"
        onClick={props.onCreate}
        className="grid h-full min-h-33 w-full content-start gap-3 rounded-xl border border-dashed border-border-default bg-transparent p-4 text-start outline-none transition-colors hover:bg-neutral-hover focus-visible:focus-ring"
      >
        <span className="grid size-9 flex-none place-items-center rounded-lg border border-border-subtle text-text-secondary">
          <Plus aria-hidden className="size-4" />
        </span>
        <span className="grid gap-1">
          <span className="text-ui-md font-semibold text-text-primary">
            {t("desktop.apps.create.title")}
          </span>
          <span className="text-ui text-text-secondary">{t("desktop.apps.create.body")}</span>
        </span>
      </button>
    </li>
  );
}
