import { t } from "@fresnel/client/i18n";
import { Alert, Badge, Button } from "@caustic/react";
import { useId, type ReactNode } from "react";
import { InfoTip } from "../../craft/info-tip.tsx";
import {
  clientRowOf,
  clientsShown,
  type ClientRow,
  type ClientsState,
} from "./connection-model.ts";
import { transportMessageOf } from "./connection-text.ts";

// 상태 카드 안의 "연결된 클라이언트" 목록(W-12). 목록은 `host.clients`가 준다. 연결이 없거나 엔진이 이 메서드를 모르면
// 자리를 숨기고(연결 수 줄과 오프라인 경고가 알린다), 읽지 못하면 작은 경고와 다시 시도를 보인다.
// 이름이 없는 연결은 전송 종류 이름으로 부른다.

export interface ConnectedClientsProps {
  readonly state: ClientsState;
  readonly onRetry: () => void;
}

export function ConnectedClients(props: ConnectedClientsProps): ReactNode {
  const { state, onRetry } = props;
  const headingId = useId();
  if (!clientsShown(state)) return null;
  return (
    <section aria-labelledby={headingId} className="grid gap-2">
      <div className="flex items-center gap-1">
        <h3 id={headingId} className="text-ui-strong text-text-primary">
          {t("desktop.connection.clients.heading")}
        </h3>
        <InfoTip text={t("desktop.connection.clients.info")} />
      </div>
      {state.kind === "loading" ? (
        <p role="status" className="text-ui-sm text-text-tertiary">
          {t("desktop.connection.clients.loading")}
        </p>
      ) : null}
      {state.kind === "failed" ? (
        <Alert
          tone="danger"
          size="sm"
          action={
            <Button size="xs" variant="outline" onClick={onRetry}>
              {t("desktop.connection.retry")}
            </Button>
          }
        >
          {t("desktop.connection.clients.loadFailed")}
        </Alert>
      ) : null}
      {state.kind === "ready" && state.clients.length === 0 ? (
        <p className="text-ui-sm text-text-tertiary">{t("desktop.connection.clients.empty")}</p>
      ) : null}
      {state.kind === "ready" && state.clients.length > 0 ? (
        <ul className="grid gap-2">
          {state.clients.map((client) => {
            const row = clientRowOf(client);
            return <ClientItem key={row.id} row={row} />;
          })}
        </ul>
      ) : null}
    </section>
  );
}

function ClientItem(props: { readonly row: ClientRow }): ReactNode {
  const { row } = props;
  const transport = t(transportMessageOf(row.transport));
  // 이름이 없으면 전송 종류가 이름 자리에 가고 둘째 줄에는 버전만 남는다
  const title = row.name ?? transport;
  const detail: string[] = [];
  if (row.name !== null) detail.push(transport);
  if (row.version !== null) detail.push(row.version);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg border border-border-default bg-surface-base px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-ui text-text-primary">
          <span className="min-w-0 break-all">{title}</span>
          {row.self ? <Badge size="xs">{t("desktop.connection.clients.self")}</Badge> : null}
        </p>
        {detail.length === 0 ? null : (
          <p className="text-ui-sm text-text-tertiary">{detail.join(" · ")}</p>
        )}
      </div>
      <p className="text-ui-sm text-text-secondary">
        {t("desktop.connection.clients.threads", {
          write: row.writeThreads,
          observe: row.observedThreads,
        })}
      </p>
    </li>
  );
}
