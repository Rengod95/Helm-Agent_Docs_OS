import { Alert, Button } from "@caustic/react";
import type { ReactNode } from "react";
import { t } from "@fresnel/client/i18n";
import { useShellActions } from "../state/shell/index.ts";
import { setupRequiredText, useSetupNeeded } from "./setup-needed.ts";

// 첫 실행 안내 띠(G2-08). 모델 키와 기본 모델이 끝나지 않았으면 대화 화면 위에서 시작 안내(첫 실행 화면 P-01)를 무대에 여는 길을 보인다.
// 설정을 읽지 못하는 연결(오래된 엔진 등)에서는 아무것도 그리지 않는다. 입력창도 같은 판단으로 잠긴다.

/** 띠의 그림. 단추 글자는 "시작 안내 열기"다: 안내 단계 진행은 설정 값에서 오므로 다시 열어도 그대로다(rtE R-7) */
export function SetupBannerView(props: { readonly onOpen: () => void }): ReactNode {
  return (
    <Alert
      tone="warning"
      size="sm"
      action={
        <Button size="sm" variant="solid" onClick={props.onOpen}>
          {t("desktop.setup.openGuide.button")}
        </Button>
      }
    >
      {setupRequiredText()}
    </Alert>
  );
}

export function SetupBanner(): ReactNode {
  const shell = useShellActions();
  const needed = useSetupNeeded();
  if (!needed) return null;
  return (
    <SetupBannerView
      onOpen={() => {
        shell.updatePlace({ screen: "first-run" });
      }}
    />
  );
}
