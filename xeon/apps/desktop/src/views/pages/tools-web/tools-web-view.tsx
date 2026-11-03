import { Alert, Badge, Button, FormLayoutSection, List, ListRow, Skeleton } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import type { ToolsWebView, WebRecommendation, WebSection, WebToolRow } from "@fresnel/client";
import type { ReactNode } from "react";
import { TONE_CLASS } from "../settings/settings-text.ts";
import { OrderedList, type OrderedItem } from "../shared/ordered-list.tsx";
import {
  displayOrderOf,
  pinnedOf,
  providerStateOf,
  type ProviderState,
} from "./tools-web-model.ts";
import { providerStateIdOf, recommendationStateIdOf } from "./tools-web-text.ts";

// 도구와 웹 화면(P-12)의 그림. 상태와 명령은 없고 props만 받는다(서버 렌더 시험이 이 부품을 직접 그린다).
// 검색 순서만 바꿀 수 있다. 브라우저 순서와 가져오기 순서는 wire에 설정이 없어 읽기만 한다(§4.11, §10 19).

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
    if (offline) return <Alert tone="info">{t("desktop.tools.offline")}</Alert>;
    return (
      <div className="flex flex-col gap-2">
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.tools.loading")}
        </p>
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }
  if (load.status === "failed") {
    return (
      <Alert
        tone="danger"
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
    <div className="flex flex-col gap-4">
      <SearchSection
        section={view.search}
        editable={!offline}
        saveError={props.saveError}
        onMove={props.onMove}
      />
      <BrowseSection section={view.browse} />
      <RecommendationSection items={view.recommendations} />
      {view.noticesPending.length === 0 ? null : (
        <p className="text-ui-sm text-text-tertiary">
          {t("desktop.tools.notices", { count: view.noticesPending.length })}
        </p>
      )}
    </div>
  );
}

/** 행 하나의 글 조각: 상태, 현재, 고정, 고지, 가격 오래됨. 색과 글을 함께 쓴다 */
function RowDetail(props: { readonly row: WebToolRow }): ReactNode {
  const { row } = props;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {row.current ? (
        <Badge className={TONE_CLASS.accent}>{t("desktop.tools.current")}</Badge>
      ) : null}
      {row.pinned ? (
        <Badge className={TONE_CLASS.info}>{t("desktop.tools.pinned.badge")}</Badge>
      ) : null}
      {row.noticePending ? (
        <Badge className={TONE_CLASS.warning}>{t("desktop.tools.notice.pending")}</Badge>
      ) : null}
      {row.price?.stale === true ? (
        <Badge className={TONE_CLASS.warning}>{t("desktop.tools.price.stale")}</Badge>
      ) : null}
      <span className="text-ui-sm text-text-secondary">{row.note}</span>
    </span>
  );
}

/** 목록 행의 글 조각과 끝 배지. 행 목록의 객체 안에서 요소를 직접 쓰지 않으려고 함수로 뺐다 */
function detailOf(row: WebToolRow): ReactNode {
  return <RowDetail row={row} />;
}

function endOf(row: WebToolRow): ReactNode {
  return <StateBadge row={row} />;
}

const STATE_TONE: Readonly<Record<ProviderState, keyof typeof TONE_CLASS>> = {
  ready: "success",
  "needs-key": "warning",
  unavailable: "neutral",
};

function StateBadge(props: { readonly row: WebToolRow }): ReactNode {
  const state = providerStateOf(props.row);
  return <Badge className={TONE_CLASS[STATE_TONE[state]]}>{t(providerStateIdOf(state))}</Badge>;
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
    return [{ id, title: row.displayName, detail: detailOf(row), end: endOf(row) }];
  });
  return (
    <FormLayoutSection title={t("desktop.tools.search.title")}>
      {pinned === null ? (
        <p className="text-ui-sm text-text-secondary">{t("desktop.tools.search.auto")}</p>
      ) : (
        <p className="text-ui-sm text-text-secondary">
          {t("desktop.tools.search.pinned", { id: pinned })}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.tools.search.empty")}</p>
      ) : (
        <OrderedList
          label={t("desktop.tools.order.label")}
          items={items}
          editable={props.editable}
          onMove={props.onMove}
        />
      )}
      {props.saveError === null ? null : <Alert tone="danger">{props.saveError}</Alert>}
    </FormLayoutSection>
  );
}

function BrowseSection(props: { readonly section: WebSection }): ReactNode {
  const { rows } = props.section;
  return (
    <FormLayoutSection title={t("desktop.tools.browse.title")}>
      {rows.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.tools.browse.empty")}</p>
      ) : (
        <List aria-label={t("desktop.tools.browse.title")}>
          {rows.map((row) => (
            <ListRow
              key={row.id}
              title={row.displayName}
              description={<RowDetail row={row} />}
              end={<StateBadge row={row} />}
            />
          ))}
        </List>
      )}
    </FormLayoutSection>
  );
}

function RecommendationSection(props: { readonly items: readonly WebRecommendation[] }): ReactNode {
  return (
    <FormLayoutSection title={t("desktop.tools.recommend.title")}>
      <List aria-label={t("desktop.tools.recommend.title")}>
        {props.items.map((item) => (
          <ListRow
            key={item.providerId}
            title={item.label}
            description={item.hint === "" ? undefined : item.hint}
            end={<Badge>{t(recommendationStateIdOf(item.state))}</Badge>}
          />
        ))}
      </List>
    </FormLayoutSection>
  );
}
