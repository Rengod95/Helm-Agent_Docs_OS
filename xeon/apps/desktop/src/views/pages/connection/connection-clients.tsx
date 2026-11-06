import { t } from "@fresnel/client/i18n";
import { Button, ListDescriptionRow, Skeleton } from "@caustic/react";
import type { ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import { clientRowOf, clientsShown, type ClientsState } from "./connection-model.ts";
import { transportMessageOf } from "./connection-text.ts";

// 상태 목록의 "연결된 클라이언트" 한 줄(W-12). 목록은 `host.clients`가 준다. 연결이 없거나 엔진이 이 메서드를 모르면 줄을 숨기고,
// 읽지 못하면 줄 안에 경고와 다시 시도를 보인다. 값은 이름 목록이고 이 앱은 "이 앱"으로 부른다. 이름이 없으면 전송 종류 이름이다.
// 설명은 정보 아이콘 뒤에 둔다.

interface ConnectedClientsRowProps {
  readonly state: ClientsState;
  readonly onRetry: () => void;
}

export function ConnectedClientsRow(props: ConnectedClientsRowProps): ReactNode {
  const { state, onRetry } = props;
  if (!clientsShown(state)) return null;
  const term = (
    <span className="inline-flex items-center gap-1">
      {t("desktop.connection.clients.heading")}
      <InfoTip text={t("desktop.connection.clients.info")} />
    </span>
  );
  return (
    <ListDescriptionRow term={term}>
      {state.kind === "loading" ? (
        <span role="status" className="inline-flex items-center gap-2">
          <Skeleton width="8rem" height={12} />
          <span className="sr-only">{t("desktop.connection.clients.loading")}</span>
        </span>
      ) : null}
      {state.kind === "failed" ? (
        <span role="alert" className="inline-flex flex-wrap items-center gap-2 text-danger-text">
          {t("desktop.connection.clients.loadFailed")}
          <Button size="xs" variant="outline" onClick={onRetry}>
            {t("desktop.connection.retry")}
          </Button>
        </span>
      ) : null}
      {state.kind === "ready" && state.clients.length === 0
        ? t("desktop.connection.clients.empty")
        : null}
      {state.kind === "ready" && state.clients.length > 0
        ? state.clients
            .map((client) => {
              const row = clientRowOf(client);
              if (row.self) return t("desktop.connection.clients.self");
              return row.name ?? t(transportMessageOf(row.transport));
            })
            .join(", ")
        : null}
    </ListDescriptionRow>
  );
}
