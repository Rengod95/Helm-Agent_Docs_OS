import { Badge, Button, IconButton } from "@caustic/react";
import { ArrowDown, ArrowUp } from "@caustic/react/icons";
import { t } from "@fresnel/client/i18n";
import type { ToolsWebView, WebRecommendation, WebToolRow } from "@fresnel/client";
import type { ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { FORM_CONTROL_SIZE, RowNote, SettingSection } from "../settings/settings-section.tsx";
import { ListSkeleton } from "../shared/panel-parts.tsx";
import {
  displayOrderOf,
  pinnedOf,
  providerNameOf,
  providerStateOf,
  type ProviderState,
} from "./tools-web-model.ts";
import { originIdOf, providerStateIdOf, recommendationStateIdOf } from "./tools-web-text.ts";

// 도구와 MCP의 "웹 도구"(P-12, DP-111 [결정: 2026-11-11 사용자]). 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 직접 그린다).
// 검색·브라우저·가져오기가 각각 카드이던 것을 표 하나로 합친다. 열 = 종류(묶음 첫 줄에만) · 제공자(이름 13/500 + 출처 12 tertiary) ·
// 상태(점 + 글, 지금 쓰는 것은 "지금" 배지) · 순서(검색만: 위·아래 ghost 28). 쓸 수 없는 줄은 바로 아래에 까닭과 고치는 법 한 줄.
// 권장 키 플러그인(Exa, Brave)은 표 아래 한 줄: 이름 · 상태, 힌트는 정보 아이콘. 검색 순서만 바꿀 수 있다(브라우저·가져오기는 wire에 설정 없음).

export type WebLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly message: string }
  | { readonly status: "ready"; readonly view: ToolsWebView };

export interface ToolsWebViewProps {
  readonly load: WebLoad;
  /** 연결이 끊겼으면 참. 순서 바꾸기가 잠기고 읽기 전 상태에 안내를 보인다 */
  readonly offline: boolean;
  /** 마지막 순서 저장 실패의 문장. 없으면 null */
  readonly saveError: string | null;
  readonly onMove: (order: readonly string[]) => void;
  readonly onRetry: () => void;
}

const CARD = "rounded-xl bg-surface-base shadow-[inset_0_0_0_1px_var(--cs-color-border-subtle)]";
const COLUMNS = "grid grid-cols-[5.5rem_minmax(0,1fr)_10rem_4rem] items-center gap-x-3";

const DOT: Readonly<Record<ProviderState, string>> = {
  ready: "bg-success-graphic",
  "needs-key": "bg-warning-graphic",
  unavailable: "bg-danger-graphic",
};

export function ToolsWebPanelView(props: ToolsWebViewProps): ReactNode {
  const { load, offline } = props;
  const explanation =
    load.status === "ready" && pinnedOf(load.view.search) !== null
      ? t("desktop.tools.search.pinned", { id: pinnedOf(load.view.search) ?? "" })
      : t("desktop.tools.search.auto");
  return (
    <SettingSection
      title={t("desktop.tools.web.title")}
      end={<InfoTip text={explanation} />}
      body="bare"
    >
      <ToolsWebBody {...props} offline={offline} />
    </SettingSection>
  );
}

function ToolsWebBody(props: ToolsWebViewProps): ReactNode {
  const { load, offline } = props;
  if (load.status === "loading") {
    if (offline) {
      return (
        <div className={`px-4 py-3 ${CARD}`}>
          <p className="m-0 text-ui text-text-tertiary">{t("desktop.tools.offline")}</p>
        </div>
      );
    }
    return (
      <div className={`px-4 py-3 ${CARD}`}>
        <ListSkeleton label={t("desktop.tools.loading")} />
      </div>
    );
  }
  if (load.status === "failed") {
    return (
      <div className={`px-4 py-3 ${CARD}`}>
        <RowNote
          tone="danger"
          actions={
            <Button size={FORM_CONTROL_SIZE} variant="outline" onClick={props.onRetry}>
              {t("desktop.tools.retry")}
            </Button>
          }
        >
          {load.message}
        </RowNote>
      </div>
    );
  }
  const view = load.view;
  const searchOrder = displayOrderOf(view.search);
  const byId = new Map(view.search.rows.map((row) => [row.id, row]));
  const searchRows = searchOrder.flatMap((id) => {
    const row = byId.get(id);
    return row === undefined ? [] : [row];
  });
  const move = (index: number, delta: -1 | 1): void => {
    const target = index + delta;
    if (target < 0 || target >= searchOrder.length) return;
    const next = [...searchOrder];
    const [item] = next.splice(index, 1);
    if (item === undefined) return;
    next.splice(target, 0, item);
    props.onMove(next);
  };
  return (
    <div className="grid gap-2">
      <div
        role="table"
        aria-label={t("desktop.tools.web.title")}
        data-slot="web-tools-table"
        className={`grid min-w-0 overflow-hidden ${CARD} [&>*+*]:border-t [&>*+*]:border-border-subtle`}
      >
        <div role="row" className={`${COLUMNS} h-8 px-4`}>
          <span role="columnheader" className="text-ui-sm font-medium text-text-tertiary">
            {t("desktop.tools.column.kind")}
          </span>
          <span role="columnheader" className="text-ui-sm font-medium text-text-tertiary">
            {t("desktop.tools.column.provider")}
          </span>
          <span role="columnheader" className="text-ui-sm font-medium text-text-tertiary">
            {t("desktop.tools.column.state")}
          </span>
          <span role="columnheader" className="text-end text-ui-sm font-medium text-text-tertiary">
            {t("desktop.tools.column.order")}
          </span>
        </div>
        <Group
          kind={t("desktop.tools.search.title")}
          rows={searchRows}
          emptyText={t("desktop.tools.search.empty")}
          order={{
            editable: !offline,
            onUp: (index) => {
              move(index, -1);
            },
            onDown: (index) => {
              move(index, 1);
            },
          }}
        />
        <Group
          kind={t("desktop.tools.browse.title")}
          rows={view.browse.rows}
          emptyText={t("desktop.tools.browse.empty")}
          order={null}
        />
        <Group
          kind={t("desktop.tools.fetch.title")}
          rows={view.fetch.rows}
          emptyText={t("desktop.tools.fetch.empty")}
          order={null}
        />
      </div>
      {props.saveError === null ? null : <RowNote tone="danger">{props.saveError}</RowNote>}
      <Recommendations items={view.recommendations} />
    </div>
  );
}

