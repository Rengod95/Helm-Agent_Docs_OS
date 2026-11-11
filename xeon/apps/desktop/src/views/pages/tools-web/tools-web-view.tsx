import { Alert, Badge, Button, EmptyState, List, ListRow, Tooltip } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ToolsWebView, WebRecommendation, WebSection, WebToolRow } from "@fresnel/client";
import type { ReactNode } from "react";
import { TONE_CLASS } from "../settings/settings-text.ts";
import { OrderedList, type OrderedItem } from "../shared/ordered-list.tsx";
import { InfoTip, ListSkeleton, PanelBlock } from "../shared/panel-parts.tsx";
import {
  displayOrderOf,
  pinnedOf,
  providerNameOf,
  providerStateOf,
  type ProviderState,
} from "./tools-web-model.ts";
import { originIdOf, providerStateIdOf, recommendationStateIdOf } from "./tools-web-text.ts";

// 도구와 웹 화면(P-12)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 그림은 목업 `p12-tools-web/app.tsx`를 따른다: 검색(순서 바꾸기), 브라우저, 가져오기, 권장.
// 정상 상태는 글을 두지 않고, 키가 없거나 쓸 수 없는 행만 상태 글을 보인다. 설명은 정보 아이콘 뒤에 둔다.
// 검색 순서만 바꿀 수 있다. 브라우저, 가져오기 순서는 wire에 설정이 없어 읽기만 한다(§4.11, §10 19).

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

export function ToolsWebPanelView(props: ToolsWebViewProps): ReactNode {
  const { load, offline } = props;
  if (load.status === "loading") {
    if (offline) return <EmptyState size="sm" surface="none" title={t("desktop.tools.offline")} />;
    return (
      <div className="grid">
        <PanelBlock title={t("desktop.tools.search.title")}>
          <ListSkeleton label={t("desktop.tools.loading")} />
        </PanelBlock>
        <PanelBlock title={t("desktop.tools.browse.title")}>
          <ListSkeleton label={t("desktop.tools.loading")} />
        </PanelBlock>
        <PanelBlock title={t("desktop.tools.fetch.title")}>
          <ListSkeleton label={t("desktop.tools.loading")} />
        </PanelBlock>
      </div>
    );
  }
  if (load.status === "failed") {
    return (
      <Alert
        tone="danger"
        layout="inline"
        action={
          <Button size="xs" variant="outline" onClick={props.onRetry}>
            {t("desktop.tools.retry")}
          </Button>
        }
      >
        {load.message}
      </Alert>
    );
  }
  const view = load.view;
  return (
    <div className="grid">
      <SearchSection
        section={view.search}
        editable={!offline}
        saveError={props.saveError}
        onMove={props.onMove}
      />
      <ReadOnlySection
        title={t("desktop.tools.browse.title")}
        emptyText={t("desktop.tools.browse.empty")}
        rows={view.browse.rows}
      />
      <ReadOnlySection
        title={t("desktop.tools.fetch.title")}
        emptyText={t("desktop.tools.fetch.empty")}
        rows={view.fetch.rows}
      />
      <RecommendationSection items={view.recommendations} />
    </div>
  );
}

/** 출처 글(목업 행의 설명 줄). 내장, 플러그인, 사용자 설정 */
function OriginText(props: { readonly row: WebToolRow }): ReactNode {
  return (
    <span className="font-mono text-mono-sm text-text-tertiary">
      {t(originIdOf(props.row.origin))}
    </span>
  );
}

const STATE_TEXT_CLASS: Readonly<Record<Exclude<ProviderState, "ready">, string>> = {
  "needs-key": "text-warning-text",
  unavailable: "text-danger-text",
};

/**
 * 행 끝(목업 End): 첫 사용 안내 배지, 상태 글(정상은 비움), 설명 아이콘, 가격 경고, 현재 배지.
 * 가격 경고는 가격표 기준일을 툴팁으로 준다.
 */
