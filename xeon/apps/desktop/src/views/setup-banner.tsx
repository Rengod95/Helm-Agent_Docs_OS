import type { ReactNode } from "react";
import { t } from "@fresnel/client/i18n";
import { useShellActions } from "../state/shell/index.ts";
import { setupRequiredText, useSetupNeeded } from "./setup-needed.ts";

// 첫 실행 안내 띠(G2-08). 모델 키와 기본 모델이 끝나지 않았으면 대화 화면 위에서 첫 실행 화면(P-01)을 무대에 연다.
// 설정을 읽지 못하는 연결(오래된 엔진 등)에서는 아무것도 그리지 않는다. 입력창도 같은 판단으로 잠긴다.

export function SetupBanner(): ReactNode {
  const shell = useShellActions();
  const needed = useSetupNeeded();
  if (!needed) return null;
  return (
    <div className="setup-banner" role="status">
      <span>{setupRequiredText()}</span>{" "}
      <button
        type="button"
        className="primary"
        onClick={() => {
          shell.updatePlace({ screen: "first-run" });
        }}
      >
        {t("desktop.setup.openSettings.button")}
      </button>
    </div>
  );
}
