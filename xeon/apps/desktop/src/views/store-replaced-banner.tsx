import { Alert, Button } from "@caustic/react";
import { t } from "@fresnel/client/i18n";
import { useState, type ReactNode } from "react";
import { useHostNotices } from "./host-notices-context.ts";
import { movedStoreFileOf, storeReplacedTextOf } from "./store-replaced-model.ts";

// 시작 때 저장소가 빈 DB 파일을 옮기고 새로 만든 일을 알리는 띠(`host.status.startupNotices`). 대화 화면 맨 위와 설정 개요에 둔다.
// 닫기는 컴포넌트 상태라 이 띠가 다시 그려지기 전(화면을 떠나 다시 열기 전)까지 숨긴다. 원래 파일은 옮긴 자리에 그대로 있다.

export function StoreReplacedBannerView(props: {
  readonly movedTo: string;
  readonly onDismiss: () => void;
}): ReactNode {
  return (
    <Alert
      tone="warning"
      size="sm"
      action={
        <Button size="sm" variant="outline" onClick={props.onDismiss}>
          {t("desktop.status.storeReplaced.dismiss")}
        </Button>
      }
    >
      {storeReplacedTextOf(props.movedTo)}
    </Alert>
  );
}

/** 이번 시작에서 빈 DB를 옮긴 일이 있을 때만 띠를 그린다. 값은 엔진이 실은 알림(`useHostNotices`)에서 읽는다 */
export function StoreReplacedBanner(): ReactNode {
  const notices = useHostNotices();
  const [dismissed, setDismissed] = useState(false);
  const movedTo = movedStoreFileOf(notices?.startupNotices ?? []);
  if (movedTo === null || dismissed) return null;
  return (
    <StoreReplacedBannerView
      movedTo={movedTo}
      onDismiss={() => {
        setDismissed(true);
      }}
    />
  );
}
