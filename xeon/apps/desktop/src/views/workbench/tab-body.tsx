// P-17 탭의 바깥 상태 그림: 읽는 중(`Skeleton`), 오프라인(한 줄), 오류(한 줄), 마지막 값(연결이 끊겼을 때 "마지막으로 읽은 값" 글 아래에 그대로).
// 값이 있을 때의 그림은 `render`가 그린다. 상태의 뜻은 `tabReadOf`(@fresnel/client/workbench)가 정한다.
import { t } from "@fresnel/client/i18n";
import type { TabRead } from "@fresnel/client/workbench";
import { assertNever } from "@fresnel/contracts";
import { Alert, Skeleton } from "@caustic/react";
import type { ReactNode } from "react";

/** 보조 글(빈 문장, 상태 한 줄)의 자리 */
export const MUTED = "m-0 text-ui-sm text-text-tertiary";

export function TabBody<T>(props: {
  readonly read: TabRead<T>;
  readonly render: (value: T) => ReactNode;
}): ReactNode {
  const { read } = props;
  switch (read.kind) {
    case "loading":
      return <Skeleton height={24} />;
    case "offline":
      return <p className={MUTED}>{t("desktop.workbench.detail.offline")}</p>;
    case "error":
      return <Alert tone="danger">{t("desktop.workbench.detail.load.failed")}</Alert>;
    case "ready":
      return (
        <div className="grid gap-2">
          {read.stale && <p className={MUTED}>{t("desktop.workbench.detail.stale")}</p>}
          {props.render(read.value)}
        </div>
      );
    default:
      return assertNever(read, "TabRead");
  }
}