/** 종류 하나의 줄들. 종류 글은 첫 줄에만 둔다 */
function Group(props: {
  readonly kind: string;
  readonly rows: readonly WebToolRow[];
  readonly emptyText: string;
  readonly order: {
    readonly editable: boolean;
    readonly onUp: (index: number) => void;
    readonly onDown: (index: number) => void;
  } | null;
}): ReactNode {
  if (props.rows.length === 0) {
    return (
      <div role="row" className={`${COLUMNS} min-h-11 px-4 py-2`}>
        <span role="cell" className="text-ui text-text-secondary">
          {props.kind}
        </span>
        <span role="cell" className="col-span-3 text-ui text-text-tertiary">
          {props.emptyText}
        </span>
      </div>
    );
  }
  return (
    <>
      {props.rows.map((row, index) => (
        <ToolRow
          key={row.id}
          kind={index === 0 ? props.kind : ""}
          row={row}
          index={index}
          last={index === props.rows.length - 1}
          order={props.order}
        />
      ))}
    </>
  );
}

function ToolRow(props: {
  readonly kind: string;
  readonly row: WebToolRow;
  readonly index: number;
  readonly last: boolean;
  readonly order: {
    readonly editable: boolean;
    readonly onUp: (index: number) => void;
    readonly onDown: (index: number) => void;
  } | null;
}): ReactNode {
  const { row, order } = props;
  const state = providerStateOf(row);
  const name = providerNameOf(row);
  return (
    <div
      role="row"
      data-slot="web-tool-row"
      data-state={state}
      className="grid min-w-0 gap-1 px-4 py-2 transition-colors hover:bg-neutral-hover"
    >
      <div className={`${COLUMNS} min-h-7`}>
        <span role="cell" className="text-ui text-text-secondary">
          {props.kind}
        </span>
        <span role="cell" className="flex min-w-0 items-baseline gap-1.5">
          {order === null ? null : (
            <span className="flex-none text-footnote text-text-tertiary tabular-nums">
              {props.index + 1}
            </span>
          )}
          <span className="min-w-0 truncate text-ui font-medium text-text-primary">{name}</span>
          <span className="flex-none text-ui-sm text-text-tertiary">
            {t(originIdOf(row.origin))}
          </span>
        </span>
        <span role="cell" className="flex min-w-0 items-center gap-1.5 text-ui text-text-secondary">
          <span aria-hidden className={`size-2 flex-none rounded-full ${DOT[state]}`} />
          <span className="min-w-0 truncate">{t(providerStateIdOf(state))}</span>
          {row.current ? (
            <Badge size="sm" variant="outline">
              {t("desktop.tools.current")}
            </Badge>
          ) : null}
          {row.noticePending ? (
            <Badge size="sm" variant="outline">
              {t("desktop.tools.notice.pending")}
            </Badge>
          ) : null}
        </span>
        <span role="cell" className="flex justify-end">
          {order === null ? null : (
            <>
              <IconButton
                size={FORM_CONTROL_SIZE}
                variant="ghost"
                label={t("desktop.tools.order.up", { name })}
                disabled={!order.editable || props.index === 0}
                onClick={() => {
                  order.onUp(props.index);
                }}
              >
                <ArrowUp />
              </IconButton>
              <IconButton
                size={FORM_CONTROL_SIZE}
                variant="ghost"
                label={t("desktop.tools.order.down", { name })}
                disabled={!order.editable || props.last}
                onClick={() => {
                  order.onDown(props.index);
                }}
              >
                <ArrowDown />
              </IconButton>
            </>
          )}
        </span>
      </div>
      {state === "ready" && row.price?.stale !== true ? null : (
        <p className="m-0 ms-[6.25rem] text-ui text-text-tertiary">
          {state === "ready" ? null : row.note}
          {row.price?.stale === true ? (
            <span className="ms-1.5">
              {t("desktop.tools.price.staleLine", { date: row.price.asOf })}
            </span>
          ) : null}
        </p>
      )}
    </div>
  );
}

/** 권장 키 플러그인 한 줄. 다 준비됐으면 그리지 않는다 */
function Recommendations(props: { readonly items: readonly WebRecommendation[] }): ReactNode {
  const pending = props.items.filter((item) => item.state !== "ready");
  if (pending.length === 0) return null;
  return (
    <div
      data-slot="web-recommend"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-ui text-text-tertiary"
    >
      <span>{t("desktop.tools.recommend.line")}</span>
      {pending.map((item) => (
        <span key={item.providerId} className="inline-flex items-center gap-2">
          <span className="font-medium text-text-secondary">{item.label}</span>{" "}
          <span>{t(recommendationStateIdOf(item.state))}</span>
          {item.hint === "" ? null : <InfoTip text={item.hint} />}
        </span>
      ))}
    </div>
  );
}
