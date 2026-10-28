import type { ReactNode } from "react";
import { useCommands } from "./commands.ts";
import { SETUP_REQUIRED_TEXT, useSetupNeeded } from "./setup-needed.ts";

// 첫 실행 안내 띠(G2-08). 모델 키와 기본 모델이 끝나지 않았으면 대화 화면 위에서 설정 화면을 연다.
// 설정을 읽지 못하는 연결(오래된 엔진 등)에서는 아무것도 그리지 않는다. 입력창도 같은 판단으로 잠긴다.

export function SetupBanner(): ReactNode {
  const commands = useCommands();
  const needed = useSetupNeeded();
  if (!needed) return null;
  return (
    <div className="setup-banner" role="status">
      <span>{SETUP_REQUIRED_TEXT}</span>{" "}
      <button
        type="button"
        className="primary"
        onClick={() => {
          commands.showScreen("settings");
        }}
      >
        설정 열기
      </button>
    </div>
  );
}
