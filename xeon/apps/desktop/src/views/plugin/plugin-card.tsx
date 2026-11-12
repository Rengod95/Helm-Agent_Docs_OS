import { t, type MessageId } from "@fresnel/client/i18n";
import type { ExtTrust } from "@fresnel/contracts/wire";
import { Switch, Tooltip } from "@caustic/react";
import type { ReactNode } from "react";
import type { AddonRow } from "./addon-model.ts";
import { PinIcon, PluginGlyph } from "./plugin-glyph.tsx";

// 플레이그라운드 목록 카드(DP-91, 시안 dzP-design.md 2절). 아이콘 타일 36 · 이름 14/600 + 버전 · 오른쪽 위 전역 스위치,
// 한 줄 설명(두 줄까지), 바닥 메타(화면·기능 수 또는 "화면 없음", 출처, 상태 점, 고정 표지). 카드 전체가 상세로 가는 단추이고
// 스위치는 따로 눌린다(카드 단추 안에 넣지 않고 겹쳐 둔다). hover는 면 색만 바꾼다(떠오름·그림자 없음).

export const ORIGIN_TEXT: Readonly<Record<ExtTrust, MessageId>> = {
  builtin: "desktop.addons.trust.builtin.title",
  managed: "desktop.addons.trust.managed.title",
  user: "desktop.addons.trust.user.title",
  project: "desktop.addons.trust.project.title",
};

function countsTextOf(row: AddonRow): string {
  const parts: string[] = [];
  if (row.screens > 0) parts.push(t("desktop.addons.count.screens", { count: row.screens }));
  if (row.features > 0) parts.push(t("desktop.addons.count.features", { count: row.features }));
  return parts.length === 0 ? t("desktop.addons.card.noScreens") : parts.join(" · ");
}

/** 상태 점과 글: 오류 > 확인 필요 > 꺼짐. 없으면 null */
function RowStatus(props: { readonly row: AddonRow }): ReactNode {
  const { row } = props;
  const tone =
    row.attention === "danger"
      ? "bg-danger-solid"
      : row.attention === "warning"
        ? "bg-warning-solid"
        : row.off
          ? "bg-text-tertiary"
          : null;
  if (tone === null) return null;
  const text =
    row.attention === "danger"
      ? row.errorCount > 0
        ? t("desktop.addons.card.errors", { count: row.errorCount })
        : t("desktop.playgroundTabs.attention.danger")
      : row.attention === "warning"
        ? t("desktop.addons.badge.attention")
        : t("desktop.addons.badge.off");
  return (
    <span className="inline-flex flex-none items-center gap-1.5 text-ui-sm font-normal text-text-secondary">
      <span aria-hidden className={`size-1.5 rounded-full ${tone}`} />
      {text}
    </span>
  );
}

export function PluginCard(props: {
  readonly row: AddonRow;
  readonly pinned: boolean;
  /** 켜짐 스위치. 그룹 구성원처럼 여기서 바꿀 수 없으면 undefined */
  readonly toggle?:
    | {
        readonly on: boolean;
        readonly busy: boolean;
        readonly onChange: (target: boolean) => void;
      }
    | undefined;
  readonly onOpen: () => void;
}): ReactNode {
  const { row } = props;
  return (
    <li className="relative">
      <button
        type="button"
        data-slot="plugin-card"
        data-plugin={row.name}
        onClick={props.onOpen}
        className="grid h-full min-h-33 w-full grid-rows-[auto_1fr_auto] gap-3 rounded-xl bg-surface-base p-4 text-start shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)] outline-none transition-colors hover:bg-neutral-hover focus-visible:focus-ring"
      >
        <span className="flex min-w-0 items-center gap-3 pe-12">
          <PluginGlyph icon={row.icon} monogram={row.monogram} size="card" off={row.off} />
          <span className="grid min-w-0">
            <span
              className={`truncate text-ui-md font-semibold ${row.off ? "text-text-secondary" : "text-text-primary"}`}
            >
              {row.title}
            </span>
            <span className="truncate text-ui-sm font-normal text-text-tertiary">
              {row.version === "" ? row.name : `${row.name} · v${row.version}`}
            </span>
          </span>
        </span>
        <span className="line-clamp-2 text-ui text-text-secondary">
          {row.summary ?? t("desktop.addons.card.noSummary")}
        </span>
        <span className="flex min-w-0 items-center gap-2 text-ui-sm font-normal text-text-tertiary">
          <span className="min-w-0 truncate">
            {countsTextOf(row)}
            <span aria-hidden> · </span>
            {t(ORIGIN_TEXT[row.trust])}
          </span>
          <span className="ms-auto flex flex-none items-center gap-2">
            <RowStatus row={row} />
            {props.pinned ? (
              <Tooltip content={t("desktop.addons.card.pinned")} side="top">
                <span className="inline-flex" tabIndex={-1}>
                  <PinIcon aria-label={t("desktop.addons.card.pinned")} className="size-3.5" />
                </span>
              </Tooltip>
            ) : null}
          </span>
        </span>
      </button>
      {props.toggle === undefined ? null : (
        <span className="absolute end-4 top-4 inline-flex h-9 items-center">
          <Switch
            size="sm"
            checked={props.toggle.on}
            disabled={props.toggle.busy}
            aria-label={t("desktop.addons.toggle", { name: row.title })}
            onCheckedChange={props.toggle.onChange}
          />
        </span>
      )}
    </li>
  );
}