function RowEnd(props: { readonly row: WebToolRow }): ReactNode {
  const { row } = props;
  const state = providerStateOf(row);
  return (
    <span className="flex items-center gap-3 text-ui">
      {row.noticePending ? (
        <Badge size="sm" className={TONE_CLASS.info}>
          {t("desktop.tools.notice.pending")}
        </Badge>
      ) : null}
      {state === "ready" ? null : (
        <span className={STATE_TEXT_CLASS[state]}>{t(providerStateIdOf(state))}</span>
      )}
      {state === "ready" ? null : <InfoTip text={row.note} />}
      <span className="w-28 truncate text-end text-text-tertiary">
        {row.price?.stale === true ? (
          <Tooltip content={t("desktop.tools.price.asOf", { date: row.price.asOf })}>
            <span
              tabIndex={0}
              className="rounded-sm text-warning-text outline-none focus-visible:focus-ring"
            >
              {t("desktop.tools.price.stale")}
            </span>
          </Tooltip>
        ) : null}
      </span>
      <span className="w-10 text-end">
        {row.current ? (
          <Badge size="sm" className={TONE_CLASS.neutral}>
            {t("desktop.tools.current")}
          </Badge>
        ) : null}
      </span>
    </span>
  );
}

function SearchSection(props: {
  readonly section: WebSection;
  readonly editable: boolean;
  readonly saveError: string | null;
  readonly onMove: (order: readonly string[]) => void;
}): ReactNode {
  const { section } = props;
  const pinned = pinnedOf(section);
  const byId = new Map(section.rows.map((row) => [row.id, row]));
  const items: OrderedItem[] = displayOrderOf(section).flatMap((id) => {
    const row = byId.get(id);
    if (row === undefined) return [];
    const detail = <OriginText row={row} />;
    const end = <RowEnd row={row} />;
    return [{ id, title: providerNameOf(row), detail, end }];
  });
  const explanation =
    pinned === null
      ? t("desktop.tools.search.auto")
      : t("desktop.tools.search.pinned", { id: pinned });
  return (
    <PanelBlock title={t("desktop.tools.search.title")} end={<InfoTip text={explanation} />}>
      {items.length === 0 ? (
        <p className="m-0 py-0.5 text-ui text-text-secondary">{t("desktop.tools.search.empty")}</p>
      ) : (
        <OrderedList
          label={t("desktop.tools.order.label")}
          items={items}
          editable={props.editable}
          numbered
          onMove={props.onMove}
        />
      )}
      {props.saveError === null ? null : (
        <p role="alert" className="m-0 text-ui text-danger-text">
          {props.saveError}
        </p>
      )}
    </PanelBlock>
  );
}

/** 브라우저와 가져오기 묶음: 순서 바꾸기가 없는 읽기 목록이다 */
function ReadOnlySection(props: {
  readonly title: string;
  readonly emptyText: string;
  readonly rows: readonly WebToolRow[];
}): ReactNode {
  return (
    <PanelBlock title={props.title}>
      {props.rows.length === 0 ? (
        <p className="m-0 py-0.5 text-ui text-text-secondary">{props.emptyText}</p>
      ) : (
        <List aria-label={props.title} size="xs" variant="ghost">
          {props.rows.map((row) => (
            <ListRow
              key={row.id}
              title={providerNameOf(row)}
              description={<OriginText row={row} />}
              end={<RowEnd row={row} />}
            />
          ))}
        </List>
      )}
    </PanelBlock>
  );
}

const RECOMMEND_TEXT_CLASS: Readonly<Record<WebRecommendation["state"], string>> = {
  "not-installed": "text-text-tertiary",
  "needs-key": "text-warning-text",
  ready: "text-text-secondary",
  unavailable: "text-danger-text",
};

/** 권장 한 줄의 끝: 상태 글(정상은 비움)과 설명 아이콘 */
function RecommendEnd(props: { readonly item: WebRecommendation }): ReactNode {
  const { item } = props;
  return (
    <span className="flex items-center gap-3 text-ui">
      {item.state === "ready" ? null : (
        <span className={RECOMMEND_TEXT_CLASS[item.state]}>
          {t(recommendationStateIdOf(item.state))}
        </span>
      )}
      {item.state === "ready" || item.hint === "" ? null : <InfoTip text={item.hint} />}
    </span>
  );
}

function RecommendationSection(props: { readonly items: readonly WebRecommendation[] }): ReactNode {
  return (
    <PanelBlock title={t("desktop.tools.recommend.title")}>
      <List aria-label={t("desktop.tools.recommend.title")} size="xs" variant="ghost">
        {props.items.map((item) => (
          <ListRow key={item.providerId} title={item.label} end={<RecommendEnd item={item} />} />
        ))}
      </List>
    </PanelBlock>
  );
}
